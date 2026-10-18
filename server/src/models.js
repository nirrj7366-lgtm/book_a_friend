const { Schema, model } = require('mongoose');
const ObjectId = Schema.Types.ObjectId;
const T = { timestamps: true };

/* Photos and ID documents are stored inside MongoDB (the browser shrinks photos first). */
const File = model('File', new Schema({
  owner: { type: ObjectId, ref: 'User', index: true },
  kind: { type: String, enum: ['avatar', 'gallery', 'id', 'police'], required: true },
  mime: String,
  size: Number,
  data: { type: Buffer, select: false },
}, T));

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, select: false },
  name: { type: String, required: true, trim: true },
  mobile: String,
  mobileVerified: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  dob: Date,
  gender: String,
  state: String,
  city: String,
  idType: String,
  idFile: { type: ObjectId, ref: 'File' },
  avatar: { type: ObjectId, ref: 'File' },
  gallery: [{ type: ObjectId, ref: 'File' }],
  emergencyName: String,
  emergencyMobile: String,
  rulesAcceptedAt: Date,
  status: { type: String, enum: ['incomplete', 'pending', 'verified', 'rejected', 'suspended'], default: 'incomplete' },
  rejectReason: String,
  isAdmin: { type: Boolean, default: false },
  deletionRequested: { type: Boolean, default: false },
  // Login security
  tokenVersion: { type: Number, default: 0 },          // raising it logs the user out everywhere (password change/reset, erase)
  failedLogins: { type: Number, default: 0, select: false },
  lockUntil: { type: Date, select: false },
  verifyToken: { type: String, select: false },
  resetToken: { type: String, select: false },
  resetExpires: { type: Date, select: false },
}, T);
userSchema.index({ status: 1, createdAt: -1 });
userSchema.index({ isAdmin: 1 });
const User = model('User', userSchema);

const compSchema = new Schema({
  user: { type: ObjectId, ref: 'User', required: true, unique: true },
  services: [String],
  rate: { type: Number, min: 100, max: 5000, required: true },
  bio: String,
  days: [String],
  active: { type: Boolean, default: true },
  caretakerVerified: { type: Boolean, default: false },
  policeFile: { type: ObjectId, ref: 'File' },
  lockSeq: { type: Number, default: 0 },               // touched inside the booking transaction so two bookings for one companion cannot run at the same time
  ratingSum: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
}, T);
compSchema.index({ active: 1, rate: 1 });
const Companion = model('Companion', compSchema);

const extSchema = new Schema({
  extraHours: Number, gross: Number, fee: Number, commission: Number, net: Number, total: Number,
  status: { type: String, enum: ['pending_payment', 'paid', 'cancelled', 'orphan'], default: 'pending_payment' },
  orderId: String, paymentId: String, createdAt: { type: Date, default: Date.now },
});

const bookingSchema = new Schema({
  renter: { type: ObjectId, ref: 'User', required: true },
  companion: { type: ObjectId, ref: 'User', required: true },
  renterName: String, companionName: String,
  renterAvatar: ObjectId, companionAvatar: ObjectId,
  service: String,
  hours: { type: Number, min: 1, max: 12 },
  startsAt: Date,
  venueType: String, venueName: String,
  rate: Number, gross: Number, fee: Number, commission: Number, net: Number, total: Number,
  checkinCode: { type: String, select: false },
  startAttempts: { type: Number, default: 0, select: false },
  status: { type: String, enum: ['pending_payment', 'paid', 'accepted', 'in_progress', 'completed', 'refund_pending', 'refunded', 'cancelled'], default: 'pending_payment' },
  disputed: { type: Boolean, default: false },
  disputeNote: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  completedAt: Date,
  extensions: [extSchema],
}, T);
bookingSchema.index({ companion: 1, status: 1, startsAt: 1 });
bookingSchema.index({ renter: 1, createdAt: -1 });
bookingSchema.index({ companion: 1, createdAt: -1 });
bookingSchema.index({ status: 1, startsAt: 1 });
bookingSchema.index({ status: 1, createdAt: 1 });
bookingSchema.index({ razorpayOrderId: 1 }, { sparse: true });
bookingSchema.index({ 'extensions.orderId': 1 }, { sparse: true });
const Booking = model('Booking', bookingSchema);

