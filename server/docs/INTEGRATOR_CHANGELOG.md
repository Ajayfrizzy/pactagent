# Integrator Changelog

## Unreleased

- WebSocket authentication moved from URL query parameters to `Sec-WebSocket-Protocol`.
- Distributed rate limits now return standard limit and retry headers.
- Idempotency records have a bounded processing lease, retention period, and response size.
- `/v1` OpenAPI changes are now checked for removed operations in CI.

Breaking changes must include migration instructions, announcement date, deprecation date, and sunset date.
