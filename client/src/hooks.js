import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { toast } from './ui';
import { getPos } from './util';

/** SOS button and live-location sharing (works while the page is open). */
export function useSafety() {
  const [sos, setSos] = useState(null);
  const [watch, setWatch] = useState(null); // booking id being shared
  const timer = useRef(null);
  const stop = () => { clearInterval(timer.current); timer.current = null; setWatch(null); };
  useEffect(() => stop, []);

  const sendSos = async (bookingId) => {
    const pos = await getPos();
    await api('/safety/sos', { method: 'POST', body: { bookingId, lat: pos ? pos.latitude : undefined, lng: pos ? pos.longitude : undefined } });
    setSos({ lat: pos ? pos.latitude : null, lng: pos ? pos.longitude : null });
  };

  const ping = async (bookingId) => {
    const pos = await getPos();
    if (!pos) { toast('Location permission is needed to share your location.'); return; }
    try { await api('/safety/ping', { method: 'POST', body: { bookingId, lat: pos.latitude, lng: pos.longitude } }); }
    catch (e) { toast(e.message); stop(); }
  };

  const toggleShare = async (bookingId) => {
    if (watch === bookingId) { stop(); toast('Stopped sharing.'); return; }
    stop(); setWatch(bookingId);
    timer.current = setInterval(() => ping(bookingId), 60000);
    toast('Sharing your location with Yaari support every minute. Keep this page open.');
    await ping(bookingId);
  };
  return { sos, closeSos: () => setSos(null), sendSos, watch, toggleShare, stop };
}
