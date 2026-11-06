import PDFDocument from 'pdfkit';
import { fetchJson, fetchCached } from './fetcher.js';
import { catalogData, overpassBbox } from './catalog.js';
import { many } from '../db/pool.js';

// Site Intelligence Report: everything we can learn about one location.
// Each section is fetched independently; a source that is down is reported
// as unavailable instead of failing the whole report.
const MI = 1609.344;
const round = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const haversineMi = (a, b) => {
  const R = 3958.8; const toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b[1] - a[1]); const dLon = toR(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const k5 = (v) => v.toFixed(4);

const SECTIONS = {
  async weather({ lon, lat }) {
    const pt = await fetchJson(`nws:pt:${k5(lat)},${k5(lon)}`, `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { ttlSec: 86400, headers: { Accept: 'application/geo+json' } });
    const fc = await fetchJson(`nws:fc:${pt.properties.forecast}`, pt.properties.forecast, { ttlSec: 1800, headers: { Accept: 'application/geo+json' } });
    const periods = (fc.properties?.periods || []).slice(0, 4).map((p) => ({ name: p.name, temp: `${p.temperature}°${p.temperatureUnit}`, wind: `${p.windSpeed} ${p.windDirection}`, text: p.shortForecast }));
    return { office: pt.properties.cwa, place: `${pt.properties.relativeLocation?.properties?.city}, ${pt.properties.relativeLocation?.properties?.state}`, periods };
  },
  async warnings({ lon, lat }) {
    const d = await fetchJson(`nws:alerts:${k5(lat)},${k5(lon)}`, `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { ttlSec: 120, headers: { Accept: 'application/geo+json' } });
    return { active: (d.features || []).map((f) => ({ event: f.properties.event, severity: f.properties.severity, until: f.properties.expires, headline: f.properties.headline })) };
  },
  async elevation({ lon, lat }) {
    const d = await fetchJson(`epqs:${k5(lat)},${k5(lon)}`, `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Feet&wkid=4326&includeDate=false`, { ttlSec: 86400 * 30 });
    const ft = Number(d.value);
    return { feet: round(ft), meters: round(ft * 0.3048) };
  },
  async flood({ lon, lat }) {
    const u = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=false&f=json`;
    const d = await fetchJson(`fema:${k5(lat)},${k5(lon)}`, u, { ttlSec: 86400 * 7, timeoutMs: 20000 });
    const a = d.features?.[0]?.attributes;
    if (!a) return { zone: 'Not mapped', note: 'No FEMA flood map panel covers this point, or it is outside mapped areas.' };
    const sfha = a.SFHA_TF === 'T';
    return { zone: a.FLD_ZONE, subtype: a.ZONE_SUBTY || '', specialFloodHazardArea: sfha, note: sfha ? 'In a Special Flood Hazard Area (1% annual chance). Flood insurance is usually required for federally backed mortgages.' : 'Outside the 1% annual chance flood area.' };
  },
  async soil({ lon, lat }) {
    const query = `SELECT TOP 1 mu.muname, mu.mukey, c.compname, c.hydgrp, c.drainagecl FROM mapunit mu LEFT JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes' WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lon} ${lat})')) ORDER BY c.comppct_r DESC`;
    const r = await fetchCached(`sda:${k5(lat)},${k5(lon)}`, 'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest', {
      method: 'POST', ttlSec: 86400 * 30, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, format: 'JSON+COLUMNNAME' }),
    });
    const d = JSON.parse(r.body.toString('utf8') || '{}');
    const row = d.Table?.[1];
    if (!row) return { mapUnit: 'Not surveyed' };
    return { mapUnit: row[0], component: row[2], hydrologicGroup: row[3], drainage: row[4] };
  },
  async demographics({ lon, lat }) {
    const g = await fetchJson(`censusgeo:${k5(lat)},${k5(lon)}`, `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Census%20Tracts,Counties&format=json`, { ttlSec: 86400 * 30, timeoutMs: 15000 });
    const tract = g.result?.geographies?.['Census Tracts']?.[0];
    const county = g.result?.geographies?.Counties?.[0];
    if (!tract) return { note: 'Outside US census tracts.' };
    const vars = 'NAME,B01003_001E,B11001_001E,B19013_001E,B25077_001E,B25003_002E,B25003_001E';
    const acs = await fetchJson(`acs:${tract.GEOID}`, `https://api.census.gov/data/2023/acs/acs5?get=${vars}&for=tract:${tract.TRACT}&in=state:${tract.STATE}%20county:${tract.COUNTY}`, { ttlSec: 86400 * 30, timeoutMs: 15000 });
    const [hdr, vals] = acs; const v = Object.fromEntries(hdr.map((h, i) => [h, vals[i]]));
    const num = (x) => (Number(x) > 0 ? Number(x) : null);
    return {
      county: county?.NAME, tract: tract.NAME, population: num(v.B01003_001E), households: num(v.B11001_001E),
      medianHouseholdIncome: num(v.B19013_001E), medianHomeValue: num(v.B25077_001E),
      ownerOccupiedPct: num(v.B25003_001E) ? round((100 * Number(v.B25003_002E)) / Number(v.B25003_001E), 1) : null,
      source: 'American Community Survey 2019-2023 5-year estimates, census tract',
    };
  },
  async hazards({ lon, lat, radiusMi }) {
    const out = { earthquakes: [], wildfires: [] };
    const eq = await catalogData('earthquakes').catch(() => null);
    if (eq) out.earthquakes = eq.features.map((f) => ({ ...f.properties, mi: round(haversineMi([lon, lat], f.geometry.coordinates), 1) })).filter((f) => f.mi <= Math.max(radiusMi, 50)).sort((a, b) => a.mi - b.mi).slice(0, 5);
    const wf = await catalogData('wildfires').catch(() => null);
    if (wf) {
      out.wildfires = wf.features.map((f) => {
        const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates?.[0]?.[0] || [];
        const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
        return { ...f.properties, mi: round(haversineMi([lon, lat], c), 1) };
      }).filter((f) => f.mi <= 100).sort((a, b) => a.mi - b.mi).slice(0, 5);
    }
    return out;
  },
  async infrastructure({ lon, lat, radiusMi, plan }) {
    if (plan?.features?.catalog !== 'premium') return { locked: true, note: 'Nearby infrastructure needs the Professional plan.' };
    const r = Math.min(radiusMi, 2); const dLat = r / 69; const dLon = r / (69 * Math.cos((lat * Math.PI) / 180));
    const fc = await overpassBbox([lon - dLon, lat - dLat, lon + dLon, lat + dLat]);
    const counts = {};
    for (const f of fc.features) counts[f.properties.kind] = (counts[f.properties.kind] || 0) + 1;
    return { withinMi: r, counts };
  },
  async workspace({ lon, lat, radiusMi, orgId }) {
    const p = 'ST_SetSRID(ST_MakePoint($2,$3),4326)';
    const sites = await many(`select name, round((ST_Distance(geom::geography, ${p}::geography)/${MI})::numeric,2) mi from sites where org_id=$1 and ST_DWithin(geom::geography, ${p}::geography, $4) order by 2 limit 10`, [orgId, lon, lat, radiusMi * MI]);
    const zones = await many(`select name from zones where org_id=$1 and ST_DWithin(geom::geography, ${p}::geography, $4) limit 10`, [orgId, lon, lat, radiusMi * MI]);
    const devices = await many(`select name, last_seen_at from devices where org_id=$1 and last_geom is not null and ST_DWithin(last_geom::geography, ${p}::geography, $4) limit 10`, [orgId, lon, lat, radiusMi * MI]);
    const layers = await many(`select l.name, count(*)::int n from features f join layers l on l.id=f.layer_id where f.org_id=$1 and ST_DWithin(f.geom::geography, ${p}::geography, $4) group by l.name order by 2 desc limit 10`, [orgId, lon, lat, radiusMi * MI]);
    return { sites, zones, devices, layers };
  },
};

