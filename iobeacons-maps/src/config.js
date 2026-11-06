// Central configuration, read once from environment variables.
// Every external service is optional: when a key is missing the matching
// feature shows a clear "not set up yet" message instead of failing.
const env = process.env;
const bool = (v, d = false) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

let basePath = (env.BASE_PATH ?? '/maps').replace(/\/+$/, '');
if (basePath && !basePath.startsWith('/')) basePath = '/' + basePath;

export const config = {
  port: num(env.PORT, 3120),
  host: env.HOST || '127.0.0.1',
  basePath, // app is served under this prefix, e.g. https://iobeacons.com/maps
  publicUrl: (env.PUBLIC_URL || `http://localhost:${num(env.PORT, 3120)}${basePath}`).replace(/\/+$/, ''),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres@localhost:5433/iobmaps?host=/tmp',
  cookieSecure: bool(env.COOKIE_SECURE, false),
  sessionDays: num(env.SESSION_DAYS, 30),
  // Open demo workspace: anyone can use it without signing in.
  demoEnabled: bool(env.DEMO_ENABLED, true),
  demoResetHours: num(env.DEMO_RESET_HOURS, 24),
  // Staff accounts (IoBeacons team) by email, comma separated.
  staffEmails: (env.STAFF_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Basemaps
  maptilerKey: env.MAPTILER_KEY || '',
  openFreeMapUrl: env.OPENFREEMAP_URL || 'https://tiles.openfreemap.org',
  // Geocoding: census (free, US), maptiler (needs key), nominatim (dev only)
  geocoder: env.GEOCODER || (env.MAPTILER_KEY ? 'maptiler' : 'census'),
  nominatimUrl: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  overpassUrl: env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  userAgent: env.HTTP_USER_AGENT || 'IoBeaconsMaps/0.1 (https://iobeacons.com/contact/)',
  // Notifications
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'IoBeacons Maps <alerts@iobeacons.com>',
  twilioSid: env.TWILIO_ACCOUNT_SID || '',
  twilioToken: env.TWILIO_AUTH_TOKEN || '',
  twilioFrom: env.TWILIO_FROM || '',
  // Billing (Stripe). Prices are Stripe Price IDs for each plan.
  stripeSecret: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  stripePrices: {
    starter: env.STRIPE_PRICE_STARTER || '',
    professional: env.STRIPE_PRICE_PROFESSIONAL || '',
    business: env.STRIPE_PRICE_BUSINESS || '',
  },
  trialDays: num(env.TRIAL_DAYS, 14),
  // Background jobs
  workerEnabled: bool(env.WORKER_ENABLED, true),
  workerIntervalSec: num(env.WORKER_INTERVAL_SEC, 60),
  // Uploads
  maxUploadMb: num(env.MAX_UPLOAD_MB, 25),
  // External fetches can be switched off entirely (tests, offline demos)
  offline: bool(env.OFFLINE, false),
};

export const url = (p = '') => `${config.basePath}${p}`;
