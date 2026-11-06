# M2 continuation report — deterministic local implementation

Updated 2026-11-06. Existing draft [PR #119](https://github.com/Ajayfrizzy/pactagent/pull/119), branch `feature/m2-base-usdc-escrow`. Baseline staging **`5e30d6eb336087b65dde3ffdb880abf07d7c0c78`** includes merged PR #118. Production main baseline **`a526b78a1fb2f7282be366c0bd0bf29f4af702b2`**. Earlier review-package commits: `bc67848` and `1cd325e`. The current implementation commit/run is identified in the PR, avoiding a self-referential report SHA.

## Approval record and scope

The owner explicitly accepted the eight **architecture directions conditionally for M2.1** and authorized deterministic local implementation using mocks. This supersedes the earlier G0-only pause. [Acceptance and technical decisions](M2-DESIGN-DECISIONS.md) distinguish that instruction from independent engineering, contract-security, legal, finance and deployment approval: **none of those approvals is claimed**.

M2 has advanced from documentation/scaffolding to a tested local escrow and evidence candidate, but **the full activated M2 rail is not complete**. Immutable interfaces remain provisional. No public-network contracts were deployed, no public RPC transactions broadcast, no funds spent, no merge/main change or M3 initiated. Foundry executes in-process EVM tests; an opt-in backend harness also submits ephemeral signed local transactions to loopback Anvil chain 31337. PostgreSQL uses a disposable loopback Docker database.

## Completed and remaining work

| Package | Completed in this continuation | Remaining |
| --- | --- | --- |
| M2.1 | Conditional acceptance register, explicit technical self-review, exact Solidity/TS EIP-712 codecs and canonical vectors, pinned libraries/compiler/toolchain, equivalent full/clone benchmark | Product directions recorded below; numerical interval policy and independent technical review before ABI/factory freeze |
| M2.2 | Immutable full-instance candidate, minimal factory, both-party exact atomic funding, arbitrary mutual split/refund/payment, signed dispute invocation, immutable direct EOA threshold arbitration, permissionless fallback and exact W-based fees | Independent contract security review and completion of all adversarial acceptance cases before release claim |
| M2.3 | Local-only adapter computing allocation from pinned terms; live metadata remains unavailable; no M1 candidate mutation | Verified live deployment/asset binding and independent token/proxy/provenance evidence |
| M2.4 | Local verified raw-transaction pipeline, encrypted immutable commands, leased outbox, restart/replacement, historical sweeps and sticky evidence correction | Live sender, paid ledger, key operations and independent finality remain gated |
| M2.5 | Authenticated scope-separated public gates and local terms/signing/proposals/status, OpenAPI, webhook jobs and compatibility tests | Live financial routes/SDK and external notification delivery remain unavailable/unverified |
| M2.6 | In-process EVM/fuzz/invariants, PostgreSQL concurrency/upgrades, real Anvil/PostgreSQL/HTTP lifecycle, CI and artifact reproducibility | No independent/testnet validation; expanded adversarial and operational review remains |

[Implementation details](M2-IMPLEMENTATION.md), [threat model](../security/M2-THREAT-MODEL.md), [contract reproducibility](../../contracts/evm/README.md) and [ABI/template evidence](evidence/m2/local-contract-artifacts.json) identify exact boundaries. No unimplemented financial operation is advertised as available.

## Local validation evidence

Toolchain: Node **26.12.1**, Foundry **1.3.1** commit `08d3a4ad4d78b62bcb897350803bf96fc2cf6cc9`, Solidity **0.8.30**, Cancun target, optimizer **200**, via-IR, OpenZeppelin **5.4.0**, PostgreSQL **16.4**. Foundry archive SHA-256 is pinned in CI; 29 unmodified vendored library files have per-file hashes. This is dependency provenance, not a third-party audit of PactAgent.

| Command / suite | Result |
| --- | --- |
| `forge test --root contracts/evm -vv` | **62 passed**, 4 suites. Full and clone lifecycle cases; 512 cases per fuzz property per inherited suite; stateful invariants **128×32=4096 calls per full/clone form**, 8192 total |
| Canonical vectors via `node --import tsx scripts/m2-vectors.ts` and Solidity vector test | Terms, four action digests and cancellation digest match across TypeScript and Solidity; wrong action/chain/instance/expiry changes are tested |
| `forge ... --match-test testBenchmarkFullAndEquivalentPinnedClone -vvvv` | Local full harness **2,488,411 gas** vs clone plus equivalent atomic initialization **630,726 gas**, two-arbiter fixture; excludes one-time clone implementation deployment. Full remains provisional preference for simpler construction |
| `forge build --root contracts/evm --sizes` | Full escrow runtime **8,950 bytes**, factory **13,682 bytes**, below EIP-170 limit; size is not security assurance |
| `node scripts/m2-contract-artifacts.mjs` | ABI and creation/runtime template hashes reproduce; not deployed-instance identity |
| `node scripts/check-evm-dependencies.mjs` | 29 exact vendored source hashes verified |
| `NODE_ENV=test REDIS_URL='' REDIS_URL_FILE='' npm test` | **117 passed**, including interval-policy/cancellation binding |
| `npm run test:integration` on disposable PostgreSQL | **48 passed**, optional Redis durability skipped; local EVM test runs separately |
| Fresh `prisma migrate deploy` | **25 migrations** applied; new local-only tables and guards installed without rewriting old migrations |
| `scripts/test-m1-upgrade.mjs` and `--review-correction` | Both populated pre-M1 and merged-M1 upgrades passed; original stored legacy fields/bytes preserved |
| Prisma generation, format/check, validation | Passed |
| `npm run lint`, `npm run build` | Server/web TypeScript and production builds passed; no deployment |
| `npm run openapi:check --workspace @pact-agent/server` | **62 operations**; existing v1 artifact unchanged, additive v2 gates |
| `scripts/check-dependency-lockfiles.mjs root/server/web` | All three isolated clean installs and dependency audits passed after registry download timeouts/retry; this continuation adds only direct pinned ethers 6.17.0 to root/server locks, resolved graph unchanged |
| `node --test scripts/m2-network-probe.test.mjs` | **16 passed**; no new live probe or activation |
| Controls/deploy/observability/performance/license/audit-policy/environment checks | Passed; no checks disabled |
| Secret scan, authored whitespace, JSON and relative document links | Validated before final push; remote CI rechecks the complete branch |
| Opt-in real Anvil/PostgreSQL/HTTP lifecycle | Passed: funding, mutual/refund/arbitration/fallback, scoped consent, crash/lost response, explicit epoch/nonce replacement, competing workers, duplicate evidence and historical reorg correction |

A final self-review tightened direct escrow construction to enforce the same Base Sepolia chain/issuer check as the factory. Arbitrary mock construction now lives only in LocalEscrow test harnesses sharing the financial core. Two additional negative/positive VM construction tests cover the boundary; no network identity was activated.

The initial local DB fixture failed because milestone currency differed from its parent. Corrected the fixture to respect the existing constraint; no constraint weakened. Initial Paris compilation correctly rejected MCOPY from the pinned OZ version; target explicitly changed to Cancun. Clone initializer test initially placed `expectRevert` before an intervening getter; corrected the test ordering and verified both implementation/instance reinitialization rejection.

## Security findings and policy questions

- **No independent verification yet:** all local tests and technical analysis here were performed by the implementation agent. CI is reproducible automation, not an independent reviewer. Contracts remain unsuitable for release claims pending specialist review.
- Network manifest still contains only single-provider evidence. Independent operator agreement, token implementation/provenance and deployed bytecode/terms binding are unresolved activation gates. Test keys/mock addresses are never registered as network deployments.
- Participant ERC-1271 owners can mutate; arbitral authority is directly verified immutable EOA membership/threshold, with no mutable verifier or operator override. Loss/delegation can prevent a verdict, leaving committed fallback.
- Earlier immutable local-operation prototype remains intact. New local command/outbox tables support explicit higher-epoch same-nonce replacement without deleting evidence. Same-epoch fee bumps, operational nonce coordination and live paid projection remain unimplemented.
- Local observer checks expected receipt/state/event facts but two fixture provider labels do not establish real provider independence or Base L1 finality.
- Remaining acceptance coverage includes forced native ETH, deeper ERC-1271/reentrancy variations, operational key recovery, continuous worker supervision and independent live finality (local real-node replacement/outbox/reorg sweeps now tested). Passing covered tests does not stand in for the entire matrix.

The owner now accepts minimum funding interval direction, distinct client/worker/
treasury addresses and explicit immutable EOA thresholds up to 16, without
independent approval. Non-revocable intents are superseded by a **provisional**
cryptographic cancellation/epoch replacement policy. Numerical interval bounds
(30 seconds..7 days for local policy 1), participant UX, irrevocable dispute and
precise cancellation authority/races require technical review before ABI freeze.
See [engineering self-review](M2-LOCAL-ENGINEERING-REVIEW.md). Full-versus-clone
benchmark evidence does not constitute independent review.

A reused local database exposed leftover fixture webhook jobs in an unrelated
worker assertion. Clean-database tests passed; the local EVM test now cleans only
its own mutable delivery jobs and retains immutable financial evidence. No runtime
security assertion was weakened.

## CI and handoff

The prior documentation-only head `1cd325e` passed all 12 jobs in [run 41242777325](https://github.com/Ajayfrizzy/pactagent/actions/runs/41242777325). This is historical evidence only, not validation of the new implementation. The continuation extends the read-only, checksum-pinned local EVM job with PostgreSQL and disposable Anvil lifecycle validation and retains every existing CI/security/migration/image check. The latest-head run/result is recorded in PR #119 after pushing; no failing check is bypassed and no auto-merge is enabled.

Next: resolve the explicit policy/interface questions, obtain independent engineering and contract-security review, and complete remaining operational/SDK/adversarial acceptance work before claiming M2 complete. Live activation additionally requires verified independent network/issuer/deployment/finality evidence and a separate reviewed deployment decision. Current authorization still forbids deployment, funds, main promotion, merge and M3.
