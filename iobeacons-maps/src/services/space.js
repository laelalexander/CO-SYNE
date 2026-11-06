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
};

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
  return { key: g.key, name: g.name, color: g.color, source: 'CelesTrak', satellites: sats.slice(0, 400) };
}
