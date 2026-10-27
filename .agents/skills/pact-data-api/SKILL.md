---
name: pact-data-api
description: Change or review PactAgent tenant persistence, migrations and versioned API, SDK or webhook contracts while preserving funded CKB records.
---

Read [migration design](../../../docs/architecture/data-api-migration.md), [repository conventions](../../../CONTRIBUTING.md) and [existing migration guidance](../../../server/prisma/MIGRATIONS.md).

Resolve appId from authenticated context. Scope all CRUD, cursors, idempotency, events, blob access, billing and jobs; enforce composite tenant and parent-scope relationships in the database as well as services. Add forward migrations and populated upgrade fixtures for authorized schema changes; never rewrite applied SQL or use db push for deployment. Preserve original funded lock bytes/outpoints and route legacy records explicitly. Unknown historical consent cannot become arbitration authority during backfill.

Keep legacy/new dual writes atomic and define the reader cutover/rollback before changing schema. Update checked-in OpenAPI for route changes and compatibility tests for events/SDKs. Consumers must tolerate duplicate/out-of-order notifications and distinguish verdict, broadcast, confirmed and reorg states.

Run repository lint, unit, build and OpenAPI checks for implementation; run relevant tenant/concurrency/financial integration and migration upgrade checks on a disposable local DB for persistence changes. Never use production data or destructive reset as a test shortcut. Report unavailable prerequisites rather than claiming skipped checks passed. In M0 document proposed diffs only; do not edit schema, migrations or routes.
