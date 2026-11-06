---
status: editorial-draft
intended-status: normative
version: "0.1"
---

# Beads Protocol — Write

Write extends [Core](../core/core.md) with individually atomic Bead, Link and
alias mutations, durable retry outcomes, and production of the required committed
Event facts when Events is advertised. It also defines the independently optional atomic-batch1, id-root1 and
delete-modes1 capabilities. [Types](../types/types.md) supplies optional Scope-wide Type
interpretation; Write does not make that interpretation a condition of Core-only
carrying.

This is the current version 0.1 editorial draft. It defines protocol obligations,
not evidence that a particular provider implements them. The requirement-language,
JSON value model, common records, References, authorization and HTTP rules are
those of Core. Core, Write, Types and optional [Events](../events/events.md) own their respective protocol clauses. Schema artifacts
are mechanical companions: structural validity does not establish admission,
authorization, atomicity, retention or conformance.

> Ownership reexamination and deferred import/Transfer composition are indexed in
> the [informative appendix](#appendix-open-design-questions); existing Write requirements remain binding.

## Contents

1. [Discover and select Write](#discover-and-select-write)
2. [Ordinary requests](#ordinary-requests)
3. [Creation and identity allocation](#creation-and-identity-allocation)
4. [Admission, authorization and limits](#admission-authorization-and-limits)
5. [Object edits and endpoint corrections](#object-edits-and-endpoint-corrections)
6. [Revisions, owners and attribution](#revisions-owners-and-attribution)
7. [Ordinary results](#ordinary-results)
8. [Aliases](#aliases)
9. [Idempotency and recovery](#idempotency-and-recovery)
10. [Problems and diagnostics](#problems-and-diagnostics)
11. [Optional atomic batch, version 1](#optional-atomic-batch-version-1)
12. [Final atomic publication](#final-atomic-publication)
13. [Atomic batch results and recovery](#atomic-batch-results-and-recovery)
14. [Optional rooted allocation, version 1](#optional-rooted-allocation-version-1)
15. [Optional deletion modes, version 1](#optional-deletion-modes-version-1)
16. [Conformance boundary](#conformance-boundary)

## Discover and select Write

A Write Scope advertises `bdpVersion:"0.1"` and `profile:"write"`. Its closed
machine discovery requires `scope` and `operations`, in addition to those two
identity members and the Core-required `specRevision`. `aliases` is optional; when
present it promises Core's alias resolution and the two alias operations below.
Bead and Link inventories use the fixed Core routes
`<scope>/bdp/beads` and `<scope>/bdp/links`; they are not discovery members. The
optional common members are `events`, `order`, `limits`,
`maximumEndpointMultiplicity`, `historicalResolution` and `capabilities`, with
their Core meanings. There is no required Type inventory.
Optional capabilities under `capabilities` are atomic batch, rooted allocation,
historical update, [deletion modes](#optional-deletion-modes-version-1) and
[idempotency](#idempotency-and-recovery). `atomic-batch1` and
`historical-update1` require `idempotency`; a Scope advertising either without it
is invalid and a client refuses it.
The operation-directory URL is absolute HTTP(S) navigation. Clients use the fixed
inventory paths and follow the discovered operation-directory members, verifying
the owning Scope, Resource kind and selected contract; they MUST NOT infer an
operation from a Resource, Type or endpoint path.

<a id="operation-directory-and-singleton-targets"></a>

<a id="eight-distinct-ordinary-targets"></a>

### Ordinary targets

A GET of `operations` returns a closed `writeOperationDirectory` object with exactly
these members: the six Resource members always, and the two alias members exactly
when discovery advertises `aliases`:

| Member | Decision | Present |
| --- | --- | --- |
| `createBead` | Create one Bead | Always |
| `updateBead` | Edit one Bead | Always |
| `deleteBead` | Delete one Bead | Always |
| `createLink` | Create one Link | Always |
| `updateLink` | Edit one Link, including either endpoint | Always |
| `deleteLink` | Delete one Link | Always |
| `putAlias` | Create or repoint one alias | With `aliases` |
| `deleteAlias` | Remove one alias | With `aliases` |

Every value is a distinct absolute HTTP(S) operation URL served for this Scope.
A directory missing a required member, carrying an alias member without advertised
`aliases`, or omitting one when `aliases` is advertised is ambiguous and MUST be
refused before dispatch. Sharing an implementation handler does not merge the wire
addresses. No fixed URL suffix is required.
Atomic batch is separately advertised; it is not a directory member. There
is no sequence, set-write or public-receipt operation in this directory.

Each ordinary target accepts POST. The target URL supplies its operation kind;
`operation`, `name` and a body-level idempotency key are not singleton request
members. Other methods receive bodyless 405 with `Allow: POST`. The directory
allows GET and HEAD and otherwise returns bodyless 405 with `Allow: GET, HEAD`.
When cross-origin access is enabled, OPTIONS and `Allow` follow Core's CORS rules;
listing OPTIONS does not itself implement preflight.

### Contract and media

The complete specification identity is
`https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json`. Ordinary successful
JSON and mutation request bodies use `application/vnd.bdp.v0.1+json`. Clients
select the successful representation in `Accept` and declare the mutation body in
`Content-Type`. Missing or generic `application/json` mutation content is not a
version selection: the provider returns 415 `unsupported-media-type` before
interpreting the rejected body, claiming its key or producing effects. Media
parameters do not select another protocol contract.

Response negotiation that accepts no offered successful representation returns
bodyless 406 before durable admission of a new mutation. Problems use
`application/problem+json`; schema documents use `application/schema+json`.
Authentication, ordinary bounds and non-disclosure retain Core's ordering. No
rejection permits automatic generic-JSON fallback, a new key or another contract.

A client requiring Types1 selects
`application/vnd.bdp.v0.1.types.v1+json` in both mutation Content-Type and Accept,
under [Types](../types/types.md). The body, target and ordinary result remain the
same; this additionally selects Types1. Batch's body selector remains independent.
The provider preserves its promised base representations. A Scope advertising
Types1 enforces its Scope-wide invariants on all accepted writes, including base
requests. Unknown capability entries do not change ordinary Write semantics or
convey permission.

### HTTP conditions and complete responses

A mutation POST addresses a command URL, not the representation of a Resource
named in its body. HTTP conditional fields on that URL do not guard the Resource
or alias. `expectedRevision` is the explicit Resource guard. A read-side 412 is
not a write-side 409 `revision-mismatch`. Historical replication-position fields
`BDP-Minimum-Scope-Position`, `BDP-Scope-Epoch` and `BDP-Authorization-View` MUST be
ignored on these command POSTs: they impose no barrier and change no command
identity. Ordinary field syntax, transport bounds and authorization still apply.

Success is HTTP 200 with the complete ordinary result directly in the body,
`Cache-Control: private, no-store`, and no operation-target `ETag` or `Location`.
An operation URL is not the created Resource URL. No public receipt is introduced
by adding another capability. Failure is the applicable direct Problem at its
status; Core's bodyless transport branches retain their meanings, including
unexpected internal 500. CORS permits `Idempotency-Key` and exposes applicable
response fields, including `Retry-After`.

<a id="explicit-bead-operations"></a>
<a id="explicit-link-operations"></a>

## Ordinary requests

Each request is one closed JSON object. The following table gives its complete
operation-specific vocabulary; fields listed as optional remain subject to the
rules below. Unknown members, duplicate JSON members, invalid strings and invalid
Reference shapes are refused rather than ignored. There is no `@name` binding in
an ordinary singleton body, including inside a pinned endpoint Reference.

| Target | Required members | Optional members |
| --- | --- | --- |
| `createBead` | `type` | `id`, `properties`, `metadata`, `revisionProvenance` |
| `updateBead` | `bead` and at least one edit member | `type`, `properties`, `propertiesChange`, `metadata`, `metadataChange`, `expectedRevision`, `revisionProvenance` |
| `deleteBead` | `bead` | `expectedRevision` |
| `createLink` | `type`, `source`, `target` | `id`, `properties`, `metadata`, `revisionProvenance` |
| `updateLink` | `link` and at least one edit member | `type`, `source`, `target`, `properties`, `propertiesChange`, `metadata`, `metadataChange`, `expectedRevision`, `revisionProvenance` |
| `deleteLink` | `link` | `expectedRevision`, `revisionProvenance` |
| `putAlias` (with `aliases`) | `alias`, `target` | none |
| `deleteAlias` (with `aliases`) | `alias` | none |

The edit members for a Bead are the five Type/object members in its row; a Link
also admits either endpoint. Guard or provenance alone is not an update. An empty
ordinary patch is still an edit member, and an endpoint-only or Type-only update
needs no dummy property patch. Neither `ownedLinks`, identity, Resource kind nor
a stored provenance envelope is caller-mutable input.

`bead` and `link` identify a durable Resource of the required kind using a
canonical Scope-relative local path or absolute canonical URL. Subject operands
are identities, not pinned Resource snapshots. A Bead subject may use an admitted
alias; a Link subject may not resolve through an alias to a Bead. Relative inputs
resolve against the canonical Scope, never the command or containing Link URL.
Kind is checked against native facts, not a path prefix.

`source` and `target` replace whole endpoint References. They admit a relative
local Bead path, an absolute in-Scope Bead URL, an allowed opaque out-of-Scope URI,
or the corresponding closed `{uri,revision}` object. A local endpoint must resolve
to a live visible Bead; an external endpoint is not dereferenced or kind-guessed.
Applicable native and Types external-endpoint rules still apply. A pin is a
nonempty opaque string, preserved literally; it is not `expectedRevision` and
creates no foreign write authority. Core defines Reference syntax and exact
Reference interpretation.

`type` is one whole affiliation: an absolute HTTP(S) Type URI or exactly
`{uri,revision}`, with an absolute HTTP(S) `uri` and nonempty opaque definition
revision string. Relative Type paths, creation handles, URNs and `typeRevision`
are not this carrier. An affiliation is neither an instance revision nor a
registration/fetch request. `properties.type` remains ordinary authored data.

Creation initializes omitted `properties` and `metadata` to `{}`. Each supplied
value must be a JSON object. Updates distinguish omission, replacement and patch
as specified below. Under `idempotency`, every operation carries exactly one valid
`Idempotency-Key` HTTP field under [Idempotency and recovery](#idempotency-and-recovery).
Without it, [Repetition without idempotency](#repetition-without-idempotency) governs
the field and a repeated request.

## Creation and identity allocation

A Resource's canonical identity is established at creation and never changes. A
caller MAY supply an already canonical local `id` consisting of one or more safe
segments. Omitting it asks the authority to allocate one opaque segment. The
allocator MUST NOT encode meaning into its minted segment or choose a live alias
URL, for either Resource kind. Bead and Link creation use the same Scope-relative
identity space: neither kind requires or implies a `beads/` or `links/` prefix, and
either kind MAY use either spelling as an ordinary ID path. There are no mandatory
Type prefixes. Hierarchy authored in an ID implies neither containment nor a nested
Scope.

Core's canonical path, namespace and navigation-collision rules apply. A supplied
noncanonical spelling — leading/trailing separator, empty or dot segment, invalid
UTF-8/escaping, encoded separator or other prohibited form — is rejected, never
trimmed, decoded twice or normalized into another identity.

The complete canonical URL supplied for a creation MUST never previously have
been committed for either Resource kind in this logical Scope. Deletion does not
release it. Lifetime non-reuse covers kind and authority changes; comparing only a
suffix after stripping a kind/root segment is forbidden. A live alias at that URL
is instead `alias-path-taken`; removing the alias can clear that condition. A
committed creation/deletion in one atomic batch still consumes its identity.
Rollback commits no allocation or non-reuse claim.

Allocation, all Resource/owner effects, facts required by advertised Events and, under
`idempotency`, durable terminal key state commit together or none. Concurrent distinct invocations cannot commit the
same canonical identity. The provider may reject unsupported allocation under
native policies/bounds, but MUST NOT silently allocate elsewhere in place of an
explicit supplied identity or root.

Deleting a Bead removes it from the live graph; deletion does not require physical
erasure. A Bead deletion fails with `incident-links-exist` while any live Link is
incident upon it. The caller must explicitly remove those Links first, stage
legal removals in the same atomic batch, or select
[deletion modes](#optional-deletion-modes-version-1). Hidden Links are not disclosed
by this failure. Link deletion creates no new Link revision and may atomically update its
owners. A Bead deletion otherwise changes a surviving Bead only through a
[declared deletion effect](#type-declared-deletion-effects). Deletion is not
controlled-content erasure.

<a id="mutation-authorization"></a>
<a id="validation-and-results"></a>

## Admission, authorization and limits

A carrier-level refusal creates no idempotency disposition. Authentication,
non-disclosure, transport/request bounds, media negotiation, exact JSON/string
syntax and, under `idempotency`, key admission occur before fresh execution. Under
`idempotency` and the admitted carrier/key, retained-key handling precedes fresh liveness, guards, Type defaults,
feature support and execution bounds; it must not mistake an issued invocation
for new work. A supported closed grammar is checked without reevaluating live
operands before that retained comparison.

For a fresh operation the authority checks the applicable duties in their
specified order, including:

1. identifier uniqueness;
2. Reference resolution and required Resource kind;
3. in-Scope endpoint existence/liveness and applicable endpoint constraints;
4. external-endpoint syntax, opaque handling and applicable policy;
5. immutable-member and caller-input/property-path restrictions;
6. complete resulting Type/properties contracts where Types applies, object
   validity, and admissibility of every numeric literal;
7. applicable Scope aggregate constraints;
8. operation authorization;
9. supplied expected revisions;
10. absence of live incident Links for Bead deletion, or the
    [deletion-mode rules](#blocking-links) when selected; and
11. advertised and configured service limits.

Mutation authorization is operation-local and atomic. Policy observes the
established principal, pre-state and proposed post-state. A denied mutation is
`forbidden`; unknown and hidden subjects preserve Core's non-disclosure rule.
Alias authorization has the additional touched-target duties below. Current
Authorization View changes do not create a new key namespace. Retained result
disclosure is reauthorized separately from mutation execution.

The authority MUST ensure serializable observable outcomes when concurrent writes
could jointly violate an invariant or maximum. Scope aggregate-policy replacement
is atomic and serialized relative to mutations: tightening refuses if the live
graph already violates the proposed maximum. A policy replacement changes
corresponding discovery and its validator without changing a Type definition or
invalidating active reads. The protocol prescribes outcomes, not a lock or storage
implementation.

### Conditional Types validation

A Core-only provider carries admitted Type References without requiring Types
registration, descriptors, default resolution or schemas. It still enforces its
native constraints. A provider advertising Types uses the exact accepted authority
and complete offline closure defined in [Types](../types/types.md). It completes
installation/registration outside the admitted mutation; a generic mutation never
fetches a definition or installs one. An unavailable required closure refuses
`type-not-installed`. No client definition lookup is required to attempt a write.

Under Types, an explicit unpinned Type input resolves once to the explicitly
selected registered eligible exact default. Absence is refusal, never a guess at
the sole/newest definition. Stored/returned affiliations are exact. Omitting Type
on update preserves the complete preceding affiliation and pin despite new
registrations or defaults. Retyping performs no implicit conversion, property
deletion, endpoint repin or hidden repair. The destination properties and affected
incident Links must satisfy the final atomic graph. Types' stated temporary
endpoint-pair/arity allowances do not generally defer syntax, authorization,
guards, liveness, exact Reference resolution or protected-input checks.

Installed schema closures, required vocabulary support, administrative installation
bounds, immutable contract-bearing content, exact-definition retention and Type
lifecycle remain Types obligations. Schema `format` is annotation unless an
applicable protocol rule gives it assertion semantics. No mutable-current
publisher definition substitutes for recorded exact meaning during validation,
replay or recovery.

<a id="numeric-admission"></a>
<a id="mutation-limits"></a>

### Native limits and numeric admission

Omitting an advertised bound does not permit partial mutation, truncation or a
non-normative failure response. Request/Resource sizes, patch counts/path size and
depth, validation work and durable response retention remain bounded under Core
and the provider's actual configuration. `patch.operations` counts the combined
properties and metadata patch items in one update; `patch.pathBytes` and
`patch.pathDepth` apply to each path. `validation.diagnostics` and
`validation.diagnosticBytes` count entries and serialized UTF-8 list bytes.
`retention.idempotency` is a minimum terminal-detail interval, not permission to
forget successful anti-reexecution state.

The Core numeric model applies at every depth of supplied objects and patch
values. The authority MUST refuse an inadmissible literal as `validation-failed`,
with a diagnostic naming the offending document/member, without effects. It
MUST NOT round, overflow or convert numeric meaning to obtain admission.

## Object edits and endpoint corrections

<a id="property-change-values"></a>
<a id="property-changes"></a>

### Independent object planes

An update may combine whole `type`, properties replacement or patch, metadata
replacement or patch and, for Links, whole endpoint replacements. Within one
object plane replacement and patch are mutually exclusive, even when empty.
Different planes may combine in one atomic operation. Failure leaves no partial
object, affiliation, endpoint or induced-owner effect.

Omitting both members for an object preserves it, subject to applicable service
completion on an admitted write. `{}` supplies an empty replacement set; it is
neither omission nor `[]`. A supplied ordinary patch may be empty and contributes
zero operations. Arrays/null are not replacement objects. JSON null inside an
object is a value, distinct from member removal. The client must not implement
replacement by a read/modify/write or reinterpret it as an apparently equivalent
root patch.

```json
{
  "bead":"task-42",
  "properties":{"title":"Reviewed"},
  "metadataChange":[{"op":"add","path":"/reviewed","value":true}],
  "expectedRevision":"resource-r7"
}
```

### Properties replacement and protected input

Without applicable Types property-access policy, properties replacement literally
replaces the complete object under native constraints; it is not an undocumented
partial merge. Under Types, replacement supplies the caller-writable set. Preserve
existing init-only values; enforce local/inherited restrictions and protected
child paths; refuse explicit service-managed input even if equal to stored state.
The service completes its fields before validating the complete result.

Omission of a required service-managed output field is not malformed caller input
merely because the stored-result schema requires that field. The provider MUST NOT
require every stored-result field from the caller, silently ignore prohibited
input, or use a permissive parent/root edit to bypass a protected child.

When retyping introduces init-only policy, preserve and validate an existing value;
an incompatible value refuses, and an absent value may be initialized. Leaving
the last applicable init-only contract preserves the value during departure;
later writes use destination policy. No hidden lifetime immutability is added.
Metadata has no Types properties schema; metadata replacement replaces its entire
common object, not properties or revision provenance.

### Ordered JSON Patch

`propertiesChange` and `metadataChange` are arrays of RFC 6902 patch items using
RFC 6901 pointers relative to their own objects. Each item is one of `add`,
`replace` or `remove`. Each item is closed: required `op` and `path`, plus
required `value` for add/replace; remove forbids `value`. Move/copy/test
are not admitted. Operations execute in array order with normal object and array
semantics. Add replaces an existing object member or inserts/appends an array
member; replace and remove require the target to exist. The final result must be
a JSON object. Complete-result validation occurs after the whole patch, not after
every temporary value.

An empty pointer addresses the object root. Root replace with `{}` clears the
object but remains a literal patch attempt under input/path policy, not the
caller-writable-set replacement mode. Whole-array policy designations under Types
do not ban otherwise valid array edits. Patch path syntax errors are
`malformed-request`; missing replace/remove targets or a nonobject final result
are `validation-failed`.

A top-level tolerant removal can be expressed as add-null followed by remove.
That composition preserves strict remove and complete final validation, and
policy must inspect the entire submitted attempt, including a protected edit
later undone. If an adapter cannot preserve this admission, it refuses. Ordinary
patch gains no idempotent-remove operation. Empty arrays do not bypass liveness,
authorization, guards, Type validation or no-op comparison; clients MUST NOT skip
such an update on the assumption that it has no effect.

### Whole Link endpoint correction

`updateLink` may supply `source`, `target` or both without another edit member.
Each replaces the complete Reference. Omission preserves its exact preceding
Reference, including pin; a URI string explicitly selects floating reference and
therefore removes a preceding pin. Null, `{revision}` and endpoint JSON Patch are
not replacement forms. An endpoint can change identity, pin or both while the
Link's `id`, Resource kind and owning Scope remain fixed.

Complete resolved Reference equality includes URI, pin presence and pin token.
A pin is provenance/exact-reference state under Core, not a Resource guard or
proof that an owning Link belonged to an older captured version. No implicit
repin, new owner guard, shared owner/Link revision token or foreign fetch follows.
The Link's optional `expectedRevision` guards the Link itself.

For `L: A → T` corrected to `L: B → T`, determine initial ownership under A's
accepted authority and final ownership under B's. An initial owner loses the Link
from its new capture and a final owner gains its complete final record. Deduplicate
when source identity is unchanged. A target correction can change its source's
capture but ordinary incoming citation does not version either endpoint target.
An unowned source acquires no invented owner effect. Link and all changed owners
publish atomically. Historical Link editions and owner captures retain their
recorded endpoints, pins and affiliations.

## Historical-base Bead Update and recovery

The following behavior is selected for the historical-update extension to
`updateBead`, from the [approved historical Update decisions](https://github.com/gastownhall/issues/7719).
This is an optional discoverable capability, not a mandatory widening of Write.
The body-free terminal-version model and narrow authorized terminal read are
selected. Source admission requires the exact complete editable content actually
consumed, with an independently authorized current protected baseline, as
[recorded in the crosswalk](../../../docs/design/historical-update-crosswalk.md#carrier-selection-requiring-a-concrete-ruling).
No provider may claim complete support from partial structural carriers or
internal retention alone. The initial extension applies to Beads; it adds no
historical Link recovery, new `revert` operation, import or generic graph rollback.

### Explicit historical-update1 selection and unchanged base carriers

The capability identity is
`https://github.com/gastownhall/bdp/capabilities/historical-update`, exact version
`"1"`. Its closed detail is `{ "atomicBatch": BOOLEAN }`. Only Write advertises
it; advertisement promises the complete selected historical Bead behavior and
its concrete read/result binding, not a retained store or a flag alone.
`atomicBatch:false` explicitly permits refusal of historical Update inside a
batch. Co-advertising ordinary atomic-batch1 does not imply this composition.
`atomicBatch:true` requires actual joint schema, atomicity, outcome and recovery
support; it is not a test-result flag. No new profile or generic framework exists.

The required grammar-owned `fromRevision` member selects this fixed exact-token
request within the explicitly selected feature media on the existing discovered
`updateBead` target. A field of that name inside properties or metadata is ordinary
document data. An ordinary base-media request retains its closed base grammar
and refuses an extra `fromRevision` rather than switching interpretation. A
feature-media mutation missing the selector is malformed; no automatic downgrade
to an ordinary edit is allowed. The feature-owned schema resource is
[historical-update-v1.schema.json](historical-update-v1.schema.json), with identity
`https://github.com/gastownhall/bdp/schemas/historical-update-v1.schema.json`.
The ordinary common bundle, Resource roots and mutation-result roots remain
unchanged.

A feature mutation sends and accepts
`application/vnd.bdp.v0.1.historical-update.v1+json`. Successful feature results
use that subtype; Problems remain `application/problem+json`. The client offers
no base fallback and never retries after stripping source/feature intent. Selected
media, exact feature version, source and original resolution witnesses participate
in the same principal/key semantic identity and retained recovery rules. Unknown
media is the ordinary pre-admission 415; no failed negotiation proves an earlier
uncertain write did not occur. Passive capability advertisement is not selection.

After ordinary carrier/key admission and known-key comparison, a fresh invocation
without selected support receives feature-local `capability-not-supported`,
request family/422/after-state-change, its capability URI, `capabilityVersion:"1"`
and pointer `/fromRevision`. A provider accepting joint batch selection uses
`/operations/N/fromRevision` for that selecting member. Missing advertisement
causes a feature-aware client to refuse before fresh dispatch. A supporting
receiver never silently discards the selector or substitutes current content.
Other failures use their ordinary truthful Problems; admission/disclosure and
known-key replay ordering remain unchanged. Issued no-reexecution obligations
survive withdrawn fresh support.

A successful selected mutation returns the closed wrapper
`{result:MUTATION_RESULT,historicalUpdate?:CONTEXT}`. `result` is the unchanged
ordinary complete updated outcome; the context is separate from the base Resource
and base result schema. The closed context has exactly `fromRevision` and
`previousRevision`, each an exact opaque token for the same enclosing Bead
identity. It records the historical content source and actual replaced state,
not the optional guard or two duplicate source aliases. A newly minted historical
version requires this durable context. A no-op returns the context already bound
to its original resulting version, or omits it if that version had none; it does
not substitute the new request's source/current predecessor.

A current live feature view explicitly selects the same subtype in `Accept` on
the canonical Bead GET/HEAD and returns
`{resource:BEAD,historicalUpdate?:CONTEXT}`. The enclosed complete Bead retains
its base schema. No new projection, aggregate, exact-History or terminal branch
is implied by this live carrier. An ordinary successful base read returns the
unchanged ordinary Bead shape. Context is immutable per version and retained
outside that base Resource; a later ordinary effectful write does not inherit a
previous operation's historical context. A later no-op preserves the original
version's context. Authorization and erasure apply to all controlled copies.

Feature read success negotiates before conditional success and preserves `Vary:
Accept`, HEAD bodylessness and representation-variant validator meaning. A base
validator is not proof of the feature wrapper bytes. The existing current Scope
navigation/kind and nondisclosure rules apply; a wrapper is not another identity.
The narrow terminal binding below is independently selected; no full History
implementation or historical content read is implied.
Combined Types-required/projection/History/batch selection requires an explicit
supported binding; these feature carriers never silently drop another selected
meaning or claim its capability.

### Body-free terminal versions and narrow authorized read

For a Scope implementing historical-update1, an effectful Bead deletion commits
one genuine fresh body-free terminal version D in that identity's committed-state
lineage. Its direct predecessor is the actual final live published version R7.
D is not an alias, a deletion timestamp, an allocated replacement identity, a
copy of R7's token or an invented last-live wrapper. D and R7 MUST remain distinct
under the ordinary same-identity revision-safety rule. Repeated deletion does not
mint another D. A later genuine recovery R8 has actual predecessor D, and a later
deletion produces a different terminal version. Retained older live and terminal
versions remain subject to the applicable retention, erasure and disclosure rules.

This explicitly amends the unextended no-deleted-edition rule for this optional
capability. A base-media delete still returns its unchanged ordinary result with
`deleted.resource.revision` identifying R7. A feature-enabled provider records D
atomically even when that ordinary delete came from a base client; the result does
not silently rename R7 or acquire an undeclared terminal member. Base current GET
continues to return the ordinary deleted-object refusal. A new full deleted Bead
body is never fabricated.

A selected historical Update guards the actual committed current state: R7 while
live or D while deleted. The optional `expectedRevision` remains a literal opaque
token; it does not need another guard flag or ordinal grammar. The selected feature
request/media gives this committed-state interpretation. An ordinary Update without
`fromRevision` does not acquire recovery semantics and still refuses a deleted
target. After another recovery R8 or deletion D2, an earlier expected D mismatches.
Source R1 remains an independently selected live version and never supplies D.

The terminal version uses the closed `historicalUpdateTerminalVersion` shape:
`{id,revision,state:"deleted",previousRevision,revisionProvenance?}`.
Its canonical Bead id binds both revisions to this identity. `previousRevision`
is the actual direct live predecessor R7, not an inference from an enumeration.
It contains no Type, properties, metadata, endpoints, owned-Link payload or native
ordinal. Any recorded revision provenance describes the actual deletion operation
under existing truthful-absence and actor rules; it is not copied from R7 or R1.
No broader provenance field or native terminal wrapper is introduced.

`GET canonical-bead?view=terminal` with an Accept selecting only
`application/vnd.bdp.v0.1.historical-update.v1+json` returns the closed
`{terminal:TERMINAL_VERSION}` wrapper for the actual current deletion version.
`HEAD` performs the same authorization/current-state/conditional decision with
no body. Exactly one `view=terminal` is admitted; additional or repeated query
members are `invalid-parameter`. This initial read does not add a revision selector,
versions listing or an exact historical content/terminal retrieval operation.
A canonical target with no current terminal, including a live Bead, receives the
uniform `resource-not-found`; current live guards come from ordinary GET instead.
An alias query retains the existing uniform404 and gains no terminal forwarding.

Current permission to disclose the whole terminal and its metadata is required
before successful disclosure or conditional success. Source access alone grants
neither that permission nor recovery authority. Undisclosable/unknown subjects
retain uniform404; permission denial is not pruning or unavailable evidence.
Positive erasure/pruning and temporary storage failure use their actual existing
Problems without a fabricated terminal. A read neither recovers the subject nor
guarantees that a subsequent expected-D guard will still match.

Terminal success uses private/no-store, selected feature media, actual owning
Scope navigation and `BDP-Resource-Kind: bead` from native subject facts; it has
no collection-kind marker. Negotiation precedes conditional success; HEAD and
variant-sensitive validator/Vary rules apply. Unsupported feature reads use the
feature-local capability Problem without a request-body pointer. The terminal
version may be compared as a guard, but its JSON wrapper is not a base Bead or a
successful ordinary current Resource representation.

This initial version selects no joint full-History binding. A provider MUST NOT
advertise `historicalResolution` for a historical-update-enabled Scope until a
separately reviewed binding accounts coherently for terminal versions, exact
success unions, rows/windows/lineage, authorization, provenance and HTTP relations.
No use of `revision-unrepresentable` as an escape hatch establishes that missing
composition. Internal exact-source retention and this narrow terminal read do not
qualify any part of the complete History capability. Unsupported composition must
be refused explicitly rather than relabelled as implemented.

Where Events is independently advertised, deletion and recovery must represent
actual live-to-deleted and deleted-to-live presence transitions with final-state
postimages and complete owner effects, not a fake live predecessor or a patch
against R1. Base deletion results/facts retain their selected final-live meaning;
D is the terminal-version evidence, not a renaming of that field. A concrete
feature/Events binding must account for D and predecessor correlation before an
advertised implementation claims that composition. The initial reference's private
fact encoding is not a public Events advertisement. An unadvertised private log
may retain D/previousR7 under an explicitly feature-aware recovery verifier.

Deletion and recovery preserve existing ownership/incident admission and atomic
publication. This feature requires no new owned-Link representation, terminal
owned snapshot, duplicated graph capture or broader ownership redesign. Required
last-current facts may reuse an existing authoritative retained record or native
state; no second full snapshot is mandated merely to store body-free D.

### Exact source, current predecessor and independent guard

`fromRevision` selects one exact retained live revision of the target Bead.
It is a nonempty opaque revision token, not a Reference, target identity,
current-state guard, local ordinal or default-last-live instruction. The ordinary
`bead` operand supplies the subject. The source MUST belong to that same identity
and be authorized, available and faithfully reconstructable. A terminal deletion
record is not a live content source. Unknown identity upsert, another subject's
source, nearest/latest substitution and erasure bypass are forbidden.

A source-only request is valid under the selected extension. Without the selector,
ordinary Update keeps its existing edit-member admission rules. `expectedRevision`
remains an independent optional current-state guard: source R1, actual current R7
and expected R7 name three roles, even when two tokens happen to be equal. After
an actual deletion D, recovery may guard against D independently of R1. The last
live token R7 MUST NOT be substituted for a genuine deletion-state revision D.
Omission follows ordinary optional-guard semantics; recovery introduces no
mandatory guard. Ordinary nondisclosure/refusal precedence still governs these
checks rather than exposing a new source/current-state oracle.

Exact-source refusal uses existing substantiated vocabulary. A syntactically
valid token with no retained same-subject state or disposition is
`revision-unknown` (not-found/404/after-state-change), not proof of pruning or a
foreign subject. Positive known missing reconstruction is `revision-unretained`
(conflict/409/after-state-change) with its required bounded `missing` diagnosis;
never invent missing locations or a complete inventory from absent evidence.
Positive erasure/pruning, reorganization, non-participation and representation
failure keep their existing predicates, statuses and disclosure gates. Temporary
I/O is a service failure. An authorized token naming a terminal version is not a
live content source and fails ordinary validation; do not choose its last live
predecessor automatically. The error never gains a foreign source URI, body,
retention window or undocumented selector detail. Source acquisition MUST be
explicitly authorized for the exact complete editable content consumed by this
operation. Permission to write the current target or read the terminal alone
does not establish that source permission. Apply ordinary nondisclosure gates;
a refusal MUST NOT reveal inaccessible historical content or its existence.

The provider MUST faithfully acquire every historical editable value that the
selected writer consumes, including authoritative absence where that affects
composition. It need not acquire unused historical owned-Link captures or old
protected structure. It MUST NOT guess missing editable values, substitute a
different revision, use current values as an unannounced source fallback, or
truncate the consumed source to obtain success. This operation-local source
acquisition does not constitute a successful partial History Resource read.
The independently authorized current protected baseline remains mandatory.

### Historical editable content and current structural authority

Source the exact historical editable properties and editable common metadata,
then apply the request's explicit edits using ordinary replacement/patch semantics.
The source is a content base, not a replacement Resource envelope. Only locations
admitted as editable by the selected ordinary writer participate; unclassified
fields are not implicitly editable.

| State | Historical-source policy |
| --- | --- |
| Ordinary editable `properties` and common `metadata` | Source their historical values, then apply explicit object edits atomically. |
| Immutable, protected and initialization-only locations | Preserve independently established authoritative current/last-current values; apply their existing ordinary edit rules. |
| Service-managed fields | Remain with the current writer; regenerate only where its existing rules permit. |
| Identity, kind, Scope and allocation | Preserve the existing subject and allocation; no reallocation or unknown-ID upsert. |
| Type affiliation and selected definition | Preserve current accepted meaning unless explicitly edited under ordinary Type rules; never take them implicitly from R1. |
| Owned Links, incidence, endpoints and pins | Preserve actual current graph state and apply current constraints; no historical snapshot replay or Link resurrection. |
| Revision and operation actor/time/provenance | Describe the actual new operation and actual predecessor, with historical source distinguished separately; never copy old operation facts as new ones. |

A native adapter MUST publish its explicit editable-field crosswalk and preserve
its ordinary domain authority. A readable serialized field does not establish
that a generic Update may write it. In particular, historical native Issue content
must use its admitted setters, nullable/empty representation, notes overwrite and
assignment fences, and retained initialization facts. Unknown changed native
members require an explicit mapping or refusal. The
[native correspondence table](../../../docs/design/historical-update-crosswalk.md#native-issue-correspondence)
records the integrated Beads boundary without requiring a generic provider to
import domain code or treating native wrappers as public BDP schema.

Recovery MUST independently establish the authoritative last-current Type,
selected definition and required immutable/initialization facts. A readable R1
plus a guardable D does not prove that baseline. Use positively bound retained
allocation/native/terminal-associated facts or an authorized exact predecessor
under the existing authority policy; do not substitute a convenient source or
latest retained body. Missing, erased, pruned, malformed, unauthorized or
unavailable required facts cause atomic refusal under the applicable truthful
diagnosis. Current Type, protected-field, ownership and graph validation apply to
the complete composed candidate through commit.

### One atomic transition and truthful recovery

Resolve/authorize the source and actual current target, independently check any
guard, compose editable content, validate the current final graph and commit as
one authoritative operation. Source retention and erasure fences apply during
acquisition and through commit. Respect actual cumulative source/current/baseline
bounds; truncation is not a valid historical source. Failure leaves no partial
content, allocation, history, revision, owner or applicable Event effect.

For a live Bead, a final state equal to the complete current covered state is the
ordinary no-op. Admission, source authorization/availability, guard and final
validation still run. Return the entire unchanged recorded envelope, including
any earlier historical-source context. Do not remove that context, replace it
with the later selector, mint a revision or provenance-only write, or emit a
lifecycle Event. Retain the ordinary durable successful retry outcome.

Deleted-to-live recovery changes presence and mints a fresh live revision under
the existing identity, even when editable content equals an earlier live record.
It preserves deletion/history evidence and current initialization authority,
uses the accepted recovery Inception direction, and revives no Link. Ordinary
deleted Resource reads remain unchanged. Effects describe the actual current-to-
result transition, never a patch against R1 presented as if R1 were current.

The exact selector and selected feature intent participate in semantic request
identity. Changing R1 with the same key conflicts. A retained success/no-op
replays its original complete outcome under current disclosure/erasure rules;
it MUST NOT resolve a newer source or execute again after source removal.
Unknown transport disposition uses ordinary same-key recovery, not a fresh key,
client read/replace simulation or automatic fallback. Optional batch composition
requires its own explicit supported binding and preserves one atomic decision;
no singleton loop or partial execution is inferred.

## Revisions, owners and attribution

<a id="mutation-revisions-and-guards"></a>

### Covered state and no-ops

Every successful creation publishes a fresh opaque Resource revision. An
individually effectful update publishes one new revision. Revision-covered state
is the complete affiliation, completed properties and metadata, applicable
captured owned-Link state and, for a Link, complete source and target References.
A nominal Type change or definition-pin change is an effect even with unchanged
objects or empty patches. Compare object values under Core's RFC 6902 Section 4.6
JSON equality, not serialized member order.

After all admission checks, an equal complete covered state is a genuine no-op:
return successful updated outcome with unchanged revision and entire recorded
envelope, no new provenance and no lifecycle Event. Context alone cannot force a
version. Under `idempotency`, a no-op still records successful durable retry state
and witnesses. Batch
uses the final-versus-initial rule below, not a version for every staged edit.

An update or deletion MAY carry `expectedRevision`. It applies only if the target
still has that committed current Resource revision; omission uses current state.
A mismatch is `revision-mismatch` with no effect. A surviving historical address
does not make its revision a current guard. No mandatory guard is introduced by
retyping, ownership or endpoint correction. Compare revision meaning as
`(Resource URI, revision)`, not bare tokens across Resources; equal strings across
Resources prove no transaction, common state or global revision.

Ordinary revision-token collision can be handled by safely choosing another
candidate. Positive persistent repair-required allocation unsafety refuses
`revision-allocation-unsafe`; transient inability to inspect safety is
`temporarily-unavailable`. The persistent diagnosis carries no condition-specific
identity information. Direct pre-admission refusal creates no disposition; an
admitted permanent failure is retained under the ordinary rules. Do not reset
retry deadlines, fabricate pruning, reexecute retained work or disable otherwise
available reads to evade the condition.

### Owned-state effects

Applicable ownership semantics come from accepted Types authority or native
rules, not a guessed path/category. Only Beads own outgoing Links. A new capture
contains complete final Link records grouped by each Link's actual nominal Type
URI, extracting `.uri` from a pinned affiliation. Different definition pins of
one nominal Link Type share a bucket; a specialization appears once in its own
nominal bucket, not again under every matching selector/ancestor. Inherited
selectors contribute a union with Links deduplicated across selectors and paths.

Each new bucket is nonempty and lists each Link exactly once in ascending
code-unit order of canonical id. An owner with no selected Links has
`ownedLinks:{}`; a nonowner omits it. An unchanged retained edition preserves its
recorded capture/envelope, including legacy empty buckets. Normalizing an old
shape is not a mutation or a reason to mint a revision.

Retyping a Link can enter or leave ownership. Compare both boundaries using the
applicable exact authority. A pin change can change membership even with the same
nominal Type; a changed captured full Link record is an owner effect even when
membership remains. Retyping a Bead recomputes its owned set from existing outgoing
Links under destination rules without inventing revisions for unedited Links.
Owner and Link revision tokens remain independent. A Link pinned to S@r1 may
remain literal while S@r2 captures that Link; S@r1 does not retroactively gain it.

<a id="attribution-on-mutations"></a>
<a id="history-context-on-mutation-results"></a>

### Per-version attribution

Create/update Bead and Link and an owned-capable deleteLink may supply the closed
`revisionProvenance` input. Alias operations and deleteBead have no such input.
Its optional members are `actor`, `agent` and `message`; callers supply no time.
Actor is the closed `{id,basis}` object from Core: nonempty `id`, with basis
`writer-supplied` or `unknown`. Agent is a nonempty string or null; message is a
string or null. Omission means undetermined; null explicitly records known
absence. Omitted input and `{}` normalize to no actor/undetermined agent/message;
explicit null remains distinct. Actor omission does not copy an earlier actor.

Attribution belongs immutably to the version minted by that decision. One
operation minting several versions records its one input on each, including all
induced owner versions. A Link deletion mints no Link version and can record
context only on newly versioned owners. No-op keeps the whole existing envelope.
Provenance input remains part of retry identity although it is excluded from
covered-state no-op comparison. Write adds no authority-attested actor.

When complete application History is independently advertised, native minted
versions carry authority-observed commit-time `committedAt`, `agent` and `message`
in complete result postimages under Core's immutable change-context rules. Commit
time is not admission, import or editable Inception time and promises no accurate
global clock. Available imported context retains its original meaning; unknown
context is not invented. Extra import provenance is not another public envelope.
Batch realizes one attribution per final version as specified below.

## Ordinary results

<a id="mutation-results"></a>

A Resource success is the closed object below. Created/updated results carry
`resource` and omit `deleted`; deleted results carry `deleted` and omit `resource`.

| Member | Meaning |
| --- | --- |
| `outcome` | `created`, `updated` or `deleted`, corresponding to the operation |
| `changed` | Required boolean; true for creation/deletion, actual complete-state effect flag for update |
| `resource` | Complete original resulting Bead or Link record, for create/update |
| `deleted` | `{resourceKind,resource:{id,type,revision}}`, for delete |
| `ownerRevisions` | Required exactly for a Link owned initially or finally; otherwise absent |

The Resource postimage contains the actual id, affiliation, revision, properties,
metadata, recorded provenance when present, applicable owned state and Link
endpoints. It is the complete original transition, not a later GET or projected
success. The deleted identity records the final live edition's exact affiliation
and revision. Unextended deletion mints no deleted edition or new revision.
Historical-update1 commits its separately represented terminal version as specified
above without changing this base result. Result identity,
kind, revision and operation MUST agree. A replay returns the same original state,
subject to current disclosure and lawful erasure, even after later edits/deletion.

### Complete owner revision context

`ownerRevisions` is result context, not a Resource field. It is a nonempty array
of closed `{id,revision}` entries for exactly the distinct Beads owning the Link
in the initial OR final committed graph, at most two sources for one Link. Order
entries by ascending code-unit canonical URI; duplicate owner IDs are invalid
even with different revision strings. Each revision is the actual final published
owner revision. Ownership exit reports its former owner's resulting revision; an
owned no-op reports unchanged context. With no owners omit the member; an empty
array is not the no-owner form. Bead results omit it.

A source move between two owners therefore reports both owners. Within a batch,
a deleted owner is reported at its final live published revision, not a staged
one, and its unique Resource row is also required. Singleton results promise no
inline owner postimages or cross-request snapshot; exact reads still depend on
actual retained access. Old result-level `source`/`sourceRevision` are not
alternative current spellings. Source and target inside a Link record remain
its actual endpoints.

## Aliases

<a id="alias-mutation-model"></a>
<a id="explicit-alias-operations"></a>
<a id="alias-targets"></a>

This section binds a Scope that advertises `aliases`. A Scope without it serves no
alias operations, answers alias URLs as Core says for an authority that does not
advertise `aliases`, and keeps every other Write rule unchanged.

An alias is a reusable locator to one canonical in-Scope Bead, not a Resource,
revision, owned state or member of the target's properties. Put creates or repoints
it; delete removes it. A put at an existing alias repoints it rather than treating
that alias as a collision. Both operations use the discovered ordinary targets.

`alias` is a canonical Scope-relative path or absolute URL in the advertised alias
base. Resolve relative operands against `scope`; do not prepend the alias base or
drop a kind-looking segment. No creation handle is admitted. Malformed syntax is
`malformed-request`; a well-formed URL outside the admitted alias namespace is
`resource-not-found`. Within that namespace, any ever-committed Resource URL is
`identity-taken` even after Resource deletion. Compare complete URLs, never tails.
Uniqueness is checked before the put's target, so a taken path plus unknown target
answers the uniqueness fault.

A put's `target` must be a canonical in-Scope Bead identity. An alias, Link or
external URI is `validation-failed` with its required diagnostic; no alias chains
are created. Unknown/invisible canonical Beads and unknown aliases for deletion
are `resource-not-found`. Put requires write authorization for the proposed target;
repoint/delete also require write authorization for the current target. If that
current target is invisible, the alias is `resource-not-found`, without disclosure.
Other forbidden operations use `forbidden`. Retry identity comparison grants no
permission to mutate or disclose these targets.

Put/delete mint no Bead version, and repoint versions neither former nor new
target. Neither operation admits expectedRevision, revisionProvenance or name.
The closed alias result is:

| Member | Meaning |
| --- | --- |
| `outcome` | `created` for a new put, `updated` for an existing put, `deleted` for delete |
| `alias` | Absolute canonical alias URL |
| `target` | Absolute canonical Bead URL for created/updated; absent for deleted |

A put to the same target succeeds as `updated` without a state change. Alias
results carry no `changed`, Resource revision or provenance. Under `idempotency`,
they still retain successful anti-reexecution state. Alias mutation emits no Resource Event.

An admitted alias spelling may be used as an update/delete Bead subject or either
Link endpoint, bare or as the uri of a pinned Reference. Resolve it to the current
canonical Bead when the fresh operation executes; stored/served References never
contain the alias or follow a later repoint. A missing alias is
`resource-not-found` under normal non-disclosure. A Link subject cannot use an
alias to become a Link. A put's own target never admits an alias. Retried locators
use the frozen comparison witnesses below instead of rebinding a known locator.

## Idempotency and recovery

This section binds a Scope that advertises the `idempotency` capability,
`https://github.com/gastownhall/bdp/capabilities/idempotency` at version `"1"` with
closed empty detail. Only Write advertises it. Advertisement promises the complete
contract below. Throughout
this document, a duty stated in terms of an idempotency key, a retained disposition,
a witness, replay or compact key state applies only under this capability. A Scope
without it owes only [Repetition without idempotency](#repetition-without-idempotency).

<a id="idempotency-keys"></a>

### Keys and namespace

The client supplies one case-sensitive ASCII token matching
`[A-Za-z0-9_-]{1,256}` as the unquoted `Idempotency-Key` value, with no whitespace
or padding. Missing, repeated or invalid fields are `malformed-request` before
execution; the authority MUST NOT choose an occurrence, allocate, normalize or
case-fold the key. It compares bytes exactly.

The namespace is canonical Scope URL plus authenticated principal, including one
shared anonymous principal. Authentication establishes principal identity across
restart/failover and credential rotation. Carried actor, Authorization View,
profile/feature version, transport host and replica epoch do not partition that
namespace. Every mutation route consults one authoritative key state. Authorities
admitting anonymous mutations SHOULD require authentication, and anonymous
clients SHOULD use unguessable keys because the namespace is shared.

### Frozen semantic identity and witnesses

Semantic identity includes the selected complete specification, capability/version
and carrier semantics, operation kind and normalized complete input. Preserve
field presence, whole Type/endpoint intent, replacement versus patch, guards and
provenance. Type omission, unpinned input and exact pinned input are distinct even
if their first execution would reach the same affiliation. Preserve array/patch
order; object member order is immaterial under Core JSON equality. Creation
omissions normalize properties and metadata to `{}`. Omitted provenance and `{}`
normalize as stated above. External opaque URI/pin values retain literal meaning.
The internal representation or fingerprint need not be a public standard.

Resolve/canonicalize local References for identity comparison. The authority MUST
retain original alias locators and their recorded canonical targets or misses
with the disposition and successful compact state. A recorded locator retains its
original resolution on retry, including equivalent canonical spellings and use in
another Reference slot. Repoint/deletion cannot rebind it. A recorded miss remains
a miss if the alias is later assigned.

A previously unrecorded locator is looked up for comparison within the principal's
key namespace without filtering the lookup by Authorization View. This is neither
an alias GET nor permission for fresh execution or disclosure. Each such retry
lookup is transient comparison input; it changes no original witnesses or outcome.
Distinct missing canonical locators are distinct identities, not one generic miss.
A direct canonical reference compares directly. Current authorization separately
governs disclosure of a retained record.

For Types, first execution records the accepted exact/default-resolution witness;
replay uses it rather than today's default. A client freezes Scope, operands,
values, contract, selected capabilities/media and key. A lost/error response MUST
NOT trigger a new key, new media, fresh file read/default or another carrier as
an automatic recovery strategy. Unavailable recovery never proves no original
effect. Different selected invocation meaning conflicts within the same namespace.

<a id="duplicate-keys-and-retained-dispositions"></a>

### Claims and terminal outcomes

After carrier/key admission, resolve known retained/expired identity before fresh
support, liveness, guards, defaults or limits. There are four ordinary outcomes:

1. Retained same meaning returns the original terminal disposition without effects.
2. Retained or successful-expired different meaning returns
   `idempotency-conflict`, preserving the original state.
3. A claimed in-flight key executes nothing again and returns
   `idempotency-in-progress` with existing transient advice, or waits within bounds.
4. Unknown admitted meaning claims its key before execution and executes at most
   once; terminal nontransient success/failure is retained.

The disposition is the original complete mutation result, alias result or Problem.
After-delay Problems (`rate-limited`, `temporarily-unavailable`,
`idempotency-in-progress`) are transient and create no retained terminal decision
for the presenting invocation. Carrier-level refusal likewise creates none.
Other admitted failures commit no mutation but retain their failure for their
stated detail interval. A client intentionally submitting refreshed new work uses
a new key; it cannot assume a failed transport means the old work did not occur.

Returning a retained create/update record requires current authorization of that
record as retained, even if no longer live/current. Denial returns `forbidden`
without replacing the original disposition or permitting reexecution. A later
permitted replay can return it. Deleted identities, retained Problems and alias
results retain their distinct disclosure rules and are returned as retained.
Controlled erasure may forbid disclosure; missing bytes do not authorize another
execution or a fabricated full result.

<a id="outcome-retention"></a>

### Detail expiry and permanent successful-key state

Advertised `retention.idempotency` is the minimum interval after terminal outcome
for full retained detail. Without advertisement the provider chooses a finite
interval but promises no client-known recovery window. A client needing that
window retries within the advertised interval. After lawful full-detail expiry,
a success — including no-op or alias success — retains compact key/semantic
identity, original locator witnesses and any allocated identity/kind for the
logical Scope's lifetime. It MUST NOT execute again against later state.

Same-meaning expired success returns `idempotency-expired`, never a reconstructed
discarded outcome; changed meaning still conflicts. A failure committed nothing
and MAY be forgotten after its interval, making a later guarded presentation
unknown work. Successful tombstones/non-reuse grow even when no new Resource
revision was created. Ordinary bounded configuration must accommodate these duties.

<a id="durability-and-recovery"></a>

### Atomic durability, crash and capability changes

Effects, semantic identity, allocations, facts required by advertised Events and terminal outcome MUST
become durable together. A crash leaves either no committed effects and an
unknown/cleared abandoned claim, or the retained original decision; never effects
behind an unknown successful key, a retained success for lost work or indefinite
in-progress for an abandoned claim. Recovery clears a claim with no durable
outcome; it does not invent work or complete unstarted work on its own initiative.
All routes/replicas accepting mutations share the authoritative key state.

Restart/failover preserves retained outcomes, successful tombstones and claim
resolution. A restore unable to preserve this continuity cannot masquerade as the
same logical Scope/key namespace; Core's canonical-Scope/non-reuse rule applies.
No public epoch or request/receipt query is needed: retry the frozen invocation.

Adding/removing capabilities or withdrawing fresh execution does not erase issued
work, its bound recovery route, promised result window or compact successful-key
state. Preserve those obligations or refuse an incompatible configuration change.
Replay does not require a feature to remain open for new work. Inability to
compare/serve the original decision is truthful service failure, never permission
for new admission, truncation or silent fallback.

### Repetition without idempotency

A Scope that does not advertise `idempotency` executes every admitted request under
the ordinary rules, including a request a client repeats. It retains no disposition
and replays nothing. It ignores `Idempotency-Key`: the field is not validated, a
missing, repeated or malformed field is not refused, and it is never reinterpreted
as a selector. The Scope does not advertise `limits.retention.idempotency`.

The ordinary rules are the client's recovery. Once a first execution has changed
its target, a repeated `updateBead` or `updateLink` carrying the prior
`expectedRevision` fails `revision-mismatch`; if the first execution was a genuine
no-op, the repeat is one too. A repeated `deleteBead` or `deleteLink` of a target
the first execution deleted is `resource-not-found`. A repeated creation carrying
`id` is `identity-taken`. A repeated creation without `id` allocates a second
identity. A client that needs at-most-once creation SHOULD supply an unguessable
`id` where the provider admits one and, on `identity-taken`, read that identity to
establish whether its own request committed. A client MUST NOT infer replay from a
200 that happens to match an earlier result.

## Problems and diagnostics

<a id="readupdate-problem-details"></a>

Write uses Core's applicable direct Problem codes, family URIs, non-disclosure and
retry meanings, with these additions. A family suffix means
`https://github.com/gastownhall/bdp/problems/SUFFIX`. HTTP status agrees with a
supplied Problem `status`; `type`, `code` and `retry` are required.

| Code | Family suffix | Status | Retry |
| --- | --- | --- | --- |
| `unsupported-media-type` | `request` | 415 | `never` |
| `validation-failed` | `validation` | 422 | `never` |
| `type-not-installed` | `validation` | 422 | `after-state-change` |
| `identity-taken` | `conflict` | 409 | `never` |
| `alias-path-taken` | `conflict` | 409 | `after-state-change` |
| `revision-mismatch` | `conflict` | 409 | `after-state-change` |
| `incident-links-exist` | `conflict` | 409 | `after-state-change` |
| `aggregate-constraint-violation` | `conflict` | 409 | `after-state-change` |
| `idempotency-conflict` | `conflict` | 409 | `never` |
| `idempotency-in-progress` | `conflict` | 409 | `after-delay` |
| `idempotency-expired` | `gone` | 410 | `never` |
| `revision-allocation-unsafe` | `conflict` | 409 | `after-state-change` |

The `idempotency-*` codes arise only under `idempotency`. The singleton operations
have no sequence-only `binding-unavailable` case.
The presence of an inherited helper in a schema artifact does not select it.
`retryAfter`, when present, is a nonnegative integer transient-delay advice only
for `after-delay`, alongside applicable HTTP `Retry-After`. Ordinary Problems may
carry Core's optional title/detail/status/instance and permitted extensions;
declared conditional fields cannot contradict their code/retry meaning.

### Reference and operation failures

A malformed Reference shape/path, invalid JSON Pointer, invalid local-name use or
singleton `@name` is carrier syntax: `malformed-request`. An admissible subject
that resolves to no visible Resource of the required kind is
`resource-not-found`, not a kind inferred from a prefix. A canonical alias put
target that is an invisible/unknown Bead also uses `resource-not-found`.

A Link endpoint resolving to a Link rather than a Bead, an alias/Link/external put
target, forbidden external-endpoint policy, a nonobject edit result, missing
replace/remove target, Type/properties mismatch or owned-set overflow is
`validation-failed`. Type validation is conditional on actual Types semantics;
native invalidity still refuses. No complete required closure is
`type-not-installed`. A supplied identity ever committed is `identity-taken`;
a live alias at a proposed Resource identity is `alias-path-taken`. Endpoint
nonexistence/hiddenness remains the non-disclosing `resource-not-found` case.

Authorization failure is `forbidden`, except the stated uniform hidden-subject
rules. A supplied target guard mismatch is `revision-mismatch`; live incident
Links block Bead deletion. A Scope aggregate maximum violation is
`aggregate-constraint-violation`. Excess patch/resource/result bounds use the
ordinary applicable limit Problem. Persistent revision allocation unsafety uses
its write-only code and supplies no History read diagnosis, Resource/identity,
revision/provenance, properties/ownedLinks, missing/window or pointer disclosure.
Transient inspection remains unavailable. Identifier collision is an inherent
signal about the complete caller-selected URL, including hidden/deleted identity;
permission for alias put grants its corresponding cheaper collision probe.

### Validation diagnostics

Only `validation-failed` carries `diagnostics`/`diagnosticsTruncated`. It MUST carry
a nonempty bounded array of closed diagnostic entries:

| Member | Meaning |
| --- | --- |
| `message` | Required nonempty cause description |
| `type` | Failing effective Type URI, when the cause is an applicable Type contract |
| `schemaLocation` | Its absolute schema keyword location, paired with `type` |
| `instanceLocation` | Optional JSON Pointer within the failing document |
| `document` | Optional `properties` or `metadata`; omission means properties |

For a Type-contract failure every entry identifies the failing effective Type and
keyword location (`$id` plus JSON Pointer fragment). Owned overflow identifies
the owning Bead Type and its `ownsOutgoing` entry. For other causes `type` and
`schemaLocation` are absent and message names the cause. Those two members occur
together or not at all. A metadata failure MUST say `document:"metadata"` and
name metadata in its message. Empty instance pointer denotes that document's
root; a request-body pointer is not a position in the properties/metadata result.
A numeric failure in an unapplied patch may omit a not-yet-known instance pointer.

If bounding omits further diagnostics, advertise the applicable entry/UTF-8 byte
bounds, keep at least the first complete required entry in evaluation order and
set `diagnosticsTruncated:true`. With neither bound advertised return the complete
list. Do not truncate a required pointer or diagnostic. Request/properties/result
bounds and diagnostic metadata/provenance must be qualified jointly before
serving that configuration. A still-replayable list constrains later configuration:
refuse incompatible lowering or preserve a sufficient bound through lawful expiry,
never reformat/truncate the retained list to fit.

## Optional atomic batch, version 1

### Advertisement and explicit selection

The capability URI is
`https://github.com/gastownhall/bdp/capabilities/atomic-batch`. Its exact version
member `"1"` has a closed detail object:

| Member | Required | Meaning |
| --- | --- | --- |
| `operation` | yes | Absolute HTTP(S) POST target in the owning Scope |
| `operations` | yes | Nonempty unique subset of the six CRUD discriminators |
| `maximumOperations` | no | Positive integer member bound |
| `maximumResultBytes` | no | Positive integer complete inline-result byte bound |

No batch support is inferred from ordinary CRUD and support conveys no permission.
Unknown capability/version entries remain ignorable for base use. Follow the
advertised target; do not guess a path. A batch uses selected Write media, one
Idempotency-Key and a closed body with exactly `capabilityVersion:"1"` and a
nonempty `operations` array. No per-member key or carrier-wide provenance occurs.
The Types-required subtype independently selects Types when required.

Each member is a closed ordinary CRUD record plus required `operation` and,
for a creation only, optional `name`. The six exact discriminators are
`createBead`, `updateBead`, `deleteBead`, `createLink`, `updateLink`, `deleteLink`.
Aliases, reads, sets, nested batches and richer encodings are not members.
Unknown operation names are malformed; a recognized CRUD omitted from the
advertised subset is unsupported. Ordinary field grammar, object-mode exclusivity,
endpoint correction and provenance meanings are unchanged.

### Identity names

Names match `[A-Za-z][A-Za-z0-9_-]*`, are unique in the batch and bind only prior
creation identities. A later Bead/Link subject or endpoint may use `@name` only
in a slot of the right kind. Unknown, forward and wrong-kind handles refuse the
whole request. No handle is valid in Type input, caller-assigned ID, revision,
query/result path or arbitrary property strings. A pinned endpoint may combine
a prior Bead handle with a literal pin under applicable admission; it captures no
staged/future revision. Names have no member/property access or expression language.

Allocation and bindings become durable only with the atomic outcome. Rollback
leaves no committed handle. A creation/deletion pair can still report its
committed allocated identity, not a fabricated live Resource.

### Admission and refusal order

Ordinary authentication/non-disclosure, media, JSON/numeric and input bounds apply.
Then the authority:

1. Reads the selector. Missing, nonscalar or empty selector is malformed. For
   implemented version1 it checks the complete closed carrier/member syntax and
   static declaration/slot kinds, without fresh live operands/defaults/guards.
   A valid unknown version is not interpreted as version1; its refusal waits for
   retained-key handling.
2. Resolves retained identity/outcome or conflict in the shared namespace before
   fresh support. Comparison and result projection must remain possible during
   promised recovery after capability withdrawal. Inability is service failure,
   not permission to reexecute.
3. For new work, checks version and each recognized member's support, returning
   the first unsupported operation in request order. Unknown version refuses
   without interpreting its remaining body. No key is durably claimed and no
   effects occur from this preflight refusal.
4. Admits/stages the whole new group and commits its complete decision and
   terminal result together, or no effects. Admitted permanent failure retains
   its ordinary failed outcome. Client disconnection does not decide the result.

Unsupported version returns a closed feature Problem with request-family type,
HTTP422, `code:"capability-not-supported"`, `retry:"after-state-change"`, the
capability URI, requested `capabilityVersion`, and `pointer:"/capabilityVersion"`.
A disabled recognized member uses `operation-not-supported`, the same family/
status/retry, its requested `operation`, and `pointer:"/operations/I/operation"`.
Those feature Problems carry their specified selector fields, not an invented
receipt or generic fallback envelope. Ordinary failures keep ordinary shapes.
In-flight uses existing `idempotency-in-progress` or bounded waiting, not a public
pending Resource. No refusal permits dropping members, chunking or sequential
singleton fallback.

### Working graph and guards

Every member stages in authored order in one Scope/principal/contract/capability
context. All Resource, owner, allocation, fact and terminal-result effects are
one atomic decision. There is no supported prefix, skipping, non-atomic mode,
public intermediate version or staged readable address. Syntax, authorization,
guards, path policy, exact References and native constraints still apply.
Applicable Types final-graph allowances remain limited to their specified repairs.

An existing target's `expectedRevision` compares its committed baseline revision,
even on later staged edits of that Resource. Working liveness still applies:
a deletion does not make a subsequent update legal. A newly created target has
no committed baseline to satisfy a literal guard, so reject such a guard with
`revision-mismatch` rather than guess a token. Endpoint pins use actual retained
committed versions under applicable semantics, never a staged/future token.
Preserve/check baseline atomically under concurrency without exposing a public
Scope snapshot or epoch.

Input and complete inline result are bounded before commit. Result overflow
refuses the whole request under the ordinary limit Problem; never commit first
and discover that no complete outcome can be recorded. No truncation, result
pages or public receipt can substitute. Advertised feature bounds constrain new
admission, not classification of retained success. Configuration preserves
promised recovery under originally admitted bounds; temporary inability is a
service failure. Request/result budgets must support at least one admitted
operation; a provider MUST NOT advertise a capability it cannot implement.

## Final atomic publication

### Publish the final state once

Compare the final working graph with the committed baseline. Each final changed
live Resource/owner gets at most one new revision; each new surviving Resource
gets one creation revision. In the unextended batch contract, existing deleted
Resources get no new revision:
their final live published version is the pre-batch version even if staged edits
preceded deletion. Nothing publishes an intermediate version, Event or provenance.

A→B→A retains the original revision and complete envelope if final covered state
is equal and no other capture effect requires change. Input/path/guard policy
still checked the submitted attempts. Two separately committed decisions publish
two transitions; this rule never collapses history across decisions.

Surviving owners capture the complete final records of selected Links, with their
actual final revisions/affiliations. Compare initial and final membership and
capture once. Multiple Link changes plus explicit owner edits share one final
owner version. A deleted owner gets no intermediate version. An unchanged Link
alone does not force a new owner revision; owner retyping invents no versions for
unedited Links. Equal captured state preserves the recorded envelope, including
legacy bucket shape. Literal endpoint pins remain literal with no repin.

### Net no-op, allocation and attribution

An all-final-no-op succeeds with `changed:false`, no new Resource revision,
provenance, lifecycle fact or result transaction. Successful key state, witnesses
and complete outcome are still durable; that bookkeeping alone is not a semantic
effect. Creation then deletion consumes a canonical identity and is effectful,
with `changed:true` and an allocation-only final outcome. It has no fictional
Resource/version/affiliation or lifecycle Event. Two staged creates cannot reuse
the identity after staged deletion. Rollback consumes no allocation.

For each final new version, collect explicit provenance inputs from every member
directly targeting that Resource. For an owner also collect inputs from Link
members whose Link is owned by it initially or finally. Membership is evaluated
at decision boundaries, not invented intermediate owners. Supplied input requests
attribution of that final version even when the member's local edit is equal;
omission does not override supplied input. Equal explicit objects under ordinary
JSON equality select one; conflicting explicit objects refuse the entire batch
with `validation-failed`,422,never and ordinary diagnostics. Do not choose first/
last, concatenate or invent attribution. A diagnostic message may identify input
positions under disclosure rules without inventing a properties-document pointer.

Realize context once per published version from that input, or ordinary omitted
behavior if none. Valid context does not force a version; no-op envelopes remain
unchanged and deletion/allocation-only rows have no newly recorded attribution.
Input validation and retry identity still preserve every authored input/presence.

### Committed facts when Events is advertised

A Write Scope without Events still owes every atomic Resource, owner, allocation,
revision and durable key/outcome obligation in this document. It does not owe an
Event fact log solely by implementing Write; optional History is a separate promise.

When Events is advertised, Write MUST durably produce the [Events profile's required facts](../events/events.md)
together with its effects and terminal decision. The remainder of this subsection
applies to that advertised support. Crash/retry cannot lose facts or mint duplicate transitions.
Failure/rollback/no-op produces none; aliases and allocation-only outcomes produce
no Resource lifecycle fact. [Events](../events/events.md) owns the Event carrier, observation source,
coverage, projection, replay, authorization and gap rules.

For initially absent/finally live Resources produce one create fact; for live
changed Resources one update; for initially live/finally absent Resources one
delete. Include each induced owner once. Order the Scope's facts by canonical
Resource URI within the decision, keeping the source's fixed append order between
decisions. Required postimages are complete final published records, never a later
GET or temporary staged state. Deletion uses the actual final-live context, with
no new version. Any optional delta transforms initial recorded state into the
final state, rather than concatenating commands; unchanged fields are omitted.
Type-only effects need no fake property patch. Changed whole endpoint References
are represented as such; owner changes use Core's complete `derived.ownedLinks`
replacement. Facts are not executable requests: guards, keys, local names and
credentials are not fact input.

Each effectful decision has actual Scope-local transaction correlation for its
published Write facts. A Link correction emits one updateLink fact and each
changed owner one updateBead, sharing that correlation. Incident projection uses
preceding OR resulting published endpoints, deduplicating self-incidence, so a
departing endpoint can observe the same correction. No linked/unlinked operation
or endpoint revision is invented merely for citation. Exact required postimage
size/retention feasibility is protected before effects commit; later size failure
cannot justify dropping or truncating a required fact.

## Atomic batch results and recovery

HTTP200 returns the closed `atomicBatchResult`:

| Member | Meaning |
| --- | --- |
| `capabilityVersion` | Exactly `"1"` |
| `changed` | Boolean OR of final Resource-row flags, including allocation effects |
| `transaction` | Required opaque Scope-unique correlation if changed; absent for all-final-no-op |
| `results` | Nonempty ordered identity mapping per input member |
| `resources` | Nonempty unique final Resource outcomes, ordered by canonical URI |

Each closed mapping has zero-based `operationIndex`, `operation`, absolute `id`,
and `operationName` exactly when the corresponding creation supplied a name. It
carries no intermediate body, revision, changed flag or execution outcome. Every
mapping resolves to a final row of the right kind. Results distinguish ordered
input identities from unique final outcomes, including induced owning sources.

Each row has `id`, `resourceKind`, `outcome`, `changed` and exactly its applicable
body/context:

| Outcome | Required final meaning |
| --- | --- |
| `created` | Initially absent/finally live; changed true; complete final `resource` with its creation revision |
| `updated` | Initially/finally live and net covered state differs; changed true; complete final `resource` with one new revision |
| `unchanged` | Initially/finally live and covered state equal; changed false; complete original `resource`/envelope |
| `deleted` | Initially live/finally absent; changed true; `deleted` identity with final-live published revision; no resource body |
| `allocated` | Initially/finally absent but committed creation consumes identity; changed true; id/kind only, no resource/deleted body, revision, type or owner context |

Live rows omit optional incident-Link aggregates; id/kind, record and revision
must agree. Deleted identity/kind also agree. Nonallocated Link rows use complete
`ownerRevisions` for distinct initial OR final owners and include each owner's
unique row, even if that owner is deleted. Evaluate A→B→C at boundaries, not a
fictional published B owner effect. Unowned and allocated rows omit owner context.
Equal revision strings across Resources are allowed but never required;
transaction is the correlation, not a global revision, position or receipt.

### One key and retained whole outcomes

One batch has one ordinary key in the shared Scope/principal namespace. Batch1
and singleton are distinct execution contexts even for one equivalent member;
reusing a key across them conflicts. Normalize complete ordinary values and
References, preserving operation/patch/array order, field presence, replacement
versus patch, authored Type intent, guards, provenance and original witnesses.
Creation labels normalize to creator slots, not independent identities. Unknown
or failed handles are not resolved into new work.

An equivalent retained request with renamed labels projects `operationName` from
its requesting create at the same index. Original identities, final outcomes,
transaction and alias/Type witnesses remain unchanged. If the new projection
exceeds the admitted output budget, refuse without truncation, forgetting success
or executing again; recovery of the original frozen request remains promised.
A current alias/default/new file value never reexecutes a key.

Commit all effects, allocations, witnesses, facts and bounded result as one durable
unit. Successful no-op keeps anti-reexecution state for the Scope lifetime; finite
failed detail can expire because it committed nothing. Retained full results are
disclosed only when current authorization permits the complete result. No silent
per-entry hiding, successful prefix or reinterpretation as new writes is allowed.
Expired unavailable detail is `idempotency-expired`; controlled erasure and
non-disclosure use existing truthful Problems, never erased bytes. Temporary
inability is a service failure. Capability withdrawal or unreachable recovery
never permits dropping successful-key state or repeating effects. Rendering or
transport failure does not change a known decision or imply rollback.

## Optional rooted allocation, version 1

The capability URI is `https://github.com/gastownhall/bdp/capabilities/id-root`;
exact version `"1"` has closed empty detail `{}`. Only Write advertises it and
advertisement promises both ordinary Bead and Link creation. It conveys no
authorization or Types support; unknown versions do not establish version1.

Presence of `idRoot` in a grammar-owned create position selects this fixed string
form on the SAME createBead/createLink target, media and key. It is required for
this selected form and mutually exclusive with `id`. Without it the ordinary
create request is unchanged. A property/metadata string/member named idRoot does
not select anything. Top-level idRoot on update/delete/alias/read/unknown operation
is malformed. No wrapper/member idRootVersion, new endpoint or media parameter
is admitted; a future version needs another rejectable selector and cannot
reinterpret this string. A base closed receiver rejects the new member.

After ordinary carrier/key admission and known-key comparison, a fresh invocation
without selected support receives feature-local `capability-not-supported`,
request family/422/after-state-change, capability URI, `capabilityVersion:"1"`
and pointer `/idRoot`, or `/operations/N/idRoot` for a selecting batch create.
Do not interpret unsupported extension values as another grammar. Supported
invalid root/type/endpoint input uses its ordinary refusal. No fabricated explicit
ID, singleton fallback or new key is automatic recovery. Issued recovery survives
withdrawal under the ordinary rules.

### Canonical prefix and one suffix

`idRoot` is a nonempty canonical local prefix without leading/trailing slash.
For `projects/alpha` the authority allocates exactly one safe opaque suffix segment
and returns the full absolute identity `projects/alpha/<opaque-segment>` under
its Scope. It returns no template or client interpolation. The prefix need not
be an existing Resource and no prefix Resource is created.

Apply Core's local path rules: no dot/empty segments, controls, backslash,
query/fragment, absolute/scheme-relative URI or encoded separator; exactly one
percent decode with valid UTF-8, literal unreserved characters and uppercase
required escapes, no Unicode normalization. Prefixes are literal, not handles,
result paths, Type locators or alias-resolution requests. `URI@2` remains literal
URI syntax, not a new revision parser. Lexical schema checks do not prove UTF-8
or namespace/allocation authority: for example `a%FF` must fail service admission.
The complete root+suffix remains subject to identity, live-alias, navigation,
Scope-containment and configured bounds. A provider unable to support a root
safely refuses rather than silently allocating elsewhere.

Reserve the chosen identity, Resource/owner effects, facts and key outcome
atomically or none, preserving lifetime non-reuse and concurrency guarantees.
There is no client collision scan, entropy/counter promise, kind prefix,
pre-created directory or permission bypass. Root selection changes no Type,
endpoint, policy, guard, provenance, ownership or final-publication rule. Types
resolution is service-side once; the client does not fetch a definition to
manufacture an allocation result. Return the ordinary complete mutation result
with actual id and accepted Type/postimage; no root/suffix result fields are added.

The root and capability belong to frozen semantic identity. Same-meaning replay
returns the original allocated id/Type/postimage even if default/support/live state
changed, under ordinary authorization and expiry. It never reallocates or resolves
a fresh default. Changed meaning conflicts; expired successful keys never execute.

### Explicit composition with atomic-batch1

When both capabilities are advertised, rooted creation also uses the SAME batch1
operation. The wrapper is still `capabilityVersion:"1"` plus operations. Presence
at a create member selects the feature-owned extended carrier, which requires
at least one rooted create. Other creates may omit both allocation selectors or
supply ordinary id; no create supplies both id and idRoot. No extra wrapper/member
version selector is added. The six CRUD kinds, member names and prior identity
bindings retain their meaning; a root never interpolates `@name`.

The feature companion closes extended create arms and reuses the existing four
update/delete arms. A no-root batch retains its original closed grammar. Both
capabilities and member operation support are required. Whole-group allocation,
complete bounded final results, create/delete allocation effects, final-state
publication and recovery remain atomic. This selects no batch2/query/set/alias/
sequence feature and no partial/chunked execution.

## Optional deletion modes, version 1

### Advertisement and selection

The capability URI is
`https://github.com/gastownhall/bdp/capabilities/delete-modes`. Its exact version
member `"1"` has a closed detail object:

| Member | Required | Meaning |
| --- | --- | --- |
| `atomicBatch` | yes | Boolean; whether `blockedBy` is admitted on atomic-batch1 members |
| `except` | yes | Boolean; whether `cascade.except` is admitted |
| `maximumClosure` | no | Positive integer bound on the Beads one request deletes |
| `typeEffects` | no | Unique nominal Type URIs whose [declared deletion effects](#type-declared-deletion-effects) this Scope applies |

Only Write advertises it. Advertisement promises the complete behavior below and
conveys no authorization. Everything except batch composition is independent of
atomic-batch1. `atomicBatch:true` requires advertised atomic-batch1 with `deleteBead`
in its `operations`; a Scope advertising otherwise is invalid and a client refuses
it. Unknown versions do not establish version1.

Presence of `beads`, `blockedBy`, `cascade` or `dryRun` on a `deleteBead` body selects
this form on the SAME target, media and key. A request carrying none of them keeps
the ordinary grammar, deletion rule, result carrier and Problem codes. A base closed
receiver rejects these members.

| Member | Value | Meaning |
| --- | --- | --- |
| `bead` | Reference | The one named Bead |
| `beads` | Nonempty array of unique References | The named Beads; exactly one of `bead` and `beads` is present |
| `expectedRevision` | Revision | Guard on `bead`; refused beside `beads` |
| `blockedBy` | `"any"`, `"inbound"` or `"none"` | Which crossing Links refuse the request; omission means `"any"` |
| `cascade` | Closed `{through,except?}` | Extends the deleted set |
| `dryRun` | Boolean; omission means `false` | Reports the outcome without effects |

Supplying both `bead` and `beads`, neither, a repeated array element, or
`expectedRevision` beside `beads` is `malformed-request`. Each element is a Bead
subject under the [ordinary rules](#ordinary-requests). Two different spellings of one
Bead name it once. `expectedRevision` guards the named Bead only, and no mode bypasses
it. This form admits no `revisionProvenance`. Every Reference must resolve to a visible
live Bead; otherwise the whole request is the uniform `resource-not-found`, which does
not say which Reference failed, and nothing is deleted.

| Intent | `blockedBy` | `cascade` |
| --- | --- | --- |
| Refuse while any Link crosses the deleted set | `any` | omitted |
| Remove crossing Links; survivors stay | `none` | omitted |
| Delete a tree; remove other crossing Links | `none` | `{through}` |
| Refuse on a crossing Link whose target is deleted; remove the others | `inbound` | omitted |
| Delete a tree; refuse if anything outside it is attached | `any` | `{through}` |

After ordinary carrier/key admission and known-key comparison, a fresh invocation
without selected support receives feature-local `capability-not-supported`,
request family/422/after-state-change, its capability URI, `capabilityVersion:"1"`
and a pointer. The pointer names the first of `/beads`, `/blockedBy`, `/cascade` and
`/dryRun` present. `except:false` refuses `/cascade/except` this way, and
`atomicBatch:false` refuses the first selecting batch member at
`/operations/N/blockedBy`. Missing advertisement causes a feature-aware client to
refuse before fresh dispatch. A supporting receiver never discards a selector or
substitutes another mode. No selector stripping, new key or sequential singleton
fallback is automatic recovery. Issued recovery survives withdrawal under the
ordinary rules.

### Deleted set

The deleted set contains every named Bead and, under `cascade`, every Bead the walk
below admits. It is resolved in the deciding transaction under the
[serializable outcome rule](#admission-authorization-and-limits), so a matching
`expectedRevision` does not pin it.

`cascade.through` is the closed `{type,match}` pair of the single Link Type test
in Core's [`graph` profile](../core/core.md#list-graph-and-query-subsets). `type`
is an unpinned absolute nominal Type identity. `match` is `exact` or `family`, with
the meanings of Core's `typeIs`. A `family` test without its required authority
refuses `type-not-installed`; there is no exact-only fallback.

The walk is rooted at every named Bead, in Core's `incoming` direction, with no
semantic depth bound. At each reached Bead it inspects the live Links whose target
is that Bead. A Link passing the test admits its source. A Link failing the test
is not followed and remains subject to blocking. Each Bead expands at most once,
so cycles, back Links, self-Links and parallel Links terminate, and a named Bead
reachable from another named Bead is deleted once, with one row. A test matching no
Link leaves the named Beads alone in the deleted set.

Endpoints match by Reference URI, whether floating or pinned. A pin neither
excludes a Link from the walk nor changes. An external endpoint is not acquired,
admitted or expanded; it is outside the deleted set.

`cascade.except` is the closed `{bind,predicate}` pair: a Core binding name and a
Core predicate node within the local filter subset admitted by Core's `list`
profile. A malformed predicate or one outside that subset is `malformed-request`.
The predicate evaluates each Bead the walk reaches, bound to its current state. A
true result exempts that Bead: it joins no deleted set and does not expand, so a
subtree reached only through it survives. Its connecting Link is then a crossing
Link. A predicate true of a named Bead refuses the whole request with
`validation-failed`.

### Blocking Links

A crossing Link is a live Link with exactly one endpoint in the deleted set. Its other
endpoint is a surviving Bead or an external endpoint. A Link with both endpoints in
the deleted set, including a self-Link, never blocks and is removed.

| `blockedBy` | Crossing Link whose target is deleted | Crossing Link whose source is deleted |
| --- | --- | --- |
| `any` | Refuses | Refuses |
| `inbound` | Refuses | Removed |
| `none` | Removed | Removed |

A refusal is the ordinary `incident-links-exist`. A removed Link is deleted as an
owned-capable `deleteLink` deletes it: it gets no new revision, and its identity stays
reserved. The authority then validates the complete final graph under Types and Scope
aggregate rules, including the arity and endpoint eligibility of surviving Beads. A
violation refuses the whole request; a deletion mode performs no repair.

Steps 1 through 9 of the [fresh order](#admission-authorization-and-limits) apply
to each named Bead, so a guard outranks blocking. Step 10 resolves the deleted
set, applies [visibility](#visibility-and-authorization-of-deletion-modes), then
blocking, then [declared effects](#type-declared-deletion-effects), then
authorization of every other deletion, removal, owner effect and declared effect,
then final-graph validation. A deleted set over `maximumClosure` or a configured
work bound refuses with `limit-exceeded`. A bound never truncates the walk or
treats an unexpanded Bead as exhausted. The complete inline result is bounded
before commit under the [batch rule](#working-graph-and-guards).

### Type-declared deletion effects

A Type MAY declare, in its semantic contract, effects that deleting one of its
Beads has on surviving Beads joined to that Bead by an incident Link. Write defines
no effect language, and the meaning of a declared effect belongs to the Type. Where
Types applies, the declaration is that of the exact definition the deleted Bead
affiliates with.

`typeEffects` lists the Types whose declared effects this Scope applies. An effect
applies when the deleted Bead's affiliation URI, ignoring any definition pin, is
listed. Listing promises the effects on every deletion of such a Bead, selected or
not. A Scope that omits `typeEffects`, or does not advertise this capability,
applies no effect. An authority applies only declared effects of a listed Type.

A surviving Bead is joined when a Link incident upon the deleted Bead, in either
direction, is live in the committed baseline or, in a batch, the final working graph,
and its other endpoint is an in-Scope Bead outside the deleted set. An effect reaches
only joined Beads, of any Type, and does not reach an external endpoint. A change an
effect makes triggers no further effect.

An effect changes only a survivor's `properties` and `metadata`. It deletes no Bead
and changes no Link, affiliation or identity, so it neither extends the deleted set
nor answers a blocking refusal. Effects apply once, after Link removal and after the
last batch member, to the final state. Several effects on one survivor apply in
ascending code-unit order of the deleted Bead's canonical URI. A survivor gets at
most one new revision, shared with any owner effect or explicit edit. An unchanged
complete covered state is the ordinary no-op, with no revision and no row of its
own. Caller-input and `propertyAccess` restrictions do not bind an effect. Final-graph
validation does, and a failure refuses the whole request. Effects commit in the same
atomic decision as the deletion, or not at all.

An ordinary singleton `deleteBead` succeeds only when no Link is incident, so it
joins no survivor and its `mutationResult` is unchanged. An ordinary atomic-batch1
`deleteBead` whose Links other members removed or moved can join one, and its
`atomicBatchResult` reports that change as an ordinary `updated` row.

### Composition with atomic-batch1

Atomic batch is not required to delete several Beads. Inside a batch, under
`atomicBatch:true`, a `deleteBead` member may carry `blockedBy` under the closed feature
batch grammar on the advertised target. `beads`, `cascade` and `dryRun`, and a request
carrying an `idRoot` or `fromRevision` selector beside `blockedBy`, are outside that
grammar and are `malformed-request`. Members stage in authored order under the
[working graph rules](#working-graph-and-guards), with these additions.

At its position a selecting member checks its named Bead's working liveness and
compares any `expectedRevision` with the committed baseline. The named Bead then
leaves working liveness, so a later member naming it is `resource-not-found` and a
later Link cannot use it as an endpoint. Its incident Links stay in the working
graph, where later members may update or delete them.

After the last member, the deleted set is every Bead named by a selecting member, and
blocking, removal and validation apply once to the final working graph. Each crossing
Link is evaluated under the `blockedBy` of the member naming its deleted endpoint.

A `deleteBead` member with no selecting member keeps the ordinary rule at its
position: any Link live there refuses it, including a Link incident upon a Bead
that another member named. With a Link between `a` and `b`:

| Members | Outcome |
| --- | --- |
| `deleteBead a`, `deleteBead b` | `incident-links-exist` at the first member |
| Both with `blockedBy:"any"` | Succeeds; the Link is removed |
| Both with `blockedBy:"inbound"` | Succeeds; the Link is removed |
| `deleteBead a` with `blockedBy:"any"`, then `deleteBead b` with no selector | `incident-links-exist` at the second member |
| `deleteBead a` alone with `blockedBy:"any"` | `incident-links-exist` |

### Dry run

`dryRun:true` evaluates the admission, guard, deleted-set, visibility, blocking,
authorization, validation and bound rules against the current graph. It returns
the Problem the committing request would return at that moment and otherwise the
closed `deleteModesPreview`. It reports the declared effects the committing request
would apply. It changes nothing: it mints no revision, allocation, provenance or
Event fact.

Under `idempotency` a dry run carries the ordinary `Idempotency-Key` and is
compared with retained key state, so it can receive `idempotency-conflict` or
`idempotency-in-progress`. It claims no key and retains no disposition, witness or
compact state. A repeated dry run evaluates the current graph again. A preview
reserves nothing and does not promise that a later committing request succeeds.

### Results

A successful committing request returns the closed `deleteModesResult`: the
[`atomicBatchResult` members](#atomic-batch-results-and-recovery) with their meanings,
plus `removedLinks`. `changed` is always true and `transaction` is always present.
`results` has one mapping per named Reference, with `operation:"deleteBead"` and
`operationIndex` its position in `beads`, or zero for `bead`; in a batch it has one
mapping per input member. `resources` has the unique final rows, with ordinary batch
members keeping their ordinary rows:

| Resource | Row |
| --- | --- |
| Bead in the deleted set | `deleted`, with its final live identity; `allocated` when the same batch created it |
| Removed Link | `deleted`, with `ownerRevisions` for its initial owners; `allocated` when the same batch created it |
| Surviving Bead whose covered state changes | `updated`, with its complete final record and one new revision |

`removedLinks` has one closed `{id,source,target}` entry per `deleted` Link row,
ascending by canonical id, with its final live recorded References. A request with
no selecting member returns its ordinary `mutationResult` or `atomicBatchResult`.

`deleteModesPreview` has `capabilityVersion`, `dryRun:true`, `changed:false`,
`results`, `resources` and `removedLinks`, and no `transaction`. Each row has `id`,
`resourceKind` and `outcome`. A `deleted` row has the `deleted` identity the
committing request would report. An `updated` row has the Bead's current `revision`
and no record, because nothing is minted. When a declared effect would change that
Bead, the row also has `proposed`, with the would-be final value of each changed
object plane.

### Visibility and authorization of deletion modes

Hidden Resources are never deleted, removed or newly versioned by this form, and
the deleted set does not depend on what the principal can see. The request refuses
with `incident-links-exist`, under every `blockedBy` value and under `dryRun`, when
a hidden Link is incident upon the deleted set, when a Link passing the test admits
a hidden Bead, when a surviving owner that would gain a revision is hidden, or when
a hidden Bead is joined to a deleted Bead whose Type is listed in `typeEffects`.
This Problem names no Resource and carries no count, Type, path or position. The
authority evaluates neither `through`, `except` nor a declared effect on the hidden
Resource, so the outcome does not depend on its Type or content. The rule for a
joined hidden Bead also binds an ordinary batch member.

Each named Bead, each other deleted Bead, each removed Link and each surviving Bead
that gains a revision requires write authorization, and a denial of a visible
Resource is `forbidden` for the whole request. Scope policy observes the proposed
post-state and MAY authorize a declared effect on the strength of the deletion.

### Revisions, retry, Events and recovery

Deletion of each Bead and removal of each Link follow
[identity non-reuse](#creation-and-identity-allocation),
[final atomic publication](#final-atomic-publication) and the batch rules of
[complete owner revision context](#complete-owner-revision-context), so a selected
singleton carries inline owner records in its rows. A deleted owner is reported at
its final live published revision. A surviving owner captures its complete final
Links once and gets one new revision. This form supplies no attribution input; a batch
collects any other member's under the
[batch attribution rule](#net-no-op-allocation-and-attribution).

Under `idempotency`, the choice of `bead` or `beads`, the order of `beads`, `blockedBy`,
`cascade`, `dryRun` and their presence belong to frozen semantic identity, so an omitted
`blockedBy` and an explicit `"any"` are different invocations. Each element of `beads`
keeps its own alias witness. A retained committing request replays its original complete
result with its original deleted set, rows, `removedLinks` and `transaction` under
[retained whole outcomes](#one-key-and-retained-whole-outcomes). It does not resolve a
Reference or walk again, apply an effect again or consult current `through`, `except`,
`typeEffects`, definition or graph state. Survivor rows belong to the whole result, so a
survivor later hidden from the principal withholds it under that rule. Without
`idempotency`, repeating a committing request any of whose named Beads was deleted is
`resource-not-found`.

Where Events is advertised, the request is one decision under
[committed facts](#committed-facts-when-events-is-advertised): one `deleteBead` fact
per deleted Bead, one `deleteLink` fact per removed Link, one `updateBead` fact per
changed survivor, including one a declared effect changed, and one transaction
correlation. The same holds for an ordinary batch that a declared effect reaches.

Under historical-update1 each effectful deleted Bead commits its own
[terminal version](#body-free-terminal-versions-and-narrow-authorized-read).
Recovering one is an ordinary single-Bead recovery of that identity. It revives no
removed Link and no other deleted Bead, and it reverses no declared effect.

An alias is not a Link: it neither blocks nor extends a walk, and a deletion mode
changes no alias. A named alias resolves under the ordinary rules. An instance's `type`
affiliation is not a Link either, so deleting a Type-definition Bead neither blocks on
nor reaches its instances. Types lifecycle obligations apply to every Bead in the
deleted set and a refusal refuses the whole request.

## Conformance boundary

A Write provider must implement the six Resource operations, the two alias
operations when it advertises `aliases`, their complete outcomes, fact production required by advertised Events, native/admitted Types constraints,
authorization, concurrency safety and, under `idempotency`, durable key/recovery
duties. Without it, the rows of [Repetition without idempotency](#repetition-without-idempotency)
apply. Optional
capability advertisement requires its complete selected behavior and bounds; it
never replaces ordinary obligations. Ordinary reads retain Core meaning: an
authoritative result does not promise that another replica immediately observes
it, or add read-your-writes checkpoints, a public epoch or hot-tier absence shortcut.

Nonatomic sequence, public mutation receipts, replica synchronization, historical
Link recovery, unselected historical-update feature compositions,
parameterized/richer batch encodings, native Query, set writes and public Type
registration/lifecycle operations are not selected by this text. Historical Bead
Update and recovery are the separately selected optional capability above; they
are not mandatory ordinary Write duties. Existing historical contracts retain their own meanings. Structural
schema examples and source publication do not establish provider, CLI, transaction,
concurrency, crash/retry or consumer qualification.

## Schemas

These visible markdown-json-schema/0.6 fragments own the selected Write definitions
in the shared bundle. Shared Resource carriers are defined by Core and Events.
The id-root and delete-modes fragments retain their separate schema resources and
reference contexts.

<!-- bdp-schema:start aliasResult -->
### Schema: "aliasResult"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Read+Update alias result" |
| type | "object" |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/aliasResultMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end aliasResult -->

<!-- bdp-schema:start aliasResultMembers -->
### Schema: "aliasResultMembers"

Value: object

Required order: ["outcome","alias"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "alias" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "outcome" | ref "#/$defs/mutationOutcome" | yes | — | — |
| "target" | ref "#/$defs/absoluteHttpUrl" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "outcome": {
            "const": "deleted"
          }
        },
        "required": [
          "outcome"
        ]
      },
      "then": {
        "properties": {
          "target": false
        }
      },
      "else": {
        "required": [
          "target"
        ]
      }
    }
  ]
}
```
<!-- bdp-schema:end aliasResultMembers -->

<!-- bdp-schema:start atomicBatchCapabilityProblem -->
### Schema: "atomicBatchCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","capability","capabilityVersion","pointer"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | — |
| "capabilityVersion" | schema | yes | — | — |
| "code" | schema | yes | — | — |
| "detail" | text | no | — | — |
| "instance" | ref "#/$defs/absoluteUri" | no | — | — |
| "pointer" | schema | yes | — | — |
| "retry" | schema | yes | — | — |
| "status" | schema | yes | — | — |
| "title" | text | no | — | — |
| "type" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/atomic-batch"
    },
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    },
    "code": {
      "const": "capability-not-supported"
    },
    "pointer": {
      "const": "/capabilityVersion"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```
<!-- bdp-schema:end atomicBatchCapabilityProblem -->

<!-- bdp-schema:start atomicBatchCapabilityV1 -->
### Schema: "atomicBatchCapabilityV1"

Value: object

Other fields: not allowed

Required order: ["operation","operations"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "maximumOperations" | schema | no | — | — |
| "maximumResultBytes" | schema | no | — | — |
| "operation" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "operations" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "maximumOperations": {
      "type": "integer",
      "minimum": 1
    },
    "maximumResultBytes": {
      "type": "integer",
      "minimum": 1
    },
    "operations": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "#/$defs/atomicBatchOperationName"
      }
    }
  }
}
```
<!-- bdp-schema:end atomicBatchCapabilityV1 -->

<!-- bdp-schema:start atomicBatchOperationName -->
### Schema: "atomicBatchOperationName"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["createBead","updateBead","deleteBead","createLink","updateLink","deleteLink"] |
<!-- bdp-schema:end atomicBatchOperationName -->

<!-- bdp-schema:start atomicBatchOperationProblem -->
### Schema: "atomicBatchOperationProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","operation","pointer"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "code" | schema | yes | — | — |
| "detail" | text | no | — | — |
| "instance" | ref "#/$defs/absoluteUri" | no | — | — |
| "operation" | ref "#/$defs/atomicBatchOperationName" | yes | — | — |
| "pointer" | schema | yes | — | — |
| "retry" | schema | yes | — | — |
| "status" | schema | yes | — | — |
| "title" | text | no | — | — |
| "type" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "code": {
      "const": "operation-not-supported"
    },
    "pointer": {
      "type": "string",
      "pattern": "^/operations/(0|[1-9][0-9]*)/operation$"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```
<!-- bdp-schema:end atomicBatchOperationProblem -->

<!-- bdp-schema:start atomicBatchProblem -->
### Schema: "atomicBatchProblem"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Existing ordinary Write Problems or the two feature-specific refusal forms; no public receipt failure carrier." |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/readUpdateProblem"
    },
    {
      "$ref": "#/$defs/atomicBatchCapabilityProblem"
    },
    {
      "$ref": "#/$defs/atomicBatchOperationProblem"
    }
  ]
}
```
<!-- bdp-schema:end atomicBatchProblem -->

<!-- bdp-schema:start atomicBatchResourceResult -->
### Schema: "atomicBatchResourceResult"

Value: object

Other fields: not allowed

Required order: ["id","resourceKind","outcome","changed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "changed" | boolean | yes | — | — |
| "deleted" | ref "#/$defs/deletedIdentity" | no | — | — |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "outcome" | schema | yes | — | — |
| "ownerRevisions" | ref "#/$defs/ownerRevisions" | no | — | — |
| "resource" | schema | no | — | — |
| "resourceKind" | ref "#/$defs/resourceKind" | yes | — | — |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "required": [
        "resource"
      ],
      "properties": {
        "resource": true,
        "outcome": {
          "enum": [
            "created",
            "updated"
          ]
        },
        "changed": {
          "const": true
        },
        "deleted": false
      },
      "type": "object"
    },
    {
      "required": [
        "resource"
      ],
      "properties": {
        "resource": true,
        "outcome": {
          "const": "unchanged"
        },
        "changed": {
          "const": false
        },
        "deleted": false
      },
      "type": "object"
    },
    {
      "required": [
        "deleted"
      ],
      "properties": {
        "deleted": true,
        "outcome": {
          "const": "deleted"
        },
        "changed": {
          "const": true
        },
        "resource": false
      },
      "type": "object"
    },
    {
      "properties": {
        "outcome": {
          "const": "allocated"
        },
        "changed": {
          "const": true
        },
        "resource": false,
        "deleted": false,
        "ownerRevisions": false
      }
    }
  ],
  "allOf": [
    {
      "if": {
        "required": [
          "resourceKind"
        ],
        "properties": {
          "resourceKind": {
            "const": "bead"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "resource": {
            "$ref": "#/$defs/beadRecord"
          },
          "deleted": {
            "type": "object",
            "properties": {
              "resourceKind": {
                "const": "bead"
              }
            }
          },
          "ownerRevisions": false
        }
      }
    },
    {
      "if": {
        "required": [
          "resourceKind"
        ],
        "properties": {
          "resourceKind": {
            "const": "link"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "resource": {
            "$ref": "#/$defs/linkRecord"
          },
          "deleted": {
            "type": "object",
            "properties": {
              "resourceKind": {
                "const": "link"
              }
            }
          }
        }
      }
    }
  ],
  "properties": {
    "outcome": {
      "enum": [
        "created",
        "updated",
        "unchanged",
        "deleted",
        "allocated"
      ]
    },
    "resource": {
      "oneOf": [
        {
          "allOf": [
            {
              "$ref": "#/$defs/beadRecord"
            },
            {
              "type": "object",
              "properties": {
                "links": false
              }
            }
          ]
        },
        {
          "$ref": "#/$defs/linkRecord"
        }
      ]
    }
  }
}
```
<!-- bdp-schema:end atomicBatchResourceResult -->

<!-- bdp-schema:start atomicBatchResult -->
### Schema: "atomicBatchResult"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","changed","results","resources"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |
| "changed" | boolean | yes | — | — |
| "resources" | schema | yes | — | — |
| "results" | schema | yes | — | — |
| "transaction" | ref "#/$defs/revision" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "required": [
          "changed"
        ],
        "properties": {
          "changed": {
            "const": false
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "transaction": false,
          "resources": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "changed": {
                  "const": false
                }
              }
            }
          }
        }
      },
      "else": {
        "required": [
          "transaction"
        ],
        "properties": {
          "transaction": true,
          "resources": {
            "type": "array",
            "contains": {
              "type": "object",
              "required": [
                "changed"
              ],
              "properties": {
                "changed": {
                  "const": true
                }
              }
            }
          }
        },
        "type": "object"
      }
    }
  ],
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "resources": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "#/$defs/atomicBatchResourceResult"
      }
    },
    "results": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/atomicBatchResultEntry"
      }
    }
  }
}
```
<!-- bdp-schema:end atomicBatchResult -->

<!-- bdp-schema:start atomicBatchResultEntry -->
### Schema: "atomicBatchResultEntry"

Value: object

Other fields: not allowed

Required order: ["operationIndex","operation","id"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "operation" | ref "#/$defs/atomicBatchOperationName" | yes | — | — |
| "operationIndex" | schema | yes | — | — |
| "operationName" | ref "#/$defs/localName" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "type": "object",
        "required": [
          "operation"
        ],
        "properties": {
          "operation": {
            "enum": [
              "updateBead",
              "deleteBead",
              "updateLink",
              "deleteLink"
            ]
          }
        }
      },
      "then": {
        "properties": {
          "operationName": false
        }
      }
    }
  ],
  "properties": {
    "operationIndex": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```
<!-- bdp-schema:end atomicBatchResultEntry -->

<!-- bdp-schema:start atomicBatchSelection -->
### Schema: "atomicBatchSelection"

Value: object

Other fields: allowed

Required order: ["capabilityVersion"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Prefix selection only, not admission as a complete request. Unknown well-formed versions refuse without interpreting their body." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end atomicBatchSelection -->

<!-- bdp-schema:start batchOperation -->
### Schema: "batchOperation"

Value: object

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/createBeadOperation"
    },
    {
      "$ref": "#/$defs/updateBeadOperation"
    },
    {
      "$ref": "#/$defs/deleteBeadOperation"
    },
    {
      "$ref": "#/$defs/createLinkOperation"
    },
    {
      "$ref": "#/$defs/updateLinkOperation"
    },
    {
      "$ref": "#/$defs/deleteLinkOperation"
    }
  ]
}
```
<!-- bdp-schema:end batchOperation -->

<!-- bdp-schema:start batchRequest -->
### Schema: "batchRequest"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","operations"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP optional atomic batch version 1 request" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |
| "operations" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "operations": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/batchOperation"
      }
    }
  }
}
```
<!-- bdp-schema:end batchRequest -->

<!-- bdp-schema:start createBeadMembers -->
### Schema: "createBeadMembers"

Value: object

Required order: ["type"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/durableResourceReference" | no | — | — |
| "metadata" | ref "#/$defs/metadata" | no | — | — |
| "properties" | ref "#/$defs/properties" | no | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "type" | ref "#/$defs/typeReference" | yes | — | — |
<!-- bdp-schema:end createBeadMembers -->

<!-- bdp-schema:start createBeadOperation -->
### Schema: "createBeadOperation"

Value: object

Required order: ["operation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "name" | ref "#/$defs/localName" | no | — | — |
| "operation" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "createBead"
    }
  }
}
```
<!-- bdp-schema:end createBeadOperation -->

<!-- bdp-schema:start createBeadRequest -->
### Schema: "createBeadRequest"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createBeadMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end createBeadRequest -->

<!-- bdp-schema:start createLinkMembers -->
### Schema: "createLinkMembers"

Value: object

Required order: ["type","source","target"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/durableResourceReference" | no | — | — |
| "metadata" | ref "#/$defs/metadata" | no | — | — |
| "properties" | ref "#/$defs/properties" | no | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "source" | ref "#/$defs/inputReference" | yes | — | — |
| "target" | ref "#/$defs/inputReference" | yes | — | — |
| "type" | ref "#/$defs/typeReference" | yes | — | — |
<!-- bdp-schema:end createLinkMembers -->

<!-- bdp-schema:start createLinkOperation -->
### Schema: "createLinkOperation"

Value: object

Required order: ["operation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "name" | ref "#/$defs/localName" | no | — | — |
| "operation" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "createLink"
    }
  }
}
```
<!-- bdp-schema:end createLinkOperation -->

<!-- bdp-schema:start createLinkRequest -->
### Schema: "createLinkRequest"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "source" | ref "#/$defs/durableInputReference" | no | — | — |
| "target" | ref "#/$defs/durableInputReference" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createLinkMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end createLinkRequest -->

<!-- bdp-schema:start deleteAliasMembers -->
### Schema: "deleteAliasMembers"

Value: object

Required order: ["alias"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "alias" | ref "#/$defs/durableResourceReference" | yes | — | — |
<!-- bdp-schema:end deleteAliasMembers -->

<!-- bdp-schema:start deleteAliasRequest -->
### Schema: "deleteAliasRequest"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteAliasMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end deleteAliasRequest -->

<!-- bdp-schema:start deleteBeadMembers -->
### Schema: "deleteBeadMembers"

Value: object

Required order: ["bead"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "#/$defs/resourceReference" | yes | — | — |
| "expectedRevision" | ref "#/$defs/expectedRevision" | no | — | — |
<!-- bdp-schema:end deleteBeadMembers -->

<!-- bdp-schema:start deleteBeadOperation -->
### Schema: "deleteBeadOperation"

Value: object

Required order: ["operation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "deleteBead"
    }
  }
}
```
<!-- bdp-schema:end deleteBeadOperation -->

<!-- bdp-schema:start deleteBeadRequest -->
### Schema: "deleteBeadRequest"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "#/$defs/durableResourceReference" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteBeadMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end deleteBeadRequest -->

<!-- bdp-schema:start deleteLinkMembers -->
### Schema: "deleteLinkMembers"

Value: object

Required order: ["link"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expectedRevision" | ref "#/$defs/expectedRevision" | no | — | — |
| "link" | ref "#/$defs/resourceReference" | yes | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
<!-- bdp-schema:end deleteLinkMembers -->

<!-- bdp-schema:start deleteLinkOperation -->
### Schema: "deleteLinkOperation"

Value: object

Required order: ["operation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "deleteLink"
    }
  }
}
```
<!-- bdp-schema:end deleteLinkOperation -->

<!-- bdp-schema:start deleteLinkRequest -->
### Schema: "deleteLinkRequest"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "link" | ref "#/$defs/durableResourceReference" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteLinkMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end deleteLinkRequest -->

<!-- bdp-schema:start deletedIdentity -->
### Schema: "deletedIdentity"

Value: object

Other fields: not allowed

Required order: ["resourceKind","resource"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "resource" | ref "#/$defs/resourceIdentity" | yes | — | — |
| "resourceKind" | ref "#/$defs/resourceKind" | yes | — | — |
<!-- bdp-schema:end deletedIdentity -->

<!-- bdp-schema:start durableInputPinnedReference -->
### Schema: "durableInputPinnedReference"

Value: object

Other fields: not allowed

Required order: ["uri","revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "revision" | schema | yes | — | — |
| "uri" | ref "#/$defs/durableResourceReference" | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end durableInputPinnedReference -->

<!-- bdp-schema:start durableInputReference -->
### Schema: "durableInputReference"

Value: object

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/durableResourceReference"
    },
    {
      "$ref": "#/$defs/durableInputPinnedReference"
    }
  ]
}
```
<!-- bdp-schema:end durableInputReference -->

<!-- bdp-schema:start durableResourceReference -->
### Schema: "durableResourceReference"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| minLength | 1 |
| pattern | "^[^@]" |
| type | "string" |
<!-- bdp-schema:end durableResourceReference -->

<!-- bdp-schema:start expectedRevision -->
### Schema: "expectedRevision"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| minLength | 1 |
| type | "string" |
<!-- bdp-schema:end expectedRevision -->

<!-- bdp-schema:start idempotencyCapabilityV1 -->
### Schema: "idempotencyCapabilityV1"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |
<!-- bdp-schema:end idempotencyCapabilityV1 -->

<!-- bdp-schema:start inputPinnedReference -->
### Schema: "inputPinnedReference"

Value: object

Other fields: not allowed

Required order: ["uri","revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "revision" | schema | yes | — | — |
| "uri" | ref "#/$defs/resourceReference" | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end inputPinnedReference -->

<!-- bdp-schema:start inputReference -->
### Schema: "inputReference"

Value: object

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/resourceReference"
    },
    {
      "$ref": "#/$defs/inputPinnedReference"
    }
  ]
}
```
<!-- bdp-schema:end inputReference -->

<!-- bdp-schema:start localBindingReference -->
### Schema: "localBindingReference"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| pattern | "^@[A-Za-z][A-Za-z0-9_-]*$" |
| type | "string" |
<!-- bdp-schema:end localBindingReference -->

<!-- bdp-schema:start localName -->
### Schema: "localName"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| pattern | "^[A-Za-z][A-Za-z0-9_-]*$" |
| type | "string" |
<!-- bdp-schema:end localName -->

<!-- bdp-schema:start mutationOutcome -->
### Schema: "mutationOutcome"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["created","updated","deleted"] |
<!-- bdp-schema:end mutationOutcome -->

<!-- bdp-schema:start mutationResult -->
### Schema: "mutationResult"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Read+Update mutation result" |
| type | "object" |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/mutationResultMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end mutationResult -->

<!-- bdp-schema:start mutationResultMembers -->
### Schema: "mutationResultMembers"

Value: object

Required order: ["outcome","changed"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "changed" | boolean | yes | — | — |
| "deleted" | ref "#/$defs/deletedIdentity" | no | — | — |
| "outcome" | ref "#/$defs/mutationOutcome" | yes | — | — |
| "ownerRevisions" | ref "#/$defs/ownerRevisions" | no | — | — |
| "resource" | schema | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "outcome": {
            "const": "deleted"
          }
        },
        "required": [
          "outcome"
        ]
      },
      "then": {
        "required": [
          "deleted"
        ],
        "properties": {
          "deleted": {
            "$ref": "#/$defs/deletedIdentity"
          },
          "resource": false
        }
      },
      "else": {
        "required": [
          "resource"
        ],
        "properties": {
          "resource": {
            "oneOf": [
              {
                "$ref": "#/$defs/beadRecord"
              },
              {
                "$ref": "#/$defs/linkRecord"
              }
            ]
          },
          "deleted": false
        }
      }
    },
    {
      "if": {
        "required": [
          "resource"
        ],
        "properties": {
          "resource": {
            "$ref": "#/$defs/beadRecord"
          }
        }
      },
      "then": {
        "properties": {
          "ownerRevisions": false
        }
      }
    },
    {
      "if": {
        "required": [
          "deleted"
        ],
        "properties": {
          "deleted": {
            "type": "object",
            "required": [
              "resourceKind"
            ],
            "properties": {
              "resourceKind": {
                "const": "bead"
              }
            }
          }
        }
      },
      "then": {
        "properties": {
          "ownerRevisions": false
        }
      }
    },
    {
      "if": {
        "required": [
          "outcome"
        ],
        "properties": {
          "outcome": {
            "enum": [
              "created",
              "deleted"
            ]
          }
        }
      },
      "then": {
        "properties": {
          "changed": {
            "const": true
          }
        }
      }
    }
  ],
  "properties": {
    "resource": {
      "oneOf": [
        {
          "$ref": "#/$defs/beadRecord"
        },
        {
          "$ref": "#/$defs/linkRecord"
        }
      ]
    }
  }
}
```
<!-- bdp-schema:end mutationResultMembers -->

<!-- bdp-schema:start ordinaryUpdateChange -->
### Schema: "ordinaryUpdateChange"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An ordinary update input may supply no patch operations; a supplied array member is still required." |
| type | "array" |

#### Advanced

```json-schema
{
  "items": {
    "$ref": "#/$defs/propertyChange/items"
  }
}
```
<!-- bdp-schema:end ordinaryUpdateChange -->

<!-- bdp-schema:start ownerRevision -->
### Schema: "ownerRevision"

Value: object

Other fields: not allowed

Required order: ["id","revision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "revision" | ref "#/$defs/revision" | yes | — | — |
<!-- bdp-schema:end ownerRevision -->

<!-- bdp-schema:start ownerRevisions -->
### Schema: "ownerRevisions"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| maxItems | 2 |
| minItems | 1 |
| type | "array" |
| uniqueItems | true |

#### Advanced

```json-schema
{
  "items": {
    "$ref": "#/$defs/ownerRevision"
  }
}
```
<!-- bdp-schema:end ownerRevisions -->

<!-- bdp-schema:start propertyChange -->
### Schema: "propertyChange"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| minItems | 1 |
| type | "array" |

#### Advanced

```json-schema
{
  "items": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "op",
          "path",
          "value"
        ],
        "properties": {
          "op": {
            "enum": [
              "add",
              "replace"
            ]
          },
          "path": {
            "$ref": "#/$defs/jsonPointer"
          },
          "value": true
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "op",
          "path"
        ],
        "properties": {
          "op": {
            "const": "remove"
          },
          "path": {
            "$ref": "#/$defs/jsonPointer"
          }
        },
        "additionalProperties": false
      }
    ]
  }
}
```
<!-- bdp-schema:end propertyChange -->

<!-- bdp-schema:start putAliasMembers -->
### Schema: "putAliasMembers"

Value: object

Required order: ["alias","target"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "alias" | ref "#/$defs/durableResourceReference" | yes | — | — |
| "target" | ref "#/$defs/resourceReference" | yes | — | — |
<!-- bdp-schema:end putAliasMembers -->

<!-- bdp-schema:start putAliasRequest -->
### Schema: "putAliasRequest"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "target" | ref "#/$defs/durableResourceReference" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/putAliasMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end putAliasRequest -->

<!-- bdp-schema:start readUpdateProblem -->
### Schema: "readUpdateProblem"

Value: object

Required order: ["type","code","retry"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Read+Update Problem Details" |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "code" | ref "#/$defs/readUpdateProblemCode" | yes | — | — |
| "detail" | text | no | — | — |
| "diagnostics" | ref "#/$defs/validationDiagnostics" | no | — | — |
| "diagnosticsTruncated" | boolean | no | — | — |
| "instance" | ref "#/$defs/absoluteUri" | no | — | — |
| "retry" | ref "#/$defs/retryDisposition" | yes | — | — |
| "retryAfter" | schema | no | — | — |
| "status" | schema | no | — | — |
| "title" | text | no | — | — |
| "type" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "code": {
            "$ref": "#/$defs/readProblemCode"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "$ref": "#/$defs/readProblem"
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "unsupported-media-type"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/request"
          },
          "status": {
            "const": 415
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "binding-unavailable"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/request"
          },
          "status": {
            "const": 400
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "validation-failed"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/validation"
          },
          "status": {
            "const": 422
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "type-not-installed"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/validation"
          },
          "status": {
            "const": 422
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "identity-taken"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "alias-path-taken"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-mismatch"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "incident-links-exist"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "aggregate-constraint-violation"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "idempotency-conflict"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "idempotency-in-progress"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-delay"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "idempotency-expired"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-allocation-unsafe"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "validation-failed"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "required": [
          "diagnostics"
        ],
        "properties": {
          "diagnostics": {
            "$ref": "#/$defs/validationDiagnostics"
          }
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "validation-failed"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "diagnostics": false,
          "diagnosticsTruncated": false
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "resource-pruned"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "archivedAt": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "retry": {
            "const": "after-delay"
          }
        },
        "required": [
          "retry"
        ]
      },
      "else": {
        "properties": {
          "retryAfter": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-allocation-unsafe"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "missing": false,
          "window": false,
          "resource": false,
          "properties": false,
          "ownedLinks": false,
          "pointer": false,
          "identity": false,
          "revision": false,
          "revisionProvenance": false
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "revision-unretained"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "missing": false
        }
      }
    }
  ],
  "properties": {
    "retryAfter": {
      "type": "integer",
      "minimum": 0
    },
    "status": {
      "type": "integer",
      "enum": [
        400,
        401,
        403,
        404,
        409,
        410,
        413,
        415,
        422,
        429,
        503
      ]
    }
  }
}
```
<!-- bdp-schema:end readUpdateProblem -->

<!-- bdp-schema:start readUpdateProblemCode -->
### Schema: "readUpdateProblemCode"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","revision-unknown","revision-unretained","revision-reorganized","revision-not-tracked","revision-unrepresentable","unsupported-media-type","binding-unavailable","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"] |
<!-- bdp-schema:end readUpdateProblemCode -->

<!-- bdp-schema:start resourceReference -->
### Schema: "resourceReference"

Value: object

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/durableResourceReference"
    },
    {
      "$ref": "#/$defs/localBindingReference"
    }
  ]
}
```
<!-- bdp-schema:end resourceReference -->

<!-- bdp-schema:start retainedDiscovery -->
### Schema: "retainedDiscovery"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "Selected retained Core or Write discovery" |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/coreDiscovery"
    },
    {
      "$ref": "#/$defs/writeDiscovery"
    }
  ]
}
```
<!-- bdp-schema:end retainedDiscovery -->

<!-- bdp-schema:start revisionProvenanceInput -->
### Schema: "revisionProvenanceInput"

Value: object

Other fields: not allowed

Required order: []

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "actor" | ref "#/$defs/revisionActor" | no | — | — |
| "agent" | schema | no | — | — |
| "message" | schema | no | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "agent": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": [
        "string",
        "null"
      ]
    }
  }
}
```
<!-- bdp-schema:end revisionProvenanceInput -->

<!-- bdp-schema:start updateBeadMembers -->
### Schema: "updateBeadMembers"

Value: object

Required order: ["bead"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "#/$defs/resourceReference" | yes | — | — |
| "expectedRevision" | ref "#/$defs/expectedRevision" | no | — | — |
| "metadata" | ref "#/$defs/metadata" | no | — | — |
| "metadataChange" | ref "#/$defs/ordinaryUpdateChange" | no | — | — |
| "properties" | ref "#/$defs/properties" | no | — | — |
| "propertiesChange" | ref "#/$defs/ordinaryUpdateChange" | no | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "type" | ref "#/$defs/typeReference" | no | — | — |

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "required": [
        "type"
      ],
      "properties": {
        "type": true
      }
    },
    {
      "required": [
        "propertiesChange"
      ],
      "properties": {
        "propertiesChange": true
      }
    },
    {
      "required": [
        "metadataChange"
      ],
      "properties": {
        "metadataChange": true
      }
    },
    {
      "required": [
        "properties"
      ],
      "properties": {
        "properties": true
      }
    },
    {
      "required": [
        "metadata"
      ],
      "properties": {
        "metadata": true
      }
    }
  ],
  "allOf": [
    {
      "not": {
        "required": [
          "properties",
          "propertiesChange"
        ],
        "properties": {
          "properties": true,
          "propertiesChange": true
        }
      }
    },
    {
      "not": {
        "required": [
          "metadata",
          "metadataChange"
        ],
        "properties": {
          "metadata": true,
          "metadataChange": true
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end updateBeadMembers -->

<!-- bdp-schema:start updateBeadOperation -->
### Schema: "updateBeadOperation"

Value: object

Required order: ["operation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "updateBead"
    }
  }
}
```
<!-- bdp-schema:end updateBeadOperation -->

<!-- bdp-schema:start updateBeadRequest -->
### Schema: "updateBeadRequest"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "#/$defs/durableResourceReference" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateBeadMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end updateBeadRequest -->

<!-- bdp-schema:start updateLinkMembers -->
### Schema: "updateLinkMembers"

Value: object

Required order: ["link"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expectedRevision" | ref "#/$defs/expectedRevision" | no | — | — |
| "link" | ref "#/$defs/resourceReference" | yes | — | — |
| "metadata" | ref "#/$defs/metadata" | no | — | — |
| "metadataChange" | ref "#/$defs/ordinaryUpdateChange" | no | — | — |
| "properties" | ref "#/$defs/properties" | no | — | — |
| "propertiesChange" | ref "#/$defs/ordinaryUpdateChange" | no | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "source" | ref "#/$defs/inputReference" | no | — | — |
| "target" | ref "#/$defs/inputReference" | no | — | — |
| "type" | ref "#/$defs/typeReference" | no | — | — |

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "required": [
        "type"
      ],
      "properties": {
        "type": true
      }
    },
    {
      "required": [
        "propertiesChange"
      ],
      "properties": {
        "propertiesChange": true
      }
    },
    {
      "required": [
        "metadataChange"
      ],
      "properties": {
        "metadataChange": true
      }
    },
    {
      "required": [
        "properties"
      ],
      "properties": {
        "properties": true
      }
    },
    {
      "required": [
        "metadata"
      ],
      "properties": {
        "metadata": true
      }
    },
    {
      "required": [
        "source"
      ],
      "properties": {
        "source": true
      }
    },
    {
      "required": [
        "target"
      ],
      "properties": {
        "target": true
      }
    }
  ],
  "allOf": [
    {
      "not": {
        "required": [
          "properties",
          "propertiesChange"
        ],
        "properties": {
          "properties": true,
          "propertiesChange": true
        }
      }
    },
    {
      "not": {
        "required": [
          "metadata",
          "metadataChange"
        ],
        "properties": {
          "metadata": true,
          "metadataChange": true
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end updateLinkMembers -->

<!-- bdp-schema:start updateLinkOperation -->
### Schema: "updateLinkOperation"

Value: object

Required order: ["operation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "updateLink"
    }
  }
}
```
<!-- bdp-schema:end updateLinkOperation -->

<!-- bdp-schema:start updateLinkRequest -->
### Schema: "updateLinkRequest"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "link" | ref "#/$defs/durableResourceReference" | no | — | — |
| "source" | ref "#/$defs/durableInputReference" | no | — | — |
| "target" | ref "#/$defs/durableInputReference" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateLinkMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end updateLinkRequest -->

<!-- bdp-schema:start validationDiagnostic -->
### Schema: "validationDiagnostic"

Value: object

Other fields: not allowed

Required order: ["message"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| dependentRequired | {"type":["schemaLocation"],"schemaLocation":["type"]} |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "document" | schema | no | — | — |
| "instanceLocation" | ref "#/$defs/jsonPointer" | no | — | — |
| "message" | schema | yes | — | — |
| "schemaLocation" | ref "#/$defs/absoluteUri" | no | — | — |
| "type" | ref "#/$defs/absoluteHttpUrl" | no | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "document": {
      "enum": [
        "properties",
        "metadata"
      ]
    },
    "message": {
      "type": "string",
      "minLength": 1
    }
  }
}
```
<!-- bdp-schema:end validationDiagnostic -->

<!-- bdp-schema:start validationDiagnostics -->
### Schema: "validationDiagnostics"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| minItems | 1 |
| type | "array" |

#### Advanced

```json-schema
{
  "items": {
    "$ref": "#/$defs/validationDiagnostic"
  }
}
```
<!-- bdp-schema:end validationDiagnostics -->

<!-- bdp-schema:start writeAdvertisedLimits -->
### Schema: "writeAdvertisedLimits"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "page" | schema | no | — | — |
| "patch" | schema | no | — | — |
| "request" | schema | no | — | — |
| "resource" | schema | no | — | — |
| "retention" | schema | no | — | — |
| "selector" | schema | no | — | — |
| "validation" | schema | no | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "page": {
      "type": "object",
      "properties": {
        "defaultItems": {
          "$ref": "#/$defs/positiveInteger"
        },
        "maximumItems": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "patch": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathDepth": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "request": {
      "type": "object",
      "properties": {
        "targetBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "bodyBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "resource": {
      "type": "object",
      "properties": {
        "representationBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "propertiesBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "retention": {
      "type": "object",
      "properties": {
        "idempotency": {
          "$ref": "#/$defs/iso8601Duration"
        },
        "maximumSnapshotLifetime": {
          "$ref": "#/$defs/iso8601Duration"
        }
      },
      "additionalProperties": false
    },
    "selector": {
      "type": "object",
      "properties": {
        "bytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "depth": {
          "$ref": "#/$defs/positiveInteger"
        },
        "nodes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "validation": {
      "type": "object",
      "properties": {
        "diagnostics": {
          "$ref": "#/$defs/positiveInteger"
        },
        "diagnosticBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    }
  }
}
```
<!-- bdp-schema:end writeAdvertisedLimits -->

<!-- bdp-schema:start writeDiscovery -->
### Schema: "writeDiscovery"

Value: object

Other fields: not allowed

Required order: ["bdpVersion","profile","scope","specRevision","operations"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "aliases" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "bdpVersion" | ref "#/$defs/bdpVersion" | yes | — | — |
| "capabilities" | ref "#/$defs/capabilityAdvertisements" | no | — | — |
| "events" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "historicalResolution" | ref "#/$defs/historyCapability" | no | — | — |
| "limits" | ref "#/$defs/writeAdvertisedLimits" | no | — | — |
| "maximumEndpointMultiplicity" | array of (ref "#/$defs/maximumEndpointMultiplicityPolicy") | no | — | — |
| "operations" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "order" | schema | no | — | — |
| "profile" | schema | yes | — | — |
| "scope" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "specRevision" | ref "#/$defs/specRevision" | yes | — | "Exact canonical protocol source commit represented by this discovery document." |

#### Advanced

```json-schema
{
  "properties": {
    "order": {
      "enum": [
        "canonical-uri"
      ]
    },
    "profile": {
      "const": "write"
    }
  }
}
```
<!-- bdp-schema:end writeDiscovery -->

<!-- bdp-schema:start writeOperationDirectory -->
### Schema: "writeOperationDirectory"

Value: object

Other fields: not allowed

Required order: ["createBead","updateBead","deleteBead","createLink","updateLink","deleteLink"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| dependentRequired | {"putAlias":["deleteAlias"],"deleteAlias":["putAlias"]} |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "createBead" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "createLink" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "deleteAlias" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "deleteBead" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "deleteLink" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "putAlias" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "updateBead" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "updateLink" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
<!-- bdp-schema:end writeOperationDirectory -->

<!-- bdp-schema:start idRootCapabilityV1 bundle=id-root -->
### Schema: "idRootCapabilityV1"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |
<!-- bdp-schema:end idRootCapabilityV1 bundle=id-root -->

<!-- bdp-schema:start idRootCapabilityAdvertisement bundle=id-root -->
### Schema: "idRootCapabilityAdvertisement"

Value: object

Required order: ["https://github.com/gastownhall/bdp/capabilities/id-root"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A capabilities map which includes fixed id-root1. Unknown versions may coexist but never authorize version1." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "https://github.com/gastownhall/bdp/capabilities/id-root" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/capabilityAdvertisements"
    }
  ],
  "properties": {
    "https://github.com/gastownhall/bdp/capabilities/id-root": {
      "type": "object",
      "allOf": [
        {
          "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/capabilityVersionAdvertisements"
        }
      ],
      "required": [
        "1"
      ],
      "properties": {
        "1": {
          "$ref": "#/$defs/idRootCapabilityV1"
        }
      }
    }
  }
}
```
<!-- bdp-schema:end idRootCapabilityAdvertisement bundle=id-root -->

<!-- bdp-schema:start idRoot bundle=id-root -->
### Schema: "idRoot"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Canonical nonempty local path prefix without a trailing slash. Lexical checks do not establish valid UTF-8, ownership, availability, bounds or safe allocation." |
| minLength | 1 |
| pattern | "^(?!@)(?![^/]*:)(?!.*(?:^\|/)\\\\.{1,2}(?:/\|$))(?:[A-Za-z0-9._~!$&'()*+,;=:@-]\|%[0-9A-F]{2})+(?:/(?:[A-Za-z0-9._~!$&'()*+,;=:@-]\|%[0-9A-F]{2})+)*$" |
| type | "string" |

#### Advanced

```json-schema
{
  "not": {
    "pattern": "%(?:00|01|02|03|04|05|06|07|08|09|0A|0B|0C|0D|0E|0F|10|11|12|13|14|15|16|17|18|19|1A|1B|1C|1D|1E|1F|2D|2E|2F|30|31|32|33|34|35|36|37|38|39|41|42|43|44|45|46|47|48|49|4A|4B|4C|4D|4E|4F|50|51|52|53|54|55|56|57|58|59|5A|5C|5F|61|62|63|64|65|66|67|68|69|6A|6B|6C|6D|6E|6F|70|71|72|73|74|75|76|77|78|79|7A|7E|7F)"
  }
}
```
<!-- bdp-schema:end idRoot bundle=id-root -->

<!-- bdp-schema:start idRootCreateSelection bundle=id-root -->
### Schema: "idRootCreateSelection"

Value: object

Required order: ["idRoot"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Presence-only prefix at an already dispatched create target; not complete request/value validation." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idRoot" | true | yes | — | — |
<!-- bdp-schema:end idRootCreateSelection bundle=id-root -->

<!-- bdp-schema:start idRootBatchSelection bundle=id-root -->
### Schema: "idRootBatchSelection"

Value: object

Required order: ["capabilityVersion","operations"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Prefix at the already selected atomic-batch1 target. Only declared create positions select id-root1, not nested data or unknown operation names." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |
| "operations" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "operations": {
      "type": "array",
      "contains": {
        "type": "object",
        "properties": {
          "operation": {
            "enum": [
              "createBead",
              "createLink"
            ]
          },
          "idRoot": true
        },
        "required": [
          "operation",
          "idRoot"
        ]
      }
    }
  }
}
```
<!-- bdp-schema:end idRootBatchSelection bundle=id-root -->

<!-- bdp-schema:start idRootCreateBeadMembers bundle=id-root -->
### Schema: "idRootCreateBeadMembers"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idRoot" | ref "#/$defs/idRoot" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/createBeadMembers"
    }
  ],
  "not": {
    "required": [
      "id",
      "idRoot"
    ],
    "properties": {
      "id": true,
      "idRoot": true
    }
  }
}
```
<!-- bdp-schema:end idRootCreateBeadMembers bundle=id-root -->

<!-- bdp-schema:start idRootCreateBeadRequest bundle=id-root -->
### Schema: "idRootCreateBeadRequest"

Value: object

Required order: ["idRoot"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idRoot" | ref "#/$defs/idRoot" | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/idRootCreateBeadMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end idRootCreateBeadRequest bundle=id-root -->

<!-- bdp-schema:start idRootCreateBeadOperation bundle=id-root -->
### Schema: "idRootCreateBeadOperation"

Value: object

Required order: ["operation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "name" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/localName" | no | — | — |
| "operation" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/idRootCreateBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "createBead"
    }
  }
}
```
<!-- bdp-schema:end idRootCreateBeadOperation bundle=id-root -->

<!-- bdp-schema:start idRootCreateLinkMembers bundle=id-root -->
### Schema: "idRootCreateLinkMembers"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idRoot" | ref "#/$defs/idRoot" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/createLinkMembers"
    }
  ],
  "not": {
    "required": [
      "id",
      "idRoot"
    ],
    "properties": {
      "id": true,
      "idRoot": true
    }
  }
}
```
<!-- bdp-schema:end idRootCreateLinkMembers bundle=id-root -->

<!-- bdp-schema:start idRootCreateLinkRequest bundle=id-root -->
### Schema: "idRootCreateLinkRequest"

Value: object

Required order: ["idRoot"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idRoot" | ref "#/$defs/idRoot" | yes | — | — |
| "source" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/durableInputReference" | no | — | — |
| "target" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/durableInputReference" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/idRootCreateLinkMembers"
    }
  ],
  "unevaluatedProperties": false
}
```
<!-- bdp-schema:end idRootCreateLinkRequest bundle=id-root -->

<!-- bdp-schema:start idRootCreateLinkOperation bundle=id-root -->
### Schema: "idRootCreateLinkOperation"

Value: object

Required order: ["operation"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "name" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/localName" | no | — | — |
| "operation" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/idRootCreateLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "createLink"
    }
  }
}
```
<!-- bdp-schema:end idRootCreateLinkOperation bundle=id-root -->

<!-- bdp-schema:start idRootBatchOperation bundle=id-root -->
### Schema: "idRootBatchOperation"

Value: object

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/idRootCreateBeadOperation"
    },
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/updateBeadOperation"
    },
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/deleteBeadOperation"
    },
    {
      "$ref": "#/$defs/idRootCreateLinkOperation"
    },
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/updateLinkOperation"
    },
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/deleteLinkOperation"
    }
  ]
}
```
<!-- bdp-schema:end idRootBatchOperation bundle=id-root -->

<!-- bdp-schema:start idRootBatchRequest bundle=id-root -->
### Schema: "idRootBatchRequest"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","operations"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Feature-owned composition of fixed id-root1 and atomic-batch1. This does not modify or validate as the old closed base batchRequest." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |
| "operations" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "operations": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/idRootBatchOperation"
      },
      "contains": {
        "type": "object",
        "properties": {
          "operation": {
            "enum": [
              "createBead",
              "createLink"
            ]
          },
          "idRoot": true
        },
        "required": [
          "operation",
          "idRoot"
        ]
      }
    }
  }
}
```
<!-- bdp-schema:end idRootBatchRequest bundle=id-root -->

<!-- bdp-schema:start idRootCapabilityProblem bundle=id-root -->
### Schema: "idRootCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","capability","capabilityVersion","pointer"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | — |
| "capabilityVersion" | schema | yes | — | — |
| "code" | schema | yes | — | — |
| "detail" | text | no | — | — |
| "instance" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteUri" | no | — | — |
| "pointer" | schema | yes | — | — |
| "retry" | schema | yes | — | — |
| "status" | schema | yes | — | — |
| "title" | text | no | — | — |
| "type" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/id-root"
    },
    "capabilityVersion": {
      "const": "1"
    },
    "code": {
      "const": "capability-not-supported"
    },
    "pointer": {
      "type": "string",
      "pattern": "^(?:/idRoot|/operations/(?:0|[1-9][0-9]*)/idRoot)$"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```
<!-- bdp-schema:end idRootCapabilityProblem bundle=id-root -->

<!-- bdp-schema:start idRootCreateResult bundle=id-root -->
### Schema: "idRootCreateResult"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| $ref | "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/mutationResult" |
<!-- bdp-schema:end idRootCreateResult bundle=id-root -->

<!-- bdp-schema:start idRootBatchResult bundle=id-root -->
### Schema: "idRootBatchResult"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| $ref | "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/atomicBatchResult" |
<!-- bdp-schema:end idRootBatchResult bundle=id-root -->

<!-- bdp-schema:start idRootCreateProblem bundle=id-root -->
### Schema: "idRootCreateProblem"

Value: object

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/readUpdateProblem"
    },
    {
      "$ref": "#/$defs/idRootCapabilityProblem"
    }
  ]
}
```
<!-- bdp-schema:end idRootCreateProblem bundle=id-root -->

<!-- bdp-schema:start idRootBatchProblem bundle=id-root -->
### Schema: "idRootBatchProblem"

Value: object

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/atomicBatchProblem"
    },
    {
      "$ref": "#/$defs/idRootCapabilityProblem"
    }
  ]
}
```
<!-- bdp-schema:end idRootBatchProblem bundle=id-root -->

<!-- bdp-schema:start deleteModesCapabilityV1 bundle=delete-modes -->
### Schema: "deleteModesCapabilityV1"

Value: object

Other fields: not allowed

Required order: ["atomicBatch","except"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "atomicBatch" | boolean | yes | — | — |
| "except" | boolean | yes | — | — |
| "maximumClosure" | schema | no | — | — |
| "typeEffects" | schema | no | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "maximumClosure": {
      "type": "integer",
      "minimum": 1
    },
    "typeEffects": {
      "type": "array",
      "uniqueItems": true,
      "items": {
        "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteHttpUrl"
      }
    }
  }
}
```
<!-- bdp-schema:end deleteModesCapabilityV1 bundle=delete-modes -->

