# Identity, app roles and treasury authority

Proposed M0 design. [M0-REPORT](M0-REPORT.md) records current wallet login and API-key scopes. See [escrow-security](escrow-security.md) for funds authority and [decisions](M0-DECISIONS.md) for unresolved defaults.

## Identity domains

A developer console account has a stable person/account ID and verified login methods. CCC wallet login may remain; add domain, audience, nonce, expiry and network to challenge messages, and verify that the claimed account is cryptographically derived from the signer for every supported connector. Do not reuse case normalization rules across address types. Recovering console access restores app administration, not an escrow participant's signing keys.

Integrating apps own customer registration/login and opaque external IDs. Proposed `ParticipantBinding(appId, externalId, chainId, authority, recipient, version, verifiedAt, proofHash)` requires a wallet-signed binding challenge scoped to app, role and expiry. Before funding, both parties sign the full escrow terms including the binding version. API keys may submit proofs, not manufacture consent. Changing an app's external-user mapping affects future agreements only. No globally searchable cross-app user directory. If an app compromises its own customer login it still cannot create a valid wallet authorization, though phishing and coerced signatures remain risks.

CKB payment readiness requires supported lock script, transaction signing, dependency resolution, witness generation and capacity access tested for that wallet. CCC connector listing or message signing is not sufficient. Base EOAs and ERC-1271 wallets use separate integration and chain selection. No seed/private key collection. Existing testnet server signer is not the production participant custody model.

## Additive app-scoped RBAC

`Membership(accountId,appId,status)` has many role grants; permissions union across roles. Explicit separation-of-duties constraints override that union. Operator administrators are a separate audited platform role, not implicit tenant members. Proposed defaults:

| Permission | Owner | Admin | Developer | Finance | Support | Arbitrator | Viewer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Read non-sensitive app configuration | yes | yes | yes | yes | yes | yes | yes |
| Invite/revoke staff and grant allowed roles | yes | yes* | no | no | no | no | no |
| Transfer ownership/high-risk policy approval | yes* | no | no | yes* | no | no | no |
| Manage scoped API keys/webhooks | yes | yes | yes | no | no | no | no |
| Propose treasury/rates and manage billing | yes | no | no | yes | no | no | no |
| Read assigned evidence and assist | no* | no* | no | no | yes | yes* | no |
| Propose/approve arbitral verdict | no | no | no | no | no | yes* | no |
| Override signatures or withdraw escrow principal | no | no | no | no | no | no | no |

`*` Admin cannot grant Owner or Arbitrator or elevate beyond delegated grant scope; Owner assignment of arbitrators applies only to future frozen policy. Owners/Admins need explicit case-access role and assignment, not automatic sensitive-evidence access. Arbitrators need assignment to the case and pinned escrow policy. Ownership transfer, treasury activation and high-risk policy changes require fresh authentication and distinct-person approvals. Owner is not automatically a contract signer. Custom roles are deferred until permission/version governance exists.

Invite flow: owner/delegated admin selects app+roles → single-use hashed token bound to intended verified account/email, expiry and inviter → recipient authenticates and accepts → atomic membership/grants and audit. Email alone is not signing authority. Revocation invalidates sessions/role caches and pending organization approvals; contracts still honor already-frozen arbiter policy until a precommitted recovery mechanism applies. Never silently claim console revocation changes chain signers.

Recommend step-up within five minutes using phishing-resistant MFA or a fresh purpose-specific wallet challenge. Default high-risk approval is two distinct verified people, with proposer excluded from approval quorum when policy requires it. A small app unable to meet the threshold cannot activate production treasury changes; testnet-only exceptions are visibly scoped, not implicit production bypasses. N-of-M counts unique person IDs, not roles, accounts or keys. Person uniqueness needs enrollment attestation/manual checks and audit; a blockchain can prove distinct keys, not distinct humans. This residual Sybil risk must be documented.

## Treasury verification and immutable versions

`TreasuryVersion(appId,networkId,assetScope,destination,version,status,proofHash,approvalPolicyVersion,activatedAt)` is append-only. Proposal → ownership/control proof → distinct-person approval → activation; deactivation stops new commitments. Freeze destination and version on each escrow before funding. Changing it cannot retarget existing escrow funds or previously signed fee terms.

Base EOA: EIP-712 purpose-specific control challenge. Base smart wallet: verify ERC-1271 at recorded block, supported network/code, owner/threshold/module configuration and expected recovery semantics. Safe threshold must be enforced on-chain; organization approval tickets alone cannot replace it. Configuration changes require re-verification before future commitments. Smart-wallet destination may keep its address while owners change, so disclose that treasury control is mutable; do not confuse it with immutable arbitration authority.

CKB: verify full lock script/code hash/args and network, supported message or transaction challenge, and recognized multisig threshold script. Store lock bytes and proof, not merely a display address. Unsupported verification locks remain unavailable. A treasury using an unfamiliar contract is not accepted based on a successful string signature.

Strong auth and two-person activation protect future configuration; escrow contract commitments protect current balances. Log proposal, proof hash, previous/new version, approver person IDs, role versions, auth method/time, network and activation. Log no secrets. Invitations, membership grants, key rotations, evidence access and failed high-risk actions are tenant-scoped audit events. Account recovery, staff departure and compromised arbiter keys require explicit runbooks before mainnet.
