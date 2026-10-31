# Contributing to PactAgent

PactAgent is an npm workspace containing an Express API/worker and a Next.js developer console, plus a Rust CKB contract. Keep changes close to the module that owns them and do not reintroduce product-specific behavior into the infrastructure core.

## Repository map

| Path | Ownership |
| --- | --- |
| `server/` | `/v1` API, webhook worker, persistence, and maintenance commands |
| `web/` | Developer console, browser API client, and operator wallet integration |
| `contracts/` | CKB contract source and contract tooling |
| `docs/`, `server/docs/` | Architecture, API artifacts, and runbooks |
| `deploy/`, `observability/` | Deployment and telemetry definitions |
| `scripts/`, `config/`, `test/` | Cross-workspace tools, policy, and load tests |

Generated directories such as `dist/`, `.next/`, `node_modules/`, `contracts/build/`, and `contracts/target/` must remain untracked.

## Server placement

Add domain behavior under `server/src/modules/<feature>/`. A module may own routes, controllers, validation, services, repositories, events, models, and colocated tests. Use `server/src/common/` only for infrastructure shared by multiple modules.

Keep dependencies flowing in this direction:

```text
routes -> controllers -> services -> repositories
                         |
                         +-> common infrastructure
```

Existing external lifecycle routes remain under `/v1`. M1 authorizes only additive read-only registry/capability metadata under `/v2`; financial v2 writes require a later milestone. The `/api` mount is a terminal `410 Gone` compatibility response and must not acquire business logic.

Tenant-owned repository operations must resolve an `appId` from authenticated context. Cross-tenant administrative queries stay in the admin module and require operator admin authorization.

## Web placement

The first-party web app is infrastructure tooling. Keep route files focused on console composition, reusable components under `web/src/components/`, operator wallet integration under `web/src/features/wallet/`, and `/v1` access under `web/src/lib/`.

Marketplace, profile, reputation, invitation, forum import, and other product experiences belong in an integrating application or a separately owned example repository.

## Tests and documentation

- Colocate unit tests using `*.test.ts`.
- Put cross-module database tests in an explicit integration test file.
- Add forward Prisma migrations; never rewrite an applied migration.
- Update the checked-in OpenAPI for every `/v1` route.
- Add an ADR for changes to security, data ownership, service boundaries, or guarantees.

Before opening a change, run:

```bash
npm run lint
npm test
npm run build
npm run openapi:check --workspace @pact-agent/server
```

Database-backed integration tests require local PostgreSQL and run separately with `npm run test:integration`.

## Permanent staging-first Git workflow

`main` is production only. `staging` is the permanent integration and pre-production branch. Normally create feature, fix, architecture and milestone branches from an up-to-date `origin/staging`, and open their pull requests into `staging`. Do not commit directly to either permanent branch, force-push, rewrite history or merge development branches directly into `main`.

Production promotion requires a reviewed PR from this repository's `staging` branch into `main`, all required checks passing, and explicit release approval. Branch policy CI rejects other PR sources for `main`. Configure branch rules to require that check as well as the existing CI/security checks; documentation alone is not branch protection.

CI runs for pull requests (including targets staging/main) and pushes to staging/main. Deployment is a separate manually dispatched operation: staging deployments must run from staging; production deployments must run from main with `approve_production` explicitly selected and protected-environment approval configured. Ordinary integration pushes do not authorize deployment. See [workflow setup and remaining configuration](docs/operations/staging-workflow.md).
