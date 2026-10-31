# M0 decision register

Date: 2026-10-27. Accepted means mandated by the [authoritative specification](../../M0_ARCHITECTURE_SPEC.md), not a newly obtained stakeholder approval. Recommended choices below remain unconfirmed. Implementers must not silently treat these as commercial or security sign-off.

## Current approval status — 2026-10-31

The repository owner has accepted **product direction only** for D01, D03–D09 through the supplied [M0 product approval](M0-PRODUCT-APPROVAL.md). This includes 1,000 bps per party and 2,000 combined, W-based fees, individualized immutable fallback (eligible/competing on CKB), immutable arbitration verification dependencies, separate application billing and no finality downgrade. Historical proposals below are retained for traceability; their “unconfirmed” labels describe the original M0 review, not the current product approval.

M1 development is authorized by [M1 scope](../../M1_MULTI_CHAIN_FOUNDATION_SPEC.md). Engineering interface acceptance before merge remains **OPEN**; D02, D10–D12 and specialized security, finance, legal, operations and release gates remain **OPEN**. See [implementation and deviations](M1-IMPLEMENTATION.md). Neither approval nor code activates Base, CKB v2, fee collection or mainnet.

## Accepted boundaries

| ID | Decision | Rationale and implication |
| --- | --- | --- |
| A01 | Noncustodial contract/script-constrained escrow; original recipients committed before funding | Operators, owners and arbitrators have no arbitrary principal withdrawal |
| A02 | Keep CKB; add native USDC on Base with Sepolia first | Separate adapters/contracts; BTC and swaps do not gate USDC |
| A03 | Apps own customer authentication; PactAgent owns console and app authorization | App assertion/API key is insufficient for funds consent |
| A04 | Multi-role additive RBAC with explicit separation of duties; one person counts once | App owner does not bypass on-chain authority |
| A05 | Independent client/worker app fees; independent application-paid infrastructure fee | Frozen user fee terms and preverified treasury; no B2B collection from escrow |
| A06 | Mutual refund, payout and arbitrary split; optional application-controlled arbitration | Both parties approve same mutual terms; arbitration requires pre-funding enforceable consent |
| A07 | Verdict and confirmation are separate; testnet-first and explicit launch gates | Chain observation, replay safety and reconciliation are required |
| A08 | M0 only docs/instructions; no merge, deploy or M1 | Dedicated branch, preserved runtime/schema/contracts/infrastructure |

## Recommended, unconfirmed design choices

| ID | Question / recommended default | Tradeoff / required decision owner | Deadline |
| --- | --- | --- | --- |
| D01 | Retain modular monolith and durable DB outbox/jobs, extend capability-based rails | Avoid service churn; isolates logical contracts rather than processes. Architecture lead | Before M1 |
| D02 | Per-milestone immutable Base instances from reviewed factory; no upgradeable principal custody | More gas than pool, smaller shared-accounting risk. Contract/security lead | Before M2 contract implementation |
| D03 | Immutable escrow-bound arbiter verifier/set/threshold, not mutable Safe address alone; separate person quorum and key threshold | Snapshot authority complicates staff recovery; protects consent from owner changes. Security + product | Approve primitive before M1 interfaces; concrete verifier before M2/M8 |
| D04 | Fixed pre-agreed fallback allocation at T; no-consent mutual-only before T; Base arbitration invoked before D and ends at T; CKB lower-bound fallback competes with other valid spends unless a stronger protocol is reviewed; no post-funding opt-in | Bounded exit may be unfair to one party; explicit disclosure essential. Product + legal + contract/security | Before M1 terms/state API freezes; durations before funding tests |
| D05 | App fees earned on W, floor bps; refund unused client fee; initial cap 10% each/20% combined; one terminal split per milestone | Simpler conservation; app commercial alternatives require separate reviewed algorithm. Product/finance | Before M1 amount/terms interfaces; rate cap confirmation by M5 |
| D06 | B2B eligible volume W, prepaid separate app credit, maximum reserve and final capture; USDC first; disable cross-currency CKB billing until capped pricing approved | Protects collection without touching escrow; custody, providers, prices, legal redemption and rate contract remain unsettled. Finance/legal/security | Ledger boundary before M1; full contract, cap/providers before M5 |
| D07 | CKB v2 exact intent cryptographic verifier, one escrow input transaction-wide, explicit capacity reserve and immutable thresholds | Safer output attribution but less batching; select audited auth library/algorithms and reserve ownership formula. CKB/security | Capability interface in M1; binary layout and VM proof before M8 |
| D08 | New semantic `/v2` API, additive v1 read metadata only; dual-read legacy and transactional CKB-only dual-write | Extra compatibility surface avoids reinterpreting old signatures/statuses. API lead | Before M1 |
| D09 | Base finalized canonical receipt for paid/billing; CKB depth policy plus block-hash checks and long-running sweeps | Higher latency and RPC cost; production depths/provider quorum need measured risk review. Operations/security | Interfaces before M1; testnet policy M2; production M10 |
| D10 | Private scanned evidence, scoped five-minute URLs, immutable versions; retention/legal hold and storage region separately approved | Private evidence requires privacy/retention governance. Product/privacy/security | Before M6 real uploads |
| D11 | Two-person high-risk config activation, fresh five-minute step-up, explicit enrolled person identities | Small apps need two people or remain testnet-only for these actions; uniqueness cannot be proven purely on-chain. Identity/security | Before M3/M4 |
| D12 | Review current EvmPersonal/JoyID account binding; never use requestedAddress fallback as a general proof of identity | Signature-library semantics must be demonstrated with negative vectors; exploitability not asserted from static review. Identity/security | Before trusting these logins for high-risk console roles |

