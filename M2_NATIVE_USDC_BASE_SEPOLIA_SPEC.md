# PactAgent — M2 Native USDC Escrow on Base Sepolia

**Milestone:** M2  
**Date:** 2026-10-31  
**Status:** Implementation specification; authorizes development and local/testnet validation planning, **not** unreviewed chain deployment, merge, mainnet activation, custody, billing, or production release.  
**Base branch:** latest protected `origin/staging` after M1 and corrective PR #118.  
**Feature branch:** `feature/m2-base-usdc-escrow` (create only if free).  
**Authority:** `M0_ARCHITECTURE_SPEC.md`, `M0_PRODUCT_APPROVAL.md`, `docs/architecture/M0-DECISIONS.md`, `docs/architecture/M0-PRODUCT-APPROVAL.md`, `docs/architecture/M1-IMPLEMENTATION.md`, `docs/architecture/M1-REVIEW-CORRECTIONS.md`, `docs/architecture/milestone-contracts.md`, `AGENTS.md`, and the repository skills.

## 1. Goal and hard boundaries

Implement a **noncustodial, per-escrow native USDC rail for Base Sepolia**, with mutually approved funding terms, exact deterministic full payment/refund/arbitrary split, optional immutable pre-consented application-selected arbitration, a chain-enforceable fallback design, versioned deployment/asset identity, authenticated integration, durable broadcast/reconciliation, and comprehensive adversarial tests. Preserve original funded CKB v1 behavior and all v1 API contracts.

**Do not interpret passing tests as authorization to deploy contracts.** Build locally and with test/mocked chains first; if testnet deployment requires an external signature, sponsor account or transaction, produce artifacts and a deployment plan and request explicit authorization. Testnet use must require **faucet-only assets and no personal expenditure**. Base mainnet, USDC mainnet, direct financial writes by unauthorized API calls, arbitrary tokens, USDT, bridge/swap, PactAgent B2B custody and CKB v2 remain disabled.

## 2. Authoritative network/asset verification

As of **2026-10-31**:

