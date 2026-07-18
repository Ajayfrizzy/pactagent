# Supply-Chain Security Policy

CI generates a CycloneDX SBOM and scans every runtime image. Builds fail for known high or critical runtime vulnerabilities. Dependabot opens weekly npm, Cargo, Docker, and GitHub Actions updates. Lockfiles are mandatory, CI actions use immutable commits, and runtime base images use registry digests.

## Remediation targets

| Severity | Production exposure | Remediation target |
| --- | --- | --- |
| Critical | Exploitable or internet-facing | 24 hours; disable affected feature immediately |
| High | Runtime dependency | 7 days |
| Moderate | Runtime dependency | 30 days |
| Low | Runtime dependency | 90 days or next planned release |

Risk acceptance requires an owner, affected versions, compensating controls, expiry date, and issue link. Development-only findings do not block releases unless they affect generated artifacts or CI credentials.

## CKB cryptography dependency

Track advisories affecting `@ckb-ccc/ccc` and its cryptographic dependency tree separately from routine updates. Do not auto-merge CKB major or cryptography updates. Before upgrade, run address derivation, signature verification, transaction construction, fee completion, testnet funding, release, refund, and managed-signer compatibility tests. Record testnet transaction hashes in the release issue.

Current accepted findings (2026-07-17): `GHSA-848j-6mx2-7j84` remains transitive through `@ckb-ccc/core`/JoyID/`elliptic`; the suggested automated fix is an incompatible downgrade and must wait for upstream plus the compatibility suite. `GHSA-92pp-h63x-v22m` is in Prisma development tooling and is not shipped in the runtime image. Reassess both weekly and close within the moderate-severity 30-day target or renew the documented risk acceptance.

The server depends directly on `@ckb-ccc/core@1.12.5` instead of the broad wallet integration bundle. This reduced the production audit from 20 findings to 7 while retaining the exact core version previously resolved by the bundle.

Run `npm run sbom` to create `sbom.cdx.json`. Runtime dependency removal must be verified with `npm ls --omit=dev --depth=0` and both production Docker builds.
