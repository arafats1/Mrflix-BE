#!/usr/bin/env bash
# Copy the Railway MySQL database into the VPS MySQL. Run on the VPS as "deploy":
#   bash /opt/mrflix/src/deploy/migrate-db.sh
#
# Asks for the Railway connection details (nothing is saved), dumps Railway
# into /opt/mrflix/backups, then REPLACES the VPS database with that dump.
# The app is stopped during the import and started again afterwards.
set -euo pipefail

cd /opt/mrflix/src
DC=(docker compose -f deploy/docker-compose.yml --env-file /opt/mrflix/.env --env-file /opt/mrflix/db.env)
# shellcheck disable=SC1091
source /opt/mrflix/db.env

read -rp  "Railway host [gondola.proxy.rlwy.net]: " R_HOST; R_HOST="${R_HOST:-gondola.proxy.rlwy.net}"
read -rp  "Railway port [14469]: " R_PORT; R_PORT="${R_PORT:-14469}"
read -rp  "Railway database [railway]: " R_DB; R_DB="${R_DB:-railway}"
read -rp  "Railway user [root]: " R_USER; R_USER="${R_USER:-root}"
read -rsp "Railway password: " R_PASS; echo

DUMP="/opt/mrflix/backups/railway-$(date +%Y%m%d-%H%M%S).sql"

echo "==> Dumping Railway -> $DUMP"
docker run --rm -e MYSQL_PWD="$R_PASS" mysql:9.7 \
  mysqldump -h "$R_HOST" -P "$R_PORT" -u "$R_USER" \
    --single-transaction --quick --routines --triggers --events \
    --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 \
    "$R_DB" > "$DUMP"
tail -n 1 "$DUMP" | grep -q "Dump completed" || { echo "Dump looks incomplete: $DUMP" >&2; exit 1; }
echo "    $(du -h "$DUMP" | cut -f1), $(grep -c '^CREATE TABLE' "$DUMP") tables"

read -rp "This REPLACES the '$DATABASE_NAME' database on the VPS. Type yes to continue: " ok
[ "$ok" = yes ] || { echo "Stopped. Dump kept at $DUMP"; exit 1; }

echo "==> Starting MySQL, stopping the app"
"${DC[@]}" up -d --wait mysql
"${DC[@]}" stop app 2>/dev/null || true

mysql_root() { "${DC[@]}" exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql mysql -uroot "$@"; }

echo "==> Recreating '$DATABASE_NAME' and importing"
mysql_root -e "DROP DATABASE IF EXISTS \`$DATABASE_NAME\`;
  CREATE DATABASE \`$DATABASE_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  GRANT ALL PRIVILEGES ON \`$DATABASE_NAME\`.* TO '$DATABASE_USERNAME'@'%';"
mysql_root "$DATABASE_NAME" < "$DUMP"

echo "==> Comparing table counts"
src=$(docker run --rm -e MYSQL_PWD="$R_PASS" mysql:9.7 mysql -N -h "$R_HOST" -P "$R_PORT" -u "$R_USER" \
  -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$R_DB'")
dst=$(mysql_root -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DATABASE_NAME'")
echo "    Railway: $src tables | VPS: $dst tables"
for t in movies up_users; do
  a=$(docker run --rm -e MYSQL_PWD="$R_PASS" mysql:9.7 mysql -N -h "$R_HOST" -P "$R_PORT" -u "$R_USER" "$R_DB" -e "SELECT COUNT(*) FROM \`$t\`" 2>/dev/null || echo "-")
  b=$(mysql_root -N "$DATABASE_NAME" -e "SELECT COUNT(*) FROM \`$t\`" 2>/dev/null || echo "-")
  echo "    $t rows  Railway: $a | VPS: $b"
done

echo "==> Starting the app"
"${DC[@]}" up -d app
echo "Done. Watch it boot with:  cd /opt/mrflix/src && bash deploy/logs.sh"
