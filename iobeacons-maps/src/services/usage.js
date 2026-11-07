import { q, one } from '../db/pool.js';

export const period = (d = new Date()) => d.toISOString().slice(0, 7);

export async function bump(orgId, metric, by = 1) {
  if (!orgId) return;
  const r = await q(`insert into usage(org_id, period, metric, count) values ($1,$2,$3,$4)
           on conflict (org_id, period, metric) do update set count = usage.count + excluded.count returning count`,
  [orgId, period(), metric, by]);
  return Number(r.rows[0]?.count || 0);
}

export async function usageFor(orgId) {
  const rows = (await q('select metric, count from usage where org_id=$1 and period=$2', [orgId, period()])).rows;
  const out = Object.fromEntries(rows.map((r) => [r.metric, Number(r.count)]));
  const counts = await one(`select
      (select count(*) from memberships where org_id=$1)::int as users,
      (select count(*) from maps where org_id=$1)::int as maps,
      (select count(*) from features where org_id=$1)::int as features,
      (select count(*) from devices where org_id=$1)::int as devices,
      (select count(*) from zones where org_id=$1)::int as zones,
      (select count(*) from rules where org_id=$1)::int as rules,
      (select count(*) from sites where org_id=$1)::int as sites`, [orgId]);
  return { ...counts, mapViews: out.mapViews || 0, reports: out.reports || 0, apiCalls: out.apiCalls || 0, period: period() };
}

export async function audit(orgId, userId, action, detail = {}) {
  await q('insert into audit(org_id, user_id, action, detail) values ($1,$2,$3,$4)', [orgId, userId, action, detail]).catch(() => {});
}
