'use strict';
const $=(s,root=document)=>root.querySelector(s);
const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const formatGhs=v=>'GH₵'+Number(v||0).toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2});
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,data){const options=data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)};const response=await fetch(path,options);let result;try{result=await response.json();}catch{throw Error('Server could not be reached');}if(!response.ok||!result.ok)throw Error(result.error||'Something went wrong');return result;}
function showMessage(el,message,color='#a44130'){if(!el)return;el.textContent=message;el.style.color=color;}
async function initRegistration(){
 const form=$('#registrationForm');if(!form)return;
 const msg=$('#formMessage'),button=$('#submitBtn'),total=$('#formTotal');let config;
 try{config=await api('/api/config');}catch(e){showMessage(msg,'Could not check registration availability. Please refresh the page.');button.disabled=true;return;}
 total.textContent=formatGhs(config.prices.general);
 const radioManual=$('input[name="method"][value="manual"]',form),radioPay=$('input[name="method"][value="paystack"]',form);
 radioManual.disabled=!config.paymentMethods.manual&&!config.testMode;
 radioPay.disabled=!config.paymentMethods.paystack;
 if(!radioManual.disabled)radioManual.checked=true;else if(!radioPay.disabled)radioPay.checked=true;else {radioManual.checked=false;radioPay.checked=false;}
 const ageSelect=$('#ageGroup',form), guardianPanel=$('#guardianFields',form);
 const guardianName=$('#guardianName',form),guardianPhone=$('#guardianPhone',form),guardianApproval=$('#guardianAcknowledged',form);
 function updateGuardianFields(){const minor=ageSelect.value==='under18';guardianPanel.hidden=!minor;guardianName.required=minor;guardianPhone.required=minor;guardianApproval.required=minor;if(!minor){guardianName.value='';guardianPhone.value='';guardianApproval.checked=false;}}
 ageSelect.addEventListener('change',updateGuardianFields);updateGuardianFields();
 if(!config.registrationEnabled){button.disabled=true;showMessage(msg,'Online registration and payment are not yet open. No MoMo number has been published.', '#596a56');}
 form.addEventListener('submit',async ev=>{
  ev.preventDefault();if(!config.registrationEnabled){showMessage(msg,'Payment setup is pending. Registration is not yet open.');return;}
  if(!form.reportValidity())return;showMessage(msg,'');button.disabled=true;button.textContent='Creating your registration…';
  const data={ticket:'general',distance:form.elements.namedItem('distance').value,fullName:form.elements.namedItem('fullName').value,email:form.elements.namedItem('email').value,phone:form.elements.namedItem('phone').value,ageGroup:form.elements.namedItem('ageGroup').value,emergencyName:form.elements.namedItem('emergencyName').value,emergencyPhone:form.elements.namedItem('emergencyPhone').value,guardianName:form.elements.namedItem('guardianName').value,guardianPhone:form.elements.namedItem('guardianPhone').value,method:$('input[name="method"]:checked',form)?.value,agree:form.elements.namedItem('agree').checked,guardianAcknowledged:form.elements.namedItem('guardianAcknowledged').checked,waiverAccepted:form.elements.namedItem('waiverAccepted').checked,medicalConsent:form.elements.namedItem('medicalConsent').checked,photoConsent:form.elements.namedItem('photoConsent').checked,marketing:form.elements.namedItem('marketing').checked};
  try{const result=await api('/api/register',data);if(result.redirect)location.assign(result.redirect);else throw Error('No payment step was returned');}catch(err){showMessage(msg,err.message);button.disabled=false;button.innerHTML='Continue to payment <span aria-hidden="true">↗</span>';}
 });
}
function initPayment(){const reference=$('#referenceForm');if(reference){reference.addEventListener('submit',async event=>{event.preventDefault();const token=location.pathname.split('/').pop();const submit=$('button',reference);submit.disabled=true;try{await api('/api/transfer-reference',{token,transactionRef:$('#transactionRef').value});location.reload();}catch(e){showMessage($('#refMessage'),e.message);submit.disabled=false;}});}
$$('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied ✓';}catch{b.textContent='Select number to copy';}}));
const pay=$('[data-paystack-retry]');if(pay)pay.addEventListener('click',async()=>{pay.disabled=true;pay.textContent='Opening secure payment…';try{const result=await api('/api/paystack/retry',{token:pay.dataset.paystackRetry});location.assign(result.redirect);}catch(e){pay.disabled=false;pay.textContent=e.message;}});
}
function initAdminLogin(){const form=$('#adminLogin');if(!form)return;form.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/admin/login',{password:$('#adminPassword').value});location.assign('/admin');}catch(err){showMessage($('#loginMsg'),err.message);}});}
async function initAdmin(){const rowsContainer=$('#adminRows');if(!rowsContainer)return;try{const result=await api('/api/admin/list');const rows=result.rows;const paid=rows.filter(x=>x.status==='paid');const awaiting=rows.filter(x=>x.status==='pending_verification');const total=paid.reduce((s,r)=>s+r.amount,0)/100;
const stats=[['Registrations',rows.length],['Confirmed participants',paid.reduce((s,r)=>s+r.participants,0)],['Needs manual checking',awaiting.length],['Confirmed collections',formatGhs(total)]];
$('#stats').innerHTML=stats.map(([k,v])=>`<div class="stat-item"><small>${escapeHtml(k)}</small><strong>${escapeHtml(v)}</strong></div>`).join('');
rowsContainer.innerHTML=rows.map(r=>`<tr><td><strong>${escapeHtml(r.code)}</strong><small>${escapeHtml(r.created.slice(0,10))}</small></td><td><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.phone)} · ${escapeHtml(r.email)}</small></td><td>${escapeHtml(r.ticket)}<small>${escapeHtml(r.shirtSize||r.distance)} · ${r.participants} person${r.participants>1?'s':''}</small><small>${r.waiverAccepted?'Waiver: '+escapeHtml(r.waiverVersion):'Waiver not recorded'} · ${escapeHtml(r.ageGroup||'not specified')}</small></td><td>${formatGhs(r.amount/100)}</td><td><span class="status-chip ${escapeHtml(r.status)}">${escapeHtml(r.status.replaceAll('_',' '))}</span><small>${escapeHtml(r.method)}</small></td><td>${escapeHtml(r.transactionRef||'—')}</td><td>${r.method==='manual'?`<select class="admin-control" data-id="${r.id}" aria-label="Update payment status"><option value="" selected>Change status…</option><option value="paid">Confirm paid</option><option value="pending_verification">Needs review</option><option value="rejected">Reject</option></select>`:'Automatic payment'}</td></tr>`).join('')||'<tr><td colspan="7">No registrations found.</td></tr>';
$$('.admin-control').forEach(select=>select.addEventListener('change',async()=>{if(!select.value)return;let action=select.value;if(action==='paid'&&!window.confirm('Have you checked this payment in the official MoMo transaction history? This will confirm this registration.')){select.value='';return;}select.disabled=true;try{await api('/api/admin/status',{id:Number(select.dataset.id),status:action});location.reload();}catch(err){alert(err.message);select.disabled=false;select.value='';}}));
}catch(e){rowsContainer.innerHTML=`<tr><td colspan="7">${escapeHtml(e.message)}</td></tr>`;}
 const logout=$('#logout');if(logout)logout.addEventListener('click',async()=>{try{await api('/api/admin/logout',{});}finally{location.assign('/admin');}});
}
document.addEventListener('DOMContentLoaded',()=>{initRegistration();initPayment();initAdminLogin();initAdmin();});
