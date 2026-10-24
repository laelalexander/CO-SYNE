// CO-SYNE Dispatch: the network operations and dispatch console. It sees
// every device, stop, alert, unit, record, and ledger entry on the network.
import { api, bootstrap, openSession, url } from '../lib/session.js';
import { Call } from '../lib/call.js';
import { icon } from '../lib/icons.js';
import {
  $, $$, esc, initials, money, time, timeSec, dateTime, ago, coords, vehicleLine, STOP_STATUS, UNIT_STATUS, UNIT_TONE, PRIORITY_TONE, ALERT_LABEL,
  citationDocument, reportDocument, showDocument, showModal, hideModal, toast, tone,
} from '../lib/ui.js';

const S = {
  config: null, trust: [], session: null, state: null, view: 'ops', qtab: 'all', selected: null,
  events: [], ops: [], call: null, callRoom: null, chat: [], seenAlerts: new Set(), seenStops: new Set(),
  dispatcher: (() => { try { return JSON.parse(sessionStorage.getItem('cosyne:dispatch') ?? 'null'); } catch { return null; } })(),
};
const fmtPlate = (p = '') => (/^[A-Z]{3}\d{3}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p);
const yn = (ok) => `<span class="mark ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</span>`;
const live = (s) => !['ended', 'failed'].includes(s.status);
const openAlert = (a) => !['resolved', 'cancelled'].includes(a.status);

function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('cosyne:dispatch:theme', t); } catch { /* ignore */ } }
applyTheme((() => { try { return localStorage.getItem('cosyne:dispatch:theme') || 'night'; } catch { return 'night'; } })());

// ---------- sign-in ----------
function renderLogin(msg = '') {
  $('#app').classList.add('hidden');
  const el = $('#login');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="login-card"><div class="row" style="gap:12px;margin-bottom:16px"><img src="../icons/dispatch.svg" width="44" height="44" alt=""><div><h2>CO-SYNE Dispatch</h2><div class="small muted">${esc(S.config.region.name)} · ${esc(S.config.pilot)}</div></div></div>
    <form id="login-form"><label>Dispatcher name</label><input name="name" required value="${esc(S.dispatcher?.name ?? '')}" placeholder="e.g. J. Morgan">
      <label>Console access code</label><input name="token" type="password" required value="${esc(S.config.dispatchHint ?? '')}">
      <button class="btn brand block lg" style="margin-top:16px">${icon('headset')} Sign in to the console</button></form>
    <p class="small" style="color:var(--danger);min-height:1.2em">${esc(msg)}</p>
    <p class="tiny faint">Pilot access code. Production consoles use agency SSO with per-dispatcher accounts.</p></div>`;
  $('#login-form').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    S.dispatcher = { name: f.name, token: f.token };
    try { sessionStorage.setItem('cosyne:dispatch', JSON.stringify(S.dispatcher)); } catch { /* ignore */ }
    connect();
  };
}

function connect() {
  S.session?.close();
  S.session = openSession('dispatch', S.dispatcher);
  S.session.on(onMessage);
}

// ---------- network events ----------
function onMessage(msg) {
  if (msg.t === 'hello_ok') {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    S.session.send({ t: 'join', room: 'ops:all', media: false });
    loadLedger();
    render();
  } else if (msg.t === 'error' && /dispatch token|sign-in/.test(msg.error)) {
    S.session.close();
    renderLogin('That access code was not accepted.');
  } else if (msg.t === 'state') {
    const first = !S.state;
    S.state = msg;
    for (const a of msg.alerts) if (!S.seenAlerts.has(a.id)) { S.seenAlerts.add(a.id); if (!first && openAlert(a)) { tone('alert'); toast(`New P${a.triage?.priority} ${ALERT_LABEL[a.type] ?? a.type} call from ${a.driver?.name ?? 'caller'}`); } }
    for (const s of msg.stops) if (!S.seenStops.has(s.id)) { S.seenStops.add(s.id); if (!first && live(s)) { tone('chime'); toast(`Traffic stop: ${s.officer?.unit ?? ''} on ${fmtPlate(s.plate)}`); } }
    if (S.call && S.callRoom?.startsWith('stop:')) {
      const st = msg.stops.find((x) => `stop:${x.id}` === S.callRoom);
      if (st && !live(st)) { leaveCall(); toast('The stop ended. You left the session.'); }
    }
    renderDynamic();
  } else if (msg.t === 'alert') {
    if (S.state) { const i = S.state.alerts.findIndex((a) => a.id === msg.alert.id); if (i >= 0) S.state.alerts[i] = msg.alert; else S.state.alerts.push(msg.alert); renderDynamic(); }
  } else if (msg.t === 'stop') {
    if (S.state) { const i = S.state.stops.findIndex((s) => s.id === msg.stop.id); if (i >= 0) S.state.stops[i] = msg.stop; else S.state.stops.push(msg.stop); renderDynamic(); }
  } else if (msg.t === 'ledger') {
    S.events.unshift({ ...msg.entry, fresh: true });
    if (S.events.length > 400) S.events.pop();
    renderEvents();
  } else if (msg.t === 'chat' && msg.room === 'ops:all') {
    S.ops.push(msg); renderOps();
  } else if (msg.t === 'chat_history' && msg.room === 'ops:all') {
    S.ops = msg.messages; renderOps();
  }
}

async function loadLedger() {
  try {
    const { entries } = await S.session.api('GET', '/api/ledger?limit=150');
    S.events = entries.slice().reverse();
    renderEvents();
  } catch { /* ignore */ }
}

// ---------- shell ----------
const VIEWS = [
  ['ops', 'Live operations', 'activity'], ['stops', 'Traffic stops', 'shieldCheck'], ['calls', 'Calls for service', 'siren'], ['units', 'Units', 'car'],
  ['records', 'Records', 'search'], ['docs', 'Citations & reports', 'ticket'], ['network', 'Network', 'network'], ['ledger', 'Evidence ledger', 'database'], ['creds', 'Credentials', 'id'],
];

function render() {
  $('#center-name').textContent = `${S.state?.centers?.[0]?.name ?? 'Tulsa 911'} · ${S.config.pilot}`;
  $('#rail').innerHTML = VIEWS.map(([id, label, ic]) => `<button class="${S.view === id ? 'on' : ''}" data-view="${id}" title="${esc(label)}">${icon(ic)}${id === 'calls' && openCalls().length ? `<i class="badge-n">${openCalls().length}</i>` : id === 'stops' && liveStops().length ? `<i class="badge-n" style="background:var(--brand);color:#111">${liveStops().length}</i>` : ''}</button>`).join('')
    + `<span style="flex:1"></span><button data-theme-toggle title="Day / night">${icon(document.documentElement.dataset.theme === 'day' ? 'moon' : 'sun')}</button>`;
  $$('#rail [data-view]').forEach((b) => { b.onclick = () => { S.view = b.dataset.view; if (S.view !== 'ops') { S.map?.remove(); S.map = null; } render(); }; });
  $('#rail [data-theme-toggle]').onclick = () => { applyTheme(document.documentElement.dataset.theme === 'day' ? 'night' : 'day'); render(); };
  $('#top-right').innerHTML = `<span class="pill ${S.session?.online ? 'ok' : 'bad'}"><span class="dot ${S.session?.online ? 'ok' : 'bad'}"></span>${S.session?.online ? 'Network online' : 'Reconnecting'}</span>
    <span class="row" style="gap:8px"><span class="avatar" style="width:30px;height:30px;font-size:.72rem">${esc(initials(S.dispatcher?.name))}</span><span>${esc(S.dispatcher?.name ?? '')}</span></span><span id="clock" class="mono"></span>
    <button class="btn sm ghost" id="signout" title="Sign out">${icon('logout')}</button>`;
  $('#signout').onclick = () => { try { sessionStorage.removeItem('cosyne:dispatch'); } catch { /* ignore */ } location.reload(); };
  tickClock();
  const main = $('#main');
  if (S.view === 'ops') {
    if (!$('#ops', main)) buildOps(main);
  } else {
    main.innerHTML = '<div class="page" id="page"></div>';
  }
  renderDynamic();
}
function tickClock() { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleTimeString([], { hour12: false }); }
setInterval(tickClock, 1000);

const liveStops = () => (S.state?.stops ?? []).filter(live);
const openCalls = () => (S.state?.alerts ?? []).filter(openAlert);

function renderKpis() {
  const st = S.state;
  if (!st) return;
  const dev = st.network?.devices ?? [];
  const by = (r) => dev.filter((d) => d.role === r).length;
  const units = st.units;
  const avail = units.filter((u) => u.status === 'available').length;
  const p1 = openCalls().filter((a) => a.triage?.priority === 1).length;
  $('#kpis').innerHTML = [
    ['Open calls', openCalls().length, p1 ? 'alert' : ''], ['P1 calls', p1, p1 ? 'alert' : ''], ['Live stops', liveStops().length, liveStops().length ? 'warn' : ''],
    ['Units available', `${avail}/${units.length}`, 'ok'], ['Patrol terminals', by('officer'), ''], ['Driver phones', by('driver'), ''], ['Dispatch consoles', by('dispatch'), ''],
    ['Ledger entries', st.network?.ledger?.entries ?? 0, ''],
  ].map(([l, v, c]) => `<div class="kpi ${c}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
}

