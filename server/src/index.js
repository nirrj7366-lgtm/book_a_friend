const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cfg = require('./config');
require('./preflight').run();                       // stops with a clear message if JWT_SECRET / MONGODB_URI are not set properly
const { connect } = require('./db');
const { errorHandler, ah, sanitize } = require('./middleware');
const { getSettings } = require('./util');
const cron = require('./cron');
const payments = require('./routes/payments');

const app = express();
app.set('trust proxy', 1);

// Browser security policy. Default "report" only logs problems in the browser console, so Razorpay checkout cannot break.
// After you have tested a payment, set CSP_MODE=enforce.
const rz = ['https://*.razorpay.com'];
const csp = cfg.cspMode === 'off' ? false : {
  useDefaults: false, reportOnly: cfg.cspMode !== 'enforce',
  directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", ...rz], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:', 'blob:', ...rz], connectSrc: ["'self'", ...rz],
    frameSrc: rz, objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'", ...rz], frameAncestors: ["'self'"],
  },
};
app.use(helmet({
  contentSecurityPolicy: csp,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// Webhook needs the raw body (for the signature), so it is mounted before the JSON parser.
app.post('/api/payments/webhook', payments.webhook, payments.webhookHandler);

app.use(express.json({ limit: '100kb' }));
app.use('/api', sanitize);                           // removes "$operator" keys: blocks NoSQL injection
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/me', require('./routes/me'));
app.use('/api/files', require('./routes/files'));
app.use('/api/companions', require('./routes/companions'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/payments', payments.router);
app.use('/api/safety', require('./routes/safety'));
app.use('/api/admin', require('./routes/admin'));
app.get('/api/settings', ah(async (req, res) => {
  const s = await getSettings();
  res.json({ commissionPct: s.commissionPct, feePct: s.feePct, minWithdrawal: s.minWithdrawal, minHourlyRate: s.minHourlyRate, maxHourlyRate: s.maxHourlyRate, });
}));
// Health check routes for Render and UptimeRobot
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'yaari-api',
    timestamp: new Date().toISOString(),
  });
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built React site
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(['/admin', '/admin/*'], (req, res) => res.sendFile(path.join(dist, 'admin.html')));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (req, res) => res.send('Yaari server is running. Build the client (see README) to see the website.'));
}

app.use(errorHandler);

if (require.main === module) {
  (async () => {
    await connect();
    await getSettings();
    cron.start();
    const server = app.listen(cfg.port, () => console.log(`BookAFriend running on port ${cfg.port}`));
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  })().catch((e) => { console.error('Could not start:', e.message); process.exit(1); });
}
module.exports = app; // exported so the automated tests can start it
