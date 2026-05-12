# Changelog

All notable changes to PactAgent is documented in this file.

The format is based on Keep a Changelog, and this project follows a simple semantic versioning style where possible.

## [Unreleased]

### Added

- Phase 1 AI report completeness checker with:
  - persisted proof check records and proof review lifecycle states
  - `POST /agreements/:id/proof/check`
  - structured proof completeness checklist and warning payloads
  - audit trail entries for proof check start and completion
  - optional async execution through the worker loop
- Phase 2 follow-up generator with:
  - AI-drafted reviewer follow-up questions with deterministic fallback
  - structured milestone-linked info request records
  - reviewer draft, send, and worker response flows on the agreement page
  - audit events for `INFO_REQUESTED` and `INFO_RECEIVED`
- Phase 3 human-in-the-loop review controls with:
  - explicit human confirmation checkpoints before payout approval
  - advisory AI recommendation acknowledgements
  - approval blocking while open info requests remain
  - imported grant payout protection through manual review enforcement
- Phase 4 forum bot and grant status sync with:
  - source thread sync routes and persisted source sync metadata
  - agreement-page and admin-page source sync controls for draft, review, and publish
  - explicit reviewer approval and reviewed-by enforcement before outward posting
  - source sync webhook events and scheduled background polling through the worker loop
  - Discourse-aware source import and sync parsing for Nervos forum threads
  - imported grant snapshots with requested budget, ETA, funding-address, and commencement-payment context
  - dynamic milestone extraction from source threads instead of fixed milestone assumptions
  - near-real-time agreement refresh after source sync updates
- Phase 5 CKBoost handoff with:
  - `Create from CKBoost` dashboard entry and import page
  - CKBoost import service, route, and webhook-driven agreement ingestion
  - campaign, quest bundle, approved proof, contributor, and sponsor metadata mapping
  - sponsor wallet to client mapping while preserving importer-as-creator access
  - persisted CKBoost external IDs for future sync-back
  - CKBoost campaign-link auto-fill for campaign metadata and quest-derived milestone drafts
- Phase 6 CKBoost identity, reputation, and event sync with:
  - contributor snapshot panels on import and agreement pages
  - stored CKBoost profile snapshots and event history
  - scheduled CKBoost profile refresh jobs and webhook receivers
  - outbound CKBoost lifecycle notifications for proof submitted, milestone approved, and milestone paid
  - durable CKBoost notification delivery records with retry handling
- Imported grant pricing support with:
  - live CKB/USD quote endpoint
  - grant-import quote panels for requested budget, commencement payment, and milestone budget references
  - automatic CKB prefill from imported USD source budgets when a live quote is available
  - milestone-level USD helper inputs with `USD -> CKB` and `CKB -> USD` conversion support
  - a single `Refresh All CKB Estimates` action for reapplying the latest quote across the full grant
  - automatic quote refresh while the import form stays open
- Imported grant kickoff settlement support with:
  - dedicated commencement-payment detection from imported source metadata
  - automatic commencement-payment release immediately after funding confirmation
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

