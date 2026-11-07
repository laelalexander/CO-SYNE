// IoBeacons admin console: one place for staff to look after the website and
// its customers. Served at /maps/console/. Staff accounts only.
import { get, post, patch, ApiError, BASE } from './api.js';
import { h, $, clear, toast, modal, fmtNum, fmtDate, ago, copyText, confirmBox } from './ui.js';
import { mountSiteHeader } from '../site/public/site-assets/site-header.js';

const SECTIONS = [
  ['overview', 'Overview', 'M3 13h8V3H3z M13 21h8V11h-8z M13 3v6h8V3z M3 21h8v-6H3z'],
  ['inquiries', 'Inquiries', 'M4 4h16v12H7l-3 3z M8 9h8 M8 12h5'],
  ['customers', 'Customers', 'M3 21V8l9-5 9 5v13 M9 21v-6h6v6'],
  ['people', 'People', 'M9 11a4 4 0 100-8 4 4 0 000 8z M2 21c0-4 3-6 7-6s7 2 7 6 M17 11a3 3 0 100-6 M22 21c0-3-2-5-5-5.5'],
  ['website', 'Website', 'M12 21a9 9 0 100-18 9 9 0 000 18z M3 12h18 M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z'],
  ['system', 'System', 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z'],
];
const STATUS = { new: 'New', forwarded: 'With Fulllobby', open: 'In progress', replied: 'Replied', closed: 'Closed' };
const PLANS = ['trial', 'starter', 'professional', 'business', 'enterprise'];
const SITE_PAGES = [
  ['Homepage', '/'], ['Platform', '/platform/'], ['Maps', '/platform/maps/'], ['Space', '/platform/space/'], ['Network', '/network/'],
  ['Research', '/research/'], ['Developers', '/developers/'], ['Contact', '/contact/'], ['Projects', '/featured-projects/'], ['Maps roadmap', '/maps-roadmap/'],
  ['Privacy', '/privacy/'], ['Terms', '/terms/'], ['Data governance', '/data-governance/'], ['Research ethics', '/research-ethics/'], ['Security', '/security/'],
  ['Maps app', '/maps/'], ['CO-SYNE', '/cosyne/'], ['Sitemap', '/sitemap.xml'], ['Robots', '/robots.txt'],
];

let me = null;
let badge = 0;
const ico = (d) => h('span', { class: 'c-ico', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>` });
const pill = (status) => h('span', { class: `c-pill s-${status}` }, STATUS[status] || status);
const fail = (e) => toast(e.message || String(e), 'error', 6000);
const stat = (label, value, sub, href) => h(href ? 'a' : 'div', { class: 'c-stat', href }, h('div', { class: 'c-stat-v' }, value), h('div', { class: 'c-stat-l' }, label), sub ? h('div', { class: 'c-stat-s' }, sub) : null);
const card = (title, ...kids) => h('section', { class: 'c-card' }, title ? h('h3', {}, title) : null, ...kids);
const when = (d) => (d ? h('span', { title: fmtDate(d) }, ago(d)) : h('span', { class: 'muted' }, 'never'));

function route() {
  const [section = 'overview', id] = location.hash.slice(1).split('/');
  return { section: SECTIONS.some(([k]) => k === section) ? section : 'overview', id };
}

function renderNav() {
  const { section } = route();
  clear($('#c-nav')).append(...SECTIONS.map(([k, label, d]) => h('a', { href: `#${k}`, class: 'c-nav-a', 'aria-current': k === section ? 'page' : null },
    ico(d), h('span', {}, label), k === 'inquiries' && badge ? h('span', { class: 'c-badge' }, badge) : null)));
}

