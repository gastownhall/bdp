---
status: draft
intended-status: normative
version: "0.1"
---

# Optional atomic batch, version 1

Paired CLI-first [batch source](../../../docs/cli-design/atomic-batch.md) under
[#152](https://github.com/gastownhall/bdp/issues/152) and sole #59. The selected
v0.1 contract, [object edits](object-edits.md), [affiliations](../core/affiliations.md)
and ordinary guards/native constraints apply. This is a retained candidate feature,
not a dependency on Transactional/replica facilities or adoption of their old schema.
Event D1/D2/encoding, actual Types/profile composition and multi-operation induced-
owner revision allocation remain adoption gates. No example selects those policies.

## Discover and explicitly select

Capability identity is `https://github.com/gastownhall/bdp/capabilities/atomic-batch`.
Exact version `"1"` occupies its generic capability-version map. Its closed detail
object requires `operation` (absolute HTTP(S) POST target in the owning Scope) and
`operations` (a nonempty unique subset of the six CRUD discriminators). Optional
positive integer `maximumOperations` and `maximumResultBytes` advertise bounds.
This capability extends retained Write without waiving its ordinary singleton
obligations. Batch support is explicit, never inferred from individual CRUD, and
conveys no authorization.
Unknown capability/version entries remain ignorable for base operations.

```json
{
  "capabilities":{
    "https://github.com/gastownhall/bdp/capabilities/atomic-batch":{
      "1":{
        "operation":"https://work.example/acme/commands/atomic",
        "operations":["createBead","updateBead","deleteBead","createLink","updateLink","deleteLink"],
        "maximumOperations":100
      }
    }
  }
}
```

This is a discovery fragment, not final profile discovery. Follow the advertised
URL; do not infer a path or require a public receipt/replica endpoint. Requests use
the selected v0.1 JSON media and require `capabilityVersion:"1"`. It is a rejectable
body discriminator, never an ignorable header/media parameter. No implicit version
or downgrade. The concrete request is exactly `capabilityVersion` plus a nonempty
`operations` array, with no per-member key or carrier-wide provenance override.

`atomicBatchSelection` validates only the prefix object/nonempty string selector,
not a complete request. A missing/nonscalar/empty selector is malformed. A valid
unknown version on a new invocation receives the capability refusal without
interpreting that version's remaining fields; retained-key handling below takes
precedence. A supported version uses its complete closed request grammar;
unknown fields/names or invalid ordinary values are not silently ignored. Future
versions must explicitly select added semantics; existing strings and handles stay literal.

## Six ordinary records, always atomic

Version 1 recognizes exactly `createBead`, `updateBead`, `deleteBead`, `createLink`,
`updateLink`, `deleteLink`. Each uses the shared ordinary member fields, including
whole Type input, object replacement/patch exclusivity, guards and operation-local
provenance. Only creates admit `name`; no alias/read/set operation is a member.
Unknown names, including older deferred set-write names, are malformed in this
selected version; their inherited definitions do not make them version 1 operations.
A valid recognized CRUD omitted from the advertised subset is unsupported instead.

One request has one Scope, principal, selected contract/capability and key. Every
admitted batch commits all effects and its durable terminal outcome atomically,
or no Resource or owned-state effects. There is no supported prefix,
skipping, non-atomic option, implicit chunking or subprocess loop over independent
commits. Syntax, authorization, guards, input/path policies, exact Reference
resolution and ordinary native constraints retain their specified checks. Applicable
final-atomic-graph allowances under Types are retained; temporary endpoint-pair/arity
invalidity may be repaired, but it does not waive other admission duties.

Names match the existing local-name grammar, are unique and bind identities of
prior creations. Unknown/forward/wrong-kind handles refuse the entire request.
No handle in Type input, caller-assigned ID or revision position; an explicitly
pinned endpoint may use a prior Bead handle plus a literal pin subject to applicable
admission. Property strings are ordinary data. Allocation and successful bindings
are durable only with the atomic outcome; a rolled-back creation leaves no usable
committed handle. A creation/deletion pair may still report the allocated identity
in its committed ordered results. No query/result-path/current-revision capture.

An authority bounds input and the complete inline outcome. It checks the staged
result budget before effects commit; excess refuses the whole request with the
ordinary limit Problem. No truncated results, public pages or commit-then-discover-
that-the-outcome-cannot-be-recorded behavior. Ordinary configured limits apply even
when not advertised. Advertised feature bounds constrain new admission, not a
reason to reclassify retained success. During promised detail retention, ordinary
reconfiguration must preserve recovery of the original request/result under its
admitted bounds; temporary inability is a service failure. Request and result
budgets must support at least one admitted operation, and the service MUST NOT advertise a capability it cannot implement.

## Refusal and admission order

Existing authentication, non-disclosure, request bounds, selected-media and numeric/
JSON admission rules still apply. Then:

1. Read the selector; for implemented version 1 validate the complete carrier and
   member syntax and static declaration/slot-kind checks; do not reevaluate live
   target existence, guards, aliases or Type defaults before retained-key handling.
   Defer unsupported-version refusal until retained-key handling; do not interpret its unknown body.
2. In the shared principal/logical-Scope key namespace, resolve retained request
   identity/outcome or conflict before current support admission. Current support
   changes cannot re-execute, reclassify or erase an earlier disposition. Retain
   enough comparison/witness and result-projection information for promised replay
   even if execution support is withdrawn. Inability to perform that comparison is
   a truthful service failure, never permission for fresh admission. Retained output
   disclosure still uses current authorization; it is not a new write.
3. For a new invocation, check capability version and every recognized member's
   support, reporting the first unsupported operation in request order. A well-
   formed unknown version refuses here without interpreting its body. No key is
   durably claimed and no effect occurs from this preflight refusal. Malformed
   syntax, forbidden access and temporary unavailability are separate diagnoses.
4. Admit the new group durably, stage/validate its atomic effects, and commit its
   terminal decision, identities, required facts and result together. No client
   disconnect decides the outcome. An admitted validation failure has no partial
   effects and follows ordinary failed-outcome retention; transient in-flight state
   cannot leave committed effects behind an unknown successful key.

Capability refusal uses `capability-not-supported`, request family, HTTP 422,
`retry:"after-state-change"`, capability URI, requested `capabilityVersion` and
`pointer:"/capabilityVersion"`. Recognized disabled CRUD uses the same family/status/
retry with `operation-not-supported`, requested `operation`, and pointer
`/operations/I/operation`. Both are closed feature-specific Problems; ordinary
Problems use their existing forms, not a new receipt failure carrier.

```json
{
  "type":"https://github.com/gastownhall/bdp/problems/request",
  "status":422,
  "code":"operation-not-supported",
  "retry":"after-state-change",
  "operation":"createLink",
  "pointer":"/operations/1/operation"
}
```

HTTP status agrees with any supplied Problem status. In-flight uses the existing
retryable `idempotency-in-progress` Problem or bounded waiting, not a public pending
Resource. No failure authorizes generic JSON, a fresh key or another carrier as an
automatic fallback. A lost/error response may leave original effects unknown.

## Inline results and changed facts

HTTP 200 returns `atomicBatchResult`: required selector 1, boolean `changed`, and a
nonempty ordered `results` array. Each entry corresponds to exactly one request
member in order, with zero-based `operationIndex`, the operation discriminator and
create `operationName` when supplied. Create/update returns the complete direct
Resource postimage, without an optional incident-Link aggregate; delete returns
its final live deleted identity. Outcome must
match operation/kind. The applicable `source`/`sourceRevision` pair follows the
common pre-OR-post ownership rule, including ownership exit and owned-Link no-op.

Ordinary Resource CRUD `mutationResultMembers` now also requires boolean `changed`:
create/delete true, update true exactly for an effect after ordinary checks. On
retained replay these flags report the original decision, not a new write by this
delivery. Alias results remain distinct and unchanged. Native postimages cover each
explicit transition, not a later normalized final state. Two A→B→A updates are not collapsed.
Secondary owner tokens are the actual induced context under the common ownership
contract, never a made-up shared revision. Exact induced-owner allocation across
multiple members remains the stated Types integration gate; do not infer counts
or intermediate owner snapshots from this result carrier.

Aggregate `changed` is the OR of member flags. Effectful results require nonempty
opaque `transaction`, unique within the logical Scope and shared by that batch's
required committed facts. It conveys correlation, not a receipt URL, Scope epoch/
position, total replica order or snapshot promise. All-no-op succeeds durably with
false, no transaction and no facts/effects from this batch; other concurrent events
are not ruled out. Provenance alone never forces a change. A rendering failure
cannot alter the committed result or imply rollback.

## Request identity and durable recovery

A whole batch has one ordinary idempotency key. The namespace is shared across
mutation carriers; selected specification/capability version and carrier semantics
are part of identity. Version 1 batch versus singleton is deliberately a different
execution context, even with one equal member: reusing a key conflicts, never starts
a separately namespaced duplicate. This differs from inherited v0 Transactional
cross-carrier equivalence and is an explicit selected-contract choice.

Within this batch context, normalize ordinary JSON values/references and ignore
object member order as specified. Preserve operation/patch/array order, field presence,
replacement versus patch, authored Type intent, guards/provenance and original
resolution witnesses. Creation labels are presentation, normalized to creator slots,
not independent identities. A retained replay with equivalent renamed labels projects
`operationName` from the requesting create at the unchanged index; underlying
identities/outcomes/transaction and the original alias/Type witnesses do not change.
A renamed retained projection exceeding its originally admitted output budget
may refuse without truncating, forgetting the original success or reexecuting;
serving the original frozen request remains subject to its promised retention. No freshly allocated ID/default, current alias target or new file value reexecutes a key.

The authority durably records all effects, allocated identities, original resolution
witnesses, required facts and successful outcome in one atomic decision or equivalent
recoverable mechanism. A successful no-op also retains compact anti-reexecution state:
forgetting it could execute effects against later state. Bulky result retention is
bounded under ordinary published retention; compact successful-key evidence outlives
it in the same logical Scope. Ordinary restart/failover or capability withdrawal does
not erase that obligation. Finite failed-outcome retention can expire under its stated
rules because that failed attempt committed no effects.

Retained full results are disclosed only when current authorization permits the
complete result. No silent per-entry hiding, success prefix or reinterpretation as
new writes. Unavailable expired detail uses `idempotency-expired`; controlled erasure
and non-disclosure use existing truthful authorized Problems, never erased content.
Temporary inability is a service failure. None permits reexecution of a successful
key. Public receipt URLs, pending/paged outcomes, replica logs and permanently
reachable legacy endpoints are not required; inability to reach/serve recovery
never proves no original effect or permits dropping durable key obligations.

## Future composition

Future parameterized packages can explicitly materialize these ordinary records;
version 1 contains no template/interpolation language. Added operations or changed
critical semantics require another explicitly selected capability version, preserving
version 1 meaning or truthfully refusing it. A registered executable adapter must
verify this atomic feature before effects and invoke one atomic owner for the whole
document. Detailed hosting/`serve` remains deferred. Required Events/D1/D2/encoding,
actual Types/profile and owner-allocation composition precede any advertisement or
implementation adoption. Old v0 artifacts/runtime/evidence remain at their actual pins.
