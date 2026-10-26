import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { randomId } from './crypto.js';

// The state CO-SYNE program: residents apply, the state checks their REAL ID
// record, approves, and issues a signed driver credential with a sticker set
// (bumper sticker, window sticker and plate tag). Membership is annual.
//
// Fee: PROGRAM_FEE (default 24.99) a year. The state share (STATE_SHARE,
// default 0.38) is kept exact per payment, so totals are exact; each payment
// shows it rounded to cents ($9.50 state, $15.49 administration).

export const STATUSES = ['submitted', 'verified', 'approved', 'issued', 'active', 'declined', 'revoked'];
const round2 = (n) => Math.round(n * 100) / 100;
const DAY = 86400_000;

// Demo stand-in for the state's driver license system. Sample drivers are
// on file; any other license number gets a matching record, which is REAL
// ID-compliant unless the number ends in an odd digit (so the decline path
// can be demonstrated).
function simulatedLicenseRecord(app, samples) {
  const ln = String(app.applicant.licenseNumber ?? '').toUpperCase();
  const sample = samples.find((s) => String(s.licenseNumber).toUpperCase() === ln);
  if (sample) return { found: true, name: sample.name, dob: sample.dob, licenseNumber: ln, licenseClass: sample.licenseClass ?? 'D', status: sample.licenseStatus ?? 'valid', expires: sample.licenseExpires, realId: true, source: 'sample' };
  if (!/^[A-Z0-9]{6,12}$/.test(ln)) return { found: false, licenseNumber: ln };
  const last = Number(ln.at(-1));
  return {
    found: true, name: app.applicant.name, dob: app.applicant.dob, licenseNumber: ln, licenseClass: 'D', status: 'valid',
    expires: new Date(Date.now() + 4 * 365 * DAY).toISOString().slice(0, 10), realId: Number.isNaN(last) || last % 2 === 0, source: 'simulated',
  };
}

export class ProgramService {
  constructor({ dataDir, env = {}, jurisdictions, samples = [] }) {
    this.file = dataDir ? path.join(dataDir, 'program.json') : null;
    this.fee = Number(env.PROGRAM_FEE) || 24.99;
    this.stateShareRate = env.STATE_SHARE != null ? Number(env.STATE_SHARE) : 0.38;
    this.jurisdictions = jurisdictions; // [{ code, name, issuerId }]
    this.samples = samples;
    let saved = {};
    if (this.file && fs.existsSync(this.file)) saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.apps = new Map((saved.applications ?? []).map((a) => [a.id, a]));
    this.payments = saved.payments ?? [];
    // Letterhead and contact details per state, edited in the console.
    this.settings = saved.settings ?? {};
  }

  settingsFor(code) {
    const j = this.jurisdiction(code);
    return { departmentName: j?.issuerName ?? '', officeAddress: '', phone: '', website: '', signerName: '', signerTitle: 'Program Director', ...(this.settings[code] ?? {}) };
  }

