import { q, one, many } from '../db/pool.js';
import { deliver } from './notify.js';
import { catalogData } from './catalog.js';
import { planFor } from '../plans.js';

// Alert rule engine. Trigger types:
//   zone_exit / zone_enter  { zone_id, device_id? }   device leaves / enters a zone
//   offline                 { minutes, device_id? }   no report for N minutes
//   speed                   { mph, device_id? }       reported speed above N mph
//   nws_warning             { target: 'sites'|'zones', events?: [...] }  NWS warning area touches a site or zone
//   earthquake              { min_mag, radius_mi }    quake within radius of a site
export const TRIGGER_TYPES = ['zone_exit', 'zone_enter', 'offline', 'speed', 'nws_warning', 'earthquake'];

async function fire(rule, key, title, body, data) {
  const state = rule.state || {};
  state.fired ||= {};
  const last = state.fired[key];
  if (last && Date.now() - last < rule.cooldown_minutes * 60000) return null;
  state.fired[key] = Date.now();
  // keep state small
  const keys = Object.keys(state.fired);
  if (keys.length > 500) for (const k of keys.sort((a, b) => state.fired[a] - state.fired[b]).slice(0, keys.length - 500)) delete state.fired[k];
  await q('update rules set state=$2 where id=$1', [rule.id, state]);
  const alert = await one('insert into alerts(org_id, rule_id, title, body, data) values ($1,$2,$3,$4,$5) returning *', [rule.org_id, rule.id, title, body, data]);
  const org = await one('select * from orgs where id=$1', [rule.org_id]);
  const plan = planFor(org);
  const delivery = org.is_demo ? { note: 'The open demo records alerts but does not send them.' } : await deliver(rule, { id: alert.id, title, body, data, created_at: alert.created_at }, { smsAllowed: plan.features.sms });
  await q('update alerts set delivery=$2 where id=$1', [alert.id, delivery]);
  return alert;
}

// Run device rules right after a new position arrives.
export async function evaluateDevice(orgId, deviceId) {
  const device = await one('select id, name, last_speed_mph, ST_X(last_geom) lon, ST_Y(last_geom) lat from devices where id=$1 and org_id=$2', [deviceId, orgId]);
  if (!device || device.lon === null) return [];
  const rules = await many(`select * from rules where org_id=$1 and enabled and trigger->>'type' in ('zone_exit','zone_enter','speed','offline')
                            and (trigger->>'device_id' is null or trigger->>'device_id' = $2)`, [orgId, deviceId]);
  const fired = [];
  for (const rule of rules) {
    const t = rule.trigger;
    rule.state ||= {};
    if (t.type === 'zone_exit' || t.type === 'zone_enter') {
      const z = await one('select name, ST_Covers(geom, ST_SetSRID(ST_MakePoint($2,$3),4326)) inside from zones where id=$1 and org_id=$4', [t.zone_id, device.lon, device.lat, orgId]);
      if (!z) continue;
      rule.state.inside ||= {};
      const was = rule.state.inside[deviceId];
      rule.state.inside[deviceId] = z.inside;
      await q('update rules set state=$2 where id=$1', [rule.id, rule.state]);
      if (was === undefined) continue; // first fix only sets the baseline
      if (t.type === 'zone_exit' && was && !z.inside) {
        const a = await fire(rule, `exit:${deviceId}`, `${device.name} left ${z.name}`, `${device.name} left the zone "${z.name}" at ${device.lat.toFixed(5)}, ${device.lon.toFixed(5)}.`, { device_id: deviceId, zone_id: t.zone_id, lon: device.lon, lat: device.lat });
        if (a) fired.push(a);
      }
      if (t.type === 'zone_enter' && !was && z.inside) {
        const a = await fire(rule, `enter:${deviceId}`, `${device.name} entered ${z.name}`, `${device.name} entered the zone "${z.name}" at ${device.lat.toFixed(5)}, ${device.lon.toFixed(5)}.`, { device_id: deviceId, zone_id: t.zone_id, lon: device.lon, lat: device.lat });
        if (a) fired.push(a);
      }
    }
    if (t.type === 'speed' && device.last_speed_mph > Number(t.mph)) {
      const a = await fire(rule, `speed:${deviceId}`, `${device.name} is over ${t.mph} mph`, `${device.name} reported ${Math.round(device.last_speed_mph)} mph.`, { device_id: deviceId, speed_mph: device.last_speed_mph });
      if (a) fired.push(a);
    }
    if (t.type === 'offline' && rule.state.offline?.[deviceId]) {
      rule.state.offline[deviceId] = false; // back online
      await q('update rules set state=$2 where id=$1', [rule.id, rule.state]);
    }
  }
  return fired;
}

