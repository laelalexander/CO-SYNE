import { createApp } from './app.js';

const app = createApp();
const port = await app.listen(Number(process.env.PORT) || 3000, process.env.HOST);
console.log(`CO-SYNE Interface running at ${app.secure ? 'https' : 'http'}://localhost:${port}`);
console.log(`Apps: /driver/  /officer/  /dispatch/`);
console.log(`Ledger: ${app.ledger.entries.length} entries, integrity ${app.ledger.verify().ok ? 'OK' : 'BROKEN'}`);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
