// End-to-end API tests against a real PostgreSQL + PostGIS database.
// Run with: TEST_DATABASE_URL=postgres://... npm test   (default: local iobmaps_test)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5433/iobmaps_test?host=/tmp';
process.env.OFFLINE = '1';
process.env.RATE_LIMIT = 'off';
process.env.WORKER_ENABLED = '0';
process.env.BASE_PATH = '/maps';
process.env.STAFF_EMAILS = 'staff@example.com';

const { buildApp } = await import('../src/app.js');
const { migrate } = await import('../src/db/migrate.js');
const { seedDemo } = await import('../src/db/seed.js');
const { pool, q } = await import('../src/db/pool.js');

let server; let base;
before(async () => {
  await migrate();
  await seedDemo();
  server = buildApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/maps/api`;
});
after(async () => { server?.close(); await pool.end(); });

// A tiny client that keeps its own session cookie.
function client(headers = {}) {
  let cookie = '';
  const call = async (method, path, body, extra = {}) => {
    const h = { ...headers, ...(cookie ? { cookie } : {}) };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual', ...extra });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p) };
}
const uniq = () => Math.random().toString(36).slice(2, 8);
async function signup(name = 'Owner') {
  const c = client();
  const email = `${name.toLowerCase()}-${uniq()}@example.com`;
  const r = await c.post('/signup', { name, email, password: 'a-long-password', orgName: `${name} Co ${uniq()}` });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { c, email };
}

test('open demo works without signing in', async () => {
  const c = client();
  const s = await c.get('/session');
  assert.equal(s.status, 200);
  assert.equal(s.data.demo, true);
  assert.equal(s.data.user, null);
  const maps = await c.get('/maps');
  assert.ok(maps.data.length >= 1);
  const m = await c.get(`/maps/${maps.data[0].id}`);
  assert.ok(m.data.layers.length >= 2);
  const sites = await c.get('/sites');
  assert.equal(sites.data.features.length, 6);
  // the demo can't reach owner-only settings
  assert.equal((await c.get('/org/keys')).status, 403);
});

test('signup gives a trial workspace with a starter map, and login works', async () => {
  const { c, email } = await signup('Pat');
  const s = await c.get('/session');
  assert.equal(s.data.role, 'owner');
  assert.equal(s.data.org.plan, 'trial');
  assert.equal(s.data.plan.features.geofences, true);
  assert.equal((await c.get('/maps')).data.length, 1);
  await c.post('/logout');
  assert.equal((await c.get('/session')).data.demo, true);
  const bad = await c.post('/login', { email, password: 'wrong-password' });
  assert.equal(bad.status, 401);
  assert.equal((await c.post('/login', { email, password: 'a-long-password' })).status, 200);
  assert.equal((await c.get('/session')).data.user.email, email);
  assert.equal((await c.post('/signup', { name: 'X', email, password: 'a-long-password' })).status, 409);
});

test('maps, layers, features, export and vector tiles', async () => {
  const { c } = await signup('Mapper');
  const m = (await c.post('/maps', { name: 'Poles' })).data;
  const l = (await c.post(`/maps/${m.id}/layers`, { name: 'Poles', style: { color: '#ff0000', mode: 'categories', field: 'kind' } })).data;
  assert.equal(l.style.color, '#ff0000');
  const add = await c.post(`/layers/${l.id}/features`, { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-95.99, 36.15] }, properties: { kind: 'wood' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-95.98, 36.16] }, properties: { kind: 'steel' } },
  ] });
  assert.equal(add.status, 201);
  assert.equal(add.data.ids.length, 2);
  const fc = (await c.get(`/layers/${l.id}/features`)).data;
  assert.equal(fc.features.length, 2);
  assert.equal((await c.patch(`/features/${add.data.ids[0]}`, { properties: { kind: 'concrete' } })).status, 200);
  const bbox = (await c.get(`/layers/${l.id}/features?bbox=-95.995,36.145,-95.985,36.155`)).data;
  assert.deepEqual(bbox.features.map((f) => f.properties.kind), ['concrete']);
  const csv = await c.get(`/layers/${l.id}/export.csv`);
  assert.equal(csv.status, 200);
  assert.match(Buffer.from(csv.data).toString(), /concrete/);
  const kml = await c.get(`/layers/${l.id}/export.kml`);
  assert.match(Buffer.from(kml.data).toString(), /<kml/);
  const tile = await c.get(`/tiles/${l.id}/10/238/401.pbf`);
  assert.equal(tile.status, 200);
  assert.ok(tile.data.byteLength > 0, 'tile has data');
  const dup = await c.post(`/maps/${m.id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.equal((await c.del(`/features/${add.data.ids[1]}`)).status, 200);
  assert.equal((await c.del(`/maps/${m.id}`)).status, 200);
});

test('uploads: GeoJSON, CSV with coordinates, KML', async () => {
  const { c } = await signup('Uploader');
  const m = (await c.get('/maps')).data[0];
  const up = async (name, text, type = 'text/plain') => {
    const form = new FormData(); form.append('file', new Blob([text], { type }), name);
    return c.post(`/maps/${m.id}/upload`, form);
  };
  const g = await up('a.geojson', JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-97, 35] }, properties: { a: 1 } }] }));
  assert.equal(g.status, 201, JSON.stringify(g.data));
  assert.equal(g.data.imported, 1);
  const csv = await up('b.csv', 'name,lat,lon\nOne,36.1,-95.9\nTwo,36.2,-95.8\nNo location,,\n');
  assert.equal(csv.status, 201, JSON.stringify(csv.data));
  assert.equal(csv.data.imported, 2);
  assert.equal(csv.data.skipped, 1);
  const kml = await up('c.kml', '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>P</name><Point><coordinates>-95.9,36.1,0</coordinates></Point></Placemark></Document></kml>');
  assert.equal(kml.status, 201, JSON.stringify(kml.data));
  const junk = await up('d.geojson', 'not json');
  assert.equal(junk.status, 400);
});

