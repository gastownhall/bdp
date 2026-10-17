# Fixed-catalog Memory V2: bounded type-gap audit

Read-only audit, October 17, 2026. No source edits or outward coordination.

## Evidence and scope

Read public BDP Memory PR143 head `38791e4cc6e16cf661fa839303d4ff315d49ab3d`: `specs/types/memory/memory.md`, its embedded schemas and definition graph in `definitions.json`, and sibling shared Types/Issue specifications. Read current public gastownhall/beads#5877 body (Revision 4). The Memory artifact still labels names/field contracts illustrative candidates and explicitly makes no Preview3 cutline claim. This audit does not freshly qualify a binary.

Current Donna scope supersedes broader requirements where explicit: fixed compiled catalog; no user-installable types, public commitment to type-definition representation, BDP/federation prerequisite, or provenance signatures. New Memory association must receive a new name; existing Dependency `related` retains identity, ownership and behavior. Memory ordinary-bead plus five specialized types is selected; exact fields and catalog details remain Melinda-owned draft decisions.

## Main finding

Do not wait for a complete generic Type engine. The proposed fixed Memory catalog exercises membership/conformance, inherited properties, endpoint-pair unions, domain-specific pin/self-link checks, and ownership/history. It declares **no positive participation minimum, pair uniqueness, or acyclicity** on any of its six relationships. Existing Issue/Dependency constraints must remain enforced, but a new generalized constraint language and cross-revision constraint-activation engine are not required to add these six relationships.

The deletion-versus-positive-minimum conflict in Memory §10.3 is a valid future design problem, but its witness is a hypothetical user-defined Issue conformer requiring Guidance. With user types excluded and no such supplied obligation, it does not block the fixed catalog. Do not introduce this obligation merely to exercise the type framework.

## Smallest decision queue, ordered for interactive discussion

### 1. Retyping boundary and invalidating graph changes

Settled already: explicit affiliation changes may preserve resource identity; omitted affiliation remains pinned; new complete properties must be valid; old revisions retain meaning; no automatic migration. Do not re-open those principles.

What remains for a coding dispatch: precisely which transitions V2 supports and what happens to incompatible existing floating links. Concrete example: converting a Memory to Issue would invalidate Supports/Challenges, change ownership, and introduce workflow properties. Memory→Procedure keeps the family and ownership but requires steps.

Recommendation: initial supported new transition set is within the supplied Memory family; retain established Issue classification transitions separately. Atomic resulting-state validation; unsupported cross-family transitions fail before mutation. This is a proposed product cutline, not a change to general Types. Permit family-internal type plus property changes in one guarded write, never intermediate invalid state. Do not claim arbitrary Link retyping merely because all six have the same properties shape. If V2 does require it, validate target endpoints/pins and source ownership effects atomically.

Cases: Memory→Procedure without steps rejects with no revision; with valid steps succeeds under same ID, old note revision intact; missing type on edit preserves it; stale guard rejects; Procedure→Memory preserves unrecognized properties unless explicitly removed; forbidden Issue↔Memory fails without graph/native-row changes. If user chooses broader support, a floating edge losing eligibility must reject unless an authorized atomic repair leaves a valid graph; pinned historical edge evaluates old state.

### 2. Pinning and same-identity re-pinning operations

The semantics of pinned vs floating references are settled. Memory-specific pin requirements are still proposed domain choices: Supports/Challenges/Supersedes require exact targets, Guidance/AppliesTo/new association accept either. Source defaults floating. Dependency stays live local floating initially (Issue §4.3), so no need to solve scheduling against historical blockers.

The real required addition is Chris R23: update a Link's target revision and metadata in place, preserving its identity. This is distinct from arbitrary Link retyping. Existing immutable pin machinery may need a bounded amendment/implementation change.

Recommendation: accept Melinda's citation requirements after her review; require caller explicitly choose target state, do not silently pin citations. Support same-target-identity re-pinning atomically. Do not add general pin constraint descriptor syntax or allow arbitrary retargeting as a side effect. Decide explicit source-pin mutation support before advertising it; historical source pin must never edit its historical owned set.

Cases: Supports to current/floating target rejects; to retained exact target accepts; target advances but citation stays exact; re-pin Link to newer revision retains Link ID and versions Memory owner; previous Memory revision keeps old Link state; historical target gone gives typed refusal, never latest fallback; Issue blocker pins remain unsupported without affecting informational pins.

### 3. Type selection and family discovery

Settled semantics: one nominal type; five types conform to Memory; schema matching alone never creates membership; conformance matching differs from nominal-only; identity-wide selectors do not resolve latest. These can be compiled membership tables, not a runtime definition graph.

Dispatch needs a CLI/query mapping, particularly whether `--type memory` includes specializations and how exact nominal filtering is expressed. Recommendation: ordinary family-facing Memory operations include all six; shared type-filter behavior must be explicit and consistent, not accidentally exact in one path and family-aware elsewhere. Preserve existing CLI meaning unless deliberately changed. This is a small product surface decision, not new conformance theory.

