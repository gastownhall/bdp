> Historical source snapshot from commit `692d801231c78e12b456d8c5213bdf137a6b534d`. This is not the canonical review specification. See the [current specification](../../../../README.md). Original source and hash are recorded in the archive index.

---
status: draft
intended-status: normative
version: "0.1"
---

# Retained Write candidate

Write inherits [retained Core](../core/retained-core.md) and adds individually atomic
Resource CRUD and aliases, safe retry outcomes and committed required Event facts.
The [canonical CLI](../../../docs/cli-design/bdp-cli.md) expresses the same operations.
This is selected v0.1 source, not the inherited Read+Update/Transactional contract
or an implementation claim. Events, final publication and Types/common-source
counterparts have paired source in the [current source map](../../../docs/design/bdp-v0.1-current-source-map.md).
Implementation and consumer qualification remain separate.

## Eight ordinary targets, one Scope and complete outcomes

Write discovery uses profile write, the Core inventories/events and required
operations/aliases URLs. `writeOperationDirectory` is closed: createBead,
updateBead, deleteBead, createLink, updateLink, deleteLink, putAlias, deleteAlias,
each a distinct absolute HTTP(S) operation URL served for that Scope. The ordinary
URL supplies its operation kind; a client MUST refuse an ambiguous directory
before dispatch. Sharing handler code does not merge those wire addresses. No fixed suffix,
sequence, batch, set-write or public receipt target is required in this directory.
Atomic batch is separately advertised by its existing capability. A caller follows
navigation, verifies Scope/kind/contract, and never guesses a destination from a
Resource, Type or endpoint path.

Each target accepts POST with the corresponding existing singleton request, one
Idempotency-Key and selected v0.1 media. The URL supplies operation kind; operation,
name and @name bindings are not singleton body fields. HTTP conditions on the
command URL are not Resource guards. Ordinary method/CORS/media/authorization and
exact JSON/numeric admission rules remain; no generic-JSON fallback after rejection.

