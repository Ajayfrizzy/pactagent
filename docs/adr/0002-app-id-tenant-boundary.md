# ADR 0002: App ID is the infrastructure tenant boundary

- Status: accepted
- Date: 2026-07-19
- Owners: API and Security owners

## Decision

Every infrastructure resource carries `appId`. API keys resolve to one app and repositories include that app ID in reads and mutations. Cross-app references are rejected by composite database constraints. A missing tenant-owned resource is returned as not found to avoid existence disclosure.

The retired `/api` product surface has no lifecycle implementation. It returns `410 Gone`; all supported external operations use `/v1`.
