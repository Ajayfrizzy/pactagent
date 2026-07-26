# Server source map

- `modules/`: the app-scoped `/v1` API, organized by business feature
- `common/`: shared server infrastructure used by multiple modules
- `worker/`: worker process entry point and agent loop
- `workers/`: individual background job handlers retained by the current worker
- `scripts/`: API and database maintenance commands
- `routes/` and `services/`: the optional legacy `/api` product surface
- `app.ts`: middleware and route composition
- `index.ts`: API process startup and shutdown
- `db.ts`, `config.ts`, and `ws.ts`: process-level adapters

New infrastructure API behavior belongs in a feature under `modules/`. The
legacy directories remain separate so the `/api` compatibility surface can be
removed or migrated deliberately rather than becoming mixed with `/v1` code.
