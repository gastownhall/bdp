# Preview 2 Type design — decision packet

Updated October 8, 2026. Owner: Trish. Product decisions: Donna.
Plan of record: [BDP #59](https://github.com/gastownhall/bdp/issues/59).
Delivery: [PR60](https://github.com/gastownhall/bdp/pull/60).
Release coordination: [Preview 2 #7170](https://github.com/gastownhall/beads/issues/7170).

## Complete design for review

Read [Versioned Types as Beads](type-lifecycle-preview2.md). The consolidated
write-up replaces the accumulating dated narrative with one model:

- Types are represented by Beads, including definitions whose instances are Links.
  A distinguished intrinsic affiliation field and finite built-in metatype bootstrap
  avoid replacing affiliation with Links. Exact bootstrap and administrative policy
  remain open.
- Stable nominal identity, resource revision, exact Type definition and major-version
  family have separate meanings. Exact definitions freeze structure and semantics.
- Stored new-model affiliations are exact. Explicit floating write selections resolve
  to exact pins; omitted update selections preserve the current pin. Properties and
  explicit Type adoption commit together or neither. Affiliation-only changes are
  observable resource state.
- A major family guarantees both that old data remains valid without transformation
  or reinterpretation and that new instances honor earlier consumers' structural
  and semantic guarantees. SemVer is the candidate designation; exact encoding,
  claim evidence/enforcement and cross-major behavior remain open.
- Authors can design extension points with open records, optional fields and explicit
  tolerance rules. The document gives both a compatible extension example and cases
  that violate one of the two promises.
- Nominal filters, contract satisfaction, exact affiliation, conformance, endpoint
  requirements and ownership are distinct. Compatibility does not silently decide
  matching, graph repair or independent Scope policies.
- Installation, defaults, adoption, deactivation, erasure, migration and packaging
  are separate actions, with a BDP/Beads ownership boundary and explicit open choices.

There are 12 decision areas and 47 acceptance cases. These are design examples,
not executed tests. The ready/NYI table distinguishes source observations from
proposed behavior. Canonical BDP and Beads runtime are unchanged.

## Remaining decisions with the widest consequences

| Area | Agreed direction | Still needed |
| --- | --- | --- |
| D01–D04 identity and definition closure | Types-as-Beads model, exact immutable meaning, intrinsic affiliation | Bootstrap and placement, exact cross-authority addressing, legacy pins, dependency representation and admission |
| D05 compatibility | Both structural and semantic guarantees within a major family | Family/label binding, evidence, authority, enforcement and false-claim handling; relationship to conformance |
| D06 graph integrity | Type adoption must account for applicable relationship/ownership obligations | Contract versus exact matching, historical state, affected-resource checks, profile-specific repair/refusal and source guards |
| D07–D08 installation and update | Publication leaves instances alone; adoption explicit and atomic per resource | Installation admission, defaults, floating resolution granularity and replay binding |
| D09–D10 removal and migration | Preserve historical meaning; separate deactivation from destruction | Operation outcomes, retention/erasure exceptions, cross-major adoption, bulk/rollback boundaries |
| D11–D12 packaging and surfaces | Exact portable meaning; CLI/storage realization belongs to Beads | Shared interchange scope, trust, wire/events/query forms and old-client behavior |

No open row authorizes implementation. Donna supplies product rulings; Trish
records them in #59; Janet and the CLI owner reconcile release and interface seams.

## Review evidence

The October 4 [initial council record](type-preview2-review.md) and earlier October 8
[brittleness map](type-brittleness-map-20261008.md) are historical. They did not
review this complete consolidated write-up. A fresh Codex + Claude council reviewed the consolidated snapshot; Gemini was
omitted at Donna's request because it was unavailable. Findings, corrections and
final-review limits are in the [October 8 council record](type-preview2-council-20261008.md). Review does not
constitute product or release acceptance.

## Monday October 12 candidate

The mandatory artifact is the reviewed, publishable Type specification/design
draft, including the settled model, explicit dispositions/deferred boundaries,
examples, ready/NYI table and one authoritative BDP home. Implementation remains
optional and requires a separately approved slice. The graph CLI gate is separate.

A settled specification requires every included behavior to have one expected
outcome and all D01–D12 decisions to be resolved or explicitly deferred within an
accepted publication scope. Source and review evidence must identify the frozen
commit; CLI and release owners must acknowledge that candidate. The prior request
for an October 4 initial review was met with the earlier draft; October 9 review
and October 12 freeze remain proposed checkpoints, not booked commitments.

This rewrite is ready for design review. It is not yet a wire-complete,
implementation-ready contract. Publication as a bounded design draft may retain
open mechanisms if Donna and the release owner accept that scope. An adopted BDP
amendment additionally requires aligned canonical prose/schema, fixtures,
conformance surfaces and client transition behavior. Document presence alone does
not discharge the release gate.

## Source and work boundaries

October 8 remote refresh: BDP main `182f1fcf8a01d896976bff3c9e3fb87c596c6ca6`,
pre-rewrite PR60 `7b6c959c4f8739adc8b2659c86a3caed694b1429`, Beads integration
`356275a13290064fe903ace31984c14d1b9f7ad4`, CLI PR102
`94d880d4b7bdb87468281c1a7453b94387aacb2e`. Targeted Type catalog/reader/reference
inspection still shows fixed initialization and arbitrary installation NYI.
This is source evidence, not fresh runtime qualification.

No graph CLI PR102, manual playground, shared database or Jim's History work was
edited. Runtime architecture tracker [Beads #7403](https://github.com/gastownhall/beads/issues/7403)
is a coordination reference; Vickie's earlier Type-first questions are deferred
following the Rust BDP client/CLI/packs direction. They do not block this write-up.
