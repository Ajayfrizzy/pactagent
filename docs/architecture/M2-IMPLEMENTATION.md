# M2 local implementation — review candidate

Owner conditional architecture-direction acceptance is recorded in [M2 design decisions](M2-DESIGN-DECISIONS.md). This branch implements deterministic local contract and evidence components, **not a complete activated Base rail**. No independent engineering/security review, deployment permission or interface freeze is claimed.

## Implemented components

- [Escrow](../../contracts/evm/src/PactEscrow.sol): constructor-bound terms, both-party cryptographic funding consent, exact token debit/credit, mutual arbitrary split/full payout/refund, participant-signed dispute invocation, fixed EOA arbitral threshold, committed permissionless fallback, W-based fees and shared terminal-state/nonreentrancy protection. ERC-1271 participants are verified at execution; arbiters use only direct ECDSA.
- [Factory](../../contracts/evm/src/PactFactory.sol): provisional full-instance creation/indexing only, no owner/upgrade/sweep. Published chain/token check is not sufficient activation proof; no deployment registry entry exists. Local mocks/factory live exclusively in tests.
- [Codec](../../server/src/modules/base/codec.ts): canonical uint256/addresses, ordered arbiter hashing, domain-separated EIP-712 action digests. Solidity tests cross-check the [canonical vectors](../../contracts/evm/test/vectors.json). M1 application hashes remain separate.
- [Local adapter](../../server/src/modules/base/adapter.ts): computes expected allocations from pinned terms and delegates verification; live capability is permanently unavailable in this candidate. Does not implement legacy adapter signing methods or claim live Base support.
- [Local observer](../../server/src/modules/base/observer.ts): validates two configured sources' chain, receipt success/tx/emitter, code hash, termsHash, terminal state, token, event path/amounts, canonical block and finalized evidence. Missing/inconsistent evidence is unknown; changed or lost finalized evidence is sticky reconciliation_required. Never uses latest as finality. Two fixture labels are not proof of real provider independence.
- [Local artifact storage](../../server/src/modules/base/local.repository.ts): scoped immutable terms; AES-256-GCM encrypted recoverable artifacts bound by associated data to app/operation/terms/key version; atomic operation+initial-evidence commit, idempotency payload matching and permanent single-terminal-slot uniqueness. App row locks serialize simultaneous reservations. Records are evidence, **not verified authorization**; storage accepts synthetic test artifacts and is not wired to a sender.
- [Append-only observations](../../server/src/modules/base/local-evidence.repository.ts): row-locked sequence assignment, duplicate suppression and sticky corrections, retaining original artifact/transaction identity. No finalized ledger capture or paid webhook is connected to this local prototype.
- [Versioned API gates](../../server/src/modules/base/base.routes.ts): authenticated `GET /v2/base/capabilities` requires `escrows:v2:read`; `POST /v2/base/proposals` requires `escrows:v2:propose` then returns `unsupported_capability`. Neither scope authorizes funds. No financial/signing payload endpoints are falsely advertised. V1 unchanged; [v2 OpenAPI](../../server/docs/openapi/pactagent.v2.openapi.json) updated.

## Persistence and compatibility

[Forward migration](../../server/prisma/migrations/20261031000300_m2_local_evidence/migration.sql) creates `BaseLocalEscrow`, `BaseLocalOperation` and `BaseLocalEvidence` with immutable-row triggers, scoped composite FKs and unique operation/idempotency/terminal keys. A database CHECK restricts the aggregate to chain **31337**, preventing accidental live identity insertion. Existing M1 rows/checks, correction checksum, legacy Escrow, CKB scripts and v1 APIs remain unchanged. No retroactive relabeling or backfill occurs.

Fresh deployment and both populated upgrade paths preserve existing rows. On code rollback, leave additive evidence tables intact. Future live evolution needs reviewed forward migrations, not removal of local-only checks. Signed artifact encryption keys are supplied to internal test functions; no production key provisioning, secret config or rotation service is introduced. Version mismatch/tampering/wrong scope prevents recovery. Never log/decrypt artifacts into public responses.

Durable pending-operation storage and observation correction are implemented locally. An actual broadcast worker, outbox integration, artifact signature/transaction verification, replaced-transaction recovery, historical scan scheduling, key-rotation operations, paid projection and notification delivery are **not** implemented. Holding a permanent terminal slot is deliberately conservative but cannot handle expired/replaced proposals yet. This is an open live-pipeline design constraint, not proof of complete crash-safe payments.

## EVM and integration validation

See [contract instructions](../../contracts/evm/README.md). Foundry 1.3.1, Solidity 0.8.30, Cancun, via-IR, optimizer 200 and OpenZeppelin 5.4.0 are pinned. Vendored imports are byte-identical to the archived npm package and checked by SHA-256. The separate CI EVM job verifies its Foundry download hash, runs local tests and reproduces [ABI/bytecode-template evidence](evidence/m2/local-contract-artifacts.json). No deploy/broadcast step exists.

The unit/fuzz suite covers funding/replay/chain/instance/action binding, ERC-1271 mutation, direct arbiter code changes, threshold duplicates, exact D/T boundaries, token pause/tax/false/empty returns, reentrancy, allowance underfunding, donations, all four fee modes, uint256 limits and rollback. Two fuzz properties run 512 cases each. Stateful terminal invariants execute 128 sequences ×32 calls on each full and clone candidate with at most one successful terminal transition and conserved balances.

The benchmark compares full constructor deployment (2,129,779 gas) with an atomically initialized pinned clone using the same core and two-arbiter terms (584,505 gas, excluding implementation deployment). Clone is test-only. Full deployment remains preferred for the initial candidate despite its gas cost because it has no external initializer/delegatecall path; independent review is still required before freezing the choice.

Backend tests use actual PostgreSQL for artifact/idempotency races, rollback/recovery, tenant/parent integrity, immutable rows, duplicate observations and reorg correction. API tests exercise real authenticated loopback requests. RPC-verifier tests use deterministic raw receipt fixtures; these are not real independent Base providers. Per user prohibition, no local RPC transactions are broadcast and no network contracts are deployed; backend-to-real-local-node lifecycle validation remains outstanding.

## Capability map and remaining work

| Work package | Implemented locally | Remaining |
| --- | --- | --- |
| M2.1 | Acceptance register, technical questions, threat model, codecs/vectors, pinned tools, equivalent full/clone measurement | Independent deployment-choice review, policy decisions, independent technical review, ABI freeze |
| M2.2 | Factory/escrow candidate, full financial branches, EVM tests/fuzz/invariants | Independent review, expanded adversarial matrix and production-quality artifacts/deployment plan |
| M2.3 | Separate local adapter and unavailable live metadata | Independent token/proxy/provenance and deployed-bytecode binding; no activated Base asset |
| M2.4 | Local additive immutable encrypted evidence and deterministic observer | Actual broadcaster, signature/tx verification, outbox/worker, historical scan scheduler, replacements and operational recovery |
| M2.5 | Scope-separated authenticated unavailable gates and OpenAPI | Real initiation/terms/signing/proposal/status workflow, signed webhooks/SDK example |
| M2.6 | In-process EVM, TypeScript, PostgreSQL, compatibility and CI | Real local-node backend integration without violating no-broadcast instruction; optional testnet remains forbidden |

No unsupported behavior is mapped to a live v1 release/refund path. `BASE_SEPOLIA_CANDIDATE` remains unchanged. No operator-held participant signing keys, B2B billing, mainnet, M3, merge or deployment is introduced.