async function show() {
  renderNav();
  const main = clear($('#c-main'));
  const { section, id } = route();
  main.append(h('div', { class: 'muted pad' }, 'Loading…'));
  try { await VIEWS[section](main, id); } catch (e) { clear(main).append(h('div', { class: 'c-empty' }, e.message)); }
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- overview
async function overview(main) {
  const d = await get('/console/overview');
  const c = d.counts;
  badge = c.inquiries_new; renderNav();
  clear(main).append(
    h('div', { class: 'c-head' }, h('div', {}, h('h1', {}, `Good to see you, ${me.name?.split(' ')[0] || 'there'}.`), h('p', { class: 'muted' }, 'Here is what is happening across iobeacons.com and its customers.'))),
    d.fulllobby ? null : h('div', { class: 'c-note' }, h('strong', {}, 'Fulllobby is not connected yet. '), 'Website inquiries are saved here and emailed to staff, but not sent to Fulllobby operators. ', h('a', { href: '#system' }, 'See how to connect it')),
    h('div', { class: 'c-stats' },
      stat('Open inquiries', c.inquiries_open, `${c.inquiries_new} new · ${c.inquiries_7d} this week`, '#inquiries'),
      stat('Customer workspaces', c.workspaces, `${c.workspaces_7d} new this week`, '#customers'),
      stat('Paying', c.paying, `${c.trials_ending} trials end within 7 days`, '#customers'),
      stat('People', c.users, `${c.users_7d} new · ${c.signed_in} signed in`, '#people'),
      stat('Devices', fmtNum(c.devices), `${fmtNum(c.maps)} maps`)),
    h('div', { class: 'c-grid2' },
      card('Latest inquiries', d.inquiries.length ? h('div', { class: 'c-list' }, d.inquiries.map((m) => h('a', { class: 'c-row', href: `#inquiries/${m.id}` },
        h('div', { class: 'grow' }, h('strong', {}, m.name), h('div', { class: 'muted small' }, `${m.topic || 'General'} · ${m.email}`)), pill(m.status), h('span', { class: 'muted small' }, ago(m.created_at)))))
        : h('p', { class: 'muted' }, 'No inquiries yet. They arrive from Talk to us on the website.')),
      card('Plans', h('div', { class: 'c-list' }, d.plans.length ? d.plans.map((p) => h('div', { class: 'c-row' }, h('span', { class: 'grow' }, p.plan), h('strong', {}, p.n))) : h('p', { class: 'muted' }, 'No customer workspaces yet.')))),
    card('Recent activity', d.activity.length ? h('table', { class: 'table' }, h('tbody', {}, d.activity.map((a) => h('tr', {}, h('td', {}, a.action), h('td', {}, a.org || '—'), h('td', { class: 'muted' }, a.email || ''), h('td', { class: 'muted' }, ago(a.created_at))))))
      : h('p', { class: 'muted' }, 'Nothing yet.')));
}

// ---------------------------------------------------------------- inquiries
let inqFilter = { status: '', q: '' };
async function inquiries(main, id) {
  const list = await get(`/console/inquiries?status=${inqFilter.status}&q=${encodeURIComponent(inqFilter.q)}`);
  badge = list.filter((m) => m.status === 'new').length || badge;
  renderNav();
  const sel = id ? list.find((m) => String(m.id) === id) : null;
  const search = h('input', { type: 'search', placeholder: 'Search name, email, company or text', value: inqFilter.q });
  search.addEventListener('change', () => { inqFilter.q = search.value.trim(); show(); });
  const tabs = h('div', { class: 'c-tabs' }, [['', 'All'], ...Object.entries(STATUS)].map(([k, l]) => h('button', { class: 'c-tab', 'aria-pressed': String(inqFilter.status === k), onclick: () => { inqFilter.status = k; show(); } }, l)));
  clear(main).append(
    h('div', { class: 'c-head' }, h('div', {}, h('h1', {}, 'Inquiries'), h('p', { class: 'muted' }, 'Everything sent through Talk to us on iobeacons.com. Each one is also sent to Fulllobby when it is connected.'))),
    h('div', { class: 'c-toolbar' }, tabs, search),
    h('div', { class: `c-split${sel ? ' has-detail' : ''}` },
      h('div', { class: 'c-card c-list tight' }, list.length ? list.map((m) => h('a', { class: `c-row${sel?.id === m.id ? ' sel' : ''}`, href: `#inquiries/${m.id}` },
        h('div', { class: 'grow' }, h('strong', {}, m.name), h('div', { class: 'muted small' }, `${m.topic || 'General'}${m.company ? ` · ${m.company}` : ''}`), h('div', { class: 'small clip' }, m.message)),
        h('div', { class: 'c-col-end' }, pill(m.status), h('span', { class: 'muted small' }, ago(m.created_at)))))
        : h('p', { class: 'muted pad' }, 'No inquiries match.')),
      sel ? inquiryDetail(sel) : h('div', { class: 'c-card c-hint-card' }, h('p', { class: 'muted' }, 'Pick an inquiry to read it, reply, add notes or change its status.'))));
}

function inquiryDetail(m) {
  const statusSel = h('select', {}, Object.entries(STATUS).map(([k, l]) => h('option', { value: k, selected: m.status === k }, l)));
  statusSel.addEventListener('change', async () => { try { await patch(`/console/inquiries/${m.id}`, { status: statusSel.value }); toast('Status updated.'); show(); } catch (e) { fail(e); } });
  const mine = h('button', { class: 'btn small', onclick: async () => { try { await patch(`/console/inquiries/${m.id}`, { assigned_to: m.assigned_to === me.id ? null : me.id, status: m.status === 'new' ? 'open' : undefined }); show(); } catch (e) { fail(e); } } }, m.assigned_to === me.id ? 'Unassign me' : 'Assign to me');
  const note = h('textarea', { rows: 3, placeholder: 'Add a private note for the team' });
  const reply = h('textarea', { rows: 6, placeholder: `Write a reply to ${m.name}. It is sent by email from IoBeacons.` });
  return h('div', { class: 'c-card c-detail' },
    h('div', { class: 'c-detail-head' }, h('div', {}, h('div', { class: 'eyebrow' }, m.topic || 'General'), h('h2', {}, m.name),
      h('div', { class: 'muted' }, h('a', { href: `mailto:${m.email}` }, m.email), m.company ? ` · ${m.company}` : '', ' · ', fmtDate(m.created_at))),
    h('a', { class: 'btn small', href: '#inquiries' }, 'Close')),
    h('p', { class: 'c-message' }, m.message),
    m.page ? h('p', { class: 'muted small' }, `Sent from ${m.page}`) : null,
    h('div', { class: 'c-meta' },
      h('label', {}, 'Status ', statusSel), mine,
      h('span', { class: 'muted small' }, m.assigned_name || m.assigned_email ? `Owner: ${m.assigned_name || m.assigned_email}` : 'No owner yet')),
    h('div', { class: 'c-fl' }, h('span', {}, h('strong', {}, 'Fulllobby: '), m.forwarded_at ? `sent ${ago(m.forwarded_at)}` : (m.forward_status || 'not sent')),
      h('button', { class: 'btn small', onclick: async (e) => { e.target.disabled = true; try { await post(`/console/inquiries/${m.id}/forward`, {}); toast('Sent to Fulllobby.'); show(); } catch (ex) { fail(ex); e.target.disabled = false; } } }, m.forwarded_at ? 'Send again' : 'Send to Fulllobby')),
    h('h3', {}, 'Reply'),
    reply,
    h('div', { class: 'row end' },
      h('a', { class: 'btn small', href: `mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.topic || 'your message to IoBeacons'}`)}` }, 'Open in my email'),
      h('button', { class: 'btn primary small', onclick: async (e) => {
        if (!reply.value.trim()) return toast('Write a reply first.');
        e.target.disabled = true;
        try { await post(`/console/inquiries/${m.id}/reply`, { message: reply.value }); toast('Reply sent.'); show(); } catch (ex) { fail(ex); e.target.disabled = false; }
      } }, 'Send reply')),
    h('h3', {}, 'Notes and history'),
    h('div', { class: 'c-notes' }, (m.notes || []).length ? m.notes.slice().reverse().map((n) => h('div', { class: `c-note-item${n.reply ? ' reply' : ''}` }, h('div', { class: 'muted small' }, `${n.reply ? 'Reply' : 'Note'} by ${n.by} · ${ago(n.at)}`), h('div', { class: 'pre' }, n.text))) : h('p', { class: 'muted small' }, 'No notes yet.')),
    note,
    h('div', { class: 'row end' }, h('button', { class: 'btn small', onclick: async () => { if (!note.value.trim()) return; try { await patch(`/console/inquiries/${m.id}`, { note: note.value }); show(); } catch (e) { fail(e); } } }, 'Add note')));
}

// ---------------------------------------------------------------- customers
let custQ = '';
async function customers(main, id) {
  if (id) return customer(main, id);
  const rows = await get(`/console/customers?q=${encodeURIComponent(custQ)}`);
  const search = h('input', { type: 'search', placeholder: 'Search workspace or member email', value: custQ });
  search.addEventListener('change', () => { custQ = search.value.trim(); show(); });
  clear(main).append(
    h('div', { class: 'c-head' }, h('div', {}, h('h1', {}, 'Customers'), h('p', { class: 'muted' }, 'Every IoBeacons Maps workspace, its plan and how it is used.'))),
    h('div', { class: 'c-toolbar' }, search),
    h('div', { class: 'c-card c-scroll' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Workspace', 'Owner', 'Plan', 'Members', 'Maps', 'Devices', 'Last active', 'Since'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((o) => h('tr', { class: 'c-click', onclick: () => { location.hash = `#customers/${o.id}`; } },
        h('td', {}, h('strong', {}, o.name), o.is_demo ? h('span', { class: 'tag' }, 'demo') : null),
        h('td', { class: 'muted' }, o.owner_email || '—'),
        h('td', {}, o.effective, o.plan === 'trial' && o.trial_ends_at ? h('div', { class: 'muted small' }, `ends ${fmtDate(o.trial_ends_at)}`) : null),
        h('td', {}, o.members), h('td', {}, o.maps), h('td', {}, o.devices), h('td', {}, when(o.last_active)), h('td', { class: 'muted' }, fmtDate(o.created_at))))))));
}

