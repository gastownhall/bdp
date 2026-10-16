# Types completion: consistency review and next decisions

October 14, 2026. Review against the current [Types draft](../../specs/types.md),
[Issue/Dependency draft](../../specs/types/issue.md), and the user-edited
[Memory draft](../../specs/types/memory.md). This is a decision list, not another
normative specification. Unresolved product choices remain unresolved. Memory is
not edited by this pass.

## What is settled

- Optional Types support is a Scope-wide promise. Core references, ownership,
  revision semantics and recognizable constraint failures do not require Types.
- Core does not require a Type reference to target a Bead or prescribe the Type
  description language. This Types profile interprets it as a reference to a
  Type-definition Bead, with an exact revision pinned in stored instances. Both
  Bead-Type and Link-Type definitions are Beads; their instance worlds stay separate.
- Definitions have immutable exact revisions. Type-to-Type conformance carries
  reusable structural and semantic promises; no separate Capability entity is required.
- Bead Types and Link Types are non-intersecting; conformance is only within each
  kind. Identical or reused property schemas do not create cross-kind membership.
- Every inherited schema and semantic promise applies. Direct declarations pin
  definitions, the implementation resolves the complete available closure, and
  conformance cycles are forbidden. Different revisions of a common ancestor
  can both apply. Diamonds do not multiply a Link's count within one constraint.
- Conformance qualifiers and specialized relationships may only tighten; every
  valid source-Type instance must satisfy the target's full contract. Conditional
  or probabilistic membership cannot substitute for conformance.
- Conformance declarations are owned ConformsTo Links, including conforming
  specializations. Exact owner revision snapshots determine authoritative
  declarations; historical traversal follows recorded Links and exact target pins,
  never current adjacency. Each declaration has its own identity and provenance.
- ConformsTo is a bounded experiment in using inter-Type Links. Ordinary graph
  viewers can expose its hierarchy when they support the records, but exact
  historical display requires recorded-state traversal. Editing, provenance and
  performance need evaluation before widening the pattern; no runtime claim yet.
- Instance affiliation stays in the distinguished type field, not an implicit
  Link. Everything else in the Type descriptor, including embedded JSON Schema,
  endpoint/arity/uniqueness/ownership constraints, remains fields in the definition
  Bead's properties. No separate Schema/Constraint Beads are introduced for now;
  concrete field syntax and schema reference resolution remain open.
- Disjoint allowed values for the same optional property permit omission, with a
  warning, if the remaining requirements permit it. Supplying the property fails
  validation. If either schema requires it, the effective definition is invalid.
- Valid-state conformance is not unrestricted write substitutability. Full
  properties replacement must satisfy the actual Type, including unknown-to-caller
  mandatory fields; it is not a merge. Explicit operation promises still bind.
- Link endpoint syntax starts with OR. Inherited lists intersect; a broader local
  declaration warns and does not override. Explicit AND/NOT/exact-only deferred.
- Bead and Link Types can declare arity. Counts use this Scope's Links, including
  external references, per endpoint identity across pins; conforming Link Types
  share counts. Bead Types declare minimums and maximums; Link Types declare only
  maximums (including zero). Same-set bounds intersect; different sets retain
  independent counts. Arity checks final
  transaction state, superseding maxima-only/per-operation rules.
- Atomic batch is optional within the proposed Write profile; every supported
  batch is atomic. Non-atomic sequence is outside the proposed direction. Existing
  Write implementation and document extraction are separate coordinated work.
- Latest domain ruling: issue is a base Bead Type; task, bug and the other work
  classifications conform to it. dependency is a base Link Type; blocks,
  parent-child and the other dependency classifications conform to it. Translate
  native issue_type/dep_type into the intrinsic Type; omit those discriminator
  properties from proposed domain records. Existing workflow meanings persist.

## Decisions that block a broadly complete specification

