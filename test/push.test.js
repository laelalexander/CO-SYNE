import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { generateKeys, signText } from '../src/crypto.js';
import { stopChallengeMessage } from '../public/canonical.js';
import { citationSigningPayload } from '../src/ticketing.js';

// Stand-in for the push service: records what would be sent to each phone.
const sent = [];
let failFor = null; // endpoint that answers 410 Gone
const sender = async (sub, body, opts) => {
  if (sub.endpoint === failFor) throw Object.assign(new Error('gone'), { statusCode: 410 });
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body), opts });
};
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosyne-push-'));
const ENV = { DISPATCH_TOKEN: 'test-dispatch', OFFICER_ENROLL_CODE: 'test-code', ADMIN_TOKEN: 'test-admin', COSYNE_DEMO: 'off' };
let app; let base;

before(async () => {
  app = createApp({ dataDir, env: ENV, simulate: false, pushSender: sender });
  base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
});
after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

async function api(method, p, body, token) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
async function connect(hello) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); inbox.push(m); for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } });
  const waitFor = (pred) => { const f = inbox.find(pred); return f ? Promise.resolve(f) : new Promise((resolve) => waiters.push({ pred, resolve })); };
  const { nonce } = await waitFor((m) => m.t === 'challenge');
  ws.send(JSON.stringify(hello(nonce)));
  return { ws, ok: await waitFor((m) => m.t === 'hello_ok' || m.t === 'error') };
}
async function enroll(type, subject, extra = {}) {
  const keys = generateKeys();
  const { body } = await api('POST', '/api/enroll', { type, subject, publicJwk: keys.publicJwk, ...extra });
  return { keys, credential: body.credential };
}
const hello = (role, h) => (nonce) => ({ t: 'hello', role, credential: h.credential, signature: signText(h.keys.privateJwk, stopChallengeMessage('session', nonce, role)) });
const fakeSub = (n) => ({ endpoint: `https://push.example.test/send/${n}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } });
const until = async (pred) => { for (let i = 0; i < 50 && !pred(); i++) await new Promise((r) => setTimeout(r, 10)); return pred(); };

test('push: VAPID key is public, subscribing needs a signed-in driver, and keys persist', async () => {
  const { body: key } = await api('GET', '/api/push/key');
  assert.match(key.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal((await api('POST', '/api/push/subscribe', { subscription: fakeSub('anon') })).status, 401);

  const driver = await enroll('driver', { name: 'Ana Ruiz', vehicle: { plate: 'ANA100' } });
  const d = await connect(hello('driver', driver));
  assert.equal((await api('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://insecure' } }, d.ok.token)).status, 400);
  assert.equal((await api('POST', '/api/push/subscribe', { subscription: fakeSub('ana') }, d.ok.token)).status, 200);
  assert.deepEqual(app.push.count(), { subscriptions: 1, holders: 1 });
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'push.json'), 'utf8'));
  assert.equal(saved.vapid.publicKey, key.publicKey, 'VAPID keys are stored in the data directory');
  assert.equal(saved.subscriptions[driver.credential.id][0].endpoint, fakeSub('ana').endpoint);
  const t = await api('POST', '/api/push/test', null, d.ok.token);
  assert.equal(t.body.delivered, 1);
  d.ws.close();
});

test('push: pull-over, citation and stop-ended alerts reach the driver phone; dead subscriptions are dropped', async () => {
  sent.length = 0;
  const officer = await enroll('officer', { name: 'Ofc. Lee Park', badge: '901', unit: 'Riverside 9', agencyId: 'tulsa-pd' }, { enrollCode: 'test-code' });
  const driver = await enroll('driver', { name: 'Bo Chen', licenseNumber: 'B1', vehicle: { plate: 'BOC-321' } });
  const d = await connect(hello('driver', driver));
  await api('POST', '/api/push/subscribe', { subscription: fakeSub('bo') }, d.ok.token);
  d.ws.close(); // the app is closed: only push can reach the phone

  const o = await connect(hello('officer', officer));
  const { body: stop } = await api('POST', '/api/stops', { plate: 'BOC321', reason: 'Speeding' }, o.ok.token);
  assert.equal(sent.length, 0, 'no alert until the officer has proved identity');
  await api('POST', `/api/stops/${stop.id}/prove`, { signature: signText(officer.keys.privateJwk, stopChallengeMessage(stop.id, stop.nonce, 'officer')) }, o.ok.token);
  assert.ok(await until(() => sent.length === 1));
  const pull = sent[0];
  assert.equal(pull.endpoint, fakeSub('bo').endpoint);
  assert.equal(pull.payload.kind, 'pullover');
  assert.equal(pull.payload.stopId, stop.id);
  assert.equal(pull.payload.url, `driver/?stop=${stop.id}`);
  assert.match(pull.payload.body, /Ofc\. Lee Park/);
  assert.match(pull.payload.body, /Speeding/);
  assert.equal(pull.opts.urgency, 'high');

  // Citations need the driver's identity: the driver confirms by proof.
  const d2 = await connect(hello('driver', driver));
  await api('POST', `/api/stops/${stop.id}/prove`, { signature: signText(driver.keys.privateJwk, stopChallengeMessage(stop.id, stop.nonce, 'driver')) }, d2.ok.token);
  const issuedAt = new Date().toISOString();
  const payload = citationSigningPayload({ stopId: stop.id, type: 'citation', violationCodes: ['SPD-10'], notes: '', issuedAt });
  const cit = await api('POST', `/api/stops/${stop.id}/citations`, { type: 'citation', violationCodes: ['SPD-10'], notes: '', issuedAt, signature: signText(officer.keys.privateJwk, payload) }, o.ok.token);
  assert.equal(cit.status, 200, JSON.stringify(cit.body));
  assert.ok(await until(() => sent.some((s) => s.payload.kind === 'citation')));
  assert.equal(sent.find((s) => s.payload.kind === 'citation').payload.url, 'driver/?tab=tickets');

  await api('POST', `/api/stops/${stop.id}/end`, { outcome: 'citation' }, o.ok.token);
  assert.ok(await until(() => sent.some((s) => s.payload.kind === 'ended')));

  // The phone uninstalled the app: the push service answers 410 Gone.
  failFor = fakeSub('bo').endpoint;
  const { body: login } = await api('POST', '/api/admin/login', { token: 'test-admin' });
  await api('POST', '/api/admin/broadcast', { text: 'Road closure on I-44', audience: 'driver' }, login.token);
  assert.ok(await until(() => !app.push.subs.has(driver.credential.id)), 'a 410 removes the subscription');
  assert.equal(app.push.count().subscriptions, 1, 'other phones keep theirs');
  // The phone re-sending the dead subscription is told to make a new one.
  const again = await api('POST', '/api/push/subscribe', { subscription: fakeSub('bo') }, d2.ok.token);
  assert.equal(again.status, 400);
  assert.match(again.body.error, /expired/);
  o.ws.close(); d2.ws.close();
});
