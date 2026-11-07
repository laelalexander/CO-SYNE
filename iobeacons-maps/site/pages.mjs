// Content for every iobeacons.com page. Layout lives in build.mjs.
import { apiReferencePage } from './api-ref.mjs';
export const SITE = { origin: 'https://iobeacons.com' };

const ICONS = {
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  cube: 'M12 2l9 5v10l-9 5-9-5V7z M12 22V12 M21 7l-9 5-9-5',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18z M3 12h18 M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  sat: 'M13 7l4-4 4 4-4 4z M3 17l4-4 4 4-4 4z M8.5 15.5l7-7 M14 14a4 4 0 01-4 4 M17 14a7 7 0 01-7 7',
  device: 'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 16a4 4 0 100-8 4 4 0 000 8z',
  bell: 'M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8 M10 20a2 2 0 004 0',
  report: 'M6 2h9l5 5v15H6z M14 2v6h6 M9 13h8 M9 17h6',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5 M3 17l9 5 9-5',
  cloud: 'M7 18a4 4 0 010-8 6 6 0 0111.5 1.5A3.5 3.5 0 0118 18z',
  shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
  people: 'M9 11a4 4 0 100-8 4 4 0 000 8z M2 21c0-4 3-6 7-6s7 2 7 6 M17 11a3 3 0 100-6 M22 21c0-3-2-5-5-5.5',
  flask: 'M9 3h6 M10 3v6L4 20h16L14 9V3',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6z M6 15a3 3 0 100-6 3 3 0 000 6z M18 22a3 3 0 100-6 3 3 0 000 6z M8.6 13.5l6.8 4 M15.4 6.5l-6.8 4',
  hand: 'M3 12l4-4 5 3 5-3 4 4-9 8z',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  key: 'M15 7a4 4 0 11-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0115 7z',
};
const icon = (name, tone = 'orange') => `<div class="icon i-${tone}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg></div>`;
const crumbs = (...items) => `<div class="crumbs"><a href="/">IoBeacons</a>${items.map((i) => ` / ${i}`).join('')}</div>`;

const CTA = (title = 'See it on your own map.', text = 'Open the live demo in your browser. No sign-up needed. When you are ready, start a 7-day free trial or talk to our team about a project.') => `
<section class="tight"><div class="wrap"><div class="cta">
  <div><h2>${title}</h2><p class="lede" style="margin:0">${text}</p></div>
  <div class="btns"><a class="btn btn-primary" href="/maps/">Open the live demo</a><a class="btn btn-ghost" href="/contact/">Talk to us</a></div>
</div></div></section>`;

// Illustration: a globe with orbits and sites. Decorative only.
const GLOBE = `
<svg class="globe-art" viewBox="0 0 520 520" role="img" aria-label="Illustration: the Earth with satellites in orbit and sites marked on the map">
  <defs>
    <radialGradient id="g-sea" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#3d86f5"/><stop offset=".55" stop-color="#1f5fcc"/><stop offset="1" stop-color="#0b2a66"/></radialGradient>
    <radialGradient id="g-glow" cx="50%" cy="50%" r="50%"><stop offset=".72" stop-color="#7fb2ff" stop-opacity=".35"/><stop offset="1" stop-color="#7fb2ff" stop-opacity="0"/></radialGradient>
    <clipPath id="g-clip"><circle cx="260" cy="260" r="170"/></clipPath>
  </defs>
  <circle cx="260" cy="260" r="215" fill="url(#g-glow)"/>
  <circle cx="260" cy="260" r="170" fill="url(#g-sea)"/>
  <g clip-path="url(#g-clip)" fill="#7fd3a8" opacity=".9">
    <path d="M150 150c30-25 70-20 92 0 18 16 8 40-12 52-22 13-18 38-40 46-26 9-52-12-58-38-6-24 0-46 18-60z"/>
    <path d="M300 120c34 2 70 22 76 52 4 22-18 30-34 40-20 12-14 40-36 50-24 10-44-12-48-36-5-30 8-54 14-74 5-18 12-32 28-32z"/>
    <path d="M250 300c22-8 52 0 64 22 12 22 2 50-20 64-24 15-52 6-62-18-10-22-4-60 18-68z"/>
    <path d="M380 270c18-4 34 8 34 26s-14 30-30 28c-16-2-26-16-22-30 2-12 8-22 18-24z"/>
  </g>
  <g clip-path="url(#g-clip)" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="1">
    <ellipse cx="260" cy="260" rx="170" ry="56"/><ellipse cx="260" cy="260" rx="170" ry="118"/><line x1="90" y1="260" x2="430" y2="260"/>
    <ellipse cx="260" cy="260" rx="56" ry="170"/><ellipse cx="260" cy="260" rx="118" ry="170"/><line x1="260" y1="90" x2="260" y2="430"/>
  </g>
  <circle cx="260" cy="260" r="170" fill="none" stroke="#ffffff" stroke-opacity=".25"/>
  <g>
    <circle cx="205" cy="205" r="5" fill="#ff713d"/><circle cx="205" cy="205" r="5" fill="none" stroke="#ff713d" stroke-width="2"><animate attributeName="r" values="5;18" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;0" dur="2.4s" repeatCount="indefinite"/></circle>
    <circle cx="318" cy="182" r="5" fill="#ff713d"/>
    <circle cx="282" cy="338" r="5" fill="#1bb782"/><circle cx="282" cy="338" r="5" fill="none" stroke="#1bb782" stroke-width="2"><animate attributeName="r" values="5;16" dur="3s" begin=".8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;0" dur="3s" begin=".8s" repeatCount="indefinite"/></circle>
    <path d="M205 205 Q 262 170 318 182" fill="none" stroke="#ffd2bf" stroke-width="2" stroke-dasharray="4 5"/>
  </g>
  <g fill="none" stroke-width="1.5">
    <ellipse id="o1" cx="260" cy="260" rx="232" ry="78" transform="rotate(-24 260 260)" stroke="#ff713d" stroke-opacity=".55" stroke-dasharray="3 6"/>
    <ellipse id="o2" cx="260" cy="260" rx="214" ry="130" transform="rotate(32 260 260)" stroke="#7c5cff" stroke-opacity=".45" stroke-dasharray="3 6"/>
  </g>
  <g transform="rotate(-24 260 260)"><circle r="7" fill="#ff713d" stroke="#fff" stroke-width="2"><animateMotion dur="14s" repeatCount="indefinite" path="M28 260a232 78 0 1 0 464 0a232 78 0 1 0 -464 0"/></circle></g>
  <g transform="rotate(32 260 260)"><circle r="6" fill="#a993ff" stroke="#fff" stroke-width="2"><animateMotion dur="22s" repeatCount="indefinite" path="M474 260a214 130 0 1 0 -428 0a214 130 0 1 0 428 0"/></circle></g>
  <g font-family="Avenir Next, Segoe UI, sans-serif" font-size="12.5" font-weight="700">
    <g transform="translate(330 70)"><rect width="160" height="44" rx="12" fill="#fff" stroke="#e3e8ef"/><circle cx="18" cy="22" r="5" fill="#ff713d"/><text x="32" y="19" fill="#071a33">Space station</text><text x="32" y="34" fill="#5b6a80" font-weight="500">420 km · 7.7 km/s</text></g>
    <g transform="translate(14 330)"><rect width="168" height="44" rx="12" fill="#fff" stroke="#e3e8ef"/><circle cx="18" cy="22" r="5" fill="#2876ee"/><text x="32" y="19" fill="#071a33">Flood watch</text><text x="32" y="34" fill="#5b6a80" font-weight="500">2 of your sites inside</text></g>
    <g transform="translate(320 420)"><rect width="168" height="44" rx="12" fill="#fff" stroke="#e3e8ef"/><circle cx="18" cy="22" r="5" fill="#1bb782"/><text x="32" y="19" fill="#071a33">Truck 7 arrived</text><text x="32" y="34" fill="#5b6a80" font-weight="500">Geofence: North Yard</text></g>
  </g>
</svg>`;

