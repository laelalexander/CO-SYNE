import * as maplibregl from 'maplibre-gl';
import { API, get } from './api.js';
import { state, emit } from './state.js';
import { toast } from './ui.js';

// Draws the basemap, the customer's layers, catalog layers and the workspace
// layers (sites, zones, devices). Everything is rebuilt after a style change.
export let map = null;
const dataCache = new Map();      // layerId -> FeatureCollection
const catalogCache = new Map();   // key -> { at, data }
let beforeLabels;                 // first basemap symbol layer, overlays go under it
let radarTimer = null;
// isStyleLoaded() turns false while any source is still loading, so track the style ourselves.
let styleReady = false;

export const PALETTE = ['#1f5fbf', '#d9781a', '#0f766e', '#7c3aed', '#c2362f', '#4d7c0f', '#db2777', '#0891b2', '#a16207', '#475569'];
const styleUrl = (name) => `${location.origin}${API}/styles/${name}.json`;

export function initMap(container, { style = 'streets', view, interactive = true } = {}) {
  map = new maplibregl.Map({
    container, style: styleUrl(style), interactive,
    center: view?.center || [-95.99, 36.15], zoom: view?.zoom ?? 10, pitch: view?.pitch || 0, bearing: view?.bearing || 0,
    attributionControl: { compact: true }, maxPitch: 75, hash: false,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'bottom-right');
  map.on('style.load', onStyleLoad);
  map.on('moveend', () => { emit('moved'); refreshBboxLayers(); });
  map.on('mousemove', (e) => emit('pointer', e.lngLat));
  map.on('error', (e) => { if (e?.error?.status === 403 || e?.error?.status === 402) return; if (e?.sourceId) console.warn('map source error', e.sourceId, e.error?.message); });
  map.on('click', onClick);
  clearInterval(radarTimer);
  radarTimer = setInterval(refreshRadar, 300000);
  return map;
}

export function setBasemap(name) {
  if (!map) return;
  emit('style-changing');
  styleReady = false;
  map.setStyle(styleUrl(name), { diff: false });
}

function onStyleLoad() {
  styleReady = true;
  beforeLabels = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  if (state.globe) map.setProjection({ type: 'globe' });
  apply3d(state.mode3d, { animate: false });
  renderAll();
  emit('style-loaded');
}

// ---------- helpers ----------
function removeLayerGroup(prefix) {
  for (const l of map.getStyle()?.layers || []) if (l.id.startsWith(prefix)) map.removeLayer(l.id);
  for (const id of Object.keys(map.getStyle()?.sources || {})) if (id.startsWith(prefix)) map.removeSource(id);
}
const add = (layer, under = true) => {
  if (layer.type === 'symbol' && !map.getStyle().glyphs) return; // labels need the basemap's fonts
  map.addLayer(layer, under && beforeLabels && map.getLayer(beforeLabels) ? beforeLabels : undefined);
};
const isPoint = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]];
const isLine = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]];
const isPoly = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];

