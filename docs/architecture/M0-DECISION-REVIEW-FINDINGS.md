# M0 architecture decision review findings

Date: 2026-10-28. **PROPOSED — no policy approvals recorded; M1 remains blocked.**

Reviewed from latest `origin/staging` at `57148cd98e6f97aad2f3e68e17e5ed33ac9b83c6`, on `architecture/m0-decision-review`. The supplied [review and sign-off worksheet](../../M0_DECISION_REVIEW.md) is retained unchanged at its supplied root name. Its SHA-256 is `544ec9111d12ce66ae303b82f8964b7e2123a14dc53846db8b8724b2a4138a5c`. This report supplements it; neither document accepts a decision.

Authority remains the [M0 specification](../../M0_ARCHITECTURE_SPEC.md), accepted A01–A08 in [M0-DECISIONS](M0-DECISIONS.md), and the [M0 report](M0-REPORT.md). Existing recommendations remain unconfirmed. No register, runtime, schema, contract, skill or workflow changes are part of this review. Source line references below refer to the recorded baseline; findings are static analysis, not exploit demonstrations or contract audits.

## Disposition of the six proposals

| Proposal / existing decisions | Review disposition | Approval status |
| --- | --- | --- |
| DR-01 / D04 | Consistent only if “fallback applies” means eligible, potentially competing execution on CKB; unconditional bounded exit is not achievable | PENDING product; OPEN legal and rail security |
| DR-02 / D03, D11 | Consistent with immutable consent; a policy hash/address alone cannot freeze mutable verifier dependencies | PENDING product; OPEN identity and contract security |
| DR-03 / D05 | Equations match M0; neither 1,000 bps per party nor 2,000 combined is an approved commercial cap | PENDING product; OPEN finance/legal |
| DR-04 / D06 | App-only charging preserves A05; prefunded custody, W eligibility and reserve/reversal policy remain choices | PENDING product; OPEN finance/legal/security |
| DR-05 / D07, D04 | Preserve v1 and reject unsupported v2 features; transaction-wide attribution and code identity still need proof | PENDING product; OPEN CKB/security |
| DR-06 / D09 | Correct separation of authorization and finality; “where available” cannot permit an implicit downgrade | PENDING interface approval; OPEN engineering/security/operations |

### DR-01: fallback eligibility, expiry and liveness