// ---------------------------------------------------------------- pages
const home = {
  key: 'home', path: '/', file: 'index.html',
  title: 'IoBeacons: maps, satellites and live data in one place',
  description: 'IoBeacons is a GIS enablement service. Put your sites, devices, weather, hazards and satellites on one live map, get alerts, share reports, and work with a team that builds it with you.',
  body: `
<div id="home">
<section class="hero"><div class="wrap hero-grid">
  <div>
    <div class="eyebrow orange">GIS enablement service</div>
    <h1>See what the world is telling you <span class="hl">before the signal becomes an event.</span></h1>
    <p class="lede">IoBeacons puts your sites, vehicles, sensors, weather, hazards and satellites on one live map. You see what is happening, get told when something changes, and share it with the people who need it. Our team helps you set it up and grow it.</p>
    <div class="btns"><a class="btn btn-primary" href="/maps/">Open the live demo</a><a class="btn btn-ghost" href="/platform/">How it works</a></div>
    <div class="chips"><span>Works in the browser</span><span>No sign-up for the demo</span><span>7-day free trial</span></div>
  </div>
  <div class="hero-art">${GLOBE}</div>
</div></section>

<section class="band"><div class="wrap">
  <div class="sec-head"><div class="eyebrow">One platform, four ways to see</div><h2>From the street to orbit, on the same map.</h2>
  <p class="lede">Everything below is one product. Switch views with a click and your data comes with you.</p></div>
  <div class="grid g4">
    <a class="card" href="/platform/maps/">${icon('map', 'blue')}<h3>Maps</h3><p class="muted">Build maps from your own files and live data. Draw, style, upload, share and embed.</p><span class="btn-link">Explore Maps</span></a>
    <a class="card" href="/maps/#3d">${icon('cube', 'orange')}<h3>3D</h3><p class="muted">Tilt into terrain and buildings to understand a site before you go there.</p><span class="btn-link">Open in 3D</span></a>
    <a class="card" href="/maps/#globe">${icon('globe', 'green')}<h3>Globe</h3><p class="muted">Zoom out to the whole Earth to follow weather, hazards and routes across regions.</p><span class="btn-link">Open the globe</span></a>
    <a class="card" href="/platform/space/">${icon('sat', 'violet')}<h3>Space</h3><p class="muted">Track live satellites, see their orbits and know what is overhead your sites.</p><span class="btn-link">Explore Space</span></a>
  </div>
</div></section>

<section><div class="wrap feature">
  <div>
    <div class="eyebrow">What you can do</div>
    <h2>Watch, get alerted, act, report.</h2>
    <p class="lede">IoBeacons is built for teams who look after real places and moving things: depots, pump stations, fleets, land, buildings and field crews.</p>
    <ul class="ticks">
      <li><strong>Watch</strong> your sites with live weather radar, NWS warnings, earthquakes, wildfires and flood zones layered on top.</li>
      <li><strong>Track</strong> vehicles, phones and sensors, with their trail and last known position.</li>
      <li><strong>Get alerted</strong> by email, text or webhook when a device enters a zone or a warning touches a site.</li>
      <li><strong>Report</strong> on any site in one click and share a PDF or a live link.</li>
    </ul>
    <div class="btns"><a class="btn btn-dark" href="/maps/">Try it on the demo map</a><a class="btn-link" href="/platform/">See the whole platform</a></div>
  </div>
  <div class="shot"><img src="/site-assets/maps-app.jpg" alt="IoBeacons Maps showing sites, vehicles, a delivery route and a service area around Tulsa" width="1400" height="687" loading="lazy"></div>
</div></section>

<section class="band"><div class="wrap">
  <div class="sec-head"><div class="eyebrow">How you get started</div><h2>From first look to your own workspace.</h2>
  <p class="lede">You can go at your own pace. Nothing below needs a call, but we are here if you want one.</p></div>
  <div class="steps">
    <div class="step now"><h3>Try the demo</h3><p>Open a working map with sample data. Click around, draw, switch to 3D or Space.</p><a href="/maps/">Open the demo →</a></div>
    <div class="step"><h3>Start a free trial</h3><p>Create your own workspace with an email and password. 7 days, everything included.</p><a href="/maps/#signup">Create a workspace →</a></div>
    <div class="step"><h3>Bring your data</h3><p>Upload spreadsheets, KML, GPX, GeoJSON or shapefiles. Add live layers from the catalog.</p><a href="/platform/maps/#data">What you can upload →</a></div>
    <div class="step"><h3>Connect and alert</h3><p>Connect trackers and sensors, draw zones and choose who gets told.</p><a href="/network/">Connect devices →</a></div>
    <div class="step"><h3>Grow with us</h3><p>Invite your team, pick a plan, or have us build a custom map, feed or integration.</p><a href="/contact/">Talk to us →</a></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="eyebrow">Built with IoBeacons</div><h2>Companies we support.</h2>
  <p class="lede">The IoBeacons technical team anchors these ventures with mapping, data and engineering.</p></div>
  <div class="proof">
    <a class="card" href="/featured-projects/"><span class="tag">Featured</span><h3 style="margin-top:14px">CO-SYNE</h3><div class="where">Alabama</div><p class="muted">A collaboration platform for teams who need to talk, share and coordinate in real time.</p><span class="btn-link">Read more</span></a>
    <a class="card" href="/featured-projects/"><span class="tag blue">Real estate</span><h3 style="margin-top:14px">USLand.com</h3><div class="where">Oklahoma City</div><p class="muted">A commercial real estate marketplace where location and land data come first.</p><span class="btn-link">Read more</span></a>
    <a class="card" href="/featured-projects/"><span class="tag green">Records</span><h3 style="margin-top:14px">ResidentData.ai</h3><div class="where">Home history</div><p class="muted">Home history records that help people understand a property before they commit.</p><span class="btn-link">Read more</span></a>
  </div>
</div></section>

<section class="band"><div class="wrap grid g3">
  <div><div class="eyebrow">For builders</div><h3>An API for everything</h3><p class="muted">Maps, devices, alerts, reports, satellites and weather from code, with JavaScript and Python libraries.</p><a class="btn-link" href="/developers/">Developer docs</a></div>
  <div><div class="eyebrow">For researchers</div><h3>Data with its source attached</h3><p class="muted">Every layer says where it came from and how fresh it is, so you can cite it and trust it.</p><a class="btn-link" href="/research/">Research</a></div>
  <div><div class="eyebrow">For everyone</div><h3>Private by default</h3><p class="muted">Your workspace is yours. Share links are opt-in, and you can turn them off at any time.</p><a class="btn-link" href="/data-governance/">How we handle data</a></div>
</div></section>
${CTA()}
</div>
<div id="lost" class="wrap lost" hidden>
  <div class="eyebrow orange">Page not found</div>
  <h1>Off the map.</h1>
  <p class="lede" style="margin:0 auto 10px">We couldn't find that page. It may have moved when we rebuilt the site.</p>
  <div class="btns" style="justify-content:center"><a class="btn btn-primary" href="/">Go to the homepage</a><a class="btn btn-ghost" href="/maps/">Open Maps</a><a class="btn btn-ghost" href="/contact/">Contact us</a></div>
</div>`,
  // Every unknown address falls back to this page on the server. Send old
  // language links (/en/network/) to the new pages and show "not found" otherwise.
  script: `(function(){var p=location.pathname,m=p.match(/^\\/(en|es|fr|pt)(\\/.*)?$/);if(m){try{localStorage.setItem('iobeacons.locale',m[1])}catch(e){}location.replace((m[2]||'/')+location.search+location.hash);return}if(p!=='/'&&p!=='/index.html'){document.title='Page not found | IoBeacons';document.getElementById('home').hidden=true;document.getElementById('lost').hidden=false;var r=document.createElement('meta');r.name='robots';r.content='noindex';document.head.appendChild(r)}})();`,
};

