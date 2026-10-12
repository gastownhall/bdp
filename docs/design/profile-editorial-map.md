# BDP profile editorial map

This map tracks the first editorial round against integration base `0dcf5eba`,
which includes common metadata and `attribution.basis`. It does not adopt Type
lifecycle or other pending design proposals.

## Review boundaries

The first commit relocates every original level-two/three section exactly once,
without changing its body. Two former model/protocol container headings become
level-three headings; their GitHub anchors are unchanged. Later clarification
commits split mixed-profile sections and make existing applicability explicit.
No protocol version, schema or runtime change is introduced by the editorial
commits. The integration follow-up migrates evidence citations and their
source-selection tests. The council repair below separates mixed-profile
History evidence into additive metadata siblings without changing wire semantics.

## Original section accounting

Base line ranges refer to `docs/specs/bdp.md` at `0dcf5eba` and are stable evidence,
not current line numbers. A later split retains the old heading/anchor at its
base-profile definition; extension headings live in their owning profile.

| Original lines | Original section | First relocation destination |
| --- | --- | --- |
| 1–12 | Front matter and title | Preface |
| 13–96 | Status and conformance | Preface |
| 97–192 | Conformance profiles and reading guide | Preface |
| 193–239 | The uniformity principle | Preface |
| 240–257 | Bead Data Model | Part I — Read |
| 258–492 | Beads and Links | Part I — Read |
| 493–564 | Types | Part I — Read |
| 565–617 | Scope aggregate constraints | Part I — Read |
| 618–699 | Scopes and identity | Part I — Read |
| 700–784 | Revisions | Part I — Read |
| 785–847 | Selection | Part I — Read |
| 848–863 | Actor attribution | Part I — Read |
| 864–907 | Carried attribution | Part I — Read |
| 908–958 | Authorization views | Part I — Read |
| 959–977 | Property changes | Part II — Read+Update |
| 978–1052 | Batch-local Resource references | Part II — Read+Update |
| 1053–1092 | Explicit Bead operations | Part II — Read+Update |
| 1093–1133 | Explicit Link operations | Part II — Read+Update |
| 1134–1161 | Explicit alias operations | Part II — Read+Update |
| 1162–1209 | Validation and results | Part II — Read+Update |
| 1210–1257 | Scope history | Part III — Transactional |
| 1258–1569 | Mutation Transactions | Part III — Transactional |
| 1570–1597 | Transactional alias mutations | Part III — Transactional |
| 1598–1674 | Set mutation | Part III — Transactional |
| 1675–1712 | Mutation receipts | Part III — Transactional |
| 1713–1964 | Events and Event Sources | Part III — Transactional |
| 1965–2056 | Change groups and replication | Part III — Transactional |
| 2057–2088 | Snapshots and strict reads | Part III — Transactional |
| 2089–2093 | Deferred model features | Conformance and informative end matter |
| 2094–2134 | BDP JSON and HTTP Protocol | Part I — Read |
| 2135–2331 | Scope discovery and human documentation | Part I — Read |
| 2332–2419 | Advertised limits | Part I — Read |
| 2420–2465 | Normative schema bundle | Part I — Read |
| 2466–2762 | Problem details | Part I — Read |
| 2763–2806 | HTTP consistency, caching, and CORS fields | Part I — Read |
| 2807–2857 | Conditional reads and HEAD | Part I — Read |
| 2858–2883 | Receipt and finite-feed HTTP validators | Part III — Transactional |
| 2884–2907 | Event-ID and checkpoint character profile | Part III — Transactional |
| 2908–3002 | Resource records | Part I — Read |
| 3003–3093 | Resource views | Part I — Read |
| 3094–3112 | Alias resolution | Part I — Read |
| 3113–3157 | Reads after deletion | Part I — Read |
| 3158–3388 | Historical resolution | Part I — Read |
| 3389–3439 | Immutable change context | Part I — Read |
| 3440–3746 | Types and Type Descriptors | Part I — Read |
| 3747–4450 | Read+Update sequence target | Part II — Read+Update |
| 4451–4696 | Batch operation target | Part III — Transactional |
| 4697–4953 | Operation record schema | Part II — Read+Update |
| 4954–5004 | Property-change values | Part II — Read+Update |
| 5005–5083 | Set mutation objects | Part III — Transactional |
| 5084–5375 | Mutation Receipt responses | Part III — Transactional |
| 5376–5416 | Incident Link reads | Part I — Read |
| 5417–5506 | Collection retrieval and selection | Part I — Read |
| 5507–5642 | Operation Directory and singleton targets | Part II — Read+Update |
| 5643–5776 | Scope snapshots | Part III — Transactional |
| 5777–6011 | Version erasure | Part III — Transactional |
| 6012–6179 | Scope changefeed | Part III — Transactional |
| 6180–6339 | Event replay and live observation | Part III — Transactional |
| 6340–6735 | Normative conformance matrix | Conformance and informative end matter |
| 6736–7012 | Open protocol questions | Conformance and informative end matter |
| 7013–7039 | Deferred companion work and implementation evidence | Conformance and informative end matter |

