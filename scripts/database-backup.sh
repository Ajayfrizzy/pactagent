#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
output="${1:-artifacts/backups/pactagent-$(date -u +%Y%m%dT%H%M%SZ).dump}"
mkdir -p "$(dirname "$output")"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="$output"
pg_restore --list "$output" > "${output}.manifest"
if command -v sha256sum >/dev/null; then sha256sum "$output" > "${output}.sha256"; else shasum -a 256 "$output" > "${output}.sha256"; fi
echo "Backup: $output"
echo "Evidence: ${output}.manifest ${output}.sha256"
