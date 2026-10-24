#!/usr/bin/env bash
# Installs or updates CO-SYNE on an Ubuntu/Debian server under /opt/cosyne,
# served at https://iobeacons.com/cosyne/ through the existing web server.
# Run from the unpacked project folder:  sudo bash deploy/install.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/cosyne

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v turnserver >/dev/null || apt-get install -y coturn

id cosyne >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin cosyne
mkdir -p "$APP/data" /etc/cosyne
# Keep the data folder (keys, ledger) across updates.
tar -C "$SRC" --exclude=./data --exclude=./node_modules --exclude=./.git -cf - . | tar -C "$APP" -xf -
(cd "$APP" && npm ci --omit=dev --no-audit --no-fund)
chown -R cosyne:cosyne "$APP"

if [ ! -f /etc/cosyne/cosyne.env ]; then
  SECRET=$(openssl rand -hex 32)
  sed -e "s/replace-with-output-of-openssl-rand-hex-32/$SECRET/" \
      -e "s/change-me-dispatch/$(openssl rand -hex 4)/" \
      -e "s/change-me-officer/$(openssl rand -hex 4)/" \
      "$SRC/deploy/cosyne.env.example" > /etc/cosyne/cosyne.env
  chmod 600 /etc/cosyne/cosyne.env
  sed "s/SAME_VALUE_AS_TURN_SECRET/$SECRET/" "$SRC/deploy/turnserver.conf" > /etc/turnserver.conf
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true
  systemctl enable --now coturn || true
  systemctl restart coturn || true
fi

cp "$SRC/deploy/cosyne.service" /etc/systemd/system/cosyne.service
systemctl daemon-reload
systemctl enable cosyne
systemctl restart cosyne

if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 3478 && ufw allow 49160:49200/udp
fi

sleep 2
curl -fsS http://127.0.0.1:3100/api/config >/dev/null && echo "CO-SYNE is running on 127.0.0.1:3100"
echo "Access codes are in /etc/cosyne/cosyne.env (DISPATCH_TOKEN, OFFICER_ENROLL_CODE)."
echo "Now add deploy/nginx-cosyne.conf (or the Apache/Caddy version) to the iobeacons.com site and reload it."
