---
name: pact-architecture
description: Audit or design PactAgent architecture and milestone contracts, distinguishing verified implementation from proposed multi-rail capabilities.
---

Read the root [specification](../../../M0_ARCHITECTURE_SPEC.md), [system design](../../../docs/architecture/system-design.md), [decision register](../../../docs/architecture/M0-DECISIONS.md) and the relevant [milestone contract](../../../docs/architecture/milestone-contracts.md).

Inspect current HEAD and cite file/line evidence before claiming a capability. Keep current behavior, accepted product constraints, recommended defaults and deferred work distinct. Update the decision register when changing trust boundaries; do not silently resolve commercial or timeout choices. Preserve app-owned customer authentication, participant-controlled funds and independent rails. CKB v1 capabilities are not v2 capabilities; Base native USDC does not depend on swaps or BTC.

During M0 edit only docs/instructions and validate references, Markdown, skill discovery and changed-path scope. For later authorized milestones check dependencies and unresolved gates before implementation; this skill does not authorize starting the next milestone. Report evidence, limitations and precise handoff in the architecture report.
