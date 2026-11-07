// IoBeacons API client 1.0.0. Generated from the API description; do not edit by hand.
// Docs: https://iobeacons.com/developers/api/
//
//   import { IoBeacons } from './iobeacons.mjs';
//   const io = new IoBeacons(process.env.IOBEACONS_API_KEY);
//   await io.sendPositions('truck-12', { lon: -95.99, lat: 36.15, speed_mph: 34 });
//   const iss = await io.satellitePosition(25544);

export const VERSION = '1.0.0';
const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thrown for any answer that is not a success. message is safe to show a person. */
export class IoBeaconsError extends Error {
  constructor(status, message, body) { super(message); this.name = 'IoBeaconsError'; this.status = status; this.body = body; }
}

export class IoBeacons {
  /**
   * @param {string} apiKey  Your key (iobm_...). Create one in Maps under Settings, API keys.
   * @param {{ baseUrl?: string, retries?: number, fetch?: typeof fetch }} [options]
   */
  constructor(apiKey, options = {}) {
    if (!apiKey || !String(apiKey).startsWith('iobm_')) throw new Error('IoBeacons: pass your API key (it starts with iobm_).');
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl || 'https://iobeacons.com/maps/api/v1').replace(/\/$/, '');
    this.retries = options.retries ?? 2;
    this._fetch = options.fetch || globalThis.fetch.bind(globalThis);
    /** Quota from the last answer: { limit, remaining, period }. */
    this.quota = null;
  }

  /** Call any endpoint. path is relative to the API root, for example '/maps'. */
  async request(method, path, { body, query, raw = false, form } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${this.apiKey}`, 'X-Client': `iobeacons-js/${VERSION}` };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    for (let attempt = 0; ; attempt++) {
      let res;
      try { res = await this._fetch(url, { method, headers, body: payload }); } catch (e) {
        if (attempt < this.retries && method === 'GET') { await sleep(500 * 2 ** attempt); continue; }
        throw new IoBeaconsError(0, `Could not reach IoBeacons: ${e.message}`);
      }
      const limit = res.headers.get('x-quota-limit');
      if (limit) this.quota = { limit: Number(limit), remaining: Number(res.headers.get('x-quota-remaining')), period: res.headers.get('x-quota-period') };
      const retryable = res.status === 429 || res.status === 502 || res.status === 503;
      if (retryable && attempt < this.retries && (method === 'GET' || res.status === 429) && res.headers.get('x-quota-remaining') !== '0') {
        await sleep(1000 * 2 ** attempt); continue;
      }
      if (!res.ok) {
        let data = null; try { data = await res.json(); } catch { /* not JSON */ }
        throw new IoBeaconsError(res.status, data?.error || `IoBeacons answered ${res.status}`, data);
      }
      if (raw) return res.arrayBuffer();
      return (res.headers.get('content-type') || '').includes('json') ? res.json() : res.text();
    }
  }

  _upload(path, file, name) {
    const form = new FormData();
    const ext = { 'application/json': 'geojson', 'application/geo+json': 'geojson', 'text/csv': 'csv', 'application/vnd.google-earth.kml+xml': 'kml', 'application/gpx+xml': 'gpx', 'application/zip': 'zip' }[file.type] || 'geojson';
    form.append('file', file, file.name || `upload.${ext}`);
    if (name) form.append('name', name);
    return this.request('POST', path, { form });
  }

  /** Who this key belongs to. GET /me
   */
  me() { return this.request('GET', `/me`); }

  /** Usage this month. GET /usage
   */
  usage() { return this.request('GET', `/usage`); }

  /** List maps. GET /maps
   */
  listMaps() { return this.request('GET', `/maps`); }

  /** Create a map. POST /maps
   *  @example io.createMap({"name":"Fleet yard","style":"streets","view":{"center":[-95.99,36.15],"zoom":11}})
   */
  createMap(body) { return this.request('POST', `/maps`, { body }); }

  /** Get a map with its layers. GET /maps/{id}
   */
  getMap(id) { return this.request('GET', `/maps/${enc(id)}`); }

  /** Change a map. PATCH /maps/{id}
   *  @example io.updateMap('id', {"name":"Fleet yard (north)","visibility":"link"})
   */
  updateMap(id, body) { return this.request('PATCH', `/maps/${enc(id)}`, { body }); }

  /** Delete a map. DELETE /maps/{id}
   */
  deleteMap(id) { return this.request('DELETE', `/maps/${enc(id)}`); }

  /** Copy a map. POST /maps/{id}/duplicate
   */
  duplicateMap(id) { return this.request('POST', `/maps/${enc(id)}/duplicate`); }

  /** Make a new share link. POST /maps/{id}/share/reset
   */
  resetShareLink(id) { return this.request('POST', `/maps/${enc(id)}/share/reset`); }

  /** Upload a file as a new layer. POST /maps/{id}/upload
   */
  uploadFile(id, file, name) { return this._upload(`/maps/${enc(id)}/upload`, file, name); }

  /** Add a layer. POST /maps/{id}/layers
   *  @example io.createLayer('id', {"name":"Depots","style":{"color":"#2876ee","radius":6}})
   */
  createLayer(id, body) { return this.request('POST', `/maps/${enc(id)}/layers`, { body }); }

  /** Change a layer. PATCH /layers/{id}
   *  @example io.updateLayer('id', {"name":"Depots","visible":true,"style":{"color":"#d9781a"}})
   */
  updateLayer(id, body) { return this.request('PATCH', `/layers/${enc(id)}`, { body }); }

  /** Delete a layer. DELETE /layers/{id}
   */
  deleteLayer(id) { return this.request('DELETE', `/layers/${enc(id)}`); }

  /** Download a layer. GET /layers/{id}/export.{format}
   */
  exportLayer(id, format) { return this.request('GET', `/layers/${enc(id)}/export.${enc(format)}`, { raw: true }); }

  /** Vector tiles. GET /tiles/{layerId}/{z}/{x}/{y}.pbf
   */
  layerTile(layerId, z, x, y) { return this.request('GET', `/tiles/${enc(layerId)}/${enc(z)}/${enc(x)}/${enc(y)}.pbf`, { raw: true }); }

  /** Read features. GET /layers/{id}/features
   *  query: bbox
   */
  listFeatures(id, query = {}) { return this.request('GET', `/layers/${enc(id)}/features`, { query }); }

  /** Add features. POST /layers/{id}/features
   *  @example io.addFeatures('id', {"type":"Feature","geometry":{"type":"Point","coordinates":[-95.99,36.15]},"properties":{"name":"Depot 4"}})
   */
  addFeatures(id, body) { return this.request('POST', `/layers/${enc(id)}/features`, { body }); }

  /** Change a feature. PATCH /features/{id}
   *  @example io.updateFeature('id', {"properties":{"name":"Depot 4 (closed)"}})
   */
  updateFeature(id, body) { return this.request('PATCH', `/features/${enc(id)}`, { body }); }

  /** Delete a feature. DELETE /features/{id}
   */
  deleteFeature(id) { return this.request('DELETE', `/features/${enc(id)}`); }

  /** List sites. GET /sites
   */
  listSites() { return this.request('GET', `/sites`); }

  /** Add a site. POST /sites
   *  @example io.createSite({"name":"Tulsa yard","address":"1 W 3rd St, Tulsa, OK"})
   */
  createSite(body) { return this.request('POST', `/sites`, { body }); }

  /** Change a site. PATCH /sites/{id}
   *  @example io.updateSite('id', {"name":"Tulsa yard (main)"})
   */
  updateSite(id, body) { return this.request('PATCH', `/sites/${enc(id)}`, { body }); }

  /** Delete a site. DELETE /sites/{id}
   */
  deleteSite(id) { return this.request('DELETE', `/sites/${enc(id)}`); }

  /** List zones. GET /zones
   */
  listZones() { return this.request('GET', `/zones`); }

  /** Add a zone. POST /zones
   *  @example io.createZone({"name":"Yard","circle":{"lon":-95.99,"lat":36.15,"radius_m":300}})
   */
  createZone(body) { return this.request('POST', `/zones`, { body }); }

  /** Change a zone. PATCH /zones/{id}
   *  @example io.updateZone('id', {"name":"Main yard","color":"#d9781a"})
   */
  updateZone(id, body) { return this.request('PATCH', `/zones/${enc(id)}`, { body }); }

  /** Delete a zone. DELETE /zones/{id}
   */
  deleteZone(id) { return this.request('DELETE', `/zones/${enc(id)}`); }

  /** List devices. GET /devices
   */
  listDevices() { return this.request('GET', `/devices`); }

  /** Add a device. POST /devices
   *  @example io.createDevice({"name":"Truck 12","external_id":"truck-12","kind":"vehicle"})
   */
  createDevice(body) { return this.request('POST', `/devices`, { body }); }

  /** Delete a device. DELETE /devices/{id}
   */
  deleteDevice(id) { return this.request('DELETE', `/devices/${enc(id)}`); }

  /** Send positions. POST /devices/{ref}/positions
   *  @example io.sendPositions('ref', {"lon":-95.99,"lat":36.15,"speed_mph":34,"heading":90})
   */
  sendPositions(ref, body) { return this.request('POST', `/devices/${enc(ref)}/positions`, { body }); }

  /** A device's trail. GET /devices/{id}/track
   *  query: hours
   */
  deviceTrack(id, query = {}) { return this.request('GET', `/devices/${enc(id)}/track`, { query }); }

  /** List alert rules. GET /rules
   */
  listRules() { return this.request('GET', `/rules`); }

  /** Add an alert rule. POST /rules
   *  @example io.createRule({"name":"Truck left the yard","trigger":{"type":"zone_exit","zone_id":"00000000-0000-0000-0000-000000000000"},"channels":{"emails":["ops@example.com"],"webhooks":["https://example.com/hooks/iobeacons"]}})
   */
  createRule(body) { return this.request('POST', `/rules`, { body }); }

  /** Change an alert rule. PATCH /rules/{id}
   *  @example io.updateRule('id', {"enabled":false})
   */
  updateRule(id, body) { return this.request('PATCH', `/rules/${enc(id)}`, { body }); }

  /** Delete an alert rule. DELETE /rules/{id}
   */
  deleteRule(id) { return this.request('DELETE', `/rules/${enc(id)}`); }

  /** Recent alerts. GET /alerts
   */
  listAlerts() { return this.request('GET', `/alerts`); }

  /** Make a site report. POST /reports
   *  @example io.createReport({"lon":-95.99,"lat":36.15,"radius_mi":1})
   */
  createReport(body) { return this.request('POST', `/reports`, { body }); }

  /** List reports. GET /reports
   */
  listReports() { return this.request('GET', `/reports`); }

  /** Get a report. GET /reports/{id}
   */
  getReport(id) { return this.request('GET', `/reports/${enc(id)}`); }

  /** Download a report as PDF. GET /reports/{id}/pdf
   */
  reportPdf(id) { return this.request('GET', `/reports/${enc(id)}/pdf`, { raw: true }); }

  /** List live data layers. GET /catalog
   */
  listCatalog() { return this.request('GET', `/catalog`); }

  /** Read a live data layer. GET /catalog/{key}/data
   *  query: bbox
   */
  catalogData(key, query = {}) { return this.request('GET', `/catalog/${enc(key)}/data`, { query }); }

  /** Look up an address. GET /geocode
   *  query: q
   */
  geocode(query = {}) { return this.request('GET', `/geocode`, { query }); }

  /** List satellite groups. GET /space
   */
  spaceGroups() { return this.request('GET', `/space`); }

  /** Orbital elements for a group. GET /space/{group}
   */
  spaceGroup(group) { return this.request('GET', `/space/${enc(group)}`); }

  /** Where a whole group is. GET /space/{group}/positions
   *  query: time
   */
  spaceGroupPositions(group, query = {}) { return this.request('GET', `/space/${enc(group)}/positions`, { query }); }

  /** Where one object is. GET /space/objects/{norad}/position
   *  query: time
   */
  satellitePosition(norad, query = {}) { return this.request('GET', `/space/objects/${enc(norad)}/position`, { query }); }

  /** Ground track. GET /space/objects/{norad}/track
   *  query: time, minutes, step
   */
  satelliteTrack(norad, query = {}) { return this.request('GET', `/space/objects/${enc(norad)}/track`, { query }); }

  /** Catalogue record. GET /space/info/{norad}
   */
  satelliteInfo(norad) { return this.request('GET', `/space/info/${enc(norad)}`); }

  /** Radar loop frames. GET /weather/radar-frames
   *  query: source
   */
  radarFrames(query = {}) { return this.request('GET', `/weather/radar-frames`, { query }); }

  /** Doppler winds near a point. GET /weather/doppler
   *  query: lon, lat
   */
  doppler(query = {}) { return this.request('GET', `/weather/doppler`, { query }); }

  /** List notes. GET /notes
   *  query: map_id, norad
   */
  listNotes(query = {}) { return this.request('GET', `/notes`, { query }); }

  /** Add a note. POST /notes
   *  @example io.createNote({"body":"Gate 3 floods after heavy rain.","target":{"kind":"place","lng":-95.99,"lat":36.15}})
   */
  createNote(body) { return this.request('POST', `/notes`, { body }); }

  /** Change a note. PATCH /notes/{id}
   *  @example io.updateNote('id', {"body":"Gate 3 floods after heavy rain. Use gate 4."})
   */
  updateNote(id, body) { return this.request('PATCH', `/notes/${enc(id)}`, { body }); }

  /** Delete a note. DELETE /notes/{id}
   */
  deleteNote(id) { return this.request('DELETE', `/notes/${enc(id)}`); }

  /** List findings. GET /findings
   */
  listFindings() { return this.request('GET', `/findings`); }

  /** Save a finding. POST /findings
   *  @example io.createFinding({"title":"Storm cell over the north yard","note":"Moving east at 30 mph.","kind":"map","view":{"center":[-95.99,36.15],"zoom":9},"share":true})
   */
  createFinding(body) { return this.request('POST', `/findings`, { body }); }

  /** Change a finding. PATCH /findings/{id}
   *  @example io.updateFinding('id', {"share":false})
   */
  updateFinding(id, body) { return this.request('PATCH', `/findings/${enc(id)}`, { body }); }

  /** Delete a finding. DELETE /findings/{id}
   */
  deleteFinding(id) { return this.request('DELETE', `/findings/${enc(id)}`); }
}

export default IoBeacons;
