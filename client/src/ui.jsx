import { useEffect, useState } from 'react';
import { fileUrl } from './api';
import { avc } from './util';

/* ---- toast ---- */
export const toast = (m) => window.dispatchEvent(new CustomEvent('yaari-toast', { detail: m }));
export function Toasts() {
  const [m, setM] = useState('');
  useEffect(() => {
    let t;
    const on = (e) => { setM(e.detail); clearTimeout(t); t = setTimeout(() => setM(''), 4200); };
    window.addEventListener('yaari-toast', on);
    return () => { window.removeEventListener('yaari-toast', on); clearTimeout(t); };
  }, []);
  return <div className={'toast' + (m ? ' show' : '')} role="status">{m}</div>;
}

/* ---- bottom sheet ---- */
export function Sheet({ open, title, onClose, footer, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <>
      <div className={'scrim' + (open ? ' open' : '')} onClick={onClose} />
      <section className={'sheet' + (open ? ' open' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sh-h"><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="sh-b">{open && children}</div>
        {footer ? <div className="sh-f">{footer}</div> : null}
      </section>
    </>
  );
}

/* ---- small pieces ---- */
export const Chips = ({ options, value, onPick, fmt }) => (
  <div className="chips">
    {options.map((o) => (
      <button key={String(o)} className="chip" aria-pressed={String(value) === String(o)} onClick={() => onPick(o)}>{fmt ? fmt(o) : o}</button>
    ))}
  </div>
);

export function useUrl(id) {
  const [u, setU] = useState(null);
  useEffect(() => {
    let live = true; setU(null);
    if (id) fileUrl(id).then((x) => { if (live) setU(x); });
    return () => { live = false; };
  }, [id]);
  return u;
}

export function Avatar({ id, name, uid, size = 64, onClick }) {
  const u = useUrl(id);
  const st = { width: size, height: size, fontSize: Math.round(size / 2) };
  const inner = u
    ? <img className="av" style={{ ...st, objectFit: 'cover', display: 'block' }} src={u} alt="" />
    : <div className="av" style={{ ...st, background: avc(uid || id) }} aria-hidden="true">{String(name || '?').charAt(0)}</div>;
  return onClick && u ? <button className="zoomable" onClick={onClick} aria-label="View photo bigger">{inner}</button> : inner;
}

export const Thumb = ({ id, size = 88, onClick, children }) => {
  const u = useUrl(id);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button className="zoomable" style={{ borderRadius: 12 }} onClick={onClick} aria-label="View photo bigger">
        {u ? <img src={u} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 12, display: 'block' }} /> : <div style={{ width: size, height: size, borderRadius: 12, background: 'var(--chip)' }} />}
      </button>
      {children}
    </div>
  );
};

/* ---- full-screen photo viewer ---- */
export const openLightbox = (ids, index = 0) => window.dispatchEvent(new CustomEvent('yaari-lb', { detail: { ids: ids.filter(Boolean), index } }));
export function Lightbox() {
  const [s, setS] = useState(null);
  const [x0, setX0] = useState(null);
  useEffect(() => {
    const on = (e) => setS({ ids: e.detail.ids, i: e.detail.index });
    window.addEventListener('yaari-lb', on);
    return () => window.removeEventListener('yaari-lb', on);
  }, []);
  const step = (d) => setS((v) => (v ? { ...v, i: (v.i + d + v.ids.length) % v.ids.length } : v));
  useEffect(() => {
    if (!s) return undefined;
    const k = (e) => { if (e.key === 'Escape') setS(null); if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [s]);
  const url = useUrl(s ? s.ids[s.i] : null);
  if (!s || !s.ids.length) return null;
  return (
    <div className="lb open" onClick={(e) => { if (e.target === e.currentTarget) setS(null); }}
      onTouchStart={(e) => setX0(e.touches[0].clientX)}
      onTouchEnd={(e) => { if (x0 != null) { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); setX0(null); } }}>
      <button className="lbx" onClick={() => setS(null)} aria-label="Close">✕</button>
      {url ? <img src={url} alt="Photo" /> : null}
      <div className="lbc">{s.i + 1} / {s.ids.length}</div>
      {s.ids.length > 1 ? <><button className="lbn lbp" onClick={() => step(-1)} aria-label="Previous photo">‹</button><button className="lbn lbnx" onClick={() => step(1)} aria-label="Next photo">›</button></> : null}
    </div>
  );
}

/* ---- runs an async action, shows errors as a toast ---- */
export function useAct() {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    if (busy) return undefined;
    setBusy(true);
    try { return await fn(); } catch (e) { toast(e.message || 'Something went wrong'); return undefined; } finally { setBusy(false); }
  };
  return [busy, run];
}

export const Field = ({ label, hint, children }) => (
  <>{label ? <label className="lbl">{label}</label> : null}{children}{hint ? <p className="hint">{hint}</p> : null}</>
);
