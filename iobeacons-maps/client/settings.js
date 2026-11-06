import { get, post, patch, del, ApiError, BASE } from './api.js';
import { h, clear, toast, modal, closeModal, confirmBox, field, fmtNum, fmtDate, ago, copyText } from './ui.js';
import { state, isOwner } from './state.js';

// Sign in, sign up, workspace settings, sharing and the upgrade prompt.
const err = (e) => toast(e.message || String(e), 'error', 6000);

// ---------- sign in / sign up (full screen) ----------
let authEl = null;
function closeAuth() { authEl?.remove(); authEl = null; document.removeEventListener('keydown', authKey); }
function authKey(e) { if (e.key === 'Escape' && state.session?.org) closeAuth(); }

function pwField(label, { autocomplete, minlength, hint } = {}) {
  const input = h('input', { type: 'password', required: true, autocomplete, minlength, maxlength: 200 });
  const toggle = h('button', { type: 'button', class: 'pw-toggle', 'aria-label': 'Show password', onclick: () => {
    const show = input.type === 'password'; input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show'; toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); input.focus();
  } }, 'Show');
  const caps = h('span', { class: 'hint caps', hidden: true }, 'Caps Lock is on.');
  input.addEventListener('keyup', (e) => { caps.hidden = !e.getModifierState?.('CapsLock'); });
  const wrap = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('div', { class: 'pw-wrap' }, input, toggle), caps, hint ? h('span', { class: 'hint' }, hint) : null);
  return { wrap, input };
}

function authShell(card) {
  closeAuth();
  const s = state.session;
  const canClose = Boolean(s?.org);
  authEl = h('div', { class: 'auth-screen', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in' },
    h('div', { class: 'auth-art' },
      h('div', { class: 'auth-brand' }, h('span', { class: 'brand-dot' }), h('span', {}, s?.brand?.name || 'IoBeacons Maps')),
      h('h1', {}, 'Maps, live data and alerts for every site you run.'),
      h('ul', { class: 'auth-points' },
        h('li', {}, 'Build maps from your own files, then style and share them'),
        h('li', {}, 'Live weather, radar, flood, wildfire and census layers'),
        h('li', {}, 'Track vehicles and devices with zone, speed and offline alerts'),
        h('li', {}, 'One-click site reports with a PDF')),
      h('p', { class: 'auth-foot' }, 'Part of ', h('a', { href: 'https://iobeacons.com/' }, 'IoBeacons'), '. 14 days free, no card needed.')),
    h('div', { class: 'auth-main' },
      canClose ? h('button', { class: 'icon-btn auth-close', 'aria-label': 'Close', onclick: closeAuth }, '✕') : null,
      h('div', { class: 'auth-card' }, card),
      s?.app?.demoEnabled && !s?.demo ? h('p', { class: 'small muted center' }, 'Just looking? ', h('a', { href: `${BASE}/`, onclick: async (e) => { e.preventDefault(); await post('/logout', {}).catch(() => {}); location.hash = ''; location.reload(); } }, 'Open the live demo')) : null,
      s?.demo ? h('p', { class: 'small muted center' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); closeAuth(); } }, 'Keep exploring the demo')) : null));
  document.body.append(authEl);
  document.addEventListener('keydown', authKey);
  setTimeout(() => authEl?.querySelector('input:not([type=hidden])')?.focus(), 40);
}

