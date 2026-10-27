// Show / hide for every password and access-code field: an eye button inside
// the field toggles between dots and the typed text. Fields added later (each
// sign-in screen renders on demand) are picked up automatically.
const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function enhance(input) {
  if (input.dataset.reveal) return;
  input.dataset.reveal = '1';
  const wrap = document.createElement('span');
  wrap.style.cssText = 'position:relative;display:block';
  input.parentNode.insertBefore(wrap, input);
  wrap.append(input);
  input.style.paddingRight = '44px';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reveal-btn';
  btn.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);width:36px;height:32px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.75;cursor:pointer;padding:0';
  const sync = () => {
    const shown = input.type === 'text';
    btn.innerHTML = shown ? EYE_OFF : EYE;
    btn.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
    btn.title = shown ? 'Hide password' : 'Show password';
    btn.setAttribute('aria-pressed', String(shown));
  };
  btn.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; sync(); input.focus(); };
  sync();
  wrap.append(btn);
}
const scan = (root = document) => root.querySelectorAll?.('input[type="password"]:not([data-reveal])').forEach(enhance);
new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
scan();
