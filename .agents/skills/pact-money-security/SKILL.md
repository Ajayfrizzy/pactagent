---
name: pact-money-security
description: Implement or review PactAgent escrow, signing, fees, billing or rail reconciliation under explicit money and authorization invariants.
---

Read [escrow security](../../../docs/architecture/escrow-security.md), [fees and billing](../../../docs/architecture/fees-billing.md) and relevant rows of the [threat model](../../../docs/security/threat-model.md). Check [unconfirmed decisions](../../../docs/architecture/M0-DECISIONS.md) before encoding policy.

Before an authorized implementation, identify the exact signer, immutable terms, source of finality and integer conservation equation. App keys, staff roles and dispute verdicts are not participant signatures. Keep fee deposits, principal, capacity/gas and B2B billing separate. Reject unsupported capabilities before funding. Persist recoverable signed operation identity before broadcast; ambiguity/reorg retains scope and cannot trigger a second payout.

Use adversarial tests appropriate to the changed layer: altered terms/chain/recipient, replay, simultaneous release/refund/fallback, insufficient capacity, rounding/max values, lost broadcast responses, canonical block changes and duplicate ledger capture. Contract authorization changes need actual VM/transaction tests, not only pure helper tests. For CKB include cross-lock-group output reuse and supported wallet witnesses; for Base include ERC-1271, token failure/reentrancy and immutable arbiter policy. Preserve v1 cells and forbid retroactive destination changes.

Record tests actually run and unresolved risks. No production funds, mainnet enablement or contract deployment is implied by this skill. M0 remains documentation-only.
