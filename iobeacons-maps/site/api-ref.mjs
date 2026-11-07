// The API reference page (/developers/api/), built from the same endpoint
// list as the API itself, with code samples and a "Try it" console.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ENDPOINTS } from '../src/openapi.js';

const ver = (f) => createHash('sha1').update(readFileSync(new URL(`./public/site-assets/${f}`, import.meta.url))).digest('hex').slice(0, 10);

const API = 'https://iobeacons.com/maps/api/v1';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const OPEN_TAGS = ['Space', 'Weather']; // work without a key, against the open demo

const TAG_TEXT = {
  Account: 'Check your key, plan and this month\'s usage.',
  Maps: 'Maps hold layers, a saved view and sharing settings.',
  Layers: 'Layers on a map: your own features or live catalog data.',
  Features: 'Points, lines and polygons inside a layer, as GeoJSON.',
  Sites: 'Places that matter to you. Reports and weather alerts use them.',
  Zones: 'Geofences for enter and exit alerts.',
  Devices: 'Vehicles, trackers and sensors, and the positions they send.',
  Alerts: 'Rules that watch zones, sites, devices and live feeds, and the alerts they raised.',
  Reports: 'Site Intelligence Reports for any point.',
  Catalog: 'Live public data layers and address search.',
  Space: 'Satellites and debris: orbital elements, live positions and ground tracks. Try these without a key.',
  Weather: 'Moving radar and Doppler winds. Try these without a key.',
  Notes: 'Notes pinned to places, satellites and maps, shared with your team.',
  Findings: 'Saved views with a note, which you can share by link.',
};

const sample = (p) => p.example ?? (p.name === 'id' || p.name === 'layerId' ? '' : p.name === 'format' ? 'geojson' : p.name === 'z' ? 3 : p.name === 'x' ? 1 : p.name === 'y' ? 3 : '');

function examplePath(path, params) {
  return path.replace(/\{(\w+)\}/g, (_, n) => {
    const p = params.find((x) => x.name === n);
    const v = p && sample(p);
    return v !== '' && v !== undefined ? v : `{${n}}`;
  });
}

