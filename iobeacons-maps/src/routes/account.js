import { Router } from 'express';
import { config } from '../config.js';
import { one, many, q, tx } from '../db/pool.js';
import {
  HttpError, hashPassword, checkPassword, createSession, destroySession, sha256, token,
  requireUser, requireRealOwner, requireStaff, requireOrg, checkLimit,
} from '../auth.js';
import { PLANS, SELLABLE, publicPlan, effectivePlanKey } from '../plans.js';
import { usageFor, audit } from '../services/usage.js';
import { stripe, billingReady, verifyWebhook, planForPrice } from '../services/stripe.js';
import { sendEmail } from '../services/notify.js';
import { STYLE_NAMES, STYLE_LABELS } from '../services/styles.js';
import { createStarterMap } from '../db/seed.js';
import { ah, str, emailOk, uuid, slugify, rateLimit } from './util.js';

export const router = Router();

function brandOf(org, plan) {
  if (!org || !plan?.features.whiteLabel) return { name: 'IoBeacons Maps', color: '#1f5fbf', logo: '' };
  return { name: org.brand?.name || org.name, color: org.brand?.color || '#1f5fbf', logo: org.brand?.logo || '' };
}

router.get('/session', ah(async (req, res) => {
  const { ctx } = req;
  const orgs = ctx.user ? await many(`select o.id, o.name, o.slug, m.role from memberships m join orgs o on o.id=m.org_id where m.user_id=$1 order by o.name`, [ctx.user.id]) : [];
  res.json({
    user: ctx.user, role: ctx.role, demo: ctx.demo, orgs,
    org: ctx.org ? { id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug, plan: ctx.planKey, trial_ends_at: ctx.org.trial_ends_at, subscription_status: ctx.org.subscription_status } : null,
    plan: ctx.org ? publicPlan(ctx.planKey) : null,
    brand: brandOf(ctx.domainOrg || ctx.org, ctx.plan),
    app: { basePath: config.basePath, demoEnabled: config.demoEnabled, billingReady: billingReady(), styles: STYLE_NAMES.map((k) => ({ key: k, label: STYLE_LABELS[k] })), plans: SELLABLE.map(publicPlan) },
  });
}));

async function createOrg(client, name, ownerId) {
  let slug = slugify(name);
  if (await client.query('select 1 from orgs where slug=$1', [slug]).then((r) => r.rowCount)) slug = `${slug}-${token(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const org = (await client.query(`insert into orgs(name, slug, plan, trial_ends_at) values ($1,$2,'trial', now() + make_interval(days => $3)) returning *`, [name, slug, config.trialDays])).rows[0];
  await client.query("insert into memberships(org_id, user_id, role) values ($1,$2,'owner')", [org.id, ownerId]);
  return org;
}

router.post('/signup', ah(async (req, res) => {
  rateLimit(`signup:${req.ip}`, 10, 3600e3);
  const name = str(req.body.name, { name: 'Your name', max: 100, required: true });
  const email = str(req.body.email, { name: 'Email', max: 200, required: true }).toLowerCase();
  if (!emailOk(email)) throw new HttpError(400, 'Enter a valid email address.');
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 10) throw new HttpError(400, 'Use a password of at least 10 characters.');
  const orgName = str(req.body.orgName, { name: 'Workspace name', max: 100 }) || `${name.split(' ')[0]}'s workspace`;
  if (await one('select 1 from users where lower(email)=$1', [email])) throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
  const isStaff = config.staffEmails.includes(email);
  const { user, org } = await tx(async (c) => {
    const user = (await c.query('insert into users(email, name, password_hash, is_staff) values ($1,$2,$3,$4) returning id, email, name', [email, name, await hashPassword(password), isStaff])).rows[0];
    let org = null;
    if (!req.body.inviteToken) org = await createOrg(c, orgName, user.id);
    return { user, org };
  });
  if (org) await createStarterMap(org.id, user.id);
  await createSession(res, user.id, org?.id || null);
  if (org) await audit(org.id, user.id, 'org.created', { name: org.name });
  res.status(201).json({ ok: true, org: org && { id: org.id, name: org.name } });
}));

router.post('/login', ah(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  rateLimit(`login:${req.ip}:${email}`, 8, 900e3);
  const user = await one('select * from users where lower(email)=$1', [email]);
  if (!user || !(await checkPassword(String(req.body.password || ''), user.password_hash))) throw new HttpError(401, "That email and password don't match.");
  if (config.staffEmails.includes(email) && !user.is_staff) await q('update users set is_staff=true where id=$1', [user.id]);
  const m = await one('select org_id from memberships where user_id=$1 order by created_at limit 1', [user.id]);
  await createSession(res, user.id, m?.org_id || null);
  res.json({ ok: true });
}));

