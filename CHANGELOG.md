# Changelog

All notable changes to PactAgent is documented in this file.

The format is based on Keep a Changelog, and this project follows a simple semantic versioning style where possible.

## [Unreleased]

### Added

- Public profile support for wallet-native identity, including profile metadata, public profile routes, and profile settings.
- Lightweight reputation snapshots derived from agreement outcomes, disputes, settlement behavior, and milestone activity.
- Invite link support for draft agreements and direct participant onboarding flows.
- Public profile and invite APIs for ecosystem-facing access.
- Webhook endpoint management with signed delivery payloads, delivery logs, retry handling, and event subscriptions.
- DAO and bounty import support with source attribution metadata preserved on agreements.
- Web UI pages for:
  - profile settings
  - public profiles
  - invite acceptance
  - webhook management
  - DAO/bounty import

### Changed

- DAO/bounty import now supports a true grant-style flow with multiple milestones and a visible total amount to lock upfront.
- Imported DAO/bounty agreements now force manual review and partial milestone-based release behavior.
- Agreement detail and dashboard views now surface source attribution and invite actions where relevant.
- Wallet authentication and webhook flows are now aligned with stricter production deployment expectations, including authenticated webhook management routes.
- Dashboard and agreement detail pages now place more emphasis on “what happens next,” milestone progress, and user action clarity instead of only showing raw agreement data.
- Wallet connection and sign-in states now use clearer language to distinguish between connected, authenticated, reconnect-required, and sign-in-incomplete states.

### Improved

- DAO/bounty import form now includes clearer inline guidance, examples, required-vs-optional cues, and field-level validation for:
  - source labels
  - source URLs
  - wallet addresses
  - Fiber public keys
  - deadline values
  - milestone content and amounts
- Regular agreement creation form now includes the same style of inline validation and helper text for a more consistent user experience.
- Webhook creation form now better explains endpoint labels, valid receiver URLs, and event selection requirements.
- Agreement detail now includes a stronger action summary, a more visual milestone journey, clearer milestone decision labels, and more educational empty states for settlement history, audit trail, and agreement discussion.
- Dashboard agreement cards now explain who needs to act next, show clearer milestone progress, and provide more helpful first-run empty states.
- The regular agreement creation experience now uses clearer section grouping for agreement basics, workflow rules, and milestone planning so the form feels more guided and less dense.
- Status badges now use cleaner human-readable labels across agreements, milestones, settlement history, source attribution, and system activity surfaces.
- Wallet/auth UI now provides stronger recovery guidance when sign-in is incomplete or the live signer needs to be reconnected.

### Fixed

- Resolved production webhook route availability issues caused by stale backend processes and port conflicts during deployment.
- Resolved live wallet sign-in failures caused by backend CORS misconfiguration between frontend and API subdomains.

## [0.1.0] - Initial milestone escrow foundation

### Added

- Wallet-based authentication using signed CCC-compatible challenges and JWT-backed sessions.
- Milestone-based agreement creation and lifecycle tracking.
- Agreement funding, proof submission, review actions, dispute handling, and settlement orchestration.
- CKB settlement support with optional Fiber payout paths and fallback behavior.
- Background agent loop for deterministic agreement progression.
- Realtime agreement and log updates through WebSockets.
- Prisma-backed persistence and shared state machine helpers across `web`, `server`, and `shared`.
