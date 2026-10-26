import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { generateKeys, signText } from '../src/crypto.js';
import { stopChallengeMessage } from '../public/canonical.js';
import { ProgramService } from '../src/program.js';

const ENV = { DISPATCH_TOKEN: 'test-dispatch', OFFICER_ENROLL_CODE: 'test-code', ADMIN_TOKEN: 'test-admin', STATE_ISSUER_TOKEN: 'test-state', COSYNE_DEMO: 'off' };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosyne-program-'));
let app; let base; let staff;

before(async () => {
  app = createApp({ dataDir, env: ENV, simulate: false, pushSender: async () => {} });
  base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
  staff = (await api('POST', '/api/state/login', { token: 'test-state', name: 'Pat Clerk' })).body.token;
});
after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

async function api(method, p, body, token, headers = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: res.status, body: json, text };
}
async function connect(hello) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const inbox = []; const waiters = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); inbox.push(m); for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } });
  const waitFor = (pred) => { const f = inbox.find(pred); return f ? Promise.resolve(f) : new Promise((resolve) => waiters.push({ pred, resolve })); };
  const { nonce } = await waitFor((m) => m.t === 'challenge');
  ws.send(JSON.stringify(hello(nonce)));
  return { ws, ok: await waitFor((m) => m.t === 'hello_ok' || m.t === 'error') };
}
const application = (jurisdiction, licenseNumber, plate, keys, extra = {}) => ({
  jurisdiction, consent: true, publicJwk: keys?.publicJwk, payment: { last4: '4242' },
  applicant: { name: 'Riley Nguyen', dob: '1990-05-01', licenseNumber, email: 'riley@example.com', address: { street: '1 Main St', city: 'Tulsa', county: 'Tulsa', zip: '74103' }, ...extra },
  vehicle: { plate, year: 2020, make: 'Toyota', model: 'Corolla', color: 'Gray' },
});

// Apply, verify identity, approve and issue; returns the application and its credential.
async function enroll(jurisdiction, licenseNumber, plate) {
  const keys = generateKeys();
  const { body: a } = await api('POST', '/api/program/apply', application(jurisdiction, licenseNumber, plate, keys));
  await api('POST', `/api/state/applications/${a.id}/verify`, null, staff);
  await api('POST', `/api/state/applications/${a.id}/approve`, null, staff);
  const { body: issued } = await api('POST', `/api/state/applications/${a.id}/issue`, null, staff);
  const { body: st } = await api('GET', `/api/program/applications/${a.id}`, null, null, { 'x-application-token': a.token });
  return { keys, id: a.id, token: a.token, credential: st.credential, stickerId: issued.stickerId };
}

test('fee split: $24.99 a year, $9.50 to the state and $15.49 for administration, exact in totals', () => {
  const p = new ProgramService({ dataDir: null, jurisdictions: [] });
  const s = p.split();
  assert.equal(s.stateShareRounded, 9.5);
  assert.equal(s.adminFeeRounded, 15.49);
  assert.equal(Math.round(s.stateShare * 10000 * 100) / 100, 94962, '10,000 enrollments send $94,962 to the state');
});

test('program: only REAL ID-verified residents can be approved, and the fee is charged on approval', async () => {
  const info = (await api('GET', '/api/program/info')).body;
  assert.deepEqual(info.jurisdictions.map((j) => j.code).sort(), ['OK', 'TX']);
  assert.equal(info.fee, 24.99);
  assert.equal((await api('POST', '/api/program/apply', { ...application('OK', 'D1234568', 'RNG100'), consent: false })).status, 400, 'consent required');

  // A license ending in an odd digit is a standard (non-REAL ID) license in the simulation.
  const { body: a } = await api('POST', '/api/program/apply', application('OK', 'D1234567', 'RNG101'));
  assert.equal(a.status, 'submitted');
  assert.equal((await api('POST', `/api/state/applications/${a.id}/approve`, null, staff)).status, 409, 'cannot approve before the identity check');
  const v = await api('POST', `/api/state/applications/${a.id}/verify`, null, staff);
  assert.equal(v.body.realId.ok, false);
  assert.equal(v.body.realId.simulated, true);
  assert.equal((await api('POST', `/api/state/applications/${a.id}/approve`, null, staff)).status, 409, 'a non-REAL ID license cannot be approved');
  assert.equal((await api('POST', `/api/state/applications/${a.id}/decline`, { reason: 'Requires a REAL ID-compliant license' }, staff)).body.status, 'declined');
  assert.equal(app.ledger.entries.filter((e) => e.type === 'program_payment' && e.data.applicationId === a.id).length, 0, 'a declined applicant is never charged');

  const ok = await enroll('OK', 'D2468024', 'RNG102');
  assert.ok(ok.credential, 'credential issued for the device key');
  assert.equal(ok.credential.issuer, 'service-ok');
  assert.equal(ok.credential.subject.realId, true);
  const pay = app.ledger.entries.find((e) => e.type === 'program_payment' && e.data.applicationId === ok.id);
  assert.equal(pay.data.amount, 24.99);
  assert.ok(!JSON.stringify(pay).includes('Riley'), 'no personal details in the ledger');
  const days = (Date.parse(ok.credential.expiresAt) - Date.now()) / 86400_000;
  assert.ok(days > 364 && days <= 365, 'expires one year after issue');

  const rev = (await api('GET', '/api/state/revenue?jurisdiction=OK', null, staff)).body;
  assert.equal(rev.totals.count, 1);
  assert.equal(rev.totals.stateShare, 9.5);
  assert.equal(rev.totals.adminFee, 15.49);
  const csv = await api('GET', '/api/state/revenue?jurisdiction=OK&format=csv', null, staff);
  assert.match(csv.text, /^date,payment,application,kind,jurisdiction,county,amount,state_share,program_administration/);
  assert.match(csv.text, /,24\.99,9\.4962,15\.4938,/);
  assert.equal((await api('GET', '/api/state/overview')).status, 401);
});

