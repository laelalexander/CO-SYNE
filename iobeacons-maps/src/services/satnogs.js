// Real signals from real satellites, and an outside check on our positions.
// SatNOGS (network.satnogs.org) is an open network of volunteer ground
// stations; it publishes every pass it records. The position check compares
// our SGP4 position for the ISS with an independent public tracker.
import { config } from '../config.js';
import { fetchJson } from './fetcher.js';
import { spaceTle, positionAt } from './space.js';

const NET = 'https://network.satnogs.org';

const sampleHeard = (norad) => {
  const now = Date.now();
  const st = [['W5OK Tulsa', 36.15, -95.99], ['DL1SAT Berlin', 52.52, 13.4], ['VK2GND Sydney', -33.87, 151.21]];
  return st.map(([name, lat, lng], i) => ({
    id: 900000 + i, start: new Date(now - (i + 1) * 5400e3).toISOString(), end: new Date(now - (i + 1) * 5400e3 + 600e3).toISOString(),
    station: { id: 100 + i, name, lat, lng }, frequencyMHz: 145.825, mode: 'AFSK', description: 'APRS digipeater (sample)',
    maxElevation: 40 + i * 10, packets: 3 - i, waterfall: null, audio: null, link: `${NET}/observations/${900000 + i}/`,
  })).map((o) => ({ ...o, norad: Number(norad) }));
};

// Passes of one object that SatNOGS stations recorded and volunteers marked good.
export async function heardBy(norad) {
  const n = String(norad).replace(/\D/g, '');
  if (!n) return null;
  if (config.offline) return { norad: Number(n), source: 'SatNOGS (sample data)', observations: sampleHeard(n) };
  const rows = await fetchJson(`satnogs:obs:${n}`, `${NET}/api/observations/?norad_cat_id=${n}&status=good&format=json`, { ttlSec: 900, timeoutMs: 12000 });
  const list = (Array.isArray(rows) ? rows : rows.results || [])
    .filter((o) => String(o.norad_cat_id) === n && o.status === 'good')
    .slice(0, 25)
    .map((o) => ({
      id: o.id, norad: Number(n), start: o.start, end: o.end,
      station: { id: o.ground_station, name: o.station_name, lat: o.station_lat, lng: o.station_lng },
      frequencyMHz: o.observation_frequency ? Math.round(o.observation_frequency / 1e3) / 1e3 : null,
      mode: o.transmitter_mode || null, description: o.transmitter_description || null,
      maxElevation: o.max_altitude ?? null, packets: Array.isArray(o.demoddata) ? o.demoddata.length : 0,
      waterfall: o.waterfall || null, audio: o.payload || null, link: `${NET}/observations/${o.id}/`,
    }));
  return { norad: Number(n), source: 'SatNOGS', observations: list };
}

const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};

// Our ISS position next to an independent tracker's, at the same moment.
export async function checkIss() {
  const tle = await spaceTle(25544);
  if (!tle) return null;
  let theirs = null;
  if (config.offline) {
    const t = new Date();
    const p = positionAt(tle, t);
    theirs = { source: 'Sample tracker (offline)', time: t.toISOString(), lat: p.lat + 0.004, lon: p.lon - 0.006, altKm: p.altKm + 0.4 };
  } else {
    // Fresh each time (short cache), so it's a real comparison.
    try {
      const j = await fetchJson(`iss:wti:${Math.floor(Date.now() / 60000)}`, 'https://api.wheretheiss.at/v1/satellites/25544', { ttlSec: 60, timeoutMs: 8000 });
      theirs = { source: 'wheretheiss.at', time: new Date(j.timestamp * 1000).toISOString(), lat: j.latitude, lon: j.longitude, altKm: j.altitude };
    } catch {
      const j = await fetchJson(`iss:on:${Math.floor(Date.now() / 60000)}`, 'http://api.open-notify.org/iss-now.json', { ttlSec: 60, timeoutMs: 8000 });
      theirs = { source: 'Open Notify', time: new Date(j.timestamp * 1000).toISOString(), lat: Number(j.iss_position.latitude), lon: Number(j.iss_position.longitude), altKm: null };
    }
  }
  const ours = positionAt(tle, new Date(theirs.time));
  const apart = Math.round(km(ours, theirs) * 10) / 10;
  return {
    norad: 25544, name: tle.name, time: theirs.time,
    ours: { lat: ours.lat, lon: ours.lon, altKm: ours.altKm },
    theirs: { source: theirs.source, lat: theirs.lat, lon: theirs.lon, altKm: theirs.altKm },
    apartKm: apart, altitudeDiffKm: theirs.altKm == null ? null : Math.round(Math.abs(ours.altKm - theirs.altKm) * 10) / 10,
    agrees: apart < 25,
    note: apart < 25 ? `Our position and ${theirs.source} agree to within ${apart} km.` : `Our position is ${apart} km from ${theirs.source}. The orbital elements may be stale.`,
  };
}
