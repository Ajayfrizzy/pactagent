# M1 multi-chain foundation implementation

Status: implementation for review, **not activation or merge approval**. Authority: [M1 specification](../../M1_MULTI_CHAIN_FOUNDATION_SPEC.md) and byte-preserved [product approval](M0-PRODUCT-APPROVAL.md). Engineering/security acceptance is OPEN. This ADR supplements the historical M0 designs; it does not assert their future contracts are implemented.

## Current staging audit and interface decisions

Baseline `43b9dcc9e3cc4d1de6a5074008dcb3b9a22002fe`. Unlike the original M0 audit, staging has restored Kubernetes deployment manifests, manual-only deployment workflows, Node 26.12.1, synchronized npm locks and dependency checks. Existing `/v1` agreements/disputes, active-escrow uniqueness, composite tenant/milestone constraints and funded-commitment triggers remain. Dispute resolution records do not authorize chain spends. Web uses `/v1`; no standalone SDK is present.

The current [CKB observer](../../server/src/rails/ckb/reconciliation.ts) and [escrow service](../../server/src/modules/escrows/escrow.service.ts) still have the depth/snapshot/historical sweep constraints identified in M0. M1 does not replace that live execution path. [CKB transaction builder](../../server/src/rails/ckb/transaction-builder.ts), contract sources, v1 OpenAPI and all historical migrations are unchanged.

| Package | Implemented boundary | Explicit limit |
| --- | --- | --- |
| M1.1 | [Typed registry](../../server/src/modules/assets/asset-registry.ts), exact identity checks, canonical unsigned strings and asset-specific bounds | CKB named testnet identity and synthetic sandbox only; no verified Base address or mainnet activation |
| M1.2 | Existing adapter interface now has deployment-bound `describeCapabilities`; discriminated unavailable, synthetic and unverified CKB v1 descriptors | No historical verified deployment inventory is available; CKB code semantics are descriptive, not an allowlist granting new actions |
| M1.3 | Strict immutable funding terms, application commitment hash, mutual full/refund/arbitrary split proposals and exact W-based fee arithmetic | No chain signature codec, signer, consent verifier, fee collection or arbitration execution |
| M1.4 | Four related tables with composite tenant FKs, full parent checks, numeric checks and immutable records | No historical backfill, no dual-write, no v1 columns reinterpreted; new terms are prospective |
| M1.5 | Operation identity/idempotency, recoverable artifact/attempt and observation storage, pure evidence/state evaluator | Live observer/broadcaster wiring and approved provider policies remain M2/M8; persisted proposals cannot become paid |
| M1.6 | Authenticated read-only `/v2/metadata` and `/v2/escrows/{id}/capabilities`, separate v2 OpenAPI | No financial writes, frontend redesign, SDK or new financial webhook semantics |

## Asset identity and capability safety

`AssetId` is versioned as `asset:v1:<chain>:<network>/<kind>:<token>`. CKB testnet uses the named `aggron4` network, native deployment and eight decimals, bounded by uint64. Sandbox uses an explicitly synthetic asset with uint256 bounds to exercise wide arithmetic without enabling EVM. This is an explicit M1 refinement of the M0 illustrative genesis-based key: the repository contains no verified genesis/deployment manifest. Do not invent a genesis hash or silently replace this immutable ID later; add a new registry version and reviewed mapping when evidence exists. Genesis verification and exact deployment manifests remain an engineering/M2/M8 gate.

Base Sepolia is a candidate descriptor (`eip155:84532`, prospective six decimals), with null asset ID, token and deployment. It cannot resolve as an accepted asset. Tickers, spoofed token addresses, wrong precision/network and mainnet are rejected. Native asset identity and escrow deployment identity are separate terms fields. `legacyAsset` translates only explicit CKB/testnet/CKB reads; unknown/manual/mock/mainnet records retain original labels and unknown metadata. No historical row is relabeled.

