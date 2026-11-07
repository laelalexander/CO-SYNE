import * as sgp4 from 'satellite.js';
import { fetchCached } from './fetcher.js';
import { config } from '../config.js';

// Satellite groups from CelesTrak (public orbital elements, refreshed every
// few hours upstream). The browser turns them into live positions.
export const SPACE_GROUPS = [
  { key: 'stations', name: 'Space stations', color: '#ff713d', celestrak: 'stations' },
  { key: 'weather', name: 'Weather satellites', color: '#2876ee', celestrak: 'weather' },
  { key: 'earth', name: 'Earth observation', color: '#1bb782', celestrak: 'resource' },
  { key: 'gps', name: 'GPS', color: '#a855f7', celestrak: 'gps-ops' },
  { key: 'science', name: 'Science', color: '#eab308', celestrak: 'science' },
  { key: 'starlink', name: 'Starlink', color: '#94a3b8', celestrak: 'starlink', limit: 9000, optional: true },
  { key: 'active', name: 'All active satellites', color: '#64748b', celestrak: 'active', limit: 20000, optional: true },
  { key: 'recent', name: 'Launched in the last 30 days', color: '#22d3ee', celestrak: 'last-30-days', limit: 2000, optional: true },
  { key: 'debris-fy1c', name: 'Debris: Fengyun 1C', color: '#ef4444', celestrak: 'fengyun-1c-debris', limit: 5000, optional: true, debris: true },
  { key: 'debris-cosmos', name: 'Debris: Cosmos 2251', color: '#f87171', celestrak: 'cosmos-2251-debris', limit: 5000, optional: true, debris: true },
  { key: 'debris-iridium', name: 'Debris: Iridium 33', color: '#fca5a5', celestrak: 'iridium-33-debris', limit: 5000, optional: true, debris: true },
];

// Parses 3-line TLE text into [{ name, l1, l2 }].
export function parseTle(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      out.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2] });
      i += 2;
    }
  }
  return out;
}

// Offline / test data: well-formed TLEs built from typical orbits.
function checksum(line) {
  let s = 0;
  for (const c of line.slice(0, 68)) s += c === '-' ? 1 : /\d/.test(c) ? Number(c) : 0;
  return line.slice(0, 68) + (s % 10);
}
function makeTle(name, id, inc, raan, ecc, argp, ma, mm) {
  const d = new Date();
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = ((d - start) / 864e5 + 1).toFixed(8).padStart(12, '0');
  const n = String(id).padStart(5, '0');
  const l1 = checksum(`1 ${n}U 00000A   ${yy}${doy}  .00000000  00000-0  00000-0 0  9990`);
  const f = (v, w, p) => v.toFixed(p).padStart(w, ' ');
  const l2 = checksum(`2 ${n} ${f(inc, 8, 4)} ${f(raan, 8, 4)} ${String(Math.round(ecc * 1e7)).padStart(7, '0')} ${f(argp, 8, 4)} ${f(ma, 8, 4)} ${f(mm, 11, 8)}    10`);
  return { name, l1, l2 };
}
const SAMPLE = {
  stations: [makeTle('ISS (ZARYA)', 25544, 51.64, 120, 0.0004, 90, 10, 15.5), makeTle('CSS (TIANHE)', 48274, 41.47, 300, 0.0005, 45, 200, 15.6)],
  weather: [makeTle('NOAA 20', 43013, 98.7, 40, 0.0001, 90, 100, 14.19), makeTle('GOES 16', 41866, 0.05, 80, 0.0001, 0, 255, 1.0027)],
  earth: [makeTle('LANDSAT 9', 49260, 98.2, 10, 0.0001, 90, 300, 14.57), makeTle('SENTINEL-2A', 40697, 98.6, 200, 0.0001, 90, 50, 14.31)],
  gps: [makeTle('GPS BIIF-1', 36585, 55, 30, 0.01, 40, 30, 2.0056), makeTle('GPS III-1', 43873, 55, 150, 0.002, 200, 120, 2.0056)],
  science: [makeTle('HST', 20580, 28.47, 250, 0.0002, 60, 80, 15.1)],
  starlink: Array.from({ length: 24 }, (_, i) => makeTle(`STARLINK-${1000 + i}`, 44000 + i, 53, (i % 6) * 60, 0.0001, 0, (i * 47) % 360, 15.06)),
};
const debris = (name, base, inc, mm) => Array.from({ length: 40 }, (_, i) => makeTle(`${name} DEB`, base + i, inc + (i % 5) * 0.3, (i * 23) % 360, 0.004 + (i % 7) * 0.002, (i * 31) % 360, (i * 53) % 360, mm + (i % 9) * 0.05));
SAMPLE['debris-fy1c'] = debris('FENGYUN 1C', 29700, 98.6, 14.2);
SAMPLE['debris-cosmos'] = debris('COSMOS 2251', 33800, 74, 14.4);
SAMPLE['debris-iridium'] = debris('IRIDIUM 33', 33780, 86.4, 14.5);
SAMPLE.recent = [makeTle('FALCON 9 R/B', 60001, 53, 40, 0.02, 10, 10, 15.8), makeTle('NEW SAT A', 60002, 97.5, 80, 0.001, 0, 40, 15.2)];
SAMPLE.active = [...SAMPLE.stations, ...SAMPLE.weather, ...SAMPLE.earth, ...SAMPLE.gps, ...SAMPLE.science, ...SAMPLE.starlink];

