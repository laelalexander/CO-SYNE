// The user's workspace: a home page after sign-in, notes pinned to places,
// satellites and maps, and findings that can be shared with peers by link.
import { get, post, patch, del, BASE, ApiError } from './api.js';
import { h, clear, toast, modal, confirmBox, field, ago, copyText } from './ui.js';
import { state, on, emit, isEditor } from './state.js';
import { map, Marker, setGlobe } from './mapview.js';

const err = (e) => toast(e.message || String(e), 'error', 6000);
export const hasWorkspace = () => Boolean(state.session?.user && state.session?.org && !state.session?.demo);
const canWrite = () => hasWorkspace() && ['editor', 'owner'].includes(state.session.role);
let hooks = {};
// main.js passes in the app actions the workspace needs (open a map, open orbits, settings, sign up).
export function setWorkspaceHooks(x) { hooks = x; }

// ---------- shared dialogs ----------
function needAccount(what) {
  if (hasWorkspace()) return false;
  if (!state.session?.user) hooks.openAuth?.('signup', `Create a free account to ${what}.`);
  else toast(`Create your own workspace to ${what}.`, 'error');
  return true;
}

export function noteDialog({ title = 'Add a note', target, mapId, onSaved }) {
  if (needAccount('save notes')) return;
  const body = h('textarea', { rows: 5, maxlength: 4000, required: true, placeholder: 'What did you notice? Your team will see this note.' });
  const m = modal(title, h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const n = await post('/notes', { body: body.value, target, map_id: mapId || undefined });
      m.close(); toast('Note saved.'); onSaved?.(n); emit('notes-changed');
    } catch (ex) { err(ex); }
  } }, target?.name ? h('p', { class: 'muted', style: { margin: 0 } }, `About: ${target.name}`) : null,
  field('Note', body),
  h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save note'))));
}

export function findingDialog({ kind, view, title = '', onSaved }) {
  if (needAccount('save and share findings')) return;
  const t = h('input', { value: title, maxlength: 140, required: true });
  const note = h('textarea', { rows: 4, maxlength: 4000, placeholder: 'What should others see here, and why does it matter?' });
  const share = h('input', { type: 'checkbox', checked: true });
  const m = modal('Save a finding', h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const f = await post('/findings', { kind, view, title: t.value, note: note.value, share: share.checked });
      emit('findings-changed'); onSaved?.(f);
      if (f.link) {
        const linkIn = h('input', { value: f.link, readonly: true, onclick: (ev) => ev.target.select() });
        clear(m.box.querySelector('.modal-body')).append(h('div', { class: 'stack' },
          h('p', {}, 'Saved. Anyone with this link can open this exact view and your note. Your team also sees it in the workspace.'),
          field('Share link', linkIn),
          h('div', { class: 'row end' },
            h('a', { class: 'btn', href: `mailto:?subject=${encodeURIComponent(f.title)}&body=${encodeURIComponent(`${f.note ? `${f.note}\n\n` : ''}${f.link}`)}` }, 'Email it'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => { copyText(f.link); toast('Link copied.'); } }, 'Copy link'))));
      } else { m.close(); toast('Finding saved to your workspace.'); }
    } catch (ex) { err(ex); }
  } },
  field('Title', t), field('Note', note),
  h('label', { class: 'check' }, share, ' Make a share link so people outside the workspace can open it'),
  h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save finding'))));
}

// ---------- current map view ----------
export function currentMapView() {
  const c = map.getCenter();
  return { mapId: state.mapRec?.id, center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), style: state.mapRec?.style, globe: state.globe, satellites: hooks.spaceOn?.() || false };
}
export async function applyMapView(v) {
  if (v.mapId && v.mapId !== state.mapRec?.id && state.maps.some((m) => m.id === v.mapId)) await hooks.openMap(v.mapId);
  if (v.globe !== undefined && Boolean(v.globe) !== Boolean(state.globe)) { setGlobe(Boolean(v.globe)); emit('view-mode'); }
  if (v.satellites) await hooks.setSatellites?.(true);
  map.flyTo({ center: v.center, zoom: v.zoom, pitch: v.pitch || 0, bearing: v.bearing || 0, duration: 1600 });
}

