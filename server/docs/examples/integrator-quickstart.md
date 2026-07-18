# PactAgent Infrastructure API Examples

Set these once:

```bash
export PACTAGENT_URL="http://localhost:4000"
export PACTAGENT_API_KEY="pa_test_replace_me"
```

## Current App

```bash
curl -sS "$PACTAGENT_URL/v1/apps/current" \
  -H "x-api-key: $PACTAGENT_API_KEY"
```

## Create Agreement

```bash
curl -sS "$PACTAGENT_URL/v1/agreements" \
  -H "x-api-key: $PACTAGENT_API_KEY" \
  -H "Idempotency-Key: agreement-demo-001" \
  -H "Content-Type: application/json" \
  -d '{
    "externalReferenceId": "order_1001",
    "title": "Landing page implementation",
    "description": "Build the approved landing page from the design spec.",
    "clientExternalId": "client_123",
    "workerExternalId": "worker_456",
    "totalAmount": "50000000000",
    "currency": "CKB",
    "releaseMode": "milestone",
    "disputeMode": "app_managed",
    "metadata": {
      "source": "demo"
    }
  }'
```

## Create Milestone

```bash
curl -sS "$PACTAGENT_URL/v1/agreements/$AGREEMENT_ID/milestones" \
  -H "x-api-key: $PACTAGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "externalReferenceId": "milestone_1",
    "title": "Responsive implementation",
    "description": "Deliver production-ready responsive markup.",
    "amount": "50000000000",
    "currency": "CKB"
  }'
```

## Create Sandbox Mock Escrow

```bash
curl -sS "$PACTAGENT_URL/v1/escrows" \
  -H "x-api-key: $PACTAGENT_API_KEY" \
  -H "Idempotency-Key: escrow-demo-001" \
  -H "Content-Type: application/json" \
  -d '{
    "agreementId": "'"$AGREEMENT_ID"'",
    "milestoneId": "'"$MILESTONE_ID"'",
    "amount": "50000000000",
    "currency": "CKB",
    "rail": "mock",
    "network": "sandbox"
  }'
```

## Mark Manual/Mock Escrow Funded

```bash
curl -sS "$PACTAGENT_URL/v1/escrows/$ESCROW_ID/mark-funded" \
  -H "x-api-key: $PACTAGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txHash":"mock_funding_tx_001"}'
```

## Submit Proof

```bash
curl -sS "$PACTAGENT_URL/v1/proofs" \
  -H "x-api-key: $PACTAGENT_API_KEY" \
  -H "Idempotency-Key: proof-demo-001" \
  -H "Content-Type: application/json" \
  -d '{
    "agreementId": "'"$AGREEMENT_ID"'",
    "milestoneId": "'"$MILESTONE_ID"'",
    "submittedByExternalId": "worker_456",
    "type": "url",
    "content": "https://example.com/delivery",
    "links": ["https://example.com/delivery"],
    "fileRefs": []
  }'
```

## Approve Or Reject Proof

```bash
curl -sS "$PACTAGENT_URL/v1/proofs/$PROOF_ID/review" \
  -H "x-api-key: $PACTAGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "reviewerExternalId": "client_123",
    "decision": "approved",
    "note": "Delivery accepted."
  }'
```

Use `"decision":"rejected"` or `"decision":"needs_changes"` for non-approval outcomes.

## Release Or Refund Escrow

```bash
curl -sS "$PACTAGENT_URL/v1/escrows/$ESCROW_ID/release" \
  -H "x-api-key: $PACTAGENT_API_KEY" \
  -H "Idempotency-Key: release-demo-001" \
  -H "Content-Type: application/json" \
  -d '{}'
```

```bash
curl -sS "$PACTAGENT_URL/v1/escrows/$ESCROW_ID/refund" \
  -H "x-api-key: $PACTAGENT_API_KEY" \
  -H "Idempotency-Key: refund-demo-001" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Query Events

```bash
curl -sS "$PACTAGENT_URL/v1/events?limit=20" \
  -H "x-api-key: $PACTAGENT_API_KEY"
```

## Create Webhook Endpoint

```bash
curl -sS "$PACTAGENT_URL/v1/webhook-endpoints" \
  -H "x-api-key: $PACTAGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://webhook.site/example",
    "description": "Demo lifecycle receiver",
    "subscribedEvents": ["agreement.created", "proof.submitted", "escrow.released", "escrow.failed"]
  }'
```

The response includes `secret` once. Store it in your receiving application.

## Verify Webhook Signature

```js
import crypto from "crypto";

function verifyPactAgentWebhook({ secret, timestamp, rawBody, signature }) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

## Idempotency

Use `Idempotency-Key` for create/release/refund/proof/dispute-resolution retries. The same key with the same request body returns the stored response. The same key with a different body returns a conflict.
