// Opens the CO-SYNE apps as separate frameless app windows (Chrome or Edge
// "--app" mode). Each app gets its own browser profile, so each one keeps its
// own identity like a separate device.
//   npm run app                      -> all three: driver, officer, dispatch
//   npm run app -- officer           -> one app (driver | officer | dispatch)
//   npm run app -- officer --kiosk   -> full screen, for a patrol terminal
// Set COSYNE_SERVER (e.g. https://iobeacons.com/cosyne) to use a remote
// server instead of starting one on this computer.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const kiosk = args.includes('--kiosk');
const which = args.filter((a) => !a.startsWith('--'));
const apps = which.length && !which.includes('all') ? which : ['dispatch', 'officer', 'driver'];
const port = Number(process.env.PORT) || 3000;
const remote = process.env.COSYNE_SERVER?.replace(/\/$/, '');
const base = remote ?? `http://localhost:${port}`;

const WINDOWS = {
  dispatch: { size: '1600,960', pos: '0,0' },
  officer: { size: '1600,960', pos: '60,40' },
  driver: { size: '480,960', pos: '1180,20' },
};

function findBrowser() {
  if (process.env.COSYNE_BROWSER) return process.env.COSYNE_BROWSER;
  const candidates = {
    win32: [
      `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
  }[process.platform] ?? [];
  return candidates.find((p) => p && fs.existsSync(p));
}

async function serverUp() {
  try { return (await fetch(`${base}/api/config`)).ok; } catch { return false; }
}

let server = null;
if (!remote && !(await serverUp())) {
  const { createApp } = await import('../src/app.js');
  server = createApp();
  await server.listen(port);
  console.log(`CO-SYNE server running at http://localhost:${port}`);
} else if (remote && !(await serverUp())) {
  console.log(`Warning: ${remote} is not responding yet.`);
}

const browser = findBrowser();
if (!browser) {
  console.log('No Chrome or Edge found. Open these in a Chromium browser and choose "Install app":');
  for (const a of apps) console.log(`  ${base}/${a}/`);
} else {
  for (const a of apps) {
    const profile = path.join(os.homedir(), '.cosyne-interface', `profile-${a}`);
    fs.mkdirSync(profile, { recursive: true });
    const w = WINDOWS[a] ?? WINDOWS.officer;
    const flags = [
      `--app=${base}/${a}/`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--enable-features=WebAppWindowControlsOverlay', '--autoplay-policy=no-user-gesture-required',
      ...(kiosk && a === 'officer' ? ['--kiosk', '--start-fullscreen'] : [`--window-size=${w.size}`, `--window-position=${w.pos}`]),
    ];
    // Lets camera/mic and device keys work for a plain-http LAN server during a demo.
    if (base.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(base)) flags.push(`--unsafely-treat-insecure-origin-as-secure=${new URL(base).origin}`);
    spawn(browser, flags, { stdio: 'ignore', detached: true }).unref();
    console.log(`Opened ${a} app: ${base}/${a}/`);
  }
  if (server) console.log('The server keeps running while this window is open. Press Ctrl+C to stop it.');
}
process.on('SIGINT', () => (server ? server.close() : Promise.resolve()).then(() => process.exit(0)));
