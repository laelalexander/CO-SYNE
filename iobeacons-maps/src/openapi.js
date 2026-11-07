// The IoBeacons API described as OpenAPI 3.1. The developer reference page,
// the client libraries and /api/v1/openapi.json are all built from this list,
// so a new endpoint only needs adding here once.

const id = (name, desc = 'Its id (a UUID).') => ({ name, in: 'path', required: true, description: desc, schema: { type: 'string' } });
const qp = (name, description, schema = { type: 'string' }, extra = {}) => ({ name, in: 'query', required: false, description, schema, ...extra });
const bbox = qp('bbox', 'Only what falls inside west,south,east,north (degrees).', { type: 'string' }, { example: '-96.1,36.0,-95.8,36.3' });
const time = qp('time', 'A moment within 30 days of now, as an ISO date. Default: now.', { type: 'string', format: 'date-time' });

// Each entry: [method, path, tag, summary, details]
// details: { op, desc, params, body, example, returns, plan }
export const ENDPOINTS = [
  // ---- account ----
  ['get', '/me', 'Account', 'Who this key belongs to', { op: 'me', desc: 'The workspace, plan and this month\'s API use for the key you sent. A good first call to check a key works.', returns: { $ref: '#/components/schemas/Me' } }],
  ['get', '/usage', 'Account', 'Usage this month', { op: 'usage', desc: 'Counts of maps, features, devices, zones, rules and sites, plus this month\'s map views, reports and API calls.' }],

  // ---- maps ----
  ['get', '/maps', 'Maps', 'List maps', { op: 'listMaps', desc: 'Every map in the workspace the key can see, newest change first.', returns: { type: 'array', items: { $ref: '#/components/schemas/MapSummary' } } }],
  ['post', '/maps', 'Maps', 'Create a map', { op: 'createMap', body: { name: 'Fleet yard', style: 'streets', view: { center: [-95.99, 36.15], zoom: 11 } }, desc: 'Styles: streets, light, dark, satellite, terrain.' }],
  ['get', '/maps/{id}', 'Maps', 'Get a map with its layers', { op: 'getMap', params: [id('id')], desc: 'The map, its saved view, every layer with its style, and share links if sharing is on.' }],
  ['patch', '/maps/{id}', 'Maps', 'Change a map', { op: 'updateMap', params: [id('id')], body: { name: 'Fleet yard (north)', visibility: 'link' }, desc: 'Send only what changes: name, description, style, view, settings or visibility (private, team, link, public). Turning on link or public sharing returns share and embed links.' }],
  ['delete', '/maps/{id}', 'Maps', 'Delete a map', { op: 'deleteMap', params: [id('id')], desc: 'Deletes the map, its layers and their features.' }],
  ['post', '/maps/{id}/duplicate', 'Maps', 'Copy a map', { op: 'duplicateMap', params: [id('id')], desc: 'Copies the map with all its layers and features.' }],
  ['post', '/maps/{id}/share/reset', 'Maps', 'Make a new share link', { op: 'resetShareLink', params: [id('id')], desc: 'The old link and embed stop working straight away.' }],
  ['post', '/maps/{id}/upload', 'Maps', 'Upload a file as a new layer', { op: 'uploadFile', params: [id('id')], upload: true, desc: 'Send multipart/form-data with a file field (GeoJSON, KML, KMZ, GPX, CSV or a zipped shapefile) and an optional name. CSV rows with addresses are geocoded.' }],

  // ---- layers ----
  ['post', '/maps/{id}/layers', 'Layers', 'Add a layer', { op: 'createLayer', params: [id('id', 'The map id.')], body: { name: 'Depots', style: { color: '#2876ee', radius: 6 } }, desc: 'kind "features" (default) is your own data. kind "catalog" with a catalog_key adds a live layer from the catalog, for example "radar" or "earthquakes".' }],
  ['patch', '/layers/{id}', 'Layers', 'Change a layer', { op: 'updateLayer', params: [id('id')], body: { name: 'Depots', visible: true, style: { color: '#d9781a' } }, desc: 'Name, visible, position, or style (color, opacity, width, radius, mode, field, label, popup, palette).' }],
  ['delete', '/layers/{id}', 'Layers', 'Delete a layer', { op: 'deleteLayer', params: [id('id')] }],
  ['get', '/layers/{id}/export.{format}', 'Layers', 'Download a layer', { op: 'exportLayer', params: [id('id'), { name: 'format', in: 'path', required: true, description: 'geojson, csv or kml', schema: { type: 'string', enum: ['geojson', 'csv', 'kml'] } }], desc: 'The whole layer as a file.', raw: true }],
  ['get', '/tiles/{layerId}/{z}/{x}/{y}.pbf', 'Layers', 'Vector tiles', { op: 'layerTile', params: [id('layerId', 'The layer id.'), ...['z', 'x', 'y'].map((n) => ({ name: n, in: 'path', required: true, schema: { type: 'integer' } }))], desc: 'Mapbox Vector Tiles for large layers. Point MapLibre or Mapbox GL at https://iobeacons.com/maps/api/v1/tiles/{layerId}/{z}/{x}/{y}.pbf and send the key as a header (transformRequest).', raw: true }],

  // ---- features ----
  ['get', '/layers/{id}/features', 'Features', 'Read features', { op: 'listFeatures', params: [id('id', 'The layer id.'), bbox], desc: 'A GeoJSON FeatureCollection. Each feature carries its id in properties._id. Up to 20,000 per call; truncated is true when there are more, so ask for a smaller bbox.', returns: { $ref: '#/components/schemas/FeatureCollection' } }],
  ['post', '/layers/{id}/features', 'Features', 'Add features', { op: 'addFeatures', params: [id('id', 'The layer id.')], body: { type: 'Feature', geometry: { type: 'Point', coordinates: [-95.99, 36.15] }, properties: { name: 'Depot 4' } }, desc: 'Send one GeoJSON Feature or a FeatureCollection. Returns the new ids.' }],
  ['patch', '/features/{id}', 'Features', 'Change a feature', { op: 'updateFeature', params: [id('id', 'The feature id (a number).')], body: { properties: { name: 'Depot 4 (closed)' } }, desc: 'Send a new geometry, new properties, or both. Properties replace the old ones.' }],
  ['delete', '/features/{id}', 'Features', 'Delete a feature', { op: 'deleteFeature', params: [id('id', 'The feature id (a number).')] }],

  // ---- sites ----
  ['get', '/sites', 'Sites', 'List sites', { op: 'listSites', desc: 'Your places of interest as GeoJSON points.' }],
  ['post', '/sites', 'Sites', 'Add a site', { op: 'createSite', body: { name: 'Tulsa yard', address: '1 W 3rd St, Tulsa, OK' }, desc: 'Give lon and lat, or an address to look up. An optional boundary polygon is used by weather alerts.' }],
  ['patch', '/sites/{id}', 'Sites', 'Change a site', { op: 'updateSite', params: [id('id')], body: { name: 'Tulsa yard (main)' } }],
  ['delete', '/sites/{id}', 'Sites', 'Delete a site', { op: 'deleteSite', params: [id('id')] }],

  // ---- zones ----
  ['get', '/zones', 'Zones', 'List zones', { op: 'listZones', desc: 'Geofences as GeoJSON polygons.' }],
  ['post', '/zones', 'Zones', 'Add a zone', { op: 'createZone', body: { name: 'Yard', circle: { lon: -95.99, lat: 36.15, radius_m: 300 } }, desc: 'Send a circle (lon, lat, radius_m) or a GeoJSON Polygon as geometry.' }],
  ['patch', '/zones/{id}', 'Zones', 'Change a zone', { op: 'updateZone', params: [id('id')], body: { name: 'Main yard', color: '#d9781a' } }],
  ['delete', '/zones/{id}', 'Zones', 'Delete a zone', { op: 'deleteZone', params: [id('id')] }],

  // ---- devices ----
  ['get', '/devices', 'Devices', 'List devices', { op: 'listDevices', desc: 'Every device with its last position, plus a FeatureCollection of those that have reported.' }],
  ['post', '/devices', 'Devices', 'Add a device', { op: 'createDevice', body: { name: 'Truck 12', external_id: 'truck-12', kind: 'vehicle' }, desc: 'external_id is your own id for it. You can skip this step: sending positions for a new external id creates the device.' }],
  ['delete', '/devices/{id}', 'Devices', 'Delete a device', { op: 'deleteDevice', params: [id('id')] }],
  ['post', '/devices/{ref}/positions', 'Devices', 'Send positions', { op: 'sendPositions', params: [{ name: 'ref', in: 'path', required: true, description: 'The device id or your external id.', schema: { type: 'string' }, example: 'truck-12' }], body: { lon: -95.99, lat: 36.15, speed_mph: 34, heading: 90 }, desc: 'One fix, or { "positions": [...] } with up to 1,000 fixes and their times. The answer lists alerts the new positions set off.' }],
  ['get', '/devices/{id}/track', 'Devices', 'A device\'s trail', { op: 'deviceTrack', params: [id('id'), qp('hours', 'How far back, 1 to 168. Default 24.', { type: 'integer' })], desc: 'A GeoJSON LineString of recent positions.' }],

  // ---- alerts ----
  ['get', '/rules', 'Alerts', 'List alert rules', { op: 'listRules' }],
  ['post', '/rules', 'Alerts', 'Add an alert rule', { op: 'createRule', body: { name: 'Truck left the yard', trigger: { type: 'zone_exit', zone_id: '00000000-0000-0000-0000-000000000000' }, channels: { emails: ['ops@example.com'], webhooks: ['https://example.com/hooks/iobeacons'] } }, desc: 'Trigger types: zone_enter, zone_exit, offline, speed, nws_warning, earthquake. Channels: emails, sms (with country code) and https webhooks.' }],
  ['patch', '/rules/{id}', 'Alerts', 'Change an alert rule', { op: 'updateRule', params: [id('id')], body: { enabled: false } }],
  ['delete', '/rules/{id}', 'Alerts', 'Delete an alert rule', { op: 'deleteRule', params: [id('id')] }],
  ['get', '/alerts', 'Alerts', 'Recent alerts', { op: 'listAlerts', desc: 'The last 100 alerts and how each was delivered.' }],

  // ---- reports ----
  ['post', '/reports', 'Reports', 'Make a site report', { op: 'createReport', body: { lon: -95.99, lat: 36.15, radius_mi: 1 }, desc: 'Flood zone, weather warnings, earthquakes, nearby services and more for a point or a site_id.' }],
  ['get', '/reports', 'Reports', 'List reports', { op: 'listReports' }],
  ['get', '/reports/{id}', 'Reports', 'Get a report', { op: 'getReport', params: [id('id')] }],
  ['get', '/reports/{id}/pdf', 'Reports', 'Download a report as PDF', { op: 'reportPdf', params: [id('id')], raw: true }],

  // ---- catalog ----
  ['get', '/catalog', 'Catalog', 'List live data layers', { op: 'listCatalog', desc: 'Ready-made layers (weather warnings, radar, earthquakes, wildfires, flood zones and more), with which your plan includes.' }],
  ['get', '/catalog/{key}/data', 'Catalog', 'Read a live data layer', { op: 'catalogData', params: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' }, example: 'earthquakes' }, bbox], desc: 'GeoJSON for vector catalog layers, or tile details for raster ones.' }],
  ['get', '/geocode', 'Catalog', 'Look up an address', { op: 'geocode', params: [{ ...qp('q', 'An address or place name.'), required: true, example: '1 W 3rd St, Tulsa' }] }],

  // ---- space ----
  ['get', '/space', 'Space', 'List satellite groups', { op: 'spaceGroups', desc: 'Stations, weather, Earth observation, GPS, science, Starlink, every active satellite, recent launches and three debris fields.' }],
  ['get', '/space/{group}', 'Space', 'Orbital elements for a group', { op: 'spaceGroup', params: [{ name: 'group', in: 'path', required: true, schema: { type: 'string' }, example: 'stations' }], desc: 'Two-line elements (TLE) from CelesTrak, refreshed every few hours.' }],
  ['get', '/space/{group}/positions', 'Space', 'Where a whole group is', { op: 'spaceGroupPositions', params: [{ name: 'group', in: 'path', required: true, schema: { type: 'string' }, example: 'stations' }, time], desc: 'Every object in the group as GeoJSON points with altitude and speed.' }],
  ['get', '/space/objects/{norad}/position', 'Space', 'Where one object is', { op: 'satellitePosition', params: [{ name: 'norad', in: 'path', required: true, description: 'NORAD catalogue number.', schema: { type: 'string' }, example: '25544' }, time], desc: 'Longitude, latitude, altitude (km) and speed (km/s), worked out from the latest elements.', returns: { $ref: '#/components/schemas/SatellitePosition' } }],
  ['get', '/space/objects/{norad}/track', 'Space', 'Ground track', { op: 'satelliteTrack', params: [{ name: 'norad', in: 'path', required: true, schema: { type: 'string' }, example: '25544' }, time, qp('minutes', 'How long a path, 1 to 1440. Default: one orbit.', { type: 'integer' }), qp('step', 'Seconds between points, 10 to 600. Default 60.', { type: 'integer' })], desc: 'The path over the ground as a GeoJSON MultiLineString, split at the date line.' }],
  ['get', '/space/objects/{norad}/heard', 'Space', 'Recordings by ground stations', { op: 'satelliteHeard', params: [{ name: 'norad', in: 'path', required: true, description: 'NORAD catalogue number.', schema: { type: 'string' }, example: '25544' }], desc: 'Recent passes of this object recorded by SatNOGS, an open network of volunteer ground stations, and checked as good: when, which station and where, frequency, mode, decoded packets, and links to the recording.' }],
  ['get', '/space/check/iss', 'Space', 'Check our positions', { op: 'checkIss', desc: 'Our ISS position next to an independent public tracker at the same moment, and how far apart they are. agrees is true within 25 km.' }],
  ['get', '/space/info/{norad}', 'Space', 'Catalogue record', { op: 'satelliteInfo', params: [{ name: 'norad', in: 'path', required: true, schema: { type: 'string' }, example: '25544' }], desc: 'Owner, launch date and site, type, status, orbit and radar size from the CelesTrak satellite catalogue.' }],

  // ---- weather ----
  ['get', '/weather/radar-frames', 'Weather', 'Radar loop frames', { op: 'radarFrames', params: [qp('source', 'us (high resolution, 5-minute steps) or world (10-minute steps). Default us.', { type: 'string', enum: ['us', 'world'] })], desc: 'Tile URLs for each frame of the last hour, oldest first, ready for a map library.' }],
  ['get', '/weather/doppler', 'Weather', 'Doppler winds near a point', { op: 'doppler', params: [{ ...qp('lon', 'Longitude.', { type: 'number' }), required: true, example: -95.99 }, { ...qp('lat', 'Latitude.', { type: 'number' }), required: true, example: 36.15 }], desc: 'The nearest NEXRAD radar within about 460 km and tile URLs for its wind velocity.' }],

  // ---- notes ----
  ['get', '/notes', 'Notes', 'List notes', { op: 'listNotes', params: [qp('map_id', 'Only notes on this map.'), qp('norad', 'Only notes about this satellite.')] }],
  ['post', '/notes', 'Notes', 'Add a note', { op: 'createNote', body: { body: 'Gate 3 floods after heavy rain.', target: { kind: 'place', lng: -95.99, lat: 36.15 } }, desc: 'A note pins to a place (lng, lat), a satellite (norad) or a whole map. Add map_id to show it on a map.' }],
  ['patch', '/notes/{id}', 'Notes', 'Change a note', { op: 'updateNote', params: [id('id')], body: { body: 'Gate 3 floods after heavy rain. Use gate 4.' }, desc: 'An API key can change notes written with an API key.' }],
  ['delete', '/notes/{id}', 'Notes', 'Delete a note', { op: 'deleteNote', params: [id('id')] }],

  // ---- findings ----
  ['get', '/findings', 'Findings', 'List findings', { op: 'listFindings' }],
  ['post', '/findings', 'Findings', 'Save a finding', { op: 'createFinding', body: { title: 'Storm cell over the north yard', note: 'Moving east at 30 mph.', kind: 'map', view: { center: [-95.99, 36.15], zoom: 9 }, share: true }, desc: 'A saved view with a note. kind "map" (center, zoom, pitch, bearing, mapId) or "orbit" (norad, time, camera). With share: true the answer includes a link anyone can open.' }],
  ['patch', '/findings/{id}', 'Findings', 'Change a finding', { op: 'updateFinding', params: [id('id')], body: { share: false } }],
  ['delete', '/findings/{id}', 'Findings', 'Delete a finding', { op: 'deleteFinding', params: [id('id')] }],
];

const TAGS = {
  Account: 'Check your key, plan and usage.',
  Maps: 'Maps hold layers, a saved view and sharing settings.',
  Layers: 'Layers on a map: your own features or live catalog data.',
  Features: 'Points, lines and polygons inside a layer, as GeoJSON.',
  Sites: 'Places that matter to you, used by reports and weather alerts.',
  Zones: 'Geofences for enter and exit alerts.',
  Devices: 'Vehicles, trackers and sensors, and the positions they send.',
  Alerts: 'Rules that watch zones, sites, devices and live feeds, and the alerts they raise.',
  Reports: 'Site Intelligence Reports for any point.',
  Catalog: 'Live public data layers and address search.',
  Space: 'Satellites and debris: orbital elements, live positions and ground tracks.',
  Weather: 'Moving radar and Doppler winds.',
  Notes: 'Notes pinned to places, satellites and maps, shared with your team.',
  Findings: 'Saved views with a note, which you can share by link.',
};

const schemas = {
  Error: { type: 'object', properties: { error: { type: 'string', description: 'A message you can show to a person.' } }, required: ['error'] },
  Me: { type: 'object', properties: {
    workspace: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
    plan: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' } } },
    key: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
    quota: { type: 'object', properties: { period: { type: 'string' }, used: { type: 'integer' }, limit: { type: ['integer', 'null'] } } },
  } },
  MapSummary: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: ['string', 'null'] }, style: { type: 'string' }, visibility: { type: 'string' }, updated_at: { type: 'string', format: 'date-time' }, layer_count: { type: 'integer' } } },
  FeatureCollection: { type: 'object', properties: { type: { const: 'FeatureCollection' }, truncated: { type: 'boolean' }, features: { type: 'array', items: { type: 'object' } } } },
  SatellitePosition: { type: 'object', properties: { norad: { type: 'integer' }, name: { type: 'string' }, time: { type: 'string', format: 'date-time' }, lon: { type: 'number' }, lat: { type: 'number' }, altKm: { type: 'number' }, speedKmS: { type: 'number' }, periodMin: { type: 'number' }, tle: { type: 'array', items: { type: 'string' } } } },
};

