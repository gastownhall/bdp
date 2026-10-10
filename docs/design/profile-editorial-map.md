# BDP profile editorial map

This map tracks the first editorial round against integration base `0dcf5eba`,
which includes common metadata and `attribution.basis`. It does not adopt Type
lifecycle or other pending design proposals.

## Review boundaries

The first commit relocates every original level-two/three section exactly once,
without changing its body. Two former model/protocol container headings become
level-three headings; their GitHub anchors are unchanged. Later clarification
commits split mixed-profile sections and make existing applicability explicit.
No protocol version, schema, runtime, fixture or acceptance claim changes here.

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

The conformance tables remain a shared index, byte-identical and in their
original order, with a local applicability summary in each profile. They are
not new definitions needed to understand Read or Update. This preserves case
identity while catalog evidence citations are migrated separately.

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

- All **84 original heading anchors** remain available; 143 anchors exist in
  the reorganized document. The renamed local-reference heading retains its
  original anchor explicitly.
- All **182 internal Markdown links** resolve. Read and Read+Update contain
  **zero internal links to later-profile definitions**.
- All relative file links resolve from `docs/specs/`.
- Every original top-level section is accounted for above. The conformance
  matrix/row tables are byte-identical to the integration base.
- An exact-text audit of paragraphs containing capitalized normative keywords
  identified only profile splits/clarifications in endpoint liveness, limits,
  CORS and conditional/HEAD behavior; the obligations remain in their owning
  parts. This is a preservation check, not proof of complete semantic equivalence.
- `git diff --check` passes. No schema, runtime, fixture or catalog files changed.

**Integration gate:** an offline audit of 522 spec citations in the conformance
catalogs found **94 citations requiring migration** after sections were split.
All 94 matched the integration base. Sixty-eight still have an exact-text
candidate at a new anchor; 26 need a reviewed selection reflecting the local
profile wording. Browser anchor compatibility does not satisfy these
section-scoped evidence selectors. Do not claim conformance or a green test
suite until the integration owner updates those citations and runs the relevant
catalog checks. This editorial branch intentionally does not modify those
artifacts.

No runtime tests were run for this document-only change. No runtime behavior,
implementation completion, Preview 2 parity or qualification is claimed.
