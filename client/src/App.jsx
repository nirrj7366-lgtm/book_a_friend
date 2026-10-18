import { useEffect, useState } from 'react';
import { api, hasToken, setToken, clearFileCache } from './api';
import { Toasts, Lightbox, toast } from './ui';
import { Home, Signup, Login, Forgot, ResetPassword } from './pages/Public';
import { Kyc, Wait, Blocked, Role, Setup } from './pages/Onboarding';
import Renter from './pages/Renter';
import Companion from './pages/Companion';

export default function App() {
  const [me, setMe] = useState(null);
  const [comp, setComp] = useState(null);
  const [settings, setSettings] = useState({ commissionPct: 15, feePct: 5, minWithdrawal: 500 });
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState('home');
  const [mode, setModeState] = useState(localStorage.getItem('yaari_mode') || '');
  const [editing, setEditing] = useState(false);
  const [resetToken, setResetToken] = useState('');

  const setMode = (m) => { localStorage.setItem('yaari_mode', m); setModeState(m); setEditing(false); };

  const reloadMe = async () => {
    const r = await api('/auth/me');
    setMe(r.user); setComp(r.companion || null);
    api('/settings').then(setSettings).catch(() => {});
    return r;
  };

  useEffect(() => {
    // links from emails: ?verify=... and ?reset=...
    const q = new URLSearchParams(window.location.search);
    const v = q.get('verify'), r = q.get('reset');
    if (v || r) window.history.replaceState({}, '', window.location.pathname);
    if (v) api('/auth/verify-email', { method: 'POST', body: { token: v } }).then(() => { toast('Email confirmed. Please log in.'); setView('login'); }).catch((e) => toast(e.message));
    if (r) setResetToken(r);
    if (hasToken()) reloadMe().catch(() => setToken('')).finally(() => setBooting(false));
    else { api('/settings').catch(() => {}); setBooting(false); }
  }, []);

  useEffect(() => { const f = () => { setMe(null); setComp(null); setView('login'); toast('Please log in again.'); }; window.addEventListener('yaari-auth-lost', f); return () => window.removeEventListener('yaari-auth-lost', f); }, []);

  const authed = async () => { setBooting(true); try { await reloadMe(); } finally { setBooting(false); } };
  const logout = () => { setToken(''); clearFileCache(); setMe(null); setComp(null); setView('home'); };

  let body, bar = null;
  const inApp = me && me.status === 'verified' && mode && !(mode === 'earn' && (!comp || editing));
  if (booting) body = <div className="narrow form"><p className="meta">Loading…</p></div>;
  else if (resetToken) body = <ResetPassword token={resetToken} done={() => { setResetToken(''); setView('login'); }} />;
  else if (!me) {
    body = view === 'signup' ? <Signup go={setView} onAuthed={authed} />
      : view === 'login' ? <Login go={setView} onAuthed={authed} />
      : view === 'forgot' ? <Forgot go={setView} />
      : <Home go={setView} settings={settings} />;
    bar = view === 'home' ? <><button className="btn alt sm" onClick={() => setView('login')}>Log in</button><button className="btn sm" onClick={() => setView('signup')}>Sign up</button></> : <button className="btn alt sm" onClick={() => setView('home')}>Home</button>;
  } else if (['incomplete', 'rejected'].includes(me.status)) { body = <Kyc me={me} onDone={reloadMe} />; bar = <button className="btn alt sm" onClick={logout}>Log out</button>; }
  else if (me.status === 'pending') { body = <Wait me={me} onCheck={reloadMe} />; bar = <button className="btn alt sm" onClick={logout}>Log out</button>; }
  else if (me.status === 'suspended') { body = <Blocked />; bar = <button className="btn alt sm" onClick={logout}>Log out</button>; }
  else if (!mode) { body = <Role me={me} keepPct={Math.round(100 - settings.commissionPct)} pick={setMode} />; bar = <button className="btn alt sm" onClick={logout}>Log out</button>; }
  else if (mode === 'earn' && (!comp || editing)) { body = <Setup me={me} comp={comp} commissionPct={settings.commissionPct} reloadMe={reloadMe} onDone={() => setEditing(false)} />; bar = <button className="btn alt sm" onClick={logout}>Log out</button>; }
  else {
    body = mode === 'earn'
      ? <Companion me={me} comp={comp} settings={settings} reloadMe={reloadMe} goSetup={() => setEditing(true)} />
      : <Renter me={me} comp={comp} settings={settings} reloadMe={reloadMe} />;
    bar = <div className="row"><button className="btn alt sm" onClick={() => setMode(mode === 'earn' ? 'rent' : 'earn')}>{mode === 'earn' ? 'Switch to renting' : 'Switch to earning'}</button><button className="btn alt sm" onClick={logout}>Log out</button></div>;
  }

  return (
    <>
      <div className="top"><div className="wrap"><button className="logo" onClick={() => (!me ? setView('home') : null)} aria-label="Yaari">Yaari<span>.</span></button>{bar}</div></div>
      <div key={inApp ? 'app' : 'page'}>{body}</div>
      <Toasts /><Lightbox />
    </>
  );
}
