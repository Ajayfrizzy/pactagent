# Data, API and compatibility migration plan

This is a schema diff **on paper only**. No Prisma, SQL migration, API or runtime file changes are authorized in M0. [System design](system-design.md) defines AssetId and rail interfaces; [milestone contracts](milestone-contracts.md) assign implementation ownership.

## Proposed additive models and constraints

| Existing or new entity | Proposed additions and invariants | Delivery |
| --- | --- | --- |
| Asset (new) | id, namespace, chainReference, assetKind/reference, decimals, maxBaseUnits, issuerEvidenceHash, status, registryVersion; unique canonical identity | M1 |
| RailDeployment (new) | rail, networkId, version, code/address identity, capability set, confirmationPolicyVersion; no mutable historical identity | M1/M2/M8 |
| Agreement/Milestone | nullable assetId initially; legacy currency retained; amount remains integer string; final asset inherited consistently | M1 |
| Escrow | assetId, deploymentId, termsVersion/hash, immutable terms payload, principal, clientFeeDeposit, treasuryVersionId, authorityPolicyId, confirmationPolicyVersion, lifecycleVersion; retain all CKB v1 fields | M1 groundwork; later policy fields by owners |
| ParticipantBinding/Consent (new) | appId, externalId, role, network, authority, recipient, version, proofHash; consent purpose, termsHash, signature scheme/bytes, expiry and verified block | M1 interfaces; M2/M3 implementation |
| SettlementIntent/Operation (new) | appId, escrowId, nonce, revision, intentHash, W/C and fees, signature proofs; signed artifact reference, expected tx identity, broadcast state; unique escrow nonce consumption | M1/M2 |
| ChainObservation (new) | deployment, transaction/outpoint/log identity, block hash/height, canonicality, finality, policy version; append-only observations | M1/M2 |
| ConsoleAccount/Membership/RoleGrant/Invitation (new) | stable account/person IDs; unique appId+accountId; unique membership+role; token hash/expiry/single use; app-bound role grants | M3 |
| TreasuryVersion/FeePolicyVersion (new) | appId, network, immutable destination/rates, proof and approval policy/version; exactly one active future default per scope | M4/M5 |
| BillingAccount/Reservation/Journal/JournalLine (new) | app and asset partition, unique settlement capture, balanced positive debit/credit lines, immutable reversal references | M5 |
| DisputeCase/EvidenceVersion/Proposal/Approval/ArbitrationPolicy (new) | app+escrow+case composite scope; immutable revision hashes; distinct-person approval uniqueness; dual consent references | M6/M7 |
| Event/WebhookDelivery | schemaVersion, aggregateId/version, correlationId, observationId, correctionOf; immutable delivery snapshot | M1/M9 |

Illustrative Prisma-style constraints, not a migration:

```prisma
// New tenant-owned tables each include appId and a composite identity.
// Escrow retains @@unique([id, appId]).
model SettlementIntent {
  id          String @id
  appId       String
  escrowId    String
  nonce       String
  intentHash  String
  termsHash   String
  // relation(fields: [escrowId, appId], references: [id, appId])
  @@unique([id, appId])
  @@unique([escrowId, nonce, intentHash])
}
// A separate operation/consumption uniqueness rule permits proposal history
// but at most one active execution/consumed nonce for a terminal escrow.
```

Every child relation must constrain both tenant and complete parent scope, including agreement/milestone consistency. Add SQL CHECKs for canonical integers, asset-specific bounds, fee bounds, conserved allocations and balanced ledgers; Prisma alone is insufficient. Lock the scope on conflicting intents/reservations with CAS/version checks and unique active-operation indexes. Never use a free-form JSON field as the only enforcement of principal or consent.

## Expansion, backfill and cutover