## Editorial invariants

- Read requires revisions, canonical records and stable paginated results; it
  does not require exposed epochs, transactions or replica-bootstrap snapshots.
- Read+Update inherits Read and adds individually atomic operations and ordered,
  non-atomic sequence. It does not inherit atomic multi-operation batches.
- Transactional inherits both lower profiles and states strengthened guarantees
  and changed response envelopes in its own part.
- Optional History remains available in Read. Its read contract does not become
  a replication requirement.
- Common metadata and `attribution.basis` remain intact.
- Original heading anchors remain available. New headings separate extensions;
  old anchors identify the base concept rather than imposing later obligations.
- Existing requirement text is relocated or explicitly clarified, not silently
  removed; the clarification ledger below records substantive wording changes.

## Clarification ledger

The clarification commit makes these existing profile boundaries local:

| Original mixed material | Read location | Update addition | Transactional addition |
| --- | --- | --- | --- |
| Identity, aliases and References | Scopes and identity; Beads and Links | Creation and identity allocation; Alias mutation model; Sequence-local Resource references | Transaction-local Resource references; Atomic operation extensions |
| Revisions | Revisions (opaque comparison, numeric values, retained addresses) | Mutation revisions and guards; Numeric admission; Revision allocation failures | Transactional revision visibility; Transactional revision and History extensions |
| Attribution and change context | Carried attribution; Immutable change context | Attribution on mutations; History context on mutation results | History context in receipts and Events |
| Authorization | Authorization views (projection and closure) | Mutation authorization | Authorization fences; Set authorization and retained receipts |
| Discovery, limits and schema | Scope discovery; Advertised limits; Normative schema bundle | Read+Update discovery; Read+Update schema and limits; Mutation limits | Transactional discovery/limits; Discovery profile membership; Profile schema inventory |
| Problems | Problem details (Read codes and HTTP-native responses) | Read+Update problem details; Sequence problem envelopes | Transactional problem details |
| HTTP | HTTP consistency; Conditional reads and HEAD | Mutation command preconditions; Read+Update consistency/field support; Mutation response media negotiation | Transactional HTTP consistency/field support; Transactional conditional reads; Mutation response negotiation |
| Types | Type meaning, descriptor representation, effective contracts | Installed Type contracts; Descriptor installation for mutation; Type validation and diagnostics | Existing staged validation and serializable outcomes |
| Operation records/directory | No mutation dependency | Operation record schema; Operation Directory and singleton targets | Batch operation record schema; Transactional operation directory and singletons |
| History recovery | Controlled-copy erasure and truthful retained history | Operation-local version production | History and Transactional erasure |

The old `batch-local-resource-references` anchor is retained explicitly before
**Sequence-local Resource references**; the atomic interpretation now appears
in Part III. An existing dangling `references` link now resolves to an explicit
anchor on the Reference definition.

The revision-mismatch sentence now says an Update operation fails without
changing state; Part III states whole-transaction rollback. The deletion
precondition now describes a separately committing sequence and its race,
while atomic cascade guidance lives in Part III. These are consequences of
the existing profile contract, not new execution modes.

Read's authorization/caching/HTTP text no longer demands exposed epochs,
checkpoints or replica-bootstrap snapshots. Transactional retains those laws.
Stable pagination remains a Read guarantee. The Read History diagnosis no
longer names an epoch to explain why an authority replacement alone cannot
prove a version's loss. Retained-address law is unchanged.

