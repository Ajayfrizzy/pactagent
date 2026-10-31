# M1 database review corrections

The two complete review comments on [PR #109](https://github.com/Ajayfrizzy/pactagent/pull/109) identify real defects in its original migration. At correction time GitHub reported that PR already merged at `6e6d241918aff685b40e351f5f0c30b663b202a2`. Fixes are pushed to its requested `feature/m1-multichain-foundation` branch and submitted as a separate corrective PR from staging; a merged PR cannot receive a new revision. No merge or deployment is authorized by this work.

## Exact database fee arithmetic

[Fee review](https://github.com/Ajayfrizzy/pactagent/pull/109#discussion_r4432267328): PostgreSQL numeric `/` selects a result scale and can round before `floor` executes. Principal `10000000000000000015` at 1000 bps has exact deposit `1000000000000000001`, whereas the old expression produces `1000000000000000002`. This valid principal plus reserve fits uint64.

The [forward migration](../../server/prisma/migrations/20261031000200_foundation_exact_fees_and_locking/migration.sql) replaces the fee CHECK with `div(principal::numeric * "clientFeeBps", 10000)`. Exact numeric multiplication followed by integer quotient does not round up; because principal/rates are constrained nonnegative, truncation is the intended mathematical floor. The original merged migration and its checksum remain unchanged. Existing values must validate; no fee data is rewritten or constraint disabled.

Database tests cover the reported value and adjacent .4/.5/.6 quotient cases, dust, zero/1/999/1000 bps, uint64 and synthetic uint256 maximal funding boundaries, overflow and incorrect deposit+1 rejection. They compare actual stored deposits with application BigInt arithmetic and exercise raw SQL constraints independently of service rejection: 26 valid allocations, 8 funding overflows and 34 incorrect deposits.

## Parent scope serialization

[Lock review](https://github.com/Ajayfrizzy/pactagent/pull/109#discussion_r4432267329): `FOR KEY SHARE` allows a concurrent non-key rail/network update. The update trigger cannot see an uncommitted foundation, allowing a stale scope check.

The replacement insertion trigger uses `FOR UPDATE` before validating all parent fields and unfunded status. The row lock remains held through commit. A waiting read-committed operation rechecks committed scope and fails with SQLSTATE 23514 when incompatible. Additionally, an `id = id` update advances only the already-validated unfunded parent's MVCC version, without changing any stored value or timestamp. This prevents a repeatable-read parent writer from using an older snapshot that omits the new foundation: it receives SQLSTATE 40001 and must restart the entire transaction. No funded legacy row is touched by this path.

Two independent PostgreSQL sessions test insert-first and parent-update-first orderings under both READ COMMITTED and REPEATABLE READ. A third session checks `pg_blocking_pids` before releasing the holder; arbitrary sleeps do not establish correctness. Tests assert the losing transaction's precise SQLSTATE, persisted consistent scope, absent invalid foundation and byte/value-identical parent after successful insertion.

The correction also fails closed if existing foundation scope was already corrupted. An installation with inconsistent fees/scope requires investigated, reviewed repair, not automatic changes to immutable commitments. DDL requires a lock window; inspect and follow [migration guidance](../../server/prisma/MIGRATIONS.md). This change neither enables live financial writes nor changes CKB scripts/outpoints or v1 API semantics.

## Verification

- Before correction: the new fee test and both read-committed race tests failed against the unchanged merged SQL, reproducing the findings.
- After correction: all five focused database regressions pass, including both repeatable-read orderings.
- Full PostgreSQL integration suite: **44 passed**. Optional Redis durability is unrelated and not rerun locally in this correction task.
- Application unit suite: **103 passed**; existing CKB builder/observer tests retained.
- Fresh database: all **22 migrations** applied successfully.
- Populated pre-M1 upgrade: all CKB/manual/mock fields, bytes/outpoints and legacy reader/writer compatibility preserved through both M1 migrations.
- Populated merged-M1 forward upgrade: every prior App/Agreement/Escrow/Foundation field preserved; exact fee constraint validated.
- Prisma generation/validation/format, server/web TypeScript and builds, OpenAPI (60 operations), controls/deployment/observability/performance policy, licenses, audit-policy tests and environment checks: passed locally.
- Full remote required CI runs on the corrective PR; exact commit/run results are recorded in that PR and the replies to both original review threads after verification. No security check is disabled or weakened.

`node scripts/test-m1-upgrade.mjs` now applies all later migrations after its populated pre-M1 fixture. The new `--review-correction` mode upgrades a populated merged-M1 fixture in a separate empty local `pactagent_m1_review_upgrade` database. Both modes run in the existing CI server/migrations job. Existing fixtures and applied SQL are retained.
