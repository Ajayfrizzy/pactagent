# Phase 2 Infrastructure Hardening Report

Date: 2026-08-29

Baseline: `772af98` (`Phase 1: Infrastructure Cleanup (#47)`)

Scope: app-scoped `/v1` agreement and settlement infrastructure only

## 1. Executive Summary

Phase 2 hardens PactAgent's existing lifecycle and settlement infrastructure. It
does not restore the removed product surface or add new rails.

The implementation now has:

- compare-and-swap lifecycle writes with `409` conflict semantics;
- parent-row locking and PostgreSQL triggers for financial allocation;
- database-enforced active escrow and unresolved dispute uniqueness;
- exact bigint-safe dispute split validation;
- durable idempotency on all required lifecycle/financial mutations;
- composite tenant/scope foreign keys and explicit breakout tests;
- webhook delivery result CAS with transactional retry/failure side effects;
- Redis-backed, TTL-bound, atomically consumed wallet challenges;
- a disabled-by-default CKB testnet adapter with deterministic commitments,
  signer isolation, independent chain verification, durable reservation,
  confirmation/reorg observation, and reconciliation jobs;
- deployment, readiness, metrics, alerts, and runbooks for the settlement queue.

The application hardening and deterministic test gates pass. CKB readiness is
**NOT READY** because no controlled funded testnet lifecycle was run, no external
signer exists, and the Rust contract lacks transaction-level VM integration tests
and an independent security review. Mainnet is blocked by startup validation.

## 2. Findings Before Hardening

The full pre-change inventory is in
[`docs/phase2-hardening-inventory.md`](docs/phase2-hardening-inventory.md).

| Severity | Pre-hardening finding | Resolution |
| --- | --- | --- |
| P0 | Read-validate-write lifecycle transitions could overwrite concurrent state | CAS update predicates and conflicts |
| P0 | Concurrent milestone creation could over-allocate an agreement | Parent `FOR UPDATE`, recomputation, and trigger |
| P0 | Multiple active escrows or unresolved disputes could share one scope | Partial unique indexes and application conflicts |
| P0 | CKB adapter was a stub and real funding could be caller-asserted | Chain verification and reconciliation architecture |
| P1 | Required mutations had incomplete idempotency adoption | Required route matrix completed |
| P1 | Dispute splits were not exact or safely bounded | Exact non-negative bigint equality |
| P1 | Wallet challenges were process-local | Redis TTL and atomic Lua consume |
| P1 | Critical string lifecycle values were incompletely constrained | Normalization, preflight, checks, and validation |
| P1 | External CKB work had no durable ambiguity/reorg handling | Reserve/external/finalize plus settlement jobs |
| P2 | Cross-tenant mutation/reference coverage was incomplete | Composite FKs and breakout suites |
| P2 | Duplicate webhook executors could race result and failure side effects | Snapshot CAS and atomic retry/failure outbox writes |
| P2 | Missing conflict, auth, and CKB operational metrics | Bounded-label metrics and alerts |
| P3 | OpenAPI and operational docs described Phase 1 behavior | Phase 2 API, config, worker, and incident docs |

## 3. Lifecycle Concurrency Changes

Agreement, milestone, proof, dispute, and escrow repositories now transition with
`UPDATE ... WHERE id = ? AND appId = ? AND status = expectedStatus`. A reusable
CAS assertion maps a zero-row update to `409 lifecycle_conflict`.

Transition services still validate the allowed edge before writing. Events,
outbox rows, and audit records are created only after the guarded write succeeds
and in the same database transaction. There is no arbitrary lifecycle retry.

Covered races include incompatible agreement transitions, stale terminal writes,
concurrent release/refund reservation, duplicate settlement, and concurrent
proof/dispute parent transitions.

## 4. Financial Invariants

### Milestone allocation

Milestone creation locks the tenant-scoped parent agreement with `SELECT ... FOR
UPDATE`, recomputes the current allocation under that lock, checks exact currency,
and inserts before commit. PostgreSQL repeats the allocation check in a trigger.

Enforced invariants:

- milestone amount is a canonical positive integer;
- milestone currency equals agreement currency;
- milestone sum does not exceed agreement amount;
- funded financial terms remain immutable.

