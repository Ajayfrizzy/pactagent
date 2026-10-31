# App fees and independent infrastructure billing

Current status (2026-10-31): [product-direction approval](M0-PRODUCT-APPROVAL.md) supersedes historical pending product labels below. Specialized reviews remain OPEN. [M1 implementation](M1-IMPLEMENTATION.md) records the additive foundation and its limits; the original M0 design/review remains historical.

M0 proposal; commercial choices D05/D06 in [decisions](M0-DECISIONS.md) require confirmation. All equations use integer asset base units and checked wide intermediates, never floating point. [Settlement security](escrow-security.md) binds the algorithm and destinations on-chain.

## Escrow conservation

Recommended fee basis: fees are earned only on principal allocated to the worker. A full refund incurs zero app fee; client prepaid fee on refunded principal is returned. This policy must be disclosed and signed, not inferred from today's API. Rates `bc` and `bw` are independently configured integer basis points (denominator B=10000); zero means that party pays no fee. Recommend initial configurable commercial cap 1000 bps per party and combined 2000 bps, subject to approval. Hard arithmetic bound each rate <=10000 and total funding within rail maximum. Reject policy above approved cap before funding.

For P > 0, terminal worker principal W in [0,P], and client principal C=P-W:

```text
FcDeposit = floor(P * bc / B)
FcEarned  = floor(W * bc / B)
FcReturn  = FcDeposit - FcEarned
FwEarned  = floor(W * bw / B)
workerNet = W - FwEarned
clientNet = C + FcReturn
treasuryNet = FcEarned + FwEarned
fundingRequired = P + FcDeposit
workerNet + clientNet + treasuryNet = fundingRequired
W + C = P
```

Round each fee down exactly once per terminal escrow; remaining base-unit dust stays with the paying party through these equations. No implicit dust sweep. A worker fee is allocated from W, never extra principal. Client fee is a separate deposit. Gas, CKB occupied capacity and PactAgent billing are excluded from P and these USDC equations. CKB must additionally conserve separately attributed capacity reserve and top-ups, as specified in escrow-security. No output below CKB minimum may be hidden as a fee.

## Executable examples in native USDC base units

P=100000000 (100 USDC), bc=200 (2%), bw=300 (3%), FcDeposit=2000000. One USDC = 1000000 units.

| Outcome | W | C | FcEarned | FcReturn | FwEarned | workerNet | clientNet | treasuryNet | Sum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Full worker payout | 100000000 | 0 | 2000000 | 0 | 3000000 | 97000000 | 0 | 5000000 | 102000000 |
| Full refund | 0 | 100000000 | 0 | 2000000 | 0 | 0 | 102000000 | 0 | 102000000 |
| Custom 37/63 split | 37000000 | 63000000 | 740000 | 1260000 | 1110000 | 35890000 | 64260000 | 1850000 | 102000000 |

For full payout with the same P:

| Fee mode | bc | bw | Client funds | Worker receives | Treasury receives |
| --- | ---: | ---: | ---: | ---: | ---: |
| Neither | 0 | 0 | 100000000 | 100000000 | 0 |
| Client only | 200 | 0 | 102000000 | 100000000 | 2000000 |
| Worker only | 0 | 300 | 100000000 | 97000000 | 3000000 |
| Both | 200 | 300 | 102000000 | 97000000 | 5000000 |

P=101, W=37, bc=200, bw=300 gives deposit=2, client-earned=0, client-return=2, worker-earned=1, workerNet=36, clientNet=66, treasuryNet=1: sum=103. This exposes integer rounding rather than assuming whole cents. Full refund and fallback use the same equations. Cancellation before funding returns no escrow money because none arrived; after funding it requires authorized refund/fallback. Pending or reverted transfers earn no fees in the ledger. A protocol token transfer failure reverts all allocations. The fixed treasury version cannot be changed retroactively when an app updates its treasury.

## B2B PactAgent fee and collection guarantee

Charge the integrating application, not participants or the escrow treasury leg. Recommended eligible gross volume is **finalized worker principal W before worker app fees**, excluding refunded C, app fees, gas, capacity, deposits, swaps and internal transfers. This definition and the negotiated percentage are contractual decisions, not a universal 1–2% default. Rate version is frozen at reservation for each escrow. Full refund has W=0 and zero infrastructure usage fee under this proposal.

Use a separately funded application credit account backed by confirmed app-owned deposits in a reviewed billing vault/payment arrangement. Billing funds must have independent provenance and cannot be swept from third-party escrow. Exact vault custody/redemption and legal terms are D06; app fee proceeds may only be voluntarily deposited after settlement. Ledger balances alone do not prove collectible backing.

At creation reserve the maximum possible fee for P at contracted rate r: `reserve=ceil(P*r/10000)` for USDC-denominated settlement/billing. Prevent withdrawal or reuse of reserved credits through a serializable balance check. After eligible final settlement capture `floor(W*r/10000)` and release the remainder, atomically with the unique confirmed-settlement ledger key. Example r=150 and W=37000000: reserve=1500000, capture=555000, release=945000. Rates and rounding are recorded. Before funding expiry and proven no funding, release reservation. Full refund releases all. Unknown settlement keeps reservation and alerts on age; never time out a reservation while liability is possible.

Insufficient credits blocks **new** escrows. It does not block an existing contract-valid settlement, refund, evidence access or recovery transaction. Operator/app billing failure never grants access to principal. A missing reservation on a legacy escrow yields explicit app receivable/risk exception, not a participant deduction. CKB legacy volume is not retroactively charged.

For future CKB-to-USDC billing, recommend a versioned independent price policy: robust CKB/USD median/TWAP from at least two approved independent providers, bounded staleness and divergence, fixed-point rational quote recorded at settlement's finality timestamp (nearest approved observation at or before it). Record source observations, timestamp, conversion precision and policy version. No current price service is assumed. Cross-asset maximum reservation cannot be guaranteed with an unbounded future price; recommended initial policy disables CKB cross-currency B2B charging until a contractual price cap or prepaid CKB-denominated billing is approved. Outage queues billing calculation or app receivable, never blocks user settlement. D06 must choose providers, time window, cap and credit exposure before M5 enables this path.

## Append-only accounting and reconciliation

Proposed double-entry books partitioned by appId, billing asset and legal entity. Accounts include app available credit liability, reserved credit liability, backing cash/vault asset, fee revenue and app receivable. Deposit: debit backing asset, credit available liability. Reserve: debit available liability, credit reserved liability. Capture: debit reserved liability, credit fee revenue. Release: debit reserved liability, credit available liability. App refund of available credit: debit available liability, credit backing asset only after withdrawal finality. Sum debits equals credits for each journal/asset; no cross-currency balancing without explicit valuation entries.

Journal fields: immutable id/appId, journalType, settlementId, observationId, rateVersion, quoteVersion, effectiveAt, postedAt, reversalOf and idempotency key; lines hold account, debit/credit base units. Enforce unique capture per escrow settlement epoch and positive balanced entries in DB transactions. Corrections reverse linked entries then post replacements; never edit history. Daily reconcile vault/payment-provider confirmed balances against liabilities/revenue, rail settlement allocations against captures, and reservations against active escrows. Unknown deposits cannot be credited from caller-supplied hashes alone.

Reorg after capture reverses fee and restores reservation until resolution; reconcile any backing-deposit reorg as a deficit, freezing new credit use and app withdrawals. Duplicate observations, double capture, concurrent reservations, forged deposits, quote spikes and reorg reversals need property/integration tests. Billing credit is not an unconditional insolvency guarantee; backing controls and legal collection terms are launch gates.
