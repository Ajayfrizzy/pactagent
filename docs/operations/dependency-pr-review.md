# Dependency PR review: #94–#103

Reviewed 2026-10-29 against freshly fetched `origin/staging` at `107163d0a65bb87ac95fb68935f7217f73407113`. Production `origin/main` remains `a526b78a1fb2f7282be366c0bd0bf29f4af702b2`. Follow the [staging workflow](staging-workflow.md); this review authorizes neither merging nor deployment, and does not begin M1 or amend [M0 decisions](../architecture/M0-DECISIONS.md).

Recommendation: replace five overlapping Node-types/Lucide PRs with one atomic change on `fix/dependency-node-types-lucide`, based directly on the above staging SHA. Defer TypeScript 7 and Tailwind 4 to deliberate migration PRs. No original PR is ready to merge as submitted. Keep original history intact and annotate supersession/deferral rather than force-pushing bot branches.

## Cause and dependency relationships

There are three installation contracts: root [workspace lockfile](../../package-lock.json) for CI, [server lockfile](../../server/package-lock.json) and [web lockfile](../../web/package-lock.json) for standalone Docker builds. The Dockerfiles copy package manifests with the respective standalone lockfile; root CI resolves both workspaces through the root lockfile, even when invoked from a workspace directory. Dependabot scans `/`, `/server` and `/web`, so its separate PRs change the same shared manifests but only one lockfile. Combining neither arbitrary retries nor a single lockfile update repairs both paths.

Inspected the full diffs, current head checks and all relevant failed job logs for each PR. Installation failures are deterministic `npm ci` manifest/lock mismatches, not evidence of unavailable infrastructure or registry outages. Error messages sometimes name newer matching versions (Node types 26.6.6 or Lucide 1.64.0), because npm resolves an unsatisfied caret range while diagnosing the stale lock; those versions are not what the PR titles say they locked. Expected negative-test database errors in #94's server log are not its failure: TypeScript declaration compilation fails later.

| Family | Overlapping original PRs | Decision and dependency rationale |
| --- | --- | --- |
| TypeScript 7.0.2 | #94 workspace, #99 server, #101 web | Defer. Genuine compiler/configuration and Prisma declaration incompatibilities, in addition to lockfiles. No security need for this major upgrade was established by these PRs. Keep working 5.9.3 locked. |
| `@types/node` 26.6.5 | #97 workspace, #98 server, #102 web | Proceed with synchronized manifests and all three lockfiles. Align compile-time Node APIs with the existing Node 26 runtime. `undici-types` must move from 6.21.0 to 8.9.0 with it. No runtime Node change is needed. |
| Tailwind CSS 4.3.3 | #96 workspace, #103 web | Defer. Requires PostCSS, CSS entry/configuration and visual/browser migration, not only a dependency bump. Keep working 3.4.19 locked; no security necessity for this major upgrade established here. |
| Lucide React 1.61.0 | #95 workspace, #100 web | Proceed as bounded maintenance, not an urgent security fix. Synchronize root/web locks and verify the actual icon imports and rendering. Independent of TypeScript 7/Tailwind 4. |

The replacement upgrades precisely the original target versions: `@types/node` 26.6.5 and `lucide-react` 1.61.0, preserving the original proposed caret ranges in manifests. Both installation layouts resolve the same reviewed versions. The only other version change is the required `undici-types` 8.9.0. npm also recalculates some web lockfile dev/optional flags and records Lucide's optional React-types peer; there are no unrelated package version upgrades. React/Next/Prisma, Node 26.12.1 image pins, fast-uri 3.1.9 overrides and every security check remain intact.

## PR-by-PR disposition and evidence

“Replacement validated” refers to the local validation matrix below, not successful validation of the original PR. Original PRs remain open for traceability; supersession is not a merge or automatic approval. CI on the replacement is separately visible in its PR checks.

