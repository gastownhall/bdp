---
type: Specification
status: draft
version: "0.1"
owner: lydia
---

# lumendoc — the Markdown reference rendering

> **Status.** Draft proposal. It specifies the rules the interim generator
> `scripts/lumen-to-markdown.py` already follows, so that `lumendoc` (the Rust
> tool) can implement the same contract and the script can be retired. Proposed
> home and ownership are open: this concerns any `.lumen` file, not BDP alone, so
> it may move to the lumendoc repository. Placed here for review.

A `.lumen` specification is the source of truth. The **Markdown reference** is its
projection for people to read. This document defines that projection: given a
`.lumen` file, exactly one Markdown document follows. The rendering is
deterministic — same input, same output — and adds nothing the source does not
say.

It does not define the JSON Schema or OpenAPI lowerings; those have their own
format specifications. It defines only the human Markdown reference.

## 1. The input: forms and metadata

A `.lumen` file is read as a sequence of **forms** and **prose**.

A **form** is one declaration — a `type`, a union, or an operation
(`fn` / `command` / `idempotent command` / `safe command`). Each form has an id.
The id is the form's `form-id` metadata when present, else its declaration name.
This is the key a citation `[[file#id]]` resolves against, so the reference must
anchor each form under exactly that id.

A form carries **`///` metadata** on the lines above its declaration, and on its
members. The vocabulary:

| Key | Meaning | In the reference |
| --- | --- | --- |
| `/// description:` | prose meaning of a form or a member | rendered as prose / a table cell |
| `/// normative:` | one conformance rule (MUST / SHOULD / MAY) | a labelled callout |
| `/// form-id:` | the stable citation id | the anchor id |
| `/// return:` | an operation's return-value description | the **Returns** line |
| `/// bdp =` | protocol machine-metadata | omitted |
| `/// openapi =` | HTTP binding machine-metadata | omitted |
| `/// jsonschema =` | JSON Schema machine-metadata | omitted |

**Prose** is comment text (`//` or `#` lines) that is not a form's metadata.
`#` and `//` are both comment prefixes; a line of five or more `#`/`=` after the
prefix is a section banner, five or more `-` is a sub-banner.

## 2. Document structure

- A top-level banner becomes an `h1`; a sub-banner becomes an `h2`. The banner
  text is used verbatim.
- Each form becomes an `h3`, preceded by an explicit anchor equal to its id, so a
  link resolves by id independently of the renderer's own heading-slug rules:

  ```
  <a id="Form"></a>

  ### `Form`
  ```
- Prose between forms renders as Markdown: paragraphs collapse to one line; a run
  of `- ` or `N.` lines becomes a list; a run of `|` lines becomes a table (a
  separator row is synthesised); indented or brace-bearing blocks render as a
  fenced code block; a `--- heading ---` line becomes bold.

## 3. Per-form rendering

Each form renders, in order:

1. its **`/// description:`** lines, as prose;
2. its **`/// normative:`** lines, each as a callout: `> **Normative.** …`;
3. its **Lumen fragment** — the declaration itself, in a ```lumen block, with all
   `///` metadata lines and trailing `//` comments stripped so only clean code
   remains;
4. its **member table** (below), when the form has members.

The fragment comes first, the table second. They are complementary: the fragment
is the exact shape; the table carries the per-member descriptions.

## 4. Member tables

The table shape depends on the form:

- **Record** (`type X { … }` / `type X = { … }`) → `| Member | Type | Description |`,
  one row per field. A field's description is its leading `/// description:`, else
  its trailing `// comment`.
- **Union** (`type X = union { … }`) → `| Variant | Payload | Description |`, one
  row per arm. An arm with no payload shows `—`. A bare named arm with no
  description borrows the description of the form it names.
- **Operation** → `| Parameter | Type | Description |`, one row per parameter,
  followed by `**Returns** `T``. The return description is the operation's own
  `/// return:` text when present (the return has no parameter line to carry a
  leading `/// description:`, so it hangs off a `return` key in the op docblock and
  lowers onto the operation node), else the description of the return type `T` when
  `T` names a form.
- **Sum-of-types alias** (`type X = A | B | C`, arms not all string literals) →
  `| Alternative | Description |`, one row per alternative, each description
  looked up from the alternative's form id.
- **String-literal union** (`type X = "a" | "b"`) and **scalar alias**
  (`type X is T`) → no table; the fragment is the whole rendering.

A `|` inside a payload (for example `{ of: "a" | "b" }`) does not split an arm:
alternative-splitting is bracket- and quote-aware.

## 5. Cross-references

A citation `[[file#id]]` (or `[[id]]`) in prose or a description renders as a
Markdown link to the form's anchor: `[id](#id)`, where `id` is the text after `#`
(else the whole target). Citations inside a code fence are left untouched.

## 6. Omissions

The reference never shows:

- machine-metadata (`/// bdp`, `/// openapi`, `/// jsonschema`);
- review scaffolding — a prose block or an inline comment marked `>DB?`,
  `TYPES-PASS:`, `>L`, or `>>>` is dropped.

## 7. Determinism and fidelity

The projection is a pure function of the source: no clock, no environment, no
ordering beyond the source's own. It adds no claim the source does not make — a
missing description renders as an empty cell, not invented text. The normative
rules are never lost: every `/// normative:` line appears as a callout at its
form, and the generator may additionally gather the store-wide ones into an
index.

## Appendix — correspondence to the interim generator

Section 1–6 of this document are implemented by
`scripts/lumen-to-markdown.py` as of branch `spec/core-v0.2`. The intended end
state is that `lumendoc --to markdown-reference` implements this specification and
the script is retired. Until then, the script is the reference implementation and
this document is its contract.
