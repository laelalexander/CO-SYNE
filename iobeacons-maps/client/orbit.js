// Live orbital view: every tracked satellite, rocket body and piece of debris
// drawn at its real height around a 3D Earth, moving in real time (or faster).
// Built as its own bundle (public/orbit.js) and loaded only when opened, so the
// map itself stays light.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { twoline2satrec, propagate, gstime, eciToGeodetic } from 'satellite.js';
import { modelChoice, normalise, loadGltf, disposeModel, aboutText } from './orbit-models.js';

const R = 100;            // Earth radius in scene units
const KM = 6371;          // Earth radius in km
const MU = 398600.4418;   // km^3/s^2

const CLASSES = [
  { key: 'sat', label: 'Satellites', css: '#4ea3ff', size: 9 },
  { key: 'starlink', label: 'Starlink', css: '#b9a6ff', size: 6 },
  { key: 'rb', label: 'Rocket bodies', css: '#f59e0b', size: 10 },
  { key: 'deb', label: 'Debris', css: '#ff4d4d', size: 6 },
  { key: 'unk', label: 'Unknown', css: '#94a3b8', size: 7 },
];
const GROUPS = ['stations', 'active', 'recent', 'debris-fy1c', 'debris-cosmos', 'debris-iridium'];
const RATES = [1, 10, 60, 300, 1800];

function classOf(name) {
  if (/\bDEB\b|\bCOOLANT\b|\bFRAG/.test(name)) return 3;
  if (/R\/B|\bAKM\b|\bPKM\b|\bPAM-D\b/.test(name)) return 2;
  if (/^STARLINK/.test(name)) return 1;
  if (/^(TBA|OBJECT [A-Z]{1,3}$)/.test(name)) return 4;
  return 0;
}

const rgb = (css) => { const n = parseInt(css.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const fmt = (n, d = 0) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));

// Latitude/longitude/height to the Earth-fixed scene frame used by the texture.
function toVec(lat, lon, hKm, out = new THREE.Vector3()) {
  const r = R * (1 + hKm / KM);
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

function geo(rec, when, gm = gstime(when)) {
  const pv = propagate(rec, when);
  if (!pv || !pv.position || Number.isNaN(pv.position.x)) return null;
  const g = eciToGeodetic(pv.position, gm);
  const v = pv.velocity;
  return { lat: g.latitude * 180 / Math.PI, lon: g.longitude * 180 / Math.PI, alt: g.height, speed: v ? Math.hypot(v.x, v.y, v.z) : null };
}

// Where the Sun is overhead, for the day and night sides of the Earth.
function sunDir(when) {
  const start = Date.UTC(when.getUTCFullYear(), 0, 0);
  const day = (when - start) / 864e5;
  const decl = -23.44 * Math.cos((2 * Math.PI / 365.25) * (day + 10));
  const b = 2 * Math.PI * (day - 81) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b); // minutes
  const hours = when.getUTCHours() + when.getUTCMinutes() / 60 + when.getUTCSeconds() / 3600;
  const lon = -15 * (hours - 12 + eot / 60);
  return toVec(decl, lon, 0).normalize();
}

