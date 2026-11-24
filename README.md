# Beads Protocol

BDP is an HTTP and JSON protocol for reading and changing Beads and Links across independently implemented stores.

This repository — [gastownhall/bdp](https://github.com/gastownhall/bdp) — is the canonical source of truth for BDP. Wherever you are reading a vendored copy, the original lives here.

## The specification

These are the human-readable specification — read them in this order:

1. **[`specs/src/bdp.md`](specs/src/bdp.md)** — the protocol: the model, the semantics, and the HTTP rules that span operations — identity, reads, writes, change events, authorization, and the wire details. Authored prose.
2. **[`specs/generated/core.md`](specs/generated/core.md)** — the Core reference: the type system, the fixed set of primitives, and the Core operations, each with its HTTP mapping and schema.
3. The standard packs — `stdlib`, `issue`, `memory`, `ops` — optional capabilities a service may advertise on top of Core; each has a reference under **[`specs/generated/`](specs/generated/)**.
4. **[`docs/cli-design/bdp-cli.md`](docs/cli-design/bdp-cli.md)** — the `bdp` command-line surface, a client specification over the protocol (not a separate wire profile).

Core works without the packs. A pack adds its stated responsibilities without changing Core identity or read meanings.

### How it is built

The Core and pack references under **[`specs/generated/`](specs/generated/)**, together with the JSON Schema bundle and the OpenAPI catalog, are **generated** from the authoring sources in **[`specs/src/`](specs/src/)** — `core/core.lumen` and `packs/*.lumen`, alongside the authored `bdp.md`. Read the generated references; the `.lumen` files are the authoring form and are not meant to be read directly. **[`specs/formats/`](specs/formats/)** holds the Markdown ↔ JSON Schema / OpenAPI conventions the generated documents follow, and **[`docs/history/`](docs/history/)** preserves the historical inputs. Nothing under `specs/generated/` is hand-edited.

## Consolidation complete

The earlier per-profile documents and type documents have been **consolidated into `bdp.md`, `core.lumen`, and the packs** under `specs/src/`, and the retired per-profile structure has been relocated to `docs/history/profiles/` and `docs/history/types/`. It is kept for history only, is not the current source of truth, and must not be read as current. Prefer `specs/src/`.

## Building and checking

```sh
pnpm install --frozen-lockfile
pnpm openapi:check   # regenerate the OpenAPI catalog and verify it matches the sources
pnpm test            # the full artifact, schema, markdown and boundary checks
```

Specification-artifact checks (schemas, generated projections and authored contracts agree) are distinct from endpoint-interoperability checks (behaviour exercised through public HTTP). A specification edit does not by itself qualify an implementation.
