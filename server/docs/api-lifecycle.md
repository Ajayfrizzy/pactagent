# API Lifecycle Policy

`/v1` is the stable integrator API. Backward-compatible fields and endpoints may be added within v1. Removing or renaming fields, changing field meaning, tightening accepted input, removing response codes, or changing pagination ordering requires `/v2`.

Deprecations are announced in the integrator changelog and response `Deprecation` and `Sunset` headers at least 90 days before removal. Security-critical removals may use a shorter period with direct customer notification.

The OpenAPI document is a tested contract. `npm run openapi:check` validates the schema and confirms documented operations exist in Express. CI compares pull requests with the main-branch contract and rejects removed v1 paths or operations.

Cursor pagination ordering must remain deterministic, with the record ID as the final tie-breaker. Reusing a cursor must not duplicate or skip unchanged records. All errors use the standard `{ error: { type, code, message, requestId } }` envelope. New error conditions require stable snake-case codes.

Rate-limit responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After`. Sensitive mutations require an `Idempotency-Key` of at most 200 characters. Keys are scoped to an app and request hash, retained for the configured retry window, and conflicting reuse returns HTTP 409.
