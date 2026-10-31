# M2 report — G0 review package, milestone incomplete

Prepared 2026-10-31 on `feature/m2-base-usdc-escrow` from latest `origin/staging` **`5e30d6eb336087b65dde3ffdb880abf07d7c0c78`**. GitHub confirms PR #118 is merged with that SHA, and ancestry was checked locally. Production `origin/main` remains **`a526b78a1fb2f7282be366c0bd0bf29f4af702b2`**. No merge, contract deployment, transaction, infrastructure provisioning, funds use or M3 work occurred.

## Work packages and scope

| Package | Delivered | Outstanding / blocked |
| --- | --- | --- |
| M2.1 | Current M1 audit, eight proposed design choices, authority/state model, conservation argument, threat model and source/chain evidence | Architecture acceptance, immutable arbiter/wallet policy approval, exact ABI/vectors, compiler/library pins and gas comparison |
| M2.2 | Reviewed requirements and proposed execution branches documented | All Solidity contract implementation and EVM security validation; no bytecode/factory/deployment claims |
| M2.3 | Read-only fail-closed evidence probe and versioned non-activating manifest | Independent identity/implementation/provenance verification and actual Base adapter; candidate remains unavailable |
| M2.4 | Durable pipeline, reorg, tenant/idempotency and additive schema design constraints documented | Schema review, migrations, storage, broadcasting, observer/reconciliation implementation |
| M2.5 | Proposed scoped API resource model and unsupported capability table | Reviewed OpenAPI/signing API and SDK/end-to-end example; no financial routes added |
| M2.6 | Deterministic probe tests and existing compatibility/policy checks | Actual EVM/fuzz/invariants/local node and new persistence integration; G2 testnet deployment not authorized |

This is intentionally **not an M2 completion or release claim**. Spec §7 G0 says “where unproved, continue non-financial scaffolding only and flag the affected contract work”; §3 requires architecture approval before immutable bytecode/API assumptions are finalized. The [design review](M2-DESIGN-DECISIONS.md) and [threat model](../security/M2-THREAT-MODEL.md) are the concrete package for that review. No reviewer acceptance has been fabricated.

## Audit and security findings

- M1 asset registry exposes a deliberately unavailable Base candidate; no verified deployment exists. It must not be mutated to activate historical identities.
- M1 lifecycle evaluation accepts already-verified evidence; it does not verify receipts/signatures/providers. Treating it as an actual observer would permit false finality.
- M1 foundation/operation/attempt/observation records are append-only and operation state is unauthorized-only. Existing legacy foundation allowlists do not model live EVM escrow. A reviewed versioned additive persistence design is required, not relaxed old checks.
- PR #118 exact numeric `div` and `FOR UPDATE`/MVCC serialization corrections remain intact. No applied migration was edited.
- Existing event repository supports transactional outbox writes; existing job leases are useful but do not provide permanent payment idempotency. Signed artifacts must exist durably before broadcast.
- Token proxy code identity is insufficient to attest its implementation. Issuer upgrades/blacklists/pause and mutable ERC-1271 participant ownership remain explicit threats.
- The proposed fixed EOA arbiter set avoids mutable threshold dependencies but deliberately forbids arbitral contract-wallet rotation; this needs architecture review.
- Canonical finalized observation from one RPC is evidence, not independent finality proof. Unknown/disagreeing evidence must never produce paid or a second payout.

## Verification evidence

[Source/identity manifest](evidence/m2/network-manifest.json) includes retrieval dates, official URLs and document hashes. Circle's live listing confirms the expected test token address; Base's current official connection page confirms chain 84532. Old Base connection URL returned 404 and finality URL redirected, so canonical URLs are recorded.

