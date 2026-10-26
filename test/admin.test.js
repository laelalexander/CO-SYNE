import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { generateKeys, signText } from '../src/crypto.js';
import { stopChallengeMessage } from '../public/canonical.js';

const ENV = { DISPATCH_TOKEN: 'test-dispatch', OFFICER_ENROLL_CODE: 'test-code', ADMIN_TOKEN: 'test-admin', PUBLIC_URL: 'https://example.test/cosyne', COSYNE_DEMO: 'off' };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosyne-admin-'));
let app; let base;

async function boot() {
  app = createApp({ dataDir, env: ENV, simulate: false });
  base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
}
before(boot);
after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

async function api(method, p, body, token) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

async function connect(hello) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  const waitFor = (pred, ms = 2000) => {
    const found = inbox.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => { waiters.push({ pred, resolve }); setTimeout(() => reject(new Error('timed out waiting for message')), ms).unref(); });
  };
  const { nonce } = await waitFor((m) => m.t === 'challenge');
  ws.send(JSON.stringify(hello(nonce)));
  const ok = await waitFor((m) => m.t === 'hello_ok' || m.t === 'error');
  return { ws, inbox, waitFor, ok, closed };
}

const login = async () => (await api('POST', '/api/admin/login', { token: 'test-admin', name: 'Test Admin' })).body.token;

test('admin sign-in rejects a wrong code and every admin route requires the admin role', async () => {
  const bad = await api('POST', '/api/admin/login', { token: 'nope' });
  assert.equal(bad.status, 403);
  assert.equal((await api('GET', '/api/admin/overview')).status, 401);
  // A dispatch session is not an admin session.
  const d = await connect(() => ({ t: 'hello', role: 'dispatch', token: 'test-dispatch', name: 'D' }));
  assert.equal((await api('GET', '/api/admin/overview', null, d.ok.token)).status, 403);
  d.ws.close();
  const cfg = (await api('GET', '/api/config')).body;
  assert.equal(cfg.adminHint, null, 'a configured admin code is never hinted');
});

test('admin overview, credential registry, revoke and reinstate', async () => {
  const token = await login();
  const keys = generateKeys();
  const { body: enrolled } = await api('POST', '/api/enroll', { type: 'driver', subject: { name: 'Pat Doe', licenseNumber: 'P1', vehicle: { plate: 'pat-001' } }, publicJwk: keys.publicJwk });
  const driver = await connect((nonce) => ({ t: 'hello', role: 'driver', credential: enrolled.credential, signature: signText(keys.privateJwk, stopChallengeMessage('session', nonce, 'driver')) }));
  assert.equal(driver.ok.t, 'hello_ok');

  const { body: o } = await api('GET', '/api/admin/overview', null, token);
  assert.equal(o.system.persistent, true);
  assert.equal(o.counts.devices.driver, 1);
  assert.equal(o.ledger.ok, true);
  assert.deepEqual(o.modules.map((m) => m.id), ['driver', 'officer', 'dispatch']);
  assert.ok(o.warnings.some((w) => /TURN/.test(w.text)));

  const { body: list } = await api('GET', '/api/admin/credentials', null, token);
  const row = list.credentials.find((c) => c.id === enrolled.credential.id);
  assert.equal(row.status, 'valid');
  assert.equal(row.online, true);
  assert.equal(row.plate, 'PAT001');

  // Revoking signs the device out at once and its next sign-in fails.
  assert.equal((await api('POST', `/api/admin/credentials/${row.id}/revoke`, { reason: 'lost phone' }, token)).status, 200);
  const err = await driver.waitFor((m) => m.t === 'error' && m.ref === 'revoked');
  assert.match(err.error, /lost phone/);
  assert.equal(await driver.closed, 4003);
  const again = await connect((nonce) => ({ t: 'hello', role: 'driver', credential: enrolled.credential, signature: signText(keys.privateJwk, stopChallengeMessage('session', nonce, 'driver')) }));
  assert.equal(again.ok.t, 'error');
  again.ws.close();

  assert.equal((await api('POST', `/api/admin/credentials/${row.id}/reinstate`, null, token)).status, 200);
  const back = await connect((nonce) => ({ t: 'hello', role: 'driver', credential: enrolled.credential, signature: signText(keys.privateJwk, stopChallengeMessage('session', nonce, 'driver')) }));
  assert.equal(back.ok.t, 'hello_ok');
  back.ws.close();
  const types = app.ledger.entries.map((e) => e.type);
  assert.ok(types.includes('admin_signed_in') && types.includes('credential_revoked') && types.includes('credential_reinstated'));
});

test('broadcast reaches the chosen audience, pinned notices reach later sign-ins, devices can be reset', async () => {
  const token = await login();
  const d = await connect(() => ({ t: 'hello', role: 'dispatch', token: 'test-dispatch', name: 'Morgan' }));
  const r = await api('POST', '/api/admin/broadcast', { text: 'Maintenance at 2 AM', level: 'warn', audience: 'dispatch', pinned: true }, token);
  assert.equal(r.status, 200);
  assert.equal(r.body.delivered, 1);
  const n = await d.waitFor((m) => m.t === 'notice');
  assert.equal(n.text, 'Maintenance at 2 AM');
  const late = await connect(() => ({ t: 'hello', role: 'dispatch', token: 'test-dispatch', name: 'Late' }));
  await late.waitFor((m) => m.t === 'notice' && m.text === 'Maintenance at 2 AM');
  late.ws.close();

  const { body: net } = await api('GET', '/api/admin/devices', null, token);
  const peer = net.devices.find((x) => x.name === 'Morgan');
  assert.equal((await api('POST', `/api/admin/devices/${peer.peerId}/disconnect`, null, token)).status, 200);
  assert.equal(await d.closed, 4001);
});

