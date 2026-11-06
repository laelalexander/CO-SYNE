import { config } from './config.js';
import { buildApp } from './app.js';
import { migrate } from './db/migrate.js';
import { ensureDemo } from './db/seed.js';
import { startWorker } from './worker.js';
import { pool } from './db/pool.js';

await migrate();
if (config.demoEnabled) await ensureDemo();

const server = buildApp().listen(config.port, config.host, () => {
  console.log(`IoBeacons Maps listening on http://${config.host}:${config.port}${config.basePath}/`);
});
const stopWorker = config.workerEnabled ? startWorker() : () => {};

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopWorker();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
