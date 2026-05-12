# PactAgent

PactAgent is a milestone-based escrow and payout application for Nervos CKB. A client creates a work agreement, splits the budget into milestones, funds the agreement from a connected wallet, and a worker submits proof for each milestone. A background agent then watches the agreement lifecycle and advances it toward payout, refund, expiry, or dispute handling.

The project combines:
- wallet-native authentication
- milestone-based payment agreements
- an autonomous backend worker that enforces state transitions
- real CKB settlement with optional Fiber payout support
- live operational logs and agreement updates in the UI

## Why PactAgent Exists

Milestone payments are still hard to manage in crypto-native work relationships.

Common problems include:
- clients do not want to release funds before work is delivered
- workers do not want to deliver work without confidence of payment
- approvals happen manually in chats and DMs
- disputes are messy, unstructured, and slow
- crypto transfers are simple payments, not operational workflows

PactAgent solves this by turning freelance or service payments into a programmable process. Instead of "trust me" coordination, users get a structured agreement with milestones, proof requirements, deadlines, dispute windows, reviewer modes, and automated settlement logic.

## What The Project Does

PactAgent allows two participants to coordinate work and payment through a milestone contract flow:

1. The client connects a CCC-compatible wallet and signs an authentication challenge.
2. The client creates a milestone agreement with:
   - title and description
   - worker address
   - optional worker Fiber public key
   - dispute window and deadline
   - proof type
   - reviewer mode
   - payout network
   - one or more milestones with fixed amounts
3. The client funds the agreement on CKB.
4. The worker submits proof for the active milestone.
5. The agent validates the next step and moves the agreement into review.
6. Depending on reviewer mode, the agent or client approves payout, or a dispute is opened.
7. Settlement is attempted over Fiber when configured, otherwise on CKB L1.
8. After a milestone is paid, the next one becomes active until the agreement is complete.

PactAgent also supports imported grant and bounty workflows:

1. An operator can paste a Nervos forum grant thread or a CKBoost campaign link into the dedicated import flows.
2. PactAgent auto-fills source metadata, governance context, source budget references, and draft milestone structure from the original source.
3. Imported Nervos grants can preserve separate commencement payments as their own kickoff checkpoint instead of forcing them into Milestone 1.
4. Imported milestone USD budgets can auto-populate live CKB estimates, and operators can refresh all estimates or convert between USD and CKB before finalizing payout amounts.
5. Once funding is confirmed, a dedicated commencement payment can be auto-released immediately while the remaining grant stays milestone-reviewed.
6. The imported work is converted into manually reviewed milestones with partial release behavior.
7. Proof is checked for completeness before human review, and missing information can trigger structured follow-up requests.
8. Source-thread updates can be drafted, reviewed, published, and synced over time.
9. CKBoost imports can keep contributor reputation, external IDs, event history, and sync-back notifications attached to the agreement.

## Current Product Scope

What is already implemented:
- real CCC wallet connection in the web app
- wallet-signature authentication with JWT-backed API sessions
- protected agreement and participant actions
- milestone agreement creation
- real CKB funding from the client wallet to a treasury wallet
- real treasury-driven payout and refund attempts on CKB
- Fiber payout attempt path with CKB fallback
- live agent logs and agreement updates via WebSocket
- dispute creation and follow-up evidence submission
- advisory AI dispute recommendation flow
- proof completeness checking with structured checklists, persisted proof review records, and async worker execution
- AI-drafted follow-up question generation for missing proof information
- structured milestone-linked info requests and responses with audit history
- human confirmation checkpoints that keep AI output advisory before payout approval
- DAO and bounty import with source attribution, manual review enforcement, and milestone-based release planning
- Nervos forum-thread auto-fill with dynamic milestone extraction, commencement-payment detection, and imported source snapshots
- live CKB/USD quote conversion for imported grant budgets with automatic CKB prefill, editable USD/CKB helper inputs, and total-lock previews
- automatic commencement-payment release after funding for imported grants that include a dedicated kickoff checkpoint
- source-thread sync, review, publish controls, and Discourse-aware summarization for imported grants
- CKBoost import, campaign-link auto-fill, contributor snapshots, event history, webhook ingestion, and outbound lifecycle notifications
- Prisma + PostgreSQL persistence, ready for Supabase