| ID | Concrete question | Evidence/example | Completion criterion |
| --- | --- | --- | --- |
| T01 | What names the counted Link set, direction and constraint identity? | dependency pair uniqueness spans blocks and parent-child; an Issue may have many different dependencies | Define syntax and exact applicability without confusing a pair key with endpoint maximum |
| T02 — local activation selected; inherited/selector precision remains | Where are differing revision constraints active? | An existing Assignment@1 Link keeps max1 at X; adding @2 max2 fails until explicit migration, absent other constraints | Complete inherited-revision/selector precision; endpoint/pair locality, per-Link acyclicity and inactive unused/history-only definitions are selected |
| T03 — resolved | Positive minimums belong on Bead Types; both kinds may declare maximums | Assignment eligibility does not oblige an ordinary Issue; AssignedIssue can require one | Same-set effective maximum is the smallest maximum; minimum is the largest minimum. Different counted sets remain independent. Declaration syntax is part of T01 |
| T04 — predicate selected; query syntax open | How are exact and identity-wide selectors exposed? | Pinned means exact affiliation/conformance; unpinned means any revision by identity/conformance, never latest | Finish query/diagnostic syntax; preserve distinction from nominal-only filters and alias resolution |
| T05 | How are endpoint pins and unavailable definitions checked? | MemorySupports cites an old revision; Dependency schedules against current Issue state | Define local/current/historical admission and revalidation; external validation is excluded, pin-mode constraints deferred |
| T06 — representation selected, syntax drafted | Which candidate definition fields and bootstrap should be adopted? | Type, BeadType, LinkType and ConformsTo contracts, six property schemas and a seed example are drafted; Core leaves target kind unspecified | Review candidate fields/seed; select production identities, installation, retrieval and pinned closure rules |
| T07 | What are lifecycle and migration operations? | Install a task definition; retype task to bug; remove a still-referenced parent definition | Distinguish publication, availability, acceptance for use, affiliation changes, retention and removal |
| T08 | What does compatibility promise, and who checks it? | Adding mandatory approvalCode breaks replacement; cents/dollars changes meaning despite identical shapes | Define read/data/write/semantic guarantees and any SemVer/claim mechanism without relying on schema inclusion alone |
| T09 | What happens to computed and operational fields? | heartbeat_at, lease expiry and is_blocked do not all behave like ordinary authored content | Separate storage, write authority, observation and revision identity; decide schema/view placement before claiming immutable complete records |
| T10 | How does legacy classification map to registered Types? | Configured custom Issue kinds and arbitrary short dependency labels already exist | Specify stable IDs/pins, reverse mapping, default create, unknown values and conflict handling; no guessed identity from a suffix |
| T11 | What does replacement mean when reads include generated/nonwritable fields? | Preview Issue --replace-properties replaces only eleven writable fields; the shared draft requires complete properties replacement | Select the read/write boundary or explicit compatibility migration; do not falsely claim the current command implements the new rule |

These are questions, not a requirement for eleven separate new mechanisms. Use the
smallest contract that answers the concrete cases. Definition representation now
uses Beads, but bootstrap and retention still need explicit rules; no installation
API has been selected yet.

Candidate machine-readable artifacts are linked from both specs under
[specs/schemas](../../specs/schemas/README.md). They define Type and ConformsTo
property shapes and mirror the Issue/Dependency base fragments. Candidate syntax
and the mutually dependent seed are review material, not additional settled decisions.
The current BDP descriptor was inspected at bd2178dd6f4b9f7c2d239624d7edaa3d961c3e26;
its older identity/conformance/schema-reference semantics remain distinct from this draft.

## Follow-up precision and validation

- Reconcile Core's current prose about references in properties with optional
  profile interpretation where needed, without turning recognized references into
  implicit graph Links. Keep canonical Core/Write amendments separately coordinated.
- Specify ConformsTo bootstrap, source-pin/traversal API precision and retention;
  do not confuse current incident Links with an exact owner's recorded declarations.
- Resolve schema dialect, references and closure composition, semantic-unit
  vocabulary, required contradiction checks and limits of mechanical proof.
- Pair-wise uniqueness now spans the declaring conformance family, keyed by ordered
  endpoint identities regardless of pins, and validates at commit. Define its wire
  syntax and other graph invariants separately. Do not silently defer authorization,
  revision preconditions or every other check to commit.
- Ownership matching through transitive conformance is selected, including custom
  descendants; no matching Link opts out. Specify selector syntax and evolution
  while preserving recorded historical owned sets.
- Separate generic schema acceptance from domain-operation availability. Merely
  registering a gate or waits-for definition cannot install its evaluator. Richer
  semantic declarations, CLI/BDP operation surfaces and agent skills are deferred
  until the Type foundations are complete.
- Selected mapping: codified workflow metadata becomes properties of the relevant
  Type; storage may remain metadata behind read/write projection. Preserve existing
  meaning, unknown metadata and historical data; exact child schemas remain open.
- Custom-name management belongs with the later bd Type-management surface against
  a complete Type draft. Do not design a separate ad hoc naming mechanism now.
  Configuration-dependent meaning (Issue P01 and the lifecycle/compatibility policy questions) remains
  explicitly open for a later discussion.

## Consistency findings and disposition

