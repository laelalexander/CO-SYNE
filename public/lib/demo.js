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
