# Environment policies

| Environment | Policy |
| --- | --- |
| `development` | Localhost CORS and optional Redis are allowed; mock/manual rails are the default. |
| `test` | Deterministic fixtures, isolated databases, local rate-limit fallback, and mock rails. |
| `staging` | Production-shaped secrets, explicit CORS, Redis, webhook egress, worker readiness, and testnet CKB readiness. |
| `production` | Strong keyrings, fail-closed distributed rate limits, controlled webhook egress, worker readiness, and explicit CKB RPC readiness policy. |

Sandbox apps use `pa_test_` keys. Production apps use `pa_live_` keys and production webhook URL policy. App environment does not weaken process-level staging or production controls.

The CKB escrow adapter is not implemented in Phase 1. `CKB_NETWORK` and `CKB_NODE_URL` configure wallet connectivity and optional readiness only; they do not imply automated settlement capability.
