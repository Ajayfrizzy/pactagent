# Disaster Recovery Runbooks

## Recovery objectives

| Capability | RTO | RPO |
| --- | ---: | ---: |
| API reads and agreement management | 60 minutes | 5 minutes |
| Worker and webhook processing | 2 hours | Queue state at last database commit |
| Settlement and treasury signing | 4 hours | Zero acknowledged settlements |
| Audit ledger | 4 hours | Zero committed audit rows |

Test database restore quarterly and perform a full regional recovery exercise annually. Record actual recovery time and data loss against these objectives.

## Database outage or restoration

1. Stop workers and disable settlement mutations; keep liveness available but readiness failing.
2. Confirm provider status and preserve database/connection-pool metrics.
3. Restore the latest point-in-time backup into an isolated instance and run `npm run db:migrate:status`.
4. Validate audit-chain continuity, row counts, pending jobs, idempotency records, and latest settlement transaction hashes.
5. Point one canary API and worker at the restored database, reconcile CKB state, then restore traffic gradually.

## Compromised API, JWT, webhook, or treasury key

1. Disable affected API keys or signing provider immediately and stop settlement workers for treasury exposure.
2. Revoke the provider credential, activate a new key ID, retain old decryption keys only as required, and re-encrypt webhook secrets.
3. Review audit logs from the earliest suspected exposure and reconcile every settlement with CKB.
4. Resume with a canary and publish an incident timeline. Never delete compromised-key audit evidence.

## Stuck settlement or incorrect release/refund

1. Disable automated retries for the agreement and capture job, transaction, provider request ID, and audit records.
2. Query CKB independently. Never resend an uncertain signing request until the first transaction is proven absent.
3. For a confirmed incorrect transfer, freeze remaining funds, notify both parties, and escalate to the incident commander; blockchain transfers cannot be rolled back.
4. Use the administrative replay only after correcting state and recording approval in the audit ledger.

## CKB outage

Open the CKB circuit, pause signing, and continue non-settlement API operations. Do not treat missing RPC data as transaction failure. On recovery, reconcile pending transaction hashes before releasing queued jobs. Fiber is retired; any Fiber-dependent record is historical and must not trigger an active call.

## Failed migration

Stop deployment, keep the previous application version, and inspect `_prisma_migrations`. Do not edit migration history manually. For transactional failures, correct the migration and use Prisma resolution procedures; for partially applied non-transactional work, restore a backup or write an explicit forward repair migration. Validate against a restored production snapshot before retrying.

## Webhook backlog or dead-letter replay

Confirm endpoint/provider health and queue age, then pause new delivery claims if the backlog is growing. Fix the root cause, replay a small canary batch, verify signatures and duplicates at the receiver, then increase throughput within provider concurrency limits. Dead-letter replay requires an audited administrator action.

## Worker outage

Readiness and heartbeat alerts identify stale workers. Ensure the old process no longer owns locks, start one replacement, observe a full cycle, and scale gradually. Reconcile stale locks and pending settlement operations before replay.

## Dependency vulnerability response

Identify affected SBOM components and reachable code, disable the exposed feature if critical, and create a time-bounded remediation issue. Upgrade CKB/cryptography dependencies only after wallet and transaction compatibility tests. Rebuild and scan every image, rotate credentials if exposure could disclose them, and document any risk acceptance.
