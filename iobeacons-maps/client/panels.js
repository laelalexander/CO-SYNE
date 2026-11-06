import { get, post, patch, del, api, API } from './api.js';
import { h, $, clear, toast, modal, confirmBox, field, fmtNum, fmtDate, ago, copyText } from './ui.js';
import { state, on, emit, isEditor, can } from './state.js';
import { map, renderLayer, renderSystem, loadLayerData, cachedData, dropCache, legendFor, fitTo, boundsOf, PALETTE } from './mapview.js';
import { editShape, describeGeometry } from './draw.js';
import {
  openMap, reloadMapRecord, refreshSites, refreshZones, refreshDevices, fail, askName, showPanel,
} from './main.js';
import { showUpgrade } from './settings.js';

// Side panels, the feature inspector, the layer style editor and site reports.

const section = (title, ...children) => h('section', { class: 'panel-sec' }, title ? h('h3', { class: 'sec-title' }, title) : null, ...children);
const head = (title, ...actions) => h('div', { class: 'panel-head' }, h('h2', {}, title), h('div', { class: 'row' }, ...actions));
const empty = (text) => h('p', { class: 'muted empty' }, text);
const icoBtn = (label, glyph, onclick, extra = {}) => h('button', { class: 'icon-btn', title: label, 'aria-label': label, onclick, ...extra }, glyph);
const center = () => { const c = map.getCenter(); return [c.lng, c.lat]; };

// ---------- inspector ----------
export function showInspector(content) {
  const el = $('#inspector');
  clear(el).append(h('button', { class: 'icon-btn insp-close', 'aria-label': 'Close', onclick: hideInspector }, '✕'), content);
  el.hidden = false;
}
export function hideInspector() { const el = $('#inspector'); if (el) { el.hidden = true; clear(el); } }

function propsTable(props, { skip = [] } = {}) {
  const rows = Object.entries(props || {}).filter(([k, v]) => !k.startsWith('_') && !skip.includes(k) && v !== null && v !== '' && typeof v !== 'object');
  if (!rows.length) return empty('No attributes.');
  return h('table', { class: 'props' }, h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, /^https?:\/\//.test(String(v)) ? h('a', { href: v, target: '_blank', rel: 'noopener' }, 'Open link') : String(v))))));
}

on('inspect', async (sel) => {
  const f = sel.feature;
  if (sel.catalog) return inspectCatalog(sel);
  if (sel.system === 'zone') return inspectZone(f.properties.id);
  if (sel.system === 'device') return inspectDevice(f.properties.id);
  const layer = state.mapRec?.layers.find((l) => l.id === sel.layerId);
  if (!layer) return;
  const id = f.properties._id ?? f.id;
  const full = cachedData(layer.id)?.features.find((x) => x.properties._id === id) || { type: 'Feature', geometry: f.geometry, properties: f.properties };
  inspectFeature(layer, id, full, sel.lngLat);
});

function inspectCatalog(sel) {
  const p = sel.feature.properties;
  const entry = state.catalog.find((c) => c.key === sel.catalog);
  const title = p.event || p.title || p.name || p.place || entry?.name || 'Feature';
  showInspector(h('div', { class: 'stack' },
    h('div', { class: 'eyebrow' }, entry?.name || 'Data layer'),
    h('h3', {}, title),
    p.headline ? h('p', {}, p.headline) : null,
    propsTable(p, { skip: ['headline', 'description', 'instruction'] }),
    p.description ? h('details', {}, h('summary', {}, 'Full text'), h('p', { class: 'pre' }, p.description), p.instruction ? h('p', { class: 'pre' }, p.instruction) : null) : null,
    entry ? h('p', { class: 'hint' }, `Source: ${entry.attribution}`) : null,
    isEditor() && !state.shareToken ? h('button', { class: 'btn', onclick: () => runReportAt(sel.lngLat.lng, sel.lngLat.lat) }, 'Site report here') : null));
}

function inspectFeature(layer, id, f, lngLat) {
  const editable = isEditor() && !state.shareToken;
  const props = { ...f.properties }; delete props._id;
  const body = h('div', { class: 'stack' });
  const draw = () => {
    clear(body).append(
      h('div', { class: 'eyebrow' }, layer.name),
      h('h3', {}, props.name || props.title || f.geometry.type),
      h('p', { class: 'mono muted small' }, describeGeometry(f.geometry)));
    if (!editable) { body.append(propsTable(props)); return; }
    const rows = h('div', { class: 'kv' });
    const addRow = (k = '', v = '') => {
      const row = h('div', { class: 'kv-row' },
        h('input', { class: 'kv-k', value: k, placeholder: 'Field', 'aria-label': 'Field name' }),
        h('input', { class: 'kv-v', value: typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''), placeholder: 'Value', 'aria-label': 'Value' }),
        icoBtn('Remove field', '✕', () => row.remove()));
      rows.append(row);
    };
    for (const [k, v] of Object.entries(props)) addRow(k, v);
    if (!Object.keys(props).length) addRow('name', '');
    body.append(rows,
      h('button', { class: 'btn link small', onclick: () => addRow() }, '+ Add field'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: async () => {
          const out = {};
          for (const r of rows.querySelectorAll('.kv-row')) {
            const k = r.querySelector('.kv-k').value.trim(); const raw = r.querySelector('.kv-v').value;
            if (!k) continue;
            out[k] = raw !== '' && Number.isFinite(Number(raw)) && !/^0\d/.test(raw) ? Number(raw) : raw;
          }
          try {
            await patch(`/features/${id}`, { properties: out });
            Object.assign(props, out); for (const k of Object.keys(props)) if (!(k in out)) delete props[k];
            await refreshLayer(layer); toast('Saved.'); draw();
          } catch (e) { fail(e); }
        } }, 'Save'),
        ['Point', 'LineString', 'Polygon'].includes(f.geometry.type) ? h('button', { class: 'btn', onclick: () => {
          hideInspector();
          const ok = editShape(f, async (geometry) => {
            try { await patch(`/features/${id}`, { geometry }); await refreshLayer(layer); toast('Shape saved.'); } catch (e) { fail(e); }
          });
          if (!ok) toast("This shape can't be edited on the map. Export it, edit, and upload again.", 'warn');
          else dropCacheAndHide(layer);
        } }, 'Edit shape') : null,
        h('button', { class: 'btn', onclick: () => { const [lon, lat] = pointOf(f.geometry, lngLat); runReportAt(lon, lat, props.name); } }, 'Site report'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!await confirmBox('Delete this shape?')) return;
          try { await del(`/features/${id}`); await refreshLayer(layer); hideInspector(); } catch (e) { fail(e); }
        } }, 'Delete')));
  };
  draw();
  showInspector(body);
}
// While a shape is being edited, hide the saved copy so the two don't overlap.
function dropCacheAndHide(layer) {
  for (const s of ['fill', 'outline', 'line', 'circle', 'label']) if (map.getLayer(`L-${layer.id}-${s}`)) map.setLayoutProperty(`L-${layer.id}-${s}`, 'visibility', 'none');
  const off = on('edit-state', (editing) => { if (!editing) { off(); renderLayer(layer); } });
}
function pointOf(g, lngLat) {
  if (g.type === 'Point') return g.coordinates;
  if (lngLat) return [lngLat.lng, lngLat.lat];
  const b = boundsOf({ features: [{ geometry: g }] });
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}
async function refreshLayer(layer) {
  dropCache(layer.id);
  const rec = await reloadMapRecord();
  const fresh = rec?.layers.find((l) => l.id === layer.id) || layer;
  await renderLayer(fresh);
}