<!-- bdp-schema:start deleteModesCapabilityAdvertisement bundle=delete-modes -->
### Schema: "deleteModesCapabilityAdvertisement"

Value: object

Required order: ["https://github.com/gastownhall/bdp/capabilities/delete-modes"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A capabilities map which includes fixed delete-modes1. Unknown versions may coexist but never authorize version1." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "https://github.com/gastownhall/bdp/capabilities/delete-modes" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/capabilityAdvertisements"
    }
  ],
  "properties": {
    "https://github.com/gastownhall/bdp/capabilities/delete-modes": {
      "type": "object",
      "allOf": [
        {
          "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/capabilityVersionAdvertisements"
        }
      ],
      "required": [
        "1"
      ],
      "properties": {
        "1": {
          "$ref": "#/$defs/deleteModesCapabilityV1"
        }
      }
    }
  }
}
```
<!-- bdp-schema:end deleteModesCapabilityAdvertisement bundle=delete-modes -->

<!-- bdp-schema:start deleteModesBlockedBy bundle=delete-modes -->
### Schema: "deleteModesBlockedBy"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["any","inbound","none"] |
| type | "string" |
<!-- bdp-schema:end deleteModesBlockedBy bundle=delete-modes -->

<!-- bdp-schema:start deleteModesLinkTypeTest bundle=delete-modes -->
### Schema: "deleteModesLinkTypeTest"

Value: object

Other fields: not allowed

Required order: ["type","match"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Core's single exact or family Link Type test. The URI is an unpinned nominal Type identity; family authority and Reference semantics are protocol rules." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "match" | schema | yes | — | — |
| "type" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteHttpUrl" | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "match": {
      "enum": [
        "exact",
        "family"
      ],
      "type": "string"
    }
  }
}
```
<!-- bdp-schema:end deleteModesLinkTypeTest bundle=delete-modes -->