export function openAuth(tab = 'login', msg = '', { inviteToken, email: presetEmail } = {}) {
  const card = h('div', { class: 'stack' });
  const draw = (which) => {
    if (which === 'forgot') return drawForgot();
    const signup = which === 'signup';
    const email = h('input', { type: 'email', required: true, autocomplete: 'email', value: presetEmail || '', maxlength: 200 });
    const pw = pwField('Password', { autocomplete: signup ? 'new-password' : 'current-password', minlength: signup ? 10 : 1, hint: signup ? 'At least 10 characters. A short phrase works well.' : null });
    const name = h('input', { required: true, maxlength: 100, autocomplete: 'name' });
    const org = h('input', { maxlength: 100, placeholder: 'Acme Utilities', autocomplete: 'organization' });
    const status = h('p', { class: 'form-error', role: 'alert' });
    const submit = h('button', { class: 'btn primary wide big', type: 'submit' }, signup ? (inviteToken ? 'Create account and join' : 'Start my free trial') : 'Sign in');
    const form = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); status.textContent = ''; submit.disabled = true; submit.classList.add('busy');
      try {
        if (signup) await post('/signup', { name: name.value, email: email.value, password: pw.input.value, orgName: org.value || undefined, inviteToken });
        else await post('/login', { email: email.value, password: pw.input.value });
        if (inviteToken) { await post(`/invitations/${inviteToken}/accept`, {}); }
        let next = null; try { next = sessionStorage.getItem('iob.next'); sessionStorage.removeItem('iob.next'); } catch { /* ignore */ }
        if (next && next.startsWith(`${BASE}/console`)) { location.href = next; return; }
        history.replaceState(null, '', `${BASE}/`); location.reload();
      } catch (ex) {
        status.textContent = ex.status === 429 ? 'Too many tries. Wait a few minutes and try again.' : ex.message;
        submit.disabled = false; submit.classList.remove('busy');
        if (ex.status === 409) { presetEmail = email.value; setTimeout(() => draw('login'), 1200); }
      }
    } },
    signup ? field('Your name', name) : null,
    field('Work email', email),
    pw.wrap,
    !signup ? h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn link small', onclick: () => { presetEmail = email.value; draw('forgot'); } }, 'Forgot password?')) : null,
    signup && !inviteToken ? field('Company or team (optional)', org) : null,
    status, submit,
    signup ? h('p', { class: 'hint center' }, 'By creating an account you agree to use it lawfully and keep your password private.') : null);
    clear(card).append(
      h('h2', {}, signup ? (inviteToken ? 'Join your team' : 'Create your workspace') : 'Welcome back'),
      msg ? h('p', { class: 'notice' }, msg) : null,
      h('div', { class: 'tabs', role: 'tablist' },
        h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(!signup), onclick: () => draw('login') }, 'Sign in'),
        h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(signup), onclick: () => draw('signup') }, 'Create account')),
      form);
    setTimeout(() => form.querySelector('input')?.focus(), 30);
  };
  const drawForgot = () => {
    const email = h('input', { type: 'email', required: true, autocomplete: 'email', value: presetEmail || '' });
    const status = h('p', { class: 'form-error', role: 'alert' });
    const submit = h('button', { class: 'btn primary wide big', type: 'submit' }, 'Email me a reset link');
    clear(card).append(h('h2', {}, 'Reset your password'), h('p', { class: 'small muted' }, "Enter your account email and we'll send a link to choose a new password."),
      h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault(); submit.disabled = true; status.textContent = '';
        try {
          const out = await post('/password/forgot', { email: email.value });
          clear(card).append(h('h2', {}, 'Check your email'),
            out.emailReady ? h('p', {}, `If ${email.value} has an account, a reset link is on its way. It works for one hour.`)
              : h('p', { class: 'notice' }, "Email isn't switched on for this server yet, so we can't send the link. Contact IoBeacons support and we'll reset it for you."),
            h('button', { class: 'btn wide', onclick: () => draw('login') }, 'Back to sign in'));
        } catch (ex) { status.textContent = ex.message; submit.disabled = false; }
      } }, field('Email', email), status, submit),
      h('button', { class: 'btn link small', onclick: () => draw('login') }, '← Back to sign in'));
  };
  authShell(card);
  draw(tab);
}