function samples(method, path, d) {
  const params = d.params || [];
  const url = API + examplePath(path, params);
  const M = method.toUpperCase();
  const body = d.body ? JSON.stringify(d.body, null, 2) : null;
  let curl = `curl${M === 'GET' ? '' : ` -X ${M}`} "${url}" \\\n  -H "Authorization: Bearer $IOBEACONS_API_KEY"`;
  if (body) curl += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(d.body)}'`;
  if (d.upload) curl += ` \\\n  -F "file=@depots.csv" -F "name=Depots"`;
  if (d.raw) curl += ` \\\n  -o download`;
  const pathArgs = params.filter((p) => p.in === 'path').map((p) => { const v = sample(p); return v === '' ? `'${p.name.toUpperCase()}'` : JSON.stringify(String(v)); });
  const jsArgs = [...pathArgs];
  const pyArgs = [...pathArgs.map((a) => a.replace(/'/g, '"'))];
  if (d.upload) { jsArgs.push('file', "'Depots'"); pyArgs.push('"depots.csv"', 'name="Depots"'); }
  else if (body) { jsArgs.push(JSON.stringify(d.body)); pyArgs.push(JSON.stringify(d.body).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')); }
  const q = params.filter((p) => p.in === 'query' && p.example !== undefined);
  if (q.length) { jsArgs.push(`{ ${q.map((p) => `${p.name}: ${JSON.stringify(p.example)}`).join(', ')} }`); pyArgs.push(...q.map((p) => `${p.name}=${JSON.stringify(p.example)}`)); }
  const js = `const result = await io.${d.op}(${jsArgs.join(', ')});`;
  const py = `result = io.${snake(d.op)}(${pyArgs.join(', ')})`;
  return { curl, js, py };
}

function endpoint([method, path, tag, summary, d = {}]) {
  const params = d.params || [];
  const anchor = d.op;
  const s = samples(method, path, d);
  const open = OPEN_TAGS.includes(tag);
  const rows = params.map((p) => `<tr><td><code>${esc(p.name)}</code>${p.required ? '' : ' <span class="opt">optional</span>'}</td><td>${p.in === 'path' ? 'path' : 'query'}</td><td>${esc(p.description || '')}</td></tr>`).join('');
  const inputs = params.map((p) => `<label><span>${esc(p.name)}${p.required ? '' : ' <i>optional</i>'}</span><input data-in="${p.in}" name="${esc(p.name)}" value="${esc(sample(p))}" placeholder="${esc(p.in === 'path' ? `${p.name} (required)` : '')}" autocomplete="off" spellcheck="false"></label>`).join('');
  return `
<article class="ep" id="${anchor}" data-method="${method.toUpperCase()}" data-path="${esc(path)}" data-open="${open ? 1 : 0}" data-raw="${d.raw ? 1 : 0}" data-upload="${d.upload ? 1 : 0}">
  <header><span class="verb v-${method}">${method.toUpperCase()}</span><code class="path">${esc(path)}</code><a class="hash" href="#${anchor}" aria-label="Link to ${esc(summary)}">#</a></header>
  <h3>${esc(summary)}</h3>
  ${d.desc ? `<p>${esc(d.desc)}</p>` : ''}
  ${rows ? `<div class="table-wrap"><table class="api params"><thead><tr><th>Parameter</th><th>In</th><th>What it is</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
  <div class="code-tabs" role="tablist">
    <button role="tab" class="on" data-lang="curl">curl</button><button role="tab" data-lang="js">JavaScript</button><button role="tab" data-lang="py">Python</button>
  </div>
  <pre class="code" data-lang="curl"><code>${esc(s.curl)}</code></pre>
  <pre class="code" data-lang="js" hidden><code>${esc(s.js)}</code></pre>
  <pre class="code" data-lang="py" hidden><code>${esc(s.py)}</code></pre>
  <details class="try"${open ? ' open' : ''}>
    <summary>Try it${open ? ' <span class="free">works without a key</span>' : ''}</summary>
    <form>
      ${inputs ? `<div class="try-grid">${inputs}</div>` : ''}
      ${d.body ? `<label class="body"><span>JSON body</span><textarea name="__body" rows="${Math.min(10, JSON.stringify(d.body, null, 2).split('\n').length + 1)}" spellcheck="false">${esc(JSON.stringify(d.body, null, 2))}</textarea></label>` : ''}
      ${d.upload ? '<label class="body"><span>File</span><input type="file" name="__file"></label>' : ''}
      <div class="try-go"><button class="btn btn-primary" type="submit">Send ${method.toUpperCase()}</button>${method !== 'get' ? '<span class="warn">This changes data in your workspace.</span>' : ''}</div>
      <output class="resp" hidden></output>
    </form>
  </details>
</article>`;
}

export function apiReferencePage({ crumbs, CTA }) {
  const tags = [...new Set(ENDPOINTS.map((e) => e[2]))];
  const nav = tags.map((t) => `<li><a href="#${slug(t)}">${t}</a><ul>${ENDPOINTS.filter((e) => e[2] === t).map((e) => `<li><a href="#${e[4].op}"><span class="verb v-${e[0]}">${e[0] === 'delete' ? 'DEL' : e[0].toUpperCase()}</span>${esc(e[3])}</a></li>`).join('')}</ul></li>`).join('');
  const sections = tags.map((t) => `
<section class="ep-group" id="${slug(t)}">
  <h2>${t}</h2>
  <p class="muted">${esc(TAG_TEXT[t] || '')}</p>
  ${ENDPOINTS.filter((e) => e[2] === t).map(endpoint).join('')}
</section>`).join('');

  return {
    key: 'developers-api', path: '/developers/api/', current: 'developers',
    title: 'API reference',
    description: `Every IoBeacons API endpoint (${ENDPOINTS.length} of them) with examples in curl, JavaScript and Python, and a console to try calls with your own key.`,
    head: `<link rel="stylesheet" href="/site-assets/api-ref.css?v=${ver('api-ref.css')}">\n<script type="module" src="/site-assets/api-ref.js?v=${ver('api-ref.js')}"></script>\n`,
    body: `
<section class="page-hero ref-hero"><div class="wrap">
  ${crumbs('<a href="/developers/">Developers</a>', 'API reference')}
  <h1>API reference</h1>
  <p class="lede">All ${ENDPOINTS.length} endpoints of the IoBeacons API, with examples you can copy and a console to try them with your own key.</p>
  <div class="ref-key">
    <label for="ref-key-input">Your API key</label>
    <div class="ref-key-row">
      <input id="ref-key-input" type="password" placeholder="iobm_..." autocomplete="off" spellcheck="false">
      <button type="button" class="btn btn-ghost" id="ref-key-check">Check key</button>
    </div>
    <p class="muted small" id="ref-key-note">Kept only in this browser tab and sent only to iobeacons.com. Space and Weather calls also work without a key. <a href="/maps/#settings=keys">Create a key in Maps</a>.</p>
  </div>
  <div class="ref-meta">
    <div><b>Base URL</b><code>${API}</code></div>
    <div><b>Auth</b><code>Authorization: Bearer iobm_...</code></div>
    <div><b>Libraries</b><a href="/developers/sdk/iobeacons.mjs" download>JavaScript</a> · <a href="/developers/sdk/iobeacons.py" download>Python</a> · <a href="/maps/api/v1/openapi.json">OpenAPI 3.1</a></div>
  </div>
</div></section>

<div class="wrap ref">
  <nav class="ref-nav" aria-label="Endpoints"><ul>${nav}</ul></nav>
  <div class="ref-main">
    <section class="ep-group" id="basics">
      <h2>The basics</h2>
      <div class="basics">
        <div><h3>Set up a client</h3>
<pre><code># JavaScript (Node 18+, Deno, Bun, browsers)
import { IoBeacons } from './iobeacons.mjs';
const io = new IoBeacons(process.env.IOBEACONS_API_KEY);

# Python 3.8+, standard library only
from iobeacons import IoBeacons
io = IoBeacons()   # reads IOBEACONS_API_KEY</code></pre></div>
        <div><h3>Errors</h3><p>Any failure answers with an HTTP status and <code>{"error": "..."}</code>, a sentence you can show to a person. 400 means something in the request needs fixing, 401 a missing or revoked key, 402 a plan limit, 404 not in this workspace, 429 too many calls.</p>
        <h3>Limits</h3><p>Professional includes 100,000 calls a month and Business 1,000,000. Each answer carries <code>X-Quota-Limit</code>, <code>X-Quota-Remaining</code> and <code>X-Quota-Period</code>. A key can make up to 1,200 calls a minute.</p>
        <h3>From a web page</h3><p>The API answers calls from any website (CORS). Keep keys on your server when the page is public.</p></div>
      </div>
    </section>
    ${sections}
  </div>
</div>
${CTA('Need something the API does not cover?', 'Our engineers build custom feeds and integrations. Tell us what you are connecting.')}`,
  };
}
