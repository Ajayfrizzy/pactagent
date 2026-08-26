# Phase 1 Infrastructure Cleanup Report

Date: 2026-08-22

## Phase 1 correction pass (2026-08-26)

### Webhook migration correction

The cleanup migration previously populated `secretHash` with
`COALESCE(secretHash, signingSecret)`. That could store a legacy plaintext
secret in a hash field and leave an active endpoint without decryptable
`secretCiphertext`.

The corrected migration never copies `signingSecret` into `secretHash`.
Endpoints remain active only when `secretHash`, `secretCiphertext`, and
`encryptionKeyVersion` are all present. Any endpoint missing current secret
material is migrated with `status = 'disabled'`; a missing ciphertext also
clears `encryptionKeyVersion`, and `secretHash` remains null when no real hash
already exists. A database check prevents incomplete endpoints from becoming
active. Archived webhook metadata retains the existing endpoint fields but
stores `[redacted]` instead of plaintext and removes hash/ciphertext material
from the retired compatibility-tenant copy.

The `/v1` API reports `requiresSecretRotation` and rejects attempts to enable
an incomplete migrated endpoint with `webhook_secret_rotation_required`. The
developer console labels that state as `Recreate required` and does not offer
an enable action. Phase 1 has no endpoint-secret rotation API, so an operator
must delete and recreate such an endpoint to receive a new secret before
delivery can resume.

### CKB primitive review

The deleted `ckbService.ts` and `onchainEscrowService.ts` implementations were
reviewed against the retained Rust contract and the `/v1` rail boundary.
Three deterministic, configuration-free primitives were preserved under
`server/src/rails/ckb/`:

- RPC/CCC script normalization and comparison
- Contract-compatible 96-byte lock-args and 88-byte escrow cell-data codecs
- Occupied-capacity calculation from injected scripts and output data

Raw JSON-RPC calls, transaction/outpoint inspection, address derivation, cell
dep configuration, treasury transfers, signer behavior, and old agreement
orchestration remain deleted. The old RPC inspection mixed node and indexer
assumptions, while the other functions depended on retired product/config
boundaries. Phase 2 should design those pieces around the implemented adapter,
explicit node/indexer clients, signer isolation, and reconciliation. The CKB
adapter remains unchanged as an intentional `escrow_adapter_not_ready` stub.

### Files changed in the correction pass

- Webhook migration/schema/API/UI:
  `server/prisma/migrations/20260821000200_core_schema_cleanup/migration.sql`,
  `server/prisma/schema.prisma`, webhook model/service and infrastructure
  integration test files, and `web/src/app/console/page.tsx`
- Migration rehearsal:
  `server/prisma/fixtures/migration-upgrade.sql`, new
  `migration-upgrade-verify.sql`, and `.github/workflows/ci.yml`
- CKB primitives: new `server/src/rails/ckb/` codec, script, capacity, and test
  files
- Stale-reference cleanup: `.github/workflows/deploy.yml`,
  `scripts/ckb-testnet-smoke.mjs`, and `contracts/README.md`
- Report: `REPORT.md`

### Correction verification results

- `npm ci`: pass, 888 packages installed; this host runs Node 25.9.0 while the
  repository requires Node 24.x, so npm emitted the expected engine warning
- Prisma format check, validate, and generate: pass
- PostgreSQL 16 clean install: pass, all 17 migrations applied and current
- Historical baseline upgrade with populated App, API key, Agreement,
  Milestone, Proof, Review, Dispute, Escrow, Transaction, Event, webhook,
  delivery, AuditLog, AgentJob, idempotency, and legacy product fixtures: pass,
  all 17 migrations current
- Upgrade assertions: pass for complete-current webhook preservation,
  plaintext-only endpoint disablement, plaintext removal, archive redaction,
  delivery/job tenancy, core record survival, legacy archival/removal, active
  endpoint secret constraints, and archive PUBLIC-access revocation
- Server unit/E2E tests: pass, 81 tests; includes the `/api/*` 410 boundary and
  six focused CKB primitive tests
- Real-PostgreSQL integration tests: pass, 22 tests; includes current webhook
  creation and API/database rejection of incomplete endpoint activation
- Server and web production build: pass; the sandboxed Turbopack attempt could
  not bind its helper port, and the same build passed with local binding allowed
- Lint: pass for server and web
- OpenAPI validation: pass, 58 operations match the Express `/v1` route table
- Deployment validation: pass, 10 Kubernetes resources and 2 smoke tests
- Environment validation: pass, all 73 referenced variables covered
- Controls, observability, and Phase 7 validation: pass
- License tests/check: pass, 888 installed packages covered
- Dependency audit tests/check: pass, no unexcepted high-or-higher records
- Rust contract tests: pass, 6 tests