### Escrow allocation

Application validation derives amount and currency from the persisted agreement
or milestone scope. Agreement escrow cannot exceed the agreement. Milestone
escrow cannot exceed the milestone. CKB escrow is milestone-scoped and must equal
the milestone amount exactly.

### Settlement split

Split resolution parses integer strings as `bigint`. Both shares are non-negative,
either may be zero, neither may exceed the funded scope, and their sum must equal
the funded escrow amount exactly. The database trigger applies the same equality.

## 5. Escrow Uniqueness

Settlement scope is:

- agreement: `(appId, agreementId)` where `milestoneId IS NULL`;
- milestone: `(appId, milestoneId)` where `milestoneId IS NOT NULL`.

Two partial unique indexes allow only one active escrow per scope. Active includes
`not_created`, `awaiting_funding`, `funding_detected`, `funded`,
`release_pending`, `refund_pending`, `reconciliation_required`, and `failed`.
`P2002` is translated to `409 active_escrow_exists`.

## 6. Dispute Uniqueness

Disputes are explicitly milestone-scoped. Partial unique indexes enforce one
`open`, `awaiting_response`, or `under_review` dispute per
`(appId, agreementId, milestoneId)`. Application prechecks improve the response;
the database remains authoritative during races. Conflicts return
`409 active_dispute_exists`.

## 7. Idempotency Coverage

| Mutation | Before | After |
| --- | --- | --- |
| `POST /v1/agreements` | required | required |
| agreement accept/funding-required/cancel | absent | required |
| milestone create | absent | required |
| proof submit | required | required |
| proof review | absent | required |
| dispute create | absent | required |
| dispute resolve | required | required |
| escrow create | required | required |
| escrow mark-funded | absent | required |
| escrow release/refund | required | required |

The key is app-scoped and bound to HTTP method, canonical path, and request body.
Same key and same request replays the stored response. A changed request returns
`409 idempotency_key_conflict`; a live pending request returns
`409 idempotency_key_in_progress`. Integration tests verify same-request replay,
request mismatch, concurrent pending behavior, and no duplicate transaction,
event, or audit rows.

Operator-owned app/API-key mutations and webhook endpoint management remain
outside this app-scoped idempotency table. No API-key or webhook-secret rotation
endpoint was added in Phase 2.

## 8. Database Constraints

Phase 2 uses checks rather than a broad Prisma enum conversion. Migration
preflight blocks unknown values and duplicate/invalid financial state before any
constraint is added. Historical valid case variants are normalized; rows are not
silently deleted.

Constraints cover critical app/API-key, agreement, milestone, proof/review,
dispute, escrow, transaction, webhook, idempotency, and job lifecycle values;
amount format/range; rail/network combinations; exact dispute splits; allocation;
CKB commitments; transaction/escrow scope; and cross-resource app ownership.

## 9. Tenant Isolation Results

`appId` remains the tenant boundary. Composite foreign keys require children to
share app, agreement, milestone, proof, and escrow ownership as applicable.

Real PostgreSQL and HTTP tests prove App B cannot get/list App A resources or use
App A agreement/milestone/proof/escrow/event/webhook references. Coverage includes
agreements, milestones, proofs, reviews, disputes, escrows, transactions, events,
webhook endpoints/deliveries, audit logs, jobs, and idempotency records. Public
resource access returns non-enumerating not-found or generic relationship errors.

Webhook execution also uses snapshot CAS over app, status, and attempt count.
Only the winning executor records the result and transactionally creates the next
retry job or final-failure event; duplicate executors observe the winning result.

## 10. Auth Challenge Durability

Deployed API processes require Redis. Challenge keys hash the normalized address,
carry a TTL, bind the exact address and message, and use Lua to compare then delete
atomically only after signature/address verification. Cross-client Redis tests
prove multi-instance visibility, wrong-message preservation, one winner under
concurrent consume, replay prevention, and expiry.

The in-memory implementation is restricted to local/unit-test use. Operator JWT
TTL now defaults to one hour and is capped at 24 hours in deployed environments.
Admin status is recomputed from the server-side allowlist during every token
verification. MFA/passkeys are not implemented.

