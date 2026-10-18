require('dotenv').config();
const env = (k, d = '') => (process.env[k] !== undefined ? process.env[k] : d);

const cfg = {
  isProd: env('NODE_ENV') === 'production',
  port: Number(env('PORT', '4000')),
  mongo: env('MONGODB_URI', 'mongodb://127.0.0.1:27017/yaari'),
  jwtSecret: env('JWT_SECRET'),
  appUrl: env('APP_URL', 'http://localhost:4000').replace(/\/$/, ''),
  rz: {
    keyId: env('RAZORPAY_KEY_ID'),
    keySecret: env('RAZORPAY_KEY_SECRET'),
    webhookSecret: env('RAZORPAY_WEBHOOK_SECRET'),
    // Only change this in automated tests (a fake Razorpay server). Normally leave it alone.
    base: env('RAZORPAY_BASE_URL', 'https://api.razorpay.com/v1').replace(/\/$/, ''),
  },
  requireEmailVerify: env('REQUIRE_EMAIL_VERIFY', 'false') === 'true',
  requireIdUpload: env('REQUIRE_ID_UPLOAD', 'true') === 'true',
  smtp: { host: env('SMTP_HOST'), port: Number(env('SMTP_PORT', '587')), user: env('SMTP_USER'), pass: env('SMTP_PASS'), from: env('SMTP_FROM', 'Yaari <no-reply@localhost>') },
  // Real alerts to YOU when someone presses SOS, reports a user, or a payout/refund needs attention
  alert: { email: env('ALERT_EMAIL'), webhook: env('ALERT_WEBHOOK_URL') },
  // Optional SMS to the emergency contact (your own SMS gateway, see README)
  sms: { webhook: env('SMS_WEBHOOK_URL'), token: env('SMS_WEBHOOK_TOKEN') },
  // off | report (log violations only, safe default) | enforce
  cspMode: env('CSP_MODE', 'report'),
};

module.exports = cfg;
