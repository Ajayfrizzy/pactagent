# PactAgent — M0 Architecture Decision Review

**Date:** 2026-10-27  
**Status:** Proposed decisions for review; **not yet approved**  
**Target:** `staging` via a dedicated documentation-only PR  
**Baseline:** `docs/architecture/M0-DECISIONS.md`, `M0-REPORT.md`, `escrow-security.md`, `fees-billing.md`, `identity-treasury.md`, and `M0_ARCHITECTURE_SPEC.md` on staging. Existing M0 decisions A01–A08 remain binding. Where this review differs, resolve explicitly; do not silently rewrite accepted requirements.

## Purpose

Close or explicitly gate the six unresolved areas identified in the M0 handoff. Make the interface-affecting choices required for M1 without mistaking a proposed security design for completed engineering, legal approval, or production readiness. Codex must audit current documentation, record approvals accurately, and **not** begin M1 under this task.

## Decision register — proposed outcomes

### DR-01. Settlement deadlock and fallback (M0 D04)

**Recommendation:** Every *new-version* funded agreement requires a deterministic, fully disclosed fallback allocation and enforceable timeout commitment agreed to by both client and worker **before funding**. A case filed with Dispute Assistance cannot freeze or redistribute funds. If neither party accepts a mutual split and valid pre-consented arbitration is unavailable or fails by the deadline, the exact precommitted fallback applies. The default allocation must **not** be assumed to be 100% refund or 50/50. Application defines permitted fallback options and users agree to the specific outcome. Avoid arbitrary platform-selected percentages.

**Chain variance:** Base design may implement exclusive time windows for mutual settlement, dispute invocation, verdict, and fallback. CKB `since` is a lower bound; the M0 CKB proposal cannot enforce exclusive upper deadlines merely by server timestamps. Until proven otherwise, represent CKB v2 arbitration and cutoff capability distinctly; do **not** promise equivalence to Base. Pre-existing CKB v1 escrow terms remain unchanged.

**Approval required:** Product owner approves enforceable pre-agreed fallback plus chain-specific disclosure; legal/security reviews consent language, timing and CKB limitations. **M1 gate:** approve the policy shape, not deployment-specific timeout values.

**Tests required later:** Deadlock, client/worker key loss, support case opened near timeout, boundary timestamps, competing CKB spends, confirmed fallback and reorg, no mutable fallback after funding.

### DR-02. Arbitration authority, quorum and recovery (M0 D03, D07, D11)

**Recommendation:** Both parties must consent to arbitration terms before funding. Bind the adjudication authority to immutable per-escrow policy (verifier/approved signer set/threshold or other cryptographically immutable arrangement). Role-based app staff permissions govern *who can propose or approve verdicts in the console*, but **do not substitute for on-chain signature thresholds**. Multiple roles belonging to one person never count as multiple unique human approvers. Do not rely on an arbitrary, subsequently mutable Safe ownership list as the sole authority commitment.

**Recovery:** Rotation affects **future escrows by default**; no post-funding admin substitution of signers, recipients, or thresholds. Lost arbitral keys cannot grant unilateral owner/operator recovery. If the committed arbitration path becomes unusable, the agreed chain-enforceable fallback remains the liveness mechanism, subject to actual chain capabilities. Any exceptional recovery mechanism would require a separately specified, auditable, pre-consented on-chain rule.

**Approval required:** Product/security approve immutable authority and no administrative override; contract/security owners choose audited cryptographic mechanism before Base/CKB implementation. Threshold and small-team exception rules require later explicit policy approval. **M1 gate:** interface supports immutable policy version/hash, authority identity and capability flags; do not falsely imply a final signer mechanism has been selected.

**Tests required later:** Forged app verdict, compromised owner, signer replacement, two roles on one account, wallet recovery, malicious arbitrator attempting alternate recipient, authorization replay.

### DR-03. Application fee ceilings and conservation (M0 D05)

**Recommendation:** Preserve all four modes: no fee, client-only, worker-only, or both with independent percentages. Use basis points, versioned rates frozen before funding, integer arithmetic, and one terminal settlement per milestone in the initial v2. Calculate app fees only on principal allocated to worker `W`, with refund of unused prepaid client fee; use the exact equations in `docs/architecture/fees-billing.md`.