What is intentionally not implemented yet:
- Phase 7 premium automation packaging
- workspace/DAO/sponsor feature gating
- automation usage metering and billing-oriented event packaging

Important architecture note:

PactAgent currently uses real CKB transfers for funding and settlement, but the agreement state machine itself is still off-chain. Agreement state, milestones, proofs, disputes, and logs are stored in PostgreSQL through Prisma. There is no custom CKB escrow script or full on-chain contract state yet.

## User Flows

### Client Flow

1. Connect wallet and sign in.
2. Create a new agreement.
3. Define milestones and total escrow amount.
4. Choose CKB or Fiber as the payout path.
5. Fund the agreement on CKB.
6. Watch milestones progress in the dashboard.
7. Approve payout, reject for refund, or open a dispute when needed.

### Worker Flow

1. Open an agreement where their wallet is the worker address.
2. Wait for the client to fund it.
3. Submit proof for the active milestone.
4. Review any structured info request if the proof checker or reviewer needs more context.
5. Submit revised proof when follow-up is requested.
6. Add more context if a dispute is opened.
7. Receive payout through Fiber when available, otherwise on CKB.

### Imported Grant / Bounty Flow

1. Paste a Nervos forum grant thread into the import flow and let PactAgent auto-fill the source fields.
2. Review the imported source snapshot, including requested USD budget, ETA, funding address, and any separate commencement payment.
3. Use the live CKB quote panel to estimate current CKB equivalents for the imported USD values.
4. Let imported milestone USD references auto-fill their current CKB equivalents, then use `Refresh All CKB Estimates` or the USD/CKB converter helpers when you want to re-run the latest quote.
5. Add, remove, or edit milestones freely so the final agreement matches the real delivery plan even when the source thread has more or fewer than four checkpoints.
6. Fund the total grant once so the agreement has the full payout capacity up front.
7. If the import includes a separate commencement payment, PactAgent can release that kickoff amount automatically as soon as funding is confirmed.
8. Run a proof completeness check before approving the remaining milestones through manual review.
9. Request more info through structured reviewer questions when needed.
10. Optionally sync or publish source-thread updates for governance visibility.

### CKBoost Handoff Flow

1. Paste a CKBoost campaign link into the dedicated import flow.
2. Resolve campaign title, description, rules, timing, and quest-derived milestone drafts from CKBoost campaign data.
3. Map the sponsor to the agreement client and the contributor to the worker role.
4. Carry campaign, quest bundle, approved proof, contributor reputation, and external IDs into PactAgent.
5. Ingest CKBoost webhook events and refresh contributor snapshots over time.
6. Notify CKBoost when proof is submitted, approved, or paid.

### Proof Review Flow

1. Worker submits a proof bundle for the active milestone.
2. PactAgent runs a completeness check synchronously or through the worker loop.
3. The proof is marked `CHECKING`, `ISSUES_FOUND`, `READY_FOR_HUMAN_REVIEW`, or `NEEDS_MORE_INFO`.
4. Reviewers can draft and send AI-generated follow-up questions when evidence is incomplete.
5. Approval stays blocked until the human reviewer confirms the decision and any open info requests are resolved.

### Dispute Flow

1. Either participant opens a dispute on the current milestone.
2. The dispute stores the reason and optional evidence notes.
3. Both sides can add follow-up evidence entries.
4. The AI recommendation layer produces an advisory summary, recommendation, confidence score, and rationale.
5. Final action still depends on reviewer mode and the approval path, not on the AI alone.

## Agent Flow

PactAgent includes a background worker that continuously scans active agreements and advances them through a deterministic state machine.

The agent currently handles:
- expiring unfunded agreements after deadline
- activating the first or next milestone
- auto-releasing imported commencement payments immediately after funding when the source marks a dedicated kickoff checkpoint
- starting and completing proof completeness checks
- validating submitted proof presence and completeness
- moving agreements into review only when the latest proof is ready
- auto-approving milestones in `AUTO` mode
- waiting for user confirmation in `HYBRID` and `MANUAL` paths
- scheduling info-request follow-up and proof re-check work
- generating dispute recommendations
- initiating payout or refund settlement
- polling imported source threads and scheduling CKBoost sync work
- unlocking the next milestone after settlement
- broadcasting logs and agreement changes in real time