- **Base Sepolia:** EVM chain ID **84532** (`eip155:84532`); Base public RPC `https://sepolia.base.org`; explorer `https://sepolia.basescan.org`. Source: https://docs.base.org/chain/connect (or current official Base documentation; verify exact current canonical page). Base public RPC may be rate-limited; do not assume production reliability.
- **Circle-issued Base Sepolia test USDC:** `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Canonical issuer listing: https://developers.circle.com/stablecoins/usdc-contract-addresses. Test token has **no monetary value**. Verify `eth_chainId`, on-chain code existence, ERC-20 `decimals()` **6**, and issuer address against Circle's live source before enabling even testnet deposits. Explicitly reject copied tickers, bridged tokens and wrong chain deployments.
- Record retrieval date, documentation URL, observed contract code hash, chain ID, deployment block/transaction, token decimals and configuration version in a reviewed manifest. The **PactAgent factory and escrow deployment addresses are unknown until we deploy**: do not invent them. The Circle token address is not PactAgent's escrow address.
- On provider disagreement or missing verification, fail closed. No automatic fallback to Base mainnet or some other USDC.

**M1 compatibility:** preserve immutable prior asset IDs and prospective/unavailable metadata; introduce an explicitly versioned verified Base asset identity and deployment binding via additive evolution. Do not silently mutate the `BASE_SEPOLIA_CANDIDATE` or historical rows to grant capabilities. Migration and activation are separately reviewed transitions.

## 3. Required architecture decisions before contracts are frozen

Write `docs/architecture/M2-DESIGN-DECISIONS.md` with tradeoffs and a reviewed choice for each:

1. **Escrow deployment:** immutable non-upgradeable per-milestone instance, created by a minimally privileged factory (clone vs full deployment selected by measured safety/gas). Factory only deploys and indexes; no owner withdraw, upgrade or arbitrary settlement authorization. Verify instance bytecode and immutable initializer binding; a proxy/clone is acceptable only with immutably pinned implementation and no upgrade path.
2. **Consent and funding:** client and worker must approve the **same complete immutable funding terms before funds are accepted**. Decide atomic creation+deposit versus a two-step creation/authorization sequence that cannot trap funds on missing signatures. App API key/DB approval is never fund-moving authority. EOA and ERC-1271 account behavior must be threat-modeled; avoid treating signature bytes as identification without chain-specific verification.
3. **Settlement authorization:** exact EIP-712 typed data (not M1 SHA-256 application hashes), chain ID, verifying contract, contract/terms version, escrow ID, token, immutable recipients, allocation W/C, executable validity, operation nonce, fee policy/treasury and distinct participant signatures. Cross-chain, cross-instance, cross-intent and replay attacks must fail.
4. **Arbitration:** app can choose a **pre-funding participant-accepted verifier/authority** or disable arbitration. Verifier implementation, dependencies, signer-set/threshold and any ERC-1271 mutability implications must be frozen or proven immutable in the funded escrow. Human organizational approval is not equivalent to on-chain cryptographic threshold. No PactAgent staff/operator override; lost arbiter keys use only the precommitted fallback. Record concrete signer formats and compromise/recovery threats before implementing verdict acceptance.
5. **Deadlines/liveness:** design enforceable precommitted fallback worker/client allocation at `T`, and if arbitration is enabled distinguish dispute invocation period `D` from final cutoff `T`. Prove exact before/after boundary semantics at the EVM timestamp granularity. Avoid arbitration and fallback races by specifying a single mutually exclusive terminal transition. A non-consenting arbitrator cannot lock principal forever; no admin may extend T. Disclose that chain outage, gas, token blacklist/pause and participant key loss may impair receipt despite an executable path.
6. **Token behavior:** USDC blacklist/pause/transfer failures, nonstandard ERC-20 returns, fee-on-transfer and reentrancy. Use exact received balance and token allowlist; reject unsupported behavior. Decide how a failed outbound transfer reverts without marking escrow settled. No extraneous token/native ETH withdrawal from escrow by platform operators.
7. **Fee design:** user app fees have the previously approved modes and W-based calculation; 1,000 bps maximum per party, floor integer arithmetic, client fee reserve and return of unearned prepaid fee, final conservation. Treasury address/version pinned before funding; if M2 includes fee execution, it must be part of the contract threat model and tested from day one; **do not implement B2B PactAgent billing** (M5). Any incompatible fee/custody design blocks the affected on-chain feature and requires explicit review, not a shortcut.
8. **Finality:** distinguish authorization, signature validation, transaction submission, unknown broadcast, inclusion, canonical confirmation, finalized chain evidence and reorg correction. Base L2 sequencing, L1 settlement and provider `finalized` support must be researched and documented; **never silently downgrade to `latest`**. Unavailable or inconsistent finality yields `unknown`/reconciliation rather than `paid`.

Architecture review approval is required **before immutable bytecode or API assumptions are finalized**, and specialist contract security review is required **before any release claim**. Record reviewers and evidence rather than inventing sign-off.

## 4. Work packages

### M2.1 — Design and contract threat model

- Audit current `staging` M1 interfaces, Prisma migration history (including exact-fee forward correction), existing network validators, jobs/outbox, wallet boundaries and CI.
- Produce state diagram, authority/consent matrix, asset conservation proof, all settlement branches, and invariant set.
- Define contract ABI, typed-data schema/hashes and canonical test vectors in both Solidity and TypeScript. Explicitly separate M1 application commitment SHA-256 from chain EIP-712 digest.
- Pin Solidity compiler, audited library versions and reproducible deployment settings/bytecode. OpenZeppelin `SafeERC20`, `EIP712`, `SignatureChecker`/ERC-1271 and `ReentrancyGuard` may be useful, but review their actual version/semantics; libraries are not substitutes for security analysis.

### M2.2 — Escrow and factory contracts

- Implement immutable factory and per-milestone escrow with frozen participants, original recipient addresses, token, application and commitment IDs, fee policy, fallback shares/deadlines and optional arbitral verifier. No mutable privileged route to principal.
- Implement funding with exact USDC amount accounting and verifiable both-party preauthorization; reject under/overdeposit, wrong token, duplicate fund and incompatible token behavior.
- Implement cooperative full worker payout, client refund and **arbitrary split** as one terminal settlement, requiring signatures from both original participants on the same intent; handle replay, expiry and malicious signature re-use.
- Implement optional on-chain enforceable arbitration only under prior mutual consent. Distinct arbitration outcome can allocate W and C arbitrarily but cannot redirect outside pinned original recipients/treasury. Threshold is cryptographically enforced; no off-chain verdict-only settlement.
- Implement immutable fallback executable without new approval after timeout. Enforce exclusive EVM terminal action and explicit timing. Failed transfers revert terminal transition.
- Emit indexed creation/funding/settlement/fallback/arbitration events with correlation IDs but no private evidence or secrets. Ensure events and balances reconcile.
- Apply checked integer arithmetic for uint256, token 6-decimal base units, exact floor fee division and conservation. Do not copy CKB occupied-capacity assumptions to EVM.

### M2.3 — Base adapter and identity registry

- Build Base Sepolia rail adapter implementing versioned M1 capabilities **only for verified deployed bytecode**. Unknown factory/escrow versions remain unavailable. Preserve existing CKB adapter and legacy paths.
- Verify chain ID, token, factory, escrow deployment code hashes and immutable terms against persisted deployment identity before preparing signatures or calling a contract.
- Enforce network, tenant, agreement/milestone/escrow parent scope, wallet address binding, funded-terms immutability and idempotency.
- Don't require PactAgent accounts for end users; the integrating app controls sign-in while participants explicitly sign their own chain authorization. No backend-held user private keys, seeds or unrestricted server signing.

### M2.4 — Durable transaction pipeline, observer and reconciliation

- Extend M1 operation/attempt/observation persistence through reviewed additive migrations. No retroactive relabeling of funded legacy escrow.
- Persist recoverable signed transaction/authorization artifacts in access-controlled immutable storage **before broadcast**; make job retries and worker restarts safe. Use outbox or equivalent durable publish, scoped deduplication and explicit unknown-outcome handling.
- Validate tx receipt, expected contract address, emitted event, token amounts, state transition, chain ID, block number/hash, canonical chain history and policy version. Define configured finality evidence; if missing/disagreeing mark unknown, not settled.
- Support same-tx changed-block reorg, disappearance/reappearance, duplicate logs, replaced tx, provider outage/rate limit, historical rescan and correction events. A finalized projection that becomes inconsistent must be reviewable/reconcilable; never create a second payout from retry.
- Keep supported live execution endpoints private/feature-gated until security criteria are met; no app API key can directly manufacture a paid state.

### M2.5 — API and developer integration

- Version additively under `/v2`; include authenticated initiation/preauthorization/terms lookup, signing payload retrieval, funding/settlement proposal submission and status read only for primitives actually proven and implemented.
- Define scope-separated read/write permissions, tenant isolation, per-operation idempotency keys, structured unsupported-capability errors, typed API/OpenAPI, safe webhooks with signature and replay protections.
- Expose `pending_authorization`, `funding_pending`, `funded_unfinalized`, `settlement_pending`, `unknown`, `finalized`, `reconciliation_required` truthfully; never infer finality from a submission response.
- Client/worker wallet actions should be explicit signed operations with independent identities and terms preview; UI redesign is optional, but end-to-end usage must be demonstrable via SDK/example scripts and test wallets.

### M2.6 — Local deterministic tests and optional authorized Sepolia validation

- Use Foundry/Hardhat as consistent with repo needs, pinned and reproducible; run deterministic local EVM fork/local chain plus contract unit/invariant/fuzz suite and backend integration with real local node.
- If **explicitly authorized** to use Sepolia faucet assets and deploy, verify Circle and Base facts afresh, deploy immutable test artifacts, independently inspect explorer code, execute full consent→fund→split/refund/arbitrate/fallback lifecycles and archive hashes/receipts/blocks. If signer/faucet/provider access is absent, record it as a blocking testnet gate rather than fabricating testnet execution.
- Include deployment manifest, reproducibility notes and operator recovery/roll-forward only; no mainnet deployment, production billing or `main` promotion.

## 5. Mandatory adversarial acceptance matrix

| Category | Minimum negative and positive tests |
| --- | --- |
| Consent | missing one signature, changed amount/recipient/treasury/policy, wrong signers, EOA and ERC-1271, mutable-verifier threats, expired approval |
| Replay and chain binding | duplicated nonce, same signatures in another escrow/factory/chain, wrong EIP-712 domain, reordered signers, reentrancy |
| Funding and USDC | wrong chain/token/decimals, spoofed symbol, under/overfunding, blacklist/pause, failed transfers, zero/large amounts, unauthorized native ETH |
| Settlement | complete worker pay, complete refund, arbitrary asymmetric split, all four fee modes, exact dust, uint256 limits, concurrent competing actions, terminal double spend |
| Arbitration | arbitration disabled, post-funding opt-in, invalid verifier, mutable authority, missing threshold, forged verdict, arbitrary recipient, compromised key, timeout conflict |
| Fallback | before/at/after D and T, no fresh signature required at T, overlapping verdict and fallback, no administrator extension, failed token transfer |
| Persistence | same/different idempotency key race, 2 workers one escrow, tenant and same-tenant parent mismatch, crash before/after broadcast, unknown RPC result, signed artifact recovery |
| Finality | different block hash for same tx, disappearing receipt, conflicting RPCs, unsupported finalized tag, deep reorg, replayed event, lost observer head; no false paid |
| Compatibility | old v1 API/OpenAPI/CKB byte identities, populated migrations and correction checksum, standalone npm locks, existing CI/security scans |
| Deployment | factory immutable implementation hash, contract reproducibility, emitter and token identity matching, no private keys in logs/artifacts, testnet-only manifest |

Property-based assertions: `W+C=P`; `FcDeposit=floor(P*bc/10000)`; `FcEarned=floor(W*bc/10000)`; `FwEarned=floor(W*bw/10000)`; `clientNet=P-W+FcDeposit-FcEarned`; `workerNet=W-FwEarned`; `treasuryNet=FcEarned+FwEarned`; `clientNet+workerNet+treasuryNet=P+FcDeposit`; and **exactly one successful terminal settlement**. Separate capacity/gas from escrow principal and prepaid client fee.

All relevant CI jobs must pass; test coverage must include actual EVM execution/invariants, not just host TypeScript tests. Record commands, run IDs, runtime/compiler versions, skipped cases and reproducible fixtures. No weakening protected staging or CI/audit checks.

## 6. Implementation and milestone handoff deliverables

1. `docs/architecture/M2-DESIGN-DECISIONS.md` — decision matrix, verified identities, EIP-712 schema, liveness/deadline and authority model, reviewers and open gates.
2. `docs/security/M2-THREAT-MODEL.md` — funds-flow threats, signer/ERC-1271 mutations, escalation, token pause/blacklist, factory and replay risks.
3. Solidity contracts, contract tests, deterministic deployment script and audited/pinned dependencies; ABI and bytecode/hash artifacts **without secrets**.
4. Base adapter, versioned capability registry and additive data/API contracts with full authentication and durable reconciliation where actually proven.
5. `docs/architecture/M2-IMPLEMENTATION.md` — implementation tradeoffs, architecture, compatibility and recovery, capability truth table, API/contract mapping.
6. `docs/architecture/M2-REPORT.md` — exact commit refs, tests, security findings, provider/code evidence, missing testnet evidence, migration evidence and remaining release gates.
7. Reviewable PR into protected `staging`; include **no auto-merge**, no deployment by CI, no `main` changes. PR must explicitly list unimplemented features as unsupported.

## 7. Stage gates and stop conditions

- **G0 Pre-coding design:** decide authoritative immutable authority, factory, fee/terms/fallback mechanics, signature codec and network asset identity; where unproved, continue non-financial scaffolding only and flag the affected contract work.
- **G1 Local implementation:** independent code review of the funds-moving authorization/contract code, EVM negative/fuzz tests, persistence and migration tests, staged integration CI.
- **G2 Testnet deployment:** separate explicit approval to spend **faucet-only** tokens/ETH, independently verified token and bytecode, key handling plan, deployment manifest and working finality assumptions. No personal funds/API purchases.
- **G3 Mainnet/production:** **NOT within M2**. Requires independent security audit/review and resolution of serious findings, legal/finance/operations approval, custody and incident plans, reliable provider/reorg reconciliation, live monitoring and an explicit separate release decision (M10).

If actual chain behavior contradicts an assumption, stop the affected funds-moving feature, label its capability **unavailable**, document discrepancy and request design review; do not weaken consent, insert an operator escape hatch, skip checks or silently downgrade finality. M2 completion is not by itself a mainnet launch approval.

## 8. Source references (reverify immediately before activation)

- Circle official USDC contract addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses
- Base official connection / chain parameters: https://docs.base.org/chain/connect ; https://basehub.org/integration-guides/connecting/
- OpenZeppelin contracts v5 cryptography: https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography
- OpenZeppelin contracts v5 ERC-20 safety: https://docs.openzeppelin.com/contracts/5.x/api/token/erc20
- EIP-712: https://eips.ethereum.org/EIPS/eip-712
- EIP-1271: https://eips.ethereum.org/EIPS/eip-1271