test('program: stickers verify at a stop; expiry, revocation and reissue fail verification; cross-state works', async () => {
  const officerKeys = generateKeys();
  const { body: o } = await api('POST', '/api/enroll', { type: 'officer', subject: { name: 'Ofc. Sam Ortiz', badge: '77', unit: 'Patrol 7', agencyId: 'tulsa-pd' }, publicJwk: officerKeys.publicJwk, enrollCode: 'test-code' });
  const officer = await connect((nonce) => ({ t: 'hello', role: 'officer', credential: o.credential, signature: signText(officerKeys.privateJwk, stopChallengeMessage('session', nonce, 'officer')) }));
  const stop = (stickerId) => api('POST', '/api/stops', { stickerId, reason: 'Speeding' }, officer.ok.token);

  // Cross-state: a Texas resident's credential verifies on an Oklahoma officer's terminal.
  const tx = await enroll('TX', 'T8642086', 'TXR200');
  assert.equal(tx.credential.issuer, 'tx-demo');
  const txStop = await stop(tx.stickerId);
  assert.equal(txStop.status, 200);
  assert.equal(txStop.body.driver.jurisdiction, 'TX');
  assert.equal(txStop.body.driver.issuer, 'State of Texas (demo issuer)');
  await api('POST', `/api/stops/${txStop.body.id}/end`, { outcome: 'no_action' }, officer.ok.token);

  // Reissue (lost sticker): the old QR stops working, the new one works.
  const ok = await enroll('OK', 'D1357902', 'OKR300');
  const re = await api('POST', `/api/state/applications/${ok.id}/reissue`, { reason: 'lost_sticker' }, staff);
  assert.notEqual(re.body.stickerId, ok.stickerId);
  assert.equal((await stop(ok.stickerId)).status, 404, 'the old sticker is void');
  const s2 = await stop(re.body.stickerId);
  assert.equal(s2.status, 200);
  await api('POST', `/api/stops/${s2.body.id}/end`, { outcome: 'no_action' }, officer.ok.token);

  // Revocation: the sticker and the credential no longer verify.
  await api('POST', `/api/state/applications/${ok.id}/revoke`, { reason: 'vehicle sold' }, staff);
  assert.equal((await stop(re.body.stickerId)).status, 404);
  assert.equal(app.identity.verifyCredential(ok.credential, 'driver').ok, false);

  // Expiry: an expired credential fails verification.
  const expired = app.identity.issue({ issuerId: 'tx-demo', type: 'driver', subject: tx.credential.subject, subjectKey: tx.credential.subjectKey, ttlDays: -1 });
  assert.equal(app.identity.verifyCredential(expired, 'driver').reason, 'credential expired');

  // A web applicant gets an activation code; until activation the sticker can't open a stop.
  const { body: web } = await api('POST', '/api/program/apply', application('OK', 'D9753108', 'WEB400'));
  await api('POST', `/api/state/applications/${web.id}/verify`, null, staff);
  await api('POST', `/api/state/applications/${web.id}/approve`, null, staff);
  const issued = (await api('POST', `/api/state/applications/${web.id}/issue`, null, staff)).body;
  assert.match(issued.activationCode, /^[0-9A-F]{10}$/);
  assert.equal((await stop(issued.stickerId)).status, 409, 'not activated yet');
  const keys = generateKeys();
  const act = await api('POST', '/api/program/activate', { code: issued.activationCode, publicJwk: keys.publicJwk });
  assert.equal(act.status, 200);
  assert.equal(act.body.credential.subjectKey.x, keys.publicJwk.x);
  assert.equal((await api('POST', '/api/program/activate', { code: issued.activationCode, publicJwk: keys.publicJwk })).status, 404, 'the code works once');
  const s3 = await stop(issued.stickerId);
  assert.equal(s3.status, 200);
  officer.ws.close();
});

test('program: renewal extends the term and records a second payment', async () => {
  const ok = await enroll('OK', 'D1122334', 'REN500');
  assert.equal((await api('POST', `/api/program/applications/${ok.id}/renew`, { payment: { last4: '4242' } }, null, { 'x-application-token': ok.token })).status, 409, 'too early to renew');
  // Move the expiry into the renewal window.
  const rec = app.program.get(ok.id);
  rec.expiresAt = new Date(Date.now() + 20 * 86400_000).toISOString();
  const r = await api('POST', `/api/program/applications/${ok.id}/renew`, { payment: { last4: '4242' } }, null, { 'x-application-token': ok.token });
  assert.equal(r.status, 200);
  const days = (Date.parse(r.body.credential.expiresAt) - Date.now()) / 86400_000;
  assert.ok(days > 384 && days <= 385, 'a year is added to the remaining term');
  assert.equal(app.program.payments.filter((p) => p.applicationId === ok.id).length, 2);
  assert.equal((await api('GET', `/api/program/applications/${ok.id}`, null, null, { 'x-application-token': 'wrong' })).status, 403);
});