router.post('/logout', ah(async (req, res) => { await destroySession(req, res); res.json({ ok: true }); }));

router.post('/orgs', requireUser, ah(async (req, res) => {
  const name = str(req.body.name, { name: 'Workspace name', max: 100, required: true });
  const org = await tx((c) => createOrg(c, name, req.ctx.user.id));
  await createStarterMap(org.id, req.ctx.user.id);
  await q('update sessions set org_id=$2 where id=$1', [req.ctx.sessionId, org.id]);
  await audit(org.id, req.ctx.user.id, 'org.created', { name });
  res.status(201).json({ id: org.id });
}));

router.post('/orgs/switch', requireUser, ah(async (req, res) => {
  const id = uuid(req.body.org_id, 'org_id');
  if (!await one('select 1 from memberships where user_id=$1 and org_id=$2', [req.ctx.user.id, id])) throw new HttpError(404, "You aren't a member of that workspace.");
  await q('update sessions set org_id=$2 where id=$1', [req.ctx.sessionId, id]);
  res.json({ ok: true });
}));

// ---- workspace settings ----
router.get('/org', requireOrg, ah(async (req, res) => {
  const { org } = req.ctx;
  const members = req.ctx.demo ? [] : await many(`select u.id, u.name, u.email, m.role, m.created_at from memberships m join users u on u.id=m.user_id where m.org_id=$1 order by m.created_at`, [org.id]);
  const invitations = req.ctx.role === 'owner' && !req.ctx.demo ? await many('select id, email, role, expires_at from invitations where org_id=$1 and accepted_at is null and expires_at > now() order by created_at desc', [org.id]) : [];
  res.json({
    org: { id: org.id, name: org.name, slug: org.slug, brand: org.brand, custom_domain: org.custom_domain, plan: org.plan, trial_ends_at: org.trial_ends_at, subscription_status: org.subscription_status, is_demo: org.is_demo },
    effectivePlan: publicPlan(req.ctx.planKey), usage: await usageFor(org.id), members, invitations,
  });
}));

router.patch('/org', requireRealOwner, ah(async (req, res) => {
  const { org, plan } = req.ctx;
  const name = str(req.body.name, { name: 'Workspace name', max: 100 });
  let brand = org.brand || {}; let domain = org.custom_domain;
  if (req.body.brand !== undefined || req.body.custom_domain !== undefined) {
    if (!plan.features.whiteLabel) throw new HttpError(402, 'Branding and custom domains come with the Business plan.', { upgrade: true });
    if (req.body.brand) {
      const b = req.body.brand;
      const color = str(b.color, { name: 'Color', max: 7 });
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new HttpError(400, 'Color must look like #1f5fbf.');
      const logo = str(b.logo, { name: 'Logo URL', max: 500 });
      if (logo && !/^https:\/\//.test(logo)) throw new HttpError(400, 'Logo must be an https:// image URL.');
      brand = { name: str(b.name, { name: 'Brand name', max: 80 }) ?? brand.name, color: color ?? brand.color, logo: logo ?? brand.logo };
    }
    if (req.body.custom_domain !== undefined) {
      domain = str(req.body.custom_domain, { name: 'Domain', max: 200 })?.toLowerCase() || null;
      if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new HttpError(400, 'Enter a domain like maps.example.com.');
    }
  }
  try {
    await q('update orgs set name=coalesce($2,name), brand=$3, custom_domain=$4 where id=$1', [org.id, name || null, brand, domain]);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'That domain is already used by another workspace.');
    throw e;
  }
  await audit(org.id, req.ctx.user.id, 'org.updated', { name, brand, custom_domain: domain });
  res.json({ ok: true });
}));

router.post('/org/invitations', requireRealOwner, ah(async (req, res) => {
  const { org } = req.ctx;
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!emailOk(email)) throw new HttpError(400, 'Enter a valid email address.');
  const role = ['owner', 'editor', 'viewer'].includes(req.body.role) ? req.body.role : 'editor';
  const { users } = await usageFor(org.id);
  const pending = (await one('select count(*)::int n from invitations where org_id=$1 and accepted_at is null and expires_at > now()', [org.id])).n;
  await checkLimit(req.ctx, 'users', users + pending);
  const t = token();
  await q(`insert into invitations(org_id, email, role, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5, now() + interval '14 days')`, [org.id, email, role, sha256(t), req.ctx.user.id]);
  const link = `${config.publicUrl}/#invite=${t}`;
  const mail = await sendEmail(email, `${req.ctx.user.name} invited you to ${org.name} on IoBeacons Maps`, `${req.ctx.user.name} invited you to the "${org.name}" workspace on IoBeacons Maps as ${role}.\n\nAccept here: ${link}\n\nThis link works for 14 days.`).catch((e) => ({ ok: false, error: e.message }));
  await audit(org.id, req.ctx.user.id, 'member.invited', { email, role });
  res.status(201).json({ link, emailed: Boolean(mail.ok) });
}));

