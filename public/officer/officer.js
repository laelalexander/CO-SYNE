// CO-SYNE Officer Terminal: the patrol vehicle's console.
import { canonicalize, stopChallengeMessage } from '../canonical.js';
import { api, bootstrap, openSession, url } from '../lib/session.js';
import { generateHolderKeys, loadIdentity, saveIdentity, clearIdentity, signText } from '../lib/keys.js';
import { Call } from '../lib/call.js';
import { icon } from '../lib/icons.js';
import { openDemoBadge, redeemDemoPass } from '../lib/demo.js';
import '../lib/reveal.js';
import { scanStickerImage, startCameraScan, stickerIdFromText } from '../lib/scanner.js';
import {
  $, $$, esc, initials, money, time, timeSec, dateTime, ago, coords, vehicleLine, STOP_STATUS, UNIT_STATUS, UNIT_TONE, PRIORITY_TONE, ALERT_LABEL,
  citationDocument, reportDocument, showDocument, showModal, hideModal, toast, tone,
} from '../lib/ui.js';
import { WindowManager } from './wm.js';

const S = {
  config: null, trust: [], catalog: { violations: [], reasons: [] }, samples: null,
  identity: loadIdentity('officer'), session: null,
  stops: new Map(), alerts: new Map(), units: [], ops: [], activeStopId: null,
  call: null, callStopId: null, callBox: null, chat: new Map(), loc: null, lastQuery: null,
  pendingScan: new URL(location.href).searchParams.get('scan'),
};
const DIVISION_START = {
  'Riverside Division': { lat: 36.0905, lng: -95.9645 }, 'Gilcrease Division': { lat: 36.1885, lng: -95.9905 },
  'Mingo Valley Division': { lat: 36.1265, lng: -95.8655 }, 'North Patrol': { lat: 36.3480, lng: -95.9830 },
};
const fmtPlate = (p = '') => (/^[A-Z]{3}\d{3}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p);
const yn = (ok) => `<span class="mark ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</span>`;
const myUnit = () => S.units.find((u) => u.id === S.session?.unitId) ?? null;
const officer = () => S.identity?.credential?.subject ?? {};

// ---------- theme ----------
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('cosyne:officer:theme:v2', t); } catch { /* ignore */ }
}
applyTheme((() => { try { return localStorage.getItem('cosyne:officer:theme:v2') || 'day'; } catch { return 'day'; } })());

// ---------- notifications ----------
let notifyHost = null;
function notify(title, text, { kind = '', onClick, sound = 'chime' } = {}) {
  notifyHost ??= Object.assign(document.createElement('div'), { className: 'notify' });
  if (!notifyHost.isConnected) document.body.append(notifyHost);
  const el = document.createElement('div');
  el.className = `n ${kind}`;
  el.innerHTML = `<b>${esc(title)}</b><span>${esc(text)}</span>`;
  el.onclick = () => { el.remove(); onClick?.(); };
  notifyHost.append(el);
  setTimeout(() => el.remove(), 7000);
  if (sound) tone(sound);
}

// ================= lock screen =================
function lockClock() {
  const now = new Date();
  const c = $('#lock-clock'); if (c) c.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const d = $('#lock-date'); if (d) d.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
setInterval(lockClock, 5000);

function renderLock(message = '') {
  $('#desktop').classList.add('hidden');
  const lock = $('#lock');
  lock.classList.remove('hidden');
  const o = officer();
  lock.innerHTML = `<div class="lock-card">
    <div class="lock-brand"><img src="../icons/officer.svg" width="26" height="26" alt=""> CO-SYNE Mobile Data Terminal</div>
    <div class="lock-clock" id="lock-clock"></div><div class="lock-date" id="lock-date"></div>
    <div class="lock-panel">
      ${S.identity ? `<div class="who"><div class="avatar">${esc(initials(o.name))}</div><div><b style="font-size:1.05rem">${esc(o.name)}</b><div class="muted small">Badge ${esc(o.badge)} · ${esc(o.unit)}</div><div class="muted small">${esc(S.identity.credential.issuerName)}${o.division ? ` · ${esc(o.division)}` : ''}</div></div></div>
        <button class="btn brand block lg" id="unlock">${icon('lock')} Sign in with device key</button>
        <div class="row" style="justify-content:space-between;margin-top:12px"><button class="btn ghost sm" id="switch">Switch officer</button><span class="tiny faint">${esc(S.config?.pilot ?? '')}</span></div>`
      : `<h3>Sign in to the terminal</h3><p class="muted small">Officer credentials are issued by the agency and bound to this terminal's key.</p>
        ${S.config?.demo ? '<h4 style="margin-top:14px">Pilot officers</h4><div class="officer-pick" id="pick"></div>' : ''}
        <details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Enroll a new officer</summary>
          <form id="enroll">
            <label>Name</label><input name="name" required placeholder="Officer First Last">
            <div class="row" style="flex-wrap:nowrap"><div class="grow"><label>Badge</label><input name="badge" required></div><div class="grow"><label>Unit</label><input name="unit" required placeholder="Riverside 214"></div></div>
            <label>Agency</label><select name="agencyId"><option value="tulsa-pd">Tulsa Police Department</option><option value="tcso">Tulsa County Sheriff's Office</option></select>
            <label>Division</label><select name="division"><option>Riverside Division</option><option>Gilcrease Division</option><option>Mingo Valley Division</option><option>North Patrol</option></select>
            <label>Agency enrollment code</label><input name="code" required placeholder="provided by your agency" autocomplete="one-time-code" spellcheck="false">
            <button class="btn primary block" style="margin-top:12px">Enroll this terminal</button>
          </form></details>`}
      <div class="boot-line" id="boot">${esc(message)}</div>
    </div></div>`;
  lockClock();
  $('#unlock')?.addEventListener('click', signIn);
  $('#switch')?.addEventListener('click', () => { clearIdentity('officer'); S.identity = null; renderLock(); });
  if ($('#pick')) loadOfficerPicker();
  $('#enroll')?.addEventListener('submit', enroll);
  $('#unlock')?.focus();
}

async function loadOfficerPicker() {
  try {
    S.samples ??= await api('GET', '/api/samples');
    $('#pick').innerHTML = S.samples.officers.map((x) => { const s = x.credential.subject; return `<button data-k="${esc(x.key)}"><span class="avatar">${esc(initials(s.name))}</span><span class="grow"><b>${esc(s.name)}</b><br><span class="small muted">Badge ${esc(s.badge)} · ${esc(s.unit)} · ${esc(x.credential.issuerName)}</span></span>${icon('chevronRight')}</button>`; }).join('');
    $$('#pick [data-k]').forEach((b) => {
      b.onclick = () => {
        const x = S.samples.officers.find((o) => o.key === b.dataset.k);
        S.identity = { credential: x.credential, publicJwk: x.publicJwk, privateJwk: x.privateJwk };
        saveIdentity('officer', S.identity);
        signIn();
      };
    });
  } catch { $('#pick').innerHTML = '<p class="small muted">Demo officers unavailable.</p>'; }
}

async function enroll(e) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const keys = await generateHolderKeys();
    const { credential } = await api('POST', '/api/enroll', { type: 'officer', subject: { name: f.name, badge: f.badge, unit: f.unit, rank: 'Patrol Officer', division: f.division, agencyId: f.agencyId }, publicJwk: keys.publicJwk, enrollCode: f.code });
    S.identity = { credential, ...keys };
    saveIdentity('officer', S.identity);
    signIn();
  } catch (err) { $('#boot').textContent = err.message; }
}

function signIn() {
  const boot = $('#boot');
  if (boot) boot.textContent = 'Signing challenge with device key…';
  S.loc = { ...(DIVISION_START[officer().division] ?? S.config.region.center) };
  S.session?.close();
  S.session = openSession('officer', S.identity, { location: () => S.loc });
  S.session.on(onMessage);
}

