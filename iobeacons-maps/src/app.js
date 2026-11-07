import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { context, HttpError } from './auth.js';
import { router as accountRouter, stripeWebhook } from './routes/account.js';
import { router as mapsRouter } from './routes/maps.js';
import { router as opsRouter } from './routes/ops.js';
import { router as siteRouter, dataRouter } from './routes/site.js';
import * as v1 from './routes/v1.js';
import { router as consoleRouter } from './routes/console.js';
import { router as workspaceRouter } from './routes/workspace.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  const base = express.Router();

  base.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!req.path.startsWith('/embed')) res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  base.post('/api/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), stripeWebhook);
  base.get('/healthz', (_req, res) => res.json({ ok: true }));

  base.use(cookieParser());
  base.use(express.json({ limit: '12mb' }));
  base.use('/api/v1', v1.cors);
  base.use('/api', context);

  // Same routes for the app (/api) and for API key customers (/api/v1).
  base.use('/api/v1', v1.open, v1.guard, v1.router, mapsRouter, opsRouter, dataRouter, workspaceRouter);
  base.use('/api/v1', (_req, _res, next) => next(new HttpError(404, 'No such endpoint. See https://iobeacons.com/developers/api/')));
  base.use('/api', siteRouter, consoleRouter, workspaceRouter, accountRouter, mapsRouter, opsRouter);
  base.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

  base.use(express.static(publicDir, {
    index: 'index.html',
    setHeaders(res, path) {
      if (/\/vendor\//.test(path)) res.set('Cache-Control', 'public, max-age=604800, immutable');
      else res.set('Cache-Control', 'no-cache');
    },
  }));

  base.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') err = new HttpError(413, `That file is too large (limit ${config.maxUploadMb} MB).`);
    if (err.type === 'entity.parse.failed') err = new HttpError(400, "The request body isn't valid JSON.");
    const status = err.status || 500;
    if (status >= 500 && status !== 503) console.error(`[${req.method} ${req.originalUrl}]`, err);
    res.status(status).json({ error: status >= 500 && status !== 503 && status !== 502 ? 'Something went wrong on our side. Please try again.' : err.message, ...(err.extra || {}) });
  });

  app.use(config.basePath || '/', base);
  if (config.basePath) app.get('/', (_req, res) => res.redirect(`${config.basePath}/`));
  return app;
}
