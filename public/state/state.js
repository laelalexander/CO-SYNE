// CO-SYNE State Issuer Console: a state DMV, DOT or federal partner reviews
// applications, checks REAL ID records, issues credentials and sticker sets,
// prints letters, manages renewals and sees the revenue split.
import { api, bootstrap, url } from '../lib/session.js';
import { icon } from '../lib/icons.js';
import { openDemoBadge, redeemDemoPass } from '../lib/demo.js';
import { LETTER_CSS, STICKER_CSS, approvalLetter, receivedNotice, infoNeededNotice, declinedNotice, enclosureGuide, stickerSet } from '../lib/letters.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const d = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const STATUS = { submitted: 'Submitted', verified: 'Identity verified', approved: 'Approved', issued: 'Issued', active: 'Active', declined: 'Declined', revoked: 'Revoked' };
const FLOW = ['submitted', 'verified', 'approved', 'issued', 'active'];

const S = {
  config: null, view: 'dashboard', jurisdiction: null, filter: { status: '', q: '' }, selected: null, info: null,
  session: (() => { try { return JSON.parse(sessionStorage.getItem('cosyne:state') ?? 'null'); } catch { return null; } })(),
};
const call = async (method, path, body) => {
  try { return await api(method, path, body, S.session?.token); } catch (e) {
    if (/sign in required|requires state/.test(e.message)) { signOut('Your session ended. Sign in again.'); }
    throw e;
  }
};
const toast = (t) => { const el = Object.assign(document.createElement('div'), { className: 'toast-x', textContent: t }); document.body.append(el); setTimeout(() => el.remove(), 3500); };
const statusPill = (a) => (a.expired && ['issued', 'active'].includes(a.status) ? '<span class="status expired">Expired</span>' : `<span class="status ${a.status}">${STATUS[a.status] ?? a.status}</span>`);
const jName = (code) => S.info?.jurisdictions.find((j) => j.code === code)?.name ?? code;