<!-- bdp-schema:start deleteModesExcept bundle=delete-modes -->
### Schema: "deleteModesExcept"

Value: object

Other fields: not allowed

Required order: ["bind","predicate"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One Bead binding and a Core predicate node in the local filter subset. This schema checks the carrier only; node closure and subset admission are protocol rules." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bind" | schema | yes | — | — |
| "predicate" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "bind": {
      "type": "string",
      "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
    },
    "predicate": {
      "oneOf": [
        {
          "type": "boolean"
        },
        {
          "type": "object"
        }
      ]
    }
  }
}
```
<!-- bdp-schema:end deleteModesExcept bundle=delete-modes -->

<!-- bdp-schema:start deleteModesCascade bundle=delete-modes -->
### Schema: "deleteModesCascade"

Value: object

Other fields: not allowed

Required order: ["through"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "except" | ref "#/$defs/deleteModesExcept" | no | — | — |
| "through" | ref "#/$defs/deleteModesLinkTypeTest" | yes | — | — |
<!-- bdp-schema:end deleteModesCascade bundle=delete-modes -->

<!-- bdp-schema:start deleteModesSelection bundle=delete-modes -->
### Schema: "deleteModesSelection"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Presence-only prefix at an already dispatched deleteBead position; not complete request validation." |
| type | "object" |

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "type": "object",
      "properties": {
        "beads": true
      },
      "required": [
        "beads"
      ]
    },
    {
      "type": "object",
      "properties": {
        "blockedBy": true
      },
      "required": [
        "blockedBy"
      ]
    },
    {
      "type": "object",
      "properties": {
        "cascade": true
      },
      "required": [
        "cascade"
      ]
    },
    {
      "type": "object",
      "properties": {
        "dryRun": true
      },
      "required": [
        "dryRun"
      ]
    }
  ]
}
```
<!-- bdp-schema:end deleteModesSelection bundle=delete-modes -->

