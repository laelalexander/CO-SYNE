// Shared client for the three CO-SYNE apps: server base URL (so the apps work
// under a path prefix such as /cosyne/), REST calls, and the signed-in
// WebSocket session.
import { stopChallengeMessage } from '../canonical.js';
import { signText } from './keys.js';
import { Socket } from './socket.js';
import { setupInstall } from './install.js';
import { showNotice } from './ui.js';

// Apps live one level below the server root (/driver/, /officer/, /dispatch/).
export const ROOT = new URL(document.querySelector('meta[name="cosyne-root"]')?.content ?? '../', location.href);
export const url = (p) => new URL(p.replace(/^\//, ''), ROOT).href;

export async function api(method, path, body, token) {
  const res = await fetch(url(path), {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function bootstrap() {
  setupInstall();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(url('/sw.js'), { scope: ROOT.pathname }).catch(() => {});
  const [config, trust] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/trust')]);
  return { config, trust: trust.issuers };
}

// Opens the network session. identity = { credential, privateJwk } for
// drivers and officers; dispatch passes { token, name }.
export function openSession(role, identity, { location } = {}) {
  const wsUrl = url('/ws').replace(/^http/, 'ws');
  const listeners = new Set();
  const session = {
    role, token: null, profile: null, unitId: null, peerId: null, online: false,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    api: (method, path, body) => api(method, path, body, session.token),
    send: (msg) => socket.send(msg),
    close: () => socket.close(),
  };
  const socket = new Socket(wsUrl, async (nonce, resumeToken) => {
    if (role === 'dispatch') return { t: 'hello', role, token: identity.token, name: identity.name, resumeToken };
    return {
      t: 'hello', role, credential: identity.credential, resumeToken,
      signature: await signText(identity.privateJwk, stopChallengeMessage('session', nonce, role)),
      location: location?.() ?? undefined,
    };
  });
  session.socket = socket;
  socket.on((msg) => {
    if (msg.t === 'hello_ok') Object.assign(session, { token: msg.token, profile: msg.profile, unitId: msg.unitId, peerId: msg.peerId, online: true });
    if (msg.t === 'disconnected') session.online = false;
    if (msg.t === 'notice') showNotice(msg);
    for (const fn of listeners) fn(msg);
  });
  return session;
}

// Location: real GPS when the device has it and the user allows it,
// otherwise a simulated position (desktops rarely have GPS).
export function locationFeed({ fallback, onChange, simulate = 'auto' }) {
  let current = { ...fallback, simulated: true };
  let watch = null;
  const emit = (loc) => { current = loc; onChange?.(loc); };
  if (simulate !== 'always' && navigator.geolocation) {
    watch = navigator.geolocation.watchPosition(
      (p) => emit({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), simulated: false }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }
  return {
    get: () => current,
    set: (loc) => emit({ ...loc, simulated: true }),
    stop: () => watch != null && navigator.geolocation.clearWatch(watch),
  };
}
