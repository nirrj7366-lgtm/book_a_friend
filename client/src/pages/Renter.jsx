import { useEffect, useState } from 'react';
import { api } from '../api';
import { SERVICES, STATES, AGES, STLBL, pillFor, svc, rs, fmtWhen } from '../util';
import { Avatar, Thumb, Chips, Sheet, openLightbox, toast, useAct } from '../ui';
import { ChatSheet, SosSheet, ReportSheet, RateSheet, ExtendSheet, openCheckout } from '../Sheets';
import { useSafety } from '../hooks';
import Account from './Account';

const stars = (p) => (p.ratingCount > 0 ? `★ ${Number(p.ratingAvg).toFixed(1)} (${p.ratingCount})` : 'New');
const where = (p) => [p.city, p.state].filter(Boolean).join(', ');
const NavTabs = ({ tab, setTab, items }) => (
  <nav className="tabs" aria-label="Main">{items.map((t) => <button key={t[0]} aria-current={tab === t[0] ? 'true' : undefined} onClick={() => setTab(t[0])}>{t[1]}</button>)}</nav>
);

/* ---------- profile sheet ---------- */
function ProfileSheet({ id, onClose, onBook, onReport, onBlocked }) {
  const [d, setD] = useState(null);
  const [busy, run] = useAct();
  useEffect(() => { setD(null); if (id) api('/companions/' + id).then(setD).catch((e) => { toast(e.message); onClose(); }); }, [id]);
  const p = d && d.companion;
  const all = p ? [p.avatar, ...(p.gallery || [])].filter(Boolean) : [];
  return (
    <Sheet open={!!id} title={p ? `${p.firstName}, ${p.age}` : 'Loading…'} onClose={onClose}
      footer={p ? <button className="btn full" onClick={() => onBook(p)}>Book from {rs(p.rate)} per hour</button> : null}>
      {p ? (
        <>
          <div className="row" style={{ margin: '4px 0 8px' }}>
            <Avatar id={p.avatar} name={p.firstName} uid={p.id} size={84} onClick={() => openLightbox(all, 0)} />
            <div><div className="meta">{stars(p)}</div><div className="meta">{where(p)}{p.gender ? ' · ' + p.gender : ''}</div>
              <span className={'badge' + (p.caretakerVerified ? ' eh' : '')} style={{ margin: '4px 0 0' }}>{p.caretakerVerified ? 'Enhanced' : 'Verified'} ✓</span></div>
          </div>
          {(p.gallery || []).length ? <div className="gal">{p.gallery.map((g, i) => <Thumb key={g} id={g} size={88} onClick={() => openLightbox(all, i + 1)} />)}</div> : null}
          <p>{p.bio}</p>
          {p.services.map((x) => <span key={x} className="tag">{x}</span>)}
          {p.days && p.days.length ? <p className="meta" style={{ margin: '8px 0 0' }}>Available: {p.days.join(', ')}</p> : null}
          <div className="note">Meetings happen only at public or registered venues. Strictly platonic.</div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="link" onClick={() => onReport(p)}>Report this profile</button><span className="meta">·</span>
            <button className="link" disabled={busy} onClick={() => run(async () => { if (!window.confirm('Block this person? You will not see each other any more.')) return; await api('/safety/block', { method: 'POST', body: { userId: p.id } }); toast('Blocked.'); onBlocked(); })}>Block</button>
          </div>
          {d.reviews.length ? <><h3 style={{ margin: '14px 0 4px', fontSize: 17 }}>Recent reviews</h3>{d.reviews.map((r, i) => <div key={i} className="line" style={{ display: 'block' }}><b>{'★'.repeat(r.stars)}</b> <span className="meta">{fmtWhen(r.createdAt)}</span>{r.comment ? <div>{r.comment}</div> : null}</div>)}</> : null}
        </>
      ) : null}
    </Sheet>
  );
}

