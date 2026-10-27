# Permanent staging-first integration workflow

## Branch and release policy

- `main` is production only and remains unchanged during M0 integration.
- `staging` is the permanent integration/pre-production branch, initially created from `origin/main` at `a526b78a1fb2f7282be366c0bd0bf29f4af702b2`.
- Normally branch development work from current `origin/staging`; merge it through a reviewed PR into staging with all required CI checks passing.
- Promote production only through a reviewed `staging` → `main` PR and explicit release approval. Never merge a feature directly into main, force-push or rewrite history.
- A staging merge is not deployment authorization and does not start M1.

## CI and deployment safeguards

CI continues to run for all pull requests, including targets staging/main, and now also runs on pushes to staging as well as main. Existing security, build, migration, contract and container checks remain enabled. The additional Branch policy job rejects PRs into main unless their source is this repository's staging branch.

The proposed deployment workflow is manual-only. Its publish gate permits staging dispatches only from `refs/heads/staging`; production requires `refs/heads/main` and the explicit boolean `approve_production`. Deployment environments remain separate. No workflow dispatch, environment approval, provisioning or deployment is part of this integration task. Credentials and infrastructure validation remain intact.

GitHub loads `workflow_run` subscriptions from the default branch. Main's unchanged workflow still listens for completed CI with head branch main. A staging or M0-head CI run does not match that filter. Consequently creating staging, opening the M0 PR and merging it into staging cannot trigger that existing automatic deployment subscription. The manual-only replacement on staging does **not** change main's workflow until a separately authorized release PR reaches main. Do not claim main's current deployment trigger has already been removed.

## Baseline reconciliation

M0 commit `0b835e6` was based on the separate VPS-conversion commit `cdb7787`, which had not merged into origin/main. Latest origin/main also includes dependency updates absent from M0's original baseline. Preserve original commits: merge origin/main into the M0 branch, then restore the 19 inherited VPS-conversion paths to origin/main in a corrective commit. Only the minimal workflow changes described above remain on those restored files. This avoids promoting an unrelated infrastructure migration with M0 and preserves original M0 ancestry.

The M0 report/decision register describe the audited historical commit and are not edited to pretend that audit ran on the newer baseline. This integration retains main's Kubernetes deployment configuration; VPS migration remains on its own feature branch and requires separate review. M0 architecture decisions remain unchanged. Restored infrastructure files are not deployed or applied.

## Remote configuration inspected

GitHub default branch: main. Existing active ruleset `Protect main branch` applies only to main, blocks deletion/non-fast-forward updates, requires PRs, selected CI checks and linear history. It currently requires zero approving reviews and allows repository-admin bypass. These are observed settings, not used to bypass checks. No staging rule was present when staging was created.

Separate staging and Production environments exist, but neither reports required reviewers or deployment branch restrictions. Neither has environment-scoped secrets configured. Repository/organization secrets and actual infrastructure provisioning have not been established by this inspection; empty environment secrets do not prove that all credential sources are absent. No secret values were read or changed.

Current main deployment expects `KUBECONFIG_B64`, `SMOKE_API_URL`, `SMOKE_WEB_URL`, and staging `SMOKE_API_KEY`; preserve those validation failures until intentionally provisioned. VPS credentials/resources belong to the unmerged VPS workstream and are not invented here.

## Remaining administrator/release tasks

1. Protect staging with PR requirements, required CI including Secret scanning, Workspace and supply-chain policy, Branch policy, Server and migrations, Web, CKB contract and all three Container images checks; prevent force pushes/deletion. Confirm merge-commit policy if retaining exact feature-commit ancestry is required.
2. Strengthen main's existing ruleset to require human review and Branch policy plus the complete security/CI set. Review admin bypass policy rather than relying on it. No existing protections are weakened by this change.
3. Configure required reviewers and branch restrictions on the separate deployment environments: staging only for staging, main only for production. Verify environment naming/case resolution against the existing Production environment. Dispatch confirmation is explicit intent, but not a substitute for independent required reviewers.
4. Provision/verify intended infrastructure and secrets under a separately authorized operations task. Do not dispatch this workflow merely to test branch integration.
5. Reconcile deployment strategy in a separate review before a production release. Main remains unchanged here, including its current automatic subscription; a future approved staging-to-main PR must carry the manual-only safeguard and receive explicit release approval.

No repository ruleset, environment protection, secret, database or infrastructure mutation is performed as part of these workflow-file changes.
