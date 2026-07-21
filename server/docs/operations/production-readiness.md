# Production readiness checklist

The release engineer owns this checklist and records links to CI, deployment, smoke, load, migration, and rollback evidence in the release issue.

1. Run `npm run controls:check`, `npm run deploy:check`, `npm run observability:check`, and `npm run phase7:check`. Expect every validator to pass; abort on missing evidence or unreviewed control regression.
2. Confirm the migration upgrade test and measured query-plan artifact passed in CI. Abort on drift, failed migration, unexpected sequential scans, or unapproved latency regression.
3. Confirm staging uses the immutable production image digests and all readiness, smoke, and k6 profiles passed. Abort on stale workers, database or settlement readiness failure, queue growth, error threshold, or idempotency mismatch.
4. Run the retention dry run and review eligible counts. Abort if the backup is missing, counts exceed the approved window, or audit export evidence is incomplete.
5. Confirm restore verification evidence is within the quarterly window and exercises for rolling restart, dead-letter replay, and incorrect release have current owners. Abort when recovery evidence is expired.
6. Confirm alert routes, on-call ownership, controlled webhook egress, signer policy, secrets, backup/PITR, and funded testnet smoke access are provisioned externally. Abort if any required external control is absent.
7. Promote through the protected production environment. Expected evidence is the release commit, image digests, migration Job, rollout revisions, health/smoke results, and release annotations. Abort and follow application rollback plus database forward-fix policy on failure.
