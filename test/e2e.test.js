import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { generateKeys, signText } from '../src/crypto.js';
import { stopChallengeMessage } from '../public/canonical.js';
import { citationAckMessage, citationSigningPayload } from '../src/ticketing.js';

let app; let base; let wsBase;

before(async () => {
  app = createApp({
    dataDir: null,
    env: { DISPATCH_TOKEN: 'test-dispatch', OFFICER_ENROLL_CODE: 'test-code' },
    simulate: false,
    // Stand-in for Claude: a second-pass triage that adds EMS.
    classifyAI: async () => { await new Promise((r) => setTimeout(r, 100)); return ({ engine: 'claude', category: 'medical', priority: 1, services: ['ems'], rationale: 'test' }); },
  });
  const port = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});
after(() => app.close());

async function api(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

// A connected client that records every message it receives.
async function connect(hello) {
  const ws = new WebSocket(wsBase);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  const waitFor = (pred, ms = 2000) => {
    const found = inbox.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error('timed out waiting for message')), ms).unref();
    });
  };
  const { nonce } = await waitFor((m) => m.t === 'challenge');
  ws.send(JSON.stringify(hello(nonce)));
  const ok = await waitFor((m) => m.t === 'hello_ok' || m.t === 'error');
  return { ws, inbox, waitFor, ok, send: (m) => ws.send(JSON.stringify(m)) };
}

async function enroll(type, subject, extra = {}) {
  const keys = generateKeys();
  const { body } = await api('POST', '/api/enroll', { type, subject, publicJwk: keys.publicJwk, ...extra });
  return { keys, credential: body.credential };
}

const holderHello = (role, holder, extra = {}) => (nonce) => ({
  t: 'hello', role, credential: holder.credential, signature: signText(holder.keys.privateJwk, stopChallengeMessage('session', nonce, role)), ...extra,
});

test('full traffic stop: mutual verification, video signaling, evidence, ledger', async () => {
  const officer = await enroll('officer', { name: 'Ofc. Dana Rivera', badge: '4471', unit: 'Patrol 9', agencyId: 'tulsa-pd' }, { enrollCode: 'test-code' });
  const driver = await enroll('driver', { name: 'Sam Lee', licenseNumber: 'D123', vehicle: { plate: 'abc-123', make: 'Honda', model: 'Civic', color: 'Blue' }, accessibility: 'Hard of hearing' });
  assert.ok(officer.credential && driver.credential);

  const bad = await api('POST', '/api/enroll', { type: 'officer', subject: { name: 'Fake' }, publicJwk: generateKeys().publicJwk, enrollCode: 'nope' });
  assert.equal(bad.status, 403);

  const dispatch = await connect(() => ({ t: 'hello', role: 'dispatch', token: 'test-dispatch' }));
  const o = await connect(holderHello('officer', officer, { location: { lat: 36.154, lng: -95.993 } }));
  const d = await connect(holderHello('driver', driver));
  assert.equal(o.ok.t, 'hello_ok');
  assert.equal(d.ok.t, 'hello_ok');

  // Signing in with someone else's credential fails.
  const imposter = await connect((nonce) => ({ t: 'hello', role: 'officer', credential: officer.credential, signature: signText(generateKeys().privateJwk, stopChallengeMessage('session', nonce, 'officer')) }));
  assert.equal(imposter.ok.t, 'error');

  // Officer initiates and proves.
  const created = await api('POST', '/api/stops', { plate: 'ABC123' }, o.ok.token);
  assert.equal(created.status, 200);
  const stop = created.body;
  const proof = await api('POST', `/api/stops/${stop.id}/prove`, { signature: signText(officer.keys.privateJwk, stopChallengeMessage(stop.id, stop.nonce, 'officer')) }, o.ok.token);
  assert.equal(proof.body.status, 'awaiting_driver');

  // Driver is notified with the verified officer and the credential to check locally.
  const onDriver = await d.waitFor((m) => m.t === 'stop' && m.stop.id === stop.id);
  assert.equal(onDriver.stop.officer.badge, '4471');
  assert.equal(onDriver.stop.officerCredential.id, officer.credential.id);
  assert.equal(onDriver.stop.driver, undefined);

  // Driver proves; officer now sees verified license/registration.
  const dProof = await api('POST', `/api/stops/${stop.id}/prove`, { signature: signText(driver.keys.privateJwk, stopChallengeMessage(stop.id, stop.nonce, 'driver')) }, d.ok.token);
  assert.equal(dProof.body.status, 'verified');
  const onOfficer = await o.waitFor((m) => m.t === 'stop' && m.stop.status === 'verified');
  assert.equal(onOfficer.stop.driver.licenseNumber, 'D123');
  assert.equal(onOfficer.stop.driver.accessibility, 'Hard of hearing');

  // Video room + signaling relay.
  const room = `stop:${stop.id}`;
  o.send({ t: 'join', room });
  await o.waitFor((m) => m.t === 'room_peers');
  d.send({ t: 'join', room });
  const peers = await d.waitFor((m) => m.t === 'room_peers');
  assert.equal(peers.peers.length, 1);
  d.send({ t: 'signal', room, to: peers.peers[0].id, data: { sdp: 'offer' } });
  const sig = await o.waitFor((m) => m.t === 'signal');
  assert.deepEqual(sig.data, { sdp: 'offer' });

  // Evidence hash anchoring and stop end.
  const ev = await api('POST', '/api/evidence', { ref: stop.id, sha256: 'a'.repeat(64), kind: 'video', bytes: 1000 }, o.ok.token);
  assert.equal(ev.body.entry.type, 'evidence_anchored');
  await api('POST', `/api/stops/${stop.id}/end`, { outcome: 'warning' }, o.ok.token);

  const trail = await api('GET', `/api/ledger?ref=${stop.id}`, null, dispatch.ok.token);
  const types = trail.body.entries.map((e) => e.type);
  for (const t of ['stop_initiated', 'stop_identity_verified', 'stop_mutually_verified', 'video_joined', 'evidence_anchored', 'stop_ended']) assert.ok(types.includes(t), t);
  assert.equal((await api('GET', '/api/ledger/verify')).body.ok, true);

  for (const c of [dispatch, o, d, imposter]) c.ws.close();
});

