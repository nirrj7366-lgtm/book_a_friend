import { useState } from 'react';
import { api, setToken } from '../api';
import { SERVICES } from '../util';
import { useAct, toast } from '../ui';

const Err = ({ m }) => <p className="err">{m}</p>;

export function Home({ go, settings }) {
  const keep = Math.round(100 - settings.commissionPct);
  return (
    <>
      <div className="hero"><div className="wrap">
        <h1>Good company for every plan.</h1>
        <p>Book a verified, friendly companion for shopping, movies, parties, weddings, studying, games or caregiving. Platonic, public and safe by design.</p>
        <div className="row wrapx"><button className="btn gold" onClick={() => go('signup')}>Get started</button><button className="btn alt" onClick={() => go('login')}>I already have an account</button></div>
      </div></div>
      <div className="wrap">
        <section className="s"><h2>What can you book?</h2><p className="sub">Seven kinds of company, each with its own safety rules.</p>
          <div className="grid">{SERVICES.map((s) => <div key={s.k} className="tile" style={{ background: s.c, color: '#0E1B33' }}><div className="em">{s.e}</div><h3>{s.k}</h3><p>{s.d}</p></div>)}</div></section>
        <section className="s"><h2>Safety comes first</h2><div className="safe">
          {[['18+ only', 'Date of birth is checked at sign-up and again on our server.'], ['ID verification', 'Every member is reviewed by our team before they can book or be booked.'], ['Public venues only', 'Malls, cafes, cinemas and registered venues. Home visits only for verified caretakers.'], ['Strictly platonic', 'No sexual services or physical intimacy. Violations mean a permanent ban.'], ['SOS, report and block', 'Alert Yaari support in one tap, report anyone, or block them.'], ['Secure payments', 'Pay only through Yaari. Money is released after the meeting is complete.']]
            .map((x) => <div key={x[0]} className="card"><b>{x[0]}</b><span className="meta">{x[1]}</span></div>)}</div></section>
        <section className="s"><div className="earn"><h2>Earn on your own schedule</h2><ul><li>Set your own hourly rate.</li><li>You keep {keep}% of every booking.</li><li>Withdraw to UPI once your balance reaches ₹{settings.minWithdrawal}.</li></ul><button className="btn gold" onClick={() => go('signup')}>Become a companion</button></div></section>
        <footer>Yaari is a marketplace for platonic companionship. Members are independent and are not employees of Yaari. In an emergency call 112.<br />
          <a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · <a href="/refund.html">Refunds</a> · <a href="/contact.html">Contact</a></footer>
      </div>
    </>
  );
}

export function Signup({ go, onAuthed }) {
  const [f, setF] = useState({ name: '', email: '', mobile: '', password: '', age18: false, agreeTerms: false });
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, run] = useAct();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = () => run(async () => {
    setErr('');
    try {
      const r = await api('/auth/signup', { method: 'POST', body: f });
      if (r.needsVerify) setSent(true); else { setToken(r.token); onAuthed(); }
    } catch (e) { setErr(e.message); }
  });
  if (sent) return <div className="narrow form"><h2>Check your email</h2><p className="sub">We sent a confirmation link to <b>{f.email}</b>. Click it, then come back and log in.</p><button className="btn full" onClick={() => go('login')}>Go to log in</button></div>;
  return (
    <div className="narrow form"><h2>Create your account</h2>
      <label className="lbl">Full name (as on your ID)</label><input className="in" autoComplete="name" value={f.name} onChange={set('name')} />
      <label className="lbl">Email address</label><input className="in" type="email" autoComplete="email" value={f.email} onChange={set('email')} />
      <label className="lbl">Mobile number</label><div className="pre"><div className="code">+91</div><input className="in" type="tel" inputMode="numeric" maxLength={10} autoComplete="tel-national" value={f.mobile} onChange={set('mobile')} /></div>
      <label className="lbl">Password</label><input className="in" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /><p className="hint">At least 8 characters with a letter and a number.</p>
      <label className="chk"><input type="checkbox" checked={f.age18} onChange={set('age18')} /><span>I am 18 years old or older.</span></label>
      <label className="chk"><input type="checkbox" checked={f.agreeTerms} onChange={set('agreeTerms')} /><span>I agree to the <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>
      <div className="actions"><Err m={err} /><button className="btn full" disabled={busy} onClick={submit}>Create account</button></div>
      <p className="hint" style={{ textAlign: 'center' }}>Already a member? <button className="link" onClick={() => go('login')}>Log in</button></p>
    </div>
  );
}

export function Login({ go, onAuthed }) {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, run] = useAct();
  const submit = () => run(async () => {
    setErr('');
    try { const r = await api('/auth/login', { method: 'POST', body: f }); setToken(r.token); onAuthed(); } catch (e) { setErr(e.message); }
  });
  return (
    <div className="narrow form"><h2>Welcome back</h2>
      <label className="lbl">Email</label><input className="in" type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <label className="lbl">Password</label><input className="in" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      <div className="actions"><Err m={err} /><button className="btn full" disabled={busy} onClick={submit}>Log in</button></div>
      <p className="hint" style={{ textAlign: 'center' }}><button className="link" onClick={() => go('forgot')}>Forgot password?</button> · <button className="link" onClick={() => go('signup')}>Create an account</button></p>
    </div>
  );
}

export function Forgot({ go }) {
  const [email, setEmail] = useState('');
  const [busy, run] = useAct();
  const submit = () => run(async () => { await api('/auth/forgot', { method: 'POST', body: { email } }); toast('If that email exists, a reset link is on its way.'); go('login'); });
  return (
    <div className="narrow form"><h2>Reset password</h2>
      <label className="lbl">Your email</label><input className="in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <div className="actions"><button className="btn full" disabled={busy} onClick={submit}>Send reset link</button></div>
    </div>
  );
}

export function ResetPassword({ token, done }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, run] = useAct();
  const submit = () => run(async () => {
    setErr('');
    try { await api('/auth/reset', { method: 'POST', body: { token, password: pw } }); toast('Password updated. Please log in.'); done(); } catch (e) { setErr(e.message); }
  });
  return (
    <div className="narrow form"><h2>Choose a new password</h2>
      <label className="lbl">New password</label><input className="in" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /><p className="hint">At least 8 characters with a letter and a number.</p>
      <div className="actions"><Err m={err} /><button className="btn full" disabled={busy} onClick={submit}>Save password</button></div>
    </div>
  );
}