export async function openReset(tokenStr) {
  const card = h('div', { class: 'stack' });
  authShell(card);
  let info;
  try { info = await get(`/password/reset/${encodeURIComponent(tokenStr)}`); } catch (e) {
    clear(card).append(h('h2', {}, 'Link expired'), h('p', {}, e.message), h('button', { class: 'btn primary wide', onclick: () => openAuth('forgot') }, 'Send a new link'));
    return;
  }
  const pw = pwField('New password', { autocomplete: 'new-password', minlength: 10, hint: 'At least 10 characters.' });
  const pw2 = pwField('Type it again', { autocomplete: 'new-password', minlength: 10 });
  const status = h('p', { class: 'form-error', role: 'alert' });
  clear(card).append(h('h2', {}, 'Choose a new password'), h('p', { class: 'small muted' }, `For ${info.email}. You'll be signed out on other devices.`),
    h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); status.textContent = '';
      if (pw.input.value !== pw2.input.value) { status.textContent = "The two passwords don't match."; return; }
      try { await post('/password/reset', { token: tokenStr, password: pw.input.value }); history.replaceState(null, '', `${BASE}/`); location.reload(); } catch (ex) { status.textContent = ex.message; }
    } }, pw.wrap, pw2.wrap, status, h('button', { class: 'btn primary wide big', type: 'submit' }, 'Save and sign in')));
}

export async function acceptInvite(tokenStr) {
  let inv;
  try { inv = await get(`/invitations/${encodeURIComponent(tokenStr)}`); } catch (e) {
    modal('Invitation', h('p', {}, e.message)); return;
  }
  const s = state.session;
  if (s.user) {
    modal(`Join ${inv.org_name}`, h('div', { class: 'stack' },
      h('p', {}, `You were invited to "${inv.org_name}" as ${inv.role}. You're signed in as ${s.user.email}.`),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: async () => {
        try { await post(`/invitations/${tokenStr}/accept`, {}); history.replaceState(null, '', `${BASE}/`); location.reload(); } catch (e) { err(e); }
      } }, 'Join workspace'))));
    return;
  }
  openAuth('signup', `You were invited to "${inv.org_name}" as ${inv.role}. Create an account or sign in to join.`, { inviteToken: tokenStr, email: inv.email });
}

// ---------- upgrade prompt ----------
export function showUpgrade(msg = 'This needs a higher plan.') {
  const s = state.session;
  const body = h('div', { class: 'stack' }, h('p', { class: 'notice' }, msg), plansGrid());
  if (s?.demo) body.append(h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => openAuth('signup') }, 'Start a 14-day free trial')));
  else if (isOwner()) body.append(h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => openSettings('billing') }, 'Change plan')));
  else body.append(h('p', { class: 'small muted' }, 'Ask a workspace owner to change the plan.'));
  modal('Upgrade', body, { wide: true });
}

const FEATURE_LABELS = [
  ['draw', 'Drawing, measuring and uploads'], ['share', 'Share links'], ['export', 'Export GeoJSON, CSV, KML'], ['terrain3d', '3D terrain and buildings'],
  ['catalog', 'Premium data: flood, wildfire, census, infrastructure', (v) => v === 'premium'], ['customStyles', 'Heatmaps, categories, 3D extrusion'],
  ['geofences', 'Alert zones'], ['alerts', 'Alert rules'], ['sms', 'Text message alerts'], ['embeds', 'Embed maps on your site'], ['api', 'REST API and device ingest'],
  ['whiteLabel', 'Your brand and custom domain'],
];
function plansGrid({ onChoose, current } = {}) {
  const plans = state.session?.app?.plans || [];
  return h('div', { class: 'plans' }, plans.map((p) => h('div', { class: `plan-card${current === p.key ? ' current' : ''}${p.key === 'professional' ? ' featured' : ''}` },
    p.key === 'professional' ? h('span', { class: 'tag' }, 'Most popular') : null,
    h('h3', {}, p.name), h('div', { class: 'price' }, p.price),
    h('ul', { class: 'limits' },
      h('li', {}, `${fmtNum(p.limits.users)} users`), h('li', {}, `${fmtNum(p.limits.maps)} maps`), h('li', {}, `${fmtNum(p.limits.features)} shapes`),
      h('li', {}, `${fmtNum(p.limits.mapViews)} map views a month`), h('li', {}, `${fmtNum(p.limits.reports)} site reports a month`),
      p.limits.devices ? h('li', {}, `${fmtNum(p.limits.devices)} tracked devices`) : null),
    h('ul', { class: 'feats' }, FEATURE_LABELS.map(([k, label, test]) => {
      const on = test ? test(p.features[k]) : Boolean(p.features[k]);
      return h('li', { class: on ? 'yes' : 'no' }, label);
    })),
    onChoose ? (current === p.key ? h('span', { class: 'muted small' }, 'Current plan') : h('button', { class: `btn ${p.key === 'professional' ? 'primary' : ''} wide`, onclick: () => onChoose(p.key) }, `Choose ${p.name}`)) : null)),
  h('div', { class: 'plan-card enterprise' }, h('h3', {}, 'Enterprise'), h('div', { class: 'price' }, 'Custom'),
    h('p', { class: 'small' }, 'Unlimited users and data, single sign-on, private hosting, custom data feeds and an SLA.'),
    h('a', { class: 'btn wide', href: 'https://iobeacons.com/contact/', target: '_blank', rel: 'noopener' }, 'Talk to IoBeacons')));
}