export async function spaceGroup(key) {
  const g = SPACE_GROUPS.find((x) => x.key === key);
  if (!g) return null;
  let sats;
  if (config.offline) sats = SAMPLE[key];
  else {
    try {
      const r = await fetchCached(`space:${key}`, `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g.celestrak}&FORMAT=tle`, { ttlSec: 4 * 3600, timeoutMs: 15000 });
      sats = r.status < 400 ? parseTle(r.body.toString('utf8')) : [];
    } catch { sats = []; }
    if (!sats.length) sats = SAMPLE[key];
  }
  return { key: g.key, name: g.name, color: g.color, source: 'CelesTrak', satellites: (sats || []).slice(0, g.limit || 400) };
}

// Catalogue record for one object (owner, launch, size), from CelesTrak SATCAT.
const OWNERS = {
  US: 'United States', PRC: 'China', CIS: 'Russia / former USSR', UK: 'United Kingdom', FR: 'France', JPN: 'Japan', IND: 'India',
  ESA: 'European Space Agency', EUME: 'EUMETSAT', EUTE: 'Eutelsat', GER: 'Germany', IT: 'Italy', CA: 'Canada', SKOR: 'South Korea',
  ISS: 'International (ISS partners)', ISRA: 'Israel', BRAZ: 'Brazil', AUS: 'Australia', SPN: 'Spain', NZ: 'New Zealand', UAE: 'United Arab Emirates',
  SES: 'SES', O3B: 'O3b (SES)', ITSO: 'Intelsat', IRID: 'Iridium', GLOB: 'Globalstar', ORB: 'Orbcomm', TURK: 'Turkey', ARGN: 'Argentina',
  SAFR: 'South Africa', LUXE: 'Luxembourg', FIN: 'Finland', NOR: 'Norway', SWED: 'Sweden', NETH: 'Netherlands', TWN: 'Taiwan', IRAN: 'Iran',
  NKOR: 'North Korea', INDO: 'Indonesia', THAI: 'Thailand', MEX: 'Mexico', SAUD: 'Saudi Arabia', ASRA: 'Austria', SWTZ: 'Switzerland', AB: 'Arab Satellite Org.',
};
const SITES = {
  AFETR: 'Cape Canaveral, Florida', AFWTR: 'Vandenberg, California', TYMSC: 'Baikonur, Kazakhstan', PLMSC: 'Plesetsk, Russia', VOSTO: 'Vostochny, Russia',
  KYMSC: 'Kapustin Yar, Russia', JSC: 'Jiuquan, China', JSSLC: 'Jiuquan, China', TSC: 'Taiyuan, China', TAISC: 'Taiyuan, China', XSC: 'Xichang, China',
  XICLF: 'Xichang, China', WSC: 'Wenchang, China', WLPIS: 'Wallops Island, Virginia', FRGUI: 'Kourou, French Guiana', SRILR: 'Sriharikota, India',
  TNSTA: 'Tanegashima, Japan', KSCUT: 'Uchinoura, Japan', RLLB: 'Mahia, New Zealand (Rocket Lab)', KODAK: 'Kodiak, Alaska', SEAL: 'Sea Launch (Pacific)',
  SVOBO: 'Svobodny, Russia', YAVNE: 'Palmachim, Israel', NSC: 'Naro, South Korea', SNMLP: 'San Marco, Kenya', SEMLS: 'Semnan, Iran', YUN: 'Sohae, North Korea',
  OREN: 'Yasny, Russia', DLS: 'Dombarovsky, Russia', SADOL: 'Submarine launch (Barents Sea)', KWAJ: 'Kwajalein, Marshall Islands', ERAS: 'Air launch (Pegasus)',
  HGSTR: 'Hammaguir, Algeria', WOMRA: 'Woomera, Australia', CHINA: 'China (sea launch)', JJSLA: 'Jeju, South Korea',
};
const TYPES = { PAY: 'Satellite (payload)', 'R/B': 'Rocket body', DEB: 'Debris', UNK: 'Unknown' };
const STATUS = { '+': 'Operating', '-': 'Not operating', P: 'Partly operating', B: 'Backup', S: 'Spare', X: 'Extended mission', D: 'Decayed', '?': 'Unknown' };

