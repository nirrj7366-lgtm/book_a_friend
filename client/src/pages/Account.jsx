import { useState } from 'react';
import { api, setToken } from '../api';
import { compress } from '../util';
import { Avatar, Thumb, openLightbox, toast, useAct } from '../ui';

export default function Account({ me, comp, reloadMe }) {
  const [ec, setEc] = useState({ name: me.emergencyName || '', mobile: me.emergencyMobile || '' });
  const [pw, setPw] = useState({ current: '', password: '' });
  const [busy, run] = useAct();
  const gallery = me.gallery || [];

  const upload = (path, file, max, ok) => run(async () => {
    const blob = await compress(file, max, 0.8), fd = new FormData();
    fd.append('photo', blob, 'photo.jpg');
    await api(path, { method: 'POST', form: fd });
    await reloadMe(); toast(ok);
  });
  const removePhoto = (id) => run(async () => {
    if (!window.confirm('Remove this photo?')) return;
    await api('/me/gallery/' + id, { method: 'DELETE' }); await reloadMe(); toast('Photo removed.');
  });

  return (
    <>
      <h2 style={{ marginBottom: 10 }}>Account</h2>

      <div className="card" style={{ marginBottom: 12 }}><b>Profile photo</b>
        <div className="row" style={{ marginTop: 8 }}>
          <Avatar id={me.avatar} name={me.name} uid={me._id} size={84} onClick={() => openLightbox([me.avatar, ...gallery], 0)} />
          <div>
            <p className="meta" style={{ margin: '0 0 6px' }}>{me.avatar ? 'Your photo is shown to verified members.' : <b style={{ color: 'var(--warn)' }}>No photo yet. A clear photo of your face is required to book or to be listed.</b>}</p>
            <span className="btn sm filebtn">{me.avatar ? 'Change photo' : 'Upload photo'}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload photo" onChange={(e) => { if (e.target.files[0]) upload('/me/avatar', e.target.files[0], 640, 'Photo updated.'); e.target.value = ''; }} /></span>
          </div>
        </div>
      </div>

      {comp ? (
        <div className="card" style={{ marginBottom: 12 }}><b>More photos</b>
          <p className="meta" style={{ margin: '4px 0 10px' }}>Add up to 4 more clear photos. Renters can open them to see you better. {gallery.length < 2 ? <b>Profiles with 2 or more photos get more bookings.</b> : null}</p>
          <div className="row wrapx">
            {gallery.map((id, i) => (
              <Thumb key={id} id={id} size={84} onClick={() => openLightbox([me.avatar, ...gallery], 1 + i)}>
                <button className="x" style={{ position: 'absolute', top: -8, right: -8, width: 28, height: 28, fontSize: 14 }} aria-label="Remove photo" onClick={() => removePhoto(id)}>✕</button>
              </Thumb>
            ))}
          </div>
          {gallery.length < 4
            ? <span className="btn sm filebtn" style={{ marginTop: 10 }}>Add photo<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Add photo" onChange={(e) => { if (e.target.files[0]) upload('/me/gallery', e.target.files[0], 1280, 'Photo added.'); e.target.value = ''; }} /></span>
            : <p className="meta" style={{ margin: '8px 0 0' }}>You have added the maximum of 4.</p>}
        </div>
      ) : null}

      <div className="card">
        {[['Name', me.name], ['Email', me.email], ['Mobile', '+91 ' + (me.mobile || '-') + (me.mobileVerified ? ' (verified)' : '')], ['Location', [me.city, me.state].filter(Boolean).join(', ') || '-']].map((r) => <div key={r[0]} className="line"><span className="meta">{r[0]}</span><span style={{ textAlign: 'right' }}>{r[1]}</span></div>)}
        <p className="hint">To change your name, ID or date of birth, contact support. Identity details are locked for safety.</p>
      </div>

      <div className="card" style={{ marginTop: 12 }}><b>Emergency contact</b>
        <label className="lbl">Name</label><input className="in" value={ec.name} onChange={(e) => setEc({ ...ec, name: e.target.value })} />
        <label className="lbl">Mobile</label><div className="pre"><div className="code">+91</div><input className="in" type="tel" inputMode="numeric" maxLength={10} value={ec.mobile} onChange={(e) => setEc({ ...ec, mobile: e.target.value })} /></div>
        <button className="btn full" style={{ marginTop: 10 }} disabled={busy} onClick={() => run(async () => { await api('/me/emergency', { method: 'PUT', body: ec }); await reloadMe(); toast('Emergency contact saved.'); })}>Save emergency contact</button>
      </div>

      <div className="card" style={{ marginTop: 12 }}><b>Change password</b>
        <label className="lbl">Current password</label><input className="in" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <label className="lbl">New password</label><input className="in" type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /><p className="hint">At least 8 characters with a letter and a number.</p>
        <button className="btn full" style={{ marginTop: 10 }} disabled={busy} onClick={() => run(async () => { const r = await api('/me/password', { method: 'PUT', body: pw }); if (r.token) setToken(r.token); setPw({ current: '', password: '' }); toast('Password updated.'); })}>Update password</button>
      </div>

      <div className="card" style={{ marginTop: 12 }}><b>Delete my account</b>
        <p className="meta">We erase your personal data and ID. We keep basic booking records as required for accounting and safety. You must have no active bookings and no wallet balance.</p>
        {me.deletionRequested ? <p className="ok">Deletion requested. Our team will process it soon.</p>
          : <button className="btn alt full" disabled={busy} onClick={() => run(async () => { if (!window.confirm('Request deletion of your account? You must have no active bookings and no wallet balance.')) return; await api('/me/delete-request', { method: 'POST' }); await reloadMe(); toast('Deletion requested.'); })}>Request account deletion</button>}
      </div>
      <p className="hint" style={{ textAlign: 'center', marginTop: 14 }}><a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · <a href="/refund.html">Refunds</a> · <a href="/contact.html">Contact</a></p>
    </>
  );
}