<!-- bdp-schema:start deleteModesRequest bundle=delete-modes -->
### Schema: "deleteModesRequest"

Value: object

Other fields: not allowed

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Exactly one of bead and beads, at least one selector, and no expectedRevision beside beads. Resolution, liveness and the semantics of each member are protocol rules." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/durableResourceReference" | no | — | — |
| "beads" | schema | no | — | — |
| "blockedBy" | ref "#/$defs/deleteModesBlockedBy" | no | — | — |
| "cascade" | ref "#/$defs/deleteModesCascade" | no | — | — |
| "dryRun" | boolean | no | — | — |
| "expectedRevision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/expectedRevision" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteModesSelection"
    }
  ],
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "bead": true
      },
      "required": [
        "bead"
      ]
    },
    {
      "type": "object",
      "properties": {
        "beads": true
      },
      "required": [
        "beads"
      ]
    }
  ],
  "not": {
    "type": "object",
    "properties": {
      "beads": true,
      "expectedRevision": true
    },
    "required": [
      "beads",
      "expectedRevision"
    ]
  },
  "properties": {
    "beads": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/durableResourceReference"
      }
    }
  }
}
```
<!-- bdp-schema:end deleteModesRequest bundle=delete-modes -->

<!-- bdp-schema:start deleteModesOperation bundle=delete-modes -->
### Schema: "deleteModesOperation"

Value: object

Required order: ["operation","blockedBy"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A deleteBead batch member selecting blockedBy. beads, cascade and dryRun are not admitted inside a batch." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "blockedBy" | ref "#/$defs/deleteModesBlockedBy" | yes | — | — |
| "operation" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/deleteBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "deleteBead"
    }
  }
}
```
<!-- bdp-schema:end deleteModesOperation bundle=delete-modes -->