// ---------- layers panel ----------
function layersPanel(side) {
  const rec = state.mapRec;
  const editable = isEditor() && !state.shareToken;
  side.append(head('Layers',
    editable && can('upload') ? h('button', { class: 'btn small', onclick: () => uploadDialog() }, 'Upload') : null,
    editable ? h('button', { class: 'btn small', onclick: () => showPanel('catalog') }, 'Add data') : null));

  const sys = section('Your workspace');
  for (const [key, label, count] of [['sites', 'Sites', state.sites.features.length], ['zones', 'Alert zones', state.zones.features.length], ['devices', 'Devices', state.devices.features.length]]) {
    sys.append(h('label', { class: 'layer-row sys' },
      h('input', { type: 'checkbox', checked: state.system[key], onchange: (e) => { state.system[key] = e.target.checked; renderSystem(); } }),
      h('i', { class: `sw sys-${key}` }), h('span', { class: 'layer-name' }, label), h('span', { class: 'count' }, fmtNum(count))));
  }
  side.append(sys);

  const list = section('On this map');
  const layers = [...(rec?.layers || [])].sort((a, b) => b.position - a.position);
  if (!layers.length) list.append(empty(editable ? 'No layers yet. Draw on the map, upload a file, or add live data.' : 'No layers.'));
  layers.forEach((l, i) => {
    const color = l.kind === 'catalog' ? '#94a3b8' : (l.style?.color || PALETTE[0]);
    const row = h('div', { class: `layer-row${l.visible ? '' : ' off'}` },
      h('input', { type: 'checkbox', checked: l.visible, 'aria-label': `Show ${l.name}`, onchange: async (e) => {
        l.visible = e.target.checked; row.classList.toggle('off', !l.visible); await renderLayer(l); renderLegend();
        if (editable) patch(`/layers/${l.id}`, { visible: l.visible }).catch(fail);
      } }),
      h('i', { class: 'sw', style: { background: color } }),
      h('div', { class: 'layer-main' },
        h('span', { class: 'layer-name' }, l.name),
        h('span', { class: 'layer-meta' }, l.kind === 'catalog' ? (state.catalog.find((c) => c.key === l.catalog_key)?.category || 'Live data') : `${fmtNum(l.feature_count)} shape${l.feature_count === 1 ? '' : 's'}${l.style?.mode && l.style.mode !== 'simple' ? ` · ${l.style.mode}` : ''}`)),
      h('div', { class: 'layer-actions' },
        l.kind === 'features' && l.feature_count ? icoBtn('Zoom to layer', '⤢', async () => { const fc = await loadLayerData(l); fitTo(boundsOf(fc)); }) : null,
        editable ? icoBtn('Style and settings', '⚙', () => openLayerEditor(l)) : null,
        editable && i > 0 ? icoBtn('Move up', '↑', () => moveLayer(layers, i, -1)) : null,
        editable && i < layers.length - 1 ? icoBtn('Move down', '↓', () => moveLayer(layers, i, 1)) : null));
    if (editable && l.kind === 'features') {
      row.addEventListener('click', (e) => { if (e.target.closest('button, input')) return; state.drawTarget = `layer:${l.id}`; emit('layers'); toast(`New drawings go to "${l.name}".`); });
      if (state.drawTarget === `layer:${l.id}`) row.classList.add('target');
    }
    list.append(row);
  });
  side.append(list);
  if (editable && layers.some((l) => l.kind === 'features')) side.append(h('p', { class: 'hint pad' }, 'Click a layer to send new drawings to it.'));
}

async function moveLayer(sorted, i, dir) {
  const a = sorted[i]; const b = sorted[i + dir];
  try {
    await Promise.all([patch(`/layers/${a.id}`, { position: b.position }), patch(`/layers/${b.id}`, { position: a.position })]);
    [a.position, b.position] = [b.position, a.position];
    if (a.position === b.position) { a.position += -dir; }
    for (const l of [...state.mapRec.layers].sort((x, y) => x.position - y.position)) if (map.getStyle().layers.some((s) => s.id.startsWith(`L-${l.id}`))) await renderLayer(l);
    renderSystem();
    emit('layers');
  } catch (e) { fail(e); }
}

export function renderLegend() {
  const lg = $('#legend');
  if (!lg || state.shareToken) return;
  clear(lg);
  const rows = [];
  for (const l of [...(state.mapRec?.layers || [])].sort((a, b) => b.position - a.position)) {
    if (!l.visible) continue;
    if (l.kind === 'catalog') { rows.push(h('div', { class: 'legend-row' }, h('i', { class: 'sw', style: { background: '#94a3b8' } }), l.name)); continue; }
    const items = legendFor({ color: '#1f5fbf', ...l.style }, cachedData(l.id));
    if (items.length <= 1) rows.push(h('div', { class: 'legend-row' }, h('i', { class: 'sw', style: { background: items[0]?.color || l.style?.color } }), l.name));
    else rows.push(h('div', { class: 'legend-group' }, h('div', { class: 'legend-sub' }, `${l.name}: ${l.style.field}`), items.map((it) => h('div', { class: 'legend-row' }, h('i', { class: 'sw', style: { background: it.color } }), it.label))));
  }
  lg.hidden = !rows.length;
  if (rows.length) lg.append(h('div', { class: 'legend-title' }, 'Legend'), ...rows);
}
on('layers', renderLegend);
on('map-opened', () => setTimeout(renderLegend, 800));