function renderDynamic() {
  if (!S.state) return;
  renderKpis();
  $$('#rail [data-view]').forEach((b) => {
    const id = b.dataset.view;
    b.querySelector('.badge-n')?.remove();
    if (id === 'calls' && openCalls().length) b.insertAdjacentHTML('beforeend', `<i class="badge-n">${openCalls().length}</i>`);
    if (id === 'stops' && liveStops().length) b.insertAdjacentHTML('beforeend', `<i class="badge-n" style="background:var(--brand);color:#111">${liveStops().length}</i>`);
  });
  if (S.view === 'ops') { renderQueue(); renderMap(); renderDetail(); } else PAGES[S.view]?.($('#page'));
}

// ---------- live ops ----------
function buildOps(main) {
  main.innerHTML = `<div class="ops" id="ops">
    <section class="col"><div class="col-head"><div class="tabs" id="q-tabs">${[['all', 'All'], ['calls', 'Calls'], ['stops', 'Stops']].map(([k, l]) => `<button data-q="${k}" class="${S.qtab === k ? 'on' : ''}">${l}</button>`).join('')}</div><label class="row small" style="margin:0;gap:6px"><input type="checkbox" id="q-closed" style="width:auto"> closed</label></div><div class="col-body" id="queue"></div></section>
    <section class="mapcol"><div id="d-map"></div><div class="legend"><span><span class="dot ok"></span> Available</span><span><span class="dot warn"></span> Assigned</span><span><span class="dot bad"></span> On scene / stop</span><span><span class="live"></span> Call</span><span><span class="live" style="background:var(--brand)"></span> Stop</span></div></section>
    <section class="col detail"><div class="col-body" id="detail"></div></section>
    <section class="feed"><div class="events"><div class="col-head"><h4>${icon('database')} Live evidence ledger</h4><button class="btn sm" id="verify">${icon('shieldCheck')} Verify chain</button></div><div class="ev-list" id="events"></div></div>
      <div><div class="col-head"><h4>${icon('radio')} Ops channel · all units</h4></div><div class="chat" id="ops-log" style="flex:1;padding:8px 10px"></div>
        <form id="ops-form" class="row" style="flex-wrap:nowrap;padding:8px;border-top:1px solid var(--line)"><input id="ops-in" placeholder="Broadcast to all units" autocomplete="off"><button class="btn sm primary">${icon('send')}</button></form></div></section>
  </div>`;
  $$('#q-tabs [data-q]').forEach((b) => { b.onclick = () => { S.qtab = b.dataset.q; $$('#q-tabs button').forEach((x) => x.classList.toggle('on', x === b)); renderQueue(); }; });
  $('#q-closed').onchange = renderQueue;
  $('#verify').onclick = verifyLedger;
  $('#ops-form').onsubmit = (e) => { e.preventDefault(); const t = $('#ops-in').value; if (t.trim()) S.session.send({ t: 'chat', room: 'ops:all', text: t }); $('#ops-in').value = ''; };
  const r = S.config.region;
  S.map = L.map('d-map').setView([r.center.lat, r.center.lng], r.zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(S.map);
  S.mapLayer = L.layerGroup().addTo(S.map);
  new ResizeObserver(() => S.map?.invalidateSize()).observe($('#d-map'));
  renderEvents(); renderOps();
}

async function verifyLedger() {
  const v = await api('GET', '/api/ledger/verify');
  toast(v.ok ? `Evidence ledger intact: ${v.length} entries, every hash and signature verified.` : `LEDGER BROKEN at entry #${v.brokenAt}: ${v.reason}`, 6000);
}

function queueItems() {
  const showClosed = $('#q-closed')?.checked;
  const items = [];
  if (S.qtab !== 'stops') for (const a of S.state.alerts) if (showClosed || openAlert(a)) items.push({ kind: 'alert', at: a.createdAt, a });
  if (S.qtab !== 'calls') for (const s of S.state.stops) if (showClosed || live(s)) items.push({ kind: 'stop', at: s.createdAt, s });
  return items.sort((x, y) => {
    const px = x.kind === 'alert' ? x.a.triage?.priority ?? 3 : 2.5; const py = y.kind === 'alert' ? y.a.triage?.priority ?? 3 : 2.5;
    return px - py || y.at.localeCompare(x.at);
  });
}

function renderQueue() {
  const q = $('#queue');
  if (!q) return;
  const items = queueItems();
  q.innerHTML = items.map((it) => {
    if (it.kind === 'alert') {
      const a = it.a;
      return `<div class="q-item p${a.triage?.priority} ${openAlert(a) ? '' : 'done'} ${S.selected === a.id ? 'sel' : ''}" data-sel="${a.id}"><header><b>${openAlert(a) ? '<span class="live"></span> ' : ''}P${a.triage?.priority} ${esc(ALERT_LABEL[a.type] ?? a.type)}</b><span class="pill">${esc(a.status.replace('_', ' '))}</span></header>
        <div class="small">${esc(a.driver?.name ?? 'Unverified caller')} · ${ago(a.createdAt)} ago${a.aiPending ? ' · AI reviewing' : ''}</div><div class="small">${esc(a.assignments.map((x) => x.callsign).join(', ') || 'No unit assigned')}</div></div>`;
    }
    const s = it.s;
    return `<div class="q-item stop ${s.status === 'failed' ? 'failed' : ''} ${live(s) ? '' : 'done'} ${S.selected === s.id ? 'sel' : ''}" data-sel="${s.id}"><header><b>${live(s) ? '<span class="live" style="background:var(--brand)"></span> ' : ''}Stop · <span class="plate">${esc(fmtPlate(s.plate))}</span></b><span class="pill ${s.status === 'verified' ? 'ok' : s.status === 'failed' ? 'bad' : ''}">${esc(STOP_STATUS[s.status])}</span></header>
      <div class="small">${esc(s.officer?.unit ?? '')} · ${esc(s.officer?.name ?? '')} · ${ago(s.createdAt)}</div>
      <div class="small">${esc(s.driver?.name ?? 'Driver pending')} · ${esc(s.reason ?? '')}${s.call ? ` · ${s.call.status === 'accepted' ? 'on video' : s.call.status === 'declined' ? 'text only' : 'ringing'}` : ''}${s.participants?.length ? ` · ${s.participants.length} connected` : ''}${(s.citations ?? []).length ? ` · ${s.citations.length} ticket(s)` : ''}</div></div>`;
  }).join('') || `<div class="empty">${icon('check')}<br>No open calls or stops.</div>`;
  $$('#queue [data-sel]').forEach((el) => { el.onclick = () => select(el.dataset.sel); });
}

function select(id, { pan = true } = {}) {
  S.selected = id;
  const obj = findSel();
  if (pan && obj && S.map) { const loc = obj.location; if (loc) S.map.setView([loc.lat, loc.lng], Math.max(S.map.getZoom(), 14)); }
  renderQueue(); renderDetail(true);
}
function findSel() { return S.state?.alerts.find((a) => a.id === S.selected) ?? S.state?.stops.find((s) => s.id === S.selected) ?? null; }

const unitColor = (s) => ({ available: '#3fb950', assigned: '#f0883e', en_route: '#f0883e', on_scene: '#f85149', on_stop: '#f85149', busy: '#79b8ff', out_of_service: '#6b7380' }[s] ?? '#9aa2ad');
function renderMap() {
  if (!S.map) return;
  S.mapLayer.clearLayers();
  for (const c of S.state.centers) L.marker([c.location.lat, c.location.lng], { icon: L.divIcon({ className: '', html: '<div class="center-marker"></div>', iconSize: [14, 14] }) }).bindTooltip(esc(c.name)).addTo(S.mapLayer);
  for (const u of S.state.units) {
    if (!u.location) continue;
    L.marker([u.location.lat, u.location.lng], { icon: L.divIcon({ className: '', html: `<span class="unit-marker" style="background:${unitColor(u.status)}">${esc(u.callsign)}</span>`, iconSize: [0, 0] }), zIndexOffset: u.simulated ? 0 : 500 })
      .bindPopup(`<b>${esc(u.callsign)}</b><br>${esc(u.agency ?? u.type)}${u.officer ? `<br>${esc(u.officer)}` : ''}<br>${esc(UNIT_STATUS[u.status] ?? u.status)}${u.simulated ? '<br><i>simulated unit</i>' : ''}`).addTo(S.mapLayer);
  }
  for (const a of S.state.alerts) {
    if (!openAlert(a)) continue;
    L.marker([a.location.lat, a.location.lng], { icon: L.divIcon({ className: '', html: '<div class="pulse-marker"></div>', iconSize: [18, 18] }), zIndexOffset: 1000 }).on('click', () => select(a.id, { pan: false })).addTo(S.mapLayer);
    if (a.trail?.length > 1) L.polyline(a.trail.map((p) => [p.lat, p.lng]), { color: '#f85149', weight: 2, opacity: .6 }).addTo(S.mapLayer);
    for (const x of a.assignments) { const u = S.state.units.find((v) => v.id === x.unitId); if (u?.location) L.polyline([[u.location.lat, u.location.lng], [a.location.lat, a.location.lng]], { color: '#f0883e', weight: 1.5, dashArray: '4 5' }).addTo(S.mapLayer); }
  }
  for (const s of S.state.stops) {
    if (!live(s) || !s.location) continue;
    L.marker([s.location.lat, s.location.lng], { icon: L.divIcon({ className: '', html: '<div class="pulse-marker" style="background:#c9a54a"></div>', iconSize: [18, 18] }), zIndexOffset: 1000 }).on('click', () => select(s.id, { pan: false })).addTo(S.mapLayer);
    if (s.officerLocation) L.polyline([[s.officerLocation.lat, s.officerLocation.lng], [s.location.lat, s.location.lng]], { color: '#c9a54a', weight: 1.5, dashArray: '3 4' }).addTo(S.mapLayer);
  }
}

// ---------- detail panel ----------
function renderDetail(force) {
  const el = $('#detail');
  if (!el) return;
  const obj = findSel();
  if (!obj) {
    el.dataset.sel = '';
    el.innerHTML = `<h3>Network overview</h3><p class="small muted">Select a call or stop to see details, assign units, or drop in to the live session.</p>${overviewHtml()}`;
    return;
  }
  // Keep the live video tiles when re-rendering the same selection.
  const keepVideo = S.callBox && el.dataset.sel === obj.id;
  if (keepVideo) S.callBox.remove();
  el.dataset.sel = obj.id;
  el.innerHTML = S.state.alerts.includes(obj) ? alertDetail(obj) : stopDetail(obj);
  const slot = $('#drop-slot', el);
  if (S.callBox && slot && S.callRoom === `${S.state.alerts.includes(obj) ? 'alert' : 'stop'}:${obj.id}`) slot.append(S.callBox);
  bindDetail(el, obj);
  renderSessionChat();
}

function overviewHtml() {
  const st = S.state;
  const byStatus = (s) => st.units.filter((u) => u.status === s).length;
  return `<div class="section"><h4>Units</h4><ul class="checks" style="margin-top:8px">${Object.keys(UNIT_STATUS).map((k) => `<li><span class="dot ${UNIT_TONE[k]}" style="margin-top:6px"></span><span class="grow">${UNIT_STATUS[k]}</span><b>${byStatus(k)}</b></li>`).join('')}</ul></div>
    <div class="section"><h4>Connected devices</h4><ul class="checks" style="margin-top:8px">${(st.network?.devices ?? []).map((d) => `<li>${icon(d.role === 'driver' ? 'phone' : d.role === 'officer' ? 'shield' : 'headset')}<span class="grow">${esc(d.name)}<div class="tiny muted">${esc(d.role)}${d.unitId ? ` · ${esc(st.units.find((u) => u.id === d.unitId)?.callsign ?? d.unitId)}` : ''}${d.plate ? ` · ${esc(fmtPlate(d.plate))}` : ''} · ${ago(d.since)}</div></span></li>`).join('') || '<li class="muted">None</li>'}</ul></div>
    <div class="section"><h4>Dispatch centers</h4>${st.centers.map((c) => `<p class="small">${esc(c.name)} <span class="pill">${esc(c.area)}</span></p>`).join('')}</div>`;
}

function sessionBlock(room, label) {
  const inThis = S.callRoom === room;
  return `<div class="section"><div class="spread"><h4>${icon('headset')} Live session</h4>${inThis ? '<span class="pill bad"><span class="live"></span> You are connected</span>' : ''}</div>
    ${inThis ? `<div class="drop" id="drop-slot" style="margin-top:8px"></div>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="d-mic">${icon(S.call?.micOn ? 'mic' : 'micOff')} ${S.call?.micOn ? 'Mute' : 'Unmute'}</button><button class="btn sm" id="d-cam">${icon(S.call?.camOn ? 'video' : 'videoOff')} ${S.call?.camOn ? 'Camera on' : 'Camera off'}</button><button class="btn sm danger" id="d-leave">${icon('phoneOff')} Leave</button></div>
      <div class="chat" id="sess-chat" style="height:110px;margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:6px"></div>
      <form id="sess-form" class="row" style="flex-wrap:nowrap;margin-top:6px"><input id="sess-in" placeholder="Text everyone on this session"><button class="btn sm">${icon('send')}</button></form>`
    : `<div class="row" style="margin-top:8px"><button class="btn brand" id="d-drop">${icon('headset')} Drop in (video + voice)</button><button class="btn" id="d-listen">${icon('eye')} Listen in (muted, camera off)</button></div><p class="tiny muted">${esc(label)} Everyone on the session sees that dispatch joined, and the join is recorded.</p>`}</div>`;
}

function stopDetail(s) {
  const d = s.driver ?? {}; const v = d.vehicle ?? {}; const o = s.officer ?? {};
  return `<div class="spread"><h2>Traffic stop · <span class="plate">${esc(fmtPlate(s.plate))}</span></h2><span class="pill ${s.status === 'verified' ? 'ok' : s.status === 'failed' ? 'bad' : ''}">${esc(STOP_STATUS[s.status])}</span></div>
    <p class="small muted">${esc(s.id)} · started ${time(s.createdAt)} (${ago(s.createdAt)} ago) · ${s.via === 'sticker' ? 'sticker scan' : 'plate lookup'} · ${coords(s.location)}</p>
    ${s.failure ? `<div class="notice bad">${esc(s.failure)}</div>` : ''}
    <dl class="kv section"><dt>Reason</dt><dd><b>${esc(s.reason ?? '—')}</b></dd><dt>Officer</dt><dd>${esc(o.name ?? '—')} · #${esc(o.badge ?? '')} · ${esc(o.unit ?? '')}<div class="tiny muted">${esc(o.agency ?? '')}${o.division ? ` · ${esc(o.division)}` : ''}</div></dd>
      <dt>Driver</dt><dd>${esc(d.name ?? 'Pending')}${s.proofs?.driver ? ' <span class="pill ok">confirmed on phone</span>' : ''}<div class="tiny muted">${esc(d.licenseNumber ?? '')} ${d.dob ? `· DOB ${esc(d.dob)}` : ''}</div></dd>
      <dt>Vehicle</dt><dd>${esc(vehicleLine(v))}</dd><dt>Call</dt><dd>${esc(s.call?.status ?? '—')}</dd>
      <dt>Connected</dt><dd>${s.participants?.length ? s.participants.map((p) => `${esc(p.name)} <span class="muted">(${esc(p.role)})</span>`).join(', ') : 'Nobody on the session'}</dd>
      ${d.accessibility ? `<dt>Note</dt><dd>${esc(d.accessibility)}</dd>` : ''}</dl>
    ${live(s) ? sessionBlock(`stop:${s.id}`, 'Join the officer and driver from the console.') : ''}
    ${s.checks?.length ? `<div class="section"><h4>Records checks</h4><ul class="checks" style="margin-top:8px">${s.checks.map((c) => `<li>${yn(c.ok)}<div><b>${esc(c.label)}</b><div class="tiny muted">${esc(c.detail)}</div></div></li>`).join('')}</ul></div>` : ''}
    <div class="section"><h4>Citations & report</h4>${(s.citations ?? []).map((c) => `<div class="spread small" style="margin-top:6px"><span><b>${esc(c.id)}</b> · ${esc(c.type)} · ${c.type === 'citation' ? money(c.totalFine) : 'no fine'} · ${esc(c.status)}${c.ack ? ' · acknowledged' : ''}</span><button class="btn sm" data-cit="${esc(c.id)}">${icon('printer')}</button></div>`).join('') || '<p class="small muted">None yet.</p>'}
      ${s.reportId ? `<button class="btn sm" style="margin-top:8px" id="d-report">${icon('report')} Open report ${esc(s.reportId)}</button>` : ''}</div>
    <div class="row section"><button class="btn sm" id="d-ledger">${icon('database')} Evidence for this stop</button>${live(s) ? `<button class="btn sm danger" id="d-end">End stop</button>` : ''}<button class="btn sm ghost" id="d-close">${icon('x')} Close</button></div>`;
}

function alertDetail(a) {
  const avail = S.state.units.filter((u) => u.location && u.status === 'available' && !a.assignments.some((x) => x.unitId === u.id))
    .map((u) => ({ u, km: Math.hypot((u.location.lat - a.location.lat) * 111, (u.location.lng - a.location.lng) * 90) })).sort((x, y) => x.km - y.km);
  return `<div class="spread"><h2>P${a.triage?.priority} · ${esc(ALERT_LABEL[a.type] ?? a.type)}</h2><span class="pill ${PRIORITY_TONE[a.triage?.priority]}">${esc(a.status.replace('_', ' '))}</span></div>
    <p class="small muted">${esc(a.id)} · ${time(a.createdAt)} (${ago(a.createdAt)} ago) · ${esc(a.center?.name ?? '')}</p>
    ${a.description ? `<div class="notice">${esc(a.description)}</div>` : ''}
    <dl class="kv section"><dt>Triage</dt><dd>${esc(a.triage?.category)} · ${esc((a.triage?.services ?? []).join(', '))}<div class="tiny muted">${esc(a.triage?.engine)}: ${esc(a.triage?.rationale)}${a.aiPending ? ' · AI second pass running' : ''}</div></dd>
      <dt>Caller</dt><dd>${esc(a.driver?.name ?? 'Unverified')}${a.driverVerified ? ' <span class="pill ok">verified ID</span>' : ' <span class="pill warn">unverified</span>'}</dd>
      <dt>Vehicle</dt><dd>${esc(a.vehicle ? `${vehicleLine(a.vehicle)} · ${fmtPlate(a.vehicle.plate)}` : '—')}</dd><dt>Location</dt><dd>${coords(a.location)} <span class="tiny muted">(${a.trail?.length ?? 0} updates)</span></dd>
      ${a.accessibility ? `<dt>Note</dt><dd>${esc(a.accessibility)}</dd>` : ''}${a.stopId ? `<dt>Stop</dt><dd><button class="btn sm" id="d-stoplink">${esc(a.stopId)}</button></dd>` : ''}</dl>
    <div class="section"><h4>Responding units</h4>${a.assignments.map((x) => `<div class="spread small" style="margin-top:6px"><span>${icon('car')} <b>${esc(x.callsign)}</b> · ${esc(x.service)}${x.by === 'dispatcher' ? ' · assigned by dispatcher' : ''}</span><span class="muted">${x.km != null ? `${x.km} km` : ''}${x.etaMin ? ` · ${x.etaMin} min` : ''}</span></div>`).join('') || '<p class="small muted">None assigned.</p>'}
      ${openAlert(a) ? `<div class="row" style="margin-top:10px;flex-wrap:nowrap"><select id="d-unit">${avail.map(({ u, km }) => `<option value="${u.id}">${esc(u.callsign)} · ${esc(u.type)} · ${km.toFixed(1)} km</option>`).join('') || '<option value="">No units available</option>'}</select><button class="btn sm primary" id="d-assign">Assign</button></div>` : ''}</div>
    ${openAlert(a) ? sessionBlock(`alert:${a.id}`, 'Video and text with the caller.') : ''}
    ${openAlert(a) ? `<div class="row section">${['acknowledged', 'en_route', 'on_scene', 'resolved'].map((s) => `<button class="btn sm ${a.status === s ? 'primary' : ''}" data-st="${s}">${esc({ acknowledged: 'Acknowledge', en_route: 'En route', on_scene: 'On scene', resolved: 'Resolve' }[s])}</button>`).join('')}</div>` : ''}
    <div class="row section"><button class="btn sm" id="d-ledger">${icon('database')} Evidence for this call</button><button class="btn sm ghost" id="d-close">${icon('x')} Close</button></div>`;
}

function bindDetail(el, obj) {
  const isAlert = S.state.alerts.includes(obj);
  const room = `${isAlert ? 'alert' : 'stop'}:${obj.id}`;
  $('#d-close', el)?.addEventListener('click', () => { S.selected = null; renderQueue(); renderDetail(); });
  $('#d-drop', el)?.addEventListener('click', () => joinCall(room, { mic: true, camera: true }));
  $('#d-listen', el)?.addEventListener('click', () => joinCall(room, { mic: false, camera: false }));
  $('#d-leave', el)?.addEventListener('click', leaveCall);
  $('#d-mic', el)?.addEventListener('click', () => { S.call?.toggleMic(); renderDetail(); });
  $('#d-cam', el)?.addEventListener('click', () => { S.call?.toggleCam(); renderDetail(); });
  $('#sess-form', el)?.addEventListener('submit', (e) => { e.preventDefault(); S.call?.chat($('#sess-in', el).value); $('#sess-in', el).value = ''; });
  $('#d-ledger', el)?.addEventListener('click', () => showLedgerFor(obj.id));
  $('#d-report', el)?.addEventListener('click', () => openReport(obj.reportId));
  $('#d-stoplink', el)?.addEventListener('click', () => select(obj.stopId));
  $$('[data-cit]', el).forEach((b) => { b.onclick = () => { const c = obj.citations.find((x) => x.id === b.dataset.cit); showDocument(citationDocument(c), c.id); }; });
  $('#d-end', el)?.addEventListener('click', async () => { if (!confirm('End this stop from dispatch?')) return; try { await S.session.api('POST', `/api/stops/${obj.id}/end`, { outcome: 'ended_by_dispatch' }); } catch (e) { toast(e.message); } });
  $('#d-assign', el)?.addEventListener('click', async () => { const unitId = $('#d-unit', el).value; if (!unitId) return; try { await S.session.api('POST', `/api/alerts/${obj.id}/assign`, { unitId }); toast('Unit assigned and notified'); } catch (e) { toast(e.message); } });
  $$('[data-st]', el).forEach((b) => { b.onclick = async () => { try { await S.session.api('POST', `/api/alerts/${obj.id}/status`, { status: b.dataset.st }); } catch (e) { toast(e.message); } }; });
}

// ---------- drop-in ----------
async function joinCall(room, { mic, camera }) {
  leaveCall();
  S.callRoom = room;
  S.chat = [];
  S.callBox = Object.assign(document.createElement('div'), { className: 'tiles' });
  S.call = new Call({
    session: S.session, room, iceServers: S.config.iceServers, container: S.callBox, label: `Dispatch · ${S.dispatcher.name}`, mic, camera,
    onChat: (m) => { S.chat.push(m); renderSessionChat(); },
  });
  renderDetail();
  try { await S.call.start(); } catch (e) { toast(e.message); }
  renderDetail();
}
function leaveCall() {
  S.call?.leave();
  S.call = null; S.callRoom = null; S.callBox = null;
  renderDetail();
}
function renderSessionChat() {
  const log = $('#sess-chat');
  if (!log) return;
  log.innerHTML = S.chat.map((m) => `<div class="msg ${m.from.id === S.session.peerId ? 'me' : ''}"><b>${esc(m.from.name)} · ${timeSec(new Date(m.ts).toISOString())}</b>${esc(m.text)}</div>`).join('') || '<div class="tiny faint">Session text appears here.</div>';
  log.scrollTop = log.scrollHeight;
}

// ---------- feed ----------
function renderEvents() {
  const el = $('#events');
  if (!el) return;
  el.innerHTML = S.events.slice(0, 120).map((e) => `<div class="${e.fresh ? 'new' : ''}"><span>${timeSec(e.ts)}</span><span>#${e.seq}</span><b>${esc(e.type)}</b><span>${esc(e.ref ?? '')}</span><span class="faint">${esc(e.hash.slice(0, 16))}…</span></div>`).join('');
  for (const e of S.events) e.fresh = false;
}
function renderOps() {
  const log = $('#ops-log');
  if (!log) return;
  log.innerHTML = S.ops.map((m) => `<div class="msg ${m.from.id === S.session.peerId ? 'me' : ''}"><b>${esc(m.from.callsign ?? m.from.name)} · ${timeSec(new Date(m.ts).toISOString())}</b>${esc(m.text)}</div>`).join('') || '<div class="tiny faint">Messages to and from all units. Recorded.</div>';
  log.scrollTop = log.scrollHeight;
}

async function showLedgerFor(ref) {
  const { entries } = await S.session.api('GET', `/api/ledger?ref=${encodeURIComponent(ref)}&limit=500`);
  showModal(`<div class="spread" style="margin-bottom:10px"><h2>Evidence · ${esc(ref)}</h2><button class="btn sm" data-close-modal>Close</button></div>
    <table class="table"><tr><th>#</th><th>Time</th><th>Event</th><th>Data</th><th>Hash</th></tr>${entries.map((e) => `<tr><td>${e.seq}</td><td>${timeSec(e.ts)}</td><td>${esc(e.type)}</td><td class="small" style="max-width:320px;overflow-wrap:anywhere">${esc(JSON.stringify(e.data).slice(0, 180))}</td><td class="mono tiny">${esc(e.hash.slice(0, 16))}…</td></tr>`).join('')}</table>`, { wide: true });
}

async function openReport(id) {
  try { const r = await S.session.api('GET', `/api/reports/${id}`); showDocument(reportDocument(r), r.id); } catch (e) { toast(e.message); }
}

// ---------- pages ----------
const PAGES = {
  stops(page) {
    const list = S.state.stops.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    page.innerHTML = `<div class="page-head"><h1>Traffic stops</h1><span class="pill">${liveStops().length} live · ${list.length} today</span></div>
      <div class="card" style="padding:0"><table class="table"><tr><th>Started</th><th>Plate</th><th>Unit / officer</th><th>Driver</th><th>Reason</th><th>Status</th><th>Session</th><th>Tickets</th><th>Report</th></tr>
      ${list.map((s) => `<tr class="click" data-go="${s.id}"><td>${time(s.createdAt)}</td><td><span class="plate">${esc(fmtPlate(s.plate))}</span></td><td>${esc(s.officer?.unit ?? '')}<div class="tiny muted">${esc(s.officer?.name ?? '')}</div></td><td>${esc(s.driver?.name ?? '—')}</td><td>${esc(s.reason ?? '')}</td><td><span class="pill ${s.status === 'verified' ? 'ok' : s.status === 'failed' ? 'bad' : ''}">${esc(STOP_STATUS[s.status])}</span></td><td>${s.participants?.length ?? 0} connected</td><td>${(s.citations ?? []).map((c) => esc(c.id)).join('<br>') || '—'}</td><td>${esc(s.reportId ?? '—')}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No stops yet.</td></tr>'}</table></div>`;
    $$('[data-go]', page).forEach((r) => { r.onclick = () => { S.view = 'ops'; S.selected = r.dataset.go; render(); select(r.dataset.go); }; });
  },
  calls(page) {
    const list = S.state.alerts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    page.innerHTML = `<div class="page-head"><h1>Calls for service</h1><span class="pill">${openCalls().length} open</span></div>
      <div class="card" style="padding:0"><table class="table"><tr><th>Time</th><th>Priority</th><th>Type</th><th>Caller</th><th>Center</th><th>Units</th><th>Triage</th><th>Status</th></tr>
      ${list.map((a) => `<tr class="click" data-go="${a.id}"><td>${time(a.createdAt)}</td><td><span class="pill ${PRIORITY_TONE[a.triage?.priority]}">P${a.triage?.priority}</span></td><td>${esc(ALERT_LABEL[a.type] ?? a.type)}</td><td>${esc(a.driver?.name ?? 'Unverified')}</td><td>${esc(a.center?.name ?? '')}</td><td>${esc(a.assignments.map((x) => x.callsign).join(', '))}</td><td class="small">${esc(a.triage?.engine)}: ${esc(a.triage?.rationale)}</td><td>${esc(a.status)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No calls yet.</td></tr>'}</table></div>`;
    $$('[data-go]', page).forEach((r) => { r.onclick = () => { S.view = 'ops'; render(); select(r.dataset.go); }; });
  },
  units(page) {
    const list = S.state.units.slice().sort((a, b) => (a.type + a.callsign).localeCompare(b.type + b.callsign));
    page.innerHTML = `<div class="page-head"><h1>Units</h1><span class="pill">${list.filter((u) => u.status === 'available').length} available</span></div>
      <div class="card" style="padding:0"><table class="table"><tr><th>Callsign</th><th>Type</th><th>Agency</th><th>Officer</th><th>Status</th><th>Assignment</th><th>Location</th><th>Set status</th></tr>
      ${list.map((u) => `<tr><td><b>${esc(u.callsign)}</b>${u.simulated ? ' <span class="pill">sim</span>' : ' <span class="pill ok">live terminal</span>'}</td><td>${esc(u.type)}</td><td>${esc(u.agency ?? '')}</td><td>${esc(u.officer ?? '')}</td><td><span class="dot ${UNIT_TONE[u.status]}"></span> ${esc(UNIT_STATUS[u.status] ?? u.status)}</td><td>${esc(u.alertId ?? u.stopId ?? '—')}</td><td class="mono small">${coords(u.location)}</td>
        <td><select data-unit="${u.id}" style="width:auto;padding:4px 6px">${['', 'available', 'en_route', 'on_scene', 'busy', 'out_of_service'].map((s) => `<option value="${s}">${s ? UNIT_STATUS[s] : '—'}</option>`).join('')}</select></td></tr>`).join('')}</table></div>`;
    $$('[data-unit]', page).forEach((sel) => { sel.onchange = async () => { if (!sel.value) return; try { await S.session.api('POST', `/api/units/${sel.dataset.unit}/status`, { status: sel.value }); toast('Unit status updated'); } catch (e) { toast(e.message); } }; });
  },
  records(page) {
    if ($('#rq', page)) return;
    page.innerHTML = `<div class="page-head"><h1>Records</h1><span class="small muted">Every query is written to the audit ledger.</span></div>
      <form id="rq-form" class="row" style="flex-wrap:nowrap;max-width:720px"><input id="rq" placeholder="Plate, Oklahoma DL number, VIN, or name"><button class="btn primary">${icon('search')} Run</button></form><div id="rq-out" style="margin-top:14px"></div>`;
    $('#rq-form', page).onsubmit = async (e) => {
      e.preventDefault();
      const out = $('#rq-out', page);
      try {
        const r = await S.session.api('GET', `/api/lookup?q=${encodeURIComponent($('#rq', page).value)}`);
        out.innerHTML = r.results.map((x) => { const p = x.profile; const v = p.vehicle ?? {};
          return `<div class="card" style="margin-bottom:12px"><div class="spread"><div class="row"><div class="avatar">${esc(initials(p.name))}</div><div><b>${esc(p.name)}</b><div class="small muted">DOB ${esc(p.dob)} · ${esc(p.address ?? '')}</div></div></div>${x.credentialValid ? '<span class="pill ok">Credential valid</span>' : `<span class="pill bad">${esc(x.credentialProblem)}</span>`}</div>
            <div class="grid2" style="margin-top:12px"><dl class="kv"><dt>OK DL</dt><dd class="mono">${esc(p.licenseNumber)}</dd><dt>Vehicle</dt><dd>${esc(vehicleLine(v))}</dd><dt>Tag</dt><dd><span class="plate">${esc(fmtPlate(v.plate))}</span></dd><dt>VIN</dt><dd class="mono">${esc(v.vin ?? '')}</dd></dl>
            <ul class="checks">${x.checks.map((c) => `<li>${yn(c.ok)}<div><b>${esc(c.label)}</b><div class="tiny muted">${esc(c.detail)}</div></div></li>`).join('')}</ul></div>
            <p class="small muted" style="margin-top:10px">${x.history.length} CO-SYNE stop(s) · ${x.citations.length} citation(s)</p></div>`; }).join('') || '<div class="notice">No CO-SYNE record.</div>';
      } catch (err) { out.innerHTML = `<div class="notice bad">${esc(err.message)}</div>`; }
    };
  },
  async docs(page) {
    if (page.dataset.loading) return;
    page.dataset.loading = '1';
    try {
      const [{ citations }, { reports }] = await Promise.all([S.session.api('GET', '/api/citations'), S.session.api('GET', '/api/reports')]);
      const total = citations.filter((c) => c.type === 'citation').reduce((s, c) => s + c.totalFine, 0);
      const paid = citations.filter((c) => c.status === 'paid').reduce((s, c) => s + c.totalFine, 0);
      page.innerHTML = `<div class="page-head"><h1>Citations & reports</h1><button class="btn sm" id="docs-refresh">Refresh</button></div>
        <div class="stat-row"><div class="stat"><b>${citations.filter((c) => c.type === 'citation').length}</b><span>Citations</span></div><div class="stat"><b>${citations.filter((c) => c.type === 'warning').length}</b><span>Warnings</span></div><div class="stat"><b>${money(total)}</b><span>Fines issued (sample)</span></div><div class="stat"><b>${money(paid)}</b><span>Paid (simulated)</span></div></div>
        <div class="grid2"><div class="card" style="padding:0"><div class="col-head"><h4>Citations and warnings</h4></div><table class="table"><tr><th>Number</th><th>Driver</th><th>Officer</th><th>Amount</th><th>Status</th><th></th></tr>${citations.slice().reverse().map((c) => `<tr><td class="mono small">${esc(c.id)}</td><td>${esc(c.driver.name)}</td><td>${esc(c.officer.name)}</td><td>${c.type === 'citation' ? money(c.totalFine) : 'Warning'}</td><td>${esc(c.status)}${c.ack ? ' · ack' : ''}</td><td><button class="btn sm" data-c="${esc(c.id)}">${icon('printer')}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">None yet.</td></tr>'}</table></div>
        <div class="card" style="padding:0"><div class="col-head"><h4>Incident reports</h4></div><table class="table"><tr><th>Report</th><th>Filed</th><th>Officer</th><th>Disposition</th><th></th></tr>${reports.map((r) => `<tr><td class="mono small">${esc(r.id)}</td><td>${dateTime(r.filedAt)}</td><td>${esc(r.officer.name)}</td><td>${esc(r.disposition)}</td><td><button class="btn sm" data-r="${esc(r.id)}">${icon('printer')}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">None yet.</td></tr>'}</table></div></div>`;
      $$('[data-c]', page).forEach((b) => { b.onclick = () => { const c = citations.find((x) => x.id === b.dataset.c); showDocument(citationDocument(c), c.id); }; });
      $$('[data-r]', page).forEach((b) => { b.onclick = () => { const r = reports.find((x) => x.id === b.dataset.r); showDocument(reportDocument(r), r.id); }; });
      $('#docs-refresh', page).onclick = () => { delete page.dataset.loading; PAGES.docs(page); };
    } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
  },
  network(page) {
    const n = S.state.network;
    const turn = S.config.iceServers.some((s) => [].concat(s.urls).some((x) => String(x).startsWith('turn')));
    page.innerHTML = `<div class="page-head"><h1>CO-SYNE network</h1><span class="pill ok"><span class="dot ok"></span> ${n.devices.length} devices online</span></div>
      <div class="stat-row"><div class="stat"><b>${n.devices.filter((d) => d.role === 'officer').length}</b><span>Patrol terminals</span></div><div class="stat"><b>${n.devices.filter((d) => d.role === 'driver').length}</b><span>Driver phones</span></div><div class="stat"><b>${n.devices.filter((d) => d.role === 'dispatch').length}</b><span>Dispatch consoles</span></div><div class="stat"><b>${n.ledger.entries}</b><span>Ledger entries</span></div></div>
      <div class="card" style="padding:0;margin-bottom:14px"><table class="table"><tr><th>Device</th><th>Role</th><th>Unit / vehicle</th><th>Agency</th><th>Online</th><th>Sessions</th></tr>
        ${n.devices.map((d) => `<tr><td>${icon(d.role === 'driver' ? 'phone' : d.role === 'officer' ? 'shield' : 'headset')} ${esc(d.name)}</td><td>${esc(d.role)}</td><td>${esc(d.unitId ? S.state.units.find((u) => u.id === d.unitId)?.callsign ?? d.unitId : d.plate ? fmtPlate(d.plate) : '—')}</td><td>${esc(d.agency ?? '')}</td><td>${ago(d.since)}</td><td class="small">${esc(d.rooms.join(', ') || '—')}</td></tr>`).join('')}</table></div>
      <div class="grid2"><div class="card"><h4>Infrastructure</h4><dl class="kv" style="margin-top:8px"><dt>Server</dt><dd class="mono small">${esc(url('/'))}</dd><dt>Signaling</dt><dd>WebSocket, device-key sign-in</dd><dt>Media</dt><dd>WebRTC peer to peer, ${turn ? 'TURN relay configured' : 'STUN only'}</dd><dt>Ledger head</dt><dd class="mono small">${esc(n.ledger.head.slice(0, 32))}…</dd><dt>AI routing</dt><dd>${S.config.aiRouting ? 'Claude second-pass triage on' : 'Rules only'}</dd></dl></div>
        <div class="card"><h4>Coverage</h4>${S.state.centers.map((c) => `<p><b>${esc(c.name)}</b> <span class="pill">${esc(c.area)}</span><br><span class="small muted">${coords(c.location)}</span></p>`).join('')}</div></div>`;
  },
  async ledger(page) {
    page.innerHTML = `<div class="page-head"><h1>Evidence ledger</h1><span class="row"><input id="lf" placeholder="Filter by event or reference" style="width:260px"><button class="btn sm" id="lv">${icon('shieldCheck')} Verify chain</button></span></div><div class="card" style="padding:0"><table class="table" id="lt"></table></div>`;
    const draw = () => {
      const f = $('#lf', page).value.toLowerCase();
      $('#lt', page).innerHTML = `<tr><th>#</th><th>Time</th><th>Event</th><th>Reference</th><th>Hash</th><th>Signature</th></tr>${S.events.filter((e) => !f || e.type.includes(f) || String(e.ref ?? '').toLowerCase().includes(f)).slice(0, 300).map((e) => `<tr><td>${e.seq}</td><td>${timeSec(e.ts)}</td><td>${esc(e.type)}</td><td class="mono small">${esc(e.ref ?? '')}</td><td class="mono small">${esc(e.hash.slice(0, 24))}…</td><td>${e.sig ? '<span class="pill ok">Ed25519</span>' : '<span class="pill ok">signed</span>'}</td></tr>`).join('')}`;
    };
    $('#lf', page).oninput = draw;
    $('#lv', page).onclick = verifyLedger;
    draw();
    PAGES.ledger.draw = draw;
  },
  creds(page) {
    const devs = S.state.network.devices.filter((d) => d.role !== 'dispatch');
    page.innerHTML = `<div class="page-head"><h1>Credentials & trust</h1></div>
      <div class="grid2"><div class="card"><h4>Trust registry</h4><p class="small muted">Issuers whose signatures CO-SYNE accepts. Driver phones check officer credentials against these keys themselves.</p>${S.trust.map((i) => `<p><b>${esc(i.name)}</b> <span class="pill">${esc(i.issues)} credentials</span><br><span class="mono tiny muted">${esc(i.id)} · Ed25519 ${esc(i.publicJwk.x.slice(0, 22))}…</span></p>`).join('')}</div>
      <div class="card"><h4>Revoke a credential</h4><p class="small muted">Revocation takes effect immediately: the device is signed out and any stop it is on fails verification.</p>
        <table class="table"><tr><th>Device</th><th>Role</th><th></th></tr>${devs.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.role)}</td><td><button class="btn sm danger" data-revoke="${esc(d.peerId)}">Revoke</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No officer or driver devices online.</td></tr>'}</table>
        <form id="rv-form" class="row" style="flex-wrap:nowrap;margin-top:12px"><input id="rv-id" placeholder="or paste a credential id (cred_…)"><button class="btn sm danger">Revoke</button></form></div></div>`;
    const revoke = async (credentialId) => {
      if (!credentialId || !confirm(`Revoke credential ${credentialId}? This cannot be undone in the pilot.`)) return;
      try { await S.session.api('POST', `/api/credentials/${encodeURIComponent(credentialId)}/revoke`, { reason: 'revoked by dispatch' }); toast('Credential revoked'); } catch (e) { toast(e.message); }
    };
    $$('[data-revoke]', page).forEach((b) => { b.onclick = async () => { const id = await credentialForPeer(b.dataset.revoke); revoke(id); }; });
    $('#rv-form', page).onsubmit = (e) => { e.preventDefault(); revoke($('#rv-id', page).value.trim()); };
  },
};

async function credentialForPeer(peerId) {
  return S.state.network.devices.find((x) => x.peerId === peerId)?.credentialId ?? null;
}

// ---------- boot ----------
async function init() {
  ({ config: S.config, trust: S.trust } = await bootstrap());
  if (S.dispatcher?.token) connect(); else renderLogin();
}
window.cosyne = { S, select, joinCall, leaveCall, render };
init().catch((e) => { document.body.innerHTML = `<div class="notice bad" style="margin:40px">Cannot reach the CO-SYNE network: ${esc(e.message)}</div>`; });
