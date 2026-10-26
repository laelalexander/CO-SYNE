import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { generateKeys } from '../src/crypto.js';

const ENV = { DISPATCH_TOKEN: 'test-dispatch', OFFICER_ENROLL_CODE: 'test-code', ADMIN_TOKEN: 'test-admin', STATE_ISSUER_TOKEN: 'test-state', COSYNE_DEMO: 'on', PUBLIC_URL: 'https://example.test/cosyne' };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosyne-demo-'));
let app; let base; let admin;

const api = async (b, method, p, body, token) => {
  const res = await fetch(b + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
async function hello(b, msg) {
  const ws = new WebSocket(b.replace('http', 'ws') + '/ws');
  const got = await new Promise((resolve) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'challenge') ws.send(JSON.stringify(msg));
      if (m.t === 'hello_ok' || m.t === 'error') resolve(m);
    });
  });
  ws.close();
  return got;
}
const passOf = (kit, module) => kit.find((k) => k.module === module).link.split('#demo=')[1];
const prepare = async () => (await api(base, 'POST', '/api/admin/demo/prepare', { officerKey: 'dana-rivera' }, admin)).body;

before(async () => {
  app = createApp({ dataDir, env: ENV, simulate: false, pushSender: async () => {} });
  base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
  admin = (await api(base, 'POST', '/api/admin/login', { token: 'test-admin', name: 'Test Admin' })).body.token;
});
after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('demo control: one link per module, each signs in once, without typing a code', async () => {
  assert.equal((await api(base, 'POST', '/api/admin/demo/prepare', {})).status, 401, 'admin only');
  const { kit, activationCode } = await prepare();
  assert.deepEqual(kit.map((k) => k.module), ['dispatch', 'officer', 'state', 'driver', 'driver-pending']);
  assert.ok(kit.every((k) => k.link.startsWith('https://example.test/cosyne/') && k.qr.startsWith('<svg')));
  assert.match(activationCode, /^[0-9A-F]{10}$/);

  // Wrong module: refused, and the link is not used up.
  assert.equal((await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'dispatch'), module: 'state' })).status, 409);
  const d = await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'dispatch'), module: 'dispatch' });
  assert.equal(d.status, 200);
  assert.notEqual(d.body.dispatch.token, 'test-dispatch', 'never hands out the real code');
  assert.equal((await hello(base, { t: 'hello', role: 'dispatch', token: d.body.dispatch.token, name: 'Demo' })).t, 'hello_ok');
  // Single use.
  const again = await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'dispatch'), module: 'dispatch' });
  assert.equal(again.status, 410);
  assert.match(again.body.error, /already been used/);

  const st = await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'state'), module: 'state' });
  assert.equal((await api(base, 'GET', '/api/state/overview?jurisdiction=OK', null, st.body.state.token)).status, 200);

  const off = await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'officer'), module: 'officer' });
  assert.equal(off.body.officer.credential.subject.name, app.samples.officers.find((o) => o.key === 'dana-rivera').credential.subject.name);

  // The approved driver is issued by the state program, bound to the phone's key.
  const keys = generateKeys();
  assert.equal((await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'driver'), module: 'driver' })).status, 400, 'needs a device key');
  const dr = await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'driver'), module: ['driver', 'driver-pending'], publicJwk: keys.publicJwk });
  assert.equal(dr.body.module, 'driver');
  assert.equal(dr.body.driver.credential.subject.realId, true);
  assert.equal(dr.body.driver.credential.subjectKey.x, keys.publicJwk.x);
  assert.equal(app.program.get(dr.body.driver.membership.id).status, 'active');
  assert.ok((await api(base, 'GET', '/api/samples')).body.kitDrivers.some((x) => x.stickerId === dr.body.driver.stickerId), 'officer can simulate a scan of the demo driver');

  // The pending driver waits for the state's approval.
  const pk = generateKeys();
  const pe = await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'driver-pending'), module: ['driver', 'driver-pending'], publicJwk: pk.publicJwk });
  assert.equal(app.program.get(pe.body.pending.id).status, 'submitted');

  const types = app.ledger.entries.map((e) => e.type);
  assert.ok(types.includes('demo_kit_prepared') && types.includes('demo_link_used'));
  assert.ok(!JSON.stringify(app.ledger.entries.filter((e) => e.type.startsWith('demo_'))).includes(passOf(kit, 'state')), 'no secrets in the ledger');
});

test('demo control: links and dispatch sign-ins expire', async () => {
  const { kit } = await prepare();
  const d = await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'dispatch'), module: 'dispatch' });
  for (const p of app.demo.passes) p.expiresAt = new Date(Date.now() - 1000).toISOString();
  for (const g of app.demo.grants) g.expiresAt = new Date(Date.now() - 1000).toISOString();
  const r = await api(base, 'POST', '/api/demo/redeem', { pass: passOf(kit, 'state'), module: 'state' });
  assert.equal(r.status, 410);
  assert.match(r.body.error, /expired/);
  assert.equal((await hello(base, { t: 'hello', role: 'dispatch', token: d.body.dispatch.token, name: 'Demo' })).t, 'error');
});

test('demo control: revoke all, and a new kit replaces unused links', async () => {
  const first = await prepare();
  const second = await prepare();
  assert.equal((await api(base, 'POST', '/api/demo/redeem', { pass: passOf(first.kit, 'state'), module: 'state' })).status, 410, 'replaced');
  const d = await api(base, 'POST', '/api/demo/redeem', { pass: passOf(second.kit, 'dispatch'), module: 'dispatch' });
  const r = await api(base, 'POST', '/api/admin/demo/revoke', null, admin);
  assert.ok(r.body.revoked >= 4);
  assert.match((await api(base, 'POST', '/api/demo/redeem', { pass: passOf(second.kit, 'state'), module: 'state' })).body.error, /revoked/);
  assert.equal((await hello(base, { t: 'hello', role: 'dispatch', token: d.body.dispatch.token, name: 'Demo' })).t, 'error', 'demo dispatch sign-ins end too');
  assert.equal((await hello(base, { t: 'hello', role: 'dispatch', token: 'test-dispatch', name: 'Real' })).t, 'hello_ok', 'the real code still works');
});

test('demo control: reset backs up data, clears the demo and re-seeds the state program', async () => {
  const r = await api(base, 'POST', '/api/admin/demo/reset', null, admin);
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(path.join(dataDir, r.body.backup, 'program.json')), 'backup written first');
  assert.equal(r.body.seeded, 9);
  assert.equal(app.program.apps.size, 9);
  assert.equal(app.stops.size, 0);
  assert.equal(app.program.counts().active, 3);
});

test('demo control: refused when demo mode is off', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosyne-demo-off-'));
  const off = createApp({ dataDir: dir, env: { ...ENV, COSYNE_DEMO: 'off' }, simulate: false, pushSender: async () => {} });
  const b = `http://127.0.0.1:${await off.listen(0, '127.0.0.1')}`;
  try {
    const tok = (await api(b, 'POST', '/api/admin/login', { token: 'test-admin', name: 'A' })).body.token;
    assert.equal((await api(b, 'POST', '/api/admin/demo/prepare', {}, tok)).status, 403);
    assert.equal((await api(b, 'POST', '/api/admin/demo/reset', null, tok)).status, 403);
    assert.equal((await api(b, 'POST', '/api/demo/redeem', { pass: 'dp_anything' })).status, 403);
    assert.equal((await api(b, 'GET', '/api/admin/demo', null, tok)).body.enabled, false);
  } finally { await off.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