export const SECTION_TITLES = {
  weather: 'Weather forecast', warnings: 'Active weather warnings', elevation: 'Elevation', flood: 'FEMA flood zone',
  soil: 'Soil', demographics: 'Demographics', hazards: 'Nearby hazards', infrastructure: 'Nearby infrastructure', workspace: 'Your data nearby',
};
export const SOURCES = {
  weather: 'National Weather Service', warnings: 'National Weather Service', elevation: 'USGS 3DEP (Elevation Point Query Service)',
  flood: 'FEMA National Flood Hazard Layer', soil: 'USDA NRCS Soil Data Access (SSURGO)', demographics: 'US Census Bureau (Geocoder, ACS 5-year)',
  hazards: 'USGS Earthquake Hazards Program, NIFC WFIGS', infrastructure: 'OpenStreetMap contributors', workspace: 'Your IoBeacons workspace',
};

export async function buildReport({ lon, lat, radiusMi = 1, orgId, plan }) {
  const keys = Object.keys(SECTIONS);
  const results = await Promise.allSettled(keys.map((k) => SECTIONS[k]({ lon, lat, radiusMi, orgId, plan })));
  const sections = {};
  keys.forEach((k, i) => {
    sections[k] = results[i].status === 'fulfilled' ? { ok: true, data: results[i].value } : { ok: false, error: `Unavailable right now (${results[i].reason?.message || 'error'}).` };
  });
  return { lon, lat, radiusMi, generatedAt: new Date().toISOString(), sections };
}

// ---- PDF ----
const money = (v) => (v ? `$${Number(v).toLocaleString('en-US')}` : 'n/a');
const n = (v) => (v || v === 0 ? Number(v).toLocaleString('en-US') : 'n/a');