The ordinary decision imports [creation/allocation](write.md#creation-and-identity-allocation),
[guards and no-ops](write.md#mutation-revisions-and-guards), explicit Bead/Link/alias
operation check order, mutation authorization and native bounds. The selected
[affiliation](../core/affiliations.md), [endpoint correction](link-updates.md) and
[object-edit](object-edits.md) amendments
govern mutable whole Type affiliation, literal replacement versus patch, policy,
recorded ownership and resulting-state equality. Old installed-descriptor requirements
are conditional Types duties, not a hidden obligation on a Core-only provider.
Native constraints still apply. Syntax, authorization, guard, protected-input and
exact-Reference admission are not generally deferred to final graph validation.

A decision atomically commits all its Resource/owner effects, allocated identities,
required semantic facts and terminal retry state, or none. One operation need not
mean one storage row. A no-op still checks guards/policy and durably succeeds, but
mints no revision/provenance/Event. A changed Type pin is an effect. Existing endpoint
pins remain literal; they are not guards or prior-membership proofs. No automatic
repin/shared Resource token follows an induced owner revision.

HTTP 200 returns the complete ordinary mutationResult or aliasResult directly, with
private/no-store and no operation-target ETag or Location. Resource create/delete
has changed true; update reports actual changed. Create/update has the full original
postimage; delete has the final live identity, no newly minted deleted version.
A Link result carries [ownerRevisions](link-updates.md#complete-owner-revision-context)
for every distinct initial/final owner, including ownership exit and a source move
with two owners. A genuine owned no-op reports unchanged context.
Alias results retain their own created/updated/deleted shape, no changed member,
Resource revision or invented provenance. Ordinary results do not turn into public
receipts when the service gains another capability. Retained output reauthorization
and erasure remain binding; no partial postimage masquerades as complete success.

Direct failures use the existing [Write Problem table](write.md#readupdate-problem-details)
where its underlying singleton case applies; sequence-only binding-unavailable is
not a new singleton case. The selected media binding overrides its inherited generic
JSON wording. When complete application History is advertised, applicable
[mutation-context duties](write.md#history-context-on-mutation-results) also apply,
without importing Transactional carriers or replication.

## Standalone key foundation, independent of sequence and replication

These paragraphs extract the singleton meaning of the existing
[idempotency](write.md#idempotency-keys), [dispositions](write.md#duplicate-keys-and-retained-dispositions),
[retention](write.md#outcome-retention) and [recovery](write.md#durability-and-recovery)
clauses. They do not import sequence admission/tail execution or Transactional
history coordinates.

Keys are byte-exact case-sensitive ASCII `[A-Za-z0-9_-]{1,256}`, supplied once.
Namespace remains canonical Scope URL plus authenticated principal (anonymous is
one shared principal). Carried attribution/Authorization View do not partition it;
there is no extra profile, feature-version, transport-host or replica-epoch component. All mutation routes for that namespace
consult one authoritative key state. Changing credentials does not change the
established principal; authentication rules determine its identity.

Semantic identity includes selected contract/capabilities, operation kind and its
normalized complete input. Preserve guards/provenance, order of arrays/patches,
whole affiliation, replacement versus patch and exact values. Creation omissions
normalize properties/metadata to empty objects. JSON object order is immaterial.
Resolve local References canonically; opaque external URIs/pins keep their literal
meaning. Preserve original alias locators and targets/misses as comparison witnesses.
A later repoint cannot rebind an original locator; previously unrecorded locators
use the existing comparison rules without granting execution/disclosure permission.
No public fingerprint algorithm or portable identity mechanism is introduced.

Authenticate and admit the carrier/key before fresh execution; a carrier-level
refusal creates no disposition. A known retained/expired key is compared before
fresh liveness, guards, defaults, support or bounds could mistake it for new work:

1. Retained same meaning returns the original terminal disposition without effects.
2. Retained/expired different meaning returns idempotency-conflict, preserving state.
3. An in-flight claimed key executes nothing again and uses idempotency-in-progress
   with existing transient retry advice (or waits within bounds).
4. Unknown admitted meaning claims the key and executes at most once; terminal
   non-transient success/failure is retained. Existing after-delay failures are
   transient and create no retained terminal disposition.

Current authorization rechecks disclosure of a retained create/update record as
retained, even if no longer current or live. Denial returns forbidden without
replacing the original disposition or permitting reexecution. Deleted identities,
retained Problems and alias results keep their existing distinct disclosure rules.
Missing result bytes are not permission to execute again. A recovered postimage is
the original transition, not a fresh read or newly resolved default.

Advertised retention.idempotency is a minimum interval after terminal outcome;
omission leaves no client-known window. After full result expiry, every successful
key, including a no-op, retains compact anti-reexecution identity/witness/allocation
state for the logical Scope's lifetime. Same-meaning expired success returns
idempotency-expired, changed meaning conflicts. An expired failure that committed
nothing may be forgotten and admitted later under its guards. Alias successes also
retain their successful-key non-reexecution state; no-op aliases do not evade it.

Effects, semantic identity, allocations and terminal outcome become durable together.
A crash leaves either no committed effects and an unknown/cleared abandoned claim,
or the retained original decision, never effects behind an unknown key. Abandoned
claims cannot stay in-progress indefinitely; recovery does not invent new work.
Restart/failover preserve retained dispositions, tombstones and claim resolution.
A restore unable to preserve that continuity cannot masquerade as the same logical
Scope/key namespace; the existing canonical-Scope/non-reuse rule remains.

Adding/removing capabilities or withdrawing fresh-write admission does not erase
issued work or its promised recovery interval. Preserve the bound recovery route
and compact successful-key state, or refuse the incompatible configuration change.
A replay does not require the feature to remain available for new work. No public
request/receipt query is necessary: retrying the frozen same invocation is recovery.

## Optional batch and remaining semantic gates

The [atomic-batch capability](atomic-batch.md) remains independent of replica
synchronization: six ordinary CRUD records, name capture, one all-or-nothing decision
and complete bounded inline ordered results. Its shared key namespace does not make
batch and singleton semantic context equal; switching carriers with an existing key
conflicts under the selected capability rules. Retained comparison precedes new
support admission. No sequential fallback, chunking, sets or alias members.

Types' selected final-graph allowances apply only when that semantics is advertised;
intermediate arity/endpoint eligibility repair does not defer other admission rules.
[Final publication](../core/publication.md) stages members but publishes at most one
new version per final changed Resource/owner. Results separate input identity
mappings from unique final outcomes. Net-zero covered state retains revisions and
successful retry evidence; allocation/create-delete remains a durable effect.

Required [Event facts](../core/events.md) become durable with effects. Donna has
selected required postimages/optional deltas and declared coverage/bounded replay/
explicit gaps. Final publication, owner context and Events agree under the selected
amendment; earlier operation-local batch examples are superseded. Replica
Event/epoch/receipt machinery is not imported. Paired selected source is assembled;
a service may advertise this entry only after its own complete implementation and
consumer-facing qualification.
Ordinary reads retain Core semantics: no cross-replica freshness
checkpoint/read-your-writes guarantee or hot-tier absence shortcut is added.

## Optional rooted identity allocation

The independently selected [id-root1 amendment](id-root.md) adds `idRoot` to
Bead/Link creation on these same operation URLs. Its feature-owned carrier and
explicit atomic-batch1 composition leave unextended common requests unchanged.
Presence selects rooted allocation; advertisement alone never changes a base
request. Type default pinning stays service-side under Types; it needs no client
definition lookup. Wire References remain URI/exact-token values, not local ordinals.

## Markdown schema contracts

The [Write schema contracts](write-contracts.md) index ordinary mutation and separately selected batch shapes using the [Markdown JSON Schema DSL](../../formats/markdown-json-schema.md). The [complete common schema companion](../core/bdp-v0.1.schema.md) preserves the canonical bundle's identity, references, conditions and closure. Schema notation does not replace atomic admission, authorization, final publication or retained-key rules. It adds no operations or capability support.
