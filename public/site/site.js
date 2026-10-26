// CO-SYNE website: shared header and footer, icons, the phone menu, the
// traffic-stop walkthrough, scroll reveal, and the contact form.
import { icon } from '../lib/icons.js';

const PAGES = [
  ['cosyne_index.html', 'Home'], ['cosyne_index.html#how', 'How it works'], ['cosyne_drivers.html', 'Drivers'],
  ['cosyne_agencies.html', 'Agencies'], ['cosyne_platform.html', 'Platform'], ['cosyne_security.html', 'Security'], ['cosyne_contact.html', 'Contact'],
];
const here = location.pathname.split('/').pop() || 'cosyne_index.html';

function header() {
  const el = document.getElementById('site-header');
  if (!el) return;
  el.className = 'site-header';
  el.innerHTML = `<div class="wrap nav">
      <a class="brand" href="cosyne_index.html" aria-label="CO-SYNE home"><img src="icon.svg" alt=""><span>CO-SYNE<small>Driver to Emergency Services</small></span></a>
      <button class="menu-toggle" aria-expanded="false" aria-controls="nav-panel" aria-label="Menu">${icon('list')}</button>
      <div class="nav-panel" id="nav-panel">
        <ul class="nav-links">${PAGES.map(([href, label]) => `<li><a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')}</ul>
        <div class="nav-cta"><a class="btn btn-secondary btn-sm" href="./">Live demo</a><a class="btn btn-primary btn-sm" href="cosyne_contact.html?type=agency">Request a demo</a></div>
      </div></div>`;
  const btn = el.querySelector('.menu-toggle');
  btn.onclick = () => {
    const open = el.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
    btn.innerHTML = icon(open ? 'x' : 'list');
  };
  el.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => { el.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.innerHTML = icon('list'); }));
}

function footer() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.className = 'site-footer';
  el.innerHTML = `<div class="wrap"><div class="foot-grid">
      <div><a class="brand" href="cosyne_index.html"><img src="icon.svg" alt=""><span>CO-SYNE<small>Driver to Emergency Services</small></span></a>
        <p style="margin-top:14px;max-width:320px">Connecting drivers, law enforcement, emergency responders and dispatch on one verified, real-time network.</p></div>
      <div><h4>Apps</h4><ul><li><a href="driver/">Driver app</a></li><li><a href="officer/">Officer terminal</a></li><li><a href="dispatch/">Dispatch console</a></li><li><a href="downloads/">Downloads</a></li><li><a href="admin/">Main admin</a></li></ul></div>
      <div><h4>Solutions</h4><ul><li><a href="cosyne_drivers.html">For drivers</a></li><li><a href="cosyne_agencies.html">For agencies</a></li><li><a href="cosyne_platform.html#hardware">Vehicle hardware</a></li><li><a href="cosyne_platform.html#pilot">Tulsa pilot</a></li></ul></div>
      <div><h4>Trust</h4><ul><li><a href="cosyne_security.html">Security &amp; privacy</a></li><li><a href="cosyne_security.html#faq">FAQ</a></li><li><a href="api/ledger/verify">Ledger status</a></li></ul></div>
      <div><h4>Investors</h4><ul><li><a href="cosyne_investors.html">Investor Relations</a></li><li><a href="cosyne_strategy.html">Market Strategy</a></li><li><a href="cosyne_thesis.html">Investment Thesis</a></li></ul></div>
      <div><h4>Company</h4><ul><li><a href="cosyne_index.html#about">About CO-SYNE</a></li><li><a href="cosyne_contact.html?type=agency">Request a demo</a></li><li><a href="cosyne_contact.html">Contact us</a></li></ul></div>
    </div>
    <div class="foot-base"><span>© ${new Date().getFullYear()} CO-SYNE. All rights reserved.</span><span>Photos are illustrative; people shown are not CO-SYNE pilot participants. <a href="cosyne_credits.html">Photo credits</a> · Demonstration identities and payments are simulated.</span></div></div>`;
}

// <i data-icon="name"></i> -> inline SVG
function icons() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
}

// Traffic-stop walkthrough: tabs on the left, the matching app screen on the right.
function stepper() {
  document.querySelectorAll('[data-stepper]').forEach((root) => {
    const btns = [...root.querySelectorAll('.step-btn')];
    const panels = [...root.querySelectorAll('.step-panel')];
    const select = (i, focus) => {
      btns.forEach((b, j) => { b.setAttribute('aria-selected', String(i === j)); b.tabIndex = i === j ? 0 : -1; });
      panels.forEach((p, j) => p.classList.toggle('on', i === j));
      if (focus) btns[i].focus();
      root.dataset.index = i;
    };
    btns.forEach((b, i) => {
      b.onclick = () => select(i);
      b.onkeydown = (e) => {
        if (['ArrowDown', 'ArrowRight'].includes(e.key)) { e.preventDefault(); select((i + 1) % btns.length, true); }
        if (['ArrowUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); select((i - 1 + btns.length) % btns.length, true); }
      };
    });
    root.querySelector('[data-prev]')?.addEventListener('click', () => select((Number(root.dataset.index) - 1 + btns.length) % btns.length));
    root.querySelector('[data-next]')?.addEventListener('click', () => select((Number(root.dataset.index) + 1) % btns.length));
    select(0);
  });
}

function reveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -60px 0px' });
  items.forEach((el) => io.observe(el));
}

// Contact / request a demo. ?type=hardware preselects the interest.
function contact() {
  const form = document.getElementById('contact-form');
  if (!form) return;
  const type = new URLSearchParams(location.search).get('type');
  if (type && form.type.querySelector(`option[value="${CSS.escape(type)}"]`)) form.type.value = type;
  const status = document.getElementById('form-status');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    status.className = 'alert'; status.textContent = 'Sending…';
    try {
      const res = await fetch('api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, source: 'website' }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `Something went wrong (${res.status})`);
      form.reset();
      form.hidden = true;
      status.className = 'alert ok';
      status.innerHTML = '<b>Thank you. Your message was received.</b><br>The CO-SYNE team will reply by email. In the meantime you can try the <a href="./">live demo apps</a>.';
      status.focus();
    } catch (err) {
      status.className = 'alert bad';
      status.textContent = err.message.charAt(0).toUpperCase() + err.message.slice(1);
      btn.disabled = false;
    }
  };
}

header();
footer();
icons();
stepper();
reveal();
contact();

// Reading view: highlight the section in view in the side contents.
(() => {
  const links = [...document.querySelectorAll('.doc-toc a[href^="#"]')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { links.forEach((a) => a.classList.remove('on')); byId.get(e.target.id)?.classList.add('on'); }
  }, { rootMargin: '-90px 0px -65% 0px' });
  document.querySelectorAll('.doc-body section[id]').forEach((s) => io.observe(s));
})();
