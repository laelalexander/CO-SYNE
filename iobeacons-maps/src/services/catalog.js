import { config } from '../config.js';
import { fetchJson, UpstreamError } from './fetcher.js';
import { HttpError } from '../auth.js';

// The IoBeacons data catalog. "standard" layers come with every plan,
// "premium" layers with Professional and up. Licenses checked 2026-11 from
// memory; confirm each before charging customers for it.
export const CATALOG = [
  {
    key: 'nws-warnings', name: 'NWS warnings and watches', category: 'Weather', tier: 'standard', type: 'feed',
    description: 'Active National Weather Service warnings, watches and advisories with drawn areas.',
    attribution: 'National Weather Service', license: 'US government, public domain', refreshSec: 120,
  },
  {
    key: 'radar', name: 'Weather radar (NEXRAD)', category: 'Weather', tier: 'standard', type: 'raster',
    description: 'US composite base reflectivity, updated every 5 minutes.',
    tiles: ['https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png'],
    tileSize: 256, maxzoom: 12, opacity: 0.65, refreshSec: 300,
    attribution: 'NOAA NEXRAD via Iowa Environmental Mesonet', license: 'Public data; IEM asks for attribution',
  },
  {
    key: 'earthquakes', name: 'Earthquakes, past 24 hours', category: 'Hazards', tier: 'standard', type: 'feed',
    description: 'USGS earthquake feed, sized by magnitude.',
    attribution: 'USGS Earthquake Hazards Program', license: 'US government, public domain', refreshSec: 300,
  },
  {
    key: 'hillshade', name: 'Hillshade', category: 'Terrain', tier: 'standard', type: 'hillshade',
    description: 'Shaded relief from global elevation tiles.',
    attribution: 'Mapzen terrain tiles (AWS Open Data)', license: 'Open data, attribution required',
  },
  {
    key: 'flood', name: 'FEMA flood zones', category: 'Hazards', tier: 'premium', type: 'raster',
    description: 'National Flood Hazard Layer: 100-year (A, AE) and 500-year (X shaded) zones. Visible from zoom 12.',
    tiles: ['https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:28'],
    tileSize: 256, minzoom: 11, opacity: 0.7,
    attribution: 'FEMA National Flood Hazard Layer', license: 'US government, public domain',
  },
  {
    key: 'wildfires', name: 'Wildfire perimeters', category: 'Hazards', tier: 'premium', type: 'feed',
    description: 'Current interagency wildfire perimeters.',
    attribution: 'NIFC WFIGS', license: 'US government, public domain', refreshSec: 900,
  },
  {
    key: 'census', name: 'Census boundaries', category: 'Demographics', tier: 'premium', type: 'raster',
    description: 'Census tracts, block groups and places from TIGERweb.',
    tiles: ['https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image'],
    tileSize: 256, minzoom: 9, opacity: 0.8,
    attribution: 'US Census Bureau TIGERweb', license: 'US government, public domain',
  },
  {
    key: 'infrastructure', name: 'Power, pipelines and towers', category: 'Infrastructure', tier: 'premium', type: 'bbox',
    description: 'Power lines, substations, pipelines and communication towers in view. Zoom in to at least 11.',
    minzoom: 11, attribution: '© OpenStreetMap contributors', license: 'ODbL; use a self-hosted Overpass for production traffic',
  },
];

export const catalogFor = (plan) => CATALOG.map((c) => ({
  ...c, locked: c.tier === 'premium' && plan?.features?.catalog !== 'premium',
}));

const FEEDS = {
  async 'nws-warnings'() {
    const data = await fetchJson('nws:active', 'https://api.weather.gov/alerts/active?status=actual', {
      ttlSec: 120, headers: { Accept: 'application/geo+json' },
    });
    const features = (data.features || []).filter((f) => f.geometry).map((f) => ({
      type: 'Feature', geometry: f.geometry,
      properties: {
        event: f.properties.event, severity: f.properties.severity, headline: f.properties.headline,
        areaDesc: f.properties.areaDesc, expires: f.properties.expires, id: f.properties.id,
      },
    }));
    return { type: 'FeatureCollection', features };
  },
  async earthquakes() {
    const data = await fetchJson('usgs:eq:day', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', { ttlSec: 300 });
    return {
      type: 'FeatureCollection',
      features: (data.features || []).map((f) => ({
        type: 'Feature', geometry: f.geometry,
        properties: { mag: f.properties.mag, place: f.properties.place, time: new Date(f.properties.time).toISOString(), url: f.properties.url },
      })),
    };
  },
  async wildfires() {
    const u = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&outFields=poly_IncidentName,poly_GISAcres,attr_PercentContained&geometryPrecision=4&maxAllowableOffset=0.002&f=geojson';
    const data = await fetchJson('nifc:perimeters', u, { ttlSec: 900, timeoutMs: 25000 });
    return {
      type: 'FeatureCollection',
      features: (data.features || []).map((f) => ({
        type: 'Feature', geometry: f.geometry,
        properties: { name: f.properties.poly_IncidentName, acres: Math.round(f.properties.poly_GISAcres || 0), contained: f.properties.attr_PercentContained },
      })),
    };
  },
};

function overpassToGeojson(data) {
  const features = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const kind = t.power === 'line' || t.power === 'minor_line' ? 'Power line'
      : t.power === 'substation' ? 'Substation'
        : t.man_made === 'pipeline' ? 'Pipeline'
          : 'Tower';
    const props = { kind, name: t.name || t.operator || '', operator: t.operator || '', voltage: t.voltage || '', substance: t.substance || '' };
    if (el.type === 'node') features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [el.lon, el.lat] }, properties: props });
    else if (el.geometry?.length) {
      const coords = el.geometry.map((p) => [p.lon, p.lat]);
      const closed = coords.length > 3 && coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1];
      features.push({ type: 'Feature', geometry: closed && kind === 'Substation' ? { type: 'Polygon', coordinates: [coords] } : { type: 'LineString', coordinates: coords }, properties: props });
    }
  }
  return { type: 'FeatureCollection', features };
}

export async function overpassBbox([w, s, e, n]) {
  if (e - w > 0.6 || n - s > 0.45) throw new HttpError(400, 'Zoom in further to load infrastructure (the view is too large).');
  const r = (v) => Math.round(v * 100) / 100; // ~1 km cache grid
  const bb = `${r(s) - 0.01},${r(w) - 0.01},${r(n) + 0.01},${r(e) + 0.01}`;
  const query = `[out:json][timeout:25];(way["power"~"^(line|minor_line)$"](${bb});nwr["power"="substation"](${bb});way["man_made"="pipeline"](${bb});node["man_made"~"^(tower|mast)$"]["tower:type"="communication"](${bb}););out geom;`;
  const data = await fetchJson(`overpass:${bb}`, `${config.overpassUrl}?data=${encodeURIComponent(query)}`, { ttlSec: 86400, timeoutMs: 30000 });
  return overpassToGeojson(data);
}

export async function catalogData(key, { bbox } = {}) {
  const entry = CATALOG.find((c) => c.key === key);
  if (!entry) throw new HttpError(404, 'No such catalog layer.');
  try {
    if (entry.type === 'feed') return await FEEDS[key]();
    if (entry.type === 'bbox') {
      if (!bbox || bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) throw new HttpError(400, 'bbox=west,south,east,north is required.');
      return await overpassBbox(bbox);
    }
  } catch (e) {
    if (e instanceof UpstreamError) throw new HttpError(503, `${entry.name} is unavailable right now. ${e.message}`);
    throw e;
  }
  throw new HttpError(400, 'This layer is drawn straight from map tiles and has no data download.');
}
