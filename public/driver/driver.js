// CO-SYNE Driver: the driver's phone app.
import { stopChallengeMessage } from '../canonical.js';
import { api, bootstrap, openSession, url } from '../lib/session.js';
import { generateHolderKeys, loadIdentity, saveIdentity, clearIdentity, signText, verifyCredentialLocally } from '../lib/keys.js';
import { Call } from '../lib/call.js';
import { icon } from '../lib/icons.js';
import { $, $$, esc, initials, money, time, dateTime, vehicleLine, ALERT_LABEL, citationDocument, showDocument, toast, tone } from '../lib/ui.js';
import { disablePush, enablePush, isIos, isStandalone, keepAwake, pushState, setBadge, vibrate } from '../lib/native.js';

// Deep links from notifications and home-screen shortcuts:
// ?stop=<id>&action=accept|text, ?tab=sos|tickets
const params = new URL(location.href).searchParams;
const S = {
  config: null, trust: [], identity: loadIdentity('driver'), session: null,
  tab: ['home', 'sos', 'tickets', 'activity', 'me'].includes(params.get('tab')) ? params.get('tab') : 'home',
  stops: new Map(), alerts: new Map(), citations: new Map(),
  seenStops: new Set(), officerChecks: new Map(), call: null, callStopId: null, chat: [], view: null,
  location: { lat: 36.1236, lng: -95.9593, simulated: true },
  pending: params.get('stop') ? { stopId: params.get('stop'), action: params.get('action') } : null,
  offline: !navigator.onLine,
};
if (params.has('stop') || params.has('tab') || params.has('action')) history.replaceState(null, '', location.pathname);
const view = $('#view');
const overlayRoot = $('#overlay-root');
const subject = () => S.identity?.credential?.subject ?? {};
const vehicle = () => subject().vehicle ?? {};
const fmtPlate = (p = '') => (/^[A-Z]{3}\d{3}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p);

// ---------- clock & frame ----------
function tick() { $('#sb-time').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, ''); }
setInterval(tick, 10_000); tick();

// ---------- banners (push notifications) ----------
function banner(title, text, onTap) {
  const el = document.createElement('div');
  el.className = 'banner';
  el.innerHTML = `<img class="app-ico" src="../icons/driver-192.png" alt=""><div class="grow"><b>${esc(title)}</b><span>${esc(text)}</span></div><small>now</small>`;
  el.onclick = () => { el.remove(); onTap?.(); };
  $('#banners').append(el);
  setTimeout(() => el.remove(), 6000);
  tone('chime');
  vibrate('notify');
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body: text, icon: '../icons/driver-192.png' }); } catch { /* not allowed here */ }
  }
}

// ---------- boot ----------
async function init() {
  let offline;
  ({ config: S.config, trust: S.trust, offline } = await bootstrap());
  if (offline) S.offline = true;
  $('#stage-tip').textContent = S.config.demo ? 'Demo mode: sample drivers are available on the welcome screen.' : '';
  if (S.identity) connect(); else { setNet('not signed in', false); render(); }
  if (offline) setNet('offline', false);
}

// Offline: the wallet ID and sticker stay available; alerts resume on reconnect.
addEventListener('online', () => { S.offline = false; render(); });
addEventListener('offline', () => { S.offline = true; render(); });

// The service worker forwards notification taps and pushes to an open app.
navigator.serviceWorker?.addEventListener('message', (e) => {
  const m = e.data ?? {};
  if (m.t === 'open') {
    if (m.stopId) { S.pending = { stopId: m.stopId, action: m.action }; const st = S.stops.get(m.stopId); if (st) handlePending(st); }
    else if (/tab=tickets/.test(m.url ?? '')) openTickets();
  } else if (m.t === 'push' && m.payload?.kind === 'citation') {
    S.session?.api('GET', '/api/citations').then(({ citations }) => { for (const c of citations) S.citations.set(c.id, c); render(); }).catch(() => {});
  }
});

// Opens the stop a notification was tapped for, and answers if asked to.
function handlePending(stop) {
  const p = S.pending;
  if (!p || p.stopId !== stop.id) return;
  S.pending = null;
  const ringing = !stop.call?.status || stop.call.status === 'ringing';
  if (stop.status === 'failed') showDanger(stop);
  else if (stop.status === 'ended') showStop(stop.id);
  else if (p.action === 'accept' && ringing) answer(stop.id, 'accepted');
  else if (p.action === 'text' && ringing) answer(stop.id, 'declined');
  else if (S.view !== 'pullover' || S.viewStop !== stop.id) showPullover(stop);
}

// ---------- alerts while the app is closed (Web Push) ----------
const ASK_KEY = 'cosyne:driver:push-asked';
function maybeAskPush() {
  const st = pushState();
  if (st === 'granted') { enablePush(S.session.api, { ask: false }).catch(() => {}); return; }
  if (!['default', 'ios-install'].includes(st)) return;
  let last = 0;
  try { last = Number(localStorage.getItem(ASK_KEY)) || 0; } catch { /* ignore */ }
  if (Date.now() - last < 3 * 86400_000) return;
  // Wait for a calm moment: never over a stop, a call, or another sheet.
  setTimeout(() => { if (!S.view && !$('#sheet')) pushSheet(); }, 1500);
}

function pushSheet() {
  const st = pushState();
  try { localStorage.setItem(ASK_KEY, String(Date.now())); } catch { /* ignore */ }
  const body = {
    'ios-install': `<p>On iPhone, CO-SYNE can alert you only when it's installed on your Home Screen (iOS 16.4 or later).</p>
      <ol class="small" style="padding-left:18px"><li>Tap the <b>Share</b> button in Safari.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Open CO-SYNE from its new icon and turn on alerts.</li></ol>
      <button class="btn primary block pill-btn" data-close>Got it</button>`,
    unsupported: `<p>This browser can't receive alerts while CO-SYNE is closed. Keep the app open while driving, or use Chrome on Android or Safari on iPhone.</p><button class="btn block pill-btn" data-close>OK</button>`,
    denied: `<p>Notifications are blocked for CO-SYNE. To get pull-over alerts, turn them on in your phone's <b>Settings → Notifications</b>${isStandalone() ? '' : ' or in the browser\'s site settings'}.</p><button class="btn block pill-btn" data-close>OK</button>`,
    default: `<p>When an officer starts a stop, CO-SYNE alerts you even if this app is closed or your phone is locked. You'll see the officer's verified name and badge, and the reason, before anyone approaches.</p>
      <div class="group" style="margin:12px 0"><div class="cell"><span class="ico-wrap">${icon('siren')}</span><span class="grow"><b>Pull-over alerts</b><span>With Accept video or Text only</span></span></div>
      <div class="cell"><span class="ico-wrap">${icon('ticket')}</span><span class="grow"><b>Tickets and stop updates</b><span>Citations, warnings, and when a stop ends</span></span></div></div>
      <button class="btn primary block pill-btn" id="push-on">Turn on alerts</button><button class="btn block pill-btn" style="margin-top:8px" data-close>Not now</button>`,
    granted: `<p>Alerts are on for this phone. A pull-over alert reaches you even when CO-SYNE is closed.</p>
      <button class="btn primary block pill-btn" id="push-test">Send a test alert</button><button class="btn block pill-btn" style="margin-top:8px" id="push-off">Turn off on this phone</button>`,
  }[st];
  sheet(`<h2>${icon('bell')} Alerts</h2>${body}`);
  $$('#sheet [data-close]').forEach((b) => { b.onclick = closeSheet; });
  $('#push-on')?.addEventListener('click', async () => {
    try { const ok = await enablePush(S.session.api); toast(ok ? 'Alerts are on' : 'Alerts were not turned on'); } catch (e) { toast(e.message); }
    closeSheet(); render();
  });
  $('#push-test')?.addEventListener('click', async () => {
    try {
      await enablePush(S.session.api, { ask: false });
      const { delivered } = await S.session.api('POST', '/api/push/test');
      toast(delivered ? 'Test alert sent. Lock your phone to see it arrive.' : 'This phone is not registered for alerts yet');
    } catch (e) { toast(e.message); }
  });
  $('#push-off')?.addEventListener('click', async () => { await disablePush(S.session.api); toast('Alerts turned off on this phone'); closeSheet(); render(); });
}

