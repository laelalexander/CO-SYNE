import {
  TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawRectangleMode,
  TerraDrawCircleMode, TerraDrawFreehandMode, TerraDrawSelectMode, TerraDrawRenderMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import length from '@turf/length';
import area from '@turf/area';
import { map } from './mapview.js';
import { state, emit, on } from './state.js';

// Drawing and measuring with Terra Draw. One drawing session at a time:
// the finished shape is handed to a callback, then cleared from the draw layer.
let draw = null;
let session = null; // { mode, onDone, measure }
const ACCENT = '#1f5fbf';
const flag = { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } };

function build() {
  draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawPointMode({ styles: { pointColor: ACCENT, pointWidth: 7, pointOutlineColor: '#ffffff', pointOutlineWidth: 2 } }),
      new TerraDrawLineStringMode({ styles: { lineStringColor: ACCENT, lineStringWidth: 3 } }),
      new TerraDrawPolygonMode({ styles: { fillColor: ACCENT, fillOpacity: 0.15, outlineColor: ACCENT, outlineWidth: 2 } }),
      new TerraDrawRectangleMode({ styles: { fillColor: ACCENT, fillOpacity: 0.15, outlineColor: ACCENT, outlineWidth: 2 } }),
      new TerraDrawCircleMode({ styles: { fillColor: ACCENT, fillOpacity: 0.15, outlineColor: ACCENT, outlineWidth: 2 } }),
      new TerraDrawFreehandMode({ styles: { fillColor: ACCENT, fillOpacity: 0.15, outlineColor: ACCENT, outlineWidth: 2 } }),
      new TerraDrawSelectMode({ flags: { point: flag, linestring: flag, polygon: flag, rectangle: flag, circle: flag, freehand: flag } }),
      new TerraDrawRenderMode({ modeName: 'static', styles: {} }),
    ],
  });
  draw.start();
  draw.on('finish', (id, ctx) => {
    if (!session || ctx.mode === 'select') return;
    const f = draw.getSnapshotFeature(id);
    if (!f) return;
    if (session.measure) { showMeasure(f); return; }
    const done = session.onDone;
    draw.clear();
    done?.({ type: 'Feature', geometry: f.geometry, properties: {} });
    if (!session?.keep) stopDraw();
  });
  draw.on('change', () => { if (session?.measure) liveMeasure(); });
}

// Terra Draw keeps its own map layers; they disappear when the basemap changes.
on('style-changing', () => { if (draw) { try { draw.stop(); } catch { /* ignore */ } draw = null; } });
on('style-loaded', () => { if (session || editing) { build(); if (session) draw.setMode(session.mode); } });

export function startDraw(mode, onDone, { measure = false, keep = false } = {}) {
  if (!draw) build();
  stopEdit();
  draw.clear();
  session = { mode, onDone, measure, keep };
  state.drawing = true;
  draw.setMode(mode);
  map.getCanvas().style.cursor = 'crosshair';
  emit('draw-state', { mode, measure });
}

export function stopDraw() {
  if (draw) { try { draw.clear(); draw.setMode('static'); } catch { /* ignore */ } }
  session = null;
  state.drawing = false;
  if (map) map.getCanvas().style.cursor = '';
  emit('draw-state', null);
  emit('measure', null);
}

// ---- measuring ----
const fmtLen = (mi) => (mi < 0.2 ? `${Math.round(mi * 5280).toLocaleString()} ft` : `${mi.toFixed(2)} mi`);
const fmtArea = (m2) => { const ac = m2 / 4046.86; return ac < 640 ? `${ac.toFixed(ac < 10 ? 2 : 1)} acres` : `${(m2 / 2589988).toFixed(2)} sq mi`; };
export function describeGeometry(g) {
  const f = { type: 'Feature', geometry: g, properties: {} };
  if (g.type.includes('Polygon')) {
    const ring = { type: 'Feature', geometry: { type: 'LineString', coordinates: g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0] }, properties: {} };
    return `${fmtArea(area(f))} · perimeter ${fmtLen(length(ring, { units: 'miles' }))}`;
  }
  if (g.type.includes('LineString')) return fmtLen(length(f, { units: 'miles' }));
  if (g.type === 'Point') return `${g.coordinates[1].toFixed(5)}, ${g.coordinates[0].toFixed(5)}`;
  return '';
}
function showMeasure(f) { emit('measure', describeGeometry(f.geometry)); }
function liveMeasure() {
  const snap = draw.getSnapshot();
  const f = snap.at(-1);
  if (!f) return;
  const g = f.geometry;
  if ((g.type === 'LineString' && g.coordinates.length > 1) || (g.type === 'Polygon' && g.coordinates[0].length > 3)) emit('measure', describeGeometry(g));
}

// ---- editing an existing shape ----
let editing = null;
export function editShape(feature, onSave) {
  stopDraw();
  if (!draw) build();
  draw.clear();
  const g = feature.geometry;
  const mode = g.type === 'Point' ? 'point' : g.type === 'LineString' ? 'linestring' : g.type === 'Polygon' ? 'polygon' : null;
  if (!mode) return false;
  const [res] = draw.addFeatures([{ type: 'Feature', id: crypto.randomUUID(), geometry: g, properties: { mode } }]);
  if (!res?.valid) { draw.clear(); return false; }
  draw.setMode('select');
  draw.selectFeature(res.id);
  editing = { id: res.id, onSave };
  state.drawing = true;
  emit('edit-state', true);
  return true;
}
export function saveEdit() {
  if (!editing) return;
  const f = draw.getSnapshotFeature(editing.id);
  const cb = editing.onSave;
  stopEdit();
  if (f) cb?.(f.geometry);
}
export function stopEdit() {
  if (!editing) return;
  editing = null;
  try { draw.clear(); draw.setMode('static'); } catch { /* ignore */ }
  state.drawing = false;
  emit('edit-state', false);
}