async function customer(main, id) {
  const d = await get(`/console/customers/${id}`);
  const o = d.org;
  const planSel = h('select', {}, PLANS.map((p) => h('option', { value: p, selected: o.plan === p }, p)));
  const u = d.usage; const L = d.plan.limits || {};
  const lim = (v, max) => (max === null || max === undefined || max === Infinity || max > 1e12 ? fmtNum(v) : `${fmtNum(v)} / ${fmtNum(max)}`);
  clear(main).append(
    h('a', { class: 'c-back', href: '#customers' }, '← All customers'),
    h('div', { class: 'c-head' }, h('div', {}, h('h1', {}, o.name, o.is_demo ? h('span', { class: 'tag' }, 'demo') : null),
      h('p', { class: 'muted' }, `${d.plan.name || o.effective} · since ${fmtDate(o.created_at)}${o.custom_domain ? ` · ${o.custom_domain}` : ''}`))),
    h('div', { class: 'c-stats' },
      stat('Members', lim(u.users, L.users)), stat('Maps', lim(u.maps, L.maps)), stat('Shapes', lim(u.features, L.features)),
      stat('Devices', lim(u.devices, L.devices)), stat('Map views this month', lim(u.mapViews, L.mapViews)), stat('API calls this month', lim(u.apiCalls, L.apiCalls))),
    h('div', { class: 'c-grid2' },
      card('Plan',
        h('div', { class: 'c-meta' }, h('label', {}, 'Plan ', planSel),
          h('button', { class: 'btn small primary', onclick: async () => { try { await patch(`/console/customers/${o.id}`, { plan: planSel.value }); toast('Plan changed.'); show(); } catch (e) { fail(e); } } }, 'Save plan')),
        o.plan === 'trial' ? h('p', {}, `Trial ends ${o.trial_ends_at ? fmtDate(o.trial_ends_at) : '—'}. `,
          h('button', { class: 'btn small', onclick: async () => { try { await patch(`/console/customers/${o.id}`, { extend_trial_days: 7 }); toast('Trial extended by 7 days.'); show(); } catch (e) { fail(e); } } }, 'Extend 7 days')) : null,
        h('p', { class: 'muted small' }, o.subscription_status ? `Stripe subscription: ${o.subscription_status}` : 'No Stripe subscription.')),
      card('Members', h('div', { class: 'c-list' }, d.members.map((m) => h('div', { class: 'c-row' },
        h('div', { class: 'grow' }, h('strong', {}, m.name || m.email), h('div', { class: 'muted small' }, m.email)),
        h('span', { class: 'tag' }, m.role), h('span', { class: 'muted small' }, m.last_sign_in ? `signed in ${ago(m.last_sign_in)}` : 'never signed in')))))),
    h('div', { class: 'c-grid2' },
      card('Maps', d.maps.length ? h('div', { class: 'c-list' }, d.maps.map((m) => h('div', { class: 'c-row' }, h('span', { class: 'grow' }, m.name), h('span', { class: 'muted small' }, m.updated_at ? ago(m.updated_at) : '')))) : h('p', { class: 'muted' }, 'No maps.')),
      card('Activity', d.activity.length ? h('table', { class: 'table' }, h('tbody', {}, d.activity.map((a) => h('tr', {}, h('td', {}, a.action), h('td', { class: 'muted' }, a.email || ''), h('td', { class: 'muted' }, ago(a.created_at)))))) : h('p', { class: 'muted' }, 'No activity yet.'))));
}

