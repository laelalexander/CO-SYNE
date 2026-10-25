import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

// Web Push to driver phones, so a locked phone or a closed app still gets the
// pull-over alert. VAPID keys are generated on first start and kept in the
// data directory (or set with VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Push
// subscriptions are stored per credential id.
export class PushService {
  constructor({ dataDir, env = {}, sender } = {}) {
    this.file = dataDir ? path.join(dataDir, 'push.json') : null;
    let saved = {};
    if (this.file && fs.existsSync(this.file)) saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.vapid = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      : saved.vapid ?? webpush.generateVAPIDKeys();
    this.subject = env.VAPID_SUBJECT || (env.PUBLIC_URL?.startsWith('https://') ? new URL(env.PUBLIC_URL).origin : 'mailto:admin@cosyne.invalid');
    this.subs = new Map(Object.entries(saved.subscriptions ?? {})); // credentialId -> [subscription]
    this.dead = new Set(saved.dead ?? []); // endpoints the push service reported gone
    this.sender = sender ?? ((sub, body, opts) => webpush.sendNotification(sub, body, { ...opts, vapidDetails: { subject: this.subject, ...this.vapid } }));
    this.sent = 0;
    this.failed = 0;
    if (!saved.vapid && !env.VAPID_PUBLIC_KEY) this.save();
  }

  save() {
    if (!this.file) return;
    const out = { vapid: this.vapid, subscriptions: Object.fromEntries(this.subs), dead: [...this.dead].slice(-500) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(out), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }

  subscribe(credentialId, sub) {
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('invalid push subscription');
    const clean = { endpoint: String(sub.endpoint), keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } };
    // The phone must make a new subscription; the old one will never deliver.
    if (this.dead.has(clean.endpoint)) throw Object.assign(new Error('push subscription expired'), { expired: true });
    // An endpoint belongs to one phone; move it if that phone changed ID.
    for (const [id, list] of this.subs) this.subs.set(id, list.filter((s) => s.endpoint !== clean.endpoint));
    const list = (this.subs.get(credentialId) ?? []).slice(-4); // up to five phones per ID
    list.push(clean);
    this.subs.set(credentialId, list);
    for (const [id, l] of this.subs) if (!l.length) this.subs.delete(id);
    this.save();
  }

  unsubscribe(endpoint) {
    for (const [id, list] of this.subs) {
      const next = list.filter((s) => s.endpoint !== endpoint);
      if (next.length) this.subs.set(id, next); else this.subs.delete(id);
    }
    this.save();
  }

  count() {
    let n = 0;
    for (const l of this.subs.values()) n += l.length;
    return { subscriptions: n, holders: this.subs.size };
  }

  // payload: { title, body, tag, url, kind, stopId, urgent }
  async send(credentialIds, payload) {
    const ids = [...new Set([].concat(credentialIds).filter(Boolean))];
    const targets = ids.flatMap((id) => (this.subs.get(id) ?? []).map((sub) => ({ id, sub })));
    const body = JSON.stringify(payload);
    const opts = { TTL: payload.urgent ? 600 : 3600, urgency: payload.urgent ? 'high' : 'normal', topic: payload.tag ? String(payload.tag).replace(/[^\w-]/g, '').slice(0, 32) : undefined };
    let gone = false;
    await Promise.all(targets.map(async ({ sub }) => {
      try { await this.sender(sub, body, opts); this.sent++; } catch (err) {
        this.failed++;
        this.lastError = { at: new Date().toISOString(), status: err.statusCode ?? null, message: String(err.body || err.message).slice(0, 200) };
        // The phone uninstalled the app or revoked permission.
        if (err.statusCode === 404 || err.statusCode === 410) { this.dead.add(sub.endpoint); this.unsubscribe(sub.endpoint); gone = true; }
      }
    }));
    if (gone) this.save();
    return targets.length;
  }

  async sendAll(payload) {
    return this.send([...this.subs.keys()], payload);
  }
}