const platform = {
  key: 'platform', path: '/platform/', current: 'platform',
  title: 'Platform',
  description: 'How IoBeacons fits together: Maps, 3D, Globe and Space views over one workspace of sites, devices, live data, alerts and reports, backed by a GIS team.',
  body: `
<section class="page-hero"><div class="wrap">
  ${crumbs('Platform')}
  <h1>One workspace. Every way of seeing it.</h1>
  <p class="lede">IoBeacons is a mapping platform and a service. The platform is where your places, things and live data come together. The service is our team helping you set it up, connect it and keep it useful.</p>
  <div class="btns"><a class="btn btn-primary" href="/maps/">Open the live demo</a><a class="btn btn-ghost" href="/contact/">Talk to us</a></div>
</div></section>

<section class="band"><div class="wrap">
  <div class="sec-head"><div class="eyebrow">The building blocks</div><h2>What is inside a workspace</h2></div>
  <div class="grid g3">
    <div class="card">${icon('pin', 'orange')}<h3>Sites</h3><p class="muted">The places you look after: offices, depots, stations, parcels. Each has a one-click report on weather, hazards and what is nearby.</p></div>
    <div class="card">${icon('device', 'green')}<h3>Devices</h3><p class="muted">Vehicles, phones and sensors that send their position. See where they are now and where they have been.</p></div>
    <div class="card">${icon('layers', 'blue')}<h3>Layers</h3><p class="muted">Your own data, drawn or uploaded, plus live catalog layers like radar, warnings, earthquakes, wildfires and flood zones.</p></div>
    <div class="card">${icon('bell', 'orange')}<h3>Alerts</h3><p class="muted">Rules that watch zones, sites and feeds, then tell the right people by email, text or webhook.</p></div>
    <div class="card">${icon('report', 'violet')}<h3>Reports</h3><p class="muted">Site reports you can read on screen or download as a PDF for a client or a crew.</p></div>
    <div class="card">${icon('share', 'blue')}<h3>Sharing</h3><p class="muted">Invite your team with roles, share a read-only link, or embed a live map on your own website.</p></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="eyebrow">Four views</div><h2>Same data, from the street to orbit</h2>
  <p class="lede">The views are buttons in the same app, not separate products. Turn one on and everything you have added is still there.</p></div>
  <div class="grid g2">
    <a class="card" href="/platform/maps/">${icon('map', 'blue')}<h3>Maps</h3><p class="muted">The everyday working view. Street, light, dark, satellite and terrain basemaps. Draw shapes, measure distances, search addresses.</p><span class="btn-link">More about Maps</span></a>
    <a class="card" href="/maps/#3d">${icon('cube', 'orange')}<h3>3D</h3><p class="muted">Terrain and 3D buildings. Tilt and turn to see slopes, access roads and what surrounds a site.</p><span class="btn-link">Open the demo in 3D</span></a>
    <a class="card" href="/maps/#globe">${icon('globe', 'green')}<h3>Globe</h3><p class="muted">The whole Earth as a sphere, for national and global operations, storm tracks and long routes.</p><span class="btn-link">Open the demo as a globe</span></a>
    <a class="card" href="/platform/space/">${icon('sat', 'violet')}<h3>Space</h3><p class="muted">Live satellites from public orbital data: space stations, weather, Earth observation, GPS and science missions.</p><span class="btn-link">More about Space</span></a>
  </div>
</div></section>

<section class="band"><div class="wrap feature">
  <div>
    <div class="eyebrow">The service</div>
    <h2>A GIS team when you need one</h2>
    <p class="lede">Most teams don't want to become map experts. That is where IoBeacons comes in.</p>
    <ul class="ticks">
      <li>We load and clean your existing data: spreadsheets, CAD exports, old GIS files.</li>
      <li>We connect your trackers, sensors and business systems.</li>
      <li>We build custom layers, alert rules, reports and embedded maps for your customers.</li>
      <li>We stay on to keep it running as you grow.</li>
    </ul>
    <div class="btns"><a class="btn btn-dark" href="/contact/">Tell us about your project</a><a class="btn-link" href="/featured-projects/">See projects</a></div>
  </div>
  <div class="card">
    <div class="eyebrow">Plans</div>
    <h3>Start free, then pick what fits</h3>
    <p class="muted">Every new workspace gets 7 days of the Professional plan for free. After that there are four plans:</p>
    <ul class="ticks">
      <li><strong>Starter</strong> for a small team getting going.</li>
      <li><strong>Professional</strong> adds devices, zones, alerts, text messages, embeds and the API.</li>
      <li><strong>Business</strong> for larger teams and more devices.</li>
      <li><strong>Enterprise</strong> with custom limits and support. Business and Enterprise can use their own branding.</li>
    </ul>
    <p class="small muted" style="margin-top:14px">You can see plan details inside Maps under Settings, or ask us for a quote.</p>
  </div>
</div></section>
${CTA()}`,
};