Initial Python RPC attempts returned HTTP 403. Later read-only Node probe succeeded at `2026-10-31T21:06:23.309Z`: chain ID 84532, six decimals, code at finalized block `0x3257e05`, canonical hash `0x7e67ffe87909a93bc276823783eafb278ce345bfb94e6aadf0409c1518c00554`. [Raw observation](evidence/m2/rpc-observation.json) contains bytecode and its SHA-256 evidence digest; the manifest adds its Keccak-256 using installed @noble/hashes 2.4.0. Neither digest verifies proxy implementation, deployment provenance or independent-provider agreement. Factory/escrow addresses remain null; no activation is authorized.

Local Node: **26.12.1**, macOS arm64. Commands run with that Node on PATH:

| Check | Result |
| --- | --- |
| `node --test scripts/m2-network-probe.test.mjs` | 16 passed: wrong chain, missing finalized, code/decimal malformation, canonical change, provider switch, RPC errors, read-only transport and no activation |
| `NODE_ENV=test REDIS_URL='' REDIS_URL_FILE='' npm test` | 103 passed; first sandbox attempt could not bind loopback, rerun with local socket access passed |
| `npm run lint` | Server/web TypeScript passed |
| `npm run build` | Server and Next.js production builds passed locally; no deployment |
| `npm run openapi:check --workspace @pact-agent/server` | 60 existing operations validated |
| `npm run controls:check`, `deploy:check`, `observability:check`, `phase7:check` | Passed; 27 controls, 10 manifest resources, 2 deployment validator tests, 12 alerts/6 dashboards and performance policy |
| `npm run licenses:test`, `licenses:check`, `audit:test`, `env:check` | Passed; 4 license tests, 826 installed packages, 5 audit-policy tests, 88 environment variables |
| `npm run audit:dependencies` | Passed; no high+ vulnerability records required exceptions |
| Markdown relative links, JSON parsing, authored-file `git diff --check` | Passed; supplied specification retains its intentional Markdown hard-break spaces |
| Migrations, populated upgrades, CKB host tests, clean lockfile installs, image scans | Existing required CI retained; remote result recorded separately below. Not claimed as locally rerun |
| EVM/backend Base integration | Not run: no financial implementation exists |

CI adds the offline probe test invocation to the existing workspace job. Initial secret scanning flagged five occurrences of the public Circle address and public code digests as generic API keys. `.gitleaks.toml` retains every default rule and adds three exact-value AND exact-path exceptions for that public evidence; no credential pattern or entire path is exempt. Permissions remain read-only, no live RPC test, secrets, auto-merge or deployment step was added. Passing these checks is not financial security assurance.

## Handoff / decisions needed

Review the eight proposed decisions in [M2-DESIGN-DECISIONS](M2-DESIGN-DECISIONS.md), especially immutable arbitral EOA threshold versus ERC-1271 participant mutability, full deployment versus measured pinned-clone alternative, D/T invocation semantics, exact signing codec and versioned EVM persistence. Supply named architecture acceptance and resolve remaining independent identity/proxy provenance evidence before treating G0 as passed. Implement and independently review the still-outstanding work packages locally, then rerun the entire mandatory adversarial matrix. G2 needs separate faucet-only deployment approval; this task expressly prohibits deployment. G3 and M3 remain out of scope.

## Remote validation and scanner correction

Draft PR: https://github.com/Ajayfrizzy/pactagent/pull/119. Initial implementation commit: `bc67848bedcacb9d17698aad67e2d7876238cd59`.

Initial [CI run 41242399360](https://github.com/Ajayfrizzy/pactagent/actions/runs/41242399360) passed **11 of 12 jobs**, including all three clean lockfile installs, server/database migrations and populated upgrades, CKB host tests, builds and all three container vulnerability scans. Secret scanning alone reported the five public-evidence matches described above; this was a real failed check, not treated as a pass.

The correction was validated using the same Gitleaks **8.24.3** as CI: scanning the full branch commit range with the new config reports no leaks. Three isolated fixture checks show the exact public address is allowed only at its designated evidence path, a different synthetic credential at that same path is still detected, and the same public address at an unrelated credentials path is still detected. No history was rewritten, no check disabled, no blanket address/hash/file exemption added. The follow-up commit runs the full required CI again; consult the PR's latest-head checks for the result.
