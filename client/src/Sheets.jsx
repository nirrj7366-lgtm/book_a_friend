import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Sheet, Chips, toast, useAct } from './ui';
import { fmtWhen, rs, REASONS } from './util';

/* ---------- Razorpay checkout ---------- */
export function openCheckout(d, me, desc, onPaid) {
  if (!window.Razorpay) throw new Error('Razorpay could not load. Check your internet or turn off the ad-blocker, then try again.');
  const rz = new window.Razorpay({
    key: d.keyId, amount: d.amount, currency: 'INR', order_id: d.orderId, name: 'BookAFriend', description: desc,
    prefill: { name: me.name, email: me.email, contact: me.mobile },
    theme: { color: '#0E1B33' },
    handler: async (resp) => {
      try { await api('/payments/verify', { method: 'POST', body: resp }); toast('Payment received.'); }
      catch { toast('Payment received. We are confirming it. Refresh in a minute.'); }
      onPaid();
    },
    modal: { ondismiss: () => toast('Payment not completed. You can try again from Bookings.') },
  });
  rz.on('payment.failed', () => toast('Payment failed. Please try again.'));
  rz.open();
}

/* ---------- chat ---------- */
export function ChatSheet({ chat, meId, onClose }) {
  const [list, setList] = useState([]);
  const [text, setText] = useState('');
  const [busy, run] = useAct();
  const box = useRef(null);
  const first = useRef(true);

  const lastAt = useRef(null);
  const load = async () => {
    if (!chat) return;
    try {
      const r = await api(`/bookings/${chat.id}/messages` + (lastAt.current ? '?after=' + encodeURIComponent(lastAt.current) : ''));
      if (!r.list.length && !first.current) return;
      const el = box.current;
      const near = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true;
      setList((old) => { const seen = new Set(old.map((m) => m._id)); return [...old, ...r.list.filter((m) => !seen.has(m._id))]; });
      if (r.list.length) lastAt.current = r.list[r.list.length - 1].createdAt;
      if (el && (near || first.current)) setTimeout(() => { el.scrollTop = el.scrollHeight; }, 0);
      first.current = false;
    } catch { /* ignore a failed refresh */ }
  };
  useEffect(() => {
    if (!chat) return undefined;
    first.current = true; lastAt.current = null; setList([]); load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [chat && chat.id]);

  const send = () => run(async () => {
    const body = text.trim(); if (!body) return;
    await api(`/bookings/${chat.id}/messages`, { method: 'POST', body: { body } });
    setText(''); await load();
  });

  return (
    <Sheet open={!!chat} title={chat ? 'Chat with ' + chat.name : ''} onClose={onClose}
      footer={<div className="row"><input className="in" style={{ margin: 0, flex: 1 }} maxLength={500} placeholder="Type a message" autoComplete="off" value={text}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} /><button className="btn" disabled={busy} onClick={send}>Send</button></div>}>
      <div className="note" style={{ marginTop: 0 }}>Keep it polite. Phone numbers, links and payment details are blocked for your safety.</div>
      <div ref={box} style={{ height: '44vh', overflowY: 'auto', padding: '4px 2px' }}>
        {list.length === 0 ? <p className="meta" style={{ textAlign: 'center' }}>No messages yet. Say hello 👋</p> : list.map((m) => {
          const me = String(m.sender) === String(meId);
          return (
            <div key={m._id} style={{ display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start', margin: '6px 0' }}>
              <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 14, background: me ? 'var(--navy)' : 'var(--chip)', color: me ? 'var(--navy-ink)' : 'inherit', wordBreak: 'break-word' }}>
                {m.body}<div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{fmtWhen(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/* ---------- SOS ---------- */
export function SosSheet({ sos, me, onClose }) {
  const loc = sos && sos.lat != null ? ` My location: https://www.google.com/maps?q=${sos.lat},${sos.lng}` : '';
  const msg = 'I pressed the SOS button on Yaari and may need help.' + loc;
  return (
    <Sheet open={!!sos} title="SOS sent" onClose={onClose}>
      <div className="note"><b>BookAFriend support has been alerted</b>{sos && sos.lat != null ? ' with your location.' : '. We could not read your location.'}</div>
      <p>Also tell <b>{(me && me.emergencyName) || 'your emergency contact'}</b> right now:</p>
      <a className="btn full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', background: 'var(--teal)', color: '#fff' }} target="_blank" rel="noopener noreferrer"
        href={`https://wa.me/91${me ? me.emergencyMobile : ''}?text=${encodeURIComponent(msg)}`}>Send WhatsApp alert</a>
      <a className="btn alt full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 10 }} href="tel:112">Call 112 (police and emergency)</a>
    </Sheet>
  );
}

/* ---------- report a person, or report a problem with a booking ---------- */
export function ReportSheet({ rep, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useAct();
  useEffect(() => { setReason(''); setDetails(''); setErr(''); }, [rep]);
  const send = () => run(async () => {
    setErr('');
    try {
      if (rep.problem) {
        if (details.trim().length < 5) throw new Error('Please describe the problem.');
        await api(`/bookings/${rep.bookingId}/problem`, { method: 'POST', body: { note: details } });
        toast('Reported. BookAFriend support will look into it. Payment will not be released automatically.');
      } else {
        if (!reason) throw new Error('Choose a reason.');
        await api('/safety/report', { method: 'POST', body: { reportedId: rep.reportedId, bookingId: rep.bookingId, reason, details } });
        toast('Thanks. Our team will review this report.');
      }
      onClose(); onDone && onDone();
    } catch (e) { setErr(e.message); }
  });
  return (
    <Sheet open={!!rep} title={rep && rep.problem ? 'Report a problem' : 'Report'} onClose={onClose} footer={<button className="btn full" disabled={busy} onClick={send}>Send report</button>}>
      {rep && rep.problem
        ? <p className="meta">Tell us what went wrong. Payment will not be released automatically while we review.</p>
        : <><span className="lbl">Reason</span><Chips options={REASONS} value={reason} onPick={setReason} /></>}
      <label className="lbl">{rep && rep.problem ? 'What happened?' : 'Details (optional)'}</label>
      <textarea className="in" rows={rep && rep.problem ? 5 : 4} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Describe it here" />
      <p className="err">{err}</p>
    </Sheet>
  );
}

/* ---------- rate a meeting ---------- */
export function RateSheet({ bookingId, onClose, onDone }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useAct();
  useEffect(() => { setStars(0); setComment(''); setErr(''); }, [bookingId]);
  const send = () => run(async () => {
    if (!stars) return setErr('Choose 1 to 5 stars.');
    try { await api(`/bookings/${bookingId}/review`, { method: 'POST', body: { stars, comment } }); toast('Thanks for your review!'); onClose(); onDone(); }
    catch (e) { setErr(e.message); }
  });
  return (
    <Sheet open={!!bookingId} title="Rate your meeting" onClose={onClose} footer={<button className="btn full" disabled={busy} onClick={send}>Submit review</button>}>
      <span className="lbl">How was it?</span>
      <Chips options={[1, 2, 3, 4, 5]} value={stars} onPick={setStars} fmt={(v) => '★'.repeat(v)} />
      <label className="lbl">Comment (optional)</label>
      <textarea className="in" rows={3} maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="A few words about your experience" />
      <p className="err">{err}</p>
    </Sheet>
  );
}

/* ---------- add more time during a meeting ---------- */
export function ExtendSheet({ booking, me, feePct, onClose, onPaid }) {
  const [x, setX] = useState(1);
  const [err, setErr] = useState('');
  const [busy, run] = useAct();
  useEffect(() => { setX(1); setErr(''); }, [booking && booking._id]);
  if (!booking) return <Sheet open={false} title="Add more time" onClose={onClose} />;
  const g = booking.rate * x, f = Math.round(g * feePct / 100);
  const pay = () => run(async () => {
    try {
      const d = await api(`/bookings/${booking._id}/extend`, { method: 'POST', body: { extraHours: x } });
      onClose(); openCheckout(d, me, 'Extra time', onPaid);
    } catch (e) { setErr(e.message); }
  });
  return (
    <Sheet open title="Add more time" onClose={onClose} footer={<button className="btn gold full" disabled={busy} onClick={pay}>Pay and add time</button>}>
      <p className="meta">You booked {booking.hours} hr with {booking.companionName}. Pay for extra time here so {booking.companionName} is paid for it too.</p>
      <span className="lbl">Extra hours</span>
      <Chips options={[1, 2, 3, 4].filter((n) => booking.hours + n <= 12)} value={x} onPick={setX} fmt={(v) => '+' + v + ' hr'} />
      <div className="sum">
        <div className="r"><span>{rs(booking.rate)} × {x} hr</span><span>{rs(g)}</span></div>
        <div className="r"><span>Safety and service fee ({feePct}%)</span><span>{rs(f)}</span></div>
        <div className="r t"><span>Total to pay</span><span>{rs(g + f)}</span></div>
      </div>
      <p className="hint">New total time: {booking.hours + x} hr.</p>
      <p className="err">{err}</p>
    </Sheet>
  );
}
