# PactAgent — M1 Multi-Chain Payment Foundation

**Milestone:** M1  
**Status:** Authorized development specification; **not** approval for merge, deployment, production, real funds or M2.  
**Target branch:** `staging`  
**Working branch:** `feature/m1-multichain-foundation`  
**Product approval companion:** `docs/architecture/M0-PRODUCT-APPROVAL.md` (import from supplied `M0_PRODUCT_APPROVAL.md`).

## Objective

Introduce additive and backwards-compatible multichain asset, rail-capability, funding-term, settlement-operation, and chain-observation foundations so PactAgent can implement **native USDC on Base Sepolia in M2** while retaining existing funded CKB v1, manual and mock operations. Implement no new on-chain money flow in M1.

## Read first, and verify baseline

1. Fetch latest `origin/staging` and record exact SHA; create feature branch from it. Confirm clean worktree. Never use `main` as implementation base.
2. Read `AGENTS.md`, `.agents/skills/pact-architecture/SKILL.md`, `.agents/skills/pact-money-security/SKILL.md`, `.agents/skills/pact-data-api/SKILL.md`, `CONTRIBUTING.md`, `M0_ARCHITECTURE_SPEC.md`, `M0_DECISION_REVIEW.md`, `docs/architecture/M0-DECISIONS.md`, `docs/architecture/M0-DECISION-REVIEW-FINDINGS.md`, `docs/architecture/system-design.md`, `docs/architecture/escrow-security.md`, `docs/architecture/fees-billing.md`, `docs/architecture/data-api-migration.md`, `docs/architecture/milestone-contracts.md`, and the companion approval file.
3. Audit code before changing it: Prisma models/migrations, `server/src/modules/escrows`, adapters, agreement/dispute services, amount invariants, OpenAPI, CKB network config and reconciliation, tests, web assumptions, migration fixtures, CI. Report differences with actual current `staging` source, not the older M0 snapshots.
4. Confirm the product-direction decisions are represented faithfully; complete an engineering interface review and record open specialized gates. Do not infer security/finance/legal approval.

## Required implementation work packages

### M1.1 — Canonical asset/network identity and registry

- Introduce typed, versioned `AssetId` with **explicit chain/network/deployment identity**, asset kind, precision, and canonical token identity. Treat ticker/symbol as display data, not asset identity.
- Define initially CKB native asset and Base **Sepolia USDC candidate configuration**; do not hardcode a guessed token address. Verified token deployment/issuer configuration is an M2 gate. Reject unregistered or misidentified token/network combinations. Avoid implicitly enabling unsupported mainnet assets.
- Preserve legacy CKB currency and old transaction identifiers; introduce explicit translation for legacy reads. Never re-label historical funded agreements or default historical records to Base.
- Financial amounts use canonical positive/nonnegative integer base-unit strings, checked range and precision; no float, imprecise conversion, assumed shared u64 limit or mixed asset arithmetic.

### M1.2 — Versioned rail and capability interfaces

- Extend the existing adapter boundary instead of inventing a parallel service. Capability data must be **versioned and discriminated** (not a flat fund/release/refund/split/arbitrate boolean set): supported actions, signature mode, chain-enforced expiration, exclusive cutoff support, dispute invocation gating, fallback competition, exact on-chain arbitral authority enforcement, settlement style and finality evidence policy.
- Unsupported is the **default**. Existing CKB v1 gets truthful actual capabilities; manual/mock rails cannot impersonate real contract settlement. Base is registered only as an **unavailable/planned capability descriptor** until M2 implements/adversarially tests the adapter and contract.
- Define explicit unsupported-capability error response and documented API/OpenAPI form. No faux v2 Base funding endpoint, automatic bridge or swap in M1.
- Ensure capabilities are bound to **the escrow's immutable deployment/script version**, never a global current-rail setting.

### M1.3 — Immutable funding terms and settlement intent contracts

- Introduce versioned typed interfaces and canonical hashing/serialization contracts for funding terms: app/tenant, agreement/milestone/escrow IDs, chain/network, deployment, asset, principal, client prepaid fee, worker fee rate, client/worker recipients and signing identities, treasury version, app fee policy version, approved fallback allocation and deadline, arbitration verifier/policy hash and amount bounds.
- Define mutual settlement proposal and operation models for full payment, full refund and **arbitrary split W,C (W+C=P)**. Applications may administer cases but cannot approve a payment on behalf of participants absent pre-consented enforceable arbitration.
- Do not invent a CKB on-chain expiring signature guarantee; keep chain-specific encoding/hashing concrete only after corresponding cryptographic review. Reuse M0's exact fee equations, test deterministic rounding and conservation. Distinguish principal, client fee reserve, CKB capacity and B2B application billing liability.
- Preserve explicit pending/unauthorized/authorization/settled states; no database verdict should masquerade as chain-confirmed payout.

### M1.4 — Additive Prisma schema and compatibility

