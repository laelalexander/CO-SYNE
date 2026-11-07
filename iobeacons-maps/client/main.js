import { get, post, patch, del, api, ApiError, BASE } from './api.js';
import { h, $, clear, toast, modal, closeModal } from './ui.js';
import { state, on, emit, isEditor, can } from './state.js';
import {
  initMap, map, setBasemap, renderAll, renderLayer, renderSystem, updateSystemData, apply3d, setGlobe, fitTo, boundsOf, dropCache,
} from './mapview.js';
import { startDraw, stopDraw, saveEdit, stopEdit, describeGeometry } from './draw.js';
import { PANELS, showInspector, hideInspector, openLayerEditor, runReportAt, openSiteInspector, newMap } from './panels.js';
import { setWorkspaceHooks, notesPanel, openWorkspace, closeWorkspace, hasWorkspace, orbitWorkspace, openSharedFinding } from './workspace.js';
import { openAuth, openSettings, openShare, showUpgrade, acceptInvite, openReset } from './settings.js';
import { mountSiteHeader } from '../site/public/site-assets/site-header.js';
import { spacePanel, selectSat, toggleGroup, setSatellites, spaceOn } from './space.js';

PANELS.space = spacePanel;
PANELS.notes = notesPanel;

// ---------- boot ----------
export async function loadSession() {
  state.session = await get('/session');
  document.title = `${state.session.brand.name}`;
  document.documentElement.style.setProperty('--brand', state.session.brand.color || '#2876ee');
  return state.session;
}

export async function loadWorkspaceData() {
  const [sites, zones, devices, catalog] = await Promise.all([
    get('/sites').catch(() => state.sites), get('/zones').catch(() => state.zones), get('/devices').catch(() => state.devices), get('/catalog').catch(() => []),
  ]);
  Object.assign(state, { sites, zones, devices, catalog });
  updateSystemData();
}

export async function refreshSites() { state.sites = await get('/sites'); updateSystemData(); emit('sites'); }
export async function refreshZones() { state.zones = await get('/zones'); updateSystemData(); emit('zones'); }
export async function refreshDevices() { state.devices = await get('/devices'); updateSystemData(); emit('devices'); }

export async function openMap(id, { fit = false } = {}) {
  hideInspector();
  stopDraw();
  const rec = await get(`/maps/${id}`);
  const styleChanged = state.mapRec?.style !== rec.style;
  state.mapRec = rec;
  state.activeLayerId = rec.layers.find((l) => l.kind === 'features')?.id || null;
  dropCache();
  try { history.replaceState(null, '', `#map=${rec.id}`); } catch { /* ignore */ }
  renderTop();
  if (!map) {
    initMap($('#map'), { style: rec.style, view: rec.view });
    document.body.dataset.basemap = rec.style;
  } else {
    if (styleChanged) { document.body.dataset.basemap = rec.style; setBasemap(rec.style); } else { clearMapLayers(); await renderAll(); }
    map.jumpTo({ center: rec.view.center, zoom: rec.view.zoom, pitch: rec.view.pitch || 0, bearing: rec.view.bearing || 0 });
  }
  if (fit) { const b = boundsOf({ features: [] }); if (b) fitTo(b); }
  emit('map-opened', rec);
}

function clearMapLayers() {
  for (const l of map.getStyle().layers) if (l.id.startsWith('L-')) map.removeLayer(l.id);
  for (const s of Object.keys(map.getStyle().sources)) if (s.startsWith('L-')) map.removeSource(s);
}

export async function reloadMapRecord() {
  if (!state.mapRec) return;
  const rec = await get(`/maps/${state.mapRec.id}`);
  state.mapRec = rec;
  emit('layers');
  return rec;
}

// Error handler shared by all actions.
export function fail(e) {
  if (e instanceof ApiError && e.status === 402) return showUpgrade(e.message);
  if (e instanceof ApiError && e.status === 401 && state.session?.demo) return openAuth('signup', e.message);
  toast(e.message || String(e), 'error', 6000);
}
window.addEventListener('unhandledrejection', (ev) => { if (ev.reason instanceof ApiError) { ev.preventDefault(); fail(ev.reason); } });

