# Trust and tenant boundaries

```mermaid
flowchart LR
  O[Operator wallet] -->|JWT| API[API process]
  I[Integrator] -->|App API key| API
  API -->|appId-scoped queries| DB[(PostgreSQL)]
  API -->|rate limits and auth challenges| R[(Redis)]
  W[Infrastructure worker] -->|durable claims| DB
  W -->|signed requests| H[Webhook destinations]
  API -->|chain reads and broadcast| C[CKB node]
  API -->|script/cell searches| X[CKB indexer]
  W -->|reconciliation reads| C
```

Internet clients, webhook destinations, CKB RPC providers, and telemetry collectors are untrusted. PostgreSQL is authoritative. Redis stores disposable distributed coordination state and one-time wallet challenges. Secrets enter through environment variables or mounted files and must never enter logs, health responses, job payloads, audit metadata, or webhook payloads.

`App` is the infrastructure tenant. API-key middleware resolves exactly one `appId`; controllers do not accept tenant identity from request bodies. Repository reads, writes, cursors, idempotency keys, events, audit records, jobs, and webhook records remain app-scoped. Administrative cross-tenant access requires wallet authentication, an allowlisted admin identity, and audit logging.

Operator wallet authentication manages infrastructure ownership; it is not a product-user identity domain. Participant identities on agreements remain opaque external IDs owned by the integrating application.
