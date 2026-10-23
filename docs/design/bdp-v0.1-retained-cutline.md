# Finite retained CLI/Core/Write source cutline

**Subsequent bounded Event increment:** Donna has [answered D1/D2](../cli-design/event-decisions-20261022.md).
The paired [Event CLI](../cli-design/events.md) / [Core source](../../specs/profiles/core/events.md)
now defines the mandatory postimage baseline and declared-coverage replay. The
counts/map below remain the exact PR296 source snapshot, not rerun evidence for
this later increment. Trish's batch publication/owner and Types gates remain open;
the Event increment does not infer per-operation versus final batch semantics.

Candidate under existing #280/#279/#152/#153 and sole #59, based on reviewed
PR294 `fd8d7c9e844d357081df4093e440ccdf57dde7d1`. This reuses the existing C1
paper and [79-section disposition](bdp-v0.1-core-write-disposition.md); it does not
rebuild that inventory or open a feature area. The paired source is concrete:

- [Canonical CLI entry](../cli-design/bdp-cli.md), using the already reviewed module signatures.
- [CLI profile/discovery correspondence](../cli-design/retained-profiles.md).
- [Positive Core entry](../../specs/profiles/core/retained-core.md) and
  [positive Write entry](../../specs/profiles/write/retained-write.md).
- Six retained discovery/directory/limit helpers in the existing v0.1 bundle;
  [finite examples/map](../../fixtures/retained-profile/candidate.json).

The separate Molly index merge08163c7 is documentation-only. This author branch
needs no rebase for that pointer change and does not edit her specs/README file.
Old main/runtime/product/implementation pins and source reports remain actual.
No source or grammar presence advertises support. This is not complete adoption.

## What the small contract actually costs

| Surface | Required work | What does not come along |
| --- | --- | --- |
| Core | Shared Resource/Reference/value/revision semantics, authorized reads/selection/pages, HTTP/errors and required Event observation | No write service, Type-definition interpretation/inventory, public epoch/position/view or replica bootstrap |
| Write | Core plus six CRUD and two alias targets; one atomic decision, guards/complete results, durable key/replay state and committed Event facts | No sequence, set-write selection, public pending/paged receipts, replica log or checkpoint reads |
| Optional atomic batch version1 | Existing selected six-CRUD group, capture, atomicity and complete bounded results/recovery | No independent commit loop, aliases in batch, replication or generalized parameters |
| Optional History / exact definition read | Their selected complete and separately scoped read obligations | No automatic application History from Types lookup, infinite retention, acquisition or public Type lifecycle |

The cost reduction is in obligations, not just renamed sections. A basic writer
still pays for permanent successful-key evidence, guarded atomic owner effects,
authorization and required Event production. Dropping these would change the safety
contract. No public replica epoch is needed to explain an ordinary revision token.
Existing Experimental files are only parked non-normative explorations, with no
new protocol or implementation commitment and no dependency from the required entries.

## Finished source versus actual remainder

"Source complete" below means the independent bounded paper has its concrete
CLI/protocol/schema correspondence. It is not provider/CLI qualification, whole
profile adoption or an assertion that every prerequisite feature is implemented.

| Unit | Source disposition | Remaining boundary |
| --- | --- | --- |
| Contract/media/profile discovery | Complete here | core/write literals are explicit author choices; all Core clients decode either known arm; future features use capability versions |
| Scope/names/References | Reviewed PR286453a37 plus canonical exact-value forms | No new portable identity/equality/relocation promise |
| Point/list/properties/aggregate/incident reads | Reviewed PR293e085; no further selected read-mode work | Native kinds/context, endpoint/AND predicates and exact delivered boundaries retained |
| Output/masks | Cleo contract plus reviewed R1-paired examples and one existing C1 preview marker | Original-value paths, ordinary properties roots, protected Resource/Reference context; no renderer claim |
| Optional History reads/versions | Existing complete native contract plus finite CLI page/row/context mapping | No ordinary cursor resizing, total-cap tail loss, new History coverage or mandatory History |
| Resource CRUD/edits/affiliation | Reviewed PR289/290/292 plus canonical signatures | Mutable Type carrier and complete state equality preserved; conditional Types admission remains Types-owned |
| Aliases | Existing singleton model, PR286 namespace and canonical signatures | Separate no-revision result/disclosure, no batch or new alias kind |
| Safe outcomes/retry | Standalone Write extraction and canonical private recovery/emission | Durable decisions/claims/tombstones/witnesses; no public request/receipt surface |
| Atomic batch | Reviewed PR292ad6ddd4 | Selected six-CRUD vocabulary/version/results/capture; induced-owner allocation below remains gated |
| Exact Type lookup | Reviewed PR294fd8d7c9 / Types8fc7ce9 | Explicit interpreting context/wrapper; public Type command deliberately deferred |
| Event D1/D2 | Existing human design gates | Mandatory payload baseline and read-only/external observation/coverage/replay; no duplicate questions or inferred answers |
| Event source composition | Gated on those answers | Then actual transport/selection/compatibility, Type-only/owner encoding and facts; replica changes is not a substitute |
| Multi-operation induced owners | Trish's composition gate | Exact captured owner revisions/results must have one truthful meaning; no token example selects allocation counts |
| Types/profile/intrinsics | Trish's source gate | Actual optional Types advertisement/definition correspondence, old URI-only state and truthful intrinsic original publication context |
| Public Type CLI/inventory | Explicitly deferred by the user | Only type list placeholder; no new verb, payload, registration/lifecycle or fake complete public Type isomorphism |
| Experimental/serve/runtime/product | Parked/held | Existing synchronization/receipts/set-write notes only; no implementation resumption or review timer |
| Normal semantic qualification | Required after source composition | Actual conformance applicability/implementation/integration evidence, not a parent runner or publication-permission queue |

