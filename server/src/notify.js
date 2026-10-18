const cfg = require('./config');
const { sendMail } = require('./mailer');
const { User } = require('./models');

async function postJson(url, body, token) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } finally { clearTimeout(t); }
}

/**
 * Real notification for the admin team: e-mail to every admin account (+ ALERT_EMAIL) and an optional webhook
 * (Slack / Discord / Telegram bridge / your own SMS-WhatsApp gateway).
 * Resolves to true if at least one channel worked.
 */
async function notifyAdmins(subject, text) {
  let ok = false;
  const to = new Set();
  try { (await User.find({ isAdmin: true }).select('email').lean()).forEach((u) => u.email && to.add(u.email)); } catch (e) { console.error('notify: cannot read admins', e.message); }
  if (cfg.alert.email) cfg.alert.email.split(',').map((s) => s.trim()).filter(Boolean).forEach((e) => to.add(e));
  for (const addr of to) {
    try { await sendMail(addr, subject, text); ok = true; } catch (e) { console.error('notify mail failed', addr, e.message); }
  }
  if (cfg.alert.webhook) {
    try { await postJson(cfg.alert.webhook, { text: `${subject}\n${text}`, subject, body: text }); ok = true; } catch (e) { console.error('notify webhook failed', e.message); }
  }
  if (!to.size && !cfg.alert.webhook) console.warn('notify: no admin email or webhook configured, alert was only saved in the database:', subject);
  return ok;
}

/** SMS to a person (for example the emergency contact). Needs SMS_WEBHOOK_URL pointing to YOUR SMS gateway. */
async function sendSms(to, text) {
  if (!cfg.sms.webhook) { console.warn('sendSms: SMS_WEBHOOK_URL is not set, SMS not sent to', to); return false; }
  try { await postJson(cfg.sms.webhook, { to: '91' + to, text }, cfg.sms.token); return true; } catch (e) { console.error('sendSms failed', e.message); return false; }
}

module.exports = { notifyAdmins, sendSms };
