// Moving weather radar. When the weather radar layer is on, the last hour
// plays as a loop (US high resolution, worldwide elsewhere), with a timeline,
// and Doppler winds from the nearest NEXRAD radar can be shown on top.
import { get } from './api.js';
import { h, clear, toast } from './ui.js';
import { state, on } from './state.js';
import { map } from './mapview.js';

const US = [[-170, 15], [-60, 72]]; // US, Alaska, Hawaii, Puerto Rico (roughly)
const inUS = (c) => c.lng > US[0][0] && c.lng < US[1][0] && c.lat > US[0][1] && c.lat < US[1][1];

const rd = { layer: null, source: null, frames: [], idx: 0, playing: true, timer: null, loadedAt: 0, bar: null, doppler: false, dop: null, dopAt: 0 };

const radarLayer = () => state.mapRec?.layers?.find((l) => l.kind === 'catalog' && l.catalog_key === 'radar' && l.visible) || null;
const staticId = (l) => `L-${l.id}-raster`;
const frameId = (i) => `X-radar-${i}`;

function clearFrames() {
  if (!map) return;
  for (let i = 0; i < 40; i++) { if (map.getLayer(frameId(i))) map.removeLayer(frameId(i)); if (map.getSource(frameId(i))) map.removeSource(frameId(i)); }
}
function clearDoppler() {
  if (!map) return;
  for (const id of ['X-doppler-ring', 'X-doppler-site', 'X-doppler']) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of ['X-doppler', 'X-doppler-geo']) if (map.getSource(id)) map.removeSource(id);
}
function stop() {
  clearTimeout(rd.timer); rd.timer = null;
  clearFrames(); clearDoppler();
  if (rd.layer && map?.getLayer(staticId(rd.layer))) map.setPaintProperty(staticId(rd.layer), 'raster-opacity', rd.layer.style?.opacity ?? 0.65);
  rd.bar?.remove(); rd.bar = null; rd.layer = null; rd.frames = []; rd.source = null;
}

async function loadFrames() {
  const want = inUS(map.getCenter()) ? 'us' : 'world';
  let data;
  try { data = await get(`/weather/radar-frames?source=${want}`); } catch (e) { toast(`Radar loop unavailable: ${e.message}`, 'warn'); return false; }
  if (!data.frames?.length && want === 'world') { toast('Worldwide radar is not available right now.', 'warn'); return false; }
  clearFrames();
  rd.source = want; rd.frames = data.frames; rd.loadedAt = Date.now(); rd.attribution = data.attribution;
  const opacity = rd.layer.style?.opacity ?? 0.65;
  const before = map.getLayer(staticId(rd.layer)) ? staticId(rd.layer) : undefined;
  data.frames.forEach((f, i) => {
    map.addSource(frameId(i), { type: 'raster', tiles: f.tiles, tileSize: 256, maxzoom: data.maxzoom, attribution: data.attribution });
    map.addLayer({ id: frameId(i), type: 'raster', source: frameId(i), paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 }, metadata: { opacity } }, before);
  });
  if (before) map.setPaintProperty(before, 'raster-opacity', 0);
  rd.idx = rd.frames.length - 1;
  show(rd.idx);
  return true;
}

function show(i) {
  rd.idx = i;
  rd.frames.forEach((_, k) => { if (map.getLayer(frameId(k))) map.setPaintProperty(frameId(k), 'raster-opacity', k === i ? (map.getLayer(frameId(k)).metadata?.opacity ?? 0.65) : 0); });
  renderBar();
}

