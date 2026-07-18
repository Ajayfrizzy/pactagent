# PactAgent

PactAgent is a milestone-based escrow and payout application for Nervos CKB. A client creates a work agreement, splits the budget into milestones, funds the agreement from a connected wallet, and a worker submits proof for each milestone. A background agent then watches the agreement lifecycle and advances it toward payout, refund, expiry, or dispute handling.

The project combines:
- wallet-native authentication
- milestone-based payment agreements
- an autonomous backend worker that enforces state transitions
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

## PactAgent Infrastructure

PactAgent infrastructure is the reusable backend layer behind agreement-driven products. External applications can use it to create agreements, split work into milestones, track escrow, accept proof, approve or reject work, resolve disputes, receive lifecycle events, and consume signed webhooks.

The infrastructure API is mounted under `/v1`. It is app-scoped: every external product is represented by an app/project, and every API-key request is resolved to exactly one `appId`. Agreements, milestones, escrows, proofs, reviews, disputes, events, webhook endpoints, webhook deliveries, transactions, idempotency keys, and audit logs created through the infrastructure API belong to that app boundary.

The legacy wallet application API remains mounted under `/api` while the infrastructure API grows alongside it.

### Current Architecture Boundary

The production core is the `/v1` infrastructure API. Legacy wallet-product routes under `/api` are disabled unless `ENABLE_LEGACY_PRODUCT_API=true`; production deployments should keep them disabled and integrate through `/v1`.

Run the API and background worker as separate processes:

```bash
cd server
npm run dev
npm run worker
```

Database changes are deployed from committed Prisma migrations:

```bash
cd server
npm run db:migrate:deploy
```

Do not use `prisma db push` against production. Existing databases that predate the migration history must follow `server/prisma/MIGRATIONS.md` before the first migration deployment.

### Container deployment

The repository builds separate API, worker, migration, and web roles. For a local production-shaped stack:

```bash
cp .env.compose.example .env
# Replace every placeholder in .env before starting the stack.
docker compose up --build
```

The migration container must complete successfully before the API and worker start. In a managed deployment, run the `migrate` target once per release, then roll out the API and worker from the `runtime` target. Do not run migrations independently from every API replica.

Runtime containers use non-root users and read-only filesystems. The API is exposed on port `4000` and the web application on port `3000` in the Compose stack.

Integrator documentation is served by the API server:

- `GET /docs` for generated endpoint docs
- `GET /openapi.json` for the OpenAPI spec
- `server/docs/examples/integrator-quickstart.md` for curl examples


### Response Format

Successful single-resource responses use:

```json
{
  "data": {},
  "requestId": "req_xxx"
}
```

List responses use cursor pagination:

```json
{
  "data": [],
  "pagination": {
    "limit": 20,
    "cursor": "next_cursor_or_null"
  },
  "requestId": "req_xxx"
}
```