function connect() {
  S.session?.close();
  S.session = openSession('driver', S.identity, { location: () => S.location });
  S.session.on(onMessage);
  render();
}

function setNet(text, ok) {
  $('#net-state').textContent = text;
  $('#net-state').style.color = ok ? 'var(--ok)' : '';
}

async function onMessage(msg) {
  if (msg.t === 'hello_ok') {
    setNet('connected to CO-SYNE', true);
    S.offline = false;
    try {
      const { citations } = await S.session.api('GET', '/api/citations');
      for (const c of citations) S.citations.set(c.id, c);
    } catch { /* offline */ }
    render();
    maybeAskPush();
  } else if (msg.t === 'disconnected') {
    setNet('reconnecting…', false);
  } else if (msg.t === 'error' && msg.ref === 'hello') {
    setNet('sign-in failed', false);
    toast(msg.error);
  } else if (msg.t === 'stop') {
    await onStop(msg.stop);
  } else if (msg.t === 'alert') {
    S.alerts.set(msg.alert.id, msg.alert);
    render();
  }
}

async function onStop(stop) {
  const prev = S.stops.get(stop.id);
  S.stops.set(stop.id, stop);
  for (const c of stop.citations ?? []) {
    if (!S.citations.has(c.id)) banner(`${c.type === 'warning' ? 'Written warning' : 'Traffic citation'} received`, `${c.id} from ${c.officer.name}. Tap to review.`, () => openTickets());
    S.citations.set(c.id, c);
  }
  // Check the officer's credential on this phone, independently of the server.
  if (stop.officerCredential && !S.officerChecks.has(stop.id)) {
    S.officerChecks.set(stop.id, await verifyCredentialLocally(stop.officerCredential, S.trust));
  }
  const isNew = !S.seenStops.has(stop.id) && !['ended'].includes(stop.status);
  if (isNew) {
    S.seenStops.add(stop.id);
    if (stop.status === 'failed' || S.officerChecks.get(stop.id)?.ok === false) showDanger(stop);
    else showPullover(stop);
  } else if (stop.status === 'failed' && prev?.status !== 'failed') {
    showDanger(stop);
  } else if (stop.status === 'ended' && prev && prev.status !== 'ended') {
    if (S.callStopId === stop.id) endCall();
    showDone(stop);
  } else if (S.view === 'pullover' && S.viewStop === stop.id) {
    showPullover(stop, { refresh: true });
  }
  if (S.view === 'stop' && S.viewStop === stop.id) showStop(stop.id);
  handlePending(stop);
  render();
}

// ---------- main views ----------
const TABS = [
  ['home', 'Home', 'home'], ['sos', 'Emergency', 'siren'], ['tickets', 'Tickets', 'ticket'], ['activity', 'Activity', 'clock'], ['me', 'Me', 'user'],
];

function render() {
  const tabbar = $('#tabbar');
  if (!S.identity) { tabbar.classList.add('hidden'); renderWelcome(); return; }
  tabbar.classList.remove('hidden');
  const unpaid = [...S.citations.values()].filter((c) => !c.ack || c.status === 'unpaid').length;
  setBadge(unpaid);
  tabbar.innerHTML = TABS.map(([id, label, ic]) => `<button class="${S.tab === id ? 'on' : ''} ${id === 'sos' ? 'sos-tab' : ''}" data-tab="${id}">${icon(ic)}${label}${id === 'tickets' && unpaid ? `<i class="badge">${unpaid}</i>` : ''}</button>`).join('');
  tabbar.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; render(); view.scrollTop = 0; }; });
  ({ home: renderHome, sos: renderSos, tickets: renderTickets, activity: renderActivity, me: renderMe })[S.tab]();
  renderMiniCall();
}

