# Contributing to PactAgent

This repository is an npm workspace containing an API and worker, a Next.js web
application, shared TypeScript contracts, and a Rust smart contract. Keep changes
close to the feature that owns them and avoid adding new catch-all directories.

## Repository map

| Path | Ownership |
| --- | --- |
| `server/` | Express API, background worker, persistence, and server maintenance commands |
| `web/` | Next.js routes, user interface, browser state, and wallet integration |
| `shared/` | Runtime-free domain values and TypeScript contracts used by more than one workspace |
| `contracts/` | CKB smart contract source and contract-specific tooling |
| `docs/` | Architecture decisions and repository-wide operating documentation |
| `server/docs/` | API artifacts and server runbooks whose paths are consumed at runtime or by controls |
| `deploy/` | Deployment manifests |
| `observability/` | Alerts, dashboards, and telemetry collector configuration |
| `scripts/` | Commands that operate across workspaces or deployment infrastructure |
| `config/` | Machine-readable policy and control definitions |
| `test/` | Cross-workspace and load tests |

Generated directories such as `dist/`, `.next/`, `node_modules/`,
`contracts/build/`, and `contracts/target/` are not source code and must remain
untracked.

## Where code belongs

### Server

Add new business behavior under `server/src/modules/<feature>/`. A module may
contain routes, controllers, validation, services, repositories, events, models,
and colocated tests. Use `server/src/common/` only for infrastructure that is
shared by multiple modules and has no product ownership.

The `server/src/routes/` and `server/src/services/` directories implement the
legacy `/api` product surface. Do not add new `/v1` behavior there. Migrate a
legacy feature only as a separate, tested change because that surface is still
optionally mounted by `server/src/app.ts`.

Keep dependencies flowing in this direction:

```text
routes -> controllers -> services -> repositories
                         |
                         +-> common infrastructure
```

A repository must not import a controller or route. Modules should call another
module's public service rather than importing its repository.

### Web

Keep `web/src/app/` route files focused on routing and page composition. Put
product-specific components and browser logic in `web/src/features/<feature>/`.
Use `web/src/components/` only for components that are reusable across unrelated
features, and `web/src/lib/` for API clients or external-system adapters.

### Shared

Use `shared/src/domain/` for enums and state-machine rules. Use
`shared/src/contracts/` for data exchanged between workspaces. Do not place
database access, React code, environment reads, or server-only models in the
shared package.

## Naming and tests

- Use kebab-case for scripts and infrastructure files.
- Follow the existing `<feature>.<layer>.ts` naming convention in server modules.
- Colocate unit tests with the code they exercise using `*.test.ts`.
- Put tests that cross module boundaries in an explicit integration test file.
- Add an ADR under `docs/adr/` for changes to security, data ownership, service
  boundaries, or operational guarantees.

Before opening a change, run:

```bash
npm run lint
npm test
npm run build
```

Database-backed integration tests require the local test infrastructure and run
separately with `npm run test:integration`.
