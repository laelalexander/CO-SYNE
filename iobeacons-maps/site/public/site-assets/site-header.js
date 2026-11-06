// IoBeacons shared site header and footer.
// One file for every page of iobeacons.com and for the Maps app, so the menu
// is the same everywhere. Edit the menu here once.
//
// Static pages:  <div data-site-header data-current="maps"></div> ... <div data-site-footer></div>
//                <script type="module" src="/site-assets/site-header.js"></script>
// Apps:          import { mountSiteHeader } from '.../site-header.js'

export const LOCALES = ['en', 'es', 'fr', 'pt'];
export const NAV = [
  { key: 'platform', path: '/platform/' },
  { key: 'maps', path: '/platform/maps/' },
  { key: 'space', path: '/platform/space/' },
  { key: 'network', path: '/network/' },
  { key: 'research', path: '/research/' },
  { key: 'developers', path: '/developers/' },
  { key: 'projects', path: '/featured-projects/' },
];
const FOOTER = [
  { title: 'product', links: [['platform', '/platform/'], ['maps', '/platform/maps/'], ['space', '/platform/space/'], ['network', '/network/'], ['roadmap', '/maps-roadmap/'], ['openMaps', '/maps/']] },
  { title: 'company', links: [['projects', '/featured-projects/'], ['research', '/research/'], ['developers', '/developers/'], ['contact', '/contact/']] },
  { title: 'trust', links: [['privacy', '/privacy/'], ['terms', '/terms/'], ['governance', '/data-governance/'], ['ethics', '/research-ethics/'], ['security', '/security/']] },
];
const T = {
  en: { platform: 'Platform', maps: 'Maps', space: 'Space', network: 'Network', research: 'Research', developers: 'Developers', projects: 'Projects', login: 'Sign in', talk: 'Talk to us', tryMaps: 'Try Maps free', openMaps: 'Open Maps', account: 'Account', menu: 'Menu', close: 'Close', language: 'Language', roadmap: 'Roadmap', contact: 'Contact', product: 'Product', company: 'Company', trust: 'Trust', tagline: 'Telemetry of all things human and machine.', blurb: 'IoBeacons is a GIS enablement service. Maps, satellites, devices and live data in one place, and a team that helps you use them.', privacy: 'Privacy', terms: 'Terms', governance: 'Data governance', ethics: 'Research ethics', security: 'Security' },
  es: { platform: 'Plataforma', maps: 'Mapas', space: 'Espacio', network: 'Red', research: 'Investigación', developers: 'Desarrolladores', projects: 'Proyectos', login: 'Iniciar sesión', talk: 'Hablemos', tryMaps: 'Prueba Mapas gratis', openMaps: 'Abrir Mapas', account: 'Cuenta', menu: 'Menú', close: 'Cerrar', language: 'Idioma', roadmap: 'Hoja de ruta', contact: 'Contacto', product: 'Producto', company: 'Empresa', trust: 'Confianza', tagline: 'Telemetría de todo lo humano y lo mecánico.', blurb: 'IoBeacons es un servicio de habilitación GIS. Mapas, satélites, dispositivos y datos en vivo en un solo lugar, con un equipo que te ayuda a usarlos.', privacy: 'Privacidad', terms: 'Términos', governance: 'Gobernanza de datos', ethics: 'Ética de investigación', security: 'Seguridad' },
  fr: { platform: 'Plateforme', maps: 'Cartes', space: 'Espace', network: 'Réseau', research: 'Recherche', developers: 'Développeurs', projects: 'Projets', login: 'Connexion', talk: 'Parlons-en', tryMaps: 'Essayer Cartes', openMaps: 'Ouvrir Cartes', account: 'Compte', menu: 'Menu', close: 'Fermer', language: 'Langue', roadmap: 'Feuille de route', contact: 'Contact', product: 'Produit', company: 'Entreprise', trust: 'Confiance', tagline: 'Télémétrie de tout ce qui est humain et machine.', blurb: "IoBeacons est un service d'activation SIG. Cartes, satellites, appareils et données en direct au même endroit, avec une équipe pour vous accompagner.", privacy: 'Confidentialité', terms: 'Conditions', governance: 'Gouvernance des données', ethics: 'Éthique de la recherche', security: 'Sécurité' },
  pt: { platform: 'Plataforma', maps: 'Mapas', space: 'Espaço', network: 'Rede', research: 'Pesquisa', developers: 'Desenvolvedores', projects: 'Projetos', login: 'Entrar', talk: 'Fale conosco', tryMaps: 'Experimente o Mapas', openMaps: 'Abrir Mapas', account: 'Conta', menu: 'Menu', close: 'Fechar', language: 'Idioma', roadmap: 'Roteiro', contact: 'Contato', product: 'Produto', company: 'Empresa', trust: 'Confiança', tagline: 'Telemetria de tudo o que é humano e máquina.', blurb: 'IoBeacons é um serviço de habilitação GIS. Mapas, satélites, dispositivos e dados ao vivo em um só lugar, com uma equipe que ajuda você a usá-los.', privacy: 'Privacidade', terms: 'Termos', governance: 'Governança de dados', ethics: 'Ética em pesquisa', security: 'Segurança' },
};
const LANG_NAMES = { en: 'EN', es: 'ES', fr: 'FR', pt: 'PT' };

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
export function locale() {
  const saved = store.get('iobeacons.locale');
  if (LOCALES.includes(saved)) return saved;
  const nav = ((typeof navigator !== 'undefined' && navigator.language) || 'en').slice(0, 2);
  return LOCALES.includes(nav) ? nav : 'en';
}
export const t = (key) => (T[locale()] || T.en)[key] || T.en[key] || key;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
.iobh{--iob-ink:#071a33;--iob-muted:#637188;--iob-line:#e3e8ef;--iob-orange:#ff713d;--iob-orange-soft:#fff0e9;font-family:"Avenir Next","Segoe UI",system-ui,-apple-system,sans-serif;color:var(--iob-ink);font-size:16px;line-height:1.4}
.iobh *{box-sizing:border-box}
.iobh a{color:inherit;text-decoration:none}
.iobh-bar{position:relative;display:flex;align-items:center;gap:22px;padding:12px 14px 12px 20px;border:1px solid rgba(208,216,226,.85);border-radius:18px;background:rgba(255,255,255,.92);box-shadow:0 8px 30px rgba(23,46,78,.06);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
.iobh-float{position:sticky;top:14px;z-index:50;max-width:1240px;margin:14px auto 0;padding:0 24px}
.iobh-flush{position:relative;z-index:60}
.iobh-flush .iobh-bar{border-radius:0;border-width:0 0 1px;box-shadow:none;padding:8px 16px;gap:18px;background:#fff}
.iobh-brand{display:inline-flex;align-items:center;gap:10px;font-weight:850;letter-spacing:-.04em;white-space:nowrap;font-size:1rem}
.iobh-mark{width:24px;height:24px;position:relative;border-radius:50%;background:var(--iob-orange);box-shadow:0 0 0 6px var(--iob-orange-soft);flex:none;display:inline-block}
.iobh-mark::after{content:"";position:absolute;inset:7px;border:2px solid #fff;border-radius:50%}
.iobh-flush .iobh-mark{width:20px;height:20px;box-shadow:0 0 0 4px var(--iob-orange-soft)}
.iobh-flush .iobh-mark::after{inset:5.5px}
.iobh-nav{display:flex;gap:22px;align-items:center;margin-left:10px;color:#43536a;font-size:.9rem}
.iobh-nav a{transition:color .2s ease;white-space:nowrap;position:relative;padding:4px 0}
.iobh-nav a:hover,.iobh-nav a[aria-current=page]{color:var(--iob-orange)}
.iobh-nav a[aria-current=page]::after{content:"";position:absolute;left:0;right:0;bottom:-4px;height:2px;border-radius:2px;background:var(--iob-orange)}
.iobh-actions{margin-left:auto;display:flex;align-items:center;gap:14px;font-size:.88rem}
.iobh-link{color:#354762;background:none;border:0;padding:0;font:inherit;cursor:pointer;white-space:nowrap}
.iobh-link:hover{color:var(--iob-orange)}
.iobh-cta{padding:10px 16px;border-radius:10px;background:var(--iob-orange);color:#fff!important;font-weight:750;box-shadow:0 8px 20px rgba(255,113,61,.22);white-space:nowrap}
.iobh-cta:hover{background:#f25f2a}
.iobh-flush .iobh-cta{padding:7px 13px;box-shadow:none}
.iobh-locale{border:1px solid var(--iob-line);border-radius:8px;background:#fff;color:#52627a;font:inherit;font-size:.78rem;padding:4px;cursor:pointer}
.iobh-burger{display:none;margin-left:auto;border:1px solid var(--iob-line);background:#fff;border-radius:10px;padding:8px 12px;font:inherit;font-size:.85rem;font-weight:650;color:var(--iob-ink);cursor:pointer}
.iobh-sheet{display:none}
@media (max-width:1180px){.iobh-nav{gap:15px;margin-left:0;font-size:.86rem}.iobh-actions{gap:11px}.iobh-hide-md{display:none}}
@media (max-width:1000px){
 .iobh-nav,.iobh-actions{display:none}.iobh-burger{display:inline-flex}
 .iobh-flush .iobh-bar{padding:8px 12px}
 .iobh-sheet{position:absolute;left:0;right:0;top:calc(100% + 8px);background:#fff;border:1px solid var(--iob-line);border-radius:16px;box-shadow:0 24px 60px rgba(7,26,51,.18);padding:10px;flex-direction:column;gap:2px}
 .iobh-flush .iobh-sheet{left:10px;right:10px}
 .iobh.open .iobh-sheet{display:flex}
 .iobh-sheet a{padding:12px 14px;border-radius:10px;font-size:1rem}
 .iobh-sheet a:hover,.iobh-sheet a[aria-current=page]{background:var(--iob-orange-soft);color:#c94a1c}
 .iobh-sheet-row{display:flex;gap:12px;align-items:center;padding:12px 6px 4px;border-top:1px solid var(--iob-line);margin-top:6px}
 .iobh-sheet-row .iobh-cta{flex:1;text-align:center;padding:12px}
}
@media (max-width:640px){.iobh-float{top:8px;padding:0 12px}}
.iobf{display:block;font-family:"Avenir Next","Segoe UI",system-ui,-apple-system,sans-serif;background:#071a33;color:#aab6c8;font-size:.9rem;line-height:1.5}
.iobf a{color:#dbe3ee;text-decoration:none}
.iobf a:hover{color:#ff713d}
.iobf p{margin:0;max-width:34ch}
.iobf-in{max-width:1240px;margin:0 auto;padding:56px 24px 28px;display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:32px}
.iobf-brand{display:flex;align-items:center;gap:10px;font-weight:850;letter-spacing:-.04em;color:#fff;font-size:1.05rem;margin-bottom:12px}
.iobf-brand .iobh-mark{box-shadow:0 0 0 5px rgba(255,113,61,.18)}
.iobf h4{margin:0 0 12px;color:#fff;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase}
.iobf ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.iobf-base{max-width:1240px;margin:0 auto;padding:18px 24px 30px;border-top:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:.8rem}
@media (max-width:820px){.iobf-in{grid-template-columns:1fr 1fr}.iobf-about{grid-column:1/-1}}
@media (max-width:480px){.iobf-in{grid-template-columns:1fr;padding:40px 16px 20px}.iobf-base{padding:16px}}
`;
function ensureCss() {
  if (document.getElementById('iob-site-css')) return;
  const s = document.createElement('style'); s.id = 'iob-site-css'; s.textContent = CSS; document.head.append(s);
}

// Renders the header into `target`.
// options: current (nav key), flush (full-width bar for apps), account ({ label, onClick })
// shown instead of Sign in, onSignIn (handler instead of the sign-in link), inApp (inside Maps).
export function mountSiteHeader(target, { current, flush = false, account, onSignIn, inApp = false } = {}) {
  ensureCss();
  const l = locale();
  const here = current || [...NAV].sort((a, b) => b.path.length - a.path.length).find((n) => location.pathname.startsWith(n.path))?.key;
  target.classList.add('iobh', flush ? 'iobh-flush' : 'iobh-float');
  const navLinks = NAV.map((n) => `<a href="${n.path}"${n.key === here ? ' aria-current="page"' : ''}>${esc(t(n.key))}</a>`).join('');
  const signIn = account
    ? `<button type="button" class="iobh-link" data-act="account">${esc(account.label || t('account'))}</button>`
    : onSignIn ? `<button type="button" class="iobh-link" data-act="signin">${esc(t('login'))}</button>` : `<a class="iobh-link" href="/maps/#signin">${esc(t('login'))}</a>`;
  const cta = inApp ? `<a class="iobh-cta" href="/contact/">${esc(t('talk'))}</a>` : `<a class="iobh-cta" href="/maps/">${esc(t('tryMaps'))}</a>`;
  const langSel = `<select class="iobh-locale" aria-label="${esc(t('language'))}">${LOCALES.map((x) => `<option value="${x}"${x === l ? ' selected' : ''}>${LANG_NAMES[x]}</option>`).join('')}</select>`;
  target.innerHTML = `<header class="iobh-bar">
    <a class="iobh-brand" href="/"><span class="iobh-mark" aria-hidden="true"></span><span>IO BEACONS</span></a>
    <nav class="iobh-nav" aria-label="Main menu">${navLinks}</nav>
    <div class="iobh-actions">
      ${inApp ? '' : `<a class="iobh-link iobh-hide-md" href="/contact/">${esc(t('talk'))}</a>`}
      ${signIn}${cta}${langSel}
    </div>
    <button type="button" class="iobh-burger" aria-expanded="false">${esc(t('menu'))}</button>
    <div class="iobh-sheet">${navLinks}${inApp ? '' : `<a href="/contact/">${esc(t('talk'))}</a>`}
      <div class="iobh-sheet-row">${signIn}${cta}${langSel}</div></div>
  </header>`;
  target.querySelectorAll('[data-act=account]').forEach((b) => b.addEventListener('click', () => { target.classList.remove('open'); account?.onClick?.(); }));
  target.querySelectorAll('[data-act=signin]').forEach((b) => b.addEventListener('click', () => { target.classList.remove('open'); onSignIn?.(); }));
  const burger = target.querySelector('.iobh-burger');
  burger.addEventListener('click', () => { const o = target.classList.toggle('open'); burger.setAttribute('aria-expanded', String(o)); burger.textContent = o ? t('close') : t('menu'); });
  target.querySelectorAll('.iobh-locale').forEach((s) => s.addEventListener('change', (e) => { store.set('iobeacons.locale', e.target.value); location.reload(); }));
  return target;
}

export function mountSiteFooter(target) {
  ensureCss();
  target.classList.add('iobf');
  target.innerHTML = `<div class="iobf-in">
    <div class="iobf-about"><div class="iobf-brand"><span class="iobh-mark" aria-hidden="true"></span>IO BEACONS</div><p>${esc(t('blurb'))}</p></div>
    ${FOOTER.map((c) => `<div><h4>${esc(t(c.title))}</h4><ul>${c.links.map(([k, p]) => `<li><a href="${p}">${esc(t(k))}</a></li>`).join('')}</ul></div>`).join('')}
  </div>
  <div class="iobf-base"><span>${esc(t('tagline'))}</span><span>© ${new Date().getFullYear()} IoBeacons · <a href="/maps/console/">Staff</a></span></div>`;
  return target;
}

// Static pages mount themselves.
if (typeof document !== 'undefined') {
  const auto = () => {
    document.querySelectorAll('[data-site-header]').forEach((el) => mountSiteHeader(el, { current: el.dataset.current }));
    document.querySelectorAll('[data-site-footer]').forEach((el) => mountSiteFooter(el));
    // Fulllobby chat widget, when one is configured on the server.
    if (document.querySelector('[data-site-header]')) {
      fetch('/maps/api/site-config').then((r) => (r.ok ? r.json() : null)).then((c) => {
        if (!c?.chatWidget || !/^https:\/\//.test(c.chatWidget) || document.getElementById('iob-chat')) return;
        const sc = document.createElement('script'); sc.id = 'iob-chat'; sc.src = c.chatWidget; sc.async = true; document.body.append(sc);
      }).catch(() => {});
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
}
