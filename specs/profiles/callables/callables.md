---
status: editorial-draft
intended-status: optional-profile
version: "preview-1"
---

# Beads Protocol — Callables

Editorial draft preview-1 · November 4, 2026 · lifted from the experimental draft of October 30, 2026

Callables is the optional capability by which a Scope exposes named,
parameterized operations that are defined as Beads and invoked over BDP. A
**Callable** is a Bead describing one such operation: its help, its declared
parameters, the schema of its result and, in this edition, the service-side
implementation it binds to. A **CallableQuery** is read-only; a
**CallableBatch** mutates. Either can be defined and invoked without any
package. [Core](../core/core.md) supplies identity, records, reads,
authorization, discovery and HTTP; [Write](../write/write.md) supplies the
mutation, allocation and attribution contracts a CallableBatch inherits;
[Types](../types/types.md) supplies the descriptor language of the three
definitions below. The [Issue and Dependency Callables](../../types/issue/callables.md)
are the first operations specified under this profile.

The three definitions are authored as descriptor documents in the
[Type-definition notation](../../formats/markdown-type-definitions.md) under
`descriptors/`, with their properties schemas as sibling documents in the
[Markdown JSON Schema notation](../../formats/markdown-json-schema.md),
`callable-properties.md` and `callable-extern-properties.md`. The wire shapes of
the capability, the directory, the invocation, the result and the problems are
fragments in the Schemas appendix (§13), bundle `callables`. The prose reads
both; it restates neither as JSON.

This is the preview-1 edition selected for the friends-and-family preview pin.
It selects the **extern** implementation form, in which the definition names an
implementation in the provider's registry, and defers stored Query AST and Batch
bodies, parameter binding into bodies, and packaging. Rules marked **preview**
may change in a later edition without a compatibility promise. Packages
(`experimental/packs.md`) remain experimental and depend on this profile, not
the reverse.

## Contents

