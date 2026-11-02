# Reference candidate independent review

A bounded read-only Claude review completed normally against the recorded candidate
manifest (695 seconds, no commands/writes/agents/network/MCP). Full private inputs,
findings and unchanged-source receipt are retained outside the product tree. This
report records disposition, not a passed whole-candidate review or runtime proof.

| Finding | Disposition |
| --- | --- |
| Per-offset reservation rejects sets above10001 and magnifies retained-state cost | Replaced only in the new resizable mode by one bounded snapshot authority and authenticated offsets. Nonrepeating per-engine identities, a fresh engine key and per-snapshot MAC keys prevent expired-token rebinding even if an entropy callback repeats. No per-offset token/page cache. Existing fixed-page behavior stays under its original controls. |
| HEAD/304 retain undelivered first-page cursors | Source-private release handles withdraw only new first pages; continuation HEAD preserves its already-issued context. Actual12MiB observations repeated across HEAD/304 prove the unchanged32MiB cap is not consumed. |
| Large-scan materialization precedes budgets | SQLite iteration now counts complete serialized bytes before JSON materialization and refuses over32MiB with413 limit-exceeded/never; no truncated prefix escapes. Actual570-record/34MiB witness proves refusal leaves committed point reads available. |
| Inventory view=links misclassified as an incident subject | Inventory parameters are validated first, yielding400 invalid-parameter. Existing non-Bead incident selection also gives400; genuinely absent subjects give404. |
| Bare unadvertised Events address returns400 | Bare address gives404 resource-not-found/after-state-change; explicit view=events gives400 invalid-parameter/never. |
| Each collection item is re-serialized/re-admitted | Validate the complete current collection schema once, then check identity/duplicates/unselected aggregates without rewriting native bytes. |
| Candidate type comment overstates full-record validation | The shared structural evaluator now explicitly assigns complete Resource validation to its caller. |
| Page cache/media checks differ from siblings | New page reads require private/no-store and validate provided empty-response media. |
| Redundant owner discovery | Retained as a conservative owner check; no implicit cache/authority reuse introduced. |
| Nineteen full-run failures cannot be one pin guard | Correct: the original run had19 failures in8 files. The18 historical/source/layout/export failures are covered by the520-test targeted repair run; the remaining policy guard was held until the independent interpretation decision. Full repaired suite/hosted CI remain mandatory. |

The reviewer explicitly permits retaining private `schema-resource-index-2` after
checking the graph's actual decoder imports and the leaf helper's erased type-only
Ajv import. Only the protocol barrel's source pin changes; all13 other required
pins were hashed and match. The manifest records the real retained-v0.1 annotation
vocabulary change outside the graph policy. This is not a Read evidence reseal,
profile/CLI qualification or claim that all wire admission stayed unchanged.

The review repair passes111 tests across5 affected files plus typecheck. Original
failures and the initial reservation implementation remain in Git/log history.
A focused closure review, actual installed smoke and complete final qualification
are still pending; no blocker is silently waived here.

The subsequent transport witness confirmed a separate18000-byte identity
creation200/read431 mismatch. The reference-only finite HTTP envelope and
advertised/enforced request bounds are now coupled to committed record sizes;
a prospective native next is checked after form serialization at maximum page
size.20 transport/collection tests, typecheck and normal build pass. Actual packed
smoke passes, including the new service/client page/alias/pin/reopen/original-replay
witness and all existing public export/lifecycle/refusal controls. Full final
suite, hosted required real-bd CI and focused closure review remain pending.
