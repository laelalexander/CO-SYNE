import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { one, many, q, tx } from '../db/pool.js';
import { HttpError, requireOrg, requireRole, requireFeature, checkLimit, token } from '../auth.js';
import { catalogFor, catalogData, CATALOG } from '../services/catalog.js';
import { basemap, STYLE_NAMES, TERRAIN_DEM } from '../services/styles.js';
import { geocode } from '../services/geocode.js';
import { parseUpload, toCsv, toKml } from '../services/geoio.js';
import { bump, usageFor, audit } from '../services/usage.js';
import { planFor } from '../plans.js';
import { ah, str, uuid, geometry } from './util.js';

export const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });
const editor = requireRole('editor');

const DEFAULT_STYLE = { color: '#1f5fbf', opacity: 0.35, width: 2, radius: 6, mode: 'simple' };
const FEATURE_CAP = 20000; // features sent as GeoJSON per request; larger layers use vector tiles

// ---- access helpers ----
const visibleTo = (ctx) => (ctx.user ? `(m.visibility <> 'private' or m.created_by = '${ctx.user.id}')` : "m.visibility <> 'private'");

async function getMap(ctx, id) {
  const map = await one(`select m.* from maps m where m.id=$1 and m.org_id=$2 and ${visibleTo(ctx)}`, [uuid(id), ctx.org.id]);
  if (!map) throw new HttpError(404, 'Map not found.');
  return map;
}
async function getLayer(ctx, id) {
  const layer = await one(`select l.* from layers l join maps m on m.id=l.map_id where l.id=$1 and l.org_id=$2 and ${visibleTo(ctx)}`, [uuid(id), ctx.org.id]);
  if (!layer) throw new HttpError(404, 'Layer not found.');
  return layer;
}
async function layersOf(mapId) {
  return many(`select l.id, l.name, l.kind, l.catalog_key, l.style, l.visible, l.position, l.source_file,
                 (select count(*) from features f where f.layer_id=l.id)::int as feature_count,
                 (select array_agg(distinct GeometryType(f.geom)) from (select geom from features where layer_id=l.id limit 500) f) as geom_types
               from layers l where l.map_id=$1 order by l.position, l.created_at`, [mapId]);
}
const touch = (mapId) => q('update maps set updated_at=now() where id=$1', [mapId]);

function shareLinks(map) {
  if (!map.share_token || !['link', 'public'].includes(map.visibility)) return null;
  const view = `${config.publicUrl}/#share=${map.share_token}`;
  const embed = `${config.publicUrl}/embed.html#${map.share_token}`;
  return { view, embed, iframe: `<iframe src="${embed}" width="100%" height="480" style="border:0" loading="lazy" title="${map.name.replace(/"/g, '')}"></iframe>` };
}

// ---- styles, catalog, search ----
router.get('/styles/:name.json', ah(async (req, res) => {
  const b = basemap(req.params.name);
  if (b.url) return res.redirect(302, b.url);
  res.set('Cache-Control', 'public, max-age=3600').json(b.style);
}));
router.get('/terrain.json', (_req, res) => res.json(TERRAIN_DEM));

router.get('/catalog', requireOrg, (req, res) => res.json(catalogFor(req.ctx.plan)));
router.get('/catalog/:key/data', requireOrg, ah(async (req, res) => {
  const entry = CATALOG.find((c) => c.key === req.params.key);
  if (entry?.tier === 'premium' && req.ctx.plan.features.catalog !== 'premium') throw new HttpError(402, `${entry.name} comes with the Professional plan.`, { upgrade: true });
  const bbox = req.query.bbox ? String(req.query.bbox).split(',').map(Number) : undefined;
  const data = await catalogData(req.params.key, { bbox });
  res.set('Cache-Control', 'public, max-age=60').json(data);
}));

