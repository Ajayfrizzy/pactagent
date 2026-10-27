# PactAgent repository instructions

Read [M0_ARCHITECTURE_SPEC.md](M0_ARCHITECTURE_SPEC.md) for the authoritative M0 scope and [M0-REPORT](docs/architecture/M0-REPORT.md) for audited baseline, unresolved decisions and handoff. Read [CONTRIBUTING.md](CONTRIBUTING.md) before implementation. M0 permits documentation/instructions only; no runtime, contracts, schema/migrations, infrastructure changes, merge, deployment or progression to M1 without a subsequent authorized task.

Preserve the modular monolith and authenticated appId boundary. Applications own customer authentication and business rules. API keys, console ownership and recorded verdicts do not authorize movement of participant funds. Funded recipients/fees/authority are immutable; paid requires verified chain confirmation. Never collect user seeds/private keys or use third-party escrow for B2B fees. Keep existing CKB v1 commitments and unsupported-capability errors explicit.

## Repository-local skills

Load the relevant skill when its scope applies; the linked documents are canonical, not duplicated policy:

- [pact-architecture](.agents/skills/pact-architecture/SKILL.md): architecture audits, milestone boundaries and design decisions.
- [pact-money-security](.agents/skills/pact-money-security/SKILL.md): funds, authorization, contracts, rail reconciliation and billing changes/reviews.
- [pact-data-api](.agents/skills/pact-data-api/SKILL.md): tenant data, additive migrations, API/SDK/event compatibility.

Use dedicated branches, never commit directly to main/staging. Keep commits focused and reviewable; review the staged diff for secrets, generated files and unrelated changes. PR summaries state behavior/scope, decisions, tests actually run and remaining gates. Do not infer permission to send messages, publish, merge or deploy from these instructions.

For authorized implementation, follow CONTRIBUTING checks and the applicable milestone's adversarial tests. For docs-only work validate links, evidence line references, Markdown and skill frontmatter; run relevant available static checks and record unavailable prerequisites. Do not claim a VM/security/production result from unit tests or prose. Unconfirmed recommendations in M0-DECISIONS remain unconfirmed until recorded stakeholder acceptance.
