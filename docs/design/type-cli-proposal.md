# Proposal: Type authoring and inspection in bd

Review draft, October 15, 2026. This proposal can be circulated independently from
the [BDP Types draft](../../specs/types.md). BDP owns Type identity, revision,
conformance and validation semantics; this document owns proposed Beads CLI UX.
Selected product direction and proposed spellings are distinguished below.
Nothing here claims implementation or release acceptance. Plan of record remains
[gastownhall/bdp#59](https://github.com/gastownhall/bdp/issues/59).

## Purpose and common rules

Make Type Beads practical to author using both ordinary graph operations and
specialized commands. The specialized commands supply file-reading, convenient
arguments, presentation and diagnostics; they do not maintain another Type store
or bypass validation available through ordinary Bead/Link operations.

Selected direction:

- Types are Beads under the optional BDP Types profile. BeadType and LinkType
  conform to Type; ConformsTo declarations are owned Links with exact target pins.
- Successful local creation of a valid definition makes its exact revision usable;
  no separate activation/publish command is needed now.
- Canonical identity comes from the resource ID. There is no required independent
  name. Friendly aliases may provide convenient references; alias storage,
  collisions, Scope lookup and pin resolution still need a precise CLI contract.
- Optional descriptor name is a display label only. Display can otherwise derive
  from the resource's local path, including Scope/path context when ambiguous.
- Existing instance affiliations never move when a definition is revised.
- Instance retyping is an explicit ordinary update, optionally combined with
  properties changes atomically. Proposed `--set-type` requires `--if-revision`.
- No general migration engine. Atomic batch applies caller-authored changes;
  prospective checking diagnoses a supplied change rather than inventing repairs.
- Import/export is a separate, parked design exercise. No package format or
  foreign-identity installation rules are selected by this proposal.

## Proposed surface

Command spelling is review syntax. Resource/Type arguments use the common reference
system. The examples' `ID@REVISION` spelling is illustrative; parsing/escaping and
legacy `--version` compatibility still need specification.

| Command | Purpose | Contract |
| --- | --- | --- |
| `bd type list` | Catalog | Preserve `bd types` as an equivalent spelling; readable/JSON output, separate Bead and Link categories |
| `bd type show TYPE_REF` | Stored definition | Declared schema/constraints, identity, selected revision and other descriptor fields |
| `bd type create --bead ...` | Author a Bead Type | Creates a Bead affiliated with BeadType; same validation as ordinary create |
| `bd type create --link ...` | Author a Link Type | Creates a Bead affiliated with LinkType; endpoint constraints remain descriptor data |
| `bd type update TYPE_ID ...` | Edit definition | New definition revision; existing instance affiliations preserved |
| `bd type delete TYPE_ID ...` | Delete definition | Subject to unfinished reference/retention policy; no implicit cascading destruction |
| `bd type explain TYPE_REF` | Effective contract | Inherited schemas/constraints and their origins; explain local breadth versus inherited restrictions |
| `bd type validate TYPE_REF` | Definition integrity | Check schema syntax, closure, category, cycles, contradictions and supported semantics |
| `bd type check RESOURCE_ID --against TYPE_REF` | Prospective affiliation check | Check hypothetical final state, including affected neighboring Links, without mutation |
| `bd type compare OLD_REF NEW_REF` | Contract differences | Explain mechanical differences and identify where compatibility needs semantic review |

Ordinary `bd show`, `update`, `versions`, `compare`, `delete`, `link` and generic
`graph` remain routes to the same records. Do not duplicate every generic command
under `bd type` without a Type-specific benefit.

## Create and update affordances

| Argument | Meaning |
| --- | --- |
| `--bead` / `--link` | Select one definition category on create |
| `--id ID` | Explicit resource identity under the normal ID rules; requiredness/default allocation still to finalize |
| `--display-name TEXT` | Optional presentation override; proposed mapping to descriptor name, never an identity/alias registration |
| `--schema FILE` | Read and embed the file as propertiesSchema; does not persist a mutable file/URL dependency |
| `--properties JSON` | Existing Preview 2 convention for other descriptor properties |
| `--conforms-to TYPE_REF` | Repeatable create-only convenience; create the initial owned declarations with exact target pins atomically |

```sh
bd type create --bead --id approved-product \
  --schema approved-product.schema.json \
  --conforms-to Product@REVISION

bd type update approved-product \
  --schema revised-product.schema.json \
  --if-revision CURRENT_REVISION
```

Omitted fields on update remain unchanged. Supplying the same property through
both a convenience flag and `--properties` fails, matching Preview 2's duplicate
input principle. Schema replacement is explicit, not a hidden schema merge.
Keep normal supported attribution/message/source controls consistent with generic
commands as those controls land; do not invent a second provenance envelope here.

Initial definition plus ConformsTo Links form one atomic operation. Later
conformance editing uses ordinary `bd link create/update/delete`: declarations
have identity, properties and provenance that replacement-list conveniences must
not silently discard. Generic property edits cannot change owned declarations.

An open-schema default is proposed for the first exercise: omitted `--schema`
materializes an explicit open object schema, with no required application fields.
The descriptor still contains propertiesSchema. It does not mean skipping validation
of the Type-definition envelope, category, closure, ownership or conformance graph.
For Link definitions, an explicit baseline endpoint policy must also be selected;
local Beads with wildcard Types is a bounded candidate, not a selected universal default.

## Changing an instance's Type

```sh
bd update BEAD_ID --set-type TYPE_REF \
  --properties '{"approvalCode":"ABC"}' --if-revision CURRENT_REVISION

bd link update LINK_ID --set-type TYPE_REF --if-revision CURRENT_REVISION
```

Selected direction: explicit single-resource retyping through update. Omission
preserves the whole existing exact affiliation. Supplied target replaces that
reference as a whole; floating author input resolves once before commit. Require a
revision precondition for this operation. Validate the proposed complete properties
and affected graph atomically. No hidden latest-Type upgrade on ordinary edits.

Editing a Type definition's schema and retyping an instance are different changes.
`bd type update Product --schema ...` does not move Product instances or change
Product's own metatype affiliation.

## Checking and diagnostics

`validate` examines a definition. `check` examines proposed use of a definition on
particular Beads/Links, whether or not they already carry that affiliation. Passing
check is not a new declaration that their old Type conforms to the proposed Type.

Checking a graph requires a caller-authored mapping of records to target Types and
any property changes. Its input format remains open and must align with atomic
operation planning. Checks include affected surrounding Links, even outside the
selected input set. Execution must revalidate against current state/preconditions.

Report machine-checkable properties/relationship results separately from author
semantic obligations. A tool cannot discover every dollars/cents change or certify
semantic compatibility from JSON structure. It must not report unimplemented
constraint checks as passed. Exact diagnostic JSON/exit codes remain to specify.

`explain` should identify why a rule applies, for example: a local maximum of two
is narrowed by an inherited maximum of one, naming the exact defining revision.
For per-Link acyclicity, prospective cycle checks traverse all family revisions.
A future whole-family preflight can help operators see old cycles before adoption;
it must not redefine or waive the per-Link protocol invariant. No new flags selected.

## First implementation exercise: open definitions and their graph

Recommendation, not a claim that implementation has started: use an isolated
experimental branch and fresh workspace to implement the smallest end-to-end Type
representation. Do not change release playgrounds or active Write work incidentally.

1. Establish trusted Type/BeadType/LinkType/ConformsTo seeds with exact pins through
   an explicit atomic bootstrap mechanism.
2. Create local Bead/Link definitions with open instance properties and no optional
   application-specific graph constraints. Creation makes them available for use.
3. Create/read/edit owned ConformsTo Links, enforcing exact available targets,
   category agreement and exact-revision cycle checks. Preserve historical owner
   snapshots; traverse those snapshots rather than mutable current adjacency.
4. Exercise generic show/versions/graph plus a small specialized create/list/validate
   path. Demonstrate ownership revision effects and optimistic concurrency.
5. Include a tiny Bead and Link using authored Types to prove exact affiliations
   and conformance matching. Otherwise label the result a definition-graph prototype,
   not completion of the usable-Type slice. This is a recommendation for coverage,
   not a requirement for full Issue/Dependency conversion in the first increment.

The foundation definitions still need structural integrity schemas; “open schema”
refers to application-instance properties. Unsupported rich schemas/constraints
must fail explicitly in the experiment rather than silently being ignored.
No full Types-profile qualification is claimed by a partial experimental surface.

### Concrete seams in current Preview 2

Source inspected at
[`703bb13e91aa2cab2092443319139006d74242c8`](https://github.com/donnabox/beads/tree/703bb13e91aa2cab2092443319139006d74242c8).
BDP main checked at `67a2842e3f1918e70978f745587cf11eaf0df5a8`; this design does not
modify its current wire contract or assert draft-profile adoption.

| Current code | Consequence for the exercise |
| --- | --- |
| [Type reader](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/types_read.go) reads installed descriptors through known types/ paths | Custom Type Beads need generic identity/discovery and revision reads, not just a command wrapper |
| [Catalog checks](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/informational_types.go) require a fixed count and exact descriptor fingerprints | Dynamic definitions require a deliberately new storage/installation boundary; do not relax release integrity checks blindly |
| [Graph values](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/graphops/types.go) carry typeURL strings; TypeDescriptor carries conformsTo ID arrays and a schema URL | Exact affiliation pins and owned declaration records affect model, serialization, storage/history and validation |
| [Type CLI](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/cmd/bd/graph_preview_types.go) separates human selectors from descriptor output | Preserve recognizable listing behavior while removing assumptions that labels imply installed Type identities |

Before execution, settle three bounded contracts: seed identities/revision allocation;
compatibility boundary for old types/ descriptors versus new definition-Bead IDs;
and exact historical declaration traversal/closure indexing. A disposable workspace
can defer an in-place storage migration but cannot erase the distinction in its design.
The current graph model mints opaque revisions; transaction-local preallocation is
worth evaluating for bootstrap, not yet an adopted protocol mechanism.

### Acceptance cases for the exercise

| Case | Expected result |
| --- | --- |
| Create a Bead Type with omitted schema convenience input | Store the explicit chosen open object schema; valid definition usable immediately |
| Create a Link Type and its initial conformance declaration | Atomic definition/owned Link state; proper category and exact target pin |
| Cross-kind conformance or exact-revision cycle | Refuse atomically |
| Revise a declaration | Source Type gets a new revision; old definition snapshot retains old declaration |
| Change an ancestor's current definition | Existing child revision retains its exact ancestor contract |
| Use the Type on a tiny instance, then revise the definition | Instance keeps its original Type pin |
| Explicitly retype with stale revision precondition | Refuse without partial effects |
| Match Product@r1 versus Product | Exact affiliation/conformance versus any revision by identity/conformance, never latest lookup |
| Inspect definition graph | Generic graph operations show explicit hierarchy without synthesized affiliation edges |
| Supply unsupported rich constraints in the limited experiment | Report unsupported behavior; do not claim successful validation |

## Remaining work and readiness

| Area | Review-draft status | Work still needed |
| --- | --- | --- |
| Command responsibilities and ordinary-operation equivalence | Selected direction captured | One consistency/editorial pass and command examples |
| Definition authoring and identity | Selected direction; flag spellings proposed | Alias resolution, file/stdin conventions, category/default requiredness |
| Single-resource retyping | Selected | Precise target resolution/precondition errors and adapter contract |
| Prospective check and validate distinction | Selected | Proposed-change input, machine output/exit codes and semantic-review reporting |
| Type deletion | Intentionally incomplete | Current references, dependent definitions, history retention and allowed operations |
| Minimal implementation exercise | Bounded proposal with code seams and cases | Resolve three foundation contracts, qualify isolated slice; no runtime implemented here |
| Import/export and general migration | Parked/deferred | Separate proposals when resumed |

A reasonable discussion draft exists with explicit open questions. A complete CLI
contract still needs input/output/errors and deletion policy. The small implementation
exercise can proceed once its three foundation contracts are decided; it need not
wait for every richer schema, lifecycle or operational-observation decision.
