# PactAgent internal staff governance — approved product direction

Status: **product-direction decisions recorded 2026-11-09; not implemented or security-certified**. This specification concerns **PactAgent's own workforce only**. Integrating applications manage their own staff and user identities; PactAgent does not provide application-team administration as part of this scope.

## Administration model and interface

One responsive internal Staff Console with permission-derived navigation, task dashboards, approvals and audit logs. Users may have multiple operational roles on one account. Backend RBAC and object-level permission checks are authoritative; hiding menus is not authorization. The Super Admin can administer all ordinary platform functions and suspend any internal staff member, but cannot unilaterally approve or execute sensitive financial changes. No role combination permits one human/account to satisfy two independent approvals.

| Role | UI sections and allowed work |
| --- | --- |
| Super Admin | Platform overview; integrating-app directory; platform fee proposals; staff/accounts; support; finance visibility; treasury requests; operations; security; audit; general settings |
| Finance Manager | Billing and revenue, per-asset/platform fee proposals, treasury/withdrawal requests, finance approvals, reports, finance audit records |
| Deputy Finance Manager | Standby dashboard, readiness/handover and account security; finance approval actions **disabled** until formally activated |
| Security Manager | Access reviews, security incidents, staff-suspension investigation, deputy activation approval, security logs |
| Operations Manager | Chain/provider health, reconciliations, queues/jobs, incident response and transaction investigation; never authorize settlement by role |
| Support Manager | Integrating-application support queue, assignments, escalations, knowledge base, team reporting |
| Support Agent | Assigned tickets, permitted app diagnostics, customer responses, escalation, knowledge base; no finance or escrow-control privileges |
| Compliance & Risk Officer | Risk cases, evidence, regulatory-policy review, suspicious-event review, compliance reporting; no unrestricted financial execution |
| Technical Administrator | API/webhook infrastructure, service status, technical configuration within granted scopes and incident diagnostics; no escrow withdrawal power |
| Auditor | Scoped read-only audit trails, financial/security event history and report exports; no mutation/approval powers |

Responsive layout: collapsible desktop sidebar, task-centered mobile navigation, permission-driven modules, searchable tables and detail drawers, approval queue, personal notifications/session security. Multiple roles combine permitted navigation without duplicated menus; independence constraints still apply. Platform-specific data access must be minimized and logged.

## Financial separation of duties — binding policy

- Sensitive actions include PactAgent platform fee/rate or discount changes, treasury/collection destination changes, withdrawals/refunds from PactAgent-owned billing funds, financial approval-rule changes and finance authority grants/revocations.
- Require **Super Admin AND currently active Finance Manager** approvals from two distinct authenticated people for ordinary sensitive finance actions, plus fresh step-up authentication and immutable proposal details. The Super Admin may initiate, but cannot self-complete regardless of also holding a finance role.
- Fee policy changes activate for **future funding commitments only**; they cannot revise existing funded terms or historical invoices.
- Treasury changes require verified control of the new destination and separate on-chain multisig/signature authority where applicable. Admin approval alone cannot mutate contract-enforced escrow recipients, seize escrow funds or override participant/arbitration consent.
- Financial authority changes (including replacing a Finance Manager or modifying approval rules) cannot be converted into a bypass by temporarily granting oneself another role. Independent approval and privilege escalation protections must cover granting, removal, recovery and step-up resets.
- Super Admin can **immediately suspend any staff account**, including Finance Manager and Security Manager, on suspected compromise: revoke sessions/tokens, freeze pending affected approvals and audit the incident. Emergency suspension may stop new risky **platform-owned** financial administration, but must not block existing valid participant escrow settlement/refund/recovery or redirect funds. Resuming financial operations requires reviewed controls.

## Active–standby finance delegation

There is exactly **one active finance approval seat**: either the primary Finance Manager or an activated Deputy Finance Manager, never both. The Deputy is enrolled, preverified and normally *standby with no financial approval authority*. Activation for ordinary unavailability, planned leave, compromise or handover requires **both Super Admin and Security Manager** approvals from distinct people. Suspension of the primary alone does not activate the Deputy.

Activation and restoration are versioned atomic transitions with independent step-up, signed proposal details, expiry, audit events, revocation of previous authority and revalidation of pending finance proposals. Prior approval does not count after a role/signer change; stale approval tokens and simultaneous primary/deputy activation must fail closed. A compromised finance account is suspended immediately; only after independent activation may the Deputy approve, together with the Super Admin.

Handover gives the replacement their own account and verified credentials, never shared passwords, secret keys, access tokens or inherited sessions. A separate, later disaster-recovery policy is needed if Super Admin and Security Manager are simultaneously unavailable/compromised; **no unilateral emergency financial bypass is approved**.

## Implementation staging and evidence gates

Use future **M3 internal identity/staff RBAC** and **M4 privileged treasury/approval controls**. M5 adds finance pricing/billing workflows that invoke these checks. Existing M3 roadmap language about application staff/team membership is superseded by this product decision for the *internal staff console*; do not silently turn it into an app-team-management product. Record migration of existing infrastructure admins, invitations, identity binding, least-privilege auditing, distinct-human proof and backup recovery. No code or admin access change is authorized by this document. Independent security, legal/finance and deployment reviews remain open.
