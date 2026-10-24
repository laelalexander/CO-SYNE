// Small UI helpers shared by the three apps.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const initials = (name = '') => String(name).replace(/^(Officer|Deputy|Corporal|Sgt\.?|Dispatch ·)\s+/i, '').split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
export const money = (n) => `$${Number(n ?? 0).toFixed(2).replace(/\.00$/, '')}`;
export const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
export const timeSec = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m`; return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
export const coords = (l) => (l ? `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}` : '—');
export const vehicleLine = (v = {}) => [v.color, v.year, v.make, v.model].filter(Boolean).join(' ');

export const STOP_STATUS = {
  awaiting_officer_proof: 'Verifying officer', awaiting_driver: 'Officer verified', verified: 'Mutually verified', failed: 'Verification failed', ended: 'Ended',
};
export const UNIT_STATUS = { available: 'Available', assigned: 'Assigned', en_route: 'En route', on_scene: 'On scene', on_stop: 'Traffic stop', busy: 'Busy', out_of_service: 'Out of service' };
export const UNIT_TONE = { available: 'ok', assigned: 'warn', en_route: 'warn', on_scene: 'bad', on_stop: 'bad', busy: 'info', out_of_service: '' };
export const PRIORITY_TONE = { 1: 'bad', 2: 'warn', 3: 'info' };
export const ALERT_LABEL = { medical: 'Medical', crash: 'Crash', fire: 'Vehicle fire', threat: 'In danger', traffic_stop: 'Being pulled over', breakdown: 'Breakdown', other: 'Other' };

let toastHost = null;
export function toast(text, ms = 3800) {
  toastHost ??= Object.assign(document.createElement('div'), { className: 'toasts' });
  if (!toastHost.isConnected) document.body.append(toastHost);
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: text });
  toastHost.append(el);
  setTimeout(() => el.remove(), ms);
}

let modalClose = null;
export function showModal(html, { onClose, wide } = {}) {
  hideModal();
  modalClose = onClose ?? null;
  const el = Object.assign(document.createElement('div'), { className: 'modal', id: 'modal' });
  el.innerHTML = `<div class="modal-card" style="${wide ? 'width:min(1000px,100%)' : ''}">${html}</div>`;
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close-modal]')) hideModal(); });
  document.body.append(el);
  return el;
}
export function hideModal() {
  document.getElementById('modal')?.remove();
  const fn = modalClose; modalClose = null; fn?.();
}

// ---- legal documents ----
export function citationDocument(c) {
  const isCit = c.type === 'citation';
  const v = c.vehicle ?? {};
  return `<div class="doc"><div class="doc-head"><div><h1>${isCit ? 'Uniform Traffic Citation' : 'Written Warning'}</h1><p>${esc(c.officer.agency)}${c.officer.division ? ` · ${esc(c.officer.division)}` : ''}</p></div><div class="doc-id">${esc(c.id)}</div></div>
    <table class="doc-table"><tr><th>Driver</th><td>${esc(c.driver.name)} · DOB ${esc(c.driver.dob ?? '')} · DL ${esc(c.driver.licenseNumber)}<br>${esc(c.driver.address ?? '')}</td></tr>
    <tr><th>Vehicle</th><td>${esc(vehicleLine(v))} · ${esc(v.plate)} ${esc(v.state ?? '')} · VIN ${esc(v.vin ?? '')}</td></tr>
    <tr><th>Issued</th><td>${new Date(c.issuedAt).toLocaleString()}${c.location ? ` · ${coords(c.location)}` : ''}</td></tr>
    <tr><th>Officer</th><td>${esc(c.officer.name)} · Badge ${esc(c.officer.badge)} · ${esc(c.officer.unit ?? '')}</td></tr></table>
    <h2>Violations</h2><table class="doc-table"><tr><th>Statute</th><th>Description</th>${isCit ? '<th>Fine</th>' : ''}</tr>
    ${c.violations.map((x) => `<tr><td>${esc(x.statute)}</td><td>${esc(x.description)}</td>${isCit ? `<td>${money(x.fine)}</td>` : ''}</tr>`).join('')}
    ${isCit ? `<tr><th colspan="2">Total</th><th>${money(c.totalFine)}</th></tr>` : ''}</table>
    ${c.notes ? `<p><b>Officer notes:</b> ${esc(c.notes)}</p>` : ''}
    ${isCit ? `<p><b>Pay by ${esc(c.payBy)}</b> or appear at <b>${esc(c.court.name)}</b>, ${esc(c.court.address)}, on ${new Date(c.court.date).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}.</p>` : '<p>No fine. This warning is recorded but is not filed with the court.</p>'}
    <p class="small">Status: ${esc(c.status)}${c.ack ? ` · receipt acknowledged ${new Date(c.ack.at).toLocaleString()}` : ''}${c.payment ? ` · paid, confirmation ${esc(c.payment.confirmation)} (simulated)` : ''}</p>
    <p class="small mono">Officer signature (Ed25519): ${esc(c.officerSignature.slice(0, 48))}…<br>Document hash: ${esc(c.hash)}${c.ledgerSeq != null ? ` · evidence ledger entry #${c.ledgerSeq}` : ''}</p>
    <p class="small">Fines shown are sample values for the pilot demonstration.</p></div>`;
}

export function reportDocument(r) {
  const d = r.driver ?? {};
  const v = d.vehicle ?? {};
  return `<div class="doc"><div class="doc-head"><div><h1>Traffic Stop Incident Report</h1><p>${esc(r.officer.agency)}${r.officer.division ? ` · ${esc(r.officer.division)}` : ''}</p></div><div class="doc-id">${esc(r.id)}</div></div>
    <table class="doc-table"><tr><th>Date / time</th><td>${new Date(r.startedAt).toLocaleString()} · ${r.durationMin} min</td></tr>
    <tr><th>Location</th><td>${coords(r.location)}</td></tr>
    <tr><th>Reason for stop</th><td>${esc(r.reason ?? '—')}</td></tr><tr><th>Identification</th><td>${esc(r.method)}${r.driverDeviceConfirmed ? ' · confirmed on driver\'s device' : ''}</td></tr>
    <tr><th>Officer</th><td>${esc(r.officer.name)} · Badge ${esc(r.officer.badge)} · ${esc(r.officer.unit ?? '')}</td></tr>
    <tr><th>Driver</th><td>${esc(d.name)} · DOB ${esc(d.dob ?? '')} · DL ${esc(d.licenseNumber)} (${esc(d.licenseStatus)})</td></tr>
    <tr><th>Vehicle</th><td>${esc(vehicleLine(v))} · ${esc(v.plate)} ${esc(v.state ?? '')} · VIN ${esc(v.vin ?? '')}</td></tr>
    <tr><th>Disposition</th><td><b>${esc(r.disposition)}</b></td></tr></table>
    <h2>Records checks</h2><ul>${r.checks.map((c) => `<li>${c.ok ? '✓' : '✗'} ${esc(c.label)}: ${esc(c.detail)}</li>`).join('')}</ul>
    <h2>Citations and warnings</h2>${r.citations.length ? `<ul>${r.citations.map((c) => `<li>${esc(c.id)} (${esc(c.type)}): ${esc(c.violations.join(', '))}${c.totalFine ? ` · ${money(c.totalFine)}` : ''}${c.acknowledged ? ' · acknowledged by driver' : ''}</li>`).join('')}</ul>` : '<p>None.</p>'}
    <h2>Narrative</h2><p>${esc(r.narrative)}</p>
    <h2>Evidence and timeline</h2><ol class="small">${r.timeline.map((e) => `<li>#${e.seq} ${new Date(e.ts).toLocaleTimeString()} ${esc(e.type)}</li>`).join('')}</ol>
    ${r.evidence.length ? `<p class="small">Recordings anchored: ${r.evidence.map((e) => `<code>${esc(e.sha256.slice(0, 16))}…</code>`).join(', ')}</p>` : ''}
    <p class="small mono">Report hash: ${esc(r.hash)} · sealed in evidence ledger entry #${r.ledgerSeq}</p></div>`;
}