// ---------- layer editor ----------
export async function openLayerEditor(layer) {
  const s = { color: '#1f5fbf', opacity: 0.35, width: 2, radius: 6, mode: 'simple', ...layer.style };
  const isCatalog = layer.kind === 'catalog';
  let fc = null;
  if (!isCatalog) fc = await loadLayerData(layer).catch(() => null);
  const fields = [...new Set((fc?.features || []).slice(0, 300).flatMap((f) => Object.keys(f.properties || {})).filter((k) => !k.startsWith('_')))];
  const numeric = fields.filter((k) => fc.features.some((f) => Number.isFinite(Number(f.properties?.[k])) && f.properties?.[k] !== ''));
  const pro = can('customStyles');

  const name = h('input', { value: layer.name, maxlength: 120 });
  const color = h('input', { type: 'color', value: s.color });
  const swatches = h('div', { class: 'swatches' }, PALETTE.map((c) => h('button', { type: 'button', class: 'swatch', style: { background: c }, 'aria-label': c, onclick: () => { color.value = c; preview(); } })));
  const opacity = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.opacity });
  const width = h('input', { type: 'range', min: 0, max: 12, step: 0.5, value: s.width });
  const radius = h('input', { type: 'range', min: 2, max: 20, step: 1, value: s.radius });
  const MODES = [['simple', 'One color'], ['categories', 'Color by category'], ['graduated', 'Color by number'], ['heatmap', 'Heatmap (points)'], ['cluster', 'Cluster points'], ['extrude', '3D extrude (areas)']];
  const mode = h('select', {}, MODES.map(([k, label]) => h('option', { value: k, selected: s.mode === k, disabled: !pro && ['categories', 'graduated', 'heatmap', 'extrude'].includes(k) }, label + (!pro && ['categories', 'graduated', 'heatmap', 'extrude'].includes(k) ? ' (Professional)' : ''))));
  const fieldSel = h('select', {}, h('option', { value: '' }, 'Choose a field'), fields.map((k) => h('option', { value: k, selected: s.field === k }, k)));
  const label = h('select', {}, h('option', { value: '' }, 'No labels'), fields.map((k) => h('option', { value: k, selected: s.label === k }, k)));
  const fieldWrap = field('Field', fieldSel, 'Categories use any field. Number styles, heatmap weight and 3D height use numeric fields.');
  const syncMode = () => {
    fieldWrap.hidden = ['simple', 'cluster'].includes(mode.value);
    for (const o of fieldSel.options) if (o.value) o.disabled = ['graduated', 'extrude', 'heatmap'].includes(mode.value) && !numeric.includes(o.value);
  };
  mode.addEventListener('change', () => { syncMode(); preview(); });
  syncMode();
  const collect = () => (isCatalog ? { opacity: Number(opacity.value) } : { color: color.value, opacity: Number(opacity.value), width: Number(width.value), radius: Number(radius.value), mode: mode.value, field: fieldSel.value, label: label.value });
  let pTimer;
  const preview = () => { clearTimeout(pTimer); pTimer = setTimeout(() => renderLayer({ ...layer, style: { ...layer.style, ...collect() } }).then(renderLegend), 120); };
  for (const el of [color, opacity, width, radius, fieldSel, label]) el.addEventListener('input', preview);

  let saved = false;
  const body = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const out = await patch(`/layers/${layer.id}`, { name: name.value, style: collect() });
      Object.assign(layer, { name: out.name, style: out.style });
      saved = true; m.close(); await renderLayer(layer); emit('layers'); toast('Layer updated.');
    } catch (err) { fail(err); }
  } },
  field('Name', name),
  isCatalog ? null : h('div', { class: 'grid2' }, field('Color', h('div', { class: 'row' }, color, swatches)), field('Style', mode)),
  isCatalog ? null : fieldWrap,
  h('div', { class: 'grid3' }, field('Opacity', opacity), isCatalog ? null : field('Line width', width), isCatalog ? null : field('Point size', radius)),
  isCatalog ? null : field('Labels', label),
  !pro && !isCatalog ? h('p', { class: 'hint' }, 'Data-driven styles come with the Professional plan. ', h('button', { type: 'button', class: 'btn link small', onclick: () => showUpgrade('Data-driven styling comes with the Professional plan.') }, 'See plans')) : null,
  !isCatalog && layer.feature_count ? h('div', { class: 'row wrap' }, h('span', { class: 'muted small' }, 'Download:'),
    ['geojson', 'csv', 'kml'].map((fmt) => h('a', { class: 'btn small', href: `${API}/layers/${layer.id}/export.${fmt}`, download: '', onclick: (e) => { if (!can('export')) { e.preventDefault(); showUpgrade('Export needs a paid plan.'); } } }, fmt.toUpperCase()))) : null,
  h('div', { class: 'row between' },
    h('button', { type: 'button', class: 'btn danger', onclick: async () => {
      if (!await confirmBox(`Delete the layer "${layer.name}"${layer.feature_count ? ` and its ${fmtNum(layer.feature_count)} shapes` : ''}?`)) return;
      try { await del(`/layers/${layer.id}`); saved = true; renderLayer({ ...layer, visible: false }); await reloadMapRecord(); toast('Layer deleted.'); } catch (err) { fail(err); }
    } }, 'Delete layer'),
    h('button', { type: 'submit', class: 'btn primary' }, 'Save')));
  const m = modal(`Layer: ${layer.name}`, body, { onClose: () => { if (!saved) renderLayer(layer).then(renderLegend); } });
}

// ---------- uploads ----------
function uploadDialog() {
  const input = h('input', { type: 'file', accept: '.geojson,.json,.kml,.kmz,.gpx,.csv,.txt,.zip' });
  const name = h('input', { placeholder: 'Layer name (optional)', maxlength: 120 });
  const status = h('p', { class: 'muted small' });
  const drop = h('div', { class: 'dropzone' }, h('strong', {}, 'Drop a file here'), h('span', {}, 'or choose one below'), input);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) { input.files = e.dataTransfer.files; status.textContent = input.files[0].name; } });
  input.addEventListener('change', () => { status.textContent = input.files[0]?.name || ''; });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Upload');
  const m = modal('Upload data', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const file = input.files[0];
    if (!file) { status.textContent = 'Choose a file first.'; return; }
    const form = new FormData(); form.append('file', file); if (name.value) form.append('name', name.value);
    btn.disabled = true; status.textContent = 'Uploading and reading the file...';
    try {
      const out = await api(`/maps/${state.mapRec.id}/upload`, { method: 'POST', form });
      m.close();
      await reloadMapRecord();
      const layer = state.mapRec.layers.find((l) => l.id === out.layer.id);
      if (layer) await renderLayer(layer);
      if (out.bounds) fitTo(out.bounds);
      toast(`Imported ${fmtNum(out.imported)} shapes${out.geocoded ? ` (${out.geocoded} addresses located)` : ''}${out.skipped ? `. Skipped ${out.skipped} rows without a location.` : '.'}`);
      state.drawTarget = `layer:${out.layer.id}`;
    } catch (err) { btn.disabled = false; status.textContent = ''; fail(err); }
  } },
  drop, field('Layer name', name), status,
  h('p', { class: 'hint' }, 'GeoJSON, KML, KMZ, GPX, shapefile (.zip) or CSV. A CSV needs latitude and longitude columns, or an address column (up to 200 addresses are located).'),
  h('div', { class: 'row end' }, btn)));
}

