import { useState } from 'react';
import { api } from '../api';
import { SERVICES, STATES, compress, isoDate } from '../util';
import { Avatar, useAct, toast } from '../ui';

const Err = ({ m }) => <p className="err">{m}</p>;
const Chk = ({ v, on, children }) => <label className="chk"><input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} /><span>{children}</span></label>;

export function Kyc({ me, onDone }) {
  const [f, setF] = useState({
    dob: me.dob ? String(me.dob).slice(0, 10) : '', gender: me.gender || '', state: me.state || '', city: me.city || '', idType: me.idType || '',
    ecName: me.emergencyName || '', ecPhone: me.emergencyMobile || '', r2: false, r3: false, r4: false, r5: false, r6: false,
  });
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');
  const [busy, run] = useAct();
  const max = new Date(); max.setFullYear(max.getFullYear() - 18);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = () => run(async () => {
    setErr('');
    try {
      if (!(f.r2 && f.r3 && f.r4 && f.r5 && f.r6)) throw new Error('Please accept all the safety rules.');
      const fd = new FormData();
      ['dob', 'gender', 'state', 'city', 'idType', 'ecName', 'ecPhone'].forEach((k) => fd.append(k, f[k]));
      fd.append('rulesAccepted', 'true');
      if (file) {
        if (file.size > 12 * 1024 * 1024) throw new Error('ID file is too large (max 12 MB).');
        const blob = await compress(file, 1600, 0.85);
        fd.append('idFile', blob, blob.type === 'image/jpeg' ? 'id.jpg' : file.name);
      }
      await api('/me/kyc', { method: 'PUT', form: fd });
      onDone();
    } catch (e) { setErr(e.message); }
  });
  return (
    <div className="narrow form"><h2>Verify your identity</h2><p className="sub">Our team reviews every profile before it goes live. This keeps everyone safe.</p>
      {me.status === 'rejected' ? <div className="note"><b>Your last submission was not approved.</b> {me.rejectReason || 'Please check your details and upload a clear ID photo.'}</div> : null}
      <label className="lbl">Date of birth</label><input className="in" type="date" max={isoDate(max)} min="1940-01-01" value={f.dob} onChange={set('dob')} /><p className="hint">You must be 18 or older.</p>
      <label className="lbl">Gender</label><select className="in" value={f.gender} onChange={set('gender')}><option value="">Select</option>{['Female', 'Male', 'Non-binary', 'Prefer not to say'].map((o) => <option key={o}>{o}</option>)}</select>
      <label className="lbl">State</label><select className="in" value={f.state} onChange={set('state')}><option value="">Select</option>{STATES.map((o) => <option key={o}>{o}</option>)}</select>
      <label className="lbl">City</label><input className="in" value={f.city} onChange={set('city')} />
      <label className="lbl">Government ID type</label><select className="in" value={f.idType} onChange={set('idType')}><option value="">Select</option>{['Aadhaar (masked)', 'PAN card', 'Driving licence', 'Passport', 'Voter ID'].map((o) => <option key={o}>{o}</option>)}</select>
      <label className="lbl">Upload ID photo</label><input className="in" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} />
      <p className="hint">Photos are shrunk automatically. Aadhaar: please mask the first 8 digits. Only our verification team can see it.</p>
      <label className="lbl">Emergency contact name</label><input className="in" value={f.ecName} onChange={set('ecName')} />
      <label className="lbl">Emergency contact mobile</label><div className="pre"><div className="code">+91</div><input className="in" type="tel" inputMode="numeric" maxLength={10} value={f.ecPhone} onChange={set('ecPhone')} /></div>
      <div style={{ marginTop: 14 }}>
        <Chk v={f.r2} on={(v) => setF({ ...f, r2: v })}>I understand BookAFriend is <b>strictly platonic</b>. I will not offer, ask for or accept sexual services or physical intimacy.</Chk>
        <Chk v={f.r3} on={(v) => setF({ ...f, r3: v })}>I will meet only at <b>public or registered venues</b>. Home visits are only for verified caretakers.</Chk>
        <Chk v={f.r4} on={(v) => setF({ ...f, r4: v })}>I will not pressure anyone to drink alcohol or use drugs, and I will follow the law.</Chk>
        <Chk v={f.r5} on={(v) => setF({ ...f, r5: v })}>I will pay and get paid <b>only through BookAFriend</b>.</Chk>
        <Chk v={f.r6} on={(v) => setF({ ...f, r6: v })}>I agree to the Terms, the Privacy Policy and to ID and background verification.</Chk>
      </div>
      <div className="actions"><Err m={err} /><button className="btn gold full" disabled={busy} onClick={submit}>Submit for review</button></div>
    </div>
  );
}

export const Wait = ({ me, onCheck }) => {
  const [busy, run] = useAct();
  return <div className="narrow form"><h2>Under review</h2><p className="sub">Thanks, {String(me.name || '').split(' ')[0]}. Our team is checking your details. This usually takes a short while. You will be able to use BookAFriend as soon as you are approved.</p><button className="btn full" disabled={busy} onClick={() => run(async () => { await onCheck(); toast('Checked.'); })}>Check status</button></div>;
};