1. Inventory all environments read-only, including currency/network values, historical lock deployments, incomplete commitments and legacy `pactagent_managed` dispute labels. Snapshot counts and verification checksums. No production reads are claimed in M0.
2. Add nullable columns/new tables and supporting indexes in forward migrations. Existing uint64 constraints remain for CKB; broaden only with explicit asset-specific validation. Use staged `NOT VALID` constraints followed by validation where PostgreSQL permits; plan lock windows for unique indexes. Never rewrite applied migrations or use db push.
3. Backfill known CKB records only when network genesis and code/deployment identity are verified. Copy original lock scripts, outpoints, data, amount and contract version unchanged. Mark uncertain rows `legacy_unverified`; block new features for them and reconcile manually. Sandbox/manual records remain synthetic, never relabeled real USDC.
4. Dual-read: prefer verified assetId/termsVersion; otherwise use explicit legacy CKB path. During compatibility window dual-write legacy currency/network plus new fields **in the same transaction** for representable CKB v1 writes. No asynchronous dual-writer race. New assets/v2 contracts use new versioned endpoints; old endpoints reject unsupported combinations.
5. Compare old/new projections in shadow reads, with tenant-safe metrics, then enable per-app testnet flags. Validate populated-upgrade fixtures, active escrow uniqueness, immutable funded commitments, rollback to old reader compatibility and event payload contracts.
6. Tighten non-null constraints only for new-version rows after backfill is proven. Keep funded v1 cells on v1 adapter indefinitely until spent. No automatic on-chain migration; voluntary close/reopen uses original authority, fresh commitments and explicit user consent.

Rollback disables new creation/routes and restores compatible reader version; it does not delete new observations, journals or v2 escrows. Keep observer/settlement support for all funded versions. Destructive cleanup requires a later migration and evidence no active records depend on it.

## API proposal and authorization

Keep current `/v1` behavior documented as legacy; introduce `/v2` for changed asset/consent/settlement semantics (decision D08). Additive read metadata may be introduced in v1 only after compatibility tests. The following is illustrative JSON, with registry/deployment references resolved on the server, not a currently callable endpoint:

```json
{
  "agreementId": "agreement-id",
  "milestoneId": "milestone-id",
  "assetId": "registry-verified-native-usdc-id",
  "deploymentId": "approved-base-sepolia-v2",
  "principal": "100000000",
  "clientBindingVersion": "binding-client-v1",
  "workerBindingVersion": "binding-worker-v1",
  "feePolicyVersion": "app-fees-v3",
  "treasuryVersion": "treasury-base-sepolia-v2",
  "arbitrationPolicyVersion": null,
  "fallback": { "workerPrincipal": "0", "clientPrincipal": "100000000" },
  "deadlinePolicyVersion": "agreed-deadlines-v1"
}
```

This example's full-client fallback is a disclosed selected allocation, not a global default. `POST /v2/escrow-terms` returns resolved immutable terms, termsHash, required signers and expiresAt. `POST /v2/escrows` accepts both funding consent proofs and termsHash under an app-scoped idempotency key; it reserves billing and prepares funding. `POST /v2/escrows/:id/intents` records exact allocations and action; `/authorizations` accepts wallet proofs; `/operations` submits/broadcasts valid artifacts. `GET` returns separate case, authorization, transaction and settlement states with finality evidence. Neither `appId` nor verified amounts/recipients may be overridden by body fields.

Stable errors include `unsupported_asset`, `unsupported_rail_capability`, `terms_mismatch`, `consent_required`, `invalid_signature`, `stale_revision`, `intent_expired`, `billing_credit_insufficient`, `idempotency_conflict`, `settlement_pending`, `reconciliation_required` and tenant-safe `not_found`. Reject forged consent before preparing fund movements. APIs must not expose signatures granting live execution unnecessarily; public clients receive only the proofs they are authorized to use.

## Events, SDKs and legacy meanings

New envelopes: `{id, appId, schemaVersion, aggregateId, aggregateVersion, type, occurredAt, observationId, data}`. `settlement.authorized`, `settlement.broadcast`, `settlement.confirmed`, `settlement.reorged` are distinct. `dispute.resolved` remains a recorded outcome, never a paid event. Frozen v1 deliveries retain their serialized body and signature verification behavior; endpoint subscriptions explicitly opt into v2. At-least-once delivery with no global ordering; SDK validates timestamp window plus HMAC over raw body, deduplicates IDs and refreshes aggregate on version gaps.

No standalone SDK package was found at audited HEAD; web/src/lib/api.ts is a first-party client, and server/docs contains OpenAPI/examples. M9 adds SDKs only after API and event contracts settle. Existing `app_managed` or `pactagent_managed` values cannot be mapped to valid arbitration consent; preserve as legacy labels with no new authority. Historical split resolution amounts are accounting intent only, not proof that a CKB split executed.
