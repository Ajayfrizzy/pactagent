# Dependabot across workspace and standalone installations

Reviewed 2026-10-30 from `origin/staging` at `6ce479f3b9e78861cfeab049db7285d35111f1a4`, which includes merged PR #107. This configuration/validation change does not merge a PR, alter runtime dependencies or M0 decisions, start M1, deploy, or modify production `main`.

## Root cause and strategy

The [earlier audit](dependency-pr-review.md) found three independent installation contracts: root workspace `package-lock.json`, `server/package-lock.json`, and `web/package-lock.json`. Shared workspace manifests feed both root CI and the respective standalone Docker builds. Scanning three npm directories without grouping every matching dependency across directories produced overlapping major-version PRs: a root update left standalone locks stale; a standalone update left the root lock stale. Existing React/minor-patch grouping did not cover all updates.

Keep all three locks and all three monitored directories. Root-only monitoring is not a substitute for updating standalone locks. The [configuration](../../.github/dependabot.yml) uses one npm entry with `directories: [/, /server, /web]` and the documented `groups.*.group-by: dependency-name`. It requests one version-update PR per dependency across those directories, including major updates except the explicit deferrals. Compatible updates to the same dependency can therefore update its shared manifests and all affected lockfiles together. Docker monitoring similarly groups each image across root/server/web; Cargo and GitHub Actions monitoring remain enabled. Every ecosystem's version-update target is `staging`.

This reduces duplicates; it cannot promise that every updater run yields a complete, compatible change. GitHub documents that incompatible version constraints can still produce separate PRs, and cross-directory grouping applies to version updates only. Peer-coupled updates (for example React and React DOM) may require maintainer consolidation when individual PRs cannot satisfy peer constraints. Never bypass that failure. Root overrides and standalone overrides can also legitimately produce different transitive graphs; review and audit all three rather than assuming identical dependency trees.

## Read-only installation validation

The existing CI now has three `Dependency lockfiles (root/server/web)` jobs, on ordinary PRs and staging/main pushes, with the same coverage as the rest of CI. [The checker](../../scripts/check-dependency-lockfiles.mjs) does the following:

1. Checks each shared manifest against both applicable lockfile snapshots, including dependency, dev, optional and peer sections.
2. Requires the same resolved version and integrity for each direct dependency between workspace and standalone locks. This catches lockfile-only drift even when both versions satisfy the same manifest range. Workspace-local resolution takes precedence over hoisted root resolution.
3. Copies only the applicable manifests/lockfile into a fresh temporary installation, outside the repository workspace. The root copy includes workspace manifests but not standalone locks. A server/web copy has no parent workspace manifest.
4. Runs a real `npm ci --ignore-scripts --no-audit --no-fund`, then the existing vulnerability policy independently against that installed graph. Failed installation, audit service errors and vulnerability-policy failures remain failures.
5. Deletes the temporary directory. It never edits tracked files, commits, pushes, merges, or uploads generated executable artifacts.

Run locally with the version in `.nvmrc`:

```sh
node --test scripts/check-dependency-lockfiles.test.mjs
node scripts/check-dependency-lockfiles.mjs
node scripts/check-dependency-lockfiles.mjs root
node scripts/check-dependency-lockfiles.mjs server
node scripts/check-dependency-lockfiles.mjs web
```

Each CI job grants only `contents: read`, disables checkout credential persistence, passes no secrets or write token, and uses pinned existing checkout/setup-node actions. Installation scripts are disabled in this additional validator, not in application-build tests: the existing builds, tests, container scans and secret checks still run. PR code is treated as untrusted and never executed by a write-privileged repair workflow. There is no `pull_request_target`, privileged `workflow_run`, writeback bot or auto-merge. Dependency artifacts may be downloaded; no claim is made that dependencies themselves are trusted. This design also works with Dependabot's restricted token and secret access.

The checker validates direct resolution parity, not equality of all transitive graphs. The isolated audits and unchanged image scans are needed for transitive security fixes. If a security update changes only a transitive root resolution, inspect and remediate every affected standalone graph; a root-only patch must not be considered proof that production images are fixed.

## Handling a failed grouped update

Grouping is the first line of coordination; CI is the enforcement mechanism. If an updater still omits a lockfile, a maintainer creates a repair/replacement branch from latest staging or updates the existing branch without rewriting history. Use the project's Node/npm toolchain, review the desired exact versions, and regenerate all affected locks together. For example:

```sh
npm install --package-lock-only --ignore-scripts
(cd server && npm install --package-lock-only --ignore-scripts --workspaces=false)
(cd web && npm install --package-lock-only --ignore-scripts --workspaces=false)
```

These commands repair manifest incompatibilities but are **not** a promise of identical resolutions or complete security remediation: an existing compatible lock can retain an older version, and a regenerated lock can select a newer allowed version. For a reviewed direct upgrade, explicitly install the same chosen version into each affected workspace/standalone layout using `npm install <name>@<reviewed-version> --package-lock-only --ignore-scripts` (with the appropriate workspace or `--workspaces=false` scope and dependency type). For transitive fixes, review the actual resolution/override and update every affected graph. Inspect the diff, preserve security overrides, run the checker and the full CI suite. Do not hand-copy whole lockfiles between layouts, use `--legacy-peer-deps` to hide incompatibilities, or authorize unsigned automatic writeback.

