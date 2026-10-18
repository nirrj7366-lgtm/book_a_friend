const router = require('express').Router();
const express = require('express');
const cfg = require('../config');
const { Booking } = require('../models');
const { ah, auth, limiter, byUser } = require('../middleware');
const { bad, hmacHex, safeEqual } = require('../util');
const { markPaid } = require('../services');

/* The browser calls this right after paying. The signature proves the payment is real (only Razorpay and our server know the secret). */
router.post('/verify', auth, limiter(10 * 60 * 1000, 60, 'Too many requests.', byUser), ah(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = req.body || {};
  if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof sig !== 'string') bad('Missing payment details');
  if (!cfg.rz.keySecret) bad('Payments are not set up yet.', 503);
  if (!safeEqual(hmacHex(cfg.rz.keySecret, `${orderId}|${paymentId}`), sig)) bad('Payment signature is invalid');
  const b = await Booking.findOne({ $or: [{ razorpayOrderId: orderId }, { 'extensions.orderId': orderId }] }).select('renter');
  if (!b || String(b.renter) !== String(req.user._id)) bad('Booking not found', 404);
  await markPaid(orderId, paymentId);
  res.json({ ok: true });
}));

/* Razorpay calls this by itself, even if the customer closes the browser after paying. Needs the raw body for the signature. */
const webhook = express.raw({ type: '*/*', limit: '1mb' });
const webhookHandler = ah(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!cfg.rz.webhookSecret || !safeEqual(hmacHex(cfg.rz.webhookSecret, raw), String(req.headers['x-razorpay-signature'] || ''))) return res.status(400).send('bad signature');
  let ev;
  try { ev = JSON.parse(raw); } catch { return res.status(400).send('bad body'); }
  if (ev.event === 'payment.captured' || ev.event === 'order.paid') {
    const p = ev.payload && ev.payload.payment && ev.payload.payment.entity;
    if (p && p.order_id && p.id) await markPaid(p.order_id, p.id, ev.event === 'payment.captured' ? p.amount : undefined);
  }
  res.send('ok');
});

module.exports = { router, webhook, webhookHandler };