// ---------- note pins on the map ----------
let pins = [];
let mapNotes = [];
function clearPins() { pins.forEach((p) => p.remove()); pins = []; }
export async function loadMapNotes() {
  clearPins(); mapNotes = [];
  if (!hasWorkspace() || !state.mapRec || state.shareToken || !map) return mapNotes;
  try { mapNotes = await get(`/notes?map_id=${state.mapRec.id}`); } catch { return mapNotes; }
  for (const n of mapNotes) {
    if (n.target?.kind !== 'place') continue;
    const btn = h('button', { class: 'note-pin', title: n.body.slice(0, 120), 'aria-label': 'Note' }, h('span', {}, '✎'));
    btn.addEventListener('click', (e) => { e.stopPropagation(); showNotePopup(n); });
    const el = h('div', { class: 'note-pin-wrap' }, btn);
    pins.push(new Marker({ element: el, anchor: 'bottom' }).setLngLat([n.target.lng, n.target.lat]).addTo(map));
  }
  return mapNotes;
}
function showNotePopup(n) {
  modal('Note', h('div', { class: 'stack' },
    h('p', { class: 'note-body' }, n.body),
    h('p', { class: 'hint' }, `${n.author_name || 'Someone'} · ${ago(n.created_at)}`),
    canEdit(n) ? h('div', { class: 'row end' }, h('button', { class: 'btn danger', onclick: async () => { await removeNote(n); } }, 'Delete note')) : null));
}
const canEdit = (n) => hasWorkspace() && (n.author_id === state.session.user.id || state.session.role === 'owner');
async function removeNote(n) {
  if (!await confirmBox('Delete this note?')) return;
  try { await del(`/notes/${n.id}`); toast('Note deleted.'); emit('notes-changed'); } catch (e) { err(e); }
}
on('map-opened', () => { loadMapNotes(); });
on('notes-changed', () => { loadMapNotes().then(() => emit('notes-loaded')); });

// Waits for one click on the map and returns where it was.
function pickPoint(message) {
  return new Promise((resolve) => {
    const tip = h('div', { class: 'pick-tip' }, message, h('button', { class: 'btn small', onclick: () => done(null) }, 'Cancel'));
    document.body.append(tip);
    map.getCanvas().style.cursor = 'crosshair';
    const onClick = (e) => done(e.lngLat);
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    function done(v) { tip.remove(); map.off('click', onClick); document.removeEventListener('keydown', onKey); map.getCanvas().style.cursor = ''; resolve(v); }
    map.once('click', onClick);
    document.addEventListener('keydown', onKey);
  });
}

