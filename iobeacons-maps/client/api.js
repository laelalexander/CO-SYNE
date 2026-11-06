// API client. The app is served under a base path such as /maps.
export const BASE = (() => {
  const p = location.pathname.replace(/\/(index\.html|embed\.html)?$/, '');
  return p === '/' ? '' : p;
})();
export const API = `${BASE}/api`;

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `Request failed (${status})`); this.status = status; this.body = body; }
}

export async function api(path, { method = 'GET', body, form, raw } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`${API}${path}`, opts);
  if (raw) return res;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
