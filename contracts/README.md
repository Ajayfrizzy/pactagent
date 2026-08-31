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

The `/v1` CKB adapter consumes explicit deployment configuration only when
`CKB_RAIL_ENABLED=true`. To make the non-mutating testnet smoke check verify a
deployed contract transaction, run:

```bash
CKB_CONTRACT_DEPLOYMENT_TX_HASH=0x... npm run test:testnet
```

The contract rejects malformed/noncanonical terms, unsupported timeout encoding,
multiple escrow inputs, duplicate matching outputs, and ambiguous client/worker
outputs. Rust tests exercise the pure validation rules. Transaction-level VM
tests and an external contract security review are still required before real-value
or mainnet use.

The controlled API testnet release/refund harness is opt-in and requires funded
testnet credentials:

```bash
CKB_TESTNET_E2E=true \
PACTAGENT_API_URL=http://localhost:4000 \
PACTAGENT_API_KEY=pa_test_... \
CKB_NETWORK=testnet \
CKB_TESTNET_SIGNER_LOCK_SCRIPT='{"codeHash":"0x...","hashType":"type","args":"0x..."}' \
CKB_TESTNET_COUNTERPARTY_LOCK_SCRIPT='{"codeHash":"0x...","hashType":"type","args":"0x..."}' \
npm run test:testnet
```

Local private-key signing is development/testnet-only. Staging, production, and
mainnet remain disabled until a reviewed external signer provider is installed.
