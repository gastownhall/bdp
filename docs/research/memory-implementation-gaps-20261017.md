# Specific implementation gaps for the Memory design

Read-only source audit, October 17, 2026. This is a prioritization note, not an
adopted contract, new runtime test pass, release cutline or assignment to implement.
The audit itself did not edit the Memory draft. A subsequent authorized review pass updates that editable draft while preserving Donna's comments.

## Subsequent product direction from Donna

G1–G3 are required in Preview 3. G4 complete provenance expansion and G5 Task
structured Link projection may follow Preview 3; truthful attribution required by
G1–G3 remains. Janet correlates these as M-D1–M-D5 in #7656 and uses M-D6 for
specialized payload/catalog activation, whose exact allocation she records. The
priority recommendations below predate this direction and are not a competing cutline.

`bd query` is in active redesign; `bd memory` is a permitted proposal for tailored
operations. Iris's batch assessment finds that the current update format cannot
change Type in the frozen Core wire format; a batch wrapper cannot supply that
missing member. Donna and Trish confirm mutable affiliation is already accepted in
Types §2 and product #7590. Use an ordinary guarded native update, preserving
untouched fields for targeted edits and validating the whole result; batch composes
that operation. Wire adoption/runtime integration remain distinct pending work.
Shared Inception DESIGN is delegated to Polly with Iris's import requirements;
it is not a Memory property or a new Preview 3 provenance implementation gate.

## Evidence boundary