// ---------------------------------------------------------------- people
let peopleQ = '';
async function people(main) {
  const rows = await get(`/console/users?q=${encodeURIComponent(peopleQ)}`);
  const search = h('input', { type: 'search', placeholder: 'Search name or email', value: peopleQ });
  search.addEventListener('change', () => { peopleQ = search.value.trim(); show(); });
  clear(main).append(
    h('div', { class: 'c-head' }, h('div', {}, h('h1', {}, 'People'), h('p', { class: 'muted' }, 'Everyone with an IoBeacons account. Help someone who is locked out with a reset link.'))),
    h('div', { class: 'c-toolbar' }, search),
    h('div', { class: 'c-card c-scroll' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Person', 'Workspaces', 'Last sign-in', 'Joined', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((u) => h('tr', {},
        h('td', {}, h('strong', {}, u.name || '—'), u.is_staff ? h('span', { class: 'tag' }, 'staff') : null, h('div', { class: 'muted small' }, u.email)),
        h('td', {}, u.orgs.length ? u.orgs.map((o) => h('a', { class: 'c-chip', href: `#customers/${o.id}` }, `${o.name} · ${o.role}`)) : h('span', { class: 'muted' }, 'none')),
        h('td', {}, when(u.last_sign_in)), h('td', { class: 'muted' }, fmtDate(u.created_at)),
        h('td', { class: 'c-actions' },
          h('button', { class: 'btn small', onclick: () => resetLink(u) }, 'Reset link'),
          h('button', { class: 'btn small', onclick: async () => { if (!await confirmBox(`Sign ${u.email} out on every device?`, { ok: 'Sign out' })) return; try { const r = await post(`/console/users/${u.id}/sign-out`, {}); toast(`Ended ${r.ended} session(s).`); } catch (e) { fail(e); } } }, 'Sign out'))))))));
}