[Escrow security](escrow-security.md#timeouts-arbitration-and-liveness) already distinguishes Base's proposed exclusive cutoff from CKB's lower-bound fallback. The supplied review's “exact precommitted fallback applies” is too strong if read as an exclusive CKB outcome. Proposed wording: **fallback becomes eligible at T; on CKB other valid spends may compete, and the first canonical valid spend wins**. If product requires exclusive adjudication deadlines or invocation-gated arbitration across both rails, leave CKB arbitration unsupported until a reviewed construction proves those properties.

Current v1 [evaluate_spend](../../contracts/pact-escrow-lock/src/lib.rs#L124) accepts client-authorized full payout, worker-authorized full refund, or timeout full refund. The [timeout predicate](../../contracts/pact-escrow-lock/src/lib.rs#L178) is a lower bound. Neither support-case state nor a server expiry revokes a valid transaction. Do not alter funded v1 cells to add individualized fallback.

“Bounded exit” must mean an executable authorized path under stated chain and asset assumptions, not guaranteed receipt by a deadline. Chain halt, USDC pause/blacklist, missing transaction gas or CKB capacity, lost recipient keys and unavailable fallback artifacts can prevent execution or use of proceeds. New fallback design must require no fresh signature from a lost participant and make committed terms/proofs available independently of the app. Pre-fund required capacity or explicitly disclose the remaining top-up dependency.

The [state table](escrow-security.md#unified-state-and-authority) requires revoked/expired funding authorization for cancellation, while the diagram's “expiry and funding absence proven” can be misread as sufficient. [Billing reservation release](fees-billing.md#b2b-pactagent-fee-and-collection-guarantee) has the same risk: no funding observed now does not prove later funding impossible. In particular, CKB server expiry is not an upper chain bound. Before releasing reserves, require proof of invalidation/unusable funding inputs or a separately approved liability policy. Keep uncertain commitments reserved and reconciled; do not invent cancellation authority.

### DR-02: authority must remain immutable through its dependencies

The proposed immutable authority aligns with [security terms](escrow-security.md#frozen-terms-and-signed-intents) and [identity/treasury design](identity-treasury.md). Bind policy version, enforceable authority identity and enforcement mechanism, not just a mutable Safe address or opaque hash. A proxy, replaceable module, recoverable signer contract or ERC-1271 owner change can change effective adjudicators even when the escrow's address/hash stays constant. The contract review must examine the complete verification dependency path.

Distinguish arbitral authority immutability from participant-controlled smart-wallet recovery and future treasury changes. Neither recovery permits rewriting a funded recipient. Staff rotation should affect future escrow terms; unusable arbitral keys fall back to the originally consented path. Do not select a signature library or numerical threshold in M1 by implication.

[Dispute resolution](../../server/src/modules/disputes/dispute.service.ts#L204) validates/stores allocations and emits an event; it does not supply on-chain arbitral authority. There is no basis for treating existing dispute labels as consent. Human separation of duties is an organizational/identity control; database role counts cannot establish distinct people or cryptographic signer thresholds. D11's two-person/five-minute recommendation and exceptions remain unapproved. D12's [requestedAddress fallback](../../server/src/services/authService.ts#L78) still requires negative signature-binding tests before high-risk identity use; exploitability is not asserted.

### DR-03: fee basis, bounds and amount compatibility

The [M0 equations](fees-billing.md#escrow-conservation) conserve principal plus prepaid client fee using integer floor arithmetic. Keep four independent fee modes and one terminal settlement per milestone. The phrase “until the product/commercial owner approves otherwise” must not activate a default: recommended replacement is **proposed ceilings only; no commercial cap is approved or shipped by this review**. At 1,000 bps each, the 2,000 combined ceiling is redundant mathematically but useful in disclosure. It is a maximum on W-based charges, not a universal percentage of client deposit or worker net receipt.

Current [amount invariants](../../server/src/common/amounts/financial-invariants.ts#L12) use u64-bounded values, require escrow amount to match its scope and require split totals to equal the funded settlement amount. [Escrow persistence](../../server/prisma/schema.prisma#L227) does not represent the proposed separate principal, prepaid client fee, capacity and billing balances. Do not reinterpret legacy `amount` or charge legacy escrows retroactively. M1 needs distinct amount types/fields and algorithm versions; later implementation must check intermediates, deposits and output sums against each rail's bounds, not merely check P before multiplication. Base uint256 capacity does not remove API or CKB limits.

### DR-04: billing is a separate financial obligation

Application-only payment is already A05. W-based eligibility, prefunded USDC accounts and custody/provider design remain D06 proposals. Reconcile “rate frozen at initiation” with the [M0 reservation rule](fees-billing.md#b2b-pactagent-fee-and-collection-guarantee): define one immutable rate/reservation point before funding authorization, with changed terms requiring renewed consent and a valid reservation. Never block a valid existing settlement because the app cannot pay.

A balanced journal does not prove backing or solvency. Define deposit ownership, custody controller, withdrawal/redemption rights, reconciliation and insolvency treatment before M5. Reorg after capture/release can require re-reservation after the app has spent released credits; the ledger must represent the deficit/receivable and freeze new exposure, not fabricate available backing. Funding-expiry uncertainty from DR-01 also applies here.

A maximum USDC reserve cannot cover an unbounded future CKB/USD price. Keep cross-currency billing disabled until independent sources, observation time, staleness/divergence, cap, outage and exposure rules are approved. Optional swaps are not a billing oracle. No provider, price feed, vault, legal acceptance or production collection guarantee exists merely because interfaces describe one.

### DR-05: v1 isolation, capacity and transaction attribution

V1's [contract entry point](../../contracts/pact-escrow-lock/src/main.rs#L38) restricts `GroupInput`, not all escrow inputs across a transaction. Its [output predicate](../../contracts/pact-escrow-lock/src/lib.rs#L161) matches lock hash and capacity; the collected output model does not enforce the proposed v2 output type/data rules. Multi-group output reuse needs adversarial full-VM transactions; static inspection alone is not proof of an exploitable spend.

The [builder](../../server/src/rails/ckb/transaction-builder.ts#L98) exposes release/refund, not dual-signature split/arbitration. A valid arbitrary arithmetic split may still be impossible as CKB outputs unless each occupied-capacity minimum is met. Specify reserve ownership and zero/dust allocation behavior without confiscating principal; required top-ups affect fallback liveness.

The [network configuration](../../server/src/rails/ckb/network-config.ts#L33) currently selects version 1 globally. Future routing must use each funded escrow's pinned deployment identity and original bytes, not relabel old records or switch them globally. “Distinct code identity” also needs a reviewed hash/dependency policy: a type-hash reference to replaceable code is not automatically immutable. D07 recommends one escrow input transaction-wide initially; retaining that restriction versus proving safe batching is an explicit technical choice, not a relaxation implied by the review. Canonical binary intent/witness vectors, wallet compatibility and VM evidence remain pre-M8 gates.

### DR-06: canonical observation and finality cannot be guessed

The [CKB observer](../../server/src/rails/ckb/reconciliation.ts#L20) derives depth and returns block identity, but depth alone does not establish the proposed historical canonicality checks. [Service reconciliation](../../server/src/modules/escrows/escrow.service.ts#L1123) observes status and separately verifies funding/settlement, allowing observations from different chain snapshots. It recognizes reorg when a formerly confirmed transaction is no longer committed/confirmed; a changed block hash while still committed does not trigger that branch. [Monitoring](../../server/src/modules/escrows/escrow.service.ts#L1280) stops at configured confirmations plus 20, rather than proving ongoing historical canonicality.

Proposed interfaces should bind evidence to a consistent block/head observation, retain prior block identity, version finality policy and support correction/reconciliation even after a settled projection. CKB depth is a risk policy, not irreversible finality. For Base, “finalized where available” means unavailable/stale/disagreeing providers leave finality unknown; it must not silently fall back to latest block or arbitrary depth. Keep authorization, broadcast and chain observation as separate axes. Do not select numerical thresholds, provider quorum or sweep intervals as part of M1 interface approval.

## M1 approval boundary and later gates

The [current proposed capability union](system-design.md#module-contracts) lists fund/release/refund/split/arbitrate, which cannot express the timing differences above. **Proposed M1 refinement:** a versioned, discriminated capability descriptor for chain-enforced expiry, exclusive cutoff, dispute invocation gating, fallback competition and authorization scheme; unsupported by default. Keep signed-term policy version/hash, deployment/asset identity, distinct monetary components, reserve liability state and finality evidence/version explicit. Do not encode an unsupported uniform `validUntil` guarantee. This is an interface recommendation, not code or an approved schema.

Before authorizing M1, product must accept or replace all seven rows in the supplied sign-off worksheet, and a technical reviewer must confirm the interface shape does not promise unproven chain behavior. Record named reviewers, date, exact accepted policy/version and any replacement text. No approval is inferred from CI, this PR or eventual merge.

| Gate | Required approval/evidence | Timing |
| --- | --- | --- |
| D01/D08 | Modular monolith/jobs/outbox and additive v2 compatibility; tenant-scoped versioned operations/events | Before M1 |
| DR-01–DR-06 | Product policy/interface choices plus technical capability review; all PENDING/OPEN | Before M1 |
| D02 and Base consent | Factory/instance design, signer-bound end-user authorization, fee/arbiter commitments and deadline proof | Before M2 implementation |
| D11/D12 | Independent human approvals, step-up/recovery rules and demonstrated login identity binding | Before M3/M4 high-risk use |
| DR-03/DR-04 | Approved caps, disclosures, custody/redemption, backing, provider and pricing/exposure rules | Before M5 activation |
| D10 | Evidence privacy, retention, legal hold and regional storage decisions | Before M6 real uploads |
| DR-02/DR-05 | Immutable verifier, CKB layout/witness, capacity and race tests; v1 compatibility | Before M8 implementation/enablement |
| DR-06 | Testnet thresholds/provider assumptions for M2/M8; measured production policy and independent security review | Before M10 launch |

These supplement the [milestone contracts](milestone-contracts.md), not reorder them. M2 must commit safe fee/arbiter/consent primitives before later M5/M7 console workflows use them; UI delivery cannot retroactively add authority to funded contracts. BTC M11 and swaps M12 remain deferred; Perun/Fiber readiness is not assumed. Product approval cannot close qualified security, legal or finance gates.

## Proposed register edits after explicit sign-off only

Do not apply these edits now. Preserve A01–A08 and rejected designs. For each accepted replacement, record approver/date/scope and distinguish approved interface policy from unresolved implementation.

| Register row | Concrete proposed clarification |
| --- | --- |
| D01/D08 | Record accepted modular monolith/outbox and additive v2 policy; link technical capability review and legacy compatibility plan |
| D03/D11 | Require immutable enforcement dependencies, distinguish human quorum from key threshold, retain threshold/recovery approvals as OPEN |
| D04 | Say CKB fallback is eligible and competes; qualify liveness assumptions and prohibit reserve release on server expiry alone |
| D05 | Replace “initial cap” with “proposed cap pending explicit commercial approval” until an actual ceiling is approved; retain W equations |
| D06 | Define rate freeze/reservation point, provable liability expiry, reorg deficit handling and explicit custody/pricing gates |
| D07 | Require pinned deployment routing, transaction-wide attribution, capacity ownership and verified code identity; retain VM gate |
| D09 | Forbid silent downgrade when finalized evidence is unavailable; require consistent observation, same-tx block-change handling and historical sweeps |

Separately flag the register's historical statement that the “current deploy workflow is VPS Docker Compose/SSH”: current staging uses Kubernetes. [Staging workflow documentation](../operations/staging-workflow.md) records that restoration. A later evidence-only correction should date the old observation and link the current workflow; it must not be presented as a new architecture decision. Historical [financial rounding](financial-rounding.md) is likewise not an approved current cross-currency pricing model.

## Repository controls and validation

Read-only GitHub inspection on 2026-10-28 found no effective rules for staging (`GET rules/branches/staging`: empty), and classic branch protection returned 404 “Branch not protected.” This does not block opening the requested PR, but PR review/check enforcement is currently a governance gap. Recommend a separately authorized staging rule requiring reviews and the intended checks, with direct pushes restricted. No settings or bypasses were changed.

[CI](../../.github/workflows/ci.yml) runs for all PRs and pushes to staging/main, including secret scanning, workspace/security policy, server/migrations, web, Rust host tests and container scans. [Staging deployment workflow](../../.github/workflows/deploy.yml) is manual-only, restricts staging to its ref and production to main plus explicit input. It still needs real environment credentials/resources; none were supplied or provisioned here. The production branch's existing workflow is not rewritten by this PR. No Actions deployment is dispatched. Existing external integrations may create preview deployments when a branch is pushed; that is not authorization for production promotion.

Local validation results:

- `npm run controls:check`: PASS, 27 controls and evidence paths.
- `npm run deploy:check`: PASS, 10 Kubernetes resources and 2 smoke-validator tests; no cluster contacted or deployed.
- `npm run observability:check`: PASS, collector pipelines, 12 alerts and 6 dashboards.
- `npm run phase7:check`: PASS, 3 load profiles, 12 pagination repositories, 5 exercises and query-plan configuration.
- Documentation checks: PASS for 7 Markdown files, 52 local links/anchors/source line bounds, table widths, fenced blocks, seven pending sign-off rows, three skill frontmatters/AGENTS routing and unchanged proposal hash/register. `git diff --cached --check` flags only three intentional two-space Markdown line breaks in the unchanged supplied proposal (lines 3–5); authored files pass the whitespace check.
- Fee equation check: 400 representative zero/full/partial allocation and fee combinations, small-unit rounding and large integer arithmetic checked independently for conservation; not a runtime/contract test or bounds proof.

Full application suites, live chain/VM adversarial tests, custody/legal reviews and production readiness are not established by these documentation/static checks. Remote PR checks are reported separately in the handoff; no green result is presumed. The PR must remain open and unmerged. M1 requires explicit policy acceptance/replacements, technical interface sign-off and a subsequent authorized implementation task.