const ERR = (d) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });

export function openapi(serverUrl) {
  const paths = {};
  for (const [method, path, tag, summary, d = {}] of ENDPOINTS) {
    const op = { operationId: d.op, tags: [tag], summary };
    if (d.desc) op.description = d.desc;
    if (d.params) op.parameters = d.params;
    if (d.body) op.requestBody = { required: true, content: { 'application/json': { schema: { type: 'object' }, example: d.body } } };
    if (d.upload) op.requestBody = { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, name: { type: 'string' } }, required: ['file'] } } } };
    const ok = method === 'post' && !/duplicate|reset|positions/.test(path) ? '201' : '200';
    op.responses = {
      [ok]: d.raw ? { description: 'A file.' } : { description: 'OK', content: { 'application/json': { schema: d.returns || { type: 'object' } } } },
      400: ERR('Something in the request needs fixing; the message says what.'),
      401: ERR('No API key, or the key was revoked.'),
      402: ERR('Your plan doesn\'t include this, or a plan limit was reached.'),
      404: ERR('Not found in this workspace.'),
      429: ERR('Too many calls. See the X-Quota headers.'),
    };
    (paths[path] ||= {})[method] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'IoBeacons API',
      version: '1.0.0',
      description: 'Maps, live data, devices, alerts, satellites and weather for the IoBeacons platform. Send your API key as a bearer token. Errors come back as JSON with an error message you can show to a person.',
      contact: { name: 'IoBeacons', url: 'https://iobeacons.com/contact/' },
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    tags: Object.entries(TAGS).map(([name, description]) => ({ name, description })),
    paths,
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'iobm_…', description: 'Create a key in Maps under Settings → API keys.' } },
      schemas,
    },
  };
}