router.get('/geocode', requireOrg, ah(async (req, res) => {
  const text = str(req.query.q, { name: 'Search', max: 200 });
  if (!text) return res.json([]);
  try { res.json(await geocode(text)); } catch (e) { throw new HttpError(503, `Address search is unavailable right now (${e.message}).`); }
}));

// ---- maps ----
router.get('/maps', requireOrg, ah(async (req, res) => {
  res.json(await many(`select m.id, m.name, m.description, m.style, m.visibility, m.updated_at, u.name as created_by_name,
      (select count(*) from layers l where l.map_id=m.id)::int as layer_count
    from maps m left join users u on u.id=m.created_by where m.org_id=$1 and ${visibleTo(req.ctx)} order by m.updated_at desc`, [req.ctx.org.id]));
}));

router.post('/maps', editor, ah(async (req, res) => {
  const { maps } = await usageFor(req.ctx.org.id);
  await checkLimit(req.ctx, 'maps', maps);
  const name = str(req.body.name, { name: 'Map name', max: 120 }) || 'Untitled map';
  const style = STYLE_NAMES.includes(req.body.style) ? req.body.style : 'streets';
  const view = req.body.view && typeof req.body.view === 'object' ? req.body.view : undefined;
  const map = await one(`insert into maps(org_id, name, style, view, created_by) values ($1,$2,$3,coalesce($4,'{"center":[-95.99,36.15],"zoom":10,"pitch":0,"bearing":0}'::jsonb),$5) returning *`, [req.ctx.org.id, name, style, view ? JSON.stringify(view) : null, req.ctx.user?.id || null]);
  await audit(req.ctx.org.id, req.ctx.user?.id, 'map.created', { id: map.id, name });
  res.status(201).json(map);
}));

router.get('/maps/:id', requireOrg, ah(async (req, res) => {
  const map = await getMap(req.ctx, req.params.id);
  bump(req.ctx.org.id, 'mapViews').catch(() => {});
  res.json({ ...map, layers: await layersOf(map.id), links: shareLinks(map) });
}));

router.patch('/maps/:id', editor, ah(async (req, res) => {
  const map = await getMap(req.ctx, req.params.id);
  const b = req.body;
  const name = str(b.name, { name: 'Map name', max: 120 });
  const description = str(b.description, { name: 'Description', max: 2000 });
  const style = b.style !== undefined ? (STYLE_NAMES.includes(b.style) ? b.style : map.style) : undefined;
  let view;
  if (b.view !== undefined) {
    const v = b.view;
    if (!Array.isArray(v.center) || v.center.length !== 2 || !v.center.every(Number.isFinite) || !Number.isFinite(v.zoom)) throw new HttpError(400, 'View needs center [lon, lat] and zoom.');
    view = { center: v.center, zoom: v.zoom, pitch: Number(v.pitch) || 0, bearing: Number(v.bearing) || 0 };
  }
  const settings = b.settings && typeof b.settings === 'object' ? { ...map.settings, ...b.settings } : undefined;
  let visibility;
  if (b.visibility !== undefined) {
    if (!['private', 'team', 'link', 'public'].includes(b.visibility)) throw new HttpError(400, 'Visibility must be private, team, link or public.');
    if (['link', 'public'].includes(b.visibility) && !req.ctx.plan.features.share) throw new HttpError(402, 'Sharing needs a paid plan.', { upgrade: true });
    visibility = b.visibility;
  }
  const shareToken = visibility && ['link', 'public'].includes(visibility) && !map.share_token ? token(16) : null;
  const out = await one(`update maps set name=coalesce($2,name), description=coalesce($3,description), style=coalesce($4,style), view=coalesce($5,view),
      settings=coalesce($6,settings), visibility=coalesce($7,visibility), share_token=coalesce($8,share_token), updated_at=now() where id=$1 returning *`,
  [map.id, name || null, description ?? null, style || null, view ? JSON.stringify(view) : null, settings ? JSON.stringify(settings) : null, visibility || null, shareToken]);
  res.json({ ...out, links: shareLinks(out) });
}));

