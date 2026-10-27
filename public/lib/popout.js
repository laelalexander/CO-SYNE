// Open the CO-SYNE apps as their own pop-out windows, so the page that
// launched them stays put. Each app has a named window: clicking again brings
// the open one forward instead of opening a duplicate. Phones get a new tab.
// Links opt in with data-popout="driver|officer|dispatch|state|admin"; a
// button with data-popout-all="driver,officer,dispatch" opens several at once.
const SIZE = { driver: [430, 900], 'driver-pending': [430, 900], officer: [1440, 900], dispatch: [1440, 900], state: [1366, 900], admin: [1366, 900] };
const isPhone = () => matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1024px)').matches;

function features(app, slot = 0) {
  const [w0, h0] = SIZE[app] ?? [1280, 860];
  const sw = screen.availWidth || 1440; const sh = screen.availHeight || 900;
  const sl = screen.availLeft ?? 0; const st = screen.availTop ?? 0;
  const phone = app.startsWith('driver');
  const w = Math.min(w0, phone ? w0 : sw - (sw > 1800 ? 440 : 0));
  const h = Math.min(h0, sh);
  // The phone sits on the right; the big consoles share the rest, offset so each title bar shows.
  const left = phone ? sl + sw - w - (app === 'driver-pending' ? w + 12 : 0) : sl + Math.min(slot * 48, Math.max(0, sw - w));
  const top = st + (phone ? 0 : Math.min(slot * 36, Math.max(0, sh - h)));
  return `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`;
}

export function popOut(href, app, slot = 0) {
  if (isPhone()) { const tab = window.open(href, '_blank'); if (tab) tab.opener = null; return tab; }
  const win = window.open(href, `cosyne-${app}`, features(app, slot));
  try { win?.focus(); } catch { /* ignore */ }
  return win;
}

function blockedNotice(anchorEl, links) {
  let n = document.getElementById('popout-notice');
  if (!n) {
    n = document.createElement('div');
    n.id = 'popout-notice';
    n.setAttribute('role', 'alert');
    n.style.cssText = 'margin:14px 0;padding:12px 14px;border-radius:8px;background:#fff4ce;color:#5c3c00;border:1px solid #e9c46a;font-size:.92rem;line-height:1.45';
    (anchorEl.closest('[data-popout-host]') ?? anchorEl.parentElement).after(n);
  }
  n.innerHTML = `<b>Your browser blocked the pop-up window.</b> Allow pop-ups for ${location.hostname} once (the icon at the right end of the address bar), then click again. Or open in new tabs: ${links.map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`).join(' · ')}`;
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const one = e.target.closest('a[data-popout]');
  const all = e.target.closest('[data-popout-all]');
  if (one) {
    e.preventDefault();
    if (!popOut(one.href, one.dataset.popout)) blockedNotice(one, [{ href: one.href, label: one.textContent.trim() || one.dataset.popout }]);
  } else if (all) {
    e.preventDefault();
    const apps = all.dataset.popoutAll.split(',').map((s) => s.trim());
    const links = apps.map((app) => {
      const a = document.querySelector(`a[data-popout="${app}"]`);
      return { app, href: a?.href ?? new URL(`${app}/`, document.baseURI).href, label: a?.textContent.trim() || app };
    });
    let slot = 0;
    const blocked = links.filter((l) => !popOut(l.href, l.app, l.app === 'driver' ? 0 : slot++));
    if (blocked.length) blockedNotice(all, blocked);
    else document.getElementById('popout-notice')?.remove();
  }
});
