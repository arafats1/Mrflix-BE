#!/usr/bin/env bash
# Runs on the VPS as "deploy" (GitHub Actions calls it after syncing the code).
# Builds the new image, restarts the app, waits for /_health, and rolls back
# to the previous image if the new one never becomes healthy.
set -euo pipefail

cd /opt/mrflix/src
DC=(docker compose -f deploy/docker-compose.yml --env-file /opt/mrflix/.env --env-file /opt/mrflix/db.env)

if [ ! -s /opt/mrflix/.env ]; then
  echo "/opt/mrflix/.env is empty - add the app's environment variables first (deploy/README.md)." >&2
  exit 1
fi

# Keep the current image so we can roll back.
docker image inspect mrflix-be:latest >/dev/null 2>&1 && docker tag mrflix-be:latest mrflix-be:previous

# Downloads from GitHub (sharp, better-sqlite3 binaries) sometimes time out
# during npm ci, so retry the build a couple of times before giving up.
for attempt in 1 2 3; do
  echo "==> Building (attempt $attempt)"
  "${DC[@]}" build app && break
  [ "$attempt" = 3 ] && { echo "!! Build failed 3 times" >&2; exit 1; }
  sleep 15
done

echo "==> Starting"
"${DC[@]}" up -d --remove-orphans

wait_healthy() {
  local id status
  id="$("${DC[@]}" ps -q app)"
  for _ in $(seq 1 60); do # up to 5 minutes
    status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)"
    [ "$status" = healthy ] && return 0
    [ "$status" = unhealthy ] && return 1
    sleep 5
  done
  return 1
}

if wait_healthy; then
  echo "==> Healthy"
  docker image prune -f >/dev/null
  exit 0
fi

echo "!! New version is not healthy. Last logs:" >&2
"${DC[@]}" logs --tail 150 app >&2 || true

if docker image inspect mrflix-be:previous >/dev/null 2>&1; then
  echo "==> Rolling back to the previous image" >&2
  docker tag mrflix-be:previous mrflix-be:latest
  "${DC[@]}" up -d --no-build app
fi
exit 1