// ---------- live orbital view (separate bundle, loaded when opened) ----------
/* global __ORBIT_V__ */
export async function showOrbit(o) {
  const v = typeof __ORBIT_V__ !== 'undefined' ? __ORBIT_V__ : String(Date.now());
  const opts = typeof o === 'string' ? { select: o } : (o || {});
  try {
    const m = await import(`${BASE}/orbit.js?v=${v}`);
    document.body.classList.add('orbit-open');
    await m.openOrbit({ ...opts, get, base: BASE, workspace: state.session ? orbitWorkspace() : null, onClose: () => { document.body.classList.remove('orbit-open'); if (location.hash === '#orbit') history.replaceState(null, '', `${BASE}/`); } });
  } catch (e) { document.body.classList.remove('orbit-open'); toast(`The orbital view did not load: ${e.message}`, 'error'); }
}
window.addEventListener('iob-orbit', (e) => showOrbit(e.detail));
setWorkspaceHooks({ openMap: (id) => openMap(id), showOrbit, showPanel: (k) => showPanel(k), openSettings, openAuth, setSatellites, spaceOn, newMap: () => newMap() });

// ---------- top bar ----------
function renderTop() {
  const s = state.session;
  const top = clear($('#topbar'));
  const brand = s.brand;
  // IoBeacons-branded workspaces sit under the same header as iobeacons.com.
  // White-label brands and embeds keep their own brand instead.
  const siteHeader = !state.embed && brand.name === 'IoBeacons Maps';
  const sh = $('#site-header');
  if (sh) {
    sh.hidden = !siteHeader;
    if (siteHeader) {
      mountSiteHeader(sh, {
        current: 'maps', flush: true, inApp: true,
        account: s.user ? { label: s.user.name?.split(' ')[0] || 'Account', onClick: () => (hasWorkspace() ? openWorkspace() : openSettings()) } : null,
        onSignIn: () => openAuth('login'),
      });
      document.documentElement.style.setProperty('--site-h', `${sh.offsetHeight || 47}px`);
    }
  }
  document.body.classList.toggle('has-site-header', siteHeader);
  if (!siteHeader) {
    top.append(
      h('a', { class: 'brand', href: `${BASE}/`, title: brand.name },
        brand.logo ? h('img', { src: brand.logo, alt: '', class: 'brand-logo' }) : h('span', { class: 'brand-dot' }),
        h('span', { class: 'brand-name' }, brand.name)),
    );
  } else {
    top.append(h('span', { class: 'product-name' }, 'Maps'));
  }
  if (state.mapRec) {
    const title = h('button', { class: 'map-title', title: isEditor() ? 'Rename map' : state.mapRec.name, onclick: () => isEditor() && renameMap() }, state.mapRec.name);
    top.append(title);
  }
  if (!state.embed) {
    const search = h('input', { id: 'search', type: 'search', placeholder: 'Search address or lat, lon', 'aria-label': 'Search', autocomplete: 'off' });
    const results = h('div', { class: 'search-results', hidden: true });
    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      const v = search.value.trim();
      if (v.length < 3) { results.hidden = true; return; }
      timer = setTimeout(async () => {
        try {
          const hits = await get(`/geocode?q=${encodeURIComponent(v)}`);
          clear(results).append(...(hits.length ? hits.map((r) => h('button', { class: 'search-hit', onclick: () => { results.hidden = true; search.value = r.label; flyToHit(r); } }, r.label)) : [h('div', { class: 'muted pad' }, 'No matches. Try a full street address with city and state.')]));
          results.hidden = false;
        } catch (e) { clear(results).append(h('div', { class: 'muted pad' }, e.message)); results.hidden = false; }
      }, 450);
    });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') results.querySelector('.search-hit')?.click(); if (e.key === 'Escape') results.hidden = true; });
    top.append(h('div', { class: 'search-wrap' }, search, results));
  }
  top.append(h('div', { class: 'spacer' }));

  const styleSel = h('div', { class: 'seg', role: 'group', 'aria-label': 'Map style' },
    s.app.styles.map((st) => h('button', {
      class: 'seg-btn', 'aria-pressed': String(state.mapRec?.style === st.key),
      onclick: async () => {
        if (!state.mapRec || state.mapRec.style === st.key) return;
        state.mapRec.style = st.key; document.body.dataset.basemap = st.key; setBasemap(st.key); renderTop();
        if (isEditor()) patch(`/maps/${state.mapRec.id}`, { style: st.key }).catch(fail);
      },
    }, st.label)));
  top.append(styleSel,
    h('button', { class: 'seg-btn solo', 'aria-pressed': String(state.mode3d), title: '3D terrain and buildings', onclick: () => { apply3d(!state.mode3d); renderTop(); } }, '3D'),
    h('button', { class: 'seg-btn solo', 'aria-pressed': String(state.globe), title: 'Globe view with satellites', onclick: async () => { const on = !state.globe; setGlobe(on); renderTop(); if (on && !spaceOn()) await setSatellites(true); } }, 'Globe'),
    h('button', { class: 'seg-btn solo', 'aria-pressed': String(spaceOn()), title: 'Live satellites on the map', onclick: async () => { await setSatellites(!spaceOn()); renderTop(); } }, 'Satellites'),
    h('button', { class: 'seg-btn solo orbit-btn', title: 'Live 3D orbits: every satellite and piece of debris at its real height, moving', onclick: () => showOrbit() }, 'Orbits'));

  if (state.embed) return;
  if (state.mapRec && !state.shareToken && isEditor()) top.append(h('button', { class: 'btn primary small', onclick: () => openShare() }, 'Share'));
  if (s.user) {
    if (hasWorkspace()) top.append(h('button', { class: 'btn primary small keep', onclick: () => openWorkspace() }, 'Workspace'));
    top.append(h('button', { class: 'btn small keep', onclick: () => openSettings() }, s.role === 'owner' && !s.demo ? 'Settings' : 'Account'));
  } else if (siteHeader) {
    top.append(h('button', { class: 'btn primary small trial', onclick: () => openAuth('signup') }, 'Start free trial'));
  } else if (!state.shareToken) {
    top.append(h('button', { class: 'btn small keep', onclick: () => openAuth('login') }, 'Sign in'), h('button', { class: 'btn primary small trial', onclick: () => openAuth('signup') }, 'Start free trial'));
  }
}
export { renderTop };

