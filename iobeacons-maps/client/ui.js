// Tiny DOM helpers, toasts and dialogs. No framework.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// Let el.append(a, cond ? b : null) skip empty values the way h() does,
// instead of writing the text "null" into the page.
const nativeAppend = Element.prototype.append;
Element.prototype.append = function append(...nodes) { nativeAppend.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false)); };
const nativePrepend = Element.prototype.prepend;
Element.prototype.prepend = function prepend(...nodes) { nativePrepend.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false)); };
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(message, kind = 'info', ms = 4200) {
  let host = $('#toasts');
  if (!host) { host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div', { class: `toast ${kind}` }, message);
  host.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

let openModal = null;
export function modal(title, body, { wide = false, onClose } = {}) {
  closeModal();
  const close = () => closeModal();
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, body));
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  openModal = { back, onKey, onClose };
  setTimeout(() => box.querySelector('input, select, textarea, button.primary')?.focus(), 30);
  return { box, close };
}
export function closeModal() {
  if (!openModal) return;
  openModal.back.remove();
  document.removeEventListener('keydown', openModal.onKey);
  const cb = openModal.onClose; openModal = null;
  cb?.();
}

// In-page confirm (the artifact-style host blocks window.confirm in some places).
export function confirmBox(message, { ok = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    const m = modal('Please confirm', h('div', { class: 'stack' },
      h('p', {}, message),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => { m.close(); resolve(false); } }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { m.close(); resolve(true); } }, ok))));
  });
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

export const fmtNum = (n) => (n === null || n === undefined ? '∞' : Number(n).toLocaleString('en-US'));
export const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const ago = (d) => {
  if (!d) return 'never';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

export function copyText(text) {
  return navigator.clipboard?.writeText(text).then(() => toast('Copied.'), () => toast('Select the text and copy it.', 'warn'));
}
