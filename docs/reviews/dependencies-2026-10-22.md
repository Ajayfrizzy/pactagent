# Dependency review — 2026-10-22

This update integrates the seven open Dependabot pull requests: #62, #66,
#67, #68, #74, #78, and #79. Their changes are consolidated in PR #80; main requires a linear history, so
the consolidated PR is squash-merged and the superseded PRs are closed.

## Compatibility and security fixes

- Align development, CI, deployment tooling, and Docker on Node 26.11.1.
  Node 26 does not bundle Corepack; remove obsolete Corepack cleanup commands.
  Apply Debian perl-base security fixes in a shared base stage; the pinned
  Node image predates those high/critical CVE fixes.
- Update Zod record schemas for the Zod 4 key/value API, with regression
  coverage for metadata defaults, nested JSON, invalid arrays, and byte limits.
- Regenerate the root workspace and standalone Docker lockfiles. Configure
  Dependabot to group npm updates across all three manifests/lockfiles.
- Advance Next.js beyond the original PR's 16.3.5 to patched 16.4.2.
- Scope legacy YAML overrides below version 5 so Swagger Parser can use its
  required YAML 5 API. Review the updated libvips 1.3.4 license entries and
  argparse's PSF-2.0 license identifier (Python Software Foundation License 2).
- Upgrade CycloneDX npm to version 6 and refresh vulnerable transitive packages,
  including fast-uri, brace-expansion, js-yaml, sharp, and PostCSS dependencies.
- Apply the deepmerge-ts fix in the root workspace and remove the expired
  security exception. Audit tests use isolated policy fixtures, including
  explicit rejection of expired exceptions and unavailable audit endpoints.

## Remaining upstream advisories

The server audit (including development dependencies) and web production audit
have no high, critical, or moderate findings. Low-severity findings remain in the
wallet SDK chain through elliptic (GHSA-848j-6mx2-7j84), which has no patched
release. npm's suggested SDK downgrade is not a compatible remediation.

The web development toolchain still uses Tailwind 3, which depends on braces
3.0.3 through chokidar/micromatch. GHSA findings for braces propagate through
that chain. No patched braces release or Tailwind 3 release is available at the
review date. These are build-time dependencies, excluded from production audit;
resolving them requires a separate Tailwind 4 migration and visual regression
review. No security checks or severity thresholds were weakened.

## Local validation

- 97 server tests and 11 Rust contract tests passed.
- Server and web TypeScript checks and production builds passed on Node 26.11.1.
- All 58 OpenAPI operations matched the Express route table.
- Infrastructure controls, deployment smoke tests, observability checks,
  operations evidence, environment coverage, and audit-policy tests passed.
- Installed dependency license checks passed.

Database/migration and container build/scanning checks run in GitHub CI before
merge. Docker was not running on the local workstation.
