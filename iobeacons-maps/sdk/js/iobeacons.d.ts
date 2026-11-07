// Types for the IoBeacons API client 1.0.0.
export declare const VERSION: string;
export declare class IoBeaconsError extends Error { status: number; body: unknown; }
type Q = Record<string, string | number | boolean | undefined>;
export declare class IoBeacons {
  constructor(apiKey: string, options?: { baseUrl?: string; retries?: number; fetch?: typeof fetch });
  apiKey: string; baseUrl: string; retries: number;
  quota: { limit: number; remaining: number; period: string } | null;
  request<T = any>(method: string, path: string, opts?: { body?: unknown; query?: Q; raw?: boolean; form?: FormData }): Promise<T>;
  /** Who this key belongs to */
  me(): Promise<any>;
  /** Usage this month */
  usage(): Promise<any>;
  /** List maps */
  listMaps(): Promise<any>;
  /** Create a map */
  createMap(body: Record<string, unknown>): Promise<any>;
  /** Get a map with its layers */
  getMap(id: string | number): Promise<any>;
  /** Change a map */
  updateMap(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Delete a map */
  deleteMap(id: string | number): Promise<any>;
  /** Copy a map */
  duplicateMap(id: string | number): Promise<any>;
  /** Make a new share link */
  resetShareLink(id: string | number): Promise<any>;
  /** Upload a file as a new layer */
  uploadFile(id: string | number, file: Blob, name?: string): Promise<any>;
  /** Add a layer */
  createLayer(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Change a layer */
  updateLayer(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Delete a layer */
  deleteLayer(id: string | number): Promise<any>;
  /** Download a layer */
  exportLayer(id: string | number, format: string | number): Promise<ArrayBuffer>;
  /** Vector tiles */
  layerTile(layerId: string | number, z: string | number, x: string | number, y: string | number): Promise<ArrayBuffer>;
  /** Read features */
  listFeatures(id: string | number, query?: { bbox?: string | number }): Promise<any>;
  /** Add features */
  addFeatures(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Change a feature */
  updateFeature(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Delete a feature */
  deleteFeature(id: string | number): Promise<any>;
  /** List sites */
  listSites(): Promise<any>;
  /** Add a site */
  createSite(body: Record<string, unknown>): Promise<any>;
  /** Change a site */
  updateSite(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Delete a site */
  deleteSite(id: string | number): Promise<any>;
  /** List zones */
  listZones(): Promise<any>;
  /** Add a zone */
  createZone(body: Record<string, unknown>): Promise<any>;
  /** Change a zone */
  updateZone(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Delete a zone */
  deleteZone(id: string | number): Promise<any>;
  /** List devices */
  listDevices(): Promise<any>;
  /** Add a device */
  createDevice(body: Record<string, unknown>): Promise<any>;
  /** Delete a device */
  deleteDevice(id: string | number): Promise<any>;
  /** Send positions */
  sendPositions(ref: string | number, body: Record<string, unknown>): Promise<any>;
  /** A device's trail */
  deviceTrack(id: string | number, query?: { hours?: string | number }): Promise<any>;
  /** List alert rules */
  listRules(): Promise<any>;
  /** Add an alert rule */
  createRule(body: Record<string, unknown>): Promise<any>;
  /** Change an alert rule */
  updateRule(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Delete an alert rule */
  deleteRule(id: string | number): Promise<any>;
  /** Recent alerts */
  listAlerts(): Promise<any>;
  /** Make a site report */
  createReport(body: Record<string, unknown>): Promise<any>;
  /** List reports */
  listReports(): Promise<any>;
  /** Get a report */
  getReport(id: string | number): Promise<any>;
  /** Download a report as PDF */
  reportPdf(id: string | number): Promise<ArrayBuffer>;
  /** List live data layers */
  listCatalog(): Promise<any>;
  /** Read a live data layer */
  catalogData(key: string | number, query?: { bbox?: string | number }): Promise<any>;
  /** Look up an address */
  geocode(query?: { q?: string | number }): Promise<any>;
  /** List satellite groups */
  spaceGroups(): Promise<any>;
  /** Orbital elements for a group */
  spaceGroup(group: string | number): Promise<any>;
  /** Where a whole group is */
  spaceGroupPositions(group: string | number, query?: { time?: string | number }): Promise<any>;
  /** Where one object is */
  satellitePosition(norad: string | number, query?: { time?: string | number }): Promise<any>;
  /** Ground track */
  satelliteTrack(norad: string | number, query?: { time?: string | number; minutes?: string | number; step?: string | number }): Promise<any>;
  /** Recordings by ground stations */
  satelliteHeard(norad: string | number): Promise<any>;
  /** Check our positions */
  checkIss(): Promise<any>;
  /** Catalogue record */
  satelliteInfo(norad: string | number): Promise<any>;
  /** Radar loop frames */
  radarFrames(query?: { source?: string | number }): Promise<any>;
  /** Doppler winds near a point */
  doppler(query?: { lon?: string | number; lat?: string | number }): Promise<any>;
  /** List notes */
  listNotes(query?: { map_id?: string | number; norad?: string | number }): Promise<any>;
  /** Add a note */
  createNote(body: Record<string, unknown>): Promise<any>;
  /** Change a note */
  updateNote(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Delete a note */
  deleteNote(id: string | number): Promise<any>;
  /** List findings */
  listFindings(): Promise<any>;
  /** Save a finding */
  createFinding(body: Record<string, unknown>): Promise<any>;
  /** Change a finding */
  updateFinding(id: string | number, body: Record<string, unknown>): Promise<any>;
  /** Delete a finding */
  deleteFinding(id: string | number): Promise<any>;
}
export default IoBeacons;