<!-- bdp-schema:start deleteModesBatchOperation bundle=delete-modes -->
### Schema: "deleteModesBatchOperation"

Value: object

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/createBeadOperation"
    },
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/updateBeadOperation"
    },
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/deleteBeadOperation"
    },
    {
      "$ref": "#/$defs/deleteModesOperation"
    },
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/createLinkOperation"
    },
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/updateLinkOperation"
    },
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/deleteLinkOperation"
    }
  ]
}
```
<!-- bdp-schema:end deleteModesBatchOperation bundle=delete-modes -->

<!-- bdp-schema:start deleteModesBatchRequest bundle=delete-modes -->
### Schema: "deleteModesBatchRequest"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","operations"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Feature-owned composition of fixed delete-modes1 and atomic-batch1. This does not modify or validate as the old closed base batchRequest." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |
| "operations" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "operations": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/deleteModesBatchOperation"
      },
      "contains": {
        "type": "object",
        "properties": {
          "blockedBy": true,
          "operation": {
            "const": "deleteBead"
          }
        },
        "required": [
          "operation",
          "blockedBy"
        ]
      }
    }
  }
}
```
<!-- bdp-schema:end deleteModesBatchRequest bundle=delete-modes -->

<!-- bdp-schema:start deleteModesRemovedLink bundle=delete-modes -->
### Schema: "deleteModesRemovedLink"