let searchMarker = null;
async function flyToHit(r) {
  const { Marker } = await import('./mapview.js');
  searchMarker?.remove();
  searchMarker = new Marker({ color: '#d9781a' }).setLngLat([r.lon, r.lat]).addTo(map);
  map.flyTo({ center: [r.lon, r.lat], zoom: 15, duration: 1400 });
  showInspector(h('div', { class: 'stack' },
    h('h3', {}, r.label),
    h('p', { class: 'mono muted' }, `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`),
    isEditor() ? h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => runReportAt(r.lon, r.lat, r.label) }, 'Site report'),
      h('button', { class: 'btn', onclick: async () => {
        try { await post('/sites', { name: r.label.split(',')[0], address: r.label, lon: r.lon, lat: r.lat }); await refreshSites(); toast('Saved as a site.'); } catch (e) { fail(e); }
      } }, 'Save as site')) : null));
}

async function renameMap() {
  const input = h('input', { value: state.mapRec.name, maxlength: 120 });
  const desc = h('textarea', { rows: 3, maxlength: 2000 }, state.mapRec.description || '');
  const m = modal('Map details', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const out = await patch(`/maps/${state.mapRec.id}`, { name: input.value, description: desc.value });
      Object.assign(state.mapRec, { name: out.name, description: out.description }); renderTop(); emit('maps-changed'); m.close();
    } catch (err) { fail(err); }
  } }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), input), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Description'), desc),
  h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
}

