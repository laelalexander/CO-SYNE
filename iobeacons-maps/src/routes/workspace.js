// The signed-in user's workspace: a home page summary, notes, findings they
// can share with peers, and saved satellites.
import { Router } from 'express';
import { config } from '../config.js';
import { one, many, q } from '../db/pool.js';
import { HttpError, requireUser, token } from '../auth.js';
import { ah, str, uuid, lonLat } from './util.js';

export const router = Router();

// Real workspaces only: the open demo is shared by everyone, so nothing personal is saved there.
// API keys can read and write notes and findings for their workspace too.
const real = (req, _res, next) => {
  if (!req.ctx.org || req.ctx.demo) return next(new HttpError(403, 'Create a free account to save notes and findings.', { signup: true }));
  next();
};
const member = [(req, res, next) => (req.ctx.via === 'api' ? next() : requireUser(req, res, next)), real];
const person = [requireUser, real]; // things that belong to one person (home summary, saved satellites)
const API_AUTHOR = 'API key';
const mayChange = (ctx, x) => (ctx.via === 'api' ? !x.author_id : x.author_id === ctx.user.id || ctx.role === 'owner');
const canWrite = (ctx) => ['editor', 'owner'].includes(ctx.role);

function cleanTarget(t = {}) {
  const kind = ['place', 'satellite', 'map'].includes(t.kind) ? t.kind : 'map';
  const out = { kind };
  if (kind === 'place') { const [lng, lat] = lonLat(t.lng, t.lat); Object.assign(out, { lng, lat }); }
  if (kind === 'satellite') { out.norad = String(t.norad || '').replace(/\D/g, '').slice(0, 9); if (!out.norad) throw new HttpError(400, 'Which satellite is this note about?'); }
  if (t.name) out.name = str(t.name, { name: 'Name', max: 120 });
  return out;
}

