# M15 — Production documentation, developer experience and knowledge base

Status: **approved future milestone scope (2026-11-17); not implemented, deployed or authorized to begin**. This milestone turns verified PactAgent capabilities into dependable launch-ready documentation. It is **not** a hackathon submission or a license to change the agreed architecture.

## Product intent and audiences

PactAgent provides B2B agreement, milestone, escrow, dispute, payment and verification infrastructure to **integrating applications**. The integrating applications own their customers, their own staff and end-user experience. The documentation must enable a developer unfamiliar with PactAgent to integrate without private guidance; it must separately equip PactAgent operators to maintain, secure and recover the platform.

1. **Public integrator documentation:** company/developer evaluation, onboarding, API keys, permissions, quickstarts, integration guides, SDKs, API reference, sandbox, webhooks, test scenarios, fees, security, troubleshooting, changes/deprecations.
2. **Private internal operator documentation:** architecture and threat models, admin RBAC and finance dual-control, treasury/capacity management, billing/reconciliation, deployments, monitoring, incident response, backup/restore and disaster recovery, support/compliance procedures and audit evidence.
3. **Repository contributor documentation:** local development, architecture boundaries, commands, migrations, tests, release procedures, compatibility and decision records.

Public vs private visibility is a **security decision**: do not publish incident credentials, protected staff identities, recovery steps exposing secrets, infrastructure inventories, vulnerability exploit specifics, or sensitive internal runbooks. Explain public trust boundaries without publishing secrets.

## Important timing and prerequisites

Maintain accurate technical docs **throughout** M1–M14 and subsequent work. M15 is a **consolidation, validation, site/build and legacy-cleanup milestone** following completion of the launch-scope capabilities and before public launch. Documentation can be incrementally designed and tested; the M15 completion gate requires actual final APIs, tested network behavior, SDKs and billing policies, plus an approved launch scope. Do not claim M11 Bitcoin, M12 swaps, M14 attestations or other unlaunched features are available. Distinguish *available*, *testnet*, *preview*, *planned* and *disabled* by rail, network, endpoint and release.

Dependencies: verified M9 API/SDK/webhook contracts and M10 applicable readiness/security evidence, plus accepted functionality from M3–M8 and M14 **only if included in the launch scope**. M15 documentation does not automatically authorize production deployment, smart-contract changes, billing changes or deletion of historical evidence. Select the documentation framework/hosting after architectural review, favoring open-source and existing/free-tier resources. A proposed `docs.pactagent.com` is a URL concept, not a provisioned domain or deployment.

## Public documentation information architecture

The public navigation should support both **learning paths** and a **searchable reference**.

| Section | Required coverage |
| --- | --- |
| Introduction | Value proposition, architecture at the integrator boundary, supported asset/chain/network matrix, terminology, trust/custody limits |
| Getting started | Account and application onboarding; sandbox setup; first API key; first agreement/milestone; test escrow lifecycle with expected results |
| Identity and API security | App-scoped keys/scopes, key rotation, tenant isolation, secure storage, auth errors, environment and network separation |
| Agreements and milestones | Creation, versioned terms, lifecycle rules, idempotency, parties, proof submission and review |
| Escrow and settlement | Funding, locked terms, chain-specific consent, release, full/partial refund, custom split, confirmed vs pending vs ambiguous/reorged |
| Disputes and arbitration | Opt-in policy, evidence, nonbinding support vs authorized arbitration, deadlines/fallback differences between rails, how payouts become final |
| Fees and billing | PactAgent charges **integrating applications only**; app-defined client/worker fees remain separate; per-asset fees, CKB incentives where effective, chain fees, CKB cell capacity ownership, quotes and billed-event examples |
| Webhooks and events | Full event catalog, sample payloads, raw-body HMAC verification, retries, duplicates/reordering, idempotent consumers and reorg corrections |
| SDKs and API reference | Versioned generated OpenAPI, copyable language examples, request/response/error models, pagination/rate limits where implemented |
| CKB verification | Record commitments, milestone/dispute hashes, Merkle inclusion, capacity recycling and independent verification **only if M14 shipped** |
| Operational integration | Observability, reconciliation expectations, errors, outages, key loss, test environments, FAQ and troubleshooting |
| Releases | Changelog, versioning, breaking changes, support/deprecation timelines and migration guides |

A full end-to-end guide must demonstrate **how to build an escrow-powered application using PactAgent**, from application registration to canonical settlement verification and webhook recovery. Cover supported CKB and USDC rails separately with clear launch-state badges; BTC only when independently approved and implemented. Provide an app-to-PactAgent architecture diagram showing what the integrating app must do itself.

## Documentation website UX

- Search; clear desktop sidebar and mobile navigation; section breadcrumbs; logical next/previous links; accessible keyboard navigation.
- Task-first quickstarts with prerequisites, complete runnable example code, environment-specific expected output and tested error paths; copyable snippets with safe placeholder credentials, not real secrets.
- Language selector only for actually tested samples; API version and network selector where versions materially differ; accuracy overrides decorative features.
- API endpoint pages generated or validated against checked-in OpenAPI and route parity, with request/response schemas and authorization scope.
- Landing page cross-linked from PactAgent's official website, console and repository README; stable URLs, meaningful redirects, sitemap, page titles and discoverability checks.
- Avoid claims of certification, independent auditing, or mainnet support without evidence. Clearly mark planned/testnet/preview features.