| Surface | Drift or risk | Disposition |
| --- | --- | --- |
| Types draft introduction | Previously said both domain drafts assume flat Types | Update pointer for the new Issue hierarchy; Memory reconciliation still pending |
| Earlier Type lifecycle exploration | Assumes definitions as Beads and earlier nominal-affiliation/compatibility design | Historical design input; current Types draft is the forward-looking discussion authority, canonical BDP still governs implementation |
| Issue/Dependency draft | Prior versions used discriminator properties and omitted the representation of the Type hierarchy | Updated to the selected hierarchy, definition Beads, owned ConformsTo Links and descriptor constraints; keep inspected Preview 2 evidence distinct from selected design |
| Memory §1 | Type definitions as Beads now agrees with the shared direction; flat Types remains an older assumption | Flag flat-Type assumptions for the user's review; no edit to the file |
| Memory §1 external definitions | Describes pending Dependency discriminator | Follow-up should reference issue/dependency hierarchies once reviewed |
| Memory §5 bounds and transactions | No mechanical minimums; says each staged operation must be valid | Superseded for shared arity design; revisit Memory-specific restrictions rather than silently relaxing all checks |
| Memory §5 queries and catalog | No conformance closure; subtype installation cannot extend eligible sets | Re-evaluate intended extension semantics; preserve the selected one-Memory-plus-kind design unless the user changes it |
| Memory related/pinned citation/lifecycle behavior | Informational Links differ from live workflow Dependencies | Keep domain differences explicit; no general propagation of Dependency restrictions or Memory cleanup rules |
| Issue properties replacement | Current writable-subset replacement differs from proposed whole-object replacement | Explicit product decision before implementation; no silent change during classification mapping |
| Current Write profile | Existing implementation has sequence and per-operation staged validity obligations | Do not edit or redirect Vickie's active work; stage a coordinated amendment when the new Type contract is ready |
| Computed/live Issue values | Query can return new lease observations under an unchanged durable graph revision | Existing behavior is evidence, not a resolution of the desired shared revision contract |

## Product examples to finish against

1. Read a task through issue; replace its properties without knowing every
   task-specific mandatory field; test targeted update separately.
2. Change task to bug without a second writable classification property. Preserve
   identity and earlier revisions; validate schema, ownership and domain effects.
3. One blocks and one parent-child Link for the same ordered Issue pair: preserve
   existing dependency-wide uniqueness. A new Type pin cannot create another slot.
4. Replace a mandatory owned relationship in a batch. Arity and pair uniqueness are final-state;
   owner revision materialization and other domain checks still need decisions.
5. Guidance accepts an Issue endpoint: establish whether task and custom Types
   conforming to issue qualify. A decision Issue is not automatically decision Memory.
6. Read the same Issue revision twice across a heartbeat. Identify which bytes are
   immutable state and which are observations; no automatic conclusion that reads
   should write new revisions.
7. Install a Type whose closure is unavailable, remove a definition still named by
   history, or change a Scope policy used by a Type. Specify exact failure/retention
   behavior rather than fetching latest or silently changing old meaning.

## Landing and evidence

A broadly complete draft needs a rule or explicit exclusion for each blocking
question. Deep completion adds wire/schema artifacts, diagnostics and executable
conformance cases. Keep design examples separate from observations of the delivered
Preview 2 build. The companion source audit pins the exact build/source and records
what was inspected; it is not a new runtime qualification.

Continue in the isolated design branch. Integrate bounded spec/schema/implementation
changes against then-current source heads with explicit BDP and Beads owners and
compatibility status. Do not merge this accumulated design branch as an implicit
migration or repin historical evidence to a newer build.

## October 14 endpoint/metatype consolidation

Selected: Type with BeadType/LinkType specializations; endpoint-pair alternatives
with OR arrays on both sides and lone wildcards; shared family-wide arity, ordered
pair uniqueness and directed identity-based acyclicity; commit-time graph checks.
External resources are opaque and unvalidated. Generic endpoint pin-mode constraints
are deferred. Six schemas and eight-definition/four-declaration final graph literals
exercise the selected structure. Informational SemVer, exact descriptor field names,
seed installation and publication-label uniqueness remain review proposals.

Do not accidentally settle T02 by declaring generic identity-acyclic ConformsTo:
that would prohibit same-Type-identity revision conformance even without an exact
revision cycle. ConformsTo keeps its exact-revision DAG requirement; this additional
restriction is not selected. Portable graph creation versus exact export/history
preservation and forward revision bindings are recorded in Types §7.1, not implemented.

## October 15 mixed-revision ruling

