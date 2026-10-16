# Type foundation: Preview 2 source audit and first contracts

Status: implementation planning, October 15, 2026. No runtime changes. This is
slice 0 of [Bead and Link Types](https://github.com/gastownhall/beads/issues/7590).
Shared semantics remain in [BDP draft PR 60](https://github.com/gastownhall/bdp/pull/60)
and [BDP 59](https://github.com/gastownhall/bdp/issues/59); this packet does not
adopt that draft as the current BDP wire contract.

## Baseline and isolation

Fresh clone: `/Users/dbox/repos/wt/trish/trish-types-foundation-audit`.
Branch: `codex/trish-types-foundation-audit`.
Remote: `https://github.com/donnabox/beads.git`.
The annotated `graph-preview2` tag object is
`d82299143954ec31964148d49509e24e84fc4abc`, peeled HEAD
`703bb13e91aa2cab2092443319139006d74242c8`. Remote and local values agree.
No existing checkout, release branch, shared database or playground was changed.

Design input was the clean BDP design checkout at
`7d531df78c65a79b39c9154a412302e4515e0f96`: `specs/types.md`, its candidate
schemas/foundation literal, the CLI proposal and implementation notes. Those
files are inputs, not copies to maintain here. Candidate seed IDs and literal
revision tokens are not adopted production allocation rules.

Janet's release policy governs implementation: each change gets a separate branch
from this tag. When she qualifies Preview 3, merge that base into shared branches,
resolve conflicts there and rerun checks. Do not write to the frozen
`release/preview2-integration`. No need for newer upstream code was identified
for the audit or the pure computation slice proposed below. That is not evidence
that full Write integration is already available.

## What exists at the tag

“Present” means source support exists; it does not claim a fresh end-to-end run.

| Area | Status and evidence | Consequence |
| --- | --- | --- |
| Domain affiliations | Present as immutable `typeURL string` in `graphops/types.go`: `BeadSpec`/`NewBead` (426/441), `LinkSpec`/`NewLink` (514/536); no Type pin | Replacing a string with an exact reference affects both values and their callers |
| General reference values | Present: `graphops.Ref` (300 onward) and `bdpwire.Reference` in `internal/httpapi/bdpwire/reference.go`; URI plus optional opaque revision | Reuse representation/equality ideas, but do not silently reuse endpoint validation: local `Ref` currently admits Bead paths only and treats pins as uninterpreted |
| Actual preview records | Present separately from graphops: `internal/storage/graphstore/types.go`, `Record`, `IssueRecord`, `LinkRecord` and tombstones all have string `Type`; Link endpoints are also strings | Changing graphops alone changes neither persisted preview records nor CLI output |
| Storage | `schema.go:24–53`: catalog has current `type_url`; generic snapshots carry complete JSON; native Issue snapshots use a separate mapping and owned blob | Add exact affiliation to both current and historical representations; the catalog cannot stand in for old affiliation |
| Exact history | `history_exact.go:64–172` checks old snapshot Type against current catalog Type; Issue history reconstructs Type from the installed Issue descriptor at 311 | Explicit retyping would make old generic snapshots fail current admission or make old Issue affiliation disappear unless historical handling changes too |
| Wire | `bdpwire/types.go:172,204`: Bead/Link Type is string; endpoint Reference supports pins. Strict decoder and schema-parity tests enforce pinned vendor schema | Type-reference objects need coordinated BDP schema adoption and codec updates, not a local DTO-only edit |
| Descriptor storage | `types_read.go:43–115`: local `types/` accessor recognizes fixed IDs; `informational_types.go:82–111` requires exact catalog count, bytes and fingerprints | Keep old install integrity checks. Dynamic Type Beads need an explicit new identity/storage boundary, not permissive catalog fallback |
| Generic creation | `records.go:29–102` creates only Memory title/body with fixed Type; read admission at 153 onward is equally specialized | “Generic Bead” naming does not mean arbitrary open-schema definition properties can already be stored |
| Owner revisions | `informational.go:329–385` retains Link and updates Memory owner snapshot/revision in one transaction; native Dependencies similarly update Issue | Reuse transactional mechanism, generalize owner selection and retained validation; do not invent another commit layer |
| Historical owned state | `ReadVersion` decodes retained owned records, not current adjacency; `validateVersionOwned` at 242 permits only fixed Memory/Issue ownership | Good foundation for immutable conformance, but not yet arbitrary definition owners or exact declaration targets |
| Queries | `graphread/selection.go:189–316` computes ID-only reflexive/transitive conformance over captured descriptors; `type` and `conformsTo` predicates differ | Conformance is not wholly absent. Need revision keys, explicit missing-definition outcomes and new matching rules |
| Indexes | Preview DDL has source endpoint index and catalog identity/backing indexes, no conformance closure or affiliation-revision index | Current query path loads a bounded inventory and computes closure; do not claim indexed conformance or scaling evidence |
| CLI Types | `graph_preview_types.go:23–113` exposes installed descriptors or friendly selectors; `graph_preview_links.go:125–169` parses fixed `types/` selectors | Keep `bd types` behavior while designing ID/alias/reference selection for definition Beads |
| Explicit retyping | `LinkUpdateRequest` is properties-only; generic CLI Link update flag allowlist at `graph_preview_links.go:238` has no type change | New explicit `--set-type` contract must be wired through storage and history, not just registered as a flag |
| Atomic writes | `backend.go:183–243` owns one graph transaction; `records.go:104` writer token fences graph writers | Reuse existing conflict and outcome-unknown handling; include owner and definition state in the same transaction |
| Batch | `cmd/bd/batch.go:21–29,263–288` uses one native transaction for a limited close/update/create/dep grammar | Atomic native batch does not yet compose generic Type Bead and ConformsTo operations or defer their constraints to final state |
| Bootstrap | `schema.go:199–256` installs fixed descriptors inside the initialization transaction; revision generation is random opaque tokens (`freshToken`, `graphops.MintRevision`) | Preallocating seed revisions is technically plausible without content-hash recursion, but authorization, production IDs and API scope remain product decisions |

The vendor provenance at `internal/httpapi/bdpwire/schema/PROVENANCE` names BDP
`de99030d13a57e77f4f2660b91ea3c39b82823cb`. The optional Types draft is not that
adopted schema. DTOs are handwritten and parity checked; see `bdpwire/GENERATOR.md`.

## Four traps to address before wiring writes

1. **Historical affiliation cannot follow the current catalog.** A record written
   with Type A@1 must still read as A@1 after explicit retyping to A@2 or B@1.
   Both generic snapshots and the native Issue projection need an answer.
2. **Owned state is already historical, but its validator is fixed.** Reusing
   current Type lookup to validate an old owner would reintroduce mutable meaning.
   Resolve ownership from that owner's exact affiliation/definition closure.
3. **A visited set is not cycle rejection.** Existing `inventoryConformance` avoids
   infinite traversal but accepts cycles in supplied descriptor input. The new
   definition admission must detect exact-revision cycles distinctly from shared
   ancestors. Same identity at distinct revisions is not itself a cycle.
4. **Pinned declaration targets are a new storage capability.** Wire/domain endpoint
   pins exist, while the preview writer stores only live local unpinned endpoints.
   ConformsTo needs retained exact targets and owner snapshot semantics. Merely
   displaying `{uri, revision}` would not establish either behavior.

## Smallest safe next coding slice

Build an isolated, pure **exact-definition closure and matching evaluator** before
connecting it to storage or public wire types. This uses settled semantics and
can proceed while bootstrap/catalog decisions are discussed. It belongs in a
separate branch from `graph-preview2`, with a small internal Type package and
existing immutable reference primitives where their admission rules fit.

Its input is an explicit finite set of captured definition snapshots, keyed by
`(canonical identity, opaque revision)`, category and exact direct ancestor keys.
These are internal algorithm inputs, not a new persistent descriptor or public
protocol. Its output is validated closure plus exact-selector and identity-selector
matching. It must:

- Require every referenced exact snapshot; never substitute the latest revision.
- Reject duplicate conflicting keys, missing ancestors, category mismatch and
  cycles over exact revision keys; allow diamonds without false cycle errors.
- Include self in conformance; match pinned selectors on identity plus revision,
  unpinned selectors on identity across captured revisions.
- Keep nominal-only equality separate from conformance matching.
- Produce stable results independent of input order, without network, database,
  wall-clock, filesystem or cache state.

This is useful code with independent tests. It deliberately does not parse the
unsettled candidate descriptor spelling, authorize definitions, resolve input
aliases, declare full Types support, or prove semantic/schema compatibility.
A future snapshot loader must prove its captured inputs actually came from the
source revision's owned state. This evaluator cannot make current adjacency safe.

Before coding, repeat contributor preflight and confirm package ownership with
Trish/Janet. No new product ruling is needed for the algorithm above. A size/budget
policy can remain the caller's responsibility; do not introduce silent truncation.

## Decisions needed for the first persistent slice

| Decision | Concrete question | What it gates |
| --- | --- | --- |
| Legacy identity and affiliation | Keep old catalog records as a distinct compatibility lane, or explicitly convert them? What exact definition does each legacy unpinned value mean, including old snapshots? | Current/history schema and serializer change |
| Wire adoption boundary | Which BDP Core reference representation and profile/version advertisement does the experiment serve? Can a local-only experiment precede public adoption? | `bdpwire`, discovery, selectors and HTTP fixtures |
| Seed establishment | Which IDs are canonical? Who may install trusted seeds? Are revisions preallocated inside one private bootstrap transaction? | Mutually pinned Type/BeadType/LinkType definitions and ConformsTo seed |
| Owner/source relation | Does stored ConformsTo source float to the identity while inclusion in the owner's immutable snapshot establishes source revision, or is a source pin required with explicit allocation rules? | Link creation/update and exact conformance snapshot loader |
| Definition availability | How are required exact ancestor revisions retained/resolved, and what happens to deletion? | Persistent loader and use admission; full removal can remain unsupported in the first experiment |
| Atomic initial authoring | What storage operation groups new definition, initial declarations and revision allocation without nested commits? | Creation convenience and bootstrap; existing native `bd batch` is not enough |

The accepted draft already settles explicit retyping, omitted-Type preservation,
exact stored affiliations, same-kind conformance, no exact-revision cycles and
availability of valid local definitions immediately upon accepted creation. Do
not reopen those because the preview happens to use fixed strings.

## Ordered implementation seams after those decisions

| Change | Files/functions to inspect or adapt first | Required proof |
| --- | --- | --- |
| Reference carrier and snapshot codecs | `graphops/types.go`; `graphstore/types.go`; `bdpwire/types.go`, `reference.go`; corresponding constructors and strict decoders | Whole reference round-trip, opaque revision preservation, omission versus explicit replacement |
| Persistence and historical admission | `graphstore/schema.go`; `records.go`; `history_exact.go`, `version_history.go`, `history_compare.go`; native Issue version mapping | Old affiliation survives explicit current retyping, reopen and comparison; fail closed on missing exact definition |
| Arbitrary definition Beads | `records.go` fixed payload path; `collection_read.go`; `types_read.go`; `informational_types.go` compatibility boundary | Open application properties work; fixed release catalog integrity still rejects corruption |
| Owned declaration writes | `informational.go`, `link_lifecycle.go`, `history_exact.go`; `backend.go` transaction boundary | Link mutation and source revision/snapshot atomic; stale source guard rejected; old source snapshot unchanged |
| Captured closure loader | New loader over retained exact owner snapshots; `graphread/inventory.go`, `selection.go` consumers | No current ancestor or adjacency leak; cache keyed by exact definitions and rebuildable from authority |
| Query/index acceleration | `bead_list.go`, `link_lifecycle.go`, `collection_read.go`, `graphread/selection.go` | Equality/conformance/pin cases agree with pure evaluator; measured workloads justify index/cache design |
| CLI adapters | `graph_preview_types.go`, `graph_preview_links.go`, generic create/update/show/version dispatch | Specialized and ordinary commands share same storage rules; no hidden implicit Type upgrade |

Each row may require more than one layer-specific PR. Do not duplicate prerequisites
across separate branches; coordinate their integration before dependent work.
Do not alter Issue/Dependency classifications or Memory semantics in the foundation.

## Acceptance packet for the first persistent milestone

- Bootstrap four foundation definitions atomically; inject failure after allocation,
  definition payload, declaration write and retained owner state. No partial graph
  becomes usable. A retry cannot silently overwrite an allocated identity.
- Create open-schema Bead/Link Types and same-kind conformance in each category.
  Cross-kind or exact cyclic declarations reject atomically.
- Create one Bead and Link using explicit Type input; floating input resolves once
  and the stored affiliation is exact. Updating unrelated properties preserves it.
- Edit a Type or ancestor. Existing instances and descendant revisions retain
  their original contracts; current definition changes do not rewrite old closure.
- Edit/delete a ConformsTo declaration. Owner advances; previous owner revision
  still exposes the previous declaration revision and exact target.
- Explicit retyping and properties succeed together or fail together. Stale guards
  alter neither record, owner state nor retained history.
- `Product@r1` and `Product` return the defined exact and identity-wide conformance
  matches. Nominal filtering remains distinguishable. Shared ancestors count once.
- Compare/read versions before and after reopen, including an explicitly retyped
  generic record and native Issue compatibility case.
- Unknown/unsupported rich constraints reject explicitly. An open-schema first
  slice must not advertise full Types-profile implementation.
- Ordinary graph traversal shows explicit ConformsTo hierarchy and does not
  synthesize affiliation edges from the `type` field.

## Ownership and overlap

The preflight search found open upstream [PR 6422](https://github.com/gastownhall/beads/pull/6422),
Janet's P0 graphops/bdpwire work. Its body and changed-file inventory were inspected;
it is a draft with conflicts, not an alternate implementation to replace. This
packet starts from Janet's prescribed release tag and preserves that code/tests.
The preflight also returned unrelated timestamp, dependency-tree and S3 PRs;
none was edited or superseded. This audit is not merge/close/replacement approval.

Coordinate with Janet before changing catalog generations, preview init, Issue
projection or CLI selection; with Vickie before public Write/reference DTO and
transaction changes. Those are overlap areas, not verified current assignments
at this tag. Trish owns design questions and public tracking. Parent coordination
must verify active ownership before edits; this worker sent no external messages.
Keep provenance fields unchanged during the separately scheduled review.

## Checks and evidence

Repository instructions read: root/cmd-bd/engdocs AGENTS, CONTRIBUTING, project
charter and testing guide. The contributor-doc location follows engdocs guidance.
No runtime implementation, no data initialization, no `make install`, no PR,
commit, push or role/launch mutation was performed.

Executed checks and outcomes are appended below after completion. Full storage,
CLI, API conformance and performance qualification remain unrun for this audit.
For implementation, use the existing focused suites first:

- Domain: `graphops` reference/descriptor/owned-record tests.
- Wire: `bdpwire` pin, strict-decode, schema-parity and projection tests; update
  vendor provenance through coordinated adoption, never hand-edit upstream bytes.
- Storage: `TestReadVersionRetainedLifecycle`, `TestReadVersionRefusals`,
  `TestReadVersionOwnedMembershipByOwnerKind`, `TestInformationalLinkLifecycle`,
  `TestInformationalOwnedConcurrentMutations`, `TestReadInstalledTypes`,
  `TestExampleTypesRefuseMissingAndCorruptInstallation` and generation guards.
- Queries: `TestCollectionPredicates`, `TestCollectionTypeSummariesAndIntegrity`,
  `TestIncidentSelection`, then revision-aware additions for both Beads and Links.
- CLI: create-Type selector, Link properties/guards, versions, record JSON and
  capability registry tests; use fresh disposable fixtures and no ambient DB.

Run focused and affected-package tests through `scripts/test.sh`. Real persistence
claims require the embedded/server cases with explicitly provisioned isolated
backends; report skips. Then repository Go-change gates (`make test`,
`make ci-pr-lint`, applicable API/docs/Bazel checks) once each change is ready.
Rerun affected checks after merging the qualified Preview 3 base. Passing at the
Preview 2 tag alone does not qualify a Preview 3 release candidate.

Executed on the unchanged Preview 2 runtime sources with Go 1.26.7:

| Check | Result |
| --- | --- |
| Remote/local tag identity and branch HEAD | Pass; exact tag and peeled commit above |
| `TEST_TIMEOUT=2m ./scripts/test.sh -json ./graphops` | Pass, package 0.272s; `/tmp/trish-types-foundation-graphops.jsonl` |
| `go test -tags=gms_pure_go -timeout=2m -json ./test/docsync` | Pass, package 0.765s; `/tmp/trish-types-foundation-docsync.jsonl` |
| `./scripts/check-doc-freshness.sh` | Pass |
| `git diff --check` and new-file whitespace check | Pass |
| PR preflight search and PR 6422 | Read-only inventory completed; reports open contributor work and draft/conflicting PR, not merge permission |

These checks validate baseline domain tests and this document's repository fit.
No storage backend, CLI workflow, full test suite, new Type runtime or performance
claim was exercised. Only this new audit document is untracked in the checkout;
HEAD remains the release tag commit. No test subprocess remains active.
