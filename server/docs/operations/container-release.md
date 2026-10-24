# Container release and rollback

## Release contract

The deployment workflow builds server, migration, and web images in GitHub Actions and publishes both a `sha-<commit>` tag and the registry digest returned by the build. VPS hosts receive only digest references in `release.env`; they do not check out source, install dependencies, generate Prisma clients, or compile code.

The `staging` and `production` GitHub environments provide `VPS_HOST`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY`, optional `VPS_SSH_PORT`, and the `SMOKE_API_URL` and `SMOKE_WEB_URL` variables. Staging also requires `SMOKE_API_KEY`. Application/database secrets remain in restricted VPS `.env` and keyring files.

Before the first deployment, provision Docker Engine, Compose v2, `/opt/pactagent/<environment>`, the environment `.env`, keyring files, and an SSH account with access to that directory. Enable Docker at boot and configure firewall ports 22, 80, and 443.

Configure the remaining secrets under **Settings > Environments** and keep staging and production values distinct.

## Promotion order

1. CI builds and scans the same Dockerfile targets used for release.
2. The release workflow publishes immutable images and records their digests.
3. The migration Job runs the tenant-integrity audit and `prisma migrate deploy` exactly once. An unsuccessful Job stops the release before any application workload changes.
4. `pactagent-api`, `pactagent-worker-infrastructure`, and `pactagent-web` receive the new digest references independently.
5. Compose health checks gate the API, worker, web, and Redis services before external smoke checks.
6. Smoke checks verify build commit, API liveness/readiness, PostgreSQL, worker heartbeat, queue visibility, settlement provider readiness, and the web response.
7. Only a successful release is annotated with its commit and immutable image references.

## Failed application promotion

If migration or health checks fail, the workflow exits non-zero and prints recent Compose logs. Run `rollback-vps.sh` to restore `previous-release.env`; database migrations are forward-only.

## Database forward-fix policy

Application rollback does not and must not reverse an applied database migration. Every migration released with a rolling deployment must be backward compatible with the immediately previous application revision: expand schema first, deploy compatible code, backfill separately, and contract only in a later release after the old revision cannot return.

If a migration succeeded but the application cannot promote, restore the previous compatible application revision and write an explicit forward repair migration. Never edit `_prisma_migrations`, run a down migration against production, or restore an older database merely to match rolled-back code. If a migration is not backward compatible, stop before production and ship a corrected expand/migrate/contract sequence.

## Manual verification

Use these read-only checks after an automated rollback:

```bash
docker compose ps
docker compose logs api worker web redis
EXPECTED_COMMIT=<commit> SMOKE_API_URL=https://api.example.com SMOKE_WEB_URL=https://app.example.com node scripts/deployment-smoke.mjs
```
