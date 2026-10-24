// Browser end-to-end check of the three apps, each in its own browser
// context (separate storage, like separate computers): the officer scans a
// sticker, the driver gets the pull-over alert and accepts video, dispatch
// drops in, the officer issues a citation, the driver acknowledges and pays,
// and the officer files the report.
// Usage: start the server, then `npm run test:browser [screenshotDir]`.
// BASE_URL can point at a deployment, e.g. https://iobeacons.com/cosyne
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHOTS = process.argv[2] ?? 'screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const DRIVER = process.env.DRIVER ?? 'maria-gonzalez';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const step = (t) => console.log(`· ${t}`);

async function app(name, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['camera', 'microphone'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|tile\.openstreetmap|Failed to load resource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await p.goto(`${BASE}/${name}/`);
  return p;
}
const until = (p, fn, arg, timeout = 15000) => p.waitForFunction(fn, arg, { timeout });

const dispatch = await app('dispatch', 1700, 980);
await dispatch.fill('#login-form [name=name]', 'J. Morgan');
await dispatch.click('#login-form button');
await dispatch.waitForSelector('#ops');
step('dispatch signed in');

const officer = await app('officer', 1600, 960);
await officer.click('#pick [data-k="dana-rivera"]');
await officer.waitForSelector('#desktop:not(.hidden)');
step('officer terminal signed in');

const driver = await app('driver', 1100, 920);
await driver.click('#w-demo');
await driver.click(`#sheet [data-sample="${DRIVER}"]`);
await until(driver, () => window.cosyne.S.session?.online);
await driver.screenshot({ path: `${SHOTS}/01-driver-home.png` });
step('driver phone signed in');

// Officer scans the sticker (the real QR image is decoded in the browser).
const stickerId = await officer.evaluate((k) => window.cosyne.S.samples.drivers.find((d) => d.key === k).stickerId, DRIVER);
await officer.evaluate((id) => window.cosyne.simulateScan(id), stickerId);
await officer.waitForSelector('#scan-go');
await officer.selectOption('#scan-reason', 'Expired registration');
await officer.screenshot({ path: `${SHOTS}/02-officer-scan.png` });
await officer.click('#scan-go');
step('sticker scanned, stop opened');

await driver.waitForSelector('#po-accept', { timeout: 10000 });
await driver.waitForTimeout(400);
await driver.screenshot({ path: `${SHOTS}/03-driver-pulled-over.png` });
await driver.click('#po-accept');
step('driver accepted the video call');

await until(officer, () => window.cosyne.S.call?.peers.size >= 1);
await until(driver, () => (window.cosyne.S.callPeers ?? []).length >= 1);
await driver.waitForTimeout(1200);
await driver.screenshot({ path: `${SHOTS}/04-driver-call.png` });
step('video connected officer <-> driver');

// Dispatch drops in.
const stopId = await officer.evaluate(() => [...window.cosyne.S.stops.keys()][0]);
await until(dispatch, (id) => window.cosyne.S.state?.stops.some((s) => s.id === id), stopId);
await dispatch.evaluate((id) => window.cosyne.select(id), stopId);
await dispatch.click('#d-drop');
await until(officer, () => window.cosyne.S.call?.peers.size >= 2);
await until(dispatch, () => window.cosyne.S.call?.peers.size >= 2);
await dispatch.waitForTimeout(1200);
await dispatch.screenshot({ path: `${SHOTS}/05-dispatch-dropin.png` });
step('dispatch dropped in (3-way)');

// Text from the officer reaches the driver.
await officer.fill('#h-chat-in', 'Ms. Gonzalez, your tag expired 8/31. I am issuing a citation; you can renew online.');
await officer.press('#h-chat-in', 'Enter');
await until(driver, () => window.cosyne.S.chat?.some((m) => /tag expired/.test(m.text)));
step('text message delivered');

await until(officer, () => document.querySelector('#t-viol input:checked'));
await officer.waitForTimeout(800);
await officer.screenshot({ path: `${SHOTS}/06-officer-console.png` });
await officer.click('#t-issue');
await until(driver, () => window.cosyne.S.citations.size >= 1);
step('citation signed and delivered');

const citId = await driver.evaluate(() => [...window.cosyne.S.citations.keys()][0]);
await driver.evaluate((id) => window.cosyne.citationAction(id, 'ack'), citId);
await driver.evaluate((id) => window.cosyne.pay(id), citId);
await until(officer, () => [...window.cosyne.S.stops.values()][0].citations?.[0]?.status === 'paid');
step('driver acknowledged and paid (simulated)');

await officer.click('#r-file');
await until(officer, () => [...window.cosyne.S.stops.values()][0].reportId);
await driver.waitForSelector('#done-close', { timeout: 10000 });
await driver.screenshot({ path: `${SHOTS}/07-driver-done.png` });
await officer.waitForTimeout(600);
await officer.screenshot({ path: `${SHOTS}/08-officer-report-filed.png` });
step('report filed, stop closed');

await until(dispatch, (id) => window.cosyne.S.state.stops.find((s) => s.id === id)?.reportId, stopId);
await dispatch.evaluate(() => { window.cosyne.S.view = 'docs'; window.cosyne.render(); });
await dispatch.waitForSelector('[data-r]');
await dispatch.screenshot({ path: `${SHOTS}/09-dispatch-docs.png` });
step('dispatch sees citation and report');

// Records lookup from the officer terminal.
await officer.evaluate(() => window.cosyne.openApp('records', { q: 'MGZ-452' }));
await officer.waitForSelector('.rec');
await officer.screenshot({ path: `${SHOTS}/10-officer-records.png` });
step('records lookup');

const verify = await (await fetch(`${BASE}/api/ledger/verify`)).json();
console.log(`ledger: ${verify.length} entries, ${verify.ok ? 'intact' : 'BROKEN'}`);
await browser.close();
if (errors.length) { console.error('Page errors:\n' + errors.join('\n')); process.exit(1); }
if (!verify.ok) process.exit(1);
console.log('Browser end-to-end: PASS');
