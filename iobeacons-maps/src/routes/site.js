import express from 'express';
import { requireUser, requireStaff, HttpError } from '../auth.js';
import { many, q } from '../db/pool.js';
import { config } from '../config.js';
import { sendEmail } from '../services/notify.js';
import { SPACE_GROUPS, spaceGroup, spaceInfo, spaceTle, positionAt, groundTrack, periodMin, noradOf } from '../services/space.js';
import { usRadarFrames, worldRadarFrames, dopplerFor } from '../services/weather.js';
import { heardBy, checkIss } from '../services/satnogs.js';
import { forwardInquiry } from '../services/fulllobby.js';
import { ah, str, emailOk, rateLimit, lonLat } from './util.js';

// Things the public iobeacons.com pages use: the contact form and satellites.
export const router = express.Router();
// Open data (satellites and weather). Also served to API keys under /api/v1.
export const dataRouter = express.Router();

const when = (t) => {
  if (t === undefined || t === '') return new Date();
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'time must be an ISO date, like 2026-11-07T12:00:00Z.');
  if (Math.abs(d - Date.now()) > 30 * 864e5) throw new HttpError(400, 'time must be within 30 days of now.');
  return d;
};
async function tleOr404(norad) {
  const t = await spaceTle(norad);
  if (!t) throw new HttpError(404, 'No orbital elements for that object.');
  return t;
}

dataRouter.get('/space', (_req, res) => res.json(SPACE_GROUPS.map(({ key, name, color, optional, debris }) => ({ key, name, color, optional: Boolean(optional), debris: Boolean(debris) }))));
// Moving weather: radar loop frames and Doppler winds from the nearest radar.
dataRouter.get('/weather/radar-frames', ah(async (req, res) => {
  const out = req.query.source === 'world' ? await worldRadarFrames() : usRadarFrames();
  res.set('Cache-Control', 'public, max-age=120');
  res.json(out);
}));
dataRouter.get('/weather/doppler', ah(async (req, res) => {
  const [lon, lat] = lonLat(req.query.lon, req.query.lat);
  const d = await dopplerFor(lon, lat);
  if (!d) throw new HttpError(503, 'Doppler winds need outside data sources, which are switched off on this server.');
  res.set('Cache-Control', 'public, max-age=120');
  res.json(d);
}));
dataRouter.get('/space/info/:norad', ah(async (req, res) => {
  const info = await spaceInfo(req.params.norad);
  if (!info) throw new HttpError(404, 'No catalogue record for that object.');
  res.set('Cache-Control', 'public, max-age=86400');
  res.json(info);
}));
dataRouter.get('/space/:group', ah(async (req, res) => {
  const g = await spaceGroup(req.params.group);
  if (!g) throw new HttpError(404, 'Unknown satellite group.');
  res.set('Cache-Control', 'public, max-age=1800');
  res.json(g);
}));

// Where one object is now (or at ?time=), worked out from its latest orbital elements.
dataRouter.get('/space/objects/:norad/position', ah(async (req, res) => {
  const t = await tleOr404(req.params.norad);
  const at = when(req.query.time);
  const p = positionAt(t, at);
  if (!p) throw new HttpError(422, 'This object has no valid orbit at that time (it may have decayed).');
  res.set('Cache-Control', 'no-store');
  res.json({ norad: noradOf(t), name: t.name, time: at.toISOString(), ...p, periodMin: Math.round(periodMin(t) * 100) / 100, tle: [t.l1, t.l2] });
}));
// Its path over the ground, as GeoJSON (default: one orbit from now).
dataRouter.get('/space/objects/:norad/track', ah(async (req, res) => {
  const t = await tleOr404(req.params.norad);
  const from = when(req.query.time);
  const minutes = Math.min(1440, Math.max(1, Number(req.query.minutes) || Math.ceil(periodMin(t))));
  const step = Math.min(600, Math.max(10, Number(req.query.step) || 60));
  res.json({ type: 'Feature', geometry: groundTrack(t, from, minutes, step), properties: { norad: noradOf(t), name: t.name, from: from.toISOString(), minutes, stepSec: step } });
}));
// Recordings of this object by SatNOGS volunteer ground stations.
dataRouter.get('/space/objects/:norad/heard', ah(async (req, res) => {
  let h;
  try { h = await heardBy(req.params.norad); } catch (e) { throw new HttpError(503, `SatNOGS can't be reached right now (${e.message}).`); }
  if (!h) throw new HttpError(400, 'Give a NORAD catalogue number.');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(h);
}));
// Our ISS position checked against an independent tracker.
dataRouter.get('/space/check/iss', ah(async (_req, res) => {
  let c;
  try { c = await checkIss(); } catch (e) { throw new HttpError(503, `The outside ISS tracker can't be reached right now (${e.message}).`); }
  if (!c) throw new HttpError(503, 'No orbital elements for the ISS right now.');
  res.set('Cache-Control', 'no-store');
  res.json(c);
}));
// Every object in a group at one moment, as GeoJSON points.
dataRouter.get('/space/:group/positions', ah(async (req, res) => {
  const g = await spaceGroup(req.params.group);
  if (!g) throw new HttpError(404, 'Unknown satellite group.');
  const at = when(req.query.time);
  const features = [];
  for (const t of g.satellites) {
    const p = positionAt(t, at);
    if (p) features.push({ type: 'Feature', id: noradOf(t), geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { norad: noradOf(t), name: t.name, altKm: p.altKm, speedKmS: p.speedKmS } });
  }
  res.json({ type: 'FeatureCollection', group: g.key, time: at.toISOString(), features });
}));

router.use(dataRouter);

router.post('/contact', ah(async (req, res) => {
  rateLimit(`contact:${req.ip}`, 5, 3600e3);
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // bots fill the hidden field
  const name = str(b.name, { name: 'Name', required: true, max: 120 });
  const email = String(b.email || '').trim();
  if (!emailOk(email)) throw new HttpError(400, 'Please enter a valid email address.');
  const message = str(b.message, { name: 'Message', required: true, min: 5, max: 5000 });
  const company = str(b.company, { name: 'Company', max: 160 }) || null;
  const topic = str(b.topic, { name: 'Topic', max: 80 }) || null;
  const page = str(b.page, { name: 'Page', max: 300 }) || null;
  const row = (await q('insert into contact_messages(name, email, company, topic, message, page) values ($1,$2,$3,$4,$5,$6) returning id', [name, email, company, topic, message, page])).rows[0];
  forwardInquiry(row.id).catch(() => {});
  for (const to of config.staffEmails) {
    sendEmail(to, `IoBeacons contact: ${topic || 'General'} from ${name}`, `${name} <${email}>${company ? `\n${company}` : ''}\nTopic: ${topic || 'General'}\n\n${message}`).catch(() => {});
  }
  res.json({ ok: true });
}));

// Public settings the static pages read (for example the Fulllobby chat widget).
router.get('/site-config', (_req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json({ chatWidget: config.fulllobbyWidget || null }); });

router.get('/admin/contact', requireUser, requireStaff, ah(async (_req, res) => {
  res.json(await many('select id, name, email, company, topic, message, page, created_at from contact_messages order by created_at desc limit 300'));
}));
