// Install and download cards for the three CO-SYNE modules, shared by the
// admin console and the public downloads page.
import { url } from './session.js';
import { icon } from './icons.js';
import './popout.js';
import { esc, toast } from './ui.js';

const PLATFORM_ICON = { windows: 'grid', unix: 'settings' };

function moduleCard(m, online) {
  return `<article class="module" id="module-${esc(m.id)}">
    <header><img src="${esc(url(m.icon))}" width="48" height="48" alt=""><div class="grow"><h2>${esc(m.name)}</h2><span class="pill">${esc(m.device)}</span>${online != null ? ` <span class="pill ${online ? 'ok' : ''}"><span class="dot ${online ? 'ok' : ''}"></span>${online} online</span>` : ''}</div></header>
    <p class="muted small">${esc(m.summary)}</p>
    <div class="module-body">
      <div class="stack">
        <div class="row"><a class="btn sm brand" href="${esc(m.installUrl)}" target="_blank" rel="noopener">${icon('plus')} Install on this device</a><a class="btn sm" href="${esc(m.url)}" target="_blank" rel="noopener" data-popout="${esc(m.id)}">Open</a><button class="btn sm ghost" data-copy="${esc(m.installUrl)}" title="Copy install link">${icon('link')}</button></div>
        <h4>Desktop downloads</h4>
        <ul class="dl">${m.downloads.map((d) => `<li><a href="${esc(url(d.file))}" download>${icon(PLATFORM_ICON[d.platform] ?? 'file')} ${esc(d.label)}</a><span class="tiny faint mono">${esc(d.file.split('/').pop())}</span></li>`).join('')}</ul>
      </div>
      <figure class="qr"><img src="${esc(url(m.qr))}" width="128" height="128" alt="QR code to install ${esc(m.name)}" loading="lazy"><figcaption class="tiny muted">Scan with a phone to install</figcaption></figure>
    </div>
  </article>`;
}

// data = GET /api/modules; online = { driver: n, ... } (admin only)
// Phone setup steps for drivers: install, then turn on alerts.
function driverGuide(data) {
  const driver = data.modules.find((m) => m.id === 'driver');
  return `<section class="card driver-guide" id="driver-app">
    <div class="dg-head"><img src="${esc(url(driver.icon))}" width="44" height="44" alt=""><div><h2>The Driver app on your phone</h2><p class="small muted">Install it once, turn on alerts, and CO-SYNE tells you who is stopping you, even when the app is closed or your phone is locked.</p></div></div>
    <div class="dg-cols">
      <div><h4>${icon('phone')} iPhone (iOS 16.4 or later)</h4><ol class="small steps"><li>Open <span class="mono">${esc(driver.installUrl.replace(/\?install=1$/, ''))}</span> in <b>Safari</b>, or scan the QR code.</li><li>Tap <b>Share</b>, then <b>Add to Home Screen</b>.</li><li>Open CO-SYNE from its new icon and tap <b>Turn on alerts</b>.</li></ol>
        <p class="tiny muted">On iPhone, alerts work only for the Home Screen app, not inside Safari.</p></div>
      <div><h4>${icon('phone')} Android</h4><ol class="small steps"><li>Open the link in <b>Chrome</b>, or scan the QR code.</li><li>Tap <b>Install</b> when CO-SYNE offers it (or menu → <b>Install app</b>).</li><li>Open CO-SYNE and tap <b>Turn on alerts</b>.</li></ol></div>
      <div><h4>${icon('bell')} What you'll get</h4><ul class="small steps"><li><b>Pull-over alerts</b> with the officer's verified name, badge and reason, and <b>Accept video</b> or <b>Text only</b>.</li><li>Citations, warnings and stop updates, with a count on the app icon.</li><li>Your ID, vehicle and sticker stay available <b>offline</b>.</li><li>The screen stays on during a stop or call.</li></ul></div>
    </div>
    <div class="row" style="margin-top:6px"><a class="btn brand" href="${esc(driver.installUrl)}" target="_blank" rel="noopener">${icon('plus')} Install the Driver app</a><a class="btn" href="#module-driver">QR code</a></div>
  </section>`;
}

export function modulesHtml(data, { online } = {}) {
  return `${driverGuide(data)}<div class="modules">${data.modules.map((m) => moduleCard(m, online?.[m.id])).join('')}</div>
    <div class="grid-auto">
      <div class="card"><h3>${icon('layers')} Full network on one computer</h3><p class="small muted">Opens the Driver, Officer Terminal and Dispatch apps side by side, each in its own window with its own device key, for demonstrations and training.</p>
        <ul class="dl">${data.bundle.map((d) => `<li><a href="${esc(url(d.file))}" download>${icon(PLATFORM_ICON[d.platform] ?? 'file')} ${esc(d.label)}</a></li>`).join('')}</ul></div>
      <div class="card"><h3>${icon('phone')} How installing works</h3><ul class="small muted steps">
        <li><b>Phones:</b> scan the module's QR code, then tap <b>Install</b> (Android) or <b>Share → Add to Home Screen</b> (iPhone).</li>
        <li><b>Windows:</b> download the launcher and double-click it. It opens the module in Edge or Chrome as its own app window. Officer terminals can use the kiosk launcher to run full screen.</li>
        <li><b>macOS / Linux:</b> download the launcher and run <code>sh &lt;file&gt;.sh</code> in Terminal.</li>
        <li>Every module connects to <span class="mono">${esc(data.base)}</span> and updates automatically when the server is updated.</li></ul></div>
      <div class="card"><h3>${icon('shield')} Native mobile apps</h3><p class="small muted">App Store and Google Play builds of the Driver app are the next phase. Until then the installed Driver app gives drivers the same features, including pull-over alerts on a locked phone: verified ID, video, tickets and SOS.</p><p><span class="pill brand">Next phase</span></p></div>
    </div>`;
}

export function bindModules(root) {
  root.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Install link copied'); } catch { prompt('Copy this link', b.dataset.copy); }
    };
  });
}
