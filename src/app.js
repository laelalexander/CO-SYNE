import http from 'node:http';
import https from 'node:https';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { canonicalize } from '../public/canonical.js';
import { nonce as makeNonce, randomId, sha256, verifyText } from './crypto.js';
import { IdentityService, loadKeystore, publicProfile } from './identity.js';
import { Ledger } from './ledger.js';
import { aiRoutingEnabled, classifyWithClaude, classifyWithRules, haversineKm, selectCenter, selectUnits } from './routing.js';
import { BEATS, CENTERS, REGION, seedUnits } from './seed.js';
import { loadSamples, officerIssuer, recordsCheck, STOP_REASONS } from './samples.js';
import { buildCitation, buildReport, citationAckMessage, citationSigningPayload, VIOLATIONS } from './ticketing.js';
import QRCode from 'qrcode';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');
const LEAFLET_DIR = path.join(here, '..', 'node_modules', 'leaflet', 'dist');
const JSQR_DIR = path.join(here, '..', 'node_modules', 'jsqr', 'dist');
const MIME = { '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const ALERT_STATUSES = ['new', 'dispatched', 'acknowledged', 'en_route', 'on_scene', 'resolved', 'cancelled'];
const UNIT_STATUSES = ['available', 'en_route', 'on_scene', 'busy', 'out_of_service'];
const APPS = ['driver', 'officer', 'dispatch'];
const normalize = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// WebRTC ICE servers. With TURN_SECRET set (coturn "use-auth-secret"), each
// client gets short-lived TURN credentials so calls connect across NAT and
// cellular networks.
function iceServersFor(env) {
  const list = env.ICE_SERVERS ? JSON.parse(env.ICE_SERVERS) : [{ urls: 'stun:stun.l.google.com:19302' }];
  if (env.TURN_URLS && env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:cosyne`;
    const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
    list.push({ urls: env.TURN_URLS.split(',').map((s) => s.trim()), username, credential });
  }
  return list;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApp({ dataDir = path.join(here, '..', 'data'), env = process.env, simulate = true, classifyAI } = {}) {
  const keystore = loadKeystore(dataDir ? path.join(dataDir, 'keys.json') : null);
  const identity = new IdentityService({ keystore });
  const ledger = new Ledger({ file: dataDir ? path.join(dataDir, 'ledger.jsonl') : null, signer: keystore.ledger });
  const dispatchToken = env.DISPATCH_TOKEN || 'dispatch-demo';
  const officerEnrollCode = env.OFFICER_ENROLL_CODE || 'officer-demo';
  const aiClassify = classifyAI ?? (aiRoutingEnabled(env) ? classifyWithClaude : null);

  const units = new Map(seedUnits().map((u) => [u.id, u]));
  const alerts = new Map();
  const stops = new Map();
  const sessions = new Map(); // token -> { role, credential, profile, unitId, plate }
  const clients = new Set(); // ws clients
  const stickers = new Map(); // stickerId -> { stickerId, code, plate, credential }
  const citations = new Map();
  const reports = new Map();
  const demoEnabled = env.COSYNE_DEMO !== 'off';
  const roomHistory = new Map(); // room -> last chat messages

  function registerSticker(stickerId, credential) {
    const sticker = { stickerId, code: stickerId.slice(4, 10).toUpperCase(), plate: credential.subject.vehicle.plate, state: credential.subject.vehicle.state ?? null, credential };
    stickers.set(stickerId, sticker);
    return sticker;
  }
  const samples = demoEnabled ? loadSamples({ file: dataDir ? path.join(dataDir, 'samples.json') : null, identity }) : { drivers: [], officers: [] };
  for (const d of samples.drivers) registerSticker(d.stickerId, d.credential);

  // ---------- helpers ----------
  const credHash = (c) => sha256(canonicalize(c));
  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const clientsWhere = (pred) => [...clients].filter((c) => c.session && pred(c));

  function sessionFrom(req, { role, required = true } = {}) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const s = token ? sessions.get(token) : null;
    if (!s && required) throw new HttpError(401, 'sign in required');
    if (s && role && ![].concat(role).includes(s.role)) throw new HttpError(403, `requires ${[].concat(role).join(' or ')} role`);
    return s ?? null;
  }

  function newSession(data) {
    const token = randomId('sess', 24);
    sessions.set(token, data);
    return token;
  }

  let stateTimer = null;
  function pushDispatchState() {
    if (stateTimer) return;
    stateTimer = setTimeout(() => {
      stateTimer = null;
      const snapshot = dispatchState();
      for (const c of clientsWhere((c) => c.session.role === 'dispatch')) send(c.ws, { t: 'state', ...snapshot });
      // Patrol terminals get the unit picture for their map.
      const unitView = snapshot.units.map(({ id, callsign, type, status, location, agency, area }) => ({ id, callsign, type, status, location, agency, area }));
      for (const c of clientsWhere((c) => c.session.role === 'officer')) send(c.ws, { t: 'units', units: unitView });
    }, 50);
  }

  function dispatchState() {
    return {
      units: [...units.values()], centers: CENTERS, region: REGION, alerts: [...alerts.values()], stops: [...stops.values()].map((s) => stopView(s, 'dispatch')),
      network: networkState(),
    };
  }

  // Every device signed in to the CO-SYNE network, for the dispatch network view.
  function networkState() {
    const devices = [...clients].filter((c) => c.session).map((c) => ({
      peerId: c.id, role: c.session.role, name: c.session.profile?.name ?? c.session.label, unitId: c.session.unitId ?? null,
      plate: c.session.plate ?? null, agency: c.session.profile?.agency ?? null, credentialId: c.session.credential?.id ?? null, since: c.since, rooms: [...c.rooms],
    }));
    return { devices, ledger: { entries: ledger.entries.length, head: ledger.head() } };
  }

  // Dispatch sees the evidence ledger as a live event stream.
  ledger.listeners.add((e) => {
    for (const c of clientsWhere((c) => c.session.role === 'dispatch')) send(c.ws, { t: 'ledger', entry: { seq: e.seq, ts: e.ts, type: e.type, ref: e.ref, hash: e.hash } });
  });

  function alertRecipients(alert) {
    const unitIds = new Set(alert.assignments.map((a) => a.unitId));
    return clientsWhere((c) => c.session.role === 'dispatch'
      || (c.session.role === 'driver' && c.session.credential?.id === alert.driverCredentialId)
      || (c.session.role === 'driver' && c.session.alertIds?.has(alert.id))
      || (c.session.role === 'officer' && unitIds.has(c.session.unitId)));
  }

  function notifyAlert(alert) {
    for (const c of alertRecipients(alert)) send(c.ws, { t: 'alert', alert });
    pushDispatchState();
  }

  function stopView(stop, role) {
    const v = { id: stop.id, plate: stop.plate, status: stop.status, location: stop.location, createdAt: stop.createdAt, endedAt: stop.endedAt, outcome: stop.outcome, nonce: stop.nonce, proofs: stop.proofs, failure: stop.failure, unitId: stop.unitId };
    if (role !== 'driver' || stop.proofs.officer) v.officer = stop.officerProfile;
    if (role === 'driver' && stop.proofs.officer) v.officerCredential = stop.officerCredential; // lets the driver's device verify independently
    if (role !== 'driver' && (stop.proofs.driver || stop.via === 'sticker')) v.driver = stop.driverProfile;
    if (role === 'driver' && stop.driverProfile) v.driver = stop.driverProfile;
    v.via = stop.via ?? 'plate';
    v.reason = stop.reason ?? null;
    v.call = stop.call ?? null;
    v.participants = peersIn(`stop:${stop.id}`).map(peerInfo);
    v.citations = (stop.citationIds ?? []).map((id) => citations.get(id));
    v.reportId = stop.reportId ?? null;
    if (role !== 'driver') v.checks = stop.checks ?? null;
    if (role === 'dispatch' || role === 'officer') v.officerLocation = units.get(stop.unitId)?.location ?? null;
    return v;
  }

  function notifyStop(stop) {
    for (const c of clientsWhere((c) => c.session.role === 'dispatch')) send(c.ws, { t: 'stop', stop: stopView(stop, 'dispatch') });
    for (const c of clientsWhere((c) => c.session.role === 'officer' && c.session.credential.id === stop.officerCredential.id)) send(c.ws, { t: 'stop', stop: stopView(stop, 'officer') });
    if (stop.proofs.officer || stop.status === 'failed') {
      for (const c of clientsWhere((c) => c.session.role === 'driver' && c.session.plate === stop.plate)) send(c.ws, { t: 'stop', stop: stopView(stop, 'driver') });
    }
    pushDispatchState();
  }

  // ---------- alerts (D2ES) ----------
  function assignUnits(alert, services) {
    const already = new Set(alert.assignments.map((a) => a.service));
    const picks = selectUnits([...units.values()], alert.location, services.filter((s) => !already.has(s)));
    for (const p of picks) {
      const u = units.get(p.unitId);
      u.status = 'assigned';
      u.alertId = alert.id;
      alert.assignments.push(p);
    }
    return picks;
  }

  async function createAlert({ session, body }) {
    const loc = body.location;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) throw new HttpError(400, 'location {lat,lng} required');
    const driverVerified = session?.role === 'driver';
    const alert = {
      id: randomId('alr'),
      createdAt: new Date().toISOString(),
      status: 'new',
      type: body.type ?? 'other',
      description: String(body.description ?? '').slice(0, 2000),
      location: { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy ?? null },
      trail: [{ ...loc, ts: Date.now() }],
      driverVerified,
      driverCredentialId: driverVerified ? session.credential.id : null,
      driver: driverVerified ? session.profile : (body.contact ? { name: String(body.contact.name ?? ''), phone: String(body.contact.phone ?? '') } : null),
      vehicle: driverVerified ? session.profile.vehicle : body.vehicle ?? null,
      accessibility: driverVerified ? session.profile.accessibility : body.accessibility ?? null,
      stopId: body.stopId ?? null,
      assignments: [],
    };
    alert.triage = classifyWithRules(alert);
    alert.center = selectCenter(CENTERS, alert.location);
    alerts.set(alert.id, alert);
    if (session?.role === 'driver') (session.alertIds ??= new Set()).add(alert.id);
    ledger.append('alert_created', {
      alertId: alert.id, type: alert.type, description: alert.description, location: alert.location,
      driverVerified, driverCredentialId: alert.driverCredentialId, stopId: alert.stopId,
    }, alert.id);
    assignUnits(alert, alert.triage.services);
    alert.status = alert.assignments.length ? 'dispatched' : 'new';
    ledger.append('alert_routed', { triage: alert.triage, center: alert.center.id, assignments: alert.assignments }, alert.id);
    notifyAlert(alert);

    // AI second pass runs in the background; it can only add responders or raise priority.
    if (aiClassify) {
      alert.aiPending = true;
      aiClassify(alert).then((ai) => {
        alert.aiPending = false;
        if (ai) {
          const priority = Math.min(alert.triage.priority, ai.priority);
          const services = [...new Set([...alert.triage.services, ...ai.services])];
          alert.triage = { ...ai, priority, services, rulesCategory: alert.triage.category };
          const added = assignUnits(alert, services);
          if (added.length && alert.status === 'new') alert.status = 'dispatched';
          ledger.append('alert_triage_ai', { triage: alert.triage, addedAssignments: added }, alert.id);
        }
        notifyAlert(alert);
      });
    }
    return alert;
  }

  function updateAlertStatus(alert, status, by) {
    if (!ALERT_STATUSES.includes(status)) throw new HttpError(400, `status must be one of ${ALERT_STATUSES.join(', ')}`);
    alert.status = status;
    if (status === 'resolved' || status === 'cancelled') {
      for (const a of alert.assignments) {
        const u = units.get(a.unitId);
        if (u && u.alertId === alert.id) { u.status = 'available'; delete u.alertId; }
      }
    } else if (['en_route', 'on_scene'].includes(status)) {
      for (const a of alert.assignments) {
        const u = units.get(a.unitId);
        if (u && (by.role === 'dispatch' || u.id === by.unitId)) u.status = status;
      }
    }
    ledger.append('alert_status', { status, by: by.role, unitId: by.unitId ?? null }, alert.id);
    notifyAlert(alert);
  }

  // ---------- traffic stops (mutual verification) ----------
  function createStop({ session, body }) {
    let sticker = null;
    if (body.stickerId) {
      sticker = stickers.get(body.stickerId);
      if (!sticker) throw new HttpError(404, 'sticker not registered with CO-SYNE');
      const check = identity.verifyCredential(sticker.credential, 'driver');
      if (!check.ok) throw new HttpError(422, `sticker's driver credential is not valid: ${check.reason}`);
    }
    const plate = sticker ? sticker.plate : String(body.plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!plate) throw new HttpError(400, 'plate or stickerId required');
    const reason = String(body.reason ?? '').slice(0, 300) || null;
    const loc = body.location ?? units.get(session.unitId)?.location ?? null;
    const stop = {
      id: randomId('stp'),
      plate,
      createdAt: new Date().toISOString(),
      status: 'awaiting_officer_proof',
      location: loc,
      nonce: makeNonce(),
      proofs: { officer: false, driver: false },
      unitId: session.unitId,
      officerCredential: session.credential,
      officerProfile: session.profile,
      driverProfile: sticker ? publicProfile(sticker.credential) : null,
      via: sticker ? 'sticker' : 'plate',
      stickerId: sticker?.stickerId ?? null,
      reason,
      checks: sticker ? recordsCheck(sticker.credential.subject) : null,
      call: sticker ? { requested: true, status: 'ringing' } : null,
      citationIds: [],
    };
    stops.set(stop.id, stop);
    const unit = units.get(session.unitId);
    if (unit) { unit.status = 'on_stop'; unit.stopId = stop.id; }
    ledger.append('stop_initiated', { stopId: stop.id, plate, location: loc, via: stop.via, stickerId: stop.stickerId, reason, officerCredentialId: session.credential.id, officerCredHash: credHash(session.credential) }, stop.id);
    if (sticker) ledger.append('records_checked', { driverCredentialId: sticker.credential.id, results: stop.checks.map((c) => ({ label: c.label, ok: c.ok })) }, stop.id);
    notifyStop(stop);
    return stop;
  }

  function proveStop(stop, { session, body }) {
    const role = session.role;
    if (!['officer', 'driver'].includes(role)) throw new HttpError(403, 'only the officer or driver can prove identity');
    if (['ended', 'failed'].includes(stop.status)) throw new HttpError(409, `stop is ${stop.status}`);
    if (role === 'officer' && session.credential.id !== stop.officerCredential.id) throw new HttpError(403, 'not the initiating officer');
    if (role === 'driver') {
      if (session.plate !== stop.plate) throw new HttpError(403, 'credential vehicle does not match this stop');
      if (!stop.proofs.officer) throw new HttpError(409, 'officer must be verified first');
    }
    const result = identity.verifyPresentation({
      credential: session.credential, expectedType: role, stopId: stop.id, nonce: stop.nonce, role, signature: body.signature,
    });
    ledger.append(result.ok ? 'stop_identity_verified' : 'stop_identity_failed', {
      role, credentialId: session.credential.id, credHash: credHash(session.credential), reason: result.reason ?? null,
    }, stop.id);
    if (!result.ok) {
      if (role === 'officer') {
        stop.status = 'failed';
        stop.failure = `Officer identity could not be verified: ${result.reason}`;
        const unit = units.get(stop.unitId);
        if (unit?.stopId === stop.id) { unit.status = 'available'; delete unit.stopId; }
        notifyStop(stop);
      }
      throw new HttpError(422, result.reason);
    }
    stop.proofs[role] = true;
    if (role === 'driver') stop.driverProfile = session.profile;
    stop.status = stop.proofs.driver ? 'verified' : 'awaiting_driver';
    if (stop.status === 'verified') ledger.append('stop_mutually_verified', { officerCredentialId: stop.officerCredential.id, driverCredentialId: session.credential.id }, stop.id);
    notifyStop(stop);
    return stop;
  }

  function endStop(stop, { session, body }) {
    if (session.role === 'officer' && session.credential.id !== stop.officerCredential.id) throw new HttpError(403, 'not your stop');
    stop.status = 'ended';
    stop.endedAt = new Date().toISOString();
    stop.outcome = String(body.outcome ?? 'no_action').slice(0, 200);
    const unit = units.get(stop.unitId);
    if (unit?.stopId === stop.id) { unit.status = 'available'; delete unit.stopId; }
    ledger.append('stop_ended', { outcome: stop.outcome, by: session.role }, stop.id);
    notifyStop(stop);
    return stop;
  }

  // Verify an officer at a stop that never reached CO-SYNE (e.g. driver
  // pulled over and wants to know whether that unit is real): dispatch-side
  // registry lookup by unit near the driver.
  function nearbyOfficers(location, km = 2) {
    return [...units.values()]
      .filter((u) => u.type === 'police' && u.location && haversineKm(u.location, location) <= km)
      .map((u) => ({ unitId: u.id, callsign: u.callsign, agency: u.agency ?? null, km: +haversineKm(u.location, location).toFixed(2), verifiedOnline: !u.simulated }));
  }

  // ---------- REST ----------
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  route('GET', '/api/config', () => ({
    productName: 'CO-SYNE Interface',
    aiRouting: Boolean(aiClassify),
    iceServers: iceServersFor(env),
    region: REGION,
    pilot: env.COSYNE_PILOT ?? 'Tulsa Police Department pilot',
    demo: demoEnabled,
    dispatchHint: demoEnabled && !env.DISPATCH_TOKEN ? dispatchToken : null, // only the built-in demo code is ever hinted
  }));
  route('GET', '/api/trust', () => ({ issuers: identity.trustRegistry() }));

  route('POST', '/api/enroll', ({ body }) => {
    const { type, subject = {}, publicJwk } = body;
    let issuerId;
    if (type === 'officer') {
      if (body.enrollCode !== officerEnrollCode) throw new HttpError(403, 'invalid agency enrollment code');
      issuerId = officerIssuer(subject.agencyId);
    } else if (type === 'driver') {
      issuerId = 'service-ok';
      if (!subject.vehicle?.plate) throw new HttpError(400, 'vehicle.plate required');
      subject.vehicle.plate = String(subject.vehicle.plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
    } else throw new HttpError(400, 'type must be officer or driver');
    const credential = identity.issue({ issuerId, type, subject, subjectKey: publicJwk });
    ledger.append('credential_issued', { credentialId: credential.id, type, issuer: issuerId, credHash: credHash(credential) }, credential.id);
    if (type === 'driver') {
      const sticker = registerSticker(randomId('stk', 6), credential);
      ledger.append('sticker_issued', { stickerId: sticker.stickerId, credentialId: credential.id, plate: sticker.plate }, credential.id);
      return { credential, stickerId: sticker.stickerId };
    }
    return { credential };
  });

  route('POST', '/api/credentials/:id/revoke', ({ req, params, body }) => {
    sessionFrom(req, { role: 'dispatch' });
    identity.revoke(params.id, body.reason ?? 'revoked');
    ledger.append('credential_revoked', { credentialId: params.id, reason: body.reason ?? 'revoked' }, params.id);
    for (const [token, s] of sessions) if (s.credential?.id === params.id) sessions.delete(token);
    return { ok: true };
  });

  route('GET', '/api/state', ({ req }) => { sessionFrom(req, { role: 'dispatch' }); return dispatchState(); });

  route('POST', '/api/alerts', ({ req, body }) => createAlert({ session: sessionFrom(req, { required: false }), body }));
  route('GET', '/api/alerts/:id', ({ req, params }) => {
    const s = sessionFrom(req);
    const a = alerts.get(params.id);
    if (!a) throw new HttpError(404, 'no such alert');
    if (s.role === 'driver' && a.driverCredentialId !== s.credential.id && !s.alertIds?.has(a.id)) throw new HttpError(403, 'not your alert');
    return a;
  });
  route('POST', '/api/alerts/:id/status', ({ req, params, body }) => {
    const s = sessionFrom(req, { role: ['dispatch', 'officer', 'driver'] });
    const a = alerts.get(params.id);
    if (!a) throw new HttpError(404, 'no such alert');
    if (s.role === 'driver' && (a.driverCredentialId !== s.credential.id || body.status !== 'cancelled')) throw new HttpError(403, 'drivers can only cancel their own alert');
    if (s.role === 'officer' && !a.assignments.some((x) => x.unitId === s.unitId)) throw new HttpError(403, 'not assigned to this alert');
    updateAlertStatus(a, body.status, s);
    return a;
  });

  route('POST', '/api/stops', ({ req, body }) => stopView(createStop({ session: sessionFrom(req, { role: 'officer' }), body }), 'officer'));
  const getStop = (id) => { const s = stops.get(id); if (!s) throw new HttpError(404, 'no such stop'); return s; };
  route('GET', '/api/stops/:id', ({ req, params }) => {
    const s = sessionFrom(req);
    const stop = getStop(params.id);
    if (s.role === 'driver' && s.plate !== stop.plate) throw new HttpError(403, 'not your stop');
    return stopView(stop, s.role);
  });
  route('POST', '/api/stops/:id/prove', ({ req, params, body }) => stopView(proveStop(getStop(params.id), { session: sessionFrom(req), body }), sessionFrom(req).role));
  route('POST', '/api/stops/:id/end', ({ req, params, body }) => stopView(endStop(getStop(params.id), { session: sessionFrom(req, { role: ['officer', 'dispatch'] }), body }), 'officer'));
  route('POST', '/api/stops/:id/report', ({ req, params, body }) => {
    // Driver flags a stop as suspicious: opens a priority threat alert tied to the stop.
    const s = sessionFrom(req, { role: 'driver' });
    const stop = getStop(params.id);
    if (s.plate !== stop.plate) throw new HttpError(403, 'not your stop');
    return createAlert({ session: s, body: { type: 'threat', stopId: stop.id, location: body.location ?? stop.location, description: `Driver reports suspicious traffic stop (${stop.status}). ${body.description ?? ''}` } });
  });
  route('POST', '/api/officers/nearby', ({ req, body }) => {
    sessionFrom(req, { role: ['driver', 'dispatch'] });
    if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) throw new HttpError(400, 'lat,lng required');
    return { units: nearbyOfficers(body, body.km ?? 2) };
  });

  route('POST', '/api/stops/:id/call', ({ req, params, body }) => {
    const s = sessionFrom(req, { role: 'driver' });
    const stop = getStop(params.id);
    if (s.plate !== stop.plate) throw new HttpError(403, 'not your stop');
    const status = body.decision === 'declined' ? 'declined' : 'accepted';
    stop.call = { ...(stop.call ?? { requested: true }), status, at: new Date().toISOString() };
    ledger.append('video_call_' + status, { by: 'driver', credentialId: s.credential.id }, stop.id);
    notifyStop(stop);
    return stopView(stop, 'driver');
  });

  route('GET', '/api/violations', () => ({ violations: VIOLATIONS, reasons: STOP_REASONS }));

  route('POST', '/api/stops/:id/citations', ({ req, params, body }) => {
    const s = sessionFrom(req, { role: 'officer' });
    const stop = getStop(params.id);
    if (stop.officerCredential.id !== s.credential.id) throw new HttpError(403, 'not your stop');
    if (!stop.driverProfile) throw new HttpError(409, 'driver identity not available yet');
    if (stop.status === 'ended') throw new HttpError(409, 'stop has ended');
    const type = body.type === 'warning' ? 'warning' : 'citation';
    const violationCodes = Array.isArray(body.violationCodes) ? body.violationCodes.map(String) : [];
    const issuedAt = String(body.issuedAt ?? '');
    if (Math.abs(Date.parse(issuedAt) - Date.now()) > 10 * 60_000 || Number.isNaN(Date.parse(issuedAt))) throw new HttpError(400, 'issuedAt must be the current time');
    const payload = citationSigningPayload({ stopId: stop.id, type, violationCodes, notes: body.notes, issuedAt });
    if (!verifyText(s.credential.subjectKey, payload, body.signature)) throw new HttpError(422, 'officer signature on citation is invalid');
    let citation;
    try {
      citation = buildCitation({ stop, type, violationCodes, notes: body.notes, issuedAt, officerSignature: body.signature });
    } catch (err) { throw new HttpError(400, err.message); }
    citations.set(citation.id, citation);
    stop.citationIds.push(citation.id);
    const entry = ledger.append('citation_issued', { citationId: citation.id, type, violations: violationCodes, totalFine: citation.totalFine, hash: citation.hash }, stop.id);
    citation.ledgerSeq = entry.seq;
    notifyStop(stop);
    return citation;
  });

  const getCitation = (id) => { const c = citations.get(id); if (!c) throw new HttpError(404, 'no such citation'); return c; };
  route('POST', '/api/citations/:id/ack', ({ req, params, body }) => {
    const s = sessionFrom(req, { role: 'driver' });
    const c = getCitation(params.id);
    if (c.driver.credentialId !== s.credential.id) throw new HttpError(403, 'not your citation');
    if (!verifyText(s.credential.subjectKey, citationAckMessage(c.id, c.hash), body.signature)) throw new HttpError(422, 'acknowledgement signature invalid');
    c.ack = { at: new Date().toISOString(), signature: body.signature };
    ledger.append('citation_acknowledged', { citationId: c.id, hash: c.hash }, c.stopId);
    notifyStop(stops.get(c.stopId));
    return c;
  });
  route('POST', '/api/citations/:id/pay', ({ req, params }) => {
    const s = sessionFrom(req, { role: 'driver' });
    const c = getCitation(params.id);
    if (c.driver.credentialId !== s.credential.id) throw new HttpError(403, 'not your citation');
    if (c.type !== 'citation' || c.status === 'paid') throw new HttpError(409, 'nothing to pay');
    c.status = 'paid';
    c.payment = { at: new Date().toISOString(), amount: c.totalFine, confirmation: randomId('PAY', 5).toUpperCase(), simulated: true };
    ledger.append('citation_paid', { citationId: c.id, amount: c.totalFine, confirmation: c.payment.confirmation, simulated: true }, c.stopId);
    notifyStop(stops.get(c.stopId));
    return c;
  });
  route('POST', '/api/citations/:id/contest', ({ req, params }) => {
    const s = sessionFrom(req, { role: 'driver' });
    const c = getCitation(params.id);
    if (c.driver.credentialId !== s.credential.id) throw new HttpError(403, 'not your citation');
    if (c.type !== 'citation') throw new HttpError(409, 'warnings cannot be contested');
    c.status = 'contested';
    ledger.append('citation_contested', { citationId: c.id }, c.stopId);
    notifyStop(stops.get(c.stopId));
    return c;
  });
  route('GET', '/api/citations', ({ req }) => {
    const s = sessionFrom(req);
    const all = [...citations.values()];
    if (s.role === 'dispatch') return { citations: all };
    if (s.role === 'officer') return { citations: all.filter((c) => c.officer.credentialId === s.credential.id) };
    return { citations: all.filter((c) => c.driver.credentialId === s.credential.id) };
  });

  route('POST', '/api/stops/:id/file-report', ({ req, params, body }) => {
    const s = sessionFrom(req, { role: 'officer' });
    const stop = getStop(params.id);
    if (stop.officerCredential.id !== s.credential.id) throw new HttpError(403, 'not your stop');
    if (stop.reportId) throw new HttpError(409, 'report already filed');
    const stopCitations = stop.citationIds.map((id) => citations.get(id));
    const disposition = String(body.disposition ?? (stopCitations.some((c) => c.type === 'citation') ? 'citation' : stopCitations.length ? 'warning' : 'no_action'));
    const entries = ledger.list({ ref: stop.id, limit: 1000 });
    const report = buildReport({
      stop, citations: stopCitations, evidence: entries.filter((e) => e.type === 'evidence_anchored'), ledgerEntries: entries,
      narrative: body.narrative, disposition, filedAt: new Date().toISOString(),
    });
    const entry = ledger.append('stop_report_filed', { reportId: report.id, hash: report.hash, disposition }, stop.id);
    report.ledgerSeq = entry.seq;
    reports.set(report.id, report);
    stop.reportId = report.id;
    if (stop.status !== 'ended') endStop(stop, { session: s, body: { outcome: disposition } });
    else notifyStop(stop);
    return report;
  });
  route('GET', '/api/reports', ({ req }) => {
    const s = sessionFrom(req, { role: ['dispatch', 'officer'] });
    const all = [...reports.values()].reverse();
    return { reports: s.role === 'dispatch' ? all : all.filter((r) => r.officer.credentialId === s.credential.id) };
  });
  route('GET', '/api/reports/:id', ({ req, params }) => {
    const s = sessionFrom(req, { role: ['dispatch', 'officer'] });
    const r = reports.get(params.id);
    if (!r) throw new HttpError(404, 'no such report');
    if (s.role === 'officer' && r.officer.credentialId !== s.credential.id) throw new HttpError(403, 'not your report');
    return r;
  });

  // ---------- records lookup, unit status, dispatch assignment ----------
  function lookupRecords(q) {
    const nq = normalize(q);
    const lq = String(q ?? '').trim().toLowerCase();
    if (nq.length < 2) throw new HttpError(400, 'enter a plate, license number, or name');
    const seen = new Set();
    const out = [];
    for (const st of stickers.values()) {
      const c = st.credential;
      if (seen.has(c.id)) continue;
      const s = c.subject;
      const hit = normalize(s.vehicle?.plate) === nq || normalize(s.licenseNumber) === nq || normalize(s.vehicle?.vin) === nq
        || (lq.length >= 3 && String(s.name ?? '').toLowerCase().includes(lq));
      if (!hit) continue;
      seen.add(c.id);
      const valid = identity.verifyCredential(c, 'driver');
      const history = [...stops.values()].filter((x) => x.plate === st.plate).map((x) => ({
        id: x.id, createdAt: x.createdAt, reason: x.reason, status: x.status, outcome: x.outcome ?? null, officer: x.officerProfile?.name, reportId: x.reportId ?? null,
      })).reverse();
      const cits = [...citations.values()].filter((x) => x.driver.credentialId === c.id).map((x) => ({
        id: x.id, type: x.type, issuedAt: x.issuedAt, status: x.status, totalFine: x.totalFine, violations: x.violations.map((v) => v.code),
      })).reverse();
      out.push({ profile: publicProfile(c), credentialValid: valid.ok, credentialProblem: valid.reason ?? null, stickerId: st.stickerId, checks: recordsCheck(s), history, citations: cits });
    }
    return out;
  }

  route('GET', '/api/lookup', ({ req, url }) => {
    const s = sessionFrom(req, { role: ['officer', 'dispatch'] });
    const q = url.searchParams.get('q') ?? '';
    const results = lookupRecords(q);
    // Every records query is audited, as CJIS requires.
    ledger.append('records_query', { by: s.role, credentialId: s.credential?.id ?? null, unitId: s.unitId ?? null, query: q.slice(0, 60), results: results.length }, s.unitId ?? 'dispatch');
    return { query: q, results };
  });

  route('POST', '/api/units/:id/status', ({ req, params, body }) => {
    const s = sessionFrom(req, { role: ['officer', 'dispatch'] });
    const unitId = params.id === 'me' ? s.unitId : params.id;
    const unit = units.get(unitId);
    if (!unit) throw new HttpError(404, 'no such unit');
    if (s.role === 'officer' && unitId !== s.unitId) throw new HttpError(403, 'not your unit');
    if (!UNIT_STATUSES.includes(body.status)) throw new HttpError(400, `status must be one of ${UNIT_STATUSES.join(', ')}`);
    if (unit.stopId && stops.get(unit.stopId)?.status !== 'ended') throw new HttpError(409, 'unit is on an active traffic stop');
    unit.status = body.status;
    if (body.status === 'available' && unit.alertId) {
      const a = alerts.get(unit.alertId);
      if (!a || ['resolved', 'cancelled'].includes(a.status)) delete unit.alertId;
    }
    ledger.append('unit_status', { unitId, status: body.status, by: s.role }, unitId);
    pushDispatchState();
    for (const c of clientsWhere((c) => c.session.unitId === unitId)) send(c.ws, { t: 'unit', unit });
    return unit;
  });

  route('POST', '/api/alerts/:id/assign', ({ req, params, body }) => {
    sessionFrom(req, { role: 'dispatch' });
    const a = alerts.get(params.id);
    if (!a) throw new HttpError(404, 'no such alert');
    const u = units.get(body.unitId);
    if (!u) throw new HttpError(404, 'no such unit');
    if (a.assignments.some((x) => x.unitId === u.id)) return a;
    const km = u.location ? haversineKm(u.location, a.location) : null;
    const pick = { service: u.type, unitId: u.id, callsign: u.callsign, km: km == null ? null : +km.toFixed(2), etaMin: km == null ? null : Math.max(1, Math.round((km / (u.area === 'rural' ? 80 : 45)) * 60)), by: 'dispatcher' };
    a.assignments.push(pick);
    u.status = 'assigned';
    u.alertId = a.id;
    if (a.status === 'new') a.status = 'dispatched';
    ledger.append('alert_assigned', pick, a.id);
    notifyAlert(a);
    return a;
  });

  // ---------- stickers & sample data (simulation) ----------
  route('GET', '/api/stickers/:id', ({ params }) => {
    const st = stickers.get(params.id);
    if (!st) throw new HttpError(404, 'sticker not registered');
    return { stickerId: st.stickerId, code: st.code, plate: st.plate, state: st.state };
  });
  route('GET', '/api/samples', () => {
    if (!demoEnabled) throw new HttpError(404, 'demo data disabled');
    return {
      notice: 'Simulation data. Private keys are included so demo devices can act as these people. Never do this with real identities.',
      drivers: samples.drivers.map(({ key, credential, publicJwk, privateJwk, stickerId }) => ({ key, credential, publicJwk, privateJwk, stickerId })),
      officers: samples.officers.map(({ key, credential, publicJwk, privateJwk }) => ({ key, credential, publicJwk, privateJwk })),
    };
  });

  route('POST', '/api/evidence', ({ req, body }) => {
    const s = sessionFrom(req);
    if (!/^[0-9a-f]{64}$/.test(body.sha256 ?? '')) throw new HttpError(400, 'sha256 hex digest required');
    const ref = String(body.ref ?? '');
    if (!alerts.has(ref) && !stops.has(ref)) throw new HttpError(400, 'ref must be an alert or stop id');
    const entry = ledger.append('evidence_anchored', {
      sha256: body.sha256, kind: String(body.kind ?? 'video').slice(0, 40), bytes: Number(body.bytes) || null,
      durationSec: Number(body.durationSec) || null, by: s.role, credentialId: s.credential?.id ?? null,
    }, ref);
    return { entry };
  });

  route('GET', '/api/ledger', ({ req, url }) => {
    sessionFrom(req);
    return { entries: ledger.list({ ref: url.searchParams.get('ref') || undefined, limit: Number(url.searchParams.get('limit')) || 200 }) };
  });
  route('GET', '/api/ledger/verify', () => ledger.verify());
  route('GET', '/api/ledger/key', () => ({ alg: 'Ed25519', publicJwk: { kty: 'OKP', crv: 'Ed25519', x: keystore.ledger.publicJwk.x }, head: ledger.head() }));

  async function handleApi(req, res, url) {
    const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!match) throw new HttpError(404, 'not found');
    const m = url.pathname.match(match.re);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let body = {};
    if (req.method === 'POST') {
      const raw = await readBody(req);
      try { body = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'invalid JSON'); }
    }
    return match.handler({ req, res, url, params, body });
  }

  function serveStatic(res, pathname) {
    if (APPS.includes(pathname.slice(1))) { res.writeHead(301, { location: `${pathname.slice(1)}/` }).end(); return; }
    if (pathname.endsWith('/')) pathname += 'index.html';
    // Leaflet is served from node_modules so the dispatch map works without a CDN.
    const [root, rel] = pathname.startsWith('/vendor/leaflet/')
      ? [LEAFLET_DIR, pathname.slice('/vendor/leaflet/'.length)]
      : pathname === '/vendor/jsQR.js' ? [JSQR_DIR, 'jsQR.js']
        : [PUBLIC_DIR, pathname.slice(1)];
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  const tls = env.TLS_CERT && env.TLS_KEY ? { cert: fs.readFileSync(env.TLS_CERT), key: fs.readFileSync(env.TLS_KEY) } : null;
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const stickerPath = url.pathname.match(/^\/s\/([\w-]+)$/);
    if (stickerPath) {
      // A scanned sticker opens the officer portal for that vehicle.
      res.writeHead(302, { location: `../officer/?scan=${encodeURIComponent(stickerPath[1])}` }).end(); // relative, so it works under a path prefix
      return;
    }
    const legacyRole = url.pathname === '/' && url.searchParams.get('role');
    if (APPS.includes(legacyRole)) { res.writeHead(302, { location: `./${legacyRole}/` }).end(); return; }
    const qrPath = url.pathname.match(/^\/api\/stickers\/([\w-]+)\/qr\.svg$/);
    if (qrPath) {
      if (!stickers.has(qrPath[1])) { res.writeHead(404).end(); return; }
      // PUBLIC_URL (e.g. https://iobeacons.com/cosyne) when served behind a proxy under a path.
      const proto = req.headers['x-forwarded-proto'] ?? (req.socket.encrypted ? 'https' : 'http');
      const origin = (env.PUBLIC_URL ?? `${proto}://${req.headers.host}`).replace(/\/+$/, '');
      const target = `${origin}/s/${qrPath[1]}`;
      const svg = await QRCode.toString(target, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0b1b2b', light: '#ffffff' } });
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' }).end(svg);
      return;
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
    try {
      const out = await handleApi(req, res, url);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: err.message }));
    }
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

  // ---------- WebSocket: sessions, live location, rooms, WebRTC signaling ----------
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

  function canJoin(c, room) {
    const [kind, id] = room.split(':');
    const s = c.session;
    if (kind === 'ops') return s.role === 'dispatch' || s.role === 'officer'; // CAD talk-group for dispatch and units
    if (s.role === 'dispatch') return (kind === 'alert' && alerts.has(id)) || (kind === 'stop' && stops.has(id));
    if (kind === 'alert') {
      const a = alerts.get(id);
      if (!a) return false;
      if (s.role === 'driver') return a.driverCredentialId === s.credential.id || s.alertIds?.has(id);
      return a.assignments.some((x) => x.unitId === s.unitId);
    }
    if (kind === 'stop') {
      const st = stops.get(id);
      if (!st) return false;
      if (s.role === 'officer') return st.officerCredential.id === s.credential.id;
      return s.plate === st.plate && st.proofs.officer;
    }
    return false;
  }

  function roomChanged(room) {
    const [kind, id] = room.split(':');
    if (kind === 'stop' && stops.has(id)) notifyStop(stops.get(id));
  }
  const peersIn = (room, except) => [...clients].filter((c) => c !== except && c.rooms.has(room));
  const peerInfo = (c) => ({ id: c.id, role: c.session.role, name: c.session.profile?.name ?? c.session.label ?? 'Dispatch', label: c.session.label, callsign: c.session.unitId ? units.get(c.session.unitId)?.callsign ?? null : null });

  wss.on('connection', (ws) => {
    const c = { id: randomId('peer', 6), ws, session: null, rooms: new Set(), challenge: makeNonce(), since: new Date().toISOString() };
    clients.add(c);
    send(ws, { t: 'challenge', nonce: c.challenge });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      try { onMessage(c, msg); } catch (err) { send(ws, { t: 'error', error: err.message, ref: msg.t }); }
    });
    ws.on('close', () => {
      clients.delete(c);
      if (c.session) pushDispatchState();
      for (const room of c.rooms) {
        for (const p of peersIn(room)) send(p.ws, { t: 'peer_left', room, peer: c.id });
        roomChanged(room);
      }
    });
  });

  function onMessage(c, msg) {
    if (msg.t === 'hello') return onHello(c, msg);
    if (!c.session) throw new Error('send hello first');
    const s = c.session;
    switch (msg.t) {
      case 'location': {
        if (!Number.isFinite(msg.lat) || !Number.isFinite(msg.lng)) return;
        const loc = { lat: msg.lat, lng: msg.lng, accuracy: msg.accuracy ?? null };
        if (s.role === 'officer' && units.has(s.unitId)) {
          units.get(s.unitId).location = loc;
          const unit = units.get(s.unitId);
          if (unit.stopId && stops.has(unit.stopId)) notifyStop(stops.get(unit.stopId));
          pushDispatchState();
        } else if (s.role === 'driver') {
          for (const a of alerts.values()) {
            if ((a.driverCredentialId === s.credential.id || s.alertIds?.has(a.id)) && !['resolved', 'cancelled'].includes(a.status)) {
              a.location = loc;
              a.trail.push({ ...loc, ts: Date.now() });
              if (a.trail.length > 100) a.trail.shift();
              notifyAlert(a);
            }
          }
        }
        return;
      }
      case 'join': {
        if (!canJoin(c, msg.room)) throw new Error('not permitted in this room');
        c.rooms.add(msg.room);
        roomChanged(msg.room);
        const textOnly = msg.room.startsWith('ops:') || msg.media === false;
        if (roomHistory.has(msg.room)) send(c.ws, { t: 'chat_history', room: msg.room, messages: roomHistory.get(msg.room) });
        if (textOnly) { c.textRooms = (c.textRooms ?? new Set()).add(msg.room); return; }
        send(c.ws, { t: 'room_peers', room: msg.room, peers: peersIn(msg.room, c).filter((p) => !p.textRooms?.has(msg.room)).map(peerInfo) });
        for (const p of peersIn(msg.room, c)) if (!p.textRooms?.has(msg.room)) send(p.ws, { t: 'peer_joined', room: msg.room, peer: peerInfo(c) });
        ledger.append('video_joined', { role: s.role, name: s.profile?.name ?? s.label, credentialId: s.credential?.id ?? null }, msg.room.split(':')[1]);
        return;
      }
      case 'leave': {
        if (!c.rooms.delete(msg.room)) return;
        if (c.textRooms?.delete(msg.room)) return;
        roomChanged(msg.room);
        for (const p of peersIn(msg.room)) send(p.ws, { t: 'peer_left', room: msg.room, peer: c.id });
        return;
      }
      case 'signal': {
        if (!c.rooms.has(msg.room)) throw new Error('join the room first');
        const target = peersIn(msg.room, c).find((p) => p.id === msg.to);
        if (target) send(target.ws, { t: 'signal', room: msg.room, from: c.id, data: msg.data });
        return;
      }
      case 'chat': {
        if (!c.rooms.has(msg.room)) throw new Error('join the room first');
        const text = String(msg.text ?? '').slice(0, 1000);
        if (!text.trim()) return;
        ledger.append('chat_message', { role: s.role, name: s.profile?.name ?? s.label, credentialId: s.credential?.id ?? null, text }, msg.room.split(':')[1]);
        const out = { t: 'chat', room: msg.room, from: peerInfo(c), text, ts: Date.now() };
        const hist = roomHistory.get(msg.room) ?? [];
        hist.push(out);
        if (hist.length > 100) hist.shift();
        roomHistory.set(msg.room, hist);
        for (const p of peersIn(msg.room)) send(p.ws, out);
        return;
      }
      default:
        throw new Error(`unknown message ${msg.t}`);
    }
  }

  function onHello(c, msg) {
    let data;
    if (msg.role === 'dispatch') {
      if (msg.token !== dispatchToken) throw new Error('invalid dispatch token');
      const name = String(msg.name ?? '').trim().slice(0, 60);
      data = { role: 'dispatch', label: name ? `Dispatch · ${name}` : 'Dispatch', profile: { name: name || 'Dispatcher', agency: CENTERS[0].name } };
    } else if (msg.role === 'officer' || msg.role === 'driver') {
      const result = identity.verifyPresentation({
        credential: msg.credential, expectedType: msg.role, stopId: 'session', nonce: c.challenge, role: msg.role, signature: msg.signature,
      });
      if (!result.ok) throw new Error(`sign-in failed: ${result.reason}`);
      const profile = publicProfile(msg.credential);
      data = { role: msg.role, credential: msg.credential, profile, label: profile.name };
      if (msg.role === 'driver') data.plate = msg.credential.subject.vehicle?.plate;
      if (msg.role === 'officer') {
        const unitId = `u-${msg.credential.id.slice(5, 13)}`;
        const existing = units.get(unitId);
        units.set(unitId, {
          ...(existing ?? { status: 'available' }),
          id: unitId,
          callsign: msg.credential.subject.unit || `Badge ${msg.credential.subject.badge}`,
          type: 'police',
          area: msg.credential.issuer === 'tcso' ? 'rural' : 'urban',
          agency: msg.credential.issuerName,
          officer: profile.name,
          location: msg.location ?? existing?.location ?? null,
        });
        data.unitId = unitId;
      }
    } else throw new Error('role must be driver, officer, or dispatch');

    c.challenge = null; // single use
    // Reuse the session token when the same holder reconnects.
    const token = msg.resumeToken && sessions.get(msg.resumeToken)?.credential?.id === data.credential?.id && sessions.get(msg.resumeToken)?.role === data.role
      ? msg.resumeToken : newSession(data);
    c.session = sessions.get(token);
    if (c.session !== data && data.unitId) c.session.unitId = data.unitId;
    send(c.ws, { t: 'hello_ok', token, role: data.role, profile: data.profile ?? null, unitId: data.unitId ?? null, peerId: c.id });

    if (data.role === 'dispatch') send(c.ws, { t: 'state', ...dispatchState() });
    if (data.role === 'driver') {
      for (const st of stops.values()) if (st.plate === data.plate && st.proofs.officer && !['ended'].includes(st.status)) send(c.ws, { t: 'stop', stop: stopView(st, 'driver') });
      for (const a of alerts.values()) if (a.driverCredentialId === data.credential.id) send(c.ws, { t: 'alert', alert: a });
    }
    if (data.role === 'officer') {
      for (const a of alerts.values()) if (a.assignments.some((x) => x.unitId === data.unitId) && !['resolved', 'cancelled'].includes(a.status)) send(c.ws, { t: 'alert', alert: a });
      for (const st of stops.values()) if (st.officerCredential.id === data.credential.id && st.status !== 'ended') send(c.ws, { t: 'stop', stop: stopView(st, 'officer') });
    }
    pushDispatchState();
  }

  // Simulated units drive toward their assigned incident, and simulated
  // patrol units cruise their beats, so the dispatch map shows a live picture.
  let simTimer = null;
  if (simulate) {
    let tick = 0;
    simTimer = setInterval(() => {
      let moved = false;
      tick++;
      for (const u of units.values()) {
        const isSeeded = Boolean(u.simulated) || ['ems', 'fire', 'tow'].includes(u.type);
        if (!isSeeded) continue;
        const a = u.alertId && alerts.get(u.alertId);
        if (a && !['resolved', 'cancelled'].includes(a.status)) {
          const d = haversineKm(u.location, a.location);
          if (d < 0.05) { if (u.status !== 'on_scene') { u.status = 'on_scene'; moved = true; } continue; }
          const step = Math.min(1, 0.4 / d);
          u.location = { lat: u.location.lat + (a.location.lat - u.location.lat) * step, lng: u.location.lng + (a.location.lng - u.location.lng) * step };
          u.status = 'en_route';
          moved = true;
        } else if (u.alertId) {
          delete u.alertId;
          u.status = 'available';
          moved = true;
        } else if (u.status === 'available' && BEATS[u.id] && tick % 2 === 0) {
          const beat = BEATS[u.id];
          u.heading = (u.heading ?? Math.random() * 360) + (Math.random() - 0.5) * 50;
          const rad = (u.heading * Math.PI) / 180;
          let lat = u.location.lat + Math.cos(rad) * 0.0012;
          let lng = u.location.lng + Math.sin(rad) * 0.0015;
          if (Math.hypot(lat - beat.lat, lng - beat.lng) > beat.r) { u.heading += 180; lat = u.location.lat; lng = u.location.lng; }
          u.location = { lat, lng };
          moved = true;
        }
      }
      if (moved) pushDispatchState();
    }, 2000);
    simTimer.unref?.();
  }

  return {
    server, secure: Boolean(tls), ledger, identity, units, alerts, stops, stickers, citations, reports, samples,
    listen(port = 0, host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port)));
    },
    close() {
      clearInterval(simTimer);
      clearTimeout(stateTimer);
      for (const c of clients) c.ws.terminate();
      wss.close();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
