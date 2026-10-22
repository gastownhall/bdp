# BDPv0.1 affiliation correspondence

**Author candidate under [#279](https://github.com/gastownhall/bdp/issues/279),
not an independently adoptable protocol revision.** This is the carrier/ordinary
input slice of the sole [#59 consolidation](https://github.com/gastownhall/bdp/issues/59),
based on integration `365f337fd161e0c888b0ab6dc3a632bfbcb28581`.
It must be composed with Core/Write prose, the illustrative Write schema, Types,
required Events and the selected contract boundary before conformance is claimed.
It neither closes #279 nor authorizes runtime or product-pin changes.

Types correspondence source: [PR283](https://github.com/gastownhall/bdp/pull/283),
exact `a2aa88d9b5a0e0d78f48de2967d4ceaa38177876`. Trish owns that disjoint
Type-local source/artifact lane and integration; Sybil owns this Core/Write seam.
This candidate does not import the Types branch or change its artifacts.

## Selected common meaning

Donna selected one `type` field using the existing Reference vocabulary:

```json
{"type":"https://types.example/Task"}
```

```json
{"type":{"uri":"https://types.example/Task","revision":"definition-r4"}}
```

The Type identity remains an absolute HTTP(S) URI. The exact object has only
`uri` and a nonempty opaque `revision`. There is no separate `typeRevision`.
The common carrier does not admit a relative Type name, a batch-local creation
binding or a broader arbitrary-URI identity by accident. It does not prescribe
that a Core-only provider understand a Type-definition language.

Under Types, an explicitly unpinned authored value resolves once to the Scope's
explicitly registered exact default before commit. No default means refusal;
there is no guess from a sole/newest installation, network acquisition or implicit
registration. Stored and returned affiliation is exact. A Core-only provider can
carry the common shape without implementing those interpretation/default rules.

An update omitting `type` preserves the complete affiliation. Supplying it replaces
the whole affiliation. A change of nominal Type or exact definition revision is
an effectful Resource transition even when properties/metadata are unchanged.
Supplying the same resolved affiliation alone is a no-op. Ordinary authorization,
liveness, optional `expectedRevision`, idempotency, property-access policy and
complete applicable validation still apply. Retyping adds no mandatory guard.

No identity, Bead/Link kind or Link endpoint changes as part of affiliation
replacement. Properties remain unless explicitly edited. A failed destination or
final incident-graph check rolls back the whole atomic operation. Retained old
Resource revisions preserve their affiliation and recorded owned state.

## Grammar correspondence in this slice

The canonical [bundle](../../specs/profiles/core/bdp-v0.schema.json) and its
distribution mirror receive only these changes:

| Definition | Candidate change |
| --- | --- |
| `typeReference` | New union of admitted Type URI and exact affiliation. |
| `pinnedTypeReference` | Reuses closed `pinnedReference`, narrowing `uri` to the existing Type identity domain. |
| `beadRecord`, `linkRecord` | Common affiliation carrier on current/historical/mutation/replica postimages through existing shared references. |
| `createBeadMembers`, `createLinkMembers` | Required `type` accepts that carrier. |
| `updateBeadMembers`, `updateLinkMembers` | Optional `type`; at least one of `type`, `propertiesChange`, `metadataChange` must be supplied. Empty ordinary patch arrays remain admitted. |
| `resourceIdentity` | Deletion results and tombstones retain the affiliation of the version they identify. |
| `typedLinkReference`, `ownedLinkDelta` | Affiliation-bearing recorded Link facts use the common carrier. This does not select a new ownership delta algorithm. |
| `event.subjectType` | The subject affiliation can be carried exactly. Event `type` remains the fact discriminator. |

Singleton, historical sequence and atomic batch input entry points inherit their
shared member grammar. Retaining the historical sequence schema is accounting for
the existing bundle, not reinstating sequence in the target Write design.
No empty mutation with all three update members omitted is admitted. An explicit
Type-only input needs no dummy empty properties patch:

```json
{
  "bead":"task-42",
  "type":{"uri":"https://types.example/Task","revision":"definition-r4"},
  "expectedRevision":"resource-r7"
}
```

The universal Core schema admits both common forms. Types' exact-output obligation
is contextual and must be enforced when validating a Types Scope, using the exact
form; schema acceptance alone does not prove registration, default resolution or
definition-category validity. Type definition identities, descriptor IDs, Type-ID
arrays and `ownedLinks` map keys remain URI strings. A pinned affiliation does not
turn a JSON object member name into an object or change nominal Type identity.

## Required remaining composition

| Seam | Required treatment before coherent adoption |
| --- | --- |
| Core model and Types extraction | Remove immutable instance-affiliation assertions, include affiliation in revision-covered state and preserve identity/kind/endpoint invariants. Reconcile optional Types with old mandatory descriptor semantics; this grammar slice does not perform that extraction. |
| Ordinary Write and illustrative schema | Carry optional `type` through signatures/examples, whole-reference replacement, no-op comparison, final validation and retries. The old illustrative `typeId` remains a nominal URI definition; use a distinct affiliation definition rather than broadening every identity. |
| Required Type-only Events | Existing `updatedData` requires a property/metadata edit or an owned-Link delta. It cannot yet encode an affiliation-only transition. Select and specify the committed affiliation effect using the shared command vocabulary; do not emit a fake patch, omit the Event or claim the carrier widening solves this. Delta/postimage representation selection remains open. |
| Ownership transitions | A Link entering/leaving ownership versions its source atomically; source-Bead retyping recomputes its recorded owned set. Preserve old versions, applicable attribution and final graph validity. Membership/bucket movement and their Event encoding need explicit correspondence; no new source-pin policy follows from this carrier. |
| Historical/event facts | Each record/fact retains the affiliation at the revision it describes, never today's live Type. Changing a default or registering a newer definition cannot rewrite old affiliations. |
| Retry identity | Preserve authored operands and one resolved exact affiliation across uncertain recovery. An omitted Type is different from an explicitly unpinned replacement; installing/changing a default cannot re-execute a retained key. Exact normal-form and contract binding must be specified. |
| Selection/CLI | `--exact-type` means nominal identity, not exact definition revision. Family membership uses the applicable exact installed closure. JSON predicates over the former string `type` field need deliberate lowering/normalization under the selected contract; object affiliations must not silently produce false negatives. CLI Type-pin authoring is still to select. |
| Contract/version boundary | Old closed v0 consumers need a selected migration or faithful compatibility contract. Merely accepting a union in the v0-named author bundle does not make pinned output decodable by an old string-only client. Discovery, contract selection and retention of issued artifacts remain coordinated author work. |

Native Issue/Dependency constraints remain applicable. Type storage is distinct
from registration for instance use. This does not introduce Type lifecycle verbs,
per-Link-Type pin policy, owned-source proposal adoption or a new profile gate for
the product's fixed Memory catalog.

## Semantic acceptance cases still to qualify

These are written requirements, not executed behavior claims:

| Case | Required outcome |
| --- | --- |
| Same nominal Type, new exact definition revision, no object edits | Validate the destination and mint one fresh Resource revision; keep identity and properties. |
| Different nominal Type with targeted property edits | Replace the affiliation and apply the edits atomically; preserve all other permitted properties. |
| Type omitted after the registered default changes | Preserve the previous exact affiliation; do not consult the new default for this update. |
| Unpinned Type input with no explicitly selected default | Refuse without guessing, fetching or registering a definition. |
| Destination rejects an existing property or an affected incident Link | Refuse the entire operation; no partial affiliation/property/revision/Event effects. An atomic batch may repair the final incident graph under the accepted validation timing. |
| Link retyping enters or leaves its source's owned set | Commit the Link and source revision effects atomically and record the resulting owned set, with truthful Event facts; exact delta encoding remains open. |
| Resource is retyped after an earlier retained revision | Historical reads and recorded facts retain the earlier exact affiliation and recorded owned state. |
| A→B→A in one atomic batch | Two effectful operation-local transitions, with distinct revisions and required Event facts; equal final affiliation does not erase the intermediate transition. |

## Evidence limits

408 focused strict-Ajv/full-format assertions pass for this slice, covering admitted/rejected carrier values, singleton/
sequence/batch inputs, omission and empty-input controls, affiliation-bearing
outputs, unchanged nominal-identity/endpoint grammars and schema mirror equality.
The three JSON fragments above parse and satisfy their corresponding candidate
grammar. The scope check confines changes to this note and the two schema copies,
with ten existing definitions amended and two added; all other definitions and
the schema envelope remain unchanged. Whitespace checks pass.
Those are grammar checks, not execution of registration/default resolution,
authorization, idempotency, revisions, final graph validation or Event production.
The unresolved composition above remains a conformance/adoption hold, even if all
shape checks pass. No hosted or runtime qualification is implied.
