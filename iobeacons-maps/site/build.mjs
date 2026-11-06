// Builds the static iobeacons.com pages into site/dist.
//   node site/build.mjs
// Each page in pages.mjs becomes <path>/index.html with the shared header,
// footer, styles and sharing tags. site/public is copied over as-is.
import { mkdir, writeFile, cp, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, SITE } from './pages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
await rm(dist, { recursive: true, force: true });
await cp(path.join(here, 'public'), dist, { recursive: true });

const hash = async (f) => createHash('sha1').update(await readFile(path.join(dist, f))).digest('hex').slice(0, 10);
const v = { css: await hash('site-assets/site.css'), js: await hash('site-assets/site-header.js') };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function layout(p) {
  const url = SITE.origin + p.path;
  const title = p.path === '/' ? p.title : `${p.title} | IoBeacons`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="IoBeacons">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE.origin}/site-assets/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#ff713d">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%23ff713d'/%3E%3Ccircle cx='16' cy='16' r='5' fill='none' stroke='%23fff' stroke-width='3'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/site-assets/site.css?v=${v.css}">
${p.head || ''}${p.noindex ? '<meta name="robots" content="noindex">\n' : ''}</head>
<body data-page="${esc(p.key)}">
<div data-site-header${p.current ? ` data-current="${p.current}"` : ''}></div>
<main id="main">
${p.body.trim()}
</main>
<div data-site-footer></div>
<script type="module" src="/site-assets/site-header.js?v=${v.js}"></script>
${p.script ? `<script>${p.script}</script>\n` : ''}</body>
</html>
`;
}

for (const p of PAGES) {
  const file = p.file || path.join(p.path.replace(/^\//, ''), 'index.html');
  await mkdir(path.dirname(path.join(dist, file)), { recursive: true });
  await writeFile(path.join(dist, file), layout(p));
}

// Old addresses that now live elsewhere.
const REDIRECTS = { 'satellite/': '/platform/space/', 'observe/': '/platform/space/', 'download/': '/network/#tracker', 'admin-signin/': '/maps/#signin' };
for (const [from, to] of Object.entries(REDIRECTS)) {
  await mkdir(path.join(dist, from), { recursive: true });
  await writeFile(path.join(dist, from, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Moved</title><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${to}"><link rel="canonical" href="${SITE.origin}${to}"><script>location.replace(${JSON.stringify(to)} + location.search)</script><a href="${to}">Continue</a>\n`);
}

const listed = PAGES.filter((p) => !p.noindex);
await writeFile(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...listed.map((p) => p.path), '/maps/', '/maps-roadmap/', '/featured-projects/'].map((u) => `  <url><loc>${SITE.origin}${u}</loc></url>`).join('\n')}
</urlset>
`);
await writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /maps/api/\nSitemap: ${SITE.origin}/sitemap.xml\n`);
console.log(`site: ${PAGES.length} pages, ${Object.keys(REDIRECTS).length} redirects -> ${path.relative(process.cwd(), dist)}`);
