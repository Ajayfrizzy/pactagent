# Server modules

Each directory owns one `/v1` business capability. Prefer the established file
roles where they are useful:

```text
<feature>.routes.ts       HTTP route declarations and middleware composition
<feature>.controller.ts   HTTP request/response translation
<feature>.validation.ts   Input schemas
<feature>.service.ts      Business rules and use cases
<feature>.repository.ts   Persistence operations
<feature>.model.ts        Module-owned types and mapping
<feature>.events.ts       Domain event construction
*.test.ts                 Colocated unit tests
```

Not every module needs every layer. Avoid placeholder files. Cross-cutting
runtime concerns belong under `../common/`, while business logic remains owned by
its module.

Module dependencies should go through services or explicit public functions.
Do not import another module's repository from a route or controller.