export function showDocument(html, title) {
  const el = showModal(`<div class="spread" style="margin-bottom:12px"><h2>${esc(title)}</h2><span class="row"><button class="btn sm primary" data-print>Print</button><button class="btn sm" data-close-modal>Close</button></span></div>${html}`, { wide: true });
  el.querySelector('[data-print]').addEventListener('click', () => printHtml(html, title));
}

export function printHtml(html, title) {
  const w = window.open('', '_blank', 'width=860,height=1000');
  if (!w) { toast('Allow pop-ups to print'); return; }
  const css = new URL('../lib/theme.css', location.href).href;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${css}"></head><body class="print-doc">${html}<script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}

// Short alert tones generated with WebAudio (no audio files to ship).
let audioCtx = null;
export function tone(pattern = 'alert') {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const seq = {
      alert: [[880, 0, .18], [660, .22, .18], [880, .44, .18], [660, .66, .18]],
      ring: [[523, 0, .35], [659, 0, .35], [523, .6, .35], [659, .6, .35]],
      chime: [[784, 0, .12], [1047, .14, .22]],
      warn: [[330, 0, .4], [262, .45, .5]],
    }[pattern];
    const t0 = audioCtx.currentTime;
    for (const [f, at, dur] of seq) {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(audioCtx.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
    }
  } catch { /* audio not available */ }
}
