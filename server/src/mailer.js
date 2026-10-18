const nodemailer = require('nodemailer');
const cfg = require('./config');

let transport = null;
if (cfg.smtp.host) {
  transport = nodemailer.createTransport({
    host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.port === 465,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
  });
}

/** Sends an email. If SMTP is not set up, the message is printed in the server log (fine for testing). */
async function sendMail(to, subject, text) {
  if (!transport) { console.log(`\n--- EMAIL (not sent, SMTP not configured) ---\nTo: ${to}\n${subject}\n${text}\n---------------------------------------------\n`); return; }
  await transport.sendMail({ from: cfg.smtp.from, to, subject, text });
}
module.exports = { sendMail };
