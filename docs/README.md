# PactAgent documentation

Start with the root `README.md` for setup and platform behavior, and
`CONTRIBUTING.md` for source-code placement rules.

## Documentation map

- `architecture/`: service boundaries, settlement, environments, and financial rules
- `adr/`: durable architecture decisions
- `operations/`: repository-wide ownership, performance, and release checklists
- `configuration.md`: environment and application configuration
- `infrastructure-implementation-roadmap.md`: phased infrastructure work
- `../server/docs/`: API lifecycle material, OpenAPI artifacts, integration examples,
  and server runbooks whose current paths are used by runtime or compliance checks

Keep new repository-wide documentation here. Keep generated API specifications or
documents that are loaded by server code under `server/docs/` until their runtime
paths are deliberately migrated and validated.

## M0 multi-rail blueprint

The [M0 report](architecture/M0-REPORT.md) indexes the architecture/security deliverables, current-code audit and validation. Read the [authoritative specification](../M0_ARCHITECTURE_SPEC.md) and [decision register](architecture/M0-DECISIONS.md) before implementation. These describe proposed work; existing behavior documents are not evidence that the new capabilities are implemented.

The [M0 decision review](../M0_DECISION_REVIEW.md) and [evidence-linked findings](architecture/M0-DECISION-REVIEW-FINDINGS.md) record proposed choices and outstanding approval gates. They do not authorize M1 or amend the accepted decision register.

## M1 foundation (review required)

- [M0 product-direction approval](architecture/M0-PRODUCT-APPROVAL.md); specialized approvals remain open.
- [M1 implementation](architecture/M1-IMPLEMENTATION.md) and [validation report](architecture/M1-REPORT.md).
- [Authoritative M1 scope](../M1_MULTI_CHAIN_FOUNDATION_SPEC.md).

## Approved internal governance, pricing and future CKB record scope (2026-11-09)

- [Internal PactAgent staff roles, dual-control finance and active–standby deputy](architecture/internal-staff-governance.md).
- [Per-asset/per-application PactAgent B2B platform fee policy](architecture/platform-fee-policies.md).
- [M14 — CKB record commitments, batched audit verification and reusable PactAgent-funded cell capacity](architecture/M14-CKB-ONCHAIN-RECORDS.md).

These are accepted product directions, **not implemented features, independent security approval or permission to deploy**. Internal staff administration does not include managing integrating applications' employees. Existing M2 draft work and M8 settlement scope remain separate.
