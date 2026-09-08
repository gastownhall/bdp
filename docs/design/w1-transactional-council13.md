# Transactional council 13

Status: **initial three-seat council completed and findings folded; operator choices and final-head review remain; no readiness or merge clearance**. Review requested by Donna
on 2026-09-08 after the apply completed. Initial exact head:
`ce8399c785a85e30d0d7aad78c49ea76538bde45`; full branch compared with main
`0b7d86e7cfec47f88cd1ec22314a73f39763bcf8`, incorporating #19 `06ebabd`.

## Seats and scope

- Codex: completed independent ephemeral read-only CLI review. 0 Critical,
  2 High, 6 Medium, 1 Low; six new defects and three known gaps/integration
  findings. Reproduced schema135/body240 validation and unchanged baseline
  definitions. Its probes used Node26; Janet's full gates used Node24.16.0.
- Gemini: reviewing the frozen numbered snapshot of the same head on stdin;
  no subagents or investigator delegation allowed. Its findings and recheck dispositions are recorded below.
- Claude: initial attempt returned the existing direct account's session limit,
  reporting a 16:30 Buenos Aires reset; the subsequent review at0466c1aa completed. No persistent
  provider configuration was changed and no quota reset was consumed.

No missing reviewer counts as zero findings. Corrections below are a partial
fold and need review at their own exact committed head. Runtime behavior and
conformance of either write profile remain unproved.

## Finding disposition

| Finding | Evidence and action |
| --- | --- |
| Codex High1: dependency identity unavailable at atomic admission | Confirmed: Mutation Transactions normalizes sequence labels to committed creator identities yet records every normalized identity before any member runs. **T62 OPEN**, unapplied: explicit reservation/binding state, prospective allocation, or amendment of D26's admission law. Do not hide it as an implementation detail. |
| Codex High2: snapshot completeness discloses hidden incident Links | Confirmed against shared authorization law. Corrected streams to contain the projected Links and their endpoints, preserving owned closure. Added a narrated hidden incoming/unowned Link case to the snapshot example. This is an illustrative case, not an authorization runtime test. |
| Codex Medium3: invalid retirement drops normative obligations | Reproduced path: normative filtering happened after unrestricted retirement. Selection now requires known normative target/replacement rows and a strictly higher replacement profile. Negative tests cover diagnostic, same/lower-profile and missing-target relationships; callers combine catalogs before higher-profile selection. |
| Codex Medium4: sequence matrix admits202 receipt | Confirmed: sequence has no carrier receipt. Split its matrix row:200 envelope, pending members as problems, no sequence-level202. |
| Codex Medium5: timestamp whitespace accepted | Confirmed permissive ajv-formats separator. Require T/t before full calendar/clock validation. Unit and compiled-validator regressions reject space/tab/newline and preserve lowercase input. |
| Codex Medium6: finite erasure-feed fixtures bypass fence | Confirmed under ruled T28. Three finite requests now receive410 cursor-expired and point to the existing pos47 snapshot recovery. Their erasure-bearing groups remain separately labeled committed-group examples, validated against changeGroup and existing group invariants; they no longer assert a successful finite replay. |
| Codex Medium7: advertised aliases lack TX contract | Known **T49 OPEN**, unapplied. Remains a completion blocker. |
| Codex Medium8: #23/#24 integration | Known prerequisites. No baseline definitions changed. PR24 requires a merge commit. Hosted CI is still owed: PR20 is stacked on #19 and the workflow triggers only PRs targeting main. |
| Codex Low9: no JCS recomputation in tests | Known **T57 provisional**. Independent scratch use of PR24's serializer reproduced all seven canonical strings and digests. Recommend integrating that existing serializer after #24; scratch verification is not regression coverage. |
| Janet: T56 dropped string/object admission law | Confirmed original T44 ratification covers Unicode scalar strings and no duplicate member names; #23 covers numbers only. Restored string/member-name validation and decoded-name uniqueness under malformed-request, preserving #23's numeric validation-failed rule. Marked T56 amended pending ratification. |

## Validation

Initial ce8399c: Node24.16.0 typecheck, lint, format, boundaries, build,
1518 tests/48files, existing Read evidence74rows, strict Ajv135definitions and
240exchangebodies, byte-identical schema mirrors, all26 sealed Read definitions
and all83 inherited #19 definitions source-byte identical. No TX evidence claim.

