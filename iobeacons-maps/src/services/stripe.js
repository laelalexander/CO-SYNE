import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../auth.js';

// Minimal Stripe client over its REST API (no SDK needed).
export const billingReady = () => Boolean(config.stripeSecret);

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

export async function stripe(method, path, params) {
  if (!billingReady()) throw new HttpError(503, "Online billing isn't switched on yet. Contact IoBeacons to change plans.");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.stripeSecret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? form(params) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(502, `Stripe: ${data.error?.message || res.status}`);
  return data;
}

// Verifies the Stripe-Signature header (v1 scheme, 5 minute tolerance).
export function verifyWebhook(rawBody, header, secret = config.stripeWebhookSecret, now = Date.now()) {
  if (!secret) throw new HttpError(503, 'Stripe webhook secret is not set.');
  const parts = Object.fromEntries((header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = (header || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!parts.t || !sigs.length) throw new HttpError(400, 'Missing Stripe signature.');
  if (Math.abs(now / 1000 - Number(parts.t)) > 300) throw new HttpError(400, 'Stripe signature is too old.');
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new HttpError(400, 'Stripe signature does not match.');
  return JSON.parse(rawBody);
}

export const planForPrice = (priceId) => Object.entries(config.stripePrices).find(([, id]) => id && id === priceId)?.[0] || null;
