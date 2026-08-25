# PactAgent documentation

Start with the root `README.md` for setup and platform behavior, and
`CONTRIBUTING.md` for source-code placement rules.

## Documentation map

- `architecture/`: service boundaries, settlement, environments, and financial rules
- `adr/`: durable architecture decisions
- `operations/`: repository-wide ownership, performance, and release checklists
- `configuration.md`: environment and application configuration
- `infrastructure-implementation-roadmap.md`: phased infrastructure work
- `../server/docs/`: API lifecycle material, OpenAPI artifacts, integration examples,
  and server runbooks whose current paths are used by runtime or compliance checks

Keep new repository-wide documentation here. Keep generated API specifications or
documents that are loaded by server code under `server/docs/` until their runtime
paths are deliberately migrated and validated.