test('modules: list, launchers and QR codes point at the public URL', async () => {
  const { body: mods } = await api('GET', '/api/modules');
  assert.equal(mods.base, 'https://example.test/cosyne');
  assert.equal(mods.modules.length, 3);
  assert.equal(mods.modules[0].installUrl, 'https://example.test/cosyne/driver/?install=1');

  const cmd = await api('GET', '/downloads/CO-SYNE-Officer-Terminal-Kiosk.cmd');
  assert.equal(cmd.status, 200);
  assert.match(cmd.headers.get('content-disposition'), /attachment; filename="CO-SYNE-Officer-Terminal-Kiosk.cmd"/);
  assert.match(cmd.text, /--app="https:\/\/example\.test\/cosyne\/officer\/"/);
  assert.match(cmd.text, /--kiosk/);
  assert.ok(cmd.text.includes('\r\n'), 'Windows line endings');

  const all = await api('GET', '/downloads/CO-SYNE-Network.sh');
  for (const id of ['driver', 'officer', 'dispatch']) assert.match(all.text, new RegExp(`open_app ${id} `));
  assert.equal((await api('GET', '/downloads/CO-SYNE-Driver-Kiosk.cmd')).status, 404, 'only the officer terminal has a kiosk launcher');
  assert.equal((await api('GET', '/downloads/evil.cmd')).status, 404);

  const qr = await api('GET', '/downloads/qr.svg?app=driver');
  assert.equal(qr.status, 200);
  assert.match(qr.text, /^<svg/);
  for (const p of ['/admin/', '/downloads/']) assert.equal((await fetch(base + p)).status, 200);
});

test('ledger export and the credential registry survive a restart', async () => {
  const token = await login();
  const exp = await api('GET', '/api/admin/ledger/export', null, token);
  assert.equal(exp.status, 200);
  const lines = exp.text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].seq, 0);

  const keys = generateKeys();
  const { body: enrolled } = await api('POST', '/api/enroll', { type: 'driver', subject: { name: 'Kim Ray', vehicle: { plate: 'KIM777' } }, publicJwk: keys.publicJwk });
  const revokedId = (await api('GET', '/api/admin/credentials', null, token)).body.credentials.find((c) => c.name === 'Pat Doe').id;
  await api('POST', `/api/admin/credentials/${revokedId}/revoke`, { reason: 'test' }, token);

  await app.close();
  await boot();
  const st = await api('GET', `/api/stickers/${enrolled.stickerId}`);
  assert.equal(st.status, 200, 'enrolled sticker still resolves after restart');
  const t2 = await login();
  const list = (await api('GET', '/api/admin/credentials', null, t2)).body.credentials;
  assert.equal(list.find((c) => c.id === revokedId).status, 'revoked');
  assert.equal(list.find((c) => c.id === enrolled.credential.id).status, 'valid');
  assert.equal((await api('GET', '/api/ledger/verify')).body.ok, true);
});

test('website: contact form leads, rate limit, admin list, and the .php link', async () => {
  const php = await fetch(base + '/cosyne_index.php?x=1', { redirect: 'manual' });
  assert.equal(php.status, 301);
  assert.equal(php.headers.get('location'), 'cosyne_index.html?x=1');
  for (const p of ['/cosyne_index.html', '/cosyne_drivers.html', '/cosyne_agencies.html', '/cosyne_platform.html', '/cosyne_security.html', '/cosyne_contact.html', '/site/site.css', '/site/site.js']) {
    assert.equal((await fetch(base + p)).status, 200, p);
  }
  const img = await fetch(base + '/site/img/dispatch-map.jpg');
  assert.equal(img.headers.get('content-type'), 'image/jpeg');

  assert.equal((await api('POST', '/api/contact', { name: 'A', email: 'a@b.co', message: 'hello there' })).status, 400, 'name too short');
  assert.equal((await api('POST', '/api/contact', { name: 'Ann Lee', email: 'not-an-email', message: 'hello there' })).status, 400, 'bad email');
  const before = app.ledger.entries.length;
  const ok = await api('POST', '/api/contact', { name: 'Capt. Ann Lee', email: 'Ann.Lee@Example.gov', organization: 'Example PD', type: 'agency', message: 'We would like a demo for 40 units.', source: 'website' });
  assert.equal(ok.status, 200);
  const entry = app.ledger.entries[before];
  assert.equal(entry.type, 'lead_received');
  assert.ok(!JSON.stringify(entry).includes('Ann'), 'no personal details in the ledger');
  // The honeypot field is accepted but dropped.
  assert.equal((await api('POST', '/api/contact', { name: 'Bot', email: 'bot@spam.co', message: 'buy now', website: 'http://spam' })).status, 200);

  const token = await login();
  const { body } = await api('GET', '/api/admin/leads', null, token);
  assert.equal(body.leads.length, 1);
  assert.equal(body.leads[0].email, 'ann.lee@example.gov');
  assert.equal(body.leads[0].type, 'agency');
  assert.equal((await api('GET', '/api/admin/leads')).status, 401);
  const saved = fs.readFileSync(path.join(dataDir, 'leads.jsonl'), 'utf8').trim().split('\n');
  assert.equal(saved.length, 1);

  for (let i = 0; i < 4; i++) await api('POST', '/api/contact', { name: `Person ${i}`, email: `p${i}@example.com`, message: 'question here' });
  assert.equal((await api('POST', '/api/contact', { name: 'One more', email: 'm@example.com', message: 'question here' })).status, 429);
});

test('admin sign-in is rate limited after repeated failures', async () => {
  for (let i = 0; i < 10; i++) await api('POST', '/api/admin/login', { token: `wrong-${i}` });
  assert.equal((await api('POST', '/api/admin/login', { token: 'test-admin' })).status, 429);
});
