#!/usr/bin/env bash
# Nightly logical backup of the VPS database (cron: /etc/cron.d/mrflix-backup).
# Keeps 14 days in /opt/mrflix/backups. Contabo Auto Backup copies the whole disk
# on top of this; for off-site copies, also sync this folder off-site.
set -euo pipefail

# shellcheck disable=SC1091
source /opt/mrflix/db.env
OUT="/opt/mrflix/backups/mrflix-$(date +%Y%m%d-%H%M%S).sql.gz"

docker compose -f /opt/mrflix/src/deploy/docker-compose.yml \
  --env-file /opt/mrflix/.env --env-file /opt/mrflix/db.env exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysqldump -uroot --single-transaction --quick --routines --triggers --events \
    --no-tablespaces --set-gtid-purged=OFF "$DATABASE_NAME" | gzip > "$OUT" || { rm -f "$OUT"; echo "$(date -Is) backup FAILED" >&2; exit 1; }

find /opt/mrflix/backups -name 'mrflix-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
