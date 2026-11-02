---
status: editorial-draft
intended-status: normative
version: "0.1"
---

# Beads Protocol — Write

Write extends [Core](../core/core.md) with individually atomic Bead, Link and
alias mutations, durable retry outcomes, and production of the required committed
Event facts when Events is advertised. It also defines the independently optional atomic-batch1 and id-root1
capabilities. [Types](../types/types.md) supplies optional Scope-wide Type
interpretation; Write does not make that interpretation a condition of Core-only
carrying.

This is the current version 0.1 editorial draft. It defines protocol obligations,
not evidence that a particular provider implements them. The requirement-language,
JSON value model, common records, References, authorization and HTTP rules are
those of Core. The three protocol texts are Core, Write and Types. Schema artifacts
are mechanical companions: structural validity does not establish admission,
authorization, atomicity, retention or conformance.

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
15. [Conformance boundary](#conformance-boundary)

## Discover and select Write

A Write Scope advertises `bdpVersion:"0.1"` and `profile:"write"`. Its closed
machine discovery requires `scope`, `beads`, `links`, `operations` and
`aliases`, in addition to those two identity members. The optional common members
are `events`, `order`, `limits`, `maximumEndpointMultiplicity`, `historicalResolution` and
`capabilities`, with their Core meanings. There is no required Type inventory.
Navigation URLs are absolute HTTP(S) URLs. Clients follow the discovered URLs and
verify the owning Scope, Resource kind and selected contract; they MUST NOT infer
an operation from a Resource, Type or endpoint path.

<a id="operation-directory-and-singleton-targets"></a>

### Eight distinct ordinary targets

A GET of `operations` returns a closed `writeOperationDirectory` object with exactly
these members:

| Member | Decision |
| --- | --- |
| `createBead` | Create one Bead |
| `updateBead` | Edit one Bead |
| `deleteBead` | Delete one Bead |
| `createLink` | Create one Link |
| `updateLink` | Edit one Link, including either endpoint |
| `deleteLink` | Delete one Link |
| `putAlias` | Create or repoint one alias |
| `deleteAlias` | Remove one alias |

Every value is a distinct absolute HTTP(S) operation URL served for this Scope.
An ambiguous directory MUST be refused before dispatch. Sharing an implementation
handler does not merge the eight wire addresses. No fixed URL suffix is required.
Atomic batch is separately advertised; it is not a ninth directory member. There
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
| `putAlias` | `alias`, `target` | none |
| `deleteAlias` | `alias` | none |

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
as specified below. Every operation carries exactly one valid `Idempotency-Key`
HTTP field under [Idempotency and recovery](#idempotency-and-recovery).

## Creation and identity allocation

A Resource's canonical identity is established at creation and never changes. A
caller MAY supply an already canonical local `id` consisting of one or more safe
segments. Omitting it asks the authority to allocate one opaque segment. The
allocator MUST NOT encode meaning into its minted segment or choose a live alias
URL, for either Resource kind. There are no mandatory `beads/`, `links/` or Type
prefixes. Hierarchy authored in an ID implies neither containment nor a nested
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

Allocation, all Resource/owner effects, facts required by advertised Events and durable terminal key
state commit together or none. Concurrent distinct invocations cannot commit the
same canonical identity. The provider may reject unsupported allocation under
native policies/bounds, but MUST NOT silently allocate elsewhere in place of an
explicit supplied identity or root.

Deleting a Bead removes it from the live graph; deletion does not require physical
erasure. A Bead deletion fails with `incident-links-exist` while any live Link is
incident upon it. The caller must explicitly remove those Links first, or stage
legal removals in the same atomic batch. Hidden Links are not disclosed by this
failure. Link deletion creates no new Link revision and may atomically update its
owners. Deletion is not controlled-content erasure.

<a id="mutation-authorization"></a>
<a id="validation-and-results"></a>

## Admission, authorization and limits

A carrier-level refusal creates no idempotency disposition. Authentication,
non-disclosure, transport/request bounds, media negotiation, exact JSON/string
syntax and key admission occur before fresh execution. Under the admitted
carrier/key, retained-key handling precedes fresh liveness, guards, Type defaults,
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
10. absence of live incident Links for Bead deletion; and
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
version. No-op still records successful durable retry state and witnesses. Batch
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
and revision. Deletion mints no deleted edition or new revision. Result identity,
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
results carry no `changed`, Resource revision or provenance. They still retain
successful anti-reexecution state. Alias mutation emits no Resource Event.

An admitted alias spelling may be used as an update/delete Bead subject or either
Link endpoint, bare or as the uri of a pinned Reference. Resolve it to the current
canonical Bead when the fresh operation executes; stored/served References never
contain the alias or follow a later repoint. A missing alias is
`resource-not-found` under normal non-disclosure. A Link subject cannot use an
alias to become a Link. A put's own target never admits an alias. Retried locators
use the frozen comparison witnesses below instead of rebinding a known locator.

## Idempotency and recovery

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

The eight singleton operations have no sequence-only `binding-unavailable` case.
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
gets one creation revision. Existing deleted Resources get no new revision:
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

When Events is advertised, Write MUST durably produce Core's required Event facts
together with its effects and terminal decision. The remainder of this subsection
applies to that advertised support. Crash/retry cannot lose facts or mint duplicate transitions.
Failure/rollback/no-op produces none; aliases and allocation-only outcomes produce
no Resource lifecycle fact. Core owns the Event carrier, observation source,
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

## Conformance boundary

A Write provider must implement all eight ordinary operations, their complete
outcomes, fact production required by advertised Events, native/admitted Types constraints,
authorization, concurrency safety and durable key/recovery duties. Optional
capability advertisement requires its complete selected behavior and bounds; it
never replaces ordinary obligations. Ordinary reads retain Core meaning: an
authoritative result does not promise that another replica immediately observes
it, or add read-your-writes checkpoints, a public epoch or hot-tier absence shortcut.

Nonatomic sequence, public mutation receipts, replica synchronization, historical
Update/recovery extensions, parameterized/richer batch encodings, native Query,
set writes and public Type registration/lifecycle operations are not selected
by this text. Existing historical contracts retain their own meanings. Structural
schema examples and source publication do not establish provider, CLI, transaction,
concurrency, crash/retry or consumer qualification.
