# PactAgent multi-asset platform fee administration — approved direction

Status: **product direction approved 2026-11-09, not implemented**. Applies to **all integrating applications**, not one particular application. Distinguish (A) fees the integrating app charges its own client and worker from (B) fees PactAgent charges the integrating business.

## Fee configuration

PactAgent internal Admin Console: **Platform Fees**. Show default per-asset/rail rates, per-application overrides, proposed/pending/active/superseded policies, effective times, revenue and audited approval history. Examples are illustrative; **no universal numeric fee schedule is approved**.

| Asset/rail | Integrating application's own client/worker fee | PactAgent B2B charge |
| --- | --- | --- |
| CKB | The app may independently set 0% / 0% to incentivize CKB | Can be configured as **0% for CKB** per eligible app or by global policy; final schedule to be approved |
| USDC | The app may set separate client/worker rates | Independently configured PactAgent fee for USDC |
| BTC (future) | The app may set separate rates when BTC rail exists | Independently configured fee only after BTC billing is designed/activated |

Use stable network/asset/deployment identifiers, not ticker alone, to select rates. Separate application-owned client/worker fee settings (when the applicable fee module ships) from **PactAgent-administered B2B rates**. Integrating apps control their own client/worker pricing; the PactAgent staff console controls PactAgent's own B2B contract/rates, not the app's team.

Each PactAgent B2B policy is scoped by appId, rail, assetId, applicable network, rate basis points, policy version, effective date, status and approval evidence, with explicit defaults/overrides and no retroactive changes to funded escrows. Freeze the applicable policy at funding reservation. The agreed general charge basis remains **finalized worker-awarded principal W**, not refunded principal, user app fees, capacity, network gas or swap cost; full refund (W=0) means no PactAgent transaction percentage under this model. A 0% policy still records a versioned zero-fee obligation/event.

**PactAgent charges the integrating application only; never directly charges the app's clients/workers.** B2B billing and custody remain separate from participant escrow. Do not force CKB fees to convert into CKB/USDC or assume a cross-asset oracle; CKB zero-rating avoids such conversion for zero-rated settlements but any positive CKB B2B rate needs a separately approved billing denomination, quote/cap and collection model. Zero percentage does not waive CKB chain/network fees or occupied-capacity needs.

## Authorization and rollout

Changing PactAgent's fee schedule is a **sensitive financial action** requiring separate approvals from Super Admin **and** active Finance Manager (or activated Deputy) with distinct human identities, fresh step-up and immutable before/after proposal. Security Manager coauthorizes Deputy activation, not routine rates. A Super Admin with an extra finance role cannot self-approve. Record proposal, initiator, approvers, evidence, execution result and effective policy version in an append-only audit journal. Pending and existing funded escrows retain frozen policies.

M5 implements pricing/billing using M3/M4 staff authorization foundations. The platform may advertise CKB incentives only when the actual approved per-app or default pricing and chain-cost disclosure support the claim. No billing collection, treasury movement, deployment or fee change is authorized by documentation alone.