Partial fold: focused tests passed after correcting a newly authored Problem
fixture's family URI and retry tuple to the existing cursor-expired row.
Full correction-pass gates passed: typecheck/lint/format/boundaries/build,
1526 tests/48files, Read evidence74rows, strict Ajv135defs and243 bodies
(240 exchange bodies plus3 committed-group examples), schema mirrors and
both baseline definition source-byte comparisons. Further reviewer findings
and exact-head rechecks remain pending.

Gemini's initial snapshot attempt produced no findings while consuming one CPU
for about15minutes. A process sample showed sustained local string comparison
and filesystem-stat callback work. TERM did not stop the busy process; the
owned child was killed and reaped. The same frozen snapshot is being retried
with every literal at sign escaped as `[AT_SIGN]` for CLI transport, explicitly
instructing the reviewer to interpret that marker as U+0040. This preserves
line references and the intended source text; all alleged tree defects still
require local verification. The first attempt provides no review evidence.


## Completed initial seats and second correction pass

Claude completed a full-branch review at0466c1aa: reported0C/2H/6M/4L,
with T49/T57/T62 separately acknowledged as known gaps. Codex's fresh full-branch
recheck at the same head reported0C/2H/5M/3L (six new defects, four known gaps).
Gemini completed its initial escaped-snapshot review atce8399c, then a focused
correction-diff/schema check at0466c1aa. The three-seat initial pass is complete;
this is not a clean final-head council or merge clearance.

| Reviewer finding | Verified disposition |
| --- | --- |
| Codex recheck High1, owned-Link erasure successors | Corrected the source's ownedLink-only Event versus the Link's property change, using safe root replacement inside the nested Link delta. Revision change considers the full owned set. Added a complete isolated live-owned-Link erasure/correction group, with two erasure records and consistent postimages. |
| Codex recheck Medium3, minimum-position receipt reads | Added409 foreign-view and410 cursor-expired to receipt/page rows after nondisclosure, plus consistency exchanges. |
| Codex recheck Medium4, hidden-Link timeline | Moved the narrated hidden incoming Link to surviving task41, so the later successful deletion of task42 retains deletion safety. |
| Codex recheck Medium5, missing retirements | Two more rows retire the direct singleton-disposition and immediate internal-fault claim-clearing obligations; shared replay, bodyless500 and pending-execution laws remain. Twelve retirements, with matching selection checks. |
| Codex recheck Low8/9, fixture tests | Pending polling now expects200; added a pending GET. No-op tests compare against an explicit before record, including a distinct preexisting attribution. |
| Claude High1, standalone delta catalog | Kept fail-closed selection. Documented in matrices/README that a write-profile bundle's single catalog contains combined inherited rows; no bundle-model change is needed. Added an explicit shipped-TX-delta-alone refusal test; combined selection remains tested. No TX runner/manifest is claimed. |
| Claude High2, sequence allocated shape | Added sequenceAllocatedIdentity and Transactional sequence problem/envelope definitions. Constrains disclosed allocation objects and their code context, preserving all83 inherited definitions. Withheld identity projection is **T63 OPEN**, unapplied. |
| Claude Medium3, erasure delivery | **T64 OPEN**: existing caught-up SSE publication versus fencing live streams too. Finite read/reconnect expiry and snapshot-ledger obligations remain fixed. |
| Claude Medium4, sequence409 | Removed the carrier409 status: its key conflicts are member problems inside200, and it has no carrier key. |
| Claude Medium5, I-JSON admission coverage | Added the two causes to batch/sequence syntax, two raw-text negative examples, and transactional.http.ijson-strings-objects with a normative citation. There is still no write admission runtime; these are illustrative wire cases, not execution evidence. |
| Claude Medium6, erased sequence pointer | Transactional sequence problem specialization rejects pointer; positive/negative tests prove the base erased problem is valid and its pointer-bearing variant invalid. |
| Claude Medium7, own pending receipt skipped | Clarified that in-flight projection concerns a receipt owned by another execution; this carrier executes its newly admitted members under their owned receipts. T62's dependency-identity transition remains open. |
| Claude Medium8, missing rel5 digest | Added the pre-erasure rel5-r1 vector; its recomputed JCS/SHA256 matches the existing818526cf digest. Every erased key now requires a vector. |
| Claude Low9, duplicate record overwrite | Fixture scan asserts equality on repeated id/revision keys before storing them. |
| Claude Low10/11, navigation and supplied IDs | Index/status now list the review and open T62–T64. Receipt compact identity wording explicitly includes client-supplied creations. |
| Claude Low12, inherited result aggregate | Recorded preexisting Read+Update shape latitude as a follow-up. TX postimages exclude the aggregate. This pass preserves the83 inherited schema definitions as required; no new Read+Update wire narrowing was inferred. |
| Gemini initial Medium, sixth failed/expired branch | Rejected by direct parsing of both exact heads: five branches only. Gemini's follow-up explicitly retracted the claim as historical-packet confusion. |
| Gemini initial Low,422 enum | Cosmetic superset only; composed code/status constraints reject invalid direct instances. No behavioral defect and no change made. |
| Gemini follow-up Medium, finite erasure assertion too broad | Rejected against Scope changefeed: changefeedPage represents a finite JSON read; SSE frames a group, not that page. Resuming after an erasure checkpoint excludes that group. T64 records the genuinely missing live-stream rule separately, without weakening finite replay checks. |

