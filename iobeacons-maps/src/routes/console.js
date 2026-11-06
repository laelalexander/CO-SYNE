import express from 'express';
import os from 'node:os';
import { requireUser, requireStaff, HttpError, sha256, token } from '../auth.js';
import { one, many, q } from '../db/pool.js';
import { config } from '../config.js';
import { PLANS, effectivePlanKey } from '../plans.js';
import { sendEmail } from '../services/notify.js';
import { usageFor, audit } from '../services/usage.js';
import { forwardInquiry, fulllobbyReady } from '../services/fulllobby.js';
import { ah, str, uuid } from './util.js';

// The IoBeacons admin console: staff tools for the website and its customers.
export const router = express.Router();
router.use('/console', requireUser, requireStaff);

const STATUSES = ['new', 'forwarded', 'open', 'replied', 'closed'];
const started = Date.now();

router.get('/console/overview', ah(async (_req, res) => {
  const c = await one(`select
      (select count(*) from orgs where not is_demo)::int workspaces,
      (select count(*) from orgs where not is_demo and created_at > now() - interval '7 days')::int workspaces_7d,
      (select count(*) from orgs where not is_demo and plan='trial' and trial_ends_at between now() and now() + interval '7 days')::int trials_ending,
      (select count(*) from orgs where not is_demo and plan in ('starter','professional','business','enterprise'))::int paying,
      (select count(*) from users)::int users,
      (select count(*) from users where created_at > now() - interval '7 days')::int users_7d,
      (select count(distinct user_id) from sessions where expires_at > now())::int signed_in,
      (select count(*) from devices)::int devices,
      (select count(*) from maps)::int maps,
      (select count(*) from contact_messages where status in ('new','forwarded','open'))::int inquiries_open,
      (select count(*) from contact_messages where status='new')::int inquiries_new,
      (select count(*) from contact_messages where created_at > now() - interval '7 days')::int inquiries_7d`);
  const plans = await many("select plan, count(*)::int n from orgs where not is_demo group by plan order by n desc");
  const activity = await many(`select a.action, a.created_at, o.name org, u.email from audit a
      left join orgs o on o.id=a.org_id left join users u on u.id=a.user_id order by a.created_at desc limit 15`);
  const inquiries = await many('select id, name, email, topic, status, created_at from contact_messages order by created_at desc limit 6');
  res.json({ counts: c, plans, activity, inquiries, fulllobby: fulllobbyReady() });
}));

// ---- inquiries from the website ----
router.get('/console/inquiries', ah(async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const search = str(req.query.q, { max: 120 }) || null;
  res.json(await many(`select m.*, u.name assigned_name, u.email assigned_email from contact_messages m left join users u on u.id=m.assigned_to
      where ($1::text is null or m.status=$1) and ($2::text is null or m.name ilike '%'||$2||'%' or m.email ilike '%'||$2||'%' or m.company ilike '%'||$2||'%' or m.message ilike '%'||$2||'%')
      order by m.created_at desc limit 300`, [status, search]));
}));

router.patch('/console/inquiries/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const m = await one('select id from contact_messages where id=$1', [id]);
  if (!m) throw new HttpError(404, 'Inquiry not found.');
  const b = req.body || {};
  if (b.status !== undefined && !STATUSES.includes(b.status)) throw new HttpError(400, 'Unknown status.');
  const assign = b.assigned_to === null ? null : b.assigned_to ? uuid(b.assigned_to, 'assigned_to') : undefined;
  const note = str(b.note, { name: 'Note', max: 4000 });
  await q(`update contact_messages set status=coalesce($2,status), assigned_to=case when $3 then $4::uuid else assigned_to end,
           notes=case when $5::text is null then notes else notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', $6::text, 'text', $5::text)) end,
           updated_at=now() where id=$1`, [id, b.status || null, assign !== undefined, assign ?? null, note || null, req.ctx.user.email]);
  res.json(await one('select * from contact_messages where id=$1', [id]));
}));

