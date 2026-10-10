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

Pending the boundary-clarification pass.

## Questions reserved for design

- Optional History is substantial but already available to Read. Simplifying or
  removing it is a product decision, not an editorial change.
- Read+Update's durable idempotency, sequence and eight singleton targets remain
  required. Reducing that surface would be a design change.
- Transactional uses receipt envelopes for singleton targets and its own sequence
  response. The cumulative contract includes these explicit response changes.
- Any uncertainty in protocol behavior exposed during extraction must be recorded
  here for a ruling rather than resolved by invented wire semantics.

## Validation

The mechanical relocation accounts for all 61 original blocks exactly once.
Profile-boundary validation and anchor checks are recorded after clarification.
