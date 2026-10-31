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