The obsolete sequence paragraph saying implementation must wait for rulings
is replaced by the resolved decision-ledger reference. The historical ledger
already states those rulings landed. A stale `claimed|unknown` mention in
History context is aligned with the integrated `basis: writer-supplied|unknown`
contract. Metadata documents and basis-bearing examples remain preserved.

Lower-profile idempotency now states its token grammar locally rather than
requiring an Event/checkpoint definition. Mutation results no longer explain
themselves by a changefeed tombstone; the equivalence remains explicit in
Part III.

The conformance tables remain a shared index with a local applicability
summary in each profile. The initial relocation preserved them byte-identically.
The council repair retains every existing ID and its profile, narrows one
History title to its lower-profile obligation, and appends nine History sibling
rows for higher-profile obligations. These rows are metadata, not new wire rules.

## Questions reserved for design

- Optional History is substantial but already available to Read. Simplifying or
  removing it is a product decision, not an editorial change.
- Read+Update's durable idempotency, sequence and eight singleton targets remain
  required. Reducing that surface would be a design change.
- Transactional uses receipt envelopes for singleton targets and its own sequence
  response. The cumulative contract includes these explicit response changes.
- Any uncertainty in protocol behavior exposed during extraction must be recorded
  here for a ruling rather than resolved by invented wire semantics.
- The Read `advertisedLimits` schema historically accepts some limit groups
  whose capabilities are not in minimum Read. This round preserves the existing
  schema and capability-applicability rule; tightening schema admission belongs
  in a separately reviewed conformance change.
- `include=links` remains outside minimum Read and is documented as an optional
  bounded aggregate. No new minimum requirement is introduced.
- The first round preserves many dated rationale paragraphs and the shared
  conformance index. Removing historical commentary and independently packaging
  each profile are later editorial slices, not completion claims here.

## Validation

The mechanical relocation accounts for all 61 original blocks exactly once.
The clarification pass checked:

- All **84 original heading anchors** remain available; 144 anchors exist in
  the reorganized document. The renamed local-reference heading retains its
  original anchor explicitly.
- All **185 internal Markdown links** resolve after the council repair. Read and Read+Update contain
  **zero internal links to later-profile definitions**.
- All relative file links resolve from `docs/specs/`.
- Every original top-level section is accounted for above. The conformance
  matrix/row tables were byte-identical in the initial relocation. The only
  council changes are the nine History siblings and one scoped History title
  described below; other existing conformance rows remain unchanged.
- An exact-text audit of paragraphs containing capitalized normative keywords
  identified only profile splits/clarifications in endpoint liveness, limits,
  CORS and conditional/HEAD behavior; the obligations remain in their owning
  parts. This is a preservation check, not proof of complete semantic equivalence.
- `git diff --check` passes. No schema or runtime files changed by this
  editorial work. Integration fixture correction `a9bcf9ed` was merged before
  running the artifact checks below.

## Citation integration and verification

The initial audit found 94 of 522 section-scoped spec citations needing
migration. The integration follow-up moved 68 exact selections and reviewed
26 selections whose wording was split by profile. That initial migration split some selections into several paragraphs but
left mixed-profile History clauses attached to lower-profile cases. The council
repair below corrects ownership with sibling cases; it preserves those clauses
rather than deleting higher-profile obligations to make a selector match.

The initial five-catalog migration preserved IDs and non-citation fields.
The council repair preserves those original IDs/profiles and adds scoped History
metadata cases as described below. Three maintained HTTP-gap objects in
`w1-transactional-packet.md` mirror their updated canonical citations. The council repair replaces flattened problem-table checks with independent
section membership assertions, retaining row/schema/fixture equality checks.

Verified with **Node 24.16.0 / pnpm 11.20.0**, after a frozen-lockfile install:

- `pnpm exec vitest run packages/conformance packages/protocol`: **41 files,
  1,629 tests passed**. The first run exposed six stale section-extraction or
  packet-mirror failures; the source selectors and mirrors were corrected and
  the full selected suite rerun successfully.
