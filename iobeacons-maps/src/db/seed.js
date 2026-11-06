import { one, q, pool } from './pool.js';
import { migrate } from './migrate.js';
import { clearDemoCache } from '../auth.js';

// Sample content for new workspaces and the open demo (Tulsa, Oklahoma).
// Everything here is example data and is labelled as such in the UI.
const TULSA = { center: [-95.9928, 36.1540], zoom: 11.2, pitch: 0, bearing: 0 };

const SAMPLE_SITES = [
  ['Riverside Depot', '2100 S Riverside Dr, Tulsa, OK', -95.9846, 36.1294],
  ['Pump Station 4', '4500 W 23rd St, Tulsa, OK', -96.0389, 36.1257],
  ['North Yard', '3200 N Peoria Ave, Tulsa, OK', -95.9757, 36.2007],
  ['Brookside Office', '3500 S Peoria Ave, Tulsa, OK', -95.9760, 36.1160],
  ['East Distribution Center', '11500 E 41st St, Tulsa, OK', -95.8487, 36.1077],
  ['Airport Hangar 7', '7777 E Apache St, Tulsa, OK', -95.8952, 36.1886],
];

const NORTH_YARD_ZONE = { type: 'Polygon', coordinates: [[[-95.9826, 36.1968], [-95.9688, 36.1968], [-95.9688, 36.2046], [-95.9826, 36.2046], [-95.9826, 36.1968]]] };

const SAMPLE_ROUTE = {
  type: 'LineString',
  coordinates: [[-95.9846, 36.1294], [-95.9862, 36.1405], [-95.9921, 36.1532], [-95.9850, 36.1650], [-95.9757, 36.1800], [-95.9757, 36.2007]],
};
const SERVICE_AREA = {
  type: 'Polygon',
  coordinates: [[[-96.06, 36.10], [-95.93, 36.09], [-95.86, 36.13], [-95.88, 36.21], [-95.98, 36.24], [-96.05, 36.19], [-96.06, 36.10]]],
};

export async function createStarterMap(orgId, userId, { demo = false } = {}) {
  const map = await one(`insert into maps(org_id, name, description, style, view, created_by, visibility)
      values ($1,$2,$3,'streets',$4,$5,'team') returning id`, [orgId, demo ? 'Tulsa operations (sample)' : 'Getting started (sample data)',
    'Sample sites, a service area and a route. Edit, delete or replace them with your own data.', JSON.stringify(TULSA), userId]);
  const lyr = async (name, style, pos, kind = 'features', catalogKey = null) => (await one(
    'insert into layers(map_id, org_id, name, kind, catalog_key, style, position) values ($1,$2,$3,$4,$5,$6,$7) returning id',
    [map.id, orgId, name, kind, catalogKey, style, pos])).id;
  const area = await lyr('Service area (sample)', { color: '#7c3aed', opacity: 0.12, width: 2, mode: 'simple' }, 1);
  const route = await lyr('Delivery route (sample)', { color: '#1f5fbf', opacity: 0.9, width: 4, mode: 'simple' }, 2);
  await lyr('Weather radar', {}, 3, 'catalog', 'radar');
  await lyr('NWS warnings and watches', {}, 4, 'catalog', 'nws-warnings');
  await q('insert into features(layer_id, org_id, geom, props) values ($1,$2,ST_SetSRID(ST_GeomFromGeoJSON($3),4326),$4)', [area, orgId, JSON.stringify(SERVICE_AREA), { name: 'Metro service area' }]);
  await q('insert into features(layer_id, org_id, geom, props) values ($1,$2,ST_SetSRID(ST_GeomFromGeoJSON($3),4326),$4)', [route, orgId, JSON.stringify(SAMPLE_ROUTE), { name: 'Depot to North Yard', miles: 5.4 }]);
  const siteCount = (await one('select count(*)::int n from sites where org_id=$1', [orgId])).n;
  if (!siteCount) {
    for (const [name, address, lon, lat] of SAMPLE_SITES) {
      await q("insert into sites(org_id, name, address, geom, props) values ($1,$2,$3, ST_SetSRID(ST_MakePoint($4,$5),4326), '{\"sample\":true}')", [orgId, name, address, lon, lat]);
    }
  }
  return map.id;
}

export async function seedDemo() {
  let org = await one('select * from orgs where is_demo limit 1');
  if (org) {
    await q('delete from maps where org_id=$1', [org.id]);
    for (const t of ['sites', 'zones', 'devices', 'rules', 'alerts', 'reports']) await q(`delete from ${t} where org_id=$1`, [org.id]);
  } else {
    org = await one("insert into orgs(name, slug, plan, is_demo) values ('Open demo', 'demo', 'professional', true) returning *");
  }
  await createStarterMap(org.id, null, { demo: true });
  const zone = await one("insert into zones(org_id, name, color, geom) values ($1,'North Yard','#d9781a', ST_SetSRID(ST_GeomFromGeoJSON($2),4326)) returning id", [org.id, JSON.stringify(NORTH_YARD_ZONE)]);
  const trucks = [['Truck 12', -95.9757, 36.2000, 18], ['Truck 7', -95.9921, 36.1532, 34], ['Van 3', -95.8487, 36.1080, 0]];
  for (const [name, lon, lat, mph] of trucks) {
    const d = await one("insert into devices(org_id, name, external_id, kind, last_geom, last_speed_mph, last_seen_at) values ($1,$2,$3,'vehicle', ST_SetSRID(ST_MakePoint($4,$5),4326), $6, now()) returning id",
      [org.id, name, name.toLowerCase().replace(/\s+/g, '-'), lon, lat, mph]);
    for (let i = 12; i >= 0; i--) {
      await q("insert into positions(device_id, org_id, geom, speed_mph, recorded_at) values ($1,$2, ST_SetSRID(ST_MakePoint($3,$4),4326), $5, now() - make_interval(mins => $6))",
        [d.id, org.id, lon - i * 0.0011, lat - i * 0.0009, mph, i * 5]);
    }
  }
  await q(`insert into rules(org_id, name, trigger, channels) values
     ($1, 'Truck leaves North Yard', $2, '{"emails":[],"sms":[],"webhooks":[]}'),
     ($1, 'Severe weather at a site', '{"type":"nws_warning","target":"sites","events":["Tornado","Severe Thunderstorm","Flash Flood"]}', '{"emails":[],"sms":[],"webhooks":[]}'),
     ($1, 'Vehicle offline 30 minutes', '{"type":"offline","minutes":30}', '{"emails":[],"sms":[],"webhooks":[]}')`,
  [org.id, JSON.stringify({ type: 'zone_exit', zone_id: zone.id })]);
  await q("insert into meta(key, value) values ('demo_reset_at', to_jsonb(now())) on conflict (key) do update set value=excluded.value");
  clearDemoCache();
  return org.id;
}

export async function ensureDemo() {
  const org = await one('select id from orgs where is_demo limit 1');
  if (!org) return seedDemo();
  return org.id;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(seedDemo).then((id) => { console.log(`Demo workspace ready (${id}).`); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
