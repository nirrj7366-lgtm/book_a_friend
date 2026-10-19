import { useEffect, useState } from 'react';
import { api } from '../api';
import { STLBL, pillFor, rs, fmtWhen } from '../util';
import { Avatar, Sheet, openLightbox, toast, useAct } from '../ui';
import { ChatSheet, SosSheet, ReportSheet } from '../Sheets';
import { useSafety } from '../hooks';
import Account from './Account';
import { NavTabs } from './Renter';

function Requests({ me, settings, onLoaded }) {
  const [list, setList] = useState([]);
  const [codes, setCodes] = useState({});
  const [chat, setChat] = useState(null);
  const [rep, setRep] = useState(null);
  const [busy, run] = useAct();
  const safety = useSafety();

  const load = async () => { try { const r = await api('/bookings/requests'); setList(r.list); onLoaded(r.list.filter((x) => x.status === 'paid').length); } catch (e) { toast(e.message); } };
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 30000); return () => clearInterval(t); }, []);
  const act = (fn) => run(async () => { await fn(); await load(); });
  const share = (id) => <button className="btn alt sm" onClick={() => safety.toggleShare(id)}>{safety.watch === id ? 'Stop sharing location' : 'Share live location'}</button>;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}><h2>Booking requests</h2><button className="btn alt sm" onClick={load}>Refresh</button></div>
      {!list.length ? <div className="card meta">No requests yet. Make sure your profile is complete.</div> : null}
      {list.map((r) => (
        <div key={r._id} className="card" style={{ marginBottom: 10 }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <Avatar id={r.renterAvatar} name={r.renterName} uid={r.renter} size={48} onClick={() => openLightbox([r.renterAvatar], 0)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="line" style={{ border: 0, padding: 0 }}><b>{r.service} with {r.renterName}</b><span className={pillFor(r.status)}>{STLBL[r.status]}</span></div>
              <div className="meta">{fmtWhen(r.startsAt)} · {r.hours} hr · {r.venueType} ({r.venueName})</div>
              <div className="meta">You earn <b>{rs(r.net)}</b> after {settings.commissionPct}% commission</div>
              {r.disputed ? <div className="note">The renter reported a problem. BookAFriend support is reviewing it.</div> : null}
              {r.status === 'accepted' ? <div className="note">Ask {r.renterName} for their 4-digit check-in code when you meet.</div> : null}
            </div>
          </div>
          <div className="row wrapx" style={{ marginTop: 10 }}>
            {r.status === 'paid' ? <><button className="btn sm" disabled={busy} onClick={() => act(async () => { await api(`/bookings/${r._id}/accept`, { method: 'POST' }); toast('Accepted.'); })}>Accept</button>
              <button className="btn alt sm" disabled={busy} onClick={() => act(async () => { if (!window.confirm('Decline this request? The renter gets a full refund.')) return; await api(`/bookings/${r._id}/refund`, { method: 'POST' }); toast('Declined. The renter is being refunded.'); })}>Decline</button></> : null}
            {r.status === 'accepted' ? <>
              <input className="in" style={{ width: 120, margin: 0 }} inputMode="numeric" maxLength={4} placeholder="4-digit code" value={codes[r._id] || ''} onChange={(e) => setCodes({ ...codes, [r._id]: e.target.value })} />
              <button className="btn sm" disabled={busy} onClick={() => act(async () => { await api(`/bookings/${r._id}/start`, { method: 'POST', body: { code: codes[r._id] || '' } }); toast('Meeting started.'); })}>Start meeting</button>
              <button className="btn alt sm" onClick={() => setChat({ id: r._id, name: r.renterName })}>💬 Chat</button>{share(r._id)}
              <button className="sos" onClick={() => run(() => safety.sendSos(r._id))}>SOS</button></> : null}
            {r.status === 'in_progress' ? <>
              <span className="meta">Meeting in progress. You are paid when the renter confirms, or automatically 24 hours after the meeting ends. If the renter adds more time, your earnings update automatically.</span>
              <button className="btn alt sm" onClick={() => setChat({ id: r._id, name: r.renterName })}>💬 Chat</button>{share(r._id)}
              <button className="btn alt sm" onClick={() => setRep({ reportedId: r.renter, bookingId: r._id })}>Report renter</button>
              <button className="sos" onClick={() => run(() => safety.sendSos(r._id))}>SOS</button></> : null}
            {r.status === 'completed' ? <button className="btn alt sm" onClick={() => setRep({ reportedId: r.renter, bookingId: r._id })}>Report renter</button> : null}
          </div>
        </div>
      ))}
      <ChatSheet chat={chat} meId={me._id} onClose={() => setChat(null)} />
      <ReportSheet rep={rep} onClose={() => setRep(null)} />
      <SosSheet sos={safety.sos} me={me} onClose={safety.closeSos} />
    </>
  );
}