- Propose and implement small, forward-only, additive migrations for asset/deployment identity, terms policy/version, operation and observation metadata where necessary. Do not rename/drop or reinterpret existing populated columns, historical signatures, v1 escrow IDs, CKB script bytes or funded transaction outpoints.
- Use safe nullable fields or related versioned entities for legacy rows. Backfill only proven metadata; unknown values remain unknown, never guessed. Any dual-write must remain transactional and CKB-only where M0 recommends it.
- Enforce `appId` tenant scope, parent-agreement/milestone ownership and uniqueness at API **and database** boundaries. Test with populated pre-M1 fixture and run migration rollback/forward-compatibility review. Do not claim rollback where destructive migrations make it impossible.
- Do not implement fee custody, staff RBAC, billing vault, arbiter verdict execution or new chain contracts in M1.

### M1.5 — Chain operation lifecycle and finality evidence foundation

- Model durable operations and exact transaction semantic identity, idempotency scopes, broadcast attempts, signed-artifact persistence requirements, observations (chain block hash/number, tx/log identifier, confirmation state, policy version and canonical evidence), uncertainty, reconciliations and reorg corrections.
- Avoid race conditions: an RPC timeout is **unknown**, not proof of failure; do not allow duplicate payment from retry; settlements only marked final after verified rail-specific policy.
- Implement abstractions, compatible persistence and testable state transitions within M1 scope; do **not** claim new live chain reconciliation is operational. M2/M8 will implement adapter-specific evidence and provider behavior.
- Finality policy unknown/unavailable/disagreeing means **no silent downgrade**.

### M1.6 — `/v2` API groundwork and docs

- Add only additive, versioned interfaces and truthful read-only metadata/registry/capabilities endpoints as appropriate; retain `/v1` route behavior and OpenAPI contracts. Prefer minimal public surface; no endpoints that accept unverified financial operations.
- Document which fields are prospective, populated for legacy CKB, unsupported or pending M2. Document exact compatibility, deployment, roll-forward and data repair procedures.
- Update docs, generated clients/contracts and relevant tests consistent with repo conventions; no frontend product redesign needed.

## Test and acceptance requirements

**Must be demonstrated:**

1. Clean dependency installation / Prisma generate + validate; lint, typecheck, unit tests, build, OpenAPI checks and full relevant CI. No bypass or weaker audit policy.
2. Property/boundary tests for integer precision and exact fee conservation with zero, client-only, worker-only, both, full refund, full payout, and arbitrary splits; overflow, dust and invalid token identity rejected.
3. Cross-tenant and same-tenant wrong-parent isolation; repeated idempotency keys with different payloads rejected; unknown state cannot become settled.
4. New registry rejects unsupported networks and spoofed ticker addresses; no accidental Base mainnet support. Capability descriptor explicitly differentiates CKB v1 lower-bound timeout from prospective Base exclusive cutoff.
5. Populated pre-M1 schema migration fixture successfully upgrades and retains existing CKB/manual/mock state. Existing CKB contract/builders and output bytes remain unchanged.
6. v1 OpenAPI, existing CKB tests, existing app integrations and Docker standalone npm lockfile installation remain valid.
7. No new signer/private key handling, contract deployment, real funds, staging or production deployment. No automatic merge or `main` changes.
8. Engineering reviewer confirms interface cannot advertise unproven arbitration/finality guarantees. Any unresolved issue is documented as an explicit gate, not a test pass.

## Expected deliverables

- Runtime/contracts **only within M1 scope**: typed registry and capability descriptors, additive DB entities/migrations, lifecycle observation interfaces, minimally necessary v2 read-only metadata and tests.
- `docs/architecture/M0-PRODUCT-APPROVAL.md` product direction (from companion document), with accurate decision register/status and links. Distinguish product acceptance from specialist signoff.
- `docs/architecture/M1-IMPLEMENTATION.md`: implemented schema/interface decisions, compatibility chart, deferred Base/CKB/BTC features, test and migration instructions.
- `docs/architecture/M1-REPORT.md`: exact baseline/head SHA, file inventory, test commands/results, adversarial cases, open gates, PR link and M2 handoff.
- Pull request from `feature/m1-multichain-foundation` into **protected `staging`**, with all required checks; **leave open for review**.

## Explicit out of scope

No Base Solidity contract, live USDC transfer, CKB v2 script, native BTC, Perun/Fiber swap, staff invites/roles, treasury multisig, application fee movement, PactAgent billing custody, evidence uploads or real arbitration verdicts. These are future milestones. Do not rewrite `main`, force-push, disable Dependabot/CI/security or deploy environments. No credentials or payment card requirements.

## Codex stop conditions and reporting

- Stop the **affected work package** and report if a specification requirement conflicts with a proven chain constraint, noncustodial security invariant, current repository behavior, or cannot be migration-tested without destructive changes; work on independent safe packages may continue.
- Do not silently reinterpret product decisions. If implementing v2 requires another product decision, record proposal and review block rather than guessing.
- All M1 changes must target a dedicated feature branch from the latest remote staging; commit and push, open PR, **do not merge**. Report blockers and evidence precisely; do not misrepresent unrun tests or specialist approvals.
