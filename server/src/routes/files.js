const router = require('express').Router();
const mongoose = require('mongoose');
const { File, Audit } = require('../models');
const { ah, auth } = require('../middleware');
const { bad } = require('../util');

/** Photos can be seen by verified members. ID papers and police certificates only by the owner and admins (admin views are logged). */
router.get('/:id', auth, ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) bad('Not found', 404);
  const f = await File.findById(req.params.id).select('+data');
  if (!f) bad('Not found', 404);
  const u = req.user, owner = String(f.owner) === String(u._id);
  const open = ['avatar', 'gallery'].includes(f.kind);
  if (!(owner || u.isAdmin || (open && u.status === 'verified'))) bad('Not found', 404); // same answer as "no such file", nothing is revealed
  if (u.isAdmin && !owner && !open) await Audit.create({ admin: u._id, action: 'view_document', target: String(f.owner) });
  res.set({
    'Content-Type': f.mime,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': open ? 'private, max-age=3600' : 'private, no-store',
  }).send(f.data);
}));

module.exports = router;