## Internal and contributor documentation

Maintain authoritative, access-controlled references for architecture diagrams, domain models, chain contracts, database schema/migration policy, tenancy, treasury/signers, staff privileges, deputy finance activation and two-person financial approvals, incident triage, security posture, financial journals and reconciliations, monitoring/alerts, on-call, backfill, rollback, backups, disaster recovery, postmortems and regulated-data handling where applicable. Provide redacted public security summaries where helpful.

Preserve existing `AGENTS.md`, repository-local Codex skills, architectural decisions, security findings, M0–M14 evidence and migration history until classification and verified replacement. Internal operational steps need named owners, prerequisites, expected outcomes and rollback/recovery conditions. Never put secrets or live personal data into docs fixtures.

## Work packages

| Package | Delivery | Acceptance |
| --- | --- | --- |
| M15.1 — Audit and ownership | Inventory every `docs/`, `server/docs/`, README, ADR, evidence artifact and Codex skill; designate public/private/keep/rewrite/archive/delete candidate | File-by-file disposition registry, authoritative-source mapping, owners and sensitive-content review |
| M15.2 — Information architecture | Navigation map, audience journeys, public/private separation, route/content taxonomy, search/SEO/accessibility specifications | Reviewable structure and sample pages; no broken links or duplicated conflicting authority |
| M15.3 — Website foundation | Chosen open-source docs stack and free/existing hosting, versioned navigation, search, mobile access, redirects, CI checks | Reproducible preview/build, accessibility audit and security review |
| M15.4 — Getting-started guides | Onboarding, API credentials, sandbox and complete tested first-escrow integration with code snippets | Fresh-user test from empty environment, no unpublished knowledge or hand edits required |
| M15.5 — Product guides | Agreement/milestone, payment rails, fees/billing, disputes, arbitration, CKB attestations if launched | Real workflows against supported environments, negative cases and feature availability labeling |
| M15.6 — API/SDK/webhook reference | Generated/validated OpenAPI, versioned reference, tested SDK examples, event catalog and webhook verification | CI detects drift; runnable examples cover real API and signature/error/retry behavior |
| M15.7 — Internal runbooks | Operations, security, treasury/finance approvals, monitoring, deployment, recoveries, incident drills | Operator exercises and independent review; access-controlled publication |
| M15.8 — Historical cleanup | Keep authoritative docs, rewrite outdated hackathon docs, archive evidence/ADRs, delete proven redundant drafts only | Reviewed inventory; no active code/CI refs broken; reversible archival and retained audit/security evidence |
| M15.9 — Release gate | External integrator walkthrough, full link/redirect check, docs CI, security/privacy and launch-scope check | Signed readiness checklist, correct capability matrix, documented ownership and update policy |

## Cleanup and deletion safeguards

1. **Never mass-delete milestone reports just because development is complete.** Security reviews, signed decisions, audit evidence, migrations, release attestations and incident records remain retrievable under documented retention policy.
2. Prefer an archive with a manifest, timestamps, provenance and preserved Git history for superseded but evidential documents. Remove only verified duplicates or temporary drafts after link/reference inspection.
3. Before deleting/moving a document, search code, CI, tests, OpenAPI generators, agent skills, references, compliance workflows and external docs links; replace or redirect all active references.
4. Make public-facing docs authoritative for *released behavior*; internal specs remain authoritative for *engineering requirements*; ADRs and old reports are historical evidence rather than marketing.
5. Every documentation change gets a staged branch/PR, review and relevant checks. Do not mix M15 cleanup with application behavior changes without a separate approved scope.

## Release and documentation quality policy

- Each new/revised API or feature milestone updates its spec, examples and release notes at implementation time; M15 validates and publishes the complete set, not reconstructs undocumented behavior from memory.
- Documentation examples must be executable in CI or explicitly verified against supported sandboxes; errors and permissions must be checked. Include network/version constraints and precise expected results.
- A developer with **no prior knowledge** must create an app, obtain credentials, call an agreement/milestone endpoint, run the supported sandbox escrow lifecycle, validate settlement, and correctly process a signed webhook **using only published docs**.
- API schema drift, broken links, invalid snippets, wrong feature-status claims and exposed secrets block publication.
- Public launch documentation is complete only when engineering, security/operations and product review approve the launch-scope accuracy; full financial rail go-live still requires its own release gates.

## Codex execution contract

When explicitly instructed to implement M15, Codex must: (1) read `AGENTS.md` and relevant repository skills; (2) read this M15 spec and current M9/M10/M14 evidence; (3) inventory actual code/endpoints before claims; (4) propose and record docs architecture/hosting/visibility decisions **before coding**; (5) sequence deliverables M15.1–M15.9 with tests and owners; (6) do not invent unsupported rails or delete without an approved disposition log; (7) work on a branch off `staging`, PR only; (8) never deploy, merge or delete evidence absent separate explicit approval.

**Current authorization:** record the milestone for future execution only. No implementation, cleanup, deployment, pricing or mainnet changes are authorized here.
