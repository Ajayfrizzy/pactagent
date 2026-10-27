# PactAgent — M0 Architecture and Security Foundation

**Status:** Specification for Codex execution and review  
**Target repository:** `Ajayfrizzy/pactagent`  
**Suggested branch:** `architecture/m0-multichain-foundation`  
**Scope:** Audit, architecture documents, threat model, durable Codex instructions, and implementation-ready milestone contracts. **No production or financial feature implementation in M0.**

## 1. Mission

Evolve PactAgent from Nervos-centric settlement into a **multi-tenant, chain-agnostic agreement, escrow, settlement, dispute, and application infrastructure platform**. Preserve working CKB capabilities; prioritize **native USDC on Base** for the first additional production-oriented rail, with Base Sepolia testing first. Native Bitcoin and optional CKB↔USDC swaps are subsequent workstreams, not prerequisites to launch USDC.

PactAgent provides infrastructure to applications; **applications own their product rules and user authentication**. PactAgent must not arbitrarily decide disputes, custody principal in an unrestricted operator wallet, or grant tenant operators free access to escrows.

## 2. Canonical product decisions (do not silently change)

1. **Escrow:** Noncustodial, contract-/script-constrained funds. Recipient wallets and permissible settlement conditions are committed before funding. Neither PactAgent operators nor tenants have unrestricted principal withdrawal rights.
2. **Rails:** Keep existing CKB native-asset rail. Add native USDC on Base as separate adapter and contract. Future native BTC rail; future provider-neutral swap capability. Swaps are optional and never required for direct escrow.
3. **Authentication:** Applications design their own end-user registration and login. PactAgent manages developer-console accounts and app-scoped identities/authorization. End-user on-chain authorizations must be verified even if an application asserts the user's identity.
4. **Wallets:** CCC wallet sign-in may remain for developer accounts. For actual CKB payments, require wallet/lock-script compatibility with the necessary CKB signing operations; CCC connector availability alone does not prove transaction capability. EVM wallet integrations on Base are separate.
5. **Treasuries:** Each app can configure and verify network-specific fee treasury destinations, including supported multisig/smart wallets; no seed phrase or private key collection. Changes require strong authentication, authorizations, audit trail, and do not retroactively change funded escrow payout destinations.
6. **Roles:** App owners invite staff. Each member can hold multiple app-scoped roles; permissions are additive, except explicit separation-of-duties constraints. A multi-role member counts as **one person** for N-of-M approvals. Owner console privileges do not bypass contract constraints. Application teams can include Developer, Finance, Support, Arbitrator, Admin, Viewer or suitably scoped custom roles later.
7. **Application user fees:** Every app may charge neither, the client, the worker, or both parties with **separate configured percentage rates**. Fees must be disclosed before funding, frozen for the escrow, and directed only to the app's pre-verified, committed treasury destination. Define caps, rounding, refunds and partial-settlement policies.
8. **PactAgent infrastructure fee:** Charged **to the integrating application**, independently of client/worker fees, as a contracted percentage of eligible **confirmed settled volume** (provisional commercial example 1–2%; no hardcoded universal rate). Design a separately funded, collectible app billing mechanism with a reconciled append-only ledger. No third-party escrow funds are available for ordinary infrastructure fee collection. Insufficient billing balance may block new escrows, not already-valid user settlement rights.
9. **Mutual settlements:** Full refund, full worker payout, and arbitrary valid client/worker splits. No fixed 50/50 split. Both parties must approve the same terms whenever mutual approval is required. Conservation of escrow principal and app-fee handling must be enforced with integer base units.
10. **Dispute Assistance:** Either party may request nonbinding help. Both parties may submit statements, files/images, worker proof, and settlement proposals. App's authorized support staff receives secure in-app cases and optional email alerts. Email is notification, not authority. Without arbitration authorization, app cannot unilaterally settle escrow; fallback/timeout rules must be explicit and enforceable.
11. **Arbitration:** Application-configured **opt-in**, with valid client and worker acceptance before funding; the designated arbitrators are application-controlled, **not PactAgent's own adjudicators by default**. Decisions limited to original client/worker recipients and valid allocations. No escrow custody or arbitrary transfer capability even during arbitration. Separate organization approval policy and on-chain signing enforcement (e.g., smart wallet threshold on Base, appropriate CKB cryptographic condition). Explicitly define whether/how post-funding opt-in could be possible; do not assume existing contracts support it.
12. **Settlement confirmation:** A verdict being recorded is **not** equivalent to an on-chain transfer being final. Observe chain-specific confirmation/reorg policy, ambiguous broadcast handling, idempotency, replay resistance and reconciliation before marking paid.
13. **Launch safety:** Testnet first; actual mainnet fund movement blocked pending transaction-level adversarial test coverage, external/security review as appropriate, operational readiness and regulatory review. No unsupported security or production-readiness claims.

