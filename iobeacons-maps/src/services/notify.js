import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { config } from '../config.js';

// Sends one alert to every channel on a rule. Each channel reports its own
// result, so one broken channel never stops the others.
let transport = null;
function mailer() {
  if (!config.smtpUrl) return null;
  transport ||= nodemailer.createTransport(config.smtpUrl);
  return transport;
}

export async function sendEmail(to, subject, text) {
  const t = mailer();
  if (!t) return { ok: false, skipped: 'Email is not set up on this server (SMTP_URL).' };
  await t.sendMail({ from: config.mailFrom, to, subject, text });
  return { ok: true };
}

export async function sendSms(to, text) {
  if (!config.twilioSid || !config.twilioToken || !config.twilioFrom) return { ok: false, skipped: 'SMS is not set up on this server (Twilio).' };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: config.twilioFrom, Body: text.slice(0, 1500) }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok ? { ok: true } : { ok: false, error: `Twilio answered ${res.status}` };
}

export async function sendWebhook(url, payload, secret) {
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret || '').update(body).digest('hex');
  const res = await fetch(url, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'User-Agent': config.userAgent, 'X-IoBeacons-Signature': `sha256=${sig}` },
    signal: AbortSignal.timeout(10000),
  });
  return res.ok ? { ok: true } : { ok: false, error: `Webhook answered ${res.status}` };
}

export async function deliver(rule, alert, { smsAllowed = true } = {}) {
  const ch = rule.channels || {};
  const text = `${alert.title}\n${alert.body}`;
  const out = { emails: [], sms: [], webhooks: [] };
  const attempt = async (list, fn) => Promise.all((list || []).slice(0, 20).map(async (to) => {
    try { return { to, ...(await fn(to)) }; } catch (e) { return { to, ok: false, error: e.message }; }
  }));
  out.emails = await attempt(ch.emails, (to) => sendEmail(to, `[IoBeacons] ${alert.title}`, text));
  out.sms = smsAllowed ? await attempt(ch.sms, (to) => sendSms(to, text)) : (ch.sms || []).map((to) => ({ to, ok: false, skipped: 'SMS needs the Professional plan.' }));
  out.webhooks = await attempt(ch.webhooks, (to) => sendWebhook(to, { type: 'alert', rule: { id: rule.id, name: rule.name }, alert }, ch.webhookSecret));
  return out;
}
