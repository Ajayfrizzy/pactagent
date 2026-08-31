# Phase 2 hardening inventory

Baseline: `772af98` (`Phase 1: Infrastructure Cleanup (#47)`). This inventory was
produced from the post-Phase-1 services, repositories, routes, Prisma schema, and
committed migrations. It is the implementation checklist for Phase 2, not a
production-readiness claim.

## Severity summary

| Severity | Finding | Affected surface |
| --- | --- | --- |
| P0 | Lifecycle writes validate a previously read status and then update by tenant/id without comparing the expected status. Concurrent requests can both emit events and audit rows for incompatible transitions. | Agreement, milestone, proof, dispute, escrow funding and settlement follow-up transitions |
| P0 | Milestone allocation reads the existing total and inserts without locking the agreement. Concurrent inserts can exceed the agreement amount. | `POST /v1/agreements/{id}/milestones` |
| P0 | No database uniqueness constraint prevents two active escrows or two unresolved disputes for one settlement scope. | Escrow and dispute creation |
| P0 | The CKB adapter is a stub and CKB funding can be asserted by an API request rather than independently verified from node/indexer state. | CKB create, fund, release, refund, reconciliation |
| P1 | Agreement actions, milestone creation, proof review, dispute creation, and escrow funding do not use the existing idempotency service. | Meaningful mutation routes |
| P1 | Dispute split values are parsed as strings but are not checked against one another or the funded settlement scope. | Dispute resolution |
| P1 | Wallet challenges live in a process-local `Map`; restarts lose them and multiple API replicas cannot share or atomically consume them. | Wallet authentication |
| P1 | Critical string lifecycle fields are only partially constrained, with several constraints left `NOT VALID` and no constraints for agreement/milestone states or rail/network combinations. | PostgreSQL schema |
| P1 | External CKB work lacks durable reservation, ambiguous-broadcast state, confirmation/reorg handling, and a reconciliation queue. | Settlement operations |
| P2 | Tenant composite foreign keys are broadly present, but API breakout coverage is mostly read-oriented and does not cover every crafted cross-tenant mutation/reference. | All app-scoped resources |
| P2 | Webhook jobs are durable and deduplicated, but delivery result writes are not lease/CAS-owned; duplicate delivery execution can race attempts and final status. | Webhook delivery worker |
| P2 | Metrics cover HTTP, jobs, DB pool, and worker health but not lifecycle conflicts, invariant rejections, auth challenge failures, or CKB reconciliation. | Observability |
| P3 | API and integrator documentation only describes idempotency for a subset of operations and does not describe Phase 2 conflict/reconciliation semantics. | OpenAPI, README, integrator changelog |

## Mutation inventory

| Resource | Mutation | Current transaction/idempotency baseline | Phase 2 requirement |
| --- | --- | --- | --- |
| App | create, update, rotate public identifier | not idempotent | preserve tenant authorization; idempotency is recommended for externally retried rotation |
| API key | create, revoke, rotate | not idempotent | retain one-time secret handling; add idempotency to rotation if exposed as a retried action |
| Agreement | create | transactional outbox/audit; idempotent | retain |
| Agreement | accept, funding-required, cancel | transaction; read then unguarded write; not idempotent | CAS each edge and require `Idempotency-Key` |
| Milestone | create financial allocation | transaction; unlocked aggregate; not idempotent | lock parent agreement, recompute total, require `Idempotency-Key` |
| Milestone | fund, proof/review, dispute, release/refund status changes | transaction; read then unguarded write | CAS every edge |
| Proof | submit | transactional and idempotent; parent transitions are unguarded | retain proof idempotency and CAS parent transitions |
| Proof/review | under-review and decision | transaction; proof and parent writes unguarded; not idempotent | CAS proof/parents and require `Idempotency-Key` |
| Dispute | open | transaction; no active-scope uniqueness; not idempotent | database uniqueness, CAS parents, require `Idempotency-Key` |
| Dispute | resolve | idempotent transaction; unguarded dispute/parent writes; split unverified | CAS and exact bigint-safe settlement split |
| Escrow | create/lock | idempotent but adapter is called while DB transaction is open | active-scope uniqueness; reserve/external/finalize for real CKB |
| Escrow | mark funded | transaction; adapter call under lock; unguarded write; not idempotent | require key; CKB verification outside DB lock; CAS finalize |
| Escrow | release/refund | idempotent reservation with escrow CAS; follow-up parent writes unguarded | retain reservation, add ambiguous/reconciliation states and parent CAS |
| Transaction | create/update through escrow operations | tenant scoped; settlement finalization update is not expected-state guarded | durable operation identity and CAS/reconciliation ownership |
| Event/outbox | created by domain services | event, deliveries, and jobs are transactionally linked when a transaction client is supplied | ensure every critical state mutation supplies the same transaction |
| Webhook endpoint/delivery | create/update/disable/manual retry/delivery result | manual retry uses update-many reservation; delivery result is unguarded | retain SSRF controls; make job/result execution duplicate-safe |
| Audit log | append | append-only trigger and hash chain | retain; never include signer/API/webhook/JWT secrets |
| Agent job | enqueue, claim, renew, complete, retry/dead-letter | durable leases and `SKIP LOCKED` claims | add a dedicated settlement-reconciliation kind/queue if CKB is enabled |