Agreement statuses:
- `DRAFT`
- `FUNDED`
- `PROOF_SUBMITTED`
- `UNDER_REVIEW`
- `APPROVED`
- `PAID`
- `DISPUTED`
- `REFUNDED`
- `EXPIRED`

Milestone statuses:
- `PENDING`
- `ACTIVE`
- `PROOF_SUBMITTED`
- `UNDER_REVIEW`
- `APPROVED`
- `PAID`
- `DISPUTED`
- `REFUNDED`
- `EXPIRED`

## UI Overview

The frontend is built with Next.js and provides three main surfaces:

### Landing Page

- introduces PactAgent as an autonomous payment agreement app on CKB
- explains the Observe / Decide / Act model
- shows live public agent activity

### Dashboard

- lists agreements for the authenticated wallet
- shows escrow and review summary metrics
- streams live operational activity through WebSockets

### Grant / Bounty Import Page

- accepts Nervos forum thread links and auto-fills source fields
- preserves imported source budget context, ETA, funding address, and commencement-payment metadata
- shows live CKB conversion for imported USD budgets with editable USD/CKB helper fields and a single `Refresh All CKB Estimates` action
- supports dynamic milestone editing and keeps commencement payments visually separate from numbered delivery milestones

### CKBoost Import Page

- accepts CKBoost campaign links for source resolution
- auto-fills campaign metadata and quest-derived milestone drafts
- keeps contributor reputation and campaign context attached during handoff

### Agreement Detail Page

- displays agreement metadata and milestone timeline
- shows funding, settlement, and Fiber references
- allows funding, proof submission, proof checking, review actions, info requests, dispute actions, and evidence submission
- displays submitted proofs and agreement-specific logs
- surfaces imported source metadata, source sync controls, CKBoost contributor context, and operational history

## Backend Architecture

The codebase is split into three packages:

- `web/`: Next.js frontend with CCC wallet integration
- `server/`: Express API, Prisma persistence, agent loop, CKB/Fiber services, and WebSocket server
- `shared/`: shared enums, types, and state machine helpers

Core backend responsibilities:
- wallet-challenge authentication and JWT session issuance
- route-level participant authorization
- agreement lifecycle persistence
- milestone and dispute operations
- settlement orchestration
- realtime event broadcasting

## CKB, Fiber, And Chain-Adjacent Infrastructure

PactAgent currently uses:

- `@ckb-ccc/ccc`
  - wallet connectivity
  - CKB client access
  - address parsing and normalization
  - transaction construction and sending
- CKB RPC node access
  - configurable for testnet or mainnet
- real CKB L1 transfers
  - client wallet funds the agreement by sending capacity to a treasury address
  - treasury wallet sends payout or refund transactions
- Fiber JSON-RPC integration
  - node health checks
  - node info
  - channel listing/open/close
  - peer connect/disconnect
  - invoice creation and payment
  - keysend-style payout attempts

How settlement works today:
- the client funds the agreement by transferring CKB to a treasury wallet
- the agreement stores the funding transaction hash
- when a milestone is approved, the server attempts settlement
- if Fiber is enabled and appropriate for the agreement, the server attempts Fiber payout first
- if Fiber is unavailable or unsuitable, the server falls back to a treasury-driven CKB transfer
- the settlement reference is saved on the agreement

What is not yet implemented:
- custom on-chain escrow locks
- on-chain dispute logic
- fully on-chain agreement state
- Perun integration

## AI And Agent Stack

PactAgent uses two automation layers:

### 1. Deterministic Agent

This is the core system behavior today.

- interval-based agreement watcher
- explicit state transitions
- rules for proof progression, deadlines, disputes, and settlement
- structured logs for all important actions

### 2. AI Recommendation Layer

This is used for dispute recommendation, proof completeness review, and follow-up drafting, not autonomous fund release.

- default mode can fall back to deterministic behavior when AI is unavailable
- optional OpenAI integration is supported through configuration
- the OpenAI path uses the Responses API with structured JSON schema output
- recommendations include:
  - summary
  - recommendation type
  - confidence
  - rationale
