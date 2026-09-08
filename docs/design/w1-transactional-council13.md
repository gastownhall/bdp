# Transactional council 13

Status: **incomplete; no readiness or merge clearance**. Review requested by Donna
on 2026-09-08 after the apply completed. Initial exact head:
`ce8399c785a85e30d0d7aad78c49ea76538bde45`; full branch compared with main
`0b7d86e7cfec47f88cd1ec22314a73f39763bcf8`, incorporating #19 `06ebabd`.

## Seats and scope

- Codex: completed independent ephemeral read-only CLI review. 0 Critical,
  2 High, 6 Medium, 1 Low; six new defects and three known gaps/integration
  findings. Reproduced schema135/body240 validation and unchanged baseline
  definitions. Its probes used Node26; Janet's full gates used Node24.16.0.
- Gemini: reviewing the frozen numbered snapshot of the same head on stdin;
  no subagents or investigator delegation allowed. Findings pending.
- Claude: initial attempt returned the existing direct account's session limit,
  reporting a 16:30 Buenos Aires reset. No substantive review yet. No persistent
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
