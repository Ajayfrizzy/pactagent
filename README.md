# PactAgent

PactAgent is app-scoped agreement and settlement infrastructure for creating programmable agreements, managing milestone-based work, collecting and reviewing proof, handling disputes, coordinating escrow, and settling through CKB.

The canonical API is `/v1`. The first-party web application is a developer console for apps, API keys, webhooks, lifecycle data, sandbox operations, and administration. Product-specific experiences belong to integrating applications.

## Core capabilities

- Apps as the tenant boundary, with operator-managed API keys and scopes
- Agreements, milestones, proof submissions, proof review decisions, and disputes
- Mock/manual escrow flows and a rail adapter boundary for CKB
- App-scoped transactions, lifecycle events, audit logs, and idempotent mutations
- HMAC-signed webhooks with durable delivery, retry, and delivery history
- Operator administration, health/readiness, metrics, tracing, and retention jobs
- OpenAPI documentation and a sandbox developer console

The former standalone product, public profiles, reputation, invites, comments, DAO/bounty/forum imports, Fiber payouts, AI review flows, and product dashboard are not part of the infrastructure core.

## Repository map

| Path | Purpose |
| --- | --- |
| `server/` | Express `/v1` API, PostgreSQL persistence, webhook worker, maintenance commands |
| `web/` | Next.js developer console and operator wallet sign-in |
| `contracts/` | CKB escrow contract source and deployment artifacts |
| `docs/` | Architecture decisions and repository-wide operations guidance |
| `server/docs/` | Runtime OpenAPI, integration examples, API policy, and server runbooks |
| `deploy/` | Kubernetes resources |
| `observability/` | OpenTelemetry, Prometheus alerts, and Grafana dashboards |
| `scripts/`, `config/`, `test/` | Environment tooling, controls, smoke checks, and load tests |

## Local setup

Prerequisites: Node.js 24, npm, Docker, and Docker Compose.

```bash
npm install
cp server/.env.example server/.env
cp web/.env.example web/.env.local
npm run setup
```

Set a development JWT secret in `server/.env` before wallet sign-in:

```env
AUTH_JWT_SECRET=replace-with-at-least-32-random-characters
```

Start the API and worker in separate terminals:

```bash
npm run dev --workspace @pact-agent/server
npm run worker --workspace @pact-agent/server
```

Start the console:

```bash
npm run dev --workspace @pact-agent/web
```

Default local endpoints:

- Developer console: `http://localhost:3000/console`
- API: `http://localhost:4000/v1`
- API docs: `http://localhost:4000/docs`
- OpenAPI: `http://localhost:4000/openapi.json`
- Health: `http://localhost:4000/health`
- Readiness: `http://localhost:4000/ready`

`npm run setup` starts PostgreSQL and Redis, deploys migrations, generates Prisma, and loads deterministic infrastructure fixtures. `npm run teardown` removes the local containers and volumes.

## Authentication

Operator endpoints for app, API-key, and admin management use a CKB wallet challenge and bearer session:

```text
POST /v1/auth/challenge
POST /v1/auth/verify
GET  /v1/auth/me
```

Integrator endpoints use an app-scoped API key in `x-api-key`. Each key has explicit scopes such as `agreements:create`, `proofs:review`, or `webhooks:manage`. Tenant identity is derived from the key and is never accepted from the request body.

Sensitive create/release/refund operations require an `Idempotency-Key` header. Reusing a key with the same body returns the recorded result; reusing it with a different body is rejected.

## API surface

| Domain | Representative endpoints |
| --- | --- |
| Apps and keys | `/v1/apps`, `/v1/api-keys` |
| Agreements and milestones | `/v1/agreements`, `/v1/agreements/{id}/milestones`, `/v1/milestones` |
| Escrow and transactions | `/v1/escrows`, `/v1/transactions` |
| Proof and review | `/v1/proofs`, `/v1/proofs/{id}/review`, `/v1/reviews` |
| Disputes | `/v1/disputes`, `/v1/disputes/{id}/resolve` |
| Events and webhooks | `/v1/events`, `/v1/webhook-endpoints`, `/v1/webhook-deliveries` |
| Audit and admin | `/v1/audit-logs`, `/v1/admin/*` |

The checked-in OpenAPI specification documents every implemented `/v1` operation and is validated against the Express route table in CI.

All `/api/*` requests return `410 Gone`; no legacy lifecycle implementation remains mounted.

## Settlement rails

Escrow behavior is selected through the adapter interface under `server/src/modules/escrows/adapters/`:

- `mock`: deterministic sandbox behavior used by the console and tests
- `manual`: records externally coordinated funding/release/refund state
- `ckb`: reserved adapter boundary; it intentionally returns `escrow_adapter_not_ready` in Phase 1

The CKB Rust contract remains in `contracts/`. Full `/v1` CKB transaction construction, signer integration, reconciliation, and concurrency hardening are Phase 2 work. Fiat, USDT, Fiber, and additional chains are not supported rails.

## Database changes

Prisma migrations are forward-only. The Phase 1 cleanup adds two explicit migrations:

1. Archive retired product tables and records into `legacy_product_archive`, then remove them from the operational schema.
2. Remove obsolete product columns, app-scope webhook jobs, require canonical webhook tenancy, rename `App.ownerUserId` to `ownerId`, and restore funded-term triggers against the cleaned models.

Run:

```bash
npm run db:migrate:status --workspace @pact-agent/server
npm run db:migrate:deploy --workspace @pact-agent/server
```

Review `server/prisma/MIGRATIONS.md` and back up the database before deploying migrations. The archive schema contains historical data and must remain access-restricted.

## Verification

```bash
npm run lint
npm test
npm run test:integration
npm run build
npm run openapi:check --workspace @pact-agent/server
npm run deploy:check
npm run observability:check
npm run controls:check
```

Contract tests run from `contracts/`:

```bash
make test
```

The Makefile resolves the local Rust host target while contract builds continue to target RISC-V.

## Documentation

- [Architecture and operations](docs/README.md)
- [Configuration](docs/configuration.md)
- [Integrator quickstart](server/docs/examples/integrator-quickstart.md)
- [API lifecycle policy](server/docs/api-lifecycle.md)
- [Phase 1 implementation report](REPORT.md)

## License

MIT
