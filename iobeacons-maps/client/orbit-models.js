// Close-up 3D models for the object picked in the live orbits view.
// Real NASA models where we have them (public domain glTF), shapes modelled
// from published descriptions for the big families, and an honest generic
// shape for everything else. The panel always says which one it is.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...extra });
const mats = () => ({
  cell: M(0x1a3a66, { roughness: 0.3, metalness: 0.6 }),
  gold: M(0xc9a227, { roughness: 0.35, metalness: 0.8 }),
  foil: M(0xd8dde4, { roughness: 0.25, metalness: 0.85 }),
  white: M(0xeef2f6, { roughness: 0.7, metalness: 0.05 }),
  metal: M(0xb9c4d0, { roughness: 0.4, metalness: 0.7 }),
  dark: M(0x2b3a4a, { roughness: 0.6, metalness: 0.3 }),
});
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (r1, r2, len, m, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), m);
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
const rotX = (o) => { o.rotation.x = Math.PI / 2; return o; };
const rotZ = (o) => { o.rotation.z = Math.PI / 2; return o; };

// Model axes: x = across, y = away from Earth, z = direction of travel.

function iss() {
  const m = mats(), g = new THREE.Group();
  // Integrated truss across the station, with four pairs of big arrays at each end.
  g.add(box(11, 0.32, 0.32, m.metal));
  for (const sx of [-1, 1]) {
    for (const off of [3.6, 4.9]) {
      for (const sz of [-1, 1]) {
        const w = box(0.95, 0.03, 3.3, M(0xb07a2a, { roughness: 0.35, metalness: 0.6 }));
        g.add(at(w, sx * off, 0, sz * 1.85));
        g.add(at(box(0.08, 0.08, 3.3, m.metal), sx * off, 0.02, sz * 1.85));
      }
    }
    // Radiators hanging below the truss.
    g.add(at(box(1.6, 0.03, 1.1, m.white), sx * 1.7, -0.9, 0));
  }
  // Pressurised modules along the direction of travel.
  g.add(at(rotX(cyl(0.42, 0.42, 6.2, m.white)), 0, -0.6, 0.4));
  g.add(at(rotZ(cyl(0.4, 0.4, 2.2, m.white)), 0, -0.6, 2.6));      // Harmony with Columbus / Kibo
  g.add(at(rotZ(cyl(0.45, 0.45, 1.4, m.white)), 1.7, -0.6, 2.6));  // Kibo
  g.add(at(rotX(cyl(0.38, 0.38, 3.2, m.white)), 0, -0.6, -4.0));   // Russian segment
  for (const sx of [-1, 1]) g.add(at(box(2.6, 0.03, 0.7, m.cell), sx * 1.9, -0.6, -3.6));
  g.add(at(box(0.8, 0.03, 0.6, m.gold), 0, -1.1, 0.4));
  return g;
}

function hubble() {
  const m = mats(), g = new THREE.Group();
  g.add(rotX(cyl(0.7, 0.7, 4.2, m.foil, 28)));
  g.add(at(rotX(cyl(0.72, 0.72, 0.5, m.dark, 28)), 0, 0, -1.9));
  const door = box(1.4, 0.04, 1.4, m.foil); door.rotation.x = -0.9; g.add(at(door, 0, 0.55, 2.55));
  for (const sx of [-1, 1]) {
    g.add(at(rotZ(cyl(0.04, 0.04, 0.6, m.metal, 8)), sx * 1.0, 0, 0.2));
    g.add(at(box(0.04, 0.85, 3.6, m.cell), sx * 1.35, 0, 0.2));
  }
  g.add(at(cyl(0.05, 0.05, 1.1, m.metal, 8), 0, 0.95, -0.8));
  return g;
}

