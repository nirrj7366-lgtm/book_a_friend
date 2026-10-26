
const router = require('express').Router();
const mongoose = require('mongoose');
const { Companion, User, File, Block, Review } = require('../models');
const { ah, auth, verified, upload, checkFile } = require('../middleware');
const {
  bad,
  SERVICES,
  DAYS,
  STATES,
  ageOf,
  ageRange,
  firstName,
  getSettings,
} = require('../util');

router.use(auth);

/* create or edit my companion profile */
router.put('/', verified, upload.single('police'), ah(async (req, res) => {
  const b = req.body || {};
  const services = [].concat(b.services || []).filter((s) => SERVICES.includes(s));
  const days = [].concat(b.days || []).filter((d) => DAYS.includes(d));

  if (!services.length) bad('Choose at least one service.');

  // Validate the hourly rate using admin-configured settings.
  const rateInput = String(b.rate ?? '').trim();

  if (!/^\d+$/.test(rateInput)) {
    bad('Enter a valid whole-number hourly rate.');
  }

  const rate = Number(rateInput);
  const settings = await getSettings();

  const minRate = Number(settings.minHourlyRate ?? 100);
  const maxRate = Number(settings.maxHourlyRate ?? 5000);

  if (
    !Number.isSafeInteger(rate) ||
    rate < minRate ||
    rate > maxRate
  ) {
    bad(
      `Your hourly rate must be between ₹${minRate} and ₹${maxRate} per hour.`
    );
  }

  if (typeof b.bio !== 'string' || b.bio.trim().length < 30) {
    bad('Write a short bio of at least 30 characters.');
  }

  if (!days.length) bad('Choose the days you are available.');

  if (!req.user.avatar) {
    bad('Please add a clear profile photo first (Account tab).');
  }

  let comp = await Companion.findOne({ user: req.user._id });

  if (
    services.includes('Caretaker') &&
    !req.file &&
    !(comp && comp.policeFile)
  ) {
    bad('Upload your police verification certificate for caretaker services.');
  }

  let policeFile = comp && comp.policeFile;

  if (req.file) {
    if (req.file.size > 5 * 1024 * 1024) {
      bad('File must be under 5 MB.');
    }

    const mime = checkFile(
      req.file,
      ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      'certificate'
    );

    const old = policeFile;

    policeFile = (
      await File.create({
        owner: req.user._id,
        kind: 'police',
        mime,
        size: req.file.size,
        data: req.file.buffer,
      })
    )._id;

    if (old) await File.deleteOne({ _id: old });
  }

  const data = {
    services,
    rate,
    bio: b.bio.trim().slice(0, 280),
    days,
    policeFile,
  };

  // Caretaker approval is given by admin only:
  // if the person removes the service, approval is dropped.
  if (comp && !services.includes('Caretaker')) {
    comp.caretakerVerified = false;
  }

  comp = comp
    ? Object.assign(comp, data)
    : new Companion({ user: req.user._id, ...data });

  await comp.save();

  res.json({ companion: comp });
}));

router.get('/me', ah(async (req, res) => {
  res.json({
    companion: await Companion.findOne({ user: req.user._id })
      .select('-lockSeq')
      .lean(),
  });
}));

const card = (u, c) => ({
  id: u._id,
  firstName: firstName(u.name),
  age: ageOf(u.dob),
  city: u.city,
  state: u.state,
  gender: u.gender,
  services: c.caretakerVerified
    ? c.services
    : c.services.filter((s) => s !== 'Caretaker'),
  rate: c.rate,
  bio: c.bio,
  days: c.days,
  caretakerVerified: c.caretakerVerified,
  avatar: u.avatar,
  gallery: u.gallery || [],
  ratingAvg: c.ratingCount
    ? Math.round((c.ratingSum / c.ratingCount) * 10) / 10
    : 0,
  ratingCount: c.ratingCount || 0,
});

/* browse + filters. Only verified people with a photo are listed; blocked people are hidden. Paged (12 at a time). */
router.get('/', verified, ah(async (req, res) => {
  if (!req.user.avatar) {
    return res.json({ list: [], hasMore: false, needsPhoto: true });
  }

  const q = req.query;
  const me = req.user._id;

  const page = Math.min(
    500,
    Math.max(1, parseInt(q.page, 10) || 1)
  );

  const limit = Math.min(
    30,
    Math.max(1, parseInt(q.limit, 10) || 12)
  );

  const blocks = await Block.find({
    $or: [{ blocker: me }, { blocked: me }],
  }).lean();

  const hide = blocks.map((x) =>
    String(x.blocker) === String(me) ? x.blocked : x.blocker
  );

  hide.push(me);

  const cm = { active: true };

  if (typeof q.service === 'string' && SERVICES.includes(q.service)) {
    cm.services = q.service;

    if (q.service === 'Caretaker') {
      cm.caretakerVerified = true;
    }
  }

  const um = {
    'u.status': 'verified',
    'u.avatar': { $ne: null },
    'u._id': { $nin: hide },
  };

  if (typeof q.state === 'string' && STATES.includes(q.state)) {
    um['u.state'] = q.state;
  }

  if (typeof q.city === 'string' && q.city.trim()) {
    um['u.city'] = new RegExp(
      q.city.trim().slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i'
    );
  }

  if (['Female', 'Male', 'Non-binary'].includes(q.gender)) {
    um['u.gender'] = q.gender;
  }

  const ar = ageRange(q.age);

  if (ar) {
    um['u.dob'] = ar;
  }

  const rows = await Companion.aggregate([
    { $match: cm },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'u',
      },
    },
    { $unwind: '$u' },
    { $match: um },
    {
      $project: {
        user: 1,
        services: 1,
        rate: 1,
        bio: 1,
        days: 1,
        caretakerVerified: 1,
        ratingSum: 1,
        ratingCount: 1,
        'u._id': 1,
        'u.name': 1,
        'u.dob': 1,
        'u.city': 1,
        'u.state': 1,
        'u.gender': 1,
        'u.avatar': 1,
        'u.gallery': 1,
      },
    }, // Never pass hashes or private fields along.
    {
      $addFields: {
        avg: {
          $cond: [
            { $gt: ['$ratingCount', 0] },
            { $divide: ['$ratingSum', '$ratingCount'] },
            0,
          ],
        },
      },
    },
    { $sort: { avg: -1, ratingCount: -1, rate: 1, _id: 1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit + 1 },
  ]);

  const hasMore = rows.length > limit;

  res.json({
    list: rows.slice(0, limit).map((r) => card(r.u, r)),
    hasMore,
    page,
  });
}));

router.get('/:id', verified, ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    bad('Not found', 404);
  }

  if (
    await Block.exists({
      $or: [
        { blocker: req.user._id, blocked: req.params.id },
        { blocker: req.params.id, blocked: req.user._id },
      ],
    })
  ) {
    bad('This companion is not available', 404);
  }

  const u = await User.findOne({
    _id: req.params.id,
    status: 'verified',
    avatar: { $ne: null },
  }).lean();

  const c = u && await Companion.findOne({
    user: u._id,
    active: true,
  }).lean();

  if (!u || !c) {
    bad('This companion is not available', 404);
  }

  const reviews = await Review.find({ reviewee: u._id })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('stars comment createdAt')
    .lean();

  res.json({
    companion: card(u, c),
    reviews,
  });
}));

module.exports = router;