router.post('/maps/:id/share/reset', editor, ah(async (req, res) => {
  const map = await getMap(req.ctx, req.params.id);
  const out = await one('update maps set share_token=$2 where id=$1 returning *', [map.id, token(16)]);
  res.json({ links: shareLinks(out) });
}));

router.delete('/maps/:id', editor, ah(async (req, res) => {
  const map = await getMap(req.ctx, req.params.id);
  await q('delete from maps where id=$1', [map.id]);
  await audit(req.ctx.org.id, req.ctx.user?.id, 'map.deleted', { id: map.id, name: map.name });
  res.json({ ok: true });
}));

router.post('/maps/:id/duplicate', editor, ah(async (req, res) => {
  const map = await getMap(req.ctx, req.params.id);
  const { maps, features } = await usageFor(req.ctx.org.id);
  await checkLimit(req.ctx, 'maps', maps);
  const n = (await one('select count(*)::int n from features where layer_id in (select id from layers where map_id=$1)', [map.id])).n;
  await checkLimit(req.ctx, 'features', features, n);
  const copy = await tx(async (c) => {
    const m = (await c.query(`insert into maps(org_id, name, description, style, view, settings, created_by) select org_id, name || ' (copy)', description, style, view, settings, $2 from maps where id=$1 returning *`, [map.id, req.ctx.user?.id || null])).rows[0];
    const layers = (await c.query('select * from layers where map_id=$1', [map.id])).rows;
    for (const l of layers) {
      const nl = (await c.query('insert into layers(map_id, org_id, name, kind, catalog_key, style, visible, position, source_file) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id', [m.id, l.org_id, l.name, l.kind, l.catalog_key, l.style, l.visible, l.position, l.source_file])).rows[0];
      await c.query('insert into features(layer_id, org_id, geom, props) select $2, org_id, geom, props from features where layer_id=$1', [l.id, nl.id]);
    }
    return m;
  });
  res.status(201).json(copy);
}));

