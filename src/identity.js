import fs from 'node:fs';
import path from 'node:path';
import { credentialPayload, stopChallengeMessage } from '../public/canonical.js';
import { generateKeys, publicOnly, randomId, signText, verifyText } from './crypto.js';

// Demo issuers. In production each agency and the state DMV would run its own
// issuer and publish its public key; CO-SYNE only holds the trust registry.
export const DEFAULT_ISSUERS = [
  { id: 'tulsa-pd', name: 'Tulsa Police Department', kind: 'agency', issues: 'officer' },
  { id: 'tcso', name: 'Tulsa County Sheriff\'s Office', kind: 'agency', issues: 'officer' },
  { id: 'service-ok', name: 'Service Oklahoma', kind: 'dmv', issues: 'driver', jurisdiction: 'OK', jurisdictionName: 'Oklahoma' },
  // A second state so cross-state verification can be demonstrated. Federal
  // partners (kind 'federal') can be added the same way as issuers or verifiers.
  { id: 'tx-demo', name: 'State of Texas (demo issuer)', kind: 'dmv', issues: 'driver', jurisdiction: 'TX', jurisdictionName: 'Texas', demo: true },
];

// Loads or creates the long-lived keys (ledger signer + demo issuers).
export function loadKeystore(file) {
  let store = {};
  if (file && fs.existsSync(file)) store = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;
  if (!store.ledger) { store.ledger = generateKeys(); changed = true; }
  store.issuers ??= {};
  for (const iss of DEFAULT_ISSUERS) {
    if (!store.issuers[iss.id]) { store.issuers[iss.id] = generateKeys(); changed = true; }
  }
  if (file && changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
  }
  return store;
}

export class IdentityService {
  constructor({ keystore, issuers = DEFAULT_ISSUERS }) {
    this.issuers = new Map(issuers.map((i) => [i.id, { ...i, ...keystore.issuers[i.id] }]));
    this.revoked = new Map();
  }

  trustRegistry() {
    return [...this.issuers.values()].map(({ id, name, kind, issues, jurisdiction, jurisdictionName, demo, publicJwk }) => ({
      id, name, kind, issues, jurisdiction: jurisdiction ?? null, jurisdictionName: jurisdictionName ?? null, demo: Boolean(demo), publicJwk: publicOnly(publicJwk),
    }));
  }

  issue({ issuerId, type, subject, subjectKey, ttlDays = 365 }) {
    const issuer = this.issuers.get(issuerId);
    if (!issuer) throw new Error(`unknown issuer ${issuerId}`);
    if (issuer.issues !== type) throw new Error(`${issuerId} cannot issue ${type} credentials`);
    if (!subjectKey?.x) throw new Error('subjectKey (Ed25519 public JWK) required');
    const now = Date.now();
    const credential = {
      id: randomId('cred'),
      type,
      issuer: issuerId,
      issuerName: issuer.name,
      subject,
      subjectKey: publicOnly(subjectKey),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlDays * 86400_000).toISOString(),
    };
    credential.proof = { alg: 'Ed25519', sig: signText(issuer.privateJwk, credentialPayload(credential)) };
    return credential;
  }

  revoke(credentialId, reason = 'revoked') {
    this.revoked.set(credentialId, { reason, at: new Date().toISOString() });
  }

  verifyCredential(credential, expectedType) {
    if (!credential || typeof credential !== 'object') return { ok: false, reason: 'no credential presented' };
    if (expectedType && credential.type !== expectedType) return { ok: false, reason: `expected ${expectedType} credential` };
    const issuer = this.issuers.get(credential.issuer);
    if (!issuer) return { ok: false, reason: 'issuer not in trust registry' };
    if (issuer.issues !== credential.type) return { ok: false, reason: 'issuer not authorized for this credential type' };
    if (!verifyText(issuer.publicJwk, credentialPayload(credential), credential.proof?.sig)) {
      return { ok: false, reason: 'issuer signature invalid (forged or altered)' };
    }
    if (Date.parse(credential.expiresAt) < Date.now()) return { ok: false, reason: 'credential expired' };
    if (this.revoked.has(credential.id)) return { ok: false, reason: `credential ${this.revoked.get(credential.id).reason}` };
    return { ok: true };
  }

  // A presentation proves the presenter holds the private key bound into the
  // credential, by signing a one-time challenge. A copied credential alone fails.
  verifyPresentation({ credential, expectedType, stopId, nonce, role, signature }) {
    const base = this.verifyCredential(credential, expectedType);
    if (!base.ok) return base;
    const msg = stopChallengeMessage(stopId, nonce, role);
    if (!verifyText(credential.subjectKey, msg, signature)) {
      return { ok: false, reason: 'challenge signature invalid (presenter does not hold this credential\'s key)' };
    }
    return { ok: true };
  }
}

// What each party is shown about the other once verification succeeds.
export function publicProfile(credential) {
  const s = credential.subject ?? {};
  if (credential.type === 'officer') {
    return { name: s.name, badge: s.badge, rank: s.rank, unit: s.unit, division: s.division, agency: credential.issuerName, agencyId: credential.issuer, credentialId: credential.id };
  }
  return {
    name: s.name,
    dob: s.dob,
    address: s.address,
    licenseNumber: s.licenseNumber,
    licenseClass: s.licenseClass,
    licenseStatus: s.licenseStatus ?? 'valid',
    licenseExpires: s.licenseExpires,
    restrictions: s.restrictions,
    vehicle: s.vehicle,
    registrationStatus: s.registrationStatus ?? 'valid',
    registrationExpires: s.registrationExpires,
    insurance: s.insurance ?? 'active',
    insuranceCarrier: s.insuranceCarrier,
    insurancePolicy: s.insurancePolicy,
    accessibility: s.accessibility,
    issuer: credential.issuerName,
    jurisdiction: s.jurisdiction ?? s.vehicle?.state ?? null,
    realId: s.realId ?? null,
    program: s.program ? { enrollment: s.enrollment ?? null, expiresAt: credential.expiresAt } : null,
    credentialId: credential.id,
  };
}
