# IoBeacons Maps

A self-serve GIS workspace: build maps, add live public data, track devices,
get alerts, and run site reports. Sold as a subscription (Starter, Professional,
Business, Enterprise) with an open demo that needs no sign-in.

## What it does

- **Map builder.** MapLibre maps with streets, light, dark, satellite and terrain
  basemaps, 3D terrain and buildings, and a globe view. Draw points, lines,
  polygons, rectangles, circles and freehand shapes; measure distance and area;
  edit shapes and their attributes.
- **Your data.** Upload GeoJSON, KML, KMZ, GPX, zipped shapefiles and CSV
  (coordinates or addresses). Style by one color, category, number, heatmap,
  clusters or 3D extrusion. Export GeoJSON, CSV or KML. Large layers are served
  as vector tiles straight from PostGIS.
- **Live data catalog.** NWS warnings, NEXRAD radar, USGS earthquakes,
  hillshade, FEMA flood zones, wildfire perimeters, Census boundaries, and
  power lines, pipelines and towers.
- **Operations.** Sites, devices with position history, polygon or circle alert
  zones, and alert rules (zone exit or entry, speeding, offline, NWS warnings
  at sites, nearby earthquakes) sent by email, text or signed webhook.
- **Site reports.** Weather, warnings, elevation, flood zone, soil,
  demographics, hazards, infrastructure and your own data for any point, with
  a PDF.
- **Business.** Workspaces with owner, editor and viewer roles, invitations,
  plans and limits, monthly usage, Stripe Checkout and Billing Portal, API keys
  (`/api/v1`), share links, embeds, white label branding and custom domains,
  an activity log, and a staff view of all workspaces.

## Run it locally

Needs Node 22 and PostgreSQL 16 with PostGIS 3.

```sh
npm install
createdb iobmaps            # then: psql -d iobmaps -c 'create extension postgis'
export DATABASE_URL=postgres://localhost/iobmaps
npm run dev                 # builds the client and starts on http://localhost:3120/maps/
```

The open demo workspace is created on first start and reset every 24 hours.
`OFFLINE=1` switches off every outside data source (useful for tests).

## Tests

```sh
createdb iobmaps_test
TEST_DATABASE_URL=postgres://localhost/iobmaps_test npm test
```

The tests drive the HTTP API end to end: the demo, sign-up and sign-in,
workspace isolation, maps and layers, uploads, exports, vector tiles, zones and
alerts, reports and PDFs, share links, API keys, plan limits and invitations.

## Deploy

`deploy/install.sh` installs or updates the app on Ubuntu 24.04 with nginx and
Node 22: PostgreSQL and PostGIS, a system user, the database, a systemd service
on 127.0.0.1:3120, an nginx `location ^~ /maps/` block (with a backup and
`nginx -t`), and daily `pg_dump` backups. Settings live in
`/etc/iobeacons-maps/iobeacons-maps.env` (see `deploy/iobeacons-maps.env.example`).

Before charging customers, add:

- `MAPTILER_KEY` (or another commercial tile and geocoding provider). The
  default OpenFreeMap tiles and Census geocoder are free but have no SLA.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the three `STRIPE_PRICE_*`
  IDs. Point the Stripe webhook at `https://<host>/maps/api/billing/webhook`.
- `SMTP_URL` for email alerts and invitations, and `TWILIO_*` for texts.
- A self-hosted Overpass instance (`OVERPASS_URL`) for the infrastructure
  layer at production volume.

## Layout

```
src/        server: Express routes, services, PostGIS schema, worker
client/     browser app (bundled by esbuild into public/app.js)
public/     HTML shells, CSS, built bundle, vendored MapLibre
deploy/     systemd unit, env example, nginx block, installer, backups
test/       API tests
```
