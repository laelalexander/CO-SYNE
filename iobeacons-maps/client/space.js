import { twoline2satrec, propagate, gstime, eciToGeodetic } from 'satellite.js';
import { get } from './api.js';
import { h, clear, toast } from './ui.js';
import { state, on, emit } from './state.js';
import { map, setGlobe } from './mapview.js';

// Live satellites on the map. Orbital elements come from the server
// (CelesTrak); positions are worked out here every second.

const DEG = 180 / Math.PI;
const groups = new Map();      // key -> { key, name, color, sats: [{ name, id, rec }] }
const enabled = new Set();
let selected = null;           // { group, index }
let timer = null;
let list = null;               // available groups

export const spaceOn = () => enabled.size > 0;

async function loadGroup(key) {
  if (groups.has(key)) return groups.get(key);
  const g = await get(`/space/${key}`);
  const sats = [];
  for (const t of g.satellites) {
    try {
      const rec = twoline2satrec(t.l1, t.l2);
      if (!rec.error) sats.push({ name: t.name, id: t.l1.slice(2, 7).trim(), rec });
    } catch { /* skip bad element sets */ }
  }
  const out = { key: g.key, name: g.name, color: g.color, source: g.source, sats };
  groups.set(key, out);
  return out;
}

function position(rec, when) {
  const pv = propagate(rec, when);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  const gd = eciToGeodetic(pv.position, gstime(when));
  const v = pv.velocity;
  return {
    lon: ((gd.longitude * DEG + 540) % 360) - 180,
    lat: gd.latitude * DEG,
    alt: gd.height,
    speed: v ? Math.hypot(v.x, v.y, v.z) : null,
  };
}

function snapshot() {
  const when = new Date();
  const features = [];
  for (const key of enabled) {
    const g = groups.get(key);
    if (!g) continue;
    g.sats.forEach((s, i) => {
      const p = position(s.rec, when);
      if (!p || !Number.isFinite(p.lon)) return;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { group: key, index: i, name: s.name, color: g.color, alt: Math.round(p.alt), sel: selected && selected.group === key && selected.index === i ? 1 : 0 } });
    });
  }
  return { type: 'FeatureCollection', features };
}

// One full orbit of the selected satellite, split where it crosses the date line.
function trackOf(sel) {
  const s = groups.get(sel.group)?.sats[sel.index];
  if (!s) return { type: 'FeatureCollection', features: [] };
  const period = (2 * Math.PI / s.rec.no) * 60e3; // ms (no is radians per minute)
  const lines = [[]];
  let prev = null;
  const now = Date.now();
  for (let k = 0; k <= 180; k++) {
    const p = position(s.rec, new Date(now + (k / 180) * Math.min(period, 864e5)));
    if (!p) continue;
    if (prev !== null && Math.abs(p.lon - prev) > 180) lines.push([]);
    lines[lines.length - 1].push([p.lon, p.lat]);
    prev = p.lon;
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines.filter((l) => l.length > 1) } }] };
}

function ensureLayers() {
  if (!map || !map.getStyle()) return false;
  if (!map.getSource('X-sats')) {
    map.addSource('X-sats', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('X-sat-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'X-sat-track', type: 'line', source: 'X-sat-track', paint: { 'line-color': '#ff713d', 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': 0.9 } });
    map.addLayer({ id: 'X-sats-glow', type: 'circle', source: 'X-sats', metadata: { system: 'sat' },
      paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 14, 7], 'circle-color': ['get', 'color'], 'circle-opacity': 0.22 } });
    map.addLayer({ id: 'X-sats-dot', type: 'circle', source: 'X-sats', metadata: { system: 'sat' },
      paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 6, 3.5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 } });
    if (map.getStyle().glyphs) {
      map.addLayer({ id: 'X-sats-label', type: 'symbol', source: 'X-sats', metadata: { system: 'sat' },
        filter: ['any', ['==', ['get', 'sel'], 1], ['==', ['get', 'group'], 'stations']],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0.9, 0], 'text-anchor': 'left', 'text-optional': true },
        paint: { 'text-color': '#071a33', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
    }
  }
  return true;
}

function tick() {
  if (!enabled.size) return;
  if (!ensureLayers()) return;
  map.getSource('X-sats')?.setData(snapshot());
  if (selected) {
    const t = Date.now();
    if (!tick.trackAt || t - tick.trackAt > 30e3) { map.getSource('X-sat-track')?.setData(trackOf(selected)); tick.trackAt = t; }
    renderSelected();
  }
}

function start() {
  clearInterval(timer);
  timer = setInterval(tick, 1000);
  tick();
}
function stop() {
  clearInterval(timer); timer = null;
  for (const id of ['X-sats-label', 'X-sats-dot', 'X-sats-glow', 'X-sat-track']) if (map?.getLayer(id)) map.removeLayer(id);
  for (const id of ['X-sats', 'X-sat-track']) if (map?.getSource(id)) map.removeSource(id);
}