// ================= desktop =================
let wm;
const APPS = {
  stop: { title: 'Stop Console', short: 'Stop', icon: 'shieldCheck', pinned: true, w: 1320, h: 800, pad: false, maximized: true, mount: mountStop, render: renderStop, beforeClose: () => !(activeStop() && !confirm('Close the console? The stop stays open and you can reopen it.')), unmount: () => {} },
  scanner: { title: 'Sticker Scanner', short: 'Scan', icon: 'scan', pinned: true, w: 1000, h: 580, pad: false, mount: mountScanner, unmount: stopCamera, reopen: (b, a) => { if (a?.found) onStickerFound(a.found, 'link'); } },
  map: { title: 'Map', icon: 'map', pinned: true, w: 920, h: 620, pad: false, mount: mountMap, render: renderMap, unmount: () => { S.map?.remove(); S.map = null; }, onResize: () => setTimeout(() => S.map?.invalidateSize(), 50) },
  records: { title: 'Records Lookup', short: 'Records', icon: 'search', pinned: true, w: 940, h: 660, pad: false, mount: mountRecords },
  cad: { title: 'Calls for Service', short: 'CAD', icon: 'radio', pinned: true, w: 760, h: 560, mount: renderCad, render: renderCad },
  messages: { title: 'Messages · Ops channel', short: 'Messages', icon: 'message', pinned: true, w: 520, h: 560, pad: false, mount: mountMessages, render: renderMessages },
  citations: { title: 'eCitations', icon: 'ticket', w: 820, h: 540, mount: renderCitations },
  reports: { title: 'Incident Reports', short: 'Reports', icon: 'report', w: 820, h: 540, mount: renderReports },
  evidence: { title: 'Evidence Ledger', short: 'Evidence', icon: 'database', w: 860, h: 560, mount: renderEvidence },
  video: { title: 'Video', icon: 'video', w: 640, h: 470, pad: false, mount: mountAlertVideo, unmount: leaveAlertVideo },
  settings: { title: 'Settings', icon: 'settings', w: 640, h: 560, mount: renderSettings },
};
const DESK = ['stop', 'scanner', 'map', 'records', 'cad', 'messages', 'citations', 'reports', 'evidence', 'settings'];

function showDesktop() {
  $('#lock').classList.add('hidden');
  $('#desktop').classList.remove('hidden');
  $('#wp-agency').textContent = `${S.identity.credential.issuerName} · ${officer().unit}`;
  if (!wm) {
    wm = new WindowManager({ root: $('#windows'), taskbar: $('#tb-apps'), apps: APPS });
    wm.onBadge = renderDeskIcons;
    $('#tb-start').onclick = (e) => { e.stopPropagation(); toggleStart(); };
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('#start') && !e.target.closest('#tb-start')) $('#start').classList.add('hidden');
      if (!e.target.closest('#tray-pop') && !e.target.closest('[data-tray]')) $('#tray-pop').classList.add('hidden');
    });
  }
  renderDeskIcons();
  renderTray();
  wm.renderTaskbar();
  if (!wm.isOpen('map')) wm.open('map');
  if (S.pendingScan) { const id = S.pendingScan; S.pendingScan = null; history.replaceState(null, '', location.pathname); wm.open('scanner'); onStickerFound(id, 'link'); }
}

function renderDeskIcons() {
  $('#desk-icons').innerHTML = DESK.map((id) => `<button class="desk-icon" data-open="${id}"><span class="glyph">${icon(APPS[id].icon)}${wm?.badges.get(id) ? `<i class="badge-n">${wm.badges.get(id)}</i>` : ''}</span>${esc(APPS[id].short ?? APPS[id].title)}</button>`).join('');
  $$('#desk-icons [data-open]').forEach((b) => { b.ondblclick = () => wm.open(b.dataset.open); b.onclick = (e) => { if (e.detail === 1 && matchMedia('(pointer: coarse)').matches) wm.open(b.dataset.open); }; });
  $$('#desk-icons [data-open]').forEach((b) => b.addEventListener('keydown', (e) => { if (e.key === 'Enter') wm.open(b.dataset.open); }));
}

function toggleStart() {
  const el = $('#start');
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
  const o = officer();
  el.innerHTML = `<div class="spread"><div class="row"><div class="avatar">${esc(initials(o.name))}</div><div><b>${esc(o.name)}</b><div class="small muted">Badge ${esc(o.badge)} · ${esc(o.unit)} · ${esc(S.identity.credential.issuerName)}</div></div></div>
      <span class="pill ${S.session?.online ? 'ok' : 'warn'}"><span class="dot ${S.session?.online ? 'ok' : 'warn'}"></span>${S.session?.online ? 'On network' : 'Offline'}</span></div>
    <div class="start-grid">${Object.entries(APPS).filter(([id]) => id !== 'video').map(([id, a]) => `<button class="desk-icon" data-open="${id}"><span class="glyph">${icon(a.icon)}</span>${esc(a.short ?? a.title)}</button>`).join('')}</div>
    <div class="start-foot"><button class="btn sm" id="st-theme">${icon(document.documentElement.dataset.theme === 'day' ? 'moon' : 'sun')} ${document.documentElement.dataset.theme === 'day' ? 'Dark mode' : 'Light mode'}</button>
      <span class="row"><button class="btn sm" id="st-lock">${icon('lock')} Lock</button><button class="btn sm" id="st-out">${icon('power')} Sign out</button></span></div>`;
  el.classList.remove('hidden');
  $$('#start [data-open]').forEach((b) => { b.onclick = () => { el.classList.add('hidden'); wm.open(b.dataset.open); }; });
  $('#st-theme').onclick = () => { applyTheme(document.documentElement.dataset.theme === 'day' ? 'night' : 'day'); el.classList.add('hidden'); };
  $('#st-lock').onclick = () => { el.classList.add('hidden'); lockTerminal(); };
  $('#st-out').onclick = () => { if (confirm('Sign out and remove this officer credential from the terminal?')) { clearIdentity('officer'); location.reload(); } };
}

function lockTerminal() {
  endCall();
  S.session?.close(); S.session = null;
  for (const id of [...wm.windows.keys()]) wm.close(id);
  renderLock('Terminal locked.');
}

