import { useEffect, useRef, useState } from 'react';
import { api, setToken, hasToken, fileUrl } from './api';
import { Sheet, Toasts, toast, useAct, useUrl } from './ui';

const rs = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const when = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit' }) : '-');
const pc = (s) => (['verified', 'completed', 'paid', 'resolved', 'captured'].includes(s) ? 'g' : ['pending', 'open', 'accepted', 'in_progress', 'pending_payment', 'refund_pending', 'refunding'].includes(s) ? 'o' : ['rejected', 'suspended', 'refunded', 'cancelled', 'orphan'].includes(s) ? 'r' : '');
const TABS = [['overview', 'Overview'], ['users', 'Users'], ['bookings', 'Bookings'], ['payments', 'Payments and payouts'], ['safety', 'Safety'], ['settings', 'Settings']];
const KV = ({ rows }) => rows.map((r) => <div key={r[0]} className="rowkv"><span className="meta">{r[0]}</span><span style={{ textAlign: 'right' }}>{String(r[1] == null ? '-' : r[1])}</span></div>);
const Kpi = ({ a, b, c }) => <div className="kpi"><span>{a}</span><b>{b}</b><small>{c}</small></div>;

function Photo({ id }) {
  const u = useUrl(id);
  if (!id) return <span className="meta">No profile photo</span>;
  return u ? <img alt="Profile" src={u} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover' }} /> : <span className="meta">Loading photo…</span>;
}

/* opens an ID document (only admins are allowed by the server; every view is logged) */
function DocLink({ id, label }) {
  const [doc, setDoc] = useState(null);
  const [busy, run] = useAct();
  const open = () => run(async () => {
    const r = await fetch('/api/files/' + id, { headers: { Authorization: 'Bearer ' + localStorage.getItem('yaari_token') } });
    if (!r.ok) throw new Error('Could not open the document.');
    const b = await r.blob(); setDoc({ url: URL.createObjectURL(b), image: b.type.startsWith('image/') });
  });
  return (
    <div>
      <button className="btn alt" disabled={busy} onClick={open}>{label}</button>
      {doc ? (doc.image ? <img alt="Document" src={doc.url} style={{ width: '100%', marginTop: 8, borderRadius: 10 }} /> : <p><a href={doc.url} target="_blank" rel="noreferrer">Open document</a></p>) : null}
    </div>
  );
}