test('revoked officer cannot complete a stop and driver is warned', async () => {
  const officer = await enroll('officer', { name: 'Ofc. Revoked', badge: '9', agencyId: 'tulsa-pd' }, { enrollCode: 'test-code' });
  const driver = await enroll('driver', { name: 'Pat', licenseNumber: 'D9', vehicle: { plate: 'ZZZ999' } });
  const dispatch = await connect(() => ({ t: 'hello', role: 'dispatch', token: 'test-dispatch' }));
  const o = await connect(holderHello('officer', officer));
  const d = await connect(holderHello('driver', driver));
  const { body: stop } = await api('POST', '/api/stops', { plate: 'ZZZ999', location: { lat: 36.10, lng: -95.97 } }, o.ok.token);
  await api('POST', `/api/credentials/${officer.credential.id}/revoke`, { reason: 'suspended' }, dispatch.ok.token);
  // Revocation also kills the officer's session token.
  const res = await api('POST', `/api/stops/${stop.id}/prove`, { signature: 'x' }, o.ok.token);
  assert.equal(res.status, 401);
  for (const c of [dispatch, o, d]) c.ws.close();
});

test('driver alert is routed, AI second pass adds responders, location streams', async () => {
  const driver = await enroll('driver', { name: 'Ana', licenseNumber: 'D5', vehicle: { plate: 'MED111' } });
  const dispatch = await connect(() => ({ t: 'hello', role: 'dispatch', token: 'test-dispatch' }));
  const d = await connect(holderHello('driver', driver));
  const { body: alert } = await api('POST', '/api/alerts', { type: 'crash', description: 'rear-ended at a light', location: { lat: 36.155, lng: -95.992 } }, d.ok.token);
  assert.equal(alert.driverVerified, true);
  assert.equal(alert.triage.engine, 'rules');
  assert.equal(alert.status, 'dispatched');
  assert.ok(alert.assignments.some((a) => a.service === 'police'));
  assert.equal(alert.center.id, 'tulsa-911');

  const updated = await dispatch.waitFor((m) => m.t === 'alert' && m.alert.id === alert.id && m.alert.triage.engine === 'claude');
  assert.equal(updated.alert.triage.priority, 1);

  d.send({ t: 'location', lat: 36.156, lng: -95.991 });
  const moved = await dispatch.waitFor((m) => m.t === 'alert' && m.alert.id === alert.id && m.alert.location.lat === 36.156);
  assert.ok(moved.alert.trail.length >= 2);

  // Anonymous alerts are accepted (never block an emergency) but flagged unverified.
  const anon = await api('POST', '/api/alerts', { type: 'medical', description: 'chest pain', location: { lat: 36.37, lng: -96.0 } });
  assert.equal(anon.body.driverVerified, false);
  assert.equal(anon.body.center.id, 'tcso-north');

  const res = await api('POST', `/api/alerts/${alert.id}/status`, { status: 'resolved' }, dispatch.ok.token);
  assert.equal(res.body.status, 'resolved');
  assert.ok(app.units.get(alert.assignments[0].unitId).status === 'available');
  for (const c of [dispatch, d]) c.ws.close();
});