function tiangong() {
  const m = mats(), g = new THREE.Group();
  g.add(rotX(cyl(0.6, 0.6, 4.6, m.white)));                         // Tianhe core
  g.add(at(rotZ(cyl(0.55, 0.55, 4.4, m.white)), 2.8, 0, 2.0));        // Wentian
  g.add(at(rotZ(cyl(0.55, 0.55, 4.4, m.white)), -2.8, 0, 2.0));       // Mengtian
  g.add(at(box(1.2, 1.2, 1.2, m.white), 0, 0, 2.0));                  // node
  for (const sx of [-1, 1]) {
    g.add(at(box(0.9, 0.03, 6.4, m.cell), sx * 5.4, 0, 2.0));
    g.add(at(box(2.6, 0.03, 0.9, m.cell), sx * 1.9, 0, -1.6));
  }
  return g;
}

function gnss() {
  const m = mats(), g = new THREE.Group();
  g.add(box(1.2, 1.2, 1.4, m.gold));
  g.add(at(box(1.0, 0.08, 1.0, m.white), 0, -0.64, 0));
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.add(at(cyl(0.06, 0.06, 0.3, m.metal, 6), Math.cos(a) * 0.35, -0.82, Math.sin(a) * 0.35)); }
  for (const sx of [-1, 1]) {
    g.add(at(rotZ(cyl(0.05, 0.05, 0.8, m.metal, 6)), sx * 1.0, 0, 0));
    g.add(at(box(2.6, 0.04, 1.4, m.cell), sx * 2.7, 0, 0));
  }
  return g;
}

function geo() {
  const m = mats(), g = new THREE.Group();
  g.add(box(1.6, 1.6, 2.0, m.gold));
  const prof = []; for (let i = 0; i <= 10; i++) { const r = i / 10 * 0.9; prof.push(new THREE.Vector2(r, r * r * 0.5)); }
  for (const sz of [-1, 1]) { const d = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), m.white); d.rotation.x = Math.PI + sz * 0.5; g.add(at(d, 0, -1.0, sz * 0.7)); }
  for (const sx of [-1, 1]) {
    g.add(at(rotZ(cyl(0.05, 0.05, 1.2, m.metal, 6)), sx * 1.4, 0, 0));
    for (let k = 0; k < 4; k++) g.add(at(box(1.5, 0.04, 1.7, m.cell), sx * (2.8 + k * 1.6), 0, 0));
  }
  return g;
}

function starlink() {
  const m = mats(), g = new THREE.Group();
  g.add(box(1.7, 0.16, 1.05, M(0x9aa6b4)));
  g.add(at(box(1.5, 0.04, 0.9, m.cell), 0, -0.11, 0));
  for (const dx of [-0.5, 0.5]) for (const dz of [-0.3, 0.3]) g.add(at(cyl(0.05, 0.07, 0.16, m.metal, 8), dx, 0.14, dz));
  g.add(at(rotZ(cyl(0.05, 0.05, 1.6, m.metal, 8)), 0, 0.06, 0.58));
  for (let i = 0; i < 8; i++) { g.add(at(box(1.6, 0.035, 0.78, m.cell), 0, 0.08, 0.55 + 0.41 + i * 0.82)); g.add(at(box(1.62, 0.055, 0.05, m.metal), 0, 0.08, 0.55 + 0.82 + i * 0.82)); }
  return g;
}

function cubesat() {
  const m = mats(), g = new THREE.Group();
  g.add(box(0.45, 0.45, 1.3, m.metal));
  for (const sx of [-1, 1]) g.add(at(box(1.15, 0.03, 1.2, m.cell), sx * 0.82, 0, 0));
  return g;
}

function flatPanel(wings, len) {
  const m = mats(), g = new THREE.Group();
  g.add(box(1.55, 0.14, 1.0, M(0x9aa6b4)));
  g.add(at(box(1.35, 0.04, 0.85, m.cell), 0, -0.1, 0));
  for (const sz of wings === 2 ? [-1, 1] : [1]) {
    g.add(at(rotZ(cyl(0.045, 0.045, 1.45, m.metal, 8)), 0, 0.05, sz * 0.55));
    for (let i = 0; i < len; i++) g.add(at(box(1.45, 0.033, 0.72, m.cell), 0, 0.07, sz * (0.52 + 0.38 + i * 0.76)));
  }
  return g;
}

