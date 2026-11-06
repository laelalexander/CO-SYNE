import { config } from '../config.js';

// Basemap styles. Without a MapTiler key every style uses free sources that
// allow commercial use: OpenFreeMap vector tiles (OpenStreetMap data) and
// USGS National Map imagery and topo (US government, public domain).
export const STYLE_NAMES = ['streets', 'light', 'dark', 'satellite', 'terrain'];
export const STYLE_LABELS = { streets: 'Streets', light: 'Light', dark: 'Dark', satellite: 'Satellite', terrain: 'Terrain' };

const MAPTILER_IDS = { streets: 'streets-v2', light: 'dataviz', dark: 'dataviz-dark', satellite: 'hybrid', terrain: 'outdoor-v2' };

const OSM_ATTR = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const USGS_ATTR = 'USGS The National Map';

const font = (bold) => [bold ? 'Noto Sans Bold' : 'Noto Sans Regular'];
const nameField = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];

function vectorSource() {
  return { type: 'vector', url: `${config.openFreeMapUrl}/planet`, attribution: OSM_ATTR };
}

// Label layers shared by the dark and satellite styles.
function labelLayers({ text, halo, roadText }) {
  return [
    {
      id: 'water-name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name', minzoom: 8,
      layout: { 'text-field': nameField, 'text-font': ['Noto Sans Italic'], 'text-size': 12 },
      paint: { 'text-color': '#7fb2e5', 'text-halo-color': halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'road-name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', minzoom: 13,
      layout: { 'symbol-placement': 'line', 'text-field': nameField, 'text-font': font(false), 'text-size': 11 },
      paint: { 'text-color': roadText, 'text-halo-color': halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'place-minor', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 11,
      filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'village', 'hamlet']]],
      layout: { 'text-field': nameField, 'text-font': font(false), 'text-size': 12 },
      paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'place-major', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
      layout: { 'text-field': nameField, 'text-font': font(true), 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 12, 16] },
      paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.6 },
    },
  ];
}

function roadLayers(c) {
  const w = (base) => ['interpolate', ['exponential', 1.5], ['zoom'], 6, base * 0.3, 12, base, 18, base * 8];
  const road = (id, classes, color, base, minzoom = 5) => ({
    id, type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom,
    filter: ['in', ['get', 'class'], ['literal', classes]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': w(base) },
  });
  return [
    road('road-minor', ['minor', 'service', 'track'], c.minor, 0.8, 12),
    road('road-secondary', ['secondary', 'tertiary'], c.secondary, 1.2, 9),
    road('road-primary', ['primary', 'trunk'], c.primary, 1.6, 6),
    road('road-motorway', ['motorway'], c.motorway, 2, 5),
    { id: 'rail', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 11,
      filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': c.rail, 'line-width': 1, 'line-dasharray': [3, 3] } },
  ];
}

function darkStyle() {
  const c = { bg: '#141a23', water: '#0e2638', park: '#17261f', building: '#222c39', minor: '#283240', secondary: '#334052', primary: '#46566d', motorway: '#5f7391', rail: '#3a4657', boundary: '#4a5568' };
  return {
    version: 8, name: 'IoBeacons Dark',
    glyphs: `${config.openFreeMapUrl}/fonts/{fontstack}/{range}.pbf`,
    sources: { openmaptiles: vectorSource() },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': c.park } },
      { id: 'landcover-wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]], paint: { 'fill-color': c.park, 'fill-opacity': 0.6 } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', paint: { 'line-color': c.water, 'line-width': 1.2 } },
      { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': c.building } },
      ...roadLayers(c),
      { id: 'boundary-state', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', filter: ['<=', ['get', 'admin_level'], 4], paint: { 'line-color': c.boundary, 'line-dasharray': [2, 2], 'line-width': 1 } },
      ...labelLayers({ text: '#c9d4e3', halo: '#0b1017', roadText: '#9fb0c6' }),
    ],
  };
}

function rasterBase(name, tiles, maxzoom, withLabels) {
  const style = {
    version: 8, name,
    glyphs: `${config.openFreeMapUrl}/fonts/{fontstack}/{range}.pbf`,
    sources: { base: { type: 'raster', tiles, tileSize: 256, maxzoom, attribution: USGS_ATTR } },
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#1d2a1f' } }, { id: 'base', type: 'raster', source: 'base' }],
  };
  if (withLabels) {
    style.sources.openmaptiles = vectorSource();
    style.layers.push(
      { id: 'road-outline', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 10,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], paint: { 'line-color': '#f3d27a', 'line-opacity': 0.55, 'line-width': 1.2 } },
      ...labelLayers({ text: '#ffffff', halo: 'rgba(0,0,0,0.75)', roadText: '#ffffff' }),
    );
  }
  return style;
}

// Returns either { url } for a hosted style or { style } for an inline one.
export function basemap(name) {
  if (!STYLE_NAMES.includes(name)) name = 'streets';
  if (config.maptilerKey) return { url: `https://api.maptiler.com/maps/${MAPTILER_IDS[name]}/style.json?key=${config.maptilerKey}` };
  switch (name) {
    case 'streets': return { url: `${config.openFreeMapUrl}/styles/liberty` };
    case 'light': return { url: `${config.openFreeMapUrl}/styles/positron` };
    case 'dark': return { style: darkStyle() };
    case 'satellite': return { style: rasterBase('IoBeacons Satellite', ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], 16, true) };
    case 'terrain': return { style: rasterBase('IoBeacons Terrain', ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'], 16, false) };
    default: return { url: `${config.openFreeMapUrl}/styles/liberty` };
  }
}

export const TERRAIN_DEM = {
  type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  attribution: 'Terrain: Mapzen, AWS Open Data',
};