export default function Admin() {
  const [me, setMe] = useState(null);
  const [D, setD] = useState(null);
  const [tab, setTab] = useState('overview');
  const [login, setLogin] = useState({ email: '', password: '' });
  const [lerr, setLerr] = useState('');
  const [busy, run] = useAct();
  const [uf, setUf] = useState('All');
  const [q, setQ] = useState('');
  const [bf, setBf] = useState('All');
  const [sheet, setSheet] = useState(null); // {type, id}
  const [chatLog, setChatLog] = useState([]);
  const [setf, setSetf] = useState(null);
  const [stats, setStats] = useState(null);
  const lastSos = useRef(null);
  const [alertsOn, setAlertsOn] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted');

  const load = async () => { const [d, st] = await Promise.all([api('/admin/data'), api('/admin/stats')]); setD(d); setSetf(d.settings); setStats(st); lastSos.current = st.openSos; };

  // New SOS while the admin page is open: sound + browser notification + page title, checked every 20 seconds.
  useEffect(() => {
    if (!me) return undefined;
    const beep = () => { try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(); o.frequency.value = 880; o.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close(); }, 700); } catch { /* sound not allowed */ } };
    const t = setInterval(async () => {
      try {
        const st = await api('/admin/stats'); setStats(st);
        if (lastSos.current !== null && st.openSos > lastSos.current) {
          toast('🚨 New SOS alert! Open the Safety tab.'); beep(); document.title = '🚨 SOS - Yaari Admin';
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Yaari SOS', { body: 'A member pressed SOS. Open the Safety tab now.' });
          await load();
        }
        lastSos.current = st.openSos;
        if (st.openSos === 0) document.title = 'Yaari Admin';
      } catch { /* try again in 20 seconds */ }
    }, 20000);
    return () => clearInterval(t);
  }, [me]);
  const askAlerts = async () => { if (typeof Notification === 'undefined') return toast('This browser cannot show notifications.'); const r = await Notification.requestPermission(); setAlertsOn(r === 'granted'); toast(r === 'granted' ? 'Alerts are on for this browser.' : 'Alerts were not allowed.'); };
  useEffect(() => {
    if (hasToken()) api('/auth/me').then(async (r) => { if (r.user.isAdmin) { setMe(r.user); await load(); } else setToken(''); }).catch(() => setToken(''));
  }, []);

  const signIn = () => run(async () => {
    setLerr('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: login }); setToken(r.token);
      if (!r.user.isAdmin) { setToken(''); throw new Error('This account is not an admin.'); }
      setMe(r.user); await load();
    } catch (e) { setLerr(e.message); }
  });
  const after = async (msg) => { await load(); if (msg) toast(msg); };
  const post = (path, body, msg) => run(async () => { await api(path, { method: 'POST', body }); setSheet(null); await after(msg); });

  if (!me || !D) {
    return (
      <>
        <header className="bar"><div className="wrap"><b>BookAFriend Admin</b><span /></div></header>
        <div className="wrap" style={{ maxWidth: 420, paddingTop: 30 }}>
          <h2 className="t">Admin sign in</h2>
          <label className="lb">Email</label><input className="in" type="email" autoComplete="username" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} />
          <label className="lb">Password</label><input className="in" type="password" autoComplete="current-password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') signIn(); }} />
          <p className="meta" style={{ color: 'var(--warn)' }}>{lerr}</p>
          <button className="btn" style={{ width: '100%', padding: 12 }} disabled={busy} onClick={signIn}>Sign in</button>
        </div>
        <Toasts />
      </>
    );
  }

  const user = (id) => D.users.find((u) => u._id === id) || { name: 'Unknown' };
  const comp = (id) => D.companions.find((c) => c.user === id);
  const compIds = new Set(D.companions.map((c) => c.user));

  /* ---------- tabs ---------- */
  const Overview = () => {
    const st = stats || { users: {}, bookings: {} };
    const act = (st.bookings.paid || 0) + (st.bookings.accepted || 0) + (st.bookings.in_progress || 0);
    const total = Object.values(st.bookings).reduce((x, y) => x + y, 0), all = Object.values(st.users).reduce((x, y) => x + y, 0);
    return (
      <>
        <h2 className="t">Overview</h2>
        <div className="kpis">
          <Kpi a="Registered users" b={all} c={`${all - st.companions} renters · ${st.companions} companions`} />
          <Kpi a="Awaiting review" b={st.users.pending || 0} c="Open the Users tab" />
          <Kpi a="Verified" b={st.users.verified || 0} c={`${st.users.rejected || 0} rejected · ${st.users.suspended || 0} suspended`} />
          <Kpi a="Total bookings" b={total} c={`${act} active`} />
          <Kpi a="Collected" b={rs(st.collected)} c={`${rs(st.refunded)} refunded`} />
          <Kpi a="Your earnings" b={rs(st.platform)} c="from completed bookings" />
          <Kpi a="Held in escrow" b={rs(st.escrow)} c="until meetings finish" />
          <Kpi a="Payouts pending" b={rs(st.payoutsPending)} c={`${st.payoutsPendingCount} requests`} />
          <Kpi a="Owed to companions" b={rs(st.owed)} c="wallet balances" />
          <Kpi a="Open safety alerts" b={st.openAlerts} c={`${st.openSos} SOS`} />
          <Kpi a="Payments to check" b={st.orphanPayments} c="money without a valid booking" />
          <Kpi a="Refunds in progress" b={st.bookings.refund_pending || 0} c="retry from Bookings" />
        </div>
        <div className="note" style={{ marginTop: 14 }}>{alertsOn ? 'SOS alerts are ON for this browser (sound + notification while this page is open). You also get an email if ALERT_EMAIL / SMTP are set.' : <>Turn on SOS alerts for this browser. <button className="btn sm" onClick={askAlerts}>Enable alerts</button></>}</div>
      </>
    );
  };

  const Users = () => {
    const l = D.users.filter((u) => (uf === 'All' || u.status === uf) && (!q || (u.name + u.email + u.mobile + u._id).toLowerCase().includes(q.toLowerCase())));
    return (
      <>
        <h2 className="t">Users ({l.length})</h2>
        <input className="in" placeholder="Search name, email, mobile or ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">{['All', 'pending', 'verified', 'rejected', 'suspended'].map((x) => <button key={x} className="chip" aria-pressed={uf === x} onClick={() => setUf(x)}>{x}</button>)}</div>
        {l.length ? l.map((u) => (
          <button key={u._id} className="card" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => setSheet({ type: 'user', id: u._id })}>
            <div className="line"><b>{u.name}</b><span className={'pill ' + pc(u.status)}>{u.status}</span></div>
            <div className="meta">{compIds.has(u._id) ? 'Companion' : 'Member'} · {u.city || '-'} · joined {when(u.createdAt)}</div>
          </button>
        )) : <div className="card meta">No users match.</div>}
      </>
    );
  };

  const Bookings = () => {
    const l = D.bookings.filter((b) => bf === 'All' || b.status === bf);
    return (
      <>
        <h2 className="t">Bookings ({l.length})</h2>
        <div className="chips">{['All', 'pending_payment', 'paid', 'accepted', 'in_progress', 'completed', 'refunded', 'cancelled'].map((x) => <button key={x} className="chip" aria-pressed={bf === x} onClick={() => setBf(x)}>{x.replace('_', ' ')}</button>)}</div>
        {l.length ? l.map((b) => (
          <button key={b._id} className="card" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => setSheet({ type: 'booking', id: b._id })}>
            <div className="line"><b>{b.service}{b.disputed ? ' ⚠️' : ''}</b><span className={'pill ' + pc(b.status)}>{b.status.replace('_', ' ')}</span></div>
            <div className="meta">{b.renterName} booked {b.companionName} · {when(b.startsAt)}</div>
            <div className="meta">{b.hours} hr · paid {rs(b.total)} · you earn {rs(b.fee + b.commission)}</div>
          </button>
        )) : <div className="card meta">No bookings.</div>}
      </>
    );
  };

  const Payments = () => {
    const st = stats || {};
    return (
      <>
        <h2 className="t">Payments and payouts</h2>
        <div className="kpis" style={{ marginBottom: 14 }}><Kpi a="Collected" b={rs(st.collected)} /><Kpi a="Refunded" b={rs(st.refunded)} /><Kpi a="Owed to companions" b={rs(st.owed)} /><Kpi a="Your earnings" b={rs(st.platform)} /></div>
        <h3 style={{ margin: '6px 0 8px' }}>Withdrawal requests</h3>
        <div className="note">Send the money from your own UPI or bank app first, then tap <b>Mark as paid</b>. Tap Reject to return the money to the companion&apos;s wallet.</div>
        {D.withdrawals.length ? D.withdrawals.map((w) => (
          <div key={w._id} className="card">
            <div className="line"><b>{rs(w.amount)} to {user(w.user).name}</b><span className={'pill ' + pc(w.status)}>{w.status}</span></div>
            <div className="meta">UPI: <b>{w.upi}</b> · requested {when(w.createdAt)}</div>
            {w.status === 'pending' ? <div className="acts"><button className="btn good" disabled={busy} onClick={() => post(`/admin/withdrawals/${w._id}`, { status: 'paid' }, 'Marked as paid.')}>Mark as paid</button><button className="btn bad" disabled={busy} onClick={() => { const n = window.prompt('Reason (optional):', ''); if (n !== null) post(`/admin/withdrawals/${w._id}`, { status: 'rejected', note: n }, 'Rejected. Money returned to wallet.'); }}>Reject</button></div> : (w.note ? <div className="meta">Note: {w.note}</div> : null)}
          </div>
        )) : <div className="card meta">No withdrawal requests.</div>}
        <h3 style={{ margin: '16px 0 8px' }}>Recent payments</h3>
        {D.payments.slice(0, 30).map((p) => <div key={p._id} className="card"><div className="line"><b>{rs(p.amount)}</b><span className={'pill ' + pc(p.status)}>{p.status}</span></div><div className="meta">{p.paymentId} · {when(p.createdAt)}{p.note ? ' · ' + p.note : ''}</div></div>)}
      </>
    );
  };

  const Safety = () => {
    const last = (uid, bid) => D.pings.find((p) => p.user === uid && (!bid || p.booking === bid));
    const dels = D.users.filter((u) => u.deletionRequested);
    return (
      <>
        <h2 className="t">Safety alerts</h2>
        {D.alerts.length ? D.alerts.map((a) => {
          const u = user(a.user), lp = last(a.user, a.booking);
          return (
            <div key={a._id} className="card">
              <div className="line"><b>{a.type} · {u.name}</b><span className={'pill ' + pc(a.status)}>{a.status}</span></div>
              <div className="meta">{a.note} · {when(a.createdAt)}{a.type === 'SOS' ? (a.lat != null ? <> · <a href={`https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">View location</a></> : ' · no location') : null}</div>
              {a.reported ? <div className="meta">Reported person: <b>{user(a.reported).name}</b> <button className="btn alt sm" onClick={() => setSheet({ type: 'user', id: a.reported })}>Open profile</button></div> : null}
              {lp ? <div className="meta">Last shared location: <a href={`https://www.google.com/maps?q=${lp.lat},${lp.lng}`} target="_blank" rel="noreferrer">open map</a> ({when(lp.createdAt)})</div> : null}
              <div className="meta">Phone: <a href={'tel:+91' + (u.mobile || '')}>{u.mobile || '-'}</a> · Emergency contact: {u.emergencyName || '-'} <a href={'tel:+91' + (u.emergencyMobile || '')}>{u.emergencyMobile || ''}</a></div>
              {a.status === 'open' ? <div className="acts"><button className="btn good" disabled={busy} onClick={() => post(`/admin/alerts/${a._id}/resolve`, {}, 'Resolved.')}>Mark resolved</button></div> : null}
            </div>
          );
        }) : <div className="card meta">No alerts. 🎉</div>}
        <h3 style={{ margin: '18px 0 8px' }}>Account deletion requests</h3>
        {dels.length ? dels.map((u) => <div key={u._id} className="card"><div className="line"><b>{u.name}</b><span className="pill o">open</span></div><div className="acts"><button className="btn alt" onClick={() => setSheet({ type: 'user', id: u._id })}>Open profile</button></div></div>) : <div className="card meta">No requests.</div>}
      </>
    );
  };

  const SettingsTab = () => (
    <>
      <h2 className="t">Settings</h2>
      <div className="card"><b>Your business rules</b>
        {[['Platform commission on companion earnings (%)', 'commissionPct'], ['Safety and service fee added for renters (%)', 'feePct'], ['Minimum withdrawal (₹)', 'minWithdrawal']].map((r) => (
          <div key={r[1]} className="fld"><label>{r[0]}</label><input className="in" type="number" min="0" value={setf[r[1]]} onChange={(e) => setSetf({ ...setf, [r[1]]: e.target.value })} /></div>
        ))}
        <p className="meta">New values apply to <b>new</b> bookings only.</p>
        <button className="btn" disabled={busy} onClick={() => run(async () => { await api('/admin/settings', { method: 'PUT', body: setf }); await load(); toast('Saved.'); })}>Save settings</button>
      </div>
      <div className="card"><b>Recent admin activity</b>
        {D.audit.length ? D.audit.map((x) => <div key={x._id} className="rowkv"><span>{x.action} <span className="meta">{(x.target || '').slice(0, 8)}</span></span><span className="meta">{when(x.createdAt)}</span></div>) : <p className="meta">Nothing yet.</p>}
      </div>
    </>
  );

  /* ---------- sheets ---------- */
  const UserSheet = ({ id }) => {
    const u = user(id), c = comp(id), n = D.bookings.filter((b) => b.renter === id || b.companion === id).length;
    return (
      <>
        <div style={{ marginBottom: 8 }}><Photo id={u.avatar} /></div>
        <div className="line"><span className="meta">{String(u._id).slice(-8)}</span><span className={'pill ' + pc(u.status)}>{u.status}</span></div>
        <KV rows={[['Email', u.email], ['Mobile', '+91 ' + (u.mobile || '-')], ['Date of birth', u.dob ? String(u.dob).slice(0, 10) : '-'], ['Gender', u.gender], ['State', u.state], ['City', u.city], ['ID type', u.idType], ['Emergency contact', `${u.emergencyName || '-'} · ${u.emergencyMobile || ''}`], ['Rules accepted', when(u.rulesAcceptedAt)], ['Joined', when(u.createdAt)], ['Bookings', n], ...(c ? [['Services', c.services.join(', ')], ['Rate', rs(c.rate) + '/hr'], ['Caretaker approved', c.caretakerVerified ? 'Yes' : 'No']] : [])]} />
        {u.rejectReason ? <p className="meta">Reject reason: {u.rejectReason}</p> : null}
        <div className="acts" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {u.idFile ? <DocLink id={u.idFile} label="View ID" /> : <span className="meta">No ID uploaded</span>}
          {c && c.policeFile ? <DocLink id={c.policeFile} label="View police certificate" /> : null}
        </div>
        <div className="acts">
          <button className="btn good" disabled={busy} onClick={() => post(`/admin/users/${id}/status`, { status: 'verified' }, 'Account approved.')}>Approve</button>
          <button className="btn bad" disabled={busy} onClick={() => { const why = window.prompt('Reason shown to the user (for example: ID photo is blurry):', ''); if (why !== null) post(`/admin/users/${id}/status`, { status: 'rejected', reason: why }, 'Account rejected.'); }}>Reject</button>
          <button className="btn alt" disabled={busy} onClick={() => post(`/admin/users/${id}/status`, { status: 'suspended' }, 'Account suspended.')}>Suspend</button>
          {c && c.services.includes('Caretaker') ? <button className="btn alt" disabled={busy} onClick={() => post(`/admin/users/${id}/caretaker`, { approved: !c.caretakerVerified }, 'Updated.')}>{c.caretakerVerified ? 'Remove caretaker approval' : 'Approve as caretaker'}</button> : null}
        </div>
        <div className="acts"><button className="btn bad" disabled={busy} onClick={() => { if (window.confirm("Erase this user's personal data, ID and photos? Booking records stay for accounting. This cannot be undone.")) post(`/admin/users/${id}/erase`, {}, 'User data erased.'); }}>Erase this user&apos;s data</button></div>
      </>
    );
  };

  const BookingSheet = ({ id }) => {
    const b = D.bookings.find((x) => x._id === id);
    const exts = (b.extensions || []).filter((e) => e.status === 'paid');
    return (
      <>
        <KV rows={[['Status', b.status], ['Service', b.service], ['Renter', `${b.renterName} (${user(b.renter).mobile || '-'})`], ['Companion', `${b.companionName} (${user(b.companion).mobile || '-'})`], ['When', when(b.startsAt)], ['Venue', `${b.venueType}, ${b.venueName}`], ['Duration', `${b.hours} hr at ${rs(b.rate)}/hr${exts.length ? ` (includes ${exts.reduce((a, e) => a + e.extraHours, 0)} extra hr)` : ''}`], ['Booking amount', rs(b.gross)], [`Renter paid (fee ${rs(b.fee)})`, rs(b.total)], ['Companion gets', rs(b.net)], ['Your earning', rs(b.fee + b.commission)], ['Razorpay payment', b.razorpayPaymentId || '-'], ['Problem reported', b.disputed ? b.disputeNote || 'yes' : 'No']]} />
        <div className="acts"><button className="btn alt" disabled={busy} onClick={() => run(async () => { const r = await api(`/admin/bookings/${id}/messages`); setChatLog(r.list); setSheet({ type: 'chat', id }); })}>View chat</button></div>
        {['paid', 'accepted', 'in_progress', 'refund_pending'].includes(b.status) ? (
          <div className="acts"><button className="btn bad" disabled={busy} onClick={() => { if (window.confirm(b.status === 'refund_pending' ? 'Retry the refund?' : 'Refund this booking to the renter?')) post(`/admin/bookings/${id}/refund`, {}, 'Refund started.'); }}>Refund renter</button>
            {b.status === 'in_progress' ? <button className="btn good" disabled={busy} onClick={() => post(`/admin/bookings/${id}/complete`, {}, 'Completed. Companion wallet credited.')}>Mark complete and pay companion</button> : null}</div>
        ) : null}
      </>
    );
  };

  const sheetTitle = !sheet ? '' : sheet.type === 'user' ? user(sheet.id).name : sheet.type === 'booking' ? 'Booking ' + String(sheet.id).slice(-8) : 'Chat log';

  return (
    <>
      <header className="bar"><div className="wrap"><b>BookAFriend Admin</b><span>{me.email}</span></div></header>
      <nav className="tabs" aria-label="Sections"><div className="wrap">{TABS.map((t) => <button key={t[0]} className="tab" aria-current={tab === t[0] ? 'true' : undefined} onClick={() => setTab(t[0])}>{t[1]}</button>)}</div></nav>
      <main><div className="wrap">
        <div className="acts" style={{ margin: '0 0 10px' }}><button className="btn alt" onClick={() => after('Updated.')}>Refresh data</button><button className="btn alt" onClick={() => { setToken(''); window.location.reload(); }}>Sign out</button></div>
        {tab === 'overview' ? Overview() : null}{tab === 'users' ? Users() : null}{tab === 'bookings' ? Bookings() : null}
        {tab === 'payments' ? Payments() : null}{tab === 'safety' ? Safety() : null}{tab === 'settings' ? SettingsTab() : null}
      </div></main>
      <Sheet open={!!sheet} title={sheetTitle} onClose={() => setSheet(null)}>
        {sheet && sheet.type === 'user' ? UserSheet({ id: sheet.id }) : null}
        {sheet && sheet.type === 'booking' ? BookingSheet({ id: sheet.id }) : null}
        {sheet && sheet.type === 'chat' ? (chatLog.length ? chatLog.map((m) => { const b = D.bookings.find((x) => x._id === sheet.id) || {}; return <div key={m._id} className="rowkv" style={{ display: 'block' }}><b>{m.sender === b.renter ? b.renterName : b.companionName}</b> <span className="meta">{when(m.createdAt)}</span><div>{m.body}</div></div>; }) : <p className="meta">No messages in this booking.</p>) : null}
      </Sheet>
      <Toasts />
    </>
  );
}