// ---------- data catalog ----------
function catalogPanel(side) {
  side.append(head('Live data'), h('p', { class: 'muted pad' }, 'Public data layers, kept current for you. Add one to this map.'));
  const onMap = new Set((state.mapRec?.layers || []).filter((l) => l.kind === 'catalog').map((l) => l.catalog_key));
  const groups = new Map();
  for (const c of state.catalog) (groups.get(c.category) || groups.set(c.category, []).get(c.category)).push(c);
  for (const [cat, entries] of groups) {
    side.append(section(cat, ...entries.map((c) => h('div', { class: 'cat-card' },
      h('div', { class: 'cat-top' }, h('strong', {}, c.name), c.tier === 'premium' ? h('span', { class: `tag${c.locked ? ' locked' : ''}` }, c.locked ? 'Professional' : 'Premium') : null),
      h('p', { class: 'small' }, c.description),
      h('p', { class: 'hint' }, `${c.attribution}. ${c.license}.`),
      onMap.has(c.key) ? h('span', { class: 'muted small' }, '✓ On this map')
        : isEditor() && !state.shareToken ? h('button', { class: 'btn small', onclick: async () => {
          if (c.locked) { showUpgrade(`${c.name} comes with the Professional plan.`); return; }
          try {
            const l = await post(`/maps/${state.mapRec.id}/layers`, { kind: 'catalog', catalog_key: c.key });
            await reloadMapRecord();
            await renderLayer({ ...l, visible: true });
            toast(`Added ${c.name}.`);
            if (c.minzoom && map.getZoom() < c.minzoom) emit('hint', `Zoom in to level ${c.minzoom} or closer to see ${c.name.toLowerCase()}.`);
            showPanel('catalog');
          } catch (e) { fail(e); }
        } }, 'Add to map') : null))));
  }
}

// ---------- maps ----------
function mapsPanel(side) {
  const editable = isEditor() && !state.shareToken;
  side.append(head('Maps', editable ? h('button', { class: 'btn primary small', onclick: newMap }, 'New map') : null));
  const list = section(null);
  if (!state.maps.length) list.append(empty('No maps yet.'));
  for (const m of state.maps) {
    list.append(h('div', { class: `map-card${state.mapRec?.id === m.id ? ' current' : ''}` },
      h('button', { class: 'map-open', onclick: () => openMap(m.id).catch(fail) },
        h('strong', {}, m.name),
        h('span', { class: 'small muted' }, `${m.layer_count} layer${m.layer_count === 1 ? '' : 's'} · ${m.visibility === 'private' ? 'Only me' : m.visibility === 'team' ? 'Team' : 'Shared link'} · ${ago(m.updated_at)}`),
        m.description ? h('span', { class: 'small' }, m.description) : null),
      editable ? h('div', { class: 'row' },
        icoBtn('Duplicate', '⧉', async () => { try { const c = await post(`/maps/${m.id}/duplicate`, {}); state.maps = await get('/maps'); emit('maps-changed'); toast(`Made "${c.name}".`); } catch (e) { fail(e); } }),
        icoBtn('Delete', '🗑', async () => {
          if (!await confirmBox(`Delete the map "${m.name}" and all its layers?`)) return;
          try {
            await del(`/maps/${m.id}`); state.maps = await get('/maps');
            if (state.mapRec?.id === m.id) { if (state.maps[0]) await openMap(state.maps[0].id); else location.reload(); }
            emit('maps-changed');
          } catch (e) { fail(e); }
        })) : null));
  }
  side.append(list);
}
async function newMap() {
  const name = await askName('New map', 'Untitled map');
  if (!name) return;
  try {
    const c = map.getCenter();
    const m = await post('/maps', { name, style: state.mapRec?.style, view: { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: 0, bearing: 0 } });
    state.maps = await get('/maps');
    await openMap(m.id);
    showPanel('layers');
  } catch (e) { fail(e); }
}
// Remember the view so the map reopens where the user left it.
let viewTimer;
on('moved', () => {
  if (!state.mapRec || !isEditor() || state.shareToken || state.session?.demo) return;
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    const c = map.getCenter();
    patch(`/maps/${state.mapRec.id}`, { view: { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() } }).catch(() => {});
  }, 2500);
});