// ---------- rail and side panel ----------
const RAIL = [
  ['maps', 'Maps', 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15'],
  ['layers', 'Layers', 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5 M3 17l9 5 9-5'],
  ['catalog', 'Data', 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  ['sites', 'Sites', 'M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z'],
  ['devices', 'Devices', 'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 16a4 4 0 100-8 4 4 0 000 8z'],
  ['alerts', 'Alerts', 'M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8 M10 20a2 2 0 004 0'],
  ['reports', 'Reports', 'M6 2h9l5 5v15H6z M14 2v6h6 M9 13h8 M9 17h6'],
  ['notes', 'Notes', 'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h5'],
  ['space', 'Space', 'M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0 M3 16c3-2 15-10 18-8 M4.5 9.5C3 12 6 17 12 18'],
];
let currentPanel = null;
function renderRail() {
  const rail = clear($('#rail'));
  for (const [key, label, d] of RAIL) {
    rail.append(h('button', { class: 'rail-btn', 'data-panel': key, 'aria-pressed': String(currentPanel === key), onclick: () => showPanel(currentPanel === key && window.innerWidth < 900 ? null : key) },
      h('span', { class: 'rail-ico', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>` }),
      h('span', { class: 'rail-label' }, label)));
  }
}
export function showPanel(key) {
  currentPanel = key;
  renderRail();
  const side = $('#side');
  side.hidden = !key;
  document.body.classList.toggle('side-open', Boolean(key));
  if (!key) return;
  clear(side);
  try { PANELS[key](side); } catch (e) { fail(e); }
  setTimeout(() => map?.resize(), 50);
}
on('layers', () => { if (currentPanel === 'layers') showPanel('layers'); });
on('sites', () => { if (currentPanel === 'sites') showPanel('sites'); });
on('zones', () => { if (currentPanel === 'devices') showPanel('devices'); });
on('devices', () => { if (currentPanel === 'devices') showPanel('devices'); });
on('maps-changed', () => { if (currentPanel === 'maps') showPanel('maps'); });
on('map-opened', () => { if (currentPanel && currentPanel !== 'maps') showPanel(currentPanel); else if (currentPanel === 'maps') showPanel('maps'); });

// ---------- draw toolbar ----------
const TOOLS = [
  ['point', 'Point', 'M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0'],
  ['linestring', 'Line', 'M4 18L10 8l4 6 6-9'],
  ['polygon', 'Polygon', 'M5 7l7-4 7 5-2 10H7z'],
  ['rectangle', 'Rectangle', 'M4 6h16v12H4z'],
  ['circle', 'Circle', 'M12 12m-8 0a8 8 0 1016 0 8 8 0 10-16 0'],
  ['freehand', 'Freehand', 'M4 16c3-6 5 2 8-3s5-6 8-2'],
];
function renderDrawbar(active = null) {
  const bar = clear($('#drawbar'));
  if (!isEditor() || state.embed) { bar.hidden = true; return; }
  bar.hidden = false;
  const featureLayers = (state.mapRec?.layers || []).filter((l) => l.kind === 'features');
  const target = h('select', { 'aria-label': 'Save drawings to', class: 'draw-target', onchange: (e) => { state.drawTarget = e.target.value; } },
    featureLayers.map((l) => h('option', { value: `layer:${l.id}`, selected: state.drawTarget === `layer:${l.id}` || (!state.drawTarget && l.id === state.activeLayerId) }, `Save to: ${l.name}`)),
    h('option', { value: 'new-layer', selected: state.drawTarget === 'new-layer' }, 'Save to: new layer'),
    h('option', { value: 'zone', selected: state.drawTarget === 'zone' }, 'Save as: alert zone'),
    h('option', { value: 'site', selected: state.drawTarget === 'site' }, 'Save as: site (points)'));
  state.drawTarget = target.value;
  for (const [mode, label, d] of TOOLS) {
    bar.append(h('button', { class: 'tool', title: label, 'aria-label': label, 'aria-pressed': String(active?.mode === mode && !active?.measure), onclick: () => beginDraw(mode) },
      h('span', { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>` })));
  }
  bar.append(h('span', { class: 'tool-sep' }),
    h('button', { class: 'tool', title: 'Measure distance', 'aria-label': 'Measure distance', 'aria-pressed': String(active?.measure && active.mode === 'linestring'), onclick: () => beginMeasure('linestring') },
      h('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2"/></svg>' })),
    h('button', { class: 'tool', title: 'Measure area', 'aria-label': 'Measure area', 'aria-pressed': String(active?.measure && active.mode === 'polygon'), onclick: () => beginMeasure('polygon') },
      h('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 4h16v16H4z M4 9h4 M4 14h2 M9 4v4 M14 4v2"/></svg>' })),
    h('span', { class: 'tool-sep' }), target);
  if (active) bar.append(h('button', { class: 'btn small', onclick: () => stopDraw() }, 'Done'));
}
on('draw-state', (s) => { renderDrawbar(s); $('#hud-draw').textContent = s ? (s.measure ? 'Click to measure. Double-click to finish.' : drawHint(s.mode)) : ''; });
on('measure', (txt) => { const el = $('#hud-measure'); el.textContent = txt || ''; el.hidden = !txt; });
on('map-opened', () => renderDrawbar());
on('layers', () => renderDrawbar());
const drawHint = (m) => ({ point: 'Click to place a point.', linestring: 'Click to add points. Double-click to finish.', polygon: 'Click to add corners. Click the first point to close.', rectangle: 'Click two opposite corners.', circle: 'Click the center, then click the edge.', freehand: 'Click, then move the mouse to draw. Click to finish.' }[m] || '');

function beginMeasure(mode) { startDraw(mode, null, { measure: true }); }

async function beginDraw(mode) {
  const target = state.drawTarget || 'new-layer';
  if (target === 'site' && mode !== 'point') { toast('Sites are points. Pick the point tool, or save shapes to a layer.', 'warn'); return; }
  if (target === 'zone' && !['polygon', 'rectangle', 'circle', 'freehand'].includes(mode)) { toast('Alert zones are areas. Use polygon, rectangle, circle or freehand.', 'warn'); return; }
  if (target === 'zone' && !can('geofences')) { showUpgrade('Alert zones (geofences) come with the Professional plan.'); return; }
  startDraw(mode, async (feature) => {
    try {
      if (target === 'site') {
        const [lon, lat] = feature.geometry.coordinates;
        const name = await askName('Name this site', 'New site');
        if (!name) return;
        await post('/sites', { name, lon, lat });
        await refreshSites(); toast(`Saved site "${name}".`);
      } else if (target === 'zone') {
        const name = await askName('Name this alert zone', 'New zone');
        if (!name) return;
        await post('/zones', { name, geometry: feature.geometry });
        await refreshZones(); toast(`Saved zone "${name}". Add an alert rule for it under Alerts.`);
      } else {
        let layerId = target.startsWith('layer:') ? target.slice(6) : null;
        if (!layerId) {
          const l = await post(`/maps/${state.mapRec.id}/layers`, { name: 'Drawings', kind: 'features' });
          layerId = l.id; state.drawTarget = `layer:${l.id}`;
          await reloadMapRecord();
        }
        await post(`/layers/${layerId}/features`, { type: 'Feature', geometry: feature.geometry, properties: { name: '', note: '', measured: describeGeometry(feature.geometry) } });
        dropCache(layerId);
        await reloadMapRecord();
        const layer = state.mapRec.layers.find((l) => l.id === layerId);
        if (layer) await renderLayer(layer);
        toast('Shape saved.');
      }
    } catch (e) { fail(e); }
  }, { keep: true });
}

function askName(title, value) {
  return new Promise((resolve) => {
    const input = h('input', { value, maxlength: 120 });
    const m = modal(title, h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); m.close(); resolve(v || null); } },
      input, h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: () => { m.close(); resolve(null); } }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
    setTimeout(() => input.select(), 40);
  });
}
export { askName };

