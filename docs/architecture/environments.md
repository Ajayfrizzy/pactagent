# Environment policies

| Environment | Policy |
| --- | --- |
| `development` | Localhost CORS and legacy routes may be enabled. Local signer and optional Redis are allowed. |
| `test` | Deterministic fixtures, isolated databases, mock providers, and no production secret requirements. |
| `staging` | Production-shaped secret, CORS, Redis, signer, and legacy-route restrictions. Testnet settlement is recommended. |
| `production` | Mainnet-capable managed signer, strong secrets, fail-closed rate limits, worker and settlement readiness, and disabled legacy routes. |

Sandbox apps use mock/manual rails and `pa_test_` keys. Production apps use `pa_live_` keys and production webhook HTTPS policy. App environment does not weaken process-level staging or production controls.