const maps = {
  key: 'maps', path: '/platform/maps/', current: 'maps',
  title: 'Maps',
  description: 'IoBeacons Maps: build maps from your own files and live data, track devices, set alerts, run site reports and share or embed them. Try the open demo in your browser.',
  body: `
<section class="page-hero"><div class="wrap hero-grid">
  <div>
    ${crumbs('<a href="/platform/">Platform</a>', 'Maps')}
    <h1>Your places and things, on a map that keeps up.</h1>
    <p class="lede">IoBeacons Maps is the app at the center of the platform. It runs in any modern browser, on a laptop, tablet or phone.</p>
    <div class="btns"><a class="btn btn-primary" href="/maps/">Open the live demo</a><a class="btn btn-ghost" href="/maps/#signup">Start a free trial</a></div>
    <div class="chips"><span>No install</span><span>Demo needs no sign-up</span><span>7 days free</span></div>
  </div>
  <div class="shot"><img src="/site-assets/maps-app.jpg" alt="The IoBeacons Maps app with layers, sites and devices" width="1400" height="687"></div>
</div></section>

<section class="band"><div class="wrap">
  <div class="sec-head"><div class="eyebrow">Features</div><h2>Everything in the app</h2></div>
  <div class="grid g3">
    <div class="card">${icon('map', 'blue')}<h3>Map builder</h3><p class="muted">Several maps per workspace, each with its own basemap, layers and saved view. Draw points, lines, areas, circles and freehand shapes and measure as you go.</p></div>
    <div class="card">${icon('layers', 'green')}<h3>Live data catalog</h3><p class="muted">NWS warnings, NEXRAD weather radar, earthquakes, hillshade, FEMA flood zones, wildfire perimeters, census boundaries, power lines, pipelines and towers.</p></div>
    <div class="card">${icon('pin', 'orange')}<h3>Sites and reports</h3><p class="muted">Save the places you care about and run a one-click site report with weather, hazards and nearby infrastructure. Download it as a PDF.</p></div>
    <div class="card">${icon('device', 'green')}<h3>Device tracking</h3><p class="muted">See vehicles and sensors live, with trails. Positions can come from a phone, your own GPS hardware or the API.</p></div>
    <div class="card">${icon('bell', 'orange')}<h3>Zones and alerts</h3><p class="muted">Draw zones and set rules. Get an email, a text message or a webhook when a device enters or leaves, or a warning touches a site.</p></div>
    <div class="card">${icon('share', 'blue')}<h3>Share and embed</h3><p class="muted">Invite teammates as viewers, editors or owners. Share a read-only link or embed a live map on your website.</p></div>
    <div class="card">${icon('cube', 'violet')}<h3>3D and globe</h3><p class="muted">Turn on terrain and 3D buildings, or switch to the globe for whole-Earth views.</p></div>
    <div class="card">${icon('sat', 'violet')}<h3>Space</h3><p class="muted">Add live satellites to any map and see their orbits. <a href="/platform/space/">More about Space</a>.</p></div>
    <div class="card">${icon('code', 'blue')}<h3>API and tiles</h3><p class="muted">Read and write your data with an API key and serve large layers as fast vector tiles. <a href="/developers/">Developer docs</a>.</p></div>
  </div>
</div></section>

<section id="data"><div class="wrap feature">
  <div>
    <div class="eyebrow">Bring your data</div>
    <h2>Upload what you already have</h2>
    <p class="lede">Drag a file into Maps and it becomes a layer you can style, filter and share.</p>
    <ul class="ticks">
      <li><strong>Spreadsheets (CSV)</strong> with latitude and longitude columns, or with addresses that we place on the map for you.</li>
      <li><strong>GeoJSON</strong>, <strong>KML</strong> from Google Earth, and <strong>GPX</strong> tracks from GPS devices.</li>
      <li><strong>Shapefiles</strong> from desktop GIS, zipped.</li>
      <li>Export any layer back out as GeoJSON, CSV or KML.</li>
    </ul>
  </div>
  <div class="card">
    <div class="eyebrow">Sign-in and your account</div>
    <h3>One account for IoBeacons</h3>
    <p class="muted">The Sign in link at the top of every page opens your workspace in Maps. If you forget your password you can reset it by email, and you can change it any time in Settings.</p>
    <div class="btns"><a class="btn btn-dark" href="/maps/#signin">Sign in</a><a class="btn btn-ghost" href="/maps/#signup">Create a workspace</a></div>
  </div>
</div></section>

<section class="band"><div class="wrap">
  <div class="sec-head"><div class="eyebrow">What's next</div><h2>Where Maps is heading</h2>
  <p class="lede">We publish our direction openly. Ask the map questions in plain English, add more data sources and offer the platform under your own brand.</p></div>
  <a class="btn btn-ghost" href="/maps-roadmap/">See the Maps roadmap</a>
</div></section>
${CTA()}`,
};

