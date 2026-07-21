# Infrastructure implementation roadmap

This roadmap covers the remaining backlog work that can be delivered through source control. A phase is complete only when its acceptance criteria pass in CI. Controls that require cloud, production-data, or organizational authority are listed separately as external handoffs.

## Status definitions

- **Source-controlled:** implementation, tests, configuration, or documentation can be completed and reviewed in this repository.
- **Deployment-dependent:** the repository can supply an adapter, manifest, or automated check, but the control is not effective until infrastructure is provisioned.
- **Operational evidence:** completion requires a real exercise or evidence from a deployed environment.

## Phase 0: Baseline and safety net

**Goal:** establish reliable gates before changing database and worker behavior.

### Deliverables

- [x] Remove committed TypeScript build metadata and prevent it from being committed again.
- [x] Add CI secret scanning.
- [x] Add an enforceable dependency-license policy and report.
- [x] Make the full root build, lint, unit, integration, Prisma, OpenAPI, contract, audit, and image scan suite required.
- [x] Add a machine-readable backlog verification matrix that links controls to tests and files.
- [x] Record current query plans and migration duration using a representative local fixture.

### Acceptance criteria

- A clean checkout passes every required CI job using clean dependency installation.
- Generated build files do not change `git status` after build or lint.
- A committed test secret causes CI to fail.
- A disallowed dependency license causes CI to fail.

## Phase 1: Database and tenant integrity

**Goal:** make cross-tenant references impossible at the PostgreSQL layer.

### Deliverables

- [x] Add a pre-migration audit that reports existing cross-app references without mutating data.
- [x] Add compound foreign keys containing `appId` for agreements, milestones, proofs, reviews, escrows, transactions, disputes, events, webhook records, and other tenant-owned relations.
- [x] Add missing compound unique keys required by those foreign keys.
- [x] Introduce a mandatory tenant context API for infrastructure repositories.
- [x] Remove or isolate repository methods that can access tenant-owned data by unscoped ID.
- [x] Include `appId` in audit records, request logs, job logs, and relevant metrics.
- [x] Add negative database and HTTP tests for every tenant-scoped `/v1` resource and mutation.
- [x] Document whether PostgreSQL row-level security is required; if selected, add policies, role tests, and migration procedures.

### Acceptance criteria

- PostgreSQL rejects a child record whose `appId` differs from its parent.
- Every `/v1` tenant resource returns not found or forbidden for another app's key.
- Infrastructure repository operations cannot compile or execute without tenant context, except explicitly reviewed administrative operations.
- The migration upgrade test preserves representative existing records.

## Phase 2: Migration and financial correctness

**Goal:** prevent schema drift and invalid monetary state from reaching runtime.

### Deliverables

- [x] Add an application startup check for unapplied or failed required migrations.
- [x] Require distinct migration and application database configuration in staging and production.
- [x] Extend migration tests from the baseline through the current schema using representative sanitized fixtures.
- [x] Convert appropriate serialized JSON fields to PostgreSQL `JSONB`.
- [x] Add database enums or check constraints for critical lifecycle fields.
- [x] Add database constraints for non-negative integer-string amounts and valid nullable lifecycle combinations.
- [x] Add uniqueness constraints for external transaction identities.
- [x] Define currency and conversion rounding rules in code and documentation.
- [x] Store price provider/source and quote timestamp with converted values.
- [x] Add exact split-balance, boundary-value, overflow, and reconciliation tests.

### Acceptance criteria

- API and worker refuse readiness when required migrations are missing.
- Invalid lifecycle values, negative amounts, and unbalanced settlements are rejected by the database or domain layer.
- Monetary calculations do not use JavaScript floating point.
- Upgrade tests prove that representative pre-migration data remains readable and correct.

## Phase 3: Durable queue and worker lifecycle

**Goal:** make job processing safe across crashes, concurrency, and rolling restarts.

### Deliverables

- [x] Replace read-then-update job claiming with one atomic `FOR UPDATE SKIP LOCKED` transaction.
- [x] Add lease expiry and periodic lease renewal for long-running jobs.
- [x] Add per-job execution deadlines and cancellation handling.
- [x] Add exponential retry backoff with bounded jitter.
- [x] Make worker concurrency configurable and bounded.
- [x] Make settlement and webhook handlers idempotent at their external side-effect boundaries.
- [x] Add audited dead-letter listing and replay controls.
- [x] Split settlement, webhook, and AI workloads into selectable worker roles while retaining shared code.
- [x] Add worker crash/stale-lock, lease-ownership, concurrent-claim, retry, deadline, and graceful-drain coverage.

### Acceptance criteria

- Concurrent workers never execute the same valid lease simultaneously.
- A terminated worker's jobs become claimable after lease expiry.
- Long-running jobs retain their leases and either finish or are safely released.
- Rolling-restart tests complete or recover all in-flight jobs without duplicate settlement.

## Phase 4: Network, WebSocket, and API hardening

**Goal:** close remaining externally reachable abuse paths.

### Deliverables

- [x] Expand webhook tests for DNS rebinding, mixed safe/blocked DNS answers, every blocked address class, and multi-hop redirects.
- [x] Add explicit controlled-egress proxy configuration and fail-closed production validation.
- [x] Add focused manual webhook retry limits and concurrency tests.
- [x] Apply per-endpoint payload limits to every write route.
- [x] Complete IP, tenant, API-key, high-risk action, and WebSocket rate-limit tests.
- [x] Define and test Redis limiter failure behavior.
- [x] Retain the authenticated WebSocket subprotocol with documented token-lifetime constraints.
- [x] Add multi-instance WebSocket broadcasting through Redis pub/sub.
- [x] Add public-event disclosure tests ensuring metadata and private agreement fields cannot leak.

