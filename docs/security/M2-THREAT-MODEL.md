# M2 threat model — proposed, G0 review required

Scope: [design decisions](../architecture/M2-DESIGN-DECISIONS.md), native Circle test USDC on Base Sepolia only. No implemented escrow, verified deployment or security sign-off is claimed. The existing [threat model](threat-model.md) and [escrow invariants](../architecture/escrow-security.md) remain authoritative. Assets at risk are principal, prepaid fees, signed executable artifacts, tenant data and truthful payment state.

## Trust boundaries and mitigations to prove

| Threat / boundary | Proposed control | Required evidence / residual risk |
| --- | --- | --- |
| App or platform impersonates participant | Onchain EIP-712 both-party checks, no server private keys or API-key settlement | Missing/forged signer and altered every-term EVM tests; app account authentication is insufficient |
| Signature replay across action/chain/instance | Separate type/domain, full terms hash, nonce and terminal guard | Cross-domain vectors in Solidity and TypeScript; actual VM replay failures |
| Mutable ERC-1271 participant wallet | Live onchain signature check, explicit wallet control risk disclosure | Owner mutation, revert, bad magic, gas grief tests; cannot freeze arbitrary wallet ownership |
| Mutable arbitral dependency/Safe | Fixed EOA list/threshold directly enforced, no mutable external verifier | Missing/duplicate signer, forged verdict, wrong threshold, contract-account rejection and list ordering tests |
| Arbiter loss/compromise | Bounded authority, invocation before D, precommitted fallback at T | Before/at/after D/T races; compromise can still select any consented allocation before T |
| Factory/operator rug | No upgrade/admin/sweep route, constructor-bound terms | Review all selectors/storage, bytecode reproducibility, clone/full gas comparison |
| Issuer proxy upgrade, pause, blacklist | Pin token and monitor implementation; fail closed on mismatch; revert failed payouts | Proxy implementation evidence missing; issuer can still block receipt/freeze USDC, escrow cannot cure this |
| Fee-on-transfer, malicious return, callback | Exact funding/output balance deltas, SafeERC20, nonreentrancy, atomic rollback | Actual EVM adversarial mock tokens; no terminal success on partial transfer |
| Fee rounding/uint overflow | Full-precision floor, exact conservation, P+reserve bound | EVM fuzz/dust/max vectors and DB integer quotient tests; preserve #118 correction |
| Donation/native ETH | No operator sweep; reject payable ingress, ignore surplus | Forced ETH/direct-token donation tests; donated balances may remain stranded |
| Stolen signed artifact | Scoped encrypted immutable storage, authenticated access, no logs; intents bind recipients and expiry | Cross-tenant access tests, key-version/recovery tests, log scanning; thief may relay authorized action early |
| Tenant/parent confusion | Auth-derived appId and composite database constraints | Cross-tenant and same-tenant wrong parent tests, not just service mocks |
| Worker crash/lost RPC response | Artifact+operation+outbox durable before broadcast; identical retry, unknown state | Kill/restart before/after submission; two-worker contention and idempotency payload collision |
| RPC lies, outage, stale finality | Independent agreement, canonical ancestry, no latest fallback | Wrong chain/emitter/code/event/receipt, missing finalized, inconsistent provider tests |
| Same tx in new block/deep reorg | Historical sweeps, immutable observations, correctable projection, duplicate suppression | Lost head, vanished/reappearing receipt, replaced tx, old-finalized correction without new payout |
| Webhook/API misrepresents paid | Separate submission/inclusion/finalized statuses; signed outbox notifications | Replayed/reordered events and OpenAPI compatibility; app must tolerate corrections |
| Supply-chain/deployment mistake | Pin compiler/libraries/settings, reproducible hashes, independent review, no CI deployment | Pins/artifacts not yet produced. Passing CI does not establish financial security |

## Security gates and unresolved findings

**Blocking:** only single-provider token code/decimals/finalized evidence, no independent agreement or implementation/provenance verification; no architecture acceptance of immutable authority and wallet mutability constraints; no EVM implementation or independent review. Token proxy semantics make a pinned proxy code hash insufficient. Fixed EOA arbiters trade away rotation and wallet flexibility to enforce the funded threshold; reviewers must accept that restriction or specify a provably immutable verifier design.

**Implementation constraint:** append-only M1 state is intentionally not a mutable payment pipeline. Adding live operation states by loosening its unauthorized-only guard would create a new trust boundary and is not an acceptable shortcut. A reviewed additive versioned model and concurrency tests are required.

**Residual:** chain outage/gas costs, compromised participant/arbiter keys and USDC issuer controls can impair liveness/receipt. Deadline fallback guarantees an executable contract path under its assumptions, not guaranteed delivery of tokens during issuer/network failure. No administrator remedy is proposed.

The read-only [probe tests](../../scripts/m2-network-probe.test.mjs) exercise only evidence-collection failure behavior. They do not test EVM signatures, conservation, storage durability, consensus or payment security. Every mandatory M2 acceptance category remains pending for the financial implementation.