const space = {
  key: 'space', path: '/platform/space/', current: 'space',
  title: 'Space',
  description: 'Live satellites on the IoBeacons globe: space stations, weather, Earth observation, GPS and science missions from public orbital data, alongside your own sites and devices.',
  body: `
<section class="page-hero"><div class="wrap hero-grid">
  <div>
    ${crumbs('<a href="/platform/">Platform</a>', 'Space')}
    <h1>Look up from the map.</h1>
    <p class="lede">Space in IoBeacons shows live satellites on the same globe as your sites and devices. See what is overhead, where it is going next and how high and fast it is moving.</p>
    <div class="btns"><a class="btn btn-primary" href="/maps/#orbit">Open live orbits in 3D</a><a class="btn btn-ghost" href="/maps/#space">Satellites on your map</a></div>
    <div class="chips"><span>Satellites and debris in 3D</span><span>Speed up time</span><span>Public orbital data</span><span>In the browser</span></div>
  </div>
  <div class="hero-art">${GLOBE}</div>
</div></section>

<section class="band"><div class="wrap">
  <div class="sec-head"><div class="eyebrow">What you can see</div><h2>Five satellite groups to start</h2></div>
  <div class="grid g3">
    <div class="card">${icon('sat', 'orange')}<h3>Space stations</h3><p class="muted">The International Space Station and other crewed stations.</p></div>
    <div class="card">${icon('cloud', 'blue')}<h3>Weather satellites</h3><p class="muted">The polar and geostationary satellites behind forecasts and storm tracking.</p></div>
    <div class="card">${icon('globe', 'green')}<h3>Earth observation</h3><p class="muted">Imaging missions that watch land, crops, water and change over time.</p></div>
    <div class="card">${icon('pin', 'violet')}<h3>GPS</h3><p class="muted">The navigation constellation that your trackers and phones depend on.</p></div>
    <div class="card">${icon('flask', 'orange')}<h3>Science</h3><p class="muted">Telescopes and research missions in orbit.</p></div>
    <div class="card">${icon('code', 'blue')}<h3>Your own list</h3><p class="muted">Need a specific fleet or mission? <a href="/contact/">Tell us</a> and we can add it to your workspace.</p></div>
  </div>
</div></section>

<section><div class="wrap feature">
  <div>
    <div class="eyebrow">How it works</div>
    <h2>Real orbits, worked out live</h2>
    <ul class="ticks">
      <li>We download public orbital elements from CelesTrak every few hours.</li>
      <li>Your browser calculates each satellite's position every second.</li>
      <li>Click a satellite to see its height, speed, the point below it and its path for the next orbit.</li>
      <li>Your sites, zones and devices stay on the globe, so you can see passes over the places you care about.</li>
    </ul>
    <p class="small muted" style="margin-top:16px">Positions are estimates from published orbital data and are good for awareness and planning. They are not for navigation or collision avoidance.</p>
  </div>
  <div class="card">
    <div class="eyebrow">Try it</div>
    <h3>Three clicks</h3>
    <ol style="padding-left:1.2em;margin:0 0 10px">
      <li>Open Maps.</li>
      <li>Choose <strong>Space</strong> in the left-hand menu.</li>
      <li>Tick a group. The map turns into a globe and the satellites appear.</li>
    </ol>
    <a class="btn btn-dark" href="/maps/#orbit">Open live orbits</a>
  </div>
</div></section>

<section class="band"><div class="wrap">
  <div class="sec-head"><div class="eyebrow">From orbit to the ground</div><h2>Space weather and Earth data</h2>
  <p class="lede">Alongside satellites, IoBeacons brings in what happens because of space and what satellites see: weather radar, warnings and hazards from NOAA and USGS. For research and operations teams we also work with NOAA space weather data and global soil data. <a href="/research/">Read more on Research</a>.</p></div>
</div></section>
${CTA('See what is overhead right now.', 'Open Space in the live demo. No sign-up needed.')}`,
};

const network = {
  key: 'network', path: '/network/', current: 'network',
  title: 'Network',
  description: 'Connect vehicles, phones and sensors to IoBeacons. Send positions from the Android tracker, your own hardware or the API, then set zones and alerts.',
  body: `
<section class="page-hero"><div class="wrap">
  ${crumbs('Network')}
  <h1>Connect the things that move and measure.</h1>
  <p class="lede">The IoBeacons network is every device that reports into your workspace: vehicles, phones, field sensors and gateways. Once they report in, you can see them on the map, keep their history and get alerts.</p>
  <div class="btns"><a class="btn btn-primary" href="/maps/">See devices on the demo map</a><a class="btn btn-ghost" href="/contact/">Plan a device rollout</a></div>
</div></section>

<section class="band"><div class="wrap">
  <div class="sec-head"><div class="eyebrow">Three ways to connect</div><h2>Use what you have</h2></div>
  <div class="grid g3">
    <div class="card" id="tracker">${icon('device', 'green')}<h3>Android tracker</h3><p class="muted">Use an Android phone as a tracker for a vehicle or a field worker. The IoBeacons Android tracker is available on request, and we set it up with your workspace.</p><a class="btn-link" href="/contact/?topic=Android%20tracker">Request the tracker</a></div>
    <div class="card">${icon('code', 'blue')}<h3>Your hardware</h3><p class="muted">Any GPS unit, gateway or telematics service that can make a web request can send positions to IoBeacons with an API key.</p><a class="btn-link" href="/developers/#positions">See the device API</a></div>
    <div class="card">${icon('hand', 'orange')}<h3>We connect it</h3><p class="muted">Already have a fleet system or sensor platform? Our team builds the bridge so its data flows into your maps.</p><a class="btn-link" href="/contact/?topic=Integration">Talk to us</a></div>
  </div>
</div></section>

<section><div class="wrap feature">
  <div>
    <div class="eyebrow">Once connected</div>
    <h2>From dots on a map to decisions</h2>
    <ul class="ticks">
      <li><strong>Live position</strong> and the time each device was last seen.</li>
      <li><strong>Trails</strong> showing where it has been.</li>
      <li><strong>Zones</strong> you draw around yards, sites and service areas.</li>
      <li><strong>Alerts</strong> when a device enters or leaves a zone, sent by email, text or webhook.</li>
      <li><strong>Limits</strong> that grow with your plan, from a handful of devices to whole fleets.</li>
    </ul>
  </div>
  <div class="shot"><img src="/site-assets/maps-app.jpg" alt="Vehicles and a delivery route on the IoBeacons map" width="1400" height="687" loading="lazy"></div>
</div></section>

<section class="band"><div class="wrap grid g2">
  <div><div class="eyebrow">Privacy</div><h3>People are not just dots</h3><p class="muted">When a device belongs to a person, tracking should be open and agreed. Workspaces control who can see positions, and you choose how long history is kept. Read our <a href="/data-governance/">data governance</a> page.</p></div>
  <div><div class="eyebrow">Reliability</div><h3>Built to keep up</h3><p class="muted">Devices can send one position or a batch of up to a thousand at once, so trackers that were offline can catch up when they reconnect.</p></div>
</div></section>
${CTA('Put your fleet on the map.', 'Try the demo devices first, then talk to us about connecting yours.')}`,
};