function cleanView(kind, v = {}) {
  const num = (x, lo, hi, d) => { const n = Number(x); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  if (kind === 'orbit') {
    const norad = String(v.norad || '').replace(/\D/g, '').slice(0, 9);
    return {
      norad: norad || null, name: v.name ? str(v.name, { max: 120 }) : null,
      time: Number.isFinite(Date.parse(v.time)) ? new Date(v.time).toISOString() : null,
      camera: ['close', 'follow', 'earth'].includes(v.camera) ? v.camera : 'follow',
      rate: num(v.rate, 1, 1800, 1),
    };
  }
  const [lng, lat] = Array.isArray(v.center) ? lonLat(v.center[0], v.center[1]) : [0, 0];
  return {
    mapId: v.mapId ? uuid(v.mapId, 'mapId') : null,
    center: [lng, lat], zoom: num(v.zoom, 0, 22, 2), pitch: num(v.pitch, 0, 85, 0), bearing: num(v.bearing, -180, 180, 0),
    style: typeof v.style === 'string' ? v.style.slice(0, 30) : null,
    globe: Boolean(v.globe), satellites: Boolean(v.satellites),
  };
}

const findingLink = (t) => (t ? `${config.publicUrl}/#finding=${t}` : null);
const findingOut = (f) => ({ ...f, share_token: undefined, link: findingLink(f.share_token) });
const authorJoin = 'left join users u on u.id = x.author_id';

// ---- home ----
router.get('/workspace', ...person, ah(async (req, res) => {
  const { ctx } = req;
  const [maps, notes, findings, watch, team, counts] = await Promise.all([
    many(`select m.id, m.name, m.description, m.style, m.updated_at, m.visibility,
            (select count(*) from layers l where l.map_id=m.id)::int as layer_count
          from maps m where m.org_id=$1 and (m.visibility <> 'private' or m.created_by=$2) order by m.updated_at desc limit 12`, [ctx.org.id, ctx.user.id]),
    many(`select x.*, coalesce(u.name, 'API key') as author_name, m.name as map_name from notes x ${authorJoin} left join maps m on m.id=x.map_id where x.org_id=$1 order by x.created_at desc limit 30`, [ctx.org.id]),
    many(`select x.*, coalesce(u.name, 'API key') as author_name from findings x ${authorJoin} where x.org_id=$1 order by x.created_at desc limit 30`, [ctx.org.id]),
    many('select norad, name, created_at from watchlist where org_id=$1 and user_id=$2 order by created_at desc', [ctx.org.id, ctx.user.id]),
    many(`select u.id, u.name, u.email, m.role from memberships m join users u on u.id=m.user_id where m.org_id=$1 order by m.created_at`, [ctx.org.id]),
    one(`select (select count(*) from sites where org_id=$1)::int as sites, (select count(*) from devices where org_id=$1)::int as devices,
            (select count(*) from rules where org_id=$1)::int as alerts, (select count(*) from maps where org_id=$1)::int as maps`, [ctx.org.id]),
  ]);
  res.json({ maps, notes, findings: findings.map(findingOut), watchlist: watch, team, counts, you: ctx.user.id, role: ctx.role });
}));

// ---- notes ----
router.get('/notes', ...member, ah(async (req, res) => {
  const where = ['x.org_id=$1']; const args = [req.ctx.org.id];
  if (req.query.map_id) { args.push(uuid(req.query.map_id, 'map_id')); where.push(`x.map_id=$${args.length}`); }
  if (req.query.norad) { args.push(String(req.query.norad).replace(/\D/g, '')); where.push(`x.target->>'norad'=$${args.length}`); }
  res.json(await many(`select x.*, coalesce(u.name, 'API key') as author_name from notes x ${authorJoin} where ${where.join(' and ')} order by x.created_at desc limit 200`, args));
}));
router.post('/notes', ...member, ah(async (req, res) => {
  if (!canWrite(req.ctx)) throw new HttpError(403, 'Viewers can read notes but not add them.');
  const body = str(req.body.body, { name: 'Note', max: 4000, required: true });
  const target = cleanTarget(req.body.target);
  let mapId = null;
  if (req.body.map_id) {
    mapId = uuid(req.body.map_id, 'map_id');
    if (!await one('select 1 from maps where id=$1 and org_id=$2', [mapId, req.ctx.org.id])) throw new HttpError(404, 'Map not found.');
  }
  const n = await one('insert into notes(org_id, author_id, map_id, body, target) values ($1,$2,$3,$4,$5) returning *', [req.ctx.org.id, req.ctx.user?.id || null, mapId, body, JSON.stringify(target)]);
  res.status(201).json({ ...n, author_name: req.ctx.user?.name || API_AUTHOR });
}));
async function ownNote(req) {
  const n = await one('select * from notes where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  if (!n) throw new HttpError(404, 'Note not found.');
  if (!mayChange(req.ctx, n)) throw new HttpError(403, 'Only the author or a workspace owner can change this note.');
  return n;
}
router.patch('/notes/:id', ...member, ah(async (req, res) => {
  const n = await ownNote(req);
  const body = str(req.body.body, { name: 'Note', max: 4000, required: true });
  res.json(await one('update notes set body=$2, updated_at=now() where id=$1 returning *', [n.id, body]));
}));
router.delete('/notes/:id', ...member, ah(async (req, res) => {
  const n = await ownNote(req);
  await q('delete from notes where id=$1', [n.id]);
  res.json({ ok: true });
}));

// ---- findings ----
router.get('/findings', ...member, ah(async (req, res) => {
  res.json((await many(`select x.*, coalesce(u.name, 'API key') as author_name from findings x ${authorJoin} where x.org_id=$1 order by x.created_at desc limit 200`, [req.ctx.org.id])).map(findingOut));
}));
router.post('/findings', ...member, ah(async (req, res) => {
  if (!canWrite(req.ctx)) throw new HttpError(403, 'Viewers can read findings but not save them.');
  const kind = req.body.kind === 'orbit' ? 'orbit' : 'map';
  const title = str(req.body.title, { name: 'Title', max: 140, required: true });
  const note = str(req.body.note, { name: 'Note', max: 4000 }) || '';
  const view = cleanView(kind, req.body.view);
  if (view.mapId && !await one('select 1 from maps where id=$1 and org_id=$2', [view.mapId, req.ctx.org.id])) throw new HttpError(404, 'Map not found.');
  const shareTok = req.body.share ? token(12) : null;
  const f = await one('insert into findings(org_id, author_id, title, note, kind, view, share_token) values ($1,$2,$3,$4,$5,$6,$7) returning *', [req.ctx.org.id, req.ctx.user?.id || null, title, note, kind, JSON.stringify(view), shareTok]);
  res.status(201).json(findingOut({ ...f, author_name: req.ctx.user?.name || API_AUTHOR }));
}));
async function ownFinding(req) {
  const f = await one('select * from findings where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  if (!f) throw new HttpError(404, 'Finding not found.');
  if (!mayChange(req.ctx, f)) throw new HttpError(403, 'Only the author or a workspace owner can change this finding.');
  return f;
}
router.patch('/findings/:id', ...member, ah(async (req, res) => {
  const f = await ownFinding(req);
  const title = str(req.body.title, { name: 'Title', max: 140 });
  const note = str(req.body.note, { name: 'Note', max: 4000 });
  let tok = f.share_token;
  if (req.body.share === true && !tok) tok = token(12);
  if (req.body.share === false) tok = null;
  res.json(findingOut(await one('update findings set title=coalesce($2,title), note=coalesce($3,note), share_token=$4, updated_at=now() where id=$1 returning *', [f.id, title || null, note ?? null, tok])));
}));
router.delete('/findings/:id', ...member, ah(async (req, res) => {
  const f = await ownFinding(req);
  await q('delete from findings where id=$1', [f.id]);
  res.json({ ok: true });
}));

// Anyone with the link can open a shared finding (no sign-in).
router.get('/findings/shared/:token', ah(async (req, res) => {
  const f = await one(`select x.id, x.title, x.note, x.kind, x.view, x.created_at, x.org_id, coalesce(u.name, 'API key') as author_name, o.name as org_name
                       from findings x left join users u on u.id=x.author_id join orgs o on o.id=x.org_id where x.share_token=$1`, [String(req.params.token).slice(0, 64)]);
  if (!f) throw new HttpError(404, 'This finding is no longer shared.');
  // Point at the map's own share link only if that map is shared too; private layers stay private.
  let mapShare = null;
  if (f.kind === 'map' && f.view.mapId) {
    const m = await one("select share_token, visibility from maps where id=$1 and org_id=$2 and visibility in ('link','public')", [f.view.mapId, f.org_id]);
    mapShare = m?.share_token || null;
  }
  const member = req.ctx.user ? await one('select 1 from memberships where user_id=$1 and org_id=$2', [req.ctx.user.id, f.org_id]) : null;
  const { org_id: _o, ...rest } = f;
  res.json({ ...rest, mapShare, member: Boolean(member) });
}));

// ---- saved satellites ----
router.get('/watchlist', ...person, ah(async (req, res) => {
  res.json(await many('select norad, name, created_at from watchlist where org_id=$1 and user_id=$2 order by created_at desc', [req.ctx.org.id, req.ctx.user.id]));
}));
router.post('/watchlist', ...person, ah(async (req, res) => {
  const norad = String(req.body.norad || '').replace(/\D/g, '').slice(0, 9);
  if (!norad) throw new HttpError(400, 'Which satellite?');
  const name = str(req.body.name, { name: 'Name', max: 120, required: true });
  const n = await one('select count(*)::int as n from watchlist where org_id=$1 and user_id=$2', [req.ctx.org.id, req.ctx.user.id]);
  if (n.n >= 500) throw new HttpError(400, 'You can save up to 500 satellites.');
  await q('insert into watchlist(org_id, user_id, norad, name) values ($1,$2,$3,$4) on conflict do nothing', [req.ctx.org.id, req.ctx.user.id, norad, name]);
  res.status(201).json({ ok: true });
}));
router.delete('/watchlist/:norad', ...person, ah(async (req, res) => {
  await q('delete from watchlist where org_id=$1 and user_id=$2 and norad=$3', [req.ctx.org.id, req.ctx.user.id, String(req.params.norad).replace(/\D/g, '')]);
  res.json({ ok: true });
}));
