# M2 implementation status

**G0 review package and non-financial scaffolding only; M2 is incomplete.** Baseline: staging `5e30d6eb336087b65dde3ffdb880abf07d7c0c78`, which includes PR #118's fee/locking corrections. See [design](M2-DESIGN-DECISIONS.md), [threat model](../security/M2-THREAT-MODEL.md) and [report](M2-REPORT.md).

## Delivered behavior

The standalone [network probe](../../scripts/m2-network-probe.mjs) sends read-only JSON-RPC to the official public Base Sepolia endpoint. It validates chain ID, requires a finalized block, pins token code and decimals calls to its canonical hash using EIP-1898, rechecks canonical height/hash and chain ID, and emits sanitized evidence. Unsupported finalized/hash-pinned reads, malformed data, reorgs and provider failures yield no observation. There is no latest fallback. A successful run remains `unavailable`, never authorizes activation, and records the remaining review/provenance/provider gates.

Run `node scripts/m2-network-probe.mjs > /tmp/m2-network-observation.json`. Exit 1 means no observation was collected; exit 0 means a single-provider observation only, **not approval or verified deployment**. The script accepts no endpoint/private key, has no transaction-sending method, does not edit configuration or touch runtime routes. It reports code bytes and SHA-256 evidence digest. The manifest separately records a Keccak-256 computed from those bytes with the installed @noble/hashes 2.4.0; proxy implementation verification remains outstanding.

The [manifest](evidence/m2/network-manifest.json) preserves expected issuer identity separately from the successful single-provider observation, all unknown deployment fields as null, and empty reviewer acceptance. [Probe tests](../../scripts/m2-network-probe.test.mjs) run offline with deterministic transport fixtures. CI executes them without credentials or live RPC access.

## Capability truth table

| Primitive | This branch |
| --- | --- |
| Existing CKB v1 APIs, scripts, asset bytes and adapters | Unchanged |
| M1 read-only registry/capabilities | Unchanged; Base candidate unavailable |
| Network evidence collection | Implemented read-only; single-provider live observation recorded; independent verification pending |
| Reviewed M2 identity/asset activation | Unavailable |
| Factory/escrow bytecode, typed-data ABI/vectors | Not implemented/finalized |
| Funding, mutual split, refund, arbitration, fallback | Unsupported on Base |
| Base execution adapter, encrypted signed-artifact storage | Not implemented |
| Durable Base observer/reorg correction | Proposed, not implemented |
| Versioned financial APIs/SDK example | Proposed, not implemented |
| EVM/invariant/local-node end-to-end tests | Not run; no implementation to validate |
| Testnet deployment/mainnet | Not authorized/out of scope |

## Migration, compatibility and recovery

No schema or migration changes; applied migration bytes, including original M1 SQL and forward correction, are unchanged. No locks, dependencies, v1 OpenAPI, runtime routes or CKB contracts are changed. The next implementation must use forward migrations, preserve populated legacy records and validate the exact-fee/concurrent-parent cases in [M1 corrections](M1-REVIEW-CORRECTIONS.md). API and schema assumptions in the design are explicitly proposed pending review.

Probe failure has no financial side effects and requires no rollback. Retry evidence collection after free read-only access is available; inspect output rather than changing expected token/chain to make it pass. Do not enable deposits from a successful probe alone. Recovery of actual broadcasts and durable operations is still an implementation deliverable, not an implemented capability.

## Resumption sequence

1. Obtain evidence for chain/token/issuer implementation, provenance and finalized behavior using free independent providers; do not buy services or deploy.
2. Review the eight design decisions and resolve participant ERC-1271 versus immutable arbitral authority, exact ABI/signing codec, deployment measurement and versioned persistence choices. Record named acceptance; do not infer it from CI.
3. Implement M2.1 remaining vectors/toolchain pins and M2.2–M2.5 locally, with actual EVM tests and full mandatory negative matrix; keep deployment-bound capabilities unavailable.
4. Run G1 independent engineering/security review and integration CI. Produce bytecode/ABI/reproducibility artifacts and revised implementation report.
5. Seek separate G2 approval only if testnet deployment is desired. This task grants none. No M3 or main promotion.
