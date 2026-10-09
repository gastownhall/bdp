# Type design council — October 8, 2026

Status: both independent reviews complete, findings dispositioned, and focused
Codex recheck of corrected core text complete. Coherent design draft; not an
implementation-ready or adopted specification, and not release acceptance.

## Scope and provenance

Donna requested a complete write-up of the current positions, including Types as
Beads, followed by a Codex + Claude council. Gemini was omitted at her request
because it was unavailable. No substitute third reviewer was used.

Both reviewers received the same core prompt and reviewed committed snapshot
`659bc85e3931f934db7a4642c1ea6a9a04ce1c7c` independently before seeing the other's
findings. Codex ran through native delegation; Claude ran through the installed
CLI in read-only review mode, with no model override. Inputs were the complete
Type design, decision packet and proposed glossary, with focused canonical BDP
crosschecks. The prompt explicitly distinguished shared decisions from open
mechanisms and a publishable design draft from an implementation-ready spec.

| Input | SHA-256 at reviewed snapshot |
| --- | --- |
| docs/design/type-lifecycle-preview2.md | f92b6c3184b179054e7d05ca8f0e8bcb3ef4f305c6c14c3f4cbf247a68203577 |
| docs/design/type-preview2-decision-packet.md | a04f51c6e40ddac23fa6d4e3b5eb10bd8d4687739c6458a47ef54a1adc69a288 |
| CONTEXT.md | f48ce54a46a09b7283c1b469a6829b9263895af301e0b8e7eab862a83f7b45bf |

The source baseline was canonical BDP main
`182f1fcf8a01d896976bff3c9e3fb87c596c6ca6`. Beads evidence was refreshed to
integration `356275a13290064fe903ace31984c14d1b9f7ad4` and CLI PR102
`94d880d4b7bdb87468281c1a7453b94387aacb2e`; this was targeted source inspection,
not runtime qualification. Neither reviewer was asked to implement anything.

## High-confidence findings

No substantive issue was independently flagged by both reviewers. Codex found no
substantive issues in the initial snapshot. Claude judged it publishable as a
design draft conditional on clarifying F1 and F5; it also raised eight other
findings and three minor notes. Both distinguished that from implementation
readiness or adopted normative status. Agreement on the publication boundary is
not agreement on every issue or product approval.

## Single-reviewer findings and dispositions

Claude completed through the external CLI with exit status 0. Its
[complete review](type-preview2-claude-20261008.md) is preserved as reviewer opinion,
including assertions and recommendations disputed below.

| Finding / review severity | Disposition |
| --- | --- |
| F1 / Critical — contract sets versus stored populations | Clarified: compatibility quantifies over all contract-permitted instances in every deployment, including empty stores. T35/table now say a permitted counterexample disqualifies the successor. The set-equality consequence was already explicit and is reinforced. Reject the overbroad claim that every constrained field addition is necessarily breaking: earlier schemas may already constrain that extension space; schema spelling is not the accepted set. No publisher-reserved narrowing exception is adopted. |
| F2 / High — declared family versus trusted qualification | Added the distinction among designation, actual obligation satisfaction and accepted evidence; T26 now includes matching and graph validity on withdrawal. Declared-membership versus trusted-contract predicate is explicitly D05/D06. Do not adopt Claude's proposed immutable declared-partition policy without Donna's ruling. |
| F3 / High — consumer obligations | Clarified guarantee 2 expressly includes continued correctness of earlier conforming consumers under their earlier obligations. A schema-preserving change requiring them to reject tolerated data or reinterpret meanings fails T43. This develops the existing semantic guarantee; it does not add an independently chosen third mechanism. Recognizing a formerly unknown key need not contradict an obligation to ignore keys that remain unknown. |
| F4 / High — read projection dependencies | Clarified complete-record traversal versus construction/reconstruction. Exact definitions or sufficient retained projection evidence may be needed for ownedLinks reconstruction; a reader of materialized records need not fetch definitions. Added T46 and Read-profile/ownedLinks amendment surfaces. Reject the broad claim that generic traversal itself always requires definitions. |
| F5 / High — floating selection resolving to the existing pin | Fixed ambiguous no-op wording. Resolution/validation occurs; no new affiliation state results when the exact pin is unchanged. With all durable state unchanged, no new revision/event arises merely from explicit selection. Added T44 and revision/no-op/expectedRevision reconciliation. |
| F6 / High — metatype artifacts and engine capability | Distinguished possessing an exact metatype artifact from implementing its semantics. Added bootstrap addressability/retention/packaging decisions and unsupported-metatype T45. Reject the exclusive resource-versus-capability framing: both conditions can be required. No concrete problem code or automatic executable installation is selected. |
| F7 / Medium — authorization visibility | Added intrinsic affiliation's absence from owned-Link authorization-view closure, caller visibility versus provider validation access, and T46 coverage. Definition/instance visibility policy and unavailable outcomes remain open. Do not automatically grant every instance reader access to all definition content. |
| F8 / Medium — saved selectors | Added T47 for retrieval and set mutation, exact-selector versus dedicated-filter precedent, and representation-dependent transition obligations. Widening the discriminator can break comparisons, but a separate version field might preserve the identity string; no wire shape is assumed or chosen. |
| F9 / Medium — normative publication vehicle | Added v0's existing follow-on-specification pointer and an explicit amendment/successor/companion publication decision with conformance boundaries. Reworded the future ledger action to make clear no Type-evolution entry currently exists. The earlier text said add or reconcile, not that such an entry already existed. Either vehicle must reconcile changed baseline rules. |
| F10 / Medium — migration cost and primitive | Added retained-version/changefeed/replication and owned-source amplification, plus bounded/resumable planning, ordering and partial-result decisions. No bulk engine is selected and publication does not require migrating every instance. The stronger claim that every structural edit forces a whole-population job is not accepted. |
| Minor — glossary legacy scope | Scoped the affiliation definition to the proposed new model; legacy absent pins remain explicit in the main document. |
| Minor — enum-removal table | Clarified preservation of the remaining values' old guarantees when meaning is otherwise unchanged; old-data acceptance still fails. |
| Minor — URI terminology | Used identity-URI terminology for proposed placement/location decisions; no change to canonical v0 identity syntax is inferred. |

