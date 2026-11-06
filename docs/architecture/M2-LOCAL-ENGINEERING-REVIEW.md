# M2 local engineering self-review — 2026-11-06

This is the implementation author's technical assessment, **not independent
engineering or contract-security approval**. The ABI is unfrozen. The owner's
[product directions](M2-DESIGN-DECISIONS.md) authorize local candidates, not release.

| Boundary | Design and evidence | Remaining review |
| --- | --- | --- |
| Funding window | Signed policy/version and interval; `now <= D-interval`, `now < expiry <= D`; exact boundary VM tests | Proposed 30-second..7-day bounds are not proven safe operational bounds; decide response-time budget/UX before freeze |
| Cancellation authority | Funding/mutual: either original participant; arbitration: fixed threshold; separate epochs and CancelIntent digest; stale signatures fail | Review participant griefing, irrevocable dispute, expiry and cancellation race disclosures |
| Settlement race | First successful canonical execution wins; cancellation never undoes settlement; shared terminal guard; fallback from T ignores epochs | Mempool censorship/order cannot guarantee cancellation wins; no promise of offchain revocation |
| Replacement | Explicit predecessor, same tenant/escrow/action/sender/nonce, increasing epoch; DB advisory serialization; service verifies chain and new signatures | Same-epoch fee bumps and automatic nonce allocation intentionally unsupported; production nonce coordination needs design |
| Broadcast recovery | Immutable encrypted bytes and transactional outbox; lease before IO; unknown before send; receipt-first restart; identical-byte retry | Lease expiry can allow duplicate submission of identical bytes, never a newly signed payout. Long RPC timeouts/supervision need operational review |
| Consensus evidence | Canonical receipt block rechecked, finalized tag required, expected code/terms/events; sticky correction and historical sweeps | Local same-node views are not independent finality; no live paid ledger projection or automatic reconciliation clearance |
| API authority | Authenticated appId/scopes plus EOA/ERC-1271 or arbiter validation and simulation; onchain execution repeats checks | Wallet ownership can mutate between simulation and execution; API acceptance is never a settlement guarantee |
| Key boundary | Test harness receives ephemeral wallets; backend receives only signed artifacts and encryption key | Live artifact-key custody/rotation, wallet UX and operational recovery remain unresolved |
| Compatibility | Two additive local migrations; chain31337 enforced; existing SQL/CKB and public API preserved | Full production rollout/rollback remains a separately reviewed plan |

The backend-to-Anvil/PostgreSQL test exercises funding, mutual settlement, refund,
arbitration and fallback through authenticated HTTP, durable commands and workers.
It additionally covers tenant/scope rejection, malformed consent, idempotency,
post-send crash, lost response, old-epoch rejection, explicit nonce replacement,
competing workers, historical disappearance/reappearance, append-only evidence and
webhook outbox creation. It does not claim external webhook delivery or independent
provider verification. Worker ticks are tested; continuous-loop supervision is not.

Self-review found two constraints worth retaining explicitly:

- A globally unique relayer nonce prevented authorized replacement. A new forward
  migration requires an explicit scoped higher-epoch successor and retains both
  signed artifacts. It does not loosen prior M1 constraints or confer authority.
- Reusing a database after the local workflow left webhook jobs for an unrelated
  global worker test. The local test now removes only its own mutable delivery jobs
  while retaining immutable evidence; clean-database validation is recorded separately.

Before freeze, an independent reviewer must assess cancellation/threshold authority,
all competing terminal paths, ERC-1271/token callbacks, fee conservation, full-versus-
clone deployment and the evidence/nonce model. Forced-native-ETH behavior, broader
wallet adversaries, operational recovery and the complete specification matrix must
be reviewed rather than inferred from test counts. Numerical interval/participant UX
policy changes require additional owner acceptance. No independent approval is recorded.