function rowsFor(key, d) {
  switch (key) {
    case 'weather': return [['Forecast office', d.office], ['Nearest place', d.place], ...d.periods.map((p) => [p.name, `${p.temp}, ${p.text}, wind ${p.wind}`])];
    case 'warnings': return d.active.length ? d.active.map((w) => [w.event, `${w.severity}. Until ${w.until ? new Date(w.until).toUTCString() : 'n/a'}`]) : [['Status', 'No active warnings at this point']];
    case 'elevation': return [['Elevation', `${n(d.feet)} ft (${n(d.meters)} m)`]];
    case 'flood': return [['Zone', `${d.zone}${d.subtype ? ` (${d.subtype})` : ''}`], ['Meaning', d.note]];
    case 'soil': return [['Map unit', d.mapUnit], ['Main component', d.component || 'n/a'], ['Hydrologic group', d.hydrologicGroup || 'n/a'], ['Drainage', d.drainage || 'n/a']];
    case 'demographics': return d.note ? [['Note', d.note]] : [['County', d.county], ['Census tract', d.tract], ['Population', n(d.population)], ['Households', n(d.households)], ['Median household income', money(d.medianHouseholdIncome)], ['Median home value', money(d.medianHomeValue)], ['Owner occupied', d.ownerOccupiedPct ? `${d.ownerOccupiedPct}%` : 'n/a'], ['Source', d.source]];
    case 'hazards': return [
      ['Earthquakes (past day, 50 mi)', d.earthquakes.length ? d.earthquakes.map((e) => `M${e.mag} ${e.mi} mi`).join('; ') : 'None'],
      ['Wildfires (within 100 mi)', d.wildfires.length ? d.wildfires.map((w) => `${w.name} ${w.mi} mi, ${n(w.acres)} acres`).join('; ') : 'None'],
    ];
    case 'infrastructure': return d.locked ? [['Note', d.note]] : Object.keys(d.counts).length ? Object.entries(d.counts).map(([k, v]) => [k, `${v} within ${d.withinMi} mi`]) : [['Result', `None mapped within ${d.withinMi} mi`]];
    case 'workspace': return [
      ['Your sites', d.sites.length ? d.sites.map((s) => `${s.name} (${s.mi} mi)`).join('; ') : 'None'],
      ['Your zones', d.zones.length ? d.zones.map((z) => z.name).join('; ') : 'None'],
      ['Your devices', d.devices.length ? d.devices.map((z) => z.name).join('; ') : 'None'],
      ['Your layers', d.layers.length ? d.layers.map((l) => `${l.name}: ${l.n}`).join('; ') : 'None'],
    ];
    default: return [];
  }
}

export function reportPdf(report, { title, brand = {} } = {}) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: title, Author: brand.name || 'IoBeacons' } });
  const accent = /^#[0-9a-f]{6}$/i.test(brand.color || '') ? brand.color : '#1f5fbf';
  doc.rect(0, 0, doc.page.width, 8).fill(accent);
  doc.fillColor('#5a6678').fontSize(9).text((brand.name || 'IoBeacons').toUpperCase() + '  ·  SITE INTELLIGENCE REPORT', 54, 30);
  doc.moveDown(0.6).fillColor('#16202e').fontSize(20).font('Helvetica-Bold').text(title);
  doc.font('Helvetica').fontSize(10).fillColor('#5a6678')
    .text(`${report.lat.toFixed(5)}° N, ${Math.abs(report.lon).toFixed(5)}° ${report.lon < 0 ? 'W' : 'E'}  ·  ${report.radiusMi} mile radius  ·  Generated ${new Date(report.generatedAt).toUTCString()}`);
  doc.moveDown(1);
  for (const [key, sec] of Object.entries(report.sections)) {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(accent).text(SECTION_TITLES[key]);
    doc.moveDown(0.25);
    const rows = sec.ok ? rowsFor(key, sec.data) : [['Status', sec.error]];
    for (const [k, v] of rows) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9.5).fillColor('#5a6678').text(String(k ?? ''), 54, y, { width: 150 });
      const h1 = doc.y - y;
      doc.fillColor('#16202e').text(String(v ?? 'n/a'), 214, y, { width: doc.page.width - 268 });
      doc.y = Math.max(doc.y, y + h1) + 3;
    }
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#8a94a6').text(`Source: ${SOURCES[key]}`, 54);
    doc.moveDown(0.8);
  }
  doc.font('Helvetica').fontSize(8).fillColor('#8a94a6').text('This report combines public data for planning purposes. It is not a survey, appraisal, flood determination or engineering assessment. Verify critical facts with the source agency.', 54, doc.y + 6, { width: doc.page.width - 108 });
  doc.end();
  return doc;
}