- Agreement access now also recognizes imported-agreement creators for source-backed grant flows, so sponsor-mapped imports remain accessible to the importing operator.
- CKBoost import now supports separating the sponsor/client identity from the importing wallet, while preserving creator attribution on the imported agreement source record.
- DAO/bounty import now supports a true grant-style flow with multiple milestones and a visible total amount to lock upfront.
- Imported DAO/bounty agreements now force manual review and partial milestone-based release behavior.
- DAO/bounty import now supports forum-thread auto-fill so source metadata and milestone drafts can be resolved from a pasted Nervos grant link.
- DAO/bounty import now preserves separate commencement payments as their own kickoff checkpoint instead of forcing them into Milestone 1.
- Imported grants can now auto-release a dedicated commencement payment immediately after funding while keeping the remaining milestones under manual review.
- CKBoost import now supports campaign-link auto-fill instead of relying only on manual campaign entry.
- Imported grant pricing now auto-fills CKB milestone amounts from source USD budgets and keeps editable USD/CKB conversion helpers in the import flow.
- Agreement detail and dashboard views now surface source attribution and invite actions where relevant.
- Wallet authentication and webhook flows are now aligned with stricter production deployment expectations, including authenticated webhook management routes.
- Dashboard and agreement detail pages now place more emphasis on “what happens next,” milestone progress, and user action clarity instead of only showing raw agreement data.
- Wallet connection and sign-in states now use clearer language to distinguish between connected, authenticated, reconnect-required, and sign-in-incomplete states.
- Webhook management now behaves more like an onboarding surface, with clearer endpoint education, receiver examples, event explanations, and easier delivery inspection.
- Imported source metadata is now presented more prominently on agreement detail pages so DAO and bounty context feels like part of the agreement, not an afterthought.
- The webhook, agreement, and grant-import flows now place more weight on guided education, stronger action hierarchy, and post-submit reassurance rather than treating advanced flows like raw configuration screens.
- Agreement detail, dashboard, and creation flows now present PactAgent as a lifecycle-centered workspace, with clearer stage-by-stage framing from creation to funding, delivery, review, settlement, and closure.
- PactAgent now distinguishes direct agreements from imported grant / bounty work more explicitly across the dashboard, agreement detail, and creation flows so each mode feels intentional instead of stacked together.

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
- Webhook settings now include practical onboarding guidance for valid receiver URLs, testing with temporary endpoints, and understanding what PactAgent sends.
- Agreement detail now highlights imported source title, sponsor, reference ID, scope, and governance notes in a stronger origin summary card.
- Core action areas now stack more cleanly on mobile, especially around funding, milestone review, disputes, and dispute reply flows.
- Agreement creation, grant import, and webhook setup now produce stronger success feedback so important setup moments feel more visible and intentional.
- Visual contrast has been strengthened across educational panels, action summaries, milestone checkpoints, and selected webhook endpoint cards so high-stakes agreement work is easier to scan.
- Webhook onboarding now explains the receive-subscribe-react lifecycle and includes “good first test” guidance for temporary webhook receivers.
- DAO/bounty import now teaches the difference between source metadata, upfront funding, and manual reviewer control before users create the agreement.
- DAO/bounty import now shows the link-first import flow at the top of the source intake section so operators begin with the forum thread before moving into the rest of the form.
- Agreement detail now presents the milestone journey as a clearer step-by-step progression with better emphasis on the active checkpoint and upcoming action.
- Mobile layouts now stack high-priority actions and summary cards more deliberately so agreement operations stay readable on smaller screens.
- Agreement detail now includes a lifecycle hero, role-aware guidance, and a clearer agreement-mode summary so clients, workers, admins, and observers understand what matters to them immediately.
- Dashboard cards now expose the viewer’s role, agreement mode, and lifecycle context more clearly, while the top-level dashboard introduces dedicated lifecycle lanes for draft, delivery, review, and settlement work.
- Direct agreement creation now uses a stronger mode-specific hero and lifecycle framing so users understand when to use the standard bilateral flow versus the DAO / bounty import flow.
- DAO / bounty import now feels more like a dedicated grant workspace, with clearer operator, grantee, treasury, and lifecycle framing throughout the top of the page.
- DAO / bounty import now gives the agreement-terms and milestone areas more breathing room, a cleaner two-column composition, and more spacious milestone funding summaries and cards.
- Form fields across the DAO / bounty import experience now use roomier padding and better visual rhythm, and dropdowns now reserve proper right-side space for the indicator arrow.
- PactAgent’s visual identity has been pushed beyond generic dark SaaS treatment in the core flows through stronger gradient heroes, mode-specific accents, and more distinctive operational summary panels.
- Agreement detail now includes a unified operational timeline that merges settlements, audit actions, messages, amendments, and dispute activity into one readable history stream.
- Imported grant UX now reduces manual amount entry by showing live CKB equivalents for imported USD budgets, recalculating totals as values change, and centralizing re-estimation under a single `Refresh All CKB Estimates` control.
- Grant milestone cards now label separate kickoff funding as `Commencement Payment` instead of `Milestone 1`.
- Large grant-funding totals now format and wrap cleanly inside the total-lock summary card.
- Imported-source warnings now use plain-language messaging when the original forum thread omits a funding wallet address.

### Fixed

- Resolved production webhook route availability issues caused by stale backend processes and port conflicts during deployment.
- Resolved live wallet sign-in failures caused by backend CORS misconfiguration between frontend and API subdomains.
- Resolved CoinGecko live-price failures caused by incorrect market-price endpoint path handling.
- Resolved imported-grant total-lock summaries failing to reflect edited amount references in real time.

## [0.1.0] - Initial milestone escrow foundation

### Added

- Wallet-based authentication using signed CCC-compatible challenges and JWT-backed sessions.
- Milestone-based agreement creation and lifecycle tracking.
- Agreement funding, proof submission, review actions, dispute handling, and settlement orchestration.
- CKB settlement support with optional Fiber payout paths and fallback behavior.
- Background agent loop for deterministic agreement progression.
- Realtime agreement and log updates through WebSockets.
- Prisma-backed persistence and shared state machine helpers across `web`, `server`, and `shared`.