Capabilities receive escrow-persisted network, version and script bytes. No new capability lookup uses current global CKB configuration. Without reviewed deployment evidence, even contractVersion=1 cannot grant execution guarantees: an arbitrary script could carry that version label. The `ckb-v1-unverified` descriptor includes actual repository code semantics (client-input full payout, worker-input full refund, lower-bound competing full-client fallback) but has no newly executable actions. Upper cutoff, invocation-gated arbitration, split and fees are unsupported. Existing v1 routes continue unchanged. Manual/mock are explicitly synthetic and never prove chain settlement. Base is unavailable, including its merely proposed exclusive deadline design.

The engineering reviewer must approve the conservative deployment-verification boundary or supply a verified historical allowlist before any activation. A global code hash must never override a funded escrow's bytes.

## Terms, monetary components and commitments

[Funding terms](../../server/src/modules/escrows/funding-terms.ts) bind tenant and complete parent scope, explicit asset/network/deployment, principal, client reserve and independent rates, both recipients and signing identities, treasury and fee-policy versions, fallback shares/deadline/enforcement, funding expiry, arbitration dependencies/hash, bounds, capacity ownership/top-ups and finality policy. Billing is a separate unimplemented app liability with a version reference, never an escrow deduction. Proposed arbitration is labeled `proposed`, not verified consent. CKB upper-bound expiry/cutoff claims are rejected.

The approved fee algorithm is `worker-principal-floor-v1`, exactly the [M0 equations](fees-billing.md). Rates are capped at 1000 bps each (therefore 2000 combined). P must be positive; W and C are nonnegative; W+C=P. Client prepaid fee and every output/funding sum must fit the asset's range. Integer floor dust remains with its payer; no sweep or floating-point conversion. CKB output minima/capacity feasibility require M8 proof and are not inferred from valid arithmetic.

Application commitments use SHA-256 over UTF-8 `PactAgent:application:<terms|intent|operation|artifact>:v1\n` followed by canonical JSON: sorted ASCII schema keys recursively, arrays retain order, no whitespace, decimal numbers limited to safe integers, all financial quantities strings. Strict schemas reject unknown fields. Strings preserve exact Unicode code points; no normalization or cross-chain address canonicalization is silently applied. Parsed terms are deeply frozen. Example `terms` hash of `{"a":"1"}` is `148d40afca36430a335452526b97d56c0c41ec84cd79f3633f6df5c9db5e8387` (independently checked with Python SHA-256).

**Never sign these application JSON hashes as a CKB transaction or EIP-712 intent.** M2/M8 must publish reviewed chain-specific codecs, domains and vectors. An app key, role or stored verdict is not participant consent. Mutual proposals start unauthorized; revision and allocation changes alter the intent hash. One terminal nonce (`0`) is reserved per foundation; additional proposals/execution policy require later review.

## Persistence and lifecycle

[Migration](../../server/prisma/migrations/20261031000100_multichain_foundation/migration.sql) adds `EscrowFoundation`, `SettlementOperation`, `BroadcastAttempt` and `ChainObservation`. Existing escrow IDs/scripts/outpoints/signatures and amount/currency columns are untouched. The registry is code-versioned rather than mutable DB configuration. Foundations are immutable and cannot be attached to already-funded legacy escrows. Their parent tenant/agreement/milestone and rail/network are checked by repository and SQL; changing an attached escrow's parent scope is prohibited. Child operations, attempts and corrections are composite-tenant constrained. Principal/rates/reserve/range/conservation also have SQL checks, not JSON-only enforcement.

Internal repository methods require authenticated `TenantContext` and a caller transaction. Duplicate app+idempotency key with changed intent rejects. Foundation+nonce uniqueness reserves semantic scope even with another key. A concurrent unique violation aborts the caller transaction; callers must reread the original scoped key/operation and compare its hash, never re-sign or issue a new payment. No HTTP writer invokes these methods in M1.

Records are append-only. Persisted operations remain `unauthorized` by DB CHECK until a later reviewed authorization integration; attempt/observation tables are evidence storage groundwork, not authority. The pure [lifecycle evaluator](../../server/src/modules/escrows/operation-lifecycle.ts) distinguishes unauthorized, authorized, broadcast, unknown, observed, settled and reconciliation-required. It requires recoverable artifact, expected transaction identity and authorization proof before modeling broadcast; timeout is unknown and cannot begin another broadcast. Only matching verified allocation/canonical evidence under the pinned policy can produce the modeled final state. Same-tx block changes, policy mismatch, lost depth and disagreement require reconciliation. No live provider, signer or finality verifier calls it; unit-test evidence is not chain proof. Reconciliation stays blocked pending an explicit future verified recovery path.

