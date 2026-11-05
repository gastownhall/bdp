---
status: editorial-draft
intended-status: optional-profile
version: "preview-1"
---

# Beads Protocol — Callables

Editorial draft preview-1 · November 5, 2026 · lifted from the experimental draft of October 30, 2026

Callables is the optional capability by which a Scope exposes named,
parameterized operations over BDP. A **Callable** is a Bead that declares one
such operation: its help, its parameters, the schema of its result and the
schema of its errors. A **CallableQuery** is read-only; a **CallableBatch**
mutates. Either can be declared and invoked on its own.
[Core](../core/core.md) supplies identity, records, reads, authorization,
discovery and HTTP; [Write](../write/write.md) supplies the mutation, allocation
and attribution contracts a CallableBatch inherits;
[Types](../types/types.md) supplies the descriptor language of the three
definitions below.

This edition specifies **declarations**, in the sense that a C header declares a
function: enough to call the operation and to project an OpenAPI operation and a
CLI command from it, and nothing about how it is implemented. A provider's
implementation might be native code or a stored batch whose body it never
publishes; a client cannot tell and does not need to. A later edition can add a
readable `body`, which makes a declaration a **definition**, without changing how
anything is invoked.

The three Types are authored as descriptor documents in the
[Type-definition notation](../../formats/markdown-type-definitions.md) under
`descriptors/`, with their properties schema as a sibling document in the
[Markdown JSON Schema notation](../../formats/markdown-json-schema.md),
`callable-properties.md`. The wire shapes of the capability, the invocation, the
result and the problems are fragments in the Schemas appendix (§13), bundle
`callables`. The prose reads both; it restates neither as JSON.

Rules marked **preview** may change in a later edition without a compatibility
promise. Packages, the experimental grouping of definitions in
`experimental/packs.md`, depend on this profile, not the reverse.

## Contents

