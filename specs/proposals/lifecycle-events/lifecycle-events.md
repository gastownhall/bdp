# Symmetric Resource lifecycle Events — WIP proposal

October 17, 2026. Requested change [#153](https://github.com/gastownhall/bdp/issues/153).
Trish owns shared wire reconciliation; Iris prepares this review draft. Base PR159
is d7197e97a29bff8f075028419afad05388e2e655. Donna's semantic/landing hold remains.

**Proposed specification material, not an adopted Event encoding.** Current
[Write Events](../../profiles/write/write.md#events-and-event-sources) still use
created/updated/deleted/linked/unlinked. This draft changes no runtime parser,
closed current schema or retained log. The legacy bd 1.3 journal is outside scope.

## Selected semantic direction

Use one common Event envelope with Resource kind and transition as independent
axes. Beads and Links each have created, updated, deleted and imported transitions.
The dotted names in #153 are conceptual; exact discriminator/subject fields remain
open. A mixed batch remains one operation array, not separate Bead/Link forms.
Import is not a seventh batch member.

Creation carries the admitted initial state. Update carries committed deltas,
previous/new revisions and recorded provenance, not an entire postimage. Consumers
need the correct prior revision or a defined resynchronization route. Snapshot
and change-group postimages remain distinct interfaces.

Deletion carries identity and the relevant final recorded revision. For a Link,
also retain Type and exact source/target References with stored pins; consumers
cannot reconstruct them by GET after deletion. Whether final revision means last
live or a new terminal state follows the selected shared deletion/History contract;
this proposal does not quietly add terminal retention.

## Incidence and ownership

The Link lifecycle fact replaces linked/unlinked. Endpoint Bead Event Sources
project that same underlying fact under access/disclosure rules. Updates to Links
must be observable where that incidence is supported. One self-Link lifecycle
fact is projected once per applicable Source, not twice for its two endpoint roles.
Source-local IDs/cursors may differ; define stable underlying-fact correlation
without pretending those IDs are globally identical.

Ordinary incidence does not version either endpoint. An owned-Link mutation also
versions its owning source and emits the source's own update. Those are distinct
Resource transitions in the same committed group; retain the owned-Link delta and
per-transition provenance. Never confuse target incidence with source ownership.
Keep operation order and each actual revision effect; no Events escape rollback,
and ordinary semantic no-op emits none. No requirement for one revision per batch.

## Import transition

Admission preserves original versions/provenance and creates a new local current
head. Emit one imported fact for that transition, correlated with its source
version and committed admission; do not also count it as an ordinary create/update.
No fake property delta, mutable original provenance or replayed historical Events.
Retries do not mint duplicate heads/Events. Initial fresh-destination import refuses
occupied destinations; this amendment does not add merge/upsert or identity remint.

Polly owns the shared Inception origin/entry design; exact encoding and adoption
remain pending. Original identity creation differs from destination admission and
revision operation. Current importer authentication does not authenticate source
claims. Optional Activity is the existing independently reported work Bead, not a
required second Event/provenance mechanism.

## Decisions held before promotion

- Wire discriminator, subject/resource-kind representation and required fields;
  delta form, exact revision/provenance linkage and minimum creation context.
- Imported payload: reconstructible source-version linkage/postimage policy,
  admission/receipt correlation, no-op rules and atomic owned-source effects.
- Underlying-fact identity and projection deduplication, authorization/disclosure,
  source-local ordering, cursor expiry and snapshot/catch-up boundary behavior.
- Group/receipt Event counts and limits after incidence projection changes.
- Compatibility for retained old Events and readers: version negotiation or explicit
  refusal/adapter policy; no relabeling old logs as the new format.
- Alignment with changed Type/pin/deletion rules: current Core immutable fields are
  not silently amended by an Event example.

Broader normative changes and full provenance are not automatically Preview 3 gates.
Donna/Janet select release scope; native Memory must not wait for a BDP runtime.

## Review fixtures and qualification

`fact-cases.schema.json` and `../../../fixtures/specs/lifecycle-events/fact-cases.json` use a **fixture-only semantic
carrier** to make missing Link deletion context, update-postimage drift, ownership,
self-Link deduplication and rollback/no-op expectations inspectable. Counts check fixture annotation consistency only: they are not derived from
operation inputs. These vectors do not exercise ownership causality, rollback,
no-op execution or two endpoint Event Sources/self-Link projection. Those remain
inspectable expectations and unexercised runtime acceptance obligations. They are not
candidate production Event JSON. Validating this carrier cannot qualify transport,
source projections, recovery, security, History, atomicity or Event publication.

Run `uv run --no-project --with 'jsonschema[format]' python scripts/check_lifecycle_examples.py`.
Before adoption, amend owning prose/schema/parsers/conformance together. Runtime
controls must exercise mixed Bead/Link batches; ordinary/owned Link create-update-
delete; pinned References; each visible/hidden endpoint; self-Link deduplication;
rollback/no-op; retained retry; Event limits; snapshot catch-up; and old-log policy.

[Review and check status](REVIEW.md) records the per-draft council disposition.

The proposed one-fact self-Link projection deliberately replaces current Write's
two incidence facts (source before target). Preserve endpoint-role meaning while
reconciling whether it is explicit projection context or derived from disclosed
Link endpoints; exact encoding/disclosure remains held. Current Link creation
already requires endpoint context; this fixture carrier retains it. Context on
updated/imported Link facts needs shared payload reconciliation. Imported payload
postimage policy remains OPEN: the fixture excludes fake ordinary-update deltas,
but does not prohibit a future agreed reconstructible postimage by fiat. A deleted
fact carries no retained body/delta. This carrier is not Event-wire adoption.
