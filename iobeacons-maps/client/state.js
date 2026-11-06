// Shared app state and a tiny event bus.
export const state = {
  session: null,          // /api/session
  mapRec: null,           // current saved map with layers
  maps: [],
  catalog: [],
  sites: { type: 'FeatureCollection', features: [] },
  zones: { type: 'FeatureCollection', features: [] },
  devices: { type: 'FeatureCollection', features: [], devices: [] },
  system: { sites: true, zones: true, devices: true },
  mode3d: false,
  globe: false,
  shareToken: null,       // set when viewing a shared map without signing in
  embed: false,
  activeLayerId: null,    // where drawn shapes are saved
};

const listeners = new Map();
export function on(evt, fn) { (listeners.get(evt) || listeners.set(evt, new Set()).get(evt)).add(fn); return () => listeners.get(evt).delete(fn); }
export function emit(evt, data) { for (const fn of listeners.get(evt) || []) { try { fn(data); } catch (e) { console.error(e); } } }

export const can = (feature) => Boolean(state.session?.plan?.features?.[feature]);
export const isEditor = () => !state.shareToken && ['editor', 'owner'].includes(state.session?.role);
export const isOwner = () => state.session?.role === 'owner' && !state.session?.demo;