## 11. CKB Rail Architecture

```text
Escrow service
  -> reserve transaction (PostgreSQL CAS)
  -> CkbEscrowAdapter
       -> deterministic transaction/commitment builder
       -> isolated signer provider
       -> CKB node client (chain state and broadcast)
       -> CKB indexer client (cell/script searches)
       -> funding/settlement verifier
  -> finalize or mark reconciliation_required
  -> durable settlement queue reconciliation
```

Node and indexer RPC clients are separate. No database transaction is held during
signing, broadcast, or provider reads. Expected transaction identity is persisted
for ambiguous broadcasts. Reconciliation compares exact outpoints, lock scripts,
cell data, capacity, destination output, block identity, and confirmation depth.

`CkbSignerProvider` isolates signing. `LocalDevCkbSignerProvider` is testnet-only.
Staging/production reject local signing. The unimplemented external provider and
all mainnet configurations fail closed at startup.

## 12. CKB Implementation Status

| Capability | Status |
| --- | --- |
| Create lock | Implemented for explicitly enabled development testnet |
| Persist lock/script/data/version/timeout | Implemented |
| Funding verification | Independent exact chain verification implemented |
| Release | Full-amount cooperative release implemented |
| Refund | Full-amount cooperative/timeout-since transaction path implemented |
| Transaction observation | pending/proposed/committed/confirmed/rejected/unknown mapped |
| Ambiguous broadcast | Expected hash persisted; reconciliation required |
| Reorg handling | Prior confirmation loss raises reorg state/event/metric |
| Durable worker | Settlement queue, dedupe, leases, healthy deferral, stale metrics |
| Mainnet signer | Not implemented and explicitly blocked |
| On-chain split dispute payout | Not implemented |

The Rust lock enforces canonical args/data, version/magic/reserved bytes, one
escrow group input, exact full-capacity destination, unambiguous outputs, signer
paths, and absolute block timeout semantics.

## 13. CKB Testnet Results

The non-mutating public testnet smoke passed on 2026-08-28 at node tip
`0x1534afe`. No deployment transaction hash was configured, so deployment was not
verified. `CKB_TESTNET_E2E` was not enabled and no funded credentials/participant
scripts were supplied; therefore create/fund/proof/release/refund lifecycle E2E
was **not run**.

`scripts/ckb-testnet-smoke.mjs` now provides an explicit testnet-only controlled
release and refund lifecycle harness. It requires an API, scoped test API key,
funded development signer, participant scripts, contract deployment, worker, and
explicit `CKB_TESTNET_E2E=true`. It has no mainnet mode.

## 14. Security Review

This was a static engineering review, not a formal security audit.

- Tenant identity is middleware-derived and all financial repositories are
  app-scoped; composite foreign keys reject crafted references.
- Mutation routes retain explicit scopes; settlement/webhook/admin actions retain
  high-risk rate limits.
- Admin routes require a verified JWT and server allowlist. Admin privilege cannot
  be asserted from a request or token claim.
- Raw SQL with dynamic values uses database parameters. Remaining unsafe APIs use
  fixed internal SQL templates or fixed audit-maintenance statements, not request
  interpolation.
- HTTP payloads have global and per-domain bounds. Deployed Redis failure policy is
  fail-closed.
- Webhook DNS/redirect/egress controls were retained; jobs and event delivery stay
  transactionally linked to domain events.
- Logger redaction covers authorization, tokens, secrets, signatures, ciphertext,
  private keys, API keys, JWTs, and database URLs. CKB payloads persist public
  transaction/commitment data only.
- CKB mainnet, deployed local keys, incomplete config, and unavailable external
  signing fail closed.
- No dedicated secret-scanner binary was installed. A tracked-source pattern scan
  found only the documented placeholder; this is weaker than a full history scan.

Supply-chain policy fails closed on an unavailable or malformed audit response
and passes against live registry data, but production `npm audit` reports 21 low,
2 moderate, and 3 high vulnerability records. The high chain is covered by the
time-limited `GHSA-ggr8-5vv4-36mx` Prisma migration-tooling exception expiring
2026-09-22. Low-severity CKB dependency findings remain subject to the
cryptography upgrade policy and must not be auto-upgraded without
compatibility/testnet evidence.

