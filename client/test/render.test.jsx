// Render test: draws every screen once (on the server, no browser) and checks nothing crashes and key texts appear.
// Run (needs: npm install in the client folder):   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';

// the pages use localStorage / window; give them harmless stand-ins
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, location: { pathname: '/' } };
globalThis.document = globalThis.document || { hidden: false, title: '' };

const me = { _id: 'u1', name: 'Test User', email: 't@x.com', mobile: '9876543210', status: 'verified', city: 'Kolkata', state: 'West Bengal', avatar: null, gallery: [], emergencyName: 'Mum', emergencyMobile: '9123456789' };
const comp = { services: ['Shopping', 'Study'], days: ['Mon', 'Tue'], rate: 250, bio: 'x'.repeat(40), caretakerVerified: false };
const settings = { commissionPct: 15, feePct: 5, minWithdrawal: 500 };
const noop = () => {};
const html = (el) => renderToString(el).replace(/<!-- -->/g, ''); // React puts invisible markers between text parts; remove them before matching

const { Home, Signup, Login, Forgot, ResetPassword } = await import('../src/pages/Public.jsx');
const { Kyc, Wait, Blocked, Role, Setup } = await import('../src/pages/Onboarding.jsx');
const Account = (await import('../src/pages/Account.jsx')).default;
const Renter = (await import('../src/pages/Renter.jsx')).default;
const Companion = (await import('../src/pages/Companion.jsx')).default;
const Admin = (await import('../src/Admin.jsx')).default;
const App = (await import('../src/App.jsx')).default;
const { SosSheet, ReportSheet, RateSheet, ExtendSheet, ChatSheet } = await import('../src/Sheets.jsx');
const util = await import('../src/util.js');

test('public pages draw', () => {
  assert.match(html(h(Home, { go: noop, settings })), /Good company for every plan/);
  assert.match(html(h(Home, { go: noop, settings })), /You keep 85%/);
  assert.match(html(h(Signup, { go: noop, onAuthed: noop })), /Create account/);
  assert.match(html(h(Login, { go: noop, onAuthed: noop })), /Welcome back/);
  assert.match(html(h(Forgot, { go: noop })), /Reset password/);
  assert.match(html(h(ResetPassword, { token: 't', done: noop })), /Choose a new password/);
});
test('onboarding pages draw', () => {
  assert.match(html(h(Kyc, { me: { ...me, status: 'incomplete' }, onDone: noop })), /Verify your identity/);
  assert.match(html(h(Kyc, { me: { ...me, status: 'rejected', rejectReason: 'blurry' }, onDone: noop })), /blurry/);
  assert.match(html(h(Wait, { me, onCheck: noop })), /Under review/);
  assert.match(html(h(Blocked)), /Account on hold/);
  assert.match(html(h(Role, { me, keepPct: 85, pick: noop })), /rent a companion/);
  assert.match(html(h(Setup, { me, comp: null, commissionPct: 15, reloadMe: noop, onDone: noop })), /Set up your companion profile/);
  assert.match(html(h(Setup, { me, comp, commissionPct: 15, reloadMe: noop, onDone: noop })), /Edit your companion profile/);
});
test('main screens draw', () => {
  const a = html(h(Account, { me, comp, reloadMe: noop }));
  assert.match(a, /More photos/); assert.match(a, /Emergency contact/); assert.match(a, /Change password/);
  assert.doesNotMatch(html(h(Account, { me, comp: null, reloadMe: noop })), /More photos/, 'renters have no gallery card');
  assert.match(html(h(Renter, { me, comp: null, settings, reloadMe: noop })), /Add your photo to book/);
  assert.match(html(h(Companion, { me, comp, settings, reloadMe: noop, goSetup: noop })), /Add a profile photo/);
  assert.match(html(h(Admin)), /Admin sign in/);
});
test('the whole app draws its first screen', () => assert.match(html(h(App)), /Yaari/));
test('sheets draw closed without crashing', () => {
  for (const el of [h(SosSheet, { sos: null, me, onClose: noop }), h(ReportSheet, { rep: null, onClose: noop }), h(RateSheet, { bookingId: null, onClose: noop, onDone: noop }), h(ExtendSheet, { booking: null, me, feePct: 5, onClose: noop, onPaid: noop }), h(ChatSheet, { chat: null, meId: 'u1', onClose: noop })]) html(el);
});
test('SOS sheet builds the WhatsApp link with the location', () => {
  const s = html(h(SosSheet, { sos: { lat: 22.5, lng: 88.3 }, me, onClose: noop }));
  assert.match(s, /wa\.me\/919123456789/); assert.match(s, /22\.5%2C88\.3/);
});
test('status labels exist for every booking status', () => {
  for (const st of ['pending_payment', 'paid', 'accepted', 'in_progress', 'completed', 'refund_pending', 'refunded', 'cancelled']) assert.ok(util.STLBL[st], 'no label for ' + st);
});
test('API paths used by the screens exist on the server (client/server connection check)', async () => {
  const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = ['src/pages', 'src'].flatMap((d) => fs.readdirSync(path.join(here, '..', d)).filter((f) => /\.jsx?$/.test(f)).map((f) => fs.readFileSync(path.join(here, '..', d, f), 'utf8'))).join('\n');
  const calls = [...src.matchAll(/api\(\s*[`'"]((?:\/[a-z-]+)+)/g)].map((m) => m[1]);
  const server = fs.readFileSync(path.join(here, '..', '..', 'server', 'src', 'index.js'), 'utf8');
  const mounts = [...server.matchAll(/app\.(?:use|get|post)\('(\/api\/[a-z]+)'/g)].map((m) => m[1].replace('/api', ''));
  const known = new Set(mounts);
  const missing = [...new Set(calls)].filter((c) => !known.has('/' + c.split('/')[1]));
  assert.deepEqual(missing, [], 'the client calls API areas the server does not have: ' + missing.join(', '));
});
