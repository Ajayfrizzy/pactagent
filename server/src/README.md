# Server source layout

- `modules/`: app-scoped `/v1` HTTP modules and their repositories, services, and validation.
- `common/`: HTTP, observability, resilience, queue, and security primitives shared by modules.
- `middleware/`: authentication, request identity, rate limiting, and error boundaries.
- `services/`: process-level services used across modules, including durable jobs and retention.
- `worker/`: durable webhook delivery and maintenance workers.
- `config.ts`, `db.ts`, and `index.ts`: process configuration and startup.

New external functionality belongs under `modules/` and must preserve the app tenant boundary.
