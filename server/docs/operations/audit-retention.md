# Audit and Retention

`AuditLog` is an append-only ledger enforced by PostgreSQL triggers. New rows form a SHA-256 linked ledger through `previousHash` and `recordHash`; concurrent writes may branch from the same valid predecessor so unrelated tenants are never globally serialized. Verification checks every row digest and predecessor reference. Updates and deletes fail unless an explicit maintenance session is authorized. Application endpoints do not expose that authorization. Administrative reads are themselves audited.

The retention job copies audit rows older than `AUDIT_ARCHIVE_AFTER_DAYS` into `AuditLogArchive`; primary ledger rows remain immutable. Export archived records to immutable object storage before moving them out of PostgreSQL. Verify the hash chain before and after export and retain the export manifest separately.

Default operational retention:

| Record | Default | Action |
| --- | ---: | --- |
| Idempotency records | 24 hours | Delete expired |
| Delivered/failed webhook deliveries and payloads | 30 days | Delete |
| Lifecycle events | 90 days | Delete only when no webhook delivery references them |
| Completed/dead-letter jobs | 30 days | Delete |
| Audit records | 365 days hot | Copy to archive; retain according to legal policy |

Preview all eligible rows without mutation:

```bash
npm run retention:run --workspace @pact-agent/server -- --dry-run --batch-size=500 --max-batches=10
```

Run bounded live batches:

```bash
npm run retention:run --workspace @pact-agent/server -- --batch-size=500 --max-batches=10
```

The JSON report records eligible and affected rows, batches, and whether work remains for every record class. Exit code `2` means the configured bound was reached and the next scheduled run must resume; exit code `1` means execution failed. Prometheus exposes row and duration metrics. The data-platform owner reviews dry-run evidence and aborts if counts exceed the approved change window or audit export has not completed. Back up the database before changing retention values.