## Suggested updates and disagreements

All accepted editorial corrections are in core-document commit
`ee2acae5772c8d151122b3ec269b29f0f2992a77`. No finding is silently dismissed:
rows above distinguish fixes, overstatements rejected and policies left to Donna.
Priority was F1/F5 (unambiguous already-agreed rules), then consumer/read/metatype
coverage, then authorization/selectors/publication/operational consequences.

The reviewers disagreed in assessment: Codex found no substantive issue in the
initial snapshot; Claude found the ambiguities above. They did not propose two
competing concrete implementations. The synthesis accepts useful clarifications
without treating every claimed impossibility or suggested policy as true.

Claude has not re-reviewed the corrected revision. A focused native Codex recheck
of the corrected core snapshot completed without substantive findings, as recorded
below. This limitation must accompany any claim about final-review coverage.

## Verification and acceptance boundary

Initial snapshot checks passed: 12 unique D IDs, 42 unique T IDs, local links/fences,
links into rewritten anchors and whitespace. Acceptance cases are not runtime
tests. This council is not product, Review Team or release-owner acceptance.
The canonical spec, schema and runtime are unchanged.

## Codex review — complete response

No substantive findings at reviewed commit `659bc85e3931f934db7a4642c1ea6a9a04ce1c7c`.

The consolidated design consistently preserves exact structural and semantic meaning, both family compatibility guarantees, explicit adoption, stable nominal identity, and the distinctions between affiliation, contract satisfaction and conformance. Its extension example preserves both guarantees; its connected Link, ownership, retention, bootstrap and installation scenarios appropriately identify unresolved decisions without inventing rulings.

**Coherent publishable DESIGN DRAFT:** Yes, subject to the stated acceptance of its bounded scope and explicit deferrals. This review does not establish release acceptance.

**Implementation-ready or adopted normative specification:** No. The recorded addressing, matching, admission, graph-integrity and lifecycle decisions remain open, and the canonical specification has not been amended.

## Codex focused recheck — complete response

No substantive findings in the focused recheck of commit
`ee2acae5772c8d151122b3ec269b29f0f2992a77`.

The corrections clarify contract-wide compatibility and floating-selection no-ops
without weakening either compatibility guarantee. The added reader, capability,
authorization, selector and migration explanations preserve explicitly open
decisions; I found no accidental new product rulings or contradictions.

**Coherent publishable DESIGN DRAFT:** Yes, subject to its stated scope and
publication approvals.

**Implementation-ready or adopted normative specification:** No; the documented
decisions and normative reconciliation remain outstanding.

## Corrected core artifacts

The final report/evidence commit adds the review record and removes one blank
line that split the acceptance table; that formatting-only correction was checked
after the native recheck. No design prose changed after that recheck. Final
document checks cover 12
unique decision IDs and 47 unique acceptance IDs, links/anchors/fences and whitespace.

| Corrected core artifact | SHA-256 |
| --- | --- |
| docs/design/type-lifecycle-preview2.md | fc6cc250d1f0439ddb4ff6711536c8887d3817723d8491b71cc76c70a23a6ede |
| docs/design/type-preview2-decision-packet.md | 785a765b74ca124b0d536f68c411dbd05749d67ce4cef747e751174f912af6c8 |
| CONTEXT.md | 807aef5611bfbf375fedc7b670b02bc4650601035726aafc87695a1ca6010313 |
