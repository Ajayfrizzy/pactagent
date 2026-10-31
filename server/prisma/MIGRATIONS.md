# Database migrations

Production deployments must use committed migrations, never `prisma db push`.

## New database

```bash
npm run db:migrate:deploy
```

This applies the baseline schema followed by the tenant-integrity constraints.

## Existing database created with `db push`

Back up the database and verify that its schema matches the baseline before marking it as applied:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
npx prisma migrate resolve --applied 20260715000100_baseline
npm run db:migrate:deploy
```

Do not resolve the tenant-integrity migration manually. It must execute against the database. It will fail if existing infrastructure records reference a parent belonging to a different app; correct those records and run the deployment again.

`prisma.config.ts` uses `DIRECT_URL` when present, so migrations can bypass a transaction-pooling connection while the application continues to use `DATABASE_URL`.

Staging and production require both variables. `DATABASE_URL` must identify the transaction/session pool used by application replicas; `DIRECT_URL` must identify a different direct PostgreSQL endpoint used only by migration jobs. The API and worker validate this policy before startup.

Before deploying tenant-integrity migrations, run `npm run audit:tenant-integrity`. It is read-only and reports up to 100 mismatches per relationship, including both app IDs. Do not rewrite ownership automatically: determine the authoritative tenant from audit and business records, repair the data under an approved change, rerun the audit, and only then deploy migrations.

The composite tenant foreign keys are maintained as custom migration SQL because the schema also supports nullable legacy product records. Review future generated migrations and do not remove constraints ending in `_appId_fkey`.

## M1 additive expansion

`20261031000100_multichain_foundation` adds prospective commitments, operations,
attempts and observations. No legacy backfill or financial execution is enabled.
Custom composite FKs, numeric checks and immutability/scope triggers must be retained.
Run `node scripts/test-m1-upgrade.mjs` from the repository root with
`M1_TEST_DATABASE_URL` pointing to an empty disposable local `pactagent_m1_upgrade`
database. See [M1 implementation](../../docs/architecture/M1-IMPLEMENTATION.md) for
compatibility, lock-window review, old-reader rollback and additive repair policy.

### M1 review correction

`20261031000200_foundation_exact_fees_and_locking` preserves the already-merged
M1 migration checksum. It replaces the fee CHECK with exact numeric `div` and
strengthens foundation insertion to `FOR UPDATE` on its parent. After validation,
an `id = id` update advances only the unfunded parent's MVCC row version; no
column value or timestamp changes. This also forces stale repeatable-read parent
writers to abort with SQLSTATE 40001 instead of missing a newly inserted foundation.
Retry a serialization failure only by restarting the whole transaction and
revalidating scope; never reuse stale terms or weaken isolation.

The correction validates existing fee data and rejects pre-existing scope
mismatches. If it fails, stop and investigate using reviewed authoritative records;
do not mutate immutable fees, retarget funded escrows or disable constraints.
DDL requires a brief table-lock window. This is a forward schema correction, not
an on-chain migration, backfill or deployment authorization.

The original pre-M1 fixture now applies all forward migrations. Additionally run
`node scripts/test-m1-upgrade.mjs --review-correction` with `M1_TEST_DATABASE_URL`
pointing to an empty local `pactagent_m1_review_upgrade` database; this upgrades
populated merged-M1 records and verifies every stored field remains unchanged.