test('workspaces are isolated from each other', async () => {
  const a = await signup('Alpha');
  const b = await signup('Bravo');
  const am = (await a.c.get('/maps')).data[0];
  assert.equal((await b.c.get(`/maps/${am.id}`)).status, 404);
  const layer = (await a.c.get(`/maps/${am.id}`)).data.layers.find((l) => l.kind === 'features');
  assert.equal((await b.c.get(`/layers/${layer.id}/features`)).status, 404);
  assert.equal((await b.c.patch(`/layers/${layer.id}`, { name: 'hacked' })).status, 404);
  const site = (await a.c.get('/sites')).data.features[0];
  await b.c.del(`/sites/${site.id}`);
  assert.equal((await a.c.get('/sites')).data.features.length, 6, 'site survives a delete from another workspace');
});

test('devices, zones and a zone-exit alert', async () => {
  const { c } = await signup('Fleet');
  const z = await c.post('/zones', { name: 'Yard', geometry: { type: 'Polygon', coordinates: [[[-96, 36], [-95.9, 36], [-95.9, 36.1], [-96, 36.1], [-96, 36]]] } });
  assert.equal(z.status, 201, JSON.stringify(z.data));
  const circle = await c.post('/zones', { name: 'Ring', circle: { lon: -95.95, lat: 36.05, radius_m: 500 } });
  assert.equal(circle.status, 201);
  const d = (await c.post('/devices', { name: 'Truck 1', external_id: 'T1' })).data;
  const rule = await c.post('/rules', { name: 'Left yard', trigger: { type: 'zone_exit', zone_id: z.data.id }, channels: { emails: [], webhooks: [] } });
  assert.equal(rule.status, 201, JSON.stringify(rule.data));
  assert.equal((await c.post('/devices/T1/positions', { lon: -95.95, lat: 36.05 })).data.alerts.length, 0);
  const out = await c.post(`/devices/${d.id}/positions`, { positions: [{ lon: -95.8, lat: 36.05, speed_mph: 40 }] });
  assert.equal(out.status, 201);
  assert.equal(out.data.alerts.length, 1);
  assert.match(out.data.alerts[0].title, /left Yard/);
  const alerts = (await c.get('/alerts')).data;
  assert.equal(alerts.length, 1);
  const track = (await c.get(`/devices/${d.id}/track`)).data;
  assert.equal(track.geometry.coordinates.length, 2);
  const devs = (await c.get('/devices')).data;
  assert.equal(devs.features[0].properties.speed_mph, 40);
  const bad = await c.post('/rules', { name: 'x', trigger: { type: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal((await c.post('/rules', { name: 'x', trigger: { type: 'speed', mph: 60 }, channels: { sms: ['5551234'] } })).status, 400);
});

test('site reports degrade gracefully when sources are down, and render a PDF', async () => {
  const { c } = await signup('Reporter');
  const site = (await c.get('/sites')).data.features[0];
  const r = await c.post('/reports', { site_id: site.id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.sections.weather.ok, false);
  assert.equal(r.data.sections.workspace.ok, true);
  assert.ok(r.data.sections.workspace.data.sites.length >= 1);
  const pdf = await c.get(`/reports/${r.data.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(pdf.data).subarray(0, 4).toString(), '%PDF');
  assert.equal((await c.get('/usage')).data.reports, 1);
});

test('share links and embeds work without signing in', async () => {
  const { c } = await signup('Sharer');
  const m = (await c.get('/maps')).data[0];
  const shared = await c.patch(`/maps/${m.id}`, { visibility: 'link' });
  assert.equal(shared.status, 200);
  const token = shared.data.links.view.split('#share=')[1];
  const anon = client();
  const pub = await anon.get(`/public/maps/${token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.embedsAllowed, true);
  assert.equal(pub.data.share_token, undefined);
  const fl = pub.data.layers.find((l) => l.kind === 'features');
  assert.equal((await anon.get(`/public/maps/${token}/layers/${fl.id}/features`)).status, 200);
  await c.post(`/maps/${m.id}/share/reset`);
  assert.equal((await anon.get(`/public/maps/${token}`)).status, 404);
});

test('API keys reach /api/v1 and create devices on first position', async () => {
  const { c } = await signup('Api');
  const k = await c.post('/org/keys', { name: 'gateway' });
  assert.equal(k.status, 201);
  const api = client({ authorization: `Bearer ${k.data.secret}` });
  assert.equal((await api.get('/v1/maps')).status, 200);
  const pos = await api.post('/v1/devices/GW-7/positions', { lon: -95.9, lat: 36.1 });
  assert.equal(pos.status, 201, JSON.stringify(pos.data));
  assert.ok((await c.get('/devices')).data.devices.some((d) => d.external_id === 'GW-7'));
  assert.equal((await client().get('/v1/maps')).status, 401);
  await c.del(`/org/keys/${k.data.id}`);
  assert.equal((await api.get('/v1/maps')).status, 401);
});

test('plans: expired trials are read-only, Starter lacks geofences, staff can change plans', async () => {
  const { c } = await signup('Expiring');
  const orgId = (await c.get('/session')).data.org.id;
  await q("update orgs set trial_ends_at = now() - interval '1 day' where id=$1", [orgId]);
  assert.equal((await c.get('/session')).data.plan.key, 'expired');
  const m = (await c.get('/maps')).data[0];
  assert.equal((await c.post('/maps', { name: 'more' })).status, 402);
  assert.equal((await c.post(`/maps/${m.id}/layers`, { name: 'x' })).status, 402);
  assert.equal((await c.get(`/maps/${m.id}`)).status, 200, 'still readable');

  const staff = client();
  const r = await staff.post('/signup', { name: 'Staff', email: `staff@example.com`, password: 'a-long-password' }).catch(() => null);
  if (r.status === 409) await staff.post('/login', { email: 'staff@example.com', password: 'a-long-password' });
  assert.equal((await staff.patch(`/admin/orgs/${orgId}`, { plan: 'starter' })).status, 200);
  assert.equal((await c.get('/session')).data.plan.key, 'starter');
  const z = await c.post('/zones', { name: 'Z', circle: { lon: -95.9, lat: 36.1, radius_m: 100 } });
  assert.equal(z.status, 402);
  assert.equal((await client().get('/admin/orgs')).status, 401);
});

test('team invitations', async () => {
  const { c } = await signup('Lead');
  const inv = await c.post('/org/invitations', { email: `mate-${uniq()}@example.com`, role: 'viewer' });
  assert.equal(inv.status, 201);
  const token = inv.data.link.split('#invite=')[1];
  const mate = client();
  assert.equal((await mate.get(`/invitations/${token}`)).data.role, 'viewer');
  await mate.post('/signup', { name: 'Mate', email: `m-${uniq()}@example.com`, password: 'a-long-password', inviteToken: token });
  assert.equal((await mate.post(`/invitations/${token}/accept`)).status, 200);
  const s = (await mate.get('/session')).data;
  assert.equal(s.role, 'viewer');
  const m = (await mate.get('/maps')).data[0];
  assert.equal((await mate.patch(`/maps/${m.id}`, { name: 'nope' })).status, 403);
  assert.equal((await c.get('/org')).data.members.length, 2);
});

test('password reset and change', async () => {
  const { c, email } = await signup('Forgetful');
  const anon = client();
  const f = await anon.post('/password/forgot', { email });
  assert.equal(f.status, 200);
  assert.equal(f.data.emailReady, false, 'no SMTP in tests');
  assert.equal((await anon.post('/password/forgot', { email: 'nobody@example.com' })).status, 200);
  // Use a token planted directly, since email is off in tests.
  const tok = `tok-${uniq()}`;
  const { sha256 } = await import('../src/auth.js');
  const uid = (await c.get('/session')).data.user.id;
  await q("insert into password_resets(token_hash, user_id, expires_at) values ($1,$2, now() + interval '1 hour')", [sha256(tok), uid]);
  assert.equal((await anon.get(`/password/reset/${tok}`)).data.email, email);
  assert.equal((await anon.post('/password/reset', { token: tok, password: 'short' })).status, 400);
  assert.equal((await anon.post('/password/reset', { token: tok, password: 'a-brand-new-password' })).status, 200);
  assert.equal((await anon.get('/session')).data.user.email, email, 'signed in after reset');
  assert.equal((await c.get('/session')).data.user, null, 'old session signed out');
  assert.equal((await anon.post('/password/reset', { token: tok, password: 'another-new-password' })).status, 404, 'single use');
  assert.equal((await anon.post('/password/change', { current: 'wrong', password: 'zzzzzzzzzzzz' })).status, 400);
  assert.equal((await anon.post('/password/change', { current: 'a-brand-new-password', password: 'third-password-here' })).status, 200);
  const again = client();
  assert.equal((await again.post('/login', { email, password: 'third-password-here' })).status, 200);
});

test('website: contact form and satellite data', async () => {
  const anon = client();
  assert.equal((await anon.post('/contact', { name: 'Ana', email: 'bad', message: 'hello there' })).status, 400);
  assert.equal((await anon.post('/contact', { name: 'Ana', email: 'ana@example.com', message: 'We want to map our depots.', topic: 'Custom project' })).status, 200);
  assert.equal((await anon.get('/admin/contact')).status, 401, 'staff only');
  const groups = (await anon.get('/space')).data;
  assert.ok(groups.some((g) => g.key === 'stations'));
  const st = (await anon.get('/space/stations')).data;
  assert.ok(st.satellites.length > 0 && st.satellites[0].l1.startsWith('1 '));
  assert.equal((await anon.get('/space/nope')).status, 404);
});
