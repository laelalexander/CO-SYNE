// Moving weather: radar loops (US high resolution and worldwide) and Doppler
// winds from the nearest NEXRAD radar. Tiles load in the browser; this only
// works out which frames and which radar to show, and caches that.
import { config } from '../config.js';
import { fetchJson } from './fetcher.js';

const IEM = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';

// US composite reflectivity for the last 50 minutes in 5-minute steps (IEM keeps these names rolling).
export function usRadarFrames(now = Date.now()) {
  const latest = Math.floor(now / 300000) * 300000;
  const frames = [];
  for (let m = 50; m >= 0; m -= 5) {
    const name = m ? `nexrad-n0q-900913-m${String(m).padStart(2, '0')}m` : 'nexrad-n0q-900913';
    frames.push({ time: new Date(latest - m * 60000).toISOString(), minutesAgo: m, tiles: [`${IEM}/${name}/{z}/{x}/{y}.png?t=${latest / 300000}`] });
  }
  return { source: 'us', attribution: 'NOAA NEXRAD via Iowa Environmental Mesonet', maxzoom: 12, stepMin: 5, frames };
}

// Worldwide radar (RainViewer, past two hours in 10-minute steps). Free tiles go to zoom 7.
export async function worldRadarFrames() {
  if (config.offline) return { source: 'world', attribution: 'RainViewer', maxzoom: 7, stepMin: 10, frames: [] };
  const j = await fetchJson('rainviewer:maps', 'https://api.rainviewer.com/public/weather-maps.json', { ttlSec: 300, timeoutMs: 10000 });
  const host = j.host || 'https://tilecache.rainviewer.com';
  const past = j.radar?.past || [];
  const now = Date.now() / 1000;
  return {
    source: 'world', attribution: 'RainViewer', maxzoom: 7, stepMin: 10,
    frames: past.map((f) => ({ time: new Date(f.time * 1000).toISOString(), minutesAgo: Math.max(0, Math.round((now - f.time) / 60)), tiles: [`${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`] })),
  };
}

// NEXRAD radar sites (IEM network list), cached for a week.
let sitesMem = null;
async function radarSites() {
  if (sitesMem && Date.now() - sitesMem.at < 864e5) return sitesMem.list;
  const g = await fetchJson('iem:nexrad-sites', 'https://mesonet.agron.iastate.edu/geojson/network/NEXRAD.geojson', { ttlSec: 7 * 86400, timeoutMs: 15000 });
  const list = (g.features || []).map((f) => ({ id: f.id || f.properties?.sid, name: f.properties?.sname || f.properties?.name || f.id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })).filter((s) => s.id && Number.isFinite(s.lon));
  sitesMem = { at: Date.now(), list };
  return list;
}
const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};

// Which velocity product this radar has right now (super-resolution N0G first).
const VELOCITY = ['N0G', 'N0U', 'N0V', 'N0S'];
async function velocityProduct(id) {
  try {
    const start = new Date(Date.now() - 3600e3).toISOString().slice(0, 16) + 'Z';
    const j = await fetchJson(`iem:radar-products:${id}`, `https://mesonet.agron.iastate.edu/json/radar.py?operation=products&radar=${id}&start=${start}`, { ttlSec: 3600, timeoutMs: 10000 });
    const have = new Set((j.products || []).map((p) => p.id));
    return VELOCITY.find((p) => have.has(p)) || 'N0G';
  } catch { return 'N0G'; }
}

export async function dopplerFor(lon, lat) {
  if (config.offline) return null;
  const sites = await radarSites();
  let best = null;
  for (const s of sites) { const d = km({ lon, lat }, s); if (!best || d < best.d) best = { ...s, d }; }
  if (!best || best.d > 460) return { radar: null, note: 'No US weather radar covers this spot. Doppler winds are available within about 460 km of a NEXRAD radar.' };
  const product = await velocityProduct(best.id);
  const stamp = Math.floor(Date.now() / 300000);
  return {
    radar: { id: best.id, name: best.name, lon: best.lon, lat: best.lat, distanceKm: Math.round(best.d) },
    product,
    tiles: [`${IEM}/ridge::${best.id}-${product}-0/{z}/{x}/{y}.png?t=${stamp}`],
    attribution: 'NOAA NEXRAD via Iowa Environmental Mesonet',
    rangeKm: 230,
  };
}