// ---------- sites ----------
function sitesPanel(side) {
  const editable = isEditor() && !state.shareToken;
  side.append(head('Sites', editable ? h('button', { class: 'btn primary small', onclick: addSiteDialog }, 'Add site') : null),
    h('p', { class: 'muted pad' }, 'Places you watch: offices, yards, towers, properties. Weather alerts and reports use them.'));
  const filter = h('input', { type: 'search', placeholder: 'Filter sites', class: 'filter' });
  const list = h('div', { class: 'list' });
  const draw = () => {
    const q = filter.value.toLowerCase();
    clear(list);
    const feats = state.sites.features.filter((f) => !q || `${f.properties.name} ${f.properties.address}`.toLowerCase().includes(q));
    if (!feats.length) list.append(empty(state.sites.features.length ? 'No matches.' : 'No sites yet. Add one by address or drop a point with the drawing tools.'));
    for (const f of feats) {
      list.append(h('button', { class: 'list-item', onclick: () => { map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 14) }); openSiteInspector(f.properties.id); } },
        h('strong', {}, f.properties.name), h('span', { class: 'small muted' }, f.properties.address || f.geometry.coordinates.map((v) => v.toFixed(4)).reverse().join(', '))));
    }
  };
  filter.addEventListener('input', draw);
  draw();
  side.append(section(null, state.sites.features.length > 6 ? filter : null, list));
}
function addSiteDialog() {
  const name = h('input', { required: true, maxlength: 120, placeholder: 'North yard' });
  const address = h('input', { maxlength: 300, placeholder: '175 E 2nd St, Tulsa, OK 74103' });
  const m = modal('Add a site', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const s = address.value.trim() ? await post('/sites', { name: name.value, address: address.value }) : await post('/sites', { name: name.value, lon: center()[0], lat: center()[1] });
      m.close(); await refreshSites(); map.flyTo({ center: [s.lon, s.lat], zoom: 15 }); toast(`Added "${s.name}".`);
    } catch (err) { fail(err); }
  } }, field('Name', name), field('Street address', address, 'Leave blank to place it at the center of the map.'),
  h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add site'))));
}
export function openSiteInspector(id) {
  const f = state.sites.features.find((x) => x.properties.id === id);
  if (!f) return;
  const p = f.properties; const [lon, lat] = f.geometry.coordinates;
  const editable = isEditor() && !state.shareToken;
  showInspector(h('div', { class: 'stack' },
    h('div', { class: 'eyebrow' }, 'Site'),
    h('h3', {}, p.name),
    p.address ? h('p', {}, p.address) : null,
    h('p', { class: 'mono muted small' }, `${lat.toFixed(5)}, ${lon.toFixed(5)}`),
    editable ? h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => runReportAt(lon, lat, p.address ? `${p.name}, ${p.address}` : p.name, id) }, 'Site report'),
      h('button', { class: 'btn', onclick: async () => {
        const n = await askName('Rename site', p.name);
        if (n) { try { await patch(`/sites/${id}`, { name: n }); await refreshSites(); openSiteInspector(id); } catch (e) { fail(e); } }
      } }, 'Rename'),
      h('button', { class: 'btn', onclick: () => {
        hideInspector();
        editShape(f, async (g) => { try { await patch(`/sites/${id}`, { lon: g.coordinates[0], lat: g.coordinates[1] }); await refreshSites(); toast('Site moved.'); } catch (e) { fail(e); } });
      } }, 'Move'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!await confirmBox(`Delete the site "${p.name}"?`)) return;
        try { await del(`/sites/${id}`); await refreshSites(); hideInspector(); } catch (e) { fail(e); }
      } }, 'Delete')) : null));
}

// ---------- zones and devices ----------
function inspectZone(id) {
  const f = state.zones.features.find((x) => x.properties.id === id);
  if (!f) return;
  const editable = isEditor() && !state.shareToken;
  showInspector(h('div', { class: 'stack' },
    h('div', { class: 'eyebrow' }, 'Alert zone'),
    h('h3', {}, f.properties.name),
    h('p', { class: 'mono muted small' }, describeGeometry(f.geometry)),
    editable ? h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => { hideInspector(); showPanel('alerts'); ruleDialog({ trigger: { type: 'zone_exit', zone_id: id } }); } }, 'Add alert rule'),
      h('button', { class: 'btn', onclick: async () => { const n = await askName('Rename zone', f.properties.name); if (n) { try { await patch(`/zones/${id}`, { name: n }); await refreshZones(); inspectZone(id); } catch (e) { fail(e); } } } }, 'Rename'),
      f.geometry.type === 'Polygon' ? h('button', { class: 'btn', onclick: () => {
        hideInspector();
        editShape(f, async (geometry) => { try { await patch(`/zones/${id}`, { geometry }); await refreshZones(); toast('Zone updated.'); } catch (e) { fail(e); } });
      } }, 'Edit shape') : null,
      h('button', { class: 'btn danger', onclick: async () => {
        if (!await confirmBox(`Delete the zone "${f.properties.name}"? Rules that use it stop working.`)) return;
        try { await del(`/zones/${id}`); await refreshZones(); hideInspector(); } catch (e) { fail(e); }
      } }, 'Delete')) : null));
}

let trackLayer = false;
async function showTrack(d) {
  try {
    const t = await get(`/devices/${d.id}/track?hours=24`);
    if (map.getSource('S-track')) { map.removeLayer('S-track-line'); map.removeSource('S-track'); }
    if (t.geometry.coordinates.length < 2) { toast(`${d.name} has no movement in the past 24 hours.`); return; }
    map.addSource('S-track', { type: 'geojson', data: t });
    map.addLayer({ id: 'S-track-line', type: 'line', source: 'S-track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0f766e', 'line-width': 3, 'line-dasharray': [1, 1.5] } }, map.getLayer('S-devices-dot') ? 'S-devices-dot' : undefined);
    trackLayer = true;
    fitTo(boundsOf({ features: [t] }));
    toast(`${t.properties.points} positions in the past 24 hours.`);
  } catch (e) { fail(e); }
}
on('style-loaded', () => { trackLayer = false; });

function inspectDevice(id) {
  const d = state.devices.devices.find((x) => x.id === id);
  if (!d) return;
  showInspector(h('div', { class: 'stack' },
    h('div', { class: 'eyebrow' }, `Device · ${d.kind}`),
    h('h3', {}, d.name),
    h('table', { class: 'props' }, h('tbody', {},
      h('tr', {}, h('th', {}, 'Last seen'), h('td', {}, d.last_seen_at ? `${ago(d.last_seen_at)} (${fmtDate(d.last_seen_at)})` : 'never')),
      h('tr', {}, h('th', {}, 'Speed'), h('td', {}, d.last_speed_mph !== null ? `${Math.round(d.last_speed_mph)} mph` : 'n/a')),
      h('tr', {}, h('th', {}, 'Position'), h('td', { class: 'mono' }, d.lat !== null ? `${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}` : 'n/a')),
      h('tr', {}, h('th', {}, 'Device ID'), h('td', { class: 'mono' }, d.external_id)))),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: () => showTrack(d) }, 'Track, 24 hours'),
      isEditor() && !state.shareToken ? h('button', { class: 'btn', onclick: () => ingestHelp(d) }, 'Connect a tracker') : null)));
}

