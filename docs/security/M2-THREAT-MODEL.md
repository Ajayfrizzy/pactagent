# M2 threat model — local candidate, independent review outstanding

The owner's [conditional direction acceptance](../architecture/M2-DESIGN-DECISIONS.md) permits local implementation only. Existing [escrow security](../architecture/escrow-security.md), [fee policy](../architecture/fees-billing.md) and [threat model](threat-model.md) still apply. Local EVM/DB checks are author-run evidence, not independent financial-security verification.

| Threat | Implemented mitigation / evidence | Residual or missing control |
| --- | --- | --- |
| App/operator impersonates participant | Onchain both-party funding/mutual signature checks; public API proposal route rejects; local harness validates signed raw transaction/consent | No live signing UI/SDK preview; local signatures are verified by the implementation; no independent reviewer approval |
| Cross-chain/instance/action replay | EIP-712 domain and distinct type hashes; separate cryptographically advanced epochs and lifecycle guard; canonical cross-language vectors | Cancellation must execute first to invalidate an epoch; offchain replacement alone has no effect. Dispute remains irrevocable |
| ERC-1271 wallet changes owners | Live SignatureChecker execution; mutation regression | Human identity is not frozen by contract address; owner-change/expiry risk needs participant disclosure |
| Mutable arbitral verifier/threshold | Constructor-bound sorted EOA set, exact threshold, direct ECDSA; reject code-bearing/delegated arbiters | No rotation/recovery; compromised threshold can select any allocation within consented authority. Per-escrow threshold policy needs final review |
| Arbiter liveness/timeout race | Signed invocation <D, settlement <T, permissionless fallback >=T; shared terminal guard; exact boundary tests | Gas/outage/token freeze can still block receipt; owner accepts a minimum interval; proposed numeric bounds need technical review |
| Operator factory escape hatch | No owner/upgrade/withdraw selector; full constructor binding | Equivalent clone benchmark/tests exist; ABI not frozen and no independent selector/bytecode/initializer audit |
| False token/pause/tax/reentrant transfer | Candidate factory and direct-constructor chain/address checks; SafeERC20, both-side exact balance delta, nonreentrancy, revert-all settlement; mock failures tested | Token implementation/proxy provenance unverified; issuer can upgrade/blacklist/pause; no algorithm can remove that external trust |
| Fee overflow/rounding | Math.mulDiv floor, P+reserve bound, four modes, uint256 and fuzz conservation | Existing library pin is not independent audit of composition; DB M1 `div` retained |
| Donations/forced ETH/recipient aliases | Surplus not allocated, no sweep, normal native calls rejected; donation test | Forced ETH untested; stranded surplus cannot be recovered; owner accepts distinct addresses, not distinct human ownership |
| Stolen/tampered signed artifact | AES-GCM, app/operation/terms/key AAD, immutable encrypted storage, recover/tamper tests | No live key provisioning/rotation/access service; local signed-transaction checks/simulation exist; execution can still fail after state changes |
| Cross-tenant/parent confusion | Authenticated scopes, composite DB FKs, internal tenant context and hashed parent binding | Local SQL functions are internal, not production evidence-authority interfaces |
| Crash/double worker/idempotency | Atomic artifact/operation/evidence, row-lock serialization and permanent terminal slot; real PostgreSQL concurrent tests | Local leased outbox, identical-byte recovery and linked higher-epoch replacement tested; live nonce/key operations remain unresolved |
| RPC fabrication/reorg/incorrect paid | Raw receipt/emitter/code/state/token/amount checks across two local providers; no latest fallback; sticky corrections | Provider independence/ancestry semantics/real L1 finality unverified; no production paid projection is enabled |
| Duplicate/out-of-order evidence | Immutable sequenced rows, duplicate suppression and correction tests | Local historical sweeps/refetch and corrective event/webhook jobs implemented; external delivery and live operational supervision not validated |
| Unsafe deployment/supply chain | Pinned toolchain, exact library source hashes/license, CI in-process and disposable loopback-Anvil tests, ABI/template reproducibility | No deployment authorization, live manifest or independent specialist review |

## Self-review findings and treatment

- **Resolved locally:** early mock fixture violated the existing milestone/parent currency constraint. Corrected fixture, retained DB guard. Exact-fee and parent serialization M1 corrections remain untouched and tested through populated upgrades.
- **Resolved locally:** OpenZeppelin 5.4.0's byte utilities require Cancun MCOPY; pinned Cancun explicitly after Paris compilation rejected it. This does not establish a live Base fork compatibility claim.
- **Fail-closed design limitation:** local-only evidence tables enforce chain 31337 and are not connected to live API authorization or paid state. A caller of internal local evidence helpers can supply fixtures; they are not a substitute for a trusted production verification service.
- **Open material policy choices:** owner accepts funding interval, distinct addresses and explicit immutable EOA thresholds up to 16. Numerical interval bounds and exact cancellation policy remain technical-review candidates before ABI freeze.
- **Open high-impact engineering:** independent contract review, complete mandatory matrix, independent clone/full review, live observer/worker/outbox/recovery (local real-node lifecycle and signed artifact verification now tested), independently verified proxy/deployment/finality.

No architecture acceptance is represented as engineering, contract-security, legal, finance or deployment approval. There is no evidence of an independent security reviewer having examined this candidate. CI success cannot clear those gates.

## Cancellation and dispatch continuation — 2026-11-06

Either participant may invalidate funding or mutual intent epochs through an
onchain signature; only the immutable arbiter threshold invalidates arbitration.
Application/database changes cannot revoke consent. An advanced epoch invalidates
all older intents for that action, not funded terms. Fallback ignores epochs and
remains permissionless from T. A participant cannot cancel the other's invocation
or veto arbitral authority. Front-running/censorship may cause an otherwise valid
settlement to precede cancellation; this ordering risk must be disclosed.

The local raw-transaction sender permits only literal loopback Anvil chain31337,
trusted fixture code and exact terms. Unknown receipt/nonce ambiguity fails closed;
reorg corrections stay sticky even when receipts reappear. Existing v1 paid state
is untouched. The local observer deliberately uses two views of the same Anvil
node; this is **not independent provider agreement** and cannot activate Base.

Outstanding specialist review includes proposed interval bounds, cancellation
policy, nonce replacement/liveness, forced ETH and expanded ERC-1271/token
adversaries, operational key rotation, historical sweep scaling and live
finality/provenance. See [engineering self-review](../architecture/M2-LOCAL-ENGINEERING-REVIEW.md).