## 3. Known repository evidence and required verification

A prior read of `main` found these items; **Codex must re-inspect HEAD and report any changes**:

- `server/prisma/schema.prisma`: Agreement currency default `CKB`, `disputeMode` default `app_managed`; Escrow rail is `mock | manual | ckb` and network `sandbox | testnet | mainnet`; dispute has resolution fields.
- `server/src/modules/escrows/escrow.validation.ts`: CKB escrow restricted to currency `CKB` and lock-script fields.
- `server/src/modules/disputes/dispute.state-machine.ts`: `release | refund | split` and related resolution statuses.
- `server/src/modules/disputes/dispute.service.ts`: dispute open/resolve pathways, active dispute uniqueness, transaction/audit events, split sum validation.
- `server/src/modules/auth/auth.routes.ts`: signature-based challenge/verification endpoints.
- `web/package.json`: CCC dependencies.
- `contracts/README.md`: CKB contract currently described as cooperative payout, cooperative refund, timeout refund. It expressly calls for VM tests and review before mainnet.
- `.github/workflows/ci.yml`: existing build, migration, supply-chain, and contract checks. Deployment workflow/history may differ; audit **current** implementation rather than assuming Kubernetes or VPS is finalized.

Audit actual module boundaries, state machines, Prisma migrations, CKB cell/lock behavior, signer providers, adapters, tenant-scoped repository operations, webhook/event ordering, audit logs, test fixtures, existing SDK/contracts and docs. Document verified evidence with paths and line references. Where uncertain, flag an open design question and give a recommended default, not an invented claim.

## 4. M0 deliverables — required repository files

Create/update appropriate repository files (adapt paths if project conventions require; explain deviations):

