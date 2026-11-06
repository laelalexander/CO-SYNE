-- IoBeacons Maps schema. Every customer record carries org_id so each
-- organization's data stays private. Idempotent: safe to run on every start.
create extension if not exists postgis;
create extension if not exists pgcrypto;

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  plan text not null default 'trial',
  trial_ends_at timestamptz,
  subscription_status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  brand jsonb not null default '{}',
  custom_domain text unique,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null default '',
  password_hash text,
  is_staff boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists memberships (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','editor','viewer')),
  token_hash text not null unique,
  invited_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,                 -- sha256 of the cookie token
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid references orgs(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  created_by uuid references users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists maps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  description text not null default '',
  style text not null default 'streets',
  view jsonb not null default '{"center":[-95.99,36.15],"zoom":10,"pitch":0,"bearing":0}',
  settings jsonb not null default '{}',
  visibility text not null default 'team' check (visibility in ('private','team','link','public')),
  share_token text unique,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists maps_org on maps(org_id);

create table if not exists layers (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references maps(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('features','catalog')),
  catalog_key text,
  style jsonb not null default '{}',
  visible boolean not null default true,
  position int not null default 0,
  source_file text,
  created_at timestamptz not null default now()
);
create index if not exists layers_map on layers(map_id);

create table if not exists features (
  id bigserial primary key,
  layer_id uuid not null references layers(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  geom geometry(Geometry, 4326) not null,
  props jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists features_layer on features(layer_id);
create index if not exists features_geom on features using gist(geom);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  address text not null default '',
  geom geometry(Point, 4326) not null,
  boundary geometry(Geometry, 4326),
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists sites_org on sites(org_id);
create index if not exists sites_geom on sites using gist(geom);

create table if not exists zones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  color text not null default '#d9781a',
  geom geometry(Geometry, 4326) not null,
  created_at timestamptz not null default now()
);
create index if not exists zones_org on zones(org_id);
create index if not exists zones_geom on zones using gist(geom);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  external_id text,
  kind text not null default 'tracker',
  last_geom geometry(Point, 4326),
  last_speed_mph real,
  last_seen_at timestamptz,
  props jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (org_id, external_id)
);

create table if not exists positions (
  id bigserial primary key,
  device_id uuid not null references devices(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  geom geometry(Point, 4326) not null,
  speed_mph real,
  heading real,
  recorded_at timestamptz not null default now()
);
create index if not exists positions_device_time on positions(device_id, recorded_at desc);

create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  trigger jsonb not null,
  channels jsonb not null default '{"emails":[],"sms":[],"webhooks":[]}',
  cooldown_minutes int not null default 30,
  state jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id bigserial primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  rule_id uuid references rules(id) on delete set null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}',
  delivery jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists alerts_org_time on alerts(org_id, created_at desc);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  title text not null,
  lon double precision not null,
  lat double precision not null,
  radius_mi real not null default 1,
  data jsonb not null default '{}',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists usage (
  org_id uuid not null references orgs(id) on delete cascade,
  period text not null,
  metric text not null,
  count bigint not null default 0,
  primary key (org_id, period, metric)
);

create table if not exists audit (
  id bigserial primary key,
  org_id uuid references orgs(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists http_cache (
  key text primary key,
  status int not null,
  content_type text,
  body bytea not null,
  expires_at timestamptz not null
);

create table if not exists meta (key text primary key, value jsonb not null);