### Remaining Phase 2 work and merge readiness

The full CKB adapter, signer infrastructure, typed node/indexer RPC access,
transaction construction, fee policy, confirmation/reconciliation behavior,
and deployment cell-dep configuration remain Phase 2 work. A first-class
webhook signing-secret rotation operation may also be added there; Phase 1
requires endpoint recreation instead.

No concurrency hardening, aggregate financial locking, uniqueness overhaul,
new chain/fiat rails, AI, marketplace, or social functionality was added. With
the checks above passing, this Phase 1 branch is ready to merge; CI should run
the same committed migration assertions before merge.

## 1. Cleanup summary

PactAgent now presents one supported product boundary: app-scoped infrastructure under `/v1`, with a developer console as the first-party UI.

### Kept in the infrastructure core

- Apps/projects as tenants and operator-owned API-key management
- Operator wallet authentication, admin allowlisting, API-key scopes, and rate limits
- Agreements, milestones, proof submissions, proof review decisions, and disputes
- Escrow adapter interface, mock/manual adapters, CKB adapter boundary, and the CKB Rust contract
- Transactions, lifecycle events, signed webhooks, audit logs, and idempotency
- Durable webhook jobs, lease/retry/dead-letter behavior, retention, and worker health
- Health/readiness, metrics, tracing, deployment manifests, OpenAPI, and developer console
- Generic agreement integration fields: `externalReferenceId`, participant external IDs, `sourceType`, `sourceUrl`, and metadata

### Isolated or migrated

- Operator wallet authentication moved from `/api/auth` to `/v1/auth`; it manages infrastructure ownership rather than product users.
- All `/api/*` paths are a single `410 Gone` compatibility boundary with no lifecycle implementation.
- Historical product data is copied to the public-access-revoked `legacy_product_archive` schema before operational tables and columns are removed.
- Retired webhook secrets are redacted in archive copies rather than duplicated as recoverable credentials.
- The CKB contract remains under `contracts/`; the server adapter explicitly rejects CKB actions until Phase 2 implements the rail.

### Removed

- Public users/profiles, reputation, invitations, comments, amendments, product evidence/checks, and agent logs
- DAO, bounty, grant, forum/Nervos Talk import and synchronization behavior
- AI completeness/recommendation/follow-up flows and market-price conversion
- Fiber and old on-chain/treasury product settlement implementations
- Product agreement dashboard, public agreement flows, profile/settings/invite pages, and product wallet onboarding
- Websocket product updates and their browser/server state
- Settlement/AI worker roles; only the durable webhook queue remains
- The unused `shared` workspace and duplicated product contracts/state machine

## 2. Files and modules removed

### Backend

- Legacy route implementations under `server/src/routes/`: agreements, auth, integrations, invites, logs, me, profiles, and webhooks
- Product services: agreement orchestration, AI structured output, commitment/follow-up, Discourse/source sync, invite/profile/reputation, report review, market price, Nervos grant resolution, old CKB/on-chain escrow, treasury signer, rich payloads, old webhook service, and legacy tenant mapping
- Product-only unit tests associated with those services
- Server websocket entry point/tests and `common/websocket/websocket-bus.ts`
- Legacy tenant backfill command and package script

### Frontend

- Routes: `/admin`, `/dashboard`, `/agreement/*`, `/invites/*`, `/profiles/*`, `/settings/profile`, and `/settings/webhooks`
- Product components: agent log panel, status/product wallet compatibility wrappers, and wallet onboarding card
- Product websocket hook, rich-payload helpers, and browser-side agreement/CKB transaction builders
- Legacy API client methods and product state for logs, websocket connectivity, and agreement update broadcasts

### Shared/domain

- Entire unused `shared` workspace, including legacy enums, agreement state machine, product contracts, and generated local artifacts

### Documentation and product artifacts

- DAO proposal Markdown and DOCX artifacts
- Legacy route/service READMEs
- Root documentation was replaced with infrastructure setup and API guidance
- Active architecture, configuration, worker, provider, deployment, and roadmap documents were rewritten to remove retired capability claims

### Configuration/deployment

- Fiber, forum, AI/OpenAI, market-price, websocket, legacy-route, treasury signer, and on-chain adapter enablement variables
- Direct server `ws` and `@types/ws` dependencies (transitive wallet-library websocket dependencies remain)
- Settlement and AI worker services from Compose, Kubernetes, service discovery, operations exercises, and telemetry scraping