Donna selected retaining the existing Assignment@1 max1 guarantee when adding
an Assignment@2 max2 Link at the same Task. Installing @2 alone has no effect.
An explicit atomic move of the old Link to @2 can permit two if neither revision
conforms to the other and all remaining constraints pass. Do not generalize to
a Scope-wide minimum over all installed revisions: activation locality is the next
question. Provenance subject validation remains open for the separate deep review
this week; do not expand it during this Type exercise.

## October 15 activation locality and uniqueness ruling

Selected: arity activation is per affected endpoint/direction, counting all current
family Links across revisions. Unused installed/history-only definitions do not
activate constraints absent another applicable contract; a new Link using one must
pass its constraints against the proposed final state before commit. Uniqueness
activation is per ordered pair: old duplicates at A→B do not block unique @2 at
C→D, but adding unique @2 at A→B counts the old Links and fails. Atomic migration
can resolve the duplicate pair. Inherited/independent constraints remain binding.
Next question: acyclicity activation locality; no new answer inferred from pair
uniqueness. Provenance remains parked for its separate review.

## October 15 per-Link acyclicity ruling

Selected: every Link subject to acyclicity must be outside every directed cycle
formed by the declaring family, traversing all current family revisions/conformers.
Old cycles with no adopting Link may remain, even in a connected region; a later
old-Type Link cannot complete a cycle through a constrained Link. Final-transaction
validation remains. Types §5.8 discusses the whole-family alternative and explicitly
reserves CLI preflight/reporting/atomic-migration UX without selecting flags or
permitting protocol bypass. Next: exact versus floating constraint selectors.

## October 15 CLI sidebar and first implementation exercise

Independent proposal: [Type CLI](type-cli-proposal.md). Local valid definition
creation makes its exact revision usable, no activation step. Ordinary operations
and Type-specific CRUD share semantics. The editorial pass removed the
Type-specific display-name field; explicit ID is identity, generic resource aliases
provide friendly references. Pinned/identity-wide
selector predicates selected in Types §4.2. User favors a first implementation
exercise with open properties and a conformance graph. Full implementation is not
claimed or started; separate [implementation notes](type-cli-implementation-notes.md)
record bootstrap/reference/storage gates, source seams and acceptance cases.
Import/export and general migrate are parked.

## October 15 registry identity and publication authority

Selected: intrinsic Types are the binary-supplied bootstrap minimum and cannot be
updated or removed by Scope clients. Pre-installed Types are ordinary definitions;
registry graphs can supply them, with mechanics deferred. Registry installation
preserves global IDs and exact revisions by default for federated equality.
Installation does not grant authority to revise the publisher's identity. A Scope
holding only a copy rejects local publication under that identity; future absolute-ID
CLI routing can send updates to the origin, where ordinary authorization applies.
Local variation uses an explicit new identity; denied/offline origin writes cannot
silently edit the installed copy or create a fork.
Keep exact installed dependency/history closure available independently of cache
eviction or registry availability. See Types §7.2. Acquisition-on-use, replica
exposure and removal/retention details remain open.

### Registration and acquisition modes

Selected: default use fails when the Type is not registered for the Scope. An
explicit automatic-install mode may acquire and validate the Type and its required
graph before use. Brute-force/unvalidated use is deferred and unsupported initially;
any future support must record that the instance was not validated. Registration is
acceptance for local use, not cache presence or a new activation step. Identity-versus-
revision registration granularity and policy controls remain to decide.

### Generic aliases and prefix shorthand

Selected: aliases may identify an absolute external Bead/Link and optionally pin a
revision; one local name has one target and cannot collide with a local resource.
Creating an alias does not fetch/register the target. Stored references are canonical,
so later alias changes cannot move stored pins. Use current Bead/Link prefix shearing
as the reference behavior; root placement is still open. Existing BDP aliases are
narrower (alias/ root, in-Scope Beads only); coordinated amendment is needed. See §7.3.

### Unpinned write revision selection remains open

A Scope-selected default Type revision was proposed after alias pinning was agreed.
Donna has not selected it. Neither registry-latest nor local-default selection is
accepted by implication; do not implement either as a settled rule.

### WIP main landing follow-up

Fresh [Codex + Claude landing council](type-wip-landing-council-20261015.md) found
no blocker to the focused WIP landing. Next editorial increment: retitle §7 to cover
selected lifecycle decisions as well as open questions; cross-reference unresolved
unpinned write revision selection; narrow checker coverage to affiliation/declaration
pins and owned consistency; make general inherited Bead ownership explicit without
requiring all selectors to match; distinguish CLI alias shorthand from shared alias
representation/semantics. These do not reopen agreed design decisions.
