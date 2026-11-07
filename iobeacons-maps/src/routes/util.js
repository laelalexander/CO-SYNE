import { HttpError } from '../auth.js';

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function str(v, { name = 'value', max = 200, min = 0, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required.`);
    return v === '' ? '' : undefined;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be text.`);
  const s = v.trim();
  if (s.length < min) throw new HttpError(400, `${name} must be at least ${min} characters.`);
  if (s.length > max) throw new HttpError(400, `${name} must be at most ${max} characters.`);
  return s;
}

export const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim()) && e.length <= 200;

export function uuid(v, name = 'id') {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw new HttpError(400, `${name} is not valid.`);
  return v;
}

export function lonLat(lon, lat) {
  const x = Number(lon); const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) throw new HttpError(400, 'Longitude and latitude are not valid.');
  return [x, y];
}

const GEOM_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);
export function geometry(g, { types } = {}) {
  if (!g || typeof g !== 'object' || !GEOM_TYPES.has(g.type)) throw new HttpError(400, 'A GeoJSON geometry is required.');
  if (types && !types.includes(g.type)) throw new HttpError(400, `Geometry must be ${types.join(' or ')}.`);
  // Columns are 2D: drop altitude and measure values (common in KML and GPX).
  const flat = (c) => (typeof c[0] === 'number' ? c.slice(0, 2) : c.map(flat));
  const g2 = g.type === 'GeometryCollection' ? { ...g, geometries: (g.geometries || []).map((x) => JSON.parse(geometry(x))) } : { type: g.type, coordinates: flat(g.coordinates || []) };
  const json = JSON.stringify(g2);
  if (json.length > 5_000_000) throw new HttpError(413, 'That shape is too large.');
  return json;
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace';
}

// Simple in-memory rate limiter (per process) for sign-in and sign-up.
const buckets = new Map();
export function rateLimit(key, max, windowMs, message = 'Too many attempts. Wait a few minutes and try again.') {
  if (process.env.RATE_LIMIT === 'off') return;
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n++;
  buckets.set(key, b);
  if (buckets.size > 10000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  if (b.n > max) throw new HttpError(429, message);
}
