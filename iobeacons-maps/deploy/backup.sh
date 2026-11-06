#!/bin/sh
# Daily database backup for IoBeacons Maps. Keeps 14 days.
set -e
DIR=/var/backups/iobeacons-maps
mkdir -p "$DIR"
chmod 700 "$DIR"
su postgres -c "pg_dump -Fc iobmaps" > "$DIR/iobmaps-$(date +%Y%m%d-%H%M).dump"
find "$DIR" -name 'iobmaps-*.dump' -mtime +14 -delete