**Provisional guardrail:** Cap each party at 1,000 bps (10%) and combined at 2,000 bps (20%) **until the product/commercial owner approves otherwise**. This is a proposed maximum, not a universally mandated fee and not a PactAgent fee. Limits must be checked before funding. Product/finance/legal must evaluate consumer disclosure and jurisdiction-specific requirements before production.

**Approval required:** Product owner confirms fee basis and whether proposed caps are acceptable; finance/legal validates disclosure. **M1 gate:** agree to the fields, arithmetic and versioning; hard-coded commercial cap is not to be shipped as approved absent sign-off.

**Tests required later:** Both-party different percentages, zero fee, full refund, arbitrary split, small-unit rounding, overflow, dust conservation, retry/reorg.

### DR-04. PactAgent billing custody, pricing and exposure (M0 D06)

**Recommendation:** PactAgent's infrastructure fee is owed **only by the integrating application**, never withdrawn from client/worker escrow or deducted from the application's user-fee proceeds automatically. Its negotiated rate is frozen at escrow initiation; earned charge is based on finalized eligible **worker principal W**. Start with a USDC-denominated, separately backed prefunded application billing account with real deposit verification, double-entry ledger, maximum-fee reservation for new escrows, capture only after final settlement, refund/release where appropriate, and explicit reconciliation/reversal handling. Insufficient balance blocks *new* funding commitments, never authorized settlement or refund of existing escrow.

**Custody caveat:** A billing vault or payment provider managing the **app's prefunded business billing money** is distinct from custody of end-user escrow, but still creates operational, legal and insolvency obligations; determine who controls that money and withdrawal rights before implementing M5. No fictional ledger credits or uncontrolled server hot wallets.

**CKB cross-currency caveat:** No assumed live CKB/USD price source. Do not enable CKB-to-USDC infrastructure billing until independent oracle sourcing, observation time, staleness, conversion policy, quote cap or risk exposure, and dispute/reorg behavior are approved. Alternative CKB-denominated application billing may be separately specified. Future optional USDC↔CKB swaps must not be silently used as the billing pricing oracle.

**Approval required:** Product owner approves application-only charging and eligible-volume definition; finance/security/legal approves account backing/custody/redemption and pricing. **M1 gate:** model *interfaces*, not implementation of a production billing provider.

**Tests required later:** Duplicate capture, concurrency, deposit verification, insolvency/withdrawals, full refunds, partial split, chain reorgs, exchange-rate gaps and billing outage.

### DR-05. CKB timeouts and v1/v2 compatibility (M0 D07, D04)

**Recommendation:** Preserve currently funded CKB v1 contracts and their original constraints; deploy any redesigned v2 script under a distinct version/code identity. Define explicit capacity ownership/top-up, output attribution across the **entire transaction**, authorized spends and a canonical signed-intent serialization. Do not claim the existing v1 contract supports dual-signature split settlements or arbitration. Do not treat a `since` lower bound as an upper time limit. Until chain VM tests prove an exclusive arbitration cutoff, do not expose such a guarantee for CKB v2; mark that capability unsupported and gate CKB arbitration if cross-rail semantics are indispensable.

**Approval required:** Product owner accepts rail-specific available capabilities and truthful disclosures; CKB/security approves lock/witness protocol, fallback competition semantics and capacity calculations before M8. **M1 gate:** capability-based rail API and backward compatibility; no script changes now.

**Tests required later:** Adversarial extra outputs, multiple inputs/groups, fee capacity, since boundary, reorg, spending race, signed serialization vectors and v1 non-regression.

### DR-06. Confirmation, reorg and finality policies (M0 D09)

**Recommendation:** Model statuses separately for broadcast/pending, canonical confirmations, settlement authorization, and finalized payment. Use the chain as source of truth for the actual transfer. Only emit final `settled` semantics and collect PactAgent fees after configured chain-specific finality conditions. Base testnet should support `finalized` receipt/block verification where available; CKB requires depth plus canonical block hash consistency checks, reorg reversal handling and periodic deep-history sweep. Treat provider outages and replaced transactions as uncertain, not failed/settled by guess.

