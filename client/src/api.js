let token = localStorage.getItem('yaari_token') || '';
export const setToken = (t) => { token = t || ''; if (t) localStorage.setItem('yaari_token', t); else localStorage.removeItem('yaari_token'); };
export const hasToken = () => !!token;

/** Talks to the Yaari server. Throws an Error with a readable message if something goes wrong. */
export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, { method, headers, body: payload }); }
  catch { throw new Error('Cannot reach the server. Check your internet and try again.'); }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : null;
  if (res.status === 401 && token) { setToken(''); window.dispatchEvent(new Event('yaari-auth-lost')); }
  if (!res.ok) { const e = new Error((data && data.error) || 'Something went wrong'); e.status = res.status; throw e; }
  return data;
}

/* Photos and documents need the login token, so they are fetched and turned into a local blob URL (cached). */
const cache = new Map();
export function fileUrl(id) {
  if (!id) return Promise.resolve(null);
  if (!cache.has(id)) {
    cache.set(id, fetch('/api/files/' + id, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('photo'))))
      .then((b) => URL.createObjectURL(b))
      .catch(() => { cache.delete(id); return null; }));
  }
  return cache.get(id);
}
export const forgetFile = (id) => cache.delete(id);
export const clearFileCache = () => cache.clear();