// ---------- Notes panel in the map ----------
export async function notesPanel(side) {
  const body = h('div', { class: 'stack' });
  side.append(h('div', { class: 'panel-head' }, h('h2', {}, 'Notes and findings')), body);
  if (!hasWorkspace()) {
    body.append(h('section', { class: 'panel-sec' },
      h('p', { class: 'muted', style: { margin: '0 0 10px' } }, 'Pin notes to places on your maps, save views as findings and share them with your team or anyone you choose.'),
      h('button', { class: 'btn primary small', onclick: () => hooks.openAuth?.('signup') }, state.session?.user ? 'Create your workspace' : 'Create a free account')));
    return;
  }
  const render = async () => {
    const notes = await loadMapNotes();
    const findings = (await get('/findings').catch(() => [])).filter((f) => f.kind === 'map' && f.view?.mapId === state.mapRec?.id);
    clear(body).append(
      h('section', { class: 'panel-sec' },
        h('div', { class: 'row' },
          canWrite() ? h('button', { class: 'btn primary small', onclick: async () => { const p = await pickPoint('Click the map where the note goes.'); if (p) noteDialog({ title: 'Note at this place', target: { kind: 'place', lng: p.lng, lat: p.lat }, mapId: state.mapRec.id }); } }, 'Pin a note') : null,
          canWrite() ? h('button', { class: 'btn small', onclick: () => noteDialog({ title: 'Note on this map', target: { kind: 'map', name: state.mapRec.name }, mapId: state.mapRec.id }) }, 'Note on the map') : null,
          canWrite() ? h('button', { class: 'btn small', onclick: () => findingDialog({ kind: 'map', view: currentMapView(), title: state.mapRec.name }) }, 'Save this view') : null)),
      h('section', { class: 'panel-sec' }, h('h3', { class: 'sec-title' }, `Notes on this map (${notes.length})`),
        notes.length ? notes.map((n) => h('div', { class: 'note-row' },
          h('div', { class: 'note-body' }, n.body),
          h('div', { class: 'note-meta' }, `${n.author_name || 'Someone'} · ${ago(n.created_at)}`, n.target?.kind === 'place' ? ' · pinned' : '',
            h('span', { class: 'grow' }),
            n.target?.kind === 'place' ? h('button', { class: 'link-btn', onclick: () => map.flyTo({ center: [n.target.lng, n.target.lat], zoom: Math.max(map.getZoom(), 12) }) }, 'Show') : null,
            canEdit(n) ? h('button', { class: 'link-btn danger', onclick: () => removeNote(n) }, 'Delete') : null)))
          : h('p', { class: 'hint', style: { margin: 0 } }, 'No notes yet. Pin one to a place or write one about the whole map.')),
      h('section', { class: 'panel-sec' }, h('h3', { class: 'sec-title' }, `Findings from this map (${findings.length})`),
        findings.length ? findings.map((f) => findingRow(f, { compact: true })) : h('p', { class: 'hint', style: { margin: 0 } }, 'Save a view to keep it, with a note, and share it with a link.')),
      h('section', { class: 'panel-sec' }, h('button', { class: 'btn small', onclick: () => openWorkspace() }, 'Open your workspace')));
  };
  await render().catch(err);
  const off1 = on('notes-loaded', () => { if (body.isConnected) render(); else off1(); });
  const off2 = on('findings-changed', () => { if (body.isConnected) render(); else off2(); });
}

// ---------- findings ----------
export async function openFinding(f) {
  closeWorkspace();
  if (f.kind === 'orbit') { hooks.showOrbit?.({ select: f.view.norad, time: f.view.time, camera: f.view.camera, rate: f.view.rate, finding: f }); return; }
  await applyMapView(f.view);
  showFindingCard(f);
}
function showFindingCard(f) {
  document.querySelector('.finding-card')?.remove();
  const card = h('aside', { class: 'finding-card' },
    h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => card.remove() }, '✕'),
    h('div', { class: 'eyebrow' }, 'Finding'),
    h('h3', {}, f.title),
    f.note ? h('p', {}, f.note) : null,
    h('p', { class: 'hint' }, [f.author_name, f.org_name].filter(Boolean).join(' · '), f.created_at ? ` · ${ago(f.created_at)}` : ''));
  document.body.append(card);
}
function findingRow(f, { compact = false } = {}) {
  const mine = hasWorkspace() && (f.author_id === state.session.user.id || state.session.role === 'owner');
  return h('div', { class: 'find-row' },
    h('div', { class: 'find-top' }, h('span', { class: `kind-tag k-${f.kind}` }, f.kind === 'orbit' ? 'Orbit' : 'Map'), h('b', {}, f.title)),
    f.note && !compact ? h('div', { class: 'find-note' }, f.note) : null,
    h('div', { class: 'note-meta' }, `${f.author_name || 'Someone'} · ${ago(f.created_at)}`, f.link ? ' · shared by link' : '',
      h('span', { class: 'grow' }),
      h('button', { class: 'link-btn', onclick: () => openFinding(f) }, 'Open'),
      f.link ? h('button', { class: 'link-btn', onclick: () => { copyText(f.link); toast('Link copied.'); } }, 'Copy link') : null,
      mine ? h('button', { class: 'link-btn', onclick: async () => { try { await patch(`/findings/${f.id}`, { share: !f.link }); toast(f.link ? 'Link turned off. The old link no longer works.' : 'Share link created.'); emit('findings-changed'); } catch (e) { err(e); } } }, f.link ? 'Stop sharing' : 'Share link') : null,
      mine ? h('button', { class: 'link-btn danger', onclick: async () => { if (!await confirmBox(`Delete "${f.title}"?`)) return; try { await del(`/findings/${f.id}`); emit('findings-changed'); } catch (e) { err(e); } } }, 'Delete') : null));
}

