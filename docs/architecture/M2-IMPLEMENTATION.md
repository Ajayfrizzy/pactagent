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

### Local command lifecycle added 2026-11-06

[Consent verification](../../server/src/modules/base/local-consent.ts) validates
trusted fixture code/terms, canonical signed EIP-1559 transactions, chain 31337,
zero native value, exact escrow destination, EOA/ERC-1271 participant consent or
immutable arbiter threshold and current action epochs. It simulates full execution;
the contract rechecks authority at execution. API keys cannot sign for participants.

[Lifecycle](../../server/src/modules/base/local-lifecycle.ts) persists encrypted
immutable signed bytes, command identity, dispatch outbox and existing event/webhook
jobs in one database transaction. SKIP LOCKED leases permit competing workers.
Unknown status is committed before submission. Restart checks the receipt first;
ambiguous retries submit only identical bytes. Consumed nonces without receipts,
changed epochs or invalid binding require reconciliation. No operator signing keys
or automatic fee bumping are introduced.

[Local worker](../../server/src/modules/base/local-worker.ts) polls pending and
historical rows, including finalized records. Receipt/block/code/terms/event checks
produce append-only evidence and transactional local-status events. Corrections are
sticky and duplicate evidence is suppressed. These events never mark legacy escrow
paid. The worker is an explicit harness dependency, not registered in production.
Continuous-loop supervision, monitoring, sweep scaling and key rotation remain
operational work; integration tests exercise durable ticks/restarts directly.

[Local API](../../server/src/modules/base/local-api.ts) offers registration, signing
payload, proposal and status with real API-key scopes/tenant isolation. It requires
loopback peers and is not imported by production app.ts. A separate [local OpenAPI](../../server/docs/openapi/pactagent.v2.local.openapi.json)
describes it. Registration cannot add trusted bytecode; trust comes from harness
configuration. Public Base financial routes remain unavailable.

Forward migrations `20261106000100_m2_local_dispatch` and
`20261106000200_m2_local_nonce_replacement` add immutable commands/evidence and a
leased outbox, then permit explicitly linked same-tenant/escrow/action/sender/nonce
successors at higher epochs. Both artifacts survive. SQL enforces structural scope;
onchain cancellation and signatures establish authority. No historical SQL is edited.
Ordinary gas-price replacement at the same epoch is deliberately unsupported.

## EVM and integration validation

See [contract instructions](../../contracts/evm/README.md). Foundry 1.3.1, Solidity 0.8.30, Cancun, via-IR, optimizer 200 and OpenZeppelin 5.4.0 are pinned. Vendored imports are byte-identical to the archived npm package and checked by SHA-256. The separate CI EVM job verifies its Foundry download hash, runs local tests and reproduces [ABI/bytecode-template evidence](evidence/m2/local-contract-artifacts.json). CI also starts disposable Anvil on loopback and executes the backend lifecycle; no public deploy/broadcast step exists.

The unit/fuzz suite covers funding/replay/chain/instance/action binding, ERC-1271 mutation, direct arbiter code changes, threshold duplicates, exact D/T boundaries, token pause/tax/false/empty returns, reentrancy, allowance underfunding, donations, all four fee modes, uint256 limits and rollback. Two fuzz properties run 512 cases each. Stateful terminal invariants execute 128 sequences ×32 calls on each full and clone candidate with at most one successful terminal transition and conserved balances.

The benchmark compares full constructor deployment (2,488,411 gas) with an atomically initialized pinned clone using the same core and two-arbiter terms (630,726 gas, excluding implementation deployment). Clone is test-only. Full deployment remains preferred for the initial candidate despite its gas cost because it has no external initializer/delegatecall path; independent review is still required before freezing the choice.

Backend tests use actual PostgreSQL for artifact/idempotency races, rollback/recovery, tenant/parent integrity, immutable rows, duplicate observations and reorg correction. API tests exercise real authenticated loopback requests. RPC-verifier tests use deterministic raw receipt fixtures; these are not real independent Base providers. The authorized loopback Anvil suite executes actual signed local transactions through authenticated HTTP, PostgreSQL outbox and worker: funding, mutual split, refund, dispute/arbitration and fallback; crash/lost response, cancellation/nonce replacement, concurrent workers and snapshot/revert sweeps. Fixture bytecode is installed through local Anvil controls, never registered as a Base deployment. Both observer views use that same node and do not establish independent network finality.

## Capability map and remaining work

| Work package | Implemented locally | Remaining |
| --- | --- | --- |
| M2.1 | Acceptance register, technical questions, threat model, codecs/vectors, pinned tools, equivalent full/clone measurement | Independent deployment-choice review, policy decisions, independent technical review, ABI freeze |
| M2.2 | Factory/escrow candidate, full financial branches, EVM tests/fuzz/invariants | Independent review, expanded adversarial matrix and production-quality artifacts/deployment plan |
| M2.3 | Separate local adapter and unavailable live metadata | Independent token/proxy/provenance and deployed-bytecode binding; no activated Base asset |
| M2.4 | Local additive immutable encrypted evidence and deterministic observer | Local broadcaster, consent verification, outbox/worker, historical sweeps and epoch replacement now implemented; live operations, key rotation, paid projection remain gated |
| M2.5 | Scope-separated authenticated unavailable gates and OpenAPI | Local terms/signing/proposal/status implemented with webhook outbox; live API/SDK, delivery operations and participant UX remain gated |
| M2.6 | In-process EVM, TypeScript, PostgreSQL, compatibility and CI | Real local-node backend lifecycle now tested; independent review and public network validation remain absent/forbidden |

No unsupported behavior is mapped to a live v1 release/refund path. `BASE_SEPOLIA_CANDIDATE` remains unchanged. No operator-held participant signing keys, B2B billing, mainnet, M3, merge or deployment is introduced.
