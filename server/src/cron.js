const cron = require('node-cron');
const { Alert, User } = require('./models');
const { autoRelease, refundUnanswered, expirePending, repair } = require('./services');
const { notifyAdmins } = require('./notify');

const run = async (name, fn) => { try { const n = await fn(); if (n) console.log(`[cron] ${name}: ${n}`); } catch (e) { console.error(`[cron] ${name} failed:`, e.message); } };

/** Every minute: if an SOS/report could not be sent to the admins (email down?), try again for up to an hour. */
async function retryAlerts() {
  const list = await Alert.find({ notified: false, notifyTries: { $lt: 20 }, createdAt: { $gt: new Date(Date.now() - 3600e3) } }).limit(20);
  let n = 0;
  for (const a of list) {
    const u = await User.findById(a.user).select('name mobile emergencyName emergencyMobile').lean();
    const loc = a.lat != null ? `\nLocation: https://www.google.com/maps?q=${a.lat},${a.lng}` : '';
    const ok = await notifyAdmins(`${a.type === 'SOS' ? '🚨 Yaari SOS' : 'Yaari report'}: ${u ? u.name : ''}`, `${a.note || ''}\nMobile: ${u ? u.mobile : '-'}${loc}`);
    await Alert.updateOne({ _id: a._id }, { $set: { notified: ok }, $inc: { notifyTries: 1 } });
    if (ok) n++;
  }
  return n;
}

function start() {
  // Every instance of the server runs these; every step is safe to repeat, so running twice does no harm.
  cron.schedule('0 * * * *', async () => {
    await run('auto-release', () => autoRelease());
    await run('refund-unanswered', () => refundUnanswered());
    await run('expire-pending', () => expirePending());
    await run('repair', () => repair());
  });
  cron.schedule('* * * * *', () => run('retry-alerts', retryAlerts));
}
module.exports = { start, retryAlerts };