test('QR sticker stop: scan, credential exchange, call, citation, acknowledgement, payment, report', async () => {
  const { body: samples } = await api('GET', '/api/samples');
  const maria = samples.drivers.find((d) => d.key === 'maria-gonzalez');
  const dana = samples.officers.find((o) => o.key === 'dana-rivera');
  const asHolder = (s) => ({ credential: s.credential, keys: { privateJwk: s.privateJwk } });
  const dispatch = await connect(() => ({ t: 'hello', role: 'dispatch', token: 'test-dispatch' }));
  const o = await connect(holderHello('officer', asHolder(dana), { location: { lat: 36.154, lng: -95.993 } }));
  const d = await connect(holderHello('driver', asHolder(maria)));

  const sticker = (await api('GET', `/api/stickers/${maria.stickerId}`)).body;
  assert.equal(sticker.plate, 'MGZ452');
  const qr = await fetch(`${base}/api/stickers/${maria.stickerId}/qr.svg`);
  assert.match(await qr.text(), /<svg/);
  const redirect = await fetch(`${base}/s/${maria.stickerId}`, { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), `../officer/?scan=${maria.stickerId}`);

  // Scan: the officer immediately gets the DMV-signed driver record and records checks.
  const { body: stop } = await api('POST', '/api/stops', { stickerId: maria.stickerId, reason: 'Expired registration' }, o.ok.token);
  assert.equal(stop.via, 'sticker');
  assert.equal(stop.driver.name, 'Maria Gonzalez');
  assert.equal(stop.checks.find((c) => c.label === 'Registration').ok, false);
  await api('POST', `/api/stops/${stop.id}/prove`, { signature: signText(dana.privateJwk, stopChallengeMessage(stop.id, stop.nonce, 'officer')) }, o.ok.token);

  // Driver sees the officer, the reason, and a ringing call.
  const onDriver = await d.waitFor((m) => m.t === 'stop' && m.stop.id === stop.id && m.stop.officer);
  assert.equal(onDriver.stop.reason, 'Expired registration');
  assert.equal(onDriver.stop.call.status, 'ringing');
  assert.equal(onDriver.stop.checks, undefined);
  await api('POST', `/api/stops/${stop.id}/prove`, { signature: signText(maria.privateJwk, stopChallengeMessage(stop.id, stop.nonce, 'driver')) }, d.ok.token);
  const accepted = await api('POST', `/api/stops/${stop.id}/call`, { decision: 'accepted' }, d.ok.token);
  assert.equal(accepted.body.call.status, 'accepted');

  // Dispatch drops in and is listed as a participant.
  dispatch.send({ t: 'join', room: `stop:${stop.id}` });
  await dispatch.waitFor((m) => m.t === 'stop' && m.stop.id === stop.id && m.stop.participants.some((p) => p.role === 'dispatch'));

  // Officer-signed citation; a tampered signature is rejected.
  const issuedAt = new Date().toISOString();
  const payload = citationSigningPayload({ stopId: stop.id, type: 'citation', violationCodes: ['REG-EXP'], notes: 'Tag expired 8/31', issuedAt });
  const bad = await api('POST', `/api/stops/${stop.id}/citations`, { type: 'citation', violationCodes: ['REG-EXP', 'SPD-25'], notes: 'Tag expired 8/31', issuedAt, signature: signText(dana.privateJwk, payload) }, o.ok.token);
  assert.equal(bad.status, 422);
  const { body: cit } = await api('POST', `/api/stops/${stop.id}/citations`, { type: 'citation', violationCodes: ['REG-EXP'], notes: 'Tag expired 8/31', issuedAt, signature: signText(dana.privateJwk, payload) }, o.ok.token);
  assert.equal(cit.totalFine, 132);
  assert.ok(cit.court.name);
  const onDriverCit = await d.waitFor((m) => m.t === 'stop' && m.stop.citations?.length === 1);
  assert.equal(onDriverCit.stop.citations[0].id, cit.id);

  const ack = await api('POST', `/api/citations/${cit.id}/ack`, { signature: signText(maria.privateJwk, citationAckMessage(cit.id, cit.hash)) }, d.ok.token);
  assert.ok(ack.body.ack);
  const paid = await api('POST', `/api/citations/${cit.id}/pay`, {}, d.ok.token);
  assert.equal(paid.body.status, 'paid');

  const { body: report } = await api('POST', `/api/stops/${stop.id}/file-report`, { narrative: 'Stopped for expired tag. Driver cooperative via text chat.' }, o.ok.token);
  assert.equal(report.disposition, 'citation');
  assert.equal(report.citations[0].acknowledged, true);
  assert.ok(report.timeline.some((e) => e.type === 'citation_issued'));
  const list = await api('GET', '/api/reports', null, dispatch.ok.token);
  assert.ok(list.body.reports.some((r) => r.id === report.id));
  assert.equal(app.stops.get(stop.id).status, 'ended');
  assert.equal((await api('GET', '/api/ledger/verify')).body.ok, true);

  // Records lookup by plate shows the stop and citation history, and is audited.
  const look = await api('GET', '/api/lookup?q=MGZ-452', null, o.ok.token);
  assert.equal(look.body.results.length, 1);
  assert.equal(look.body.results[0].profile.name, 'Maria Gonzalez');
  assert.ok(look.body.results[0].citations.some((c) => c.id === cit.id));
  assert.equal((await api('GET', '/api/lookup?q=MGZ452', null, d.ok.token)).status, 403);
  assert.ok(app.ledger.entries.some((e) => e.type === 'records_query'));
  for (const c of [dispatch, o, d]) c.ws.close();
});