export async function spaceInfo(norad) {
  const n = String(norad).replace(/\D/g, '');
  if (!n) return null;
  let rec;
  if (config.offline) rec = n === '25544' ? { OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544, OBJECT_TYPE: 'PAY', OPS_STATUS_CODE: '+', OWNER: 'ISS', LAUNCH_DATE: '1998-11-20', LAUNCH_SITE: 'TYMSC', DECAY_DATE: null, PERIOD: 92.9, INCLINATION: 51.64, APOGEE: 425, PERIGEE: 417, RCS: 401.2 } : null;
  else {
    try {
      const r = await fetchCached(`satcat:${n}`, `https://celestrak.org/satcat/records.php?CATNR=${n}&FORMAT=json`, { ttlSec: 7 * 86400, timeoutMs: 12000 });
      if (r.status < 400) { const j = JSON.parse(r.body.toString('utf8')); rec = Array.isArray(j) ? j[0] : null; }
    } catch { rec = null; }
  }
  if (!rec) return null;
  return {
    norad: rec.NORAD_CAT_ID, name: rec.OBJECT_NAME, intlId: rec.OBJECT_ID,
    type: TYPES[rec.OBJECT_TYPE] || rec.OBJECT_TYPE || null, typeCode: rec.OBJECT_TYPE || null,
    status: STATUS[rec.OPS_STATUS_CODE] || null,
    owner: OWNERS[rec.OWNER] || rec.OWNER || null,
    launchDate: rec.LAUNCH_DATE || null, launchSite: SITES[rec.LAUNCH_SITE] || rec.LAUNCH_SITE || null,
    decayDate: rec.DECAY_DATE || null,
    apogeeKm: rec.APOGEE ?? null, perigeeKm: rec.PERIGEE ?? null, periodMin: rec.PERIOD ?? null, inclination: rec.INCLINATION ?? null,
    rcsM2: rec.RCS ?? null,
    source: 'CelesTrak SATCAT',
  };
}

// ---- positions computed on the server (for the API) ----

// Orbital elements for one object, by catalogue number.
export async function spaceTle(norad) {
  const n = String(norad).replace(/\D/g, '');
  if (!n) return null;
  const fromSample = () => Object.values(SAMPLE).flat().find((s) => Number(s.l1.slice(2, 7)) === Number(n)) || null;
  if (config.offline) return fromSample();
  try {
    const r = await fetchCached(`tle:${n}`, `https://celestrak.org/NORAD/elements/gp.php?CATNR=${n}&FORMAT=tle`, { ttlSec: 4 * 3600, timeoutMs: 12000 });
    if (r.status < 400) { const t = parseTle(r.body.toString('utf8'))[0]; if (t) return t; }
  } catch { /* fall back below */ }
  return fromSample();
}


// Where an object is at a moment: longitude, latitude, height and speed.
export function positionAt(tle, when = new Date()) {
  const rec = sgp4.twoline2satrec(tle.l1, tle.l2);
  const pv = sgp4.propagate(rec, when);
  if (!pv || !pv.position || typeof pv.position === 'boolean' || rec.error) return null;
  const gd = sgp4.eciToGeodetic(pv.position, sgp4.gstime(when));
  const v = pv.velocity;
  return {
    lon: Math.round(sgp4.degreesLong(gd.longitude) * 1e5) / 1e5,
    lat: Math.round(sgp4.degreesLat(gd.latitude) * 1e5) / 1e5,
    altKm: Math.round(gd.height * 10) / 10,
    speedKmS: Math.round(Math.hypot(v.x, v.y, v.z) * 1000) / 1000,
  };
}
export const periodMin = (tle) => 1440 / Number(tle.l2.slice(52, 63));
export const noradOf = (tle) => Number(tle.l1.slice(2, 7));

// The ground track as GeoJSON, split where it crosses the date line.
export function groundTrack(tle, from, minutes, stepSec) {
  const lines = [[]];
  let prev = null;
  for (let s = 0; s <= minutes * 60; s += stepSec) {
    const p = positionAt(tle, new Date(from.getTime() + s * 1000));
    if (!p) continue;
    if (prev && Math.abs(p.lon - prev.lon) > 180) lines.push([]);
    lines.at(-1).push([p.lon, p.lat]);
    prev = p;
  }
  const parts = lines.filter((l) => l.length > 1);
  return { type: 'MultiLineString', coordinates: parts };
}