Approve D01, D03–D09 interface-affecting choices or explicitly replace them with reviewed alternatives before starting M1. Unresolved deployment/library/provider details can remain scheduled gates without forcing M2–M8 implementation into M0. Named approvers and acceptance dates are intentionally not fabricated.

## Rejected designs

| ID | Design | Reason |
| --- | --- | --- |
| R01 | Owner/operator withdrawal or infrastructure fees deducted from third-party principal | Violates noncustody and B2B fee separation |
| R02 | App API-key dispute verdict automatically pays or overrides client/worker consent | Database identity is not chain authorization |
| R03 | Force 50/50 split or silently replace CKB v1 commitments | Violates custom allocation and historical script invariants |
| R04 | Accept arbitrary “USDC” symbol or require a swap to use direct USDC escrow | Asset spoofing and unnecessary provider dependency |
| R05 | Assume all CCC connectors can spend the required CKB lock | Message-login capability does not imply valid transaction witness capability |
| R06 | Assume database arbiter flag or N role approvals enforce an on-chain threshold | Missing cryptographic enforcement; duplicate-person approval risk |
| R07 | Automatically refund client after any support dispute, or allow staff to extend locks indefinitely | Neither follows pre-agreed enforceable liveness policy |

## Deferred work

Native BTC is M11 after independent Bitcoin review; provider-neutral swaps are M12 only if production-compatible routes exist; future rails/optimization are M13. Incremental withdrawals, arbitrary token support, post-funding arbiter amendments, mutable custom roles and pooled escrow optimization require separate designs. Mainnet authorization remains gated by M10 and applicable contract review, operational and regulatory acceptance. These deferrals do not prevent native Base USDC testnet work after M0 review.

## Conflicts with existing repository material

The current `app_managed`/`pactagent_managed` labels are not proof of pre-funding consent. “Cooperative” in contracts/README does not mean both parties sign: v1 client input authorizes worker payout and worker input authorizes client refund. Existing docs/architecture/boundaries.md's “PostgreSQL is authoritative” is limited to application data, not chain finality. Existing financial-rounding.md describes a historical USD/CKB quote model; current schema no longer supplies that model, so it is not an approved B2B pricing implementation. CONTRIBUTING.md excludes product invitations; M3 invitations are explicitly **console staff memberships**, not product-user invitations. Current deploy workflow is VPS Docker Compose/SSH, not Kubernetes. Keep historical evidence intact and use these M0 documents as the prospective multi-rail contract.
