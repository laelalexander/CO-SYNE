// Letters and printed materials for the state CO-SYNE program: the approval
// letter, short notices, the enclosure guide and the sticker set (bumper
// sticker 11.5 x 3 in, window sticker 4 x 4 in, plate tag 2 x 2 in). Used by
// the State Issuer Console and the public sample letter.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
const money = (n) => `$${Number(n).toFixed(2)}`;
// Blank fields print as a line to fill in by hand, never as placeholder text.
const f = (v) => (v ? esc(v) : '<span class="blank"></span>');

export const LETTER_CSS = `
  .letter { font: 11.5pt/1.5 Georgia, "Times New Roman", serif; color: #111; background: #fff; max-width: 7.5in; margin: 0 auto; padding: .6in .7in; box-sizing: border-box; }
  .letter + .letter { margin-top: 24px; }
  .lh { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #0b3a66; padding-bottom: 12px; margin-bottom: 26px; font-family: "Segoe UI", Arial, sans-serif; }
  .lh b { display: block; font-size: 15pt; color: #0b3a66; }
  .lh span { display: block; font-size: 9pt; color: #444; }
  .lh .seal { width: 58px; height: 58px; border-radius: 50%; border: 3px solid #0b3a66; display: grid; place-items: center; font: 700 9pt/1.1 "Segoe UI", Arial, sans-serif; color: #0b3a66; text-align: center; flex: 0 0 auto; }
  .letter .addr { margin: 0 0 22px; }
  .letter .re { font-weight: 700; margin: 0 0 18px; }
  .letter p { margin: 0 0 12px; }
  .letter h4 { font: 700 10.5pt/1.3 "Segoe UI", Arial, sans-serif; margin: 18px 0 6px; color: #0b3a66; text-transform: none; letter-spacing: 0; }
  .letter table.facts { display: table; grid-template-columns: none; border: 0; width: auto; border-collapse: collapse; margin: 6px 0 14px; font-family: "Segoe UI", Arial, sans-serif; font-size: 10pt; }
  .letter table.facts td { padding: 4px 16px 4px 0; vertical-align: top; }
  .letter table.facts td:first-child { color: #555; }
  .letter ol { margin: 0 0 12px; padding-left: 22px; }
  .letter .code { font: 700 14pt/1 ui-monospace, Consolas, monospace; letter-spacing: 2px; background: #f2f6fa; border: 1px dashed #0b3a66; padding: 4px 10px; border-radius: 4px; }
  .letter .sig { margin-top: 26px; }
  .letter .sig .line { margin-top: 34px; }
  .letter .encl { margin-top: 22px; font-size: 9.5pt; color: #333; border-top: 1px solid #ccc; padding-top: 8px; }
  .letter .blank { display: inline-block; min-width: 2.2in; border-bottom: 1px solid #555; height: 1em; vertical-align: -2px; }
  .letter .sample { position: relative; }
  .sample-mark { font: 700 9pt/1 "Segoe UI", Arial, sans-serif; letter-spacing: .1em; color: #a4262c; border: 2px solid #a4262c; border-radius: 4px; padding: 4px 8px; display: inline-block; margin-bottom: 14px; }
  @media print { .letter { padding: 0; max-width: none; } .letter + .letter { margin-top: 0; break-before: page; } }
`;