// ---------- share ----------
export function openShare() {
  const rec = state.mapRec;
  const body = h('div', { class: 'stack' });
  const draw = () => {
    const vis = h('div', { class: 'radio-list' }, [
      ['private', 'Only me', 'Other workspace members cannot see it.'],
      ['team', 'Workspace', 'Everyone in your workspace can open it.'],
      ['link', 'Anyone with the link', 'View only. No sign-in needed.'],
    ].map(([k, label, hint]) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'vis', value: k, checked: rec.visibility === k || (k === 'link' && rec.visibility === 'public'), onchange: async () => {
        try {
          const out = await patch(`/maps/${rec.id}`, { visibility: k });
          Object.assign(rec, { visibility: out.visibility, links: out.links }); draw();
        } catch (e) {
          if (e instanceof ApiError && e.status === 402) { closeModal(); showUpgrade(e.message); } else err(e);
        }
      } }),
      h('span', {}, h('strong', {}, label), h('span', { class: 'hint' }, hint)))));
    clear(body).append(vis);
    if (rec.links) {
      const embedsOk = state.session?.plan?.features?.embeds;
      body.append(
        field('View link', h('div', { class: 'copy-row' }, h('input', { readonly: true, value: rec.links.view }), h('button', { class: 'btn small', onclick: () => copyText(rec.links.view) }, 'Copy'))),
        embedsOk ? field('Embed on your website', h('div', { class: 'copy-row' }, h('textarea', { readonly: true, rows: 3 }, rec.links.iframe), h('button', { class: 'btn small', onclick: () => copyText(rec.links.iframe) }, 'Copy')))
          : h('p', { class: 'small' }, 'Embedding maps on your own site comes with the Professional plan.'),
        h('div', { class: 'row between' },
          h('a', { class: 'btn small', href: rec.links.view, target: '_blank', rel: 'noopener' }, 'Open as a visitor'),
          h('button', { class: 'btn small', onclick: async () => {
            if (!await confirmBox('Make a new link? The old link and embeds stop working.', { ok: 'Make new link' })) { openShare(); return; }
            try { const out = await post(`/maps/${rec.id}/share/reset`, {}); rec.links = out.links; openShare(); toast('New link made.'); } catch (e) { err(e); }
          } }, 'Reset link')));
    }
  };
  draw();
  modal(`Share "${rec.name}"`, body);
}

