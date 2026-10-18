const router = require('express').Router();
const bcrypt = require('bcryptjs');
const cfg = require('../config');
const { User, File } = require('../models');
const { ah, auth, upload, checkFile, signToken, limiter, byUser } = require('../middleware');
const { bad, ageOf, isMobile, strongPw, STATES } = require('../util');
const { publicUser } = require('./auth');

router.use(auth);

const IMG = ['image/jpeg', 'image/png', 'image/webp'];
const IMG_PDF = [...IMG, 'application/pdf'];

async function saveFile(user, kind, file, allowed) {
  const mime = checkFile(file, allowed, kind === 'id' ? 'ID document' : kind === 'police' ? 'certificate' : 'photo'); // real type from the file bytes
  const doc = await File.create({ owner: user._id, kind, mime, size: file.size, data: file.buffer });
  return doc._id;
}

/* KYC: personal details + ID photo, then it waits for admin review */
router.put('/kyc', limiter(60 * 60 * 1000, 20, 'Too many submissions. Try again later.', byUser), upload.single('idFile'), ah(async (req, res) => {
  const u = req.user;
  if (!['incomplete', 'rejected'].includes(u.status)) bad('Your details are already submitted.');
  const b = req.body || {};
  if (!b.dob || isNaN(new Date(b.dob))) bad('Enter your date of birth.');
  const age = ageOf(b.dob); if (age < 18) bad('You must be 18 or older to use Yaari.'); if (age > 90) bad('Please check your date of birth.');
  if (!['Female', 'Male', 'Non-binary', 'Prefer not to say'].includes(b.gender)) bad('Select a gender option.');
  if (!STATES.includes(b.state)) bad('Select your state.');
  if (typeof b.city !== 'string' || b.city.trim().length < 2 || b.city.length > 60) bad('Enter your city.');
  if (!['Aadhaar (masked)', 'PAN card', 'Driving licence', 'Passport', 'Voter ID'].includes(b.idType)) bad('Select your ID type.');
  if (!isMobile(b.ecPhone) || typeof b.ecName !== 'string' || b.ecName.trim().length < 2 || b.ecName.length > 60) bad("Add your emergency contact's name and 10-digit mobile.");
  if (b.ecPhone === u.mobile) bad('Emergency contact must be someone else.');
  if (String(b.rulesAccepted) !== 'true') bad('Please accept all the safety rules.');
  if (cfg.requireIdUpload && !req.file && !u.idFile) bad('Upload a photo of your ID.');

  let newId = null;
  if (req.file) {
    if (req.file.size > 5 * 1024 * 1024) bad('ID file must be under 5 MB.');
    newId = await saveFile(u, 'id', req.file, IMG_PDF);
  }
  const old = u.idFile;
  Object.assign(u, { dob: b.dob, gender: b.gender, state: b.state, city: b.city.trim(), idType: b.idType, emergencyName: b.ecName.trim(), emergencyMobile: b.ecPhone, rulesAcceptedAt: new Date(), status: 'pending', rejectReason: undefined });
  if (newId) u.idFile = newId;
  await u.save();
  if (newId && old) await File.deleteOne({ _id: old });
  res.json({ user: publicUser(u) });
}));

router.put('/emergency', ah(async (req, res) => {
  const { name, mobile } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 60) bad("Enter your emergency contact's name.");
  if (!isMobile(mobile)) bad('Enter a valid 10-digit mobile number.');
  if (mobile === req.user.mobile) bad('Emergency contact must be someone else.');
  req.user.emergencyName = name.trim(); req.user.emergencyMobile = mobile; await req.user.save();
  res.json({ user: publicUser(req.user) });
}));

/* Changing the password logs out every other device (tokenVersion) and returns a fresh token for this one. */
router.put('/password', limiter(15 * 60 * 1000, 10, 'Too many attempts. Try again later.', byUser), ah(async (req, res) => {
  const { current, password } = req.body || {};
  const u = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(String(current || ''), u.passwordHash || ''))) bad('Your current password is wrong.');
  if (!strongPw(password)) bad('Password needs 8+ characters with a letter and a number.');
  u.passwordHash = await bcrypt.hash(password, 11); u.tokenVersion = (u.tokenVersion || 0) + 1; await u.save();
  res.json({ ok: true, token: signToken(u) });
}));

/* Profile photo and up to 4 extra photos (the browser shrinks them first) */
router.post('/avatar', limiter(60 * 60 * 1000, 30, 'Too many uploads. Try again later.', byUser), upload.single('photo'), ah(async (req, res) => {
  if (!req.file) bad('Please choose a photo.');
  if (req.file.size > 1024 * 1024) bad('Photo is too large.');
  const u = req.user, old = u.avatar;
  u.avatar = await saveFile(u, 'avatar', req.file, IMG); await u.save();
  if (old) await File.deleteOne({ _id: old });
  res.json({ user: publicUser(u) });
}));

router.post('/gallery', limiter(60 * 60 * 1000, 30, 'Too many uploads. Try again later.', byUser), upload.single('photo'), ah(async (req, res) => {
  if (!req.file) bad('Please choose a photo.');
  if (req.file.size > 1024 * 1024) bad('Photo is too large.');
  const id = await saveFile(req.user, 'gallery', req.file, IMG);
  // atomic: the limit of 4 holds even if two uploads arrive together
  const u = await User.findOneAndUpdate({ _id: req.user._id, $expr: { $lt: [{ $size: { $ifNull: ['$gallery', []] } }, 4] } }, { $push: { gallery: id } }, { new: true });
  if (!u) { await File.deleteOne({ _id: id }); bad('You can add up to 4 extra photos. Remove one first.'); }
  res.json({ user: publicUser(u) });
}));

router.delete('/gallery/:id', ah(async (req, res) => {
  const id = String(req.params.id);
  const u = await User.findOneAndUpdate({ _id: req.user._id, gallery: id }, { $pull: { gallery: id } }, { new: true });
  if (!u) bad('Photo not found', 404);
  await File.deleteOne({ _id: id, owner: req.user._id });
  res.json({ user: publicUser(u) });
}));

router.post('/delete-request', ah(async (req, res) => {
  req.user.deletionRequested = true; await req.user.save();
  res.json({ user: publicUser(req.user) });
}));

module.exports = router;
