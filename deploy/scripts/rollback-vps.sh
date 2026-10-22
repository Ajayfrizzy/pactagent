#!/usr/bin/env bash
set -euo pipefail
DEPLOY_DIR="${DEPLOY_DIR:-/opt/pactagent}"
[[ -s "$DEPLOY_DIR/previous-release.env" ]] || { echo "No previous release metadata found." >&2; exit 1; }
cp "$DEPLOY_DIR/previous-release.env" "$DEPLOY_DIR/release.env"
docker compose --env-file "$DEPLOY_DIR/.env" --env-file "$DEPLOY_DIR/release.env" -f "$DEPLOY_DIR/docker-compose.yml" pull api worker web
docker compose --env-file "$DEPLOY_DIR/.env" --env-file "$DEPLOY_DIR/release.env" -f "$DEPLOY_DIR/docker-compose.yml" up -d --remove-orphans api worker web redis
echo "Rolled back application images to ${DEPLOY_DIR}/release.env. Database migrations are forward-only."