Errors use a stable envelope:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_state_transition",
    "message": "Agreement cannot be released before proof approval.",
    "requestId": "req_xxx"
  }
}
```

Every response includes a request ID, and the same value is also returned in the `X-Request-Id` response header.

### 1. What PactAgent Infrastructure Is

PactAgent infrastructure is not a marketplace and does not hardcode any external app. It provides neutral primitives that other products can build on:

- app/project tenancy
- scoped API keys
- agreement lifecycle state machines
- milestone records
- sandbox mock escrow and manual escrow operations
- proof submission and human review decisions
- dispute records and dispute resolution
- app-scoped lifecycle events
- signed webhooks and retryable webhook deliveries
- app-scoped audit logs
- internal admin monitoring
- health and readiness checks

### 2. How Apps Work

Apps are the tenant boundary. Each app has its own environment, status, default currency, default network, API keys, agreements, events, webhooks, and audit logs. API-key requests can only access records whose `appId` matches the authenticated key.

App management currently uses the existing wallet JWT owner session, not an app API key.

Create an app:

```http
POST /v1/apps
Authorization: Bearer <wallet-jwt>
Content-Type: application/json
```

```json
{
  "name": "Example Product",
  "slug": "example-product",
  "environment": "sandbox",
  "defaultCurrency": "CKB",
  "defaultNetwork": "sandbox"
}
```

Useful app routes:

```http
POST   /v1/apps
GET    /v1/apps
GET    /v1/apps/current
GET    /v1/apps/:id
PATCH  /v1/apps/:id
POST   /v1/apps/:id/disable
```

`GET /v1/apps/current` uses API-key authentication and returns the app resolved from the key.

### 3. How API Keys Work

API keys authenticate server-to-server integrator calls. They are app-scoped and environment-specific:

- sandbox keys start with `pa_test_`
- production keys start with `pa_live_`
- raw keys are returned only once during creation
- PactAgent stores `keyPrefix` and a SHA-256 hash, never the raw API key
- keys have explicit scopes
- keys can be revoked
- successful authentication updates `lastUsedAt`

Create an API key:

```http
POST /v1/api-keys
Authorization: Bearer <wallet-jwt>
Content-Type: application/json
```

```json
{
  "appId": "app_uuid",
  "name": "Server integration key",
  "scopes": [
    "apps:read",
    "agreements:create",
    "agreements:read",
    "agreements:update",
    "milestones:create",
    "milestones:read",
    "escrows:create",
    "escrows:read",
    "escrows:fund",
    "escrows:release",
    "escrows:refund",
    "proofs:create",
    "proofs:read",
    "proofs:review",
    "events:read",
    "webhooks:manage",
    "webhooks:read"
  ]
}
```

Use an API key with either header form:

```http
X-API-Key: pa_test_xxx
```

or:

```http
Authorization: Bearer pa_test_xxx
```

API key routes:

```http
POST   /v1/api-keys
GET    /v1/api-keys
DELETE /v1/api-keys/:id
```

### 4. How To Create An Agreement

Agreements represent the top-level work/payment lifecycle. Each agreement belongs to the app resolved from the API key and may include an `externalReferenceId` so the integrating product can map PactAgent records back to its own database.

```http
POST /v1/agreements
X-API-Key: pa_test_xxx
Content-Type: application/json
```

```json
{
  "externalReferenceId": "order_123",
  "title": "Landing page implementation",
  "description": "Implement the approved landing page design.",
  "clientExternalId": "client_456",
  "workerExternalId": "contractor_789",
  "totalAmount": "10000000000",
  "currency": "CKB",
  "releaseMode": "milestone",
  "disputeMode": "app_managed",
  "sourceType": "api",
  "metadata": {
    "projectId": "project_abc"
  }
}
```

Agreement metadata is JSON and is limited to 16KB. Amounts are positive integer strings so large token amounts can be stored without floating point loss.

Common agreement routes:

```http
POST   /v1/agreements
GET    /v1/agreements
GET    /v1/agreements/:id
POST   /v1/agreements/:id/accept
POST   /v1/agreements/:id/funding-required
POST   /v1/agreements/:id/cancel
```

Infrastructure agreement statuses are lowercase states such as `draft`, `accepted`, `funding_required`, `funded`, `in_progress`, `proof_submitted`, `under_review`, `approved`, `released`, `cancelled`, `refunded`, and `disputed`. Invalid transitions are rejected by the state machine.

### 5. How To Create Milestones

Milestones split an agreement into separately tracked work units. A single-payment agreement can be represented as one milestone. Milestones must belong to the same app as their agreement, and the total milestone amount cannot exceed the agreement total.

```http
POST /v1/agreements/:agreementId/milestones
X-API-Key: pa_test_xxx
Content-Type: application/json
```

```json
{
  "externalReferenceId": "task_1",
  "title": "Design implementation",
  "description": "Build the responsive landing page.",
  "amount": "6000000000",
  "currency": "CKB",
  "order": 1,
  "dueDate": "2026-07-15T00:00:00.000Z"
}
```

Milestone routes:

```http
POST   /v1/agreements/:id/milestones
GET    /v1/agreements/:id/milestones
GET    /v1/milestones/:id
```

### 6. How To Create Escrow In Sandbox/Mock Mode

Sandbox mock escrow lets integrators test lifecycle behavior without moving real funds. Use `rail: "mock"` and `network: "sandbox"`.

Escrow creation requires an `Idempotency-Key` header.

```http
POST /v1/escrows
X-API-Key: pa_test_xxx
Idempotency-Key: escrow_create_order_123_m1
Content-Type: application/json
```

```json
{
  "agreementId": "agreement_uuid",
  "milestoneId": "milestone_uuid",
  "amount": "6000000000",
  "currency": "CKB",
  "rail": "mock",
  "network": "sandbox"
}
```

Mark the mock escrow funded:

```http
POST /v1/escrows/:id/mark-funded
X-API-Key: pa_test_xxx
Content-Type: application/json
```

```json
{
  "txHash": "mock_funding_tx_123"
}
```

Escrow routes:

```http
POST   /v1/escrows
GET    /v1/escrows
GET    /v1/escrows/:id
POST   /v1/escrows/:id/mark-funded
POST   /v1/escrows/:id/release
POST   /v1/escrows/:id/refund
```

### 7. How To Submit Proof

Proof submissions attach work evidence to an agreement and milestone. Proof creation requires an `Idempotency-Key` header.

```http
POST /v1/proofs
X-API-Key: pa_test_xxx
Idempotency-Key: proof_order_123_m1_v1
Content-Type: application/json
```

```json
{
  "agreementId": "agreement_uuid",
  "milestoneId": "milestone_uuid",
  "submittedByExternalId": "contractor_789",
  "type": "url",
  "content": "https://example.com/work/landing-page",
  "links": ["https://example.com/work/landing-page"],
  "fileRefs": []
}
```

Proof cannot be submitted for released, refunded, cancelled, or expired agreements. A successful submission emits `proof.submitted` and moves active funded work toward `proof_submitted`.

### 8. How To Approve Or Reject Proof

Review decisions are submitted through the proof review endpoint. This route requires the `proofs:review` scope.

```http
POST /v1/proofs/:proofId/review
X-API-Key: pa_test_xxx
Content-Type: application/json
```

Approve proof:

```json
{
  "reviewerExternalId": "client_456",
  "decision": "approved",
  "note": "Work accepted."
}
```

Reject proof:

```json
{
  "reviewerExternalId": "client_456",
  "decision": "rejected",
  "note": "Please fix the mobile spacing issues."
}
```

Request changes:

```json
{
  "reviewerExternalId": "client_456",
  "decision": "needs_changes",
  "note": "Please upload the final deployment URL."
}
```

`approved` moves the proof to `accepted` and the agreement/milestone to `approved`. `rejected` records rejection. `needs_changes` records the request and moves the agreement/milestone back toward `in_progress`.

### 9. How To Release Or Refund Escrow

Escrow release and refund require idempotency keys and database transactions.

Release is only allowed when escrow is funded and the related proof has been approved, or when dispute resolution authorizes release.

```http
POST /v1/escrows/:id/release
X-API-Key: pa_test_xxx
Idempotency-Key: release_order_123_m1
Content-Type: application/json
```

```json
{}
```

Refund is forbidden after release. Release is forbidden after refund.

```http
POST /v1/escrows/:id/refund
X-API-Key: pa_test_xxx
Idempotency-Key: refund_order_123_m1
Content-Type: application/json
```

```json
{}
```

Release/refund operations create transaction records, audit logs, and lifecycle events.

### 10. How Events Work

Events are durable, app-scoped lifecycle records. They are created for important actions such as agreement creation, milestone creation, escrow creation/funding/release/refund, proof submission, proof review, dispute opening/resolution, and final webhook delivery failure.

Query events:

```http
GET /v1/events?limit=20
X-API-Key: pa_test_xxx
```

Filter by type:

```http
GET /v1/events?type=proof.submitted
X-API-Key: pa_test_xxx
```

Useful event types include:

- `agreement.created`
- `agreement.accepted`
- `agreement.funding_required`
- `agreement.funded`
- `agreement.released`
- `agreement.refunded`
- `milestone.created`
- `milestone.proof_submitted`
- `milestone.approved`
- `escrow.created`
- `escrow.funded`
- `escrow.released`
- `escrow.refunded`
- `escrow.failed`
- `proof.submitted`
- `proof.approved`
- `proof.rejected`
- `proof.needs_changes`
- `dispute.opened`
- `dispute.resolved`
- `webhook.delivery_failed`

Events are also used to enqueue webhook deliveries for matching app webhook endpoints.

### 11. How Webhooks Are Signed

Webhook endpoints are app-scoped. Create one with the `webhooks:manage` scope:

```http
POST /v1/webhook-endpoints
X-API-Key: pa_test_xxx
Content-Type: application/json
```

```json
{
  "url": "https://example.com/pactagent/webhook",
  "description": "Production event receiver",
  "subscribedEvents": [
    "agreement.created",
    "proof.submitted",
    "proof.approved",
    "escrow.released",
    "dispute.opened"
  ]
}
```

The response includes a raw webhook signing secret only once. PactAgent stores a hash plus an encrypted copy for delivery signing.

Each webhook delivery is signed with HMAC SHA-256 over:

```text
timestamp + "." + rawBody
```

Webhook requests include:

```http
PactAgent-Event-Id: event_uuid
PactAgent-Timestamp: 1782518400
PactAgent-Signature: sha256=<hex_digest>
```

Failed webhook deliveries are retried on this bounded schedule:

- 1 minute
- 5 minutes
- 15 minutes
- 1 hour
- 6 hours

Delivery logs are available through:

```http
GET  /v1/webhook-deliveries
GET  /v1/webhook-deliveries/:id
POST /v1/webhook-deliveries/:id/retry
```

### 12. How To Verify Webhooks

Consumers must verify the signature against the exact raw request body before parsing JSON.

```ts
import crypto from 'crypto';

