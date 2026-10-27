import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';

const ENV = { DISPATCH_TOKEN: 'test-dispatch', OFFICER_ENROLL_CODE: 'test-code', ADMIN_TOKEN: 'test-admin', STATE_ISSUER_TOKEN: 'test-state', COSYNE_DEMO: 'on' };
async function start(dataDir, env = ENV) {
  const app = createApp({ dataDir, env, simulate: false, pushSender: async () => {} });
  const base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
  const api = async (method, p, body, token) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const hello = (msg) => new Promise((resolve) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'challenge') ws.send(JSON.stringify(msg));
      if (m.t === 'hello_ok' || m.t === 'error') { ws.close(); resolve(m); }
    });
  });
  return { app, api, hello, close: () => app.close() };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cosyne-access-'));

test('admin password: change it, the old code stops working, sign-ins survive a restart, and deleting the file recovers', async () => {
  const dir = tmp();
  let s = await start(dir);
  const t = (await s.api('POST', '/api/admin/login', { token: 'test-admin', name: 'Lael' })).body.token;
  assert.equal((await s.api('POST', '/api/admin/password', { current: 'wrong', next: 'roadside1', confirm: 'roadside1' }, t)).status, 403);
  assert.equal((await s.api('POST', '/api/admin/password', { current: 'test-admin', next: 'short', confirm: 'short' }, t)).status, 400);
  assert.equal((await s.api('POST', '/api/admin/password', { current: 'test-admin', next: 'roadside1', confirm: 'other' }, t)).status, 400);
  assert.equal((await s.api('POST', '/api/admin/password', { current: 'test-admin', next: 'roadside1', confirm: 'roadside1' }, t)).status, 200);
  assert.equal((await s.api('POST', '/api/admin/login', { token: 'test-admin' })).status, 403, 'the old code no longer works');
  assert.equal((await s.api('POST', '/api/admin/login', { token: 'roadside1' })).status, 200);
  const saved = fs.readFileSync(path.join(dir, 'admin-auth.json'), 'utf8');
  assert.ok(!saved.includes('roadside1') && !saved.includes(t), 'only hashes are stored');
  assert.ok(s.app.ledger.entries.some((e) => e.type === 'admin_password_changed'));
  await s.close();

  // Restart: the 30-day sign-in still works and the password is kept.
  s = await start(dir);
  assert.equal((await s.api('GET', '/api/admin/overview', null, t)).status, 200, 'still signed in after a restart');
  assert.equal((await s.api('POST', '/api/admin/login', { token: 'roadside1' })).status, 200);
  await s.close();

  // Recovery: delete the file and restart; ADMIN_TOKEN works again.
  fs.rmSync(path.join(dir, 'admin-auth.json'));
  s = await start(dir);
  assert.equal((await s.api('POST', '/api/admin/login', { token: 'test-admin' })).status, 200);
  assert.equal((await s.api('POST', '/api/admin/login', { token: 'roadside1' })).status, 403);
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sign-in lockout: 25 failures pause sign-in', async () => {
  const dir = tmp();
  const s = await start(dir);
  for (let i = 0; i < 24; i++) await s.api('POST', '/api/admin/login', { token: `wrong-${i}` });
  assert.equal((await s.api('POST', '/api/admin/login', { token: 'test-admin' })).status, 200, 'still allowed after 24 mistakes');
  for (let i = 0; i < 25; i++) await s.api('POST', '/api/admin/login', { token: `wrong-${i}` });
  const r = await s.api('POST', '/api/admin/login', { token: 'test-admin' });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /5 minutes/);
  await s.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('open demo: modules sign in without codes while on; turning it off restores the codes', async () => {
  const dir = tmp();
  const s = await start(dir);
  assert.equal((await s.api('GET', '/api/config')).body.openDemo, true, 'on by default in demo mode');
  assert.equal((await s.hello({ t: 'hello', role: 'dispatch', token: 'open-demo', name: 'Demo' })).t, 'hello_ok');
  const st = await s.api('POST', '/api/state/login', { open: true, name: 'Demo office' });
  assert.equal(st.status, 200);
  assert.deepEqual(st.body.jurisdictions, ['OK', 'TX']);
  assert.equal((await s.api('POST', '/api/admin/login', { open: true })).status, 403, 'the Main Admin still needs its password');

  const t = (await s.api('POST', '/api/admin/login', { token: 'test-admin', name: 'Lael' })).body.token;
  assert.equal((await s.api('POST', '/api/admin/open-demo', { on: false })).status, 401);
  assert.equal((await s.api('POST', '/api/admin/open-demo', { on: false }, t)).body.openDemo, false);
  assert.equal((await s.api('GET', '/api/config')).body.openDemo, false);
  assert.equal((await s.hello({ t: 'hello', role: 'dispatch', token: 'open-demo', name: 'Demo' })).t, 'error');
  assert.equal((await s.api('POST', '/api/state/login', { open: true })).status, 403);
  assert.equal((await s.hello({ t: 'hello', role: 'dispatch', token: 'test-dispatch', name: 'Real' })).t, 'hello_ok', 'codes work as before');
  const types = s.app.ledger.entries.map((e) => e.type);
  assert.ok(types.includes('open_demo_off'));
  await s.api('POST', '/api/admin/open-demo', { on: true }, t);
  assert.equal((await s.api('GET', '/api/config')).body.openDemo, true);
  assert.ok(s.app.ledger.entries.some((e) => e.type === 'open_demo_on'));
  await s.close(); fs.rmSync(dir, { recursive: true, force: true });

  // Never without demo mode.
  const d2 = tmp();
  const p = await start(d2, { ...ENV, COSYNE_DEMO: 'off' });
  assert.equal((await p.api('GET', '/api/config')).body.openDemo, false);
  assert.equal((await p.hello({ t: 'hello', role: 'dispatch', token: 'open-demo', name: 'Demo' })).t, 'error');
  assert.equal((await p.api('POST', '/api/state/login', { open: true })).status, 403);
  await p.close(); fs.rmSync(d2, { recursive: true, force: true });
});