- proof review output can include:
  - readiness status
  - structured checklist items
  - warnings
  - follow-up prompts for missing information

Important safety property:

AI output is advisory only. It does not directly move funds without the normal agreement review path.

## Implemented Phase Summary

### Phase 1: AI Report Completeness Checker

Implemented:
- AI-backed proof/report completeness checking with deterministic fallback
- `Check report` step on the agreement page
- structured proof completeness checklist
- persisted proof review states:
  - `CHECKING`
  - `ISSUES_FOUND`
  - `READY_FOR_HUMAN_REVIEW`
  - `NEEDS_MORE_INFO`
- missing-item warnings near proof submission and reviewer approval areas
- `POST /api/agreements/:id/proof/check`
- `reportReviewService.ts` milestone-vs-proof comparison logic
- proof bundle parsing reuse from the rich payload service
- proof check audit/history logging
- optional async execution through the worker loop

### Phase 2: Follow-Up Generator

Implemented:
- AI follow-up question drafting for missing proof information
- `Request more info` panel on the agreement page
- editable AI-drafted reviewer questions
- structured follow-up requests and participant responses
- outstanding info requests in the milestone timeline and review surfaces
- service layer that turns checker output into follow-up prompts
- milestone-linked structured info request persistence
- audit events for `INFO_REQUESTED` and `INFO_RECEIVED`
- reuse of existing agreement comment/message flows

### Phase 3: Human-In-The-Loop Review Controls

Implemented:
- reviewer controls that separate AI suggestion from final human action
- AI output labeled and acknowledged as suggested, not self-approving
- human confirmation checkpoints before payout/status transitions
- imported-grant policy rules that prevent AI-driven payout approval
- manual review lock for imported grants
- permission checks for who can confirm payout actions

### Phase 4: Forum Bot And Grant Status Sync

Implemented:
- forum/governance thread capture during import
- `POST /api/agreements/import-bounty/autofill` for Nervos forum-thread auto-fill
- Discourse-aware thread parsing for title, summary, requested budget, ETA, funding address, and governance metadata
- imported source snapshots that preserve requested USD budget references and separate commencement-payment context
- dynamic milestone extraction from source threads, including support for more or fewer than four checkpoints
- source-thread card on agreement detail
- admin and agreement-page source update controls
- source sync service for ingesting and summarizing source-thread updates
- Discourse JSON summarization instead of generic HTML scraping when the source is a forum topic
- DB fields for thread URL, sync status, last synced at, latest summary, review and publish metadata
- `POST /api/agreements/:id/source-sync`
- `POST /api/agreements/:id/source-sync/publish`
- explicit reviewer approval before direct posting
- webhook events for source sync state changes
- scheduled background source polling in the worker loop
- near-real-time agreement refresh broadcasts after source sync updates land

### Phase 5: CKBoost Handoff

Implemented:
- `Create from CKBoost` entry point
- CKBoost campaign/contributor import form
- `POST /api/integrations/ckboost/autofill` for campaign-link auto-fill
- CKBoost on-chain campaign resolver for title, description, rules, stats, and quest-derived milestone drafts
- CKBoost import service and route
- mapping from sponsor to client, contributor to worker, and campaign/quest/proof data into agreement metadata
- imported contributor reputation and campaign history during creation
- manual import and webhook-driven ingestion
- `POST /api/integrations/ckboost/import`
- persistence of CKBoost external IDs for future sync-back

### Imported Grant Pricing

Implemented:
- `GET /api/integrations/market/ckb-price` for live CKB/USD quotes
- live CKB conversion panels on the grant import page for requested budget, commencement payment, and milestone budget references
- automatic CKB prefill from imported USD source budgets when a live quote is available
- milestone-level USD helper inputs with `USD -> CKB` and `CKB -> USD` conversion support
- a single `Refresh All CKB Estimates` action for reapplying the latest quote across the full grant
- automatic quote refresh while the imported grant form is open
- manual override of the final CKB payout amounts before agreement creation

### Phase 6: CKBoost Identity, Reputation, And Event Sync