1. [Discover Callables](#1-discover-callables)
2. [Declarations](#2-declarations)
3. [Invocation](#3-invocation)
4. [Checking arguments](#4-checking-arguments)
5. [Execution and results](#5-execution-and-results)
6. [What a declaration promises](#6-what-a-declaration-promises)
7. [Registration](#7-registration)
8. [Authorization](#8-authorization)
9. [Problems](#9-problems)
10. [CLI correspondence](#10-cli-correspondence)
11. [Conformance rows for preview-1](#11-conformance-rows-for-preview-1)
12. [Deferred](#12-deferred)
13. [Schemas](#13-schemas)
14. [OpenAPI](#14-openapi)
15. [Obsolescence](#15-obsolescence)

## 1. Discover Callables

| Item | Selected value |
| --- | --- |
| Capability identity | `https://github.com/gastownhall/bdp/capabilities/callables` |
| Exact supported version | JSON member name `"1"`; **Callables1** means version 1 of this capability, as Types1 does for Types |
| Version-1 detail | Closed empty object (`callablesCapabilityV1`) |
| Base contract | BDP `"0.1"`; Core required; Write required for a CallableBatch |
| Media | `application/vnd.bdp.v0.1+json` for bodies and successful results; `application/problem+json` for problems |
| Feature schema | `https://github.com/gastownhall/bdp/schemas/callables-v1.schema.json` |

A Scope advertises the capability under Core's `capabilities` map. Like the
inventories at `<scope>/bdp/beads` and `<scope>/bdp/links`, invocation lives in a
fixed namespace, `<scope>/bdp/call` (§3), so discovery names no URL. There is no
`callables` profile literal, no new required discovery member and no change to
Write's closed operation directory. A Core-only Scope MAY advertise Callables1 and
offer CallableQuery operations. A CallableBatch requires Write, whose allocation,
non-reuse and attribution rules govern its effects; under a Scope that also
advertises Write's optional `idempotency` capability, the `Idempotency-Key` is
required and replayed as §3 states. (**preview**)

Advertisement states support, not authorization. A client that does not understand
the capability ignores it and keeps using base behavior. (**preview**)

## 2. Declarations

### 2.1 Identities and names

Three Bead Types are published under `https://github.com/gastownhall/bdp/types/callable/`:

| Identity suffix | Exact revision | Refines | `abstract` | Descriptor |
| --- | --- | --- | --- | --- |
| `callable` | `callable-preview-1` | none | `true` | [`descriptors/callable.md`](descriptors/callable.md) |
| `callable-query` | `callable-query-preview-1` | `callable` at `callable-preview-1` | absent | [`descriptors/callable-query.md`](descriptors/callable-query.md) |
| `callable-batch` | `callable-batch-preview-1` | `callable` at `callable-preview-1` | absent | [`descriptors/callable-batch.md`](descriptors/callable-batch.md) |

A declaration is an ordinary Bead affiliated with `callable-query` or
`callable-batch`. Its properties object is the declaration. It is readable by
point read and appears in the Bead inventory like any other Bead, so a client
that wants only other records selects by `type` or `conformsTo`. The three Types
are a fixed catalog: a provider may enforce them as native Scope policy under
Core alone, and a Scope advertising Types1 serves them as definition Beads
unchanged.

**A Callable's name is its full local Resource ID**, its canonical URL relative
to the Scope: `reserve-room`, or `rooms/reserve`. There is no separate name
member. The name is unique because the identity is, and it follows the
identity's rules: it never changes, and it is not reused after the Bead is
deleted, so renaming an operation means declaring a new Bead. A declaration
intended for people or generators is created with a chosen `id`; an allocated
opaque identity gives an equally valid and meaningless name. Aliases name nothing
here: an alias is a repointable locator, not part of the record. (**preview**)

### 2.2 callable — Bead Type

**Meaning and use.** The common contract of a named operation: help, parameters,
the result and error schemas, and any CLI additions. `description` and the `...Schema` names match the Type descriptor's `description` and `propertiesSchema`. Abstract: a declaration
affiliates with one of the two concrete refinements, never with `callable`
itself.

**Conforms to.** None within this profile; it is the parent of `callable-query`
and `callable-batch`.

**Properties** (`callable-properties.md`, root). The root is open. A `body` is
rejected in this edition; a later edition defines it. The binding from a name to
an implementation is the provider's own and is no part of a declaration.

Other fields: allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "atomic" | boolean | no | callable | "True when the operation commits all its effects or none; false when absent. Meaningful for a CallableBatch." |
| "cliMapping" | cliMapping | no | callable | "Additions to the CLI form derived from parameters (§10)." |
| "description" | text | yes | callable | "Standard help for the operation; an empty string is admitted and differs from absence." |
| "errorSchema" | valueSchema | no | callable | "Schema of the value in a callable-error Problem's error member; absent means any JSON value." |
| "idempotent" | boolean | no | callable | "True when repeating an invocation with the same arguments has no further effect, even if the result differs; false when absent. Meaningful for a CallableBatch." |
| "parameters" | array of parameter | yes | callable | "Declared named arguments; an empty array is admitted; names are distinct within one declaration." |
| "resultSchema" | valueSchema | no | callable | "Schema of the invocation result; absent means any JSON value." |
| "title" | text | no | callable | "Short human-readable name; the name itself is the local Resource ID." |

### 2.3 Value shapes

These are property value shapes, not Bead Types; each is a named definition of
the sibling schema document.

**parameter** — one declared argument. Names are distinct within one declaration;
a required parameter carries no default.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "default" | any | no | parameter | "The value supplied for an omitted argument; it must satisfy schema. Omission of this member is distinguishable from an explicit null default." |
| "description" | text | no | parameter | "Parameter help, reused by the CLI and OpenAPI projections." |
| "name" | text | yes | parameter | "Nonempty exact argument name." |
| "required" | boolean | no | parameter | "Whether the argument must be supplied; false when absent." |
| "schema" | valueSchema | yes | parameter | "The argument's value schema." |

**Defaults belong to the service.** A client never substitutes a default: it omits
the argument and the service applies the value (§4). OpenAPI carries `default` as
documentation, and `--help` shows it. (**preview**)

**valueSchema** — an embedded JSON Schema Draft 2020-12 value, an object or a
boolean. It validates one argument, one result or one error value; it establishes
no Resource kind, Type membership or authorization. **Every `$ref` in a
valueSchema resolves inside the document that carries it**, so a client holding a
declaration needs nothing else to read it: in a declaration Bead, each valueSchema
is its own root and shared parts sit in its own `$defs`, and a `$ref` naming
another document is invalid. Authoring tools may keep shared schemas and copy
them in when they generate a declaration. (**preview**)

**cliMapping** — additions to the CLI form derived from parameters (§10). It
chooses no command route and grants nothing.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "flags" | array of flagMapping | no | cliMapping | "Additional flag spellings for parameters." |
| "positionals" | array of positionalMapping | no | cliMapping | "Positions mapped onto parameters." |

**flagMapping** — adds one or more CLI flag spellings for a declared parameter.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "names" | array of text | yes | flagMapping | "Distinct nonempty flag spellings, such as -l; at least one." |
| "parameter" | text | yes | flagMapping | "The nonempty name of a declared parameter of the same declaration." |

**positionalMapping** — maps one zero-based CLI position onto a declared
parameter.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "parameter" | text | yes | positionalMapping | "The nonempty name of a declared parameter of the same declaration." |
| "position" | integer | yes | positionalMapping | "Zero-based argument position; at least 0." |

### 2.4 callable-query and callable-batch — Bead Types

**Meaning and use.** `callable-query` declares a read-only operation: invoking it
changes no Resource, alias or retained state. `callable-batch` declares a
mutating operation, with Write's allocation, non-reuse and attribution rules for
its effects. Nothing else differs between them in this edition; the distinction
decides which invocation members and fields apply (§3).

**Conforms to.** `callable`, through one exact Refines declaration each.
Concrete: `abstract` is absent. Neither adds properties.

**Owned outgoing Link Types.** None, for all three Types.

### 2.5 Valid declarations and a worked example

A declaration is invalid when it has duplicate parameter names, a flag or
positional mapping naming an undeclared parameter, duplicate flag spellings
(derived or added), duplicate positions, a `default` that fails its `schema`,
`required` together with `default`, or a `$ref` that does not resolve inside its
document. These are semantic checks the structural schema cannot express. A
provider does not serve an invalid declaration.

Informative: a complete declaration Bead, as a point read of its canonical URL
returns it. The record is an ordinary Bead and the declaration is its properties
object. The `reason` member inside `errorSchema` is this declaration's own choice;
Callables gives it no meaning.

```json
{
  "id": "https://beads.example/acme/reserve-room",
  "type": "https://github.com/gastownhall/bdp/types/callable/callable-batch",
  "revision": "r1",
  "properties": {
    "title": "Reserve a room",
    "description": "Reserve a room for one day. Reserving a room you already hold changes nothing.",
    "idempotent": true,
    "atomic": true,
    "parameters": [
      {
        "name": "room",
        "schema": {"type": "string", "minLength": 1},
        "required": true,
        "description": "The room to reserve."
      },
      {
        "name": "day",
        "schema": {"type": "string", "format": "date"},
        "required": true,
        "description": "The day to reserve it for."
      }
    ],
    "resultSchema": {
      "type": "object",
      "properties": {
        "reservation": {"type": "string"},
        "already_held": {"type": "boolean"}
      },
      "required": ["reservation", "already_held"]
    },
    "errorSchema": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "reason": {"const": "room-taken"},
            "holder": {"type": "string"}
          },
          "required": ["reason", "holder"]
        },
        {
          "type": "object",
          "properties": {"reason": {"const": "room-closed"}},
          "required": ["reason"]
        }
      ]
    },
    "cliMapping": {"positionals": [{"position": 0, "parameter": "room"}]}
  },
  "metadata": {}
}
```

The invocation, a success and a `callable-error` then read, in order:

```json
{"arguments": {"room": "cedar", "day": "2026-11-20"}, "revisionProvenance": {"actor": {"id": "sam", "basis": "writer-supplied"}}}
```

```json
{"changed": true, "result": {"reservation": "res-81", "already_held": false}}
```

```json
{"type": "https://github.com/gastownhall/bdp/problems/conflict", "status": 409, "code": "callable-error", "retry": "after-state-change", "error": {"reason": "room-taken", "holder": "kim"}}
```

## 3. Invocation

An invocation is `POST` to the Callable's **mount**: `<scope>/bdp/call/` followed by
the Callable's name, each segment encoded as in its canonical URL. `reserve-room` in
the Scope `https://beads.example/acme/` is
`https://beads.example/acme/bdp/call/reserve-room`. The namespace is fixed, as
`<scope>/bdp/beads` and `<scope>/bdp/links` are, and Core already reserves `bdp` and
its descendants against Resources and aliases. A provider MAY serve a listing at
`<scope>/bdp/call` itself; this edition specifies none. A mount admits `POST` only
and answers other methods with a bodyless 405 and `Allow: POST`. `GET` of a
declaration's canonical URL is always the ordinary record read and never an
invocation.

The body is the closed `callableInvocation` object:

| Member | Required | Meaning |
| --- | --- | --- |
| `arguments` | yes | Object keyed by parameter name; `{}` when the declaration has no parameters |
| `revisionProvenance` | no, CallableBatch only | Write's attribution input, carried onto every revision the batch commits; rejected on a CallableQuery |

The mount supplies the operation; `operation`, `name` and a body-level key are
not invocation members. Unknown members, duplicate JSON members and invalid
strings are rejected as `malformed-request`. `Content-Type` declares the base
media type; a missing or generic `application/json` body is rejected with 415
`unsupported-media-type` before interpretation, for both kinds.

When the Scope advertises `idempotency`, a CallableBatch invocation carries
exactly one `Idempotency-Key` HTTP field under Write's idempotency rules and a
replay returns the original result. When it does not, the field is admitted and
not retained: repeating an invocation is safe exactly when the declaration says
`idempotent`, and otherwise a client that needs at-most-once execution uses a
revision guard, supplies identities, or chooses a Scope with `idempotency`. A
CallableQuery invocation carries no key and is rejected as `malformed-request` if
it does. (**preview**)

Success is HTTP 200 with the `callableResult` body (§5), `Cache-Control: private,
no-store`, and no `ETag` or `Location`. Failure is the applicable Problem at its
status (§9).

## 4. Checking arguments

The provider checks `arguments` against the declaration before running the
operation:

- A member whose name is no declared parameter is rejected.
- A declared parameter that is `required` and neither supplied nor defaulted is
  rejected.
- An omitted parameter with a `default` is supplied that value; an omitted
  parameter without one is absent, and the implementation sees absence, never a
  fabricated `null`.
- `null` is a supplied value and is validated like any other.
- Every supplied value is validated against the parameter's `schema`; failure is
  rejected.
- A value whose schema says it is a URI or Reference is validated as a value only;
  checking it acquires nothing and establishes neither Resource kind nor Type
  membership. Resolution, if any, is the implementation's and follows the ordinary
  authorization and non-disclosure rules.

Every rejection above is `validation-failed` with a diagnostic naming the
parameter. Checking uses Core's JSON value model: exact decimal numbers, no
duplicate names, Unicode scalar values.

## 5. Execution and results

A CallableQuery runs under the request's Authorization View and returns its
result. A CallableBatch runs under Write's allocation, non-reuse and attribution
rules, and the retained key state records the outcome where `idempotency` is
advertised.

**Atomicity is declared per Callable, as idempotency is.** A CallableBatch whose
declaration says `atomic` commits all its effects or none, so a Problem from it means
nothing committed. Without `atomic`, a Problem does not establish that. (**preview**)

**Validation.** Checking arguments is the service's job (§4). Checking a response is
the client's, which MAY validate what it receives. A conforming implementation does
not return a `result` or `error` value that violates its declared schema; conformance
can test that by example but cannot prove it exhaustively. (**preview**)

Success returns the closed `callableResult`, for example:

```json
{
  "changed": true,
  "result": {"reservation": "res-81", "already_held": false}
}
```

| Member | Meaning |
| --- | --- |
| `result` | Any JSON value; the declaration's `resultSchema`, when there is one, says what to expect |
| `changed` | CallableBatch only, required: `true` when the batch committed any durable effect, else `false`; it promises nothing about revisions, and an implementation may commit a durable effect that mints none |

Under `idempotency`, a replay of a CallableBatch key returns the original
`callableResult` under Write's rules, without running again and without
re-resolving defaults, declarations or implementations.

Resource records inside `result` are ordinary records when the implementation
chooses to return them; nothing in this profile makes a result a collection,
grants a cursor or issues a revision. A query that pages does so through its own
declared parameters and result shape.

## 6. What a declaration promises

A declaration states a contract and the provider stands behind it:

- `resultSchema` and `errorSchema` describe what the operation returns; absent,
  they promise only some JSON value.
- `idempotent`, when true, is a promise a client may rely on when deciding to
  retry, and `atomic`, when true, one it may rely on after a failure.
- The implementation of a CallableQuery observes and does not mutate.
- A reachable Callable with no working implementation answers
  `callable-unavailable`, never a no-op, a stale success or an unknown Bead.

How a name finds its implementation is the provider's own. That binding is not a
Bead, is not named in a declaration and is no part of this protocol.

A retained successful key replays its original result even after the declaration or
the implementation changed.

## 7. Registration

Registration answers one question: which of this Scope's Callables are reachable? A
declaration existing in the Scope does not make it reachable, because creating a Bead
must not create an endpoint. **Registration is optional in this edition.**

The BDP specifications own two prefixes in a Scope, and the rest is the Scope's:

| Prefix | Kind | Holds |
| --- | --- | --- |
| `bdp` | Sideband | The protocol routes that Bead operations go through. Never addressable as a Bead or Link |
| `sys` | In-band | Real Beads and Links the specifications place under reserved names, read and changed through the ordinary operations, so they cannot collide with a user's IDs |

Core reserves only `bdp` today; reserving `sys` is a Core amendment that accompanies
this profile. Installed packages are one application of `sys`, and exposed operations
are another.

A Scope that registers has a **root Bead** at `<scope>/sys/callables`, with one typed
outgoing Link to each reachable declaration:

```text
sys/callables [root Bead]
    --exposes [Link, own identity and revision]-->
    reserve-room [declaration Bead]
```

A live Link is the whole fact: its presence means the Callable is reachable, and its
absence means it is not. There is no boolean on the declaration and no hidden table.
A client lists what is reachable with Core's ordinary read,
`GET <scope>/sys/callables?view=links&direction=outbound`, and follows each `target`
to its declaration. On a Scope with a root Bead, invoking a Callable with no live Link
is `callable-not-found`. A Link's target is unpinned, so the declaration's current
revision is what is exposed. A Link promises neither that an implementation is
currently available (`callable-unavailable`, §9) nor that the caller is authorized
(§8).

On a Scope without a root Bead, which Callables are reachable is the provider's own,
and a client learns them from a published contract such as its OpenAPI document.

The root Bead's Type, the Link Type's final name and how a package's Callables join it
are settled with packages, because the installed-package root is the same pattern and
the two are designed together (§12). (**preview**)

## 8. Authorization

A CallableQuery requires read authorization for the Scope under Core; a
CallableBatch requires write authorization under Write. An implementation MAY
require more and answers `forbidden`. An `exposes` Link, a readable declaration and
a CLI projection grant nothing. Non-disclosure follows Core: an unauthorized
caller receives the same `callable-not-found` for a Callable it may not see as for
a name that does not exist. (**preview**)

## 9. Problems

Every failure of an invocation is an HTTP error status with a Problem body; a 200
always means the operation succeeded. A client tells them apart by `code`, which
is BDP's closed list. Callables uses Core's and Write's applicable codes, families,
non-disclosure and retry meanings, with these additions. A family suffix means
`https://github.com/gastownhall/bdp/problems/SUFFIX`.

| Code | Family suffix | Status | Retry | Condition |
| --- | --- | --- | --- | --- |
| `callable-not-found` | `not-found` | 404 | `after-state-change` | No visible, reachable Callable at the mount |
| `callable-unavailable` | `unavailable` | 503 | `after-state-change` | The Callable is reachable but has no working implementation |
| `callable-error` | `conflict` | 409 | `after-state-change` | The operation ran and returned an error of its own; the required `error` member carries its value |

**`callable-error` means the operation was successfully dispatched and returned
normally, reporting an error of its own, and was not terminated from outside or by
a system error.** It is the `Err` of a `Result<T, E>`, where `result` is the `T`.
The `error` member is one JSON value, valid against the declaration's `errorSchema`
when there is one, and Callables gives its contents no meaning: the declaration's
author chooses its shape, typically a union discriminated by a member of their
choosing.
The status is always 409. (**preview**)

A failure that is not the operation's own answer is not `callable-error`. An
implementation that crashes, is terminated or hits a system failure answers a
standard 5xx Problem, such as `temporarily-unavailable`, with no `error` member.
Where an operation's failure meets the condition of a Core or Write code, it uses
that code rather than `callable-error`: `revision-mismatch` for a stale guard,
`resource-not-found` for a Resource named by an argument that it could not resolve.

Reused as they stand: `malformed-request` (carrier syntax, a key on a query),
`invalid-parameter`, `unsupported-media-type`, `validation-failed` (checking
arguments), `unauthenticated`, `forbidden`, `resource-not-found`,
`request-too-large`, `limit-exceeded`, `rate-limited`, `temporarily-unavailable`,
and Write's `idempotency-conflict`, `idempotency-in-progress`,
`idempotency-expired`, `revision-mismatch`, `identity-taken` and
`incident-links-exist` for the effects a CallableBatch commits.

## 10. CLI correspondence

The canonical client invokes a Callable by its name, with client options before
the verb and the Callable's own arguments after it:

```text
bdp [client options] call NAME [callable arguments]
```

Flags derive from the declaration, so most declarations need no CLI section:

| Declared | CLI form |
| --- | --- |
| Any parameter | `--kebab-name`, from the parameter name split at `_`, `-` and lower-to-upper boundaries, lowercased and joined with `-` |
| `schema` of type `boolean` | `--flag` and `--no-flag` |
| `schema` of type `array` | The flag repeats, one item each |
| Any other non-string `schema` | The flag's value is parsed as JSON |

`cliMapping` only adds to this: `flags` adds spellings such as `-l`, and
`positionals` lets a position stand for a flag. A generic `--arguments JSON` input
supplies the whole object, and explicit flags override its members. `--help` after
`NAME` prints `title`, `description`, the parameters and any declared errors
without invoking.

**The command tree, as a placeholder.** A Callable's name gives its place in the tree,
one command word per segment: `memory/remember` is `bdp memory remember`. A built-in
command wins any collision, and `bdp call NAME` always reaches the Callable. (**preview**)

The client preserves omission and `null`, and never substitutes a default. A CallableBatch invocation
mints the `Idempotency-Key` as the client does for Write's operations when the
Scope advertises `idempotency`. The client never infers an invocation from a Bead
URL. The CLI design document gains a `call` section and closes its mismatch row,
`CLI-09`, when that section lands.

```sh
bdp call reserve-room --room cedar --day 2026-11-20
bdp call reserve-room cedar --day 2026-11-20
```

## 11. Conformance rows for preview-1

| Row | Expectation |
| --- | --- |
| CB-1 | Discovery advertises the capability at version `"1"` with empty detail |
| CB-2 | Each reachable name resolves to a Bead affiliated with `callable-query` or `callable-batch` whose properties satisfy §§2.2–2.5 |
| CB-3 | `POST` to a mount with valid `arguments` returns 200 and a `callableResult` |
| CB-4 | An unknown argument member is rejected as `validation-failed` naming it |
| CB-5 | A missing required parameter is rejected as `validation-failed`; an omitted defaulted parameter runs with its default |
| CB-6 | `POST` to a mount with no reachable Callable is `callable-not-found` |
| CB-7 | Under `idempotency`, a CallableBatch `POST` without `Idempotency-Key` is rejected and a replay with the same key returns the original `callableResult`. Without it, repeating an invocation of a declaration marked `idempotent` has no further effect |
| CB-8 | A CallableQuery invocation leaves every Resource revision in the Scope unchanged |
| CB-9 | A reachable Callable with no working implementation answers `callable-unavailable` |
| CB-10 | A `callable-error` is HTTP 409 with an `error` member, valid against the declaration's `errorSchema` when there is one |
| CB-11 | `GET` of a declaration's canonical URL returns the ordinary Bead record |
| CB-12 | On a Scope with a root Bead at `sys/callables`, a declaration with no live Link from it is `callable-not-found`, and creating that Link makes it reachable |
| CB-13 | A Problem from a declaration marked `atomic` leaves every Resource revision in the Scope unchanged |

## 12. Deferred

Not selected in preview-1:

- Stored bodies: a readable `body`, such as a selected Query AST or a literal
  atomic-batch request, which makes a declaration a definition, with a versioned
  parameter-binding form (CALL-O1's binding half).
- How an endpoint advertises what it does and does not support across the board. The
  exercise follows this specification work.
- Registration details, settled together with packages: the root Bead's Type, the
  Link Type's final name, per-Callable projection choices carried on the Link, and how
  a package's Callables join it (`experimental/packs.md`, including installed command
  trees and shortcuts).
- The command tree: whether it stays derived from the name, is declared, or is built
  from a Bead graph, and whether a package can add parameters to an existing command,
  such as `--title` on `bd create`.
- How the CLI learns what Callables exist: something Bead-specific, or the OpenAPI
  document with CLI customizations carried in its extension members.
- How much of `cliMapping` survives. It is judged during the detailed design of the
  first package, and a parameter annotation for positionals may be all that is
  needed.
- Result carriers beyond one JSON value: paged results, streamed results,
  collection-kind metadata.
- A revision guard on an invocation. A general scrub of provenance, actor and
  `--if-revision` comes first, and `call` could use the same mechanism.
- A service that exposes CallableBatch commands without Write's raw generic verbs,
  a common pattern this edition does not yet allow. It is to be anticipated when
  the requirement that a CallableBatch needs Write is revisited.

## 13. Schemas

The following markdown-json-schema/0.6 fragments, bundle `callables`, are the wire
shapes the prose above reads from; `scripts/spec-schema-fragments.mjs` extracts them
into `specs/profiles/callables/callables-v1.schema.json`, the feature schema of §1,
beside the Types feature schema. References into the common bundle use its full
schema identity, as the Types feature schema does. The Types' property schema is
the descriptor companion `callable-properties.md`, not a member of this bundle.

<!-- bdp-schema:start callablesCapabilityV1 bundle=callables -->
### Schema: "callablesCapabilityV1"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Version-1 detail of the Callables capability: closed and empty, because invocation lives in a fixed namespace." |
| type | "object" |
<!-- bdp-schema:end callablesCapabilityV1 bundle=callables -->

<!-- bdp-schema:start callablesDiscovery bundle=callables -->
### Schema: "callablesDiscovery"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A Core or Write discovery document that advertises Callables version 1 with its closed detail." |

#### Advanced

```json-schema
{
  "allOf": [
    {"$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/retainedDiscovery"},
    {
      "type": "object",
      "properties": {
        "capabilities": {
          "type": "object",
          "properties": {
            "https://github.com/gastownhall/bdp/capabilities/callables": {
              "type": "object",
              "properties": {"1": {"$ref": "#/$defs/callablesCapabilityV1"}},
              "required": ["1"]
            }
          },
          "required": ["https://github.com/gastownhall/bdp/capabilities/callables"]
        }
      },
      "required": ["capabilities"]
    }
  ]
}
```
<!-- bdp-schema:end callablesDiscovery bundle=callables -->

<!-- bdp-schema:start callableInvocation bundle=callables -->
### Schema: "callableInvocation"

Value: object

Other fields: not allowed

Required order: ["arguments"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The closed invocation body. The mount supplies the operation; no operation, name or key member rides in the body." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "arguments" | object | yes | — | "Object keyed by parameter name; an empty object when the declaration has no parameters." |
| "revisionProvenance" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revisionProvenanceInput" | no | — | "Write's attribution input, admitted on a CallableBatch invocation and carried onto every revision the batch commits; rejected on a CallableQuery." |
<!-- bdp-schema:end callableInvocation bundle=callables -->

<!-- bdp-schema:start callableResult bundle=callables -->
### Schema: "callableResult"

Value: object

Other fields: not allowed

Required order: ["result"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The closed success body of an invocation: the result value and, for a CallableBatch, whether anything committed." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "changed" | boolean | no | — | "CallableBatch only, then required: true when the batch committed any durable effect, else false." |
| "result" | any | yes | — | "Any JSON value; the declaration's resultSchema, when there is one, says what to expect." |
<!-- bdp-schema:end callableResult bundle=callables -->

<!-- bdp-schema:start callableProblemMembers bundle=callables -->
### Schema: "callableProblemMembers"

Value: object

Required order: ["type","code","retry"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The members of a Problem whose code this profile adds. Core's and Write's codes keep their own shapes; an invocation Problem is one or the other." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "code" | schema | yes | — | "One of the three codes this profile adds." |
| "error" | any | no | — | "Required with callable-error, absent otherwise: the operation's own error value, valid against the declaration's errorSchema when there is one." |
| "retry" | schema | yes | — | "Always after-state-change for these three codes." |
| "type" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteUri" | yes | — | "The BDP problem-family URI." |

#### Advanced

```json-schema
{
  "properties": {
    "code": {"enum": ["callable-not-found", "callable-unavailable", "callable-error"]},
    "retry": {"const": "after-state-change"}
  },
  "if": {"properties": {"code": {"const": "callable-error"}}},
  "then": {"required": ["error"]},
  "else": {"not": {"required": ["error"]}}
}
```
<!-- bdp-schema:end callableProblemMembers bundle=callables -->

<!-- bdp-schema:start callableProblem bundle=callables -->
### Schema: "callableProblem"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A Problem answered by a mount: a Core or Write Problem, or one carrying a code this profile adds." |

#### Advanced

```json-schema
{
  "anyOf": [
    {"$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/readUpdateProblem"},
    {"$ref": "#/$defs/callableProblemMembers"}
  ]
}
```
<!-- bdp-schema:end callableProblem bundle=callables -->

## 14. OpenAPI

**Each Callable projects to one typed OpenAPI operation by a fixed rule**, so a
declaration needs no HTTP mapping of its own:

| OpenAPI | Comes from |
| --- | --- |
| Path and method | `POST` at the Callable's mount (§3) |
| `operationId` | The name, split at `/`, `-`, `_` and `.`, joined in lower camel case: `rooms/reserve` is `roomsReserve` |
| `summary`, `description` | `title`, `description` |
| Request body | `callableInvocation`, with `arguments` as a closed object: one property per parameter carrying its `schema`, `description` and `default`, and `required` listing the required parameters |
| `Idempotency-Key` header | CallableBatch only, as §3 states |
| 200 response | `callableResult`, with `result` as the declaration's `resultSchema` |
| 409 response | `callableProblem`, with `error` as the declaration's `errorSchema` on `callable-error` |
| `default` response | `callableProblem` |
| `x-bdp-callable` extension | The Type, `idempotent`, `atomic` and `cliMapping`, so they survive into the document |

A `oneOf` in `errorSchema` whose branches each fix one member to a constant may project
OpenAPI's `discriminator` on that member. Two Callables whose names give the same
`operationId` are a generator error.

The following visible operation table is the shared envelope that rule fills in,
using the BDP Markdown OpenAPI notation. Its target is a fixed route. This table is
not yet in the generated catalog: the mount route and a second composition are still
to be added to the generator.

<!-- bdp-operation:start callableInvoke -->
### Operation: callableInvoke

| Field | JSON value |
| --- | --- |
| id | `"callableInvoke"` |
| navigation | `{"role":"fixed-route","path":"bdp/call/{name}"}` |
| methods | `["post"]` |
| request | `"callableInvocation"` |
| response | `"callableResult"` |
| problem | `"callableProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","revision-mismatch","identity-taken","incident-links-exist","idempotency-conflict","idempotency-in-progress","idempotency-expired","callable-not-found","callable-unavailable","callable-error"]` |
| continuation | `"none"` |
| optional | `"Callables1 capability; Write profile for a CallableBatch"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
| `Idempotency-Key` | header | no | `{"type":"string","minLength":1}` | Required on a CallableBatch invocation when the Scope advertises `idempotency`; admitted and not retained otherwise; rejected on a CallableQuery. | — |
<!-- bdp-operation:end callableInvoke -->

<!-- bdp-composition:start callables1 -->
### Composition: callables1

| Field | JSON value |
| --- | --- |
| id | `"callables1"` |
| media | `"application/vnd.bdp.v0.1+json"` |
| capability | `"https://github.com/gastownhall/bdp/capabilities/callables"` |
| version | `"1"` |
| operations | `["callableInvoke"]` |
| responseSchemas | `{"callableInvoke":"callableResult"}` |
| selection | `"The capability advertisement is the selection; no media subtype or discovery profile literal is added. Checking arguments, atomic and idempotency remain normative prose obligations."` |
<!-- bdp-composition:end callables1 -->

## 15. Obsolescence

This edition replaces the protocol outline, the Bead Types and the shared value
shapes of the experimental draft of October 30, 2026, archived at
`specs/history/callables-draft-20261030/`. Its scenarios S1–S6 become the
conformance rows above or the deferred items, its "Open issues" table is closed at
preview depth as stated in §§4–6 and reopened only for what §12 lists, and its
"Depends on" table is replaced by this document's references. The JSON companion,
examples and checker are retired in favor of the descriptor companion and the
extracted feature schema. `experimental/packs.md` keeps its experimental status and
repoints its callable references here.