## 3. Database changes

### Models removed

- `User`
- `PublicProfile`
- `ReputationSnapshot`
- `InviteLink`
- `AgreementSource`
- `ProofCheck`
- `InfoRequest`
- `DisputeEvidence`
- `AgentLog`
- `MilestoneSettlement`
- `AgreementComment`
- `AgreementAmendment`

`Review` remains and is documented as a proof review decision record, not a social/reputation review.

### Agreement columns removed

- Product wallet participants: `clientAddress`, `workerAddress`, `arbitratorAddress`
- Fiber: `workerFiberPubkey`, `fiberPaymentReference`
- Product proof/reviewer configuration: `proofType`, `reviewerMode`, legacy `releaseMode`
- Product payout/escrow duplication: `payoutNetwork`, `escrowModel`, `escrowAddress`, lock-script fields, agreement/milestone digests
- Quote/reserve state: pricing mode, reserve balances, price quote/source/time, reserve health
- Product settlement duplication: last settlement error and legacy CKB create/fund/release transaction hashes

The canonical infrastructure `infrastructureReleaseMode` column is migrated to `releaseMode`. `disputeMode`, external participant IDs, amount/currency, deadline, generic source metadata, and settlement/lifecycle status remain.

### Other columns removed or changed

- Milestone quote, released-value, and legacy on-chain output fields removed
- Dispute wallet opener, evidence notes, and AI summary/recommendation/confidence/rationale removed; `openedByExternalId` remains
- Proof automation `reviewStatus` and `lastCheckedAt` removed; proof lifecycle status and `Review` decisions remain
- Webhook duplicate product columns removed; `appId` and `url` are required,
  while `secretHash` may be null only for disabled migrated endpoints that need
  recreation
- Webhook delivery `appId` is required
- `App.ownerUserId` renamed to `ownerId`; it stores the infrastructure operator identity
- `AgentJob.appId` is required and compound agreement tenancy is enforced
- Job kind/queue constrained to `DELIVER_WEBHOOK`/`webhook`; worker heartbeat defaults to `webhook`

### Relations and integrity

- Product-model relations were removed from agreement, milestone, proof, dispute, and app records.
- Agent jobs now relate directly to `App` and optionally to `(agreementId, appId)`.
- Existing compound tenant foreign keys remain the database tenant boundary.
- Funded agreement terms and milestone terms/membership triggers are recreated against the cleaned schema.

### Forward migrations

1. `20260821000100_archive_legacy_product`
   Archives product tables and fixed legacy-tenant operational rows, redacts retired webhook secrets, removes product tables/data, authorizes the append-only audit cleanup for the migration session, and revokes public archive access.
2. `20260821000200_core_schema_cleanup`
   Archives removed columns/unsupported jobs, renames app ownership, app-scopes jobs and webhooks, removes obsolete columns, constrains the remaining queue, and rebuilds funded-term triggers.

Historical migrations were not edited.

## 4. Legacy API status

- No `/api` route implementation remains.
- `server/src/app.ts` returns `410 Gone` for every `/api/*` request with direction to `/v1`.
- `/v1/auth` is the operator wallet session API.
- `/v1` is canonical for all apps, API keys, agreements, milestones, escrows, transactions, proofs, reviews, disputes, events, webhooks, audit logs, and admin operations.
- OpenAPI documents all 58 implemented `/v1` operations; validation now fails when an Express `/v1` route is undocumented or a documented route is missing.

## 5. Frontend status

The Next.js app now redirects `/` to `/console`. The remaining experience provides:

- App/project selection and creation
- Scoped API-key creation/revocation and key inspection
- Agreement, milestone, escrow, transaction, proof, review, dispute, event, and audit inspection
- Webhook endpoint management, delivery history, and retry
- Sandbox lifecycle workbench
- Operator admin/system health views
- Links to `/docs` and `/openapi.json`
- CKB wallet operator sign-in through `/v1/auth`

The console has no legacy `/api`, websocket, public profile, invite, bounty/forum import, social onboarding, or product settlement dependency.

## 6. Verification results

Completed checks:

- `npm install --ignore-scripts`: pass; removed retired workspace packages. The host uses Node 25.9.0 while the repository requires Node 24.x, so npm emitted an engine warning.
- `npx prisma format`: pass
- `npx prisma validate`: pass
- `npx prisma generate`: pass
- `npm test`: pass, 75 unit/E2E tests
- `npm run test:integration`: pass, 21 real-PostgreSQL infrastructure tests
- `npm run build`: pass for the TypeScript server and optimized Next.js production build
- `npm run env:check`: pass, 73 referenced variables covered
- `npm run openapi:check --workspace @pact-agent/server`: pass, 58 operations matched
- `npm run lint`: pass for server and web
- `npm run deploy:check`: pass, 10 Kubernetes resources and 2 smoke tests
- Production Compose interpolation/syntax check: pass with non-secret placeholder secret paths
- Server and web runtime container builds: pass, including isolated `npm ci`, Prisma generation, TypeScript/Next builds, and runtime assembly
- `npm run controls:check`: pass, 27 controls and evidence paths
- `npm run observability:check`: pass, collector pipelines, 8 alerts, and 6 dashboards
- `npm run phase7:check`: pass, 3 load profiles, 12 paginated repositories, 5 exercises, and critical query plans
- `npm run licenses:test`: pass, 2 policy tests
- `npm run licenses:check`: pass, 888 installed packages checked at the time of the run
- `npm run audit:test`: pass, 2 audit-policy tests
- `npm run audit:dependencies`: pass; patched `fast-uri`/`nanoid` overrides are installed and the exact Prisma tooling exception is active
- Exact server-workspace CI audit: pass against `server/package-lock.json` with the same scoped exception
- Clean-install migration rehearsal on PostgreSQL 16: pass, all 17 migrations applied and current
- Historical-baseline upgrade rehearsal on PostgreSQL 16: pass with populated core and legacy-product fixtures; all forward migrations applied and current
- Upgrade preservation checks: pass for app ownership, agreement, transaction/idempotency response data, product row archival, webhook-secret redaction, audit/job archival, compatibility-tenant deletion, and product-table removal
- `make test` under `contracts/`: pass, 6 Rust contract tests
- Local console HTTP verification: pass; `/` redirects to `/console`, console/docs/OpenAPI return 200, the first render is infrastructure-only, and the `/v1/auth` proxy returns the canonical envelope

The first sandboxed Next production build attempt reached compilation but Turbopack could not bind its internal helper port (`EPERM`). The same build passed when local process binding was allowed.

Visual browser verification is the remaining test limitation. The mandated in-app browser runtime rejected bootstrap because its host did not provide required sandbox metadata, so desktop/mobile screenshots and hydrated interaction checks could not be collected. This is recorded as a tooling limitation rather than a visual pass; production build, server-rendered markup, route responses, and the `/v1` proxy were verified independently.

## 7. Deferred items for Phase 2

- Compare-and-swap lifecycle transitions and concurrency conflict behavior
- Exact agreement/milestone financial locks and aggregate invariants
- One-active-escrow enforcement and dispute uniqueness
- Full CKB adapter: construction, signer isolation, fees, confirmations, reconciliation, and ambiguous outcomes
- Redis-backed one-time wallet challenge storage across replicas
- PostgreSQL enums and any broader lifecycle type migration
- Separate least-privilege database roles and renewed RLS evaluation
- Production migration rehearsal on an approved sanitized data set
- Deeper webhook/worker reliability and security work discovered during load testing

No fiat, USDT, multi-chain, AI proof verification, marketplace, chat, reputation replacement, or bounty integrations were added.

## 8. Remaining technical debt

- The agreement and milestone lifecycle still has both infrastructure status and settlement status fields; Phase 2 should formalize their invariant matrix.
- The CKB adapter is deliberately a rejecting stub while the Rust contract remains separately testable.
- Operator wallet challenges are process-local by design until the deferred Redis challenge work.
- The archive schema needs an externally approved retention/export/deletion policy and restricted production role grants.
- Some historical operations/ADR documents describe guarantees from earlier phases; active entry-point documents are corrected, but a later documentation governance pass should mark historical decisions as superseded where appropriate.
- Existing Prisma models still use string lifecycle values; database checks exist for several critical fields, while a complete enum strategy is deferred.
- The standalone migration image forces patched `deepmerge-ts`, `fast-uri`, `js-yaml`, and `valibot` transitive versions. Prisma's root development-workspace pin to `deepmerge-ts@7.1.5` retains a narrow exception through 2026-09-22, but the affected version is no longer shipped in the migration image.

## 9. Recommended next step

Deploy the two cleanup migrations to an isolated clone of the current production schema, verify archive row counts and representative agreement/webhook/job preservation, and obtain an explicit database-owner sign-off. Then begin Phase 2 with lifecycle compare-and-swap and financial invariants before implementing the CKB adapter.