// Edit-shape bar
on('edit-state', (editing) => {
  const bar = $('#editbar');
  bar.hidden = !editing;
  clear(bar);
  if (editing) bar.append(h('span', {}, 'Drag points to reshape.'), h('button', { class: 'btn small', onclick: () => stopEdit() }, 'Cancel'), h('button', { class: 'btn primary small', onclick: () => saveEdit() }, 'Save shape'));
});

// pointer readout
on('pointer', (ll) => { const el = $('#hud-coords'); if (el) el.textContent = `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`; });
on('hint', (t) => { const el = $('#hud-hint'); if (!el) return; el.textContent = t; el.hidden = !t; clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 5000); });

// selection -> inspector
on('select', (sel) => { if (!sel) { hideInspector(); return; } if (sel.system === 'site') return openSiteInspector(sel.feature.properties.id); if (sel.system === 'sat') return selectSat(sel.feature.properties, $('#inspector')); emit('inspect', sel); });
on('view-mode', () => renderTop());
on('space-changed', () => { if (currentPanel === 'space') showPanel('space'); });

// ---------- demo banner ----------
function renderBanner() {
  const b = $('#banner');
  const s = state.session;
  b.hidden = true;
  if (state.embed || state.shareToken) return;
  if (s.demo) {
    b.hidden = false;
    clear(b).append(h('span', {}, h('strong', {}, 'Open demo. '), 'Try everything with sample Tulsa data. Changes reset every day and alerts are recorded, not sent.'),
      h('button', { class: 'btn primary small', onclick: () => openAuth('signup') }, 'Create your workspace: 14 days free'));
  } else if (s.org?.plan === 'trial' && s.org.trial_ends_at) {
    const days = Math.ceil((new Date(s.org.trial_ends_at) - Date.now()) / 864e5);
    b.hidden = false;
    clear(b).append(h('span', {}, days > 0 ? `Professional trial: ${days} day${days === 1 ? '' : 's'} left.` : 'Your trial has ended. Your maps are read-only until you choose a plan.'),
      s.role === 'owner' ? h('button', { class: 'btn primary small', onclick: () => openSettings('billing') }, 'Choose a plan') : null);
  } else if (s.plan?.key === 'expired') {
    b.hidden = false;
    clear(b).append(h('span', {}, 'This workspace has no active plan. Maps are read-only.'), s.role === 'owner' ? h('button', { class: 'btn primary small', onclick: () => openSettings('billing') }, 'Choose a plan') : null);
  }
}

