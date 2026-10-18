
/** Checks the setup and tells you clearly what you still have to fill in. Pure function (easy to test). */
function check(c = require('./config')) {
  const errors = [], warnings = [];
  const weak = !c.jwtSecret || c.jwtSecret.length < 32 || /^(change|secret|password|test|x+|a+)/i.test(c.jwtSecret) || new Set(c.jwtSecret).size < 10;
  if (weak) errors.push('JWT_SECRET is missing, short (<32) or too simple. Use a random text of 40+ different characters.');
  if (!c.mongo || /USER:PASSWORD|<password>/i.test(c.mongo)) errors.push('MONGODB_URI still has the placeholder USER:PASSWORD. Put your real MongoDB Atlas connection string.');
  if (!c.rz.keyId || !c.rz.keySecret) warnings.push('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are empty: payments will not work.');
  if (c.rz.keyId && /^rzp_live_/.test(c.rz.keyId) && !c.isProd) warnings.push('You are using LIVE Razorpay keys outside production. Use test keys (rzp_test_...) while testing.');
  if (!c.rz.webhookSecret) warnings.push('RAZORPAY_WEBHOOK_SECRET is empty: the webhook (payment backup) is disabled and will reject calls.');
  if (c.isProd && /localhost|127\.0\.0\.1/.test(c.appUrl)) warnings.push('APP_URL still points to localhost. Set it to your real site address (needed for email links).');
  if (c.isProd && !c.smtp.host) warnings.push('SMTP_HOST is empty: password-reset and verification emails are only printed in the server log, users will not receive them.');
  if (c.isProd && !c.alert.email && !c.alert.webhook) warnings.push('ALERT_EMAIL / ALERT_WEBHOOK_URL are empty: only admin accounts get SOS emails (and only if SMTP is set). Add an alert address.');
  if (c.isProd && c.cspMode === 'off') warnings.push('CSP_MODE=off: the browser security policy is disabled.');
  if (!c.requireEmailVerify) warnings.push('REQUIRE_EMAIL_VERIFY=false: anyone can register with any email address (nobody confirms ownership).');
  return { errors, warnings };
}

/** Looks for the placeholders that a human must replace (business details for the legal pages). */
function findPlaceholders(text) {
  const out = [];
  for (const key of ['name', 'address', 'email', 'phone', 'grievanceOfficer']) {
    const m = new RegExp(key + '\\s*:\\s*"([^"]*)"').exec(text);
    if (!m || /^YOUR|^\[Add/i.test(m[1])) out.push(key);
  }
  return out;
}

function run() {
  const { errors, warnings } = check();
  warnings.forEach((w) => console.warn('[setup warning]', w));
  if (errors.length) { errors.forEach((e) => console.error('[setup ERROR]', e)); process.exit(1); }
  try {
    const fs = require('fs'), path = require('path');
    const f = path.join(__dirname, '..', '..', 'client', 'public', 'config.js');
    if (fs.existsSync(f)) {
      const miss = findPlaceholders(fs.readFileSync(f, 'utf8'));
      if (miss.length) console.warn('[setup warning] Business details not filled in client/public/config.js:', miss.join(', '), '(shown on Terms/Privacy/Refund/Contact pages)');
    }
  } catch { /* ignore */ }
}

module.exports = { check, findPlaceholders, run };