Implemented:
- contributor reputation panels on import and agreement pages
- linked CKBoost profile, approval rate, campaign participation, and leaderboard context
- periodic sync jobs and webhook receivers for CKBoost events
- stored external profile snapshots and event history
- CKBoost notifications for proof submitted, approved, and paid
- durable retryable outbound CKBoost notification delivery records

### Phase 7: Premium Automation Package

Not implemented yet:
- plan / feature gating in admin and settings pages
- enabled automation views by workspace, DAO, or sponsor
- workspace-level feature flags for automation modules
- usage metering by agreement, milestone, sync job, or AI run
- billing-oriented premium automation event packaging

## Tech Stack

### Frontend

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- Zustand
- `@ckb-ccc/connector-react`
- `@ckb-ccc/ccc`

### Backend

- Express
- TypeScript
- Prisma
- PostgreSQL
- `ws`
- `zod`
- `jsonwebtoken`
- `uuid`

### Data / Infra

- PostgreSQL
- Supabase-compatible Prisma configuration
- CKB RPC node
- optional Fiber node
- optional OpenAI API access

## Repository Structure

```text
.
|-- web/
|   |-- src/app/
|   |-- src/components/
|   |-- src/hooks/
|   `-- src/lib/
|-- server/
|   |-- prisma/
|   `-- src/
|       |-- middleware/
|       |-- routes/
|       |-- services/
|       |-- worker/
|       `-- ws.ts
`-- shared/
    `-- src/
```

## Local Development Setup

### 1. Install dependencies

```bash
cd server
npm install

cd ../web
npm install
```

### 2. Configure environment variables

Copy the example files:

```bash
cp server/.env.example server/.env
cp web/.env.example web/.env.local
```

If you are on Windows PowerShell:

```powershell
Copy-Item server\.env.example server\.env
Copy-Item web\.env.example web\.env.local
```

### 3. Configure server environment

`server/.env`:

```env
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
DIRECT_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"

PORT=4000
CORS_ORIGIN=http://localhost:3000

CKB_NODE_URL=https://testnet.ckb.dev/
CKB_NETWORK=testnet
DEFAULT_CKB_FEE_RATE=1200

TREASURY_CKB_PRIVATE_KEY=
TREASURY_CKB_ADDRESS=

AUTH_JWT_SECRET=
AUTH_TOKEN_TTL_SECS=604800
AUTH_CHALLENGE_TTL_SECS=600
ADMIN_ADDRESSES=
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=20
ACTION_RATE_LIMIT_WINDOW_MS=60000
ACTION_RATE_LIMIT_MAX=12

AGENT_INTERVAL_MS=5000

ONCHAIN_ESCROW_ENABLED=false
ONCHAIN_LOCK_CODE_HASH=
ONCHAIN_LOCK_HASH_TYPE=type
ONCHAIN_LOCK_TX_HASH=
ONCHAIN_LOCK_INDEX=
ONCHAIN_LOCK_DEP_TYPE=code
ONCHAIN_ESCROW_ARGS_SALT=

FIBER_ENABLED=false
FIBER_NODE_URL=http://127.0.0.1:8227
FIBER_API_KEY=

FORUM_PUBLISH_ENABLED=false
FORUM_PUBLISH_PROVIDER=DISCOURSE
FORUM_PUBLISH_API_KEY=
FORUM_PUBLISH_API_USERNAME=
FORUM_PUBLISH_WEBHOOK_URL=
FORUM_PUBLISH_TIMEOUT_MS=10000

CKBOOST_SYNC_ENABLED=false
CKBOOST_WEBHOOK_URL=
CKBOOST_WEBHOOK_SECRET=
CKBOOST_INBOUND_TOKEN=
COINGECKO_API_BASE_URL=https://api.coingecko.com/api/v3
COINGECKO_API_KEY=
MARKET_PRICE_CACHE_TTL_MS=60000

