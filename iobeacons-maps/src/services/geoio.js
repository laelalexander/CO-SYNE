import { DOMParser } from '@xmldom/xmldom';
import { kml as kmlToGeojson, gpx as gpxToGeojson } from '@tmcw/togeojson';
import { parse as parseCsv } from 'csv-parse/sync';
import shp from 'shpjs';
import { HttpError } from '../auth.js';
import { geocode } from './geocode.js';

// Turns an uploaded file into a GeoJSON FeatureCollection (WGS84).
const VALID = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);

function normalize(fc) {
  const list = Array.isArray(fc) ? fc.flatMap((x) => x.features || []) : fc?.type === 'FeatureCollection' ? fc.features
    : fc?.type === 'Feature' ? [fc] : fc?.type && VALID.has(fc.type) ? [{ type: 'Feature', geometry: fc, properties: {} }] : null;
  if (!list) throw new HttpError(400, "That file doesn't contain map features we can read.");
  const features = list.filter((f) => f && f.geometry && VALID.has(f.geometry.type))
    .map((f) => ({ type: 'Feature', geometry: f.geometry, properties: cleanProps(f.properties || {}) }));
  return { type: 'FeatureCollection', features };
}

function cleanProps(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith('_') || v === undefined) continue;
    out[String(k).slice(0, 80)] = typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 2000) : v;
  }
  return out;
}

const LAT = ['lat', 'latitude', 'y', 'lat_dd', 'latitude_dd'];
const LON = ['lon', 'lng', 'long', 'longitude', 'x', 'lon_dd', 'longitude_dd'];
const ADDR = ['address', 'full_address', 'location', 'addr', 'street_address'];

async function fromCsv(text, { geocodeLimit = 200 } = {}) {
  const rows = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  if (!rows.length) throw new HttpError(400, 'The CSV file has no rows.');
  const cols = Object.keys(rows[0]);
  const find = (names) => cols.find((c) => names.includes(c.toLowerCase().trim()));
  const latC = find(LAT); const lonC = find(LON);
  const addrC = find(ADDR);
  const cityC = find(['city', 'town']); const stateC = find(['state', 'st', 'province']); const zipC = find(['zip', 'zipcode', 'postal_code', 'postcode']);
  const features = []; const skipped = []; let geocoded = 0;
  for (const [i, row] of rows.entries()) {
    const num = (v) => (v === undefined || String(v).trim() === '' ? NaN : Number(String(v).trim()));
    let lat = latC ? num(row[latC]) : NaN; let lon = lonC ? num(row[lonC]) : NaN;
    if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && addrC && row[addrC]) {
      if (geocoded >= geocodeLimit) { skipped.push({ row: i + 2, reason: 'over the address lookup limit for one upload' }); continue; }
      const full = [row[addrC], cityC && row[cityC], stateC && row[stateC], zipC && row[zipC]].filter(Boolean).join(', ');
      const hit = (await geocode(full).catch(() => []))[0];
      geocoded++;
      if (hit) { lon = hit.lon; lat = hit.lat; }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      skipped.push({ row: i + 2, reason: 'no usable coordinates or address' });
      continue;
    }
    const props = { ...row }; if (latC) delete props[latC]; if (lonC) delete props[lonC];
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: cleanProps(props) });
  }
  if (!latC && !addrC) throw new HttpError(400, 'The CSV needs latitude and longitude columns (lat, lon) or an address column.');
  return { fc: { type: 'FeatureCollection', features }, skipped, geocoded };
}