| Deliverable | Contents |
|---|---|
| `docs/architecture/system-design.md` | Context diagram, tenancy and authorization trust boundaries, modular contracts, data and event flows, Base/CKB/BTC rail separation, SDK/application responsibilities, background job and reconciliation model. |
| `docs/architecture/escrow-security.md` | Unified settlement state machine; source of truth per state; signed-intent schema, chain IDs, domain separation, signatures, nonce/replay rules, timeout/refund precedence, fee and split conservation, on-chain invariants, threat-sensitive admin functions. |
| `docs/architecture/dispute-arbitration.md` | Dispute Assistance vs authorized arbitration; consent capture, arbitrator selection, evidence access, proposal revisions/acceptance, escalation rules, evidence storage safety, verdict flow, settlement transition, no-consent fallback. |
| `docs/architecture/identity-treasury.md` | Developer account identity, separation from integrating apps' customer authentication, app-level multi-role RBAC permission matrix, invitation flow, step-up auth, multisig thresholds, smart wallet/CKB verification, treasury versioning. |
| `docs/architecture/fees-billing.md` | Independent app client/worker rates, examples for both-payer, full refund, custom split, and worker payout; app treasury payouts; B2B PactAgent infrastructure billing and guarantees, credit reservation/final capture/refund policy, ledger/reconciliation. |
| `docs/architecture/data-api-migration.md` | Proposed Prisma schema diff *on paper*, additive migration plan, API fields, event/webhook compatibility, asset identifiers/network/decimals, cross-tenant isolation, dual-read/write decisions, existing CKB record handling. |
| `docs/security/threat-model.md` | Assets, trust boundaries, attacker goals, STRIDE-style threats or equivalent, mitigations, residual risk, test requirements, owner and severity. Cover signature replay, bogus addresses/tokens, swap failures, tenant IDOR, forged consent/evidence, treasury updates, arbitrary arbitrator withdrawals, overpayment, double-settlement, reorgs, billing fraud, private keys and staff privilege escalation. |
| `docs/architecture/milestone-contracts.md` | M1–M13 goals, dependencies, interface contracts, per-milestone acceptance criteria, testnet/mainnet gates and explicit deferrals. |
| `AGENTS.md` and `.agents/skills/.../SKILL.md` | Persistent context/instructions for Codex (architecture, repository workflows, secure money-code changes, migrations, tests, commit/PR discipline). Favor minimal, nonduplicative instructions and scope narrowly where appropriate. |
| `docs/architecture/M0-DECISIONS.md` | Decision register: accepted, recommended-but-unconfirmed, rejected and deferred choices, with rationale. |
| `docs/architecture/M0-REPORT.md` | Audit findings, created files, conflicts/open questions, validation performed, readiness determination and next steps. |

## 5. Architecture subjects requiring implementation-ready specifications

### 5.1 Multi-rail payment core

Specify stable internal `AssetId` (e.g., chain namespace, chain ID, token contract/asset identity), integer base units and rounding. Distinguish **USDC** asset from arbitrary tokens with matching symbol; prohibit accepting an unverified token. Define `EscrowRail` interface with capabilities for create/fund/observe/release/refund/split/arbitrate; per-rail deviations must be explicit. Avoid forcing Base semantics on CKB UTXO/cell logic or BTC UTXOs.

### 5.2 Base native USDC

Specify Solidity escrow contract authorization and token transfer security; funding by approval/transfer workflow; non-reentrancy, trusted token only, immutable recipient and arbiter binding, immutable fee policy, escrow-per-milestone vs pooled architecture tradeoff, event and indexer contract, Base Sepolia tests. Confirm authoritative USDC deployment addresses and network specifics *during M2* using official sources; do not hardcode unverified addresses in M0.

### 5.3 CKB escrow upgrade

Inspect existing contract's signing and timeout mechanics. Propose an explicit cryptographic contract change for custom splits, fees and opt-in arbitration, accounting for cell capacity, signature threshold, and locked output constraints. Do not claim these already work. Plan test vectors and backwards compatibility for existing CKB escrow cells; never change historical lock commitments in place.

### 5.4 Identity, approvals and evidence

Define a trustworthy mapping from integrating application's user IDs to verifiable client/worker settlement consent; app API key alone cannot impersonate a user for disposition of funds. Evidence is separately stored (e.g., private object store), scanned/validated, immutable or versioned with content hashes; signed access URLs are short-lived and scoped. Emails contain case references, not publicly accessible attachments.

### 5.5 Billing and fee conservation

Distinguish escrow principal, escrowed client fees, worker-allocated app fees, application treasury distributions, protocol gas/capacity, and PactAgent off-escrow infrastructure fees. Document exact arithmetic in integer token units, dust policy, cancellations, refunds, and pending settlement conditions. Infrastructure fee assessed on a clearly defined, finalized eligible gross volume; for CKB-to-USDC billing, define price source and valuation timestamp before implementation.

### 5.6 Authorization and liveness

Define mutual agreement and arbitration settlement authority with an explicit no-arbitration path. Analyze arbitrator compromise, loss of participant keys, dispute timeout, escrow liveness, and double-signature/replay risk. Avoid unconditional refund after dispute or indefinite unexplained lock. A dispute-resolution record is only an instruction; funds settle only upon confirmed valid chain transaction.

