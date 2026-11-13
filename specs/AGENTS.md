# Working on the Core specification

This file is for anyone, person or agent, who changes the Core v0.2 specification. It covers three files: [core.lumen](core.lumen) and [core.md](core.md) in this directory, and the generated reference [generated/core.md](generated/core.md).

## Which file says what

`core.lumen` is the source for the schemas and the six operations. It is authoritative. The Markdown reference, the JSON Schema and the OpenAPI document are generated from it.

`core.md` holds the broad meaning of the protocol: the model, the rules that span operations, and the reasons. It does not repeat the shape of a record or the HTTP form of an operation.

When the two disagree about a shape, an operation, a parameter or a status code, `core.lumen` is right and `core.md` is to be fixed.

## Generated files

`generated/core.md` is the Markdown reference. It is generated from `core.lumen`, and its first line says so. The JSON Schema and the OpenAPI document are generated from the same source and are not in this repository yet.

Do not edit a generated file by hand. Change `core.lumen` and generate again.

The generator is not in this repository yet, and nothing here checks that `generated/core.md` matches `core.lumen`. After a change to `core.lumen`, the reference is out of date until it is generated again. When the two disagree, `core.lumen` is right.

## Rules for `core.lumen`

1. **Only schemas, no nominal types.** Every shape is a `schema`. A schema is transparent and makes no new identity: `schema X = T` means `X` is `T`. Never write `type X is …`.
2. **The six operations are primitives, not callables.** Each one is marked `bdp = { kind = "primitive" }`. Do not add a seventh. Anything more goes into a callable in another specification.
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

## Public text

This repository is public. Do not name people in either file. Do not describe how a particular product stores its data.