/* ---------- booking sheet ---------- */
function BookSheet({ p, feePct, me, onClose, onCreated }) {
  const [b, setB] = useState({ service: '', hours: 2, when: '', venueType: '', venue: '' });
  const [err, setErr] = useState('');
  const [busy, run] = useAct();
  useEffect(() => { if (p) { setB({ service: p.services[0], hours: 2, when: '', venueType: svc(p.services[0]).v[0], venue: '' }); setErr(''); } }, [p && p.id]);
  if (!p) return <Sheet open={false} title="Plan" onClose={onClose} />;
  const venues = svc(b.service || p.services[0]).v;
  const g = p.rate * b.hours, f = Math.round(g * feePct / 100);
  const min = new Date(Date.now() + 90 * 60000); min.setMinutes(min.getMinutes() - min.getTimezoneOffset());
  const pay = () => run(async () => {
    setErr('');
    try {
      if (!b.when) throw new Error('Choose a date and start time.');
      if (!b.venue || b.venue.trim().length < 3) throw new Error('Enter the venue name. We only allow public or registered venues.');
      const { booking } = await api('/bookings', { method: 'POST', body: { companion: p.id, service: b.service, hours: b.hours, startsAt: new Date(b.when).toISOString(), venueType: b.venueType, venueName: b.venue } });
      onClose(); onCreated(booking._id);
    } catch (e) { setErr(e.message); }
  });
  return (
    <Sheet open title={'Plan with ' + p.firstName} onClose={onClose} footer={<button className="btn full" disabled={busy} onClick={pay}>Pay and send request</button>}>
      <span className="lbl">What for?</span><Chips options={p.services} value={b.service} onPick={(v) => setB({ ...b, service: v, venueType: svc(v).v[0] })} />
      <span className="lbl">How long?</span><Chips options={[1, 2, 3, 4]} value={b.hours} onPick={(v) => setB({ ...b, hours: v })} fmt={(v) => v + ' hr'} />
      <label className="lbl">Date and start time</label><input className="in" type="datetime-local" min={min.toISOString().slice(0, 16)} value={b.when} onChange={(e) => setB({ ...b, when: e.target.value })} />
      {p.days && p.days.length ? <p className="hint">Available on: {p.days.join(', ')}</p> : null}
      <span className="lbl">Venue type <span className="meta">(public places only)</span></span><Chips options={venues} value={b.venueType} onPick={(v) => setB({ ...b, venueType: v })} />
      <label className="lbl">Venue name</label><input className="in" placeholder="e.g. South City Mall" value={b.venue} onChange={(e) => setB({ ...b, venue: e.target.value })} />
      <div className="sum">
        <div className="r"><span>{rs(p.rate)} × {b.hours} hr</span><span>{rs(g)}</span></div>
        <div className="r"><span>Safety and service fee ({feePct}%)</span><span>{rs(f)}</span></div>
        <div className="r t"><span>Total</span><span>{rs(g + f)}</span></div>
      </div>
      <p className="err">{err}</p>
    </Sheet>
  );
}

/* ---------- browse ---------- */
function Browse({ me, setTab, feePct, startPay }) {
  const [cat, setCat] = useState('All');
  const [showF, setShowF] = useState(false);
  const [F, setF] = useState({ state: '', city: '', gender: '', age: '' });
  const [applied, setApplied] = useState({ state: '', city: '', gender: '', age: '' });
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(null);
  const [book, setBook] = useState(null);
  const [rep, setRep] = useState(null);

  const load = async (p = 1) => {
    const q = new URLSearchParams({ page: String(p) });
    if (cat !== 'All') q.set('service', cat);
    Object.entries(applied).forEach(([k, v]) => { if (v) q.set(k, v); });
    try { const r = await api('/companions?' + q.toString()); setList((old) => (p === 1 ? r.list : [...old, ...r.list])); setMore(!!r.hasMore); setPage(p); } catch (e) { toast(e.message); }
  };
  useEffect(() => { load(1); }, [cat, applied]);
  const nAct = Object.values(applied).filter(Boolean).length;

  return (
    <>
      {!me.avatar ? <div className="note" style={{ margin: '0 0 12px' }}><b>Add your photo to book.</b> Companions meet you in person, so a clear photo of your face is required. <button className="link" onClick={() => setTab('account')}>Add photo</button></div> : null}
      <div className="chips" style={{ marginBottom: 12 }}>{['All', ...SERVICES.map((s) => s.k)].map((k) => <button key={k} className="chip" aria-pressed={cat === k} onClick={() => setCat(k)}>{k}</button>)}</div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn alt sm" onClick={() => setShowF(!showF)}>Filters{nAct ? ` (${nAct})` : ''}{showF ? ' ▲' : ' ▼'}</button>
        {nAct ? <button className="btn alt sm" onClick={() => { const z = { state: '', city: '', gender: '', age: '' }; setF(z); setApplied(z); setShowF(false); }}>Clear filters</button> : null}
      </div>
      {showF ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <label className="lbl" style={{ marginTop: 0 }}>State</label><select className="in" value={F.state} onChange={(e) => setF({ ...F, state: e.target.value })}><option value="">Any state</option>{STATES.map((o) => <option key={o}>{o}</option>)}</select>
          <label className="lbl">City</label><input className="in" placeholder="e.g. Kolkata" value={F.city} onChange={(e) => setF({ ...F, city: e.target.value })} />
          <span className="lbl">Gender</span><Chips options={['', 'Female', 'Male', 'Non-binary']} value={F.gender} onPick={(v) => setF({ ...F, gender: v })} fmt={(v) => v || 'Any'} />
          <label className="lbl">Age</label><select className="in" value={F.age} onChange={(e) => setF({ ...F, age: e.target.value })}>{AGES.map((a) => <option key={a[0]} value={a[0]}>{a[1]}</option>)}</select>
          <button className="btn full" style={{ marginTop: 12 }} onClick={() => { setApplied(F); setShowF(false); }}>Show results</button>
        </div>
      ) : null}
      {list.length ? list.map((p) => (
        <button key={p.id} className="pcard" onClick={() => setOpen(p.id)}>
          <Avatar id={p.avatar} name={p.firstName} uid={p.id} size={64} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>{p.firstName}, {p.age}<span className={'badge' + (p.caretakerVerified ? ' eh' : '')}>{p.caretakerVerified ? 'Enhanced' : 'Verified'} ✓</span></h3>
            <div className="meta">{stars(p)} · {where(p)}</div>
            <div style={{ marginTop: 4 }}>{p.services.map((x) => <span key={x} className="tag">{x}</span>)}</div>
          </div>
          <div className="price">{rs(p.rate)}<small>per hour</small></div>
        </button>
      )) : <div className="card meta">No companions match these filters yet. Try clearing a filter. New people are approved every day.</div>}
      {more ? <button className="btn alt full" style={{ marginBottom: 12 }} onClick={() => load(page + 1)}>Show more</button> : null}

      <ProfileSheet id={open} onClose={() => setOpen(null)} onBook={(p) => { setBook(p); setOpen(null); }} onReport={(p) => { setRep({ reportedId: p.id }); }} onBlocked={() => { setOpen(null); load(1); }} />
      <BookSheet p={book} feePct={feePct} me={me} onClose={() => setBook(null)} onCreated={(id) => { setTab('bookings'); startPay(id); }} />
      <ReportSheet rep={rep} onClose={() => setRep(null)} />
    </>
  );
}