router.delete('/org/invitations/:id', requireRealOwner, ah(async (req, res) => {
  await q('delete from invitations where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  res.json({ ok: true });
}));

router.get('/invitations/:token', ah(async (req, res) => {
  const inv = await one(`select i.email, i.role, o.name as org_name from invitations i join orgs o on o.id=i.org_id where token_hash=$1 and accepted_at is null and expires_at > now()`, [sha256(req.params.token)]);
  if (!inv) throw new HttpError(404, 'This invitation has expired or was already used.');
  res.json(inv);
}));

router.post('/invitations/:token/accept', requireUser, ah(async (req, res) => {
  const inv = await one('select * from invitations where token_hash=$1 and accepted_at is null and expires_at > now()', [sha256(req.params.token)]);
  if (!inv) throw new HttpError(404, 'This invitation has expired or was already used.');
  await tx(async (c) => {
    await c.query('insert into memberships(org_id, user_id, role) values ($1,$2,$3) on conflict (org_id, user_id) do update set role=excluded.role', [inv.org_id, req.ctx.user.id, inv.role]);
    await c.query('update invitations set accepted_at=now() where id=$1', [inv.id]);
    await c.query('update sessions set org_id=$2 where id=$1', [req.ctx.sessionId, inv.org_id]);
  });
  await audit(inv.org_id, req.ctx.user.id, 'member.joined', { role: inv.role });
  res.json({ ok: true });
}));

router.patch('/org/members/:userId', requireRealOwner, ah(async (req, res) => {
  const role = req.body.role;
  if (!['owner', 'editor', 'viewer'].includes(role)) throw new HttpError(400, 'Role must be owner, editor or viewer.');
  const uid = uuid(req.params.userId);
  if (uid === req.ctx.user.id && role !== 'owner') {
    const owners = (await one("select count(*)::int n from memberships where org_id=$1 and role='owner'", [req.ctx.org.id])).n;
    if (owners < 2) throw new HttpError(400, 'A workspace needs at least one owner.');
  }
  await q('update memberships set role=$3 where org_id=$1 and user_id=$2', [req.ctx.org.id, uid, role]);
  await audit(req.ctx.org.id, req.ctx.user.id, 'member.role', { user_id: uid, role });
  res.json({ ok: true });
}));

router.delete('/org/members/:userId', requireRealOwner, ah(async (req, res) => {
  const uid = uuid(req.params.userId);
  if (uid === req.ctx.user.id) throw new HttpError(400, "You can't remove yourself. Make someone else owner first.");
  await q('delete from memberships where org_id=$1 and user_id=$2', [req.ctx.org.id, uid]);
  await audit(req.ctx.org.id, req.ctx.user.id, 'member.removed', { user_id: uid });
  res.json({ ok: true });
}));

// ---- API keys ----
router.get('/org/keys', requireRealOwner, ah(async (req, res) => {
  res.json(await many('select id, name, prefix, last_used_at, revoked_at, created_at from api_keys where org_id=$1 order by created_at desc', [req.ctx.org.id]));
}));
router.post('/org/keys', requireRealOwner, ah(async (req, res) => {
  if (!req.ctx.plan.features.api) throw new HttpError(402, 'The API comes with the Professional plan.', { upgrade: true });
  const name = str(req.body.name, { name: 'Key name', max: 80 }) || 'API key';
  const secret = `iobm_${token(24)}`;
  const row = await one('insert into api_keys(org_id, name, prefix, key_hash, created_by) values ($1,$2,$3,$4,$5) returning id, name, prefix, created_at', [req.ctx.org.id, name, secret.slice(0, 12), sha256(secret), req.ctx.user.id]);
  await audit(req.ctx.org.id, req.ctx.user.id, 'apikey.created', { name });
  res.status(201).json({ ...row, secret });
}));
router.delete('/org/keys/:id', requireRealOwner, ah(async (req, res) => {
  await q('update api_keys set revoked_at=now() where id=$1 and org_id=$2', [uuid(req.params.id), req.ctx.org.id]);
  await audit(req.ctx.org.id, req.ctx.user.id, 'apikey.revoked', { id: req.params.id });
  res.json({ ok: true });
}));

router.get('/org/audit', requireRealOwner, ah(async (req, res) => {
  res.json(await many(`select a.action, a.detail, a.created_at, u.name as user_name from audit a left join users u on u.id=a.user_id where a.org_id=$1 order by a.id desc limit 200`, [req.ctx.org.id]));
}));

// ---- billing ----
router.post('/billing/checkout', requireRealOwner, ah(async (req, res) => {
  const plan = req.body.plan;
  if (!SELLABLE.includes(plan)) throw new HttpError(400, 'Choose Starter, Professional or Business.');
  const price = config.stripePrices[plan];
  if (!billingReady() || !price) throw new HttpError(503, "Online billing isn't switched on yet. Contact IoBeacons to change plans.");
  const { org, user } = req.ctx;
  let customer = org.stripe_customer_id;
  if (!customer) {
    customer = (await stripe('POST', 'customers', { email: user.email, name: org.name, metadata: { org_id: org.id } })).id;
    await q('update orgs set stripe_customer_id=$2 where id=$1', [org.id, customer]);
  }
  const session = await stripe('POST', 'checkout/sessions', {
    mode: 'subscription', customer, client_reference_id: org.id,
    line_items: { 0: { price, quantity: 1 } },
    subscription_data: { metadata: { org_id: org.id } },
    allow_promotion_codes: true,
    success_url: `${config.publicUrl}/#settings=billing&checkout=done`,
    cancel_url: `${config.publicUrl}/#settings=billing`,
  });
  res.json({ url: session.url });
}));

router.post('/billing/portal', requireRealOwner, ah(async (req, res) => {
  if (!req.ctx.org.stripe_customer_id) throw new HttpError(400, 'There is no billing account yet. Choose a plan first.');
  const s = await stripe('POST', 'billing_portal/sessions', { customer: req.ctx.org.stripe_customer_id, return_url: `${config.publicUrl}/#settings=billing` });
  res.json({ url: s.url });
}));

// Called by Stripe. Mounted with a raw body parser in app.js.
export async function stripeWebhook(req, res, next) {
  try {
    const event = verifyWebhook(req.body.toString('utf8'), req.headers['stripe-signature']);
    const obj = event.data?.object || {};
    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
      const sub = await stripe('GET', `subscriptions/${obj.subscription}`);
      const plan = planForPrice(sub.items?.data?.[0]?.price?.id);
      await q('update orgs set plan=coalesce($2,plan), subscription_status=$3, stripe_subscription_id=$4, stripe_customer_id=$5 where id=$1', [obj.client_reference_id, plan, sub.status, sub.id, obj.customer]);
      await audit(obj.client_reference_id, null, 'billing.subscribed', { plan, status: sub.status });
    }
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const plan = planForPrice(obj.items?.data?.[0]?.price?.id);
      const status = event.type.endsWith('deleted') ? 'canceled' : obj.status;
      const org = await one('select id from orgs where stripe_subscription_id=$1 or stripe_customer_id=$2', [obj.id, obj.customer]);
      if (org) {
        await q('update orgs set plan=coalesce($2,plan), subscription_status=$3 where id=$1', [org.id, plan, status]);
        await audit(org.id, null, 'billing.updated', { plan, status });
      }
    }
    res.json({ received: true });
  } catch (e) { next(e); }
}

