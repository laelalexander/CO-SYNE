#!/usr/bin/env bash
# Publishes the iobeacons.com website pages (site/) next to IoBeacons Maps.
#
#   sudo bash deploy/site-install.sh
#
# Run from the release folder after deploy/install.sh. It:
#  1. builds the pages (node site/build.mjs),
#  2. backs up every file it will replace to /root/iobeacons-site-bak-<time>/,
#  3. copies the pages into the web root,
#  4. puts the shared header and footer on Featured Projects and Maps Roadmap,
#  5. checks the pages answer, and fixes nginx if new folders are not served.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
WWW=${WWW:-/var/www/iobeacons.com}
ROOT=${SITE_ROOT:-$WWW/public}
NGINX_SITE=${NGINX_SITE:-/etc/nginx/sites-available/iobeacons.com}
DOMAIN=${SITE_DOMAIN:-iobeacons.com}
STAMP=$(date +%Y%m%d-%H%M%S)
BAK=/root/iobeacons-site-bak-$STAMP

say() { printf '\n== %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
[ -f "$ROOT/index.html" ] || { echo "No $ROOT/index.html. Set SITE_ROOT to the folder that serves https://$DOMAIN/."; exit 1; }

say "Building the pages"
node "$SRC/site/build.mjs"
DIST="$SRC/site/dist"

say "Backing up to $BAK"
mkdir -p "$BAK"
(cd "$DIST" && find . -type f) | while read -r f; do
  if [ -f "$ROOT/$f" ]; then mkdir -p "$BAK/public/$(dirname "$f")"; cp -p "$ROOT/$f" "$BAK/public/$f"; fi
done
for p in featured-projects maps-roadmap; do
  for d in "$WWW/$p" "$ROOT/$p"; do
    [ -f "$d/index.html" ] && { mkdir -p "$BAK/$p"; cp -p "$d/index.html" "$BAK/$p/index.html"; }
  done
done
echo "Saved. To undo: cp -a $BAK/public/. $ROOT/ (and the two page backups)."

say "Copying pages"
cp -a "$DIST/." "$ROOT/"
chmod -R a+rX "$ROOT"
echo "Copied $(cd "$DIST" && find . -name index.html | wc -l) pages."

say "Shared header on Featured Projects and Maps Roadmap"
python3 - "$WWW" "$ROOT" <<'PY'
import re, sys, os
www, root = sys.argv[1], sys.argv[2]
TAG = '<script type="module" src="/site-assets/site-header.js"></script>'
for page, current in (('featured-projects', 'projects'), ('maps-roadmap', 'maps')):
    path = next((p for p in (os.path.join(www, page, 'index.html'), os.path.join(root, page, 'index.html')) if os.path.exists(p)), None)
    if not path:
        print(f'{page}: not found, skipped'); continue
    html = open(path, encoding='utf-8').read()
    if 'site-assets/site-header.js' in html:
        print(f'{page}: already has the shared header'); continue
    notes = []
    # Replace an old menu header (a <header> with a <nav> and no page title in it).
    m = next((m for m in re.finditer(r'<header\b[^>]*>.*?</header>', html, re.S | re.I) if '<nav' in m.group(0).lower() and '<h1' not in m.group(0).lower()), None)
    div = f'<div data-site-header data-current="{current}"></div>'
    if m:
        html = html[:m.start()] + div + html[m.end():]; notes.append('replaced old menu')
    else:
        html = re.sub(r'(<body\b[^>]*>)', r'\1\n' + div, html, count=1, flags=re.I); notes.append('added header at top')
    f = list(re.finditer(r'<footer\b[^>]*>.*?</footer>', html, re.S | re.I))
    if f:
        html = html[:f[-1].start()] + '<div data-site-footer></div>' + html[f[-1].end():]; notes.append('replaced footer')
    else:
        html = re.sub(r'</body>', '<div data-site-footer></div>\n</body>', html, count=1, flags=re.I); notes.append('added footer')
    html = re.sub(r'</body>', TAG + '\n</body>', html, count=1, flags=re.I)
    # Old floating "Download the Android tracker" button points at a page that moved.
    html = html.replace('href="/download/"', 'href="/network/#tracker"')
    open(path, 'w', encoding='utf-8').write(html)
    print(f'{page}: ' + ', '.join(notes))
PY

check() { curl -fsS --max-time 15 "https://$DOMAIN$1" 2>/dev/null | grep -c "data-page=\"$2\"" || true; }

say "Checking pages"
if [ "$(check /platform/ platform)" = 0 ]; then
  echo "New folders are not served yet; adding an nginx rule for them."
  cp "$NGINX_SITE" "/root/$(basename "$NGINX_SITE").bak-site-$STAMP"
  python3 - "$NGINX_SITE" "$DOMAIN" "$ROOT" <<'PY'
import re, sys
site, domain, root = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(site).read()
block = ('    # iobeacons.com pages (added by site-install.sh)\n'
         '    location ~ ^/(platform|network|research|developers|contact|privacy|terms|data-governance|research-ethics|security|satellite|observe|download|site-assets)(/|$) {\n'
         f'        root {root};\n'
         '        try_files $uri $uri/index.html $uri/ =404;\n'
         '    }\n'
         '    location = /sitemap.xml { root ' + root + '; }\n'
         '    location = /robots.txt { root ' + root + '; }\n')
best = None
for m in re.finditer(r'server\s*\{', text):
    depth, i = 0, m.end() - 1
    while i < len(text):
        if text[i] == '{': depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0: break
        i += 1
    body = text[m.start():i]
    if 'listen 443' in body or 'listen [::]:443' in body:
        names = (re.search(r'server_name\s+([^;]+);', body) or [None, ''])[1].split()
        score = (domain in names) * 2 + ('return 301' not in body)
        if not best or score > best[0]: best = (score, m.start(), body)
if not best: sys.exit('No HTTPS server block found.')
_, start, body = best
loc = body.find('\n    location')
pos = start + (loc + 1 if loc >= 0 else body.find('{') + 2)
open(site, 'w').write(text[:pos] + block + text[pos:])
print('Added nginx rule.')
PY
  if nginx -t; then systemctl reload nginx; else
    echo "nginx test failed; restoring."; cp "/root/$(basename "$NGINX_SITE").bak-site-$STAMP" "$NGINX_SITE"; nginx -t && systemctl reload nginx; exit 1
  fi
  sleep 1
fi

ok=1
for pair in /:home /platform/:platform /platform/maps/:maps /platform/space/:space /network/:network /research/:research /developers/:developers /contact/:contact /privacy/:privacy /terms/:terms; do
  url=${pair%%:*}; key=${pair##*:}
  n=$(check "$url" "$key")
  if [ "$n" = 0 ]; then echo "MISSING $url"; ok=0; else echo "ok      $url"; fi
done
for u in /maps/ /maps-roadmap/ /featured-projects/ /cosyne/ /robots.txt /sitemap.xml; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN$u")" "$u"
done
[ "$ok" = 1 ] && echo && echo "Website published. Backup: $BAK" || { echo; echo "Some pages are not served. Backup: $BAK"; exit 1; }
