# Operational checklists

## Deployment

- [ ] CI tests, audits, image scans, and OpenAPI compatibility pass.
- [ ] Build version and commit are embedded.
- [ ] Secrets and key IDs exist in the target environment.
- [ ] `/health`, `/ready`, and worker probes match deployment policy.
- [ ] Migration job completes before API/worker rollout.
- [ ] Error rate, queue age, and settlement status are observed during rollout.
- [ ] Rollback artifact and database compatibility are confirmed.

## Migration

- [ ] Migration is additive or has an explicit expand/migrate/contract plan.
- [ ] Upgrade test preserves representative existing data.
- [ ] Query plan and lock duration are measured in staging.
- [ ] Backup and restore point are verified.
- [ ] Backfill is bounded, resumable, and observable.
- [ ] Rollback or forward-fix procedure is documented.

## Security

- [ ] Tenant-scoped reads and writes have negative tests.
- [ ] New URLs use SSRF and DNS-rebinding controls.
- [ ] New secrets support mounted files and redaction.
- [ ] Payload, rate, and pagination limits are defined.
- [ ] Dependencies and containers pass vulnerability policy.
- [ ] Authentication, authorization, audit, and retention impacts are reviewed.
