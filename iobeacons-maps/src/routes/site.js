import express from 'express';
import { requireUser, requireStaff, HttpError } from '../auth.js';
import { many, q } from '../db/pool.js';
import { config } from '../config.js';
import { sendEmail } from '../services/notify.js';
import { SPACE_GROUPS, spaceGroup } from '../services/space.js';
import { forwardInquiry } from '../services/fulllobby.js';
import { ah, str, emailOk, rateLimit } from './util.js';

// Things the public iobeacons.com pages use: the contact form and satellites.
export const router = express.Router();

router.get('/space', (_req, res) => res.json(SPACE_GROUPS.map(({ key, name, color, optional }) => ({ key, name, color, optional: Boolean(optional) }))));
router.get('/space/:group', ah(async (req, res) => {
  const g = await spaceGroup(req.params.group);
  if (!g) throw new HttpError(404, 'Unknown satellite group.');
  res.set('Cache-Control', 'public, max-age=1800');
  res.json(g);
}));

router.post('/contact', ah(async (req, res) => {
  rateLimit(`contact:${req.ip}`, 5, 3600e3);
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // bots fill the hidden field
  const name = str(b.name, { name: 'Name', required: true, max: 120 });
  const email = String(b.email || '').trim();
  if (!emailOk(email)) throw new HttpError(400, 'Please enter a valid email address.');
  const message = str(b.message, { name: 'Message', required: true, min: 5, max: 5000 });
  const company = str(b.company, { name: 'Company', max: 160 }) || null;
  const topic = str(b.topic, { name: 'Topic', max: 80 }) || null;
  const page = str(b.page, { name: 'Page', max: 300 }) || null;
  const row = (await q('insert into contact_messages(name, email, company, topic, message, page) values ($1,$2,$3,$4,$5,$6) returning id', [name, email, company, topic, message, page])).rows[0];
  forwardInquiry(row.id).catch(() => {});
  for (const to of config.staffEmails) {
    sendEmail(to, `IoBeacons contact: ${topic || 'General'} from ${name}`, `${name} <${email}>${company ? `\n${company}` : ''}\nTopic: ${topic || 'General'}\n\n${message}`).catch(() => {});
  }
  res.json({ ok: true });
}));

// Public settings the static pages read (for example the Fulllobby chat widget).
router.get('/site-config', (_req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json({ chatWidget: config.fulllobbyWidget || null }); });

router.get('/admin/contact', requireUser, requireStaff, ah(async (_req, res) => {
  res.json(await many('select id, name, email, company, topic, message, page, created_at from contact_messages order by created_at desc limit 300'));
}));
