// Native-app behaviour for the installed Driver app: Web Push, vibration,
// keeping the screen awake during a stop or call, the home-screen badge, and
// install state. Every call degrades quietly where the platform lacks it.

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Where push stands on this device, for the UI:
//  'unsupported' | 'ios-install' (iPhone must add to Home Screen first)
//  'default' (not asked yet) | 'denied' | 'granted'
export function pushState() {
  if (isIos() && !isStandalone()) return 'ios-install';
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

const b64ToBytes = (s) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// Subscribes this phone for push and registers it with CO-SYNE.
// api(method, path, body) is the signed-in driver session's api.
export async function enablePush(api, { ask = true } = {}) {
  if (!pushSupported()) return false;
  if (Notification.permission === 'default') {
    if (!ask) return false;
    if ((await Notification.requestPermission()) !== 'granted') return false;
  }
  if (Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const fresh = async () => {
    const { publicKey } = await api('GET', '/api/push/key');
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  };
  let sub = (await reg.pushManager.getSubscription()) ?? await fresh();
  try {
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
  } catch (err) {
    // The push service retired this subscription (or the server's key
    // changed): replace it with a new one.
    if (!/expired/.test(err.message)) throw err;
    await sub.unsubscribe().catch(() => {});
    sub = await fresh();
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
  }
  return true;
}

export async function disablePush(api) {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export const VIBRATE = {
  pullover: [400, 200, 400, 200, 400],
  danger: [600, 200, 600, 200, 600],
  notify: [180, 90, 180],
  tap: [12],
};
export function vibrate(pattern) {
  try { navigator.vibrate?.(VIBRATE[pattern] ?? pattern); } catch { /* not allowed */ }
}

// Screen Wake Lock, held while any reason is active (a live stop, a call).
// The browser drops the lock when the app is hidden; it is taken again when
// the app comes back.
const reasons = new Set();
let lock = null;
async function syncLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (reasons.size && !lock && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!reasons.size && lock) {
      await lock.release(); lock = null;
    }
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', syncLock);
export function keepAwake(reason, on) {
  if (on) reasons.add(reason); else reasons.delete(reason);
  syncLock();
}

// Count on the home-screen icon (unread or unpaid tickets).
export function setBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* unsupported */ }
}