// ---- layers ----
function cleanStyle(s = {}) {
  const out = { ...DEFAULT_STYLE };
  if (/^#[0-9a-f]{6}$/i.test(s.color || '')) out.color = s.color;
  for (const k of ['opacity', 'width', 'radius']) if (Number.isFinite(Number(s[k]))) out[k] = Math.max(0, Math.min(k === 'opacity' ? 1 : 40, Number(s[k])));
  if (['simple', 'categories', 'graduated', 'heatmap', 'cluster', 'extrude'].includes(s.mode)) out.mode = s.mode;
  if (typeof s.field === 'string') out.field = s.field.slice(0, 80);
  if (typeof s.label === 'string') out.label = s.label.slice(0, 80);
  if (Array.isArray(s.popup)) out.popup = s.popup.filter((x) => typeof x === 'string').slice(0, 30);
  if (typeof s.palette === 'string') out.palette = s.palette.slice(0, 30);
  return out;
}

router.post('/maps/:id/layers', editor, ah(async (req, res) => {
  const map = await getMap(req.ctx, req.params.id);
  const kind = req.body.kind === 'catalog' ? 'catalog' : 'features';
  let name = str(req.body.name, { name: 'Layer name', max: 120 });
  let catalogKey = null;
  if (kind === 'catalog') {
    const entry = catalogFor(req.ctx.plan).find((c) => c.key === req.body.catalog_key);
    if (!entry) throw new HttpError(400, 'Unknown catalog layer.');
    if (entry.locked) throw new HttpError(402, `${entry.name} comes with the Professional plan.`, { upgrade: true });
    catalogKey = entry.key; name ||= entry.name;
  }
  if (kind === 'features' && !req.ctx.plan.features.draw) throw new HttpError(402, 'Your plan does not include editing.', { upgrade: true });
  const pos = (await one('select coalesce(max(position),0)+1 p from layers where map_id=$1', [map.id])).p;
  const layer = await one('insert into layers(map_id, org_id, name, kind, catalog_key, style, position) values ($1,$2,$3,$4,$5,$6,$7) returning *', [map.id, req.ctx.org.id, name || 'New layer', kind, catalogKey, cleanStyle(req.body.style), pos]);
  await touch(map.id);
  res.status(201).json({ ...layer, feature_count: 0 });
}));

router.patch('/layers/:id', editor, ah(async (req, res) => {
  const layer = await getLayer(req.ctx, req.params.id);
  const name = str(req.body.name, { name: 'Layer name', max: 120 });
  const style = req.body.style ? cleanStyle({ ...layer.style, ...req.body.style }) : null;
  if (style && ['heatmap', 'categories', 'graduated', 'extrude'].includes(style.mode) && !req.ctx.plan.features.customStyles) throw new HttpError(402, 'Data-driven styling comes with the Professional plan.', { upgrade: true });
  const visible = typeof req.body.visible === 'boolean' ? req.body.visible : null;
  const position = Number.isInteger(req.body.position) ? req.body.position : null;
  const out = await one('update layers set name=coalesce($2,name), style=coalesce($3,style), visible=coalesce($4,visible), position=coalesce($5,position) where id=$1 returning *', [layer.id, name || null, style, visible, position]);
  await touch(layer.map_id);
  res.json(out);
}));

router.delete('/layers/:id', editor, ah(async (req, res) => {
  const layer = await getLayer(req.ctx, req.params.id);
  await q('delete from layers where id=$1', [layer.id]);
  await touch(layer.map_id);
  res.json({ ok: true });
}));

// ---- features ----
async function featuresGeojson(layerId, bbox) {
  const params = [layerId];
  let where = 'layer_id=$1';
  if (bbox) { params.push(...bbox); where += ' and geom && ST_MakeEnvelope($2,$3,$4,$5,4326)'; }
  const rows = await many(`select id, props, ST_AsGeoJSON(geom, 7)::json as g from features where ${where} order by id limit ${FEATURE_CAP + 1}`, params);
  const truncated = rows.length > FEATURE_CAP;
  return {
    type: 'FeatureCollection', truncated,
    features: rows.slice(0, FEATURE_CAP).map((r) => ({ type: 'Feature', id: Number(r.id), geometry: r.g, properties: { ...r.props, _id: Number(r.id) } })),
  };
}
const parseBbox = (s) => {
  if (!s) return null;
  const b = String(s).split(',').map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite)) throw new HttpError(400, 'bbox must be west,south,east,north.');
  return b;
};

router.get('/layers/:id/features', requireOrg, ah(async (req, res) => {
  const layer = await getLayer(req.ctx, req.params.id);
  res.json(await featuresGeojson(layer.id, parseBbox(req.query.bbox)));
}));

async function insertFeatures(ctx, layer, list) {
  if (!ctx.plan.features.draw) throw new HttpError(402, 'Your plan does not include editing.', { upgrade: true });
  const { features } = await usageFor(ctx.org.id);
  await checkLimit(ctx, 'features', features, list.length);
  const ids = [];
  await tx(async (c) => {
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const vals = []; const params = [layer.id, ctx.org.id];
      chunk.forEach((f) => {
        params.push(geometry(f.geometry), JSON.stringify(f.properties || {}));
        vals.push(`($1,$2,ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($${params.length - 1}),4326)),$${params.length}::jsonb)`);
      });
      const r = await c.query(`insert into features(layer_id, org_id, geom, props) values ${vals.join(',')} returning id`, params);
      ids.push(...r.rows.map((x) => Number(x.id)));
    }
  });
  await touch(layer.map_id);
  return ids;
}

