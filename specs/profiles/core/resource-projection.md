# Shared Resource projection: draft amendment

**Status: October 26, 2026 incorporation candidate.** Donna accepted one
server-side Resource projection contract for current point GET, exact historical
point GET, and each Resource returned by List. This module specifies that target;
the [native binding proposal](read-operations.md) now supplies physical parameters,
discovery, framing and validator rules for review and integration. It does not change held schema bytes or advertise provider support.
It composes [Core selection](core.md#collection-retrieval-and-selection),
[ordinary read delivery](read-delivery.md), and the selected
[contract binding](contract-binding.md) only after their explicit amendments.

## Select content, then represent it

A point request first selects its authorized Resource edition. A List request
first selects its authorized current Resource population. Projection then changes
the represented fields, never identity, revision, authorization, membership,
ordering, count, or acquisition. Required filtering/sorting uses full selected
data even if a field is omitted from the response.

The same visible edition, read context, and projection mask yield the same
Resource content in GET and a corresponding List item. This equivalence does not
equate their envelopes, errors, validators, or continuation. A failed point lookup
and a successful empty List remain different outcomes. A revision predicate on a
current List does not acquire historical editions.

For an exact historical GET, project the selected saved edition. Do not substitute
current fields, a nearest revision, or present-day Type content. Full historical
authorization and retention rules are checked before projection. A mask is not
permission to read otherwise unavailable history.

## Mask composition

- No includes or omissions returns the full selected Resource representation.
- Includes union the selected original paths, plus protected context.
- Omissions subtract from that union; omit wins and argument order has no effect.
- Root include (`""`, the empty JSON Pointer) selects the whole Resource. Root
  omission refuses. Supplied mask arrays are nonempty; omit an array member to
  request no mask of that kind. Invalid RFC 6901 escapes refuse.
  Omit an empty projection container rather than serializing `{}` in this AST.
- Protect canonical identity, actual Type, selected revision, and whole source/
  target References on Links. A mask cannot misrepresent their meaning.
- Protected context cannot be sliced with nested include paths either. Protection
  is Resource-kind-aware: an absent `/source` on a Bead is an ordinary no-op,
  whereas a Link's `/source` Reference is protected whole.
- `title` is an ordinary optional property, not protected context.
- Properties/metadata admit nested paths. Revision provenance, recorded owned
  Links (`ownedLinks`), and any admitted included-Link plane (`links`) are whole-
  plane only initially. Each may be omitted by a mask; omission must be declared
  as projection, not misrepresented as a full record with no recorded state.
  Nested plane slicing is deferred. References stay whole.
- A valid absent optional include adds nothing, and an absent omission changes
  nothing. An include set matching no optional fields returns protected context
  only. Do not synthesize null or fall back to a full Resource.

Mask paths refer to the stable logical Resource shape. Schema evolution needs an
explicit compatibility story before this shape is locked. Path syntax,
unsupported/protected omissions, and unsupported capability remain errors.
Ordinary missing optional data is nonfatal.

Missing-path warnings are advisory and deduplicated per path when supported by
useful authorized evidence. They MUST NOT require an extra full scan, infer
absence from empty/incomplete pages, expose hidden fields, or alter selection or
success. Exact diagnostic framing belongs to the common response contract.

## Shared operations and existing views

`resources` results in the [Query draft](query.md) reuse this representation
contract. Count selects the same population before paging and does not depend on
masks. Graph mixed-component masking needs an explicit target convention; this
module does not invent it.

Properties-only, included-Link aggregates, Versions summaries, Events, and Type
inventories retain their own representations. A mask does not request a native
view or acquire related Resources. Versions is the separately accepted subject
History GET view; summary rows do not automatically accept Resource masks.

Current native exact GET has a revision-only query rule. Adoption MUST explicitly
amend that rule for service-side projection. Client rendering of a full response
does not establish server projection support. HTTP validators describe their
actual selected representation and policy; no client manufactures a validator
from a Resource revision or assumes a full-body validator qualifies another view.

The current Core collection rules require complete Resource items and reject
unsupported query parameters. `read-delivery.md` likewise specifies full inventory
records. Those clauses need explicit projection-capable amendments; an unchanged
service remains required to refuse unsupported masks. The current always-metadata
and owning-record owned-state requirements also need to distinguish an authorized
projected response from a full record. Projection does not weaken the stored
record, full-read, or authorization requirements.

Held schema definitions require `properties`, and current record definitions also
require `metadata`. Therefore adoption needs projected Bead/Link representation
definitions and collection-item arms tied to an actual projected invocation.
Protected-context-only responses cannot validate as the held full-record types.
Do not globally make required stored/full-record fields optional or add a projection
marker inside the Resource to work around that mismatch. Native response schema,
capability/version binding, and framing must identify the projection contract.

## Required positive/refusal coverage

Pair current GET and same-edition List under no mask, include, omit, both, missing
paths, empty optional projection, whole provenance, and Link Reference protection.
Repeat content projection on an exact saved edition while current content differs.
Check authorization before masking, protected omission refusal, unsupported
capability, native view separation, representation validators, and unchanged
count/selection/ordering. Those are authored obligations until a provider suite
actually executes them.
