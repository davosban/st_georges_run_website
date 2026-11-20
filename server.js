'use strict';
// St. George's Sunrise Run & Walk — zero-dependency Node.js 22+ server.
// IMPORTANT: Use a persistent DATA_DIR and HTTPS when deploying for real registrations.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { sendMail } = require('./mailer');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const pos=line.indexOf('='); if (pos === -1) continue;
    const k=line.slice(0,pos).trim(), v=line.slice(pos+1).trim().replace(/^(['"])(.*)\1$/,'$2');
    if (k && process.env[k] === undefined) process.env[k]=v;
  }
}
loadEnv(path.join(__dirname,'.env'));
const cfg = {
  port: Number(process.env.PORT || 3000),
  name: process.env.EVENT_NAME || 'St. George’s Sunrise Run & Walk',
  date: process.env.EVENT_DATE_DISPLAY || 'Friday, 4 December 2026',
  place: process.env.EVENT_LOCATION || 'St. George’s Heights · East Doboro, Ghana',
  momoNumber: (process.env.MOMO_NUMBER || '').trim(),
  momoName: (process.env.MOMO_NAME || '').trim(),
  momoNetwork: (process.env.MOMO_NETWORK || 'MTN Mobile Money').trim(),
  email: (process.env.CONTACT_EMAIL || '').trim(),
  contact: (process.env.CONTACT_PHONE || '').trim(),
  paystack: (process.env.PAYSTACK_SECRET_KEY || '').trim(),
  baseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/,''),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  testMode: process.env.TEST_MODE === 'true',
  prices: { general: Number(process.env.PRICE_GENERAL || 80) },
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: process.env.SMTP_PORT || 465,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  notifyTo: process.env.MAIL_NOTIFICATION_TO || 'bookings@stgeorgesheight.com'
};
const WAIVER_VERSION = process.env.WAIVER_VERSION || 'DRAFT-2026-11-15-v1';
const manualEnabled = /^\+?[\d\s-]{9,18}$/.test(cfg.momoNumber) && cfg.momoName.length > 1;
const paystackEnabled = cfg.paystack.startsWith('sk_') && /^https:\/\/[^/]+\.[^/]+/.test(cfg.baseUrl) && !cfg.baseUrl.includes('your-real-domain.com');
const adminConfigured = cfg.adminPassword.length >= 12 && !cfg.adminPassword.startsWith('REPLACE_') && cfg.sessionSecret.length >= 40 && !cfg.sessionSecret.startsWith('REPLACE_');
const registrationEnabled = adminConfigured || cfg.testMode;
const paymentUrl = 'https://stgeorgesheight.com/product/sunrise-run-walk-ticket/';
const dbDir=process.env.DATA_DIR || path.join(__dirname,'data');
fs.mkdirSync(dbDir,{recursive:true});
const db=new DatabaseSync(path.join(dbDir,'registrations.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS registrations (
   id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE,
   full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, distance TEXT NOT NULL,
   ticket TEXT NOT NULL, members_json TEXT NOT NULL DEFAULT '[]', participants INTEGER NOT NULL,
   amount_pesewas INTEGER NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL,
   gateway_reference TEXT UNIQUE, transfer_reference TEXT, shirt_size TEXT, guardian_confirmed INTEGER NOT NULL DEFAULT 0,
   marketing_opt_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, paid_at TEXT
  );
  CREATE TABLE IF NOT EXISTS payment_attempts (reference TEXT PRIMARY KEY, token TEXT NOT NULL, checkout_url TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_payment_attempts_token ON payment_attempts(token);
  CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
  CREATE INDEX IF NOT EXISTS idx_reg_created ON registrations(created_at);
`);
// Safe additive migration for an existing SQLite file.
if(!db.prepare('PRAGMA table_info(registrations)').all().some(c=>c.name==='shirt_size')) db.exec('ALTER TABLE registrations ADD COLUMN shirt_size TEXT');
// Record the version and timestamp of each safety acknowledgement, without collecting diagnoses.
for(const [name,definition] of Object.entries({
 waiver_version:'TEXT',waiver_accepted_at:'TEXT',medical_consent:'INTEGER NOT NULL DEFAULT 0',
 photo_consent:'INTEGER NOT NULL DEFAULT 0',emergency_name:'TEXT',emergency_phone:'TEXT',
 age_group:'TEXT',guardian_name:'TEXT',guardian_phone:'TEXT'
})){if(!db.prepare('PRAGMA table_info(registrations)').all().some(c=>c.name===name))db.exec(`ALTER TABLE registrations ADD COLUMN ${name} ${definition}`);}
const sql={
  insert: db.prepare(`INSERT INTO registrations(token,code,full_name,email,phone,distance,ticket,members_json,participants,amount_pesewas,method,status,shirt_size,guardian_confirmed,marketing_opt_in,created_at,updated_at,waiver_version,waiver_accepted_at,medical_consent,photo_consent,emergency_name,emergency_phone,age_group,guardian_name,guardian_phone) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  getByToken: db.prepare('SELECT * FROM registrations WHERE token = ?'),
  getByCode: db.prepare('SELECT * FROM registrations WHERE code = ?'),
  getByGateway: db.prepare('SELECT r.* FROM registrations r JOIN payment_attempts a ON a.token = r.token WHERE a.reference = ?'),
  attempts: db.prepare('SELECT reference FROM payment_attempts WHERE token=? ORDER BY created_at DESC LIMIT 6'),
  saveAttempt: db.prepare('INSERT INTO payment_attempts(reference,token,checkout_url,created_at) VALUES(?,?,?,?)'),
  list: db.prepare('SELECT * FROM registrations ORDER BY id DESC LIMIT 5000'),
  updateGateway: db.prepare('UPDATE registrations SET gateway_reference=?,updated_at=? WHERE token=?'),
  updateTransfer: db.prepare('UPDATE registrations SET transfer_reference=?, status=?,updated_at=? WHERE token=? AND status IN (\'awaiting_payment\',\'pending_verification\')'),
  updateStatus: db.prepare('UPDATE registrations SET status=?,paid_at=?,updated_at=? WHERE id=?'),
};
const rate=new Map();
const now=()=>new Date().toISOString();
const random=()=>crypto.randomBytes(18).toString('base64url');
function clean(v,n=120){return typeof v==='string'?v.trim().slice(0,n):'';}
function money(p){return `GH₵${(p/100).toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));}
function json(res,status,data,headers={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(JSON.stringify(data));}
function html(res,markup,status=200,headers={}){res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',...headers});res.end(markup);}
function error(res,status,message){json(res,status,{ok:false,error:message});}
function getCookie(req,name){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';}
function sign(value){return crypto.createHmac('sha256',cfg.sessionSecret).update(value).digest('hex');}
function adminAuthed(req){if(!adminConfigured)return false;let value=getCookie(req,'stg_admin'); const p=value.lastIndexOf('.');if(p<0)return false;const content=value.slice(0,p),sig=value.slice(p+1);if(!/^[0-9a-f]{64}$/.test(sig))return false; if(!crypto.timingSafeEqual(Buffer.from(sign(content)),Buffer.from(sig)))return false;let expiry=Number(content);return expiry>Date.now() && expiry<Date.now()+86400000;}
function checkOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===(req.headers['x-forwarded-host']||req.headers.host);}catch{return false;}}
async function readBody(req,limit=16000){const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>limit)throw new Error('Request is too large'); chunks.push(part);}return Buffer.concat(chunks);}
function sendStatic(req,res,filename){const ext=path.extname(filename);const type={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'}[ext]||'application/octet-stream'; const file=path.join(__dirname,'public',filename);if(!fs.existsSync(file)){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'content-type':type,'cache-control':ext==='.html'?'no-store':'public, max-age=3600'});fs.createReadStream(file).pipe(res);}
function previewBanner(){return cfg.testMode?'<div class="preview-banner">TEST MODE — DO NOT SHARE THIS SITE OR SEND REAL PAYMENTS. Use fictional registration details only.</div>':registrationEnabled?'':'<div class="preview-banner">Preview mode: registration is currently closed.</div>';}
function page(title,body,scripts=''){
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#20362b"><title>${escapeHtml(title)} · St. George’s</title><meta name="description" content="Register for St. George’s Sunrise Run & Walk — The Doboro Edition."><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/style.css"></head><body>${previewBanner()}${body}<script src="/app.js" defer></script>${scripts}</body></html>`;
}
function nav(){return `<header class="nav"><a class="brand" href="/" aria-label="St George's home"><span class="brand-mark">SG<span class="brand-star">✳</span></span><span class="brand-name">ST. GEORGE’S<small>HEIGHTS · DOBORO</small></span></a><nav class="nav-links"><a href="/#experience">The experience</a><a href="/#tickets">Tickets</a><a href="/#faqs">FAQs</a></nav><a class="nav-cta" href="/#register">Register <span aria-hidden="true">↗</span></a></header>`;}
function footer(){return `<footer class="footer"><div class="footer-brand">ST. GEORGE’S <span>RUN & WALK</span></div><div>East Doboro, Ghana · A different route. A better morning.</div><div class="footer-note">${cfg.email?`Enquiries: <a href="mailto:${escapeHtml(cfg.email)}">${escapeHtml(cfg.email)}</a>`:'Event details and contact information will be announced by the organisers.'}</div><p>Participation is voluntary and subject to event safety instructions.</p></footer>`;}
function waiverPage(){
 return fs.readFileSync(path.join(__dirname,'public','waiver.html'),'utf8')
  .replaceAll('{{WAIVER_VERSION}}',escapeHtml(WAIVER_VERSION));
}
function home(){
 return fs.readFileSync(path.join(__dirname,'public','index.html'),'utf8')
  .replace('<body>', `<body>${previewBanner()}`)
  .replace('action="register.php"', 'action="/api/register"')
  .replace('id="submitBtn"', registrationEnabled ? 'id="submitBtn"' : 'id="submitBtn" disabled');
}
function payablePage(r){const method=r.method; const status=r.status;
const paid=status==='paid';const awaiting=status==='awaiting_payment'; const manual=method==='manual';
const desc=paid?'Payment confirmed. Your place is secured.':status==='pending_verification'?'We have your transaction reference. The team will verify it against our MoMo statement.':status==='rejected'?'This registration has not been confirmed. Please contact the organising team.':method==='external'?'Continue to the payment page to complete your registration.':manual?'Transfer the exact amount to the official account below, then provide your transaction reference.':'Complete the secure checkout. Registration is confirmed only after the payment provider verifies payment.';
const input=manual&&awaiting?`<form id="referenceForm" class="reference-form"><label for="transactionRef">MoMo transaction ID / reference</label><div class="reference-inline"><input id="transactionRef" name="transactionRef" maxlength="80" required placeholder="e.g. 1234567890" autocomplete="off"><button class="btn primary" type="submit">Submit reference</button></div><p class="fine-print">Submitting a reference does not confirm payment. Our team must verify receipt.</p><p class="form-msg" role="alert" id="refMessage"></p></form>`:'';
const details=manual&&status!=='paid'?`<div class="pay-details"><div><span>Network</span><strong>${escapeHtml(cfg.momoNetwork)}</strong></div><div><span>Official MoMo number</span><strong>${escapeHtml(cfg.momoNumber)}</strong><button class="copy-btn" type="button" data-copy="${escapeHtml(cfg.momoNumber)}">Copy</button></div><div><span>Account name (verify this)</span><strong>${escapeHtml(cfg.momoName)}</strong></div><div><span>Amount to transfer</span><strong>${money(r.amount_pesewas)}</strong></div><div><span>Payment note / reference</span><strong>${escapeHtml(r.code)}</strong><button class="copy-btn" type="button" data-copy="${escapeHtml(r.code)}">Copy</button></div></div><p class="security-note">Only make payment after the displayed MoMo account name matches. Do not enter your MoMo PIN anywhere on this website.</p>`:'';
const retry=awaiting&&method==='external'?`<a class="btn primary" href="${paymentUrl}">Continue to payment</a>`:!paid&&method==='paystack'&&status!=='rejected'?`<button class="btn primary" data-paystack-retry="${escapeHtml(r.token)}">Continue secure MoMo payment <span aria-hidden="true">↗</span></button>`:'';
return page('Your registration',`${nav()}<main class="receipt-wrapper"><div class="receipt-card"><div class="receipt-top"><div class="eyebrow">ST. GEORGE’S · THE DOBORO EDITION</div><div class="receipt-tag ${paid?'paid':status==='rejected'?'rejected':'pending'}">${paid?'✓ CONFIRMED':status==='pending_verification'?'● AWAITING VERIFICATION':status==='rejected'?'UNCONFIRMED':'● PAYMENT PENDING'}</div></div><h1>${paid?'You’re on the list.':'One step closer to the start line.'}</h1><p class="receipt-intro">${escapeHtml(desc)}</p><div class="receipt-summary"><div><small>Registration ID</small><strong>${escapeHtml(r.code)}</strong></div><div><small>Lead participant</small><strong>${escapeHtml(r.full_name)}</strong></div><div><small>Ticket</small><strong>${escapeHtml(r.ticket==='general'?'General admission':r.ticket)} · ${escapeHtml(r.distance)}</strong></div><div><small>Total</small><strong>${money(r.amount_pesewas)}</strong></div></div>${details}${input}${retry}<p class="fine-print">Save this page and your registration ID. ${paid?'We look forward to welcoming you to Doboro.':'Refresh this page later to check your payment status.'}</p><a class="back-link" href="/">← Back to event page</a></div></main>${footer()}`);
}
function adminLoginPage(){return page('Organiser login',`${nav()}<main class="receipt-wrapper"><form class="receipt-card admin-login" id="adminLogin"><div class="eyebrow">ORGANISER ACCESS</div><h1>Registration dashboard</h1><p class="receipt-intro">Authorised event staff only.</p><label for="adminPassword">Admin password</label><input type="password" name="password" id="adminPassword" required minlength="8" autocomplete="current-password"><button type="submit" class="btn primary full-width">Sign in</button><p class="form-msg" id="loginMsg" role="alert"></p></form></main>${footer()}`);}
function adminPage(){return page('Organiser dashboard',`${nav()}<main class="dashboard"><div class="dashboard-head"><div><div class="eyebrow">PRIVATE EVENT OPERATIONS</div><h1>Registration dashboard</h1><p>Verify MoMo payments against your official transaction history before marking anyone paid.</p></div><div class="dash-actions"><a href="/api/admin/export" class="btn secondary">Export CSV ↓</a><button id="logout" class="btn tertiary">Sign out</button></div></div><div id="stats" class="stat-grid"></div><div class="table-wrap"><table><thead><tr><th>Registration</th><th>Participant</th><th>Ticket</th><th>Amount</th><th>Payment</th><th>Transaction ref.</th><th>Action</th></tr></thead><tbody id="adminRows"><tr><td colspan="7">Loading…</td></tr></tbody></table></div><p class="fine-print">Payment statuses are recorded in your database. This dashboard displays up to 5,000 most recent registrations.</p></main>${footer()}`);}
function csvCell(v){return '"'+String(v??'').replace(/^[=+\-@]/,'\'$&').replace(/"/g,'""')+'"';}
function rowPublic(r){return {token:r.token,code:r.code,name:r.full_name,ticket:r.ticket,distance:r.distance,participants:r.participants,amount:r.amount_pesewas,status:r.status,method:r.method,date:cfg.date};}
async function paystackVerify(r){if(!r || r.method!=='paystack' || r.status==='paid'||!cfg.paystack)return r;
for(const attempt of sql.attempts.all(r.token)){try{const res=await fetch('https://api.paystack.co/transaction/verify/'+encodeURIComponent(attempt.reference),{headers:{Authorization:'Bearer '+cfg.paystack},signal:AbortSignal.timeout(9000)});const response=await res.json();const d=response?.data;
 if(res.ok && response.status && d?.status==='success' && d?.reference===attempt.reference && d?.currency==='GHS' && Number(d?.amount)===r.amount_pesewas){sql.updateStatus.run('paid',now(),now(),r.id);return sql.getByToken.get(r.token);}
 }catch(e){console.error('Paystack verification unavailable:',e.message);break;}}return r;}
async function beginPaystack(r){if(!paystackEnabled)throw new Error('Automatic MoMo checkout has not been configured');if(r.status==='paid')throw new Error('Payment is already confirmed');
 const ref='STG'+Date.now().toString(36).toUpperCase()+crypto.randomBytes(5).toString('hex').toUpperCase();
 const payload={email:r.email,amount:String(r.amount_pesewas),currency:'GHS',reference:ref,channels:['mobile_money'],callback_url:`${cfg.baseUrl}/pay/${encodeURIComponent(r.token)}?gateway=return`,metadata:{registration_code:r.code}};
 const response=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:'Bearer '+cfg.paystack,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
 const body=await response.json(); if(!response.ok||!body.status||!/^https:\/\//.test(body.data?.authorization_url||''))throw new Error('Payment provider could not start checkout. Try again.');
 sql.saveAttempt.run(ref,r.token,body.data.authorization_url,now());sql.updateGateway.run(ref,now(),r.token);return body.data.authorization_url;
}
function notifyRegistration(r) {
  if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) return;
  const subject = `[New Registration] ${r.code} - ${r.full_name} (${r.distance})`;
  const text = [
    `New registration received for ${cfg.name}:`,
    ``,
    `Registration Code: ${r.code}`,
    `Full Name: ${r.full_name}`,
    `Email: ${r.email}`,
    `Phone: ${r.phone}`,
    `Route / Distance: ${r.distance}`,
    `Ticket: ${r.ticket} (GH₵${r.amount_pesewas / 100})`,
    `Age Group: ${r.age_group}`,
    `Payment Method: ${r.method}`,
    `Payment Status: ${r.status}`,
    `Emergency Contact: ${r.emergency_name} (${r.emergency_phone})`,
    r.age_group === 'under18' ? `Guardian Contact: ${r.guardian_name} (${r.guardian_phone})` : '',
    `Medical Consent: ${r.medical_consent ? 'Yes' : 'No'}`,
    `Waiver Accepted: ${r.waiver_accepted_at ? 'Yes (version ' + r.waiver_version + ')' : 'No'}`,
    `Photo Consent: ${r.photo_consent ? 'Yes' : 'No'}`,
    `Marketing Consent: ${r.marketing_opt_in ? 'Yes' : 'No'}`,
    `Registration Date: ${r.created_at}`,
    ``,
    `View or verify in the organiser admin panel.`
  ].filter(Boolean).join('\n');

  sendMail({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    user: cfg.smtpUser,
    pass: cfg.smtpPass,
    from: `"${cfg.name}" <${cfg.smtpUser}>`,
    to: cfg.notifyTo,
    replyTo: r.email,
    subject,
    text
  }).then(() => {
    console.log(`Notification email sent to ${cfg.notifyTo} for registration ${r.code}`);
  }).catch(err => {
    console.error(`Failed to send registration notification for ${r.code}:`, err.message);
  });

  // Also send an acknowledgement email to participant
  const participantSubject = `Registration Confirmation - ${cfg.name} (${r.code})`;
  const participantText = [
    `Hello ${r.full_name},`,
    ``,
    `Thank you for registering for ${cfg.name}!`,
    ``,
    `Registration Details:`,
    `- Registration Code: ${r.code}`,
    `- Route: ${r.distance}`,
    `- Amount: GH₵${r.amount_pesewas / 100}`,
    `- Event Date: ${cfg.date}`,
    `- Location: ${cfg.place}`,
    ``,
    `To complete your ticket purchase, please proceed here:`,
    paymentUrl,
    ``,
    `If you have any questions, you can reply directly to this email or contact us at ${cfg.notifyTo}.`,
    ``,
    `Warm regards,`,
    `The Organising Team`,
    `St. George’s Heights`
  ].join('\n');

  sendMail({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    user: cfg.smtpUser,
    pass: cfg.smtpPass,
    from: `"${cfg.name}" <${cfg.smtpUser}>`,
    to: r.email,
    replyTo: cfg.notifyTo,
    subject: participantSubject,
    text: participantText
  }).then(() => {
    console.log(`Confirmation email sent to participant ${r.email} for registration ${r.code}`);
  }).catch(err => {
    console.error(`Failed to send participant confirmation for ${r.code}:`, err.message);
  });
}

async function handle(req,res){
 const pathname=new URL(req.url,'http://localhost').pathname;
 const method=req.method||'GET';
 if(method==='GET' && ['/', '/index.html'].includes(pathname))return html(res,home());
 if(method==='GET' && ['/waiver', '/waiver.html'].includes(pathname))return html(res,waiverPage());
 if(method==='GET' && ['/style.css','/app.js','/favicon.svg'].includes(pathname))return sendStatic(req,res,pathname.slice(1));
 if(method==='GET' && pathname==='/api/config')return json(res,200,{ok:true,name:cfg.name,date:cfg.date,location:cfg.place,prices:cfg.prices,paymentMethods:{manual:manualEnabled,paystack:paystackEnabled},registrationEnabled,testMode:cfg.testMode,waiverVersion:WAIVER_VERSION});
 if(method==='GET' && /^\/pay\/[a-zA-Z0-9_-]{24}$/.test(pathname)){let r=sql.getByToken.get(pathname.split('/')[2]);if(!r)return html(res,page('Not found',`${nav()}<main class="receipt-wrapper"><div class="receipt-card"><h1>Registration not found.</h1><a href="/">Return to the event</a></div></main>${footer()}`),404);r=await paystackVerify(r);return html(res,payablePage(r));}
 if(method==='GET' && /^\/api\/registration\/[a-zA-Z0-9_-]{24}$/.test(pathname)){let r=sql.getByToken.get(pathname.split('/')[3]);if(!r)return error(res,404,'Registration not found');r=await paystackVerify(r);return json(res,200,{ok:true,registration:rowPublic(r)});}
 if(method==='GET' && pathname==='/admin')return html(res,adminAuthed(req)?adminPage():adminLoginPage());
 if(method==='GET' && pathname==='/api/admin/list'){if(!adminAuthed(req))return error(res,401,'Not authorised');const rows=sql.list.all().map(r=>({id:r.id,code:r.code,name:r.full_name,email:r.email,phone:r.phone,distance:r.distance,ticket:r.ticket,shirtSize:r.shirt_size,ageGroup:r.age_group,waiverVersion:r.waiver_version,waiverAccepted:!!r.waiver_accepted_at,participants:r.participants,amount:r.amount_pesewas,method:r.method,status:r.status,transactionRef:r.transfer_reference||'',created:r.created_at}));return json(res,200,{ok:true,rows});}
 if(method==='GET' && pathname==='/api/admin/export'){if(!adminAuthed(req))return error(res,401,'Not authorised');const rows=sql.list.all();const columns=['code','full_name','email','phone','distance','ticket','shirt_size','participants','amount_pesewas','method','status','transfer_reference','gateway_reference','members_json','guardian_confirmed','marketing_opt_in','age_group','guardian_name','guardian_phone','emergency_name','emergency_phone','waiver_version','waiver_accepted_at','medical_consent','photo_consent','created_at','paid_at'];const data=[columns.join(','),...rows.map(r=>columns.map(k=>csvCell(r[k])).join(','))].join('\r\n');res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="st-georges-registrations.csv"','cache-control':'no-store'});res.end('\uFEFF'+data);return;}
 if(!['POST','PUT','PATCH','DELETE'].includes(method)){res.writeHead(404);return res.end('Not found');}
 if(!checkOrigin(req))return error(res,403,'Untrusted request origin');
 if(pathname==='/api/paystack/webhook' && method==='POST'){const raw=await readBody(req,100000);if(!cfg.paystack)return error(res,404,'Gateway not set up');const supplied=req.headers['x-paystack-signature']||'';const expected=crypto.createHmac('sha512',cfg.paystack).update(raw).digest('hex');if(typeof supplied!=='string'||!/^[0-9a-f]{128}$/i.test(supplied)||!crypto.timingSafeEqual(Buffer.from(supplied.toLowerCase()),Buffer.from(expected)))return error(res,401,'Invalid signature');const event=JSON.parse(raw.toString());if(event.event==='charge.success'){const d=event.data||{};const r=sql.getByGateway.get(d.reference||'');if(r && r.status!=='paid' && r.method==='paystack' && Number(d.amount)===r.amount_pesewas && d.currency==='GHS' && d.status==='success')sql.updateStatus.run('paid',now(),now(),r.id);}return json(res,200,{ok:true});}
 const rawBody=(await readBody(req)).toString();
 const registrationForm=pathname==='/api/register' && method==='POST' &&
  req.headers['content-type']?.split(';')[0]==='application/x-www-form-urlencoded';
 const b=registrationForm ? Object.fromEntries(new URLSearchParams(rawBody)) : JSON.parse(rawBody||'{}');
 if(pathname==='/api/register' && method==='POST'){
  if(!registrationEnabled)return error(res,503,'Registrations are not yet open');
  const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0];const t=Date.now();const arr=(rate.get(ip)||[]).filter(x=>t-x<600000);if(arr.length>=7)return error(res,429,'Too many attempts. Please try again later.');arr.push(t);rate.set(ip,arr);if(rate.size>10000)rate.clear();
  const name=clean(b.fullName,100),email=clean(b.email,160).toLowerCase(),phone=clean(b.phone,25),distance='5 km',ticket='general',paymentMethod='external';
  if(name.length<3||!name.includes(' ')||!/^\S+@\S+\.\S+$/.test(email)||!/^\+?\d[\d\s-]{8,15}$/.test(phone))return error(res,400,'Enter your full name, valid email address and contact number');
  if(!b.agree||!b.waiverAccepted||!b.medicalConsent)return error(res,400,'Please read and accept the health declaration, first-aid consent and event terms');
  const ageGroup=clean(b.ageGroup,10),emergencyName=clean(b.emergencyName,100),emergencyPhone=clean(b.emergencyPhone,25);
  const guardianName=clean(b.guardianName,100),guardianPhone=clean(b.guardianPhone,25);
  if(!['adult','under18'].includes(ageGroup))return error(res,400,'Select a valid participant age group');
  if(emergencyName.length<3||!/^\+?\d[\d\s-]{8,15}$/.test(emergencyPhone))return error(res,400,'Enter a valid emergency contact name and phone');
  if(ageGroup==='under18'&&(!b.guardianAcknowledged||guardianName.length<3||!/^\+?\d[\d\s-]{8,15}$/.test(guardianPhone)))return error(res,400,'Under-18 participants require parent/guardian approval and contact details');
  const members=[];
  const amount=cfg.prices[ticket]*100;if(!Number.isSafeInteger(amount)||amount<100)return error(res,500,'Ticket prices are not configured correctly');
  const token=random(),code='SG-'+crypto.randomBytes(4).toString('hex').toUpperCase();
  try{db.exec('BEGIN IMMEDIATE');sql.insert.run(token,code,name,email,phone,distance,ticket,JSON.stringify(members),1,amount,paymentMethod,'awaiting_payment','',ageGroup==='under18'?1:0,b.marketing?1:0,now(),now(),WAIVER_VERSION,now(),1,b.photoConsent?1:0,emergencyName,emergencyPhone,ageGroup,ageGroup==='under18'?guardianName:'',ageGroup==='under18'?guardianPhone:'');db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK')}catch{};console.error(e);return error(res,500,'Unable to create registration');}
  if(registrationForm){
   res.writeHead(303,{location:paymentUrl});
   return res.end();
  }
  return json(res,201,{ok:true,code,redirect:paymentUrl});
 }
 if(pathname==='/api/transfer-reference' && method==='POST'){
  const r=sql.getByToken.get(clean(b.token,32));if(!r||r.method!=='manual')return error(res,404,'Registration not found');if(r.status==='paid'||r.status==='rejected')return error(res,409,'This registration is no longer awaiting payment');const tx=clean(b.transactionRef,80);if(!/^[A-Za-z0-9 /_\-.]{6,80}$/.test(tx))return error(res,400,'Enter a valid MoMo transaction reference');const existing=db.prepare("SELECT code FROM registrations WHERE transfer_reference=? AND token<>? AND status!='rejected' LIMIT 1").get(tx,r.token);if(existing)return error(res,409,'This transaction reference was submitted already. Contact the organisers if you believe this is a mistake');sql.updateTransfer.run(tx,'pending_verification',now(),r.token);return json(res,200,{ok:true,status:'pending_verification'});
 }
 if(pathname==='/api/paystack/retry' && method==='POST'){const r=sql.getByToken.get(clean(b.token,32));if(!r||r.method!=='paystack')return error(res,404,'Registration not found');try{const url=await beginPaystack(r);return json(res,200,{ok:true,redirect:url});}catch(e){return error(res,502,e.message);}}
 if(pathname==='/api/admin/login' && method==='POST'){if(!adminConfigured)return error(res,503,'Set secure admin credentials before launch');const input=String(b.password||'');const a=Buffer.from(input),expected=Buffer.from(cfg.adminPassword);if(a.length!==expected.length||!crypto.timingSafeEqual(a,expected))return error(res,401,'Incorrect password');const expiry=String(Date.now()+8*60*60*1000);const secure=req.socket.encrypted||req.headers['x-forwarded-proto']==='https';json(res,200,{ok:true},{'set-cookie':`stg_admin=${expiry}.${sign(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure?'; Secure':''}`});return;}
 if(pathname==='/api/admin/logout' && method==='POST'){return json(res,200,{ok:true},{'set-cookie':'stg_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
 if(pathname==='/api/admin/status' && method==='POST'){if(!adminAuthed(req))return error(res,401,'Not authorised');const id=Number(b.id),status=clean(b.status,32);if(!Number.isInteger(id)||!['paid','rejected','pending_verification'].includes(status))return error(res,400,'Invalid status change');const r=db.prepare('SELECT * FROM registrations WHERE id=?').get(id);if(!r)return error(res,404,'Registration not found');if(r.method==='paystack'&&status==='paid')return error(res,403,'Gateway payments must be verified automatically, not marked paid manually');sql.updateStatus.run(status,status==='paid'?now():null,now(),id);return json(res,200,{ok:true});}
 return error(res,404,'Not found');
}
const server=http.createServer((req,res)=>{
 const headers={ 'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"};
 for(const [k,v] of Object.entries(headers))res.setHeader(k,v);
 Promise.resolve(handle(req,res)).catch(e=>{console.error('Request failed',e);if(!res.headersSent)error(res,500,'An unexpected error occurred');else res.end();});
});
server.listen(cfg.port,()=>{console.log(`St. George's website: http://localhost:${cfg.port}`);console.log(`Registrations: ${registrationEnabled?'enabled':'PREVIEW ONLY'}; direct MoMo: ${manualEnabled?'ready':'not configured'}; Paystack: ${paystackEnabled?'ready':'not configured'}`);});
