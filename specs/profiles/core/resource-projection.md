# Shared Resource projection: draft amendment

**Status: October 26, 2026 incorporation candidate.** Donna accepted one
server-side Resource projection contract for current point GET, exact historical
point GET, and each Resource returned by List. This module specifies that target;
physical parameters, discovery, framing, and exact validator bindings still need
integration. It does not change held schema bytes or advertise provider support.

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
- Protect canonical identity, actual Type, selected revision, and whole source/
  target References on Links. A mask cannot misrepresent their meaning.
- `title` is an ordinary optional property, not protected context.
- Properties/metadata admit nested paths. Revision provenance is whole-plane only
  initially; nested provenance slicing is deferred. References stay whole.
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

## Required positive/refusal coverage

Pair current GET and same-edition List under no mask, include, omit, both, missing
paths, empty optional projection, whole provenance, and Link Reference protection.
Repeat content projection on an exact saved edition while current content differs.
Check authorization before masking, protected omission refusal, unsupported
capability, native view separation, representation validators, and unchanged
count/selection/ordering. Those are authored obligations until a provider suite
actually executes them.