export async function parseUpload(filename, buf) {
  const name = (filename || '').toLowerCase();
  const text = () => buf.toString('utf8');
  const xml = () => new DOMParser().parseFromString(text(), 'text/xml');
  if (name.endsWith('.geojson') || name.endsWith('.json')) {
    let data; try { data = JSON.parse(text()); } catch { throw new HttpError(400, "That GeoJSON file isn't valid JSON."); }
    return { fc: normalize(data), skipped: [] };
  }
  if (name.endsWith('.kml')) return { fc: normalize(kmlToGeojson(xml())), skipped: [] };
  if (name.endsWith('.gpx')) return { fc: normalize(gpxToGeojson(xml())), skipped: [] };
  if (name.endsWith('.csv') || name.endsWith('.txt')) { const r = await fromCsv(text()); return { fc: r.fc, skipped: r.skipped, geocoded: r.geocoded }; }
  if (name.endsWith('.kmz')) {
    const { default: JSZip } = await import('jszip').catch(() => ({ default: null }));
    if (!JSZip) throw new HttpError(400, 'KMZ support is not installed on this server. Save it as KML and try again.');
    const zip = await JSZip.loadAsync(buf);
    const kmlFile = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml'));
    if (!kmlFile) throw new HttpError(400, 'No KML file inside that KMZ.');
    const doc = new DOMParser().parseFromString(await kmlFile.async('string'), 'text/xml');
    return { fc: normalize(kmlToGeojson(doc)), skipped: [] };
  }
  if (name.endsWith('.zip') || name.endsWith('.shp.zip')) {
    try {
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return { fc: normalize(await shp(ab)), skipped: [] };
    } catch (e) {
      throw new HttpError(400, `We couldn't read that shapefile zip (${e.message}). It needs the .shp, .dbf and .prj files.`);
    }
  }
  throw new HttpError(400, 'Upload a GeoJSON, KML, KMZ, GPX, CSV or zipped shapefile.');
}

// ---- export ----
const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function kmlGeom(g) {
  const coords = (cs) => cs.map((c) => `${c[0]},${c[1]}`).join(' ');
  switch (g.type) {
    case 'Point': return `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]}</coordinates></Point>`;
    case 'LineString': return `<LineString><coordinates>${coords(g.coordinates)}</coordinates></LineString>`;
    case 'Polygon': return `<Polygon>${g.coordinates.map((r, i) => `<${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}><LinearRing><coordinates>${coords(r)}</coordinates></LinearRing></${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}>`).join('')}</Polygon>`;
    case 'MultiPoint': return `<MultiGeometry>${g.coordinates.map((c) => kmlGeom({ type: 'Point', coordinates: c })).join('')}</MultiGeometry>`;
    case 'MultiLineString': return `<MultiGeometry>${g.coordinates.map((c) => kmlGeom({ type: 'LineString', coordinates: c })).join('')}</MultiGeometry>`;
    case 'MultiPolygon': return `<MultiGeometry>${g.coordinates.map((c) => kmlGeom({ type: 'Polygon', coordinates: c })).join('')}</MultiGeometry>`;
    case 'GeometryCollection': return `<MultiGeometry>${g.geometries.map(kmlGeom).join('')}</MultiGeometry>`;
    default: return '';
  }
}

export function toKml(fc, name = 'IoBeacons Maps export') {
  const marks = fc.features.map((f) => {
    const p = f.properties || {};
    const data = Object.entries(p).map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(v)}</value></Data>`).join('');
    return `<Placemark><name>${esc(p.name || p.title || '')}</name><ExtendedData>${data}</ExtendedData>${kmlGeom(f.geometry)}</Placemark>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>\n${marks}\n</Document></kml>\n`;
}

export function toCsv(fc) {
  const keys = [...new Set(fc.features.flatMap((f) => Object.keys(f.properties || {})))];
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['geometry_type', 'longitude', 'latitude', 'wkt_or_note', ...keys].join(',')];
  for (const f of fc.features) {
    const g = f.geometry; const pt = g.type === 'Point' ? g.coordinates : null;
    lines.push([g.type, pt ? pt[0] : '', pt ? pt[1] : '', pt ? '' : 'see GeoJSON export for shape', ...keys.map((k) => f.properties?.[k])].map(cell).join(','));
  }
  return lines.join('\n') + '\n';
}