export async function toggleGroup(key, onOff) {
  if (onOff) {
    try { await loadGroup(key); } catch (e) { toast(e.message, 'error'); return; }
    enabled.add(key);
    if (!state.globe) { setGlobe(true); emit('view-mode'); }
    start();
  } else {
    enabled.delete(key);
    if (selected?.group === key) { selected = null; map.getSource('X-sat-track')?.setData({ type: 'FeatureCollection', features: [] }); hideSel(); }
    if (!enabled.size) stop(); else tick();
  }
}

// ---------- inspector for a satellite ----------
let inspectorEl = null;
function hideSel() { if (inspectorEl) { inspectorEl.hidden = true; clear(inspectorEl); } }
function renderSelected() {
  if (!selected || !inspectorEl || inspectorEl.hidden) return;
  const g = groups.get(selected.group);
  const s = g?.sats[selected.index];
  if (!s) return;
  const p = position(s.rec, new Date());
  if (!p) return;
  const periodMin = (2 * Math.PI) / s.rec.no;
  const vals = inspectorEl.querySelector('[data-live]');
  if (vals) {
    vals.querySelector('[data-k=pos]').textContent = `${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°`;
    vals.querySelector('[data-k=alt]').textContent = `${Math.round(p.alt).toLocaleString()} km (${Math.round(p.alt * 0.621).toLocaleString()} mi)`;
    vals.querySelector('[data-k=spd]').textContent = p.speed ? `${p.speed.toFixed(2)} km/s` : '—';
    vals.querySelector('[data-k=per]').textContent = periodMin > 1000 ? `${(periodMin / 60).toFixed(1)} hours` : `${Math.round(periodMin)} minutes`;
  }
}
export function selectSat(props, inspector) {
  inspectorEl = inspector;
  selected = { group: props.group, index: Number(props.index) };
  const g = groups.get(selected.group);
  const s = g?.sats[selected.index];
  if (!s) return;
  const row = (label, k) => h('tr', {}, h('th', {}, label), h('td', { 'data-k': k }, '…'));
  clear(inspector).append(
    h('button', { class: 'icon-btn insp-close', 'aria-label': 'Close', onclick: () => { selected = null; map.getSource('X-sat-track')?.setData({ type: 'FeatureCollection', features: [] }); hideSel(); tick(); } }, '✕'),
    h('div', { class: 'stack' },
      h('div', { class: 'eyebrow' }, g.name),
      h('h3', {}, s.name),
      h('table', { class: 'props', 'data-live': '' }, h('tbody', {}, row('Over', 'pos'), row('Altitude', 'alt'), row('Speed', 'spd'), row('One orbit', 'per'), h('tr', {}, h('th', {}, 'NORAD id'), h('td', {}, s.id)))),
      h('p', { class: 'hint' }, 'The dashed line is its path for the next orbit. Positions update every second. Source: CelesTrak orbital elements.'),
      h('button', { class: 'btn small', onclick: () => { const p = position(s.rec, new Date()); if (p) map.flyTo({ center: [p.lon, p.lat], zoom: Math.min(map.getZoom(), 3), duration: 1200 }); } }, 'Center on it')));
  inspector.hidden = false;
  tick.trackAt = 0;
  tick();
}

// ---------- side panel ----------
export async function spacePanel(side) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Loading satellite groups…'));
  side.append(h('div', { class: 'panel-head' }, h('h2', {}, 'Space')), body);
  try { list ||= await get('/space'); } catch (e) { clear(body).append(h('p', { class: 'muted' }, e.message)); return; }
  const rows = list.map((g) => {
    const box = h('input', { type: 'checkbox', checked: enabled.has(g.key) || undefined });
    const count = h('span', { class: 'count' }, groups.get(g.key)?.sats.length ?? '');
    box.addEventListener('change', async () => {
      box.disabled = true;
      await toggleGroup(g.key, box.checked);
      box.disabled = false;
      count.textContent = groups.get(g.key)?.sats.length ?? '';
    });
    return h('label', { class: 'layer-row space-row' }, box, h('span', { class: 'swatch', style: { background: g.color } }), h('span', { class: 'grow' }, g.name), count);
  });
  clear(body).append(
    h('section', { class: 'panel-sec' }, h('p', { class: 'muted', style: { margin: 0 } }, 'Show live satellites over your map. Turning one on switches to the globe so you can see whole orbits. Click a satellite for its path, height and speed.')),
    h('section', { class: 'panel-sec' }, h('h3', { class: 'sec-title' }, 'Satellites'), ...rows),
    h('section', { class: 'panel-sec' }, h('h3', { class: 'sec-title' }, 'View'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => { setGlobe(true); emit('view-mode'); map.easeTo({ zoom: 1.6, pitch: 0, duration: 1200 }); } }, 'Whole Earth'),
        h('button', { class: 'btn small', onclick: () => { setGlobe(false); emit('view-mode'); } }, 'Flat map'))),
    h('section', { class: 'panel-sec' }, h('p', { class: 'hint', style: { margin: 0 } }, 'Orbital data: CelesTrak, refreshed every few hours. Positions are calculated in your browser.')));
}

on('style-loaded', () => { if (enabled.size) { tick.trackAt = 0; tick(); } });