## 6. Milestone execution map (contract-level, not code in M0)

- **M1:** Asset registry, rail abstractions, additive model and API groundwork.
- **M2:** Native USDC/Base Sepolia contract and adapter; fund, release, refund, custom split, reconciliation; arbitration permissions designed from day one.
- **M3:** Console accounts, invitations, multi-role per-app RBAC.
- **M4:** Treasury verification, network-specific destinations, Safe/CKB multisig integration and high-risk approval policy.
- **M5:** App client/worker fee policies and separately funded PactAgent B2B billing ledger.
- **M6:** Two-sided evidence, dispute assistance, negotiated outcomes and notifications.
- **M7:** Application-configured arbitration consent, adjudicators, verdict approval and contract-enforced execution on Base and CKB.
- **M8:** CKB custom split, fees and arbitration script upgrades with VM tests.
- **M9:** Versioned APIs, SDKs, integration guides, sandbox/webhooks.
- **M10:** Adversarial/integration testing, staging, reconciliation, operational and security launch gates.
- **M11:** Native Bitcoin escrow design and implementation after independent Bitcoin security review.
- **M12:** Optional provider-neutral CKB↔USDC swaps when verified production-compatible routes exist.
- **M13:** Demand-led future rail expansion and optimizations.

M2 and M8 must implement the M0-approved arbitration authorization primitive even if dashboard adjudicator workflows are delivered in M7. Avoid dangerous contract retrofits that strand funds.

## 7. Codex execution rules

1. Start by reading this file in full, then inspecting repository HEAD and existing `AGENTS.md`, skills, docs, schemas, source, contracts, CI and deployment configuration.
2. Create a dedicated branch if appropriate. **Do not commit directly to `main` or `staging`**, and do not merge or deploy.
3. Respect repo's naming conventions and existing architecture. Produce substantive docs with actual data structures, API examples, sequence and state diagrams (Mermaid where useful), exact financial invariants and meaningful security analysis; avoid generic prose.
4. Do **not** change runtime/business logic, smart contracts, API routes, Prisma schema or migrations, CI deployment flow, infrastructure resources or real secrets. This milestone is specification-and-instructions-only.
5. Design options that are unsettled must be called out with tradeoffs and a recommended default; no silent policy assumption.
6. Write Codex skills that make subsequent work persistent, test-driven and security aware; avoid duplicating entire architecture specs in skills—link to them.
7. Validate document references/relative links, markdown structure and skill discoverability; run relevant repository static/document checks if available. Record every check executed; do not claim contract functionality was tested if not run.
8. Create reviewable commits and a PR summary only if repository policy permits. **Do not merge or deploy**. Report modified paths, design decisions, unresolved blockers and readiness for M1.

## 8. M0 exit/acceptance criteria

M0 is accepted only when:

- Every listed deliverable exists and accurately reflects **current** repository state.
- Chain-specific and common authorization responsibilities are explicit.
- Both the client and worker can authorize mutual settlement; application adjudication cannot move assets without pre-agreed enforceable authority.
- Percentage fee rules cover client-only, worker-only, both, none, partial payout, full refund and app B2B charges.
- Exact principal conservation, asset precision, replay/idempotency and confirmation state rules are stated.
- Application multi-role RBAC and multisig's *distinct-person* threshold are specified.
- Backward-compatible migration and CKB escrow preservation plans are included.
- Native BTC and swaps are deferred cleanly without preventing the USDC plan.
- Threat model contains concrete attack scenarios and verification steps.
- Codex project skills exist and point to canonical docs.
- No functional code, contract, schema, production credential or deployment behavior was changed.
- `M0-REPORT.md` lists remaining decisions and a precise handoff to M1.

**Success is a reviewable implementation blueprint, not a claim of production readiness.**
