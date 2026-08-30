# Disaster Recovery Runbooks

## Recovery objectives

| Capability | RTO | RPO |
| --- | ---: | ---: |
| API reads and agreement management | 60 minutes | 5 minutes |
| Worker and webhook processing | 2 hours | Queue state at last database commit |
| CKB settlement readiness | 4 hours | Zero acknowledged settlements |
| Audit ledger | 4 hours | Zero committed audit rows |

Test database restore quarterly and perform a full regional recovery exercise annually. Record actual recovery time and data loss against these objectives.

Create a portable backup with `npm run backup:create -- <output.dump>`. Verify it only against an isolated target with `ALLOW_RESTORE_VERIFICATION=true BACKUP_FILE=<dump> RESTORE_DATABASE_URL=<isolated-url> npm run backup:verify`. Expected evidence includes schema and representative counts, migration status, tenant-integrity audit, and audit-chain verification. The database operator must abort if the target name does not contain `restore`, `verify`, or `test`, or if any integrity check fails.

Exercise definitions are machine-readable in `config/operations-exercises.json`. Run `npm run operations:exercise` to list them, `npm run operations:exercise -- --exercise=<id>` for a dry run, and add `--execute` only in an approved exercise window. Each execution writes evidence under `artifacts/exercises` and identifies the responsible owner, expected evidence, and abort condition.

## Database outage or restoration

1. Stop the infrastructure worker and disable settlement mutations; keep liveness available but readiness failing.
2. Confirm provider status and preserve database/connection-pool metrics.
3. Restore the latest point-in-time backup into an isolated instance and run `npm run db:migrate:status`.
4. Validate audit-chain continuity, row counts, pending jobs, idempotency records, and latest settlement transaction hashes.
5. Point one canary API and worker at the restored database, reconcile CKB state, then restore traffic gradually.

## Compromised API, JWT, or webhook key

1. Disable affected API keys or webhook endpoints immediately and stop the infrastructure worker for webhook-key exposure.
2. Revoke the affected credential, activate a new JWT key ID when applicable, retain old decryption keys only as required, and re-encrypt webhook secrets.
3. Review audit logs from the earliest suspected exposure and reconcile every settlement with CKB.
4. Resume with a canary and publish an incident timeline. Never delete compromised-key audit evidence.

## Stuck settlement or incorrect release/refund

1. Disable automated retries for the agreement and capture job, transaction, provider request ID, and audit records.
2. Query CKB independently. Never resend an uncertain signing request until the first transaction is proven absent.
3. For a confirmed incorrect transfer, freeze remaining funds, notify both parties, and escalate to the incident commander; blockchain transfers cannot be rolled back.
4. Use the administrative replay only after correcting state and recording approval in the audit ledger.

## CKB outage, ambiguity, or reorg

1. Disable new CKB settlement mutations while leaving the settlement worker able to observe existing transactions.
2. Preserve every expected transaction hash and `reconciliation_required` record. Never clear a reservation or create a replacement payment merely because broadcast returned an error.
3. Query the configured node and indexer independently, verify the exact escrow outpoint and destination output, then record the evidence in the incident.
4. For a reorg, keep affected escrows in `reconciliation_required`, page the settlement owner, and wait for the configured chain depth before any manual repair.
5. Resume new settlement only after node/indexer readiness, backlog, stale-transaction, and reorg metrics are stable.

## Failed migration

Stop deployment, keep the previous application version, and inspect `_prisma_migrations`. Do not edit migration history manually. For transactional failures, correct the migration and use Prisma resolution procedures; for partially applied non-transactional work, restore a backup or write an explicit forward repair migration. Validate against a restored production snapshot before retrying.

## Webhook backlog or dead-letter replay

Confirm endpoint/provider health and queue age, then pause new delivery claims if the backlog is growing. Fix the root cause, replay a small canary batch, verify signatures and duplicates at the receiver, then increase throughput within provider concurrency limits. Dead-letter replay requires an audited administrator action.

## Worker outage

Readiness and heartbeat alerts identify stale workers. Ensure the old process no longer owns locks, start one replacement, observe a full cycle, and scale gradually. Reconcile stale locks, pending webhook deliveries, and CKB reconciliation jobs before replay.

## Dependency vulnerability response

Identify affected SBOM components and reachable code, disable the exposed feature if critical, and create a time-bounded remediation issue. Upgrade CKB/cryptography dependencies only after wallet and transaction compatibility tests. Rebuild and scan every image, rotate credentials if exposure could disclose them, and document any risk acceptance.
