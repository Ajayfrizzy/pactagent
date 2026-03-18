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
- Prisma + PostgreSQL persistence, ready for Supabase

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
4. Add more context if a dispute is opened.
5. Receive payout through Fiber when available, otherwise on CKB.

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
- validating submitted proof presence
- moving agreements into review
- auto-approving milestones in `AUTO` mode
- waiting for user confirmation in `HYBRID` and `MANUAL` paths
- generating dispute recommendations
- initiating payout or refund settlement
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

### Agreement Detail Page

- displays agreement metadata and milestone timeline
- shows funding, settlement, and Fiber references
- allows funding, proof submission, review actions, dispute actions, and evidence submission
- displays submitted proofs and agreement-specific logs

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

This is used only for dispute recommendation, not autonomous fund release.

- default mode is a deterministic mock engine
- optional OpenAI integration is supported through configuration
- the OpenAI path uses the Responses API with structured JSON schema output
- recommendations include:
  - summary
  - recommendation type
  - confidence
  - rationale

Important safety property:

AI output is advisory only. It does not directly move funds without the normal agreement review path.

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

AGENT_INTERVAL_MS=10000

FIBER_ENABLED=false
FIBER_NODE_URL=http://127.0.0.1:8227
FIBER_API_KEY=

AI_ENABLED=false
AI_PROVIDER=mock
AI_TIMEOUT_MS=
OPENAI_MODEL=
OPENAI_API_KEY=
```

Notes:
- `TREASURY_CKB_PRIVATE_KEY` is required for payout and refund execution
- `TREASURY_CKB_ADDRESS` is optional and can be derived from the private key
- enable `FIBER_ENABLED=true` only if you have a reachable Fiber node
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
- proof validation is lightweight and based on workflow/state rather than deep verification
- dispute AI is advisory, not a replacement for arbitration
- there is no role-separated admin or arbitrator interface yet

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