## Deferrals and security updates

Only `version-update:semver-major` is ignored for `typescript` and `tailwindcss` in the staging-targeted npm version-update entry. This defers TypeScript 7/Tailwind 4 (and other incompatible major transitions until explicitly reviewed), while continuing minor/patch maintenance. No advisory, alert or security-update setting is disabled. Migration exit criteria remain in the [dependency review](dependency-pr-review.md#deferral-exit-criteria-and-future-maintenance).

GitHub documents that with `target-branch` set to a non-default branch, that entry's options no longer govern security updates: **security PRs still use the default branch, currently `main`**. Do not infer that this configuration routes or groups security fixes on staging. An urgent fix requiring a deferred major version must be evaluated promptly; perform the necessary reviewed migration or another valid remediation, rather than leaving a vulnerability open because of a version-update deferral.

For a default-branch security PR, maintainers must inspect the advisory and diff, then retarget to staging if safe or prepare a replacement from current staging. Bring all affected locks along, retain a link to the original advisory/PR, and run full CI. Do not directly merge a dependency branch into main. Only a reviewed staging-to-main release PR plus explicit release approval may promote it. The alert can remain open while production's default-branch dependency is vulnerable; a staging fix alone does not establish production remediation. Do not dismiss the alert to simulate completion. Verify the production dependency graph and alert resolution after the separately authorized release.

## Activation and administrator tasks

GitHub requires `.github/dependabot.yml` on the **default branch**. Merging this PR into staging alone does not activate the new Dependabot schedule/targeting policy. Activation requires a separately reviewed and explicitly authorized promotion of the configuration to main through the production release process. This task does not do that, change the default branch, or claim the new bot behavior is already live. Until activation, the old default-branch configuration may continue creating duplicate/main-targeted version updates.

Require the three new lockfile jobs alongside the existing full security/build/migration checks in staging branch protection. No branch rules were changed here. Current main's workflow/protection is not rewritten by a staging PR; administrators must enforce staging-first release review, especially for default-branch security PRs. Observe the first scheduled/check-now Dependabot run after authorized activation: confirm targets, grouping and changes to every affected lockfile. A schema-valid configuration is not an executed hosted updater test.

## PR cleanup snapshot

Read-only GitHub inspection on 2026-10-30 found eight open Dependabot PRs, all currently targeting staging. Original branches were not closed, merged or rewritten in this task.

| PRs | Current check summary | Disposition |
| --- | --- | --- |
| #97, #100, #102 | Failing container install or workspace npm-ci checks from their old heads | Superseded by merged #107; recommend closing these duplicates after confirming its changes remain in staging. |
| #94, #99, #101 | Failing TypeScript/configuration/declaration and installation checks | Close package-only proposals as deferred; track a dedicated TypeScript/Prisma/browser-target migration. |
| #96 | Failing Tailwind/PostCSS and lockfile checks | Close package-only proposal as deferred; track a dedicated Tailwind 4 migration with visual/browser acceptance. |
| #103 | Head changed to `6e9d807b6dafaa5e5df24ad54991cbc524caad4a`; only one successful preview-related check visible, no full successful CI suite | Not validated or merge-ready. Same separate Tailwind migration requirement; recommend closing the package-only proposal rather than treating absent failures as green CI. |

#95 and #98 were not in the current open-PR set. #107 is merged at the baseline SHA above. No cleanup closure is performed here; these are explicit recommendations, not hidden repository mutations.

## Verification and sources

On 2026-10-30, configuration parsed and validated successfully against the published [SchemaStore Dependabot draft-07 schema](https://json.schemastore.org/dependabot-2.0.json), including `group-by`, `directories`, `target-branch` and version-update ignore types. Retrieved schema SHA-256: `f310bfb4960eea6a5fb7d75de54ab49ba36f947757c8f4d5de88d3ea8ac51d3f`. SchemaStore is a schema reference, not a live GitHub acceptance test; behavior was separately checked against GitHub's [options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#groups), [target-branch behavior](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference#target-branch), and [configuration-file requirements](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file).

Local validation under Node 26.12.1 passed: seven new regression tests; metadata/direct-resolution checks; isolated root/server/web clean installs and security audits; full clean root and standalone installs with lifecycle scripts enabled; Prisma generation/validation; server/web TypeScript and lint; 97 application tests; root/standalone builds; 58 OpenAPI operations; control, deployment, observability and Phase 7 checks; four license-policy tests and license scan; five audit-policy tests and dependency audit. New tests cover stale manifests, same-range resolution drift, integrity drift, workspace-local resolution and installation isolation. No dependency versions, lockfiles, runtime code, contracts, schemas or M0 decisions changed.

Local Docker is unavailable; database integration/migration fixtures and Linux image scans are validated by the unchanged existing PR CI. Remote check results are reported in the PR/handoff, not presumed here. Actual hosted Dependabot behavior remains an activation follow-up as described above.