// ---- IoBeacons staff ----
router.get('/admin/orgs', requireUser, requireStaff, ah(async (req, res) => {
  const rows = await many(`select o.id, o.name, o.slug, o.plan, o.trial_ends_at, o.subscription_status, o.is_demo, o.created_at,
      (select count(*) from memberships m where m.org_id=o.id)::int members,
      (select count(*) from maps where org_id=o.id)::int maps,
      (select count(*) from features where org_id=o.id)::int features,
      (select coalesce(sum(count),0) from usage u where u.org_id=o.id and u.period=to_char(now(),'YYYY-MM') and metric='mapViews')::int views
    from orgs o order by o.created_at desc limit 500`);
  res.json(rows.map((r) => ({ ...r, effective: effectivePlanKey(r) })));
}));
router.patch('/admin/orgs/:id', requireUser, requireStaff, ah(async (req, res) => {
  const plan = req.body.plan;
  if (plan && !PLANS[plan]) throw new HttpError(400, 'Unknown plan.');
  const days = req.body.extend_trial_days ? Number(req.body.extend_trial_days) : null;
  await q(`update orgs set plan=coalesce($2,plan), subscription_status=case when $2 is null then subscription_status else null end,
           trial_ends_at=case when $3::int is null then trial_ends_at else greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => $3::int) end where id=$1`, [uuid(req.params.id), plan || null, days]);
  await audit(req.params.id, req.ctx.user.id, 'staff.plan', { plan, days });
  res.json({ ok: true });
}));
