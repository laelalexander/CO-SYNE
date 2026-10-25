// CO-SYNE service worker.
// - App-shell cache for the apps. Network first, so a deployment update is
//   picked up immediately; the cache only covers offline starts. The Driver
//   app shell is cached at install, so the wallet ID opens with no signal.
//   Live data (/api, /ws, stickers, downloads) is never cached.
// - Web Push: pull-over alerts, stop and ticket updates, and system notices
//   reach a driver's phone while the app is closed or the phone is locked.
const CACHE = 'cosyne-shell-v5';
const DRIVER_SHELL = [
  'driver/', 'driver/index.html', 'driver/driver.js', 'driver/driver.css', 'driver/manifest.webmanifest',
  'canonical.js', 'lib/theme.css', 'lib/session.js', 'lib/socket.js', 'lib/keys.js', 'lib/ui.js', 'lib/icons.js', 'lib/install.js',
  'lib/call.js', 'lib/rtc.js', 'lib/native.js', 'icons/driver.svg', 'icons/driver-192.png', 'icons/driver-512.png',
];
const scopeUrl = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // Best effort: one missing file must not block the update.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(DRIVER_SHELL.map((p) => c.add(scopeUrl(p)).catch(() => {})))));
});
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || /\/(api|ws|s|downloads)\//.test(url.pathname) || url.pathname.endsWith('/ws')) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// ---------- push ----------
const VIBRATE = { pullover: [400, 200, 400, 200, 400, 200, 800], danger: [600, 200, 600, 200, 600, 200, 600], citation: [200, 100, 200], notice: [200] };
const ACTION_LABEL = { accept: 'Accept video', text: 'Text only' };

async function driverWindows() {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all.filter((c) => new URL(c.url).pathname.includes('/driver/'));
}

self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data?.json() ?? {}; } catch { p = { title: 'CO-SYNE', body: e.data?.text() ?? '' }; }
  e.waitUntil((async () => {
    const wins = await driverWindows();
    // The app is open on screen: it shows its own full-screen alert. Safari
    // requires a notification for every push, so it always gets one.
    const safari = !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(self.navigator.userAgent);
    const visible = wins.find((w) => w.visibilityState === 'visible');
    for (const w of wins) w.postMessage({ t: 'push', payload: p });
    if (p.kind === 'citation' && self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {});
    if (visible && !safari && p.kind !== 'notice') return;
    await self.registration.showNotification(p.title ?? 'CO-SYNE', {
      body: p.body ?? '', tag: p.tag ?? undefined, renotify: Boolean(p.tag),
      icon: scopeUrl('icons/driver-192.png'), badge: scopeUrl('icons/driver-192.png'),
      requireInteraction: Boolean(p.urgent), vibrate: VIBRATE[p.kind] ?? [200],
      data: { url: p.url ?? 'driver/', stopId: p.stopId ?? null, kind: p.kind ?? null },
      actions: (p.actions ?? []).map((a) => ({ action: a, title: ACTION_LABEL[a] ?? a })),
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data ?? {};
  const target = new URL(scopeUrl(d.url ?? 'driver/'));
  if (e.action) target.searchParams.set('action', e.action);
  e.waitUntil((async () => {
    const wins = await driverWindows();
    if (wins.length) {
      const w = wins[0];
      w.postMessage({ t: 'open', stopId: d.stopId, action: e.action || null, url: target.href });
      return w.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
