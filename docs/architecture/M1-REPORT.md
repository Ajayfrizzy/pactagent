# M1 implementation and validation report

Date: 2026-10-31. Branch: `feature/m1-multichain-foundation`, based on freshly fetched `origin/staging` **`43b9dcc9e3cc4d1de6a5074008dcb3b9a22002fe`**. Status: implementation prepared for engineering review; **not merge, deployment, production or M2 approval**. PR/head and remote-check results will be recorded after publication. [Implementation decisions, compatibility and recovery](M1-IMPLEMENTATION.md) are part of this report.

## Delivered scope

- Imported the supplied [M0 product approval](M0-PRODUCT-APPROVAL.md) byte-for-byte; updated current decision status without erasing historical proposals. Product direction is accepted; qualified engineering, security, legal/finance and operations acceptance remains OPEN.
- Added versioned asset registry, asset-specific integer validation, explicit legacy translation and unavailable Base Sepolia candidate. No guessed USDC address or mainnet activation.
- Extended the existing adapter boundary with discriminated deployment-bound capability metadata. Unknown CKB deployment evidence remains unverified; code semantics do not grant new financial actions.
- Added strict immutable terms/application commitments, W-based exact fee allocation, arbitrary terminal mutual proposals and separate billing/capacity semantics. No chain signature codec or fee execution.
- Added four scoped append-only tables, SQL conservation/tenant/full-parent constraints and idempotent internal proposal persistence. No backfill, live financial writer or legacy column reinterpretation.
- Added operation/evidence lifecycle abstractions and tests for unknown broadcasts, canonicality loss, policy mismatch, changed-block reorgs and duplicate scope reservation. No live new reconciler or signer.
- Added authenticated read-only v2 metadata/capability endpoints and separate OpenAPI while preserving v1 operations, CKB contracts/builders, app integrations and web behavior.
- Added populated pre-M1 upgrade validation to CI. Patched only `follow-redirects` 1.16.1 → 1.16.2 in root/web locks after clean-install audit discovered **GHSA-mrwp-f3q8-3g9p** (high); no security exceptions or scan reductions.

## Local validation evidence

Toolchain: verified Node **26.12.1**, npm lockfile installs, macOS arm64. PostgreSQL **16.4** and Redis **7.4.0** ran only in disposable loopback-bound local containers, using repository-pinned image digests. No production database, live chain transaction or deployment was used.

| Check | Result |
| --- | --- |
| `npm ci --cache /tmp/pact-npm-cache` | PASS on final patched workspace lock |
| `node scripts/check-dependency-lockfiles.mjs root`, `server`, `web` | PASS: isolated clean installations, manifest/direct dependency parity and unchanged high+ audit policy; zero advisory exceptions used |
| Prisma `generate`, `validate`, `format --check` | PASS |
| Fresh `prisma migrate deploy` | PASS: all 21 migrations, including additive M1 |
| `M1_TEST_DATABASE_URL=... node scripts/test-m1-upgrade.mjs` | PASS: populated pre-M1 CKB/manual/mock; every old field unchanged, original CKB bytes/outpoint retained; old reader/writer works |
| `npm run lint` | PASS: server and web TypeScript |
| `NODE_ENV=test REDIS_URL='' REDIS_URL_FILE='' npm test` | PASS: 103 unit tests, none failed/skipped; includes existing CKB tests |
| `npm run test:integration` with disposable DB and test environment | PASS: 39 database tests; optional Redis suite run separately |
| Redis durability integration with `REDIS_INTEGRATION_URL` | PASS: 2 tests, shared atomic consume and TTL |
| `npm run build` | PASS: server and Next.js production build; no application deployment |
| `npm run openapi:check --workspace @pact-agent/server` | PASS: 60 operations, including 2 v2 reads |
| v1 `openapi:compat` against exact origin/staging schema | PASS; v1 schema file unchanged |
| CKB `cargo test ... --lib --target aarch64-apple-darwin` | PASS: 11 host tests; **not VM/security certification** |
| `controls:check`, `deploy:check`, `observability:check`, `phase7:check` | PASS: existing static CI policies; no infrastructure applied or load exercise dispatched |
| `licenses:test`, `licenses:check`, `audit:test`, `env:check` | PASS |

Adversarial evidence includes 26,260 small-domain fee vectors (P=1..101, every W, five rate pairs), wide uint256 arithmetic, zero/refund/full payout/splits, dust and overflow; spoofed assets/network/precision/mainnet rejection; changed terms/recipient/tenant/deployment hashes and strict immutable parsing; unsupported capabilities; missing artifact/authorization; timeout and no rebroadcast; unavailable/disagreeing/weakened finality; same-transaction changed-block correction; API unauthenticated/wrong-scope/wrong-tenant rejection; DB cross-tenant/full-parent mismatch, immutable terms, conflicting idempotency payload, conservation, append-only observations and **concurrent different-key reservation resulting in exactly one operation**.

Initial fixture validation rejected malformed synthetic CKB cell data under an existing pre-M1 constraint. Corrected the fixture to the required 88-byte shape and reran on an empty disposable database; no constraint was weakened. Initial clean-install audit failed on the newly reported follow-redirects advisory; the patch and repeat audits resolved it. Baseline low/moderate advisories remain governed by the existing audit policy; they are not asserted absent.

## Security findings and remaining gates

1. **Engineering acceptance OPEN:** review concrete capability, terms, schema and lifecycle interfaces before merging. Staging has PR/check protection, but its current rules require zero approving reviewers; protection alone does not satisfy the required specialist review. No settings were changed.
2. **Historical CKB deployment inventory absent:** named CKB testnet asset identity is metadata, not verified genesis/code evidence. No fabricated deployment allowlist; capabilities remain unverified and existing v1 continues unchanged. Review explicit mapping before new rail activation.
3. **Actual consent/finality unavailable:** new persisted proposals stay unauthorized. Attempt/observation tables and pure evaluators do not supply cryptographic proofs. M2/M8 must wire reviewed verifiers, recoverable artifact storage, canonical provider evidence, CAS execution/recovery and historical sweeps before enabling financial writes.
4. **Legacy CKB limitations preserved:** current signer/reconciliation still have the audited M0 constraints; M1 does not claim to repair or certify historical live money behavior. No new split/arbitration/expiry guarantees apply to old cells.
5. **Specialized decisions OPEN:** D02 contract design, immutable verifier dependencies, signer policy/recovery, fee disclosure/finance/legal, billing custody/pricing, exact finality thresholds/provider policy and independent contract/VM review remain their milestone gates.
6. **No release authorization:** no merge, deployment, main modification, real-money transaction, fee collection, Base contract, CKB v2, BTC/swaps or M2 work.

## Review and M2 prerequisites

Review the complete PR, the byte-preserved approval and [implementation ADR](M1-IMPLEMENTATION.md). Resolve engineering findings, ensure required CI is green, and obtain qualified interface acceptance before an independently authorized merge to staging. This task leaves the PR open. Any later M2 task requires explicit owner authorization, official Base Sepolia/native-USDC deployment verification, reviewed consent/arbiter/deadline and factory design, approved testnet finality assumptions and actual transaction-level adversarial tests. CI success does not close specialist or launch gates.

`main` was independently verified unchanged at **`a526b78a1fb2f7282be366c0bd0bf29f4af702b2`**. `staging` remains at the recorded baseline. No merge was performed.
