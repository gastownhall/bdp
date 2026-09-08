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
