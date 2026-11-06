import { Router } from 'express';
import { one, many, q } from '../db/pool.js';
import { HttpError, requireOrg, requireRole, requireFeature, checkLimit, token } from '../auth.js';
import { evaluateDevice, TRIGGER_TYPES } from '../services/alerts.js';
import { buildReport, reportPdf } from '../services/report.js';
import { geocode } from '../services/geocode.js';
import { bump, usageFor, audit, period } from '../services/usage.js';
import { ah, str, uuid, lonLat, geometry, emailOk } from './util.js';

// Sites, zones (geofences), devices, alert rules, alerts and reports.
export const router = Router();
const editor = requireRole('editor');

const pointJson = (lon, lat) => JSON.stringify({ type: 'Point', coordinates: [lon, lat] });

// ---- sites ----
router.get('/sites', requireOrg, ah(async (req, res) => {
  const rows = await many(`select id, name, address, props, ST_AsGeoJSON(geom)::json g, ST_AsGeoJSON(boundary)::json b, created_at from sites where org_id=$1 order by name`, [req.ctx.org.id]);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', id: r.id, geometry: r.g, properties: { id: r.id, name: r.name, address: r.address, ...r.props, has_boundary: Boolean(r.b) } })) });
}));

router.post('/sites', editor, ah(async (req, res) => {
  const name = str(req.body.name, { name: 'Site name', max: 120, required: true });
  let address = str(req.body.address, { name: 'Address', max: 300 }) || '';
  let lon = req.body.lon; let lat = req.body.lat;
  if ((lon === undefined || lat === undefined) && address) {
    const hit = (await geocode(address).catch(() => []))[0];
    if (!hit) throw new HttpError(400, "We couldn't find that address. Drop a pin on the map instead.");
    lon = hit.lon; lat = hit.lat; address = hit.label;
  }
  [lon, lat] = lonLat(lon, lat);
  const boundary = req.body.boundary ? geometry(req.body.boundary, { types: ['Polygon', 'MultiPolygon'] }) : null;
  const site = await one(`insert into sites(org_id, name, address, geom, boundary, props) values ($1,$2,$3, ST_SetSRID(ST_GeomFromGeoJSON($4),4326),
      case when $5::text is null then null else ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)) end, $6) returning id, name, address`,
  [req.ctx.org.id, name, address, pointJson(lon, lat), boundary, req.body.props && typeof req.body.props === 'object' ? req.body.props : {}]);
  res.status(201).json({ ...site, lon, lat });
}));

router.patch('/sites/:id', editor, ah(async (req, res) => {
  const name = str(req.body.name, { name: 'Site name', max: 120 });
  const address = str(req.body.address, { name: 'Address', max: 300 });
  let pt = null;
  if (req.body.lon !== undefined) { const [lon, lat] = lonLat(req.body.lon, req.body.lat); pt = pointJson(lon, lat); }
  const r = await q(`update sites set name=coalesce($3,name), address=coalesce($4,address), geom=coalesce(ST_SetSRID(ST_GeomFromGeoJSON($5),4326),geom) where id=$1 and org_id=$2`, [uuid(req.params.id), req.ctx.org.id, name || null, address ?? null, pt]);
  if (!r.rowCount) throw new HttpError(404, 'Site not found.');
  res.json({ ok: true });
}));

