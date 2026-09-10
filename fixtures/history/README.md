# History wire illustrations

`wire.json` contains narrated examples for the 38 selected initial History units.
Every `condition` is an assumption, not an observed request, commit, authorization,
erasure, recovery or retention result. `schema` names the owning canonical bundle
shape. The protocol tests validate bodies, composition and rejected corruption;
they do not establish server/client/adapter behavior or capability support.

The owning law is [Historical resolution](../../docs/specs/bdp.md#historical-resolution)
and [Immutable change context](../../docs/specs/bdp.md#immutable-change-context).
The new `history-v1` catalog is unbound metadata. Its future executable manifest
must gate History rows on actual advertised capability and preserve cumulative
profile obligations. No existing Read cohort, original catalog row, manifest or
seal is rewritten here. Context-free ordinary/legacy fixtures remain intentional
compatibility coverage. Runtime authorization, whole-state reconstruction, restore,
erasure/import assurance, context commit/fan-out, HEAD/conditional behavior and
cursor snapshots remain explicit implementation and review gates.