Cases: Procedure appears once in `memories`; generic type discovery includes it under Memory when family match selected; workflow-only commands refuse every Memory specialization; Guidance accepts task/bug and every Memory child; unfamiliar root properties cannot spoof membership.

### 4. Stable catalog identities and upgrade meaning

Do not ship example.org artifact identities as accidental production identity. Fixed definitions need stable identity/meaning across binaries even when representation remains private. Recommendation: choose existing product naming namespace where compatible, plus an internal immutable catalog-contract identifier per supported type version. Retain old contract interpretation for stored revisions or reject unsupported forward data accurately. No type beads, registry, public descriptor CRUD, content-hash allocation, or SemVer policy is needed to dispatch bounded implementation.

Cases: new binary reads old Memory/Link revisions with same meaning; existing `related` records unchanged; new Memory association never resolves through Dependency selector; older binary does not silently overwrite unsupported newer typed state. Exact production names/IDs are owner choices needed before shipping, not before membership/validation helpers can be written.

## Melinda-owned domain decisions, not generic Types blockers

- New association name: Donna selected distinct new name, no Dependency `related` change. `memory-related` is a safe explicit candidate already used as illustrative identity, but not chosen. Beware `relates-to` is already a Dependency child too.
- Final six-Bead/six-Link catalog and fields: Memory; Observation/Decision/Procedure/Policy/Lesson; association/Guidance/AppliesTo/Supports/Challenges/Supersedes. No kind discriminator.
- Required fields, closed inception/applicability nested objects, title derivation, citation pin requirements, self-link ban, structured search paths, render/export exposure, and defaults. These can be hand-coded validators but must follow one reviewed contract and shared fixtures.
- New relationships declare neither global uniqueness nor acyclicity. Parallel identities allowed, no automatic winner for conflicting/superseding memories. Existing Dependency pair uniqueness and mixed-cycle checks continue unchanged.
- Avoid conflating `memory-supersedes` with native Dependency `supersedes` or `bd supersede` close-workflow behavior.

## Required runtime guarantees, not unresolved Type theory

- Complete properties validated at atomic create/update, inheritance included; targeted edits preserve unknown data; full replacement cannot silently lose required fields. Property types/date-time and applicability ordering checks are real admission requirements.
- Endpoint union is union of pairs, not independent source/target flattening. Same-scope floating requires live eligible state; exact uses retained state. No graph Link endpoints become Links.
- Self-link rejection by canonical identity even with different revision pins; no remote validation required.
- Every outgoing Memory Link belongs to its immutable source state. Add/update/remove atomically versions Memory source, never target; incoming late evidence does not rewrite target. Issue-source Guidance is not owned under current Issue ownership rule, but Link has independent history.
- Durable content/metadata/inception/source changes version; semantic no-op does not. Current/historical read, history comparison, restore, retention/gone reasons, concurrency and deletion are real V2 work, not satisfied by adding catalog rows.
- Delete Memory cleans floating incident Memory relationships, preserves retained pinned citations and historical owner sets. No positive minima in this catalog prevents implementing this without resolving the hypothetical custom minimum conflict. Do not apply new cleanup indiscriminately to workflow Dependencies.
- Native Memory revision requires responsible writer plus timestamp; indirect owned-link/cleanup changes receive initiating attribution. Writer-provided is okay; never infer authentication. Provenance deeper representation/admission disputes stay with provenance owner.
- Compact discovery searches declared specialized fields; explicit full reads show them. Fixed types are not implemented merely because create validation passes.

## Deferred general features

User-defined/installable types; dynamic ConformsTo graph and schema authoring; registry and dependency installation; aliases for types; package import/export format; descriptor representation/metatype/bootstrap; schema-composition decision procedure; arbitrary semantic validation; general arity/uniqueness/acyclicity authoring and mixed-revision activation; same-identity cross-revision conformance; general migration; SemVer participation; federated validation/routing; signing. Preserve existing Dependency constraints and stored type meaning nonetheless.

No BDP/federation does not necessarily mean dropping opaque external reference values: carrying a URL/source without fetching is separable. Donna must explicitly narrow broader Chris cross-scope/interface requirements if V2 omits them; local product can accept opaque values without implementing federation.

## Provenance explicitly left open

Activity admission for nonexistent/pruned subjects; authenticated basis wording; envelope amendments; full provenance attestation. None should trigger a new Memory-specific source/admission system. The scoped plan accepts unsigned writer claims. Basic actor/time/source recording, unknown-vs-empty distinction, and indirect attribution still need a selected concrete local mapping for the relevant implementation slice.

## Coding dispatch today

Safe parallel-ready first tranche, subject to parent/Janet codebase readiness: central fixed catalog membership helpers; property validators from approved Memory schema fixtures; type-aware create/update/filter dispatch; endpoint pair checks including self-link/pin requirements; tests protecting Dependency behavior. Design seams for source-owner mutation hooks and history, but do not claim complete Memory release until those integrations are real.

The implementation plan should split catalog/validation delivery from revision/owned-link lifecycle and provenance delivery, with explicit dependencies and honest completion claims. Full V2 cannot be reduced to twelve new catalog entries.
