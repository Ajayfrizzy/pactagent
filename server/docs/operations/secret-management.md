# Secret management and rotation

Production services should receive secret files from a managed secrets store through workload identity. Do not put raw production keys in `.env`, Compose variables, CI variables, container images, or source control.

## Secret files

JWT keyring file:

```json
{"jwt-2026-07":"at-least-32-random-characters","jwt-2026-06":"previous-key"}
```

Webhook encryption keyring file:

```json
{"webhook-2026-07":"at-least-32-random-characters","webhook-2026-06":"previous-key"}
```

Configure `AUTH_JWT_ACTIVE_KID` and `WEBHOOK_ACTIVE_KEY_ID` with keys present in those files. The files may be mounted by Kubernetes Secrets Store CSI, ECS secrets injection, a Vault agent, or the platform's equivalent. Grant the API access to JWT and webhook keys; grant the worker webhook and treasury access; do not grant these to the web or migration service.

## JWT rotation

1. Add the new key to the secret-store keyring while retaining the old key.
2. Deploy all API replicas with both keys available.
3. Change `AUTH_JWT_ACTIVE_KID` to the new key ID and redeploy.
4. Wait at least `AUTH_TOKEN_TTL_SECS` after the final old-key token was issued.
5. Remove the old key and record the rotation in the security log.

Tokens include `kid`; unknown key IDs are rejected. Tokens without `kid` continue to use `AUTH_JWT_SECRET` only during legacy migration.

## Webhook encryption rotation

1. Add the new key while retaining every key referenced by `WebhookEndpoint.encryptionKeyVersion`.
2. Set `WEBHOOK_ACTIVE_KEY_ID` to the new ID and deploy API and worker replicas.
3. Run `npm run rotate:webhook-encryption` once as a controlled job.
4. Query the database and verify no endpoint references the old key ID.
5. Remove the old key only after verification and a backup checkpoint.

The rotation job decrypts and re-encrypts stored secrets; it does not replace the integrator-facing webhook secret.

## Treasury signer

Development may use `TREASURY_SIGNER_PROVIDER=local` with `TREASURY_CKB_PRIVATE_KEY_FILE`. Production mainnet and enabled on-chain escrow reject this provider.

Production should set:

```env
TREASURY_SIGNER_PROVIDER=managed
TREASURY_SIGNER_URL=https://isolated-signer.internal
TREASURY_SIGNER_TOKEN_FILE=/run/secrets/treasury-signer-token
TREASURY_CKB_ADDRESS=ckb...
```

The managed service must expose `POST /v1/ckb/transfers`, accept `network`, `toAddress`, `amount`, and `feeRate`, and return `{ "txHash": "0x..." }`. It must enforce destination, amount, rate, network, approval, and replay policies before using its KMS/HSM-held key. Restrict the endpoint to the worker/API workload identity and private network.

## Emergency revocation

- Treasury: disable the signer credential and settlement worker, move funds through the recovery signer, reconcile all recent transactions, then issue a new workload credential.
- JWT: add and activate a replacement key, invalidate sessions issued before the incident cutoff, and remove the compromised key after forcing reauthentication.
- Webhook encryption: add a replacement key, re-encrypt records, rotate integrator webhook signing secrets if plaintext exposure is possible, then revoke the compromised key.
- API key: revoke the key record, issue a replacement, and review audit logs by API-key ID.

Never delete a decryption or verification key merely because a new key is active. First prove that no stored ciphertext or unexpired token still depends on it.