// Someone opened a shared finding link.
export async function openSharedFinding(tokenStr) {
  let f;
  try { f = await get(`/findings/shared/${encodeURIComponent(tokenStr)}`); } catch (e) { toast(e.message, 'error', 8000); return false; }
  if (f.kind === 'orbit') { hooks.showOrbit?.({ select: f.view.norad, time: f.view.time, camera: f.view.camera, rate: f.view.rate, finding: f }); return true; }
  if (f.mapShare && !f.member) { location.replace(`${BASE}/#share=${f.mapShare}&finding=${tokenStr}`); location.reload(); return true; }
  const go = () => { applyMapView(f.member ? f.view : { ...f.view, mapId: null }); showFindingCard(f); };
  if (map) go(); else { const off = on('style-loaded', () => { off(); go(); }); }
  return true;
}

// ---------- workspace home ----------
let wsEl = null;
export function closeWorkspace() {
  if (!wsEl) return;
  wsEl.remove(); wsEl = null; document.body.classList.remove('ws-open');
  if (location.hash === '#workspace') history.replaceState(null, '', state.mapRec ? `#map=${state.mapRec.id}` : `${BASE}/`);
}
const greet = () => { const hr = new Date().getHours(); return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };
const initials = (n) => (n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

export async function openWorkspace() {
  closeWorkspace();
  wsEl = h('div', { class: 'ws', role: 'region', 'aria-label': 'Your workspace' });
  document.body.append(wsEl); document.body.classList.add('ws-open');
  try { if (location.hash !== '#workspace') history.replaceState(null, '', '#workspace'); } catch { /* ignore */ }
  const s = state.session;
  const wrap = h('div', { class: 'ws-wrap' });
  wsEl.append(wrap);
  const close = h('button', { class: 'btn small', onclick: closeWorkspace }, state.mapRec ? `Back to ${state.mapRec.name}` : 'Back to the map');
  if (!hasWorkspace()) {
    wrap.append(h('div', { class: 'ws-head' }, h('div', {}, h('h1', {}, 'Your own workspace'), h('p', { class: 'muted' }, 'Save your maps, pin notes, keep satellites you follow and share findings with peers.')), close),
      h('section', { class: 'ws-card ws-cta' },
        h('ul', {}, h('li', {}, 'Maps, layers, sites and devices saved to your account'), h('li', {}, 'Notes on places, maps and satellites, visible to your team'), h('li', {}, 'Findings you can share with anyone by link'), h('li', {}, 'Invite teammates and manage your plan')),
        h('button', { class: 'btn primary', onclick: () => { closeWorkspace(); hooks.openAuth?.(s?.user ? 'signup' : 'signup'); } }, 'Start free for 14 days'),
        s?.user ? null : h('button', { class: 'btn', onclick: () => { closeWorkspace(); hooks.openAuth?.('login'); } }, 'Sign in')));
    return;
  }
  wrap.append(h('p', { class: 'muted' }, 'Loading your workspace…'));
  let d;
  try { d = await get('/workspace'); } catch (e) { clear(wrap).append(h('p', {}, e.message), close); return; }
  if (!wsEl) return;
  const plan = s.plan || {};
  const trialDays = s.org?.trial_ends_at ? Math.ceil((Date.parse(s.org.trial_ends_at) - Date.now()) / 864e5) : null;
  const planLine = s.org?.plan === 'trial' ? (trialDays > 0 ? `Free trial: ${trialDays} day${trialDays === 1 ? '' : 's'} left` : 'Your trial has ended') : s.org?.plan === 'expired' ? 'Your trial has ended' : `${plan.name || s.org?.plan} plan${s.org?.subscription_status ? ` · ${s.org.subscription_status}` : ''}`;
  const owner = s.role === 'owner';
  const card = (title, action, ...kids) => h('section', { class: 'ws-card' }, h('div', { class: 'ws-card-head' }, h('h2', {}, title), action), ...kids);
  const empty = (t) => h('p', { class: 'hint ws-empty' }, t);

  clear(wrap).append(
    h('div', { class: 'ws-head' },
      h('div', {}, h('div', { class: 'eyebrow' }, s.org.name), h('h1', {}, `${greet()}, ${(s.user.name || 'there').split(' ')[0]}`),
        h('p', { class: 'muted' }, 'Everything you and your team have saved, in one place.')),
      close),
    h('div', { class: 'ws-quick' },
      state.mapRec ? h('button', { class: 'ws-q', onclick: closeWorkspace }, h('b', {}, 'Continue'), h('span', {}, state.mapRec.name)) : null,
      isEditor() ? h('button', { class: 'ws-q', onclick: () => { closeWorkspace(); hooks.newMap?.(); } }, h('b', {}, 'New map'), h('span', {}, 'Start from a blank map')) : null,
      h('button', { class: 'ws-q', onclick: () => { closeWorkspace(); hooks.showOrbit?.(); } }, h('b', {}, 'Live orbits'), h('span', {}, 'Satellites and debris in 3D')),
      h('button', { class: 'ws-q', onclick: () => { closeWorkspace(); hooks.showPanel?.('notes'); } }, h('b', {}, 'Add a note'), h('span', {}, 'Pin it to a place on a map'))),
    h('div', { class: 'ws-grid' },
      h('div', { class: 'ws-col' },
        card('Maps', h('span', { class: 'hint' }, `${d.counts.maps} in total`),
          d.maps.length ? h('div', { class: 'ws-maps' }, d.maps.map((m) => h('button', { class: 'ws-map', onclick: async () => { closeWorkspace(); await hooks.openMap(m.id); } },
            h('b', {}, m.name), h('span', {}, `${m.layer_count} layer${m.layer_count === 1 ? '' : 's'} · edited ${ago(m.updated_at)}`), m.visibility === 'link' || m.visibility === 'public' ? h('em', {}, 'Shared') : null))) : empty('No maps yet.')),
        card('Findings', h('span', { class: 'hint' }, 'Saved views your team can open, and share by link'),
          d.findings.length ? d.findings.map((f) => findingRow(f)) : empty('No findings yet. In a map, open Notes and choose "Save this view". In Live orbits, pick a satellite and choose "Save finding".')),
        card('Notes', h('span', { class: 'hint' }, 'From everyone in the workspace'),
          d.notes.length ? d.notes.map((n) => h('div', { class: 'note-row' },
            h('div', { class: 'note-body' }, n.body),
            h('div', { class: 'note-meta' }, `${n.author_name || 'Someone'} · ${ago(n.created_at)} · `,
              n.target?.kind === 'satellite' ? `Satellite ${n.target.name || n.target.norad}` : n.map_name ? `Map: ${n.map_name}` : 'Workspace',
              h('span', { class: 'grow' }),
              h('button', { class: 'link-btn', onclick: () => openNote(n) }, 'Open'),
              canEdit(n) ? h('button', { class: 'link-btn danger', onclick: async () => { await removeNote(n); openWorkspace(); } }, 'Delete') : null))) : empty('No notes yet.'))),
      h('div', { class: 'ws-col' },
        card('Your plan', null,
          h('div', { class: 'ws-plan' }, h('b', {}, planLine), h('span', { class: 'hint' }, `${d.counts.sites} sites · ${d.counts.devices} devices · ${d.counts.alerts} alert rules`)),
          h('div', { class: 'row' },
            owner ? h('button', { class: 'btn primary small', onclick: () => hooks.openSettings?.('billing') }, 'Manage subscription') : h('span', { class: 'hint' }, 'Only the workspace owner can change the plan.'),
            h('button', { class: 'btn small', onclick: () => hooks.openSettings?.('workspace') }, 'Settings'))),
        card('Saved satellites', h('button', { class: 'link-btn', onclick: () => { closeWorkspace(); hooks.showOrbit?.(); } }, 'Live orbits'),
          d.watchlist.length ? d.watchlist.map((w) => h('div', { class: 'sat-row' },
            h('span', { class: 'sat-dot' }), h('b', {}, w.name), h('span', { class: 'hint' }, w.norad), h('span', { class: 'grow' }),
            h('button', { class: 'link-btn', onclick: () => { closeWorkspace(); hooks.showOrbit?.({ select: w.norad, camera: 'follow' }); } }, 'Track'),
            h('button', { class: 'link-btn danger', 'aria-label': `Remove ${w.name}`, onclick: async () => { await del(`/watchlist/${w.norad}`).catch(err); openWorkspace(); } }, 'Remove')))
            : empty('In Live orbits, pick a satellite and choose "Save" to keep it here.')),
        card('Team', owner ? h('button', { class: 'link-btn', onclick: () => hooks.openSettings?.('team') }, 'Invite people') : null,
          h('div', { class: 'ws-team' }, d.team.map((m) => h('div', { class: 'ws-person' }, h('span', { class: 'avatar' }, initials(m.name || m.email)),
            h('div', {}, h('b', {}, m.name || m.email, m.id === d.you ? ' (you)' : ''), h('span', { class: 'hint' }, m.role))))),
          d.team.length < 2 ? h('p', { class: 'hint', style: { margin: '8px 0 0' } }, 'Invite peers so they can see your notes and findings, as editors or view only.') : null))));
}

async function openNote(n) {
  closeWorkspace();
  if (n.target?.kind === 'satellite') { hooks.showOrbit?.({ select: n.target.norad, camera: 'follow' }); return; }
  if (n.map_id && n.map_id !== state.mapRec?.id) await hooks.openMap(n.map_id);
  if (n.target?.kind === 'place') map.flyTo({ center: [n.target.lng, n.target.lat], zoom: Math.max(map.getZoom(), 12), duration: 1400 });
  hooks.showPanel?.('notes');
}

// ---------- hooks for the live orbits view ----------
export function orbitWorkspace() {
  let saved = null;
  const loadSaved = async () => { if (!hasWorkspace()) return new Set(); saved ||= new Set((await get('/watchlist').catch(() => [])).map((w) => w.norad)); return saved; };
  return {
    enabled: hasWorkspace(),
    canWrite: canWrite(),
    signUp: () => hooks.openAuth?.('signup', 'Create a free account to save satellites, notes and findings.'),
    isSaved: async (norad) => (await loadSaved()).has(String(norad)),
    save: async (sat) => { await post('/watchlist', { norad: sat.id, name: sat.name }); (await loadSaved()).add(String(sat.id)); toast(`${sat.name} saved to your workspace.`); },
    unsave: async (sat) => { await del(`/watchlist/${sat.id}`); (await loadSaved()).delete(String(sat.id)); toast(`${sat.name} removed.`); },
    notes: async (norad) => (hasWorkspace() ? get(`/notes?norad=${norad}`).catch(() => []) : []),
    addNote: (sat, onSaved) => noteDialog({ title: `Note about ${sat.name}`, target: { kind: 'satellite', norad: sat.id, name: sat.name }, onSaved }),
    saveFinding: (sat, view) => findingDialog({ kind: 'orbit', view: { ...view, norad: sat.id, name: sat.name }, title: sat.name }),
  };
}

export const isApiError = (e) => e instanceof ApiError;
