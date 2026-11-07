// The generated client libraries, run against a real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5433/iobmaps_test?host=/tmp';
process.env.OFFLINE = '1';
process.env.RATE_LIMIT = 'off';
process.env.WORKER_ENABLED = '0';
process.env.BASE_PATH = '/maps';

const { buildApp } = await import('../src/app.js');
const { migrate } = await import('../src/db/migrate.js');
const { seedDemo } = await import('../src/db/seed.js');
const { pool } = await import('../src/db/pool.js');
const { IoBeacons, IoBeaconsError } = await import('../sdk/js/iobeacons.mjs');

let server; let apiRoot; let key;
before(async () => {
  await migrate();
  await seedDemo();
  server = buildApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/maps/api`;
  apiRoot = `${base}/v1`;
  const email = `sdk-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const s = await fetch(`${base}/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sdk', email, password: 'a-long-password', orgName: `Sdk ${email}` }) });
  const cookie = s.headers.get('set-cookie').split(';')[0];
  const k = await fetch(`${base}/org/keys`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'sdk test' }) });
  key = (await k.json()).secret;
});
after(async () => { server?.close(); await pool.end(); });

test('JavaScript client: maps, features, devices, satellites, notes and errors', async () => {
  const io = new IoBeacons(key, { baseUrl: apiRoot });
  assert.equal((await io.me()).key.name, 'sdk test');
  assert.ok(io.quota.remaining > 0);
  const m = await io.createMap({ name: 'From the SDK' });
  const layer = await io.createLayer(m.id, { name: 'Points' });
  const added = await io.addFeatures(layer.id, { type: 'Feature', geometry: { type: 'Point', coordinates: [-95.9, 36.1] }, properties: { name: 'A' } });
  assert.equal(added.ids.length, 1);
  assert.equal((await io.listFeatures(layer.id)).features.length, 1);
  const csv = await io.exportLayer(layer.id, 'csv');
  assert.ok(new TextDecoder().decode(csv).includes('A'));
  const up = await io.uploadFile(m.id, new File([JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }] })], 'points.geojson', { type: 'application/json' }), 'Uploaded');
  assert.equal(up.imported, 1);
  const pos = await io.sendPositions('sdk-truck', { lon: -95.9, lat: 36.1, speed_mph: 20 });
  assert.equal(pos.stored, 1);
  const iss = await io.satellitePosition(25544);
  assert.equal(iss.name, 'ISS (ZARYA)');
  assert.equal((await io.satelliteTrack(25544, { minutes: 20 })).properties.minutes, 20);
  assert.ok((await io.createNote({ body: 'sdk note', target: { kind: 'map' } })).id);
  await assert.rejects(io.getMap('00000000-0000-0000-0000-000000000000'), (e) => e instanceof IoBeaconsError && e.status === 404);
  await assert.rejects(new IoBeacons('iobm_nope', { baseUrl: apiRoot }).listMaps(), (e) => e.status === 401 && /not valid/.test(e.message));
  assert.throws(() => new IoBeacons('wrong'));
});

test('Python client', { skip: (() => { try { execFileSync('python3', ['--version']); return false; } catch { return 'python3 not installed'; } })() }, async () => {
  const sdk = fileURLToPath(new URL('../sdk/python', import.meta.url));
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(sdk)})
from iobeacons import IoBeacons, IoBeaconsError
io = IoBeacons(${JSON.stringify(key)}, base_url=${JSON.stringify(apiRoot)})
assert io.me()["key"]["name"] == "sdk test"
m = io.create_map({"name": "From Python"})
l = io.create_layer(m["id"], {"name": "P"})
io.add_features(l["id"], {"type": "Feature", "geometry": {"type": "Point", "coordinates": [3, 4]}, "properties": {"n": 1}})
assert len(io.list_features(l["id"])["features"]) == 1
assert b"n" in io.export_layer(l["id"], "csv")
assert io.send_positions("py-truck", {"lon": -95.9, "lat": 36.1})["stored"] == 1
assert io.satellite_position(25544, time=None)["name"] == "ISS (ZARYA)"
assert io.space_group_positions("stations")["features"]
try:
    io.get_map("00000000-0000-0000-0000-000000000000")
    raise SystemExit("expected an error")
except IoBeaconsError as e:
    assert e.status == 404
print("ok", io.quota["remaining"])
`;
  // async, so this process's server can answer while Python waits
  const { stdout: out } = await promisify(execFile)('python3', ['-I', '-c', script], { encoding: 'utf8' });
  assert.match(out, /^ok \d+/);
});
