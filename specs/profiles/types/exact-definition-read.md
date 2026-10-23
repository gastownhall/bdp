---
status: draft
intended-status: normative
version: "0.1"
---

# Exact Type-definition lookup, candidate version 1

Types-local candidate under [#282](https://github.com/gastownhall/bdp/issues/282),
shared correspondence [#279](https://github.com/gastownhall/bdp/issues/279) and sole
[#59](https://github.com/gastownhall/bdp/issues/59). This makes the selected
[complete exact read obligation](types.md#314-complete-exact-definition-reads)
concrete for common-source review. Sybil's bounded author feedback supports this
binding, not adoption or a Donna ruling. Core/discovery/shared-schema propagation
is separately owned and remains a gate. No runtime, general History or lifecycle
capability is enabled by this draft.

## Discover and select one exact definition

The candidate capability identity is
`https://github.com/gastownhall/bdp/capabilities/type-definition-read`, exact version
`"1"`. Its closed detail contains an absolute HTTP(S) `operation` URL served by the
advertising lookup Scope. No path prefix is prescribed. A future Types-supporting
Scope MUST provide this complete-read obligation; advertising this operation alone
does not claim all Types semantics or grant authorization.

```json
{
  "capabilities": {
    "https://github.com/gastownhall/bdp/capabilities/type-definition-read": {
      "1": { "operation": "https://work.example/acme/definitions/exact" }
    }
  }
}
```

GET and corresponding HEAD take exactly three once-only query members:
`capabilityVersion`, `uri`, `revision`. Version1 requires selector `"1"`, the admitted
absolute HTTP(S) Type identity and a nonempty opaque exact revision token. Decode
form-query components once: encode a literal plus as `%2B`, never reinterpret it as
a delimiter or checkpoint syntax. Literal tokens such as `current` and `unpinned`
remain exact tokens here, not instructions. Alias/local-name/creation-handle,
floating/default/latest, projection, incident, selection and paging forms refuse.
Repeated parameters refuse even if equal. Do not derive the operation URL from the
Type URI or reinterpret ordinary Type property strings as query instructions.

```http
GET /acme/definitions/exact?capabilityVersion=1&uri=https%3A%2F%2Fexample.org%2Ftypes%2Fbeads%2Ftask&revision=task-1 HTTP/1.1
Host: work.example
Accept: application/vnd.bdp.v0.1+json
```

Authenticate/apply non-disclosure, numeric/JSON and ordinary operational request
bounds as applicable, then read the nonempty string selector before interpreting
a future version's other fields. Missing/empty/repeated selection is malformed.
A well-formed unsupported selector receives the feature refusal below without
version1 interpretation or fallback. Supported1 uses the complete closed grammar.
The selector is emitted by a feature-aware client, not a new global CLI version flag.
The operation is read-only, with no execution key or registration/default side effect.

## Complete response and source context

HTTP200 uses the selected v0.1 JSON media and a closed object containing required
`definition` and optional `originScope`. `definition` is the complete requested
Type-definition Bead record; its `id` and `revision` MUST equal the requested exact
pair. Its own metatype affiliation and every captured Link affiliation are exact
pins. Preserve properties, retained schema resources, metadata/provenance presence
and recorded owned Link identities, revisions, endpoints and captures. Do not
synthesize History-required provenance, project with today's rules, substitute
current/nearest state or add an incident aggregate. This is the existing definition
representation inside a lookup wrapper, not another Type descriptor view.

`originScope` carries the original absolute HTTP(S) Scope identity whenever that
source context was recorded. Do not derive it from URI prefixes or insert the
receiving Scope. Unknown intrinsic publication context must not be fabricated;
bootstrap/authority cases requiring known context remain unqualified until supplied.
Origin context is neither a transfer of ownership nor a verified current mutation
binding. [The finite response](exact-definition-read-cases.json) copies a complete
literal definition and its owned Refines capture from [definitions.json](definitions.json),
with explicitly supplied example origin context, not a production bootstrap claim.

The wrapper is **not** an ordinary canonical Resource point response or collection.
It has no `BDP-Resource-Kind` or `BDP-Collection-Kind`. If `service-desc` is returned,
it describes the responding lookup service only; it cannot establish that service
as the owner of `definition.id`. Ordinary canonical Resource mutation binding still
requires its own verified owning-Scope navigation. HEAD has the same selection,
authorization/status semantics and no body; a conditional304 carries no new body.
Response caching/validators remain truthful to the selected representation and
current authorization, not a synthetic replacement revision or ownership witness.

## Narrow interpretation, not implicit History or inventory

Use the exact operation in an explicit interpreting Scope to resolve local,
retained foreign and intrinsic definitions needed for interpretation. Origin outage
does not force network retrieval when the authorized complete retained copy exists.
A miss never authorizes fetch-and-register, alias/default refresh, importing a new
Type, local graph insertion or retargeting its canonical identity.

Traverse the accepted finite dependency closure through separate exact reads of
recorded declarations; no all-closure envelope or live incident adjacency. Track
visited exact pairs for metatype-reference loops; they are distinct from Refines
cycles. A complete child read does not assert that a separately missing parent is
available or that complete interpretation succeeded.

This operation promises no application History, versions listing, Event coverage,
retention floor, Type inventory payload, ordinary product list visibility, public
Type CRUD or lifecycle command. Mere readability grants no registration/default or
creation permission. Generic `show URI@REV` MUST NOT silently fall back here when
application History is unadvertised. Typed-affiliation interpretation may use this
explicit context; an eventual Type CLI/result descriptor must preserve this wrapper
and origin context. No such public command is selected here.

## Refusals and operational bounds

Current whole-definition/owned-state disclosure authorization precedes existence
or reason-specific disclosure. Unknown exact pairs and ordinary nondisclosure use
uniform `resource-not-found`. Malformed/repeated/extra selection uses
`invalid-parameter`. Temporary backend unavailability remains ordinary service
failure, not missing history. Existing erasure/disclosure precedence is preserved;
this does not choose a physical Type-removal lifecycle.

A valid unsupported selector uses request-family HTTP422,
`capability-not-supported`, `retry:"after-state-change"`, this capability identity,
requested `capabilityVersion`, and query `parameter:"capabilityVersion"`. It is a
feature-local carrier; do not reuse atomic batch's capability URI or a JSON body
pointer for this query request. Unknown versions do not grant an absence oracle.

```json
{
  "type": "https://github.com/gastownhall/bdp/problems/request",
  "status": 422,
  "code": "capability-not-supported",
  "retry": "after-state-change",
  "capability": "https://github.com/gastownhall/bdp/capabilities/type-definition-read",
  "capabilityVersion": "2",
  "parameter": "capabilityVersion"
}
```

For positive local knowledge of the required exact retained revision with missing
reconstruction pieces, propose the existing `revision-unretained` Problem and bounded
`missing` shape under **current exact-definition/owned-state disclosure permission**.
The existing64-item diagnostic ceiling/complete flag applies to this reused shape,
not a semantic maximum on definitions or owned Links. No Resource or partial
Resource accompanies it. Current Core restricts revision diagnoses to History;
this Types-local permission/operation exception requires an explicit shared-source
amendment before adoption. It neither imports the full five-diagnosis obligation
nor requires versions, History provenance or general subject-history access. An
unfamiliar token alone is not evidence of loss, pruning, reorganization or tampering.

Complete successful output stays within explicit operational byte/count admission
bounds. Reject an oversized state before accepting its promised interpretation/read
obligation. Configuration tightening preserves promised complete retained reads or
refuses the configuration change. No truncation, pagination of owned captures,
implicit semantic family maximum or alternate current-state success. Ordinary limits
and actual concrete budget/error correspondence require shared qualification.

## Artifact and qualification cutline

[Local candidate grammar](exact-definition-read.schema.json) describes the selected
query, prefix/detail, complete wrapper and feature Problems. It references shared
native record/pin/Problem shapes, not another copied canonical bundle. Its fixed
review input is PR292 `ad6ddd45f4fb35742fbc60be84b0eb6f3b0fd9c1`, schema SHA256
`d9c9822c8abdaae907a966ef076f945043116adb52b94c9c1c71dbaa8c8adf09`.
That dependency is unmerged staging source, not adopted runtime support. Resolve
it from exact local input with network retrieval disabled; schema IDs are not Type
identities or proof of registration. Shape validation cannot enforce actual category,
whole-record completeness, request/result equality, origin authority, authorization,
retention, dispatch, closure traversal or operational admission.

[Cases](exact-definition-read-cases.json) contain grammar examples, exact query
encoding and six **unexecuted** semantic expectations. They do not implement a
lookup, HTTP service, CLI or parser. The existing finite Type checker still owns
its original artifact coverage; additional read-binding checks have separate evidence.
Core/discovery/error/schema propagation, real definition read/closure and permission
qualification, intrinsic publication, actual Types/profile composition and applicable
integration checks remain gates. Existing runtime/serve/Vickie/product/main/Experimental
holds and owner/Event questions remain. No source presence is a feature advertisement.
