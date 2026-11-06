import { config } from '../config.js';
import { fetchJson } from './fetcher.js';

// Address search. Returns [{ label, lon, lat }].
// census: US Census Geocoder (free, US addresses, commercial use allowed)
// maptiler: MapTiler geocoding (needs MAPTILER_KEY, worldwide)
// nominatim: OpenStreetMap Nominatim (light use only, per its policy)
const coordRe = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export async function geocode(text) {
  const qText = String(text || '').trim().slice(0, 200);
  if (!qText) return [];
  const m = qText.match(coordRe);
  if (m) {
    const lat = Number(m[1]); const lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [{ label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lon, lat }];
  }
  const key = `geo:${config.geocoder}:${qText.toLowerCase()}`;
  if (config.geocoder === 'maptiler' && config.maptilerKey) {
    const d = await fetchJson(key, `https://api.maptiler.com/geocoding/${encodeURIComponent(qText)}.json?key=${config.maptilerKey}&limit=5`, { ttlSec: 86400 * 30 });
    return (d.features || []).map((f) => ({ label: f.place_name, lon: f.center[0], lat: f.center[1] }));
  }
  if (config.geocoder === 'nominatim') {
    const d = await fetchJson(key, `${config.nominatimUrl}/search?format=jsonv2&limit=5&q=${encodeURIComponent(qText)}`, { ttlSec: 86400 * 30 });
    return d.map((r) => ({ label: r.display_name, lon: Number(r.lon), lat: Number(r.lat) }));
  }
  const d = await fetchJson(key, `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(qText)}&benchmark=Public_AR_Current&format=json`, { ttlSec: 86400 * 30, timeoutMs: 15000 });
  return (d.result?.addressMatches || []).slice(0, 5).map((r) => ({ label: r.matchedAddress, lon: r.coordinates.x, lat: r.coordinates.y }));
}
