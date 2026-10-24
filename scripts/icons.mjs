// Renders the app icons (SVG) to the PNG sizes the web app manifests need.
//   node scripts/icons.mjs   (requires the playwright dev dependency)
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
const p = await b.newPage();
for (const name of ['driver', 'officer', 'dispatch']) {
  const svg = fs.readFileSync(`public/icons/${name}.svg`, 'utf8');
  for (const size of [192, 512]) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    await p.screenshot({ path: `public/icons/${name}-${size}.png`, omitBackground: true });
  }
}
await b.close();