AI_ENABLED=false
AI_PROVIDER=mock
AI_TIMEOUT_MS=
OPENAI_MODEL=
OPENAI_API_KEY=
```

Notes:
- `DATABASE_URL` is always required
- `DIRECT_URL` is also required when your main `DATABASE_URL` points at a pooled endpoint such as Supabase's `6543` connection
- if you are using a plain local PostgreSQL instance, you can set `DIRECT_URL` to the same value as `DATABASE_URL`
- `TREASURY_CKB_PRIVATE_KEY` is required for payout and refund execution
- `TREASURY_CKB_ADDRESS` is optional and can be derived from the private key
- `ADMIN_ADDRESSES` is a comma-separated allowlist for Fiber admin actions
- auth and agreement write endpoints now have in-memory rate limits; tune them with the `*_RATE_LIMIT_*` variables
- set `ONCHAIN_ESCROW_ENABLED=true` together with `ONCHAIN_LOCK_CODE_HASH`, `ONCHAIN_LOCK_TX_HASH`, and `ONCHAIN_LOCK_INDEX` once you have a deployed lock script and want the app to expose the `ONCHAIN_LOCK` escrow model
- enable `FIBER_ENABLED=true` only if you have a reachable Fiber node
- set `FORUM_PUBLISH_ENABLED=true` to let Phase 4 publish approved source-thread updates directly
- `FORUM_PUBLISH_PROVIDER=DISCOURSE` posts replies to Discourse topic URLs using `FORUM_PUBLISH_API_KEY` and `FORUM_PUBLISH_API_USERNAME`
- `FORUM_PUBLISH_PROVIDER=WEBHOOK` sends the approved update payload to `FORUM_PUBLISH_WEBHOOK_URL` so you can bridge to other governance/forum systems
- set `CKBOOST_SYNC_ENABLED=true` to enable outbound CKBoost lifecycle notifications for proof submission, approval, and payout
- `CKBOOST_WEBHOOK_URL` is the outbound CKBoost endpoint PactAgent should notify for imported CKBoost agreements
- `CKBOOST_INBOUND_TOKEN` protects the `POST /api/integrations/ckboost/webhook` receiver when CKBoost pushes reputation or campaign events back into PactAgent
- `COINGECKO_API_BASE_URL`, `COINGECKO_API_KEY`, and `MARKET_PRICE_CACHE_TTL_MS` control the live CKB quote service used during imported grant conversion from USD source budgets into editable CKB estimates
- AI can run in mock mode without external dependencies

### 4. Configure web environment

`web/.env.local`:

```env
NEXT_PUBLIC_CKB_NETWORK=testnet
NEXT_PUBLIC_CKB_NODE_URL=https://testnet.ckb.dev/
NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_WS_URL=
API_PROXY_TARGET=http://127.0.0.1:4000
```

### 5. Generate Prisma client and push schema

```bash
cd server
npx prisma generate
npx prisma db push
```

### 6. Seed demo data (optional)

```bash
cd server
npm run seed
```

The seed creates:
- demo users
- multiple milestone agreements
- proof data
- dispute data
- sample agent logs

### 7. Start the backend

```bash
cd server
npm run dev
```

### 8. Start the frontend

```bash
cd web
npm run dev
```

The app will be available at:
- frontend: `http://localhost:3000`
- backend: `http://localhost:4000`
- websocket: `ws://localhost:4000/ws`

## Important Notes For Running The App

- the treasury wallet must actually hold enough CKB to send payouts and refunds
- funding is currently sent to the treasury wallet, not into a custom escrow lock script
- the frontend validates a minimum 61 CKB output requirement for CKB transaction outputs
- Fiber settlement still depends on a reachable and healthy Fiber backend
- agreement routes are protected and require an authenticated wallet session

## Current Limitations

- agreement logic is off-chain even though settlement uses real CKB transfers
- treasury custody is still a trust assumption in the current architecture
- proof validation is still operationally focused rather than cryptographic or oracle-backed verification
- dispute AI is advisory, not a replacement for arbitration
- imported grant USD-to-CKB conversion uses a live quote for operator guidance, but the final CKB payout values are still chosen manually and are not price-locked automatically
- there is no role-separated admin or arbitrator interface yet
- premium automation packaging and billing controls from Phase 7 are still not implemented

## Future Directions

PactAgent can grow far beyond the hackathon version.

