# Container release and rollback

## Release contract

The deployment workflow builds server, migration, and web images in GitHub Actions and publishes both a `sha-<commit>` tag and the registry digest returned by the build. Kubernetes receives only digest references. Production hosts do not check out source, install dependencies, generate Prisma clients, or compile code.

The `staging` and `production` GitHub environments must provide the `KUBECONFIG_B64` environment secret and the `SMOKE_API_URL` and `SMOKE_WEB_URL` environment variables. Staging also requires the `SMOKE_API_KEY` environment secret for its load checks. A missing GitHub secret resolves to an empty string, so repository variables with the same names do not satisfy this contract. Provision each environment before its first deployment; GitHub can automatically create a referenced environment, but the new environment will not contain secrets or variables.

Before the first deployment to an environment, encode a minimal, environment-specific kubeconfig and store it as that environment's `KUBECONFIG_B64` secret. With GitHub CLI authenticated for the repository, the following command streams the current context directly to the staging secret without printing it:

```bash
kubectl config view --raw --minify --flatten |
  base64 |
  tr -d '\n' |
  gh secret set --env staging KUBECONFIG_B64
```

Repeat with `--env production` only when production is ready. The kubeconfig's API server must be reachable from a GitHub-hosted runner, and its identity should have only the permissions needed to deploy into the `pactagent` namespace. Configure the remaining secrets under **Settings > Environments > staging** and add the smoke URLs as environment variables, not secrets.

Before the first release, create `pactagent-secrets` in the `pactagent` namespace with the required production environment values, including separate `DATABASE_URL` and `DIRECT_URL`, `REDIS_URL`, `WEBHOOK_EGRESS_PROXY_URL`, keyrings, metrics token, admin addresses, CORS origins, signer configuration, and provider credentials. Keep that Secret under the deployment platform's secret manager rather than Git.

## Promotion order

1. CI builds and scans the same Dockerfile targets used for release.
2. The release workflow publishes immutable images and records their digests.
3. The migration Job runs the tenant-integrity audit and `prisma migrate deploy` exactly once. An unsuccessful Job stops the release before any application workload changes.
4. API, webhook worker, and web Deployments receive the new digest references independently.
5. Kubernetes readiness gates each rolling update with zero configured unavailability.
6. Smoke checks verify build commit, API liveness/readiness, PostgreSQL, worker heartbeat, queue visibility, settlement provider readiness, and the web response.
7. Only a successful release is annotated with its commit and immutable image references.

## Failed application promotion

If rollout readiness or smoke checks fail, the workflow runs `kubectl rollout undo` for every application Deployment and waits for the restored revisions. Inspect rollout history, pod events, application logs, migration Job logs, and `/ready` before retrying. A rollback is successful only when the prior application revisions are ready and their smoke checks pass.

## Database forward-fix policy

Application rollback does not and must not reverse an applied database migration. Every migration released with a rolling deployment must be backward compatible with the immediately previous application revision: expand schema first, deploy compatible code, backfill separately, and contract only in a later release after the old revision cannot return.

If a migration succeeded but the application cannot promote, restore the previous compatible application revision and write an explicit forward repair migration. Never edit `_prisma_migrations`, run a down migration against production, or restore an older database merely to match rolled-back code. If a migration is not backward compatible, stop before production and ship a corrected expand/migrate/contract sequence.

## Manual verification

Use these read-only checks after an automated rollback:

```bash
kubectl -n pactagent get deployments,pods,jobs
kubectl -n pactagent rollout history deployment/pactagent-api
kubectl -n pactagent logs job/pactagent-migrate
EXPECTED_COMMIT=<commit> SMOKE_API_URL=https://api.example.com SMOKE_WEB_URL=https://app.example.com node scripts/deployment-smoke.mjs
```