/* ---------- bookings ---------- */
function Bookings({ me, feePct, payFor, clearPay }) {
  const [list, setList] = useState([]);
  const [chat, setChat] = useState(null);
  const [rep, setRep] = useState(null);
  const [rate, setRate] = useState(null);
  const [ext, setExt] = useState(null);
  const [busy, run] = useAct();
  const safety = useSafety();

  const load = async () => { try { setList((await api('/bookings/mine')).list); } catch (e) { toast(e.message); } };
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 30000); return () => clearInterval(t); }, []);

  const pay = (id) => run(async () => {
    toast('Starting payment…');
    const d = await api(`/bookings/${id}/pay-order`, { method: 'POST' });
    openCheckout(d, me, 'Companion booking', load);
  });
  useEffect(() => { if (payFor) { pay(payFor); clearPay(); } }, [payFor]);

  const act = (fn) => run(async () => { await fn(); await load(); });
  const share = (id) => <button className="btn alt sm" onClick={() => safety.toggleShare(id)}>{safety.watch === id ? 'Stop sharing location' : 'Share live location'}</button>;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}><h2>Your bookings</h2><button className="btn alt sm" onClick={load}>Refresh</button></div>
      {!list.length ? <div className="card meta">No bookings yet. Find someone in Browse.</div> : null}
      {list.map((b) => (
        <div key={b._id} className="card" style={{ marginBottom: 10 }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <Avatar id={b.companionAvatar} name={b.companionName} uid={b.companion} size={48} onClick={() => openLightbox([b.companionAvatar], 0)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="line" style={{ border: 0, padding: 0 }}><b>{b.service} with {b.companionName}</b><span className={pillFor(b.status)}>{STLBL[b.status]}</span></div>
              <div className="meta">{fmtWhen(b.startsAt)} · {b.hours} hr · {b.venueType} ({b.venueName})</div>
              <div className="meta">Total {rs(b.total)}</div>
              {b.disputed ? <div className="note">You reported a problem. BookAFriend support is reviewing it, and the payment will not be released automatically.</div> : null}
              {b.status === 'in_progress' && !b.disputed ? <div className="meta">If you do nothing, payment is released automatically 24 hours after the meeting ends.</div> : null}
              {b.status === 'accepted' && b.checkinCode ? <div className="note">Check-in code: <b>{b.checkinCode}</b>. Tell it to {b.companionName} only when you meet.</div> : null}
            </div>
          </div>
          <div className="row wrapx" style={{ marginTop: 10 }}>
            {b.status === 'pending_payment' ? <><button className="btn sm" disabled={busy} onClick={() => pay(b._id)}>Pay {rs(b.total)}</button><button className="btn alt sm" onClick={() => act(() => api(`/bookings/${b._id}/cancel-unpaid`, { method: 'POST' }))}>Cancel</button></> : null}
            {b.status === 'refund_pending' ? <button className="btn sm" disabled={busy} onClick={() => act(async () => { await api(`/bookings/${b._id}/refund`, { method: 'POST' }); toast('Refund retried.'); })}>Retry refund</button> : null}
            {b.status === 'paid' ? <button className="btn alt sm" onClick={() => act(async () => { if (!window.confirm('Cancel this booking and refund the payment?')) return; await api(`/bookings/${b._id}/refund`, { method: 'POST' }); toast('Refund started. It reaches your account in a few working days.'); })}>Cancel and refund</button> : null}
            {b.status === 'accepted' ? <>
              <button className="btn alt sm" onClick={() => act(async () => { if (!window.confirm('Cancel this booking and refund the payment?')) return; await api(`/bookings/${b._id}/refund`, { method: 'POST' }); toast('Refund started.'); })}>Cancel and refund</button>
              <button className="btn alt sm" onClick={() => setChat({ id: b._id, name: b.companionName })}>💬 Chat</button>{share(b._id)}
              <button className="btn alt sm" onClick={() => setRep({ problem: true, bookingId: b._id })}>Report a problem</button>
              <button className="sos" onClick={() => run(() => safety.sendSos(b._id))}>SOS</button></> : null}
            {b.status === 'in_progress' ? <>
              <button className="btn sm" onClick={() => act(async () => { if (!window.confirm('Confirm the meeting is done and release the payment?')) return; safety.stop(); await api(`/bookings/${b._id}/complete`, { method: 'POST' }); toast('Payment released. Thank you!'); })}>Meeting done: release payment</button>
              <button className="btn alt sm" onClick={() => setExt(b)}>Add more time</button>
              <button className="btn alt sm" onClick={() => setChat({ id: b._id, name: b.companionName })}>💬 Chat</button>{share(b._id)}
              <button className="btn alt sm" onClick={() => setRep({ problem: true, bookingId: b._id })}>Report a problem</button>
              <button className="sos" onClick={() => run(() => safety.sendSos(b._id))}>SOS</button></> : null}
            {b.status === 'completed' ? <>{b.reviewed ? <span className="meta">Thanks for your review ✓</span> : <button className="btn sm" onClick={() => setRate(b._id)}>Rate this meeting</button>}
              <button className="btn alt sm" onClick={() => setRep({ reportedId: b.companion, bookingId: b._id })}>Report</button></> : null}
          </div>
        </div>
      ))}
      <ChatSheet chat={chat} meId={me._id} onClose={() => setChat(null)} />
      <ReportSheet rep={rep} onClose={() => setRep(null)} onDone={load} />
      <RateSheet bookingId={rate} onClose={() => setRate(null)} onDone={load} />
      <ExtendSheet booking={ext} me={me} feePct={feePct} onClose={() => setExt(null)} onPaid={load} />
      <SosSheet sos={safety.sos} me={me} onClose={safety.closeSos} />
    </>
  );
}

