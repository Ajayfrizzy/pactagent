# M14 — CKB on-chain records, verification and capacity recycling

Status: **product scope approved 2026-11-09; milestone is not implemented or scheduled for immediate execution**. Dedicated milestone separate from **M8 CKB v2 escrow**. This design is for PactAgent infrastructure supporting all integrating applications, not for uploading every created job.

## Precisely four additional on-chain record categories

| Category | On-chain minimum | Off-chain source |
| --- | --- | --- |
| Agreement commitment | Domain-separated/versioned commitment to finalized agreement terms and record identity | Complete agreement, revisions, private parties and documents |
| Milestone commitment | Domain-separated/versioned commitment to agreed milestone conditions | Complete milestones, description, progress and evidence |
| Dispute resolution commitment | Commitment to final decision/authorized allocation and linked escrow/settlement evidence; **does not authorize a spend by itself** | Statements, documents, case chronology and decision detail |
| Audit verification | Batched Merkle root/commitment of selected significant financial and internal administrative events, with verifiable inclusion proofs | Immutable detailed audit journal and proofs |

**Escrow is not a fifth additional storage feature.** Its enforceable on-chain cell is already required by CKB payments and belongs to M8. Where safe, agreement/milestone commitments may be embedded within existing escrow terms instead of creating extra record cells. No one-cell-per-job, per-message, per-update, per-file or per-support-ticket pattern. Raw private/identifying data, uploaded documents, customer support content and secrets never go into public cell data. A hash alone proves commitment to bytes, not the parties' consent or truth of a disputed claim; consent/authorization remains separately verified.

## Financial responsibility

**PactAgent bears incremental CKB cell capacity and on-chain transaction costs for its four optional/required record-attestation categories**, using a PactAgent-controlled budget/capacity pool. Integrating applications are responsible for **CKB payment execution network fees and required escrow cell capacity**, per their agreed application payment-flow cost allocation; PactAgent must not transfer those fees to itself through undocumented deductions. Do not conflate record-attestation funding with escrow principal, app fees or PactAgent B2B fees.

This is an explicit **exception** to earlier no-PactAgent-subsidy assumptions for CKB swaps/payment rails: PactAgent *does* fund its own attestation infrastructure. PactAgent still does not subsidize swaps, participant payment network fees or escrow occupied capacity. Implement operational budgets/caps, per-app rate limits, batching, monitoring, treasury governance and pause controls so PactAgent-owned costs cannot grow unbounded. No new paid infrastructure without approved funding; use free/testnet tools or available resources during development.

## Cell lifecycle and recycling

A **consumed cell is never reused as the same outpoint**. Its locked CKB capacity can instead be directed through the authorized transaction into new live outputs, subject to the lock/type script, output minimums and transaction fees. Design PactAgent-owned record cells so permitted spend paths can recover/recycle their occupied capacity after the applicable agreement/record has been finalized. Record cell ownership and custody must be unambiguous, and expenditure of PactAgent's own record pool is subject to internal financial safeguards. Consumed records remain in historical chain data where retrievable; do not claim blockchain deletion or infinite archival availability from every node.

Proposed path: active agreement commitment cell -> authorized closure/replacement -> consume -> release recoverable PactAgent-owned capacity -> reuse released CKB to fund a new agreement record cell. Explicitly test concurrency, spent-outpoint detection, script constraints, capacity top-ups, minimum cell capacity, partial unrecoverable/stranded capacity, transaction fees and interrupted batch creation. Track pool inventory/reserves and compare actual chain UTXOs to ledger. Agreement settlement **in another chain** does not itself consume its corresponding CKB record; M14 must define how cross-chain closure is authenticated without allowing a forged off-chain status to free/rewrite commitments.

Prefer in-escrow commitments or batched audit roots when standalone live cells add no independent state/security value. Detached audit commitments require exact historical verification data: anchoring transaction ID, script/data location, source events, canonical encoding and proof verification. Witness-only bytes must not be represented as enforceable state unless scripts actually bind them.

## Work packages and acceptance

- **M14.1** Record/cost classification, privacy/security threat model, cost inventory and budget.
- **M14.2** Versioned canonical commitments with network/application domains, stable privacy-preserving IDs, optional salting and cross-language hash test vectors.
- **M14.3** Agreement/milestone commitment binding to M8 escrow where appropriate, plus reviewed independent record cells only where justified.
- **M14.4** Dispute outcome commitment and evidence linkage without independent fund-spend authority.
- **M14.5** Batched audit Merkle roots, inclusion proofs, canonical anchors, reorg correction and historical indexing.
- **M14.6** Record-cell spend paths, capacity-recycling inventory, budget/fee accounting, multi-transaction concurrency and incident recovery.
- **M14.7** Authenticated integrating-app APIs and independent verification with explicit pending/committed/canonical/reorged states.
- **M14.8** Full transaction-level CKB-VM/adversarial security tests, historical-chain retrieval, testnet verification and separate launch/security approval.

Dependencies: M1 asset/identity discipline; M8 for escrow-bound work; M3/M4 internal finance/treasury controls for administering PactAgent-owned capacity. Work may be designed in parallel, but do not block native Base/BTC payout on optional CKB attestations, and do not claim CKB proof of finality for foreign-chain settlement merely from an anchor.

**Release gates:** signed ownership and recovery policy, audited script/output conservation, cost limits, chain indexing and provider failure recovery, privacy review, testnet evidence and independent security assessment. This document changes no scripts, schemas, deployment state or production resources.