function skysat() {
  const m = mats(), g = new THREE.Group();
  g.add(box(0.7, 0.7, 0.95, m.gold));
  g.add(at(cyl(0.26, 0.26, 0.85, m.metal, 14), 0, -0.7, 0));
  g.add(at(cyl(0.33, 0.27, 0.3, m.dark, 14), 0, -1.2, 0));
  for (const sx of [-1, 1]) g.add(at(box(1.0, 0.035, 0.75, m.cell), sx * 0.88, 0, 0));
  return g;
}

function iridium() {
  const m = mats(), g = new THREE.Group();
  g.add(box(1.15, 0.95, 1.45, m.gold));
  g.add(at(box(1.45, 0.09, 1.75, M(0x9fb3c8)), 0, -0.55, 0));
  for (const dz of [-0.55, 0, 0.55]) g.add(at(box(0.5, 0.07, 0.36, m.metal), 0, -0.63, dz));
  for (const sx of [-1, 1]) {
    g.add(at(rotZ(cyl(0.05, 0.05, 0.5, m.metal, 6)), sx * 0.78, 0, 0));
    const w = at(box(1.75, 0.05, 1.05, m.cell), sx * 1.9, 0, 0); w.rotation.x = sx * 0.28; g.add(w);
  }
  return g;
}

function oneweb() {
  const m = mats(), g = new THREE.Group();
  g.add(box(0.6, 0.6, 0.8, m.white));
  for (const sx of [-1, 1]) {
    g.add(at(rotZ(cyl(0.04, 0.04, 0.55, m.metal, 6)), sx * 0.55, 0, 0));
    for (let k = 0; k < 2; k++) g.add(at(box(1.5, 0.035, 0.46, m.cell), sx * (1.55 + k * 1.55), 0, 0));
  }
  return g;
}

function bus(wings = 3) {
  const m = mats(), g = new THREE.Group();
  g.add(box(1.0, 1.1, 1.3, m.metal));
  g.add(at(box(1.04, 0.34, 1.34, m.gold), 0, -0.52, 0));
  for (const sx of [-1, 1]) {
    g.add(at(rotZ(cyl(0.05, 0.05, 1.2 + wings * 1.1, m.metal, 6)), sx * (0.6 + wings * 0.55), 0, 0));
    for (let k = 0; k < wings; k++) { g.add(at(box(1.0, 0.05, 1.15, m.cell), sx * (1.15 + k * 1.1), 0, 0)); g.add(at(box(1.0, 0.09, 0.05, m.metal), sx * (1.15 + k * 1.1), 0, 0)); }
  }
  const prof = []; for (let i = 0; i <= 10; i++) { const r = i / 10 * 0.5; prof.push(new THREE.Vector2(r, r * r * 1.1)); }
  const dish = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), m.white); dish.rotation.x = Math.PI; g.add(at(dish, 0, -0.95, 0));
  g.add(at(cyl(0.03, 0.03, 0.9, m.metal, 6), 0, 0.95, 0));
  return g;
}

function rocketBody() {
  const m = mats(), g = new THREE.Group();
  g.add(rotX(cyl(0.55, 0.55, 2.1, m.white)));
  for (const sz of [-1, 1]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.white); d.rotation.x = sz > 0 ? Math.PI / 2 : -Math.PI / 2; g.add(at(d, 0, 0, sz * 1.05)); }
  g.add(at(rotX(cyl(0.6, 0.6, 0.22, m.dark)), 0, 0, 0.35));
  const bell = []; for (let i = 0; i <= 12; i++) { const t = i / 12; bell.push(new THREE.Vector2(0.16 + Math.pow(t, 1.7) * 0.46, t * 0.85)); }
  const n = new THREE.Mesh(new THREE.LatheGeometry(bell, 20), m.metal); n.rotation.x = -Math.PI / 2; g.add(at(n, 0, 0, -1.35));
  return g;
}

function fragment(seedFrom = 7) {
  const geo = new THREE.IcosahedronGeometry(0.9, 1);
  const p = geo.attributes.position;
  // Same corner, same stretch, so the faces stay joined.
  const seed = (seedFrom % 997) + 1;
  const stretch = (x, y, z) => { const v = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719 + seed) * 43758.5453; return 0.55 + (v - Math.floor(v)) * 0.9; };
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = stretch(x, y, z); p.setXYZ(i, x * k * 1.3, y * k * 0.45, z * k); }
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, M(0xb8c0c9, { flatShading: true, roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide })));
  return g;
}

