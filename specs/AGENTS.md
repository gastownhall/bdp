# Working on the Core specification

This file is for anyone, person or agent, who changes the Core v0.2 specification. It covers three files: the normative source [`src/core/core.lumen`](src/core/core.lumen), the narrative [`src/bdp.md`](src/bdp.md), and the generated reference [`generated/core.md`](generated/core.md). (The old root `core.md` is retired to [`docs/history/obsolete-core.md`](../docs/history/obsolete-core.md) — harvest only, do not cite.)

## Which file says what

`core.lumen` is the source for the schemas and the primitive operations. It is authoritative. The Markdown reference, the JSON Schema and the OpenAPI document are generated from it.

`bdp.md` holds the broad meaning of the protocol: the model, the rules that span operations, and the reasons. It does not repeat the shape of a record or the HTTP form of an operation.

When the two disagree about a shape, an operation, a parameter or a status code, `core.lumen` is right and `bdp.md` is to be fixed.

## Generated files

`generated/core.md` is the Markdown reference. It is generated from `core.lumen`, and its first line says so. The JSON Schema and the OpenAPI document are generated from the same source and are not in this repository yet.

Do not edit a generated file by hand. Change `core.lumen` and generate again.

The reference generator **is** in this repository: `scripts/lumen-to-markdown.py`, which follows the format in [`formats/lumendoc-markdown-reference.md`](formats/lumendoc-markdown-reference.md). (A Rust `lumendoc` is a *speculative* future replacement — not yet used in the product; today it has no reference renderer.) Regenerate with:

```
python3 scripts/lumen-to-markdown.py specs/src/core/core.lumen specs/generated/core.md
```

Nothing here *checks* that `generated/core.md` matches `core.lumen`, so regenerate after every `core.lumen` change — the reference is out of date until you do. When the two disagree, `core.lumen` is right.

## Rules for `core.lumen`

1. **Nominal types are the surface.** BDP models its shapes as Lumen types. Write `type X is T` for a nominal newtype — a distinct identity over a base type, for a scalar that deserves its own name (e.g. `type Rev is string`, `type Ordinal is number`). Write `type X = T` for a transparent alias or a structural shape — a record, a union, or an enum (e.g. `type ResourceRef = ResourceId`, `type PushResult = union { … }`). On the wire the only type system is the media type; these names are the authoring surface.
2. **The primitives are a fixed set, not callables.** Each is marked `bdp = { kind = "primitive" }`. A service offers a subset, advertised through discovery; do not invent a new one. Anything more goes into a callable in another specification.
3. **This is an HTTP specification.** Describe each operation as HTTP: the method, the URL, the query parameters, the headers, the bodies and the status codes. The only type system on the wire is the media type.
4. **Semantics go in metadata comments.** The meaning of a schema, a member, an operation or a parameter is written in the `///` lines above it. The appendix of `core.lumen` lists the metadata keys.

## Marking what is not settled

Use a sidebar, written as a Markdown blockquote inside a prose block. There are two labels.

```markdown
> **Open** — something that is not decided, or is only proposed.

> **Todo** — work still to do in this file.
```

Text with no sidebar is the specification as it stands. Do not record who decided something, or when, in the file.

## Review notes

A reviewer leaves a note as a line that begins with `>` and their marker, for example `>DB`. Put a note inside a prose block, never between a declaration and its metadata comments. A note is temporary. Remove it when it is answered.

## Paths another repository depends on

The conformance gate lives in its own repository and reads two paths out of this tree at
build time. Treat both as a published interface, not as internal layout:

- `generated/openapi/core.openapi.json` — the gate derives the tier-1 operation and fault
  surface (its denominator) from the `paths` block.
- `src/core/core.lumen` — the gate independently re-derives that same surface from the
  `/// openapi =` annotations and asserts the two agree. That is a deliberate second
  witness: it checks the generator from the consumer side, in another language, with no
  shared code, so a generator bug cannot hide behind its own output.

Moving or renaming either path breaks that build. It breaks loudly, which is the intent —
but coordinate a restructuring that has to move them instead of discovering it in someone
else's CI.

Changing the `paths` block of the generated OpenAPI moves the gate's denominator in the
same commit. Adding or removing an operation, or a declared `>=400` response, will fail
the gate's row-by-row surface test until its cases and its expectation move together. That
is the mechanism working, not a breakage: a silent surface change is the thing it exists
to prevent.

## Public text

This repository is public. Do not name people in either file. Do not describe how a particular product stores its data.
