// Window manager for the officer terminal: movable, resizable, minimizable
// app windows with a taskbar, like a desktop operating system.
import { icon } from '../lib/icons.js';
import { esc } from '../lib/ui.js';

export class WindowManager {
  constructor({ root, taskbar, apps }) {
    Object.assign(this, { root, taskbar, apps });
    this.windows = new Map(); // appId -> { el, body, app, state }
    this.z = 10;
    this.badges = new Map();
  }

  isOpen(id) { return this.windows.has(id); }
  body(id) { return this.windows.get(id)?.body ?? null; }

  open(id, args) {
    const app = this.apps[id];
    if (!app) return null;
    let w = this.windows.get(id);
    if (w) {
      w.el.classList.remove('min');
      this.focus(id);
      if (args !== undefined) app.reopen?.(w.body, args);
      return w.body;
    }
    const el = document.createElement('div');
    el.className = 'win';
    el.dataset.app = id;
    const area = this.root.getBoundingClientRect();
    const width = Math.min(app.w ?? 760, area.width - 120);
    const height = Math.min(app.h ?? 520, area.height - 30);
    const n = this.windows.size;
    const x = app.x ?? Math.max(110, Math.min(area.width - width - 10, 130 + n * 34));
    const y = app.y ?? Math.max(10, Math.min(area.height - height - 10, 20 + n * 28));
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    el.innerHTML = `<div class="win-bar">${icon(app.icon)}<span class="win-title">${esc(app.title)}<span class="sub"></span></span>
      <button class="win-ctl" data-ctl="min" title="Minimize">${icon('minus')}</button>
      <button class="win-ctl" data-ctl="max" title="Maximize">${icon('square')}</button>
      <button class="win-ctl close" data-ctl="close" title="Close">${icon('x')}</button></div>
      <div class="win-body ${app.pad === false ? '' : 'pad'}"></div>`;
    this.root.append(el);
    const body = el.querySelector('.win-body');
    w = { el, body, app };
    this.windows.set(id, w);
    if (app.maximized) el.classList.add('max');
    this.bind(id, w);
    this.focus(id);
    app.mount(body, args);
    this.renderTaskbar();
    return body;
  }

  bind(id, w) {
    const bar = w.el.querySelector('.win-bar');
    w.el.addEventListener('pointerdown', () => this.focus(id), true);
    bar.addEventListener('dblclick', (e) => { if (!e.target.closest('.win-ctl')) this.toggleMax(id); });
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.win-ctl') || w.el.classList.contains('max')) return;
      const start = { x: e.clientX, y: e.clientY, left: w.el.offsetLeft, top: w.el.offsetTop };
      const area = this.root.getBoundingClientRect();
      const move = (ev) => {
        const left = Math.min(area.width - 80, Math.max(-w.el.offsetWidth + 120, start.left + ev.clientX - start.x));
        const top = Math.min(area.height - 40, Math.max(0, start.top + ev.clientY - start.y));
        w.el.style.left = `${left}px`; w.el.style.top = `${top}px`;
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    w.el.querySelector('[data-ctl=min]').onclick = () => this.minimize(id);
    w.el.querySelector('[data-ctl=max]').onclick = () => this.toggleMax(id);
    w.el.querySelector('[data-ctl=close]').onclick = () => this.close(id);
  }

  setSubtitle(id, text) {
    const sub = this.windows.get(id)?.el.querySelector('.win-title .sub');
    if (sub) sub.textContent = text ? `· ${text}` : '';
  }

  focus(id) {
    for (const [k, w] of this.windows) w.el.classList.toggle('focused', k === id);
    const w = this.windows.get(id);
    if (w) w.el.style.zIndex = String(++this.z);
    this.active = id;
    this.clearBadge(id);
    this.renderTaskbar();
  }

  minimize(id) {
    this.windows.get(id)?.el.classList.add('min');
    if (this.active === id) this.active = null;
    this.renderTaskbar();
  }

  toggleMax(id) {
    const w = this.windows.get(id);
    w?.el.classList.toggle('max');
    w?.app.onResize?.(w.body);
  }

  close(id) {
    const w = this.windows.get(id);
    if (!w) return;
    if (w.app.beforeClose && w.app.beforeClose(w.body) === false) return;
    w.app.unmount?.(w.body);
    w.el.remove();
    this.windows.delete(id);
    if (this.active === id) this.active = null;
    this.renderTaskbar();
  }

  badge(id, n) {
    if (this.active === id && this.windows.has(id) && !this.windows.get(id).el.classList.contains('min')) return;
    this.badges.set(id, n ?? (this.badges.get(id) ?? 0) + 1);
    this.renderTaskbar();
    this.onBadge?.();
  }
  clearBadge(id) { if (this.badges.delete(id)) this.onBadge?.(); }

  renderTaskbar() {
    const pinned = Object.entries(this.apps).filter(([, a]) => a.pinned);
    const extra = [...this.windows.keys()].filter((k) => !this.apps[k].pinned).map((k) => [k, this.apps[k]]);
    this.taskbar.innerHTML = [...pinned, ...extra].map(([id, a]) => {
      const w = this.windows.get(id);
      const cls = [w ? 'open' : '', this.active === id && w && !w.el.classList.contains('min') ? 'active' : ''].join(' ');
      const b = this.badges.get(id);
      return `<button class="tb-app ${cls}" data-app="${id}" title="${esc(a.title)}">${icon(a.icon)}<span>${esc(a.short ?? a.title)}</span>${b ? `<i class="badge-n">${b}</i>` : ''}</button>`;
    }).join('');
    this.taskbar.querySelectorAll('[data-app]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.app;
        const w = this.windows.get(id);
        if (w && this.active === id && !w.el.classList.contains('min')) this.minimize(id);
        else this.open(id);
      };
    });
  }
}
