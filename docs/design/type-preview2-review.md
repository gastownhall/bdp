# Preview 2 Type draft — initial review disposition

October 4, 2026. Plan: [BDP #59](https://github.com/gastownhall/bdp/issues/59).
Delivery: [PR60](https://github.com/gastownhall/bdp/pull/60).

## Scope and limits

The initial review council used native Codex, external Claude, and Gemini via
Antigravity. All three returned substantive reviews. Gemini's first file-access
attempt returned no review because headless command permission was unavailable;
a second review of supplied document/spec text completed without requesting
permissions or enabling automatic approval. Claude inspected the BDP spec and
schema locally but did not independently verify the remote Beads source heads;
Trish performed that source verification.

The target was the provisional design, decision packet and README authority
statement, not runtime implementation or the release's decided-specification
Review Team gate. Review started before draft commit `eadab654130d3cd03dac2194f3f0c5f03574592d`;
findings were applied in stages. Claude and Gemini reviewed intermediate drafts.
A final native review of the revised 32-case documents found no blocking findings
and no accidental product ruling. External reviewers have not re-reviewed the
final revision. This is initial design-review evidence, not final product or
release acceptance.

## Findings corroborated by multiple reviewers

| Finding / highest submitted severity | Reviewers | Disposition |
| --- | --- | --- |
| Owned-Link adoption can change ownership, bounds, guards, aggregate state and source versions / High | All three | Expanded §5/D06 and T19–T21; T30 also covers invalid explicit/wildcard bounds. Outcomes remain product decisions. |
| Existing v0 immutability and Reference pin laws must be reconciled explicitly / Critical | Claude, Gemini | Baseline now states the direct conflict, new-model-only pin invariant and legacy handling; D03 retains exact-addressing choice; amendment map preserved. Conflict is intentional in a proposal, not a defect repaired by inventing wire fields. |
| Publication needs a distinct pass criterion from normative adoption / High | Claude, Gemini | Added two checkable completion criteria. Monday targets the requested design/specification draft. Canonical prose/schema/fixture/conformance amendment and adoption are separate. Neither gate is claimed passed. |
| External endpoint policy needs an evolution case / Medium | Claude, Gemini | T23 records policy tightening without assuming remote dereference or cross-authority atomicity. |
| Relationship between properties preservation and adoption / Medium | Claude, Gemini (baseline/coverage concerns) | T24 and baseline retain the current open-root/preserve-untouched obligation unless expressly amended; no byte-serialization promise added. |

## Other accepted findings

| Reviewer / finding | Disposition |
| --- | --- |
| Native: dependency cycles conflated with conformance cycles / Medium | D04/T16 distinguish conformance, recursive schemas and bootstrap; bounded evaluation is separate. |
| Native: T20 silently narrowed still-open integrity alternatives / Low | T20 now says chosen integrity policy. |
| Claude H1: no absent-pin transition for existing/retained records | New-model invariant scoped; D02/D03 and T27 cover absent pins and successors without rewriting retained records. |
| Claude H2: cross-authority version minting/identity and divergence undefined | D03/D11 and T28 explicitly own minting authority, agreement on content, unknown definitions and divergence detection. No public digest format selected. |
| Claude H3: shared outcomes mixed with Beads acquisition/package mechanisms | Added boundary paragraph before lifecycle matrix; D11 separates portable meaning and publication authority from concrete format, distribution and trust configuration. Shared interchange standardization needs an explicit scope decision. |
| Claude H4: intersection conformance expresses only substitution | §4 states this limitation and leaves the separate acceptance-claim carrier as D05. |
| Claude H6: existing retention duties and replicated erasure not carried forward | Baseline cites artifact and Scope-lifetime identity/fingerprint duties; weakening requires amendment. D09/T32 cover propagation and dependent data. |
| Claude M1: identity/version matching in filters and Scope policies missing | D12/T29 cover type/conformsTo filters and maximumEndpointMultiplicity. |
| Claude M3: existing install checks and refusal vocabulary missing | Baseline and T30 name dialect, required vocabularies, open roots, descriptor rules, bounds and type-not-installed. New availability outcomes remain undecided. |
| Claude M5: coordinated parent/child adoption and inactive parents missing | D09/D10/T31 cover dependency ordering and fixed-closure behavior. |
| Claude M6: canonical open-question visibility omitted | Amendment map now includes reconciling the canonical spec's open-question ledger. No normative edit made during this draft. |
| Claude L1–L3: preservation claim, repository roles and relative date | Preservation labeled recommendation; repository roles named; October 4 review date stated absolutely with request context. |
| Gemini 8: two versions of one identity in a conformance diamond | D04/D05/T22 require a decision; explain why blindly rejecting multiple versions would also prohibit proposed predecessor conformance. |
| Gemini 11: resource deletion after deactivation/erasure missing | D09/T12/T25 require explicit guards, dependency checks and outcomes. No ID-only delete or cascade was inferred. |
| Gemini 5: false or withdrawn semantic claims need observable consequences | D05/T26 cover future admissions, existing data, retained evidence and diagnostics separately. |

## Disagreements and suggestions not adopted

Gemini classified several explicitly unruled choices as Critical/High defects
and proposed concrete solutions: a new discriminator field, a separate
content-addressed definition URI, engine-native metatypes with exclusively
administrative operations, cryptographic certification, irrevocable admitted
claims, a one-version-per-identity closure rule, and ID-only resource deletion.
Those are not accepted product rulings. Some are plausible options; others
conflict with the working model or existing integrity rules. D01–D12 and cases
now expose their underlying questions without selecting those mechanisms.

The final native review found these unresolved decisions appropriate for a
provisional design draft. The council does not authorize implementation against
an undecided contract. Donna's rulings, review of the decided specification,
CLI seam acknowledgment and release-owner acceptance remain pending.

## Validation

Trish checked unique ordered D01–D12 and T01–T32 rows, local Markdown links,
balanced fences, and `git diff --check`. Acceptance cases are written scenarios,
not executed tests. No runtime, database, protocol-conformance or combined-release
qualification was run by this lane.

Final document digests (SHA-256; packet includes the added review-report link):

- `README.md`: `11509a79f91a59eff39c14cd186b61bd858e83cd2d9772b3151f518348e96a6d`
- `docs/design/type-lifecycle-preview2.md`: `de9d3eae68875aa44515ca3a4b28c979f5bd87f24d83193edbb2e49e9af16744`
- `docs/design/type-preview2-decision-packet.md`: `fee7ad99b0f8b79358b58c35cca0d26315435b95d20161a99572ed1da7055a64`