export function verifyPactAgentWebhook(params: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}) {
  const expected = `sha256=${crypto
    .createHmac('sha256', params.secret)
    .update(`${params.timestamp}.${params.rawBody}`)
    .digest('hex')}`;

  if (expected.length !== params.signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(params.signature),
  );
}
```

Recommended consumer behavior:

- reject requests with missing webhook headers
- reject old timestamps according to your replay tolerance
- verify the HMAC before parsing the body
- process webhook event IDs idempotently
- return a 2xx response only after the event is safely accepted

### 13. How Idempotency Works

Sensitive lifecycle actions use an `Idempotency-Key` header. The key is scoped to the current app.

If the same key is reused with the same request body, PactAgent returns the stored response. If the same key is reused with a different request body, PactAgent returns a conflict error.

Currently enforced idempotent routes:

- `POST /v1/escrows`
- `POST /v1/escrows/:id/release`
- `POST /v1/escrows/:id/refund`
- `POST /v1/proofs`
- `POST /v1/disputes/:id/resolve`

Example:

```http
POST /v1/escrows/:id/release
X-API-Key: pa_test_xxx
Idempotency-Key: release_order_123_m1
Content-Type: application/json
```

Use stable, operation-specific keys from your own system, such as `release_<orderId>_<milestoneId>`.

### 14. How Sandbox Mode Works

Sandbox mode is for integration testing without real value transfer.

Sandbox conventions:

- apps use `environment: "sandbox"`
- sandbox API keys start with `pa_test_`
- mock escrow uses `rail: "mock"` and `network: "sandbox"`
- manual escrow transitions are available for controlled testing
- production webhook URLs must be HTTPS, while sandbox can use HTTP only for public non-local test hosts
- sandbox still enforces app scoping, scopes, validation, idempotency checks, and webhook URL SSRF protections

Seed data includes a generic `Sandbox Demo App`, a disabled `Production Demo App`, sandbox API keys, a sandbox agreement, milestone, mock escrow, proof submission, and a safe test webhook endpoint. It does not seed app-specific marketplace, ProofPay, DAO, or bounty-import infrastructure logic.

### 15. Security Notes For Integrators

Integrator responsibilities:

- store PactAgent API keys only in server-side secret storage
- never expose `pa_test_` or `pa_live_` keys in browsers or mobile apps
- use the minimum required scopes for each key
- rotate and revoke keys when access changes
- always send idempotency keys for sensitive lifecycle writes
- verify webhook signatures before parsing or trusting webhook payloads
- deduplicate webhook events by event ID or delivery ID
- use HTTPS webhook endpoints in production
- return 2xx only after webhook processing is safely persisted
- treat all IDs from your app as external references, not authorization proof

PactAgent security controls:

- raw API keys are never stored
- API keys are hashed and scoped to one app
- every infrastructure query is app-scoped
- request bodies and query parameters are validated
- metadata and proof links have size/count limits
- invalid state transitions are rejected
- duplicate release/refund paths are blocked
- audit logs are written for sensitive operations
- webhook endpoint creation blocks localhost, private IP ranges, metadata IPs, file URLs, credentials, and non-HTTP protocols
- webhooks are signed with HMAC SHA-256
- internal `/v1/admin` routes require a wallet JWT from the `ADMIN_ADDRESSES` allowlist; app API keys cannot access global admin data

### Infrastructure Routes

```http
POST   /v1/apps
GET    /v1/apps
GET    /v1/apps/current
GET    /v1/apps/:id
PATCH  /v1/apps/:id
POST   /v1/apps/:id/disable

