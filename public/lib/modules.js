// Install and download cards for the three CO-SYNE modules, shared by the
// admin console and the public downloads page.
import { url } from './session.js';
import { icon } from './icons.js';
import { esc, toast } from './ui.js';

const PLATFORM_ICON = { windows: 'grid', unix: 'settings' };

function moduleCard(m, online) {
  return `<article class="module" id="module-${esc(m.id)}">
    <header><img src="${esc(url(m.icon))}" width="48" height="48" alt=""><div class="grow"><h2>${esc(m.name)}</h2><span class="pill">${esc(m.device)}</span>${online != null ? ` <span class="pill ${online ? 'ok' : ''}"><span class="dot ${online ? 'ok' : ''}"></span>${online} online</span>` : ''}</div></header>
    <p class="muted small">${esc(m.summary)}</p>
    <div class="module-body">
      <div class="stack">
        <div class="row"><a class="btn sm brand" href="${esc(m.installUrl)}" target="_blank" rel="noopener">${icon('plus')} Install on this device</a><a class="btn sm" href="${esc(m.url)}" target="_blank" rel="noopener">Open</a><button class="btn sm ghost" data-copy="${esc(m.installUrl)}" title="Copy install link">${icon('link')}</button></div>
        <h4>Desktop downloads</h4>
        <ul class="dl">${m.downloads.map((d) => `<li><a href="${esc(url(d.file))}" download>${icon(PLATFORM_ICON[d.platform] ?? 'file')} ${esc(d.label)}</a><span class="tiny faint mono">${esc(d.file.split('/').pop())}</span></li>`).join('')}</ul>
      </div>
      <figure class="qr"><img src="${esc(url(m.qr))}" width="128" height="128" alt="QR code to install ${esc(m.name)}" loading="lazy"><figcaption class="tiny muted">Scan with a phone to install</figcaption></figure>
    </div>
  </article>`;
}

// data = GET /api/modules; online = { driver: n, ... } (admin only)
export function modulesHtml(data, { online } = {}) {
  return `<div class="modules">${data.modules.map((m) => moduleCard(m, online?.[m.id])).join('')}</div>
    <div class="grid-auto">
      <div class="card"><h3>${icon('layers')} Full network on one computer</h3><p class="small muted">Opens the Driver, Officer Terminal and Dispatch apps side by side, each in its own window with its own device key, for demonstrations and training.</p>
        <ul class="dl">${data.bundle.map((d) => `<li><a href="${esc(url(d.file))}" download>${icon(PLATFORM_ICON[d.platform] ?? 'file')} ${esc(d.label)}</a></li>`).join('')}</ul></div>
      <div class="card"><h3>${icon('phone')} How installing works</h3><ul class="small muted steps">
        <li><b>Phones:</b> scan the module's QR code, then tap <b>Install</b> (Android) or <b>Share → Add to Home Screen</b> (iPhone).</li>
        <li><b>Windows:</b> download the launcher and double-click it. It opens the module in Edge or Chrome as its own app window. Officer terminals can use the kiosk launcher to run full screen.</li>
        <li><b>macOS / Linux:</b> download the launcher and run <code>sh &lt;file&gt;.sh</code> in Terminal.</li>
        <li>Every module connects to <span class="mono">${esc(data.base)}</span> and updates automatically when the server is updated.</li></ul></div>
      <div class="card"><h3>${icon('shield')} Native mobile apps</h3><p class="small muted">App Store and Google Play builds of the Driver app are the next phase. Until then the installed web app gives drivers the same features: verified ID, pull-over alerts, video, tickets and SOS.</p><p><span class="pill brand">Next phase</span></p></div>
    </div>`;
}

export function bindModules(root) {
  root.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Install link copied'); } catch { prompt('Copy this link', b.dataset.copy); }
    };
  });
}