const Safety = () => (
  <>
    <h2 style={{ marginBottom: 10 }}>Stay safe</h2>
    <div className="safe">{[['Before you meet', 'Read the profile and reviews. Tell a friend where you are going.'], ['At the venue', 'Meet in a public place. Keep your own transport. Never share your check-in code before you meet.'], ['Feeling uneasy?', 'You can leave at any time. Tap SOS on the booking. You can also share your live location while the page is open.'], ['Report or block', "Open any profile to report or block it. Use 'Report a problem' on a booking to pause payment release."], ['Emergency numbers', 'Police and emergency: 112. Women helpline: 1091.']]
      .map((x) => <div key={x[0]} className="card"><b>{x[0]}</b><span className="meta">{x[1]}</span></div>)}</div>
  </>
);

export default function Renter({ me, comp, settings, reloadMe }) {
  const [tab, setTab] = useState('browse');
  const [payFor, setPayFor] = useState(null);
  return (
    <>
      <div className="wrap main">
        {tab === 'browse' ? <Browse me={me} setTab={setTab} feePct={settings.feePct} startPay={setPayFor} /> : null}
        {tab === 'bookings' ? <Bookings me={me} feePct={settings.feePct} payFor={payFor} clearPay={() => setPayFor(null)} /> : null}
        {tab === 'safety' ? <Safety /> : null}
        {tab === 'account' ? <Account me={me} comp={comp} reloadMe={reloadMe} /> : null}
      </div>
      <NavTabs tab={tab} setTab={setTab} items={[['browse', 'Browse'], ['bookings', 'Bookings'], ['safety', 'Safety'], ['account', 'Account']]} />
    </>
  );
}
export { NavTabs };