router.delete('/sites/:id', editor, ah(async (req, res) => {
  await q('delete from sites where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  res.json({ ok: true });
}));

// ---- zones (polygon geofences) ----
router.get('/zones', requireOrg, ah(async (req, res) => {
  const rows = await many('select id, name, color, ST_AsGeoJSON(geom)::json g from zones where org_id=$1 order by name', [req.ctx.org.id]);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', id: r.id, geometry: r.g, properties: { id: r.id, name: r.name, color: r.color } })) });
}));

router.post('/zones', editor, requireFeature('geofences'), ah(async (req, res) => {
  const name = str(req.body.name, { name: 'Zone name', max: 120, required: true });
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : '#d9781a';
  let g;
  if (req.body.circle) {
    const [lon, lat] = lonLat(req.body.circle.lon, req.body.circle.lat);
    const m = Math.min(100000, Math.max(10, Number(req.body.circle.radius_m) || 200));
    g = (await one('select ST_AsGeoJSON(ST_Buffer(ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3, 32)::geometry) g', [lon, lat, m])).g;
  } else g = geometry(req.body.geometry, { types: ['Polygon', 'MultiPolygon'] });
  const { zones } = await usageFor(req.ctx.org.id);
  await checkLimit(req.ctx, 'zones', zones);
  const z = await one('insert into zones(org_id, name, color, geom) values ($1,$2,$3, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($4),4326))) returning id, name, color', [req.ctx.org.id, name, color, g]);
  res.status(201).json(z);
}));

router.patch('/zones/:id', editor, ah(async (req, res) => {
  const name = str(req.body.name, { name: 'Zone name', max: 120 });
  const g = req.body.geometry ? geometry(req.body.geometry, { types: ['Polygon', 'MultiPolygon'] }) : null;
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : null;
  const r = await q('update zones set name=coalesce($3,name), color=coalesce($4,color), geom=coalesce(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)),geom) where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id, name || null, color, g]);
  if (!r.rowCount) throw new HttpError(404, 'Zone not found.');
  res.json({ ok: true });
}));

router.delete('/zones/:id', editor, ah(async (req, res) => {
  await q('delete from zones where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  res.json({ ok: true });
}));

// ---- devices ----
router.get('/devices', requireOrg, ah(async (req, res) => {
  const rows = await many(`select id, name, external_id, kind, last_speed_mph, last_seen_at, props, ST_AsGeoJSON(last_geom)::json g from devices where org_id=$1 order by name`, [req.ctx.org.id]);
  res.json({
    type: 'FeatureCollection',
    features: rows.filter((r) => r.g).map((r) => ({ type: 'Feature', id: r.id, geometry: r.g, properties: { id: r.id, name: r.name, kind: r.kind, speed_mph: r.last_speed_mph, last_seen_at: r.last_seen_at } })),
    devices: rows.map(({ g, ...r }) => ({ ...r, lon: g?.coordinates?.[0] ?? null, lat: g?.coordinates?.[1] ?? null })),
  });
}));

router.post('/devices', editor, ah(async (req, res) => {
  const name = str(req.body.name, { name: 'Device name', max: 120, required: true });
  const { devices } = await usageFor(req.ctx.org.id);
  await checkLimit(req.ctx, 'devices', devices);
  const kind = str(req.body.kind, { name: 'Type', max: 40 }) || 'tracker';
  const ext = str(req.body.external_id, { name: 'External ID', max: 120 }) || token(6);
  try {
    const d = await one('insert into devices(org_id, name, external_id, kind) values ($1,$2,$3,$4) returning id, name, external_id, kind', [req.ctx.org.id, name, ext, kind]);
    res.status(201).json(d);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'A device with that external ID already exists.');
    throw e;
  }
}));

router.delete('/devices/:id', editor, ah(async (req, res) => {
  await q('delete from devices where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  res.json({ ok: true });
}));

router.get('/devices/:id/track', requireOrg, ah(async (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
  const rows = await many(`select ST_X(geom) lon, ST_Y(geom) lat, speed_mph, recorded_at from positions where device_id=$1 and org_id=$2 and recorded_at > now() - make_interval(hours => $3) order by recorded_at`, [uuid(req.params.id), req.ctx.org.id, hours]);
  res.json({ type: 'Feature', geometry: { type: 'LineString', coordinates: rows.map((r) => [r.lon, r.lat]) }, properties: { points: rows.length, from: rows[0]?.recorded_at, to: rows.at(-1)?.recorded_at } });
}));

// Position ingest. Accepts one fix or { positions: [...] }. A device is found by id
// or external_id; with an API key, an unknown external_id is created automatically.
router.post('/devices/:ref/positions', editor, ah(async (req, res) => {
  const ref = String(req.params.ref);
  let device = /^[0-9a-f-]{36}$/i.test(ref) ? await one('select id from devices where id=$1 and org_id=$2', [ref, req.ctx.org.id]) : null;
  device ||= await one('select id from devices where external_id=$1 and org_id=$2', [ref, req.ctx.org.id]);
  if (!device) {
    if (req.ctx.via !== 'api') throw new HttpError(404, 'Device not found.');
    const { devices } = await usageFor(req.ctx.org.id);
    await checkLimit(req.ctx, 'devices', devices);
    device = await one('insert into devices(org_id, name, external_id) values ($1,$2,$2) returning id', [req.ctx.org.id, ref.slice(0, 120)]);
  }
  const list = Array.isArray(req.body.positions) ? req.body.positions.slice(0, 1000) : [req.body];
  let last = null;
  for (const p of list) {
    const [lon, lat] = lonLat(p.lon, p.lat);
    const at = p.time ? new Date(p.time) : new Date();
    if (Number.isNaN(at.getTime())) throw new HttpError(400, 'time must be an ISO date.');
    const speed = Number.isFinite(Number(p.speed_mph)) ? Number(p.speed_mph) : null;
    await q('insert into positions(device_id, org_id, geom, speed_mph, heading, recorded_at) values ($1,$2, ST_SetSRID(ST_MakePoint($3,$4),4326), $5, $6, $7)', [device.id, req.ctx.org.id, lon, lat, speed, Number(p.heading) || null, at]);
    if (!last || at >= last.at) last = { lon, lat, speed, at };
  }
  await q(`update devices set last_geom=ST_SetSRID(ST_MakePoint($2,$3),4326), last_speed_mph=$4, last_seen_at=$5
           where id=$1 and (last_seen_at is null or last_seen_at <= $5)`, [device.id, last.lon, last.lat, last.speed, last.at]);
  const fired = req.ctx.plan.features.alerts ? await evaluateDevice(req.ctx.org.id, device.id) : [];
  res.status(201).json({ device_id: device.id, stored: list.length, alerts: fired.map((a) => ({ id: Number(a.id), title: a.title })) });
}));

// ---- rules and alerts ----
function cleanTrigger(t = {}) {
  if (!TRIGGER_TYPES.includes(t.type)) throw new HttpError(400, `Rule type must be one of: ${TRIGGER_TYPES.join(', ')}.`);
  const out = { type: t.type };
  if (t.device_id) out.device_id = uuid(t.device_id, 'device_id');
  if (t.type === 'zone_exit' || t.type === 'zone_enter') out.zone_id = uuid(t.zone_id, 'zone_id');
  if (t.type === 'offline') out.minutes = Math.min(10080, Math.max(1, Number(t.minutes) || 30));
  if (t.type === 'speed') out.mph = Math.min(300, Math.max(1, Number(t.mph) || 70));
  if (t.type === 'nws_warning') {
    out.target = t.target === 'zones' ? 'zones' : 'sites';
    out.events = Array.isArray(t.events) ? t.events.filter((e) => typeof e === 'string').map((e) => e.slice(0, 60)).slice(0, 10) : [];
  }
  if (t.type === 'earthquake') { out.min_mag = Math.min(9, Math.max(1, Number(t.min_mag) || 3)); out.radius_mi = Math.min(500, Math.max(1, Number(t.radius_mi) || 50)); }
  return out;
}
function cleanChannels(c = {}, prev = {}) {
  const emails = (c.emails || []).map((e) => String(e).trim()).filter(Boolean).slice(0, 20);
  if (emails.some((e) => !emailOk(e))) throw new HttpError(400, 'One of the email addresses is not valid.');
  const sms = (c.sms || []).map((s) => String(s).replace(/[^\d+]/g, '')).filter(Boolean).slice(0, 10);
  if (sms.some((s) => !/^\+\d{8,15}$/.test(s))) throw new HttpError(400, 'Phone numbers need the country code, like +19185551234.');
  const webhooks = (c.webhooks || []).map((w) => String(w).trim()).filter(Boolean).slice(0, 5);
  if (webhooks.some((w) => !/^https:\/\/[^\s]+$/.test(w))) throw new HttpError(400, 'Webhooks must be https:// URLs.');
  return { emails, sms, webhooks, webhookSecret: prev.webhookSecret || token(18) };
}

router.get('/rules', requireOrg, ah(async (req, res) => {
  const rows = await many('select id, name, enabled, trigger, channels, cooldown_minutes, created_at from rules where org_id=$1 order by created_at', [req.ctx.org.id]);
  res.json(rows.map((r) => ({ ...r, channels: { ...r.channels, webhookSecret: req.ctx.role === 'owner' ? r.channels.webhookSecret : undefined } })));
}));

router.post('/rules', editor, requireFeature('alerts'), ah(async (req, res) => {
  const name = str(req.body.name, { name: 'Rule name', max: 120, required: true });
  const { rules } = await usageFor(req.ctx.org.id);
  await checkLimit(req.ctx, 'rules', rules);
  const trigger = cleanTrigger(req.body.trigger);
  if (trigger.zone_id && !await one('select 1 from zones where id=$1 and org_id=$2', [trigger.zone_id, req.ctx.org.id])) throw new HttpError(400, 'That zone is not in this workspace.');
  const channels = cleanChannels(req.body.channels);
  const cooldown = Math.min(10080, Math.max(1, Number(req.body.cooldown_minutes) || 30));
  const r = await one('insert into rules(org_id, name, trigger, channels, cooldown_minutes) values ($1,$2,$3,$4,$5) returning id, name, enabled, trigger, channels, cooldown_minutes', [req.ctx.org.id, name, trigger, channels, cooldown]);
  await audit(req.ctx.org.id, req.ctx.user?.id, 'rule.created', { name, type: trigger.type });
  res.status(201).json(r);
}));

router.patch('/rules/:id', editor, ah(async (req, res) => {
  const rule = await one('select * from rules where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  if (!rule) throw new HttpError(404, 'Rule not found.');
  const name = str(req.body.name, { name: 'Rule name', max: 120 });
  const trigger = req.body.trigger ? cleanTrigger(req.body.trigger) : null;
  const channels = req.body.channels ? cleanChannels(req.body.channels, rule.channels) : null;
  const enabled = typeof req.body.enabled === 'boolean' ? req.body.enabled : null;
  await q('update rules set name=coalesce($2,name), trigger=coalesce($3,trigger), channels=coalesce($4,channels), enabled=coalesce($5,enabled), state=case when $3::jsonb is null then state else \'{}\'::jsonb end where id=$1', [rule.id, name || null, trigger, channels, enabled]);
  res.json({ ok: true });
}));

router.delete('/rules/:id', editor, ah(async (req, res) => {
  await q('delete from rules where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  res.json({ ok: true });
}));

router.get('/alerts', requireOrg, ah(async (req, res) => {
  res.json(await many('select a.id, a.title, a.body, a.data, a.delivery, a.created_at, r.name as rule_name from alerts a left join rules r on r.id=a.rule_id where a.org_id=$1 order by a.id desc limit 100', [req.ctx.org.id]));
}));

// ---- Site Intelligence Reports ----
router.post('/reports', editor, ah(async (req, res) => {
  const { reports } = await usageFor(req.ctx.org.id);
  await checkLimit(req.ctx, 'reports', reports);
  let lon; let lat; let title = str(req.body.title, { name: 'Title', max: 200 }); let siteId = null;
  if (req.body.site_id) {
    const s = await one('select id, name, address, ST_X(geom) lon, ST_Y(geom) lat from sites where id=$1 and org_id=$2', [uuid(req.body.site_id), req.ctx.org.id]);
    if (!s) throw new HttpError(404, 'Site not found.');
    [lon, lat, siteId] = [s.lon, s.lat, s.id];
    title ||= s.address ? `${s.name}, ${s.address}` : s.name;
  } else [lon, lat] = lonLat(req.body.lon, req.body.lat);
  title ||= `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const radiusMi = Math.min(5, Math.max(0.25, Number(req.body.radius_mi) || 1));
  const data = await buildReport({ lon, lat, radiusMi, orgId: req.ctx.org.id, plan: req.ctx.plan });
  const row = await one('insert into reports(org_id, site_id, title, lon, lat, radius_mi, data, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, title, created_at', [req.ctx.org.id, siteId, title, lon, lat, radiusMi, data, req.ctx.user?.id || null]);
  await bump(req.ctx.org.id, 'reports');
  res.status(201).json({ ...row, ...data });
}));

router.get('/reports', requireOrg, ah(async (req, res) => {
  res.json(await many('select id, title, lon, lat, radius_mi, created_at from reports where org_id=$1 order by created_at desc limit 100', [req.ctx.org.id]));
}));

router.get('/reports/:id', requireOrg, ah(async (req, res) => {
  const r = await one('select * from reports where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  if (!r) throw new HttpError(404, 'Report not found.');
  res.json({ id: r.id, title: r.title, created_at: r.created_at, ...r.data });
}));

router.get('/reports/:id/pdf', requireOrg, ah(async (req, res) => {
  const r = await one('select * from reports where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  if (!r) throw new HttpError(404, 'Report not found.');
  const brand = req.ctx.plan.features.whiteLabel ? { name: req.ctx.org.brand?.name || req.ctx.org.name, color: req.ctx.org.brand?.color } : {};
  res.type('application/pdf').attachment(`site-report-${r.created_at.toISOString().slice(0, 10)}.pdf`);
  reportPdf(r.data, { title: r.title, brand }).pipe(res);
}));

router.get('/usage', requireOrg, ah(async (req, res) => res.json({ period: period(), ...(await usageFor(req.ctx.org.id)) })));