const research = {
  key: 'research', path: '/research/', current: 'research',
  title: 'Research',
  description: 'IoBeacons for research: public environmental, weather, hazard and orbital data with its source and freshness attached, plus tools for field studies and partnerships.',
  body: `
<section class="page-hero"><div class="wrap">
  ${crumbs('Research')}
  <h1>Data you can trace back to its source.</h1>
  <p class="lede">Research needs to know where a number came from. Every layer in IoBeacons names its source and how often it updates, and our team works with universities, agencies and companies on field studies and custom datasets.</p>
  <div class="btns"><a class="btn btn-primary" href="/contact/?topic=Research">Start a research conversation</a><a class="btn btn-ghost" href="/maps/">Explore the data in Maps</a></div>
</div></section>

<section class="band"><div class="wrap">
  <div class="sec-head"><div class="eyebrow">Sources we work with</div><h2>Public data, clearly labelled</h2></div>
  <div class="table-wrap"><table class="api">
    <thead><tr><th>Data</th><th>Source</th><th>Used for</th></tr></thead>
    <tbody>
      <tr><td>Weather warnings and watches</td><td>US National Weather Service</td><td>Storm, flood and heat risk at sites</td></tr>
      <tr><td>Weather radar</td><td>NOAA NEXRAD (via Iowa Environmental Mesonet)</td><td>Live precipitation</td></tr>
      <tr><td>Earthquakes</td><td>USGS</td><td>Hazard awareness</td></tr>
      <tr><td>Flood zones</td><td>FEMA</td><td>Site and parcel risk</td></tr>
      <tr><td>Wildfire perimeters</td><td>Public fire agencies</td><td>Hazard awareness</td></tr>
      <tr><td>Census boundaries</td><td>US Census Bureau</td><td>Demographics and service areas</td></tr>
      <tr><td>Satellite orbits</td><td>CelesTrak</td><td>Space view and pass planning</td></tr>
      <tr><td>Space weather</td><td>NOAA Space Weather Prediction Center</td><td>Research and operations projects</td></tr>
      <tr><td>Soil properties</td><td>ISRIC SoilGrids</td><td>Agriculture and land research</td></tr>
      <tr><td>Basemaps</td><td>OpenStreetMap contributors, OpenFreeMap</td><td>Streets, buildings and places</td></tr>
    </tbody>
  </table></div>
</div></section>

<section><div class="wrap grid g3">
  <div class="card">${icon('flask', 'orange')}<h3>Field studies</h3><p class="muted">Equip a study area with trackers or sensors, collect positions and readings, and see them on a shared map as they arrive.</p></div>
  <div class="card">${icon('layers', 'blue')}<h3>Custom datasets</h3><p class="muted">We clean, join and map the datasets your project needs, and keep a record of where each one came from.</p></div>
  <div class="card">${icon('people', 'green')}<h3>Partnerships</h3><p class="muted">Joint projects with research groups and agencies, from a single study to long-running observatories.</p></div>
</div></section>

<section class="band"><div class="wrap grid g2">
  <div><div class="eyebrow">Ethics</div><h3>Research that respects people</h3><p class="muted">Studies that involve people or their locations follow consent, minimisation and review. Read our <a href="/research-ethics/">research ethics</a> principles.</p></div>
  <div><div class="eyebrow">Openness</div><h3>Export and cite</h3><p class="muted">Export layers as GeoJSON, CSV or KML for your own analysis, and cite the original source listed on each layer.</p></div>
</div></section>
${CTA('Have a research question?', 'Tell us what you are studying and we will tell you honestly whether IoBeacons can help.')}`,
};

const developers = {
  key: 'developers', path: '/developers/', current: 'developers',
  title: 'Developers',
  description: 'The IoBeacons API library: maps, devices, alerts, reports, satellites and weather from code, with JavaScript and Python libraries and an interactive reference.',
  body: `
<section class="page-hero"><div class="wrap narrow">
  ${crumbs('Developers')}
  <h1>Build on IoBeacons.</h1>
  <p class="lede">Everything you can do in Maps, you can do from code. Send positions from devices, keep your own systems in sync with your map layers and embed live maps in your product.</p>
  <div class="btns"><a class="btn btn-primary" href="/developers/api/">API reference</a><a class="btn btn-ghost" href="/maps/#signup">Get an API key</a><a class="btn btn-ghost" href="/contact/?topic=Integration">Talk to an engineer</a></div>
</div></section>

<section class="band"><div class="wrap narrow">
  <h2>Getting started</h2>
  <ol>
    <li>Create a workspace (the 7-day trial includes the API).</li>
    <li>In Maps, open <strong>Settings → API keys</strong> and create a key. Copy it now; it is shown once.</li>
    <li>Send it as a bearer token to <code>https://iobeacons.com/maps/api/v1</code>.</li>
  </ol>
<pre><code>curl https://iobeacons.com/maps/api/v1/maps \\
  -H "Authorization: Bearer iobm_your_key_here"</code></pre>
  <p class="muted">Responses are JSON. Errors come back with an HTTP status and an <code>error</code> message you can show to a person. The API is part of the Professional plan and above (100,000 calls a month on Professional, 1,000,000 on Business). Check a key with <code>GET /me</code>.</p>
</div></section>

<section id="positions"><div class="wrap narrow">
  <h2>Send device positions</h2>
  <p>Use your own id for the device. If the device doesn't exist yet it is created for you.</p>
<pre><code>curl -X POST https://iobeacons.com/maps/api/v1/devices/truck-12/positions \\
  -H "Authorization: Bearer iobm_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"lon": -95.99, "lat": 36.15, "speed_mph": 34, "heading": 90}'</code></pre>
  <p>To catch up after being offline, send up to 1,000 positions at once with their times:</p>
<pre><code>{"positions": [
  {"lon": -95.99, "lat": 36.15, "time": "2026-11-06T14:00:00Z"},
  {"lon": -95.98, "lat": 36.16, "time": "2026-11-06T14:01:00Z"}
]}</code></pre>
  <p class="muted">The answer lists any alerts the new positions set off, so your system can react straight away.</p>
</div></section>

<section class="band" id="library"><div class="wrap narrow">
  <h2>The API library</h2>
  <p>Every part of the platform is in the API: maps and layers, features, sites, zones, devices and positions, alert rules, reports, notes and findings, live data layers, and satellites and weather. The <a href="/developers/api/">API reference</a> lists all of it with examples in curl, JavaScript and Python, and lets you try each call with your own key.</p>
  <div class="table-wrap"><table class="api">
    <thead><tr><th>Area</th><th>What you can do</th></tr></thead>
    <tbody>
      <tr><td><a href="/developers/api/#maps">Maps</a>, <a href="/developers/api/#layers">layers</a>, <a href="/developers/api/#features">features</a></td><td>Create and share maps, add layers, read and write GeoJSON, upload files, export, vector tiles</td></tr>
      <tr><td><a href="/developers/api/#devices">Devices</a></td><td>Send one or 1,000 positions at once, read trails and last positions</td></tr>
      <tr><td><a href="/developers/api/#sites">Sites</a>, <a href="/developers/api/#zones">zones</a>, <a href="/developers/api/#alerts">alerts</a></td><td>Places, geofences, rules that email, text or call your webhook, and the alerts they raised</td></tr>
      <tr><td><a href="/developers/api/#reports">Reports</a></td><td>Site Intelligence Reports for any point, as JSON or PDF</td></tr>
      <tr><td><a href="/developers/api/#space">Space</a></td><td>Where any satellite or piece of debris is now or at any moment, its ground track and catalogue record</td></tr>
      <tr><td><a href="/developers/api/#weather">Weather</a>, <a href="/developers/api/#catalog">catalog</a></td><td>Radar loop frames, Doppler winds, warnings, earthquakes, wildfires, flood zones and address search</td></tr>
      <tr><td><a href="/developers/api/#notes">Notes</a>, <a href="/developers/api/#findings">findings</a></td><td>Pin notes for your team and save views you can share by link</td></tr>
    </tbody>
  </table></div>
  <h3 style="margin-top:32px">Client libraries</h3>
  <p>Each is one file with no dependencies. Every endpoint is a method, named as in the reference.</p>
  <div class="table-wrap"><table class="api">
    <thead><tr><th>Language</th><th>Download</th><th>Works with</th></tr></thead>
    <tbody>
      <tr><td>JavaScript</td><td><a href="/developers/sdk/iobeacons.mjs" download>iobeacons.mjs</a> and <a href="/developers/sdk/iobeacons.d.ts" download>types</a></td><td>Node 18+, Deno, Bun and browsers</td></tr>
      <tr><td>Python</td><td><a href="/developers/sdk/iobeacons.py" download>iobeacons.py</a></td><td>Python 3.8+, standard library only</td></tr>
      <tr><td>Anything else</td><td><a href="/developers/openapi.json">OpenAPI 3.1 description</a></td><td>Postman, Insomnia, or a generator for your language</td></tr>
    </tbody>
  </table></div>
<pre><code>// JavaScript
import { IoBeacons } from './iobeacons.mjs';
const io = new IoBeacons(process.env.IOBEACONS_API_KEY);
await io.sendPositions('truck-12', { lon: -95.99, lat: 36.15, speed_mph: 34 });
const iss = await io.satellitePosition(25544);   // { lon, lat, altKm, speedKmS }

# Python
from iobeacons import IoBeacons
io = IoBeacons()   # reads IOBEACONS_API_KEY
io.send_positions("truck-12", {"lon": -95.99, "lat": 36.15, "speed_mph": 34})
iss = io.satellite_position(25544)</code></pre>
  <div class="btns" style="margin-top:18px"><a class="btn btn-primary" href="/developers/api/">Open the API reference</a></div>
</div></section>

<section><div class="wrap narrow">
  <h2>Embed a live map</h2>
  <p>In Maps, open a map, choose <strong>Share</strong>, turn on the link and copy the embed code. It looks like this:</p>
<pre><code>&lt;iframe src="https://iobeacons.com/maps/embed.html#your-share-token"
        width="100%" height="480" style="border:0" loading="lazy"&gt;&lt;/iframe&gt;</code></pre>
  <p class="muted">Viewers don't need an account. Turning the link off in Maps stops the embed straight away.</p>
  <h2 style="margin-top:40px">Webhooks</h2>
  <p>Alert rules can call your URL. Each call carries the alert as JSON and a signature header so you can check it came from IoBeacons. Set the URL and secret on the rule in Maps.</p>
</div></section>
${CTA('Need something the API does not cover?', 'Our engineers build custom feeds and integrations. Tell us what you are connecting.')}`,
};