// data: { app, settings, jurisdictionName, issuedAt, sample }
function letterhead({ settings, jurisdictionName, code }) {
  return `<div class="lh"><div><b>${f(settings.departmentName)}</b><span>State of ${esc(jurisdictionName)} · CO-SYNE Verified Roadside program</span>
    <span>${f(settings.officeAddress)}</span><span>${settings.phone ? esc(settings.phone) : ''}${settings.phone && settings.website ? ' · ' : ''}${settings.website ? esc(settings.website) : ''}</span></div>
    <div class="seal">${esc(code)}<br>CO-SYNE</div></div>`;
}
function addressBlock(app, date) {
  const a = app.applicant;
  return `<p>${longDate(date)}</p><p class="addr">${esc(a.name)}<br>${esc(a.address.street)}<br>${esc(a.address.city)}, ${esc(a.address.state)} ${esc(a.address.zip)}</p>`;
}
function signature(settings, jurisdictionName) {
  return `<div class="sig"><p>Sincerely,</p><div class="line">${f(settings.signerName)}<br>${f(settings.signerTitle)}<br>${f(settings.departmentName)}<br>State of ${esc(jurisdictionName)}</div></div>`;
}
const vehicleLine = (v) => [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle on file';
const sampleMark = (d) => (d.sample ? '<div class="sample-mark">SAMPLE · NOT AN OFFICIAL LETTER</div>' : '');

export function approvalLetter(d) {
  const { app, settings, jurisdictionName } = d;
  const website = settings.website || 'the CO-SYNE website';
  return `<article class="letter">${sampleMark(d)}${letterhead({ settings, jurisdictionName, code: app.jurisdiction })}${addressBlock(app, d.date ?? app.issuedAt)}
    <p class="re">Re: Your CO-SYNE enrollment is approved<br>Application number: ${esc(app.id)}</p>
    <p>Dear ${esc(app.applicant.name)},</p>
    <p>Thank you for applying to the CO-SYNE Verified Roadside program. We have confirmed your identity against your REAL ID-compliant driver license on file, and your enrollment is approved.</p>
    <p>The ${f(settings.departmentName)} has issued you a CO-SYNE credential, signed by the State of ${esc(jurisdictionName)}. It links your verified license to the vehicle below:</p>
    <table class="facts"><tr><td>Vehicle</td><td>${esc(vehicleLine(app.vehicle))}</td></tr><tr><td>Plate</td><td>${esc(app.vehicle.plate)} (${esc(app.jurisdiction)})</td></tr>
      <tr><td>Effective</td><td>${longDate(app.issuedAt)}</td></tr><tr><td>Expires</td><td>${longDate(app.expiresAt) || 'One year from activation'}</td></tr><tr><td>Annual program fee</td><td>${money(d.fee ?? 24.99)}, paid</td></tr></table>
    <h4>What's in this envelope</h4>
    <p>Your CO-SYNE set has a bumper sticker, a window sticker and a plate tag. Each has a QR code that a law enforcement officer can scan during a traffic stop. The codes contain only a link, never your name, address or license details.</p>
    <h4>Activate your credential in three steps</h4>
    <ol><li>Install the CO-SYNE Driver app from ${esc(website)}, or add it to your phone's home screen.</li>
      ${app.activationCode ? `<li>Choose "Activate with a code" and enter your activation code: <span class="code">${esc(app.activationCode)}</span>. The code works once and links the credential to your phone.</li>` : '<li>Open the app on the phone you applied with. Your credential is already linked to that phone.</li>'}
      <li>Turn on alerts so the app can notify you when an officer starts a stop.</li></ol>
    <p>Then put the stickers and tag on your vehicle as the enclosed guide shows.</p>
    <h4>What changes at a traffic stop</h4>
    <p>Before anyone approaches your car, your phone shows the officer's verified name, badge number, agency and the reason for the stop. The officer sees that your license and vehicle are verified, along with any accessibility notes you chose to add. Either of you can start a video or text conversation from your vehicles. If anything about the stop seems wrong, the app lets you alert dispatch right away.</p>
    <p>CO-SYNE does not replace your driver license, and you must still carry it as state law requires. Taking part is voluntary. If you choose not to use the app at a stop, the stop proceeds as it does today.</p>
    <h4>Renewal</h4>
    <p>Your enrollment renews each year for ${money(d.fee ?? 24.99)}. We will remind you 30 days before ${longDate(app.expiresAt) || 'your expiration date'}. If you sell the vehicle, change your plate, or lose a sticker, contact us and we will cancel the old codes and send a replacement set.</p>
    <p>If you have any questions, call ${f(settings.phone)} or visit ${f(settings.website)}.</p>
    ${signature(settings, jurisdictionName)}
    <div class="encl">Enclosures: CO-SYNE sticker set (bumper sticker, window sticker, plate tag); installation and privacy guide.<br>
      Of the ${money(d.fee ?? 24.99)} annual fee, ${money(d.stateShare ?? 9.5)} (${Math.round((d.stateShareRate ?? 0.38) * 100)}%) goes to the State of ${esc(jurisdictionName)}, and ${money(d.adminFee ?? 15.49)} covers program administration.</div>
  </article>`;
}

export function receivedNotice(d) {
  const { app, settings, jurisdictionName } = d;
  return `<article class="letter">${sampleMark(d)}${letterhead({ settings, jurisdictionName, code: app.jurisdiction })}${addressBlock(app, d.date ?? app.submittedAt)}
    <p class="re">Re: We received your CO-SYNE application<br>Application number: ${esc(app.id)}</p>
    <p>Dear ${esc(app.applicant.name)},</p>
    <p>We received your application to the CO-SYNE Verified Roadside program for the vehicle with plate ${esc(app.vehicle.plate)}. We will now confirm your identity against your REAL ID-compliant driver license on file.</p>
    <p>Your card has been authorized for the ${money(d.fee ?? 24.99)} annual fee. It is charged only if your enrollment is approved. We will write to you again when we have reviewed your application.</p>
    ${signature(settings, jurisdictionName)}</article>`;
}

export function infoNeededNotice(d) {
  const { app, settings, jurisdictionName } = d;
  return `<article class="letter">${sampleMark(d)}${letterhead({ settings, jurisdictionName, code: app.jurisdiction })}${addressBlock(app, d.date)}
    <p class="re">Re: More information needed for your CO-SYNE application<br>Application number: ${esc(app.id)}</p>
    <p>Dear ${esc(app.applicant.name)},</p>
    <p>We need a little more information before we can review your application:</p>
    <p><b>${f(app.infoNeeded)}</b></p>
    <p>Please call ${f(settings.phone)} or visit ${f(settings.website)} and quote your application number. Your fee has not been charged and will be charged only if your enrollment is approved.</p>
    ${signature(settings, jurisdictionName)}</article>`;
}

export function declinedNotice(d) {
  const { app, settings, jurisdictionName } = d;
  return `<article class="letter">${sampleMark(d)}${letterhead({ settings, jurisdictionName, code: app.jurisdiction })}${addressBlock(app, d.date)}
    <p class="re">Re: Your CO-SYNE application was not approved<br>Application number: ${esc(app.id)}</p>
    <p>Dear ${esc(app.applicant.name)},</p>
    <p>We were not able to approve your application to the CO-SYNE Verified Roadside program. Enrollment requires a current REAL ID-compliant driver license on file with the State of ${esc(jurisdictionName)}${app.declineReason ? `. Reason: ${esc(app.declineReason)}` : ''}.</p>
    <p>You have not been charged. You may apply again once you hold a REAL ID-compliant license. If you have questions, call ${f(settings.phone)} or visit ${f(settings.website)}.</p>
    ${signature(settings, jurisdictionName)}</article>`;
}

export function enclosureGuide(d) {
  const { settings, jurisdictionName } = d;
  return `<article class="letter">${sampleMark(d)}${letterhead({ settings, jurisdictionName, code: d.app.jurisdiction })}
    <p class="re">Installation and privacy guide</p>
    <h4>Where each piece goes</h4>
    <table class="facts"><tr><td>Bumper sticker (11.5 × 3 in)</td><td>Rear bumper, left of center, on a clean, dry surface.</td></tr>
      <tr><td>Window sticker (4 × 4 in)</td><td>Inside the rear window, lower driver's side corner, facing out. Use it if your bumper has no flat spot.</td></tr>
      <tr><td>Plate tag (2 × 2 in)</td><td>Beside the license plate where your state allows a decal, so an officer behind you can scan it.</td></tr></table>
    <p>Officers scan the code from the patrol car. You don't need to do anything when it is scanned; your phone alerts you.</p>
    <h4>Your privacy</h4>
    <p>The QR codes hold only a link. Your name, address and license details are never printed on your vehicle. Your credential is bound to a key that stays on your phone. Your location is shared only during an active stop or an emergency alert you send. Recordings stay on the device that made them.</p>
    <h4>Lost a sticker, sold the car or changed plates?</h4>
    <p>Contact us at ${f(settings.phone)} or ${f(settings.website)}. We cancel the old codes right away, so they can no longer be used, and mail a replacement set.</p></article>`;
}

// ---------- the sticker set ----------
export const STICKER_CSS = `
  .set { break-inside: avoid; margin: 0 0 .35in; font-family: "Segoe UI", Arial, sans-serif; color: #111; }
  .set h3 { font: 600 10pt/1.3 "Segoe UI", Arial, sans-serif; margin: 0 0 .12in; color: #333; }
  .pieces { display: flex; gap: .3in; flex-wrap: wrap; align-items: flex-start; }
  .bumper { width: 11.5in; height: 3in; border-radius: .18in; background: #0b1b2b; color: #fff; display: flex; align-items: center; gap: .25in; padding: .22in .3in; box-sizing: border-box; }
  .bumper .qr { width: 2.5in; height: 2.5in; background: #fff; border-radius: .1in; padding: .08in; box-sizing: border-box; flex: 0 0 auto; }
  .bumper .qr img, .window img, .tag img { display: block; width: 100%; height: 100%; }
  .bumper b { font: 800 34pt/1 "Segoe UI", Arial, sans-serif; letter-spacing: .02em; } .bumper b span { color: #e0c171; }
  .bumper .l { font-size: 14pt; opacity: .92; margin-top: .06in; } .bumper .c { font: 600 11pt/1 ui-monospace, Consolas, monospace; opacity: .75; margin-top: .12in; }
  .window { width: 4in; height: 4in; border-radius: .16in; border: .07in solid #c9a54a; background: #fff; box-sizing: border-box; padding: .22in; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .window .qr { width: 2.7in; height: 2.7in; } .window b { font: 800 13pt/1.1 "Segoe UI", Arial, sans-serif; margin-top: .06in; } .window small { font-size: 8pt; color: #445; }
  .tag { width: 2in; height: 2in; border-radius: .12in; background: #0b1b2b; color: #fff; box-sizing: border-box; padding: .12in; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .tag .qr { width: 1.45in; height: 1.45in; background: #fff; border-radius: .06in; padding: .04in; box-sizing: border-box; } .tag b { font: 800 9pt/1 "Segoe UI", Arial, sans-serif; margin-top: .05in; } .tag small { font: 600 7pt/1 ui-monospace, Consolas, monospace; opacity: .8; }
  .mail { font-size: 9pt; line-height: 1.35; border: 1px dashed #999; padding: .1in .14in; border-radius: 4px; width: 3in; box-sizing: border-box; }
`;
export function stickerSet({ stickerId, code, plate, state, qrUrl, label, mailing }) {
  const qr = `<img src="${esc(qrUrl)}" alt="CO-SYNE QR code">`;
  return `<section class="set">${label ? `<h3>${esc(label)}</h3>` : ''}<div class="pieces">
    <div class="bumper"><div class="qr">${qr}</div><div><b>CO-<span>SYNE</span> VERIFIED</b><div class="l">Officers: scan from your patrol car.</div><div class="l">Driver stays in the car · identity verified both ways</div><div class="c">STICKER ${esc(code)} · ${esc(state)} · ${esc(plate)}</div></div></div>
    <div class="window"><div class="qr">${qr}</div><b>CO-SYNE VERIFIED STOP</b><small>Scan from patrol vehicle · ${esc(code)}</small></div>
    <div class="tag"><div class="qr">${qr}</div><b>CO-SYNE</b><small>${esc(state)} · ${esc(code)}</small></div>
    ${mailing ? `<div class="mail">${mailing}</div>` : ''}</div></section>`;
}
