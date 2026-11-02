# Transfer draft: correspondence and decisions

November 1, 2026. Iris supplied this contribution for the same PR337 editorial corpus. Root integrated
the proposed [Transfer profile](../../specs/profiles/transfer/transfer.md) and its
[CLI mapping](../cli-design/bdp-cli.md#proposed-transfer-commands) after receiving the
exact input files. Core/Write/Types and protocol schemas remain unchanged.
Original input hashes are recorded below; publication is not adoption or runtime
qualification.

## Selected source and read scope

Canonical target: PR337 commit 72f92fe8293ee16a7cb7159507124592381e445a in /Users/dbox/repos/wt/trish/trish-bdp-canonical-spec-review-20261101. HEAD was read as that exact commit before drafting. This was a focused clause correspondence pass, **not** a complete review of the roughly ten-thousand-line Core/Write/Types corpus. The initial combined read exceeded output limits; the clauses listed below were subsequently read directly in bounded ranges. No claim rests on unseen portions of that truncated output.

| Document / selected clauses | Transfer correspondence |
| --- | --- |
| specs/profiles/core/core.md:44–255 | Immutable protocol identity, separate optional capability selection, Scope nonreuse/no required kind prefixes, full Resource/Reference carriers and external opacity. Stable DNS-neutral identity is pending, not adopted here. |
| Core:761–872 | Recorded owned state, complete authorization closure, exact JSON value comparison and binary64 round-trip numeric admission, immutable retained addresses. |
| Core:967–1018 | revisionProvenance is the one common envelope; actor basis carries data, not authentication. Old attribution/changeContext are not aliases. |
| Core:2679–2984 | Optional History, full historical records, explicit missing-state and erasure evidence, retained lineage/order versus traversal order, origin/erasure admission duties. Public History pages are authorization-relative, not complete backup proof. |
| Core:3392–3455 | Optional Events, truthful observation coverage, durable local Write facts when advertised, baseline initialization without fake creates, no replica/import capability implied by Events. |
| specs/profiles/write/write.md:182–220 | Ordinary creation/nonreuse and deletion are different from original-state restoration; removing kind prefixes does not remove lifetime collision rules. |
| Write:594–720 | One Scope/principal key namespace, frozen semantic identity, retained-key resolution before fresh execution, atomic outcome durability, expiry/continuity and no automatic fresh-key recovery. |
| Write:915–999 | Final whole publication, net no-op, allocation-only effects, complete owner captures, optional Event transitions. Transfer must specify its historical admission composition rather than pretend CRUD mints original revisions. |
| specs/profiles/types/types.md:85–128 | Scope-wide Types1 exact interpretation, rejectable selection, no silent base fallback, retained recovery. Package data cannot activate Types or select a new-import epoch. |
| Types:2093–2267 | Exact installed identities and publication authority, preregistered import dependencies/no auto-install/default, retained availability versus retired new-affiliation eligibility. Retired fresh restoration remains an explicit admission gap. |
| docs/cli-design/bdp-cli.md:200–246,614–632 | Cleo schema2 framing, emission versus result, output selection, unknown versus output failure and exact diagnosis-based exit mapping. Current stale Required Events heading is not propagated. |
| docs/cli-design/read-output.md:1–133 | Descriptor binding, no contract claim before binding, masks are projections and cannot claim a complete transfer, stdout/stderr separation. |
| docs/spec-review/cli-mismatches.md | CLI-01..08 corrections and shared profile/pack/output factoring are received from2aceaa9. The Transfer mapping does not undo them or invent another CLI authority. |

Iris's preserved private source index and snapshots record exact selected bytes;
they are provenance, not an additional required specification. Root verified the
manifest and all twelve declared input files. Core/Write/Types remain byte-identical
at the receiving commit; this focused correspondence is not full-corpus or runtime
qualification.

## Recovered outcomes and their limits

Recovered human outcomes are retained in Iris's original decision/Type-registration
receipts and Janet's retained-data recovery ruling. The public
[Resource-shaped comparison](https://github.com/donnabox/agent-coordination/tree/4824cce9d0f2c3716ae4f9bd972bbf891863b658/context/iris/independent-362-356-20261031/native-B-resource-comparison01)
and [corrected closure](https://github.com/donnabox/agent-coordination/blob/69cb96de687b35861826f9d7c5b1f29ca79d236e/context/iris/independent-362-356-20261031/native-B-resource-comparison01/NATIVE-RESOURCE-COMPARISON02-CLOSURE.md)
supply illustrative shape evidence, not complete portable-backup proof.

Settled: Resource-first/minimal adornment, both encodings, same-Scope original identities, all retained user facts, complete-package atomicity, preregistered exact Types, fresh-first delivery, later default upsert/insert-only/no-op/guarded update/divergence conflict/whole incoming force with displaced History. Generic framing/order/integrity engineering is delegated. A successful comparison fixture is neither a complete package nor implementation qualification.

## Mismatch audit before reuse

| Older material / mismatch | Draft treatment |
| --- | --- |
| Oct17 focused proposal: JSONL only, required-pin reachable History, current narrow Memory profile | Superseded by both encodings and all-retained coverage. No selective pin closure substituted for retained inventory. |
| Mandatory new import head / imported lifecycle Event | Not carried forward: unchanged return must preserve original envelope, Events is optional; conditional actual local transitions and honest baseline are specified separately. |
| Historical attribution/changeContext/Inception wording | Use exact current revisionProvenance; no new public provenance envelope or authenticated actor claim. |
| Comparison says Link endpoints immutable across revisions | Corrected: current Write permits whole endpoint correction. Preserve each version's exact endpoints/pins; only identity/kind remain immutable. |
| Comparison examples type URI-only with older Go carriers | Illustrative Core-only examples, not Types1 all-retained fixtures. Final typed output requires exact pinned affiliations and registered closure. |
| Comparison digest and head flags | Not production canonicalization or complete History. Draft proposes named JCS virtual-record integrity and explicit identity/history facts. |
| Private grapharchive table/key/base64 carrier | Internal source reservoir only; cannot become public authority by renaming payload to resource. |
| Historical URL kind segments | Examples do not impose prefixes. New grammar preserves all canonical segments; same-Scope mode does not remap. |
| Older loose exact-decimal/numeric preservation claims | Core now has an explicit binary64 round-trip admissibility law. Refuse invalid public values or preserve them in a specified native adjunct; never round a bound Resource silently. |
| Query/List masks and generic schema2 JSONL | Representation/emission is not transfer completion. Package output is raw artifact bytes; import result is separately registered compound mutation framing. |
| All retained operational data versus inert authority | Distinguish preservation from activation; enforce nonreuse/retry continuity while keeping credentials/leases inert. Safe mapping/security remains explicit G4. |
| Empty destination versus preinstalled definitions | Fresh user-data target may have separately trusted prerequisites; no automatic Type installation or blind overwrite. |

## New proposed engineering details

The manifest/record/completion grammar, bdp-transfer/1 working labels, per-family inventory, canonical serialization order, JCS virtual-JSONL digest/domain separator, proposed successful result fields and CLI family/input-format flag spellings are **new draft proposals**, not quotations of Donna's prior rulings. They give reviewers concrete text to accept/change. No existing immutable profile/schema URI, media type, discovery member or endpoint is assigned or silently changed. Formal schemas and rejectable binding remain G6 before adoption.

The insert-only rule rejects existing lifetime allocation collisions, while same-key replay is resolved before mode checks. Retained compatible-history augmentation may be effectful without a new current revision. Force never overwrites conflicting content at one immutable retained address. These are explicit proposed refinements to reconcile the accepted modes with current Core/Write; owner review must check them, not infer them from old product tests.

## Events recommendation

Recommend its own independently optional Events profile. Core owns shared values/identity and its discovery hook; the Events profile owns source/coverage/carriers/paging/replay/retention; Write and Transfer state conditional effects. Preserve the exact current clauses during any owner-approved move. This separates observer replay from retained History and from import execution without weakening mandatory facts on an advertising Scope. Cost: another cross-profile version/publication dependency and careful preservation of links/contract identity. Donna subsequently approved the clause move: [Events](../../specs/profiles/events/events.md) now owns that contract. The source coordinates above are the original receiving snapshot, not current line citations. No new import operation is assigned.

## Handoff gaps

G1 is Donna's actual pending Scope identity discussion. G2 is complete portable family/native adjunct mapping. G3 is original admission/no-op proof/History and retired-Type eligibility. G4 is origin/erasure/custody/security and operational continuity. G5 is optional Events composition. G6 is final wire identity/schema/diagnostic/result/transport publication. These are not six routine permission gates: first reconcile owner contracts and write engineering details, then ask Donna only about genuinely changed product semantics. The draft must not claim portable complete implementation while those mappings remain unselected.

## Receiving provenance

| Original Iris input | Original SHA-256 | Integrated location |
| --- | --- | --- |
| transfer-profile.md | 778eb507d373bdae0f5341092d4c4f87c464c93e137442226fd0ee6d5025a5c2 | [Transfer](../../specs/profiles/transfer/transfer.md) |
| transfer-cli-mapping.md | 09c85abc2a954ba4611438b46bfd42328037632a1e85b6477aa77cfee3fb372e | [CLI section](../cli-design/bdp-cli.md#proposed-transfer-commands) |
| review-notes.md | 2d723735144f2a5ac9c76b713a6933e013b9e1d1051fdd3feb34fa5c479a4db0 | This provenance/review note |

Integration adjusts local navigation, document status and receiving-source notes;
original private inputs remain preserved. Scoped independent semantic and CLI/framing receiving reviews found no required
contradictions. The minor code-unit comparator and common-authorization factoring
recommendations are incorporated. Original input snapshots and findings remain
preserved; the proposed gaps are not upgraded to complete interoperability. No external review council, tests, codegen, engine, implementation
alignment, merge or capability publication is claimed. The reviewable draft comes
before implementation alignment as requested.
