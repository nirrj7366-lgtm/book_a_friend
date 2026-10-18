// Usage:  npm run make-admin -- you@example.com
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { User, Settings } = require('../src/models');

(async () => {
  const email = (process.argv[2] || '').toLowerCase();
  if (!email) { console.log('Usage: npm run make-admin -- you@example.com'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  const u = await User.findOneAndUpdate({ email }, { $set: { isAdmin: true, status: 'verified', emailVerified: true } }, { new: true });
  if (!u) { console.log('No account with that email. Sign up on the site first, then run this again.'); process.exit(1); }
  await Settings.updateOne({ key: 'main' }, { $setOnInsert: { key: 'main' } }, { upsert: true });
  console.log(`Done. ${email} is now an admin.`);
  process.exit(0);
})();