// ---------- start ----------
async function startApp() {
  await loadSession();
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('invite')) { await acceptInvite(hash.get('invite')); return; }
  if (hash.get('reset')) { await openReset(hash.get('reset')); return; }
  if (location.hash === '#signin=console') { try { sessionStorage.setItem('iob.next', `${BASE}/console/`); } catch { /* ignore */ } history.replaceState(null, '', `${BASE}/#signin`); }
  if (location.hash === '#signin' || location.hash === '#signup') { const tab = location.hash === '#signup' ? 'signup' : 'login'; history.replaceState(null, '', `${BASE}/`); setTimeout(() => openAuth(tab), 0); }
  // Deep links from the website: #space, #globe, #3d open Maps in that view.
  if (location.hash === '#orbit' || location.hash === '#orbits') setTimeout(() => showOrbit(), 0);
  const view = ['#space', '#globe', '#3d'].includes(location.hash) ? location.hash.slice(1) : null;
  if (view) {
    history.replaceState(null, '', `${BASE}/`);
    const off = on('style-loaded', () => {
      off();
      if (view === '3d') { apply3d(true); map.easeTo({ zoom: 15.2, pitch: 62, bearing: -20, duration: 1400 }); renderTop(); }
      if (view === 'globe') { setGlobe(true); setSatellites(true); renderTop(); }
      if (view === 'space') { showPanel('space'); setSatellites(true).then(() => { showPanel('space'); map.easeTo({ zoom: 1.6, pitch: 0, duration: 1400 }); renderTop(); }); }
    });
  }
  const findingTok = hash.get('finding');
  const wantWorkspace = location.hash === '#workspace';
  if (hash.get('share')) { await startShared(hash.get('share')); if (findingTok) openSharedFinding(findingTok); return; }
  if (findingTok && !state.session.org) { renderTop(); await openSharedFinding(findingTok); return; }
  if (!state.session.org) { renderTop(); renderBanner(); openAuth('login'); return; }
  renderBanner();
  await loadWorkspaceData();
  state.maps = await get('/maps');
  let id = hash.get('map');
  if (!id || !state.maps.some((m) => m.id === id)) id = state.maps[0]?.id;
  if (!id) {
    if (isEditor()) id = (await post('/maps', { name: 'My first map' })).id;
    else { renderTop(); toast('This workspace has no maps yet.'); return; }
    state.maps = await get('/maps');
  }
  renderRail();
  await openMap(id);
  if (view !== 'space') showPanel(window.innerWidth >= 900 ? 'layers' : null);
  if (hash.get('settings')) openSettings(hash.get('settings'));
  if (findingTok) { history.replaceState(null, '', `#map=${state.mapRec.id}`); openSharedFinding(findingTok); }
  else if (wantWorkspace) openWorkspace();
}

