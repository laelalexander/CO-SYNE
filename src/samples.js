import fs from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../public/canonical.js';
import { generateKeys, randomId } from './crypto.js';

// Sample people and vehicles for simulation. Each gets a real credential
// signed by the demo issuers and a real device key, so the sample stop runs
// through exactly the same verification code as a live one.
export const SAMPLE_DRIVERS = [
  {
    key: 'jordan-lee',
    subject: {
      name: 'Jordan Lee', dob: '1988-04-12', licenseNumber: 'L081204127', licenseClass: 'D', licenseStatus: 'valid',
      licenseExpires: '2029-04-12', restrictions: 'B (corrective lenses)', address: '3420 S Peoria Ave, Tulsa, OK 74105',
      phone: '(918) 555-0142',
      vehicle: { year: 2021, make: 'Toyota', model: 'Camry', color: 'Silver', plate: 'KJR482', state: 'OK', vin: '4T1B11HK5MU123456' },
      registrationStatus: 'valid', registrationExpires: '2027-03-31',
      insurance: 'active', insuranceCarrier: 'State Farm', insurancePolicy: 'SF-36-204411', insuranceExpires: '2027-01-15',
    },
  },
  {
    key: 'maria-gonzalez',
    subject: {
      name: 'Maria Gonzalez', dob: '1995-09-02', licenseNumber: 'G950902554', licenseClass: 'D', licenseStatus: 'valid',
      licenseExpires: '2028-09-02', restrictions: 'None', address: '1811 E 11th St, Tulsa, OK 74104',
      phone: '(918) 555-0199',
      vehicle: { year: 2019, make: 'Honda', model: 'CR-V', color: 'Blue', plate: 'MGZ452', state: 'OK', vin: '2HKRW2H85KH601234' },
      registrationStatus: 'expired', registrationExpires: '2026-08-31',
      insurance: 'active', insuranceCarrier: 'Progressive', insurancePolicy: 'PG-4410-9921', insuranceExpires: '2027-05-01',
      accessibility: 'Deaf. Prefers text chat; can lip-read on video.',
    },
  },
  {
    key: 'james-carter',
    subject: {
      name: 'James Carter', dob: '1979-12-20', licenseNumber: 'C791220778', licenseClass: 'D', licenseStatus: 'valid',
      licenseExpires: '2027-12-20', restrictions: 'None', address: '9808 N 129th E Ave, Owasso, OK 74055',
      phone: '(918) 555-0167',
      vehicle: { year: 2017, make: 'Ford', model: 'F-150', color: 'Black', plate: 'JTC778', state: 'OK', vin: '1FTEW1EP7HFA45678' },
      registrationStatus: 'valid', registrationExpires: '2027-06-30',
      insurance: 'active', insuranceCarrier: 'Allstate', insurancePolicy: 'AL-3021-7765', insuranceExpires: '2026-12-31',
      accessibility: 'Type 1 diabetic. Glucose kit in center console.',
    },
  },
  {
    key: 'aisha-khan',
    subject: {
      name: 'Aisha Khan', dob: '2001-03-15', licenseNumber: 'K010315909', licenseClass: 'D', licenseStatus: 'valid',
      licenseExpires: '2030-03-15', restrictions: 'None', address: '1102 W Main St, Jenks, OK 74037',
      phone: '(918) 555-0123',
      vehicle: { year: 2023, make: 'Tesla', model: 'Model 3', color: 'White', plate: 'AKH202', state: 'OK', vin: '5YJ3E1EA9PF456789' },
      registrationStatus: 'valid', registrationExpires: '2027-02-28',
      insurance: 'active', insuranceCarrier: 'GEICO', insurancePolicy: 'GE-7788-1200', insuranceExpires: '2027-02-28',
    },
  },
];

export const SAMPLE_OFFICERS = [
  { key: 'dana-rivera', subject: { name: 'Officer Dana Rivera', badge: '4471', rank: 'Patrol Officer', unit: 'Riverside 212', division: 'Riverside Division', agencyId: 'tulsa-pd' } },
  { key: 'kevin-tran', subject: { name: 'Officer Kevin Tran', badge: '3920', rank: 'Corporal', unit: 'Gilcrease 131', division: 'Gilcrease Division', agencyId: 'tulsa-pd' } },
  { key: 'marcus-hale', subject: { name: 'Deputy Marcus Hale', badge: '218', rank: 'Deputy Sheriff', unit: 'TCSO 32', division: 'North Patrol', agencyId: 'tcso' } },
];

export const officerIssuer = (agencyId) => (agencyId === 'tcso' ? 'tcso' : 'tulsa-pd');

// Loads sample identities from disk (so credential ids and stickers stay the
// same across restarts) or creates them.
export function loadSamples({ file, identity }) {
  let saved = {};
  if (file && fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = { drivers: [], officers: [] };
  let changed = false;
  const make = (def, type) => {
    let rec = saved[def.key];
    // Re-issue when the sample definition changed or the issuer keys rotated.
    const valid = rec && identity.verifyCredential(rec.credential, type).ok && canonicalize(rec.credential.subject) === canonicalize(def.subject);
    if (!valid) {
      const keys = generateKeys();
      const subject = structuredClone(def.subject);
      const issuerId = type === 'officer' ? officerIssuer(subject.agencyId) : 'service-ok';
      rec = { ...keys, credential: identity.issue({ issuerId, type, subject, subjectKey: keys.publicJwk }) };
      if (type === 'driver') rec.stickerId = saved[def.key]?.stickerId ?? randomId('stk', 6);
      saved[def.key] = rec;
      changed = true;
    }
    return { key: def.key, ...rec };
  };
  for (const d of SAMPLE_DRIVERS) out.drivers.push(make(d, 'driver'));
  for (const o of SAMPLE_OFFICERS) out.officers.push(make(o, 'officer'));
  if (file && changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  }
  return out;
}

export const STOP_REASONS = [
  'Speeding', 'Expired registration', 'Equipment violation (lights)', 'Lane violation', 'Failure to stop', 'Welfare check', 'Investigative stop', 'Other',
];

// Simulated records checks (stand-in for DMV, insurance, and NCIC lookups).
export function recordsCheck(subject = {}, now = Date.now()) {
  const expired = (d) => d && Date.parse(d) < now;
  const v = subject.vehicle ?? {};
  return [
    { label: 'Driver license', ok: subject.licenseStatus === 'valid' && !expired(subject.licenseExpires), detail: `${subject.licenseStatus ?? 'unknown'} · class ${subject.licenseClass ?? '?'} · exp ${subject.licenseExpires ?? '?'}` },
    { label: 'Registration', ok: subject.registrationStatus === 'valid' && !expired(subject.registrationExpires), detail: `${expired(subject.registrationExpires) ? 'EXPIRED' : subject.registrationStatus ?? 'unknown'} · exp ${subject.registrationExpires ?? '?'}` },
    { label: 'Insurance', ok: subject.insurance === 'active' && !expired(subject.insuranceExpires), detail: `${subject.insurance ?? 'unknown'} · ${subject.insuranceCarrier ?? ''} ${subject.insurancePolicy ?? ''}`.trim() },
    { label: 'Warrants', ok: !(subject.warrants), detail: subject.warrants ?? 'None on file (simulated)' },
    { label: 'Stolen vehicle', ok: true, detail: `Not reported · VIN ${v.vin ?? 'unknown'}` },
  ];
}