// ---------- sign-in ----------
function renderLogin(msg = '') {
  $('#app').classList.add('hidden');
  const el = $('#login'); el.classList.remove('hidden');
  el.innerHTML = `<div class="card"><div class="dg-head" style="margin-bottom:18px"><img src="../icons/state.svg" width="48" height="48" alt=""><div><h2 style="margin:0">CO-SYNE State Issuer Console</h2><p class="small muted" style="margin:2px 0 0">For state DMVs, DOTs and federal partners</p></div></div>
    <form id="lf" class="form"><label>Your name<input name="name" required autocomplete="name" placeholder="e.g. J. Rivera, Program Office" value="${S.config?.openDemo ? 'Demo Program Office' : ''}"></label>
      ${S.config?.openDemo ? '' : `<label>Issuer access code<input name="token" type="password" required autocomplete="current-password" value="${S.config?.demo ? 'state-demo' : ''}"></label>`}
      <button class="btn btn-primary">${S.config?.openDemo ? 'Continue' : 'Sign in'}</button></form>
    <p class="small" id="lmsg" style="color:var(--danger);min-height:1.2em;margin-top:10px">${esc(msg)}</p>
    <p class="tiny muted">Every sign-in and action is recorded in the CO-SYNE evidence ledger.</p></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('POST', '/api/state/login', S.config?.openDemo ? { name: f.name, open: true } : f);
      S.session = { token: r.token, name: r.name, jurisdictions: r.jurisdictions };
      try { sessionStorage.setItem('cosyne:state', JSON.stringify(S.session)); } catch { /* ignore */ }
      start();
    } catch (err) { $('#lmsg').textContent = err.message; }
  };
}
function signOut(msg) {
  S.session = null;
  try { sessionStorage.removeItem('cosyne:state'); } catch { /* ignore */ }
  renderLogin(msg ?? '');
}

async function start() {
  S.info = await api('GET', '/api/program/info');
  S.jurisdiction = S.jurisdiction ?? S.session.jurisdictions[0];
  try { await call('GET', `/api/state/overview?jurisdiction=${S.jurisdiction}`); } catch { return; }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#juris').innerHTML = S.session.jurisdictions.map((c) => `<option value="${esc(c)}">${esc(jName(c))} (${esc(c)})</option>`).join('');
  $('#juris').value = S.jurisdiction;
  $('#juris').onchange = (e) => { S.jurisdiction = e.target.value; S.selected = null; render(); };
  $('#who').textContent = S.session.name;
  $('#signout').onclick = () => signOut();
  $('#menu').innerHTML = icon('list');
  $('#menu').onclick = () => $('#app').classList.toggle('menu-open');
  render();
}

// ---------- shell ----------
const VIEWS = [['dashboard', 'Dashboard', 'activity'], ['applications', 'Applications', 'file'], ['print', 'Print center', 'printer'], ['renewals', 'Renewals', 'clock'], ['revenue', 'Revenue', 'wallet'], ['partners', 'Partner states', 'network'], ['settings', 'Letter settings', 'settings']];
async function render() {
  const ov = await call('GET', `/api/state/overview?jurisdiction=${S.jurisdiction}`).catch(() => null);
  S.ov = ov;
  const badge = { applications: ov ? ov.counts.submitted + ov.counts.verified + ov.counts.approved : 0, print: ov?.awaitingPrint ?? 0, renewals: ov?.renewalsDue ?? 0 };
  $('#side').innerHTML = VIEWS.map(([id, label, ic]) => `<button class="${S.view === id ? 'on' : ''}" data-v="${id}">${icon(ic)}<span>${label}</span>${badge[id] ? `<i class="n">${badge[id]}</i>` : ''}</button>`).join('')
    + `<hr style="border:0;border-top:1px solid var(--line);margin:10px 4px"><a class="btn btn-ghost btn-sm" style="padding-left:12px" href="../cosyne_states.html">${icon('home')} About the program</a>`;
  $$('#side [data-v]').forEach((b) => { b.onclick = () => { S.view = b.dataset.v; S.selected = null; $('#app').classList.remove('menu-open'); render(); }; });
  $('#sub').textContent = `${jName(S.jurisdiction)} · ${ov?.jurisdictions?.find((j) => j.code === S.jurisdiction)?.issuerName ?? ''}`;
  const main = $('#main');
  main.innerHTML = '';
  await PAGES[S.view](main, ov);
}

// ---------- pages ----------
const PAGES = {
  async dashboard(main, ov) {
    const c = ov.counts;
    main.innerHTML = `<div class="st-head"><div><h1>Program dashboard</h1><p>CO-SYNE Verified Roadside program · ${esc(jName(S.jurisdiction))}</p></div>
      <button class="btn btn-primary" data-go="applications">${icon('file')} Review applications</button></div>
      <div class="kpis">
        <div class="kpi warn"><b>${c.submitted}</b><span>New applications</span></div>
        <div class="kpi blue"><b>${c.verified + c.approved}</b><span>Verified or approved, awaiting issue</span></div>
        <div class="kpi"><b>${ov.awaitingPrint}</b><span>Sticker sets to print and mail</span></div>
        <div class="kpi ok"><b>${c.active}</b><span>Active members</span></div>
        <div class="kpi"><b>${ov.renewalsDue}</b><span>Renewals due in 60 days</span></div>
        <div class="kpi"><b>${money(ov.revenue.stateShare)}</b><span>State share collected (${Math.round(ov.stateShareRate * 100)}%)</span></div>
      </div>
      <div class="grid grid-2">
        <div class="panel"><header><h2>Resident flow</h2></header><div class="body"><ol class="steps-v">
          <li class="done"><i>1</i><div><b>Apply</b><div class="small muted">In the Driver app or online. The card is authorized for ${money(S.info.fee)}; it is charged only on approval.</div></div></li>
          <li class="done"><i>2</i><div><b>REAL ID check</b><div class="small muted">Name, date of birth and license confirmed against the state's REAL ID-compliant record.</div></div></li>
          <li class="done"><i>3</i><div><b>Approve and issue</b><div class="small muted">A credential signed by the state, bound to the resident's phone, and a sticker set.</div></div></li>
          <li class="done"><i>4</i><div><b>Mail the letter and stickers</b><div class="small muted">Bumper sticker, window sticker and plate tag.</div></div></li>
          <li class="done"><i>5</i><div><b>Verified at every stop</b><div class="small muted">Any agency's officer terminal verifies the state's signature.</div></div></li></ol></div></div>
        <div class="panel"><header><h2>Fee and revenue split</h2><button class="btn btn-secondary btn-sm" data-go="revenue">Revenue report</button></header><div class="body">
          <dl class="facts"><dt>Annual fee</dt><dd><b>${money(S.info.fee)}</b> per resident</dd><dt>State share</dt><dd>${money(S.info.perPayment.stateShare)} (${Math.round(S.info.stateShareRate * 100)}%)</dd><dt>Program administration</dt><dd>${money(S.info.perPayment.adminFee)}</dd>
            <dt>Collected to date</dt><dd>${money(ov.revenue.amount)} from ${ov.revenue.count} payment${ov.revenue.count === 1 ? '' : 's'}</dd></dl>
          <p class="sim" style="margin-top:12px">Payments are simulated in the pilot; no card is charged.</p></div></div>
      </div>`;
    $$('[data-go]', main).forEach((b) => { b.onclick = () => { S.view = b.dataset.go; render(); }; });
  },

  async applications(main) {
    if (S.selected) return detail(main, S.selected);
    const f = S.filter;
    const qs = new URLSearchParams({ jurisdiction: S.jurisdiction, ...(f.status ? { status: f.status } : {}), ...(f.q ? { q: f.q } : {}) });
    const { applications } = await call('GET', `/api/state/applications?${qs}`);
    main.innerHTML = `<div class="st-head"><div><h1>Applications</h1><p>Review, verify, approve and issue.</p></div>
      <div class="filters"><input id="q" placeholder="Search name, license, plate, county, number" value="${esc(f.q)}">
        <select id="st"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div>
      <div class="panel scroll"><table class="tbl"><tr><th>Application</th><th>Applicant</th><th>Vehicle</th><th>County</th><th>Submitted</th><th>REAL ID</th><th>Status</th></tr>
        ${applications.map((a) => `<tr class="click" data-id="${esc(a.id)}"><td class="mono small">${esc(a.id)}<div class="tiny muted">${a.channel === 'web' ? 'Online' : 'Driver app'}</div></td><td><b>${esc(a.applicant.name)}</b><div class="tiny muted">DL ${esc(a.applicant.licenseNumber)}</div></td>
          <td>${esc(a.vehicle.plate)}<div class="tiny muted">${esc([a.vehicle.year, a.vehicle.make, a.vehicle.model].filter(Boolean).join(' '))}</div></td><td>${esc(a.applicant.address.county)}</td><td class="small">${dt(a.submittedAt)}</td>
          <td>${a.realId ? (a.realId.ok ? '<span class="status active">Verified</span>' : '<span class="status declined">Not verified</span>') : '<span class="muted small">Not checked</span>'}</td><td>${statusPill(a)}${a.infoNeeded ? '<div class="tiny" style="color:var(--warn)">Info requested</div>' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">No applications match.</td></tr>'}</table></div>`;
    let t;
    $('#q', main).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; PAGES.applications(main); }, 300); };
    $('#st', main).onchange = (e) => { f.status = e.target.value; PAGES.applications(main); };
    $$('[data-id]', main).forEach((r) => { r.onclick = () => { S.selected = r.dataset.id; PAGES.applications(main); }; });
    if (f.q) { const q = $('#q', main); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  },

  async print(main) {
    const { applications } = await call('GET', `/api/state/applications?jurisdiction=${S.jurisdiction}&status=issued`);
    main.innerHTML = `<div class="st-head"><div><h1>Print center</h1><p>Sticker sets and approval letters for issued enrollments, ready to mail.</p></div></div>
      <div class="panel"><header><h2>${applications.length} set${applications.length === 1 ? '' : 's'} to print</h2>
        <div class="filters"><button class="btn btn-secondary btn-sm" id="p-letters">${icon('file')} Letters and guides</button><button class="btn btn-secondary btn-sm" id="p-small">${icon('printer')} Window stickers and plate tags (letter)</button><button class="btn btn-secondary btn-sm" id="p-bumper">${icon('printer')} Bumper stickers (tabloid)</button><button class="btn btn-primary btn-sm" id="p-mailed">Mark selected as mailed</button></div></header>
        <div class="scroll"><table class="tbl"><tr><th><input type="checkbox" id="all" checked></th><th>Application</th><th>Applicant</th><th>Plate</th><th>Sticker</th><th>Issued</th><th>Activation</th></tr>
          ${applications.map((a) => `<tr><td><input type="checkbox" class="pick" value="${esc(a.id)}" checked></td><td class="mono small">${esc(a.id)}</td><td>${esc(a.applicant.name)}<div class="tiny muted">${esc(a.applicant.address.city)}, ${esc(a.applicant.address.zip)}</div></td><td>${esc(a.vehicle.plate)}</td><td class="mono small">${esc(a.stickerId?.slice(4, 10).toUpperCase())}</td><td class="small">${d(a.issuedAt)}</td><td class="small">${a.activationCode ? 'Code in letter' : 'Linked to phone'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">Nothing waiting. Issued sets appear here.</td></tr>'}</table></div></div>
      <p class="small muted">Window stickers (4 × 4 in) and plate tags (2 × 2 in) print at actual size on letter paper, two sets a page. Bumper stickers (11.5 × 3 in) print three to a tabloid (11 × 17 in) page, or send the same page to your sticker vendor.</p>`;
    const picked = () => applications.filter((a) => $$('.pick', main).find((c) => c.value === a.id)?.checked);
    $('#all', main)?.addEventListener('change', (e) => $$('.pick', main).forEach((c) => { c.checked = e.target.checked; }));
    $('#p-letters', main).onclick = () => printLetters(picked());
    $('#p-small', main).onclick = () => printSmall(picked());
    $('#p-bumper', main).onclick = () => printBumpers(picked());
    $('#p-mailed', main).onclick = async () => {
      const list = picked(); if (!list.length) return;
      for (const a of list) await call('POST', `/api/state/applications/${a.id}/mailed`).catch(() => {});
      toast(`${list.length} marked as mailed`); render();
    };
  },

  async renewals(main) {
    const { renewals } = await call('GET', '/api/state/renewals');
    const list = renewals.filter((a) => a.jurisdiction === S.jurisdiction);
    main.innerHTML = `<div class="st-head"><div><h1>Renewals</h1><p>Memberships expiring in the next 60 days, and expired ones. Residents get an automatic reminder 30 and 7 days before expiry and renew in the Driver app.</p></div></div>
      <div class="panel scroll"><table class="tbl"><tr><th>Applicant</th><th>Plate</th><th>Expires</th><th>Status</th><th></th></tr>
        ${list.map((a) => `<tr><td><b>${esc(a.applicant.name)}</b><div class="tiny muted mono">${esc(a.id)}</div></td><td>${esc(a.vehicle.plate)}</td><td>${d(a.expiresAt)}</td><td>${statusPill(a)}</td><td>${a.credentialId ? `<button class="btn btn-secondary btn-sm" data-remind="${esc(a.id)}">${icon('bell')} Send reminder</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">No renewals due.</td></tr>'}</table></div>`;
    $$('[data-remind]', main).forEach((b) => { b.onclick = async () => { try { const r = await call('POST', `/api/state/applications/${b.dataset.remind}/remind`); toast(r.delivered ? 'Reminder sent to the resident\'s phone' : 'The resident has not turned on phone alerts'); } catch (e) { toast(e.message); } }; });
  },

  async revenue(main) {
    const r = await call('GET', `/api/state/revenue?jurisdiction=${S.jurisdiction}`);
    const max = Math.max(1, ...r.byMonth.map((m) => m.amount));
    main.innerHTML = `<div class="st-head"><div><h1>Revenue</h1><p>Every annual fee of ${money(r.fee)} is split ${Math.round(r.stateShareRate * 100)}% to the state (${money(r.perPayment.stateShare)}) and ${100 - Math.round(r.stateShareRate * 100)}% to program administration (${money(r.perPayment.adminFee)}).</p></div>
      <a class="btn btn-secondary" href="#" id="csv">${icon('file')} Export CSV</a></div>
      <div class="kpis"><div class="kpi"><b>${r.totals.count}</b><span>Payments</span></div><div class="kpi"><b>${money(r.totals.amount)}</b><span>Collected</span></div>
        <div class="kpi blue"><b>${money(r.totals.stateShare)}</b><span>State share</span></div><div class="kpi"><b>${money(r.totals.adminFee)}</b><span>Program administration</span></div></div>
      <div class="grid grid-2">
        <div class="panel"><header><h2>By month</h2><span class="legend"><span><i style="background:var(--blue)"></i>State</span><span><i style="background:#a6cdef"></i>Administration</span></span></header><div class="body bars">
          ${r.byMonth.map((m) => `<div class="bar-row"><span>${esc(m.key)}</span><span class="track"><i class="s" style="width:${(m.stateShare / max) * 100}%"></i><i class="a" style="width:${(m.adminFee / max) * 100}%"></i></span><span class="num">${money(m.amount)}</span></div>`).join('') || '<p class="muted">No payments yet.</p>'}</div></div>
        <div class="panel scroll"><header><h2>By county</h2></header><table class="tbl"><tr><th>County</th><th class="num">Payments</th><th class="num">State share</th><th class="num">Administration</th></tr>
          ${r.byCounty.map((c) => `<tr><td>${esc(c.key.split(' · ')[1])}</td><td class="num">${c.count}</td><td class="num">${money(c.stateShare)}</td><td class="num">${money(c.adminFee)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No payments yet.</td></tr>'}</table></div>
      </div>
      <div class="panel scroll"><header><h2>Recent payments</h2></header><table class="tbl"><tr><th>Date</th><th>Application</th><th>Kind</th><th class="num">Amount</th><th class="num">State</th><th class="num">Administration</th><th>Confirmation</th></tr>
        ${r.recent.map((p) => `<tr><td class="small">${dt(p.at)}</td><td class="mono small">${esc(p.applicationId)}</td><td>${esc(p.kind)}</td><td class="num">${money(p.amount)}</td><td class="num">${money(p.stateShare)}</td><td class="num">${money(p.adminFee)}</td><td class="mono small">${esc(p.confirmation)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No payments yet.</td></tr>'}</table></div>
      <p class="sim">Simulated payments: no card is charged in the pilot.</p>`;
    $('#csv', main).onclick = async (e) => {
      e.preventDefault();
      const res = await fetch(url(`/api/state/revenue?jurisdiction=${S.jurisdiction}&format=csv`), { headers: { authorization: `Bearer ${S.session.token}` } });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: `cosyne-revenue-${S.jurisdiction}.csv` });
      document.body.append(a); a.click(); a.remove();
    };
  },

  async partners(main) {
    const { issuers } = await call('GET', '/api/state/issuers');
    const drivers = issuers.filter((i) => i.issues === 'driver');
    main.innerHTML = `<div class="st-head"><div><h1>Partner states and agencies</h1><p>The CO-SYNE trust registry. Each state signs its own residents' credentials; there is no national database. Any participating agency's officer terminal verifies these signatures, so a resident's credential works across state lines.</p></div></div>
      <div class="panel scroll"><header><h2>Driver credential issuers</h2></header><table class="tbl"><tr><th>Jurisdiction</th><th>Issuer</th><th>Type</th><th>Public key (Ed25519)</th></tr>
        ${drivers.map((i) => `<tr><td><b>${esc(i.jurisdictionName ?? '—')}</b> <span class="tiny muted">${esc(i.jurisdiction ?? '')}</span></td><td>${esc(i.name)}${i.demo ? ' <span class="status submitted">Demo</span>' : ''}</td><td>${i.kind === 'federal' ? 'Federal partner' : 'State DMV'}</td><td class="mono tiny">${esc(i.publicJwk.x)}</td></tr>`).join('')}</table></div>
      <div class="panel scroll"><header><h2>Law enforcement credential issuers</h2></header><table class="tbl"><tr><th>Agency</th><th>Type</th><th>Public key (Ed25519)</th></tr>
        ${issuers.filter((i) => i.issues === 'officer').map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.kind)}</td><td class="mono tiny">${esc(i.publicJwk.x)}</td></tr>`).join('')}</table></div>
      <div class="panel"><header><h2>Federal partners</h2></header><div class="body"><p class="small">The Department of Homeland Security or another federal agency can join the registry the same way: as an issuer (kind "federal") for credentials it is responsible for, or as a verifier that checks state-signed credentials. Adding a partner is an agreement plus its public key.</p></div></div>`;
  },

  async settings(main) {
    const { settings } = await call('GET', `/api/state/settings/${S.jurisdiction}`);
    const fields = [['departmentName', 'Department name'], ['officeAddress', 'Program office address'], ['phone', 'Phone'], ['website', 'Website'], ['signerName', 'Signer name'], ['signerTitle', 'Signer title']];
    main.innerHTML = `<div class="st-head"><div><h1>Letter settings</h1><p>Letterhead and contact details printed on approval letters and notices for ${esc(jName(S.jurisdiction))}. Blank fields print as a line to fill in.</p></div></div>
      <div class="panel"><div class="body"><form id="sf" class="form" style="max-width:560px">${fields.map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(settings[k])}"></label>`).join('')}
        <div class="actions"><button class="btn btn-primary">Save</button><button type="button" class="btn btn-secondary" id="preview">Preview a letter</button></div></form></div></div>`;
    $('#sf', main).onsubmit = async (e) => { e.preventDefault(); await call('POST', `/api/state/settings/${S.jurisdiction}`, Object.fromEntries(new FormData(e.target))); toast('Saved'); };
    $('#preview', main).onclick = () => {
      const s = Object.fromEntries(new FormData($('#sf', main)));
      const sample = { id: 'APP-SAMPLE', jurisdiction: S.jurisdiction, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(), activationCode: 'A1B2C3D4E5', applicant: { name: 'Jordan Sample', address: { street: '123 Main St', city: 'Anytown', state: S.jurisdiction, zip: '00000' } }, vehicle: { year: 2022, make: 'Toyota', model: 'Camry', plate: 'ABC123' } };
      printDocs([approvalLetter({ ...letterData({ ...sample, letter: s }), sample: true })], 'Letter preview');
    };
  },
};

// ---------- application detail ----------
async function detail(main, id) {
  const a = await call('GET', `/api/state/applications/${id}`);
  const at = FLOW.indexOf(a.status);
  const r = a.realId;
  main.innerHTML = `<div class="st-head"><div><button class="btn btn-ghost btn-sm" id="back">‹ All applications</button><h1>${esc(a.applicant.name)}</h1><p class="mono">${esc(a.id)} · ${a.channel === 'web' ? 'Applied online' : 'Applied in the Driver app'} · ${dt(a.submittedAt)}</p></div><div>${statusPill(a)}</div></div>
    <div class="detail">
      <div>
        <div class="panel"><header><h2>Applicant</h2></header><div class="body"><dl class="facts">
          <dt>Name</dt><dd>${esc(a.applicant.name)}</dd><dt>Date of birth</dt><dd>${esc(a.applicant.dob)}</dd><dt>License</dt><dd>${esc(a.applicant.licenseNumber)} (${esc(a.jurisdiction)})</dd>
          <dt>Mailing address</dt><dd>${esc(a.applicant.address.street)}, ${esc(a.applicant.address.city)}, ${esc(a.applicant.address.state)} ${esc(a.applicant.address.zip)}</dd><dt>County</dt><dd>${esc(a.applicant.address.county)}</dd>
          <dt>Contact</dt><dd>${esc(a.applicant.email || '—')}${a.applicant.phone ? ` · ${esc(a.applicant.phone)}` : ''}</dd><dt>Accessibility notes</dt><dd>${esc(a.applicant.accessibility || 'None')}</dd>
          <dt>Vehicle</dt><dd>${esc([a.vehicle.year, a.vehicle.color, a.vehicle.make, a.vehicle.model].filter(Boolean).join(' ') || '—')} · plate <b>${esc(a.vehicle.plate)}</b>${a.vehicle.vin ? ` · VIN ${esc(a.vehicle.vin)}` : ''}</dd></dl>
          ${a.infoNeeded ? `<div class="realid bad"><b>Information requested</b>${esc(a.infoNeeded)}</div>` : ''}</div></div>
        <div class="panel"><header><h2>REAL ID identity check</h2><span class="sim">Simulated lookup</span></header><div class="body">
          ${r ? `<div class="realid ${r.ok ? 'ok' : 'bad'}"><b>${r.ok ? 'Verified: REAL ID-compliant license on file' : 'Not verified'}</b>
            License record ${r.found ? 'found' : 'not found'} · name ${r.nameMatch ? 'matches' : 'does not match'} · date of birth ${r.dobMatch ? 'matches' : 'does not match'} · REAL ID ${r.realId ? '★ yes' : 'no'}${r.licenseStatus ? ` · license ${esc(r.licenseStatus)}` : ''}${r.licenseExpires ? `, expires ${esc(r.licenseExpires)}` : ''}<div class="tiny muted" style="margin-top:4px">Checked ${dt(r.at)} by ${esc(r.by)}</div></div>`
            : '<p class="muted small">Not checked yet. The check compares the application with the state\'s driver license record and confirms the license is REAL ID-compliant.</p>'}
          <p class="tiny muted">In production this queries the state's driver license system. Demo rule: license numbers ending in an odd digit are on file as standard (non-REAL ID) licenses.</p></div></div>
        <div class="panel"><header><h2>Credential and stickers</h2></header><div class="body"><dl class="facts">
          <dt>Credential</dt><dd class="mono small">${esc(a.credentialId ?? (a.activationCode ? 'Issued on activation' : '—'))}</dd><dt>Sticker set</dt><dd class="mono small">${esc(a.stickerId ? a.stickerId.slice(4, 10).toUpperCase() : '—')}</dd>
          ${a.activationCode ? `<dt>Activation code</dt><dd class="mono">${esc(a.activationCode)} <span class="tiny muted">(printed in the letter)</span></dd>` : ''}
          <dt>Issued</dt><dd>${d(a.issuedAt)}</dd><dt>Expires</dt><dd>${d(a.expiresAt)}${a.expired ? ' <span class="status expired">Expired</span>' : ''}</dd><dt>Mailed</dt><dd>${d(a.mailedAt)}</dd>
          <dt>Payments</dt><dd>${a.payments.map((p) => `${p.kind} ${money(p.amount)} · ${esc(p.confirmation)}`).join('<br>') || 'Authorized, not charged'}</dd></dl></div></div>
        <div class="panel"><header><h2>History</h2></header><div class="body"><ul class="history">${a.history.slice().reverse().map((h) => `<li><time>${dt(h.at)}</time><span><b>${esc(h.action.replace(/_/g, ' '))}</b>${h.note ? ` · ${esc(h.note)}` : ''} <span class="muted">· ${esc(h.by)}</span></span></li>`).join('')}</ul></div></div>
      </div>
      <div>
        <div class="panel"><header><h2>Progress</h2></header><div class="body"><ol class="steps-v">${FLOW.map((s, i) => `<li class="${a.status === 'declined' || a.status === 'revoked' ? '' : i < at ? 'done' : i === at ? 'now' : ''}"><i>${i < at ? '✓' : i + 1}</i><span>${STATUS[s]}</span></li>`).join('')}</ol></div></div>
        <div class="panel"><header><h2>Actions</h2></header><div class="body actions-col" id="acts"></div></div>
      </div>
    </div>`;
  $('#back', main).onclick = () => { S.selected = null; PAGES.applications(main); };
  const acts = $('#acts', main);
  const btn = (label, ic, fn, kind = 'btn-secondary') => { const b = Object.assign(document.createElement('button'), { className: `btn ${kind}`, innerHTML: `${icon(ic)} ${label}` }); b.onclick = fn; acts.append(b); };
  const act = (path, body, msg) => async () => { try { await call('POST', `/api/state/applications/${a.id}/${path}`, body); toast(msg); render(); } catch (e) { toast(e.message); } };
  if (['submitted', 'verified'].includes(a.status)) btn(a.realId ? 'Check identity again' : 'Check REAL ID record', 'id', act('verify', null, 'Identity checked'), a.realId ? 'btn-secondary' : 'btn-primary');
  if (a.status === 'verified') btn(`Approve and charge ${money(S.info.fee)}`, 'check', act('approve', null, 'Approved'), 'btn-primary');
  if (a.status === 'approved') btn('Issue credential and sticker set', 'shieldCheck', act('issue', null, 'Credential and sticker set issued'), 'btn-primary');
  if (['issued', 'active'].includes(a.status)) {
    btn('Print sticker set', 'printer', () => printSets([a]));
    btn('Print approval letter', 'file', () => printLetters([a]));
    if (a.status === 'issued') btn('Mark as mailed', 'send', act('mailed', null, 'Marked as mailed'), 'btn-primary');
    btn('Reissue stickers', 'qr', () => reissue(a));
    if (a.credentialId) btn('Send renewal reminder', 'bell', act('remind', null, 'Reminder sent'));
    btn('Revoke enrollment', 'x', () => { const reason = prompt('Reason for revoking (the resident is signed out and the stickers stop working):', 'Vehicle sold'); if (reason) act('revoke', { reason }, 'Revoked')(); }, 'btn-secondary');
  }
  if (['submitted', 'verified'].includes(a.status)) {
    btn(a.infoNeeded ? 'Update information request' : 'Request more information', 'message', () => { const text = prompt('What do you need from the applicant?', a.infoNeeded ?? ''); if (text != null) act('note', { text }, 'Saved')(); });
    if (a.infoNeeded) btn('Print "more information needed" notice', 'printer', () => printDocs([infoNeededNotice(letterData(a))], a.id));
    btn('Print "application received" notice', 'printer', () => printDocs([receivedNotice(letterData(a))], a.id));
    btn('Decline', 'x', () => { const reason = prompt('Reason (printed on the notice):', a.realId && !a.realId.realId ? 'Requires a current REAL ID-compliant license' : ''); if (reason) act('decline', { reason }, 'Declined')(); });
  }
  if (a.status === 'declined') btn('Print "not approved" notice', 'printer', () => printDocs([declinedNotice(letterData(a))], a.id));
}

function reissue(a) {
  const m = Object.assign(document.createElement('div'), { className: 'modal-x' });
  m.innerHTML = `<div class="card"><h2 style="font-size:1.3rem">Reissue stickers</h2><p class="small muted">A new sticker set is issued and the old QR codes stop working right away.</p>
    <form class="form" id="rf"><label>Reason<select name="reason"><option value="lost_sticker">Lost or stolen sticker</option><option value="damaged">Damaged sticker</option><option value="new_plate">New license plate</option><option value="new_vehicle">Different vehicle</option></select></label>
      <div id="veh" class="form hidden"><label>New plate<input name="plate" value="${esc(a.vehicle.plate)}"></label><div id="vx" class="form hidden"><label>Year<input name="year"></label><label>Make<input name="make"></label><label>Model<input name="model"></label><label>Color<input name="color"></label><label>VIN<input name="vin"></label></div></div>
      <div class="actions"><button class="btn btn-primary">Reissue</button><button type="button" class="btn btn-secondary" id="rc">Cancel</button></div></form></div>`;
  document.body.append(m);
  const f = $('#rf', m);
  f.reason.onchange = () => { $('#veh', m).classList.toggle('hidden', !['new_plate', 'new_vehicle'].includes(f.reason.value)); $('#vx', m).classList.toggle('hidden', f.reason.value !== 'new_vehicle'); };
  $('#rc', m).onclick = () => m.remove();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    try { await call('POST', `/api/state/applications/${a.id}/reissue`, { reason: v.reason, vehicle: v }); m.remove(); toast('New sticker set issued; the old codes are void'); render(); } catch (err) { toast(err.message); }
  };
}

// ---------- printing ----------
function letterData(a) {
  return { app: a, settings: a.letter ?? {}, jurisdictionName: jName(a.jurisdiction), fee: S.info.fee, stateShare: S.info.perPayment.stateShare, adminFee: S.info.perPayment.adminFee, stateShareRate: S.info.stateShareRate };
}
function printDocs(parts, title, extraCss = '', pageCss = '@page { size: letter; margin: .6in; }') {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { toast('Allow pop-ups to print'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><base href="${esc(url('/'))}"><style>body{margin:0;background:#eee;padding:20px} ${LETTER_CSS} ${STICKER_CSS} ${extraCss} @media print{body{background:#fff;padding:0}} ${pageCss}</style></head><body>${parts.join('')}<script>addEventListener('load',()=>setTimeout(()=>print(),400))<\/script></body></html>`);
  w.document.close();
}
const qrFor = (a) => `api/stickers/${encodeURIComponent(a.stickerId)}/qr.svg`;
const mailing = (a) => `<b>${esc(a.applicant.name)}</b><br>${esc(a.applicant.address.street)}<br>${esc(a.applicant.address.city)}, ${esc(a.applicant.address.state)} ${esc(a.applicant.address.zip)}<br><span style="color:#666">${esc(a.id)} · plate ${esc(a.vehicle.plate)}</span>`;
function printSets(list) {
  printDocs(list.map((a) => stickerSet({ stickerId: a.stickerId, code: a.stickerId.slice(4, 10).toUpperCase(), plate: a.vehicle.plate, state: a.jurisdiction, qrUrl: qrFor(a), label: `${a.applicant.name} · ${a.id}`, mailing: mailing(a) })), 'CO-SYNE sticker sets', '.set{background:#fff;padding:.3in}', '@page { size: 17in 11in; margin: .4in; }');
}
function printSmall(list) {
  if (!list.length) return;
  const sets = list.map((a) => `<section class="set" style="background:#fff;padding:.2in .3in;height:4.6in;box-sizing:border-box"><h3>${esc(a.id)} · ${esc(a.applicant.name)}</h3><div class="pieces">
    <div class="window"><div class="qr"><img src="${qrFor(a)}" alt=""></div><b>CO-SYNE VERIFIED STOP</b><small>Scan from patrol vehicle · ${esc(a.stickerId.slice(4, 10).toUpperCase())}</small></div>
    <div class="tag"><div class="qr"><img src="${qrFor(a)}" alt=""></div><b>CO-SYNE</b><small>${esc(a.jurisdiction)} · ${esc(a.stickerId.slice(4, 10).toUpperCase())}</small></div>
    <div class="mail">${mailing(a)}</div></div></section>`);
  printDocs(sets, 'Window stickers and plate tags', '.set:nth-of-type(2n){break-after:page}');
}
function printBumpers(list) {
  if (!list.length) return;
  printDocs(list.map((a) => `<section class="set" style="background:#fff;padding:.15in"><h3>${esc(a.id)} · plate ${esc(a.vehicle.plate)}</h3><div class="pieces"><div class="bumper"><div class="qr"><img src="${qrFor(a)}" alt=""></div><div><b>CO-<span>SYNE</span> VERIFIED</b><div class="l">Officers: scan from your patrol car.</div><div class="l">Driver stays in the car · identity verified both ways</div><div class="c">STICKER ${esc(a.stickerId.slice(4, 10).toUpperCase())} · ${esc(a.jurisdiction)} · ${esc(a.vehicle.plate)}</div></div></div></div></section>`),
    'Bumper stickers', '.set:nth-of-type(3n){break-after:page}', '@page { size: 17in 11in; margin: .4in; }');
}
function printLetters(list) {
  if (!list.length) return;
  printDocs(list.flatMap((a) => [approvalLetter(letterData(a)), enclosureGuide(letterData(a))]), 'CO-SYNE approval letters');
}

// ---------- boot ----------
(async () => {
  try { ({ config: S.config } = await bootstrap()); } catch (e) { document.body.innerHTML = `<p style="margin:40px">Cannot reach the CO-SYNE network: ${esc(e.message)}</p>`; return; }
  openDemoBadge(S.config);
  // A Demo Control link signs the console in without the access code.
  try {
    const r = await redeemDemoPass('state');
    if (r?.state) { S.session = r.state; try { sessionStorage.setItem('cosyne:state', JSON.stringify(S.session)); } catch { /* ignore */ } }
  } catch (e) { renderLogin(e.message); return; }
  if (S.session?.token) start().catch(() => renderLogin()); else renderLogin();
})();
window.cosyne = { S, render };
