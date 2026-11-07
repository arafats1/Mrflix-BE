#!/usr/bin/env bash
# Follow the app logs on the VPS:  bash /opt/mrflix/src/deploy/logs.sh [service]
exec docker compose -f /opt/mrflix/src/deploy/docker-compose.yml \
  --env-file /opt/mrflix/.env --env-file /opt/mrflix/db.env logs -f --tail 200 "${1:-app}"