POST   /v1/api-keys
GET    /v1/api-keys
DELETE /v1/api-keys/:id

POST   /v1/agreements
GET    /v1/agreements
GET    /v1/agreements/:id
POST   /v1/agreements/:id/accept
POST   /v1/agreements/:id/funding-required
POST   /v1/agreements/:id/cancel

POST   /v1/agreements/:id/milestones
GET    /v1/agreements/:id/milestones
GET    /v1/milestones/:id

POST   /v1/escrows
GET    /v1/escrows
GET    /v1/escrows/:id
POST   /v1/escrows/:id/mark-funded
POST   /v1/escrows/:id/release
POST   /v1/escrows/:id/refund

GET    /v1/transactions

POST   /v1/proofs
GET    /v1/proofs
GET    /v1/proofs/:id
POST   /v1/proofs/:id/review

POST   /v1/disputes
GET    /v1/disputes
GET    /v1/disputes/:id
POST   /v1/disputes/:id/resolve

GET    /v1/events
GET    /v1/events/:id

POST   /v1/webhook-endpoints
GET    /v1/webhook-endpoints
GET    /v1/webhook-endpoints/:id
PATCH  /v1/webhook-endpoints/:id
DELETE /v1/webhook-endpoints/:id

GET    /v1/webhook-deliveries
GET    /v1/webhook-deliveries/:id
POST   /v1/webhook-deliveries/:id/retry