function Earnings({ settings }) {
  const [w, setW] = useState({ balance: 0, ledger: [], withdrawals: [] });
  const [sheet, setSheet] = useState(false);
  const [upi, setUpi] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useAct();
  const load = async () => { try { setW(await api('/safety/wallet')); } catch (e) { toast(e.message); } };
  useEffect(() => { load(); }, []);
  const can = w.balance >= settings.minWithdrawal;
  const go = () => run(async () => {
    setErr('');
    try { await api('/safety/withdraw', { method: 'POST', body: { upi } }); setSheet(false); toast('Withdrawal requested.'); load(); } catch (e) { setErr(e.message); }
  });
  return (
    <>
      <div className="bal"><span>Available balance</span><b>{rs(w.balance)}</b>
        <button className="btn gold" style={{ marginTop: 10 }} disabled={!can} onClick={() => setSheet(true)}>Withdraw</button>
        <div style={{ marginTop: 8, fontSize: 14, opacity: 0.9 }}>{can ? 'Ready to withdraw to your UPI.' : `Minimum withdrawal is ${rs(settings.minWithdrawal)}. You need ${rs(settings.minWithdrawal - w.balance)} more.`}</div></div>
      <h3 style={{ margin: '14px 0 4px' }}>History</h3>
      {w.ledger.length ? w.ledger.map((x) => <div key={x._id} className="line"><span>{x.note || x.type}<br /><span className="meta">{fmtWhen(x.createdAt)}</span></span><b style={{ color: x.amount < 0 ? 'var(--warn)' : 'var(--teal)' }}>{x.amount < 0 ? '−' : '+'}{rs(Math.abs(x.amount))}</b></div>) : <div className="card meta">No earnings yet.</div>}
      {w.withdrawals.length ? <><h3 style={{ margin: '16px 0 4px' }}>Withdrawals</h3>{w.withdrawals.map((x) => <div key={x._id} className="line"><span>{rs(x.amount)} to {x.upi}</span><span className={'pill ' + (x.status === 'paid' ? 'g' : x.status === 'rejected' ? 'r' : '')}>{x.status}</span></div>)}</> : null}
      <Sheet open={sheet} title="Withdraw earnings" onClose={() => setSheet(false)} footer={<button className="btn full" disabled={busy} onClick={go}>Request withdrawal</button>}>
        <div className="sum" style={{ marginTop: 4 }}><div className="r t"><span>Amount</span><span>{rs(w.balance)}</span></div></div>
        <label className="lbl">UPI ID</label><input className="in" placeholder="name@bank" autoComplete="off" value={upi} onChange={(e) => setUpi(e.target.value)} />
        <p className="hint">BookAFriend sends the money to this UPI ID after a quick check, usually within 1 to 2 working days.</p><p className="err">{err}</p>
      </Sheet>
    </>
  );
}

function Profile({ me, comp, goSetup }) {
  return (
    <>
      <h2 style={{ marginBottom: 10 }}>Your profile</h2>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <Avatar id={me.avatar} name={me.name} uid={me._id} size={72} onClick={() => openLightbox([me.avatar, ...(me.gallery || [])], 0)} />
          <div><b>{me.name}</b><div className="meta">{[me.city, me.state].filter(Boolean).join(', ')}</div><div className="meta">Change photos in the Account tab.</div></div>
        </div>
        <p>{comp.bio}</p>{comp.services.map((x) => <span key={x} className="tag">{x}</span>)}
        <div className="line" style={{ marginTop: 10 }}><span>Hourly rate</span><b>{rs(comp.rate)}</b></div>
        <div className="line"><span>Available</span><b>{comp.days.join(', ')}</b></div>
        {comp.services.includes('Caretaker') ? <div className="line"><span>Caretaker approval</span><span className={'pill ' + (comp.caretakerVerified ? 'g' : 'o')}>{comp.caretakerVerified ? 'Approved' : 'Pending'}</span></div> : null}
      </div>
      <button className="btn alt full" style={{ marginTop: 12 }} onClick={goSetup}>Edit profile</button>
    </>
  );
}

export default function Companion({ me, comp, settings, reloadMe, goSetup }) {
  const [tab, setTab] = useState('requests');
  const [newCount, setNewCount] = useState(0);
  return (
    <>
      <div className="wrap main">
        {!me.avatar ? <div className="note" style={{ margin: '0 0 12px' }}><b>Add a profile photo.</b> Without a photo you will not appear in search. <button className="link" onClick={() => setTab('account')}>Add it now</button></div> : null}
        {tab === 'requests' ? <Requests me={me} settings={settings} onLoaded={setNewCount} /> : null}
        {tab === 'earnings' ? <Earnings settings={settings} /> : null}
        {tab === 'profile' ? <Profile me={me} comp={comp} goSetup={goSetup} /> : null}
        {tab === 'account' ? <Account me={me} comp={comp} reloadMe={reloadMe} /> : null}
      </div>
      <NavTabs tab={tab} setTab={setTab} items={[['requests', newCount ? `Requests (${newCount})` : 'Requests'], ['earnings', 'Earnings'], ['profile', 'Profile'], ['account', 'Account']]} />
    </>
  );
}