router.post('/console/inquiries/:id/reply', ah(async (req, res) => {
  const id = Number(req.params.id);
  const m = await one('select * from contact_messages where id=$1', [id]);
  if (!m) throw new HttpError(404, 'Inquiry not found.');
  const text = str(req.body.message, { name: 'Reply', required: true, min: 2, max: 8000 });
  const sent = await sendEmail(m.email, `Re: ${m.topic || 'your message to IoBeacons'}`, `${text}\n\n— ${req.ctx.user.name || 'The IoBeacons team'}\nIoBeacons · https://iobeacons.com\n\n> ${m.message.split('\n').join('\n> ')}`)
    .catch((e) => ({ ok: false, error: e.message }));
  if (!sent.ok) throw new HttpError(503, sent.skipped ? 'Email is not set up on the server yet (SMTP_URL). Reply from your own mailbox for now.' : `Email failed: ${sent.error}`);
  await q(`update contact_messages set status='replied', updated_at=now(),
           notes = notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', $2::text, 'text', $3::text, 'reply', true)) where id=$1`, [id, req.ctx.user.email, text]);
  res.json({ ok: true });
}));

router.post('/console/inquiries/:id/forward', ah(async (req, res) => {
  const r = await forwardInquiry(Number(req.params.id));
  if (!r.ok) throw new HttpError(502, r.error);
  res.json(r);
}));

// ---- customers (workspaces) ----
router.get('/console/customers', ah(async (req, res) => {
  const search = str(req.query.q, { max: 120 }) || null;
  const rows = await many(`select o.id, o.name, o.slug, o.plan, o.trial_ends_at, o.subscription_status, o.is_demo, o.created_at, o.custom_domain,
      (select u.email from memberships m join users u on u.id=m.user_id where m.org_id=o.id and m.role='owner' order by m.created_at limit 1) owner_email,
      (select count(*) from memberships m where m.org_id=o.id)::int members,
      (select count(*) from maps where org_id=o.id)::int maps,
      (select count(*) from devices where org_id=o.id)::int devices,
      (select max(s.created_at) from sessions s where s.org_id=o.id) last_active
    from orgs o where ($1::text is null or o.name ilike '%'||$1||'%' or o.slug ilike '%'||$1||'%'
      or exists (select 1 from memberships m join users u on u.id=m.user_id where m.org_id=o.id and u.email ilike '%'||$1||'%'))
    order by o.is_demo, o.created_at desc limit 500`, [search]);
  res.json(rows.map((r) => ({ ...r, effective: effectivePlanKey(r) })));
}));

router.get('/console/customers/:id', ah(async (req, res) => {
  const id = uuid(req.params.id);
  const org = await one('select id, name, slug, plan, trial_ends_at, subscription_status, stripe_customer_id, is_demo, created_at, custom_domain, brand from orgs where id=$1', [id]);
  if (!org) throw new HttpError(404, 'Workspace not found.');
  const members = await many(`select u.id, u.email, u.name, m.role, m.created_at,
      (select max(created_at) from sessions s where s.user_id=u.id) last_sign_in from memberships m join users u on u.id=m.user_id where m.org_id=$1 order by m.created_at`, [id]);
  const usage = await usageFor(id);
  const plan = PLANS[effectivePlanKey(org)];
  const activity = await many('select a.action, a.detail, a.created_at, u.email from audit a left join users u on u.id=a.user_id where a.org_id=$1 order by a.created_at desc limit 40', [id]);
  const maps = await many('select id, name, updated_at from maps where org_id=$1 order by updated_at desc limit 20', [id]).catch(() => []);
  res.json({ org: { ...org, effective: effectivePlanKey(org) }, plan: { name: plan?.name, limits: plan?.limits }, members, usage, activity, maps });
}));

router.patch('/console/customers/:id', ah(async (req, res) => {
  const id = uuid(req.params.id);
  const b = req.body || {};
  if (b.plan && !PLANS[b.plan]) throw new HttpError(400, 'Unknown plan.');
  const days = b.extend_trial_days ? Number(b.extend_trial_days) : null;
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new HttpError(400, 'Days must be 1 to 365.');
  const name = str(b.name, { name: 'Name', max: 120 });
  await q(`update orgs set plan=coalesce($2,plan), subscription_status=case when $2 is null then subscription_status else null end,
           trial_ends_at=case when $3::int is null then trial_ends_at else greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => $3::int) end,
           name=coalesce($4,name) where id=$1`, [id, b.plan || null, days, name || null]);
  await audit(id, req.ctx.user.id, 'staff.update', { plan: b.plan, days, name });
  res.json({ ok: true });
}));

