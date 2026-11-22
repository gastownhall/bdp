# Beads Protocol

BDP is an HTTP and JSON protocol for reading and changing Beads and Links across independently implemented stores.

This repository — [gastownhall/bdp](https://github.com/gastownhall/bdp) — is the canonical source of truth for BDP. Wherever you are reading a vendored copy, the original lives here.

## The specification

The protocol is defined by a small set of authored sources under [`specs/src/`](specs/src/), from which every machine-readable artifact is generated. Read them in this order:

1. **[`specs/src/bdp.md`](specs/src/bdp.md)** — the protocol itself: the model, the semantics, and the HTTP rules that span operations — identity, reads, writes, change events, authorization, and the wire details.
2. **[`specs/src/core/core.lumen`](specs/src/core/core.lumen)** — the formal Core source: the type system, the fixed set of primitives, and the Core operations. It projects deterministically to the JSON Schema bundle, the OpenAPI catalog, and the generated Markdown reference.
3. **[`specs/src/bdppacks.md`](specs/src/bdppacks.md)** and **[`specs/src/packs/`](specs/src/packs/)** — the standard packs (`stdlib`, `issue`, `memory`, `ops`): optional capabilities a service may advertise on top of Core.
4. **[`docs/cli-design/bdp-cli.md`](docs/cli-design/bdp-cli.md)** — the `bdp` command-line surface, a client specification over the protocol (not a separate wire profile).

Supporting material:

- **[`specs/formats/`](specs/formats/)** — the authoring conventions for the Markdown ↔ JSON Schema / OpenAPI projections. Generated Markdown adheres to these.
- **[`specs/generated/`](specs/generated/)** — generated artifacts (the Markdown reference, the schemas, the OpenAPI catalog). Produced from the sources above and never hand-edited.
- **[`specs/history/`](specs/history/)** — preserved historical inputs and their immutable original revisions.

Core works without the packs. A pack adds its stated responsibilities without changing Core identity or read meanings.

## Consolidation in progress

The per-profile documents under `specs/profiles/` and the type documents under `specs/types/` are an **earlier structure being consolidated into `bdp.md`, `core.lumen`, and the packs**. They are retained only until that migration completes, are not the current source of truth, and will be removed. Prefer `specs/src/`.

## Building and checking

```sh
pnpm install --frozen-lockfile
pnpm openapi:check   # regenerate the OpenAPI catalog and verify it matches the sources
pnpm test            # the full artifact, schema, markdown and boundary checks
```

Specification-artifact checks (schemas, generated projections and authored contracts agree) are distinct from endpoint-interoperability checks (behaviour exercised through public HTTP). A specification edit does not by itself qualify an implementation.