// What each common object is for, in plain words.
const ABOUT = [
  [/^ISS\b/, 'The International Space Station, home to a crew of about seven. Built by the US, Russia, Europe, Japan and Canada, it is the largest object in orbit, about the size of a football field.'],
  [/^(CSS|TIANHE|TIANGONG)/, 'China\'s Tiangong space station, with a crew of three. Its core module Tianhe launched in 2021.'],
  [/^(HST|HUBBLE)/, 'The Hubble Space Telescope, launched in 1990. It has taken some of the most famous pictures of deep space.'],
  [/^NOAA \d/, 'A US polar weather satellite. It circles over the poles, scanning the whole Earth twice a day for forecasts.'],
  [/^FENGYUN \d[A-Z]?$/, 'A Chinese Fengyun weather satellite, watching clouds, storms and sea temperatures.'],
  [/^(METOP|METEOR)/, 'A polar-orbiting weather satellite (MetOp from Europe, Meteor from Russia) used for forecasts.'],
  [/^(SUOMI NPP|JPSS|NOAA 2\d)/, 'A US polar weather satellite (NOAA and NASA) used in daily forecasts.'],
  [/^GOES/, 'A US geostationary weather satellite. It stays over one spot on the equator and watches storms across the Americas.'],
  [/^(METEOSAT|MSG|MTG)/, 'A European geostationary weather satellite watching Europe and Africa.'],
  [/^HIMAWARI/, 'A Japanese geostationary weather satellite watching Asia and the Pacific.'],
  [/^LANDSAT/, 'A Landsat Earth-observation satellite (NASA and USGS). Landsat has photographed the land since 1972 for farming, forests and cities.'],
  [/^SENTINEL/, 'A Copernicus Sentinel satellite from the European Union, watching land, sea and air quality.'],
  [/^(GPS|NAVSTAR)/, 'A GPS navigation satellite. About 31 of them let any phone or receiver work out where it is.'],
  [/^(COSMOS 2\d{3} \(GLONASS|GLONASS)/, 'A GLONASS navigation satellite, Russia\'s version of GPS.'],
  [/^GSAT0|^GALILEO/, 'A Galileo navigation satellite, Europe\'s version of GPS.'],
  [/^BEIDOU/, 'A BeiDou navigation satellite, China\'s version of GPS.'],
  [/^STARLINK/, 'A SpaceX Starlink internet satellite. Thousands fly in low orbit to give broadband almost anywhere.'],
  [/^ONEWEB/, 'A OneWeb (Eutelsat) internet satellite in a high polar orbit.'],
  [/^IRIDIUM/, 'An Iridium satellite for satellite phones and messaging that work anywhere on Earth.'],
  [/^KUIPER/, 'An Amazon Project Kuiper internet satellite.'],
  [/^(TERRA|AQUA|AURA)$/, 'A NASA Earth-observing satellite measuring clouds, oceans, ice and the atmosphere.'],
  [/^(FLOCK|DOVE|SUPERDOVE)/, 'A Planet Dove, a shoebox-sized satellite that photographs the whole Earth every day.'],
  [/FENGYUN 1C DEB/, 'A piece of the Fengyun-1C weather satellite, destroyed in a Chinese anti-satellite test in 2007. That test created the largest debris cloud ever recorded.'],
  [/COSMOS 2251 DEB/, 'A piece of the Cosmos 2251 satellite, which collided by accident with Iridium 33 in 2009.'],
  [/IRIDIUM 33 DEB/, 'A piece of the Iridium 33 satellite, destroyed in the 2009 collision with Cosmos 2251.'],
  [/\bDEB\b/, 'A piece of space debris: a fragment from a break-up, collision or explosion. It is tracked so working satellites can steer clear of it.'],
  [/R\/B/, 'A spent rocket stage, left in orbit after delivering its payload. It will slowly fall back and burn up.'],
];

const REAL = { 25682: { file: 'landsat-7', label: 'Landsat 7' }, 39084: { file: 'landsat-8', label: 'Landsat 8' } };
const FAMILIES = [
  [/^ISS\b/, iss, 'the International Space Station'],
  [/^(CSS|TIANHE)/, tiangong, 'the Tiangong space station'],
  [/^(HST|HUBBLE)/, hubble, 'the Hubble Space Telescope'],
  [/^STARLINK/, starlink, 'a Starlink satellite'],
  [/^ONEWEB/, oneweb, 'a OneWeb satellite'],
  [/^(FLOCK|DOVE|SUPERDOVE|LEMUR|SPIRE)/, cubesat, 'a 3U cubesat'],
  [/^IRIDIUM(?!.*DEB)/, iridium, 'an Iridium NEXT satellite'],
  [/^KUIPER/, () => flatPanel(1, 7), 'a Project Kuiper satellite'],
  [/^(QIANFAN|HULIANWANG|GUOWANG|SATNET)/, () => flatPanel(2, 5), 'a Chinese flat-panel broadband satellite'],
  [/^SKYSAT/, skysat, 'a Planet SkySat'],
  [/^(GPS|NAVSTAR|GSAT0|GALILEO|BEIDOU|GLONASS)/, gnss, 'a navigation satellite'],
];

export function aboutText(name) {
  for (const [re, t] of ABOUT) if (re.test(name)) return t;
  return null;
}

// cls: 0 satellite, 1 starlink, 2 rocket body, 3 debris, 4 unknown. altKm decides "geostationary".
export function modelChoice({ id, name, cls, altKm }) {
  if (REAL[+id]) return { kind: 'gltf', file: REAL[+id].file, note: `This is the real ${REAL[+id].label}, from NASA's public 3D model.` };
  for (const [re, build, label] of FAMILIES) if (re.test(name)) return { kind: 'built', build, note: `Shape of ${label}, modelled from published pictures and sizes.` };
  if (cls === 2) return { kind: 'gltf', file: 'agena-target-vehicle', fallback: rocketBody, note: 'A real NASA model of a similar upper stage, standing in for this rocket body. Spent stages differ in size and shape.' };
  if (cls === 3) return { kind: 'built', build: () => fragment(Number(id) || 7), note: 'A typical debris fragment. Real pieces range from paint flecks to whole broken panels; this one is tracked, so it is at least about 10 cm across.' };
  if (cls === 4) return { kind: 'built', build: () => fragment(3), note: 'This object is not identified yet, so this is a placeholder shape.' };
  if (altKm > 30000) return { kind: 'built', build: geo, note: 'A typical geostationary satellite. The exact design of this one is not in our library.' };
  return { kind: 'built', build: () => bus(3), note: 'A typical satellite shape. The exact design of this one is not in our library.' };
}

// Centre a model and scale it so its longest side is `size` scene units.
export function normalise(obj, size) {
  const b = new THREE.Box3().setFromObject(obj);
  const s = new THREE.Vector3(); b.getSize(s);
  const c = new THREE.Vector3(); b.getCenter(c);
  obj.position.sub(c);
  const holder = new THREE.Group();
  holder.add(obj);
  holder.scale.setScalar(size / (Math.max(s.x, s.y, s.z) || 1));
  const outer = new THREE.Group();
  outer.add(holder);
  return outer;
}

const cache = {};
let gltf = null;
export function loadGltf(base, file) {
  if (!gltf) {
    gltf = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${base}/vendor/draco/`);
    gltf.setDRACOLoader(draco);
  }
  cache[file] ||= new Promise((res, rej) => gltf.load(`${base}/orbit/models/${file}.glb`, (g) => res(g.scene), undefined, rej));
  return cache[file].then((scene) => scene.clone(true));
}

export function disposeModel(m) {
  if (!m) return;
  if (m.userData.shared) { m.parent?.remove(m); return; } // glTF clones share their geometry with the cache
  m.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((x) => { x.map?.dispose(); x.dispose(); }); });
  m.parent?.remove(m);
}
