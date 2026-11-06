// IoBeacons shared site header and footer.
// One file for every page of iobeacons.com: the homepage, Featured Projects,
// Maps Roadmap, the Maps app and any new page. Edit the menu here once.
//
// Static pages:  <div data-site-header></div> ... <div data-site-footer></div>
//                <script type="module" src="/assets/site-header.js"></script>
// Apps:          import { mountSiteHeader } from '.../site-header.js'

export const LOCALES = ['en', 'es', 'fr', 'pt'];
export const NAV = [
  { key: 'observe', path: '/satellite/' },
  { key: 'network', path: '/network/' },
  { key: 'research', path: '/research/' },
  { key: 'build', path: '/developers/' },
  { key: 'mapsApp', path: '/maps/', raw: true },
  { key: 'featured', path: '/featured-projects/', raw: true },
];
export const FOOTER = [
  { key: 'privacy', path: '/privacy/' }, { key: 'terms', path: '/terms/' }, { key: 'governance', path: '/data-governance/' },
  { key: 'ethics', path: '/research-ethics/' }, { key: 'security', path: '/security/' }, { key: 'contact', path: '/contact/' },
];
const T = {
  en: { observe: 'Observe', network: 'Network', research: 'Research', build: 'Build', mapsApp: 'Maps', featured: 'Featured Projects', login: 'Sign in', talk: 'Talk to us', account: 'Account', tagline: 'Telemetry of all things human and machine.', privacy: 'Privacy', terms: 'Terms', governance: 'Data governance', ethics: 'Research ethics', security: 'Security', contact: 'Contact', menu: 'Menu', language: 'Language' },
  es: { observe: 'Observar', network: 'Red', research: 'Investigación', build: 'Construir', mapsApp: 'Mapas', featured: 'Proyectos destacados', login: 'Iniciar sesión', talk: 'Hablemos', account: 'Cuenta', tagline: 'Telemetría de todo lo humano y lo mecánico.', privacy: 'Privacidad', terms: 'Términos', governance: 'Gobernanza de datos', ethics: 'Ética de investigación', security: 'Seguridad', contact: 'Contacto', menu: 'Menú', language: 'Idioma' },
  fr: { observe: 'Observer', network: 'Réseau', research: 'Recherche', build: 'Construire', mapsApp: 'Cartes', featured: 'Projets phares', login: 'Connexion', talk: 'Parlons-en', account: 'Compte', tagline: "Télémétrie de tout ce qui est humain et machine.", privacy: 'Confidentialité', terms: 'Conditions', governance: 'Gouvernance des données', ethics: 'Éthique de la recherche', security: 'Sécurité', contact: 'Contact', menu: 'Menu', language: 'Langue' },
  pt: { observe: 'Observar', network: 'Rede', research: 'Pesquisa', build: 'Construir', mapsApp: 'Mapas', featured: 'Projetos em destaque', login: 'Entrar', talk: 'Fale conosco', account: 'Conta', tagline: 'Telemetria de tudo o que é humano e máquina.', privacy: 'Privacidade', terms: 'Termos', governance: 'Governança de dados', ethics: 'Ética em pesquisa', security: 'Segurança', contact: 'Contato', menu: 'Menu', language: 'Idioma' },
};
const LANG_NAMES = { en: 'English', es: 'Español', fr: 'Français', pt: 'Português' };

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
export function locale() {
  const m = location.pathname.match(/^\/(en|es|fr|pt)(\/|$)/);
  if (m) return m[1];
  const saved = store.get('iobeacons.locale');
  if (LOCALES.includes(saved)) return saved;
  const nav = (navigator.language || 'en').slice(0, 2);
  return LOCALES.includes(nav) ? nav : 'en';
}
const link = (n, l) => (n.raw ? n.path : `/${l}${n.path}`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
.iobh{--iob-ink:#071a33;--iob-muted:#637188;--iob-line:#e3e8ef;--iob-orange:#ff713d;--iob-orange-soft:#fff0e9;font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--iob-ink)}
.iobh *{box-sizing:border-box}
.iobh a{color:inherit;text-decoration:none}
.iobh-bar{display:flex;align-items:center;gap:26px;padding:13px 16px 13px 20px;border:1px solid rgba(208,216,226,.85);border-radius:18px;background:rgba(255,255,255,.9);box-shadow:0 8px 30px rgba(23,46,78,.06);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
.iobh-float{position:sticky;top:14px;z-index:20;max-width:1240px;margin:14px auto 0;padding:0 28px}
.iobh-flush .iobh-bar{border-radius:0;border-width:0 0 1px;box-shadow:none;padding:9px 16px;gap:20px}
.iobh-brand{display:inline-flex;align-items:center;gap:10px;font-weight:850;letter-spacing:-.04em;white-space:nowrap}
.iobh-mark{width:25px;height:25px;position:relative;border-radius:50%;background:var(--iob-orange);box-shadow:0 0 0 6px var(--iob-orange-soft);flex:none}
.iobh-mark::after{content:"";position:absolute;inset:7px;border:2px solid #fff;border-radius:50%}
.iobh-flush .iobh-mark{width:22px;height:22px;box-shadow:0 0 0 5px var(--iob-orange-soft)}
.iobh-flush .iobh-mark::after{inset:6px}
.iobh-nav{display:flex;gap:23px;align-items:center;margin-left:16px;color:#43536a;font-size:.88rem}
.iobh-nav a{transition:color .2s ease;white-space:nowrap;position:relative}
.iobh-nav a:hover,.iobh-nav a[aria-current=page]{color:var(--iob-orange)}
.iobh-nav a[aria-current=page]::after{content:"";position:absolute;left:0;right:0;bottom:-6px;height:2px;border-radius:2px;background:var(--iob-orange)}
.iobh-actions{margin-left:auto;display:flex;align-items:center;gap:13px;font-size:.86rem}
.iobh-login{color:#354762;background:none;border:0;padding:0;font:inherit;cursor:pointer;white-space:nowrap}
.iobh-login:hover{color:var(--iob-orange)}
.iobh-talk{padding:11px 16px;border-radius:10px;background:var(--iob-orange);color:#fff!important;font-weight:750;box-shadow:0 8px 20px rgba(255,113,61,.2);white-space:nowrap}
.iobh-flush .iobh-talk{padding:8px 14px}
.iobh-locale{border:0;background:transparent;color:#52627a;font:inherit;font-size:.78rem;cursor:pointer}
.iobf{font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;padding:38px 0 45px;border-top:1px solid #e3e8ef;color:#637188;font-size:.8rem}
.iobf a{color:inherit;text-decoration:none}
.iobf-row{max-width:1240px;margin:0 auto;padding:0 28px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
.iobf-links{display:flex;gap:17px;flex-wrap:wrap}
.iobf-links a:hover{color:#ff713d}
@media (max-width:980px){.iobh-nav{gap:12px;margin-left:0}}
@media (max-width:720px){.iobh-float{top:8px;padding:0 17px}.iobh-bar{flex-wrap:wrap;gap:13px}.iobh-nav{order:3;width:100%;overflow:auto;padding-bottom:2px}.iobf-row{padding:0 17px}
.iobh-flush .iobh-bar{gap:10px 14px;padding:8px 12px}.iobh-flush .iobh-talk{display:none}}
`;
function ensureCss() {
  if (document.getElementById('iob-site-css')) return;
  const s = document.createElement('style'); s.id = 'iob-site-css'; s.textContent = CSS; document.head.append(s);
}

// Renders the header into `target`.
// options: current (nav key), flush (full-width bar for apps), product (label after the logo),
// account ({ label, onClick }) shown instead of Sign in, onSignIn (handler instead of a link).
export function mountSiteHeader(target, { current, flush = false, product, account, onSignIn } = {}) {
  ensureCss();
  const l = locale(); const t = T[l];
  const here = current || NAV.find((n) => location.pathname.startsWith(n.path) || location.pathname.startsWith(`/${l}${n.path}`))?.key;
  target.classList.add('iobh', flush ? 'iobh-flush' : 'iobh-float');
  target.innerHTML = `<header class="iobh-bar">
    <a class="iobh-brand" href="/${l}/"><span class="iobh-mark" aria-hidden="true"></span><span>IO BEACONS</span>${product ? `<span class="iobh-product">${esc(product)}</span>` : ''}</a>
    <nav class="iobh-nav" aria-label="Primary navigation">${NAV.map((n) => `<a href="${link(n, l)}"${n.key === here ? ' aria-current="page"' : ''}>${esc(t[n.key])}</a>`).join('')}</nav>
    <div class="iobh-actions">
      ${account ? `<button type="button" class="iobh-login" data-act="account">${esc(account.label || t.account)}</button>` : onSignIn ? `<button type="button" class="iobh-login" data-act="signin">${esc(t.login)}</button>` : `<a class="iobh-login" href="/maps/#signin">${esc(t.login)}</a>`}
      <a class="iobh-talk" href="/contact/">${esc(t.talk)}</a>
      <select class="iobh-locale" aria-label="${esc(t.language)}">${LOCALES.map((x) => `<option value="${x}"${x === l ? ' selected' : ''}>${LANG_NAMES[x]}</option>`).join('')}</select>
    </div></header>`;
  target.querySelector('[data-act=account]')?.addEventListener('click', account?.onClick);
  target.querySelector('[data-act=signin]')?.addEventListener('click', onSignIn);
  target.querySelector('.iobh-locale').addEventListener('change', (e) => {
    const nl = e.target.value; store.set('iobeacons.locale', nl);
    const m = location.pathname.match(/^\/(en|es|fr|pt)(\/.*)?$/);
    if (m) location.href = `/${nl}${m[2] || '/'}`; else location.reload();
  });
  return target;
}

export function mountSiteFooter(target) {
  ensureCss();
  const l = locale(); const t = T[l];
  target.classList.add('iobf');
  target.innerHTML = `<div class="iobf-row"><span>${esc(t.tagline)}</span><span class="iobf-links">${FOOTER.map((f) => `<a href="${f.path}">${esc(t[f.key])}</a>`).join('')}</span></div>`;
  return target;
}

// Static pages mount themselves.
if (typeof document !== 'undefined') {
  const auto = () => {
    document.querySelectorAll('[data-site-header]').forEach((el) => mountSiteHeader(el, { current: el.dataset.current }));
    document.querySelectorAll('[data-site-footer]').forEach((el) => mountSiteFooter(el));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
}