- Final Preview 2: `703bb13e91aa2cab2092443319139006d74242c8`.
- Qualified source catch-up: [Beads PR113](https://github.com/donnabox/beads/pull/113),
  source `b9eebc31f8e0f21b9a6154652476ed87027e9cad`, actual hosted merge
  `9b39cae84d3d6f0e32fda033add5078e8751486b`. Janet records source-base qualification,
  not Memory V2 workflow completion. PR110 is a documentation tracker, not a code base.
- Eighteen relevant storage/CLI blobs independently compared between Preview 2 and
  PR113 are identical. A second audit compared twenty graphstore source/test blobs,
  also identical. Manifests and fetched primary material are retained in the author's audit packet.
- [Janet's implementation ledger #7656](https://github.com/gastownhall/beads/issues/7656)
  records owners and workflow/release gates. Its partial rows must not be interpreted
  as saying every mechanism in those rows is absent.
- Trish owns the single fixed-Memory implementation plan and F0 groundwork. Pure
  validator/fixture work has no storage or CLI activation. This note starts no second lane.

## Foundations already present

The preview already implements ordinary Memory graph identity and title/body records,
metadata changes, guarded writes, guard-before-no-op behavior, deliberate unguarded
predecessor disclosure, retained exact reads, per-resource version lists/comparison,
historical Memory outgoing sets, stable Link-ID property/metadata updates and removal,
source-only Memory revisions for owned Link mutations, and actor/time attribution for
those revisions. Incoming Link reads are bounded and refuse rather than silently
truncate. These are reusable mechanisms, not new tasks to implement from scratch.

Sources: [record and attribution types](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/types.go#L58),
[Memory update](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/memory_update.go),
[exact reads](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/history_exact.go),
[Link mutation](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/link_lifecycle.go),
and [Link metadata/owned source handling](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/link_properties_patch.go).

## Shared implementation work to prioritize

These priorities are recommendations for Janet, not a newly approved preview cutline.

| ID | Specific present limitation | Required result / acceptance example | Existing owner boundary |
| --- | --- | --- | --- |
| G1 | Link source/target are bare strings for unpinned live local Beads. Link updates explicitly exclude endpoint changes. | Persist latest versus exact endpoint References, validate retained local state, and support selected same-target-identity re-pinning while keeping Link ID. After target edit, latest follows and an old pin resolves the original state. Supports/Challenges/Supersedes can then enforce exact targets. | Trish with Polly/Jim retained-state resolution. |
| G2 | Memory deletion refuses every live incident Link. It retains old versions but creates no terminal Memory revision. | Remove floating incident informational Links atomically; preserve valid pinned citations and retained owned snapshots; report removed Links and affected source revisions. Record the selected terminal deletion evidence without adding revisions to mere incoming targets. | Trish Links + Polly/Jim History. |
| G3 | No shared graph-Memory same-ID restoration operation is present. The native legacy restore command has a different meaning. | Restore deleted Memory from retained state under the same ID, with a current guard and a new attributed revision. Validate current admission and do not resurrect Links cleaned up during deletion or take another live resource's key. | Polly/Jim, coordinating Trish lifecycle. |
| G4 | Existing attribution contains actor/status/recordedAt; it does not carry the proposed sources/completeness/shared revisionProvenance or a dedicated editable Inception contract. Native writes can currently retain unknown actor attribution; the draft requires a truthful actor on each new native revision. Current stale-write error identifies the revision but not its actor/time. | Preserve existing truthful writer attribution; add the accepted source/unknown/empty distinctions and origin state across create/update/exact read/indirect writes. Structured conflict reports include accepted current attribution where required. No signing/authentication claim is needed. | Polly/Jim with Melinda's record contract. |
| G5 | Issue show omits an informational Issue-to-Memory Link visible in the separate Link collection. This has narrow installed evidence in both modes. | Expose Link ID, Type, endpoint Reference and truthful target information through the selected Task structured view, without loading target bodies or affecting readiness. Do not accidentally change ownership while fixing projection. | Trish; Janet CLI acceptance. |

G1 source: [types.go125–132,183–195](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/types.go#L125).
G2/G3 source: [memory_delete.go13–26,64–85](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/memory_delete.go#L13),
retained-state and lifecycle inventory in the [reviewed fixed-Memory plan](https://github.com/gastownhall/bdp/blob/99ab2594202c7de436dc1b215770dcf0820e5790/docs/design/preview3-fixed-memory-types-plan.md).
G4 source: [types.go66–83](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/types.go#L66)
and [guard error](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/informational.go#L34).
G5 evidence: [Janet's exact-source planning snapshot and installed observations](https://github.com/donnabox/beads/blob/dc07a7fa22784bf966333dd658727bca8923f8f8/engdocs/drafts/preview3-integration-status.md).

## Runtime extensions introduced by this design

These are implementation consequences of the Memory design, separate from proving
that existing generic graph/history mechanisms work. Trish already stages them in
F1–F4; do not open a duplicate implementation stream.

1. **Full specialized payload and historical affiliation.** Current Properties only
   contains title/body and CLI rejects additional fields. Preserve steps, choice,
   statement, etc. and permitted unknown fields through create/patch/replacement,
   reopen, exact history and compare. Retained decoding currently admits one fixed
   Memory affiliation and checks it against the allocation's Type. It must preserve
   the original contract across explicit Memory-family retyping and later catalog upgrades.
2. **Family discovery and direct-field search.** Current discovery matches one Memory
   Type by equality and searches only title/body. Include all supplied specializations,
   search accepted knowledge properties and produce bounded property-path excerpts.
   Existing compact output and honest refusal bounds are useful and should be retained.
3. **Atomic Memory-family retyping.** Add the selected type-plus-properties operation,
   validating required fields and affected floating Links together. Preserve omitted
   affiliation and old historical affiliation; refuse Issue/Memory conversion.
4. **Catalog and Link admission activation.** F0 pure predicates are only groundwork.
   Wire accepted names, pair/pin/self rules and schemas through all supported writers,
   inventory and historical readers. Current informational properties admit only note;
   even that differs from the draft's nonblank-note/open-root rule. Preserve existing
   Dependency related/relates-to/supersedes dispatch. Do not expose unsupported catalog rows.

Sources: [complete preview payload](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/types.go#L58),
[CLI property refusal](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/cmd/bd/graph_preview_issue.go#L432),
[retained decoding](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/history_exact.go#L110),
[discovery](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/cmd/bd/graph_preview_memories_projection.go#L58),
and [current Link properties](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/internal/storage/graphstore/informational.go#L18).

## Decisions or conditional work, not unconditional blockers

- **R2 keys:** canonical resource identity already exists. Human-key namespace,
  assign/repoint/release, historical meaning and version effects need a selected
  shared naming contract and implementation; R2 is not complete merely from IDs.
- **CLI completion:** existing remember positional/stdin/file capture and title
  derivation are implemented. Do not list all R4 as absent. Graph memories --json
  is explicitly refused; graph prime/guidance and supported cross-surface semantics
  still need the selected contract and tests. Decide human/JSON/error policies once.
- **Selective acquisition:** discovery emits bounded summaries but obtains a complete
  current snapshot first. Decide whether the accepted R8/R21 boundary forbids that
  storage acquisition or only automatic delivery to the consumer; then implement/test
  the selected behavior. Output shape alone cannot prove the stronger boundary.
- **S16/feed and removal:** existing exact reads are not an ordered project feed or
  real retention/erasure producer. Select V2 inclusion before prioritizing those
  producers. Unknown version must not be labeled erased/pruned without evidence.
- **S11 conversion / S13 interchange:** both need explicit V2 decisions. Preview 3
  migration is excluded. Iris owns interchange; no implied resume or new assignment.
- **Activity:** a separate V2 work-provenance contract/owner remains open. It is not
  required to build the Memory family validators or a substitute for revision provenance.
- **Not fixed-Memory prerequisites:** general installable Types, custom minimum/cycle
  engine, federation, BDP adoption/deployment, signatures or Rust.

The [exact acceptance matrix](https://github.com/donnabox/beads/blob/dc07a7fa22784bf966333dd658727bca8923f8f8/engdocs/drafts/v2-memory-acceptance-matrix.md)
records these cutline choices. [Current CLI refusal](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/cmd/bd/graph_preview_memories.go#L17)
and [snapshot acquisition](https://github.com/donnabox/beads/blob/b9eebc31f8e0f21b9a6154652476ed87027e9cad/cmd/bd/graph_preview_memories.go#L40)
are direct source evidence.

## Recommended ordering and qualification

Decide the fixed record and Reference contracts now. Run the payload/history-affiliation
and Reference/provenance groundwork in their existing owner lanes; lifecycle depends
on those foundations. Follow with restore, projections and complete CLI workflows.
Keep keys/cutline choices explicit so they do not become hidden implementation defaults.

Janet's release work is integration plus exact-candidate embedded/shared-server
scenario tests, hosted actual-merge gates, normal/default activation and the selected
CI protections. Those are evidence/release gaps, separate from missing algorithms.
The current source qualification is valuable and must not be reported as absent;
it does not automatically qualify a later Memory feature commit. This audit executed
no new runtime suites and made no release/main/pin changes.