// ---- people ----
router.get('/console/users', ah(async (req, res) => {
  const search = str(req.query.q, { max: 120 }) || null;
  res.json(await many(`select u.id, u.email, u.name, u.is_staff, u.created_at,
      (select max(created_at) from sessions s where s.user_id=u.id) last_sign_in,
      coalesce((select json_agg(json_build_object('id', o.id, 'name', o.name, 'role', m.role)) from memberships m join orgs o on o.id=m.org_id where m.user_id=u.id), '[]') orgs
    from users u where ($1::text is null or u.email ilike '%'||$1||'%' or u.name ilike '%'||$1||'%') order by u.created_at desc limit 500`, [search]));
}));

// Makes a one-hour reset link. It is emailed when email is set up, and always
// shown to the staff member so they can pass it on by phone or chat.
router.post('/console/users/:id/reset-link', ah(async (req, res) => {
  const user = await one('select id, email, name from users where id=$1', [uuid(req.params.id)]);
  if (!user) throw new HttpError(404, 'User not found.');
  const t = token();
  await q("insert into password_resets(token_hash, user_id, expires_at) values ($1,$2, now() + interval '1 hour')", [sha256(t), user.id]);
  const link = `${config.publicUrl}/#reset=${t}`;
  const mail = await sendEmail(user.email, 'Reset your IoBeacons password', `Hi ${user.name},\n\nThe IoBeacons team made this link so you can choose a new password. It works for one hour.\n\n${link}\n`).catch(() => ({ ok: false }));
  res.json({ link, emailed: Boolean(mail.ok) });
}));

router.post('/console/users/:id/sign-out', ah(async (req, res) => {
  const r = await q('delete from sessions where user_id=$1', [uuid(req.params.id)]);
  res.json({ ok: true, ended: r.rowCount });
}));

// ---- system ----
router.get('/console/system', ah(async (_req, res) => {
  const db = await one("select pg_database_size(current_database())::bigint size, version() version, (select count(*) from http_cache)::int cache_rows");
  res.json({
    services: [
      { key: 'fulllobby', name: 'Fulllobby (inquiries)', ready: fulllobbyReady(), hint: 'FULLLOBBY_INQUIRY_URL' },
      { key: 'email', name: 'Email (SMTP)', ready: Boolean(config.smtpUrl), hint: 'SMTP_URL' },
      { key: 'sms', name: 'Text messages (Twilio)', ready: Boolean(config.twilioSid && config.twilioToken && config.twilioFrom), hint: 'TWILIO_*' },
      { key: 'billing', name: 'Payments (Stripe)', ready: Boolean(config.stripeSecret), hint: 'STRIPE_*' },
      { key: 'maps', name: 'Commercial basemaps (MapTiler)', ready: Boolean(config.maptilerKey), hint: 'MAPTILER_KEY' },
      { key: 'demo', name: 'Open demo', ready: config.demoEnabled, hint: 'DEMO_ENABLED' },
      { key: 'worker', name: 'Background jobs (alerts, demo reset)', ready: config.workerEnabled, hint: 'WORKER_ENABLED' },
    ],
    server: {
      uptimeMin: Math.round((Date.now() - started) / 60000), node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      load: os.loadavg().map((x) => x.toFixed(2)), freeMemMb: Math.round(os.freemem() / 1048576), totalMemMb: Math.round(os.totalmem() / 1048576),
      dbSizeMb: Math.round(Number(db.size) / 1048576), postgres: db.version.split(' ').slice(0, 2).join(' '), cacheRows: db.cache_rows,
      publicUrl: config.publicUrl, staffEmails: config.staffEmails.length,
    },
  });
}));
