# ADR 0003: Settlement is explicit, idempotent, and reconciled asynchronously

- Status: accepted
- Date: 2026-07-19
- Owners: Settlement and Data owners

## Decision

Database approval is not proof of on-chain finality. Settlement operations first reserve an idempotent state, submit through the configured signer, persist transaction identity, and become confirmed only after chain reconciliation. Ambiguous provider failures remain pending or failed for reconciliation; they are never blindly resubmitted.