function tick() {
  clearTimeout(rd.timer);
  if (!rd.playing || !rd.frames.length) return;
  const last = rd.idx >= rd.frames.length - 1;
  rd.timer = setTimeout(() => { show(last ? 0 : rd.idx + 1); tick(); }, last ? 1600 : 550);
}

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function renderBar() {
  if (!rd.bar) {
    rd.bar = h('div', { class: 'radar-bar', role: 'group', 'aria-label': 'Radar loop' });
    document.querySelector('#map')?.parentElement?.append(rd.bar);
  }
  const f = rd.frames[rd.idx];
  const ticks = h('div', { class: 'rb-ticks' }, rd.frames.map((x, k) => h('button', { class: `rb-tick${k === rd.idx ? ' on' : ''}${k === rd.frames.length - 1 ? ' latest' : ''}`, title: `${x.minutesAgo ? `${x.minutesAgo} min ago` : 'Latest'} · ${fmtTime(x.time)}`, 'aria-label': fmtTime(x.time), onclick: () => { rd.playing = false; clearTimeout(rd.timer); show(k); } })));
  clear(rd.bar).append(
    h('button', { class: 'rb-play', 'aria-label': rd.playing ? 'Pause radar loop' : 'Play radar loop', onclick: () => { rd.playing = !rd.playing; renderBar(); tick(); } }, rd.playing ? '❚❚' : '▶'),
    h('div', { class: 'rb-mid' },
      h('div', { class: 'rb-when' }, h('b', {}, f ? (f.minutesAgo ? `${f.minutesAgo} min ago` : 'Latest') : '—'), f ? ` · ${fmtTime(f.time)}` : '', h('span', { class: 'rb-src' }, rd.source === 'us' ? 'US radar, 5-minute steps' : 'Worldwide radar, 10-minute steps')),
      ticks),
    h('label', { class: 'rb-dop', title: 'Wind speed and direction measured by the nearest NEXRAD Doppler radar' },
      h('input', { type: 'checkbox', checked: rd.doppler, onchange: (e) => { rd.doppler = e.target.checked; syncDoppler(true); } }), 'Doppler winds'),
    rd.doppler && rd.dop?.radar ? h('div', { class: 'rb-legend' },
      h('span', { class: 'rb-grad' }), h('span', {}, `Toward / away from radar ${rd.dop.radar.id} (${rd.dop.radar.name}, ${rd.dop.radar.distanceKm} km)`)) : null,
    rd.doppler && rd.dop && !rd.dop.radar ? h('div', { class: 'rb-legend' }, rd.dop.note) : null);
}

async function syncDoppler(force = false) {
  if (!map || !rd.layer) return;
  if (!rd.doppler) { clearDoppler(); rd.dop = null; renderBar(); return; }
  const c = map.getCenter();
  const near = rd.dop?.radar && Math.hypot(c.lng - rd.dop.radar.lon, c.lat - rd.dop.radar.lat) < 1.2;
  if (!force && near && Date.now() - rd.dopAt < 300000) return;
  try { rd.dop = await get(`/weather/doppler?lon=${c.lng.toFixed(3)}&lat=${c.lat.toFixed(3)}`); rd.dopAt = Date.now(); } catch (e) { toast(e.message, 'warn'); rd.doppler = false; renderBar(); return; }
  clearDoppler();
  if (rd.dop.radar) {
    map.addSource('X-doppler', { type: 'raster', tiles: rd.dop.tiles, tileSize: 256, maxzoom: 12, attribution: rd.dop.attribution });
    map.addLayer({ id: 'X-doppler', type: 'raster', source: 'X-doppler', paint: { 'raster-opacity': 0.8, 'raster-fade-duration': 0 } });
    const { lon, lat } = rd.dop.radar;
    const ring = Array.from({ length: 73 }, (_, i) => { const a = (i / 72) * 2 * Math.PI; return [lon + (rd.dop.rangeKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.cos(a), lat + (rd.dop.rangeKm / 110.57) * Math.sin(a)]; });
    map.addSource('X-doppler-geo', { type: 'geojson', data: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } },
      { type: 'Feature', properties: { name: `Radar ${rd.dop.radar.id}` }, geometry: { type: 'Point', coordinates: [lon, lat] } }] } });
    map.addLayer({ id: 'X-doppler-ring', type: 'line', source: 'X-doppler-geo', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#334155', 'line-width': 1.2, 'line-dasharray': [3, 3], 'line-opacity': 0.7 } });
    map.addLayer({ id: 'X-doppler-site', type: 'circle', source: 'X-doppler-geo', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#0f172a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  }
  renderBar();
}

export async function syncRadar() {
  if (!map) return;
  const l = radarLayer();
  if (!l) { if (rd.layer) stop(); return; }
  if (!map.isStyleLoaded() || !map.getLayer(staticId(l))) return;
  const sourceNow = inUS(map.getCenter()) ? 'us' : 'world';
  const fresh = rd.layer?.id === l.id && rd.source === sourceNow && Date.now() - rd.loadedAt < 300000 && map.getLayer(frameId(0));
  if (fresh) return;
  rd.layer = l;
  if (await loadFrames()) { tick(); if (rd.doppler) syncDoppler(true); }
}

let moveTimer;
on('style-loaded', () => { rd.loadedAt = 0; setTimeout(syncRadar, 300); });
on('map-opened', () => { stop(); setTimeout(syncRadar, 600); });
on('layers', () => setTimeout(syncRadar, 300));
on('layer-rendered', () => setTimeout(syncRadar, 100));
on('moved', () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { syncRadar(); if (rd.doppler) syncDoppler(); }, 600); });
setInterval(() => { if (rd.layer) { rd.loadedAt = 0; syncRadar(); } }, 300000);