- After the final Read-citation, closed-discovery, heading and cross-reference
  repairs, all six catalog suites plus protocol tests were rerun: **26 files,
  970 tests passed**. That earlier check covered `read-v1.json`; it did not establish that
  Read-tagged cases in other catalogs had correct profile ownership. The
  all-catalog check below now covers that gap.
- `pnpm typecheck`: passed.
- Formatter checks for all changed catalog JSON and test files: passed.
- Canonical and package schema files are byte-identical.
- Catalog non-citation fields and conformance-table text remain unchanged.
- `git diff --check`: passed.

These checks validate specification/artifact consistency and the selected
protocol/conformance tooling. They do not establish a shipping write-profile
implementation, cross-product CLI parity or Preview 2 qualification. The
entire repository test suite was not run for this editorial slice.

## Council repair: profile ownership and preserved requirements

Repair base: `2535b898b8e533bd629312b9c3a85157fa6e31e5`; the council reviewed
`c493faf` against normative baseline `a9bcf9ed`. The repair uses the consolidated
native dispositions, not every external recommendation verbatim. Earlier local
repairs at the base already corrected the nonexistent update request schema names,
mutation diagnostic/sequence/receipt problem links, the historical table link,
and the Sequence-local link label. Those corrections remain.

The surface inventory classified spec applicability and source selections as
migrate-now; original case IDs, profile tags, wire schemas, fixtures and runtime
behavior as preserve; the Transactional packet citations as synchronized mirrors;
and Type lifecycle proposals/Preview 2 integration as outside this repair.

| Finding | Disposition |
| --- | --- |
| Claude 1: limits closure | Read locally identifies the closed `advertisedLimits` schema and its applicable groups; Read+Update locally enumerates its closed groups and retention members. Catalogs cite those sections. **Qualified:** the existing Read schema accepts some later-capability limit groups; it is not tightened through prose. Schema acceptance is distinguished from capability relevance. |
| Claude 2: History cross-profile citations | Preserve all 21 original IDs/profiles; add nine explicitly scoped siblings, for 30 metadata-only History cases. The full audit also found `history.retained-address` citing Read+Update guards. Each original clause survives under its owning profile. |
| Claude 3: nonnormative overview as authority | Restore the no-Events/no-durable-receipts rule in Read+Update consistency. Retarget every catalog overview citation, including guards and sequence interleaving, to local normative clauses. |
| Claude 4: discovery closure | Enumerate exact Read+Update required/optional members locally, verified against `readUpdateDiscovery`. Lower-profile catalogs use local clauses; full comparative operations/aliases membership is explicitly retained in the Transactional discovery case. |
| Claude 5: limit failure atomicity | Restore the explicit no-partial-mutation assurance in Mutation limits; existing operation and transaction rollback rules remain. |
| Claude 6: conditional ordering force | Restore `MUST precede` for Transactional epoch/view, minimum-position and erasure/expiry checks; update catalog and packet mirror. |
| Claude 7: History conditional erasure | Place the general no-retaining-erased-content assurance in Read conditional rules, inherited cumulatively. Keep checkpoint rules in Transactional. |
| Claude 8: HEAD qualifier | Restore “merely to stream events” in spec, catalog and packet. No assertion is made about the reviewer's stronger TCP-reuse interpretation. |
| Claude 9: actor surfaces | Restore the actor prohibition on mutation results in Part II and on receipts/Events/groups in Part III's actor section. Read retains its Resource prohibition. |
| Claude 10: split-section references | Retarget the remaining wrong-root alias reference to Read+Update problems; split the Event HTTP reference between inherited Read behavior and Transactional context/checkpoint requirements. Base repairs already covered diagnostics and the other problem references. |
| Claude 11: table membership checks | Assert Read, Read+Update additions and Transactional additions independently, including content/count/schema equality. Read+Update tests no longer read the Transactional table just to slice it away. |
| Claude 12: 412/409 distinction | Restore the distinction in Part II command preconditions, avoiding write vocabulary in Read. |
| Claude 13: missing bullets | Restore independent retention bullets and sentence-ending punctuation in Read and mutation limits. |
| Claude 14: deletion artifacts | Replace the dangling context pronoun and update its History citation; fix the semicolon and revision-period artifacts. |
| Claude 15: later vocabulary | Remove the Part II set-mutation attribution mention and batch comparison; keep the earlier Sequence-local display-label repair and compatibility anchor. Root review also moved receipt-specific command-precondition wording to Transactional HTTP field support, preserving its rule with a backward reference. |
| Claude 16: duplicate/process claim | Deduplicate the repeated Transactional table citation. Preserve the existing schema-inventory process text; no new product obligation is inferred from the alleged future-process weakening. |
| Claude 17: History Read diagnoses | Put the five Read diagnosis pointer in Part I; retain only the write allocation-failure pointer in Part II. |
| Gemini 1–3 | Schema entry names, mutation problem links and Sequence-local label were already repaired at the base and remain verified. |
| Rejected/deferred external claims | The missing-History claim came from truncated context and is false. The numeric-admission wording predates this reorganization; any broader metadata error-semantics change is deferred. |