The machine companion records ten source-complete units, two Event design-gated
units, two Types/owner-gated units, two explicitly deferred units and one qualification
gate. This is a finite source map under #59, not another tracker. There is no further
independent Core/Write feature area to open at this cut. Do not poll unchanged state
or run an unchanged validation campaign while those actual design/owner gates remain.

## Explicit authored deltas

The new native front door is retainedDiscovery: coreDiscovery or writeDiscovery.
Core requires Bead/Link inventories and events navigation without an old Type catalog.
Write adds aliases and a closed eight-URL absolute singleton directory. Known atomic
batch version1 requires the Write arm; unknown capability versions remain opaque
for base use. Six new helpers are added; every prior native definition/root stays
unchanged. Earlier read/read-update/transactional helpers and their examples remain
explicit staging inputs, not the current discovery entry or a later-PASS shortcut.
No active catalog metadata, runtime parser or shipping profile is rewritten.

Two closed limit helpers retain read bounds and singleton patch/diagnostic/key bounds,
without sequence/transaction/receipt/replay groups. Lifetime key identity is the
canonical Scope/principal pair, with no extra profile/transport-host/replica partition.
Configuration/support changes cannot erase promised recovery or successful-key state.
No migration of canonical Scope identity is invented.

The canonical CLI finishes shared exact field-value escapes, ordinary eight-target
signatures, explicit delete apply/preview, standalone retry/error/output/emission and
one-page optional History versions. Its row/subject/window context is explicit;
unknown/nondisclosable metadata kind stays null without inventing a Resource kind,
extra body fetch or permanent allocation marker; actual Resource reads stay typed;
no new native History payload, cursor rule or Type command is created. The separate
ordinary-read framing schema gains only optional context.preview=delete from C1;
History/mutation/unbound descriptors remain outside that partial six-kind schema.
Known output failure retains original operation data/context rather than implying
rollback; unbound local diagnostics use no false selected BDP identity. These are
ordinary author choices for source review, not recovered Donna rulings or changes
to Preview's numeric exits.

## Qualification at this cut

Fresh **495/495 focused tests across fourteen files**, zero failures/skips, include
fourteen new retained-profile artifact tests plus the prior 481. Strict Ajv/full
formats compiles all 184 native definitions. Checks cover Core/Write union recognition,
required Event navigation, known capability dependency/unknown versions, closed small
discovery/limit/directory shapes, eight native singleton request pairs, distinct results,
preview metadata, native History row/context pairing and truthful local error data.
These are source/grammar/static correspondences, not command/HTTP/provider execution.

All 569 current catalog quotations resolve without edits. Original schema/old reports
and original repaired PR293/294 reports retain their exact input identities. The
initial fourteen-test run is separate from this current combined run; neither is
relabeled as an implementation PASS. Native canonical/distribution bytes match;
all 178 prior definitions/root and the held v0 slot remain unchanged. The CLI framing
change is exactly one optional preview discriminator. No Type files change.

Eight command/request pairs, twelve semantic scenarios and the finite done/gated map
are paper source. No journal/crash/authorization/closure, Event payload, cursor fetch,
field-mask renderer, public Type CLI, server or installed/full-suite/hosted evidence
is claimed. Trish owns normal source integration and actual Types/owner work; Molly
owns the useful batched source index. Once those genuine gates are the only remainder,
stop cleanly at this exact source cutline rather than open another campaign.

Final source audit resolves 31 JSON fences and 293 local file/anchor targets;
five touched TS/JSON files pass Biome/whitespace. Native candidate SHA256 is
`2cce40a3588f5c17d134ca3a27396f037e4a38753e8969bb2e01ece303be19df`;
held v0 is `15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327`.
The ordinary CLI framing hash is
`26761fe239fb692c0887062c2466b5a2898121f1723125a570c6eddb4603880c`.
The initial fourteen-test run and pre-unknown-kind combined run remain distinct;
the final 495 run includes that native empty-history/nullable-context control.
Only prose/evidence presentation follows that run. Own temporary dependencies are
removed before publication, leaving borrowed Vickie dependencies unchanged.