GET    /v1/audit-logs

GET    /v1/admin/system-health
GET    /v1/admin/apps
GET    /v1/admin/agreements
GET    /v1/admin/escrows
GET    /v1/admin/events
GET    /v1/admin/webhook-deliveries
GET    /v1/admin/audit-logs

GET    /health
GET    /ready
```

`GET /health` is a lightweight liveness check. `GET /ready` verifies the database can answer a simple query and returns `503` when the backend is not ready to serve traffic.

## What The Project Does

PactAgent allows two participants to coordinate work and payment through a milestone contract flow:

1. The client connects a CCC-compatible wallet and signs an authentication challenge.
2. The client creates a milestone agreement with:
   - title and description
   - worker address
   - dispute window and deadline
   - proof type
   - reviewer mode
   - payout network
   - one or more milestones with fixed amounts
3. The client funds the agreement on CKB.
4. The worker submits proof for the active milestone.
5. The agent validates the next step and moves the agreement into review.
6. Depending on reviewer mode, the agent or client approves payout, or a dispute is opened.
8. After a milestone is paid, the next one becomes active until the agreement is complete.

PactAgent also supports imported grant and bounty workflows:

1. An operator can paste a Nervos forum grant thread into the dedicated import flow.
2. PactAgent auto-fills source metadata, governance context, source budget references, and draft milestone structure from the original source.
3. Imported Nervos grants can preserve separate commencement payments as their own kickoff checkpoint instead of forcing them into Milestone 1.
4. Imported milestone USD budgets can auto-populate live CKB estimates, and operators can refresh all estimates or convert between USD and CKB before finalizing payout amounts.
5. Once funding is confirmed, a dedicated commencement payment can be auto-released immediately while the remaining grant stays milestone-reviewed.
6. The imported work is converted into manually reviewed milestones with partial release behavior.
7. Proof is checked for completeness before human review, and missing information can trigger structured follow-up requests.
8. Source-thread updates can be drafted, reviewed, published, and synced over time.

## Current Product Scope

What is already implemented:
- real CCC wallet connection in the web app
- wallet-signature authentication with JWT-backed API sessions
- protected agreement and participant actions
- milestone agreement creation
- deployed on-chain milestone escrow lock contract (`pact_escrow_lock`)
- real on-chain CKB milestone escrow funding with one escrow cell per milestone
- manual on-chain escrow payout and refund transaction signing paths for CKB
- treasury-driven funding and settlement path for agreements that still use `TREASURY_BRIDGE`
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
- Prisma + PostgreSQL persistence, ready for Supabase

Important architecture note:

PactAgent now includes a real on-chain CKB escrow lock for milestone funding and settlement on CKB L1. Each milestone can be funded into its own escrow cell, and payout / refund resolution is enforced by the on-chain `pact_escrow_lock` script.

At the same time, the broader agreement coordination layer is still off-chain. Agreement metadata, participant roles, proofs, disputes, review records, logs, and lifecycle orchestration are stored in PostgreSQL through Prisma and coordinated by the backend worker. In other words: escrow settlement on CKB is on-chain, while the surrounding agreement workflow remains application-managed.

## User Flows

### Client Flow

1. Connect wallet and sign in.
2. Create a new agreement.
3. Define milestones and total escrow amount.
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

### Imported Grant / Bounty Flow

1. Paste a Nervos forum grant thread into the import flow and let PactAgent auto-fill the source fields.
2. Review the imported source snapshot, including requested USD budget, ETA, funding address, and any separate commencement payment.
3. Use the live CKB quote panel to estimate current CKB equivalents for the imported USD values.
4. Let imported milestone USD references auto-fill their current CKB equivalents, then use `Refresh All CKB Estimates` or the USD/CKB converter helpers when you want to re-run the latest quote.
5. Add, remove, or edit milestones freely so the final agreement matches the real delivery plan even when the source thread has more or fewer than four checkpoints.
6. Fund a buffered CKB reserve once so the agreement has enough settlement capacity for normal price movement.
7. If the import includes a separate commencement payment, PactAgent converts that kickoff USD target into CKB at funding confirmation time and releases it automatically.
8. Run a proof completeness check before approving the remaining milestones through manual review. Each later payout uses a fresh quote and can request a reserve top-up if the remaining CKB is insufficient.
9. Request more info through structured reviewer questions when needed.
10. Optionally sync or publish source-thread updates for governance visibility.

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
- polling imported source threads for updates
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

### Agreement Detail Page

- displays agreement metadata and milestone timeline
- allows funding, proof submission, proof checking, review actions, info requests, dispute actions, and evidence submission
- displays submitted proofs and agreement-specific logs
- surfaces imported source metadata, source sync controls, and operational history

## Backend Architecture

The codebase is split into three packages:

- `web/`: Next.js frontend with CCC wallet integration
- `shared/`: shared enums, types, and state machine helpers

Core backend responsibilities:
- wallet-challenge authentication and JWT session issuance
- route-level participant authorization
- agreement lifecycle persistence
- milestone and dispute operations
- settlement orchestration
- realtime event broadcasting


PactAgent currently uses:

- `@ckb-ccc/ccc`
  - wallet connectivity
  - CKB client access
  - address parsing and normalization
  - transaction construction and sending
- CKB RPC node access
  - configurable for testnet or mainnet
- real CKB L1 transfers
  - client wallet can fund milestone escrow cells on-chain through the Pact escrow lock
  - on-chain escrow payout and refund transactions can be signed manually against funded milestone cells
  - treasury wallet still supports the `TREASURY_BRIDGE` settlement path where used
  - node health checks
  - node info
  - channel listing/open/close
  - peer connect/disconnect
  - invoice creation and payment
  - keysend-style payout attempts

How settlement works today:
- for `ONCHAIN_LOCK` agreements, the client funds one escrow cell per milestone on CKB
- the agreement stores the funding transaction hash, milestone output indexes, escrow cell data, and refund timeout metadata
- when a milestone is approved, PactAgent prepares the milestone for manual on-chain payout settlement
- when a refund is needed, PactAgent supports manual on-chain refund settlement for escrow-backed milestones
- for `TREASURY_BRIDGE` agreements, the treasury-driven settlement path still exists and remains server-managed
- settlement references and audit history are saved on the agreement

What is not yet implemented:
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

### Imported Grant Pricing

Implemented:
- `GET /api/integrations/market/ckb-price` for live CKB/USD quotes
- live CKB conversion panels on the grant import page for requested budget, commencement payment, and milestone budget references
- automatic CKB prefill from imported USD source budgets when a live quote is available
- milestone-level USD helper inputs with `USD -> CKB` and `CKB -> USD` conversion support
- a single `Refresh All CKB Estimates` action for reapplying the latest quote across the full grant
- automatic quote refresh while the imported grant form is open
- canonical USD milestone targets stored for imported DAO and bounty grants
- buffered reserve funding for new imported grants
- payout-time USD -> CKB conversion for imported milestone releases
- reserve top-up flow when price movement makes the remaining CKB insufficient

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
- `SEED_SANDBOX_API_KEY` is optional; if set before running the seed, the demo sandbox API key will use that raw key value and store only its hash
- auth and agreement write endpoints now have in-memory rate limits; tune them with the `*_RATE_LIMIT_*` variables
- set `ONCHAIN_ESCROW_ENABLED=true` together with `ONCHAIN_LOCK_CODE_HASH`, `ONCHAIN_LOCK_TX_HASH`, and `ONCHAIN_LOCK_INDEX` once you have a deployed lock script and want the app to expose the `ONCHAIN_LOCK` escrow model
- set `FORUM_PUBLISH_ENABLED=true` to let Phase 4 publish approved source-thread updates directly
- `FORUM_PUBLISH_PROVIDER=DISCOURSE` posts replies to Discourse topic URLs using `FORUM_PUBLISH_API_KEY` and `FORUM_PUBLISH_API_USERNAME`
- `FORUM_PUBLISH_PROVIDER=WEBHOOK` sends the approved update payload to `FORUM_PUBLISH_WEBHOOK_URL` so you can bridge to other governance/forum systems
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
- `ONCHAIN_LOCK` agreements fund milestone escrow cells directly on-chain, while `TREASURY_BRIDGE` agreements still use the treasury-managed path
- the frontend validates a minimum 61 CKB output requirement for CKB transaction outputs
- agreement routes are protected and require an authenticated wallet session

## Current Limitations

- agreement logic is off-chain even though settlement uses real CKB transfers
- treasury custody is still a trust assumption in the current architecture
- proof validation is still operationally focused rather than cryptographic or oracle-backed verification
- dispute AI is advisory, not a replacement for arbitration
- existing imported grants created before the new reserve model still behave as fixed-CKB agreements and are not migrated automatically
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
- [server/src/services/disputeService.ts](/c:/Users/ajayh/Desktop/pactagent/server/src/services/disputeService.ts)
- [server/prisma/schema.prisma](/c:/Users/ajayh/Desktop/pactagent/server/prisma/schema.prisma)

## License

This project is licensed under the MIT License. See [LICENSE](/c:/Users/ajayh/Desktop/pactagent/LICENSE).
