# VPS deployment

PactAgent deploys to separate DigitalOcean staging and production Droplets through GitHub Actions over SSH. Each machine runs Docker Compose from `/opt/pactagent/<environment>` and connects to that environment's Supabase PostgreSQL instance.

## VPS provisioning

Install Docker Engine and the Compose v2 plugin, enable Docker at boot, create `/opt/pactagent/staging` or `/opt/pactagent/production`, and restrict ownership to the deployment user. Copy [`deploy/.env.example`](.env.example) to the environment directory as `.env`, replace every placeholder, and place the referenced keyring/token files under a root-readable secrets directory. Do not commit or print these values.

Allow only TCP 22 (or the configured SSH port), 80, and 443 in the DigitalOcean firewall. API and web bind to loopback so a separately provisioned Caddy/Nginx reverse proxy can terminate TLS; Redis, PostgreSQL, and worker health ports are never public.

## GitHub Environments

Create protected `staging` and `production` environments. Each requires `VPS_HOST`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY`, and optional `VPS_SSH_PORT` secrets, plus `SMOKE_API_KEY` where staging smoke tests need it. Set `SMOKE_API_URL` and `SMOKE_WEB_URL` as environment variables. Keep database, CKB, webhook, JWT, and Redis settings in the VPS `.env`, separately on each machine.

Pushes that pass CI on `staging` trigger an automatic staging deployment. Production is only deployed through `workflow_dispatch` with `environment=production`; GitHub Environment protection should require approval.

## Release and rollback

The workflow publishes immutable server, migration, and web images, records their registry digests, copies the Compose file and scripts, then runs:

1. `docker compose pull`
2. `docker compose run --rm migrate` (`prisma migrate deploy` in the image)
3. `docker compose up -d --remove-orphans api worker web redis`
4. Compose health checks and external API/web smoke checks

Migration failure stops the rollout. The script preserves `previous-release.env`; run `./rollback-vps.sh` on the relevant VPS to restore the previous application image references. Database migrations are forward-only and are never automatically rolled back.

Inspect operations with `docker compose ps`, `docker compose logs api`, `docker compose logs worker`, `docker compose logs web`, and `docker compose logs redis` from the environment directory. Configure Docker's json-file log rotation during VPS provisioning.

## Validation and limitations

`npm run deploy:check` validates the Compose contract and workflow statically. Real SSH, registry pulls, reverse proxy/domain setup, backups, firewall provisioning, and DigitalOcean deployment remain manual steps. A local validation pass is not a production deployment claim.
