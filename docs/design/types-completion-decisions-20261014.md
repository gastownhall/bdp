# Types completion: consistency review and next decisions

October 14, 2026. Review against the current [Types draft](../../specs/types.md),
[Issue/Dependency draft](../../specs/types/issue.md), and the user-edited
[Memory draft](../../specs/types/memory.md). This is a decision list, not another
normative specification. Unresolved product choices remain unresolved. Memory is
not edited by this pass.

## What is settled

- Optional Types support is a Scope-wide promise. Core references, ownership,
  revision semantics and recognizable constraint failures do not require Types.
- Definitions have immutable exact revisions. Whether definitions are Beads is
  undecided. Type-to-Type conformance now carries reusable structural and semantic
  promises; there is no separately required Capability entity.
- Every inherited schema and semantic promise applies. Direct declarations pin
  definitions, the implementation resolves the complete available closure, and
  conformance cycles are forbidden. Different revisions of a common ancestor
  can both apply. Diamonds do not multiply a Link's count within one constraint.
- Valid-state conformance is not unrestricted write substitutability. Full
  properties replacement must satisfy the actual Type, including unknown-to-caller
  mandatory fields; it is not a merge. Explicit operation promises still bind.
- Link endpoint syntax starts with OR. Inherited lists intersect; a broader local
  declaration warns and does not override. Explicit AND/NOT/exact-only deferred.
- Bead and Link Types can declare arity. Counts use this Scope's Links, including
  external references, per endpoint identity across pins; conforming Link Types
  share counts. Lower bounds and zero maximum are meaningful. Arity checks final
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
| T02 | How do arity limits coexist across definition revisions? | Assignment@1 max1 and Assignment@2 max2 share nominal allowance | Select activation/coexistence/migration rules; reject implicit latest-wins and revision-created extra slots |
| T03 | What population owes a Link-Type positive minimum? | Assignment allows Issue sources; an ordinary zero-Link Issue is not automatically an AssignedIssue | Specify obligation trigger/lifetime, including external identities; no implicit global enumeration |
| T04 | How do nominal and conformance selectors match exact and floating definitions? | Query issue includes task/bug by conformance; an exact historical contract must retain meaning | Define matching independently from presentation aliases, revision age and compatibility claims |
| T05 | How are endpoint pins and unavailable definitions checked? | MemorySupports cites an old revision; Dependency schedules against current Issue state | Define local/current/historical/remote admission and revalidation, without treating unknown as false |
| T06 | What is the definition representation and bootstrap? | issue/task and dependency/blocks need exact definitions; definitions may or may not be Beads | Specify fields, identities, finite bootstrap, retrieval and pinned closure availability |
| T07 | What are lifecycle and migration operations? | Install a task definition; retype task to bug; remove a still-referenced parent definition | Distinguish publication, availability, acceptance for use, affiliation changes, retention and removal |
| T08 | What does compatibility promise, and who checks it? | Adding mandatory approvalCode breaks replacement; cents/dollars changes meaning despite identical shapes | Define read/data/write/semantic guarantees and any SemVer/claim mechanism without relying on schema inclusion alone |
| T09 | What happens to computed and operational fields? | heartbeat_at, lease expiry and is_blocked do not all behave like ordinary authored content | Separate storage, write authority, observation and revision identity; decide schema/view placement before claiming immutable complete records |
| T10 | How does legacy classification map to registered Types? | Configured custom Issue kinds and arbitrary short dependency labels already exist | Specify stable IDs/pins, reverse mapping, default create, unknown values and conflict handling; no guessed identity from a suffix |
| T11 | What does replacement mean when reads include generated/nonwritable fields? | Preview Issue --replace-properties replaces only eleven writable fields; the shared draft requires complete properties replacement | Select the read/write boundary or explicit compatibility migration; do not falsely claim the current command implements the new rule |

These are questions, not a requirement for eleven separate new mechanisms. Use the
smallest contract that answers the concrete cases. For example, the definition
representation may use ordinary Beads and existing operations if that satisfies
bootstrap and retention; no installation API has been selected yet.

## Follow-up precision and validation

- Same-name optional fields with disjoint allowed values can prohibit presence
  without making every instance invalid. Decide diagnostics/admission explicitly.
- Cross-kind conformance between Bead and Link definitions is undecided; applying
  the same rules to both kinds does not select cross-kind membership.
- Resolve schema dialect, references and closure composition, semantic-unit
  vocabulary, required contradiction checks and limits of mechanical proof.
- Decide pair-wise uniqueness and any other graph invariants separately from
  arity, including their validation phase. Do not silently defer authorization,
  revision preconditions or every other check to commit.
- Specify ownership matching under conformance. An Issue owning dependencies must
  include blocks/parent-child, not only exact nominal dependency affiliations.
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
| Issue/Dependency previous draft | One issue/one dependency with discriminator properties, flat endpoint assumptions, per-operation graph validity | Revise under the user's new direction and current Preview 2 evidence; preserve existing semantics and distinguish proposed mapping |
| Memory §1 | Assumes Type definitions are Beads and Types are flat | Flag for the user's review; no edit to the file |
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
4. Replace a mandatory owned relationship in a batch. Arity is final-state; pair
   uniqueness timing and owner revision materialization still need decisions.
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
