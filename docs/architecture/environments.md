# Environment policies

| Environment | Policy |
| --- | --- |
| `development` | Localhost CORS and optional Redis are allowed; mock/manual rails are the default. |
| `test` | Deterministic fixtures, isolated databases, local rate-limit fallback, and mock rails. |
| `staging` | Production-shaped secrets, explicit CORS, Redis, webhook egress, worker readiness, and CKB disabled until an external signer exists. |
| `production` | Strong keyrings, fail-closed Redis controls, controlled webhook egress, worker readiness, and CKB/mainnet disabled until external signing and testnet evidence are complete. |

Sandbox apps use `pa_test_` keys. Production apps use `pa_live_` keys and production webhook URL policy. App environment does not weaken process-level staging or production controls.

Development may explicitly enable the CKB testnet rail with a mounted local signer key. Staging and production reject local signing, require Redis for wallet challenges/rate limits, and fail startup if CKB is enabled with the unavailable external signer. `REQUIRE_SETTLEMENT_READY=true` checks both configured node and indexer; RPC health alone is not evidence that signing or settlement is production-ready.