## 15. Migrations

New forward migrations:

1. `20260827000100_phase2_financial_lifecycle_constraints`
2. `20260827000200_ckb_reconciliation_state`
3. `20260827000300_cross_resource_scope_constraints`

All 20 migrations applied successfully to a fresh PostgreSQL database. A separate
populated Phase 1 upgrade applied all three Phase 2 migrations while preserving
one row in each required resource class: App, API key, Agreement, Milestone,
Proof, Review, Dispute, Escrow, Transaction, Event, WebhookEndpoint,
WebhookDelivery, AuditLog, AgentJob, and IdempotencyKey. Legacy values were
verified as normalized to `draft`, `pending`, `CKB`, and `text`.

Historical migration files were not modified.

## 16. Test Results

| Gate | Result |
| --- | --- |
| `npm ci` | Pass; Node 25 runner warning against required Node 24 |
| Prisma format/validate/generate | Pass |
| Fresh 20-migration install | Pass |
| Populated Phase 1 upgrade | Pass; all 15 resource counts preserved |
| Server unit/e2e tests | Pass, 94 passed and 0 failed |
| PostgreSQL/Redis integration | Pass, 36 passed and 0 failed against fresh migrated services |
| Server/web TypeScript lint | Pass |
| Server and Next.js production build | Pass |
| OpenAPI route validation | 58 operations pass |
| OpenAPI Phase 1 compatibility | No removed `/v1` path or operation |
| Docker Compose config | Pass |
| Kubernetes deployment validation/smoke | Pass, 10 resources and 2 tests |
| Observability validation | Pass, 12 alerts and 6 dashboards |
| Infrastructure control matrix | Pass, 27 controls |
| Dependency policy | Pass with one active high-advisory exception; 3 policy tests pass |
| License policy | Pass, 888 packages; 2 policy tests pass |
| Rust contract host tests | 11 passed, 0 failed |
| CKB public testnet RPC smoke | Pass; lifecycle/deployment not exercised |

## 17. Known Limitations

- No external/KMS signer provider is installed; deployed CKB and mainnet are
  intentionally unavailable.
- No funded testnet lifecycle or contract deployment verification was run.
- Contract tests exercise pure validation logic, not a full ckb-testtool/VM
  transaction with witnesses, fee inputs, and multiple script groups.
- The local environment lacks the RISC-V GCC cross compiler, so the release
  contract binary was not rebuilt in this verification run.
- Dispute split accounting is exact in PostgreSQL, but arbitrary split outputs are
  not implemented by the CKB adapter/contract path.
- Webhook delivery is intentionally at-least-once. Receivers must deduplicate by
  event ID; an external side effect cannot be made exactly-once across HTTP.
- Webhook signing-secret rotation and API-key rotation do not have dedicated
  idempotent public endpoints in this phase.
- Operator MFA/passkeys are deferred.
- The Node verification runner is v25.9.0; release CI should use the pinned Node
  24.x runtime.

## 18. Items Deferred to Phase 3

- reviewed external/KMS CKB signer with approval, rotation, and recovery policy;
- ckb-testtool/VM transaction integration and independent contract review;
- funded testnet release, refund, reorg, crash-after-broadcast, and dispute
  settlement evidence with recorded transaction hashes;
- explicit on-chain split-dispute construction if product policy requires it;
- webhook/API-key secret rotation APIs with grace/revocation policy;
- operator MFA/passkey enforcement;
- removal of the Prisma advisory exception and reviewed CKB dependency upgrades.

## 19. Production Readiness Assessment

### CKB classification: NOT READY

The rail has the required architectural safety boundaries, deterministic unit
coverage, durable ambiguity handling, and operational instrumentation, but it
does not meet the evidence threshold for testnet or mainnet readiness. Missing
funded E2E, production signer, transaction-level VM tests, RISC-V release build,
and external review are blocking readiness evidence.

The app-scoped core with CKB disabled passed the local staging gates. Release CI
must repeat them under the pinned Node 24 runtime. This report does not claim a
formal security audit or production mainnet readiness.
