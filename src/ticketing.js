import { canonicalize } from '../public/canonical.js';
import { sha256 } from './crypto.js';

// Pilot violation catalog: Oklahoma Title 47 references. Fines are sample
// values for the demonstration, not the court's bond schedule.
export const VIOLATIONS = [
  { code: 'SPD-10', statute: '47 O.S. § 11-801', description: 'Speeding 1 to 10 mph over the limit', fine: 172 },
  { code: 'SPD-15', statute: '47 O.S. § 11-801', description: 'Speeding 11 to 15 mph over the limit', fine: 197 },
  { code: 'SPD-25', statute: '47 O.S. § 11-801', description: 'Speeding 16 to 25 mph over the limit', fine: 247 },
  { code: 'REG-EXP', statute: '47 O.S. § 1151', description: 'Expired or no vehicle registration (tag)', fine: 132 },
  { code: 'INS-NONE', statute: '47 O.S. § 7-606', description: 'Failure to maintain compulsory insurance', fine: 250 },
  { code: 'EQP-LGT', statute: '47 O.S. § 12-201', description: 'Defective or inoperable headlamp or tail lamp', fine: 95 },
  { code: 'LANE', statute: '47 O.S. § 11-309', description: 'Failure to maintain lane / unsafe lane change', fine: 182 },
  { code: 'STOP', statute: '47 O.S. § 11-403', description: 'Failure to stop at stop sign', fine: 182 },
  { code: 'BELT', statute: '47 O.S. § 12-417', description: 'Seat belt violation', fine: 20 },
  { code: 'PHONE', statute: '47 O.S. § 11-901d', description: 'Texting while driving', fine: 100 },
];

export const COURTS = {
  'tulsa-pd': { name: 'Tulsa Municipal Court', address: '600 Civic Center, Tulsa, OK 74103' },
  tcso: { name: 'Tulsa County District Court (Traffic)', address: '500 S Denver Ave, Tulsa, OK 74103' },
};

// The exact text an officer signs to issue a citation, and a driver signs to
// acknowledge receipt (acknowledgement is not an admission).
export function citationSigningPayload({ stopId, type, violationCodes, notes, issuedAt }) {
  return canonicalize({ v: 'CO-SYNE/citation/v1', stopId, type, violationCodes: [...violationCodes].sort(), notes: notes ?? '', issuedAt });
}
export const citationAckMessage = (citationId, hash) => `CO-SYNE/citation-ack/v1|${citationId}|${hash}`;

let counter = 0;
export function buildCitation({ stop, type, violationCodes, notes, issuedAt, officerSignature }) {
  const violations = violationCodes.map((code) => {
    const v = VIOLATIONS.find((x) => x.code === code);
    if (!v) throw new Error(`unknown violation ${code}`);
    return { ...v };
  });
  if (!violations.length) throw new Error('select at least one violation');
  const year = new Date(issuedAt).getFullYear();
  const court = COURTS[stop.officerCredential.issuer] ?? COURTS['tulsa-pd'];
  const courtDate = new Date(Date.parse(issuedAt) + 30 * 86400_000);
  courtDate.setHours(9, 0, 0, 0);
  const d = stop.driverProfile ?? {};
  const doc = {
    id: `${type === 'warning' ? 'WRN' : 'CIT'}-${year}-${String(Date.now() % 1e6).padStart(6, '0')}${++counter % 10}`,
    type,
    stopId: stop.id,
    issuedAt,
    location: stop.location,
    officer: { name: stop.officerProfile.name, badge: stop.officerProfile.badge, agency: stop.officerProfile.agency, unit: stop.officerProfile.unit, division: stop.officerProfile.division, credentialId: stop.officerCredential.id },
    driver: { name: d.name, dob: d.dob, licenseNumber: d.licenseNumber, address: d.address, credentialId: d.credentialId },
    vehicle: d.vehicle ?? { plate: stop.plate },
    violations,
    notes: notes ?? '',
    totalFine: type === 'warning' ? 0 : violations.reduce((s, v) => s + v.fine, 0),
    court: type === 'warning' ? null : { ...court, date: courtDate.toISOString() },
    payBy: type === 'warning' ? null : new Date(Date.parse(issuedAt) + 28 * 86400_000).toISOString().slice(0, 10),
    officerSignature,
  };
  doc.hash = sha256(canonicalize(doc));
  doc.status = type === 'warning' ? 'issued' : 'unpaid';
  return doc;
}

// Incident report assembled from everything the stop recorded.
export function buildReport({ stop, citations, evidence, ledgerEntries, narrative, disposition, filedAt }) {
  const doc = {
    id: `RPT-${stop.id.slice(4, 12).toUpperCase()}`,
    stopId: stop.id,
    filedAt,
    disposition,
    reason: stop.reason ?? null,
    startedAt: stop.createdAt,
    durationMin: Math.max(1, Math.round((Date.parse(filedAt) - Date.parse(stop.createdAt)) / 60000)),
    location: stop.location,
    method: stop.via === 'sticker' ? 'CO-SYNE QR sticker scan' : 'Plate lookup',
    officer: stop.officerProfile,
    driver: stop.driverProfile,
    driverDeviceConfirmed: stop.proofs.driver,
    checks: stop.checks ?? [],
    citations: citations.map((c) => ({ id: c.id, type: c.type, violations: c.violations.map((v) => v.code), totalFine: c.totalFine, hash: c.hash, acknowledged: Boolean(c.ack) })),
    evidence: evidence.map((e) => ({ sha256: e.data.sha256, kind: e.data.kind, by: e.data.by, ledgerSeq: e.seq })),
    timeline: ledgerEntries.map((e) => ({ seq: e.seq, ts: e.ts, type: e.type })),
    narrative: String(narrative ?? '').slice(0, 10_000),
  };
  doc.hash = sha256(canonicalize(doc));
  return doc;
}
