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

Current accepted finding (reviewed 2026-08-22): `GHSA-ggr8-5vv4-36mx` remains in `deepmerge-ts@7.1.5` through the latest Prisma 7.9.1 CLI. Prisma is development/migration tooling, receives repository-authored acyclic configuration, and is not shipped in runtime images. The exception expires on 2026-09-22 and must be removed when Prisma adopts `deepmerge-ts@8` or explicitly renewed after review. Previously accepted Elliptic, Sharp, and PostCSS findings are now below the high-severity gate or absent from the production audit and their expired exceptions were removed. Patched compatible `fast-uri` and `nanoid` versions are enforced through workspace overrides.

`scripts/audit-dependencies.mjs` enforces these exact package/advisory pairs and their expiry dates. It fails for every other high or critical finding and for expired or malformed exceptions.

The server depends directly on `@ckb-ccc/core@1.12.5` instead of the broad wallet integration bundle. This reduced the production audit from 20 findings to 7 while retaining the exact core version previously resolved by the bundle.

Run `npm run sbom` to create `sbom.cdx.json`. Runtime dependency removal must be verified with `npm ls --omit=dev --depth=0` and both production Docker builds.

Run `npm run licenses:check` from the repository root after `npm ci` to enforce `config/license-policy.json`. Unknown and explicitly denied licenses fail CI. Exceptions must identify an exact package version, document the review reason, and expire. `npm run licenses:test` proves that a forbidden license is rejected.

CI scans full Git history for committed secrets with a commit-pinned Gitleaks action. A detected credential must be revoked and rotated; removing it in a later commit is not sufficient because it remains in Git history.