router.post('/layers/:id/features', editor, ah(async (req, res) => {
  const layer = await getLayer(req.ctx, req.params.id);
  if (layer.kind !== 'features') throw new HttpError(400, 'Catalog layers are read-only.');
  const list = req.body.type === 'FeatureCollection' ? req.body.features : [req.body];
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Send a GeoJSON Feature or FeatureCollection.');
  const ids = await insertFeatures(req.ctx, layer, list);
  res.status(201).json({ ids });
}));

async function getFeature(ctx, id) {
  const f = await one(`select f.id, f.layer_id, l.map_id from features f join layers l on l.id=f.layer_id join maps m on m.id=l.map_id
                       where f.id=$1 and f.org_id=$2 and ${visibleTo(ctx)}`, [Number(id) || 0, ctx.org.id]);
  if (!f) throw new HttpError(404, 'Feature not found.');
  return f;
}

router.patch('/features/:id', editor, ah(async (req, res) => {
  const f = await getFeature(req.ctx, req.params.id);
  const g = req.body.geometry ? geometry(req.body.geometry) : null;
  let props = null;
  if (req.body.properties) {
    if (typeof req.body.properties !== 'object') throw new HttpError(400, 'properties must be an object.');
    const p = { ...req.body.properties }; delete p._id;
    props = JSON.stringify(p);
  }
  await q('update features set geom=coalesce(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($2),4326)),geom), props=coalesce($3::jsonb,props), updated_at=now() where id=$1', [f.id, g, props]);
  await touch(f.map_id);
  res.json({ ok: true });
}));

router.delete('/features/:id', editor, ah(async (req, res) => {
  const f = await getFeature(req.ctx, req.params.id);
  await q('delete from features where id=$1', [f.id]);
  await touch(f.map_id);
  res.json({ ok: true });
}));

// ---- uploads and export ----
router.post('/maps/:id/upload', editor, upload.single('file'), ah(async (req, res) => {
  if (!req.ctx.plan.features.upload) throw new HttpError(402, 'Uploads need a paid plan.', { upgrade: true });
  const map = await getMap(req.ctx, req.params.id);
  if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
  const { fc, skipped, geocoded } = await parseUpload(req.file.originalname, req.file.buffer);
  if (!fc.features.length) throw new HttpError(400, `No usable features found in ${req.file.originalname}.`);
  const name = str(req.body.name, { name: 'Layer name', max: 120 }) || req.file.originalname.replace(/\.(geojson|json|kml|kmz|gpx|csv|txt|zip)$/i, '');
  const pos = (await one('select coalesce(max(position),0)+1 p from layers where map_id=$1', [map.id])).p;
  const palette = ['#1f5fbf', '#d9781a', '#0f766e', '#7c3aed', '#c2362f', '#4d7c0f'];
  const layer = await one('insert into layers(map_id, org_id, name, kind, style, position, source_file) values ($1,$2,$3,$4,$5,$6,$7) returning *',
    [map.id, req.ctx.org.id, name, 'features', { ...DEFAULT_STYLE, color: palette[pos % palette.length] }, pos, req.file.originalname]);
  try {
    await insertFeatures(req.ctx, layer, fc.features);
  } catch (e) { await q('delete from layers where id=$1', [layer.id]); throw e; }
  const bounds = await one('select ST_XMin(e) w, ST_YMin(e) s, ST_XMax(e) e, ST_YMax(e) n from (select ST_Extent(geom) e from features where layer_id=$1) x', [layer.id]);
  await audit(req.ctx.org.id, req.ctx.user?.id, 'layer.uploaded', { map_id: map.id, file: req.file.originalname, features: fc.features.length });
  res.status(201).json({ layer: { ...layer, feature_count: fc.features.length }, imported: fc.features.length, skipped: skipped.length, skippedRows: skipped.slice(0, 20), geocoded: geocoded || 0, bounds: bounds && [bounds.w, bounds.s, bounds.e, bounds.n] });
}));

