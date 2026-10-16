# Proposal: Bead and Link Types

Draft for discussion, October 15, 2026. Intended for an issue in
`gastownhall/beads`; not yet posted. This proposal covers the model, the Beads CLI
and a small first implementation. The detailed shared rules live in the
[BDP Types draft](https://github.com/gastownhall/bdp/blob/codex/trish-bdp-design-authority/specs/types.md).
Command spellings remain proposals; the readiness table distinguishes design from
implementation. The supporting design record is
[BDP #59](https://github.com/gastownhall/bdp/issues/59).

## Proposal

Let users define Bead Types and Link Types, give those definitions stable identities
and immutable revisions, and declare when one Type conforms to another. Represent
the definitions as Beads and the conformance declarations as owned Links. Keep an
instance's Type affiliation in its existing distinguished `type` field, pinned to
the exact definition revision it uses.

Add convenient `bd type` commands on top of ordinary Bead/Link operations. Begin
with open application-property schemas and a working conformance graph. This gives
us a useful way to classify information and exercise the representation before
implementing the full schema and graph-constraint system.

## How Types have worked so far

Beads began with a concrete domain: work items and their dependencies. An Issue
has a classification such as `task`, `bug` or `epic`; a Dependency has a relationship
classification such as `blocks` or `parent-child`. The application knows what those
classifications mean. Some names select behavior, and configurable names extend
categorization. Validation and workflow rules largely live in the application.

Graph Preview 2 introduces explicit Bead/Link Type descriptors and an installed
catalog. It also makes existing classifications usable through familiar CLI Type
selectors. `bd types` helps users discover available choices; detailed/JSON output
exposes installed definitions. This is useful groundwork, but the inspected code
still treats the catalog as a fixed installation rather than arbitrary user-authored,
versioned definition Beads. Existing Issue and Dependency classifications are being
brought forward as intrinsic Types; the exact implementation stage is recorded in
the source notes below.

The proposed domain hierarchy preserves established vocabulary and behavior:
`task`, `bug` and the other work-item Types conform to `issue`; `blocks`,
`parent-child` and the other relationship Types conform to `dependency`. This does
not invent new scheduling semantics or turn every Dependency into a blocking Link.
Existing storage classifications can be translated at the graph boundary as the
implementation evolves. That translation is a compatibility task, not a reason to
retain `issue_type` or `dep_type` as duplicate authorities in the proposed properties.

The next step is to let people author their own definitions, evolve them without
silently changing old records, and reuse contracts across applications. Adding a
new label alone does not answer what properties it supports, what its relationships
mean, or whether an existing record can safely adopt it.

## What we need from Types

| Need | User question | Proposed capability |
| --- | --- | --- |
| Categorization | “What kind of thing is this, and how do I find related kinds?” | A stable Type identity; explicit conformance lets a query for a general Type include more specific Types |
| Schematization | “What properties can this thing have, and what do they mean?” | A JSON Schema for properties, semantic documentation, and applicable relationship constraints |
| Conformance testing and enforcement | “Does this record satisfy that contract, and will writes preserve it?” | Prospective checks against a proposed Type; write-time enforcement of supported structural and graph requirements; explicit author responsibility for meaning that cannot be mechanically proved |

These capabilities can be introduced incrementally. A Type with open properties
and no required application fields is still useful for categorization and declared
conformance. Later revisions can add structure; existing instances retain their
original exact affiliation until explicitly changed.

Three questions must remain distinct:

1. **Affiliation:** what Type revision is recorded on this Bead or Link?
2. **Declared conformance:** what other exact contracts does that Type promise to
   satisfy, directly or transitively?
3. **Prospective acceptance:** would this particular record or proposed graph state
   pass the enforceable requirements of another Type?

Passing a prospective check does not add a conformance declaration to the record's
current Type. Two unrelated Types can happen to accept the same JSON without
meaning the same thing.

For example, ApprovedProduct can conform to Product while adding a required
approval code. A reader relying on Product's guarantees can understand the shared
fields. An update still has to preserve ApprovedProduct's additional requirements;
a full replacement that omits its required approval code fails. Conformance is
not permission to ignore the actual Type when writing.

For Link Types, the contract can also say which source/target combinations are
allowed, how many Links may meet at an identity, whether a pair must be unique,
and whether a Link may participate in a cycle. These checks concern the Scope's
own graph. They do not imply validating arbitrary external resources. Supported
graph invariants are checked against the final state of an atomic change, including
affected surrounding records; open properties alone do not waive those rules.

Schemas also cannot establish every semantic promise. A numeric `price` interpreted
as dollars is different from one interpreted as cents, even if their JSON shapes
are identical. Definitions must document meaning; validators enforce the vocabulary
and constraints they understand, while diagnostics distinguish those checks from
semantic claims requiring human or application review.

## Why model definitions as Beads?

A Type definition needs many of the things ordinary Beads already need. Reusing
that model gives us one coherent way to address, revise, inspect and relate them.

| Existing graph mechanism | What it gives Type definitions |
| --- | --- |
| Stable Bead identity and exact revision references | A Type can evolve while old instances keep the precise contract they were written against |
| Common Bead/Link representations and BDP operations | Definitions use the same resource envelope, addressing, revision and ownership rules as other graph data |
| Ordinary CLI create/show/update/delete/versions/compare | Definitions remain accessible through familiar operations; specialized commands add conveniences rather than another persistence model |
| Atomic writes and owned Links | Editing a conformance declaration revises the owning definition coherently and preserves its historical declaration set |
| Explicit Links and graph traversal | The conformance hierarchy is a real graph that generic graph tools can display and inspect |
| Common metadata and revision attribution/provenance mechanisms | Changes to definitions and declarations can use the same contextual information as other changes, as those mechanisms become available |

We could keep a separate descriptor store and implement these capabilities again.
Choosing Beads makes the shared mechanisms the architectural contract. It does not
mean all the required implementation already exists, or that graph traversal alone
is a sufficiently fast conformance-query implementation; indexes may still be needed.

There are costs. The first metatypes need a trusted bootstrap; historical Type
meaning requires retained definitions and declaration revisions; and generic
editing must enforce Type integrity just as carefully as specialized commands.
We should test those costs with a small working graph before adding richer features.

## The model in a little more detail

**A definition is a Bead. Its descriptor is its properties object.** That object
contains the instance-properties schema and other contract information. Its common
envelope supplies identity, revision, Type affiliation, metadata and recorded owned
Links. The properties schema of the foundational Type is therefore the schema for
the common descriptor itself; no second descriptor-schema concept is required.

There are three foundational Bead Types:

- **Type:** the common contract for definitions.
- **BeadType:** conforms to Type and describes Bead Types.
- **LinkType:** conforms to Type and describes Link Types. An instance of LinkType
  is still a Bead; it defines a Type whose instances are Links.

A fourth foundation, **ConformsTo**, is a Link Type. Its owned declarations connect
BeadType definitions to BeadType definitions, or LinkType definitions to LinkType
definitions. Cross-kind conformance is invalid. Each target pins an exact definition
revision. Conformance is transitive, has no exact-revision cycles, and can only add
requirements or narrow permissions; it cannot withdraw inherited promises.

Illustratively:

```text
Definition Bead       Own Type       Owned conformance declaration
issue                 BeadType       —
task                  BeadType       task → issue@REVISION
dependency            LinkType       —
blocks                LinkType       blocks → dependency@REVISION
```

Both definitions and declarations have ordinary resource identities and revisions.
The complete meaning of a definition revision includes its recorded owned Links.
Reading an old Type must follow that snapshot, not today's live adjacency. Changing
a declaration produces a new owner revision; old definitions remain interpretable.

An ordinary instance still has one distinguished `type` reference. That reference
is not an implicit graph Link: displaying an Issue's work graph does not automatically
wander into the Type hierarchy. Users can inspect the hierarchy explicitly.

Stored affiliations and ConformsTo targets pin exact revisions. Explicit unpinned
input for those roles resolves once before commit. Constraint selectors can be
pinned or deliberately identity-wide: `Product@r1` requires that exact contract
through affiliation or conformance; `Product` accepts any revision of that identity
or conformance to one. Identity-wide matching does not repeatedly resolve “latest.”

A Type's ID supplies identity. Friendly aliases can make references easier to type;
an optional display label can improve presentation. Neither changes equality or
conformance. Optional SemVer remains proposed informational author metadata, not a
replacement for the resource revision or a mechanical compatibility guarantee.

## Shared BDP semantics and Beads behavior

The BDP Types profile defines the shared meaning of definitions, conformance,
matching and constraints. It is optional and Scope-wide. Core defines the common
resource/reference/revision contract without requiring every Type reference to
point to a Bead or every server to implement this particular Type system. Servers
advertising this Types profile use Type-definition Beads and its shared rules.

Beads supplies command syntax, short-reference/alias resolution, presentation,
file inputs, storage, indexes and operator workflows. The same validation applies
whether the caller uses a specialized command, an ordinary graph command, or a
supported protocol operation. BDP and Beads must be brought into alignment through
coordinated changes; this proposal does not describe the draft as today's wire format.

## Operational rules


Make Type Beads practical to author using both ordinary graph operations and
specialized commands. The specialized commands supply file-reading, convenient
arguments, presentation and diagnostics; they do not maintain another Type store
or bypass validation available through ordinary Bead/Link operations.

The proposed operating rules are:

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

## Suggested first implementation: open definitions and their graph

Use an isolated experimental branch and fresh workspace to implement the smallest
end-to-end Type representation. This is proposed work, not a claim that implementation
has started or that an existing workspace can already be upgraded in place.

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

### Implementation notes from Preview 2

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

## Feedback requested

- Does the distinction between categorization, schemas and conformance cover the
  Types people need to author and use?
- Do Type Beads and owned ConformsTo Links give us a useful common model without
  unnecessary authoring burden?
- Does the CLI make definition integrity, prospective adoption and actual changes
  easy to distinguish?
- Is the suggested open-schema/conformance-graph implementation the right first
  increment for testing the model against real Beads code?

Definition removal/retention, bootstrap details and remaining CLI input/output
contracts are explicit open work. Import/export, automatic migration and deeper
provenance questions are separate discussions.