// ---------- settings ----------
const SECTIONS = [
  ['workspace', 'Workspace'], ['team', 'Team'], ['billing', 'Plan and billing'], ['usage', 'Usage'],
  ['keys', 'API keys'], ['branding', 'Branding'], ['activity', 'Activity'], ['staff', 'IoBeacons staff'],
];
export async function openSettings(sectionKey = 'workspace') {
  const s = state.session;
  if (!s.user) { openAuth('login'); return; }
  const owner = isOwner();
  const visible = SECTIONS.filter(([k]) => (k === 'staff' ? s.user.is_staff : owner || ['workspace', 'usage'].includes(k)));
  if (!visible.some(([k]) => k === sectionKey)) sectionKey = 'workspace';
  const nav = h('nav', { class: 'set-nav' });
  const pane = h('div', { class: 'set-pane' });
  const go = async (key) => {
    for (const b of nav.children) b.setAttribute('aria-current', String(b.dataset.key === key));
    clear(pane).append(h('p', { class: 'muted' }, 'Loading...'));
    try { await RENDER[key](pane); } catch (e) { clear(pane).append(h('p', { class: 'form-error' }, e.message)); }
  };
  nav.append(...visible.map(([k, label]) => h('button', { class: 'set-link', 'data-key': k, onclick: () => go(k) }, label)));
  modal('Settings', h('div', { class: 'settings' }, nav, pane), { wide: true, onClose: () => { if (location.hash.includes('settings=')) history.replaceState(null, '', `#map=${state.mapRec?.id || ''}`); } });
  go(sectionKey);
  if (location.hash.includes('checkout=done')) toast('Thanks. Your plan updates as soon as the payment clears.');
}