function numberRange(fc, field) {
  let min = Infinity; let max = -Infinity;
  for (const f of fc?.features || []) { const v = Number(f.properties?.[field]); if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); } }
  return min === Infinity ? null : [min, max === min ? min + 1 : max];
}
function categories(fc, field) {
  const counts = new Map();
  for (const f of fc?.features || []) { const v = f.properties?.[field]; if (v !== undefined && v !== null && v !== '') counts.set(String(v), (counts.get(String(v)) || 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, PALETTE.length - 1).map(([k]) => k);
}

export function colorExpr(style, fc) {
  if (style.mode === 'categories' && style.field) {
    const cats = categories(fc, style.field);
    if (!cats.length) return style.color;
    return ['match', ['to-string', ['get', style.field]], ...cats.flatMap((c, i) => [c, PALETTE[i]]), PALETTE.at(-1)];
  }
  if (style.mode === 'graduated' && style.field) {
    const r = numberRange(fc, style.field);
    if (!r) return style.color;
    return ['interpolate', ['linear'], ['to-number', ['get', style.field], r[0]], r[0], '#dbe7f7', (r[0] + r[1]) / 2, style.color, r[1], '#0b2a5b'];
  }
  return style.color;
}
export const legendFor = (style, fc) => {
  if (style.mode === 'categories' && style.field) return categories(fc, style.field).map((c, i) => ({ label: c, color: PALETTE[i] })).concat([{ label: 'Other', color: PALETTE.at(-1) }]);
  if (style.mode === 'graduated' && style.field) { const r = numberRange(fc, style.field); return r ? [{ label: `${r[0].toLocaleString()}`, color: '#dbe7f7' }, { label: `${r[1].toLocaleString()}`, color: '#0b2a5b' }] : []; }
  return [{ label: '', color: style.color }];
};

// ---------- data ----------
function featuresUrl(layerId) {
  return state.shareToken ? `/public/maps/${state.shareToken}/layers/${layerId}/features` : `/layers/${layerId}/features`;
}
export async function loadLayerData(layer, { force = false } = {}) {
  if (!force && dataCache.has(layer.id)) return dataCache.get(layer.id);
  const fc = await get(featuresUrl(layer.id));
  dataCache.set(layer.id, fc);
  return fc;
}
export const cachedData = (id) => dataCache.get(id);
export const dropCache = (id) => (id ? dataCache.delete(id) : dataCache.clear());

async function catalogFetch(key, bbox) {
  const qs = bbox ? `?bbox=${bbox.map((v) => v.toFixed(4)).join(',')}` : '';
  const path = state.shareToken ? `/public/maps/${state.shareToken}/catalog/${key}${qs}` : `/catalog/${key}/data${qs}`;
  return get(path);
}

// ---------- rendering ----------
export async function renderAll() {
  if (!map || !styleReady) return;
  const layers = [...(state.mapRec?.layers || [])].sort((a, b) => a.position - b.position);
  for (const l of layers) await renderLayer(l).catch((e) => toast(`${l.name}: ${e.message}`, 'warn'));
  renderSystem();
}

export async function renderLayer(layer) {
  const prefix = `L-${layer.id}`;
  removeLayerGroup(prefix);
  if (!layer.visible) { emit('layer-rendered', layer); return; }
  if (layer.kind === 'catalog') { await renderCatalog(layer, prefix); emit('layer-rendered', layer); return; }
  const s = { color: '#1f5fbf', opacity: 0.35, width: 2, radius: 6, mode: 'simple', ...layer.style };
  const big = layer.feature_count > 20000;
  let fc = null;
  if (big) {
    map.addSource(prefix, { type: 'vector', tiles: [`${location.origin}${API}/tiles/${layer.id}/{z}/{x}/{y}.pbf`], maxzoom: 16 });
  } else {
    fc = await loadLayerData(layer);
    if (map.getSource(prefix)) return; // a newer render already added it
    const cluster = s.mode === 'cluster';
    map.addSource(prefix, { type: 'geojson', data: fc, promoteId: '_id', cluster, clusterRadius: 48, clusterMaxZoom: 14 });
  }
  const src = big ? { source: prefix, 'source-layer': 'features' } : { source: prefix };
  const color = colorExpr(s, fc);
  const meta = { layerId: layer.id };
  if (s.mode === 'heatmap') {
    add({ id: `${prefix}-heat`, type: 'heatmap', ...src, filter: isPoint, metadata: meta,
      paint: { 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 6, 12, 14, 30], 'heatmap-opacity': 0.85,
        'heatmap-weight': s.field ? ['interpolate', ['linear'], ['to-number', ['get', s.field], 0], 0, 0, numberRange(fc, s.field)?.[1] || 1, 1] : 1 } });
  }
  if (s.mode === 'cluster' && !big) {
    add({ id: `${prefix}-cluster`, type: 'circle', ...src, filter: ['has', 'point_count'], metadata: meta,
      paint: { 'circle-color': s.color, 'circle-opacity': 0.85, 'circle-radius': ['step', ['get', 'point_count'], 14, 25, 20, 100, 28], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } }, false);
    add({ id: `${prefix}-cluster-count`, type: 'symbol', ...src, filter: ['has', 'point_count'], metadata: meta,
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 }, paint: { 'text-color': '#fff' } }, false);
  }
  if (s.mode === 'extrude') {
    add({ id: `${prefix}-extrude`, type: 'fill-extrusion', ...src, filter: isPoly, metadata: meta,
      paint: { 'fill-extrusion-color': color, 'fill-extrusion-opacity': 0.85, 'fill-extrusion-height': s.field ? ['to-number', ['get', s.field], 10] : 20 } });
  } else {
    add({ id: `${prefix}-fill`, type: 'fill', ...src, filter: isPoly, metadata: meta, paint: { 'fill-color': color, 'fill-opacity': s.opacity } });
    add({ id: `${prefix}-outline`, type: 'line', ...src, filter: isPoly, metadata: meta, paint: { 'line-color': color, 'line-width': Math.max(1, s.width * 0.75) } });
  }
  add({ id: `${prefix}-line`, type: 'line', ...src, filter: isLine, metadata: meta, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': s.width } });
  if (s.mode !== 'heatmap') {
    const pf = s.mode === 'cluster' && !big ? ['all', isPoint, ['!', ['has', 'point_count']]] : isPoint;
    add({ id: `${prefix}-circle`, type: 'circle', ...src, filter: pf, metadata: meta,
      paint: { 'circle-color': color, 'circle-radius': s.radius, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } }, false);
  }
  if (s.label) {
    add({ id: `${prefix}-label`, type: 'symbol', ...src, metadata: meta,
      layout: { 'text-field': ['to-string', ['get', s.label]], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': '#16202e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } }, false);
  }
}

const SEVERITY_COLORS = ['match', ['get', 'severity'], 'Extreme', '#7f1d1d', 'Severe', '#e0332b', 'Moderate', '#f59e0b', 'Minor', '#eab308', '#64748b'];

async function renderCatalog(layer, prefix) {
  const entry = state.catalog.find((c) => c.key === layer.catalog_key) || {};
  const key = layer.catalog_key;
  if (entry.type === 'raster' || key === 'radar' || key === 'flood' || key === 'census') {
    const tiles = (entry.tiles || []).map((t) => (key === 'radar' ? `${t}?t=${Math.floor(Date.now() / 300000)}` : t));
    if (!tiles.length) return;
    map.addSource(prefix, { type: 'raster', tiles, tileSize: entry.tileSize || 256, minzoom: entry.minzoom || 0, maxzoom: entry.maxzoom || 18, attribution: entry.attribution });
    add({ id: `${prefix}-raster`, type: 'raster', source: prefix, minzoom: entry.minzoom || 0, metadata: { layerId: layer.id, catalog: key }, paint: { 'raster-opacity': layer.style?.opacity ?? entry.opacity ?? 0.7 } });
    return;
  }
  if (key === 'hillshade') {
    const dem = await get('/terrain.json').catch(() => null);
    if (!dem || map.getSource(prefix)) return;
    map.addSource(prefix, dem);
    add({ id: `${prefix}-hs`, type: 'hillshade', source: prefix, metadata: { layerId: layer.id }, paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#3b3b3b' } });
    return;
  }
  let data = { type: 'FeatureCollection', features: [] };
  if (entry.type === 'feed') {
    const hit = catalogCache.get(key);
    if (hit && Date.now() - hit.at < (entry.refreshSec || 300) * 1000) data = hit.data;
    else {
      // A failed feed is remembered too, so the warning shows once per refresh period.
      try { data = await catalogFetch(key); } catch (e) { toast(e.message, 'warn'); }
      catalogCache.set(key, { at: Date.now(), data });
    }
  }
  if (map.getSource(prefix)) return;
  map.addSource(prefix, { type: 'geojson', data, attribution: entry.attribution });
  const meta = { layerId: layer.id, catalog: key };
  if (key === 'nws-warnings') {
    add({ id: `${prefix}-fill`, type: 'fill', source: prefix, metadata: meta, paint: { 'fill-color': SEVERITY_COLORS, 'fill-opacity': 0.16 } });
    add({ id: `${prefix}-line`, type: 'line', source: prefix, metadata: meta, paint: { 'line-color': SEVERITY_COLORS, 'line-width': 1.6 } });
  } else if (key === 'earthquakes') {
    add({ id: `${prefix}-circle`, type: 'circle', source: prefix, metadata: meta,
      paint: { 'circle-color': '#b45309', 'circle-opacity': 0.75, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1, 'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'mag'], 1], 1, 3, 4, 9, 7, 20] } }, false);
  } else if (key === 'wildfires') {
    add({ id: `${prefix}-fill`, type: 'fill', source: prefix, metadata: meta, paint: { 'fill-color': '#ea580c', 'fill-opacity': 0.3 } });
    add({ id: `${prefix}-line`, type: 'line', source: prefix, metadata: meta, paint: { 'line-color': '#c2410c', 'line-width': 1.5 } });
  } else if (key === 'infrastructure') {
    add({ id: `${prefix}-sub`, type: 'fill', source: prefix, filter: isPoly, metadata: meta, paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.25 } });
    add({ id: `${prefix}-line`, type: 'line', source: prefix, filter: isLine, metadata: meta,
      paint: { 'line-color': ['match', ['get', 'kind'], 'Pipeline', '#8b5a2b', '#7c3aed'], 'line-width': 1.6, 'line-dasharray': ['match', ['get', 'kind'], 'Pipeline', ['literal', [3, 2]], ['literal', [1, 0]]] } });
    add({ id: `${prefix}-circle`, type: 'circle', source: prefix, filter: isPoint, metadata: meta, paint: { 'circle-color': '#7c3aed', 'circle-radius': 4, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } }, false);
    refreshBboxLayers();
  }
}

let bboxTimer = null;
function refreshBboxLayers() {
  clearTimeout(bboxTimer);
  bboxTimer = setTimeout(async () => {
    for (const l of state.mapRec?.layers || []) {
      if (l.kind !== 'catalog' || l.catalog_key !== 'infrastructure' || !l.visible) continue;
      const src = map.getSource(`L-${l.id}`);
      if (!src) continue;
      if (map.getZoom() < 11) { src.setData({ type: 'FeatureCollection', features: [] }); emit('hint', 'Zoom in to see power lines, pipelines and towers.'); continue; }
      const b = map.getBounds();
      try { src.setData(await catalogFetch('infrastructure', [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])); } catch (e) { emit('hint', e.message); }
    }
  }, 600);
}

function refreshRadar() {
  for (const l of state.mapRec?.layers || []) {
    if (l.catalog_key === 'radar' && l.visible) renderLayer(l);
    if (l.catalog_key === 'nws-warnings' && l.visible) { catalogCache.delete('nws-warnings'); renderLayer(l); }
  }
}

// ---------- workspace layers: zones, sites, devices ----------
export function renderSystem() {
  if (!map || !styleReady) return;
  removeLayerGroup('S-');
  if (state.system.zones) {
    map.addSource('S-zones', { type: 'geojson', data: state.zones });
    add({ id: 'S-zones-fill', type: 'fill', source: 'S-zones', metadata: { system: 'zone' }, paint: { 'fill-color': ['coalesce', ['get', 'color'], '#d9781a'], 'fill-opacity': 0.14 } });
    add({ id: 'S-zones-line', type: 'line', source: 'S-zones', metadata: { system: 'zone' }, paint: { 'line-color': ['coalesce', ['get', 'color'], '#d9781a'], 'line-width': 2.2, 'line-dasharray': [3, 1.5] } });
    add({ id: 'S-zones-label', type: 'symbol', source: 'S-zones', metadata: { system: 'zone' }, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'symbol-placement': 'point' }, paint: { 'text-color': '#9a4f0b', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } }, false);
  }
  if (state.system.sites) {
    map.addSource('S-sites', { type: 'geojson', data: state.sites });
    add({ id: 'S-sites-halo', type: 'circle', source: 'S-sites', metadata: { system: 'site' }, paint: { 'circle-radius': 11, 'circle-color': '#1f5fbf', 'circle-opacity': 0.18 } }, false);
    add({ id: 'S-sites-pin', type: 'circle', source: 'S-sites', metadata: { system: 'site' }, paint: { 'circle-radius': 6.5, 'circle-color': '#1f5fbf', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } }, false);
    add({ id: 'S-sites-label', type: 'symbol', source: 'S-sites', minzoom: 10, metadata: { system: 'site' },
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': '#123c7a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } }, false);
  }
  if (state.system.devices) {
    map.addSource('S-devices', { type: 'geojson', data: state.devices });
    add({ id: 'S-devices-dot', type: 'circle', source: 'S-devices', metadata: { system: 'device' }, paint: { 'circle-radius': 7, 'circle-color': '#0f766e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } }, false);
    add({ id: 'S-devices-label', type: 'symbol', source: 'S-devices', metadata: { system: 'device' },
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [1, 0], 'text-anchor': 'left' },
      paint: { 'text-color': '#0f766e', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } }, false);
  }
}
export function updateSystemData() {
  map?.getSource('S-sites')?.setData(state.sites);
  map?.getSource('S-zones')?.setData(state.zones);
  map?.getSource('S-devices')?.setData(state.devices);
}

// ---------- 3D, globe ----------
export function apply3d(on, { animate = true } = {}) {
  state.mode3d = on;
  if (!map) return;
  if (on) {
    if (!map.getSource('dem')) {
      get('/terrain.json').then((dem) => {
        if (!map.getSource('dem')) map.addSource('dem', dem);
        map.setTerrain({ source: 'dem', exaggeration: 1.3 });
      }).catch(() => {});
    } else map.setTerrain({ source: 'dem', exaggeration: 1.3 });
    addBuildings();
    if (animate) map.easeTo({ pitch: 60, duration: 900 });
  } else {
    if (map.getTerrain?.()) map.setTerrain(null);
    if (map.getLayer('iob-3d-buildings')) map.removeLayer('iob-3d-buildings');
    if (animate) map.easeTo({ pitch: 0, duration: 700 });
  }
}
function addBuildings() {
  const src = map.getSource('openmaptiles') ? 'openmaptiles' : null;
  if (!src || map.getLayer('iob-3d-buildings')) return;
  map.addLayer({
    id: 'iob-3d-buildings', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 13,
    paint: {
      'fill-extrusion-color': document.body.dataset.basemap === 'dark' ? '#2a3442' : '#d5dbe3',
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85,
    },
  }, beforeLabels && map.getLayer(beforeLabels) ? beforeLabels : undefined);
}
export function setGlobe(on) {
  state.globe = on;
  map?.setProjection({ type: on ? 'globe' : 'mercator' });
  if (on && map.getZoom() > 4) map.easeTo({ zoom: 2.5, duration: 1200 });
}

// ---------- clicks ----------
function onClick(e) {
  if (state.drawing) return;
  const feats = map.queryRenderedFeatures(e.point).filter((f) => f.layer.metadata?.layerId || f.layer.metadata?.system);
  const f = feats[0];
  if (!f) { emit('select', null); return; }
  if (f.properties?.cluster) {
    map.getSource(f.source).getClusterExpansionZoom(f.properties.cluster_id).then((z) => map.easeTo({ center: f.geometry.coordinates, zoom: z }));
    return;
  }
  emit('select', { feature: f, lngLat: e.lngLat, layerId: f.layer.metadata.layerId, system: f.layer.metadata.system, catalog: f.layer.metadata.catalog });
}

export function fitTo(bounds, opts = {}) {
  if (!bounds || bounds.some((v) => !Number.isFinite(v))) return;
  map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 60, maxZoom: 15, duration: 900, ...opts });
}
export function boundsOf(fc) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  for (const f of fc?.features || []) if (f.geometry) walk(f.geometry.type === 'GeometryCollection' ? f.geometry.geometries.map((g) => g.coordinates) : f.geometry.coordinates);
  return b[0] === Infinity ? null : b;
}
export const Popup = maplibregl.Popup;
export const Marker = maplibregl.Marker;
