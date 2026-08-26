# PactAgent Contracts

This workspace contains the first on-chain contract for PactAgent:

- `pact_escrow_lock`: one escrow cell per milestone with:
  - cooperative payout
  - cooperative refund
  - timeout refund

## Build

```bash
cd contracts
make build
```

This produces:

```text
build/release/pact_escrow_lock
```

## Test

```bash
cd contracts
make test
```

## Deploy

Example with `offckb`:

```bash
cd contracts
offckb deploy \
  --network testnet \
  --type-id \
  --target ./build/release/pact_escrow_lock \
  --output ./deployed
```

Phase 1 does not consume contract deployment configuration because the `/v1`
CKB adapter remains an intentionally rejecting stub. To make the standalone
testnet smoke check verify a deployed contract transaction, run:

```bash
CKB_CONTRACT_DEPLOYMENT_TX_HASH=0x... npm run test:testnet
```

Phase 2 must define reviewed adapter configuration for the deployed code cell,
signer, fee policy, confirmation policy, and reconciliation before enabling the
CKB rail.