const paySchema = new Schema({
  booking: { type: ObjectId, ref: 'Booking', index: true },
  orderId: String,
  paymentId: { type: String, unique: true, sparse: true },
  amount: Number,
  // captured = money received, refunding = refund call in progress, refunded = money returned,
  // orphan = money received but no valid booking (needs a human if the automatic refund failed)
  status: { type: String, enum: ['captured', 'refunding', 'refunded', 'orphan'], default: 'captured' },
  note: String,
}, T);
paySchema.index({ createdAt: -1 });
const Payment = model('Payment', paySchema);

const ledgerSchema = new Schema({
  user: { type: ObjectId, ref: 'User', required: true },
  booking: { type: ObjectId, ref: 'Booking' },
  ref: { type: ObjectId },                              // booking id for earnings, withdrawal id for withdrawals
  amount: { type: Number, required: true },
  type: String,
  note: String,
}, T);
ledgerSchema.index({ user: 1, createdAt: -1 });
// The same booking can be credited only once, the same withdrawal can be debited / reversed only once.
ledgerSchema.index({ ref: 1, type: 1 }, { unique: true, partialFilterExpression: { ref: { $exists: true } } });
const Ledger = model('Ledger', ledgerSchema);

const wdSchema = new Schema({
  user: { type: ObjectId, ref: 'User', required: true },
  amount: Number,
  upi: String,
  status: { type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending' },
  note: String,
  paidAt: Date,
}, T);
// Only ONE pending withdrawal per person: this is what stops a double tap from paying out twice.
wdSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
wdSchema.index({ status: 1, createdAt: -1 });
const Withdrawal = model('Withdrawal', wdSchema);

const alertSchema = new Schema({
  user: { type: ObjectId, ref: 'User', required: true },
  booking: { type: ObjectId, ref: 'Booking' },
  type: { type: String, enum: ['SOS', 'Report'], default: 'SOS' },
  note: String,
  reported: { type: ObjectId, ref: 'User' },
  lat: Number, lng: Number,
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  notified: { type: Boolean, default: false },          // did at least one admin notification (email/webhook) go out?
  notifyTries: { type: Number, default: 0 },
}, T);
alertSchema.index({ status: 1, createdAt: -1 });
alertSchema.index({ notified: 1, createdAt: -1 });
alertSchema.index({ user: 1, createdAt: -1 });
const Alert = model('Alert', alertSchema);

const blockSchema = new Schema({ blocker: { type: ObjectId, required: true }, blocked: { type: ObjectId, required: true } }, T);
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
blockSchema.index({ blocked: 1 });
const Block = model('Block', blockSchema);

const reviewSchema = new Schema({
  booking: { type: ObjectId, ref: 'Booking', required: true, unique: true },
  reviewer: { type: ObjectId, ref: 'User', required: true },
  reviewee: { type: ObjectId, ref: 'User', required: true },
  stars: { type: Number, min: 1, max: 5, required: true },
  comment: String,
}, T);
reviewSchema.index({ reviewee: 1, createdAt: -1 });
const Review = model('Review', reviewSchema);

const msgSchema = new Schema({
  booking: { type: ObjectId, ref: 'Booking', required: true },
  sender: { type: ObjectId, ref: 'User', required: true },
  body: { type: String, required: true },
}, T);
msgSchema.index({ booking: 1, createdAt: 1 });
const Message = model('Message', msgSchema);

const pingSchema = new Schema({
  booking: { type: ObjectId, ref: 'Booking' },
  user: { type: ObjectId, ref: 'User' },
  lat: Number, lng: Number,
}, T);
pingSchema.index({ user: 1, booking: 1, createdAt: -1 });
pingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600 }); // location history is deleted after 60 days
const Ping = model('Ping', pingSchema);

const auditSchema = new Schema({ admin: { type: ObjectId, ref: 'User' }, action: String, target: String }, T);
auditSchema.index({ createdAt: -1 });
const Audit = model('Audit', auditSchema);

const Settings = model('Settings', new Schema({
  key: { type: String, default: 'main', unique: true },
  commissionPct: { type: Number, default: 15, min: 0, max: 60 },
  feePct: { type: Number, default: 5, min: 0, max: 30 },
  minWithdrawal: { type: Number, default: 500, min: 100 },
}, T));

module.exports = { File, User, Companion, Booking, Payment, Ledger, Withdrawal, Alert, Block, Review, Message, Ping, Audit, Settings };
