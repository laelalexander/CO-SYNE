import { config } from './config.js';
import { one, q } from './db/pool.js';
import { runScheduledChecks } from './services/alerts.js';
import { pruneCache } from './services/fetcher.js';
import { seedDemo } from './db/seed.js';

// Background jobs, run inside the web process to keep memory low on a shared server.
export async function tick() {
  await runScheduledChecks();
  await pruneCache().catch(() => {});
  await q("delete from positions where recorded_at < now() - interval '90 days'").catch(() => {});
  await q('delete from sessions where expires_at < now()').catch(() => {});
  if (config.demoEnabled) {
    const last = await one("select (value #>> '{}')::timestamptz as at from meta where key='demo_reset_at'");
    if (!last || Date.now() - new Date(last.at).getTime() > config.demoResetHours * 3600e3) await seedDemo();
  }
}

export function startWorker() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await tick(); } catch (e) { console.error('[worker]', e.message); } finally { running = false; }
  };
  const timer = setInterval(run, config.workerIntervalSec * 1000);
  setTimeout(run, 5000);
  return () => clearInterval(timer);
}