const contact = {
  key: 'contact', path: '/contact/', current: '',
  title: 'Contact',
  description: 'Talk to the IoBeacons team about Maps, devices, space data, research or a custom GIS project.',
  body: `
<section class="page-hero"><div class="wrap feature" style="align-items:start">
  <div>
    ${crumbs('Contact')}
    <h1>Talk to us.</h1>
    <p class="lede">Tell us a little about what you want to map, track or build. A real person on the IoBeacons team reads every message and replies by email.</p>
    <ul class="ticks">
      <li>Questions about Maps, plans or the free trial</li>
      <li>Connecting vehicles, phones or sensors</li>
      <li>Space data and research projects</li>
      <li>Custom maps, feeds and integrations</li>
    </ul>
    <div class="card" style="margin-top:28px">
      <h3>Want to look first?</h3>
      <p class="muted">The live demo needs no sign-up. You can try everything with sample data.</p>
      <a class="btn btn-dark" href="/maps/">Open the live demo</a>
    </div>
  </div>
  <div class="card">
    <form class="form" id="contact-form" novalidate>
      <div class="two">
        <label>Your name<input name="name" autocomplete="name" required maxlength="120"></label>
        <label>Email<input name="email" type="email" autocomplete="email" required maxlength="200"></label>
      </div>
      <div class="two">
        <label>Company or organisation<input name="company" autocomplete="organization" maxlength="160"></label>
        <label>Topic<select name="topic">
          <option>Maps and plans</option><option>Android tracker</option><option>Integration</option><option>Space data</option><option>Research</option><option>Custom project</option><option>Support</option><option>Something else</option>
        </select></label>
      </div>
      <label>Message<textarea name="message" required maxlength="5000" placeholder="What would you like to do?"></textarea></label>
      <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
      <div id="contact-msg" role="status"></div>
      <button class="btn btn-primary" type="submit">Send message</button>
      <p class="small muted" style="margin:0">We use your details only to answer you. See our <a href="/privacy/">privacy policy</a>.</p>
    </form>
  </div>
</div></section>`,
  script: `(function(){var f=document.getElementById('contact-form'),m=document.getElementById('contact-msg'),q=new URLSearchParams(location.search).get('topic');if(q){[].forEach.call(f.topic.options,function(o){if(o.text===q)f.topic.value=q})}
f.addEventListener('submit',function(e){e.preventDefault();m.className='';m.textContent='';var d={};new FormData(f).forEach(function(v,k){d[k]=v});d.page=document.referrer||location.href;
if(!d.name||!d.email||!d.message){m.className='form-msg err';m.textContent='Please fill in your name, email and message.';return}
var b=f.querySelector('button[type=submit]');b.disabled=true;b.textContent='Sending…';
fetch('/maps/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Something went wrong.');return j})})
.then(function(){f.reset();m.className='form-msg ok';m.textContent='Thank you. Your message reached the IoBeacons team and we will reply by email.'})
.catch(function(err){m.className='form-msg err';m.textContent=err.message+' You can also try again in a few minutes.'})
.finally(function(){b.disabled=false;b.textContent='Send message'})})})();`,
};

const updated = 'November 6, 2026';
const legal = (key, path, title, description, html) => ({
  key, path, title, description,
  body: `<section class="page-hero"><div class="wrap narrow">${crumbs(title)}<h1>${title}</h1><p class="muted">Last updated ${updated}</p></div></section>
<section style="padding-top:0"><div class="wrap narrow"><div class="prose">${html}</div></div></section>`,
});