## Read-then-write and aggregate sites

- Agreement lifecycle actions read status, validate it, then call
  `Agreement.update` by `(id, appId)`.
- Proof submission/review and dispute open/resolve compute multi-resource paths
  from snapshots and update agreement, milestone, proof, or dispute without the
  expected status in the write predicate.
- Escrow funding reads status and calls the adapter inside the transaction before
  an unguarded escrow update. Settlement reservation itself already uses an
  expected-state `updateMany`, but parent terminal transitions do not.
- Milestone creation sums rows in application code without locking the agreement.
- Agreement completion checks all escrow statuses and then updates agreement
  status without guarding the snapshot.
- Webhook delivery fetches a delivery, performs HTTP, and updates by id without a
  delivery execution lease/status predicate.

## Financial and uniqueness invariants

- All amount inputs are canonical positive integer strings and must stay within
  unsigned 64-bit shannon range where CKB capacity is involved.
- Milestone currency must equal the parent agreement currency and the sum of
  milestone amounts must not exceed the agreement amount.
- A milestone escrow cannot exceed its milestone; an agreement escrow cannot
  exceed its agreement. A scope has at most one active escrow.
- Settlement scope is `(appId, agreementId, milestoneId)`, where a null milestone
  denotes agreement-level settlement. Active escrow statuses are
  `not_created`, `awaiting_funding`, `funding_detected`, `funded`,
  `release_pending`, `refund_pending`, `reconciliation_required`, and `failed`.
- Unresolved dispute statuses are `open`, `awaiting_response`, and
  `under_review`. Disputes are milestone-scoped in the current API, so uniqueness
  is `(appId, agreementId, milestoneId)` over those statuses.
- For split resolution, `workerAmount + clientAmount` must equal the funded
  escrow amount for the disputed milestone. Each side may be zero but not
  negative or greater than the scope.
- Release and refund are mutually exclusive terminal outcomes and external
  settlement ambiguity must remain pending/reconciliation-required, never be
  blindly retried as a fresh payment.

## Tenant boundaries

`appId` is the tenant boundary for agreements, milestones, proofs, reviews,
disputes, escrows, transactions, events, webhook endpoints/deliveries, audit
logs, jobs, and idempotency keys. Composite `(resourceId, appId)` foreign keys
protect most cross-resource references. Phase 2 tests must additionally prove
that App B cannot read, filter for, mutate, settle, review, dispute, retry, or use
as a foreign reference any App A resource, returning a non-enumerating 404 or
generic relationship error.

## Required idempotency matrix

`Idempotency-Key` is required for agreement create/accept/funding-required/cancel,
milestone create, proof submit/review, dispute create/resolve, and escrow
create/mark-funded/release/refund. GET/list endpoints do not require it. Same
key plus same request replays the stored response, changed request data returns
409, and a currently leased request returns 409 without duplicating events,
audit rows, jobs, or external settlement effects.