function devicesPanel(side) {
  const editable = isEditor() && !state.shareToken;
  side.append(head('Devices', editable ? h('button', { class: 'btn primary small', onclick: addDeviceDialog }, 'Add device') : null),
    h('p', { class: 'muted pad' }, 'Vehicles, trackers and sensors that report their position.'));
  const list = section(null);
  if (!state.devices.devices.length) list.append(empty('No devices yet.'));
  for (const d of state.devices.devices) {
    const fresh = d.last_seen_at && Date.now() - new Date(d.last_seen_at) < 30 * 60e3;
    list.append(h('div', { class: 'list-item row between' },
      h('button', { class: 'plain', onclick: () => { if (d.lon !== null) map.flyTo({ center: [d.lon, d.lat], zoom: Math.max(map.getZoom(), 14) }); inspectDevice(d.id); } },
        h('span', { class: `dot ${fresh ? 'on' : 'off'}`, title: fresh ? 'Reporting' : 'Not reporting' }),
        h('strong', {}, d.name), h('span', { class: 'small muted' }, ` ${ago(d.last_seen_at)}${d.last_speed_mph ? ` · ${Math.round(d.last_speed_mph)} mph` : ''}`)),
      editable ? icoBtn('Delete device', '🗑', async () => {
        if (!await confirmBox(`Delete ${d.name} and its position history?`)) return;
        try { await del(`/devices/${d.id}`); await refreshDevices(); } catch (e) { fail(e); }
      }) : null));
  }
  side.append(list);

  const zones = section('Alert zones');
  if (!can('geofences')) zones.append(h('p', { class: 'small' }, 'Alert zones (geofences) come with the Professional plan. ', h('button', { class: 'btn link small', onclick: () => showUpgrade('Alert zones come with the Professional plan.') }, 'See plans')));
  else if (!state.zones.features.length) zones.append(empty('No zones yet. In the drawing toolbar, pick "Save as: alert zone" and draw an area.'));
  for (const z of state.zones.features) {
    zones.append(h('button', { class: 'list-item', onclick: () => { fitTo(boundsOf({ features: [z] })); inspectZone(z.properties.id); } },
      h('span', {}, h('i', { class: 'sw', style: { background: z.properties.color } }), ' ', h('strong', {}, z.properties.name))));
  }
  if (editable && can('geofences')) zones.append(h('button', { class: 'btn small', onclick: () => { state.drawTarget = 'zone'; emit('layers'); toast('Pick polygon, rectangle, circle or freehand in the toolbar and draw the zone.'); } }, 'Draw a zone'));
  side.append(zones);
}

function addDeviceDialog() {
  const name = h('input', { required: true, maxlength: 120, placeholder: 'Truck 14' });
  const kind = h('select', {}, ['vehicle', 'tracker', 'phone', 'sensor', 'asset'].map((k) => h('option', { value: k }, k)));
  const ext = h('input', { maxlength: 120, placeholder: 'IMEI, serial or any ID (optional)' });
  const m = modal('Add a device', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try { const d = await post('/devices', { name: name.value, kind: kind.value, external_id: ext.value || undefined }); m.close(); await refreshDevices(); ingestHelp(d); } catch (err) { fail(err); }
  } }, field('Name', name), field('Type', kind), field('Device ID', ext, 'Your tracker sends this ID with each position.'),
  h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add device'))));
}
function ingestHelp(d) {
  const url = `${location.origin}${API}/v1/devices/${encodeURIComponent(d.external_id)}/positions`;
  const curl = `curl -X POST "${url}" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"lat": 36.154, "lon": -95.993, "speed_mph": 31}'`;
  modal(`Connect ${d.name}`, h('div', { class: 'stack' },
    h('p', {}, 'Have the tracker, phone app or gateway send each position to this address. Positions can also be sent in batches as {"positions": [...]} with a "time" on each.'),
    h('pre', { class: 'code' }, curl),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => copyText(curl) }, 'Copy example'),
      can('api') ? h('button', { class: 'btn', onclick: () => import('./settings.js').then((s) => s.openSettings('keys')) }, 'Create an API key') : h('span', { class: 'small muted' }, 'API keys come with the Professional plan.')),
    h('p', { class: 'hint' }, 'Alert rules run on every position: zone exits and entries, speeding, and going offline.')), { wide: true });
}

// ---------- alerts ----------
const TRIGGER_LABELS = { zone_exit: 'Leaves a zone', zone_enter: 'Enters a zone', offline: 'Stops reporting', speed: 'Goes over a speed', nws_warning: 'Weather warning at a site or zone', earthquake: 'Earthquake near a site' };
function describeRule(r) {
  const t = r.trigger;
  const dev = t.device_id ? state.devices.devices.find((d) => d.id === t.device_id)?.name || 'a device' : 'Any device';
  const zone = t.zone_id ? state.zones.features.find((z) => z.properties.id === t.zone_id)?.properties.name || 'a zone' : '';
  switch (t.type) {
    case 'zone_exit': return `${dev} leaves ${zone}`;
    case 'zone_enter': return `${dev} enters ${zone}`;
    case 'offline': return `${dev} silent for ${t.minutes} min`;
    case 'speed': return `${dev} over ${t.mph} mph`;
    case 'nws_warning': return `NWS ${t.events?.length ? t.events.join(', ') : 'warnings'} at your ${t.target}`;
    case 'earthquake': return `M${t.min_mag}+ within ${t.radius_mi} mi of a site`;
    default: return t.type;
  }
}
async function alertsPanel(side) {
  const editable = isEditor() && !state.shareToken;
  side.append(head('Alerts', editable ? h('button', { class: 'btn primary small', onclick: () => ruleDialog() }, 'New rule') : null));
  if (!can('alerts')) {
    side.append(section(null, h('p', {}, 'Alert rules watch your devices, zones and sites, and send email, text and webhook notices.'), h('button', { class: 'btn primary', onclick: () => showUpgrade('Alerts come with the Professional plan.') }, 'See plans')));
    return;
  }
  const rulesSec = section('Rules', h('p', { class: 'muted small' }, 'Loading...'));
  const feedSec = section('Recent alerts', h('p', { class: 'muted small' }, 'Loading...'));
  side.append(rulesSec, feedSec);
  const [rules, alerts] = await Promise.all([get('/rules'), get('/alerts')]);
  clear(rulesSec).append(h('h3', { class: 'sec-title' }, 'Rules'));
  if (!rules.length) rulesSec.append(empty('No rules yet.'));
  for (const r of rules) {
    const ch = r.channels || {};
    rulesSec.append(h('div', { class: `rule-card${r.enabled ? '' : ' off'}` },
      h('div', { class: 'row between' }, h('strong', {}, r.name),
        editable ? h('label', { class: 'switch', title: r.enabled ? 'On' : 'Off' }, h('input', { type: 'checkbox', checked: r.enabled, onchange: async (e) => { try { await patch(`/rules/${r.id}`, { enabled: e.target.checked }); showPanel('alerts'); } catch (err) { fail(err); } } }), h('span', {})) : null),
      h('p', { class: 'small' }, describeRule(r)),
      h('p', { class: 'hint' }, [ch.emails?.length ? `${ch.emails.length} email` : '', ch.sms?.length ? `${ch.sms.length} text` : '', ch.webhooks?.length ? `${ch.webhooks.length} webhook` : ''].filter(Boolean).join(' · ') || 'Recorded here only'),
      editable ? h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => ruleDialog(r) }, 'Edit'),
        h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox(`Delete the rule "${r.name}"?`)) { try { await del(`/rules/${r.id}`); showPanel('alerts'); } catch (e) { fail(e); } } } }, 'Delete')) : null));
  }
  clear(feedSec).append(h('h3', { class: 'sec-title' }, 'Recent alerts'));
  if (!alerts.length) feedSec.append(empty('Nothing has fired yet.'));
  for (const a of alerts) {
    const d = a.delivery || {};
    const sent = d.note ? 'Recorded only (demo)' : ['emails', 'sms', 'webhooks'].flatMap((k) => (d[k] || []).map((x) => `${x.to}: ${x.ok ? 'sent' : x.skipped ? 'not sent' : 'failed'}`)).join(' · ');
    feedSec.append(h('div', { class: 'alert-item' },
      h('div', { class: 'row between' }, h('strong', {}, a.title), h('span', { class: 'small muted' }, ago(a.created_at))),
      a.body ? h('p', { class: 'small' }, a.body) : null,
      h('p', { class: 'hint' }, `${a.rule_name || 'Rule deleted'}${sent ? ` · ${sent}` : ''}`),
      a.data?.lon !== undefined ? h('button', { class: 'btn link small', onclick: () => map.flyTo({ center: [a.data.lon, a.data.lat], zoom: 14 }) }, 'Show on map') : null));
  }
}