The second correction pass adds three schema definitions (138 total), one
catalog row (114 total), two retirements (12 total), and an eighth digest
vector. The original26 sealed Read and83 Read+Update definitions remain the
baseline comparison. Full second-pass gates and a final-head review are still
required; outstanding T49/T62/T63/T64 choices prevent readiness regardless of
unit-test results.


## Second correction-pass verification

Node24.16.0: typecheck, lint, format, dependency boundaries, build and
all1533 tests in48 files pass (34.96s). Existing Read evidence verifies74rows.
Strict Ajv compiles138definitions and validates253 bodies:189Read+Update,
60Transactional exchange bodies and4 committed-group examples. Two additional
raw request texts demonstrate I-JSON rejection; they are preserved as text,
not parsed into an object that would discard duplicate-member evidence.
Both schema mirrors match, and source-byte comparisons confirm all26 sealed
Read and83 inherited Read+Update definitions unchanged. All8 erasure vectors
also independently canonicalize/hash to their recorded bytes using PR24's
existing serializer in a scratch check; integrated JCS regression coverage
remains T57.

No review or test process remains running. This second correction commit has
not received a new complete council at its exact head. T49/T62/T63/T64 are
unapplied choices and T50–T61 require ratification; a final exact-head council,
hosted CI and the operator's readiness/merge decisions remain mandatory.


## AFK review of the second correction head: Claude fold

Claude independently reviewed exact head `1eef4e439629e247e9055ef8e42045acbea66b75`
against main `0b7d86e7cfec47f88cd1ec22314a73f39763bcf8` and reported
**0 Critical, 0 High, 4 Medium, 2 Low** new findings. These findings concern
the draft artifacts; they do not select the four open operator choices.

| Finding | Verified disposition |
| --- | --- |
| Medium 1: live-successor catalog obligation contradicts the amended delta law | Corrected the specification table and catalog title together: same-group successor, property root replacement, owning-source ownedLink-only delta, and change in revision-determining durable state. Added the owning-source paragraph citation. The catalog test now compares all 114 row titles and IDs against the specification, in order, rather than comparing only IDs. |
| Medium 2: successor Event attribution differs from its postimages | Preserved the correction adding explicit attribution to both successor Event data objects and the nested Link delta. Assertions compare attribution only for matching Resource identity and revision; negative probes omit each of the three fields. A positive probe supplies earlier Events with different attribution and only final postimages, so a check cannot incorrectly compare an intermediate version with final state. These are group-shape consistency probes, not a full Event application runtime. |
| Medium 3: isolated erasure example appears to follow deleted identities | Clarified the intended independent hypothetical initial history and live endpoints. It now uses distinct scopeEpoch/authorizationView and plainly separate opaque position/checkpoint tokens. Resource IDs and digest vectors remain unchanged. Position tokens were already opaque: this clarification does not infer a numerical ordering law from pos-60 or introduce a restore/identity-reuse exception. |
| Medium 4: five-entry receipt paginates below the Scope's advertised bound | Main acme rcpt-9 now contains all five entries with next null at its existing pos-46. A separate receipt-pagination Scope advertises defaultItems/maximumItems of three and narrates its own initial live graph; it contains the five-entry transaction as a two-entry inline prefix plus a final three-entry page. Page expiry and the two page minimum-position errors moved into that scenario; non-page rcpt-7 cases remain. Tests cross-check receipt/page bounds using discovery from the same Scope and reject unnecessary pagination and over-bound inline/pages. No global limit was lowered. |
| Low 5: all-profile I-JSON law lacks a lower-profile catalog counterpart | Recorded a T56 downstream Read+Update catalog/admission obligation for integration. The inherited catalog is unchanged and the normative all-profile rule remains. This coverage gap is not declared resolved by the Transactional examples or by inventing a catalog ruling. |
| Low 6: I-JSON problems omit useful location/title | Both raw-text negative examples now carry a diagnostic title and pointer /operations/0/properties/title. The SHOULD-level recommendation is preserved. |