const privacy = legal('privacy', '/privacy/', 'Privacy policy', 'How IoBeacons collects, uses and protects personal information.', `
<p>This policy explains what personal information IoBeacons collects when you use iobeacons.com and IoBeacons Maps, why we collect it and the choices you have. If anything is unclear, <a href="/contact/">contact us</a>.</p>
<h2>What we collect</h2>
<ul>
<li><strong>Account details</strong>: your name, email address and a scrambled (hashed) version of your password when you create a workspace.</li>
<li><strong>Workspace content</strong>: the maps, layers, sites, files, devices, positions, zones and alert rules you or your team add.</li>
<li><strong>Contact messages</strong>: what you send us through the contact form.</li>
<li><strong>Technical data</strong>: basic server logs such as IP address, browser type and the pages requested, kept for security and troubleshooting.</li>
<li><strong>Billing</strong>: if you subscribe, payments are handled by our payment provider. We do not store card numbers.</li>
</ul>
<h2>How we use it</h2>
<ul>
<li>To run your workspace and show your data to you and the people you invite.</li>
<li>To send messages you ask for, such as alerts, password resets and invitations.</li>
<li>To answer questions and support requests.</li>
<li>To keep the service secure, prevent abuse and fix problems.</li>
</ul>
<p>We do not sell personal information, and we do not use your workspace content to advertise to you.</p>
<h2>Location data</h2>
<p>Device positions are workspace content. They are visible only to members of that workspace and to anyone the workspace shares a map with. Workspace owners are responsible for telling the people they track and getting their agreement where the law requires it.</p>
<h2>Cookies</h2>
<p>Maps uses one cookie to keep you signed in. The website remembers your language choice in your browser. We do not use advertising cookies.</p>
<h2>Who we share it with</h2>
<p>We use service providers to host the platform, send email and text messages and take payments. They may process data only to provide those services to us. We may disclose information if the law requires it.</p>
<h2>How long we keep it</h2>
<p>We keep account and workspace data while your workspace is active. When a workspace is closed, we delete its content within 90 days, except where we must keep records for legal or billing reasons. Open demo changes are reset every day.</p>
<h2>Your choices and rights</h2>
<p>You can view and edit your details in Maps, export your layers and ask us to delete your account. Depending on where you live you may have further rights, such as access, correction and objection. To use them, <a href="/contact/">contact us</a>.</p>
<h2>Security</h2>
<p>See our <a href="/security/">security page</a> for how we protect data.</p>
<h2>Changes</h2>
<p>We will post any changes on this page and update the date at the top. For significant changes we will tell workspace owners by email.</p>`);

const terms = legal('terms', '/terms/', 'Terms of service', 'The terms for using iobeacons.com and IoBeacons Maps.', `
<p>These terms apply when you use iobeacons.com, IoBeacons Maps and the IoBeacons API (together, "the service"). By using the service you agree to them. If you use it for an organisation, you agree on its behalf.</p>
<h2>Your account</h2>
<p>Keep your password safe and tell us if you think someone else has used your account. You are responsible for what happens in your workspace and for the people you invite.</p>
<h2>Free trial and plans</h2>
<p>New workspaces get a free trial. After it ends you can choose a paid plan. Paid plans renew until cancelled. If you cancel, your workspace stays available until the end of the period you paid for. Plan limits and features are shown in Maps.</p>
<h2>Your content</h2>
<p>You own the data you put into the service. You give us permission to store, process and display it only to run the service for you. You must have the right to upload it, and to track any device or person you track.</p>
<h2>Acceptable use</h2>
<ul>
<li>Do not use the service to break the law, stalk or harass anyone, or track people without the consent the law requires.</li>
<li>Do not try to break, overload or get around the security or limits of the service.</li>
<li>Do not resell the service without an agreement with us.</li>
</ul>
<h2>Third-party data</h2>
<p>Catalog layers, basemaps and satellite positions come from public and third-party sources. They are provided as they are and may be late, incomplete or wrong. Do not rely on them alone for safety-critical decisions, emergency response or navigation.</p>
<h2>Availability</h2>
<p>We work to keep the service running but cannot promise it will never be interrupted. We may change features over time and will give notice of changes that significantly affect paid plans.</p>
<h2>Liability</h2>
<p>To the extent the law allows, IoBeacons is not liable for indirect or consequential losses, and our total liability is limited to the amount you paid us in the 12 months before the claim.</p>
<h2>Ending</h2>
<p>You can stop using the service at any time. We may suspend accounts that break these terms. You can export your layers before your workspace is closed.</p>
<h2>Contact</h2>
<p>Questions about these terms? <a href="/contact/">Contact us</a>.</p>`);

const governance = legal('governance', '/data-governance/', 'Data governance', 'How IoBeacons organises, separates and protects the data in each workspace.', `
<p>Each IoBeacons workspace is a separate space for one organisation. These are the rules we follow for the data inside it.</p>
<h2>Separation</h2>
<p>Every map, layer, site, device and position belongs to exactly one workspace. Our software checks the workspace on every request, so one customer cannot see another's data.</p>
<h2>Roles</h2>
<p>Workspace owners decide who can view, edit or manage. Owners can remove access at any time.</p>
<h2>Sharing is opt-in</h2>
<p>Maps are private until someone turns on a share link. Turning the link off, or creating a new one, stops the old link straight away.</p>
<h2>Sources are labelled</h2>
<p>Catalog layers show where they come from and how often they refresh. See <a href="/research/">Research</a> for the list.</p>
<h2>Export and deletion</h2>
<p>You can export layers as GeoJSON, CSV or KML. Closed workspaces are deleted as described in our <a href="/privacy/">privacy policy</a>.</p>
<h2>Activity log</h2>
<p>Important actions such as invitations, plan changes and API key changes are recorded in the workspace activity log, visible to owners.</p>`);

const ethics = legal('ethics', '/research-ethics/', 'Research ethics', 'The principles IoBeacons follows for research involving people, places and location data.', `
<p>Location data can say a lot about people. When IoBeacons takes part in research, we follow these principles.</p>
<h2>Consent</h2>
<p>People who carry a tracker or whose location is studied should know and agree, in plain language, before collection starts.</p>
<h2>Collect only what is needed</h2>
<p>We help projects collect the least detail that answers the question, and keep it only as long as needed.</p>
<h2>Protect identities</h2>
<p>Published results should not reveal where an individual lives, works or goes. We round, group or remove data where needed.</p>
<h2>Review</h2>
<p>Studies involving people should have approval from the right ethics board or review process before they begin.</p>
<h2>Say where data came from</h2>
<p>Results should name their sources so others can check and repeat them.</p>
<p>Planning a study? <a href="/contact/?topic=Research">Talk to us</a> before you start.</p>`);

const security = legal('security', '/security/', 'Security', 'How IoBeacons protects accounts and data.', `
<h2>In transit and at rest</h2>
<p>All traffic to iobeacons.com uses HTTPS. Data is stored in a managed database on servers we control, with daily backups.</p>
<h2>Accounts</h2>
<p>Passwords are stored only as strong one-way hashes. Sign-in attempts are rate limited. Password reset links expire and can be used once, and resetting signs you out everywhere else.</p>
<h2>API keys</h2>
<p>API keys are shown once and stored only as hashes. Owners can revoke a key at any time.</p>
<h2>Isolation</h2>
<p>Each workspace's data is checked on every request so customers cannot reach each other's data.</p>
<h2>Webhooks</h2>
<p>Webhook calls carry a signature so your systems can check they came from IoBeacons.</p>
<h2>Reporting a problem</h2>
<p>If you think you have found a security issue, please <a href="/contact/?topic=Support">contact us</a> with details. We will reply, keep you updated and credit you if you wish.</p>`);

const developersApi = apiReferencePage({ crumbs, CTA });

export const PAGES = [home, platform, maps, space, network, research, developers, developersApi, contact, privacy, terms, governance, ethics, security];
