# Infrastructure roadmap

## Phase 1: Core cleanup

Status: implemented in the current change set.

- `/v1` is the only supported lifecycle API; `/api` returns `410 Gone`.
- The first-party frontend is a developer console.
- Profile, reputation, invite, comments, DAO/bounty/forum import, AI review, Fiber, and product dashboard domains are removed.
- Retired database tables and fixed-tenant product records are archived before operational tables/columns are dropped.
- Agreements retain app tenancy, external participant IDs, generic source metadata, amount/currency, policy, and settlement status.
- Proof reviews are explicitly infrastructure decisions, not social/reputation reviews.
- Durable jobs are limited to signed webhook delivery and maintenance.
- Mock/manual rails work; the CKB adapter and Rust contract remain isolated.
- OpenAPI covers every `/v1` operation and CI checks route parity.

See `REPORT.md` for the full inventory and verification record.

## Phase 2: Correctness and CKB hardening

Phase 2 should address the following without reintroducing product behavior:

1. Compare-and-swap lifecycle transitions and conflict tests.
2. Agreement/milestone financial locking and exact aggregate invariants.
3. One-active-escrow and dispute uniqueness constraints.
4. A production CKB adapter with transaction construction, isolated signing, confirmation depth, reconciliation, and ambiguous-outcome handling.
5. Redis-backed one-time wallet challenges across API replicas.
6. Separate least-privilege database roles and a renewed RLS evaluation.
7. Archive access policy, retention, and eventual export/removal procedure.
8. Production-scale migration rehearsal using an approved sanitized snapshot.

Fiat, USDT, multi-chain support, AI verification, marketplace behavior, chat, reputation, and bounty integrations remain outside Phase 2 unless separately approved as adapters or integrating applications.

## External handoffs

| Handoff | Repository output | Required external action |
| --- | --- | --- |
| Production migration rehearsal | Forward migrations and upgrade fixture | Provide an approved snapshot and isolated database |
| CKB signing | Adapter boundary and Rust contract | Provision keys, policy, workload identity, approvals, and recovery |
| Secret management | Keyrings and rotation commands | Provision managed stores and rotation ownership |
| Network egress | Proxy-aware webhook client | Deploy and enforce proxy/VPC policy |
| Observability | Collector, alerts, dashboards | Provision storage, notification routes, retention, and on-call ownership |
| Recovery | Backup/restore and exercise scripts | Schedule exercises and retain evidence |