1. [Discover and select Callables1](#1-discover-and-select-callables1)
2. [Definitions](#2-definitions)
3. [The directory](#3-the-directory)
4. [Invocation](#4-invocation)
5. [Argument admission](#5-argument-admission)
6. [Execution and results](#6-execution-and-results)
7. [Externs and definition closure](#7-externs-and-definition-closure)
8. [Authorization](#8-authorization)
9. [Problems](#9-problems)
10. [CLI correspondence](#10-cli-correspondence)
11. [Conformance rows for preview-1](#11-conformance-rows-for-preview-1)
12. [Deferred](#12-deferred)
13. [Schemas](#13-schemas)
14. [OpenAPI](#14-openapi)
15. [Obsolescence](#15-obsolescence)

## 1. Discover and select Callables1

> **Open for Donna.** This section depends on Write's retained-recovery
> capability, which is proposed and not yet in Write. Whether a Core-only Scope
> may list a CallableBatch is also open; the proposal is that a CallableBatch
> requires Write and a Core-only Scope lists queries only.

| Item | Selected value |
| --- | --- |
| Capability identity | `https://github.com/gastownhall/bdp/capabilities/callables` |
| Exact supported version | JSON member name `"1"` |
| Version-1 detail | Closed object `{"directory": ABSOLUTE_HTTP_URL}` (`callablesCapabilityV1`) |
| Base contract | BDP `"0.1"`; Core required; Write required for Write's own guarantees on a CallableBatch's effects |
| Media | `application/vnd.bdp.v0.1+json` for bodies and successful results; `application/problem+json` for problems |
| Feature schema | `https://github.com/gastownhall/bdp/schemas/callables-v1.schema.json` |

A Scope advertises the capability under Core's `capabilities` map. The
version-1 detail carries the one navigation member, `directory`, an absolute
HTTP(S) URL served for this Scope. There is no `callables` profile literal, no
new required discovery member and no change to Write's closed operation
directory. A Core-only Scope MAY advertise Callables1 and list both kinds. A
CallableBatch under a Scope that does not advertise Write commits its
implementation's effects under the retry semantics its definition states; under
a Scope that advertises Write, Write's allocation, non-reuse and attribution
rules govern those effects; and under a Scope that advertises retained recovery
(Write's optional capability), the `Idempotency-Key` is required and replayed
as §4 states. (**preview**)

Advertisement states support, not authorization. A client that does not
understand the capability ignores it and keeps using base behavior. The
directory, mount and definition addresses are protocol navigation reserved from
Resource and alias allocation under Core's navigation-collision rule; the
conventional spellings `<scope>/bdp/callables` for the directory and
`<scope>/bdp/callables/NAME` for a mount are recommended and not required.
(**preview**)

## 2. Definitions

### 2.1 Identities

Three Bead Types are published under `https://github.com/gastownhall/bdp/types/callable/`:

| Identity suffix | Exact revision | Own affiliation | Refines | `abstract` | Descriptor |
| --- | --- | --- | --- | --- | --- |
| `callable` | `callable-preview-1` | `type-system/bead-type` | none | `true` | [`descriptors/callable.md`](descriptors/callable.md) |
| `callable-query` | `callable-query-preview-1` | `type-system/bead-type` | `callable` at `callable-preview-1` | absent | [`descriptors/callable-query.md`](descriptors/callable-query.md) |
| `callable-batch` | `callable-batch-preview-1` | `type-system/bead-type` | `callable` at `callable-preview-1` | absent | [`descriptors/callable-batch.md`](descriptors/callable-batch.md) |

A definition is an ordinary Bead affiliated with `callable-query` or
`callable-batch`, readable by point read and present in the Bead inventory with
`type` selection. Its properties object is the definition. The three Types are
carried under Core alone, as [Issue and Dependency Types](../../types/issue/issue.md) §1
describes for that package; a Scope advertising Types1 serves them as definition
Beads unchanged.

### 2.2 callable — Bead Type

**Meaning and use.** The common contract of a named operation: help, declared
parameters, the result schema and an optional CLI projection. Abstract: a
definition affiliates with one of the two concrete refinements, never with
`callable` itself. A Callable's operation identity is independent of its CLI
spelling and of the mount that invokes it.

**Conforms to.** None within this profile; it is the parent of `callable-query`
and `callable-batch`.

**Properties** (`callable-properties.md`, root). The root is open so that the
refinements add their implementation member.

Other fields: allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "cliMapping" | cliMapping | no | callable | "Declarative CLI projection; it chooses no command route and grants nothing." |
| "description" | text | yes | callable | "Standard help for the operation; an empty string is admitted and differs from absence." |
| "parameters" | array of parameter | yes | callable | "Declared named arguments; an empty array is admitted; names are distinct within one definition." |
| "result" | valueSchema | no | callable | "Schema of the invocation result; absent means any JSON value. (preview: new in this edition)" |

**Owned outgoing Link Types.** None.

### 2.3 callable-query and callable-batch — Bead Types

**Meaning and use.** `callable-query` is a read-only operation: its
implementation observes and does not mutate, and invocation changes no Resource,
alias or retained state. `callable-batch` is a mutating operation: its
implementation commits its effects as one atomic outcome, with Write's
allocation, non-reuse and attribution rules when Write is advertised, and with
the retry semantics the definition states (§4).

**Conforms to.** `callable`, through one exact Refines declaration each.
Concrete: `abstract` is absent.

**Properties** (`callable-extern-properties.md`, root), conjoined with the
`callable` properties on the same object under Types' refinement rule. A stored
`body` is refused in preview-1: the body form, a selected Query AST or a literal
Batch request, and the body-XOR-extern rule return in a later edition.
(**preview**)

Other fields: allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "extern" | externBinding | yes | callable-query, callable-batch | "The implementation this definition invokes." |

**Owned outgoing Link Types.** None.

### 2.4 Value shapes

These are property value shapes, not Bead Types; each is a named definition of
the sibling schema documents.

**parameter** — one declared argument. Names are distinct within one
definition; a required parameter carries no default.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "default" | any | no | parameter | "The value substituted for an omitted argument; it must satisfy schema. Omission of this member is distinguishable from an explicit null default." |
| "description" | text | no | parameter | "Parameter help, reused by CLI mappings." |
| "name" | text | yes | parameter | "Nonempty exact argument name." |
| "required" | boolean | no | parameter | "Whether the argument must be supplied; false when absent." |
| "schema" | valueSchema | yes | parameter | "The argument's value schema; the selected parameter decision of October 30, 2026." |

**valueSchema** — an embedded JSON Schema Draft 2020-12 value, an object or a
boolean. It validates one argument or one result; it establishes no Resource
kind, Type membership or authorization.

**cliMapping** — declarative flag and positional projection for clients. It
chooses no command route and grants nothing; duplicate flags or positions refuse
registration.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "flags" | array of flagMapping | no | cliMapping | "Flag spellings mapped onto parameters." |
| "positionals" | array of positionalMapping | no | cliMapping | "Positions mapped onto parameters." |

**flagMapping** — maps one or more CLI flag spellings onto a declared parameter.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "names" | array of text | yes | flagMapping | "Distinct nonempty flag spellings, such as --limit and -l; at least one." |
| "parameter" | text | yes | flagMapping | "The nonempty name of a declared parameter of the same definition." |

**positionalMapping** — maps one zero-based CLI position onto a declared
parameter.

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "parameter" | text | yes | positionalMapping | "The nonempty name of a declared parameter of the same definition." |
| "position" | integer | yes | positionalMapping | "Zero-based argument position; at least 0." |

**externBinding** — the service-side implementation a definition binds to. The
binding is an opaque name in the provider's registry; it freezes no behavior by
itself (§7).

Other fields: not allowed

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "binding" | text | yes | externBinding | "Nonempty name in the provider's implementation registry." |
| "version" | text | no | externBinding | "Nonempty informational label distinguishing implementation editions; no ordering or compatibility meaning." |

### 2.5 Registration admission and a worked example

Registration-time admission refuses duplicate parameter names, a flag or
positional mapping naming an undeclared parameter, duplicate flag names across
mappings, duplicate positions, a `default` that fails its `schema`, and
`required` together with `default`. These are semantic checks the structural
schema cannot express.

Informative: a complete definition Bead, the `claimIssue` of the
[Issue and Dependency Callables](../../types/issue/callables.md), as a point read
of its canonical URL returns it. The record is an ordinary Bead; the definition is
its properties object; `parameters` derive from that document's
`claimIssueArguments` schema one parameter per property, and `result` names its
`claimResult` schema.

```json
{
  "id": "https://beads.example/acme/callables/claim-issue",
  "type": "https://github.com/gastownhall/bdp/types/callable/callable-batch",
  "revision": "r1",
  "properties": {
    "description": "Claim an Issue for the invocation's actor; a re-claim by the holder is idempotent.",
    "parameters": [
      {
        "name": "issue",
        "schema": {"type": "string", "minLength": 1},
        "required": true,
        "description": "The Issue the operation acts on, as a Scope-relative path or absolute URL."
      }
    ],
    "result": {"$ref": "https://github.com/gastownhall/bdp/schemas/issue-callables-preview-1.schema.json#/$defs/claimResult"},
    "extern": {"binding": "issueops.Claimer"}
  },
  "metadata": {}
}
```

The directory entry that makes it callable, the invocation and the result then
read, in order:

```json
{"claimIssue": {"definition": {"uri": "https://beads.example/acme/callables/claim-issue", "revision": "r1"}, "invoke": "https://beads.example/acme/bdp/callables/claimIssue"}}
```

```json
{"arguments": {"issue": "bd-a1b2"}, "revisionProvenance": {"actor": {"id": "sam", "basis": "writer-supplied"}}}
```

```json
{"callable": {"uri": "https://beads.example/acme/callables/claim-issue", "revision": "r1"}, "changed": true, "result": {"issue": {"bead": {"id": "https://beads.example/acme/bd-a1b2", "type": "https://github.com/gastownhall/bdp/types/issue/task", "revision": "r9", "properties": {"title": "Specify BDP mutation", "status": "in_progress", "priority": 2, "assignee": "sam"}, "metadata": {}}, "observations": {"lease_expires_at": "2026-11-05T21:10:00Z"}, "dependency_count": 0, "dependent_count": 1, "comment_count": 0}, "already_claimed": false}}
```

## 3. The directory

In plain terms, the directory is the list of what this Scope lets a client
call. A client does not guess where to send an invocation, any more than it
guesses the URL of Write's `createBead`: it reads the capability detail,
follows `directory`, and finds each callable's name beside the exact definition
revision it will execute and the URL that invokes it. Write's operation
directory does the same for the mutation verbs; this is the callables'
counterpart, and it is the only place a name becomes callable.

`GET` of the advertised `directory` returns the closed `callableDirectory`
object, for example:

```json
{
  "callables": {
    "listReadyWork": {
      "definition": {"uri": "https://beads.example/acme/callables/list-ready-work", "revision": "r3"},
      "invoke": "https://beads.example/acme/bdp/callables/listReadyWork"
    }
  }
}
```

| Member | Meaning |
| --- | --- |
| `callables` | Object mapping each invocable name to its entry; an empty object means nothing is invocable |
| `callables[NAME].definition` | Pinned Reference to the exact definition revision the name is bound to |
| `callables[NAME].invoke` | Absolute HTTP(S) mount URL that invokes it |

`NAME` is one nonempty safe segment, compared exactly, unique within the
directory. The directory is the authority for what is invocable: a definition
Bead's presence in the Scope, a registered Type and an available implementation
are separate facts, and only a directory entry makes the operation callable. A
name bound to a definition revision stays bound to it until the provider changes
the directory; changing the directory never reinterprets a retained invocation.

The directory allows `GET` and `HEAD` and answers other methods with a bodyless
405 and `Allow: GET, HEAD`. It carries `Cache-Control: private, no-store` in
preview-1. (**preview**)

## 4. Invocation

An invocation is `POST` to a mount with the closed `callableInvocation` body,
for example:

```json
{
  "arguments": {"assignee": "sam", "limit": 10},
  "definition": {"uri": "https://beads.example/acme/callables/list-ready-work", "revision": "r3"}
}
```

| Member | Required | Meaning |
| --- | --- | --- |
| `arguments` | yes | Object keyed by parameter name; `{}` when the definition declares no parameters |
| `definition` | no | Pinned Reference to the definition revision the client parsed; a mismatch with the directory's binding is refused as `callable-revision-mismatch` |
| `revisionProvenance` | no, CallableBatch only | Write's attribution input, carried onto every revision the batch commits; refused on a CallableQuery |

The mount supplies the operation; `operation`, `name` and a body-level key are
not invocation members. Unknown members, duplicate JSON members and invalid
strings are refused as `malformed-request`. `Content-Type` declares the base
media type; a missing or generic `application/json` body is refused with 415
`unsupported-media-type` before interpretation, as Write requires for mutations
and as this profile requires for both kinds. When the Scope advertises retained
recovery, a CallableBatch invocation carries exactly one `Idempotency-Key` HTTP
field under Write's idempotency rules and a replay returns the original result.
When it does not, the field is admitted and not retained: a repeated invocation
follows the retry semantics the definition states (a re-claim by the holder is
idempotent, a second removal is `removed: false`, a re-close reports
`already_closed`), and a client that needs at-most-once execution uses a
revision guard, supplies identities, or chooses a Scope with retained recovery.
A CallableQuery invocation carries no key and is refused as `malformed-request`
if it does. (**preview**)

A CallableQuery mount additionally admits `GET` with one query member,
`arguments`, holding the percent-encoded JSON argument object, when the provider
chooses to support it; a provider that does not answers `GET` with a bodyless
405 and `Allow: POST`. A CallableBatch mount admits `POST` only. `GET` of a
definition Bead's canonical URL is always the ordinary record read and never an
invocation; the query-string invocation mode at the canonical URL selected in the
experimental draft is deferred, because mounts make it unnecessary for this
edition. (**preview**)

Success is HTTP 200 with the `callableResult` body (§6), `Cache-Control:
private, no-store`, and no `ETag` or `Location`. Failure is the applicable
Problem at its status (§9).

## 5. Argument admission

The provider admits `arguments` against the bound definition revision before
execution:

- A member whose name is no declared parameter is refused.
- A declared parameter that is `required` and neither supplied nor defaulted is
  refused.
- An omitted parameter with a `default` is supplied that value; an omitted
  parameter without one is absent from the executed arguments, and the
  implementation sees absence, never a fabricated `null`.
- `null` is a supplied value and is validated like any other.
- Every supplied value is validated against the parameter's `schema`; failure is
  refused.
- A value whose schema says it is a URI or Reference is validated as a value
  only; admission acquires nothing and establishes neither Resource kind nor
  Type membership. Resolution, if any, is the implementation's and follows the
  ordinary authorization and non-disclosure rules.

Every refusal above is `validation-failed` with a diagnostic naming the
parameter. Admission uses Core's JSON value model: exact decimal numbers, no
duplicate names, Unicode scalar values.

## 6. Execution and results

A CallableQuery executes within one read context under the request's
Authorization View and returns its result. A CallableBatch executes under
Write's atomic owner: all of its effects commit or none, allocation and
non-reuse follow Write where Write is advertised, and the retained key state
records the outcome where retained recovery is advertised.

Success returns the closed `callableResult`, for example:

```json
{
  "callable": {"uri": "https://beads.example/acme/callables/list-ready-work", "revision": "r3"},
  "result": {"items": [], "has_more": false}
}
```

| Member | Meaning |
| --- | --- |
| `callable` | Pinned Reference to the exact definition revision executed |
| `result` | Any JSON value, valid against the definition's `result` schema when one is declared |
| `changed` | CallableBatch only, required: `true` when the batch committed any durable effect, else `false`; it promises nothing about revisions, and an implementation may commit a durable effect that mints none |

The provider validates `result` against the declared schema before returning
it. A CallableBatch whose implementation produced a result that fails the schema
or exceeds the advertised representation bound is rolled back and refused, as
`validation-failed` or `limit-exceeded`; the profile never commits and then
truncates or reports an unknown success. (**preview**) Under retained
recovery, a replay of a CallableBatch key returns the original `callableResult`
under Write's rules, without re-executing and without re-resolving defaults,
definitions or implementations.

Resource records inside `result` are ordinary records when the implementation
chooses to return them; nothing in this profile makes a result a collection,
grants a cursor or issues a revision. A query that pages does so through its
own declared parameters and result shape.

## 7. Externs and definition closure

The provider promises, for each directory entry:

- the bound definition revision is retained and served for as long as the entry
  exists, and the `callable` member of every result names it;
- `extern.binding` resolves in the provider's registry to one implementation
  whose input is the admitted arguments of §5 and whose output satisfies the
  declared `result`; the registry is the provider's own and is not a Bead;
- an entry whose binding does not resolve is refused as `binding-unavailable`,
  never served as a no-op, a stale success or an unknown Bead;
- the implementation of a CallableQuery observes and does not mutate; the
  implementation of a CallableBatch mutates only within the request's atomic
  outcome.

Preview-1 pins the definition and leaves implementation identity to the
binding name and the informational `extern.version`. A client that cached a
definition and its `cliMapping` guards its invocation with `definition`; on
`callable-revision-mismatch` it re-reads the directory and the definition. A
retained successful key replays its original result even after the definition or
the implementation changed. The experimental draft's remaining closure
questions, in particular pinning schema resources and implementation editions
inside the result, are deferred (§12).

## 8. Authorization

A CallableQuery requires read authorization for the Scope under Core; a
CallableBatch requires write authorization under Write. An implementation MAY
require more and refuses with `forbidden`. A directory entry, a readable
definition and a CLI projection grant nothing. Non-disclosure follows Core: an
unauthorized caller receives the same `callable-not-found` for an entry it may
not see as for a name that does not exist. (**preview**)

## 9. Problems

Callables uses Core's and Write's applicable codes, families, non-disclosure and
retry meanings, with these additions. A family suffix means
`https://github.com/gastownhall/bdp/problems/SUFFIX`.

| Code | Family suffix | Status | Retry | Condition |
| --- | --- | --- | --- | --- |
| `callable-not-found` | `not-found` | 404 | `after-state-change` | No visible directory entry for the mount |
| `callable-revision-mismatch` | `conflict` | 409 | `after-state-change` | The invocation's `definition` guard does not match the entry's binding |
| `binding-unavailable` | `unavailable` | 503 | `after-state-change` | The entry's `extern.binding` resolves to no implementation |
| `callable-refused` | `conflict` | 409 | `after-state-change` | The implementation refused for a domain reason that maps to no Core or Write code; the required `reason` member carries the implementation's token |

A Problem answered by the directory or a mount is a Core or Write Problem, or
one carrying a code above with `type`, `code` and `retry` required and, for
`callable-refused`, a nonempty `reason`; the shapes are `callableProblemMembers`
and `callableProblem` in §13.

Reused as they stand: `malformed-request` (carrier syntax, a key on a query),
`invalid-parameter` (`GET` query members), `unsupported-media-type`,
`validation-failed` (argument admission, result validation),
`unauthenticated`, `forbidden`, `resource-not-found` (a Resource named by an
argument that the implementation could not resolve), `request-too-large`,
`limit-exceeded`, `rate-limited`, `temporarily-unavailable`, and Write's
`idempotency-conflict`, `idempotency-in-progress`, `idempotency-expired`,
`revision-mismatch`, `identity-taken` and `incident-links-exist` for the effects
a CallableBatch commits.

An implementation maps each of its outcomes to exactly one code under this
rule: a Core or Write code whose condition it meets, else `callable-refused`
with `reason`. `callable-refused` MAY carry RFC 9457 extension members the
implementation defines; `reason` is required and is a nonempty token compared
exactly. `binding-unavailable` is already a member of Write's problem-code
enumeration and keeps its meaning here. (**preview**: the `callable-refused`
carrier is the one place a native tracker's refusal vocabulary crosses the wire;
a later edition may select families for the common ones.)

## 10. CLI correspondence

The canonical client invokes a callable with the selected direct form, client
options before the verb and the callable's own arguments after it:

```text
bdp [client options] call NAME [callable arguments]
```

The client reads the directory, follows the entry's `definition`, and projects
`cliMapping` flags and positionals onto `arguments`, preserving omission,
`null`, defaults and the declared value schemas. A generic `--arguments JSON`
input supplies the whole object when no mapping fits; `--help` after `NAME`
prints `description` and the parameters without invoking. A CallableBatch
invocation mints the `Idempotency-Key` as the client does for Write's
operations when the Scope advertises retained recovery. The client never infers
an invocation from a Bead URL and never invokes a name absent from the
directory. The CLI design document gains a `call` section and a mismatch row,
`CLI-09`, open until that section lands.

## 11. Conformance rows for preview-1

| Row | Expectation |
| --- | --- |
| CB-1 | Discovery advertises the capability at version `"1"` with a `directory` URL that serves `callableDirectory` |
| CB-2 | Each entry's `definition` resolves to a Bead affiliated with `callable-query` or `callable-batch` whose properties satisfy §§2.2–2.4 |
| CB-3 | `POST` to an entry's mount with valid `arguments` returns 200 and a `callableResult` whose `callable` equals the entry's `definition` |
| CB-4 | An unknown argument member is refused as `validation-failed` naming it |
| CB-5 | A missing required parameter is refused as `validation-failed`; an omitted defaulted parameter is executed with its default |
| CB-6 | `POST` to a mount with no directory entry is `callable-not-found` |
| CB-7 | A `definition` guard naming another revision is `callable-revision-mismatch` |
| CB-8 | Under retained recovery, a CallableBatch `POST` without `Idempotency-Key` is refused and a replay with the same key returns the original `callableResult` and commits nothing further; without it, a repeated invocation follows the definition's stated retry semantics |
| CB-9 | A CallableQuery invocation leaves every Resource revision in the Scope unchanged |
| CB-10 | An entry whose binding is withdrawn by the provider answers `binding-unavailable` |
| CB-11 | A CallableBatch result that fails the declared `result` schema is rolled back and refused |
| CB-12 | `GET` of a definition's canonical URL returns the ordinary Bead record |

## 12. Deferred

Not selected in preview-1, carried from the experimental draft:

- Stored bodies: a CallableQuery implemented by a selected Query AST and a
  CallableBatch implemented by a literal atomic-batch request, with the
  body-XOR-extern rule and a versioned parameter-binding form (CALL-O1's
  binding half).
- The query-string invocation mode at a definition's canonical URL and its
  control-key grammar.
- Result carriers beyond one JSON value: paged results, streamed results,
  collection-kind metadata.
- Definition closure beyond the pinned revision: schema resources and
  implementation editions witnessed in the result (CALL-O3's remainder).
- Registration, mount lifecycle, catalog mutation and packaging
  (`experimental/packs.md`), including installed command trees and shortcuts.
- A family vocabulary for common domain refusals now carried by `callable-refused`.

## 13. Schemas

The following markdown-json-schema/0.6 fragments, bundle `callables`, are the
wire shapes the prose above reads from; `scripts/spec-schema-fragments.mjs`
gains the `callables` bundle and extracts them into
`specs/profiles/callables/callables-v1.schema.json`, the feature schema of §1,
beside the Types feature schema. References into the common bundle use its
full schema identity, as the Types feature schema does. The three Types'
property schemas are the descriptor companions `callable-properties.md` and
`callable-extern-properties.md`, not members of this bundle.

<!-- bdp-schema:start callablesCapabilityV1 bundle=callables -->
### Schema: "callablesCapabilityV1"

Value: object

Other fields: not allowed

Required order: ["directory"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Version-1 detail of the Callables capability: the one navigation member a client follows to learn what is invocable." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "directory" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteHttpUrl" | yes | — | "Absolute HTTP(S) URL of the callable directory served for this Scope." |
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

<!-- bdp-schema:start callableDirectoryEntry bundle=callables -->
### Schema: "callableDirectoryEntry"

Value: object

Other fields: not allowed

Required order: ["definition","invoke"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One invocable name's binding: the exact definition revision it is bound to and the mount that invokes it." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "definition" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/pinnedReference" | yes | — | "Pinned Reference to the exact definition revision the name is bound to." |
| "invoke" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteHttpUrl" | yes | — | "Absolute HTTP(S) mount URL that invokes the Callable." |
<!-- bdp-schema:end callableDirectoryEntry bundle=callables -->

<!-- bdp-schema:start callableDirectory bundle=callables -->
### Schema: "callableDirectory"

Value: object

Other fields: not allowed

Required order: ["callables"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The authority for what is invocable in a Scope: a closed map from invocable name to its binding. An empty map means nothing is invocable." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "callables" | schema | yes | — | "Map from name, one nonempty safe segment compared exactly, to its directory entry." |

#### Advanced

```json-schema
{
  "properties": {
    "callables": {
      "type": "object",
      "propertyNames": {"type": "string", "minLength": 1, "pattern": "^[^/]+$"},
      "additionalProperties": {"$ref": "#/$defs/callableDirectoryEntry"}
    }
  }
}
```
<!-- bdp-schema:end callableDirectory bundle=callables -->

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
| "arguments" | object | yes | — | "Object keyed by parameter name; an empty object when the definition declares no parameters." |
| "definition" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/pinnedReference" | no | — | "The definition revision the client parsed; a mismatch with the directory's binding is callable-revision-mismatch." |
| "revisionProvenance" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revisionProvenanceInput" | no | — | "Write's attribution input, admitted on a CallableBatch invocation and carried onto every revision the batch commits; refused on a CallableQuery." |
<!-- bdp-schema:end callableInvocation bundle=callables -->

<!-- bdp-schema:start callableResult bundle=callables -->
### Schema: "callableResult"

Value: object

Other fields: not allowed

Required order: ["callable","result"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The closed success body of an invocation: the exact definition revision executed, the result value, and for a CallableBatch whether anything committed." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "callable" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/pinnedReference" | yes | — | "Pinned Reference to the exact definition revision executed." |
| "changed" | boolean | no | — | "CallableBatch only, then required: true when the batch committed any Resource, alias or retained-state effect, else false." |
| "result" | any | yes | — | "Any JSON value, valid against the definition's result schema when one is declared." |
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
| "code" | schema | yes | — | "One of the four codes this profile adds." |
| "reason" | schema | no | — | "Required with callable-refused: the implementation's nonempty refusal token, compared exactly." |
| "retry" | schema | yes | — | "Always after-state-change for these four codes." |
| "type" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteUri" | yes | — | "The BDP problem-family URI." |

#### Advanced

```json-schema
{
  "properties": {
    "code": {"enum": ["callable-not-found", "callable-revision-mismatch", "binding-unavailable", "callable-refused"]},
    "reason": {"type": "string", "minLength": 1},
    "retry": {"const": "after-state-change"}
  },
  "if": {"properties": {"code": {"const": "callable-refused"}}},
  "then": {"required": ["reason"]}
}
```
<!-- bdp-schema:end callableProblemMembers bundle=callables -->

<!-- bdp-schema:start callableProblem bundle=callables -->
### Schema: "callableProblem"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A Problem answered by the directory or a mount: a Core or Write Problem, or one carrying a code this profile adds." |

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

The following visible operation tables are the authoring source for the generated
catalog, using the BDP Markdown OpenAPI notation. Targets are navigated URLs: the
directory from the capability detail, the mounts from the directory. These
tables are not yet in the generated catalog: the navigation role
`capability-detail-member` and a second composition are still to be added to
the generator.

<!-- bdp-operation:start callableDirectory -->
### Operation: callableDirectory

| Field | JSON value |
| --- | --- |
| id | `"callableDirectory"` |
| navigation | `{"role":"capability-detail-member","capability":"https://github.com/gastownhall/bdp/capabilities/callables","version":"1","member":"directory"}` |
| response | `"callableDirectory"` |
| methods | `["get","head"]` |
| problem | `"readProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable"]` |
| continuation | `"none"` |
| optional | `"Callables1 capability"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end callableDirectory -->

<!-- bdp-operation:start callableInvoke -->
### Operation: callableInvoke

| Field | JSON value |
| --- | --- |
| id | `"callableInvoke"` |
| navigation | `{"role":"callable-directory-member","member":"invoke"}` |
| methods | `["post"]` |
| request | `"callableInvocation"` |
| response | `"callableResult"` |
| problem | `"callableProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","revision-mismatch","identity-taken","incident-links-exist","idempotency-conflict","idempotency-in-progress","idempotency-expired","callable-not-found","callable-revision-mismatch","binding-unavailable","callable-refused"]` |
| continuation | `"none"` |
| optional | `"Callables1 capability; Write profile for Write's guarantees on a CallableBatch"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
| `Idempotency-Key` | header | no | `{"type":"string","minLength":1}` | Required on a CallableBatch invocation when the Scope advertises retained recovery; admitted and not retained otherwise; refused on a CallableQuery. | — |
<!-- bdp-operation:end callableInvoke -->

<!-- bdp-composition:start callables1 -->
### Composition: callables1

| Field | JSON value |
| --- | --- |
| id | `"callables1"` |
| media | `"application/vnd.bdp.v0.1+json"` |
| capability | `"https://github.com/gastownhall/bdp/capabilities/callables"` |
| version | `"1"` |
| operations | `["callableDirectory","callableInvoke"]` |
| responseSchemas | `{"callableDirectory":"callableDirectory","callableInvoke":"callableResult"}` |
| selection | `"The directory URL in the capability detail and the mount URLs in the directory are the selection; no media subtype or discovery profile literal is added. Admission, atomic execution, result validation and retained recovery remain normative prose obligations."` |
<!-- bdp-composition:end callables1 -->

## 15. Obsolescence

This edition replaces the protocol outline, the Bead Types and the shared value
shapes of `experimental/callables.md` (October 30, 2026); its scenarios S1–S6
become the conformance rows above or the deferred items, its "Open issues" table
is closed at preview depth as stated in §§5–7 and reopened only for what §12
lists, and its "Depends on" table is replaced by this document's references.
`experimental/callables/` (the JSON companion, examples and checker) is retired
in favor of the descriptor companions and the extracted feature schema.
`experimental/packs.md` keeps its experimental status and repoints its callable
references here.
