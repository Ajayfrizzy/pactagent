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

Then set:

```env
ONCHAIN_ESCROW_ENABLED=true
ONCHAIN_LOCK_CODE_HASH=0x...
ONCHAIN_LOCK_HASH_TYPE=type
ONCHAIN_LOCK_TX_HASH=0x...
ONCHAIN_LOCK_INDEX=0x0
ONCHAIN_LOCK_DEP_TYPE=code
```
