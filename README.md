# PactAgent

PactAgent is a milestone-based escrow and payout app for Nervos CKB. A client creates and funds an agreement, a worker submits proof for each milestone, and the background agent advances the agreement toward payout, refund, expiry, or dispute handling.

## What is real now

- Real CCC wallet connection in the web app
- Wallet-signature authentication with JWT-backed API sessions
- Milestone agreement creation and protected participant actions
- Real CKB funding from the client wallet to the configured treasury wallet
- Real CKB payout/refund attempts from the treasury wallet
- Fiber payout path with CKB fallback
- Prisma configured for PostgreSQL, ready for Supabase

## Stack

- `web/`: Next.js + CCC wallet integration
- `server/`: Express + Prisma + background agent worker + WebSocket
- `shared/`: shared agreement types and enums
- `database`: PostgreSQL via Supabase

## Required configuration

### Server

Copy [`server/.env.example`](/c:/Users/ajayh/Desktop/hackathon/server/.env.example) to `server/.env` and configure:

- `DATABASE_URL`: Supabase pooled PostgreSQL connection string
- `DIRECT_URL`: Supabase direct PostgreSQL connection string for Prisma
- `CORS_ORIGIN`: frontend origin
- `CKB_NODE_URL`: real CKB RPC endpoint
- `CKB_NETWORK`: `testnet` or `mainnet`
- `TREASURY_CKB_PRIVATE_KEY`: private key for the treasury wallet that sends payouts/refunds
- `TREASURY_CKB_ADDRESS`: optional explicit treasury address
- `AUTH_JWT_SECRET`: long random secret
- `FIBER_*`: Fiber or FiberPay connection details if you want off-chain payout attempts
- `OPENAI_API_KEY`: optional, only if you enable AI recommendations

### Web

Copy [`web/.env.example`](/c:/Users/ajayh/Desktop/hackathon/web/.env.example) to `web/.env.local` and configure:

- `NEXT_PUBLIC_CKB_NETWORK`
- `NEXT_PUBLIC_CKB_NODE_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_WS_URL`
- `API_PROXY_TARGET`

## Supabase setup

1. Create a Supabase project.
2. In Supabase, open `Project Settings -> Database`.
3. Copy the pooled connection string into `DATABASE_URL`.
4. Copy the direct connection string into `DIRECT_URL`.
5. Make sure both strings include `sslmode=require`.

Example shape:

```env
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
DIRECT_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
```

## Local run

### 1. Install dependencies

```bash
cd server
npm install

cd ../web
npm install
```

### 2. Generate Prisma client and push schema

```bash
cd server
npx prisma generate
npx prisma db push
```

### 3. Seed demo data if needed

```bash
cd server
npm run seed
```

### 4. Start the backend

```bash
cd server
npm run dev
```

### 5. Start the frontend

```bash
cd web
npm run dev
```

## Product flow

1. Connect a CCC-compatible wallet.
2. Sign the PactAgent auth challenge.
3. Create a milestone agreement as the client.
4. Fund the agreement from the connected wallet to the treasury wallet.
5. Let the worker submit proof for the active milestone.
6. Let the agent auto-approve or wait for client review.
7. Send payout through Fiber when configured, otherwise settle on CKB.

## Important notes

- The treasury wallet must actually hold the funds needed for payout and refund execution.
- Fiber payout still depends on a reachable Fiber/FiberPay backend. If it fails, PactAgent falls back to CKB settlement.
- Agreement routes are now protected, so the UI must be used from an authenticated wallet session.
- If you already placed secrets in [`server/.env`](/c:/Users/ajayh/Desktop/hackathon/server/.env), rotate any exposed production keys before shipping.
