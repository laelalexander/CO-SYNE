// The public developer API at /api/v1. API keys reach the same routes the app
// uses, plus /me and the OpenAPI description. Calls work from any website
// (CORS), since a key is sent as a header and no cookies are involved.
import { Router } from 'express';
import { config } from '../config.js';
import { HttpError } from '../auth.js';
import { openapi } from '../openapi.js';
import { period } from '../services/usage.js';
import { rateLimit } from './util.js';

// Mounted before the key is checked, so even a bad-key answer reaches the browser.
export function cors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.set('Access-Control-Expose-Headers', 'X-Quota-Limit, X-Quota-Remaining, X-Quota-Period');
  res.set('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

export const open = Router();

let specCache = null;
const spec = () => (specCache ||= openapi(`${config.publicUrl}/api/v1`));
open.get('/openapi.json', (_req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json(spec()); });
open.get('/', (req, res, next) => {
  if (req.ctx.via === 'api') return next();
  res.json({ name: 'IoBeacons API', version: spec().info.version, docs: 'https://iobeacons.com/developers/api/', openapi: `${config.publicUrl}/api/v1/openapi.json`, auth: 'Authorization: Bearer iobm_...' });
});

// Every other call needs a working key on a plan that includes the API.
export function guard(req, res, next) {
  try {
    if (req.ctx.via !== 'api') throw new HttpError(401, 'Use an API key: Authorization: Bearer iobm_...');
    if (!req.ctx.plan.features.api) throw new HttpError(402, `The API comes with the Professional plan. This workspace is on ${req.ctx.plan.name}.`, { upgrade: true });
    rateLimit(`api:${req.ctx.apiKeyId}`, 1200, 60000, 'Too many calls from this key: the limit is 1,200 a minute. Slow down and try again.');
    const limit = req.ctx.plan.limits.apiCalls;
    res.set('X-Quota-Period', period());
    if (Number.isFinite(limit)) {
      res.set('X-Quota-Limit', String(limit));
      res.set('X-Quota-Remaining', String(Math.max(0, limit - req.ctx.apiCalls)));
      if (req.ctx.apiCalls > limit) throw new HttpError(429, `This workspace has used all ${limit.toLocaleString('en-US')} API calls for this month. Upgrade for more, or wait until the 1st.`, { upgrade: true });
    }
    next();
  } catch (e) { next(e); }
}

export const router = Router();
const me = (req, res) => {
  const limit = req.ctx.plan.limits.apiCalls;
  res.json({
    workspace: { id: req.ctx.org.id, name: req.ctx.org.name },
    plan: { key: req.ctx.planKey, name: req.ctx.plan.name },
    key: { id: req.ctx.apiKeyId, name: req.ctx.apiKeyName },
    quota: { period: period(), used: req.ctx.apiCalls, limit: Number.isFinite(limit) ? limit : null },
    docs: 'https://iobeacons.com/developers/api/',
  });
};
router.get('/', me);
router.get('/me', me);