test('dispatch network: unit status, manual assignment, ops channel, live ledger feed', async () => {
  const dana = app.samples.officers.find((x) => x.key === 'dana-rivera');
  const o = await connect(holderHello('officer', { credential: dana.credential, keys: { privateJwk: dana.privateJwk } }, { location: { lat: 36.154, lng: -95.993 } }));
  const dispatch = await connect(() => ({ t: 'hello', role: 'dispatch', token: 'test-dispatch', name: 'J. Morgan' }));
  const state = await dispatch.waitFor((m) => m.t === 'state' && m.network?.devices.some((x) => x.role === 'officer'));
  assert.ok(state.region.name.includes('Tulsa'));

  const st = await api('POST', '/api/units/me/status', { status: 'busy' }, o.ok.token);
  assert.equal(st.body.status, 'busy');
  await dispatch.waitFor((m) => m.t === 'ledger' && m.entry.type === 'unit_status');
  await api('POST', '/api/units/me/status', { status: 'available' }, o.ok.token);

  const { body: alert } = await api('POST', '/api/alerts', { type: 'breakdown', description: 'flat tire on I-44', location: { lat: 36.12, lng: -95.95 } });
  const assigned = await api('POST', `/api/alerts/${alert.id}/assign`, { unitId: o.ok.unitId }, dispatch.ok.token);
  assert.ok(assigned.body.assignments.some((x) => x.unitId === o.ok.unitId && x.by === 'dispatcher'));
  await o.waitFor((m) => m.t === 'alert' && m.alert.id === alert.id);

  o.send({ t: 'join', room: 'ops:all' });
  dispatch.send({ t: 'join', room: 'ops:all' });
  await new Promise((r) => setTimeout(r, 50));
  dispatch.send({ t: 'chat', room: 'ops:all', text: 'All units, BOLO white Tesla AKH-202' });
  const heard = await o.waitFor((m) => m.t === 'chat' && m.room === 'ops:all');
  assert.equal(heard.from.name, 'J. Morgan');
  for (const c of [dispatch, o]) c.ws.close();
});
