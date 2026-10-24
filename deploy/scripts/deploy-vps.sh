#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/pactagent}"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"
RELEASE_FILE="${DEPLOY_DIR}/release.env"
PREVIOUS_FILE="${DEPLOY_DIR}/previous-release.env"
: "${PACTAGENT_SERVER_IMAGE:?PACTAGENT_SERVER_IMAGE is required}"
: "${PACTAGENT_MIGRATE_IMAGE:?PACTAGENT_MIGRATE_IMAGE is required}"
: "${PACTAGENT_WEB_IMAGE:?PACTAGENT_WEB_IMAGE is required}"
: "${PACTAGENT_RELEASE_SHA:?PACTAGENT_RELEASE_SHA is required}"

cd "$DEPLOY_DIR"
if [[ -f "$RELEASE_FILE" ]]; then cp "$RELEASE_FILE" "$PREVIOUS_FILE"; fi
umask 077
cat > "$RELEASE_FILE" <<EOF
PACTAGENT_SERVER_IMAGE=${PACTAGENT_SERVER_IMAGE}
PACTAGENT_MIGRATE_IMAGE=${PACTAGENT_MIGRATE_IMAGE}
PACTAGENT_WEB_IMAGE=${PACTAGENT_WEB_IMAGE}
PACTAGENT_RELEASE_SHA=${PACTAGENT_RELEASE_SHA}
EOF

compose=(docker compose --env-file .env --env-file "$RELEASE_FILE" -f "$COMPOSE_FILE")
cleanup() { [[ "$?" -eq 0 ]] || { echo "Deployment failed; recent service logs:"; "${compose[@]}" logs --tail=80 api worker web redis || true; }; }
trap cleanup EXIT

"${compose[@]}" config >/dev/null
"${compose[@]}" pull api worker web redis migrate
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --remove-orphans api worker web redis

for service in redis api worker web; do
  "${compose[@]}" up -d --wait "$service"
done
echo "Deployment successful: ${PACTAGENT_RELEASE_SHA}"
