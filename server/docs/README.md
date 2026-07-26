# Server documentation

This directory contains documents coupled to the API and worker:

- `openapi/`: the specification loaded by the server and validation scripts
- `examples/`: integration examples
- `operations/`: API and worker runbooks referenced by infrastructure controls
- `api-lifecycle.md`: compatibility and lifecycle policy
- `INTEGRATOR_CHANGELOG.md`: integrator-facing changes

Repository-wide architecture decisions and operational ownership documentation
belong under the root `docs/` directory. Several paths here are runtime or
compliance inputs; move them only together with their code and control references.