function renderTray() {
  const u = myUnit();
  const st = u?.status ?? 'available';
  const now = new Date();
  $('#tb-tray').innerHTML = `
    <button class="tray-btn unit-status-btn ${UNIT_TONE[st] ?? ''}" data-tray="status" title="Unit status"><span class="dot ${UNIT_TONE[st] ?? ''}"></span>${esc(officer().unit ?? 'Unit')} · ${esc(UNIT_STATUS[st] ?? st)}</button>
    <button class="tray-btn" data-tray="net" title="CO-SYNE network">${icon('wifi')}<span class="dot ${S.session?.online ? 'ok' : 'bad'}"></span></button>
    <button class="tray-btn" data-tray="gps" title="Location">${icon('gps')}<span class="small">${S.loc ? (S.locSource === 'gps' ? 'GPS' : 'SIM') : '—'}</span></button>
    <div class="tray-btn tray-clock"><div>${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><div class="muted">${now.toLocaleDateString([], { month: 'short', day: 'numeric' })}</div></div>`;
  $$('#tb-tray [data-tray]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); trayPop(b.dataset.tray); }; });
}
setInterval(() => { if (!$('#desktop').classList.contains('hidden')) renderTray(); }, 15_000);

function trayPop(kind) {
  const pop = $('#tray-pop');
  if (!pop.classList.contains('hidden') && pop.dataset.kind === kind) { pop.classList.add('hidden'); return; }
  pop.dataset.kind = kind;
  const u = myUnit();
  if (kind === 'status') {
    pop.innerHTML = `<h4 style="margin:4px 8px 8px">Unit status</h4>${['available', 'en_route', 'on_scene', 'busy', 'out_of_service'].map((s) => `<button class="opt ${u?.status === s ? 'cur' : ''}" data-st="${s}"><span class="dot ${UNIT_TONE[s]}"></span>${UNIT_STATUS[s]}</button>`).join('')}
      ${u?.status === 'on_stop' ? '<p class="small muted" style="margin:8px">On a traffic stop. Status returns to Available when you file the report.</p>' : ''}`;
    $$('#tray-pop [data-st]').forEach((b) => { b.onclick = () => setUnitStatus(b.dataset.st); });
  } else if (kind === 'net') {
    const turn = S.config.iceServers.some((s) => [].concat(s.urls).some((x) => String(x).startsWith('turn')));
    pop.innerHTML = `<h4 style="margin:4px 8px 8px">CO-SYNE network</h4><dl class="kv" style="padding:4px 8px"><dt>Status</dt><dd>${S.session?.online ? '<span class="pill ok">Connected</span>' : '<span class="pill bad">Reconnecting</span>'}</dd>
      <dt>Server</dt><dd class="mono">${esc(url('/').replace(/\/$/, ''))}</dd><dt>Unit</dt><dd>${esc(S.session?.unitId ?? '—')}</dd><dt>Video relay</dt><dd>${turn ? 'TURN relay configured' : 'Direct (STUN only)'}</dd><dt>Identity</dt><dd>Ed25519 device key</dd></dl>`;
  } else if (kind === 'gps') {
    pop.innerHTML = `<h4 style="margin:4px 8px 8px">Location</h4><p class="small muted" style="margin:0 8px 8px">${coords(S.loc)} · ${S.locSource === 'gps' ? 'device GPS' : 'simulated for the demo'}</p>
      <button class="opt" data-loc="gps">${icon('gps')} Use this device's GPS</button><button class="opt" data-loc="map">${icon('map')} Set position on the map</button>`;
    $$('#tray-pop [data-loc]').forEach((b) => {
      b.onclick = () => {
        pop.classList.add('hidden');
        if (b.dataset.loc === 'map') { wm.open('map'); toast('Click the map to move your patrol car'); S.placing = true; return; }
        navigator.geolocation?.getCurrentPosition((p) => { S.locSource = 'gps'; setLocation({ lat: p.coords.latitude, lng: p.coords.longitude }); }, () => toast('GPS is not available on this device'));
      };
    });
  }
  pop.classList.remove('hidden');
}

async function setUnitStatus(status) {
  $('#tray-pop').classList.add('hidden');
  try {
    const u = await S.session.api('POST', '/api/units/me/status', { status });
    S.units = S.units.map((x) => (x.id === u.id ? { ...x, ...u } : x));
    renderTray();
    toast(`Unit status: ${UNIT_STATUS[status]}`);
  } catch (e) { toast(e.message); }
}

function setLocation(loc) {
  S.loc = { lat: loc.lat, lng: loc.lng };
  S.session?.send({ t: 'location', ...S.loc });
  renderTray();
  refresh('map');
}

function refresh(id) { const b = wm?.body(id); if (b) APPS[id].render?.(b); }

// ================= network events =================
async function onMessage(msg) {
  if (msg.t === 'hello_ok') {
    const first = $('#desktop').classList.contains('hidden');
    if (first) {
      $('#boot') && ($('#boot').textContent = `Unit ${msg.unitId} online · connected to CO-SYNE`);
      await new Promise((r) => setTimeout(r, 350));
      showDesktop();
      notify('Connected to CO-SYNE', `${officer().unit} is online with ${S.config.region.name} dispatch.`, { sound: null });
    }
    S.session.send({ t: 'join', room: 'ops:all', media: false });
    S.session.send({ t: 'location', ...S.loc });
    renderTray();
  } else if (msg.t === 'error' && (msg.ref === 'hello' || /sign-in/.test(msg.error))) {
    S.session?.close();
    renderLock(msg.error);
  } else if (msg.t === 'disconnected') {
    renderTray();
  } else if (msg.t === 'units') {
    S.units = msg.units;
    renderTray();
    refresh('map');
  } else if (msg.t === 'unit') {
    S.units = S.units.map((x) => (x.id === msg.unit.id ? { ...x, ...msg.unit } : x));
    renderTray();
  } else if (msg.t === 'stop') {
    onStop(msg.stop);
  } else if (msg.t === 'alert') {
    const isNew = !S.alerts.has(msg.alert.id);
    S.alerts.set(msg.alert.id, msg.alert);
    if (isNew && !['resolved', 'cancelled'].includes(msg.alert.status)) {
      const a = msg.alert;
      notify(`New call · P${a.triage?.priority} ${ALERT_LABEL[a.type] ?? a.type}`, `${a.driver?.name ?? 'Caller'} · ${coords(a.location)}`, { kind: 'bad', sound: 'alert', onClick: () => wm.open('cad') });
      wm.open('cad');
    }
    refresh('cad'); refresh('map');
  } else if (msg.t === 'chat' && msg.room === 'ops:all') {
    S.ops.push(msg);
    if (msg.from.id !== S.session.peerId) { wm.badge('messages'); if (!wm.isOpen('messages')) notify(`Ops · ${msg.from.name}`, msg.text, { onClick: () => wm.open('messages') }); }
    refresh('messages');
  } else if (msg.t === 'chat_history' && msg.room === 'ops:all') {
    S.ops = msg.messages; refresh('messages');
  }
}

function onStop(stop) {
  const prev = S.stops.get(stop.id);
  S.stops.set(stop.id, stop);
  if (prev?.call?.status !== 'accepted' && stop.call?.status === 'accepted') notify('Driver accepted the video call', `${stop.driver?.name ?? 'Driver'} is on video.`, { onClick: () => wm.open('stop') });
  if (prev?.call?.status !== 'declined' && stop.call?.status === 'declined') notify('Driver chose text only', `${stop.driver?.name ?? 'Driver'} will communicate by text.`, { onClick: () => wm.open('stop') });
  if (!prev?.proofs?.driver && stop.proofs?.driver) notify('Driver confirmed identity', 'Signed on the driver\'s own phone.', { sound: null });
  for (const c of stop.citations ?? []) {
    const old = prev?.citations?.find((x) => x.id === c.id);
    if (old && !old.ack && c.ack) notify('Citation acknowledged', `${c.id} receipt signed by the driver.`, { sound: null });
    if (old && old.status !== 'paid' && c.status === 'paid') notify('Citation paid', `${c.id} · ${money(c.totalFine)} (simulated)`, { sound: null });
  }
  if (stop.status === 'ended' && prev?.status !== 'ended' && S.callStopId === stop.id) setTimeout(endCall, 1200);
  refresh('stop'); refresh('map');
}

function activeStop() {
  const s = S.activeStopId && S.stops.get(S.activeStopId);
  if (s) return s;
  return [...S.stops.values()].filter((x) => !['ended', 'failed'].includes(x.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

// ================= scanner =================
let camSession = null;
function stopCamera() { camSession?.stop(); camSession = null; }

function reasonSelect(id = 'reason', value) {
  return `<select id="${id}">${S.catalog.reasons.map((r) => `<option ${r === value ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`;
}

async function mountScanner(body) {
  body.innerHTML = `<div class="scan-wrap">
    <div class="scan-cam"><video id="scan-video" playsinline muted></video><canvas id="scan-canvas" class="hidden"></canvas><div class="scan-reticle"></div>
      <div class="scan-found hidden" id="scan-found"></div>
      <div id="scan-msg" style="position:absolute;top:12px;left:12px;right:12px;color:#e6e8eb;font-size:.85rem;text-shadow:0 1px 3px #000">Starting camera…</div></div>
    <div class="scan-side">
      <h3>Reason for the stop</h3>${reasonSelect('scan-reason')}
      <h4 style="margin:16px 0 8px">Point the camera at the vehicle's CO-SYNE sticker</h4>
      <p class="small muted">Bumper sticker or rear-window cling. The scan opens the stop, sends the driver your verified identity and the reason, and rings their phone for a video call.</p>
      ${S.samples?.drivers?.length ? `<h4 style="margin:16px 0 8px">Pilot vehicles (simulate a scan)</h4><div class="sticker-pick">${[...(S.samples.kitDrivers ?? []), ...S.samples.drivers].map((d) => { const s = d.credential.subject; return `<button data-sim="${esc(d.stickerId)}"><img src="${url(`/api/stickers/${encodeURIComponent(d.stickerId)}/qr.svg`)}" alt=""><span><b>${esc(fmtPlate(s.vehicle.plate))}</b><br>${esc(`${s.vehicle.color} ${s.vehicle.make} ${s.vehicle.model}`)}</span></button>`; }).join('')}</div>` : ''}
      <h4 style="margin:16px 0 8px">No sticker? Look up by plate</h4>
      <form id="plate-form" class="row" style="flex-wrap:nowrap"><input id="plate-in" placeholder="Plate, e.g. KJR-482" autocomplete="off"><button class="btn">${icon('search')} Lookup</button></form>
    </div></div>`;
  body.querySelectorAll('[data-sim]').forEach((b) => { b.onclick = () => simulateScan(b.dataset.sim); });
  $('#plate-form', body).onsubmit = (e) => { e.preventDefault(); wm.open('records', { q: $('#plate-in', body).value }); };
  camSession = startCameraScan($('#scan-video', body), $('#scan-canvas', body), (id) => onStickerFound(id, 'camera'));
  const ok = await camSession.ready;
  const msg = $('#scan-msg', body);
  if (msg) msg.textContent = ok ? 'Scanning… hold the sticker inside the frame.' : 'No camera on this terminal. Use a pilot vehicle on the right to simulate a scan.';
}

// Decodes the real printed QR image through the same decoder the camera uses.
async function simulateScan(stickerId) {
  const body = wm.open('scanner');
  const text = await scanStickerImage(stickerId, $('#scan-canvas', body) ?? document.createElement('canvas'));
  const id = stickerIdFromText(text);
  if (!id) { toast('Could not read that sticker'); return null; }
  return onStickerFound(id, 'image', text);
}

async function onStickerFound(stickerId, how, text) {
  stopCamera();
  const body = wm.body('scanner') ?? wm.open('scanner');
  let info = null;
  try { info = await api('GET', `/api/stickers/${encodeURIComponent(stickerId)}`); } catch { /* not registered */ }
  const box = $('#scan-found', body);
  if (!info) { if (box) { box.classList.remove('hidden'); box.style.borderColor = 'var(--danger)'; box.innerHTML = 'Sticker not registered with CO-SYNE. Run the plate instead.'; } return null; }
  if (box) {
    box.classList.remove('hidden');
    box.innerHTML = `<div class="spread"><div><b>${icon('check')} Sticker ${esc(info.code)} · plate ${esc(fmtPlate(info.plate))} ${esc(info.state ?? '')}</b><div class="small" style="color:#9aa2ad">${how === 'camera' ? 'Read by camera' : how === 'link' ? 'Opened from sticker link' : 'Decoded from the sticker image'}${text ? ` · ${esc(text)}` : ''}</div></div>
      <button class="btn brand" id="scan-go">${icon('shieldCheck')} Open stop</button></div>`;
    $('#scan-go', body).onclick = () => beginStop({ stickerId, reason: $('#scan-reason', body)?.value });
  }
  tone('chime');
  return info;
}

async function beginStop({ stickerId, plate, reason }) {
  try {
    const stop = await S.session.api('POST', '/api/stops', { stickerId, plate, reason, location: S.loc });
    S.stops.set(stop.id, stop);
    S.activeStopId = stop.id;
    const signature = await signText(S.identity.privateJwk, stopChallengeMessage(stop.id, stop.nonce, 'officer'));
    S.stops.set(stop.id, await S.session.api('POST', `/api/stops/${stop.id}/prove`, { signature }));
    if (wm.isOpen('scanner')) wm.close('scanner');
    wm.open('stop');
    startCall(stop.id); // joins the session now, so the driver connects the moment they accept
    return stop;
  } catch (e) { toast(e.message); throw e; }
}

// ================= stop console =================
function mountStop(body) { body.dataset.stop = ''; renderStop(body); }

function suggestedViolations(stop) {
  const out = new Set();
  for (const c of stop.checks ?? []) {
    if (c.label === 'Registration' && !c.ok) out.add('REG-EXP');
    if (c.label === 'Insurance' && !c.ok) out.add('INS-NONE');
  }
  const r = stop.reason ?? '';
  if (/speed/i.test(r)) out.add('SPD-15');
  if (/light|equipment/i.test(r)) out.add('EQP-LGT');
  if (/lane/i.test(r)) out.add('LANE');
  if (/failure to stop/i.test(r)) out.add('STOP');
  return out;
}

function autoNarrative(stop) {
  const d = stop.driver ?? {};
  const v = d.vehicle ?? {};
  const o = stop.officer ?? {};
  const fails = (stop.checks ?? []).filter((c) => !c.ok).map((c) => `${c.label.toLowerCase()} (${c.detail})`);
  return `On ${new Date(stop.createdAt).toLocaleString()}, I, ${o.name ?? ''} (badge ${o.badge ?? ''}, ${o.unit ?? ''}), initiated a traffic stop on a ${vehicleLine(v)}, ${v.state ?? ''} tag ${fmtPlate(stop.plate)}, at ${coords(stop.location)} for: ${stop.reason ?? 'unspecified'}. `
    + `The driver was identified by ${stop.via === 'sticker' ? 'scanning the vehicle\'s CO-SYNE sticker' : 'plate lookup'} as ${d.name ?? 'unknown'} (${d.jurisdiction ?? 'OK'} DL ${d.licenseNumber ?? '?'}), verified against a credential signed by ${d.issuer ?? 'Service Oklahoma'}${stop.proofs?.driver ? ' and confirmed on the driver\'s own phone' : ''}. `
    + `The driver received my verified identity and the reason for the stop on their phone before contact. The stop was conducted from the patrol vehicle by CO-SYNE ${stop.call?.status === 'declined' ? 'text' : 'live video'}. `
    + (fails.length ? `Records checks returned: ${fails.join('; ')}. ` : 'All records checks were clear. ')
    + (d.accessibility ? `Accommodation noted and provided: ${d.accessibility} ` : '');
}

function renderStop(body) {
  const stop = activeStop();
  if (!stop) {
    body.dataset.stop = '';
    body.innerHTML = `<div class="empty" style="padding:60px 20px">${icon('shieldCheck')}<h2 style="margin:10px 0 6px;color:var(--text)">No active stop</h2><p>Scan a vehicle's CO-SYNE sticker or run a plate to open a stop.</p>
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn brand" id="go-scan">${icon('scan')} Open scanner</button><button class="btn" id="go-rec">${icon('search')} Records lookup</button></div>
      ${recentStopsHtml()}</div>`;
    $('#go-scan', body).onclick = () => wm.open('scanner');
    $('#go-rec', body).onclick = () => wm.open('records');
    body.querySelectorAll('[data-open-report]').forEach((b) => { b.onclick = () => openReport(b.dataset.openReport); });
    wm.setSubtitle('stop', '');
    return;
  }
  if (body.dataset.stop !== stop.id) buildHud(body, stop);
  updateHud(body, stop);
}

function recentStopsHtml() {
  const done = [...S.stops.values()].filter((s) => s.status === 'ended').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  if (!done.length) return '';
  return `<div class="card" style="max-width:640px;margin:26px auto 0;text-align:left"><h4>Earlier this shift</h4><table class="table"><tr><th>Time</th><th>Plate</th><th>Driver</th><th>Outcome</th><th></th></tr>
    ${done.map((s) => `<tr><td>${time(s.createdAt)}</td><td><span class="plate">${esc(fmtPlate(s.plate))}</span></td><td>${esc(s.driver?.name ?? '—')}</td><td>${esc(s.outcome ?? '')}</td><td>${s.reportId ? `<button class="btn sm" data-open-report="${esc(s.reportId)}">${esc(s.reportId)}</button>` : ''}</td></tr>`).join('')}</table></div>`;
}

function buildHud(body, stop) {
  body.dataset.stop = stop.id;
  body.innerHTML = `<div class="hud">
    <div class="hud-head"><div class="row" style="gap:14px"><span class="plate" id="h-plate"></span><div><b id="h-veh"></b><div class="small muted" id="h-sub"></div></div></div><div class="row" id="h-status"></div></div>
    <div class="hud-grid">
      <section class="card video-panel span2"><div class="spread"><h3>Live session</h3><span id="h-call"></span></div>
        <div class="video-stage" id="h-stage"><div class="waiting" id="h-wait">Connecting…</div></div>
        <div class="spread"><div class="vctl"><button class="btn sm" id="v-mic">${icon('mic')} Mute</button><button class="btn sm" id="v-cam">${icon('video')} Camera</button><button class="btn sm" id="v-rec">${icon('record')} Record evidence</button><button class="btn sm" id="v-join">${icon('video')} Rejoin</button></div><span class="small muted" id="h-parts"></span></div>
        <div class="chat hud-chat" id="h-chat"></div>
        <form id="h-chat-form" class="row" style="flex-wrap:nowrap"><input id="h-chat-in" placeholder="Text the driver (recorded as evidence)" autocomplete="off"><button class="btn sm">${icon('send')} Send</button></form>
      </section>
      <section class="card" id="h-driver"></section>
      <section class="card" id="h-vehicle"></section>
      <section class="card" id="h-checks"></section>
      <section class="card" id="h-ticket"><header><h3>eCitation</h3><span class="seg" id="t-type"><button type="button" class="on" data-v="citation">Citation</button><button type="button" data-v="warning">Warning</button></span></header>
        <div class="violations" id="t-viol">${S.catalog.violations.map((v) => `<label class="check" data-code="${esc(v.code)}"><input type="checkbox" value="${esc(v.code)}"><span><b>${esc(v.description)}</b><br><span class="muted small">${esc(v.statute)} · ${money(v.fine)}</span></span></label>`).join('')}</div>
        <label>Notes for the driver and court</label><input id="t-notes" placeholder="e.g. Tag expired 8/31; advised to renew with Service Oklahoma">
        <div class="spread" style="margin-top:10px"><span class="small muted" id="t-total"></span><button class="btn brand" id="t-issue">${icon('ticket')} Sign &amp; issue</button></div>
        <div id="t-list"></div></section>
      <section class="card span3" id="h-report"><header><h3>Incident report</h3><span class="small muted">Auto-drafted from the stop. Edit before filing.</span></header>
        <textarea id="r-narr" rows="5"></textarea>
        <div class="spread" style="margin-top:10px"><span class="small muted" id="r-state"></span><span class="row"><button class="btn" id="r-end">End stop without report</button><button class="btn primary" id="r-file">${icon('report')} File report &amp; close stop</button></span></div></section>
    </div></div>`;
  let type = 'citation';
  $$('#t-type button', body).forEach((b) => { b.onclick = () => { type = b.dataset.v; $$('#t-type button', body).forEach((x) => x.classList.toggle('on', x === b)); updateTotal(); }; });
  const updateTotal = () => {
    const codes = $$('#t-viol input:checked', body).map((i) => i.value);
    const total = S.catalog.violations.filter((v) => codes.includes(v.code)).reduce((s, v) => s + v.fine, 0);
    $('#t-total', body).textContent = codes.length ? `${codes.length} violation${codes.length > 1 ? 's' : ''} · ${type === 'warning' ? 'no fine' : money(total)}` : 'Select violations';
  };
  $('#t-viol', body).addEventListener('change', updateTotal);
  $('#t-issue', body).onclick = () => issueTicket({ type, codes: $$('#t-viol input:checked', body).map((i) => i.value), notes: $('#t-notes', body).value }).catch((e) => toast(e.message));
  $('#r-file', body).onclick = () => fileReport($('#r-narr', body).value).catch((e) => toast(e.message));
  $('#r-end', body).onclick = () => endStopNoReport().catch((e) => toast(e.message));
  $('#r-narr', body).oninput = (e) => { e.target.dataset.touched = '1'; };
  $('#h-chat-form', body).onsubmit = (e) => { e.preventDefault(); S.call?.chat($('#h-chat-in', body).value); $('#h-chat-in', body).value = ''; };
  $('#v-mic', body).onclick = () => { if (!S.call) return; const on = S.call.toggleMic(); $('#v-mic', body).innerHTML = `${icon(on ? 'mic' : 'micOff')} ${on ? 'Mute' : 'Unmute'}`; };
  $('#v-cam', body).onclick = () => { if (!S.call) return; const on = S.call.toggleCam(); $('#v-cam', body).innerHTML = `${icon(on ? 'video' : 'videoOff')} ${on ? 'Camera' : 'Camera off'}`; };
  $('#v-rec', body).onclick = () => toggleRecording(body);
  $('#v-join', body).onclick = () => startCall(stop.id);
  updateTotal();
  if (S.callBox && S.callStopId === stop.id) $('#h-stage', body).append(S.callBox);
  renderStopChat();
}

function updateHud(body, stop) {
  const d = stop.driver;
  const v = d?.vehicle ?? {};
  wm.setSubtitle('stop', fmtPlate(stop.plate));
  $('#h-plate', body).textContent = `${fmtPlate(stop.plate)} ${v.state ?? ''}`.trim();
  $('#h-veh', body).textContent = d ? vehicleLine(v) : 'Vehicle';
  $('#h-sub', body).innerHTML = `Reason: <b>${esc(stop.reason ?? '—')}</b> · ${stop.via === 'sticker' ? 'opened by sticker scan' : 'plate lookup'} · ${time(stop.createdAt)} · ${coords(stop.location)}`;
  const st = stop.status;
  $('#h-status', body).innerHTML = `<span class="pill ${st === 'verified' ? 'ok' : st === 'failed' ? 'bad' : st === 'ended' ? '' : 'warn'}">${esc(STOP_STATUS[st])}</span>${st !== 'ended' ? '<span class="pill bad"><span class="live"></span> Live</span>' : ''}`;
  const call = stop.call?.status;
  $('#h-call', body).innerHTML = call ? `<span class="pill ${call === 'accepted' ? 'ok' : call === 'declined' ? 'info' : 'warn'}">${call === 'ringing' ? 'Ringing driver…' : call === 'accepted' ? 'Driver on video' : 'Driver chose text only'}</span>` : '';
  $('#h-parts', body).textContent = stop.participants?.length ? `Connected: ${stop.participants.map((p) => `${p.name} (${p.role})`).join(', ')}` : '';
  const waiting = $('#h-wait', body);
  const remote = S.call ? S.call.peers.size : 0;
  if (waiting) {
    waiting.classList.toggle('hidden', remote > 0);
    waiting.innerHTML = st === 'ended' ? 'Stop closed.' : call === 'declined' ? `${icon('chat')}<br>Driver chose text only. Use the text box below.` : call === 'accepted' ? 'Driver accepted. Connecting video…' : `${icon('phone')}<br>Calling ${esc(d?.name ?? 'the driver')}… their phone is showing your verified ID and the reason for the stop.`;
  }
  $('#v-join', body).classList.toggle('hidden', Boolean(S.call && S.callStopId === stop.id) || st === 'ended');

  $('#h-driver', body).innerHTML = d ? `<header><h3>Driver</h3><span class="pill ok">${icon('shieldCheck')} ${d.jurisdiction ? `${esc(d.jurisdiction)} · ` : ''}${esc(d.issuer ?? 'Service Oklahoma')} verified${d.realId ? ' · REAL ID' : ''}</span></header>
      <div class="person"><div class="avatar">${esc(initials(d.name))}</div><div><b style="font-size:1.05rem">${esc(d.name)}</b><div class="small muted">DOB ${esc(d.dob ?? '—')} · ${esc(d.address ?? '')}</div></div></div>
      <dl class="kv"><dt>OK DL</dt><dd class="mono">${esc(d.licenseNumber)} · class ${esc(d.licenseClass ?? '—')}</dd><dt>Status</dt><dd>${esc(d.licenseStatus)} · exp ${esc(d.licenseExpires ?? '—')}</dd>
      <dt>Restrictions</dt><dd>${esc(d.restrictions ?? 'None')}</dd><dt>Device</dt><dd>${stop.proofs.driver ? '<span class="pill ok">Confirmed on driver\'s phone</span>' : '<span class="pill warn">Awaiting driver</span>'}</dd></dl>
      ${d.accessibility ? `<div class="notice warn" style="margin-top:10px"><b>Accommodation:</b> ${esc(d.accessibility)}</div>` : ''}`
    : '<h3>Driver</h3><p class="muted">Waiting for the driver to share their verified ID.</p>';
  $('#h-vehicle', body).innerHTML = d ? `<h3 style="margin-bottom:10px">Vehicle</h3><dl class="kv"><dt>Vehicle</dt><dd>${esc(vehicleLine(v))}</dd><dt>Tag</dt><dd><span class="plate">${esc(fmtPlate(v.plate ?? stop.plate))}</span> ${esc(v.state ?? '')}</dd><dt>VIN</dt><dd class="mono">${esc(v.vin ?? '—')}</dd>
      <dt>Registration</dt><dd>${d.registrationStatus === 'valid' ? esc(`valid · exp ${d.registrationExpires}`) : `<span style="color:var(--danger)">${esc(d.registrationStatus)} · exp ${esc(d.registrationExpires)}</span>`}</dd>
      <dt>Insurance</dt><dd>${esc(d.insurance)} · ${esc(d.insuranceCarrier ?? '')} ${esc(d.insurancePolicy ?? '')}</dd></dl>` : '<h3>Vehicle</h3><p class="muted">—</p>';
  $('#h-checks', body).innerHTML = `<header><h3>Records checks</h3><span class="pill">Simulated</span></header>${stop.checks?.length ? `<ul class="checks">${stop.checks.map((c) => `<li>${yn(c.ok)}<div><b>${esc(c.label)}</b><div class="small muted">${esc(c.detail)}</div></div></li>`).join('')}</ul><p class="tiny faint" style="margin-top:10px">Stand-in for OLETS/NCIC, Service Oklahoma, and insurance verification. Query logged.</p>` : '<p class="muted small">Available once the driver is identified.</p>'}`;

  if (d && !body.dataset.prefilled) {
    body.dataset.prefilled = '1';
    const sug = suggestedViolations(stop);
    $$('#t-viol label', body).forEach((l) => { const on = sug.has(l.dataset.code); l.classList.toggle('suggested', on); l.querySelector('input').checked = on; });
    $('#t-viol', body).dispatchEvent(new Event('change'));
  }
  const narr = $('#r-narr', body);
  if (d && !narr.dataset.touched) narr.value = autoNarrative(stop);
  $('#t-list', body).innerHTML = (stop.citations ?? []).map((c) => `<div class="cit-row"><div><b>${esc(c.id)}</b> · ${esc(c.type)} · ${c.type === 'citation' ? money(c.totalFine) : 'no fine'}<div class="small muted">${esc(c.violations.map((x) => x.code).join(', '))}</div></div>
      <div class="row" style="justify-content:flex-end">${c.ack ? '<span class="pill ok">Acknowledged</span>' : '<span class="pill warn">Delivered</span>'}${c.status === 'paid' ? '<span class="pill ok">Paid</span>' : c.status === 'contested' ? '<span class="pill info">Court date</span>' : ''}<button class="btn sm" data-cit="${esc(c.id)}">${icon('printer')}</button></div></div>`).join('');
  $$('#t-list [data-cit]', body).forEach((b) => { b.onclick = () => { const c = stop.citations.find((x) => x.id === b.dataset.cit); showDocument(citationDocument(c), c.id); }; });
  const closed = Boolean(stop.reportId) || st === 'ended';
  $('#t-issue', body).disabled = !d || closed;
  $('#r-file', body).disabled = Boolean(stop.reportId) || !d;
  $('#r-end', body).classList.toggle('hidden', closed);
  $('#r-state', body).innerHTML = stop.reportId ? `Report <b>${esc(stop.reportId)}</b> filed and sealed in the evidence ledger. <button class="btn sm" id="r-view">View / print</button> <button class="btn sm" id="r-new">${icon('scan')} New stop</button>` : st === 'ended' ? 'Stop ended.' : '';
  $('#r-view', body)?.addEventListener('click', () => openReport(stop.reportId));
  $('#r-new', body)?.addEventListener('click', () => { S.activeStopId = null; body.dataset.stop = ''; body.dataset.prefilled = ''; wm.open('scanner'); renderStop(body); });
}

async function issueTicket({ type, codes, notes }) {
  const stop = activeStop();
  if (!stop) throw new Error('No active stop');
  if (!codes.length) throw new Error('Select at least one violation');
  const issuedAt = new Date().toISOString();
  const payload = canonicalize({ v: 'CO-SYNE/citation/v1', stopId: stop.id, type, violationCodes: [...codes].sort(), notes: notes ?? '', issuedAt });
  const signature = await signText(S.identity.privateJwk, payload);
  const c = await S.session.api('POST', `/api/stops/${stop.id}/citations`, { type, violationCodes: codes, notes, issuedAt, signature });
  notify(`${type === 'warning' ? 'Warning' : 'Citation'} ${c.id} issued`, 'Signed with this terminal\'s key and delivered to the driver\'s phone.', { sound: null });
  return c;
}

async function fileReport(narrative) {
  const stop = activeStop();
  if (!stop) throw new Error('No active stop');
  const r = await S.session.api('POST', `/api/stops/${stop.id}/file-report`, { narrative: narrative || autoNarrative(stop) });
  S.activeStopId = stop.id;
  notify(`Report ${r.id} filed`, 'Hash-sealed in the evidence ledger. The stop is closed and your unit is available.', { sound: null });
  return r;
}

async function endStopNoReport() {
  const stop = activeStop();
  if (!stop || !confirm('End the stop without filing a report?')) return;
  S.stops.set(stop.id, await S.session.api('POST', `/api/stops/${stop.id}/end`, { outcome: 'no_action' }));
  S.activeStopId = stop.id;
  refresh('stop');
}

async function openReport(id) {
  try { const r = await S.session.api('GET', `/api/reports/${id}`); showDocument(reportDocument(r), r.id); } catch (e) { toast(e.message); }
}

// ---- live session ----
async function startCall(stopId) {
  if (S.call && S.callStopId === stopId) return;
  endCall();
  S.callStopId = stopId;
  S.callBox = Object.assign(document.createElement('div'), { className: 'call-box', style: 'display:contents' });
  const stage = $('#h-stage', wm.body('stop') ?? document);
  stage?.append(S.callBox);
  S.chat.set(stopId, []);
  S.call = new Call({
    session: S.session, room: `stop:${stopId}`, iceServers: S.config.iceServers, container: S.callBox, label: officer().name,
    onPeers: () => refresh('stop'),
    onChat: (m) => { S.chat.get(stopId)?.push(m); renderStopChat(); if (m.from.id !== S.session.peerId && !wm.isOpen('stop')) notify(m.from.name, m.text, { onClick: () => wm.open('stop') }); },
  });
  try { await S.call.start(); } catch (e) { toast(`Video: ${e.message}`); }
  refresh('stop');
}

function endCall() {
  S.call?.leave();
  S.call = null; S.callStopId = null; S.callBox = null;
  refresh('stop');
}

function renderStopChat() {
  const log = $('#h-chat', wm?.body('stop') ?? document);
  if (!log) return;
  const msgs = S.chat.get(S.callStopId) ?? [];
  log.innerHTML = msgs.map((m) => `<div class="msg ${m.from.id === S.session.peerId ? 'me' : ''}"><b>${esc(m.from.id === S.session.peerId ? 'You' : m.from.name)} · ${timeSec(new Date(m.ts).toISOString())}</b>${esc(m.text)}</div>`).join('') || '<div class="tiny faint">Text messages with the driver appear here and are recorded in the evidence ledger.</div>';
  log.scrollTop = log.scrollHeight;
}

async function toggleRecording(body) {
  if (!S.call) { toast('Join the session first'); return; }
  const b = $('#v-rec', body);
  if (!S.call.recording) {
    S.call.startRecording();
    b.classList.add('on-air'); b.innerHTML = `${icon('record')} Stop recording`;
    return;
  }
  b.disabled = true;
  try {
    const r = await S.call.stopRecording();
    notify('Recording anchored', `SHA-256 ${r.sha256.slice(0, 16)}… in ledger entry #${r.entry.seq}. The file stays on this terminal.`, { sound: null });
    const a = Object.assign(document.createElement('a'), { href: r.url, download: `stop-${S.callStopId}-${Date.now()}.webm` });
    a.click();
  } catch (e) { toast(e.message); }
  b.disabled = false; b.classList.remove('on-air'); b.innerHTML = `${icon('record')} Record evidence`;
}

// ================= map =================
function mountMap(body) {
  body.innerHTML = `<div class="map" id="o-map"></div>
    <div class="map-tools"><button class="btn sm" id="m-me">${icon('gps')} My unit</button><button class="btn sm" id="m-move">${icon('pin')} Move car</button></div>
    <div class="map-legend"><span><span class="dot" style="background:var(--brand-2)"></span> You</span><span><span class="dot ok"></span> Available</span><span><span class="dot warn"></span> Assigned / en route</span><span><span class="dot bad"></span> On scene / stop</span><span><span class="live"></span> Active call or stop</span></div>`;
  const r = S.config.region;
  S.map = L.map($('#o-map', body), { zoomControl: true, attributionControl: true }).setView([S.loc?.lat ?? r.center.lat, S.loc?.lng ?? r.center.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(S.map);
  S.mapLayer = L.layerGroup().addTo(S.map);
  S.map.on('click', (e) => { if (S.placing) { S.placing = false; S.locSource = 'sim'; setLocation({ lat: e.latlng.lat, lng: e.latlng.lng }); toast(`Patrol car moved to ${coords(S.loc)}`); } });
  $('#m-me', body).onclick = () => S.loc && S.map.setView([S.loc.lat, S.loc.lng], 15);
  $('#m-move', body).onclick = () => { S.placing = true; toast('Click the map to move your patrol car'); };
  new ResizeObserver(() => S.map?.invalidateSize()).observe(body);
  renderMap(body);
}

const unitColor = (s) => ({ available: '#3fb950', assigned: '#f0883e', en_route: '#f0883e', on_scene: '#f85149', on_stop: '#f85149', busy: '#79b8ff', out_of_service: '#6b7380' }[s] ?? '#9aa2ad');
function renderMap() {
  if (!S.map) return;
  S.mapLayer.clearLayers();
  for (const u of S.units) {
    if (!u.location || u.id === S.session?.unitId) continue;
    const html = `<span class="unit-marker" style="background:${unitColor(u.status)}">${esc(u.callsign)}</span>`;
    L.marker([u.location.lat, u.location.lng], { icon: L.divIcon({ className: '', html, iconSize: [0, 0] }) }).bindPopup(`<b>${esc(u.callsign)}</b><br>${esc(u.agency ?? u.type)}<br>${esc(UNIT_STATUS[u.status] ?? u.status)}`).addTo(S.mapLayer);
  }
  for (const a of S.alerts.values()) {
    if (['resolved', 'cancelled'].includes(a.status)) continue;
    L.marker([a.location.lat, a.location.lng], { icon: L.divIcon({ className: '', html: '<div class="pulse-marker"></div>', iconSize: [18, 18] }) }).bindPopup(`<b>P${a.triage?.priority} ${esc(ALERT_LABEL[a.type] ?? a.type)}</b><br>${esc(a.driver?.name ?? '')}`).addTo(S.mapLayer);
  }
  for (const s of S.stops.values()) {
    if (s.status === 'ended' || !s.location) continue;
    L.marker([s.location.lat, s.location.lng], { icon: L.divIcon({ className: '', html: '<div class="pulse-marker" style="background:#f0883e"></div>', iconSize: [18, 18] }) }).bindPopup(`<b>Traffic stop ${esc(fmtPlate(s.plate))}</b><br>${esc(s.reason ?? '')}`).addTo(S.mapLayer);
  }
  if (S.loc) L.marker([S.loc.lat, S.loc.lng], { icon: L.divIcon({ className: '', html: `<span class="unit-marker me">${esc(officer().unit ?? 'Me')}</span>`, iconSize: [0, 0] }), zIndexOffset: 1000 }).addTo(S.mapLayer);
}

// ================= records lookup =================
function mountRecords(body, args) {
  body.innerHTML = `<div class="win-tools"><form id="q-form" class="row grow" style="flex-wrap:nowrap"><input id="q" placeholder="Plate, Oklahoma DL number, VIN, or name" autocomplete="off"><button class="btn primary">${icon('search')} Run</button></form></div>
    <div class="pad" style="padding:14px" id="q-out"><div class="empty">${icon('search')}<br>Query vehicle and driver records. Every query is written to the audit ledger.</div></div>`;
  $('#q-form', body).onsubmit = (e) => { e.preventDefault(); runQuery(body, $('#q', body).value); };
  APPS.records.reopen = (b, a) => { if (a?.q) { $('#q', b).value = a.q; runQuery(b, a.q); } };
  if (args?.q) { $('#q', body).value = args.q; runQuery(body, args.q); } else setTimeout(() => $('#q', body)?.focus(), 50);
}

async function runQuery(body, q) {
  const out = $('#q-out', body);
  out.innerHTML = '<div class="empty">Querying…</div>';
  try {
    const r = await S.session.api('GET', `/api/lookup?q=${encodeURIComponent(q)}`);
    wm.setSubtitle('records', q);
    if (!r.results.length) { out.innerHTML = `<div class="notice">No CO-SYNE record for <b>${esc(q)}</b>. The vehicle may not be enrolled. In production this query also goes to OLETS/NCIC and Service Oklahoma.</div><p class="query-log">${new Date().toLocaleTimeString()} · query logged</p>`; return; }
    out.innerHTML = r.results.map((x, i) => {
      const p = x.profile; const v = p.vehicle ?? {};
      return `<div class="rec"><div class="spread"><div class="row"><div class="avatar">${esc(initials(p.name))}</div><div><b style="font-size:1.05rem">${esc(p.name)}</b><div class="small muted">DOB ${esc(p.dob ?? '—')} · ${esc(p.address ?? '')}</div></div></div>
          <span class="row">${x.credentialValid ? '<span class="pill ok">Credential valid</span>' : `<span class="pill bad">${esc(x.credentialProblem)}</span>`}<button class="btn sm brand" data-stop="${i}">${icon('shieldCheck')} Open stop</button></span></div>
        <div class="rec-grid" style="margin-top:12px"><dl class="kv"><dt>OK DL</dt><dd class="mono">${esc(p.licenseNumber)} · class ${esc(p.licenseClass ?? '')}</dd><dt>License</dt><dd>${esc(p.licenseStatus)} · exp ${esc(p.licenseExpires ?? '')}</dd><dt>Vehicle</dt><dd>${esc(vehicleLine(v))}</dd><dt>Tag</dt><dd><span class="plate">${esc(fmtPlate(v.plate))}</span> ${esc(v.state ?? '')}</dd><dt>VIN</dt><dd class="mono">${esc(v.vin ?? '')}</dd>${p.accessibility ? `<dt>Note</dt><dd>${esc(p.accessibility)}</dd>` : ''}</dl>
          <ul class="checks">${x.checks.map((c) => `<li>${yn(c.ok)}<div><b>${esc(c.label)}</b><div class="small muted">${esc(c.detail)}</div></div></li>`).join('')}</ul></div>
        <h4 style="margin:14px 0 6px">CO-SYNE history</h4>${x.history.length || x.citations.length ? `<table class="table"><tr><th>Date</th><th>Event</th><th>Detail</th></tr>
          ${x.history.map((h) => `<tr><td>${dateTime(h.createdAt)}</td><td>Stop · ${esc(h.reason ?? '')}</td><td>${esc(h.officer ?? '')} · ${esc(h.outcome ?? h.status)}</td></tr>`).join('')}
          ${x.citations.map((c) => `<tr><td>${dateTime(c.issuedAt)}</td><td>${esc(c.type)} ${esc(c.id)}</td><td>${esc(c.violations.join(', '))} · ${esc(c.status)}</td></tr>`).join('')}</table>` : '<p class="small muted">No prior CO-SYNE stops or citations.</p>'}</div>`;
    }).join('') + `<p class="query-log">${new Date().toLocaleTimeString()} · ${r.results.length} result(s) · query logged to the evidence ledger</p>`;
    $$('[data-stop]', out).forEach((b) => {
      b.onclick = () => {
        const x = r.results[Number(b.dataset.stop)];
        showModal(`<h2>Open a stop on ${esc(fmtPlate(x.profile.vehicle.plate))}</h2><p class="muted small">The driver's phone receives your verified identity, the reason, and a video call request.</p><label>Reason</label>${reasonSelect('m-reason')}
          <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close-modal>Cancel</button><button class="btn brand" id="m-go">Open stop</button></div>`);
        $('#m-go').onclick = () => { const reason = $('#m-reason').value; hideModal(); beginStop(x.stickerId ? { stickerId: x.stickerId, reason } : { plate: x.profile.vehicle.plate, reason }); };
      };
    });
  } catch (e) { out.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
}

// ================= CAD =================
function renderCad(body) {
  const list = [...S.alerts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = list.filter((a) => !['resolved', 'cancelled'].includes(a.status));
  wm.setSubtitle('cad', open.length ? `${open.length} open` : '');
  body.innerHTML = `<div class="spread" style="margin-bottom:12px"><h3>Assigned to ${esc(officer().unit)}</h3><span class="pill">${esc(S.config.region.name)}</span></div>
    ${list.length ? list.map((a) => `<div class="cad-item p${a.triage?.priority}">
      <div class="spread"><div><b>P${a.triage?.priority} · ${esc(ALERT_LABEL[a.type] ?? a.type)}</b> <span class="muted small">${esc(a.id)} · ${time(a.createdAt)} (${ago(a.createdAt)} ago)</span></div><span class="pill ${['resolved', 'cancelled'].includes(a.status) ? '' : 'warn'}">${esc(a.status.replace('_', ' '))}</span></div>
      <p class="small">${esc(a.description || a.triage?.rationale || '')}</p>
      <dl class="kv small"><dt>Caller</dt><dd>${esc(a.driver?.name ?? 'Unverified caller')}${a.driverVerified ? ' <span class="pill ok">verified ID</span>' : ''}</dd><dt>Vehicle</dt><dd>${esc(a.vehicle ? `${vehicleLine(a.vehicle)} · ${fmtPlate(a.vehicle.plate)}` : '—')}</dd><dt>Location</dt><dd>${coords(a.location)}</dd>${a.accessibility ? `<dt>Note</dt><dd>${esc(a.accessibility)}</dd>` : ''}
        <dt>Units</dt><dd>${esc(a.assignments.map((x) => `${x.callsign}${x.etaMin ? ` (${x.etaMin} min)` : ''}`).join(', '))}</dd></dl>
      ${['resolved', 'cancelled'].includes(a.status) ? '' : `<div class="row" style="margin-top:10px">${['acknowledged', 'en_route', 'on_scene', 'resolved'].map((s) => `<button class="btn sm ${a.status === s ? 'primary' : ''}" data-as="${s}" data-id="${esc(a.id)}">${esc({ acknowledged: 'Acknowledge', en_route: 'En route', on_scene: 'On scene', resolved: 'Clear' }[s])}</button>`).join('')}
        <button class="btn sm" data-video="${esc(a.id)}">${icon('video')} Video with caller</button><button class="btn sm" data-locate="${esc(a.id)}">${icon('map')} Map</button></div>`}</div>`).join('') : `<div class="empty">${icon('radio')}<br>No calls assigned. Dispatch assigns D2ES alerts here automatically.</div>`}`;
  $$('[data-as]', body).forEach((b) => {
    b.onclick = async () => {
      try { S.alerts.set(b.dataset.id, await S.session.api('POST', `/api/alerts/${b.dataset.id}/status`, { status: b.dataset.as })); renderCad(body); renderTray(); } catch (e) { toast(e.message); }
    };
  });
  $$('[data-video]', body).forEach((b) => { b.onclick = () => wm.open('video', { room: `alert:${b.dataset.video}`, title: 'Caller video' }); });
  $$('[data-locate]', body).forEach((b) => { b.onclick = () => { const a = S.alerts.get(b.dataset.locate); wm.open('map'); S.map?.setView([a.location.lat, a.location.lng], 16); }; });
}

let alertCall = null;
async function mountAlertVideo(body, args) {
  leaveAlertVideo();
  wm.setSubtitle('video', args?.title ?? '');
  body.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;padding:10px;gap:8px"><div class="tiles grow" id="av-tiles" style="align-content:start"></div>
    <div class="chat" id="av-chat" style="height:90px;border:1px solid var(--line);border-radius:8px;padding:6px"></div>
    <form id="av-form" class="row" style="flex-wrap:nowrap"><input id="av-in" placeholder="Text the caller"><button class="btn sm">${icon('send')}</button><button type="button" class="btn sm danger" id="av-leave">${icon('phoneOff')} Leave</button></form></div>`;
  const log = $('#av-chat', body);
  alertCall = new Call({
    session: S.session, room: args.room, iceServers: S.config.iceServers, container: $('#av-tiles', body), label: officer().name,
    onChat: (m) => { log.insertAdjacentHTML('beforeend', `<div class="msg"><b>${esc(m.from.name)}</b>${esc(m.text)}</div>`); log.scrollTop = log.scrollHeight; },
  });
  $('#av-form', body).onsubmit = (e) => { e.preventDefault(); alertCall?.chat($('#av-in', body).value); $('#av-in', body).value = ''; };
  $('#av-leave', body).onclick = () => wm.close('video');
  APPS.video.reopen = (b, a) => mountAlertVideo(b, a);
  try { await alertCall.start(); } catch (e) { toast(e.message); }
}
function leaveAlertVideo() { alertCall?.leave(); alertCall = null; }

// ================= messages =================
function mountMessages(body) {
  body.innerHTML = `<div class="msg-wrap"><div class="chat" id="ops-log"></div><form id="ops-form"><input id="ops-in" placeholder="Message dispatch and all units" autocomplete="off"><button class="btn primary">${icon('send')}</button></form></div>`;
  $('#ops-form', body).onsubmit = (e) => { e.preventDefault(); const t = $('#ops-in', body).value; if (t.trim()) S.session.send({ t: 'chat', room: 'ops:all', text: t }); $('#ops-in', body).value = ''; };
  renderMessages(body);
}
function renderMessages(body) {
  const log = $('#ops-log', body);
  if (!log) return;
  log.innerHTML = S.ops.map((m) => `<div class="msg ${m.from.id === S.session.peerId ? 'me' : ''}"><b>${esc(m.from.callsign ?? m.from.name)}${m.from.role === 'dispatch' ? ' · Dispatch' : ''} · ${timeSec(new Date(m.ts).toISOString())}</b>${esc(m.text)}</div>`).join('') || '<div class="empty">Ops channel: dispatch and every unit on the CO-SYNE network. Messages are recorded.</div>';
  log.scrollTop = log.scrollHeight;
}

// ================= citations / reports / evidence =================
async function renderCitations(body) {
  try {
    const { citations } = await S.session.api('GET', '/api/citations');
    body.innerHTML = citations.length ? `<table class="table"><tr><th>Number</th><th>Issued</th><th>Driver</th><th>Violations</th><th>Amount</th><th>Status</th><th></th></tr>
      ${citations.slice().reverse().map((c) => `<tr><td class="mono">${esc(c.id)}</td><td>${dateTime(c.issuedAt)}</td><td>${esc(c.driver.name)}</td><td>${esc(c.violations.map((v) => v.code).join(', '))}</td><td>${c.type === 'citation' ? money(c.totalFine) : 'Warning'}</td><td>${esc(c.status)}${c.ack ? ' · ack' : ''}</td><td><button class="btn sm" data-c="${esc(c.id)}">${icon('printer')}</button></td></tr>`).join('')}</table>`
      : `<div class="empty">${icon('ticket')}<br>No citations issued yet this shift.</div>`;
    $$('[data-c]', body).forEach((b) => { b.onclick = () => { const c = citations.find((x) => x.id === b.dataset.c); showDocument(citationDocument(c), c.id); }; });
  } catch (e) { body.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
}

async function renderReports(body) {
  try {
    const { reports } = await S.session.api('GET', '/api/reports');
    body.innerHTML = reports.length ? `<table class="table"><tr><th>Report</th><th>Filed</th><th>Driver</th><th>Reason</th><th>Disposition</th><th></th></tr>
      ${reports.map((r) => `<tr><td class="mono">${esc(r.id)}</td><td>${dateTime(r.filedAt)}</td><td>${esc(r.driver?.name ?? '')}</td><td>${esc(r.reason ?? '')}</td><td>${esc(r.disposition)}</td><td><button class="btn sm" data-r="${esc(r.id)}">${icon('printer')} Open</button></td></tr>`).join('')}</table>`
      : `<div class="empty">${icon('report')}<br>No reports filed yet this shift.</div>`;
    $$('[data-r]', body).forEach((b) => { b.onclick = () => { const r = reports.find((x) => x.id === b.dataset.r); showDocument(reportDocument(r), r.id); }; });
  } catch (e) { body.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
}

async function renderEvidence(body) {
  const mine = [...S.stops.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  body.innerHTML = `<div class="spread" style="margin-bottom:10px"><div class="row"><label style="margin:0">Stop</label><select id="ev-stop" style="width:auto">${mine.map((s) => `<option value="${s.id}">${esc(fmtPlate(s.plate))} · ${time(s.createdAt)}</option>`).join('') || '<option value="">No stops yet</option>'}</select></div><button class="btn sm" id="ev-verify">${icon('shieldCheck')} Verify whole chain</button></div><div id="ev-out"></div>`;
  const load = async () => {
    const ref = $('#ev-stop', body).value;
    if (!ref) { $('#ev-out', body).innerHTML = '<div class="empty">Entries appear here once you run a stop.</div>'; return; }
    const { entries } = await S.session.api('GET', `/api/ledger?ref=${ref}&limit=500`);
    $('#ev-out', body).innerHTML = `<table class="table"><tr><th>#</th><th>Time</th><th>Event</th><th>Hash</th></tr>${entries.map((e) => `<tr><td>${e.seq}</td><td>${timeSec(e.ts)}</td><td>${esc(e.type)}</td><td class="mono small">${esc(e.hash.slice(0, 20))}…</td></tr>`).join('')}</table>`;
  };
  $('#ev-stop', body).onchange = load;
  $('#ev-verify', body).onclick = async () => { const v = await api('GET', '/api/ledger/verify'); toast(v.ok ? `Ledger intact: ${v.length} entries, every hash and signature checks out` : `Ledger BROKEN at entry ${v.brokenAt}`); };
  load().catch((e) => toast(e.message));
}

// ================= settings =================
function renderSettings(body) {
  const o = officer();
  const turn = S.config.iceServers.some((s) => [].concat(s.urls).some((x) => String(x).startsWith('turn')));
  body.innerHTML = `<div class="stack">
    <div class="card"><h4>Officer</h4><dl class="kv" style="margin-top:8px"><dt>Name</dt><dd>${esc(o.name)}</dd><dt>Badge</dt><dd>${esc(o.badge)}</dd><dt>Unit</dt><dd>${esc(o.unit)}</dd><dt>Division</dt><dd>${esc(o.division ?? '—')}</dd><dt>Agency</dt><dd>${esc(S.identity.credential.issuerName)}</dd><dt>Credential</dt><dd class="mono small">${esc(S.identity.credential.id)} · exp ${esc(S.identity.credential.expiresAt.slice(0, 10))}</dd></dl></div>
    <div class="card"><h4>Display</h4><div class="seg" style="margin-top:8px"><button data-th="night" class="${document.documentElement.dataset.theme !== 'day' ? 'on' : ''}">${icon('moon')} Dark</button><button data-th="day" class="${document.documentElement.dataset.theme === 'day' ? 'on' : ''}">${icon('sun')} Light</button></div></div>
    <div class="card"><h4>Network</h4><dl class="kv" style="margin-top:8px"><dt>Server</dt><dd class="mono small">${esc(url('/'))}</dd><dt>Status</dt><dd>${S.session?.online ? 'Connected' : 'Offline'}</dd><dt>Video</dt><dd>${turn ? 'TURN relay configured' : 'STUN only (same-network calls)'}</dd><dt>Location</dt><dd>${coords(S.loc)} (${S.locSource === 'gps' ? 'GPS' : 'simulated'})</dd><dt>Pilot</dt><dd>${esc(S.config.pilot)}</dd></dl></div>
    <div class="row"><button class="btn" id="s-lock">${icon('lock')} Lock terminal</button><button class="btn danger" id="s-out">${icon('logout')} Sign out and remove credential</button></div></div>`;
  $$('[data-th]', body).forEach((b) => { b.onclick = () => { applyTheme(b.dataset.th); renderSettings(body); }; });
  $('#s-lock', body).onclick = lockTerminal;
  $('#s-out', body).onclick = () => { if (confirm('Remove this officer credential from the terminal?')) { clearIdentity('officer'); location.reload(); } };
}

// ================= boot =================
async function init() {
  ({ config: S.config, trust: S.trust } = await bootstrap());
  openDemoBadge(S.config);
  S.catalog = await api('GET', '/api/violations');
  if (S.config.demo) S.samples = await api('GET', '/api/samples').catch(() => null);
  renderLock();
  // A Demo Control link signs this terminal in as the chosen pilot officer.
  try {
    const r = await redeemDemoPass('officer');
    if (r?.officer) { S.identity = r.officer; saveIdentity('officer', S.identity); renderLock(); signIn(); return; }
  } catch (e) { renderLock(e.message); return; }
  if (S.identity && new URL(location.href).searchParams.get('autologin') !== '0' && S.pendingScan) signIn();
}

window.cosyne = { S, beginStop, simulateScan, issueTicket, fileReport, openApp: (id, a) => wm.open(id, a), signIn };
init().catch((e) => { $('#lock').innerHTML = `<div class="lock-card"><div class="notice bad">Cannot reach the CO-SYNE network: ${esc(e.message)}</div></div>`; });
