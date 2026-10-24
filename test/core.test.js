import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger.js';
import { IdentityService, loadKeystore } from '../src/identity.js';
import { generateKeys, signText } from '../src/crypto.js';
import { stopChallengeMessage } from '../public/canonical.js';
import { classifyWithRules, selectUnits } from '../src/routing.js';

const keystore = loadKeystore(null);

test('ledger chains, verifies, and detects tampering', () => {
  const ledger = new Ledger({ file: null, signer: keystore.ledger });
  ledger.append('a', { n: 1 }, 'x');
  ledger.append('b', { n: 2 }, 'x');
  ledger.append('c', { n: 3 }, 'y');
  assert.equal(ledger.verify().ok, true);
  assert.equal(ledger.list({ ref: 'x' }).length, 2);

  const edited = structuredClone(ledger.entries);
  edited[1].data.n = 99;
  assert.deepEqual(ledger.verify(edited), { ok: false, length: 3, brokenAt: 1, reason: 'entry contents altered' });

  const deleted = structuredClone(ledger.entries).filter((e) => e.seq !== 1);
  assert.equal(ledger.verify(deleted).ok, false);

  // Re-hashing after an edit still fails: the attacker lacks the ledger signing key.
  const rechained = structuredClone(ledger.entries);
  rechained[2].data.n = 7;
  rechained[2].hash = Ledger.hashEntry(rechained[2]);
  assert.equal(ledger.verify(rechained).reason, 'bad ledger signature');
});

test('credentials: issue, verify, forge, revoke, and key-possession proof', () => {
  const id = new IdentityService({ keystore });
  const holder = generateKeys();
  const cred = id.issue({ issuerId: 'tulsa-pd', type: 'officer', subject: { name: 'Ofc. Rivera', badge: '4471' }, subjectKey: holder.publicJwk });
  assert.equal(id.verifyCredential(cred, 'officer').ok, true);
  assert.equal(id.verifyCredential(cred, 'driver').ok, false);

  const forged = structuredClone(cred);
  forged.subject.badge = '0001';
  assert.match(id.verifyCredential(forged).reason, /signature invalid/);

  assert.throws(() => id.issue({ issuerId: 'service-ok', type: 'officer', subject: {}, subjectKey: holder.publicJwk }));

  const sig = signText(holder.privateJwk, stopChallengeMessage('stp_1', 'n1', 'officer'));
  assert.equal(id.verifyPresentation({ credential: cred, expectedType: 'officer', stopId: 'stp_1', nonce: 'n1', role: 'officer', signature: sig }).ok, true);
  // Replay against a different stop fails.
  assert.equal(id.verifyPresentation({ credential: cred, expectedType: 'officer', stopId: 'stp_2', nonce: 'n1', role: 'officer', signature: sig }).ok, false);
  // Someone holding a copied credential but a different key fails.
  const thief = generateKeys();
  const thiefSig = signText(thief.privateJwk, stopChallengeMessage('stp_1', 'n1', 'officer'));
  assert.equal(id.verifyPresentation({ credential: cred, expectedType: 'officer', stopId: 'stp_1', nonce: 'n1', role: 'officer', signature: thiefSig }).ok, false);

  id.revoke(cred.id, 'suspended');
  assert.match(id.verifyCredential(cred).reason, /suspended/);
});

test('rules triage escalates from the description', () => {
  assert.equal(classifyWithRules({ type: 'breakdown', description: 'flat tire' }).priority, 3);
  const t = classifyWithRules({ type: 'breakdown', description: 'car is stalled and there is smoke' });
  assert.equal(t.category, 'fire');
  assert.equal(t.priority, 1);
  assert.ok(t.services.includes('fire'));
  assert.equal(classifyWithRules({ type: 'other', description: 'my passenger has chest pain' }).category, 'medical');
  // A crash with an injury escalates to P1 but still sends police.
  const crash = classifyWithRules({ type: 'crash', description: 'rear-ended, passenger has chest pain' });
  assert.equal(crash.priority, 1);
  assert.deepEqual(crash.services.sort(), ['ems', 'police']);
});

test('unit selection picks nearest available unit per service', () => {
  const units = [
    { id: 'far', type: 'ems', status: 'available', location: { lat: 34, lng: -84 } },
    { id: 'near', type: 'ems', status: 'available', location: { lat: 36.154, lng: -95.993 } },
    { id: 'busy', type: 'ems', status: 'assigned', location: { lat: 36.153, lng: -95.992 } },
  ];
  const [pick] = selectUnits(units, { lat: 36.153, lng: -95.992 }, ['ems']);
  assert.equal(pick.unitId, 'near');
});
