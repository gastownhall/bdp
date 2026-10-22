# Scope-defined names: paired CLI and BDP correspondence

Author candidate under [#280](https://github.com/gastownhall/bdp/issues/280), sole plan [#59](https://github.com/gastownhall/bdp/issues/59). Base: published integration `050cb3b1e5550ba25d8ee51429a3f675b01e86d4`. This pairs a closed CLI design subset with its Core/Write consequences. It preserves PR284 and Trish's Types files. It is not a complete/adopted v0.1 contract, an implementation restart or a change to main/product pins.

## Problem and resulting behavior

Previously the draft assigned kind, collection roots and alias classification from reserved path spellings. A Bead like `task-42`, a Link like `relations/81`, or inventory URLs outside those roots conflicted with that text. The new model resolves complete Scope-defined paths, checks actual kind and follows advertised navigation. `beads/`, `links/` and `types/` remain legal deployment choices without protocol privilege.

| CLI design first | Matching protocol rule |
| --- | --- |
| Default Scope, relative IDs and explicit binding | Canonical Scope URI base; retained safe-path normalization and exact comparison |
| Absolute show without configuration | Direct point GET/HEAD; no inventory scan or Scope path stripping |
| Absolute write needs verified owner/operation binding | Point-read `service-desc` relation to owning Scope; explicit binding remains available |
| Root readers generic, Link readers assert kind | `BDP-Resource-Kind` on successful point representations, HEAD/304 and views; native JSON unchanged; CORS exposes it |
| Lists/CRUD follow discovery | Inventory paths independent of item IDs; directory routing unchanged, no inferred kind root |
| Alias operand is a complete Scope-relative name | Advertised alias base may equal Scope; authority resolves/classifies bindings, not a fixed `alias/` prefix |
| No implicit suffix-key equivalence | Full-URL collisions across Beads, Links and aliases; canonical non-reuse survives deletion, alias removal releases only its locator |
| No remote kind proof from path | External `bead` policy retains declared intent and HTTP(S) URL admission without pretending that a `/beads/` tail proves remote kind |

## Author choices requiring parent review

Prefix removal itself is selected, not a vote. These consequences are explicit proposals:

- Use one response metadata field for actual Resource kind, instead of modifying every native Resource/Reference body or performing an extra read. Properties/HEAD/304 need it too. It identifies the subject of an incident view, not its item kind.
- Reuse the existing registered `service-desc` relation on successful point reads for owning-Scope discovery. A supplied verified binding still works when no read is authorized. This is not a general legacy descriptor endpoint.
- Resolve alias names against Scope, permit a Scope-selected alias base, and compare entire URLs across both Resource kinds. This intentionally replaces old fixed-root tail collisions. Within an admitted alias namespace, alias permission exposes the same inherent chosen-identity collision signal as allocation; extending it across kinds must remain visible in review.
- Remove external Bead-shaped path validation. The existing `external:"bead"` value becomes HTTP(S) URL admission plus declared intent, with no remote-kind verification. The old rule never verified the remote Resource either. This broadening is necessary to express arbitrary Scope-defined paths; parent review must assess its wording/utility rather than silently keep an impossible shape test.

None adds remote acquisition, a mandatory new write guard, external integrity, lifetime reachability or global ID comparison. Literal pins, ownership, current/historical binding, authorization/non-disclosure and idempotent resolution witnesses retain their selected meanings.

## Schema and evidence boundary

Canonical/distributed JSON schema files are unchanged in this pair. The existing URI/reference definitions already admit paths without fixed roots and arbitrary HTTP(S) inventory URLs; the restriction was prose/behavior, not an asserted kind-prefix regex. Kind/owner navigation is HTTP metadata and collision/kind lookup are stateful rules, outside those JSON structural definitions. The focused [paper fixtures](../../fixtures/scope-namespace/candidate.json) separate inherited-schema grammar samples from unexecuted semantic expectations.

Existing fixed-root examples elsewhere remain valid Scope-selected paths. The new discovery/point examples demonstrate alternatives. Older catalog/fixture/runtime evidence is pinned to its old source; it is not magically qualified for the changed namespace/collision rules. A bounded acceptance disposition is included with the new cases. No existing runtime test is relabeled a passing v0.1 result.

The new source catalog is intentionally not selected by the existing v0 profile-contract loader's explicit catalog list. That loader and provider/CLI implementations remain held; the source rows are not an enabled runtime matrix. Ten inherited-schema grammar samples passed strict Ajv8.17.1 with URI formats; canonical and distribution schema bytes remain identical to baseline (SHA256 `15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327`). Thirty JSON fences parse, 48 local link targets resolve, eight catalog quotations/anchors match the actual source, and the 15 semantic cases remain unexecuted. Whitespace checks pass. This is static author evidence, not independent review or complete protocol qualification.

## Composition holds and next source

The integration branch is still a staged draft. A coherent selected v0.1 discovery/media/version binding remains a coordinated contract amendment; **do not advertise these changed semantics as unchanged `bdpVersion:"0"`** merely because inherited structural grammar examples still use that literal. This pair does not create parallel legacy endpoints or a migration fleet. General profile factoring, required Events D1/D2, exact-definition transport and #279 affiliation/nominal ownership projection remain their own coordinated source work. Trish's reviewed C1 R1/R2 and retained literal-pin clarification remain inputs, not implied adoption here.

Parent review must inspect this actual source pair, especially response metadata, alias full-URL collisions, external `bead` intent, and inherited evidence disposition. No council, parser, schema-runtime or provider qualification is claimed. Implementation remains paused.
