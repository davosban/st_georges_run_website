'use strict';
const tls = require('node:tls');

function sendMail({ host, port, user, pass, from, to, replyTo, subject, text, html }) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const socket = tls.connect(Number(port) || 465, host, { rejectUnauthorized: false }, () => {});
    let buffer = '';
    let step = 0;

    const timer = setTimeout(() => {
      if (!resolved) {
        socket.destroy();
        reject(new Error('SMTP connection timeout'));
      }
    }, 20000);

    socket.setEncoding('utf8');

    socket.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\r\n');
      buffer = lines.pop(); // keep last incomplete chunk

      for (const line of lines) {
        if (!line) continue;
        // Check if line indicates completion of SMTP response (code followed by space, e.g. '250 ' or '220 ')
        const match = line.match(/^(\d{3})(?:[ -])(.*)$/);
        if (!match) continue;
        const code = match[1];
        const isLastLine = line.charAt(3) === ' ';

        if (!isLastLine) continue; // Multi-line response continuation

        if (code.startsWith('4') || code.startsWith('5')) {
          socket.destroy();
          clearTimeout(timer);
          return reject(new Error(`SMTP error ${code}: ${line}`));
        }

        if (step === 0 && code === '220') {
          step = 1;
          socket.write('EHLO stgeorgesheight.com\r\n');
        } else if (step === 1 && code === '250') {
          step = 2;
          socket.write('AUTH LOGIN\r\n');
        } else if (step === 2 && code === '334') {
          step = 3;
          socket.write(Buffer.from(user).toString('base64') + '\r\n');
        } else if (step === 3 && code === '334') {
          step = 4;
          socket.write(Buffer.from(pass).toString('base64') + '\r\n');
        } else if (step === 4 && code === '235') {
          step = 5;
          socket.write(`MAIL FROM:<${user}>\r\n`);
        } else if (step === 5 && code === '250') {
          step = 6;
          socket.write(`RCPT TO:<${to}>\r\n`);
        } else if (step === 6 && code === '250') {
          step = 7;
          socket.write('DATA\r\n');
        } else if (step === 7 && code === '354') {
          step = 8;
          const boundary = '----=_Part_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
          const headers = [
            `From: ${from || user}`,
            `To: ${to}`,
            replyTo ? `Reply-To: ${replyTo}` : '',
            `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
            `Date: ${new Date().toUTCString()}`,
            `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@stgeorgesheight.com>`,
            'MIME-Version: 1.0',
            html
              ? `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}\r\n\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n\r\n--${boundary}--`
              : 'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n' + text,
            '\r\n.'
          ].filter(Boolean).join('\r\n') + '\r\n';
          socket.write(headers);
        } else if (step === 8 && code === '250') {
          step = 9;
          resolved = true;
          clearTimeout(timer);
          socket.write('QUIT\r\n');
          socket.end();
          resolve({ ok: true, message: line });
        }
      }
    });

    socket.on('error', err => {
      clearTimeout(timer);
      if (!resolved) reject(err);
    });
  });
}

module.exports = { sendMail };