  updateSettings(code, s) {
    const str = (v, max) => String(v ?? '').trim().slice(0, max);
    this.settings[code] = { departmentName: str(s.departmentName, 120), officeAddress: str(s.officeAddress, 200), phone: str(s.phone, 40), website: str(s.website, 120), signerName: str(s.signerName, 80), signerTitle: str(s.signerTitle, 80) };
    this.save();
    return this.settingsFor(code);
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ applications: [...this.apps.values()], payments: this.payments, settings: this.settings }), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }

  split(amount = this.fee) {
    const stateShare = amount * this.stateShareRate;
    return { amount, stateShare, adminFee: amount - stateShare, stateShareRounded: round2(stateShare), adminFeeRounded: round2(amount - stateShare) };
  }

  jurisdiction(code) { return this.jurisdictions.find((j) => j.code === code) ?? null; }

  log(app, action, by, note) {
    (app.history ??= []).push({ at: new Date().toISOString(), action, by: by ?? 'system', note: note ?? null });
  }

  // payment: { method: 'card', last4 } (simulated: nothing is charged)
  recordPayment(app, kind, payment = {}) {
    const s = this.split();
    const p = {
      id: randomId('pay', 6), at: new Date().toISOString(), applicationId: app.id, kind, jurisdiction: app.jurisdiction,
      county: app.applicant.address?.county || 'Unknown', amount: s.amount, stateShare: s.stateShare, adminFee: s.adminFee,
      method: payment.method ?? 'card', last4: String(payment.last4 ?? '').slice(-4) || null, simulated: true,
      confirmation: randomId('CSY', 5).toUpperCase(),
    };
    this.payments.push(p);
    return p;
  }

  refund(app, original) {
    const p = { ...original, id: randomId('pay', 6), at: new Date().toISOString(), kind: 'refund', amount: -original.amount, stateShare: -original.stateShare, adminFee: -original.adminFee, confirmation: randomId('RFD', 5).toUpperCase() };
    this.payments.push(p);
    return p;
  }

  apply(body) {
    const str = (v, max) => String(v ?? '').trim().slice(0, max);
    const j = this.jurisdiction(str(body.jurisdiction, 4).toUpperCase());
    if (!j) throw Object.assign(new Error('choose a participating state'), { status: 400 });
    const a = body.applicant ?? {};
    const v = body.vehicle ?? {};
    const applicant = {
      name: str(a.name, 100), dob: str(a.dob, 10), licenseNumber: str(a.licenseNumber, 20).toUpperCase().replace(/[^A-Z0-9]/g, ''),
      email: str(a.email, 160).toLowerCase(), phone: str(a.phone, 40), accessibility: str(a.accessibility, 300),
      address: { street: str(a.address?.street, 160), city: str(a.address?.city, 80), county: str(a.address?.county, 80), state: j.code, zip: str(a.address?.zip, 10) },
    };
    const vehicle = { plate: str(v.plate, 10).toUpperCase().replace(/[^A-Z0-9]/g, ''), state: j.code, year: Number(v.year) || null, make: str(v.make, 40), model: str(v.model, 40), color: str(v.color, 30), vin: str(v.vin, 17).toUpperCase() };
    const missing = [['name', applicant.name.length >= 2], ['date of birth', /^\d{4}-\d{2}-\d{2}$/.test(applicant.dob)], ['license number', applicant.licenseNumber.length >= 6],
      ['street address', applicant.address.street], ['city', applicant.address.city], ['county', applicant.address.county], ['ZIP code', applicant.address.zip], ['license plate', vehicle.plate.length >= 2]]
      .filter(([, ok]) => !ok).map(([n]) => n);
    if (missing.length) throw Object.assign(new Error(`please enter your ${missing.join(', ')}`), { status: 400 });
    if (!body.consent) throw Object.assign(new Error('please agree to the program terms and privacy notice'), { status: 400 });
    const pk = body.publicJwk;
    if (pk && !(pk.kty === 'OKP' && pk.crv === 'Ed25519' && typeof pk.x === 'string')) throw Object.assign(new Error('invalid device key'), { status: 400 });
    const app = {
      id: `APP-${randomBytes(4).toString('hex').toUpperCase()}`, token: randomBytes(18).toString('base64url'), jurisdiction: j.code, issuerId: j.issuerId,
      status: 'submitted', submittedAt: new Date().toISOString(), channel: pk ? 'driver-app' : 'web', applicant, vehicle,
      publicJwk: pk ? { kty: 'OKP', crv: 'Ed25519', x: pk.x } : null, realId: null, credentialId: null, stickerId: null, activationCode: null,
      issuedAt: null, expiresAt: null, mailedAt: null, history: [],
    };
    app.payment = { method: 'card', last4: String(body.payment?.last4 ?? '').slice(-4) || null, authorizedAt: new Date().toISOString(), simulated: true };
    this.log(app, 'submitted', 'applicant', (app.channel === 'web' ? 'Applied online' : 'Applied in the Driver app') + ' · fee authorized, charged on approval');
    this.apps.set(app.id, app);
    this.save();
    return app;
  }

  get(id) { return this.apps.get(id) ?? null; }

  checkIdentity(app, by) {
    const rec = simulatedLicenseRecord(app, this.samples);
    const nameMatch = rec.found && rec.name?.toLowerCase().replace(/[^a-z]/g, '') === app.applicant.name.toLowerCase().replace(/[^a-z]/g, '');
    const dobMatch = rec.found && rec.dob === app.applicant.dob;
    const ok = rec.found && nameMatch && dobMatch && rec.status === 'valid' && rec.realId;
    app.realId = { at: new Date().toISOString(), by, simulated: true, found: rec.found, nameMatch, dobMatch, realId: Boolean(rec.realId), licenseStatus: rec.status ?? null, licenseClass: rec.licenseClass ?? null, licenseExpires: rec.expires ?? null, ok };
    if (ok && app.status === 'submitted') app.status = 'verified';
    this.log(app, ok ? 'identity_verified' : 'identity_not_verified', by,
      ok ? 'REAL ID-compliant license on file (simulated lookup)' : !rec.found ? 'No license on file' : !rec.realId ? 'License on file is not REAL ID-compliant' : 'Name, date of birth or license status does not match');
    this.save();
    return app.realId;
  }

  decline(app, by, reason) {
    if (['issued', 'active'].includes(app.status)) throw Object.assign(new Error('revoke an issued enrollment instead'), { status: 409 });
    app.status = 'declined';
    app.declineReason = String(reason ?? 'Not eligible').slice(0, 300);
    this.log(app, 'declined', by, app.declineReason + ' · not charged');
    this.save();
  }

  dueForRenewal(withinDays = 60, now = Date.now()) {
    return [...this.apps.values()].filter((a) => a.expiresAt && ['issued', 'active'].includes(a.status) && Date.parse(a.expiresAt) - now < withinDays * DAY);
  }

  revenue({ jurisdiction } = {}) {
    const rows = this.payments.filter((p) => !jurisdiction || p.jurisdiction === jurisdiction);
    const sum = (list) => list.reduce((t, p) => ({ count: t.count + (p.kind === 'refund' ? -1 : 1), amount: t.amount + p.amount, stateShare: t.stateShare + p.stateShare, adminFee: t.adminFee + p.adminFee }), { count: 0, amount: 0, stateShare: 0, adminFee: 0 });
    const group = (keyOf) => {
      const m = new Map();
      for (const p of rows) { const k = keyOf(p); (m.get(k) ?? m.set(k, []).get(k)).push(p); }
      return [...m.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0]))).map(([k, list]) => ({ key: k, ...money(sum(list)) }));
    };
    const money = (t) => ({ count: t.count, amount: round2(t.amount), stateShare: round2(t.stateShare), adminFee: round2(t.adminFee) });
    return {
      fee: this.fee, stateShareRate: this.stateShareRate, perPayment: { stateShare: this.split().stateShareRounded, adminFee: this.split().adminFeeRounded },
      totals: money(sum(rows)), byMonth: group((p) => p.at.slice(0, 7)), byCounty: group((p) => `${p.jurisdiction} · ${p.county}`), payments: rows,
    };
  }

  counts() {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const a of this.apps.values()) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }
}