async function resetLink(u) {
  try {
    const r = await post(`/console/users/${u.id}/reset-link`, {});
    modal('Password reset link', h('div', { class: 'stack' },
      h('p', {}, r.emailed ? `We emailed this link to ${u.email}. You can also pass it on yourself.` : `Email isn't set up yet, so send this link to ${u.email} yourself (by chat or text).`),
      h('div', { class: 'copy-row' }, h('textarea', { readonly: true, rows: 3 }, r.link), h('button', { class: 'btn small', onclick: () => copyText(r.link) }, 'Copy')),
      h('p', { class: 'muted small' }, 'It works once, for one hour.')));
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- website
async function website(main) {
  const rows = SITE_PAGES.map(([name, path]) => {
    const cell = h('td', {}, h('span', { class: 'muted' }, 'checking…'));
    fetch(path, { method: 'GET', cache: 'no-store', redirect: 'follow' }).then(async (r) => {
      const text = r.ok && /\/$/.test(path) && path !== '/maps/' ? await r.text() : '';
      const notFound = path !== '/' && /id="lost"/.test(text) && !/data-page="(?!home)/.test(text);
      clear(cell).append(r.ok && !notFound ? h('span', { class: 'c-ok' }, `● ${r.status}`) : h('span', { class: 'c-bad' }, `● ${notFound ? 'not found' : r.status}`));
    }).catch(() => clear(cell).append(h('span', { class: 'c-bad' }, '● unreachable')));
    return h('tr', {}, h('td', {}, h('strong', {}, name)), h('td', { class: 'muted' }, path), cell, h('td', {}, h('a', { class: 'btn small', href: path, target: '_blank', rel: 'noopener' }, 'Open')));
  });
  const cfg = await get('/site-config').catch(() => ({}));
  clear(main).append(
    h('div', { class: 'c-head' }, h('div', {}, h('h1', {}, 'Website'), h('p', { class: 'muted' }, 'Every public page on iobeacons.com and whether it answers right now.'))),
    h('div', { class: 'c-grid2' },
      card('Talk to us', h('p', {}, 'The Contact page form saves each message here under Inquiries and sends it to Fulllobby when connected.'), h('a', { class: 'btn small', href: '#inquiries' }, 'Open inquiries')),
      card('Chat widget', h('p', {}, cfg.chatWidget ? 'The Fulllobby chat widget is switched on for the website.' : 'No chat widget yet. Add FULLLOBBY_WIDGET_SRC on the server to show the Fulllobby chat on every page.'))),
    h('div', { class: 'c-card c-scroll' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ['Page', 'Address', 'Status', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))));
}

// ---------------------------------------------------------------- system
async function system(main) {
  const d = await get('/console/system');
  const s = d.server;
  clear(main).append(
    h('div', { class: 'c-head' }, h('div', {}, h('h1', {}, 'System'), h('p', { class: 'muted' }, 'Connected services and the health of the Maps server.'))),
    card('Connected services', h('table', { class: 'table' }, h('tbody', {}, d.services.map((x) => h('tr', {},
      h('td', {}, h('strong', {}, x.name)), h('td', {}, x.ready ? h('span', { class: 'c-ok' }, '● Connected') : h('span', { class: 'c-warn' }, '● Not set up')), h('td', { class: 'muted small' }, x.hint)))))),
    card('Connect Fulllobby',
      h('p', {}, 'Add these lines to ', h('code', {}, '/etc/iobeacons-maps/iobeacons-maps.env'), ' on the server, then run ', h('code', {}, 'systemctl restart iobeacons-maps'), '.'),
      h('pre', {}, 'FULLLOBBY_INQUIRY_URL=https://…   # where Fulllobby accepts new inquiries\nFULLLOBBY_API_KEY=…               # sent as a bearer token and used to sign each inquiry\nFULLLOBBY_WIDGET_SRC=https://…    # optional: Fulllobby chat widget script for the website'),
      h('p', { class: 'muted small' }, 'Each inquiry is sent as JSON: id, name, email, company, topic, message, page, created_at and a link back to this console. The X-IoBeacons-Signature header is an HMAC-SHA256 of the body using the API key.')),
    card('Server', h('div', { class: 'c-stats small' },
      stat('Up for', s.uptimeMin > 120 ? `${Math.round(s.uptimeMin / 60)} h` : `${s.uptimeMin} min`), stat('App memory', `${s.memoryMb} MB`),
      stat('Server memory free', `${fmtNum(s.freeMemMb)} / ${fmtNum(s.totalMemMb)} MB`), stat('Load', s.load.join(' · ')),
      stat('Database', `${s.dbSizeMb} MB`, s.postgres), stat('Node', s.node, `${s.staffEmails} staff email(s)`))));
}

const VIEWS = { overview, inquiries, customers, people, website, system };

// ---------------------------------------------------------------- start
async function start() {
  mountSiteHeader($('#site-header'), { flush: true, inApp: true, account: null, onSignIn: () => { location.href = `${BASE}/#signin`; } });
  let session;
  try { session = await get('/session'); } catch (e) { session = null; }
  me = session?.user;
  if (me) mountSiteHeader($('#site-header'), { flush: true, inApp: true, account: { label: me.name?.split(' ')[0] || 'Account', onClick: () => { location.href = `${BASE}/#settings=workspace`; } } });
  if (!me || !me.is_staff) {
    clear($('#c-app')).append(h('div', { class: 'c-gate' }, h('div', { class: 'c-card' },
      h('div', { class: 'eyebrow' }, 'IoBeacons admin console'),
      h('h1', {}, me ? 'This console is for IoBeacons staff.' : 'Sign in to continue.'),
      h('p', { class: 'muted' }, me ? `You are signed in as ${me.email}, which is not a staff account. Staff accounts are set by STAFF_EMAILS on the server.` : 'Use your IoBeacons staff account. You will come straight back here after signing in.'),
      h('div', { class: 'row' }, me ? h('a', { class: 'btn', href: `${BASE}/` }, 'Go to Maps') : h('a', { class: 'btn primary', href: `${BASE}/#signin=console` }, 'Sign in')))));
    return;
  }
  window.addEventListener('hashchange', show);
  show();
}
window.addEventListener('unhandledrejection', (ev) => { if (ev.reason instanceof ApiError) { ev.preventDefault(); fail(ev.reason); } });
start();