export const Blocked = () => <div className="narrow form"><h2>Account on hold</h2><p className="sub">Your account is currently suspended or closed. Please contact BookAFriend support.</p></div>;

export const Role = ({ me, keepPct, pick }) => (
  <div className="narrow form"><h2>Hi {String(me.name || '').split(' ')[0]}, what would you like to do?</h2><p className="sub">You can switch any time from the top bar.</p>
    <button className="role" onClick={() => pick('rent')}><div style={{ fontSize: 30 }}>🔎</div><h3>I want to rent a companion</h3><p>Browse verified people for shopping, movies, parties, weddings, study, play or care.</p></button>
    <button className="role" onClick={() => pick('earn')}><div style={{ fontSize: 30 }}>💰</div><h3>I want to rent myself out</h3><p>Set your own rate and earn. You keep {keepPct}% of every booking.</p></button>
  </div>
);

export function Setup({ me, comp, commissionPct, onDone, reloadMe }) {
  const [f, setF] = useState({ services: comp ? comp.services : [], days: comp ? comp.days : [], rate: comp ? comp.rate : '', bio: comp ? comp.bio : '', c1: !!comp });
  const [photo, setPhoto] = useState(null);
  const [police, setPolice] = useState(null);
  const [err, setErr] = useState('');
  const [busy, run] = useAct();
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const care = f.services.includes('Caretaker');
  const submit = () => run(async () => {
    setErr('');
    try {
      if (!f.services.length) throw new Error('Choose at least one service.');
      const r = parseInt(f.rate, 10);
      if (!(r >= 100 && r <= 5000)) throw new Error('Set a rate between ₹100 and ₹5,000 per hour.');
      if (!f.bio || f.bio.trim().length < 30) throw new Error('Write a short bio of at least 30 characters.');
      if (!f.days.length) throw new Error('Choose the days you are available.');
      if (!photo && !me.avatar) throw new Error('Please add a clear profile photo.');
      if (!f.c1) throw new Error('Please accept the safety rule.');
      if (photo) {
        const blob = await compress(photo, 640, 0.8), fd0 = new FormData();
        fd0.append('photo', blob, 'avatar.jpg');
        await api('/me/avatar', { method: 'POST', form: fd0 });
      }
      const fd = new FormData();
      f.services.forEach((s) => fd.append('services', s)); f.days.forEach((d) => fd.append('days', d));
      fd.append('rate', r); fd.append('bio', f.bio);
      if (police) fd.append('police', police);
      await api('/companions', { method: 'PUT', form: fd });
      await reloadMe(); toast('Profile saved.'); onDone();
    } catch (e) { setErr(e.message); }
  });
  return (
    <div className="narrow form"><h2>{comp ? 'Edit' : 'Set up'} your companion profile</h2><p className="sub">This is what renters will see.</p>
      <span className="lbl">Profile photo{me.avatar ? ' (optional to change)' : ''}</span>
      {me.avatar ? <Avatar id={me.avatar} name={me.name} uid={me._id} size={84} /> : null}
      <input className="in" type="file" accept="image/jpeg,image/png,image/webp" style={{ marginTop: 8 }} onChange={(e) => setPhoto(e.target.files[0] || null)} /><p className="hint">A clear, friendly photo of your face. Only verified members can see it.</p>
      <span className="lbl">Services you offer</span>
      <div className="chips">{SERVICES.map((s) => <button key={s.k} className="chip" aria-pressed={f.services.includes(s.k)} onClick={() => toggle('services', s.k)}>{s.e} {s.k}</button>)}</div>
      <label className="lbl">Your rate per hour (₹)</label><input className="in" type="number" min="100" max="5000" inputMode="numeric" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /><p className="hint">Between ₹100 and ₹5,000. BookAFriend keeps {commissionPct}% commission.</p>
      <label className="lbl">Short bio</label><textarea className="in" rows={4} maxLength={280} placeholder="Tell renters about yourself in a few friendly lines." value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
      <span className="lbl">Available on</span>
      <div className="chips">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <button key={d} className="chip" aria-pressed={f.days.includes(d)} onClick={() => toggle('days', d)}>{d}</button>)}</div>
      <p className="hint">Renters can only book you on these days.</p>
      {care ? <><div className="note"><b>Caretaker listings need extra checks.</b> Upload your police verification certificate. Your Caretaker service stays hidden until our team approves it.</div><label className="lbl">Police verification certificate</label><input className="in" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setPolice(e.target.files[0] || null)} /></> : null}
      <Chk v={f.c1} on={(v) => setF({ ...f, c1: v })}>I will follow BookAFriend&apos;s safety rules and meet only at allowed venues.</Chk>
      <div className="actions"><Err m={err} /><button className="btn gold full" disabled={busy} onClick={submit}>{comp ? 'Save' : 'Go live'}</button></div>
    </div>
  );
}
