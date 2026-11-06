#!/usr/bin/env bash
# Installs or updates IoBeacons Maps on an Ubuntu 24.04 server that already runs
# nginx (with HTTPS for the site) and Node 22.
#
#   sudo STAFF_EMAILS=you@example.com bash deploy/install.sh
#
# Run it from the unpacked release folder. Safe to run again for updates:
# it keeps the existing env file, database and nginx block.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/iobeacons-maps
ETC=/etc/iobeacons-maps
ENV_FILE=$ETC/iobeacons-maps.env
NGINX_SITE=${NGINX_SITE:-/etc/nginx/sites-available/iobeacons.com}
PORT=${PORT:-3120}
STAMP=$(date +%Y%m%d-%H%M%S)

say() { printf '\n== %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
command -v node >/dev/null || { echo "Node.js is not installed."; exit 1; }

say "Checking the port"
if ss -ltn "( sport = :$PORT )" | grep -q LISTEN && ! systemctl is-active --quiet iobeacons-maps; then
  echo "Port $PORT is already used by another program. Set PORT=... and try again."; exit 1
fi

say "PostgreSQL and PostGIS"
FRESH_PG=0
command -v psql >/dev/null || FRESH_PG=1
if [ "$FRESH_PG" = 1 ] || ! ls /usr/share/postgresql/*/extension/postgis.control >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib postgis postgresql-16-postgis-3
fi
systemctl enable --now postgresql
# Small footprint on a shared server, only when we installed PostgreSQL here
# (an existing install may be tuned for other apps).
PGCONF=$(su postgres -c "psql -tAc 'show config_file'")
if [ "$FRESH_PG" = 1 ] && ! grep -q 'iobeacons-maps tuning' "$PGCONF"; then
  cat >> "$PGCONF" <<'EOF'
# iobeacons-maps tuning (shared server)
shared_buffers = 128MB
work_mem = 8MB
maintenance_work_mem = 64MB
max_connections = 40
EOF
  systemctl restart postgresql
fi

say "System user and folders"
id iobmaps >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin iobmaps
mkdir -p "$APP" "$ETC"

say "Database"
if [ ! -f "$ENV_FILE" ]; then
  DBPASS=$(openssl rand -hex 24)
  if su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='iobmaps'\"" | grep -q 1; then
    su postgres -c "psql -qc \"alter role iobmaps with password '$DBPASS'\""
  else
    su postgres -c "psql -qc \"create role iobmaps login password '$DBPASS'\""
  fi
  sed -e "s#postgres://iobmaps:CHANGE_ME@#postgres://iobmaps:$DBPASS@#" \
      -e "s#^PORT=.*#PORT=$PORT#" \
      -e "s#^STAFF_EMAILS=.*#STAFF_EMAILS=${STAFF_EMAILS:-}#" \
      "$SRC/deploy/iobeacons-maps.env.example" > "$ENV_FILE"
  chown root:iobmaps "$ENV_FILE"; chmod 640 "$ENV_FILE"
  echo "Wrote $ENV_FILE"
else
  echo "Keeping existing $ENV_FILE"
fi
su postgres -c "psql -tAc \"select 1 from pg_database where datname='iobmaps'\"" | grep -q 1 || su postgres -c "createdb -O iobmaps iobmaps"
su postgres -c "psql -q -d iobmaps -c 'create extension if not exists postgis; create extension if not exists pgcrypto;'"

say "App files"
if [ -d "$APP/src" ]; then
  tar -C "$APP" --exclude=node_modules -czf "/root/iobeacons-maps-bak-$STAMP.tgz" . && echo "Backup: /root/iobeacons-maps-bak-$STAMP.tgz"
fi
# Copy the release (code, built public files) without touching node_modules.
tar -C "$SRC" --exclude=node_modules --exclude=.git --exclude=test -cf - . | tar -C "$APP" -xf -
chown -R iobmaps:iobmaps "$APP"
cd "$APP"
# Install everything, build the browser bundle here, then drop the build-only packages.
su iobmaps -s /bin/bash -c "cd $APP && HOME=$APP npm ci --no-audit --no-fund --loglevel=error && HOME=$APP npm run build && HOME=$APP npm prune --omit=dev --no-audit --no-fund --loglevel=error"

say "Service"
install -m 644 "$SRC/deploy/iobeacons-maps.service" /etc/systemd/system/iobeacons-maps.service
systemctl daemon-reload
systemctl enable iobeacons-maps >/dev/null
systemctl restart iobeacons-maps
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/maps/healthz" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/maps/healthz" || { echo "The app did not start. Last log lines:"; journalctl -u iobeacons-maps -n 40 --no-pager; exit 1; }
echo

say "Backups"
install -m 755 "$SRC/deploy/backup.sh" /etc/cron.daily/iobeacons-maps-backup

say "nginx"
if grep -q 'location \^~ /maps/' "$NGINX_SITE"; then
  echo "nginx already has the /maps/ block."
else
  cp "$NGINX_SITE" "/root/$(basename "$NGINX_SITE").bak-maps-$STAMP"
  # Insert the block into the HTTPS server block, before its first location.
  python3 - "$NGINX_SITE" "$SRC/deploy/nginx-maps.conf" <<'PY'
import sys, re
site, block = sys.argv[1], open(sys.argv[2]).read()
text = open(site).read()
# find the server block that listens on 443
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
        loc = body.find('\n    location')
        if loc < 0: loc = body.find('location')
        pos = m.start() + (loc + 1 if loc >= 0 else len(body))
        text = text[:pos] + block + '\n' + text[pos:]
        open(site, 'w').write(text)
        print('Inserted /maps/ block')
        break
else:
    sys.exit('No HTTPS server block found; add deploy/nginx-maps.conf by hand.')
PY
  if nginx -t; then systemctl reload nginx; else
    echo "nginx test failed; restoring the previous config."
    cp "/root/$(basename "$NGINX_SITE").bak-maps-$STAMP" "$NGINX_SITE"; nginx -t && systemctl reload nginx; exit 1
  fi
fi

say "Done"
echo "IoBeacons Maps is running: $(grep ^PUBLIC_URL "$ENV_FILE" | cut -d= -f2)/"
echo "Logs: journalctl -u iobeacons-maps -f"
