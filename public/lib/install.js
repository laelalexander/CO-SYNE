// "Install this app" support for the CO-SYNE modules. Opening an app with
// ?install=1 (the links and QR codes on the downloads page) shows an install
// card: the browser's own install prompt where it has one (Chrome, Edge,
// Android), and Add to Home Screen steps on iPhone and iPad.
import { esc } from './ui.js';

let deferred = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function canInstall() { return Boolean(deferred); }

export async function promptInstall() {
  if (!deferred) return false;
  const d = deferred;
  deferred = null;
  d.prompt();
  const { outcome } = await d.userChoice;
  return outcome === 'accepted';
}

export function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    document.getElementById('install-go')?.removeAttribute('disabled');
  });
  window.addEventListener('appinstalled', () => document.getElementById('install-pop')?.remove());
  if (!new URLSearchParams(location.search).has('install') || standalone()) return;
  const name = document.title;
  const iconHref = document.querySelector('link[rel="icon"]')?.href ?? '';
  const pop = Object.assign(document.createElement('div'), { id: 'install-pop', className: 'install-pop' });
  const ios = isIos();
  pop.innerHTML = `<img src="${esc(iconHref)}" alt=""><div class="grow"><b>Install ${esc(name)}</b>
    <p class="small muted" id="install-help">${ios
      ? 'Tap the Share button in Safari, then <b>Add to Home Screen</b>. The app then opens full screen from its own icon.'
      : 'Adds the app to this device with its own icon and window. It keeps working offline for start-up.'}</p>
    <div class="row">${ios ? '' : '<button class="btn sm brand" id="install-go" disabled>Install</button>'}<button class="btn sm" id="install-later">Not now</button></div></div>`;
  const show = () => document.body.append(pop);
  if (document.body) show(); else addEventListener('DOMContentLoaded', show);
  pop.querySelector('#install-later').onclick = () => pop.remove();
  const go = pop.querySelector('#install-go');
  if (!go) return;
  if (deferred) go.removeAttribute('disabled');
  go.onclick = async () => { if (await promptInstall()) pop.remove(); };
  // Browsers without a prompt (Firefox, Safari on macOS) or that already
  // installed the app: say how to do it from the browser menu.
  setTimeout(() => {
    if (deferred || !pop.isConnected) return;
    pop.querySelector('#install-help').innerHTML = 'Use your browser menu: <b>Install app</b> (Chrome, Edge) or <b>Add to Home screen</b> (Android). If it is already installed, open it from its icon.';
    go.remove();
  }, 5000);
}