The corpus now has eleven Transactional JSON files: ten exchange fixtures
with 63 schema-tagged exchange bodies, four separately validated committed
group examples, and eight digest vectors. The two invalid I-JSON request
texts remain raw; parsing them would discard duplicate-member evidence.
The catalog remains 114 rows with 12 retirements. No additional definitions
or modifications to the 83 inherited definitions were made by this Claude fold.

Focused verification: the Transactional wire and catalog suites pass all 130
tests under Node 24.16.0. Typecheck passes. An initial touched-file lint pass
caught three unsafe optional chains in newly authored test helpers; they were
corrected before the passing rerun. Full gates and final committed-head review
are Janet's subsequent work, not claimed by these focused results. No write
profile is implemented or shown conformant. T49/T62/T63/T64 remain unselected;
T50–T61 remain provisional, including T56 and integrated JCS coverage T57.


## AFK Codex/Gemini dispositions and full correction checks

At `1eef4e439629e247e9055ef8e42045acbea66b75`, the Codex CLI seat returned
0 Critical, 0 High, 2 Medium and 1 Low; Gemini returned no new findings.
Codex's Event-attribution Medium overlaps Claude Medium 2 above and is fixed
with version-specific checks. Its other Medium is fixed in only the new
Transactional problem branches: cardinality-violated, event-history-expired,
and catch-up-timeout now reject diagnostics and diagnosticsTruncated.
Positive base objects and otherwise valid diagnostic mutations exercise this
guard. No inherited definition was edited. The Low no-op oracle defect is
fixed by establishing the fixture's same-value replacement from its explicit
before-state and request before checking the whole returned Resource.
Revision-only, attribution-only, and combined corruptions must fail. This
fixture-specific assertion is not an RFC 6902 implementation.

The combined author correction passed all 1,546 tests (48 files) under Node
24.16.0, including the packaged-executable preflight. Typecheck, full lint,
format and whitespace checks pass. The preceding correction build and
dependency-boundary checks passed; subsequent changes are fixtures, tests
and documents. Strict Ajv compilation covers all 138 definitions and validates
256 bodies with zero failures. Both schema mirrors are identical; exact source
byte slices of all 26 main and all 83 inherited Read+Update definitions remain
unchanged. Existing Read evidence verification still reports 74 target-row
instances at constant 5141c855420f6c7c032e513e5d072cd446275587. Those historical
Read observations establish no Transactional runtime result. The resulting
commit still needs independent council review; this record claims no clearance.


## Frozen-head final review: Codex and Gemini adjudication

Both reviews targeted `245c03e6f7730dd0780a35b336fb844a8c37ed06` against main.
Codex reported **0 Critical, 0 High, 0 Medium, 2 Low** new findings. Gemini
reported **0 Critical, 1 High, 1 Medium, 1 Low**; direct frozen-tree and staged
snapshot verification rejects its High and Low claims and retains its Medium
as the already documented contextual schema limitation. These dispositions do
not stand in for Claude's pending result or a council on a later correction
head. Preparation of the changes below used a separate detached worktree so
the reviewed head remained frozen.