Value: object

Other fields: not allowed

Required order: ["id","source","target"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteHttpUrl" | yes | — | — |
| "source" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/reference" | yes | — | — |
| "target" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/reference" | yes | — | — |
<!-- bdp-schema:end deleteModesRemovedLink bundle=delete-modes -->

<!-- bdp-schema:start deleteModesRemovedLinks bundle=delete-modes -->
### Schema: "deleteModesRemovedLinks"

Value: object

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One entry per deleted Link row, ascending by canonical id." |
| type | "array" |
| uniqueItems | true |

#### Advanced

```json-schema
{
  "items": {
    "$ref": "#/$defs/deleteModesRemovedLink"
  }
}
```
<!-- bdp-schema:end deleteModesRemovedLinks bundle=delete-modes -->

<!-- bdp-schema:start deleteModesResult bundle=delete-modes -->
### Schema: "deleteModesResult"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","changed","transaction","results","resources","removedLinks"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A committed delete-modes1 outcome, singleton or batch. Result entries and Resource rows are the common atomic-batch definitions." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |
| "changed" | schema | yes | — | — |
| "removedLinks" | ref "#/$defs/deleteModesRemovedLinks" | yes | — | — |
| "resources" | schema | yes | — | — |
| "results" | schema | yes | — | — |
| "transaction" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revision" | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "changed": {
      "const": true
    },
    "resources": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/atomicBatchResourceResult"
      }
    },
    "results": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/atomicBatchResultEntry"
      }
    }
  }
}
```
<!-- bdp-schema:end deleteModesResult bundle=delete-modes -->

<!-- bdp-schema:start deleteModesPreviewRow bundle=delete-modes -->
### Schema: "deleteModesPreviewRow"

Value: object

Other fields: not allowed

Required order: ["id","resourceKind","outcome"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A Resource the committed request would delete or newly version. A preview mints nothing, so an updated row has the current revision and no record." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "deleted" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/deletedIdentity" | no | — | — |
| "id" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteHttpUrl" | yes | — | — |
| "outcome" | schema | yes | — | — |
| "proposed" | schema | no | — | "The object planes a declared deletion effect would change, with their would-be final values." |
| "resourceKind" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/resourceKind" | yes | — | — |
| "revision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revision" | no | — | — |

#### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "deleted": true,
        "outcome": {
          "const": "deleted"
        },
        "proposed": false,
        "revision": false
      },
      "required": [
        "deleted"
      ]
    },
    {
      "type": "object",
      "properties": {
        "deleted": false,
        "outcome": {
          "const": "updated"
        },
        "revision": true
      },
      "required": [
        "revision"
      ]
    }
  ],
  "properties": {
    "outcome": {
      "enum": [
        "deleted",
        "updated"
      ],
      "type": "string"
    },
    "proposed": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "properties": {
        "metadata": {
          "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/metadata"
        },
        "properties": {
          "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/properties"
        }
      }
    }
  }
}
```
<!-- bdp-schema:end deleteModesPreviewRow bundle=delete-modes -->