### Acceptance criteria

- Webhook connections only use validated addresses and revalidate every redirect.
- Production refuses to start when its required egress policy is absent.
- WebSocket authentication, origin, payload, connection, heartbeat, and backpressure tests pass.
- Rate limits behave consistently across multiple API instances.

## Phase 5: Immutable packaging and deployment automation

**Goal:** make releases reproducible, health-gated, and reversible.

### Deliverables

- [x] Replace the mutable PM2 deployment workflow with commit-addressed container builds and registry publication.
- [x] Add production-shaped manifests for migration, API, worker roles, and web.
- [x] Add CPU and memory requests/limits, termination grace periods, read-only filesystems, and security contexts.
- [x] Deploy migrations once before API and worker rollout.
- [x] Embed commit and version metadata in images and health responses.
- [x] Add post-deployment API, worker, database, queue, and settlement smoke checks.
- [x] Add automated application rollback when health checks fail.
- [x] Document database forward-fix behavior because application rollback does not reverse applied migrations.

### Acceptance criteria

- A release references images by immutable commit digest/tag.
- API and worker are independently scalable and deployable.
- Failed readiness or smoke checks stop promotion and restore the prior compatible application release.
- No deployment performs `git reset`, dependency installation, or compilation on the production host.

## Phase 6: Observability and resilience definitions

**Goal:** provide complete telemetry and deployable operational definitions.

### Deliverables

- [x] Add missing correlation identifiers across agreement, milestone, transaction, delivery, job, provider request, trace, and tenant logs.
- [x] Instrument database pool saturation, provider latency/errors, queue execution time, lock renewal, retries, settlement reconciliation, and WebSocket pressure.
- [x] Supply version-controlled OpenTelemetry collector configuration.
- [x] Supply version-controlled dashboards for API, worker, queue, settlement, webhook, database, and provider health.
- [x] Supply alert rules based on documented service-level indicators and provisional objectives.
- [x] Add telemetry redaction and cardinality tests.
- [x] Ensure every active external provider uses the shared timeout, retry, concurrency, classification, and circuit-breaker framework.

### Acceptance criteria

- A local production-shaped stack emits usable logs, metrics, and traces for one complete agreement lifecycle.
- Dashboards and alert definitions validate in CI.
- Deliberate secrets and high-cardinality payload values do not enter telemetry.
- Provider failures are classified consistently as retryable or permanent.

## Phase 7: Retention, performance, and recovery automation

**Goal:** finish repository-level operational controls and test harnesses.

### Deliverables

- [x] Complete retention jobs for idempotency records, webhook payloads/snippets, events, jobs, and audit archives.
- [x] Add bounded, resumable retention execution with metrics and dry-run support.
- [x] Add database backup/restore verification scripts that can target an isolated database.
- [x] Add migration, restore, rolling-restart, dead-letter replay, and incorrect-release exercise scripts/checklists.
- [x] Add pagination tests for every list operation and measured query-plan fixtures for critical paths.
- [x] Add API, queue, and webhook load-test thresholds to release validation.
- [x] Add deterministic simulated provider-failure tests; keep destructive infrastructure chaos tests as an external exercise.
- [x] Complete API lifecycle, rate-limit, idempotency, retention, and production changelog documentation.

### Acceptance criteria

- Retention dry runs report exactly what would change and live runs are bounded and observable.
- Restore verification checks schema, representative data, tenant constraints, and audit-chain integrity.
- Performance tests have explicit pass/fail thresholds and preserve correctness under concurrency.
- Every operational runbook names the command, expected evidence, abort condition, and responsible owner.

## External infrastructure handoffs

The repository can provide adapters, manifests, checks, and documentation for these controls, but cannot complete them without access to the target environment.

| Handoff | Repository output | Required external action |
| --- | --- | --- |
| Production migration rehearsal | Sanitization/import and upgrade-test tooling | Provide an approved sanitized production snapshot and isolated database |
| KMS/HSM treasury signing | Managed signer adapter and workload configuration | Provision keys, policies, approvals, identities, network access, and revocation |
| Secrets management | Secret-file/provider integration and rotation commands | Provision secret stores, environment-specific secrets, access policies, and rotation schedule |
| Network egress | Proxy support and network-policy definitions | Deploy the proxy and enforce VPC, firewall, DNS, and metadata-service restrictions |
| PostgreSQL resilience | Timeout settings, checks, restore scripts, and runbooks | Enable HA, backups, PITR, monitoring, maintenance, and isolated restore capacity |
| Container releases | Build/publish/deploy workflows and manifests | Provide registry, deployment platform, credentials, admission rules, and retained releases |
| Staging parity | Production-shaped manifests and validation scripts | Provision an isolated staging environment with representative scale and test credentials |
| Central observability | Collector, dashboards, alerts, and redaction rules | Provision storage, retention, access controls, notification routes, and on-call ownership |
| On-chain validation | Testnet smoke and reconciliation scripts | Supply funded test wallets, signer access, RPC endpoints, and transaction-review authority |
| Recovery evidence | Exercise scripts and evidence templates | Schedule and execute restores, rolling restarts, key revocation, and incident exercises |
| Governance | CODEOWNERS, runbooks, provisional SLO/RTO/RPO documents | Approve owners, service objectives, risk exceptions, escalation paths, and compliance retention |

## Recommended delivery order

Execute phases in order. Phases 0 through 3 are release blockers because they protect tenant data and settlement correctness. Phase 4 should complete before accepting untrusted production traffic. Phase 5 is required before calling deployment reproducible. Phases 6 and 7 provide the evidence and operating controls needed to sustain production safely.

Each phase should be delivered as a separate reviewed change set. Database phases should use expand, migrate, and contract steps where existing data or rolling compatibility makes a single migration unsafe.