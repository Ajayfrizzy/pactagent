# PactAgent — M0 Product-Level Decision Approval

**Date:** 2026-10-31  
**Status:** Product-direction approval requested/confirmed through the owner's instruction to proceed with the previously proposed defaults; **technical, financial, legal and production gates remain OPEN**. Codex must not assert independent specialist sign-off.  
**Applies to:** M1 interfaces and future designs only, not migration of existing funded escrow commitments.  
**Source:** `docs/architecture/M0-DECISIONS.md`, `M0_DECISION_REVIEW.md`, `docs/architecture/M0-DECISION-REVIEW-FINDINGS.md`.

## Product policy decisions — approval scope

| Decision | Product-direction policy for M1 | Unresolved implementation/security gate |
| --- | --- | --- |
| DR-01 / D04 | Every new v2 funded escrow has explicit, immutable, both-party-approved fallback allocation and its enforceable timing. No universal automatic refund or 50/50 rule. Base may implement exclusive deadlines; CKB fallback **becomes eligible** at the timeout but can compete with previously valid spends. Dispute Assistance has no ability to suspend chain rules. | Legal consent/disclosure; chain-specific proof of liveness and deadline enforcement; no release of reserved billing based only on server expiry. |
| DR-02 / D03 | Both parties pre-consent to an immutable, enforceable per-escrow arbitration authority and verification **dependencies**, not merely a mutable wallet address. Staff RBAC and human quorum are separate from actual chain signer thresholds. No admin override of funded terms. | Arbiter verifier design, approved signers/thresholds, recovery, contract audit and smart-wallet mutability assessment before M2/M8. |
| DR-03 / D05 | Four fee modes (zero, client, worker, both); independent basis-point rates; fee earned only against worker-allocated principal W; return unearned prepaid client fee; integer rounding and conservation; one terminal allocation per milestone. **Adopt 1,000 bps (10%) maximum per party and 2,000 bps (20%) combined as initial product guardrails**, changeable only by new explicitly approved versioned policy. | Finance/legal sign-off and user fee disclosure before M5 activation. No fee collection implementation in M1. |
| DR-04 / D06 | PactAgent charges **only integrating applications**, on finalized eligible worker principal W, under a frozen rate/version. Prefunded, independently backed USDC application billing credits, reservations before new funding, finality-based capture and reorg corrections. Existing funded escrow payout cannot be blocked by an app billing shortfall. | Billing custody/controller, withdrawals, legal obligations, insolvency/reorg deficit, independent deposits and cross-currency oracle/price cap before M5. No CKB→USDC billing without approval. |
| DR-05 / D07 | Preserve CKB v1 as-is; separately version CKB v2. Expose proven capabilities only. CKB output attribution must be transaction-wide, with explicit capacity/top-up ownership. No claim of exclusive upper cutoff absent cryptographic proof. | Script/witness format, hash/deployment pinning, VM tests, capacity mathematics, compatible signers and external security review before M8. |
| DR-06 / D09 | Separate authorization, broadcast, observed confirmation and final settlement. Base requires valid canonical finality evidence; CKB uses configurable depth plus canonical block-hash verification and historical reconciliation. No silent fallback to a weaker policy when finality is uncertain. | Exact thresholds, provider policy, sweep cadence, reorg drills and operational risk thresholds before testnet/production milestones. |
| D01 / D08 | Keep modular monolith with durable outbox/jobs and capability-discriminated rail boundaries. Introduce additive, versioned `/v2` API while preserving `/v1` semantics and historical escrow identities. | Engineering interface review and compatibility tests before M1 code is accepted. |

## Cross-cutting binding constraints

1. No PactAgent or application operator has unrestricted escrow withdrawal. Neither an API key nor a dispute record is sufficient settlement consent.
2. Applications handle customer sign-in, but cryptographically verifiable participant authorization is required for financial actions.
3. Terms hash/version binds chain, asset, amount components, recipients, treasury version, fee policy, arbitration and fallback **before funding**; future changes cannot rewrite existing funded escrows.
4. Multi-role RBAC counts one distinct person only once for human approval; never substitute that count for on-chain signature thresholds.
5. BTC and CKB↔USDC swaps are deferred and cannot block Base USDC progress.
6. Security, privacy, specialist finance/legal, testnet, mainnet and deployment gates remain **OPEN** unless independently evidenced and approved.
7. If an interface exposes a chain property that has not been proven, model it as unsupported; never substitute a misleading boolean or server timestamp.

## Evidence and sign-off record

- **Product owner:** Repository owner, accepting the proposed direction to move forward in the conversation dated 2026-10-31. Codex should record this as **product-direction acceptance only**, not claim a cryptographic signature or independent legal/technical attestation.
- **Engineering reviewer:** OPEN — must review the concrete M1 capability/terms interfaces and verify unsupported chain semantics are not encoded as guarantees.
- **Legal/finance/security/operations:** OPEN — milestone-specific gates above.
- **Release authorization:** NOT GRANTED; no mainnet, production, contract deployment or application fee collection.

## Required repository handling

Codex should add this document to `docs/architecture/M0-PRODUCT-APPROVAL.md` on an M1 feature branch, link it from the decision register and docs index, and update decision labels without erasing the original proposals or historical reviews. If Codex identifies a material conflict or a recommendation that requires a different product choice, stop **that affected part** and report the conflict; continue independent safe work. Do not claim specialized approvals. The intent to proceed authorizes **M1-scoped implementation work only**, subject to documented engineering interface sign-off before merging its PR.