Potential next steps:
- move escrow logic into custom CKB scripts
- support fully on-chain agreement state commitments
- add richer proof systems such as file storage, hashes, attestations, and oracle checks
- add arbitrator and admin tooling
- support multi-party agreements
- build marketplace, DAO, or bounty integrations on top of the API
- improve Fiber channel management and routing strategies
- add notifications, audit exports, and compliance-friendly reporting
- expose PactAgent as infrastructure for third-party apps
- add Phase 7 premium automation controls, feature gating, and usage metering

## Recommended Improvements And High-Impact Features

If you want to push PactAgent from a strong prototype into a much more serious product, these are the most valuable additions to prioritize.

### 1. Trustless Escrow And Safer Settlement

- move from treasury custody toward true on-chain escrow with custom CKB lock scripts
- assign a unique funding destination or escrow cell per agreement instead of using a shared treasury flow
- verify funding transactions on-chain before changing agreement status to `FUNDED`
- store settlement references per milestone, not only at the agreement level
- support confirmation tracking for funding, payout, and refund transactions
- add explicit failure recovery flows for payout and refund retries

Why this matters:

This is the biggest step toward making PactAgent feel credible for real value transfer. It reduces trust assumptions and makes the product much stronger technically and commercially.

### 2. Better Dispute And Review Infrastructure

- add a dedicated arbitrator role with a separate review dashboard
- support dispute states like `OPEN`, `RESPONDED`, `UNDER_ARBITRATION`, and `RESOLVED`
- allow structured evidence uploads such as files, URLs, images, hashes, and timestamps
- support milestone-specific acceptance criteria that are defined up front and reviewed later
- add signed reviewer decisions and immutable dispute history
- let the client choose between self-review, named arbitrator review, or DAO/community review

Why this matters:

Disputes are one of the core reasons a system like PactAgent exists. Strong dispute tooling makes the platform more defensible and much more useful for professional work.

### 3. Richer Proof Systems

- support file attachments through IPFS or another object storage layer
- add proof templates by job type such as design review, code delivery, audit report, content delivery, and consulting
- support proof bundles with multiple artifacts per milestone
- add optional oracle or attestation checks for objective milestones
- include proof expiry, revision history, and resubmission workflows
- add previewable proof panels in the agreement UI

Why this matters:

Right now proof is mostly text or link based. Richer proof handling makes the review flow more realistic and much easier for real users to trust.

### 4. Stronger Agent Architecture

- move the worker loop from a polling-only model to a queue-backed job system
- add distributed locking so only one worker instance can process a given agreement at a time
- break agent actions into explicit jobs like funding verification, proof review, dispute analysis, payout, and refund
- add retry limits, dead-letter handling, and alerting for stuck agreements
- support scheduled reminders before deadlines and dispute window expiry
- expose an internal agent timeline for debugging and replay

Why this matters:

This would make the automation layer more production-ready and easier to operate once usage grows beyond a demo environment.

### 5. Access Control, Privacy, And Security Hardening

- authenticate WebSocket connections and scope updates by agreement participant
- protect Fiber admin routes behind admin-only authentication
- add role-separated admin, operator, and arbitrator permissions
- store less sensitive operational data in public feeds
- add rate limiting on auth, funding, dispute, and recommendation endpoints
- add stronger wallet identity normalization and signer verification rules
- introduce audit logs for privileged actions

Why this matters:

These changes make PactAgent safer to deploy publicly and help prevent accidental data exposure or unauthorized operational actions.

### 6. Product Experience And Workflow Features

- support draft editing and milestone re-ordering before funding
- add agreement cancellation before funding and controlled amendment proposals after funding
- support milestone comments and participant chat per agreement
- show clearer transaction progress, confirmations, and failure states in the UI
- add mobile-friendly evidence and proof submission flows
- add participant notifications by email, Telegram, Discord, or wallet-native alerts
- add saved templates for common agreement types

Why this matters:

A strong workflow experience is what turns technical infrastructure into a product people actually want to keep using.

### 7. Marketplace And Ecosystem Expansion

- add public worker/client profiles with lightweight reputation history
- support invite links for new agreements
- expose embeddable API and webhook integrations for third-party platforms
- support multi-party agreements for agencies, teams, or milestone committees
- add optional stablecoin or multi-asset settlement paths if the chain stack allows it

Why this matters:

This is where PactAgent starts becoming not just an app, but a reusable agreement engine for broader ecosystems.