Each observation records attempt/transaction scope, block number/hash, log identifier, versioned evidence JSON, policy and optional correction. Signed artifact references must point to recoverable, access-controlled immutable storage before a future broadcaster uses them; M1 does not provision that storage. Do not log/expose executable artifacts through the metadata API. Future replacement transactions must preserve semantic intent and nonce/outpoint; M1 does not authorize replacements.

## API and compatibility

Both v2 endpoints require an app API key and `escrows:read`, with IP/key/tenant rate limiting. Escrow reads resolve tenant from auth and return 404 across tenants. Optional `action` probes return existing error envelope with HTTP 400 `unsupported_rail_capability`. Registry metadata is not a financial authorization. `/openapi.v2.json` serves the new schema; `/openapi.json` and v1 schema are unchanged. OpenAPI validation checks both route sets, and existing v1 compatibility comparison remains in CI.

| Consumer/data | M1 behavior |
| --- | --- |
| Existing v1 CKB funded cell | Original route, adapter execution, ID, scripts, outpoint and fees unchanged |
| Manual/mock integrations | Existing behavior unchanged; v2 labels them synthetic |
| Historical missing metadata | Explicit unknown/legacy translation; no guessed consent/deployment |
| Prospective terms/operations | Internal types and storage only; no financial HTTP write surface |
| Base/USDC, CKB v2, BTC/swaps | Unavailable; respective M2/M8/M11/M12 gates |

## Migration, roll-forward and recovery procedure

1. Review PR, qualified interface findings and CI. No deployment is authorized here. Before an independently approved rollout, back up and inventory environment counts/deployments; estimate lock window (the new parent trigger briefly locks Escrow metadata).
2. Apply `npm run db:migrate:deploy --workspace @pact-agent/server` through the existing approved migration job with its direct DB connection. Never `db push`, edit historical migrations, or infer consent during backfill.
3. Verify migration status, compare legacy row checksums/counts and CKB bytes/outpoints, and smoke-test v1 plus authenticated read-only v2 metadata. M1 intentionally has no backfill or writer cutover.
4. If application rollback is needed, run the previous v1 reader/writer with the additive tables retained. Never drop evidence/terms to roll back. Since no new financial execution is enabled, no funded v2 cells need migration. Future writer activation changes this assumption and requires a new runbook.
5. If constraints reject data, stop the affected write, capture tenant-scoped evidence, investigate authoritative parent/commitment records and issue a reviewed additive repair migration. Do not disable triggers, mutate immutable funded data, or change recipients. No automated data repair is included.

Reproduce the populated upgrade using an **empty disposable local** database named `pactagent_m1_upgrade`: set `M1_TEST_DATABASE_URL` then run `node scripts/test-m1-upgrade.mjs`. It refuses nonlocal/other names and nonempty databases, applies every pre-M1 migration, inserts funded CKB/manual/mock fixtures, snapshots every old field, applies M1 and verifies byte-identical rows plus legacy reader/writer compatibility. CI also tests fresh deploy and the original baseline upgrade fixture. This establishes schema rollback compatibility, not production backup/restore evidence.

## Open gates and handoff

Engineering review must validate the interfaces before merge, especially named network identity, unavailable historical deployment capabilities, immutable dependency semantics and the prospective-only persistence boundary. Independent contract/security, provider policy, legal/finance, identity, custody, testnet and production approvals remain OPEN. M1 does not fix legacy CKB reconciliation/signing limitations, execute arbitration, collect fees, implement staff RBAC or move real money.

Before M2: review M1 PR and all validation; close or explicitly resolve M1 engineering findings; obtain explicit M2 authorization; verify official Base Sepolia/native USDC deployment and decimals; review D02 factory/instance design, participant consent and immutable arbiter dependencies; select testnet finality/provider policy; implement actual transaction adversarial tests. No automatic M2 start or main promotion follows M1 completion.