| Finding | Verified disposition |
| --- | --- |
| Codex Low 1: receipt checks accept missing operation outcomes | Reproduced with failing corruption probes against the original helper. The complete page chain of a completed, available receipt must now account for every requested operation: exactly one singleton outcome, or exactly one leading matched entry plus its counted set outcomes. Disclosed set Resource identities are unique within the operation; withheld identities are not invented. Missing and cyclic pages are rejected. Probes remove a singleton/no-op result, remove or duplicate matched entries, remove or duplicate set Resource outcomes, and corrupt page continuations; a zero-match set remains valid. Pending, failed, expired and wholly withheld receipts do not pretend to carry a complete result list. |
| Codex Low 2: a fresh failed execution reuses the discarded receipt's fence | The rcpt-11 condition now explicitly places fresh execution at current head pos-48, after the earlier erasures and receipt forgetting, with no intervening commit before response. Its requiredPosition is pos-48; the old rcpt-8 remains at its original pos-43. The regression checks the fresh execution against that independent narrated observation and rejects a shape-valid copy of the original fence. No comparison or ordering of opaque token spellings is inferred. |
| Gemini High 1: missing aliases, expanded limits, binding code and diagnostic guards | Rejected. In the reviewed schema, alias targets are required at lines 3021–3022 and defined at 3047–3051; the expanded limits definition starts at 4292, includes validation at 4370 and transaction at 4382, and closes at 4422; binding-unavailable appears at 3640; diagnostic guards appear at 3718–3719, 3743–3744 and 3879–3880. Reconstructing the 4595-line staged schema after line-prefix removal and at-sign decoding produces byte-for-byte git-show output for the frozen head; both mirrors match. The snapshot was current. |
| Gemini Medium 2: erased Bead can structurally carry owned-source fields | The structural latitude is real and belongs to the existing contextual-validation boundary, not a missing wire discriminator. Normative schema bundle leaves Resource kind/ownership/result correspondence to contextual checks; Mutation Receipt responses restrict the pair to owned-Link operations. Provisional T50 deliberately retains the bare lineage marker. Added a contextual probe pairing the actual retained erasure receipt with its original batch request: a schema-valid erased Bead with source fields fails, while an erased owned Link requires its pair. No wire member or schema prohibition was invented. |
| Gemini Low 3: stray period before semicolon | Rejected. Frozen specification line 4749 already says council 12); the two set, without a period. The reconstructed staged specification matches the frozen file byte-for-byte, and neither contains the alleged punctuation. |

The schema and normative prose are unchanged by this fold. The corpus remains
11 files, 63 parsed Transactional exchange bodies, four group examples and
eight vectors; 138 definitions and the 26 Read/83 inherited definition slices
are unaffected. T49/T62/T63/T64 remain OPEN and T50–T61 remain provisional.
No runtime, conformance, readiness or merge clearance is claimed.

The low-finding correction passed 135 focused tests and all 1,551 tests in
48 files under Node 24.16.0 (34.76 seconds), including packaged executable
checks after a fresh build. Typecheck, full lint and format, and whitespace
checks pass. Strict Ajv compiles 138 definitions and validates all 256 bodies
with no failure. No schema or catalog bytes changed from the preceding
verified correction. The final committed correction still needs review.


## Claude's frozen-head final review and bounded correction

Claude completed the same `245c03e6f7730dd0780a35b336fb844a8c37ed06` review and
reported **0 Critical, 0 High, 2 Medium, 6 Low**. It independently reproduced
the 138-definition/256-body checks, byte-stable baselines, 114 TX rows and
12 retirements, and all eight canonical strings/digests. The dispositions
below distinguish actual defects, authoring clarifications, existing checks,
and inherited integration work. They do not turn every reported count into
an accepted defect or select an open ruling.