function ruleDialog(rule = null) {
  const t = rule?.trigger || {};
  const ch = rule?.channels || {};
  const name = h('input', { required: true, maxlength: 120, value: rule?.name || '' });
  const type = h('select', {}, Object.entries(TRIGGER_LABELS).map(([k, v]) => h('option', { value: k, selected: t.type === k }, v)));
  const device = h('select', {}, h('option', { value: '' }, 'Any device'), state.devices.devices.map((d) => h('option', { value: d.id, selected: t.device_id === d.id }, d.name)));
  const zone = h('select', {}, state.zones.features.map((z) => h('option', { value: z.properties.id, selected: t.zone_id === z.properties.id }, z.properties.name)));
  const minutes = h('input', { type: 'number', min: 1, max: 10080, value: t.minutes || 30 });
  const mph = h('input', { type: 'number', min: 1, max: 300, value: t.mph || 70 });
  const target = h('select', {}, h('option', { value: 'sites', selected: t.target !== 'zones' }, 'Sites'), h('option', { value: 'zones', selected: t.target === 'zones' }, 'Alert zones'));
  const events = h('input', { value: (t.events || []).join(', '), placeholder: 'Tornado Warning, Severe Thunderstorm Warning' });
  const minMag = h('input', { type: 'number', min: 1, max: 9, step: 0.1, value: t.min_mag || 3 });
  const radiusMi = h('input', { type: 'number', min: 1, max: 500, value: t.radius_mi || 50 });
  const emails = h('input', { value: (ch.emails || []).join(', '), placeholder: 'ops@example.com' });
  const sms = h('input', { value: (ch.sms || []).join(', '), placeholder: '+19185551234', disabled: !can('sms') });
  const hooks = h('input', { value: (ch.webhooks || []).join(', '), placeholder: 'https://example.com/hooks/iobeacons' });
  const cooldown = h('input', { type: 'number', min: 1, max: 10080, value: rule?.cooldown_minutes || 30 });
  const f = {
    device: field('Device', device), zone: field('Zone', zone, state.zones.features.length ? null : 'Draw an alert zone first.'), minutes: field('Minutes without a position', minutes),
    mph: field('Speed limit (mph)', mph), target: field('Watch', target), events: field('Only these warnings (optional)', events, 'Comma separated. Leave blank for all warnings.'),
    minMag: field('Minimum magnitude', minMag), radiusMi: field('Distance from a site (miles)', radiusMi),
  };
  const show = { zone_exit: ['device', 'zone'], zone_enter: ['device', 'zone'], offline: ['device', 'minutes'], speed: ['device', 'mph'], nws_warning: ['target', 'events'], earthquake: ['minMag', 'radiusMi'] };
  const sync = () => { for (const [k, el] of Object.entries(f)) el.hidden = !show[type.value].includes(k); if (!name.value || name.dataset.auto) { name.value = TRIGGER_LABELS[type.value]; name.dataset.auto = '1'; } };
  name.addEventListener('input', () => { delete name.dataset.auto; });
  type.addEventListener('change', sync);
  sync();
  const list = (el) => el.value.split(',').map((s) => s.trim()).filter(Boolean);
  const m = modal(rule?.id ? 'Edit alert rule' : 'New alert rule', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const trigger = { type: type.value, device_id: device.value || undefined, zone_id: zone.value || undefined, minutes: Number(minutes.value), mph: Number(mph.value), target: target.value, events: list(events), min_mag: Number(minMag.value), radius_mi: Number(radiusMi.value) };
    const body = { name: name.value, trigger, channels: { emails: list(emails), sms: list(sms), webhooks: list(hooks) }, cooldown_minutes: Number(cooldown.value) };
    try { if (rule?.id) await patch(`/rules/${rule.id}`, body); else await post('/rules', body); m.close(); showPanel('alerts'); toast('Rule saved.'); } catch (err) { fail(err); }
  } },
  h('div', { class: 'grid2' }, field('When', type), field('Rule name', name)),
  h('div', { class: 'grid2' }, ...Object.values(f)),
  h('h4', {}, 'Send to'),
  field('Email', emails, 'Comma separated.'),
  field('Text message', sms, can('sms') ? 'Include the country code.' : 'Text messages come with the Professional plan.'),
  field('Webhook', hooks, rule?.channels?.webhookSecret ? `Signed with X-IoBeacons-Signature (HMAC SHA-256). Secret: ${rule.channels.webhookSecret}` : 'Each call is signed with an HMAC SHA-256 header.'),
  field('Wait between repeats (minutes)', cooldown),
  state.session?.demo ? h('p', { class: 'hint' }, 'In the open demo, alerts are recorded here but nothing is sent.') : null,
  h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save rule'))), { wide: true });
}