async function checkOffline() {
  const rules = await many(`select * from rules where enabled and trigger->>'type'='offline'`);
  for (const rule of rules) {
    const mins = Math.max(1, Number(rule.trigger.minutes) || 30);
    const devices = await many(`select id, name, last_seen_at from devices where org_id=$1 and last_seen_at is not null
                                and last_seen_at < now() - make_interval(mins => $2) and ($3::uuid is null or id=$3::uuid)`, [rule.org_id, mins, rule.trigger.device_id || null]);
    rule.state ||= {}; rule.state.offline ||= {};
    for (const d of devices) {
      if (rule.state.offline[d.id]) continue;
      rule.state.offline[d.id] = true;
      await q('update rules set state=$2 where id=$1', [rule.id, rule.state]);
      await fire(rule, `offline:${d.id}:${new Date(d.last_seen_at).getTime()}`, `${d.name} is offline`, `${d.name} hasn't reported for more than ${mins} minutes (last seen ${new Date(d.last_seen_at).toISOString()}).`, { device_id: d.id });
    }
  }
}

async function checkNws() {
  const rules = await many(`select * from rules where enabled and trigger->>'type'='nws_warning'`);
  if (!rules.length) return;
  let feed;
  try { feed = await catalogData('nws-warnings'); } catch { return; }
  for (const rule of rules) {
    const events = (rule.trigger.events || []).map((e) => e.toLowerCase());
    const table = rule.trigger.target === 'zones' ? 'zones' : 'sites';
    const geomCol = table === 'sites' ? 'coalesce(boundary, geom)' : 'geom';
    for (const w of feed.features) {
      if (events.length && !events.some((e) => (w.properties.event || '').toLowerCase().includes(e))) continue;
      const hits = await many(`select id, name from ${table} where org_id=$1 and ST_Intersects(${geomCol}, ST_SetSRID(ST_GeomFromGeoJSON($2),4326))`, [rule.org_id, JSON.stringify(w.geometry)]);
      for (const h of hits) {
        await fire(rule, `nws:${w.properties.id}:${h.id}`, `${w.properties.event}: ${h.name}`, `${w.properties.headline || w.properties.event}\nAffects: ${h.name}\nUntil: ${w.properties.expires || 'see NWS'}`, { warning: w.properties, [table.slice(0, -1) + '_id']: h.id });
      }
    }
  }
}

async function checkQuakes() {
  const rules = await many(`select * from rules where enabled and trigger->>'type'='earthquake'`);
  if (!rules.length) return;
  let feed;
  try { feed = await catalogData('earthquakes'); } catch { return; }
  for (const rule of rules) {
    const minMag = Number(rule.trigger.min_mag ?? 3); const radiusM = Number(rule.trigger.radius_mi ?? 50) * 1609.34;
    for (const eq of feed.features.filter((f) => (f.properties.mag ?? 0) >= minMag)) {
      const [lon, lat] = eq.geometry.coordinates;
      const hits = await many(`select id, name, round((ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography)/1609.34)::numeric,1) mi
                               from sites where org_id=$1 and ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4)`, [rule.org_id, lon, lat, radiusM]);
      for (const h of hits) {
        await fire(rule, `eq:${eq.properties.url}:${h.id}`, `M${eq.properties.mag} earthquake near ${h.name}`, `${eq.properties.place}, ${h.mi} mi from ${h.name}.`, { quake: eq.properties, site_id: h.id });
      }
    }
  }
}

export async function runScheduledChecks() {
  for (const fn of [checkOffline, checkNws, checkQuakes]) {
    try { await fn(); } catch (e) { console.error(`[alerts] ${fn.name}:`, e.message); }
  }
}