### History metadata ownership

Original Read cases retain their Read requirements. `history.retained-address`
and `history.context` gain `.read-update` siblings for guards and mutation
postimages. Transactional siblings cover allocation rollback, receipt/Event
context, atomic commit time, set/batch context inputs and fan-out, erasure ledger
rules and the required controlled-copy acquisition route. They supplement their
lower cases; they retire none. `history.context-time`'s title is narrowed to
independently committed sequence instants, and its atomic-time wording is on its
new Transactional sibling. No executable manifest admits the History catalog.

The catalog-level profile invariant now checks **all six catalogs**, including
unchanged entries, rather than only edited selections. A source excerpt must
resolve, remain within its owning or an inherited part, and not cite the explicitly
nonnormative profile overview. Shared conformance-index citations remain allowed.
This verifies structural ownership; it is not proof that every sentence is a
complete or unambiguous implementation contract.

### Repair verification

Using Node **24.16.0** and pnpm **11.20.0**, with frozen-lockfile installation:

- `vitest run packages/conformance packages/protocol --maxWorkers=2`: **42 files,
  1,636 tests passed**, no failures or skips. The first run found three stale
  excerpts (four failing assertions); those selections and the packet mirror
  were repaired before the passing rerun.
- After the final receipt-precondition relocation, the six affected catalog/
  protocol suites passed **307 tests** with no failures or skips.
- `pnpm typecheck`, `pnpm check:boundaries` and `pnpm format:check`: passed.
- All **539 spec citations** across six catalogs checked; no later-profile
  target on a lower-profile case and no normative overview citation remains.
- **144 anchors**, including all **84 baseline anchors**, and **185 internal
  links** checked; no missing anchor or forward link from Read/Read+Update.
- Original catalog IDs and profile tags preserved. Catalog sizes are Read 49,
  Read+Update 81, Transactional 133, numeric 4, owned-wildcard 7, History 30.
- Canonical/package schema copies remain byte-identical and unchanged; no runtime
  or fixture changes. `git diff --check` passed.

Logs and machine-readable evidence are outside the clone in the local
`bdp-editorial-review` directory. These are artifact consistency checks, not
shipping profile conformance, CLI parity, Preview 2 qualification, or council
readiness. Root retains integration and publication ownership.

The preexisting Read schema's wider limit acceptance remains an explicit design
question. It cannot be resolved by this editorial repair without a separately
reviewed schema/conformance decision. No other new product semantics were chosen.

## Present-contract follow-up

The subsequent [present-contract editorial map](spec-present-contract-map.md)
accounts for removing development chronology and consolidating optional History
within Read. Its ledger disposition and validation supersede this earlier round's
bookmark-preservation counts; no draft-reader compatibility scaffold is required.


## Four-part organization

The current structure separates the common Data Model from the three protocol
profiles. This follow-up is based on `cd22ac3e388be3baffaf1d3a4caac7c4bd288502`;
the first-relocation destinations and previous verification counts above remain
records of their original passes.

| Current part | Contents and ownership |
| --- | --- |
| Part I — Data Model | Shared Scope/Resource identity, aliases, Beads, Links, References, ownership, Type identity and effective constraints, aggregate constraints, revisions and carried attribution. These are common Read-level concepts, not a fourth advertised profile. |
| Part II — Read | Authorization projections, selection, JSON/HTTP, discovery, schema/limits, descriptor inventory and retrieval, Resource/collection reads, optional History, errors, validators and Read conformance. |
| Part III — Read+Update | Inherits the model and Read; existing single-operation, sequence, mutation and retry obligations remain here. |
| Part IV — Transactional | Inherits the model and both lower profiles; existing transaction, receipt, Event, snapshot, changefeed and erasure obligations remain here. |