// Small white symbols, tinted per class: a satellite with panels, a spent
// stage, a jagged fragment, a dot.
function sprite(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.strokeStyle = '#fff';
  if (kind === 0 || kind === 1) {
    x.fillRect(25, 25, 14, 14);
    x.fillRect(4, 28, 18, 8); x.fillRect(42, 28, 18, 8);
  } else if (kind === 2) {
    x.beginPath(); x.roundRect(22, 8, 20, 48, 9); x.fill();
  } else if (kind === 3) {
    x.beginPath(); x.moveTo(14, 18); x.lineTo(40, 8); x.lineTo(54, 30); x.lineTo(36, 56); x.lineTo(20, 44); x.closePath(); x.fill();
  } else {
    x.beginPath(); x.arc(32, 32, 16, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
}

let current = null;
export function orbitOpen() { return Boolean(current); }
export function closeOrbit() { current?.close(); }

// opts: { get(path) -> Promise<json>, base, onClose(), select: 'ISS' }
export async function openOrbit(opts = {}) {
  if (current) { current.focus?.(opts); return current; }
  const root = el('div', { class: 'orb', role: 'region', 'aria-label': 'Live orbital view' });
  document.body.append(root);
  const loading = el('div', { class: 'orb-loading' }, el('div', { class: 'orb-spin' }), el('p', {}, 'Loading the satellite catalogue…'));
  root.append(loading);
  const st = { alive: true, listeners: [] };
  const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); st.listeners.push([t, ev, fn, o]); };
  const close = () => {
    if (!st.alive) return;
    st.alive = false;
    cancelAnimationFrame(st.raf);
    for (const [t, ev, fn, o] of st.listeners) t.removeEventListener(ev, fn, o);
    st.ro?.disconnect();
    st.scene?.traverse((o) => { o.geometry?.dispose(); const m = o.material; if (m) { for (const v of Object.values(m.uniforms || {})) v.value?.dispose?.(); m.map?.dispose(); m.dispose(); } });
    st.ren?.dispose();
    root.remove();
    current = null;
    opts.onClose?.();
  };
  current = { close };
  listen(window, 'keydown', (e) => { if (e.key === 'Escape' && !e.target.closest?.('input')) close(); });

  // ---------- catalogue ----------
  const seen = new Set();
  const sats = [];  // { rec, name, id, cls, group }
  let done = 0;
  const p = loading.querySelector('p');
  await Promise.all(GROUPS.map(async (g) => {
    let data;
    try { data = await opts.get(`/space/${g}`); } catch { data = null; }
    done++;
    if (!st.alive || !data) return;
    for (const t of data.satellites || []) {
      const id = t.l1.slice(2, 7).trim();
      if (seen.has(id)) continue;
      let rec;
      try { rec = twoline2satrec(t.l1, t.l2); } catch { continue; }
      if (!rec || rec.error) continue;
      seen.add(id);
      sats.push({ rec, name: t.name.replace(/^0 /, ''), id, cls: classOf(t.name), group: data.name });
    }
    p.textContent = `Loading the satellite catalogue… ${sats.length.toLocaleString()} objects`;
  }));
  if (!st.alive) return current;
  if (!sats.length) { p.textContent = 'The satellite catalogue is not available right now. Try again in a minute.'; loading.append(el('button', { class: 'orb-btn', onclick: close }, 'Back to map')); return current; }

  // ---------- scene ----------
  const ren = new THREE.WebGLRenderer({ antialias: true });
  st.ren = ren;
  ren.setPixelRatio(Math.min(devicePixelRatio, 2));
  const canvas = ren.domElement; canvas.className = 'orb-canvas';
  root.prepend(canvas);
  const scene = new THREE.Scene(); st.scene = scene;
  scene.background = new THREE.Color(0x02050b);
  const cam = new THREE.PerspectiveCamera(42, 1, 0.5, 20000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(sunLight);
  {
    const pm = new THREE.PMREMGenerator(ren);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }

  // Stars
  {
    const n = 4000, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.set([6000 * s * Math.cos(a), 6000 * u, 6000 * s * Math.sin(a)], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb2cc, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7 })));
  }

  // Earth with day and night sides
  const loader = new THREE.TextureLoader();
  const base = opts.base || '';
  const blank = new THREE.DataTexture(new Uint8Array([20, 40, 70, 255]), 1, 1); blank.needsUpdate = true;
  const earthU = { day: { value: blank }, night: { value: blank }, sun: { value: new THREE.Vector3(1, 0, 0) } };
  for (const [k, f] of [['day', 'earth-day.jpg'], ['night', 'earth-night.jpg']]) {
    loader.load(`${base}/orbit/${f}`, (t) => { t.anisotropy = 4; earthU[k].value = t; });
  }
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), new THREE.ShaderMaterial({
    uniforms: earthU,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D day; uniform sampler2D night; uniform vec3 sun; varying vec2 vUv; varying vec3 vN;
      void main(){ float d = dot(normalize(vN), sun); float k = smoothstep(-0.12, 0.18, d);
        vec3 n = texture2D(night, vUv).rgb * 1.25 + vec3(0.012, 0.02, 0.04);
        vec3 c = mix(n, texture2D(day, vUv).rgb, k); gl_FragColor = vec4(c, 1.0); }`,
  }));
  scene.add(earth);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.1, 64, 48), new THREE.ShaderMaterial({
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vN; void main(){ float i = pow(max(0.0, 0.72 - dot(vN, vec3(0.0,0.0,1.0))), 2.6); gl_FragColor = vec4(0.32, 0.6, 1.0, 1.0) * i; }',
  }));
  scene.add(atmo);

  // One point cloud per class, so a class can be switched off as a whole.
  const groups = CLASSES.map((c, k) => {
    const idx = [];
    sats.forEach((s, i) => { if (s.cls === k) idx.push(i); });
    const n = idx.length;
    const pos = new Float32Array(n * 3), A = new Float32Array(n * 3), B = new Float32Array(n * 3), C = new Float32Array(n * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geom, new THREE.PointsMaterial({
      map: sprite(k), color: new THREE.Color(...rgb(c.css)), size: c.size * Math.min(devicePixelRatio, 2), sizeAttenuation: false,
      transparent: true, alphaTest: 0.3, depthWrite: false,
    }));
    points.frustumCulled = false;
    scene.add(points);
    return { k, idx, pos, A, B, C, geom, points };
  });
  sats.forEach((s) => { s.g = groups[s.cls]; });
  groups.forEach((g) => g.idx.forEach((i, j) => { sats[i].j = j; }));

  // Selection: ring, its orbit ahead (bright) and behind (faint), and the track on the ground.
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const ring = new THREE.Group();
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.RingGeometry(1, 1.1, 24, 1, i * Math.PI / 2, Math.PI / 2 * 0.6), ringMat); m.renderOrder = 10; ring.add(m); }
  ring.visible = false; scene.add(ring);
  const PATH_N = 240;
  const mkLine = (color, opacity) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_N * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PATH_N * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity }));
    l.frustumCulled = false; l.visible = false; scene.add(l);
    l.userData.color = new THREE.Color(color);
    return l;
  };
  const orbitLine = mkLine(0x8fdcff, 1);
  const groundLine = mkLine(0xffb347, 0.85);

  // ---------- state ----------
  const sim = { t: Date.now(), rate: 1, paused: false, wall: performance.now() };
  const simNow = () => {
    const w = performance.now();
    if (!sim.paused) sim.t += (w - sim.wall) * sim.rate;
    sim.wall = w;
    return sim.t;
  };
  const view = { yaw: 0.6, pitch: 0.35, dist: 420, want: 420, target: new THREE.Vector3(), follow: false, spin: true, oyaw: 0.5, opitch: 0.35, home: 420, zoomed: false };
  let sel = -1;

  // Propagation runs in slices across frames so 25,000 objects never stall the page.
  // A = state at tA, B = state at tB, C is being filled for tC.
  const prop = { tA: 0, tB: 0, tC: 0, cursor: 0, ready: false, ms: 0 };
  const stepMs = () => Math.min(Math.max(1500 * sim.rate, 1500), 10 * 60 * 1000);
  const tmp = new THREE.Vector3();
  function fill(buf, which, when, from, budgetMs) {
    const gm = gstime(when), t0 = performance.now();
    let i = from;
    for (; i < sats.length; i++) {
      const s = sats[i];
      const g = geo(s.rec, when, gm);
      const b = s.g[which];
      if (g && g.alt > -50) { toVec(g.lat, g.lon, g.alt, tmp); b[s.j * 3] = tmp.x; b[s.j * 3 + 1] = tmp.y; b[s.j * 3 + 2] = tmp.z; } else { b[s.j * 3] = b[s.j * 3 + 1] = b[s.j * 3 + 2] = 0; }
      if (budgetMs && (i & 63) === 0 && performance.now() - t0 > budgetMs) return i + 1;
    }
    return i;
  }
  function primeProp() {
    const now = simNow();
    prop.tA = now; prop.tB = now + stepMs(); prop.tC = prop.tB + stepMs();
    const t0 = performance.now();
    fill(null, 'A', new Date(prop.tA), 0, 0);
    fill(null, 'B', new Date(prop.tB), 0, 0);
    prop.ms = Math.round((performance.now() - t0) / 2);
    prop.cursor = 0; prop.ready = false;
  }
  function advanceProp(now) {
    if (now < prop.tA - 1000 || now > prop.tC + stepMs() * 2) { primeProp(); return; } // clock jumped
    if (!prop.ready) {
      prop.cursor = fill(null, 'C', new Date(prop.tC), prop.cursor, 7);
      if (prop.cursor >= sats.length) prop.ready = true;
    }
    if (now >= prop.tB && prop.ready) {
      for (const g of groups) { const a = g.A; g.A = g.B; g.B = g.C; g.C = a; }
      prop.tA = prop.tB; prop.tB = prop.tC; prop.tC = prop.tB + stepMs();
      prop.cursor = 0; prop.ready = false;
    }
  }
  function interpolate(now) {
    const u = Math.max(0, Math.min(1, (now - prop.tA) / Math.max(1, prop.tB - prop.tA)));
    for (const g of groups) {
      if (!g.points.visible) continue;
      const { A, B, pos } = g;
      for (let k = 0; k < pos.length; k += 3) {
        const ax = A[k], ay = A[k + 1], az = A[k + 2], bx = B[k], by = B[k + 1], bz = B[k + 2];
        const ra = Math.sqrt(ax * ax + ay * ay + az * az), rb = Math.sqrt(bx * bx + by * by + bz * bz);
        if (ra < 1 || rb < 1) { pos[k] = pos[k + 1] = pos[k + 2] = 0; continue; }
        // Move along the arc between the two positions, not straight through the Earth.
        const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (ra * rb)));
        const th = Math.acos(cos);
        let w1 = 1 - u, w2 = u;
        if (th > 1e-4) { const s = Math.sin(th); w1 = Math.sin((1 - u) * th) / s; w2 = Math.sin(u * th) / s; }
        const x = ax / ra * w1 + bx / rb * w2, y = ay / ra * w1 + by / rb * w2, z = az / ra * w1 + bz / rb * w2;
        const r = (ra + (rb - ra) * u) / (Math.sqrt(x * x + y * y + z * z) || 1);
        pos[k] = x * r; pos[k + 1] = y * r; pos[k + 2] = z * r;
      }
      g.geom.attributes.position.needsUpdate = true;
    }
  }

  // ---------- interface ----------
  const counts = CLASSES.map((_, k) => groups[k].idx.length);
  const search = el('input', { type: 'search', class: 'orb-search', placeholder: 'Find a satellite: ISS, Hubble, NOAA 20, 25544', 'aria-label': 'Find a satellite', autocomplete: 'off' });
  const hits = el('div', { class: 'orb-hits', hidden: true });
  const rateSel = el('select', { 'aria-label': 'Speed', class: 'orb-rate' }, RATES.map((r) => el('option', { value: r }, r === 1 ? 'Real time' : `${r}× faster`)));
  const pauseBtn = el('button', { class: 'orb-btn icon', title: 'Pause', 'aria-label': 'Pause' }, '❚❚');
  const nowBtn = el('button', { class: 'orb-btn', title: 'Back to the current time' }, 'Now');
  const followBtn = el('button', { class: 'orb-btn follow', disabled: true, title: 'Fly to the selected object and stay with it' }, 'Follow');
  const legend = el('div', { class: 'orb-legend' });
  const hud = el('div', { class: 'orb-hud' });
  const panel = el('aside', { class: 'orb-panel', hidden: true });
  const label = el('div', { class: 'orb-label', hidden: true });
  const clock = el('span', { class: 'orb-clock' });

  root.append(
    el('div', { class: 'orb-bar' },
      el('button', { class: 'orb-btn back', onclick: close }, '← Map'),
      el('div', { class: 'orb-title' }, el('b', {}, 'Live orbits'), el('span', {}, `${sats.length.toLocaleString()} objects`)),
      el('div', { class: 'orb-find' }, search, hits),
      el('div', { class: 'orb-time' }, pauseBtn, rateSel, nowBtn, clock),
      followBtn),
    legend, hud, panel, label);
  loading.remove();

  const renderLegend = () => {
    legend.replaceChildren(...CLASSES.map((c, k) => counts[k] ? el('label', { class: 'orb-chip' },
      el('input', { type: 'checkbox', checked: groups[k].points.visible, onchange: (e) => { groups[k].points.visible = e.target.checked; if (!e.target.checked && sel >= 0 && sats[sel].cls === k) select(-1); } }),
      el('span', { class: 'k', style: { background: c.css } }), c.label, el('b', {}, counts[k].toLocaleString())) : null).filter(Boolean),
    el('p', {}, 'Positions are calculated from public CelesTrak orbital elements (SGP4), not radar. Drag to turn, scroll or pinch to zoom, click any object to track it.'));
  };
  renderLegend();

  pauseBtn.addEventListener('click', () => { simNow(); sim.paused = !sim.paused; pauseBtn.textContent = sim.paused ? '▶' : '❚❚'; pauseBtn.title = sim.paused ? 'Play' : 'Pause'; });
  rateSel.addEventListener('change', () => { simNow(); sim.rate = Number(rateSel.value); prop.tC = prop.tB + stepMs(); prop.cursor = 0; prop.ready = false; });
  nowBtn.addEventListener('click', () => { simNow(); sim.t = Date.now(); sim.rate = 1; rateSel.value = '1'; if (sim.paused) pauseBtn.click(); primeProp(); });
  followBtn.addEventListener('click', () => setFollow(!view.follow));

  function setFollow(on, close = false) {
    view.follow = on && sel >= 0;
    view.want = view.follow ? (close ? 7 : 30) : view.home;
    view.oyaw = close ? 0.7 : 0.5; view.opitch = close ? 0.3 : 0.35;
    if (view.follow) view.spin = false;
    followBtn.textContent = view.follow ? 'Back to Earth' : 'Follow';
    followBtn.classList.toggle('on', view.follow);
    panel.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('on', (b.dataset.cam === 'close' && view.follow && close) || (b.dataset.cam === 'follow' && view.follow && !close) || (b.dataset.cam === 'earth' && !view.follow)));
  }

  search.addEventListener('input', () => {
    const q = search.value.trim().toUpperCase();
    if (q.length < 2) { hits.hidden = true; return; }
    const out = [];
    for (let i = 0; i < sats.length && out.length < 8; i++) if (sats[i].id === q || sats[i].name.includes(q)) out.push(i);
    hits.replaceChildren(...(out.length ? out.map((i) => el('button', { class: 'orb-hit', onclick: () => { hits.hidden = true; search.value = sats[i].name; if (!groups[sats[i].cls].points.visible) { groups[sats[i].cls].points.visible = true; renderLegend(); } select(i); setFollow(true); } },
      el('span', { class: 'k', style: { background: CLASSES[sats[i].cls].css } }), sats[i].name, el('small', {}, sats[i].id))) : [el('div', { class: 'orb-none' }, 'Nothing found by that name or number.')]));
    hits.hidden = false;
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') hits.querySelector('.orb-hit')?.click(); if (e.key === 'Escape') { hits.hidden = true; search.blur(); } });

  const sec = (title, ...kids) => el('section', { class: 'orb-sec' }, el('h4', {}, title), ...kids);
  // ---------- workspace: save, notes, findings ----------
  const ws = opts.workspace || null;
  function wsActions(s) {
    if (!ws) return null;
    if (!ws.enabled) return sec('Your workspace', el('p', { class: 'orb-note' }, 'Save satellites you follow, add notes and share findings with peers.'), el('div', { class: 'orb-actions' }, el('button', { class: 'orb-btn', onclick: () => { close(); ws.signUp(); } }, 'Create a free account')));
    const saveBtn = el('button', { class: 'orb-btn' }, '☆ Save');
    const setSaved = (on) => { saveBtn.textContent = on ? '★ Saved' : '☆ Save'; saveBtn.classList.toggle('on', on); saveBtn.dataset.on = on ? '1' : ''; };
    ws.isSaved(s.id).then(setSaved);
    saveBtn.addEventListener('click', async () => { try { if (saveBtn.dataset.on) { await ws.unsave(s); setSaved(false); } else { await ws.save(s); setSaved(true); } } catch (e) { alertMsg(e); } });
    const list = el('div', { class: 'orb-notes' });
    const loadNotes = () => ws.notes(s.id).then((ns) => list.replaceChildren(...ns.map((n) => el('div', { class: 'orb-n' }, el('p', {}, n.body), el('span', {}, `${n.author_name || 'Someone'} · ${new Date(n.created_at).toLocaleDateString()}`)))));
    loadNotes();
    return sec('Your workspace',
      el('div', { class: 'orb-actions' }, saveBtn,
        ws.canWrite ? el('button', { class: 'orb-btn', onclick: () => ws.addNote(s, loadNotes) }, 'Add note') : null,
        ws.canWrite ? el('button', { class: 'orb-btn', onclick: () => ws.saveFinding(s, { time: new Date(simNow()).toISOString(), camera: view.follow ? (view.want < 12 ? 'close' : 'follow') : 'earth', rate: sim.rate }) }, 'Save finding') : null),
      list);
  }
  const alertMsg = (e) => { const t = el('div', { class: 'orb-toast' }, e.message || String(e)); root.append(t); setTimeout(() => t.remove(), 5000); };

  // ---------- selection ----------
  let pathAt = 0, model = null, modelToken = 0;
  function select(i) {
    sel = i;
    ring.visible = orbitLine.visible = groundLine.visible = i >= 0;
    label.hidden = i < 0;
    followBtn.disabled = i < 0;
    disposeModel(model); model = null; modelToken++;
    if (i < 0) { panel.hidden = true; setFollow(false); return; }
    const s = sats[i];
    const p0 = geo(s.rec, new Date(simNow()));
    const choice = modelChoice({ id: s.id, name: s.name, cls: s.cls, altKm: p0?.alt ?? 0 });
    const noteEl = el('p', { class: 'orb-note' }, choice.note, ' Shown many times larger than life so you can see it.');
    const token = modelToken;
    const place = (obj, shared) => { if (token !== modelToken) return; disposeModel(model); model = normalise(obj, 3); model.userData.shared = shared; scene.add(model); };
    if (choice.kind === 'gltf') {
      if (choice.fallback) place(choice.fallback(), false);
      loadGltf(base, choice.file).then((g) => place(g, true)).catch(() => { if (!choice.fallback) place(choice.build ? choice.build() : new THREE.Group(), false); });
    } else place(choice.build(), false);
    const c = CLASSES[s.cls];
    label.replaceChildren(el('b', {}, s.name), el('span', {}, c.label));
    const n = s.rec.no / 60; // rad/s
    const a = Math.cbrt(MU / (n * n));
    const e = s.rec.ecco;
    const period = (2 * Math.PI / s.rec.no);
    const row = (k, v, live) => el('tr', {}, el('th', {}, k), el('td', live ? { 'data-k': live } : {}, v));
    const hi = a * (1 + e) - KM, lo = a * (1 - e) - KM;
    const orbitKind = hi > 34000 && lo > 34000 ? 'Geostationary (stays over one spot)' : e > 0.25 ? 'Highly elliptical' : hi > 2000 ? 'Medium Earth orbit' : 'Low Earth orbit';
    const about = aboutText(s.name);
    const catalogue = el('tbody', {}, row('Catalogue', 'Loading…'));
    panel.replaceChildren(...[
      el('button', { class: 'orb-x', 'aria-label': 'Close', onclick: () => select(-1) }, '✕'),
      el('div', { class: 'orb-eyebrow' }, el('span', { class: 'k', style: { background: c.css } }), c.label, ' · ', s.group),
      el('h3', {}, s.name),
      about ? el('p', { class: 'orb-about' }, about) : null,
      el('div', { class: 'orb-cams', role: 'group', 'aria-label': 'Camera' },
        el('button', { class: 'orb-btn', 'data-cam': 'close', onclick: () => setFollow(true, true) }, 'Close up'),
        el('button', { class: 'orb-btn', 'data-cam': 'follow', onclick: () => setFollow(true) }, 'Follow'),
        el('button', { class: 'orb-btn', 'data-cam': 'earth', onclick: () => setFollow(false) }, 'Globe')),
      sec('Right now', el('table', {}, el('tbody', { 'data-live': '' },
        row('Over', '…', 'pos'), row('Altitude', '…', 'alt'), row('Speed', '…', 'spd'), row('Sunlight', '…', 'sun')))),
      sec('Its orbit', el('table', {}, el('tbody', {},
        row('Type', orbitKind),
        row('One orbit', period > 1000 ? `${fmt(period / 60, 1)} hours` : `${fmt(period, 0)} minutes`),
        row('Orbits a day', fmt(1440 / period, 1)),
        row('Highest / lowest', `${fmt(hi)} / ${fmt(lo)} km`),
        row('Inclination', `${fmt(s.rec.inclo * 180 / Math.PI, 1)}°`))),
        el('p', { class: 'orb-note' }, 'Blue line: where it goes in the next orbit. Orange: the path over the ground below it.')),
      wsActions(s),
      sec('Catalogue record', el('table', {}, catalogue)),
      sec('The 3D model', noteEl),
      el('p', { class: 'orb-note' }, `NORAD ${s.id} · orbital elements from ${epochText(s.rec)} · `,
        el('a', { href: `https://celestrak.org/satcat/table-satcat.php?CATNR=${s.id}`, target: '_blank', rel: 'noopener' }, 'CelesTrak record ↗'))].filter(Boolean));
    panel.hidden = false;
    panel.scrollTop = 0;
    setFollow(view.follow, view.want < 12);
    opts.get(`/space/info/${s.id}`).then((d) => {
      if (token !== modelToken) return;
      const age = d.launchDate ? Math.floor((Date.now() - Date.parse(d.launchDate)) / (365.25 * 864e5)) : null;
      const size = d.rcsM2 == null ? null : d.rcsM2 < 0.1 ? 'Small (under about 30 cm)' : d.rcsM2 < 1 ? 'Medium (about 0.3 to 1 m)' : `Large (radar size about ${fmt(d.rcsM2, d.rcsM2 < 10 ? 1 : 0)} m²)`;
      catalogue.replaceChildren(...[
        d.type && row('Object', d.type), d.status && row('Status', d.status), d.owner && row('Owner', d.owner),
        d.launchDate && row('Launched', `${d.launchDate}${age != null ? ` (${age < 1 ? 'this year' : `${age} year${age === 1 ? '' : 's'} ago`})` : ''}`),
        d.launchSite && row('Launch site', d.launchSite), d.intlId && row('International id', d.intlId),
        size && row('Size', size), d.decayDate && row('Re-entered', d.decayDate),
      ].filter(Boolean));
    }).catch(() => { if (token === modelToken) catalogue.replaceChildren(row('Catalogue', 'No record available right now.')); });
    pathAt = 0;
  }
  function epochText(rec) {
    const yr = rec.epochyr < 57 ? 2000 + rec.epochyr : 1900 + rec.epochyr;
    const d = new Date(Date.UTC(yr, 0, 1) + (rec.epochdays - 1) * 864e5);
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  function drawPaths(now) {
    const s = sats[sel];
    const period = (2 * Math.PI / s.rec.no) * 60000;
    const span = Math.min(period * 1.02, 24 * 3600e3);
    const o = orbitLine.geometry.attributes, g = groundLine.geometry.attributes;
    const c1 = orbitLine.userData.color, c2 = groundLine.userData.color;
    let last = null;
    for (let i = 0; i < PATH_N; i++) {
      const when = new Date(now + (i / (PATH_N - 1)) * span);
      const p = geo(s.rec, when) || last;
      if (!p) continue;
      last = p;
      toVec(p.lat, p.lon, p.alt, tmp); o.position.setXYZ(i, tmp.x, tmp.y, tmp.z);
      toVec(p.lat, p.lon, 8, tmp); g.position.setXYZ(i, tmp.x, tmp.y, tmp.z);
      const f = 1 - (i / PATH_N) * 0.6;
      o.color.setXYZ(i, c1.r * f, c1.g * f, c1.b * f);
      g.color.setXYZ(i, c2.r * f, c2.g * f, c2.b * f);
    }
    o.position.needsUpdate = o.color.needsUpdate = g.position.needsUpdate = g.color.needsUpdate = true;
  }
  const selPos = new THREE.Vector3();
  function updateSelected(now) {
    const s = sats[sel];
    const p = geo(s.rec, new Date(now));
    if (!p) return;
    toVec(p.lat, p.lon, p.alt, selPos);
    ring.position.copy(selPos);
    ring.quaternion.copy(cam.quaternion);
    ring.scale.setScalar(Math.max(1.4, view.dist * 0.016));
    ring.visible = view.dist > 14;
    if (model) {
      model.visible = view.dist < 140;
      model.position.copy(selPos);
      model.scale.setScalar(Math.max(0.8, Math.min(3, view.dist / 14)));
      // Point it along its direction of travel, top away from the Earth.
      const ahead = geo(s.rec, new Date(now + 5000));
      if (ahead) {
        const fwd = toVec(ahead.lat, ahead.lon, ahead.alt).sub(selPos).normalize();
        const up = selPos.clone().normalize();
        const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
        const trueUp = new THREE.Vector3().crossVectors(fwd, right).normalize();
        model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, trueUp, fwd));
      }
    }
    ring.children.forEach((m) => { m.rotation.z = performance.now() / 900; });
    if (performance.now() - pathAt > 1000) { drawPaths(now); pathAt = performance.now(); }
    const live = panel.querySelector('[data-live]');
    if (live) {
      live.querySelector('[data-k=pos]').textContent = `${Math.abs(p.lat).toFixed(2)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(2)}° ${p.lon >= 0 ? 'E' : 'W'}`;
      live.querySelector('[data-k=alt]').textContent = `${fmt(p.alt)} km (${fmt(p.alt * 0.621371)} mi)`;
      live.querySelector('[data-k=spd]').textContent = p.speed ? `${p.speed.toFixed(2)} km/s (${fmt(p.speed * 2236.94)} mph)` : '—';
      const sun = earthU.sun.value, d = selPos.dot(sun);
      const shade = d < 0 && selPos.clone().addScaledVector(sun, -d).length() < R;
      live.querySelector('[data-k=sun]').textContent = shade ? "In Earth's shadow" : 'In sunlight';
    }
    // Label follows the object unless it is behind the Earth.
    const toObj = selPos.clone().sub(cam.position);
    const t = -cam.position.dot(toObj) / toObj.lengthSq();
    const hidden = t > 0 && t < 1 && cam.position.clone().addScaledVector(toObj, t).length() < R;
    const v = selPos.clone().project(cam);
    if (hidden || v.z > 1) label.hidden = true;
    else { label.hidden = false; label.style.transform = `translate(${(v.x * 0.5 + 0.5) * root.clientWidth + 14}px, ${(-v.y * 0.5 + 0.5) * root.clientHeight - 14}px)`; }
  }

  // ---------- camera input ----------
  const ptrs = new Map();
  let moved = 0, pinch = 0;
  listen(canvas, 'pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; view.spin = false; });
  listen(canvas, 'pointermove', (e) => {
    const prev = ptrs.get(e.pointerId);
    if (!prev) return;
    if (ptrs.size === 2) {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) { view.zoomed = true; view.want = view.dist = Math.max(view.follow ? 3 : 112, Math.min(3000, view.dist * pinch / d)); }
      pinch = d; moved += 10; return;
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    moved += Math.abs(dx) + Math.abs(dy);
    const k = 0.005 * Math.min(1, (view.dist - (view.follow ? 0 : R * 0.9)) / 300 + 0.15);
    if (view.follow) { view.oyaw -= dx * 0.006; view.opitch = Math.max(-1.3, Math.min(1.3, view.opitch + dy * 0.006)); }
    else { view.yaw -= dx * k; view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch + dy * k)); }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; };
  listen(canvas, 'pointerup', (e) => { up(e); if (moved < 6) pick(e); });
  listen(canvas, 'pointercancel', up);
  listen(canvas, 'wheel', (e) => { e.preventDefault(); view.spin = false; view.zoomed = true; view.want = Math.max(view.follow ? 3 : 112, Math.min(3000, view.want * (1 + Math.sign(e.deltaY) * 0.12))); }, { passive: false });

  const ray = new THREE.Raycaster();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.params.Points.threshold = Math.max(0.3, view.dist * 0.012);
    ray.setFromCamera(ndc, cam);
    const vis = groups.filter((g) => g.points.visible && g.idx.length);
    const found = ray.intersectObjects([earth, ...vis.map((g) => g.points)], false);
    const earthHit = found.find((h) => h.object === earth);
    const h = found.find((x) => x.object !== earth && (!earthHit || x.distance < earthHit.distance + 1));
    if (!h) { select(-1); return; }
    const g = vis.find((x) => x.points === h.object);
    select(g.idx[h.index]);
  }

  const resize = () => {
    const w = root.clientWidth, hgt = root.clientHeight;
    if (!w || !hgt) return;
    ren.setSize(w, hgt, false);
    cam.aspect = w / hgt; cam.updateProjectionMatrix();
    // Fit the Earth and its satellite shell to the screen, portrait phones included.
    const half = Math.atan(Math.tan(21 * Math.PI / 180) * Math.min(1, cam.aspect));
    view.home = Math.max(380, 140 / Math.sin(half));
    if (!view.zoomed && !view.follow) { view.want = view.home; if (!st.started) view.dist = view.home; }
  };
  st.ro = new ResizeObserver(resize); st.ro.observe(root); resize();

  st.started = true;
  primeProp();
  // Open on a given object, time and camera (from the workspace or a shared finding).
  function focus(o = {}) {
    if (o.time && Number.isFinite(Date.parse(o.time))) { simNow(); sim.t = Date.parse(o.time); }
    if (o.rate && RATES.includes(Number(o.rate))) { sim.rate = Number(o.rate); rateSel.value = String(sim.rate); }
    if (o.time || o.rate) primeProp();
    if (o.select) {
      const q = String(o.select).toUpperCase();
      const i = sats.findIndex((x) => x.id === q || x.name.startsWith(q));
      if (i >= 0) {
        if (!groups[sats[i].cls].points.visible) { groups[sats[i].cls].points.visible = true; renderLegend(); }
        select(i);
        if (o.camera === 'close') setFollow(true, true); else if (o.camera !== 'earth') setFollow(true);
      }
    }
    findingCard?.remove(); findingCard = null;
    if (o.finding) {
      const f = o.finding;
      findingCard = el('aside', { class: 'orb-finding' },
        el('button', { class: 'orb-x', 'aria-label': 'Close', onclick: () => { findingCard.remove(); findingCard = null; } }, '✕'),
        el('div', { class: 'orb-eyebrow' }, 'Shared finding'), el('h3', {}, f.title), f.note ? el('p', {}, f.note) : null,
        el('p', { class: 'orb-note' }, [f.author_name, f.org_name].filter(Boolean).join(' · ')));
      root.append(findingCard);
    }
  }
  let findingCard = null;
  current.focus = focus;
  focus(opts);

  // ---------- frame loop ----------
  let frames = 0, fps = 0, fpsAt = performance.now(), hudAt = 0;
  const origin = new THREE.Vector3();
  (function loop() {
    if (!st.alive) return;
    st.raf = requestAnimationFrame(loop);
    const now = simNow();
    advanceProp(now);
    interpolate(now);
    earthU.sun.value.copy(sunDir(new Date(now)));
    sunLight.position.copy(earthU.sun.value).multiplyScalar(1000);
    if (view.spin) view.yaw += 0.0007;
    if (sel >= 0) updateSelected(now);
    view.target.lerp(view.follow && sel >= 0 ? selPos : origin, 0.12);
    view.dist += (view.want - view.dist) * 0.1;
    if (view.follow && sel >= 0) {
      // Ride along above the object, with the Earth below it.
      const d = selPos.clone().normalize();
      const ty = Math.atan2(d.x, d.z) + view.oyaw, tp = Math.max(-1.45, Math.min(1.45, Math.asin(d.y) + view.opitch));
      view.yaw += (((ty - view.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * 0.12;
      view.pitch += (tp - view.pitch) * 0.12;
    }
    cam.position.set(
      view.target.x + view.dist * Math.cos(view.pitch) * Math.sin(view.yaw),
      view.target.y + view.dist * Math.sin(view.pitch),
      view.target.z + view.dist * Math.cos(view.pitch) * Math.cos(view.yaw));
    cam.lookAt(view.target);
    atmo.visible = cam.position.length() > R * 1.16;
    if (sel >= 0) ring.quaternion.copy(cam.quaternion);
    ringMat.opacity = 0.65 + 0.25 * Math.sin(performance.now() / 300);
    ren.render(scene, cam);
    frames++;
    const w = performance.now();
    if (w - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = w; }
    if (w - hudAt > 250) {
      hudAt = w;
      const d = new Date(now);
      clock.textContent = sim.paused ? `Paused · ${d.toISOString().slice(11, 19)} UTC` : sim.rate === 1 ? `Live · ${d.toISOString().slice(11, 19)} UTC` : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
      clock.classList.toggle('fast', sim.rate !== 1 || sim.paused);
      hud.textContent = `${sats.length.toLocaleString()} objects · ${fps} fps`;
    }
  })();
  return current;
}
