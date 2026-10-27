// One-time demo links from the Main Admin's Demo Control. A link ends in
// #demo=<pass>; the module exchanges the pass once for a signed-in start and
// removes it from the address bar, so reloading or sharing the page can't reuse it.
import { api } from './session.js';

const PASS = /(?:^#|&)demo=([A-Za-z0-9_-]+)/;
export const hasDemoPass = () => PASS.test(location.hash);

export async function redeemDemoPass(module, extra = {}) {
  const m = location.hash.match(PASS);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return api('POST', '/api/demo/redeem', { pass: m[1], module, ...extra });
}

// "Open demo" badge: shown in each module while sign-in codes are switched off.
export function openDemoBadge(config) {
  if (!config?.openDemo || document.getElementById('open-demo-badge')) return;
  const b = document.createElement('div');
  b.id = 'open-demo-badge';
  b.textContent = 'Open demo';
  b.title = 'Open demo mode: no sign-in codes. Turn it off in Main Admin > Settings.';
  b.style.cssText = 'position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:9999;pointer-events:none;font:600 11px/1 system-ui,sans-serif;letter-spacing:.04em;padding:4px 10px;border-radius:999px;background:#c9a54a;color:#111;opacity:.92';
  document.body.append(b);
}