function activeStop() {
  return [...S.stops.values()].filter((s) => !['ended', 'failed'].includes(s.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
function activeAlert() {
  return [...S.alerts.values()].filter((a) => !['resolved', 'cancelled'].includes(a.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

function walletCard() {
  const s = subject();
  const cred = S.identity.credential;
  return `<div class="wallet" data-open-id>
    <div class="w-top"><span>Oklahoma · Driver License</span><span>Class ${esc(s.licenseClass ?? 'D')}</span></div>
    <div class="row" style="margin-top:14px;gap:14px;flex-wrap:nowrap"><div class="w-photo">${esc(initials(s.name))}</div><div><div class="w-name" style="margin:0">${esc(s.name)}</div><div style="font-size:.8rem;color:#c9c3b3">DL ${esc(s.licenseNumber ?? '—')}</div></div></div>
    <div class="w-row"><div><span>DOB</span>${esc(s.dob ?? '—')}</div><div><span>Expires</span>${esc(s.licenseExpires ?? '—')}</div><div><span>Plate</span>${esc(fmtPlate(vehicle().plate))}</div></div>
    <div class="w-seal">${icon('shieldCheck')} Verified by ${esc(cred.issuerName)}</div>
  </div>`;
}

function renderHome() {
  const s = subject();
  const v = vehicle();
  const stop = activeStop();
  const alert = activeAlert();
  const regExpired = s.registrationStatus === 'expired' || (s.registrationExpires && Date.parse(s.registrationExpires) < Date.now());
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  view.innerHTML = `
    <div class="greeting"><div><div class="sub">${hello}</div><h1>${esc(s.name?.split(' ')[0] ?? '')}</h1></div>
      <span class="chip"><span class="dot ${S.session?.online ? 'ok' : 'warn'}"></span>${S.session?.online ? 'Protected' : S.offline ? 'Offline' : 'Connecting'}</span></div>
    ${S.offline ? `<div class="offline-card">${icon('wifi')}<div><b>No connection</b><span>Your ID, vehicle and sticker still work offline. Alerts and video resume when you're back online.</span></div></div>` : ''}
    ${S.session?.online && ['default', 'ios-install'].includes(pushState()) ? `<button class="tile-card cell push-nudge" data-push-sheet><span class="ico-wrap">${icon('bell')}</span><span class="grow"><b>Get alerts when the app is closed</b><span>${pushState() === 'ios-install' ? 'Add CO-SYNE to your Home Screen first' : 'Turn on pull-over alerts for this phone'}</span></span>${icon('chevronRight')}</button>` : ''}
    ${stop ? `<button class="tile-card cell" style="border:2px solid var(--warn);border-radius:16px" data-open-stop="${esc(stop.id)}">
        <span class="ico-wrap" style="background:var(--warn-bg);color:var(--warn)">${icon('siren')}</span>
        <span class="grow"><b>Traffic stop in progress</b><span>${esc(stop.officer?.name ?? 'Officer')} · ${esc(stop.reason ?? '')}</span></span>${icon('chevronRight')}</button>` : ''}
    ${alert ? `<button class="tile-card cell" style="border:2px solid var(--danger);border-radius:16px" data-open-alert="${esc(alert.id)}">
        <span class="ico-wrap" style="background:var(--danger-bg);color:var(--danger)">${icon('alert')}</span>
        <span class="grow"><b>${esc(ALERT_LABEL[alert.type] ?? 'Emergency')} alert active</b><span>${alert.assignments.length ? `${esc(alert.assignments.map((a) => a.callsign).join(', '))} responding` : 'Routing to dispatch…'}</span></span>${icon('chevronRight')}</button>` : ''}
    ${walletCard()}
    <div class="group">
      <button class="cell" data-open-vehicle><span class="ico-wrap">${icon('car')}</span><span class="grow"><b>${esc(vehicleLine(v))}</b><span>${esc(fmtPlate(v.plate))} ${esc(v.state ?? '')} · CO-SYNE sticker active</span></span>${icon('chevronRight')}</button>
      <div class="cell"><span class="ico-wrap" style="${regExpired ? 'background:var(--warn-bg);color:var(--warn)' : ''}">${icon('file')}</span><span class="grow"><b>Registration</b><span style="${regExpired ? 'color:var(--warn)' : ''}">${regExpired ? `Expired ${esc(s.registrationExpires)} · renew with Service Oklahoma` : `Valid through ${esc(s.registrationExpires ?? '—')}`}</span></span></div>
      <div class="cell"><span class="ico-wrap">${icon('shield')}</span><span class="grow"><b>Insurance</b><span>${esc(s.insuranceCarrier ?? '')} · ${esc(s.insurance ?? '')} through ${esc(s.insuranceExpires ?? '—')}</span></span></div>
    </div>
    <div class="group-title">If you're pulled over</div>
    <div class="group">
      <div class="cell"><span class="ico-wrap">${icon('bell')}</span><span class="grow"><b>You'll get an alert here</b><span>When an officer scans your sticker, this phone shows who they are and why you were stopped, verified before anyone approaches.</span></span></div>
      <button class="cell" data-verify-nearby><span class="ico-wrap">${icon('search')}</span><span class="grow"><b>Check a patrol car near me</b><span>Ask dispatch whether a unit nearby is on the CO-SYNE network.</span></span>${icon('chevronRight')}</button>
    </div>
    <button class="sos-btn" data-tab-go="sos">${icon('siren')} Emergency</button>`;
  bindCommon();
}

function bindCommon() {
  view.querySelectorAll('[data-open-stop]').forEach((b) => { b.onclick = () => showStop(b.dataset.openStop); });
  view.querySelectorAll('[data-open-alert]').forEach((b) => { b.onclick = () => showAlert(b.dataset.openAlert); });
  view.querySelectorAll('[data-tab-go]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tabGo; render(); }; });
  view.querySelector('[data-open-id]')?.addEventListener('click', showId);
  view.querySelector('[data-open-vehicle]')?.addEventListener('click', showId);
  view.querySelector('[data-verify-nearby]')?.addEventListener('click', verifyNearby);
  view.querySelector('[data-push-sheet]')?.addEventListener('click', pushSheet);
  view.querySelectorAll('[data-cit]').forEach((b) => { b.onclick = () => citationAction(b.dataset.cit, b.dataset.act); });
}

const SOS = [
  ['medical', 'Medical', 'heart', 'red', 'EMS and police'], ['crash', 'Crash', 'crash', 'red', 'Police, EMS'], ['fire', 'Vehicle fire', 'flame', 'red', 'Fire and EMS'],
  ['threat', "I'm in danger", 'alert', 'red', 'Priority police'], ['traffic_stop', 'Being pulled over', 'siren', 'amber', 'Verify the officer'], ['breakdown', 'Breakdown', 'wrench', 'ink', 'Tow and police'],
];
function renderSos() {
  const alert = activeAlert();
  view.innerHTML = `<h1 class="page-title">Emergency</h1>
    ${alert ? alertCard(alert) : ''}
    <p class="muted small" style="margin-top:0">Your location, vehicle, and verified ID go to Tulsa 911 with the alert, and your location keeps updating until the alert closes.</p>
    <div class="sos-grid">${SOS.map(([id, label, ic, tone, sub]) => `<button class="sos ${tone}" data-sos="${id}">${icon(ic)}<div><b>${label}</b><br><span>${sub}</span></div></button>`).join('')}</div>
    <label for="sos-desc" style="margin-top:16px">What's happening? (optional)</label>
    <textarea id="sos-desc" rows="2" placeholder="e.g. chest pain, two cars, I-44 near Yale"></textarea>`;
  view.querySelectorAll('[data-sos]').forEach((b) => { b.onclick = () => sendAlert(b.dataset.sos); });
  bindCommon();
  bindAlertCard();
}

function alertCard(a) {
  return `<div class="tile-card" style="border:2px solid var(--danger)">
    <div class="spread"><h3>${esc(ALERT_LABEL[a.type] ?? a.type)} · P${a.triage?.priority ?? '?'}</h3><span class="pill ${a.status === 'on_scene' ? 'ok' : 'warn'}">${esc(a.status.replace('_', ' '))}</span></div>
    <p class="small muted">${esc(a.center?.name ?? 'Routing…')}${a.aiPending ? ' · AI review in progress' : ''}</p>
    ${a.assignments.map((x) => `<div class="status-line">${icon('car')} <b>${esc(x.callsign)}</b> <span class="muted">${x.etaMin ? `ETA ${x.etaMin} min` : ''}</span></div>`).join('') || '<div class="status-line muted">Finding the nearest units…</div>'}
    <div class="row" style="margin-top:12px"><button class="btn primary" data-alert-video="${esc(a.id)}">${icon('video')} Video with dispatch</button><button class="btn" data-alert-cancel="${esc(a.id)}">Cancel alert</button></div></div>`;
}
function bindAlertCard() {
  view.querySelectorAll('[data-alert-video]').forEach((b) => { b.onclick = () => openCall({ room: `alert:${b.dataset.alertVideo}`, title: 'Tulsa 911', sub: 'Emergency video' }); });
  view.querySelectorAll('[data-alert-cancel]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Cancel this emergency alert?')) return;
      try { S.alerts.set(b.dataset.alertCancel, await S.session.api('POST', `/api/alerts/${b.dataset.alertCancel}/status`, { status: 'cancelled' })); render(); } catch (e) { toast(e.message); }
    };
  });
}

async function sendAlert(type) {
  const description = $('#sos-desc')?.value ?? '';
  try {
    const a = await S.session.api('POST', '/api/alerts', { type, description, location: S.location });
    S.alerts.set(a.id, a);
    if (navigator.vibrate) navigator.vibrate(200);
    toast(`Alert sent to ${a.center?.name ?? 'dispatch'}`);
    render();
  } catch (e) { toast(e.message); }
}

function showAlert(id) { S.tab = 'sos'; render(); }

// ---------- tickets ----------
function openTickets() { closeOverlay(); S.tab = 'tickets'; render(); }
function citationCard(c) {
  const isCit = c.type === 'citation';
  const paid = c.status === 'paid';
  return `<div class="cit ${isCit ? '' : 'warning'} ${paid ? 'paid' : ''}">
    <div class="spread"><h3>${isCit ? 'Traffic citation' : 'Written warning'}</h3><span class="pill ${paid ? 'ok' : c.status === 'contested' ? 'info' : isCit ? 'bad' : 'warn'}">${paid ? 'Paid' : c.status === 'contested' ? 'Court date requested' : isCit ? 'Unpaid' : 'Warning'}</span></div>
    <div class="small muted">${esc(c.id)} · ${dateTime(c.issuedAt)} · ${esc(c.officer.name)}, ${esc(c.officer.agency)}</div>
    ${isCit ? `<div class="amount">${money(c.totalFine)}</div><div class="small">Pay by <b>${esc(c.payBy)}</b> or appear at ${esc(c.court.name)}</div>` : '<p class="small">No fine. This warning is on record only.</p>'}
    <ul>${c.violations.map((v) => `<li>${esc(v.description)} <span class="muted">· ${esc(v.statute)}</span></li>`).join('')}</ul>
    ${c.notes ? `<p class="small"><i>"${esc(c.notes)}"</i></p>` : ''}
    <div class="actions">
      ${!c.ack ? `<button class="btn primary sm" data-cit="${esc(c.id)}" data-act="ack">Acknowledge receipt</button>` : '<span class="pill ok">Receipt acknowledged</span>'}
      ${isCit && c.status === 'unpaid' ? `<button class="btn sm" data-cit="${esc(c.id)}" data-act="pay">Pay ${money(c.totalFine)}</button><button class="btn sm" data-cit="${esc(c.id)}" data-act="contest">Request court date</button>` : ''}
      <button class="btn sm" data-cit="${esc(c.id)}" data-act="view">View</button>
    </div>
    ${!c.ack ? '<p class="tiny muted" style="margin-top:8px">Acknowledging receipt is not an admission of guilt.</p>' : ''}
    ${c.payment ? `<p class="tiny muted">Payment ${esc(c.payment.confirmation)} · simulated for the pilot</p>` : ''}
  </div>`;
}
function renderTickets() {
  const list = [...S.citations.values()].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  view.innerHTML = `<h1 class="page-title">Tickets</h1>${list.length ? list.map(citationCard).join('') : `<div class="tile-card empty">${icon('ticket')}<br>No citations or warnings. Drive safe.</div>`}`;
  bindCommon();
}

async function citationAction(id, act) {
  const c = S.citations.get(id);
  if (!c) return;
  try {
    if (act === 'view') { showDocument(citationDocument(c), c.id); return; }
    if (act === 'ack') {
      const signature = await signText(S.identity.privateJwk, `CO-SYNE/citation-ack/v1|${c.id}|${c.hash}`);
      S.citations.set(id, await S.session.api('POST', `/api/citations/${id}/ack`, { signature }));
      toast('Receipt acknowledged and signed on this phone');
    } else if (act === 'pay') { showPay(c); return; } else if (act === 'contest') {
      if (!confirm(`Request a court date at ${c.court.name} instead of paying?`)) return;
      S.citations.set(id, await S.session.api('POST', `/api/citations/${id}/contest`));
      toast('Court date requested');
    }
    render();
  } catch (e) { toast(e.message); }
}

function showPay(c) {
  sheet(`<h2 style="margin-bottom:4px">Pay citation</h2><p class="muted small">${esc(c.id)} · ${esc(c.court.name)}</p>
    <div class="tile-card spread"><span>Amount due</span><b style="font-size:1.4rem">${money(c.totalFine)}</b></div>
    <div class="pay-field"><label>Card number</label><input value="4242 4242 4242 4242" inputmode="numeric"></div>
    <div class="row" style="flex-wrap:nowrap"><div class="pay-field grow"><label>Expires</label><input value="12 / 29"></div><div class="pay-field grow"><label>CVC</label><input value="123"></div></div>
    <p class="tiny muted">Pilot simulation: no card is charged and no payment processor is contacted.</p>
    <button class="btn primary block pill-btn" id="pay-now">Pay ${money(c.totalFine)}</button>`);
  $('#pay-now').onclick = async () => {
    try {
      $('#pay-now').disabled = true;
      S.citations.set(c.id, await S.session.api('POST', `/api/citations/${c.id}/pay`));
      closeSheet(); toast('Payment received (simulated)'); render();
    } catch (e) { toast(e.message); $('#pay-now').disabled = false; }
  };
}

// ---------- activity & me ----------
function renderActivity() {
  const items = [
    ...[...S.stops.values()].map((s) => ({ at: s.createdAt, html: `<button class="cell" data-open-stop="${esc(s.id)}"><span class="ico-wrap">${icon('siren')}</span><span class="grow"><b>Traffic stop · ${esc(s.reason ?? '')}</b><span>${esc(s.officer?.name ?? '')} · ${dateTime(s.createdAt)} · ${s.status === 'ended' ? esc(s.outcome ?? 'ended') : 'in progress'}</span></span>${icon('chevronRight')}</button>` })),
    ...[...S.alerts.values()].map((a) => ({ at: a.createdAt, html: `<div class="cell"><span class="ico-wrap">${icon('alert')}</span><span class="grow"><b>${esc(ALERT_LABEL[a.type] ?? a.type)} alert</b><span>${dateTime(a.createdAt)} · ${esc(a.status)}</span></span></div>` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  view.innerHTML = `<h1 class="page-title">Activity</h1>${items.length ? `<div class="group">${items.map((i) => i.html).join('')}</div>` : `<div class="tile-card empty">${icon('clock')}<br>Stops and alerts from this session appear here.</div>`}
    <p class="tiny muted">Every stop, video session, and citation is recorded in the CO-SYNE tamper-evident evidence ledger.</p>`;
  bindCommon();
}

function renderMe() {
  const s = subject();
  view.innerHTML = `<h1 class="page-title">Me</h1>
    <div class="group"><div class="cell"><span class="avatar">${esc(initials(s.name))}</span><span class="grow"><b>${esc(s.name)}</b><span>${esc(s.address ?? '')}</span></span></div></div>
    <div class="group-title">Accessibility shared with officers</div>
    <div class="group"><div class="cell"><span class="ico-wrap">${icon('hand')}</span><span class="grow"><b>${esc(s.accessibility ? 'On your credential' : 'None on file')}</b><span>${esc(s.accessibility ?? 'Add notes such as hearing loss or a medical condition when you register.')}</span></span></div></div>
    <div class="group-title">Vehicle sticker</div>
    <div class="group"><div class="cell" style="flex-direction:column;align-items:stretch;text-align:center">
      <img id="sticker-qr" src="${stickerQrSrc()}" alt="Sticker QR" style="width:150px;margin:6px auto">
      <span class="small muted">Officers scan this from the patrol car. The code holds only a link, never your personal data.</span>
      <a class="btn sm" style="margin-top:10px" href="../sticker.html?id=${encodeURIComponent(S.identity.stickerId)}" target="_blank" rel="noopener">${icon('printer')} Print bumper and window stickers</a></div></div>
    <div class="group-title">Settings</div>
    <div class="group">
      <button class="cell" id="notif"><span class="ico-wrap">${icon('bell')}</span><span class="grow"><b>Alerts when the app is closed</b><span>${esc({ granted: 'On for this phone', default: 'Off · tap to turn on', denied: 'Blocked in phone settings', 'ios-install': 'Add to Home Screen to turn on', unsupported: 'Not supported in this browser' }[pushState()])}</span></span>${icon('chevronRight')}</button>
      <div class="cell"><span class="ico-wrap">${icon('phone')}</span><span class="grow"><b>App</b><span>${isStandalone() ? 'Installed on this phone' : isIos() ? 'In Safari · Share → Add to Home Screen to install' : 'In the browser · use Install app in the menu'}</span></span></div>
      <div class="cell"><span class="ico-wrap">${icon('pin')}</span><span class="grow"><b>Location</b><span>${S.location.simulated ? 'Simulated (Tulsa) for the demo' : 'Device GPS'}</span></span></div>
      <button class="cell" id="signout"><span class="ico-wrap" style="color:var(--danger)">${icon('logout')}</span><span class="grow"><b style="color:var(--danger)">Remove ID from this phone</b><span>Your private key is deleted from this device.</span></span></button>
    </div>
    <p class="tiny muted">CO-SYNE Driver · ${esc(S.config.pilot)} · credential ${esc(S.identity.credential.id)}</p>`;
  $('#notif').onclick = pushSheet;
  cacheStickerQr();
  $('#signout').onclick = () => {
    if (!confirm('Remove your CO-SYNE ID from this phone?')) return;
    disablePush(S.session.api).finally(() => {
      try { localStorage.removeItem(qrKey()); } catch { /* ignore */ }
      clearIdentity('driver'); S.session?.close(); location.reload();
    });
  };
}

// The driver's own sticker QR is kept on the phone so it shows offline.
const qrKey = () => `cosyne:driver:qr:${S.identity.stickerId}`;
function stickerQrSrc() {
  let svg = null;
  try { svg = localStorage.getItem(qrKey()); } catch { /* ignore */ }
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : url(`/api/stickers/${encodeURIComponent(S.identity.stickerId)}/qr.svg`);
}
async function cacheStickerQr() {
  try {
    if (localStorage.getItem(qrKey()) || S.offline) return;
    const res = await fetch(url(`/api/stickers/${encodeURIComponent(S.identity.stickerId)}/qr.svg`));
    if (res.ok) localStorage.setItem(qrKey(), await res.text());
  } catch { /* offline or storage blocked */ }
}

function showId() {
  const s = subject(); const v = vehicle();
  sheet(`${walletCard()}
    <div class="group"><dl class="kv" style="padding:14px">
      <dt>License</dt><dd>${esc(s.licenseNumber)} · class ${esc(s.licenseClass)}</dd><dt>Status</dt><dd>${esc(s.licenseStatus)}</dd><dt>Restrictions</dt><dd>${esc(s.restrictions ?? 'None')}</dd>
      <dt>Address</dt><dd>${esc(s.address ?? '—')}</dd><dt>Vehicle</dt><dd>${esc(vehicleLine(v))}</dd><dt>Plate</dt><dd>${esc(fmtPlate(v.plate))} ${esc(v.state ?? '')}</dd><dt>VIN</dt><dd class="mono">${esc(v.vin ?? '—')}</dd>
      <dt>Issuer</dt><dd>${esc(S.identity.credential.issuerName)}</dd><dt>Expires</dt><dd>${esc(S.identity.credential.expiresAt.slice(0, 10))}</dd></dl></div>
    <p class="tiny muted">Your ID is a credential signed by ${esc(S.identity.credential.issuerName)} and bound to a key that never leaves this phone. Officers only see it when they scan your sticker or you share it.</p>`);
}

async function verifyNearby() {
  try {
    const { units } = await S.session.api('POST', '/api/officers/nearby', { ...S.location, km: 5 });
    sheet(`<h2>Patrol units near you</h2><p class="muted small">From Tulsa 911's live unit positions.</p>
      <div class="group">${units.length ? units.map((u) => `<div class="cell"><span class="ico-wrap">${icon('car')}</span><span class="grow"><b>${esc(u.callsign)}</b><span>${esc(u.agency ?? '')} · ${u.km} km away</span></span><span class="pill ok">On network</span></div>`).join('') : '<div class="cell">No CO-SYNE units within 5 km. If you are being stopped by an unmarked car, slow down, turn on hazards, and drive to a well-lit public place. Call 911 to confirm.</div>'}</div>`);
  } catch (e) { toast(e.message); }
}

// ---------- the stop ----------
function officerBlock(stop) {
  const o = stop.officer ?? {};
  const check = S.officerChecks.get(stop.id);
  return `<div class="officer-card"><div class="who"><div class="badge-mark">${esc(initials(o.name))}</div><div><b>${esc(o.name ?? 'Officer')}</b><div class="meta">Badge #${esc(o.badge ?? '—')} · ${esc(o.rank ?? '')}</div><div class="meta">${esc(o.agency ?? '')}${o.division ? ` · ${esc(o.division)}` : ''}</div><div class="meta">Unit ${esc(o.unit ?? '—')}</div></div></div>
    <div class="verify-row ${check?.ok === false ? 'bad' : ''}">${icon(check?.ok === false ? 'shieldAlert' : 'shieldCheck')} ${check?.ok === false ? `Not verified: ${esc(check.reason)}` : `Verified on this phone · signed by ${esc(check?.issuer ?? o.agency)}`}</div></div>`;
}

function showPullover(stop, { refresh } = {}) {
  S.view = 'pullover'; S.viewStop = stop.id;
  keepAwake('stop', true);
  const callState = stop.call?.status;
  const html = `<div class="overlay pullover ${callState && callState !== 'ringing' ? 'calm' : ''}">
    <div class="po-kicker">${icon('siren')} CO-SYNE traffic stop</div>
    <div class="po-title">You're being pulled over</div>
    ${officerBlock(stop)}
    <div class="po-reason"><span>Reason for the stop</span><b>${esc(stop.reason ?? 'Not stated yet')}</b></div>
    <ul class="po-steps">
      <li><span class="n">1</span>Pull over to the right as soon as it's safe and turn on your hazard lights.</li>
      <li><span class="n">2</span>Stay in your vehicle. The officer will talk with you by video from the patrol car.</li>
      <li><span class="n">3</span>Keep your hands visible if the officer walks up.</li>
    </ul>
    ${!callState || callState === 'ringing' ? `<div class="ring"><div class="ring-title">${icon('video')} ${esc((stop.officer?.name ?? 'The officer').replace(/^Officer\s+/, 'Officer '))} is requesting a video call</div>
      <div class="ring-actions"><button class="round-btn accept" id="po-accept">${icon('phone')} Accept</button><button class="round-btn text" id="po-text">${icon('chat')} Text only</button></div></div>`
    : `<button class="btn primary block pill-btn" id="po-open">${icon('chevronRight')} Continue</button>`}
    <button class="link-danger" id="po-wrong">Something feels wrong</button>
  </div>`;
  setOverlay(html);
  if (!refresh && (!callState || callState === 'ringing')) startRinging();
  $('#po-accept')?.addEventListener('click', () => answer(stop.id, 'accepted'));
  $('#po-text')?.addEventListener('click', () => answer(stop.id, 'declined'));
  $('#po-open')?.addEventListener('click', () => showStop(stop.id));
  $('#po-wrong').onclick = () => reportStop(stop.id);
}

let ringTimer = null;
function startRinging() {
  stopRinging();
  const ring = () => { tone('alert'); vibrate('pullover'); };
  ring();
  ringTimer = setInterval(ring, 2600);
  setTimeout(stopRinging, 45_000);
}
function stopRinging() { clearInterval(ringTimer); ringTimer = null; }

async function proveIdentity(stop) {
  if (stop.proofs?.driver) return;
  const signature = await signText(S.identity.privateJwk, stopChallengeMessage(stop.id, stop.nonce, 'driver'));
  S.stops.set(stop.id, await S.session.api('POST', `/api/stops/${stop.id}/prove`, { signature }));
}

async function answer(stopId, decision) {
  stopRinging();
  const stop = S.stops.get(stopId);
  try {
    await proveIdentity(stop);
    S.stops.set(stopId, await S.session.api('POST', `/api/stops/${stopId}/call`, { decision }));
  } catch (e) { toast(e.message); }
  const s = S.stops.get(stopId);
  if (decision === 'accepted') openCall({ room: `stop:${stopId}`, stopId, title: s.officer?.name ?? 'Officer', sub: s.officer?.agency ?? '' });
  else { showStop(stopId); openChatOnly(stopId); }
}

function timelineFor(stop) {
  const steps = [
    ['Officer verified on your phone', Boolean(stop.officer) && S.officerChecks.get(stop.id)?.ok !== false],
    ['You confirmed your ID', Boolean(stop.proofs?.driver)],
    [stop.call?.status === 'declined' ? 'Text session open' : 'Video session', stop.call?.status === 'accepted' || stop.call?.status === 'declined'],
    ['Officer decision', (stop.citations ?? []).length > 0 || stop.status === 'ended'],
    ['Stop closed', stop.status === 'ended'],
  ];
  const firstOpen = steps.findIndex(([, done]) => !done);
  return `<ul class="timeline">${steps.map(([label, done], i) => `<li class="${done ? 'done' : i === firstOpen ? 'now' : ''}"><span class="tdot"></span><span>${label}</span></li>`).join('')}</ul>`;
}

function showStop(stopId) {
  const stop = S.stops.get(stopId);
  if (!stop) return;
  S.view = 'stop'; S.viewStop = stopId;
  const live = !['ended', 'failed'].includes(stop.status);
  keepAwake('stop', live);
  const cits = (stop.citations ?? []).map((c) => S.citations.get(c.id) ?? c);
  setOverlay(`<div class="overlay" style="background:var(--bg)"><div class="view" style="padding-top:58px">
    <div class="spread" style="margin-bottom:10px"><button class="btn sm ghost" id="stop-back">${icon('chevronLeft')} Back</button>${live ? '<span class="pill warn"><span class="live"></span> Live stop</span>' : '<span class="pill">Ended</span>'}</div>
    <h1 class="page-title" style="font-size:1.6rem">Traffic stop</h1>
    <div style="background:#0f1012;border-radius:18px;padding:2px;margin-bottom:14px">${officerBlock(stop)}</div>
    <div class="tile-card"><div class="small muted">Reason</div><b>${esc(stop.reason ?? '—')}</b>${timelineFor(stop)}</div>
    ${live ? `<div class="row" style="margin-bottom:14px"><button class="btn primary grow pill-btn" id="stop-video">${icon('video')} ${S.callStopId === stopId ? 'Return to call' : 'Video call'}</button><button class="btn grow pill-btn" id="stop-text">${icon('chat')} Text</button></div>` : ''}
    ${cits.length ? `<div class="group-title">From the officer</div>${cits.map(citationCard).join('')}` : ''}
    ${live ? '<button class="link-danger" id="stop-wrong" style="color:var(--danger)">Something feels wrong</button>' : ''}
  </div></div>`);
  $('#stop-back').onclick = closeOverlay;
  $('#stop-video')?.addEventListener('click', async () => {
    if (S.callStopId === stopId) { showCallScreen(); return; }
    await answer(stopId, 'accepted');
  });
  $('#stop-text')?.addEventListener('click', () => openChatOnly(stopId));
  $('#stop-wrong')?.addEventListener('click', () => reportStop(stopId));
  overlayRoot.querySelectorAll('[data-cit]').forEach((b) => { b.onclick = async () => { await citationAction(b.dataset.cit, b.dataset.act); if (b.dataset.act !== 'view' && b.dataset.act !== 'pay') showStop(stopId); }; });
}

async function reportStop(stopId) {
  if (!confirm('Alert Tulsa 911 that something is wrong with this stop? A dispatcher will see your location and can join by video.')) return;
  try {
    const a = await S.session.api('POST', `/api/stops/${stopId}/report`, { location: S.location });
    S.alerts.set(a.id, a);
    toast('Dispatch alerted. Stay in your locked vehicle if you feel unsafe.');
  } catch (e) { toast(e.message); }
}

function showDanger(stop) {
  stopRinging();
  S.view = 'danger'; S.viewStop = stop.id;
  tone('warn');
  vibrate('danger');
  const check = S.officerChecks.get(stop.id);
  setOverlay(`<div class="overlay danger-screen">
    <div class="po-kicker" style="color:#ffadb0">${icon('shieldAlert')} Warning</div>
    <h1>This officer could not be verified</h1>
    <p>${esc(stop.failure ?? check?.reason ?? 'The credential presented is not valid.')}</p>
    <ul class="po-steps"><li><span class="n">1</span>Keep your doors locked and your window up.</li><li><span class="n">2</span>Turn on your hazards and drive slowly to a well-lit public place.</li><li><span class="n">3</span>Call 911 and say you're being stopped by an unverified vehicle.</li></ul>
    <p class="small" style="color:#ffd2d4">Tulsa 911 has already been alerted.</p>
    <a class="round-btn accept" style="background:#e5484d;text-decoration:none;margin-top:8px" href="tel:911">${icon('phone')} Call 911</a>
    <button class="btn block" style="margin-top:12px" id="danger-close">Close</button></div>`);
  $('#danger-close').onclick = closeOverlay;
}

function showDone(stop) {
  stopRinging();
  keepAwake('stop', false);
  S.view = 'done'; S.viewStop = stop.id;
  const cits = (stop.citations ?? []);
  setOverlay(`<div class="overlay done-screen">
    <div class="big-check">${icon('check')}</div>
    <h1 style="font-size:1.6rem">Stop complete</h1>
    <p class="muted">${esc(stop.officer?.name ?? 'The officer')} closed the stop. You're free to go when it's safe.</p>
    <div class="tile-card" style="text-align:left"><dl class="kv"><dt>Reason</dt><dd>${esc(stop.reason ?? '—')}</dd><dt>Outcome</dt><dd>${esc(stop.outcome ?? '—')}</dd><dt>Duration</dt><dd>${Math.max(1, Math.round((Date.parse(stop.endedAt ?? new Date().toISOString()) - Date.parse(stop.createdAt)) / 60000))} min</dd><dt>Tickets</dt><dd>${cits.length ? cits.map((c) => esc(c.id)).join(', ') : 'None'}</dd></dl></div>
    ${cits.length ? `<button class="btn primary block pill-btn" id="done-tickets">${icon('ticket')} Review ticket</button>` : ''}
    <button class="btn block pill-btn" style="margin-top:10px" id="done-close">Done</button>
    <p class="tiny muted" style="margin-top:16px">A record of this stop is sealed in the CO-SYNE evidence ledger.</p></div>`);
  $('#done-close').onclick = closeOverlay;
  $('#done-tickets')?.addEventListener('click', openTickets);
}

// ---------- call ----------
async function openCall({ room, stopId = null, title, sub }) {
  if (S.call && S.call.room !== room) endCall();
  S.callStopId = stopId; S.callRoom = room; S.callTitle = title; S.callSub = sub;
  keepAwake('call', true);
  if (!S.call) {
    S.chat = [];
    S.callBox = Object.assign(document.createElement('div'), { className: 'call-box' });
    showCallScreen();
    S.call = new Call({
      session: S.session, room, iceServers: S.config.iceServers, container: S.callBox, label: subject().name,
      onPeers: (peers) => { S.callPeers = peers; updateCallTop(); },
      onChat: (m) => { S.chat.push(m); renderChat(); if (!$('#chat-drawer')) banner(m.from.name, m.text, () => { showCallScreen(); toggleChat(true); }); },
    });
    try { await S.call.start(); } catch (e) { toast(e.message); }
    S.callStarted = Date.now();
    updateCallTop();
  } else showCallScreen();
}

function showCallScreen() {
  S.view = 'call';
  setOverlay(`<div class="overlay callscreen">
    <div class="remote" id="call-remote"><div class="waiting" id="call-waiting">${icon('video')}<br>Connecting to ${esc(S.callTitle)}…</div></div>
    <div class="call-top"><div class="spread"><div><b>${esc(S.callTitle)}</b><div class="meta" id="call-meta"></div></div><button class="cc" style="width:40px;height:40px" id="call-min" title="Minimize">${icon('chevronLeft')}</button></div></div>
    <div class="call-controls">
      <div><button class="cc" id="cc-mic">${icon('mic')}</button><div class="cc-label">Mute</div></div>
      <div><button class="cc" id="cc-cam">${icon('video')}</button><div class="cc-label">Camera</div></div>
      <div><button class="cc" id="cc-chat">${icon('chat')}</button><div class="cc-label">Text</div></div>
      <div><button class="cc end" id="cc-end">${icon('phoneOff')}</button><div class="cc-label">Leave</div></div>
    </div></div>`);
  const remote = $('#call-remote');
  if (S.callBox) remote.append(S.callBox);
  remote.querySelectorAll('video').forEach((v) => v.play().catch(() => {}));
  $('#cc-mic').onclick = () => { const on = S.call.toggleMic(); $('#cc-mic').classList.toggle('off', !on); $('#cc-mic').innerHTML = icon(on ? 'mic' : 'micOff'); };
  $('#cc-cam').onclick = () => { const on = S.call.toggleCam(); $('#cc-cam').classList.toggle('off', !on); $('#cc-cam').innerHTML = icon(on ? 'video' : 'videoOff'); };
  $('#cc-chat').onclick = () => toggleChat();
  $('#cc-end').onclick = () => { const id = S.callStopId; endCall(); if (id) showStop(id); else closeOverlay(); };
  $('#call-min').onclick = () => { if (S.callStopId) showStop(S.callStopId); else closeOverlay(); renderMiniCall(); };
  if (S.call) { $('#cc-mic').classList.toggle('off', !S.call.micOn); $('#cc-cam').classList.toggle('off', !S.call.camOn); }
  updateCallTop();
}

function updateCallTop() {
  const meta = $('#call-meta');
  const peers = S.callPeers ?? [];
  $('#call-waiting')?.classList.toggle('hidden', peers.length > 0);
  if (meta) meta.innerHTML = `<span class="pill ok" style="background:rgba(31,157,85,.3);color:#b9f0cd">${icon('shieldCheck')} Verified</span> ${esc(S.callSub ?? '')}${peers.some((p) => p.role === 'dispatch') ? ' · <span class="pill" style="background:rgba(255,255,255,.15);color:#fff;border:0">Dispatch on call</span>' : ''}`;
}

function toggleChat(force) {
  const open = $('#chat-drawer');
  if (open && force !== true) { open.remove(); return; }
  if (open) return;
  const el = document.createElement('div');
  el.className = 'chat-drawer'; el.id = 'chat-drawer';
  el.innerHTML = `<div class="spread"><b style="font-size:.9rem">Text with the officer</b><button class="btn sm ghost" style="color:#fff" id="chat-x">${icon('x')}</button></div><div class="chat" id="chat-log"></div>
    <form id="chat-form"><input id="chat-input" placeholder="Type a message" autocomplete="off"><button class="btn sm primary" style="background:#fff;color:#111">${icon('send')}</button></form>`;
  $('.callscreen')?.append(el);
  $('#chat-x').onclick = () => el.remove();
  $('#chat-form').onsubmit = (e) => { e.preventDefault(); const i = $('#chat-input'); S.call?.chat(i.value); i.value = ''; };
  renderChat();
}
function renderChat() {
  const log = $('#chat-log');
  if (!log) return;
  log.innerHTML = S.chat.map((m) => `<div class="msg ${m.from.id === S.session.peerId ? 'me' : ''}"><b>${esc(m.from.id === S.session.peerId ? 'You' : m.from.name)} · ${time(new Date(m.ts).toISOString())}</b>${esc(m.text)}</div>`).join('') || '<p class="tiny muted" style="color:#a7abb3">Messages are recorded as evidence.</p>';
  log.scrollTop = log.scrollHeight;
}

async function openChatOnly(stopId) {
  // Text-only session: join the call muted with the camera off.
  const s = S.stops.get(stopId);
  await openCall({ room: `stop:${stopId}`, stopId, title: s.officer?.name ?? 'Officer', sub: 'Text session' });
  if (S.call?.camOn) { S.call.toggleCam(); }
  if (S.call?.micOn) { S.call.toggleMic(); }
  showCallScreen();
  toggleChat(true);
}

function endCall() {
  S.call?.leave();
  S.call = null; S.callStopId = null; S.callPeers = []; S.callRoom = null;
  keepAwake('call', false);
  renderMiniCall();
}

function renderMiniCall() {
  $('#mini-call')?.remove();
  if (!S.call || S.view === 'call') return;
  const el = document.createElement('div');
  el.className = 'mini-call'; el.id = 'mini-call';
  el.innerHTML = `<span class="live" style="background:#1f9d55"></span> ${esc(S.callTitle)} · tap to return`;
  el.onclick = showCallScreen;
  $('#screen').append(el);
}

// ---------- overlay/sheet plumbing ----------
function setOverlay(html) { overlayRoot.innerHTML = html; renderMiniCall(); }
function closeOverlay() {
  stopRinging();
  if (S.view === 'call' && S.call) { /* keep the call running in the background */ }
  overlayRoot.innerHTML = ''; S.view = null; S.viewStop = null;
  keepAwake('stop', Boolean(activeStop()));
  render();
}
function sheet(html) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet-back'; el.id = 'sheet';
  el.innerHTML = `<div class="sheet"><div class="grabber"></div>${html}</div>`;
  el.onclick = (e) => { if (e.target === el) closeSheet(); };
  $('#screen').append(el);
}
function closeSheet() { $('#sheet')?.remove(); }

// ---------- onboarding ----------
async function renderWelcome() {
  view.innerHTML = `<div class="onboard">
    <img class="logo" src="../icons/driver-192.png" alt="">
    <h1>Safer traffic stops,<br>verified both ways.</h1>
    <p>CO-SYNE connects you to Tulsa officers and 911 with a verified digital ID.</p>
    <div class="feature">${icon('shieldCheck')}<div><b>Know who's stopping you</b><span>See the officer's verified name, badge, and the reason before anyone approaches.</span></div></div>
    <div class="feature">${icon('video')}<div><b>Stay in your car</b><span>Talk with the officer by video and text from your seat.</span></div></div>
    <div class="feature">${icon('siren')}<div><b>One-tap emergency</b><span>Your location and vehicle go straight to Tulsa 911.</span></div></div>
    <div style="margin-top:auto;padding-top:20px" class="stack">
      ${S.config?.demo ? '<button class="btn primary block pill-btn" id="w-demo">Use a pilot demo driver</button>' : ''}
      <button class="btn block pill-btn" id="w-register">Register my license</button>
    </div></div>`;
  $('#w-demo')?.addEventListener('click', pickSample);
  $('#w-register').onclick = registerForm;
}

async function pickSample() {
  const { drivers } = await api('GET', '/api/samples');
  sheet(`<h2>Choose a demo driver</h2><p class="muted small">Each has a credential signed by Service Oklahoma (demo) and a printed sticker.</p>
    <div class="group">${drivers.map((d) => { const s = d.credential.subject; return `<button class="cell" data-sample="${esc(d.key)}"><span class="avatar">${esc(initials(s.name))}</span><span class="grow"><b>${esc(s.name)}</b><span>${esc(vehicleLine(s.vehicle))} · ${esc(fmtPlate(s.vehicle.plate))}${s.registrationStatus === 'expired' ? ' · tag expired' : ''}</span></span>${icon('chevronRight')}</button>`; }).join('')}</div>`);
  $$('#sheet [data-sample]').forEach((b) => {
    b.onclick = () => {
      const d = drivers.find((x) => x.key === b.dataset.sample);
      useIdentity({ credential: d.credential, publicJwk: d.publicJwk, privateJwk: d.privateJwk, stickerId: d.stickerId });
    };
  });
}

function useIdentity(id) {
  S.identity = id;
  saveIdentity('driver', id);
  closeSheet();
  S.tab = 'home';
  connect();
}

function registerForm() {
  sheet(`<h2>Register your license</h2><p class="muted small">Pilot enrollment. In production, Service Oklahoma confirms your identity before issuing the credential.</p>
    <form id="reg">
      <label>Full name</label><input name="name" required placeholder="As on your license">
      <div class="row" style="flex-wrap:nowrap"><div class="grow"><label>Date of birth</label><input name="dob" type="date" required></div><div class="grow"><label>License number</label><input name="licenseNumber" required placeholder="A123456789"></div></div>
      <label>Address</label><input name="address" placeholder="Street, city">
      <div class="row" style="flex-wrap:nowrap"><div class="grow"><label>Plate</label><input name="plate" required placeholder="ABC-123"></div><div class="grow"><label>Year</label><input name="year" inputmode="numeric" placeholder="2022"></div></div>
      <div class="row" style="flex-wrap:nowrap"><div class="grow"><label>Make</label><input name="make" placeholder="Toyota"></div><div class="grow"><label>Model</label><input name="model" placeholder="Camry"></div><div class="grow"><label>Color</label><input name="color" placeholder="Silver"></div></div>
      <label>Accessibility notes for officers (optional)</label><input name="accessibility" placeholder="e.g. hard of hearing, autism, diabetic">
      <button class="btn primary block pill-btn" style="margin-top:14px">Create my CO-SYNE ID</button>
    </form>`);
  $('#reg').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const keys = await generateHolderKeys();
      const subject = {
        name: f.name, dob: f.dob, licenseNumber: f.licenseNumber.toUpperCase(), licenseClass: 'D', licenseStatus: 'valid', address: f.address,
        licenseExpires: new Date(Date.now() + 4 * 365 * 86400_000).toISOString().slice(0, 10), restrictions: 'None',
        vehicle: { year: Number(f.year) || null, make: f.make, model: f.model, color: f.color, plate: f.plate, state: 'OK' },
        registrationStatus: 'valid', registrationExpires: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
        insurance: 'active', insuranceCarrier: 'On file', insuranceExpires: new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10),
        accessibility: f.accessibility || undefined,
      };
      const { credential, stickerId } = await api('POST', '/api/enroll', { type: 'driver', subject, publicJwk: keys.publicJwk });
      useIdentity({ credential, ...keys, stickerId });
      toast('Your CO-SYNE ID is ready. Print your sticker from the Me tab.');
    } catch (err) { toast(err.message); }
  };
}

// Hooks for automated end-to-end tests.
window.cosyne = { S, answer, useIdentity, citationAction, pay: async (id) => { S.citations.set(id, await S.session.api('POST', `/api/citations/${id}/pay`)); render(); } };

init().catch((e) => { view.innerHTML = `<div class="tile-card">Could not reach the CO-SYNE network: ${esc(e.message)}</div>`; });