<!-- bdp-schema:start deleteModesPreview bundle=delete-modes -->
### Schema: "deleteModesPreview"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","dryRun","changed","results","resources","removedLinks"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The report of a dry run. It commits nothing and retains no outcome." |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |
| "changed" | schema | yes | — | — |
| "dryRun" | schema | yes | — | — |
| "removedLinks" | ref "#/$defs/deleteModesRemovedLinks" | yes | — | — |
| "resources" | schema | yes | — | — |
| "results" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "changed": {
      "const": false
    },
    "dryRun": {
      "const": true
    },
    "resources": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "#/$defs/deleteModesPreviewRow"
      }
    },
    "results": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/atomicBatchResultEntry"
      }
    }
  }
}
```
<!-- bdp-schema:end deleteModesPreview bundle=delete-modes -->

<!-- bdp-schema:start deleteModesCapabilityProblem bundle=delete-modes -->
### Schema: "deleteModesCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","capability","capabilityVersion","pointer"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | — |
| "capabilityVersion" | schema | yes | — | — |
| "code" | schema | yes | — | — |
| "detail" | text | no | — | — |
| "instance" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteUri" | no | — | — |
| "pointer" | schema | yes | — | — |
| "retry" | schema | yes | — | — |
| "status" | schema | yes | — | — |
| "title" | text | no | — | — |
| "type" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/delete-modes"
    },
    "capabilityVersion": {
      "const": "1"
    },
    "code": {
      "const": "capability-not-supported"
    },
    "pointer": {
      "type": "string",
      "pattern": "^(?:/(?:beads|blockedBy|cascade(?:/except)?|dryRun)|/operations/(?:0|[1-9][0-9]*)/blockedBy)$"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```
