import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { one, q } from './db/pool.js';
import { planFor, effectivePlanKey } from './plans.js';
import { bump } from './services/usage.js';

const scrypt = promisify(crypto.scrypt);
export const COOKIE = 'iobm_session';
const ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, k] = stored.split('$');
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 64);
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export async function createSession(res, userId, orgId) {
  const t = token();
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  await q('insert into sessions(id, user_id, org_id, expires_at) values ($1,$2,$3,$4)', [sha256(t), userId, orgId, expires]);
  res.cookie(COOKIE, t, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires, path: config.basePath || '/' });
}
export async function destroySession(req, res) {
  const t = req.cookies?.[COOKIE];
  if (t) await q('delete from sessions where id=$1', [sha256(t)]);
  res.clearCookie(COOKIE, { path: config.basePath || '/' });
}

let demoOrgCache = null;
export async function demoOrg() {
  if (demoOrgCache && Date.now() - demoOrgCache.at < 60000) return demoOrgCache.org;
  const org = await one('select * from orgs where is_demo order by created_at limit 1');
  demoOrgCache = { org, at: Date.now() };
  return org;
}
export const clearDemoCache = () => { demoOrgCache = null; };

// Works out who is calling and for which organization. Order:
// 1) API key (Authorization: Bearer iobm_...), 2) session cookie, 3) open demo.
export async function context(req, _res, next) {
  try {
    const ctx = { user: null, org: null, role: null, via: 'anon', demo: false };
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].split(':')[0].trim().toLowerCase();
    const domainOrg = host ? await one('select * from orgs where custom_domain=$1', [host]) : null;

    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer iobm_')) {
      const key = await one(`select k.*, row_to_json(o) as org from api_keys k join orgs o on o.id=k.org_id
                             where k.key_hash=$1 and k.revoked_at is null`, [sha256(auth.slice(7))]);
      if (!key) return next(new HttpError(401, 'That API key is not valid or was revoked.'));
      ctx.org = key.org; ctx.role = 'editor'; ctx.via = 'api'; ctx.apiKeyId = key.id;
      q('update api_keys set last_used_at=now() where id=$1', [key.id]).catch(() => {});
      bump(ctx.org.id, 'apiCalls').catch(() => {});
    } else if (req.cookies?.[COOKIE]) {
      const s = await one(`select s.*, row_to_json(u) as user from sessions s join users u on u.id=s.user_id
                           where s.id=$1 and s.expires_at > now()`, [sha256(req.cookies[COOKIE])]);
      if (s) {
        ctx.user = { id: s.user.id, email: s.user.email, name: s.user.name, is_staff: s.user.is_staff };
        ctx.via = 'session'; ctx.sessionId = s.id;
        let m = null;
        const wanted = domainOrg?.id || s.org_id;
        if (wanted) m = await one('select m.role, row_to_json(o) as org from memberships m join orgs o on o.id=m.org_id where m.user_id=$1 and m.org_id=$2', [s.user_id, wanted]);
        if (!m && !domainOrg) m = await one('select m.role, row_to_json(o) as org from memberships m join orgs o on o.id=m.org_id where m.user_id=$1 order by m.created_at limit 1', [s.user_id]);
        if (m) { ctx.org = m.org; ctx.role = m.role; }
      }
    }
    if (!ctx.org && config.demoEnabled && !domainOrg) {
      const d = await demoOrg();
      if (d) { ctx.org = d; ctx.role = 'editor'; ctx.demo = true; }
    }
    ctx.domainOrg = domainOrg;
    if (ctx.org) { ctx.planKey = effectivePlanKey(ctx.org); ctx.plan = planFor(ctx.org); ctx.demo = ctx.demo || ctx.org.is_demo; }
    req.ctx = ctx;
    next();
  } catch (e) { next(e); }
}

export const requireOrg = (req, _res, next) => (req.ctx.org ? next() : next(new HttpError(401, 'Sign in to use a workspace.')));
export const requireUser = (req, _res, next) => (req.ctx.user ? next() : next(new HttpError(401, 'Sign in first.')));
export const requireStaff = (req, _res, next) => (req.ctx.user?.is_staff ? next() : next(new HttpError(403, 'IoBeacons staff only.')));
export const requireRole = (role) => (req, _res, next) => {
  if (!req.ctx.org) return next(new HttpError(401, 'Sign in to use a workspace.'));
  if ((ROLE_RANK[req.ctx.role] || 0) < ROLE_RANK[role]) return next(new HttpError(403, `You need ${role} access in this workspace to do that.`));
  next();
};
// Owner-only actions that make no sense in the shared demo (billing, team, keys).
export const requireRealOwner = (req, res, next) => {
  if (req.ctx.demo) return next(new HttpError(403, 'Create your own workspace to manage team, billing and API keys.'));
  return requireRole('owner')(req, res, next);
};
export const requireFeature = (feature) => (req, _res, next) => {
  if (!req.ctx.plan?.features[feature]) {
    return next(new HttpError(402, `Your plan (${req.ctx.plan?.name || 'none'}) doesn't include this. Upgrade to use it.`, { upgrade: true, feature }));
  }
  next();
};

// Throws 402 when adding `adding` more of `metric` would pass the plan limit.
export async function checkLimit(ctx, metric, current, adding = 1) {
  const limit = ctx.plan?.limits?.[metric];
  if (limit === undefined || limit === Infinity) return;
  if (current + adding > limit) {
    throw new HttpError(402, `This would pass your plan's limit of ${limit.toLocaleString('en-US')} ${metric}. Upgrade for more.`, { upgrade: true, metric, limit });
  }
}
