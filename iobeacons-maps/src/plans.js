// Plans and what each one includes. Prices are display values; Stripe holds the
// real prices (config.stripePrices). "Infinity" means no limit.
const INF = Infinity;

export const PLANS = {
  starter: {
    name: 'Starter', price: '$49/mo',
    limits: { users: 3, maps: 10, features: 25000, mapViews: 25000, devices: 0, reports: 5, apiCalls: 0, zones: 0, rules: 0 },
    features: { draw: true, upload: true, share: true, export: true, catalog: 'standard', geofences: false, alerts: false, sms: false, embeds: false, api: false, whiteLabel: false, customStyles: false, terrain3d: true },
  },
  professional: {
    name: 'Professional', price: '$199/mo',
    limits: { users: 10, maps: INF, features: 500000, mapViews: 250000, devices: 25, reports: 50, apiCalls: 100000, zones: 100, rules: 50 },
    features: { draw: true, upload: true, share: true, export: true, catalog: 'premium', geofences: true, alerts: true, sms: true, embeds: true, api: true, whiteLabel: false, customStyles: true, terrain3d: true },
  },
  business: {
    name: 'Business', price: '$799/mo',
    limits: { users: 50, maps: INF, features: 5000000, mapViews: 1000000, devices: 250, reports: 500, apiCalls: 1000000, zones: 1000, rules: 500 },
    features: { draw: true, upload: true, share: true, export: true, catalog: 'premium', geofences: true, alerts: true, sms: true, embeds: true, api: true, whiteLabel: true, customStyles: true, terrain3d: true },
  },
  enterprise: {
    name: 'Enterprise', price: 'Custom',
    limits: { users: INF, maps: INF, features: INF, mapViews: INF, devices: INF, reports: INF, apiCalls: INF, zones: INF, rules: INF },
    features: { draw: true, upload: true, share: true, export: true, catalog: 'premium', geofences: true, alerts: true, sms: true, embeds: true, api: true, whiteLabel: true, customStyles: true, terrain3d: true },
  },
};
// A trial gets Professional for config.trialDays.
PLANS.trial = { ...PLANS.professional, name: 'Professional trial', price: 'Free for 14 days' };
// The open demo: Professional tools, small limits, no team or billing.
PLANS.demo = {
  name: 'Open demo', price: 'Free',
  limits: { users: 0, maps: 25, features: 20000, mapViews: INF, devices: 10, reports: 100, apiCalls: 0, zones: 50, rules: 20 },
  features: { ...PLANS.professional.features, api: false, sms: false },
};
// After a trial ends without a subscription: read-only.
PLANS.expired = {
  name: 'Trial ended', price: '',
  limits: { users: 3, maps: 0, features: 0, mapViews: 1000, devices: 0, reports: 0, apiCalls: 0, zones: 0, rules: 0 },
  features: { draw: false, upload: false, share: true, export: true, catalog: 'standard', geofences: false, alerts: false, sms: false, embeds: false, api: false, whiteLabel: false, customStyles: false, terrain3d: false },
};

export const SELLABLE = ['starter', 'professional', 'business'];

// The plan that currently applies to an org (handles trial expiry).
export function effectivePlanKey(org) {
  if (org.is_demo) return 'demo';
  if (org.plan === 'trial' && org.trial_ends_at && new Date(org.trial_ends_at) < new Date()) return 'expired';
  if (['past_due', 'unpaid', 'canceled'].includes(org.subscription_status) && org.plan !== 'enterprise') return 'expired';
  return PLANS[org.plan] ? org.plan : 'expired';
}
export const planFor = (org) => PLANS[effectivePlanKey(org)];

// JSON can't carry Infinity; send null for "no limit".
export function publicPlan(key) {
  const p = PLANS[key];
  const limits = Object.fromEntries(Object.entries(p.limits).map(([k, v]) => [k, v === INF ? null : v]));
  return { key, name: p.name, price: p.price, limits, features: p.features };
}
