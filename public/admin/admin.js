// CO-SYNE Main Admin: oversight of the whole CO-SYNE system. System health,
// every connected device, the credential registry, agencies and units, live
// operations, the evidence ledger, system-wide notices, settings, and the
// installable modules.
import { api, bootstrap, url } from '../lib/session.js';
import { icon } from '../lib/icons.js';
import { modulesHtml, bindModules } from '../lib/modules.js';
import {
  $, $$, esc, money, timeSec, dateTime, ago, STOP_STATUS, UNIT_STATUS, UNIT_TONE, PRIORITY_TONE, ALERT_LABEL,
  citationDocument, reportDocument, showDocument, showModal, hideModal, toast,
} from '../lib/ui.js';

const S = {
  config: null, view: 'overview', overview: null, timer: null,
  admin: (() => { try { return JSON.parse(localStorage.getItem('cosyne:admin') ?? sessionStorage.getItem('cosyne:admin') ?? 'null'); } catch { return null; } })(),
  devRole: 'all', credFilter: { q: '', type: 'all', status: 'all' }, ledgerFilter: '',
};
const fmtPlate = (p = '') => (/^[A-Z]{3}\d{3}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p);
const ROLE_ICON = { driver: 'phone', officer: 'shield', dispatch: 'headset' };
const CRED_TONE = { valid: 'ok', revoked: 'bad', expired: 'warn', invalid: 'bad' };
const uptime = (s) => (s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`);

function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('cosyne:admin:theme', t); } catch { /* ignore */ } }
applyTheme((() => { try { return localStorage.getItem('cosyne:admin:theme') || 'night'; } catch { return 'night'; } })());

// REST calls with the admin session; an expired session returns to sign-in.
async function call(method, path, body) {
  try {
    return await api(method, path, body, S.admin?.token);
  } catch (e) {
    if (/sign in required|requires admin/.test(e.message)) signOut('Your admin session ended. Sign in again.');
    throw e;
  }
}

// ---------- sign-in ----------
function renderLogin(msg = '') {
  clearInterval(S.timer);
  $('#app').classList.add('hidden');
  const el = $('#login');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="login-card"><div class="row" style="gap:12px;margin-bottom:16px"><img src="../icons/admin.svg" width="44" height="44" alt=""><div><h2>CO-SYNE Main Admin</h2><div class="small muted">${esc(S.config.region.name)} · ${esc(S.config.pilot)}</div></div></div>
    <form id="login-form"><label>Administrator name</label><input name="name" required autocomplete="name" value="${esc(S.admin?.name ?? '')}" placeholder="e.g. A. Alexander">
      <label>Admin access code</label><input name="token" type="password" required autocomplete="current-password" value="${esc(S.config.adminHint ?? '')}">
      <label class="row" style="gap:8px;margin-top:12px;font-weight:400"><input type="checkbox" name="keep" checked style="width:auto"> Keep me signed in on this computer for 30 days</label>
      <button class="btn brand block lg" style="margin-top:14px">${icon('lock')} Sign in</button></form>
    <p class="small" style="color:var(--danger);min-height:1.2em" id="login-msg">${esc(msg)}</p>
    <p class="tiny faint">Administrative access to the whole CO-SYNE network. Every sign-in and action is recorded in the evidence ledger.</p></div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('POST', '/api/admin/login', { name: f.name, token: f.token, keep: Boolean(f.keep) });
      S.admin = { token: r.token, name: r.name };
      try { (r.keep ? localStorage : sessionStorage).setItem('cosyne:admin', JSON.stringify(S.admin)); } catch { /* ignore */ }
      start();
    } catch (err) { $('#login-msg').textContent = err.message; }
  };
}

function signOut(msg) {
  if (S.admin?.token && !msg) api('POST', '/api/admin/logout', null, S.admin.token).catch(() => {});
  S.admin = S.admin ? { name: S.admin.name } : null;
  try { sessionStorage.removeItem('cosyne:admin'); localStorage.removeItem('cosyne:admin'); if (S.admin?.name) localStorage.setItem('cosyne:admin', JSON.stringify(S.admin)); } catch { /* ignore */ }
  renderLogin(msg ?? '');
}

async function start() {
  try { S.overview = await call('GET', '/api/admin/overview'); } catch { return; }
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  render();
  clearInterval(S.timer);
  S.timer = setInterval(refresh, 5000);
}

async function refresh() {
  try { S.overview = await call('GET', '/api/admin/overview'); } catch { return; }
  renderChrome();
  // Live pages redraw; pages with forms keep what the admin is typing.
  if (['overview', 'devices', 'operations'].includes(S.view)) PAGES[S.view]($('#page'), { quiet: true });
}

// ---------- shell ----------
const VIEWS = [
  ['overview', 'Overview', 'activity'], ['demo', 'Demo control', 'check'], ['modules', 'Modules & downloads', 'layers'], ['devices', 'Network devices', 'network'],
  ['credentials', 'Credentials', 'id'], ['agencies', 'Agencies & units', 'users'], ['operations', 'Operations', 'siren'],
  ['ledger', 'Evidence ledger', 'database'], ['broadcast', 'System notices', 'bell'], ['program', 'State program', 'id'], ['leads', 'Website leads', 'message'], ['settings', 'Settings', 'settings'],
];

function render() {
  renderChrome();
  $('#main').innerHTML = '<div class="page" id="page"></div>';
  PAGES[S.view]($('#page'));
}

function renderChrome() {
  const o = S.overview;
  $('#sub').textContent = `${o.system.pilot} · v${o.system.version}${o.system.commit ? ` (${o.system.commit})` : ''}`;
  const badge = { leads: o.counts.leads?.new ? `<i class="n brand">${o.counts.leads.new}</i>` : '', devices: o.counts.devices.total ? `<i class="n brand">${o.counts.devices.total}</i>` : '', operations: o.counts.alerts.open + o.counts.stops.live ? `<i class="n">${o.counts.alerts.open + o.counts.stops.live}</i>` : '' };
  $('#side').innerHTML = VIEWS.map(([id, label, ic]) => `<button class="${S.view === id ? 'on' : ''}" data-view="${id}">${icon(ic)}<span>${esc(label)}</span>${badge[id] ?? ''}</button>`).join('')
    + `<hr><button data-theme-toggle>${icon(document.documentElement.dataset.theme === 'day' ? 'moon' : 'sun')}<span>${document.documentElement.dataset.theme === 'day' ? 'Night' : 'Day'} theme</span></button>
       <button data-href="../">${icon('home')}<span>Network home</span></button>`;
  $$('#side [data-view]').forEach((b) => { b.onclick = () => { S.view = b.dataset.view; $('#app').classList.remove('menu-open'); render(); }; });
  $('#side [data-theme-toggle]').onclick = () => { applyTheme(document.documentElement.dataset.theme === 'day' ? 'night' : 'day'); renderChrome(); };
  $('#side [data-href]').onclick = (e) => { location.href = e.currentTarget.dataset.href; };
  $('#menu').innerHTML = icon('list');
  $('#menu').onclick = () => $('#app').classList.toggle('menu-open');
  const ok = o.ledger.ok;
  $('#top-right').innerHTML = `<span class="pill ${ok ? 'ok' : 'bad'}" title="Evidence ledger"><span class="dot ${ok ? 'ok' : 'bad'}"></span>${ok ? 'System healthy' : 'LEDGER BROKEN'}</span>
    <span class="who row" style="gap:6px">${icon('user')} ${esc(S.admin?.name ?? '')}</span>
    <button class="btn sm ghost" id="signout" title="Sign out">${icon('logout')}</button>`;
  $('#signout').onclick = () => signOut();
}

// ---------- pages ----------
const PAGES = {
  async overview(page, { quiet } = {}) {
    const o = S.overview;
    const c = o.counts;
    let recent = [];
    try { recent = (await call('GET', '/api/ledger?limit=14')).entries.reverse(); } catch { /* ignore */ }
    const ub = c.units.byStatus;
    const unitBar = Object.entries(ub).map(([st, n]) => `<i style="width:${(n / c.units.total) * 100}%;background:var(--${{ ok: 'ok', warn: 'warn', bad: 'danger', info: 'info' }[UNIT_TONE[st]] ?? 'faint'})" title="${esc(UNIT_STATUS[st] ?? st)}: ${n}"></i>`).join('');
    page.innerHTML = `<div class="page-head"><div><h1>System overview</h1><p class="small muted">${esc(o.system.region)} · started ${dateTime(o.system.startedAt)} · up ${uptime(o.system.uptimeSec)}</p></div>
        <button class="btn sm" id="refresh">${icon('activity')} Refresh</button></div>
      ${o.warnings.length ? `<div class="warnings">${o.warnings.map((w) => `<div class="notice ${w.level === 'warn' ? 'warn' : ''}">${icon(w.level === 'warn' ? 'alert' : 'eye')} ${esc(w.text)}</div>`).join('')}</div>` : ''}
      <div class="stat-row">
        <div class="stat ${c.devices.total ? 'ok' : ''}"><b>${c.devices.total}</b><span>Devices online · ${c.devices.driver} driver, ${c.devices.officer} officer, ${c.devices.dispatch} dispatch</span></div>
        <div class="stat ${c.stops.live ? 'warn' : ''}"><b>${c.stops.live}</b><span>Live traffic stops · ${c.stops.total} total${c.stops.failed ? `, ${c.stops.failed} failed verification` : ''}</span></div>
        <div class="stat ${c.alerts.p1 ? 'bad' : ''}"><b>${c.alerts.open}</b><span>Open calls · ${c.alerts.p1} priority 1 · ${c.alerts.total} total</span></div>
        <div class="stat"><b>${c.citations.citations + c.citations.warnings}</b><span>Tickets · ${c.citations.citations} citations, ${c.citations.warnings} warnings</span></div>
        <div class="stat"><b>${c.reports}</b><span>Incident reports filed</span></div>
        <div class="stat ${o.ledger.ok ? 'ok' : 'bad'}"><b>${o.ledger.entries}</b><span>Ledger entries · ${o.ledger.ok ? 'chain intact' : `broken at #${o.ledger.brokenAt}`}</span></div>
      </div>
      <div class="grid2">
        <div class="card"><h4>System health</h4><dl class="kv">
          <dt>Version</dt><dd>${esc(o.system.version)}${o.system.commit ? ` · <span class="mono">${esc(o.system.commit)}</span>` : ''}</dd>
          <dt>Public URL</dt><dd class="mono small">${esc(o.system.publicUrl ?? url('/'))}</dd>
          <dt>Runtime</dt><dd>Node ${esc(o.system.node)} · ${o.system.memoryMb} MB memory</dd>
          <dt>Uptime</dt><dd>${uptime(o.system.uptimeSec)}</dd>
          <dt>Storage</dt><dd>${o.system.persistent ? 'Ledger and registry on disk' : '<span style="color:var(--warn)">In memory only</span>'}</dd>
          <dt>Video relay</dt><dd>${o.system.turn ? 'TURN configured' : 'STUN only'}</dd>
          <dt>Call routing</dt><dd>${o.system.aiRouting ? 'Rules + Claude second pass' : 'Rules engine'}</dd>
          <dt>Demo data</dt><dd>${o.system.demo ? '<span class="pill warn">on</span>' : '<span class="pill ok">off</span>'}</dd>
          <dt>Phone alerts</dt><dd>${c.push.subscriptions} phone${c.push.subscriptions === 1 ? '' : 's'} registered · ${c.push.sent} sent${c.push.failed ? `, ${c.push.failed} failed` : ''}</dd>
          <dt>Admin sessions</dt><dd>${c.adminSessions}</dd></dl></div>
        <div class="card"><h4>Modules</h4>${o.modules.map((m) => `<div class="mod-line"><img src="${url(`icons/${m.id}.svg`)}" width="28" height="28" alt=""><span class="grow"><b>${esc(m.name)}</b></span><span class="pill ${m.online ? 'ok' : ''}"><span class="dot ${m.online ? 'ok' : ''}"></span>${m.online} online</span><a class="btn sm" href="${url(`${m.id}/`)}" target="_blank" rel="noopener">Open</a></div>`).join('')}
          <div class="row" style="margin-top:10px"><button class="btn sm" data-go="modules">${icon('layers')} Install & download</button></div></div>
        <div class="card"><h4>Units · ${c.units.total}</h4><div class="bar" style="margin:6px 0 10px">${unitBar}</div>
          <div class="row">${Object.entries(ub).map(([st, n]) => `<span class="pill ${UNIT_TONE[st] ?? ''}">${esc(UNIT_STATUS[st] ?? st)} ${n}</span>`).join('')}</div>
          <h4 style="margin-top:14px">Credentials</h4><div class="row"><span class="pill">${c.credentials.driver} driver</span><span class="pill">${c.credentials.officer} officer</span><span class="pill">${c.credentials.stickers} stickers</span>${c.credentials.revoked ? `<span class="pill bad">${c.credentials.revoked} revoked</span>` : ''}</div></div>
        <div class="card"><div class="spread"><h4>Recent activity</h4><button class="btn sm ghost" data-go="ledger">Ledger ${icon('chevronRight')}</button></div>
          <div class="ev">${recent.map((e) => `<div><span>${timeSec(e.ts)}</span><b>${esc(e.type)}</b><span>${esc(e.ref ?? '')}</span></div>`).join('') || '<p class="muted">No activity yet.</p>'}</div></div>
      </div>`;
    $('#refresh', page).onclick = refresh;
    $$('[data-go]', page).forEach((b) => { b.onclick = () => { S.view = b.dataset.go; render(); }; });
  },

  async modules(page) {
    page.innerHTML = '<p class="muted">Loading modules…</p>';
    try {
      const mods = await api('GET', '/api/modules');
      const online = Object.fromEntries(S.overview.modules.map((m) => [m.id, m.online]));
      const pub = url('downloads/');
      page.innerHTML = `<div class="page-head"><div><h1>Modules & downloads</h1><p class="small muted">Install each CO-SYNE module on its device, or download launchers. The public page for drivers and agencies is <a href="${esc(pub)}" target="_blank" rel="noopener">${esc(pub)}</a>.</p></div>
        <span class="row"><button class="btn sm" data-copy="${esc(pub)}">${icon('link')} Copy public page link</button><a class="btn sm" href="${esc(pub)}" target="_blank" rel="noopener">Open public page</a></span></div>
        ${modulesHtml(mods, { online })}`;
      bindModules(page);
    } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
  },

  async devices(page, { quiet } = {}) {
    let net;
    try { net = await call('GET', '/api/admin/devices'); } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const list = net.devices.filter((d) => S.devRole === 'all' || d.role === S.devRole);
    const count = (r) => net.devices.filter((d) => d.role === r).length;
    page.innerHTML = `<div class="page-head"><div><h1>Network devices</h1><p class="small muted">Every phone, patrol terminal, and dispatch console signed in to CO-SYNE right now.</p></div>
        <div class="seg" id="roles">${[['all', `All ${net.devices.length}`], ['driver', `Drivers ${count('driver')}`], ['officer', `Officers ${count('officer')}`], ['dispatch', `Dispatch ${count('dispatch')}`]].map(([id, l]) => `<button class="${S.devRole === id ? 'on' : ''}" data-r="${id}">${l}</button>`).join('')}</div></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table class="table"><tr><th>Device</th><th>Role</th><th>Unit / vehicle</th><th>Agency</th><th>Online</th><th>Sessions</th><th></th></tr>
        ${list.map((d) => `<tr><td>${icon(ROLE_ICON[d.role] ?? 'user')} ${esc(d.name)}<div class="tiny faint mono">${esc(d.peerId)}</div></td><td>${esc(d.role)}</td><td>${esc(d.callsign ?? d.unitId ?? (d.plate ? fmtPlate(d.plate) : '—'))}</td><td>${esc(d.agency ?? '')}</td><td>${ago(d.since)}</td><td class="small">${esc(d.rooms.join(', ') || '—')}</td>
          <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-reset="${esc(d.peerId)}" title="End this device's session">Reset</button>${d.credentialId ? `<button class="btn sm danger" data-revoke="${esc(d.credentialId)}">Revoke</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No devices online.</td></tr>'}</table></div></div>
      <p class="small muted" style="margin-top:10px"><b>Reset</b> ends the device's session; a device with a valid credential signs back in on its own. <b>Revoke</b> invalidates the credential, so it cannot sign in or verify at a stop again.</p>`;
    $$('#roles [data-r]', page).forEach((b) => { b.onclick = () => { S.devRole = b.dataset.r; PAGES.devices(page); }; });
    $$('[data-reset]', page).forEach((b) => { b.onclick = async () => {
      try { await call('POST', `/api/admin/devices/${encodeURIComponent(b.dataset.reset)}/disconnect`); toast('Device session reset'); setTimeout(() => PAGES.devices(page), 400); } catch (e) { toast(e.message); }
    }; });
    $$('[data-revoke]', page).forEach((b) => { b.onclick = () => revoke(b.dataset.revoke, () => PAGES.devices(page)); });
  },

  async credentials(page) {
    let creds;
    try { ({ credentials: creds } = await call('GET', '/api/admin/credentials')); } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const f = S.credFilter;
    page.innerHTML = `<div class="page-head"><div><h1>Credential registry</h1><p class="small muted">Every officer and driver credential issued by or presented to CO-SYNE.</p></div>
        <div class="filters"><input id="cq" placeholder="Search name, plate, badge, id" value="${esc(f.q)}">
          <select id="ct"><option value="all">All types</option><option value="officer">Officers</option><option value="driver">Drivers</option></select>
          <select id="cs"><option value="all">Any status</option><option value="valid">Valid</option><option value="revoked">Revoked</option><option value="expired">Expired</option></select>
          <button class="btn sm" id="cr">${icon('activity')} Refresh</button></div></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table class="table" id="ctab"></table></div></div>`;
    $('#ct', page).value = f.type;
    $('#cs', page).value = f.status;
    const draw = () => {
      const q = f.q.toLowerCase();
      const rows = creds.filter((c) => (f.type === 'all' || c.type === f.type) && (f.status === 'all' || c.status === f.status)
        && (!q || [c.name, c.plate, c.badge, c.unit, c.id, c.licenseNumber, c.issuerName].some((v) => String(v ?? '').toLowerCase().includes(q))));
      $('#ctab', page).innerHTML = `<tr><th>Holder</th><th>Type</th><th>Issuer</th><th>Status</th><th>Issued</th><th>Expires</th><th>Source</th><th></th></tr>
        ${rows.map((c) => `<tr><td>${icon(c.type === 'officer' ? 'shield' : 'car')} <b>${esc(c.name ?? '—')}</b>${c.online ? ' <span class="pill ok"><span class="dot ok"></span>online</span>' : ''}
            <div class="tiny muted">${c.type === 'officer' ? `Badge ${esc(c.badge ?? '?')}${c.unit ? ` · ${esc(c.unit)}` : ''}` : `${c.plate ? `<span class="plate">${esc(fmtPlate(c.plate))}</span>` : ''} ${esc(c.licenseNumber ?? '')}`}</div><div class="tiny faint mono">${esc(c.id)}</div></td>
          <td>${esc(c.type)}</td><td class="small">${esc(c.issuerName)}</td>
          <td><span class="pill ${CRED_TONE[c.status] ?? ''}">${esc(c.status)}</span>${c.revoked ? `<div class="tiny muted">${esc(c.revoked.reason)} · ${dateTime(c.revoked.at)}</div>` : c.problem && c.status !== 'valid' ? `<div class="tiny muted">${esc(c.problem)}</div>` : ''}</td>
          <td class="small">${dateTime(c.issuedAt)}</td><td class="small">${dateTime(c.expiresAt)}</td><td class="small">${esc(c.source)}</td>
          <td><div class="row" style="flex-wrap:nowrap">${c.stickerId ? `<a class="btn sm" href="${url(`sticker.html?id=${encodeURIComponent(c.stickerId)}`)}" target="_blank" rel="noopener" title="Print sticker">${icon('qr')}</a>` : ''}
            ${c.status === 'revoked' ? `<button class="btn sm" data-reinstate="${esc(c.id)}">Reinstate</button>` : `<button class="btn sm danger" data-revoke="${esc(c.id)}">Revoke</button>`}</div></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No matching credentials.</td></tr>'}`;
      $$('[data-revoke]', page).forEach((b) => { b.onclick = () => revoke(b.dataset.revoke, () => PAGES.credentials(page)); });
      $$('[data-reinstate]', page).forEach((b) => { b.onclick = async () => {
        if (!confirm('Reinstate this credential? Its holder can sign in and verify at stops again.')) return;
        try { await call('POST', `/api/admin/credentials/${encodeURIComponent(b.dataset.reinstate)}/reinstate`); toast('Credential reinstated'); PAGES.credentials(page); } catch (e) { toast(e.message); }
      }; });
    };
    $('#cq', page).oninput = (e) => { f.q = e.target.value; draw(); };
    $('#ct', page).onchange = (e) => { f.type = e.target.value; draw(); };
    $('#cs', page).onchange = (e) => { f.status = e.target.value; draw(); };
    $('#cr', page).onclick = () => PAGES.credentials(page);
    draw();
  },

  async agencies(page) {
    let state;
    try { state = await call('GET', '/api/state'); } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const o = S.overview;
    page.innerHTML = `<div class="page-head"><div><h1>Agencies & units</h1><p class="small muted">Credential issuers CO-SYNE trusts, the dispatch centers that route calls, and every unit on the network.</p></div></div>
      <div class="grid2">
        <div class="card"><h4>Trust registry</h4>${o.issuers.map((i) => `<p><b>${esc(i.name)}</b> <span class="pill">${esc(i.kind)}</span> <span class="pill info">issues ${esc(i.issues)} credentials</span><br><span class="mono tiny muted">${esc(i.id)} · Ed25519 ${esc(i.publicJwk.x)}</span></p>`).join('')}
          <p class="tiny faint">Driver phones check officer credentials against these keys independently of the server.</p></div>
        <div class="card"><h4>Dispatch centers</h4>${o.centers.map((c) => `<p><b>${esc(c.name)}</b> <span class="pill">${esc(c.area)}</span><br><span class="small muted">${c.location.lat.toFixed(4)}, ${c.location.lng.toFixed(4)}</span></p>`).join('')}</div>
      </div>
      <div class="card" style="padding:0"><div class="col-head" style="padding:10px 12px"><h4 style="margin:0">Units · ${state.units.length}</h4></div><div class="table-wrap"><table class="table"><tr><th>Unit</th><th>Type</th><th>Agency</th><th>Area</th><th>Status</th><th>Assignment</th><th>Set status</th></tr>
        ${state.units.map((u) => `<tr><td><b>${esc(u.callsign)}</b>${u.officer ? `<div class="tiny muted">${esc(u.officer)}</div>` : ''}${u.simulated ? '<div class="tiny faint">simulated</div>' : ''}</td><td>${esc(u.type)}</td><td class="small">${esc(u.agency ?? '—')}</td><td>${esc(u.area)}</td>
          <td><span class="pill ${UNIT_TONE[u.status] ?? ''}">${esc(UNIT_STATUS[u.status] ?? u.status)}</span></td><td class="mono small">${esc(u.stopId ?? u.alertId ?? '—')}</td>
          <td><select data-unit="${esc(u.id)}" style="width:auto">${['', 'available', 'busy', 'out_of_service'].map((s) => `<option value="${s}">${s ? esc(UNIT_STATUS[s]) : 'Change…'}</option>`).join('')}</select></td></tr>`).join('')}</table></div></div>`;
    $$('[data-unit]', page).forEach((sel) => { sel.onchange = async () => {
      if (!sel.value) return;
      try { await call('POST', `/api/units/${encodeURIComponent(sel.dataset.unit)}/status`, { status: sel.value }); toast('Unit status updated'); PAGES.agencies(page); } catch (e) { toast(e.message); sel.value = ''; }
    }; });
  },

  async operations(page, { quiet } = {}) {
    let state; let cits; let reps;
    try {
      [state, { citations: cits }, { reports: reps }] = await Promise.all([call('GET', '/api/state'), call('GET', '/api/citations'), call('GET', '/api/reports')]);
    } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const stops = state.stops.slice().reverse();
    const alerts = state.alerts.slice().reverse();
    page.innerHTML = `<div class="page-head"><div><h1>Operations</h1><p class="small muted">Traffic stops, calls for service, tickets and reports across every agency. Dispatch handles the calls; this view is for oversight.</p></div><a class="btn sm" href="${url('dispatch/')}" target="_blank" rel="noopener">${icon('headset')} Open Dispatch</a></div>
      <div class="card" style="padding:0;margin-bottom:14px"><div class="col-head" style="padding:10px 12px"><h4 style="margin:0">Traffic stops · ${stops.length}</h4></div><div class="table-wrap"><table class="table"><tr><th>Started</th><th>Vehicle</th><th>Officer</th><th>Driver</th><th>Reason</th><th>Status</th><th>Tickets</th></tr>
        ${stops.map((s) => `<tr><td class="small">${dateTime(s.createdAt)}</td><td><span class="plate">${esc(fmtPlate(s.plate))}</span></td><td>${esc(s.officer?.name ?? '—')}<div class="tiny muted">${esc(s.officer?.unit ?? '')}</div></td><td>${esc(s.driver?.name ?? '—')}</td><td class="small">${esc(s.reason ?? '—')}</td>
          <td><span class="pill ${s.status === 'failed' ? 'bad' : s.status === 'ended' ? '' : s.status === 'verified' ? 'ok' : 'warn'}">${esc(STOP_STATUS[s.status] ?? s.status)}</span>${s.failure ? `<div class="tiny" style="color:var(--danger)">${esc(s.failure)}</div>` : ''}</td><td>${s.citations?.length ?? 0}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No traffic stops yet.</td></tr>'}</table></div></div>
      <div class="card" style="padding:0;margin-bottom:14px"><div class="col-head" style="padding:10px 12px"><h4 style="margin:0">Calls for service · ${alerts.length}</h4></div><div class="table-wrap"><table class="table"><tr><th>Received</th><th>Type</th><th>Priority</th><th>Caller</th><th>Center</th><th>Responders</th><th>Status</th></tr>
        ${alerts.map((a) => `<tr><td class="small">${dateTime(a.createdAt)}</td><td>${esc(ALERT_LABEL[a.type] ?? a.type)}</td><td><span class="pill ${PRIORITY_TONE[a.triage?.priority] ?? ''}">P${a.triage?.priority ?? '?'}</span></td><td>${esc(a.driver?.name ?? 'Unverified caller')}${a.driverVerified ? ' <span class="pill ok">verified</span>' : ''}</td><td class="small">${esc(a.center?.name ?? '')}</td>
          <td class="small">${esc(a.assignments.map((x) => x.callsign).join(', ') || '—')}</td><td>${esc(a.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No calls yet.</td></tr>'}</table></div></div>
      <div class="grid2">
        <div class="card" style="padding:0"><div class="col-head" style="padding:10px 12px"><h4 style="margin:0">Citations & warnings · ${cits.length}</h4></div><div class="table-wrap"><table class="table"><tr><th>Number</th><th>Driver</th><th>Amount</th><th>Status</th><th></th></tr>
          ${cits.slice().reverse().map((c) => `<tr><td class="mono small">${esc(c.id)}</td><td>${esc(c.driver.name)}</td><td>${c.type === 'citation' ? money(c.totalFine) : 'Warning'}</td><td>${esc(c.status)}${c.ack ? ' · ack' : ''}</td><td><button class="btn sm" data-c="${esc(c.id)}">${icon('printer')}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">None yet.</td></tr>'}</table></div></div>
        <div class="card" style="padding:0"><div class="col-head" style="padding:10px 12px"><h4 style="margin:0">Incident reports · ${reps.length}</h4></div><div class="table-wrap"><table class="table"><tr><th>Report</th><th>Filed</th><th>Officer</th><th>Disposition</th><th></th></tr>
          ${reps.map((r) => `<tr><td class="mono small">${esc(r.id)}</td><td class="small">${dateTime(r.filedAt)}</td><td>${esc(r.officer.name)}</td><td>${esc(r.disposition)}</td><td><button class="btn sm" data-r="${esc(r.id)}">${icon('printer')}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">None yet.</td></tr>'}</table></div></div>
      </div>`;
    $$('[data-c]', page).forEach((b) => { b.onclick = () => { const c = cits.find((x) => x.id === b.dataset.c); showDocument(citationDocument(c), c.id); }; });
    $$('[data-r]', page).forEach((b) => { b.onclick = () => { const r = reps.find((x) => x.id === b.dataset.r); showDocument(reportDocument(r), r.id); }; });
  },

  async ledger(page) {
    let entries;
    try { ({ entries } = await call('GET', '/api/ledger?limit=1000')); } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    entries.reverse();
    const v = S.overview.ledger;
    page.innerHTML = `<div class="page-head"><div><h1>Evidence ledger</h1><p class="small muted">Append-only, SHA-256 hash-chained and Ed25519-signed. Every alert, stop, identity check, ticket, records query and admin action is recorded here.</p></div>
        <div class="filters"><input id="lf" placeholder="Filter by event or reference" value="${esc(S.ledgerFilter)}"><button class="btn sm" id="lv">${icon('shieldCheck')} Verify chain</button><button class="btn sm" id="lx">${icon('file')} Export JSONL</button></div></div>
      <div class="notice ${v.ok ? 'ok' : 'bad'}" id="lstatus" style="margin-bottom:12px">${v.ok ? `Chain intact: ${v.length} entries verified. Head <span class="mono small">${esc(String(v.head).slice(0, 32))}…</span>` : `Chain BROKEN at entry #${v.brokenAt}: ${esc(v.reason)}`}</div>
      <div class="card" style="padding:0"><div class="table-wrap"><table class="table" id="lt"></table></div></div>
      <p class="tiny faint" style="margin-top:8px">Showing the latest ${entries.length} entries. Export downloads the complete ledger.</p>`;
    const draw = () => {
      const f = S.ledgerFilter.toLowerCase();
      $('#lt', page).innerHTML = `<tr><th>#</th><th>Time</th><th>Event</th><th>Reference</th><th>Hash</th></tr>${entries.filter((e) => !f || e.type.includes(f) || String(e.ref ?? '').toLowerCase().includes(f)).slice(0, 500).map((e) => `<tr class="click" data-seq="${e.seq}"><td>${e.seq}</td><td class="small">${dateTime(e.ts)}</td><td>${esc(e.type)}</td><td class="mono small">${esc(e.ref ?? '')}</td><td class="mono small">${esc(e.hash.slice(0, 20))}…</td></tr>`).join('')}`;
      $$('[data-seq]', page).forEach((tr) => { tr.onclick = () => {
        const e = entries.find((x) => x.seq === Number(tr.dataset.seq));
        showModal(`<div class="spread" style="margin-bottom:10px"><h2>Ledger entry #${e.seq}</h2><button class="btn sm" data-close-modal>Close</button></div><pre class="json">${esc(JSON.stringify(e, null, 2))}</pre>`);
      }; });
    };
    $('#lf', page).oninput = (e) => { S.ledgerFilter = e.target.value; draw(); };
    $('#lv', page).onclick = async () => {
      const r = await api('GET', '/api/ledger/verify');
      $('#lstatus', page).className = `notice ${r.ok ? 'ok' : 'bad'}`;
      $('#lstatus', page).textContent = r.ok ? `Chain intact: ${r.length} entries re-verified just now.` : `Chain BROKEN at entry #${r.brokenAt}: ${r.reason}`;
    };
    $('#lx', page).onclick = exportLedger;
    draw();
  },

  broadcast(page) {
    const notices = S.overview.notices;
    page.innerHTML = `<div class="page-head"><div><h1>System notices</h1><p class="small muted">Send a notice that appears as a banner in every connected app you choose: driver phones, patrol terminals, and dispatch consoles.</p></div></div>
      <div class="grid2"><div class="card"><h4>New notice</h4><form id="bf">
          <label>Message</label><textarea name="text" rows="3" maxlength="500" required placeholder="e.g. Scheduled maintenance tonight 2:00–2:15 AM. Video calls may drop briefly."></textarea>
          <div class="row" style="flex-wrap:nowrap;gap:12px"><div class="grow"><label>Audience</label><select name="audience"><option value="all">Everyone</option><option value="driver">Driver phones</option><option value="officer">Officer terminals</option><option value="dispatch">Dispatch consoles</option></select></div>
            <div class="grow"><label>Level</label><select name="level"><option value="info">Information</option><option value="warn">Warning</option><option value="critical">Critical</option></select></div></div>
          <label class="check" style="margin-top:10px"><input type="checkbox" name="pinned"> Also show to devices that sign in later (pinned)</label>
          <button class="btn brand" style="margin-top:6px">${icon('send')} Send notice</button></form></div>
        <div class="card"><h4>Sent notices</h4>${notices.map((n) => `<div class="notice ${n.level === 'critical' ? 'bad' : n.level === 'warn' ? 'warn' : ''}" style="margin-bottom:6px"><div class="spread"><b>${esc(n.audience === 'all' ? 'Everyone' : n.audience)} · ${esc(n.level)}</b><span class="tiny muted">${dateTime(n.at)} · ${esc(n.by)}</span></div>${esc(n.text)}
          ${n.pinned ? `<div class="row" style="margin-top:6px"><span class="pill brand">pinned</span><button class="btn sm" data-unpin="${esc(n.id)}">Unpin</button></div>` : ''}</div>`).join('') || '<p class="muted">No notices sent yet.</p>'}</div></div>`;
    $('#bf', page).onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        const r = await call('POST', '/api/admin/broadcast', { text: f.text, audience: f.audience, level: f.level, pinned: Boolean(f.pinned) });
        toast(`Notice delivered to ${r.delivered} device${r.delivered === 1 ? '' : 's'}`);
        await refresh();
        PAGES.broadcast(page);
      } catch (err) { toast(err.message); }
    };
    $$('[data-unpin]', page).forEach((b) => { b.onclick = async () => { try { await call('POST', `/api/admin/broadcast/${b.dataset.unpin}/unpin`); await refresh(); PAGES.broadcast(page); } catch (err) { toast(err.message); } }; });
  },

  async demo(page) {
    let d;
    try { d = await call('GET', '/api/admin/demo'); } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const kit = (() => { try { const k = JSON.parse(sessionStorage.getItem('cosyne:admin:demo-kit') ?? 'null'); return k && Date.parse(k.expiresAt) > Date.now() ? k : null; } catch { return null; } })();
    const status = new Map();
    for (const p of d.passes) if (!status.has(p.module)) status.set(p.module, p.status);
    const MOD_ICON = { dispatch: 'headset', officer: 'shield', state: 'id', driver: 'phone', 'driver-pending': 'clock' };
    const PILL = { ready: 'ok', used: '', expired: 'warn', revoked: 'bad' };
    const label = (st) => (st === 'ready' ? 'Ready' : st[0].toUpperCase() + st.slice(1));
    const person = (m, fallback) => kit?.kit.find((k) => k.module === m)?.who.split(' · ')[0] ?? fallback;
    page.innerHTML = `<div class="page-head"><div><h1>Demo control</h1><p class="small muted">One-time links that open each module already signed in, so a demo needs no typed codes. Links work once, expire after ${d.hours} hours by default, and only while demo mode is on. The real access codes don't change.</p></div>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" id="dm-reset">${icon('activity')} Reset demo</button><button class="btn sm" id="dm-revoke">${icon('x')} Revoke all links</button></div></div>
      ${d.enabled ? '' : '<div class="notice bad">Demo mode is off on this server (COSYNE_DEMO=off), so demo links are refused.</div>'}
      <div class="demo-layout"><div>
        <div class="card demo-prep"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <label class="grow" style="min-width:220px"><span class="small muted">Officer for the patrol terminal</span><select id="dm-officer">${d.officers.map((o) => `<option value="${esc(o.key)}">${esc(o.name)} · Badge ${esc(o.badge)} · ${esc(o.unit)} · ${esc(o.agency)}</option>`).join('')}</select></label>
          <label><span class="small muted">Links last</span><select id="dm-hours">${[2, 4, 8, 12, 24].map((h) => `<option value="${h}"${h === d.hours ? ' selected' : ''}>${h} hours</option>`).join('')}</select></label>
          <button class="btn brand" id="dm-prepare" ${d.enabled ? '' : 'disabled'}>${icon('check')} Prepare full demo</button>
          ${kit ? `<button class="btn" id="dm-launch">${icon('layers')} Launch all on this computer</button>` : ''}
        </div><p class="tiny muted" style="margin:10px 0 0">Preparing a new demo replaces any links that haven't been used yet. Each link signs in one window or phone, once.</p></div>
        ${kit ? `<div class="demo-cards">${kit.kit.map((k) => { const st = status.get(k.module) ?? 'ready'; return `<div class="card demo-card ${st}">
            <div class="row" style="gap:10px;align-items:flex-start"><span class="demo-ico">${icon(MOD_ICON[k.module] ?? 'grid')}</span><div class="grow"><b>${esc(k.title)}</b><div class="small muted">${esc(k.who)}</div></div><span class="pill ${PILL[st] ?? ''}">${label(st)}</span></div>
            <div class="demo-body"><div class="demo-qr" title="Scan with a phone or another computer">${k.qr}</div>
              <div class="grow" style="min-width:0"><input class="demo-link" readonly value="${esc(k.link)}" aria-label="${esc(k.title)} link">
                <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn sm" data-copy="${esc(k.module)}">${icon('link')} Copy</button><button class="btn sm brand" data-open="${esc(k.module)}" ${st === 'ready' ? '' : 'disabled'}>${icon('chevronRight')} Open</button></div>
                <p class="tiny muted" style="margin:8px 0 0">${k.module === 'driver-pending' ? 'Best on a second phone: approve it in the State console during the demo.' : k.module === 'driver' ? 'Scan with the driver phone, or open here in its own window.' : 'Opens in its own window.'}</p></div></div></div>`; }).join('')}</div>
          <div class="card" style="margin-top:14px"><h4>Fallback codes</h4><p class="small muted">If a link is used up mid-demo, sign in by hand. Revealing the access codes is recorded in the ledger.</p>
            <dl class="kv"><dt>Driver activation code</dt><dd><span class="mono">${esc(kit.activationCode ?? '—')}</span> <span class="tiny muted">${esc(kit.activationFor ?? '')} · "Activate with a code" in the Driver app</span></dd></dl>
            <div id="dm-codes" style="margin-top:10px"><button class="btn sm" id="dm-reveal">${icon('eye')} Reveal access codes</button></div></div>`
        : '<div class="card empty" style="margin-top:14px">Choose the officer and press <b>Prepare full demo</b>. You get a link and QR code for Dispatch, the Officer terminal, the State console, an approved driver phone, and a driver phone with an application waiting for approval.</div>'}
        <div class="card" style="margin-top:14px;padding:0"><div class="table-wrap"><table class="table"><tr><th>Link</th><th>Signs in as</th><th>Created</th><th>Status</th></tr>
          ${d.passes.map((p) => `<tr><td><b>${esc(p.title)}</b><div class="tiny muted mono">${esc(p.id)}</div></td><td class="small">${esc(p.who)}</td><td class="small">${dateTime(p.createdAt)}<div class="tiny muted">expires ${dateTime(p.expiresAt)}</div></td><td><span class="pill ${PILL[p.status] ?? ''}">${esc(label(p.status))}</span>${p.usedAt ? `<div class="tiny muted">${dateTime(p.usedAt)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No demo links yet.</td></tr>'}</table></div></div>
      </div>
      <aside class="card demo-script"><h4>Demo script</h4><ol>
        <li><b>Dispatch</b> (big screen): the Tulsa map with patrol units live.</li>
        <li><b>Driver phone</b>: open the approved driver link. Show the wallet ID, and the sticker and membership on the Me tab.</li>
        <li><b>Officer terminal</b>: open the Sticker Scanner, pick ${esc(person('driver', 'the demo driver'))}'s vehicle under Pilot vehicles, choose a reason and start the stop.</li>
        <li><b>Driver phone</b>: the verified officer, badge and reason appear before the approach. Accept the video call.</li>
        <li><b>Dispatch</b>: the stop appears live. Join the call or watch the ledger.</li>
        <li><b>Officer</b>: run the records check, then issue a citation or warning. It arrives on the phone.</li>
        <li><b>Officer</b>: end the stop and file the report. It is sealed in the ledger.</li>
        <li><b>State console</b>: in Applications, open ${esc(person('driver-pending', 'the waiting application'))}, check REAL ID, approve and issue. The second phone receives its credential.</li>
        <li><b>State console</b>: print the letter and sticker set, then show Revenue: $9.50 of each $24.99 to the state.</li>
        <li><b>Main Admin</b>: the overview and evidence ledger, then <b>Reset demo</b> for the next audience.</li>
      </ol></aside></div>`;

    const findKit = (m) => kit?.kit.find((k) => k.module === m);
    const WIN = { dispatch: 'width=1500,height=900,left=0,top=0', officer: 'width=1366,height=820,left=60,top=40', state: 'width=1366,height=860,left=120,top=80', driver: 'width=430,height=900,left=1000,top=60', 'driver-pending': 'width=430,height=900,left=1040,top=90' };
    const openMod = (m) => window.open(findKit(m).link, `cosyne-demo-${m}`, WIN[m]);
    const later = () => setTimeout(() => { if (S.view === 'demo') PAGES.demo(page); }, 2500);
    $('#dm-prepare', page).onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        const k = await call('POST', '/api/admin/demo/prepare', { officerKey: $('#dm-officer', page).value, hours: Number($('#dm-hours', page).value) });
        try { sessionStorage.setItem('cosyne:admin:demo-kit', JSON.stringify(k)); } catch { /* ignore */ }
        toast('Demo links ready');
      } catch (err) { toast(err.message); }
      PAGES.demo(page);
    };
    $('#dm-launch', page)?.addEventListener('click', () => {
      const blocked = kit.kit.filter((k) => k.desktop && (status.get(k.module) ?? 'ready') === 'ready').filter((k) => !openMod(k.module));
      if (blocked.length) toast(`Your browser blocked ${blocked.length} window${blocked.length > 1 ? 's' : ''}. Allow pop-ups for this site, or use the Open buttons.`);
      later();
    });
    $$('[data-open]', page).forEach((b) => { b.onclick = () => { if (!openMod(b.dataset.open)) toast('Allow pop-ups for this site to open demo windows.'); later(); }; });
    $$('[data-copy]', page).forEach((b) => {
      b.onclick = async () => {
        try { await navigator.clipboard.writeText(findKit(b.dataset.copy).link); toast('Link copied'); } catch { b.closest('.demo-card').querySelector('.demo-link').select(); toast('Press Ctrl+C to copy'); }
      };
    });
    $('#dm-revoke', page).onclick = async () => {
      if (!confirm('Revoke every unused demo link and demo dispatch sign-in?')) return;
      try { const r = await call('POST', '/api/admin/demo/revoke'); toast(`Revoked ${r.revoked} link${r.revoked === 1 ? '' : 's'}`); } catch (err) { toast(err.message); }
      PAGES.demo(page);
    };
    $('#dm-reset', page).onclick = async () => {
      if (!confirm('Reset the demo? Stops, citations, alerts, reports and state program applications are cleared (a backup is saved first), unused links are revoked, and the sample applications are recreated.')) return;
      try {
        const r = await call('POST', '/api/admin/demo/reset');
        try { sessionStorage.removeItem('cosyne:admin:demo-kit'); } catch { /* ignore */ }
        toast(`Demo reset. Backup saved: ${r.backup ?? 'none'}`);
        await refresh();
      } catch (err) { toast(err.message); }
      PAGES.demo(page);
    };
    $('#dm-reveal', page)?.addEventListener('click', async () => {
      try {
        const c = await call('POST', '/api/admin/demo/codes');
        $('#dm-codes', page).innerHTML = `<dl class="kv"><dt>Dispatch console</dt><dd class="mono">${esc(c.dispatch)}</dd><dt>State Issuer Console</dt><dd class="mono">${esc(c.state ?? 'not set')}</dd><dt>Officer enrollment</dt><dd class="mono">${esc(c.officerEnroll)}</dd></dl>`;
      } catch (err) { toast(err.message); }
    });
    // Keep link status current while the page is open (paused while codes are revealed).
    clearTimeout(S.demoTimer);
    S.demoTimer = setTimeout(() => { if (S.view === 'demo' && document.body.contains(page) && !document.hidden && !page.querySelector('#dm-codes dl')) PAGES.demo(page); }, 8000);
  },

  async program(page) {
    await refresh();
    const p = S.overview.program;
    const c = p.counts;
    const usd = (n) => `${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const active = (c.issued ?? 0) + (c.active ?? 0);
    page.innerHTML = `<div class="page-head"><div><h1>State program</h1><p class="small muted">CO-SYNE enrollments issued by state DMVs through the <a href="${esc(url('state/'))}" target="_blank" rel="noopener">State Issuer Console</a>. Annual fee ${usd(p.fee)}: ${Math.round(p.stateShareRate * 100)}% to the state, the rest for program administration. Payments are simulated in the pilot.</p></div>
        <button class="btn sm" id="pr">${icon('activity')} Refresh</button></div>
      <div class="stat-row">
        <div class="stat"><b>${Object.values(c).reduce((a, b) => a + b, 0)}</b><span>Applications</span></div>
        <div class="stat ${c.submitted + c.verified ? 'warn' : ''}"><b>${(c.submitted ?? 0) + (c.verified ?? 0)}</b><span>Awaiting state review</span></div>
        <div class="stat ok"><b>${active}</b><span>Enrolled residents</span></div>
        <div class="stat"><b>${usd(p.revenue.amount)}</b><span>Fees collected · ${p.revenue.count} payments</span></div>
        <div class="stat ok"><b>${usd(p.revenue.stateShare)}</b><span>State share</span></div>
        <div class="stat"><b>${usd(p.revenue.adminFee)}</b><span>Administration</span></div>
      </div>
      <div class="card" style="padding:0"><div class="table-wrap"><table class="table"><tr><th>State issuer</th><th>Code</th><th>Applications</th><th>Collected</th><th>State share</th><th>Administration</th></tr>
        ${p.jurisdictions.map((j) => `<tr><td><b>${esc(j.issuerName ?? j.name)}</b>${j.demo ? ' <span class="pill warn">demo</span>' : ''}</td><td class="mono">${esc(j.code)}</td><td>${j.applications}</td><td>${usd(j.revenue.amount)}</td><td>${usd(j.revenue.stateShare)}</td><td>${usd(j.revenue.adminFee)}</td></tr>`).join('')}</table></div></div>
      <div class="card" style="margin-top:14px"><h4>Applications by status</h4><dl class="kv">${Object.entries(c).map(([k, n]) => `<dt>${esc(k[0].toUpperCase() + k.slice(1))}</dt><dd>${n}</dd>`).join('')}</dl></div>`;
    $('#pr', page).onclick = () => PAGES.program(page);
  },

  async leads(page) {
    let leads;
    try { ({ leads } = await call('GET', '/api/admin/leads')); } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    const TYPE = { agency: 'Law enforcement agency', dispatch: 'Dispatch / 911 center', driver: 'Driver', hardware: 'Vehicle hardware', partner: 'Partner', investor: 'Investor', state: 'State or federal agency', press: 'Press', other: 'Other' };
    page.innerHTML = `<div class="page-head"><div><h1>Website leads</h1><p class="small muted">Demo requests, hardware interest and questions sent from the public website (<a href="${esc(url('cosyne_contact.html'))}" target="_blank" rel="noopener">contact page</a>). Personal details stay in the leads file, not the ledger.</p></div>
        <button class="btn sm" id="lr">${icon('activity')} Refresh</button></div>
      <div class="stat-row">${Object.entries(TYPE).map(([k, l]) => ({ k, l, n: leads.filter((x) => x.type === k).length })).filter((x) => x.n).map((x) => `<div class="stat"><b>${x.n}</b><span>${esc(x.l)}</span></div>`).join('') || '<div class="stat"><b>0</b><span>Leads so far</span></div>'}</div>
      <div class="card" style="padding:0"><div class="table-wrap"><table class="table"><tr><th>Received</th><th>Contact</th><th>Organization</th><th>Interest</th><th>Message</th></tr>
        ${leads.map((l) => `<tr><td class="small">${dateTime(l.at)}</td><td><b>${esc(l.name)}</b><div class="small"><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>${l.phone ? `<div class="tiny muted">${esc(l.phone)}</div>` : ''}</td>
          <td class="small">${esc(l.organization || '—')}${l.role ? `<div class="tiny muted">${esc(l.role)}</div>` : ''}</td><td><span class="pill ${l.type === 'agency' || l.type === 'dispatch' || l.type === 'state' ? 'brand' : ''}">${esc(TYPE[l.type] ?? l.type)}</span></td>
          <td class="small" style="max-width:420px;white-space:pre-wrap">${esc(l.message || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No leads yet. They appear here when someone sends the contact form.</td></tr>'}</table></div></div>`;
    $('#lr', page).onclick = () => PAGES.leads(page);
  },

  async settings(page) {
    let st;
    try { st = await call('GET', '/api/admin/settings'); } catch (e) { page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return; }
    page.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p class="small muted">Your admin password, open demo mode, and the server configuration. Access codes are never shown here.</p></div></div>
      <div class="grid2" style="margin-bottom:14px">
        <div class="card"><h4>${icon('lock')} Admin password</h4><p class="small muted">${st.passwordSet ? `Your own password is in use (changed ${dateTime(st.passwordUpdatedAt)}).` : 'You are using the server access code. Set a password you can remember; it replaces the code for signing in here.'}</p>
          <form id="pw-form" class="stack" style="gap:8px"><label class="small">Current password or access code<input name="current" type="password" required autocomplete="current-password"></label>
            <label class="small">New password <span class="muted">(at least 6 characters)</span><input name="next" type="password" required minlength="6" autocomplete="new-password"></label>
            <label class="small">Confirm new password<input name="confirm" type="password" required minlength="6" autocomplete="new-password"></label>
            <button class="btn brand">Save new password</button><span class="small" id="pw-msg"></span></form>
          <p class="tiny faint" style="margin-top:10px">Forgot it? On the server, delete <code>data/admin-auth.json</code> and restart CO-SYNE; the access code in /etc/cosyne/cosyne.env works again.</p></div>
        <div class="card"><h4>${icon('users')} Open demo mode</h4>
          <p class="small muted">When on, Dispatch, the Officer terminal, the State Issuer Console and the Driver app open without any access codes: just a Continue button. The Main Admin still needs your password. Each module shows an "Open demo" badge.</p>
          ${st.demoMode ? `<div class="row" style="gap:10px;margin-top:6px"><span class="pill ${st.openDemo ? 'ok' : ''}">${st.openDemo ? 'On' : 'Off'}</span><button class="btn ${st.openDemo ? '' : 'brand'}" id="od-toggle">${st.openDemo ? 'Turn off (require codes)' : 'Turn on'}</button></div>` : '<div class="notice">Demo mode is off on this server (COSYNE_DEMO=off), so open demo is not available.</div>'}</div>
      </div>
      <div class="card" style="padding:0;margin-bottom:14px"><div class="table-wrap"><table class="table"><tr><th>Setting</th><th>Value</th><th>Purpose</th></tr>
        ${st.settings.map((s) => `<tr><td class="mono small">${esc(s.key)}</td><td>${s.secret ? `<span class="pill ${/^set/.test(s.value) ? 'ok' : 'warn'}">${esc(s.value)}</span>` : `<span class="mono small">${esc(s.value ?? '—')}</span>`}</td><td class="small muted">${esc(s.note)}</td></tr>`).join('')}</table></div></div>
      <div class="grid2"><div class="card"><h4>Changing settings</h4><p class="small">Settings live in <code>/etc/cosyne/cosyne.env</code> on the server. After editing, restart the service:</p><pre class="json">sudo systemctl restart cosyne</pre>
        <p class="small muted">Data directory: <code>${esc(st.dataDir ?? 'none (in memory)')}</code>. The ledger, credential registry and sample identities are kept there; back it up with the server.</p></div>
        <div class="card"><h4>Security checklist</h4><ul class="checks">${S.overview.warnings.map((w) => `<li><span class="mark bad">!</span><span class="small">${esc(w.text)}</span></li>`).join('') || '<li><span class="mark ok">✓</span>No open items.</li>'}</ul></div></div>`;
    $('#pw-form', page).onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const msg = $('#pw-msg', page);
      if (f.next !== f.confirm) { msg.textContent = 'The two new passwords do not match.'; return; }
      try { await call('POST', '/api/admin/password', f); e.target.reset(); msg.textContent = 'Saved. Use your new password next time you sign in.'; toast('Admin password changed'); } catch (err) { msg.textContent = err.message; }
    };
    $('#od-toggle', page)?.addEventListener('click', async () => {
      try { const r = await call('POST', '/api/admin/open-demo', { on: !st.openDemo }); toast(r.openDemo ? 'Open demo is on: no codes in the modules' : 'Open demo is off: modules need their codes'); } catch (err) { toast(err.message); }
      PAGES.settings(page);
    });
  },
};

// ---------- actions ----------
async function revoke(id, after) {
  const reason = prompt(`Revoke credential ${id}?\nIts holder is signed out immediately and cannot verify at a stop.\n\nReason:`, 'revoked by administrator');
  if (reason == null) return;
  try { await call('POST', `/api/admin/credentials/${encodeURIComponent(id)}/revoke`, { reason: reason || 'revoked by administrator' }); toast('Credential revoked'); after?.(); } catch (e) { toast(e.message); }
}

async function exportLedger() {
  try {
    const res = await fetch(url('/api/admin/ledger/export'), { headers: { authorization: `Bearer ${S.admin.token}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'cosyne-ledger.jsonl';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Ledger exported');
  } catch (e) { toast(e.message); }
}

// ---------- boot ----------
async function init() {
  ({ config: S.config } = await bootstrap());
  if (S.admin?.token) start(); else renderLogin();
}
window.cosyne = { S, render, hideModal };
init().catch((e) => { document.body.innerHTML = `<div class="notice bad" style="margin:40px">Cannot reach the CO-SYNE network: ${esc(e.message)}</div>`; });