// ---------- reports ----------
async function reportsPanel(side) {
  const editable = isEditor() && !state.shareToken;
  side.append(head('Reports', editable ? h('button', { class: 'btn primary small', onclick: () => { const [lon, lat] = center(); runReportAt(lon, lat); } }, 'Report at map center') : null),
    h('p', { class: 'muted pad' }, 'Site intelligence: weather, flood zone, elevation, soil, demographics, hazards and infrastructure for any point. Click a site or anything on the map for a report there.'));
  const list = section('Recent', h('p', { class: 'muted small' }, 'Loading...'));
  side.append(list);
  const rows = await get('/reports');
  clear(list).append(h('h3', { class: 'sec-title' }, 'Recent'));
  if (!rows.length) list.append(empty('No reports yet.'));
  for (const r of rows) {
    list.append(h('button', { class: 'list-item', onclick: async () => { try { showReport(await get(`/reports/${r.id}`)); } catch (e) { fail(e); } } },
      h('strong', {}, r.title), h('span', { class: 'small muted' }, `${fmtDate(r.created_at)} · ${r.radius_mi} mi radius`)));
  }
  const usage = await get('/usage').catch(() => null);
  const lim = state.session?.plan?.limits?.reports;
  if (usage && lim !== undefined) side.append(h('p', { class: 'hint pad' }, `${fmtNum(usage.reports)} of ${fmtNum(lim)} reports used this month.`));
}

export async function runReportAt(lon, lat, title, siteId) {
  if (!isEditor()) { toast('Reports need an editor account.', 'warn'); return; }
  const radius = h('select', {}, [0.25, 0.5, 1, 2, 5].map((r) => h('option', { value: r, selected: r === 1 }, `${r} mile${r === 1 ? '' : 's'}`)));
  const titleIn = h('input', { value: title || '', placeholder: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, maxlength: 200 });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Build report');
  const m = modal('Site report', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Gathering data...';
    try {
      const r = await post('/reports', siteId ? { site_id: siteId, title: titleIn.value || undefined, radius_mi: Number(radius.value) } : { lon, lat, title: titleIn.value || undefined, radius_mi: Number(radius.value) });
      m.close(); showReport(r);
      if ($('#side .panel-head h2')?.textContent === 'Reports') showPanel('reports');
    } catch (err) { btn.disabled = false; btn.textContent = 'Build report'; fail(err); }
  } },
  h('p', { class: 'mono muted small' }, `${lat.toFixed(5)}, ${lon.toFixed(5)}`),
  field('Title', titleIn), field('Search radius', radius),
  h('p', { class: 'hint' }, 'Pulls from the National Weather Service, USGS, FEMA, USDA, the Census Bureau and OpenStreetMap. Takes about 10 seconds.'),
  h('div', { class: 'row end' }, btn)));
}

const TITLES = { weather: 'Weather forecast', warnings: 'Active weather warnings', elevation: 'Elevation', flood: 'FEMA flood zone', soil: 'Soil', demographics: 'Demographics', hazards: 'Nearby hazards', infrastructure: 'Nearby infrastructure', workspace: 'Your data nearby' };
const money = (v) => (v ? `$${Number(v).toLocaleString('en-US')}` : 'n/a');
const n = (v) => (v || v === 0 ? Number(v).toLocaleString('en-US') : 'n/a');
function reportRows(key, d) {
  switch (key) {
    case 'weather': return [['Forecast office', d.office], ['Nearest place', d.place], ...d.periods.map((p) => [p.name, `${p.temp}, ${p.text}, wind ${p.wind}`])];
    case 'warnings': return d.active.length ? d.active.map((w) => [w.event, `${w.severity}. ${w.headline || ''}`]) : [['Status', 'No active warnings at this point']];
    case 'elevation': return [['Elevation', `${n(d.feet)} ft (${n(d.meters)} m)`]];
    case 'flood': return [['Zone', `${d.zone}${d.subtype ? ` (${d.subtype})` : ''}`], ['Meaning', d.note]];
    case 'soil': return [['Map unit', d.mapUnit], ['Main component', d.component || 'n/a'], ['Hydrologic group', d.hydrologicGroup || 'n/a'], ['Drainage', d.drainage || 'n/a']];
    case 'demographics': return d.note ? [['Note', d.note]] : [['County', d.county], ['Census tract', d.tract], ['Population', n(d.population)], ['Households', n(d.households)], ['Median household income', money(d.medianHouseholdIncome)], ['Median home value', money(d.medianHomeValue)], ['Owner occupied', d.ownerOccupiedPct ? `${d.ownerOccupiedPct}%` : 'n/a']];
    case 'hazards': return [['Earthquakes, past day', d.earthquakes.length ? d.earthquakes.map((e) => `M${e.mag} at ${e.mi} mi`).join('; ') : 'None within 50 mi'], ['Wildfires', d.wildfires.length ? d.wildfires.map((w) => `${w.name} ${w.mi} mi`).join('; ') : 'None within 100 mi']];
    case 'infrastructure': return d.locked ? [['Note', d.note]] : Object.keys(d.counts).length ? Object.entries(d.counts).map(([k, v]) => [k, `${v} within ${d.withinMi} mi`]) : [['Result', `None mapped within ${d.withinMi} mi`]];
    case 'workspace': return [['Sites', d.sites.map((s) => `${s.name} (${s.mi} mi)`).join('; ') || 'None'], ['Zones', d.zones.map((z) => z.name).join('; ') || 'None'], ['Devices', d.devices.map((x) => x.name).join('; ') || 'None'], ['Layers', d.layers.map((l) => `${l.name}: ${l.n}`).join('; ') || 'None']];
    default: return [];
  }
}
function flag(key, d) {
  if (key === 'flood' && d.specialFloodHazardArea) return 'warn';
  if (key === 'warnings' && d.active?.length) return 'bad';
  return '';
}
export function showReport(r) {
  const cards = Object.entries(r.sections).map(([key, sec]) => h('div', { class: `report-card ${sec.ok ? flag(key, sec.data) : 'na'}` },
    h('h4', {}, TITLES[key] || key),
    sec.ok ? h('table', { class: 'props' }, h('tbody', {}, reportRows(key, sec.data).map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, String(v ?? 'n/a')))))) : h('p', { class: 'muted small' }, sec.error)));
  modal(r.title, h('div', { class: 'stack' },
    h('p', { class: 'mono muted small' }, `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)} · ${r.radiusMi} mile radius · ${fmtDate(r.generatedAt)}`),
    h('div', { class: 'report-grid' }, cards),
    h('div', { class: 'row between wrap' },
      h('p', { class: 'hint' }, 'Public data for planning. Not a survey, appraisal or flood determination.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => map.flyTo({ center: [r.lon, r.lat], zoom: 15 }) }, 'Show on map'),
        r.id ? h('a', { class: 'btn primary', href: `${API}/reports/${r.id}/pdf`, target: '_blank', rel: 'noopener' }, 'Download PDF') : null))), { wide: true });
}

export const PANELS = { maps: mapsPanel, layers: layersPanel, catalog: catalogPanel, sites: sitesPanel, devices: devicesPanel, alerts: (s) => alertsPanel(s).catch(fail), reports: (s) => reportsPanel(s).catch(fail) };