The `Types and Type Descriptors` inventory/wire block and its `Descriptor
resolution and installation` subsection move to Read. `Effective Type contracts`
and `Link endpoint constraints` remain nested under `Types` in the shared model.
Every operative section body is unchanged. Only the reading guide and part/model
introductions are revised. Existing Part anchors and `bead-data-model` resolve
through explicit aliases; the four new Part headings have their own anchors.
No draft amendment narration is added to the normative specification.

The profile ownership inventory explicitly classifies both Data Model and Read
at Read rank. Existing citation admission, shared-excerpt restrictions and
ambiguous-anchor rejection remain intact. Internal links are now checked for
resolution and lower-profile forward dependencies, including a negative case
through a retained Part alias. Catalog IDs, excerpts, profile tags and requirement
counts are untouched. Data Model does not acquire any write- or transaction-only
requirements from this organization.

Verification with Node 24.16.0 / pnpm 11.20.0:

- `pnpm exec vitest run packages/conformance packages/protocol --maxWorkers=2 --reporter=verbose`:
  43 files, 1,661 tests passed, no failures or skips.
- `pnpm typecheck`, `pnpm check:boundaries`, `pnpm format:check` and
  `git diff --check`: passed.
- A section-body audit against the base preserves all 137 operative section
  bodies byte-for-byte after removing added standalone anchor lines and their
  insertion-only blank lines. All 144
  prior anchors remain; there are 148 anchors and 171 resolving internal links.
- All tables, conformance end matter and capitalized requirement-word counts
  remain unchanged. Runtime, schema, fixture, catalog and historical evidence
  files are untouched. These checks are editorial/artifact consistency checks,
  not new provider qualification or public profile admission.

The separate revision-provenance work still owns the carried-attribution and
History metadata definitions. Integration must preserve that worker's revised
bodies in the shared model and optional History section respectively; this pass
changes neither envelope. These counts describe the original96ffc56 pass, not the later provenance
integration. Its audit and logs are archived outside the checkout under
`/Users/dbox/repos/wt/vickie/bdp-integration-logs/four-part-editorial/`;
that machine-local evidence is not a repository-distributed reproduction tool.


## Provenance and four-part integration follow-up

Scratch source is96ffc56 (four-part layout overcd22ac3); operative provenance
changes are fromd7fccb4, plus the owned-Link metadata Event-fold correction
c1712f2. The combined spec retains current clauses and profile-local History
ownership. Read need not advertise History or provide an actor, timestamp or
provenance envelope. A minted version carries one revisionProvenance envelope;
History's committedAt/agent/message group remains all-or-none independently
of actor. No-op keeps the entire existing envelope. Old wire shapes are rejected.

The data-model introduction explicitly distinguishes shared state constraints
from Read representation definitions. The reading guide deliberately describes
backwards dependencies between profiles; Data Model is shared, not a profile.
An additional part-order link check protects the model-to-Read boundary without
an allow-list; the History link now lives in Resource records. The model anchor
is bounded to its introduction, and nested Type headings remain explicitly
described as children. Catalog IDs, profile ownership and obligations are
preserved while selectedText follows the revised operative clauses.

Scratch validation (Node24.16.0 / pnpm11.20.0): six focused catalog/profile/HTTP
files passed219 tests; typecheck, dependency boundaries, format and diff checks
passed. The final audit retains142 heading sections and all148 prior anchors;
172 internal links resolve. Of142 normalized section bodies,112 are unchanged
from96ffc56;30 change for the listed provenance, metadata-fold and editorial
corrections. All744 spec citations (768 total) in seven catalogs remain valid.
Catalog changes are selectedText only: IDs, profile tags, anchors, requirement
counts and other metadata are identical. This scratch branch does not integrate
runtime/schema changes; combined runtime/example/evidence checks belong to the
integration worker and these checks do not constitute qualification.