| Finding | Verified disposition |
| --- | --- |
| Medium 1 and Low 7: retirement count and unbounded bullet assertions | Confirmed stale count and test scope. Normative prose now says twelve and includes direct-disposition replay and immediate internal-fault claim clearing in its enumeration. The catalog test bounds both rows and retirement bullets to the Transactional subsection, compares the exact count, and checks the stated count word. No retirement policy or catalog row changes. |
| Medium 2: hypothetical erasure example reuses acme identities | Strengthened namespace isolation rather than declaring an exception to the permanent ledger. The standalone committed-group example now explicitly carries canonical Scope https://beads.example/owned-erasure/ in its fixture metadata; all protocol Resource/Event URLs in that example and the two before-record vectors use that Scope. The HTTP exchanges retain their fixture's acme Scope. Scope-aware assertions verify the override, and the two digests were recomputed with PR24's existing serializer. Epoch/view distinctions alone are not used as erasure-ledger isolation. The initial history is still an illustration, not a claimed sequence of executed states. |
| Low 3: raw I-JSON examples unasserted | Confirmed coverage gap. Fixture typing and probes now require exactly the two bodyText exchanges, well-formed JSON, absent parsed body/schema, and the intended lone-surrogate or duplicate-decoded-name fault at the supplied pointer. Repairing either fault makes its illustration probe fail. The small authored-example checker is not an I-JSON admission implementation or conformance evidence. |
| Low 4: empty available receipt | Accepted only for an empty terminal receipt. The completed/available schema branch requires at least one result when next is null. The existing text permits a non-maximal prefix and does not rule out an empty prefix with continuation; that structural latitude is preserved and explicitly tested. No unconditional minItems was added to receiptCore or the available branch. The complete-chain/request correspondence checks from the Codex fold still require every operation's outcome. |
| Low 5: missing snapshot inline/first-class agreement check | Rejected as an exact-tree claim: expectClosedSnapshot already builds linkById and checks every inline owned Link for presence and member-for-member equality. Added a nonvacuous positive graph and two corruptions (missing first-class Link and disagreeing properties), both rejected by the existing helper. No duplicate agreement implementation was added. |
| Low 6: administrative attribution rule allegedly inferred by the probe | The probe compares exact-version Event/postimage attribution; it does not prescribe attribution for all administrative writes. The example now explicitly narrates that this administrative writer supplied agent:erasure-administrator for the two successor versions, matching the existing claimed meaning and differing from the old agent:planner value. It invents no administrative API or universal policy. A positive probe omits attribution consistently from Events and postimages and still passes; one-sided omission remains a consistency error. No additional ruling was inferred. |
| Low 8: inherited RU title wording differs | Recorded for #19 integration audit. The reviewed RU catalog is byte-inherited, and different title wording alone does not establish semantic drift from its cited obligation. Reconcile any verified semantic difference and decide whether exact title equality is the intended RU authoring convention during integration; do not blanket-rewrite 77 inherited titles or imply that all are wrong. |

The two moved vector digests are 9c1e-r1
`5e34ceb5dabdca08822ee32862214e9c92de6c2c395fc63964c97fded50030a3`
and dec-9-r2
`84d844516ff305e9ad934aa120bbbcfd0d4faec51c7e1e5fe3d0f3da07cc2051`.
All eight vectors were independently re-canonicalized and hashed using
PR24's existing serializer in scratch execution; integrated coverage remains
T57. The corpus stays at 11 files, 63 exchange bodies, four group examples,
and eight vectors. The bundle stays at 138 definitions; no inherited Read or
Read+Update definition was edited. Final gates and review of the eventual
committed correction remain separate from these focused checks.
T49/T62/T63/T64 remain OPEN; T50–T61 remain provisional.


Focused validation of this correction: Node 24.16.0 passes all 150 tests
across Transactional wire, schema-bundle, and Transactional catalog suites,
plus typecheck and touched-file lint/format. Strict Ajv compiles 138 definitions
and validates all 256 parsed bodies with zero failures. Both schema mirrors
match; source-byte comparisons against main and inherited #19 confirm all
26 Read and 83 Read+Update definitions unchanged. An initial lint pass caught
an unsafe optional chain in the new snapshot probe; it was corrected before
the passing rerun. Full-suite verification was deliberately left to the
integrating Janet session; no later-head council result is claimed here.

The driver verified the completed fold with all 1,555 tests in 48 files
under Node 24.16.0 (35.63 seconds), full lint/format, and the existing Read
evidence verifier (74 historical target-row instances). The preceding build
remains current for unchanged runtime sources; focused typecheck/strict Ajv
and definition-byte comparisons passed after the schema correction. All
eight vectors independently match PR24's existing canonical serializer and
SHA-256, including both rewritten Scope identities. Final correction-head
reviews are still required. Claude is unavailable until its reported 21:30
Buenos Aires session reset; the missing review is not a clean seat.