router.get('/layers/:id/export.:fmt', requireOrg, ah(async (req, res) => {
  if (!req.ctx.plan.features.export) throw new HttpError(402, 'Export needs a paid plan.', { upgrade: true });
  const layer = await getLayer(req.ctx, req.params.id);
  const fc = await featuresGeojson(layer.id);
  fc.features.forEach((f) => { delete f.properties._id; });
  const base = layer.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'layer';
  if (req.params.fmt === 'geojson') { res.attachment(`${base}.geojson`).type('application/geo+json').send(JSON.stringify(fc)); return; }
  if (req.params.fmt === 'csv') { res.attachment(`${base}.csv`).type('text/csv').send(toCsv(fc)); return; }
  if (req.params.fmt === 'kml') { res.attachment(`${base}.kml`).type('application/vnd.google-earth.kml+xml').send(toKml(fc, layer.name)); return; }
  throw new HttpError(400, 'Export as geojson, csv or kml.');
}));

// ---- vector tiles for large layers ----
router.get('/tiles/:layerId/:z/:x/:y.pbf', requireOrg, ah(async (req, res) => {
  const layer = await getLayer(req.ctx, req.params.layerId);
  const [z, x, y] = [req.params.z, req.params.x, req.params.y].map(Number);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22) throw new HttpError(400, 'Bad tile address.');
  const row = await one(`with b as (select ST_TileEnvelope($2,$3,$4) e),
      t as (select f.id, f.props, ST_AsMVTGeom(ST_Transform(f.geom,3857), b.e, 4096, 64, true) g
            from features f, b where f.layer_id=$1 and ST_Transform(f.geom,3857) && b.e)
    select ST_AsMVT(t.*, 'features', 4096, 'g', 'id') mvt from (select id, props::text as props, g from t where g is not null) t`, [layer.id, z, x, y]);
  res.set('Content-Type', 'application/x-protobuf').set('Cache-Control', 'private, max-age=30').send(row?.mvt || Buffer.alloc(0));
}));

// ---- public share links (no sign-in) ----
async function sharedMap(tokenStr) {
  const map = await one(`select m.*, row_to_json(o) as org from maps m join orgs o on o.id=m.org_id where m.share_token=$1 and m.visibility in ('link','public')`, [String(tokenStr)]);
  if (!map) throw new HttpError(404, 'This map link is no longer shared.');
  return map;
}
router.get('/public/maps/:token', ah(async (req, res) => {
  const map = await sharedMap(req.params.token);
  const plan = planFor(map.org);
  bump(map.org_id, 'mapViews').catch(() => {});
  const brand = plan.features.whiteLabel ? { name: map.org.brand?.name || map.org.name, color: map.org.brand?.color || '#1f5fbf', logo: map.org.brand?.logo || '' } : { name: 'IoBeacons Maps', color: '#1f5fbf', logo: '' };
  const { org: _org, share_token: _t, ...rest } = map;
  res.json({ ...rest, layers: (await layersOf(map.id)).filter((l) => l.visible), brand, embedsAllowed: plan.features.embeds });
}));
router.get('/public/maps/:token/layers/:layerId/features', ah(async (req, res) => {
  const map = await sharedMap(req.params.token);
  const layer = await one('select id from layers where id=$1 and map_id=$2', [uuid(req.params.layerId), map.id]);
  if (!layer) throw new HttpError(404, 'Layer not found.');
  res.json(await featuresGeojson(layer.id, parseBbox(req.query.bbox)));
}));
router.get('/public/maps/:token/catalog/:key', ah(async (req, res) => {
  const map = await sharedMap(req.params.token);
  if (!await one('select 1 from layers where map_id=$1 and catalog_key=$2', [map.id, req.params.key])) throw new HttpError(404, 'Not on this map.');
  const bbox = req.query.bbox ? String(req.query.bbox).split(',').map(Number) : undefined;
  res.set('Cache-Control', 'public, max-age=60').json(await catalogData(req.params.key, { bbox }));
}));

export { featuresGeojson, getMap };
export const _requireFeature = requireFeature;