const RENDER = {
  async workspace(pane) {
    const s = state.session;
    const info = await get('/org');
    const name = h('input', { value: info.org.name, maxlength: 100, disabled: !isOwner() });
    clear(pane).append(
      h('h3', {}, 'Workspace'),
      isOwner() ? h('form', { class: 'stack', onsubmit: async (e) => { e.preventDefault(); try { await patch('/org', { name: name.value }); toast('Saved.'); } catch (ex) { err(ex); } } },
        field('Workspace name', name), h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'))) : field('Workspace name', name),
      h('p', { class: 'small' }, `Plan: ${info.effectivePlan.name}. Your role: ${s.role}.`),
      h('h3', {}, 'Your account'),
      h('p', {}, `${s.user.name} · ${s.user.email}`),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: async () => {
          const input = h('input', { required: true, maxlength: 100, placeholder: 'New workspace name' });
          const m = modal('New workspace', h('form', { class: 'stack', onsubmit: async (e) => {
            e.preventDefault();
            try { await post('/orgs', { name: input.value }); m.close(); location.hash = ''; location.reload(); } catch (ex) { err(ex); }
          } }, field('Name', input), h('p', { class: 'hint' }, 'A new workspace starts its own 14-day trial.'), h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Create'))));
        } }, 'New workspace'),
        h('button', { class: 'btn', onclick: changePassword }, 'Change password'),
        h('button', { class: 'btn', onclick: async () => { await post('/logout', {}); location.hash = ''; location.reload(); } }, 'Sign out')));
  },

  async team(pane) {
    const info = await get('/org');
    const me = state.session.user.id;
    const email = h('input', { type: 'email', required: true, placeholder: 'name@company.com' });
    const role = h('select', {}, ['editor', 'viewer', 'owner'].map((r) => h('option', { value: r }, r)));
    clear(pane).append(
      h('h3', {}, 'Team'),
      h('p', { class: 'small muted' }, 'Owners manage billing and members. Editors build maps, sites and alerts. Viewers look only.'),
      h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}, ''))),
        h('tbody', {}, info.members.map((m) => h('tr', {},
          h('td', {}, m.name), h('td', {}, m.email),
          h('td', {}, h('select', { 'aria-label': `Role for ${m.name}`, onchange: async (e) => { try { await patch(`/org/members/${m.id}`, { role: e.target.value }); toast('Role updated.'); } catch (ex) { err(ex); RENDER.team(pane); } } },
            ['owner', 'editor', 'viewer'].map((r) => h('option', { value: r, selected: m.role === r }, r)))),
          h('td', {}, m.id === me ? h('span', { class: 'muted small' }, 'You') : h('button', { class: 'btn small danger', onclick: async () => {
            if (!await confirmBox(`Remove ${m.name} from the workspace?`)) { openSettings('team'); return; }
            try { await del(`/org/members/${m.id}`); openSettings('team'); } catch (ex) { err(ex); }
          } }, 'Remove')))))),
      h('h4', {}, 'Invite someone'),
      h('form', { class: 'row wrap', onsubmit: async (e) => {
        e.preventDefault();
        try {
          const out = await post('/org/invitations', { email: email.value, role: role.value });
          email.value = '';
          toast(out.emailed ? 'Invitation sent.' : 'Invitation made. Email is not set up, so copy the link and send it yourself.', out.emailed ? 'info' : 'warn', 8000);
          await RENDER.team(pane);
          pane.append(field('Invitation link', h('div', { class: 'copy-row' }, h('input', { readonly: true, value: out.link }), h('button', { class: 'btn small', onclick: () => copyText(out.link) }, 'Copy'))));
        } catch (ex) { if (ex.status === 402) showUpgrade(ex.message); else err(ex); }
      } }, email, role, h('button', { class: 'btn primary', type: 'submit' }, 'Invite')),
      info.invitations.length ? h('div', { class: 'stack' }, h('h4', {}, 'Waiting to join'), info.invitations.map((i) => h('div', { class: 'row between' },
        h('span', {}, `${i.email} (${i.role}), expires ${fmtDate(i.expires_at)}`),
        h('button', { class: 'btn small', onclick: async () => { try { await del(`/org/invitations/${i.id}`); RENDER.team(pane); } catch (ex) { err(ex); } } }, 'Cancel')))) : null);
  },

  async billing(pane) {
    const info = await get('/org');
    const s = state.session;
    const o = info.org;
    const status = o.plan === 'trial'
      ? (new Date(o.trial_ends_at) > new Date() ? `Professional trial, ends ${fmtDate(o.trial_ends_at)}.` : 'Your trial has ended. Choose a plan to keep editing.')
      : `${info.effectivePlan.name}${o.subscription_status ? ` (${o.subscription_status.replace('_', ' ')})` : ''}.`;
    const choose = async (plan) => {
      if (!s.app.billingReady) { toast("Online billing isn't switched on yet. Contact IoBeacons to change plans.", 'warn', 7000); return; }
      try { const { url } = await post('/billing/checkout', { plan }); location.href = url; } catch (e) { err(e); }
    };
    clear(pane).append(
      h('h3', {}, 'Plan and billing'),
      h('p', {}, status),
      s.app.billingReady && o.subscription_status ? h('button', { class: 'btn', onclick: async () => { try { const { url } = await post('/billing/portal', {}); location.href = url; } catch (e) { err(e); } } }, 'Manage payment and invoices') : null,
      !s.app.billingReady ? h('p', { class: 'notice' }, 'Online payment is not switched on yet. To change plans, contact IoBeacons.') : null,
      plansGrid({ onChoose: choose, current: ['starter', 'professional', 'business'].includes(o.plan) && o.subscription_status === 'active' ? o.plan : null }));
  },

  async usage(pane) {
    const [u, info] = await Promise.all([get('/usage'), get('/org')]);
    const lim = info.effectivePlan.limits;
    const row = (label, used, max) => {
      const pct = max === null ? 0 : max === 0 ? 100 : Math.min(100, (100 * used) / max);
      return h('div', { class: 'meter' },
        h('div', { class: 'row between' }, h('span', {}, label), h('span', { class: 'mono small' }, `${fmtNum(used)} / ${max === null ? 'unlimited' : fmtNum(max)}`)),
        h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` }, class: pct >= 90 ? 'hot' : '' })));
    };
    clear(pane).append(
      h('h3', {}, `Usage for ${u.period}`),
      h('p', { class: 'small muted' }, `Plan: ${info.effectivePlan.name}. Monthly counts reset on the 1st.`),
      row('Map views this month', u.mapViews, lim.mapViews), row('Site reports this month', u.reports, lim.reports), row('API calls this month', u.apiCalls, lim.apiCalls),
      row('Members', u.users, lim.users), row('Maps', u.maps, lim.maps), row('Shapes stored', u.features, lim.features),
      row('Devices', u.devices, lim.devices), row('Alert zones', u.zones, lim.zones), row('Alert rules', u.rules, lim.rules),
      h('p', { class: 'small' }, `Sites: ${fmtNum(u.sites)}`));
  },

  async keys(pane) {
    const keys = await get('/org/keys');
    const name = h('input', { maxlength: 80, placeholder: 'Fleet gateway' });
    const apiBase = `${location.origin}${BASE}/api/v1`;
    clear(pane).append(
      h('h3', {}, 'API keys'),
      h('p', { class: 'small' }, `Use a key as "Authorization: Bearer <key>" against ${apiBase}. The API has the same endpoints as the app: maps, layers, features, sites, zones, devices, positions, rules, alerts and reports.`),
      !state.session.plan.features.api ? h('p', { class: 'notice' }, 'The API comes with the Professional plan.') : h('form', { class: 'row wrap', onsubmit: async (e) => {
        e.preventDefault();
        try {
          const k = await post('/org/keys', { name: name.value });
          await RENDER.keys(pane);
          pane.prepend(h('div', { class: 'notice stack' }, h('strong', {}, 'Copy this key now. It is shown only once.'),
            h('div', { class: 'copy-row' }, h('input', { readonly: true, value: k.secret, class: 'mono' }), h('button', { class: 'btn small', onclick: () => copyText(k.secret) }, 'Copy'))));
        } catch (ex) { if (ex.status === 402) showUpgrade(ex.message); else err(ex); }
      } }, name, h('button', { class: 'btn primary', type: 'submit' }, 'Create key')),
      keys.length ? h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Key'), h('th', {}, 'Last used'), h('th', {}, ''))),
        h('tbody', {}, keys.map((k) => h('tr', { class: k.revoked_at ? 'off' : '' }, h('td', {}, k.name), h('td', { class: 'mono' }, `${k.prefix}...`), h('td', {}, k.revoked_at ? 'Revoked' : ago(k.last_used_at)),
          h('td', {}, k.revoked_at ? null : h('button', { class: 'btn small danger', onclick: async () => {
            if (!await confirmBox(`Revoke "${k.name}"? Anything using it stops working.`, { ok: 'Revoke' })) { openSettings('keys'); return; }
            try { await del(`/org/keys/${k.id}`); openSettings('keys'); } catch (ex) { err(ex); }
          } }, 'Revoke')))))) : h('p', { class: 'muted' }, 'No keys yet.'),
      h('h4', {}, 'Example: send a position'),
      h('pre', { class: 'code' }, `curl -X POST "${apiBase}/devices/TRUCK-12/positions" \\\n  -H "Authorization: Bearer iobm_..." -H "Content-Type: application/json" \\\n  -d '{"lat": 36.154, "lon": -95.993, "speed_mph": 31}'`));
  },

  async branding(pane) {
    const info = await get('/org');
    const ok = state.session.plan.features.whiteLabel;
    const b = info.org.brand || {};
    const bname = h('input', { value: b.name || '', maxlength: 80, placeholder: info.org.name, disabled: !ok });
    const color = h('input', { type: 'color', value: b.color || '#1f5fbf', disabled: !ok });
    const logo = h('input', { value: b.logo || '', maxlength: 500, placeholder: 'https://example.com/logo.png', disabled: !ok });
    const domain = h('input', { value: info.org.custom_domain || '', maxlength: 200, placeholder: 'maps.example.com', disabled: !ok });
    clear(pane).append(
      h('h3', {}, 'Branding'),
      !ok ? h('p', { class: 'notice' }, 'Your own name, colors, logo and domain come with the Business plan. ', h('button', { class: 'btn link small', onclick: () => showUpgrade('Branding comes with the Business plan.') }, 'See plans')) : null,
      h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        try { await patch('/org', { brand: { name: bname.value, color: color.value, logo: logo.value }, custom_domain: domain.value }); toast('Saved. Reloading with your brand.'); setTimeout(() => location.reload(), 900); } catch (ex) { err(ex); }
      } },
      field('Brand name', bname, 'Shown in the top bar, shared maps, embeds and PDF reports.'),
      field('Brand color', color), field('Logo URL', logo, 'An https:// image, about 64 pixels tall.'),
      field('Custom domain', domain, 'Point a CNAME at iobeacons.com, then tell IoBeacons support so we can add the certificate.'),
      ok ? h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save')) : null));
  },

  async activity(pane) {
    const rows = await get('/org/audit');
    clear(pane).append(h('h3', {}, 'Activity'),
      rows.length ? h('table', { class: 'table' }, h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { class: 'small' }, fmtDate(r.created_at)), h('td', {}, r.user_name || 'System'), h('td', {}, r.action.replace('.', ' ')),
        h('td', { class: 'small muted' }, Object.entries(r.detail || {}).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(', ')))))) : h('p', { class: 'muted' }, 'Nothing yet.'));
  },

  async staff(pane) {
    const rows = await get('/admin/orgs');
    const plans = ['trial', 'starter', 'professional', 'business', 'enterprise'];
    clear(pane).append(h('h3', {}, 'All workspaces'),
      h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ['Workspace', 'Plan', 'Members', 'Maps', 'Shapes', 'Views', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.map((o) => h('tr', {},
          h('td', {}, o.name, o.is_demo ? h('span', { class: 'tag' }, 'demo') : null, h('div', { class: 'hint' }, `since ${fmtDate(o.created_at)}`)),
          h('td', {}, o.is_demo ? 'demo' : h('select', { onchange: async (e) => { try { await patch(`/admin/orgs/${o.id}`, { plan: e.target.value }); toast('Plan changed.'); } catch (ex) { err(ex); } } },
            plans.map((p) => h('option', { value: p, selected: o.plan === p }, p))), h('div', { class: 'hint' }, o.effective !== o.plan ? `in effect: ${o.effective}` : '')),
          h('td', {}, o.members), h('td', {}, o.maps), h('td', {}, fmtNum(o.features)), h('td', {}, fmtNum(o.views)),
          h('td', {}, o.plan === 'trial' ? h('button', { class: 'btn small', onclick: async () => { try { await patch(`/admin/orgs/${o.id}`, { extend_trial_days: 14 }); toast('Trial extended 14 days.'); } catch (ex) { err(ex); } } }, '+14 days') : null))))));
    // Messages from the iobeacons.com contact form.
    const msgs = await get('/admin/contact').catch(() => []);
    pane.append(h('h3', { style: { marginTop: '28px' } }, `Contact form messages (${msgs.length})`),
      msgs.length ? h('div', { class: 'stack' }, msgs.map((m) => h('div', { class: 'card' },
        h('div', {}, h('strong', {}, m.name), ' · ', h('a', { href: `mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.topic || 'your message to IoBeacons'}`)}` }, m.email), m.company ? ` · ${m.company}` : ''),
        h('div', { class: 'hint' }, `${m.topic || 'General'} · ${fmtDate(m.created_at)}`),
        h('p', { class: 'pre' }, m.message)))) : h('p', { class: 'muted' }, 'No messages yet.'));
  },
};

function changePassword() {
  const cur = pwField('Current password', { autocomplete: 'current-password' });
  const pw = pwField('New password', { autocomplete: 'new-password', minlength: 10, hint: 'At least 10 characters.' });
  const status = h('p', { class: 'form-error', role: 'alert' });
  const m = modal('Change password', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault(); status.textContent = '';
    try { await post('/password/change', { current: cur.input.value, password: pw.input.value }); m.close(); toast('Password changed. Other devices were signed out.'); } catch (ex) { status.textContent = ex.message; }
  } }, cur.wrap, pw.wrap, status, h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Change password'))));
}
