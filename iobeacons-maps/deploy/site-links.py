#!/usr/bin/env python3
"""Adds the IoBeacons Maps links to the main iobeacons.com site.

  sudo python3 deploy/site-links.py [/var/www/iobeacons.com]

1. Main menu: a "Maps" item (key mapsApp, link /maps/) after "Maps Roadmap".
2. Maps Roadmap page: a "Try the live demo" link under the intro text.

Backs up both files to /root/iobeacons-bak-maps-link-<time>/ first.
Safe to run again: it skips anything that is already there.
"""
import os, re, shutil, sys, time

ROOT = sys.argv[1] if len(sys.argv) > 1 else '/var/www/iobeacons.com'
HOME = os.path.join(ROOT, 'public', 'index.html')
ROADMAP = os.path.join(ROOT, 'maps-roadmap', 'index.html')
BAK = '/root/iobeacons-bak-maps-link-' + time.strftime('%Y%m%d-%H%M%S')
LABELS = ['Maps', 'Mapas', 'Cartes', 'Mapas']  # en, es, fr, pt

os.makedirs(BAK, exist_ok=True)
for f in (HOME, ROADMAP):
    if os.path.exists(f):
        shutil.copy2(f, os.path.join(BAK, os.path.basename(os.path.dirname(f)) + '-index.html'))
print('Backup:', BAK)

# 1. Main menu
text = open(HOME, encoding='utf-8').read()
if re.search(r'''key:\s*["']mapsApp["']''', text):
    print('Menu: Maps item already there.')
else:
    entry = re.search(r'''\{\s*key:\s*["']maps["'][^}]*\}''', text)
    if not entry:
        sys.exit('Menu: could not find the Maps Roadmap entry; nothing changed.')
    text = text[:entry.end()] + ', { key: "mapsApp", path: "/maps/", raw: true }' + text[entry.end():]
    labels = list(re.finditer(r'''(?<![\w.])maps\s*:\s*(["'])(?:(?!\1).)*\1\s*,?''', text))
    for i, m in reversed(list(enumerate(labels))):
        word = LABELS[i] if len(labels) == len(LABELS) else 'Maps'
        if m.group(0).rstrip().endswith(','):
            add = ' mapsApp: "%s",' % word
        else:
            add = ', mapsApp: "%s"' % word
        text = text[:m.end()] + add + text[m.end():]
    open(HOME, 'w', encoding='utf-8').write(text)
    print('Menu: added Maps item and %d labels.' % len(labels))

# 2. Roadmap demo link
if os.path.exists(ROADMAP):
    page = open(ROADMAP, encoding='utf-8').read()
    if 'href="/maps/"' in page:
        print('Roadmap: demo link already there.')
    else:
        link = ('\n<p style="margin-top:18px"><a href="/maps/" style="display:inline-block;'
                'padding:12px 20px;border-radius:999px;background:#ff713d;color:#fff;'
                'font-weight:600;text-decoration:none">Try the live demo &rarr;</a></p>')
        m = re.search(r'<p[^>]*class="[^"]*\blede\b[^"]*"[^>]*>.*?</p>', page, re.S) or re.search(r'</h1>', page)
        if not m:
            print('Roadmap: no intro found; skipped.')
        else:
            page = page[:m.end()] + link + page[m.end():]
            open(ROADMAP, 'w', encoding='utf-8').write(page)
            print('Roadmap: added demo link.')
else:
    print('Roadmap: page not found; skipped.')