**Approval required:** Engineering/security/operations choose exact testnet thresholds, provider assumptions, sweep interval and exception handling; production thresholds need empirical review and M10 signoff. **M1 gate:** finality policy abstraction and pending/reconciliation statuses, not invented block-count constants.

**Tests required later:** Same transaction in a different block, deep reorg, missed RPC observation, duplicate logs, replaced nonce/spend, stale head, billing reversal.

## Cross-cutting M1 interface approvals (existing D01, D08; D02 deferred)

- **D01:** Recommend modular monolith with strict rail capability boundaries and durable jobs/outbox. Avoid premature microservices.
- **D08:** Recommend additive versioned `/v2` semantics and safe v1 compatibility; no reinterpreting previously committed financial terms.
- **D02:** Per-milestone immutable Base escrows with a reviewed factory is recommended but concrete contract architecture must receive security approval before M2; do not imply audit complete.
- **Identity/consent prerequisite:** The integrating app authenticates end users, while independent verifiable authorization must bind those users to on-chain funding and settlement actions. API-key identity or login assertion alone is insufficient. Detail the signature/delegation options before M2.
- **Native BTC and swaps:** Still scheduled after first USDC/CKB foundation; neither blocks M1. Perun/Fiber production readiness is not presumed.

## Explicit sign-off worksheet

Codex must present these as **proposed** unless the product owner actually authorizes them; a generated document, CI pass or PR merge is not itself policy approval.

| Decision | Product recommendation | Product approval | Specialized review / implementation gate |
| --- | --- | --- | --- |
| DR-01 fallback | Precommitted individualized allocation; no universal auto-refund | PENDING | Legal, Base contract security, CKB capability |
| DR-02 arbitration | Immutable pre-consented authority; no administrative takeover | PENDING | Contract security, signer threshold and recovery |
| DR-03 app fees | W-based, independent bps, provisional 10% each cap | PENDING | Finance/legal cap/disclosure; M5 |
| DR-04 PactAgent billing | Separate prefunded app USDC credits, W-based fees | PENDING | Finance/legal custody, provider, pricing; M5 |
| DR-05 CKB compatibility | Preserve v1; disclose v2 limitations; no fabricated cutoff | PENDING | CKB VM/security tests; M8 |
| DR-06 finality | Pending vs canonical final; chain-specific policies | PENDING | Operations/security thresholds; M2/M8/M10 |
| D01/D08 interfaces | Modular monolith; additive v2 API | PENDING | Architecture/API review; **M1** |

**Authority rule:** The product owner may approve product policies; only qualified technical reviewers can close security/implementation findings and qualified legal/finance reviewers can close their respective gates. If those reviewers are unavailable, mark the risk/gate OPEN, not APPROVED. Project owner sign-off cannot replace independent contract security review.

## Codex execution boundaries for this review

1. Start from current `origin/staging` and follow `AGENTS.md` plus applicable `.agents/skills`; record exact baseline commit and existing related decisions.
2. Create `architecture/m0-decision-review` from staging. Import this file into `docs/architecture/M0-DECISION-REVIEW.md` (or keep its agreed repository name). Check every proposal against current staging docs; report contradictions, practical impossibilities and missing decisions. Do not silently approve.
3. Produce an evidence-linked short review report identifying (a) interface choices required before M1, (b) later milestone gates, (c) concrete recommended edits to `M0-DECISIONS.md` **only after product sign-off**. May add a draft ADR/decision worksheet but preserve authoritative unapproved status.
4. Review existing CI, staging branch controls and docs links. Run applicable documentation/metadata/static checks and report any failures; do not bypass controls.
5. Commit and push documentation-only changes. Open PR targeting **staging**, not `main`. Do **not** merge this PR automatically; return review results and product sign-off requests.
6. Do not write application code, change schema/contracts, deploy, manage secrets, merge into main, or begin M1. No mainnet authorization.

## Completion / authorization

This review is complete when proposals and remaining technical/legal/finance gates are transparent and the proposed documents are reviewed. **M1 can be authorized only after** the product owner explicitly accepts or replaces the DR-01–DR-06 policy/interface choices and D01/D08, and the technical reviewer confirms M1 interfaces do not incorrectly encode unproven chain behavior. Later milestone implementation gates may remain open if recorded and isolated. Production security approval remains a distinct later process.