async function startShared(token, { embed = false } = {}) {
  state.shareToken = token;
  state.embed = embed;
  const rec = await get(`/public/maps/${token}`);
  state.session = { ...(state.session || {}), brand: rec.brand, role: 'viewer', plan: null, app: state.session?.app || { styles: [] } };
  if (embed && !rec.embedsAllowed) { document.body.append(h('div', { class: 'center-msg' }, 'Embedding this map needs the Professional plan.')); return; }
  state.mapRec = rec;
  document.title = `${rec.name} · ${rec.brand.name}`;
  state.system = { sites: false, zones: false, devices: false };
  state.catalog = (await import('./catalog-static.js')).CATALOG_STATIC;
  renderTop();
  initMap($('#map'), { style: rec.style, view: rec.view });
  if (!embed) {
    const b = $('#banner'); b.hidden = false;
    clear(b).append(h('span', {}, `Shared map: ${rec.name}. View only.`), h('a', { class: 'btn small', href: `${BASE}/` }, 'Open IoBeacons Maps'));
  }
  renderLegendShared();
}
function renderLegendShared() {
  const lg = clear($('#legend'));
  const items = state.mapRec.layers.map((l) => h('div', { class: 'legend-row' }, h('i', { class: 'sw', style: { background: l.kind === 'catalog' ? '#94a3b8' : (l.style?.color || '#1f5fbf') } }), l.name));
  if (items.length) lg.append(h('div', { class: 'legend-title' }, state.mapRec.name), ...items);
  lg.hidden = !items.length;
}

async function boot() {
  try {
    if (document.body.dataset.mode === 'embed') {
      await startShared(location.hash.slice(1), { embed: true });
    } else await startApp();
  } catch (e) {
    console.error(e);
    clear($('#map')).append(h('div', { class: 'center-msg' }, e.message || 'Something went wrong loading the map.'));
  }
}
window.addEventListener('hashchange', () => {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('settings')) openSettings(p.get('settings'));
  else if (location.hash === '#workspace') openWorkspace();
  else if (p.get('finding')) openSharedFinding(p.get('finding'));
  else if (p.get('map') && p.get('map') !== state.mapRec?.id && !state.shareToken) openMap(p.get('map')).catch(fail);
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.drawing) { stopDraw(); stopEdit(); } });

export { renderRail, renderBanner, closeModal, renderSystem, api, del, startShared };
boot();
