export const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
export const fmtWhen = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const isoDate = (d) => d.toISOString().slice(0, 10);

export const SERVICES = [
  { k: 'Shopping', e: '🛍️', c: '#FFE3B8', d: 'Browse, pick outfits and enjoy a day at the mall or market.', v: ['Mall / Market', 'Cafe / Restaurant'] },
  { k: 'Movie', e: '🎬', c: '#D6E8FF', d: 'Someone to watch a film with and chat about it afterwards.', v: ['Cinema hall', 'Cafe / Restaurant'] },
  { k: 'Club & Party', e: '🎉', c: '#F3D9FF', d: 'A friendly plus-one at registered venues. No pressure to drink.', v: ['Registered club / lounge', 'Banquet / Party venue'] },
  { k: 'Wedding', e: '💒', c: '#FFD6DD', d: 'A polite, well-dressed guest for weddings and receptions.', v: ['Wedding venue / Banquet'] },
  { k: 'Study', e: '📚', c: '#D4F2E3', d: 'A study buddy for focus, exam prep or language practice.', v: ['Library / Study cafe', 'Cafe / Restaurant'] },
  { k: 'Play', e: '🎮', c: '#FFF0B3', d: 'Sports, board games, gaming or a walk. Fun without the awkwardness.', v: ['Sports ground / Park', 'Gaming cafe / Arcade', 'Board-game cafe'] },
  { k: 'Caretaker', e: '🤝', c: '#DCE6F5', d: 'Police-verified caretakers for elders and patients.', v: ['Home (verified caretakers only)', 'Hospital / Clinic', 'Park (walks)'] },
];
export const svc = (k) => SERVICES.find((s) => s.k === k);
export const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
export const AGES = [['', 'Any age'], ['18-25', '18 to 25'], ['26-35', '26 to 35'], ['36-45', '36 to 45'], ['46-', '46 and above']];
export const REASONS = ['Inappropriate behaviour', 'Asked to meet privately', 'Asked for payment outside Yaari', 'Fake profile or photo', 'Harassment or threats', 'Other'];
export const STLBL = { pending_payment: 'Awaiting payment', paid: 'Waiting for companion', accepted: 'Confirmed', in_progress: 'In progress', completed: 'Completed', refund_pending: 'Refund in progress', refunded: 'Refunded', cancelled: 'Cancelled' };
export const pillFor = (st) => (st === 'completed' ? 'pill g' : st === 'refunded' || st === 'cancelled' ? 'pill r' : st === 'refund_pending' ? 'pill o' : 'pill');
const AVC = ['#CFE3FF', '#FFD9E6', '#D8F2DD', '#FFE9B8', '#E7DAFB', '#CDEFF0'];
export const avc = (id) => { let n = 0; String(id || '').split('').forEach((c) => { n += c.charCodeAt(0); }); return AVC[n % AVC.length]; };

/** Shrinks a photo in the browser before upload (saves storage and data). */
export function compress(file, max, q) {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type)) return resolve(file);
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob((b) => resolve(b || file), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(u); resolve(file); };
    img.src = u;
  });
}

export function getPos() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), () => resolve(null), { timeout: 9000, enableHighAccuracy: true });
  });
}
