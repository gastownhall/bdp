# BDP specification — `specs/`

The canonical specification is **[`src/`](src/)** — the authoring sources — and
**[`generated/`](generated/)**, the references generated from them. See the
[repository README](../README.md) for the full orientation and build steps.

## Canonical

- **[`src/core/core.lumen`](src/core/core.lumen)** — the normative Core source. This is the authoring form; read the generated reference, not the `.lumen` directly.
- **[`src/bdp.md`](src/bdp.md)** — the authored protocol narrative: the model, the semantics, and the rules that span operations.
- **[`src/packs/`](src/packs/)** — the standard packs: `stdlib`, `issue`, `memory`, `ops`.
- **[`src/CHANGELOG.md`](src/CHANGELOG.md)** — the Core spec delta log.
- **[`generated/core.md`](generated/core.md)** — the generated Core reference; the JSON Schema bundle and the OpenAPI catalog sit beside it under [`generated/`](generated/). Generated from `src/`; never hand-edited.
- **[`formats/`](formats/)** — the Markdown ↔ JSON Schema / OpenAPI conventions the generated documents follow.

Core works without the packs; a pack adds its stated responsibilities without changing Core identity or read meanings.

## Superseded — not the source of truth

**[`profiles/`](profiles/)** and **[`types/`](types/)** are an earlier per-profile
structure, now consolidated into `src/`. They are retained only until they are removed
from `specs/`, carry no authority, and must not be read as current. Prefer `src/`.