<!-- bdp-schema:end deleteModesCapabilityProblem bundle=delete-modes -->

<!-- bdp-schema:start deleteModesProblem bundle=delete-modes -->
### Schema: "deleteModesProblem"

Value: object

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/readUpdateProblem"
    },
    {
      "$ref": "#/$defs/deleteModesCapabilityProblem"
    }
  ]
}
```
<!-- bdp-schema:end deleteModesProblem bundle=delete-modes -->

<!-- bdp-schema:start deleteModesBatchProblem bundle=delete-modes -->
### Schema: "deleteModesBatchProblem"

Value: object

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/atomicBatchProblem"
    },
    {
      "$ref": "#/$defs/deleteModesCapabilityProblem"
    }
  ]
}
```
<!-- bdp-schema:end deleteModesBatchProblem bundle=delete-modes -->

## OpenAPI

The following visible operation tables are the authoring source for the generated
[OpenAPI catalog](../../openapi/README.md), using the
[BDP Markdown OpenAPI notation](../../formats/markdown-openapi.md). Targets are
navigated URLs, not prescribed deployment paths. Shared media, authorization,
conditional HTTP, bodyless HEAD/status and Problem rules remain defined by Core.
Schema names resolve in the shared bundle; optional feature compositions retain
their distinct schema resources. Generation does not qualify an implementation.

<!-- bdp-operation:start writeDirectory -->
### Operation: writeDirectory

| Field | JSON value |
| --- | --- |
| id | `"writeDirectory"` |
| navigation | `{"role":"discovery-member","member":"operations"}` |
| response | `"writeOperationDirectory"` |
| methods | `["get","head"]` |
| problem | `"readProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable"]` |
| continuation | `"none"` |
| optional | `"Write profile"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end writeDirectory -->

<!-- bdp-operation:start createBead -->
### Operation: createBead

| Field | JSON value |
| --- | --- |
| id | `"createBead"` |
| navigation | `{"role":"write-directory-member","member":"createBead"}` |
| methods | `["post"]` |
| request | `"createBeadRequest"` |
| response | `"mutationResult"` |
| problem | `"readUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"]` |
| continuation | `"none"` |
| optional | `"Write profile"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end createBead -->

<!-- bdp-operation:start updateBead -->
### Operation: updateBead

| Field | JSON value |
| --- | --- |
| id | `"updateBead"` |
| navigation | `{"role":"write-directory-member","member":"updateBead"}` |
| methods | `["post"]` |
| request | `"updateBeadRequest"` |
| response | `"mutationResult"` |
| problem | `"readUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"]` |
| continuation | `"none"` |
| optional | `"Write profile"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end updateBead -->

<!-- bdp-operation:start deleteBead -->
### Operation: deleteBead

| Field | JSON value |
| --- | --- |
| id | `"deleteBead"` |
| navigation | `{"role":"write-directory-member","member":"deleteBead"}` |
| methods | `["post"]` |
| request | `"deleteBeadRequest"` |
| response | `"mutationResult"` |
| problem | `"readUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"]` |
| continuation | `"none"` |
| optional | `"Write profile"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end deleteBead -->

<!-- bdp-operation:start createLink -->
### Operation: createLink

| Field | JSON value |
| --- | --- |
| id | `"createLink"` |
| navigation | `{"role":"write-directory-member","member":"createLink"}` |
| methods | `["post"]` |
| request | `"createLinkRequest"` |
| response | `"mutationResult"` |
| problem | `"readUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"]` |
| continuation | `"none"` |
| optional | `"Write profile"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end createLink -->

<!-- bdp-operation:start updateLink -->
### Operation: updateLink

| Field | JSON value |
| --- | --- |
| id | `"updateLink"` |
| navigation | `{"role":"write-directory-member","member":"updateLink"}` |
| methods | `["post"]` |
| request | `"updateLinkRequest"` |
| response | `"mutationResult"` |
| problem | `"readUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"]` |
| continuation | `"none"` |
| optional | `"Write profile"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end updateLink -->

<!-- bdp-operation:start deleteLink -->
### Operation: deleteLink

| Field | JSON value |
| --- | --- |
| id | `"deleteLink"` |
| navigation | `{"role":"write-directory-member","member":"deleteLink"}` |
| methods | `["post"]` |
| request | `"deleteLinkRequest"` |
| response | `"mutationResult"` |
| problem | `"readUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"]` |
| continuation | `"none"` |
| optional | `"Write profile"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end deleteLink -->

<!-- bdp-operation:start putAlias -->
### Operation: putAlias

| Field | JSON value |
| --- | --- |
| id | `"putAlias"` |
| navigation | `{"role":"write-directory-member","member":"putAlias"}` |
| methods | `["post"]` |
| request | `"putAliasRequest"` |
| response | `"aliasResult"` |
| problem | `"readUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"]` |
| continuation | `"none"` |
| optional | `"Write profile with aliases advertised"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end putAlias -->

<!-- bdp-operation:start deleteAlias -->
### Operation: deleteAlias

| Field | JSON value |
| --- | --- |
| id | `"deleteAlias"` |
| navigation | `{"role":"write-directory-member","member":"deleteAlias"}` |
| methods | `["post"]` |
| request | `"deleteAliasRequest"` |
| response | `"aliasResult"` |
| problem | `"readUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"]` |
| continuation | `"none"` |
| optional | `"Write profile with aliases advertised"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end deleteAlias -->

<!-- bdp-operation:start atomicBatch -->
### Operation: atomicBatch

| Field | JSON value |
| --- | --- |
| id | `"atomicBatch"` |
| navigation | `{"role":"capability-operation","capability":"https://github.com/gastownhall/bdp/capabilities/atomic-batch","version":"1"}` |
| methods | `["post"]` |
| request | `"batchRequest"` |
| response | `"atomicBatchResult"` |
| problem | `"atomicBatchProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe","capability-not-supported","operation-not-supported"]` |
| continuation | `"none"` |
| optional | `"Write plus atomic-batch1"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end atomicBatch -->

### Optional id-root1 composition

The createBead, createLink and atomicBatch signatures keep the same URLs, media
and results when id-root1 is explicitly selected. Their request schemas compose
the base arm with idRootCreateBeadRequest, idRootCreateLinkRequest and
idRootBatchRequest respectively from the id-root schema resource. The feature
Problem schemas are idRootCreateProblem and idRootBatchProblem. Presence of
`idRoot` selects this feature; absence keeps the base contract. Clients do not
allocate IDs or invent a separate endpoint. The admission and composition rules
in [Optional rooted creation](#optional-rooted-allocation-version-1) remain binding.

### Optional delete-modes1 composition

The deleteBead and atomicBatch signatures keep the same URLs and media when
delete-modes1 is explicitly selected. Their additional request arms are
deleteModesRequest and deleteModesBatchRequest from the delete-modes schema resource.
deleteBead's additional success arms are deleteModesResult and deleteModesPreview, and
atomicBatch's is deleteModesResult. Their feature Problem schemas are deleteModesProblem
and deleteModesBatchProblem. Presence of `beads`, `blockedBy`, `cascade` or `dryRun` on
deleteBead, or `blockedBy` on a batch member, selects this feature; absence keeps the
base contract. The rules in [Optional deletion modes](#optional-deletion-modes-version-1)
remain binding.

## Historical-update1 feature schema resource

These visible fragments own the feature resource above. They do not add members
to common base schemas. Full-History composition remains a separate receiving
decision. Source authorization, consumed-content completeness and the independent
current baseline are semantic duties; structural validation alone cannot
advertise the complete extension. The operation member form records offline intent; when
`atomicBatch:false`, that form does not promise executable batch composition.

<!-- bdp-schema:start historicalUpdateCapabilityV1 bundle=historical-update -->
### Schema: "historicalUpdateCapabilityV1"

Value: object

Other fields: not allowed

Required order: ["atomicBatch"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "atomicBatch" | boolean | yes | — | — |
<!-- bdp-schema:end historicalUpdateCapabilityV1 bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateCapabilityAdvertisement bundle=historical-update -->
### Schema: "historicalUpdateCapabilityAdvertisement"

Value: object

#### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/retainedDiscovery"
    },
    {
      "type": "object",
      "properties": {
        "profile": {
          "const": "write"
        },
        "capabilities": {
          "type": "object",
          "properties": {
            "https://github.com/gastownhall/bdp/capabilities/historical-update": {
              "type": "object",
              "properties": {
                "1": {
                  "$ref": "#/$defs/historicalUpdateCapabilityV1"
                }
              },
              "required": [
                "1"
              ]
            }
          },
          "required": [
            "https://github.com/gastownhall/bdp/capabilities/historical-update"
          ]
        }
      },
      "required": [
        "profile",
        "capabilities"
      ]
    }
  ]
}
```
<!-- bdp-schema:end historicalUpdateCapabilityAdvertisement bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateContext bundle=historical-update -->
### Schema: "historicalUpdateContext"

Value: object

Other fields: not allowed

Required order: ["fromRevision","previousRevision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "fromRevision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revision" | yes | — | — |
| "previousRevision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revision" | yes | — | — |
<!-- bdp-schema:end historicalUpdateContext bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateRequest bundle=historical-update -->
### Schema: "historicalUpdateRequest"

Value: object

Other fields: not allowed

Required order: ["bead","fromRevision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/durableResourceReference" | yes | — | — |
| "expectedRevision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/expectedRevision" | no | — | — |
| "fromRevision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revision" | yes | — | — |
| "metadata" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/metadata" | no | — | — |
| "metadataChange" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/ordinaryUpdateChange" | no | — | — |
| "properties" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/properties" | no | — | — |
| "propertiesChange" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/ordinaryUpdateChange" | no | — | — |
| "revisionProvenance" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revisionProvenanceInput" | no | — | — |
| "type" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/typeReference" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "not": {
        "required": [
          "properties",
          "propertiesChange"
        ],
        "properties": {
          "properties": true,
          "propertiesChange": true
        }
      }
    },
    {
      "not": {
        "required": [
          "metadata",
          "metadataChange"
        ],
        "properties": {
          "metadata": true,
          "metadataChange": true
        }
      }
    }
  ]
}
```
<!-- bdp-schema:end historicalUpdateRequest bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateOperation bundle=historical-update -->
### Schema: "historicalUpdateOperation"

Value: object

Other fields: not allowed

Required order: ["operation","bead","fromRevision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/resourceReference" | yes | — | — |
| "expectedRevision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/expectedRevision" | no | — | — |
| "fromRevision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revision" | yes | — | — |
| "metadata" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/metadata" | no | — | — |
| "metadataChange" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/ordinaryUpdateChange" | no | — | — |
| "operation" | schema | yes | — | — |
| "properties" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/properties" | no | — | — |
| "propertiesChange" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/ordinaryUpdateChange" | no | — | — |
| "revisionProvenance" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revisionProvenanceInput" | no | — | — |
| "type" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/typeReference" | no | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "not": {
        "required": [
          "properties",
          "propertiesChange"
        ],
        "properties": {
          "properties": true,
          "propertiesChange": true
        }
      }
    },
    {
      "not": {
        "required": [
          "metadata",
          "metadataChange"
        ],
        "properties": {
          "metadata": true,
          "metadataChange": true
        }
      }
    }
  ],
  "properties": {
    "operation": {
      "const": "updateBead"
    }
  }
}
```
<!-- bdp-schema:end historicalUpdateOperation bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateResult bundle=historical-update -->
### Schema: "historicalUpdateResult"

Value: object

Other fields: not allowed

Required order: ["result"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "historicalUpdate" | ref "#/$defs/historicalUpdateContext" | no | — | — |
| "result" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "result": {
            "properties": {
              "changed": {
                "const": true
              }
            },
            "required": [
              "changed"
            ],
            "type": "object"
          }
        },
        "required": [
          "result"
        ],
        "type": "object"
      },
      "then": {
        "required": [
          "historicalUpdate"
        ],
        "properties": {
          "historicalUpdate": true
        }
      }
    }
  ],
  "properties": {
    "result": {
      "allOf": [
        {
          "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/mutationResult"
        },
        {
          "type": "object",
          "properties": {
            "outcome": {
              "const": "updated"
            },
            "resource": {
              "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/currentBeadRecord"
            }
          },
          "required": [
            "resource"
          ]
        }
      ]
    }
  }
}
```
<!-- bdp-schema:end historicalUpdateResult bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateView bundle=historical-update -->
### Schema: "historicalUpdateView"

Value: object

Other fields: not allowed

Required order: ["resource"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "historicalUpdate" | ref "#/$defs/historicalUpdateContext" | no | — | — |
| "resource" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "resource": {
      "allOf": [
        {
          "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/currentBeadRecord"
        },
        {
          "not": {
            "required": [
              "links"
            ],
            "properties": {
              "links": true
            },
            "type": "object"
          }
        }
      ]
    }
  }
}
```
<!-- bdp-schema:end historicalUpdateView bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateCapabilityProblem bundle=historical-update -->
### Schema: "historicalUpdateCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","capability","capabilityVersion","pointer"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | — |
| "capabilityVersion" | schema | yes | — | — |
| "code" | schema | yes | — | — |
| "detail" | text | no | — | — |
| "instance" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteUri" | no | — | — |
| "pointer" | schema | yes | — | — |
| "retry" | schema | yes | — | — |
| "status" | schema | yes | — | — |
| "title" | text | no | — | — |
| "type" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/historical-update"
    },
    "capabilityVersion": {
      "const": "1"
    },
    "code": {
      "const": "capability-not-supported"
    },
    "pointer": {
      "type": "string",
      "pattern": "^(?:/fromRevision|/operations/(?:0|[1-9][0-9]*)/fromRevision)$"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```
<!-- bdp-schema:end historicalUpdateCapabilityProblem bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateProblem bundle=historical-update -->
### Schema: "historicalUpdateProblem"

Value: object

#### Advanced

```json-schema
{
  "anyOf": [
    {
      "$ref": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/readUpdateProblem"
    },
    {
      "$ref": "#/$defs/historicalUpdateCapabilityProblem"
    },
    {
      "$ref": "#/$defs/historicalUpdateReadCapabilityProblem"
    }
  ]
}
```
<!-- bdp-schema:end historicalUpdateProblem bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateTerminalVersion bundle=historical-update -->
### Schema: "historicalUpdateTerminalVersion"

Value: object

Other fields: not allowed

Required order: ["id","revision","state","previousRevision"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteHttpUrl" | yes | — | — |
| "previousRevision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revision" | yes | — | — |
| "revision" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revision" | yes | — | — |
| "revisionProvenance" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/revisionProvenance" | no | — | — |
| "state" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "state": {
      "const": "deleted"
    }
  }
}
```
<!-- bdp-schema:end historicalUpdateTerminalVersion bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateTerminalView bundle=historical-update -->
### Schema: "historicalUpdateTerminalView"

Value: object

Other fields: not allowed

Required order: ["terminal"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "terminal" | ref "#/$defs/historicalUpdateTerminalVersion" | yes | — | — |
<!-- bdp-schema:end historicalUpdateTerminalView bundle=historical-update -->

<!-- bdp-schema:start historicalUpdateReadCapabilityProblem bundle=historical-update -->
### Schema: "historicalUpdateReadCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","capability","capabilityVersion"]

#### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

#### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | — |
| "capabilityVersion" | schema | yes | — | — |
| "code" | schema | yes | — | — |
| "detail" | text | no | — | — |
| "instance" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/absoluteUri" | no | — | — |
| "retry" | schema | yes | — | — |
| "status" | schema | yes | — | — |
| "title" | text | no | — | — |
| "type" | schema | yes | — | — |

#### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/historical-update"
    },
    "capabilityVersion": {
      "const": "1"
    },
    "code": {
      "const": "capability-not-supported"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```
<!-- bdp-schema:end historicalUpdateReadCapabilityProblem bundle=historical-update -->


## Selected historical-update HTTP signatures

These informative signatures catalog the already selected [historical-update binding](#historical-base-bead-update-and-recovery). They use the existing discovered `updateBead` operation and canonical Bead URL, not new endpoints. The explicit feature media selects closed feature schemas; ordinary media keeps the base grammar. Current and terminal reads have SDK/HTTP correspondence only; no new CLI read flag or verb is selected. Feature composition with full History or Events is not inferred.

<!-- bdp-operation:start historicalUpdateBead -->
### Operation: historicalUpdateBead

| Field | JSON value |
| --- | --- |
| id | `"historicalUpdateBead"` |
| navigation | `{"role":"write-directory-feature","member":"updateBead","feature":{"capability":"https://github.com/gastownhall/bdp/capabilities/historical-update","version":"1","media":"application/vnd.bdp.v0.1.historical-update.v1+json","schema":"specs/profiles/write/historical-update-v1.schema.json"}}` |
| methods | `["post"]` |
| request | `"historicalUpdateRequest"` |
| response | `"historicalUpdateResult"` |
| problem | `"historicalUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","capability-not-supported","unsupported-media-type","validation-failed","revision-mismatch","revision-unknown","revision-unretained","revision-reorganized","revision-not-tracked","revision-unrepresentable","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"]` |
| continuation | `"none"` |
| optional | `"Write plus historical-update1"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end historicalUpdateBead -->

<!-- bdp-operation:start historicalUpdateCurrent -->
### Operation: historicalUpdateCurrent

| Field | JSON value |
| --- | --- |
| id | `"historicalUpdateCurrent"` |
| navigation | `{"role":"canonical-resource","kind":"bead","feature":{"capability":"https://github.com/gastownhall/bdp/capabilities/historical-update","version":"1","media":"application/vnd.bdp.v0.1.historical-update.v1+json","schema":"specs/profiles/write/historical-update-v1.schema.json"}}` |
| methods | `["get","head"]` |
| response | `"historicalUpdateView"` |
| problem | `"historicalUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","capability-not-supported"]` |
| continuation | `"none"` |
| optional | `"historical-update1"` |
| kind | `"bead"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
<!-- bdp-operation:end historicalUpdateCurrent -->

<!-- bdp-operation:start historicalUpdateTerminal -->
### Operation: historicalUpdateTerminal

| Field | JSON value |
| --- | --- |
| id | `"historicalUpdateTerminal"` |
| navigation | `{"role":"canonical-resource","kind":"bead","feature":{"capability":"https://github.com/gastownhall/bdp/capabilities/historical-update","version":"1","media":"application/vnd.bdp.v0.1.historical-update.v1+json","schema":"specs/profiles/write/historical-update-v1.schema.json"}}` |
| methods | `["get","head"]` |
| response | `"historicalUpdateTerminalView"` |
| problem | `"historicalUpdateProblem"` |
| codes | `["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","capability-not-supported"]` |
| continuation | `"none"` |
| optional | `"historical-update1"` |
| kind | `"bead"` |

| Parameter | Location | Required | JSON Schema | Meaning | Parsed schema |
| --- | --- | --- | --- | --- | --- |
| view | query | yes | `{"const":"terminal"}` | Current terminal state only; no exact revision or History selection. | — |
<!-- bdp-operation:end historicalUpdateTerminal -->

## Appendix: open design questions

This informative appendix does not relax mutation, retry, ownership, erasure or final-publication duties. [OWN-REVIEW](../../deferred.md#own-review--owned-links-reexamination) records the requested reexamination of owned Links. Historical correction/recovery should preserve current invariants minimally; a broader redesign, duplicate graph capture or changed cascade rule requires separate review. Exact representation and lifecycle alternatives belong to that design, not a historical-stack cleanup.

[IMPORT-CONTEXT](../../deferred.md#import-context--historical-import-lifecycle-and-source-correlation) preserves unadopted import/source-correlation questions. [XFER-OBS](../../deferred.md#xfer-obs--replication-streaming-and-cross-feature-order) and [XFER-RETAIN](../../deferred.md#xfer-retain--snapshot-minima-continuity-and-erasurepublication-races) require Transfer-time review of ordering, retained continuity and publication races while preserving current atomicity and cleanup fences. These entries grant no new operation or permission to claim unsupported feature composition.

Public receipts remain [deferred exploration](../../deferred.md#write-receipts--public-outcome-services); durable internal outcomes and safe original-key recovery remain mandatory.