| PR | Failure root cause and job evidence | Recommended action | Fix completed / validation | Remaining blocker |
| --- | --- | --- | --- | --- |
| [#94](https://github.com/Ajayfrizzy/pactagent/pull/94) | [Server TS2883](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829223067/job/123299306899): inferred PrismaPg-dependent exports cannot be named portably. [Web TS5108](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829223067/job/123299306821): ES5 target removed. Standalone locks still resolve TS5. | Defer TypeScript family; replace later as one migration. | Diagnosis only; compiler options and repository types deliberately unchanged. | Resolve typed Prisma declaration boundary and web target, then regenerate all locks and validate migration. |
| [#95](https://github.com/Ajayfrizzy/pactagent/pull/95) | [Web Docker npm ci](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829270469/job/123299454867): standalone web lock has Lucide 0.577.0 against new manifest. Workspace compilation passed. | Supersede with replacement. | Root/web locks synchronized at 1.61.0; clean installs, builds and 45 icon renders pass. | Replacement review, including three minor glyph changes. |
| [#96](https://github.com/Ajayfrizzy/pactagent/pull/96) | [Web build](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829235604/job/123299343178): Tailwind is no longer a direct PostCSS plugin; standalone web lock also remains v3. | Defer Tailwind family. | Diagnosis only; no partial CSS migration. | PostCSS v4 integration, theme/directive migration and responsive/visual/browser acceptance. |
| [#97](https://github.com/Ajayfrizzy/pactagent/pull/97) | [Container install](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829228553/job/123299321116): standalone locks still contain Node types 20 / undici-types 6. Workspace code checks passed. | Supersede with replacement. | Both manifests/all three locks synchronized; type checks, tests and both layouts' builds pass. | Replacement review/CI. |
| [#98](https://github.com/Ajayfrizzy/pactagent/pull/98) | [Workspace npm ci](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829256507/job/123299409386): root lock missing matching Node types/undici-types; only server lock changed. | Supersede with same replacement as #97. | Same atomic fix; no duplicate upgrade branch. | Replacement review/CI. |
| [#99](https://github.com/Ajayfrizzy/pactagent/pull/99) | [Server build](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829249848/job/123299388949): TS2883 PrismaPg export errors; root lock also lacks TS7/platform packages. | Defer with #94. | Diagnosis only; no declaration/type-check weakening. | A coherent compiler/Prisma migration, not a lockfile-only fix. |
| [#100](https://github.com/Ajayfrizzy/pactagent/pull/100) | [Workspace npm ci](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829242751/job/123299366292): root lock retains Lucide 0.577.0; only web lock changed. | Supersede with same replacement as #95. | Same synchronized-lock fix and render/build validation. | Replacement review, including glyph differences. |
| [#101](https://github.com/Ajayfrizzy/pactagent/pull/101) | [Web Docker build](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829198996/job/123299225025): TS5108 rejects ES5; workspace lock missing TS7. | Defer with #94. | Diagnosis only; existing browser compilation contract preserved. | Agree supported output/browser target and compatible compiler/toolchain before migration. |
| [#102](https://github.com/Ajayfrizzy/pactagent/pull/102) | [Workspace npm ci](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829215932/job/123299278689): root lock lacks matching Node types/undici-types; only web lock changed. | Supersede with same replacement as #97. | Same synchronized manifests/locks and passing local validation. | Replacement review/CI. |
| [#103](https://github.com/Ajayfrizzy/pactagent/pull/103) | [Web Docker build](https://github.com/Ajayfrizzy/pactagent/actions/runs/40829208843/job/123299256366): old direct Tailwind PostCSS plugin; workspace lock still v3. | Defer with #96. | Diagnosis only; no unsafe package-only migration. | Same Tailwind migration and visual acceptance as #96. |

## Completed compatibility checks

No source compatibility fixes were necessary for the two proceeding families. The fix is coordinated package/lock resolution, not `--legacy-peer-deps`, skipped scripts, weaker type checking, modified scanner thresholds or altered security suppressions.

A targeted comparison parsed all Lucide imports in the web source and rendered 45 distinct exports using ReactDOMServer before and after the upgrade. Every import remains available and renders an SVG with the supplied class and accessible label. Thirteen serialized SVGs differ: ten only in upstream alias classes and three in glyph geometry (`CircleCheck`, `Trophy`, `Zap`). No source selectors depend on those generated Lucide class names. The [before/after comparison](dependency-icon-comparison.svg) shows the three glyph changes; they preserve their meanings and were visually inspected. This is not a claim of exhaustive interactive browser or accessibility testing. Reviewers should accept those cosmetic differences before merge.

Local checks ran with Node 26.12.1 / npm from that distribution. Standalone checks copied only tracked server/web files into isolated temporary directories, with no parent workspace manifest and no developer `.env`, so they exercise the independent lockfiles used by Docker rather than accidentally reusing the root installation.

| Validation | Result |
| --- | --- |
| Root `npm ci` | PASS, clean workspace install |
| Standalone server `npm ci`, `prisma generate`, `npm run lint`, `npm run build` | PASS |
| Standalone web `npm ci`, `npm run lint`, `npm run build` | PASS |
| Root Prisma generation and `prisma validate` | PASS, existing Prisma 7.10.1 and unchanged schema |
| Root `npm run lint` | PASS, server `tsc --noEmit` and web typegen/`tsc --noEmit` |
| Root `npm test` | PASS, 97 tests, zero skipped; `NODE_ENV=test`, local Redis URL unset |
| Root `npm run build` | PASS, server declarations and Next production build |
| `npm run openapi:check --workspace @pact-agent/server` | PASS, 58 operations |
| `npm run licenses:check` | PASS, 826 installed packages |
| `npm run audit:dependencies` | PASS, no high+ vulnerability records relying on active exceptions |
| `npm run controls:check` / `npm run deploy:check` | PASS, 27 controls, 10 manifests and 2 smoke-validator tests; no deployment |
| Actual Lucide export/render comparison | PASS, 45 exports; disclosed cosmetic differences above |
| Changed-path/lockfile/reference/whitespace review | Verified before commit; no source/schema/contract/workflow/M0 decision changes |

Local Docker daemon is unavailable. Database integration/upgrade fixtures and Linux container builds/scans must be evaluated through the existing PR CI, which provisions disposable PostgreSQL and keeps every security check enabled. Local unit/build success is not a VM, production, full UI or database-integration result. Final remote results belong in the PR/handoff; do not infer green CI from this document.

## Deferral exit criteria and future maintenance

TypeScript: design a portable, explicitly typed Prisma client/repository declaration boundary, preserving inferred result precision, tenant scoping and transaction types. Investigate generator/compiler compatibility rather than upgrading Prisma to its advertised prerelease. Choose a supported web target consistent with Next/browser policy. Validate emitted declarations, server/runtime and wallet SDK compilation, tests, migrations, API compatibility and all three locked installation layouts. Do not turn off declarations, strictness or checks merely to suppress TS2883; do not cast results to `any`.

Tailwind: adopt the v4 PostCSS integration and CSS entry/directive model, explicitly load/migrate the current custom colors and utilities, and review changed defaults/Preflight and browser support. Audit the existing `@apply` rules, responsive console navigation, form/error states and wallet flows with visual and interaction checks. Updating the PostCSS package alone is not sufficient acceptance evidence.

For future dependency updates, treat each shared manifest and every lockfile that consumes it as one change. The current multi-directory Dependabot configuration produces overlapping PRs; consider a separately reviewed automation design that updates/checks all lockfiles atomically. No security updater or scan is disabled here. Once the replacement is reviewed, maintainers can close #95/#97/#98/#100/#102 as superseded; #94/#99/#101 and #96/#103 should remain deferred until their respective migration scope is ready. No closure or merge is implied by this recommendation.