### 8. Reporting, Analytics, And Compliance Tooling

- add downloadable agreement reports and dispute summaries
- create dashboards for settlement success rate, dispute rate, payout speed, and agent actions
- support searchable activity history across agreements
- add export formats for finance, operations, and legal review
- include treasury balance health checks and payout runway visibility
- add agreement lifecycle metrics for marketplaces or enterprise teams

Not implemented from the current roadmap:
- premium automation packaging and billing controls from Phase 7
- workspace, DAO, or sponsor-level automation gating
- usage metering for AI runs, sync jobs, or premium automation actions

Why this matters:

Reporting turns PactAgent into something teams and organizations can rely on operationally, not just interact with occasionally.

### 9. Engineering Quality And Developer Experience

- add unit tests for state transitions, auth validation, and dispute logic
- add integration tests for funding, payout, refund, and Fiber fallback behavior
- add end-to-end tests for the main client and worker flows
- remove duplicated transition rules by using the shared state machine as the single source of truth
- add schema-level indexes for status, participant address, and log-heavy queries
- add CI for linting, type-checking, tests, and Prisma validation
- document deployment environments for local, staging, and production

Why this matters:

This is the layer that will make the project easier to maintain, easier to contribute to, and much more trustworthy over time.

### 10. A Strong Product Version To Aim For

An excellent next major version of PactAgent could include:

- verified on-chain funding confirmation
- milestone-level payout tracking
- secure participant-scoped realtime updates
- full dispute workspace with arbitrator mode
- richer proof artifacts and evidence attachments
- notification system and reporting exports
- production-grade worker orchestration with retries and locks
- test coverage around all money-moving flows

That combination would make PactAgent feel much closer to a real crypto-native escrow platform rather than only a promising prototype.

## Why This Could Become A Real Product

PactAgent is viable both as an end-user product and as infrastructure.

As a product, it can serve freelancers, agencies, service providers, protocol contributors, and remote teams that need milestone-based crypto payment coordination.

As infrastructure, it already resembles a programmable agreement engine:

- authenticated wallet participants
- structured agreement lifecycle
- deterministic agent automation
- settlement adapters
- dispute and evidence flows
- realtime observability

That makes it a good fit for:

- job and freelancer marketplaces
- DAO contributor payouts
- grants and milestone funding platforms
- vendor management tools
- crypto-native agency operations

## Code References

If you want to inspect the most important implementation entry points, start here:

- [README.md](/c:/Users/ajayh/Desktop/pactagent/README.md)
- [web/src/app/page.tsx](/c:/Users/ajayh/Desktop/pactagent/web/src/app/page.tsx)
- [web/src/app/dashboard/page.tsx](/c:/Users/ajayh/Desktop/pactagent/web/src/app/dashboard/page.tsx)
- [web/src/app/agreement/new/page.tsx](/c:/Users/ajayh/Desktop/pactagent/web/src/app/agreement/new/page.tsx)
- [web/src/app/agreement/[id]/page.tsx](/c:/Users/ajayh/Desktop/pactagent/web/src/app/agreement/[id]/page.tsx)
- [server/src/routes/agreements.ts](/c:/Users/ajayh/Desktop/pactagent/server/src/routes/agreements.ts)
- [server/src/services/agreementService.ts](/c:/Users/ajayh/Desktop/pactagent/server/src/services/agreementService.ts)
- [server/src/worker/agentLoop.ts](/c:/Users/ajayh/Desktop/pactagent/server/src/worker/agentLoop.ts)
- [server/src/services/ckbService.ts](/c:/Users/ajayh/Desktop/pactagent/server/src/services/ckbService.ts)
- [server/src/services/fiberService.ts](/c:/Users/ajayh/Desktop/pactagent/server/src/services/fiberService.ts)
- [server/src/services/disputeService.ts](/c:/Users/ajayh/Desktop/pactagent/server/src/services/disputeService.ts)
- [server/prisma/schema.prisma](/c:/Users/ajayh/Desktop/pactagent/server/prisma/schema.prisma)

## License

This project is licensed under the MIT License. See [LICENSE](/c:/Users/ajayh/Desktop/pactagent/LICENSE).
