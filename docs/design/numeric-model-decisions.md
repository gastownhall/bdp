# Numeric-model decisions

This packet records every judgment taken while transcribing the numeric
model — the operator's ruling of 2026-09-08, recorded at
[gastownhall/bdp#21](https://github.com/gastownhall/bdp/issues/21#issuecomment-5586406564)
— into `docs/specs/bdp.md` (Revisions, Property-change values, Validation
and results, the Numeric-model conformance rows, and ledger entry 17),
`docs/design/requirements.md` (PROTO-016), `fixtures/numeric-model/`, and
`packages/conformance/catalog/numeric-model-v1.json`.

The ruling fixed four things: equality under RFC 6902 Section 4.6 is over
exact decimal values, so `1.0`, `1`, and `1e0` are one value and
`9007199254740993` and `9007199254740992` are two; an authority refuses at
admission any number literal whose exact decimal value does not round-trip
through IEEE 754 binary64 unchanged — RFC 7493's interoperability rule
made mandatory — with a `validation-failed` diagnostic naming the member,
so that on every admitted value the exact-decimal and binary64 models
agree and no two conforming peers can disagree about a no-op; a token
scheme declares its number model by name, `sha256-jcs` meaning RFC 8785
serialization with numbers as binary64, exact over admitted values by
construction; and conformance vectors for the round-trip rule and for
`1.0`, `-0.0`, `1e300`, and an integer past 2^53. Those points are
transcribed, not decided. What follows is the remainder: each detail the
ruling did not fix, with the conservative choice applied in the draft and
the artifacts that depend on it. A ruling that departs from a
recommendation is applied by editing the quoted specification sentence,
the fixture vector, and the catalog row together.

The lockstep tests (`packages/protocol/src/numeric-model.test.ts`,
`packages/conformance/src/numeric-model-catalog.test.ts`) check vector
and citation consistency — the round-trip rule, implemented in a few
lines with the exact side kept exact, admits and refuses every vector as
pinned; the same-value groups share one RFC 8785 form and one
`sha256-jcs` digest; the sealed Read artifacts carry no inadmissible
literal; every catalog citation still appears in its anchored section;
and the catalog mirrors the specification's row table in order. They
inspect none of the behavior: no authority admitted or refused a literal,
and a green run establishes only that the artifact families still agree
on what they say.

Nothing in this packet is a conformance claim. No manifest, fixture
realization, runner, or evidence exists for any numeric-model row;
`claimEligible` remains `false` everywhere, and the sealed Read cohort is
untouched.

Decisions are numbered in dependency order: what a literal denotes, then
the rule itself, then where it applies, then the vectors and rows, then
where the text lives, then evidence, runtime, data, and merge posture.

---

## NM1 — Signed zero: `-0.0` denotes zero and is admitted

**Context.** The ruling lists `-0.0` among the vectors without saying
which way it goes. Under the exact-decimal model a literal denotes a
decimal number, and decimal numbers have no signed zero; under binary64,
`-0.0` converts to negative zero, which RFC 8785 serializes as `0`
(Appendix B, "Minus zero"). So the round trip is `-0.0` → `-0` → `0`, and
the question is whether `0` "is the same value" as `-0.0`.

**Options.**

1. `-0.0` denotes zero. Its exact decimal value is 0, the same as `0`,
   `0.0`, and `-0`; the round trip yields `0`, a literal of the same
   value; so `-0.0` is admissible, and a write replacing `0` with `-0.0`
   is a no-op. A `sha256-jcs` token serializes every one of these as `0`.
2. Treat the sign as part of the value: `-0.0` is a different value from
   `0`, and since the round trip yields `0` it does not round-trip and
   is refused.
3. Admit `-0.0` as a distinct value. Impossible under the ruling: two
   admitted values that binary64 cannot distinguish would let peers
   disagree about a no-op.

**Recommendation.** Option 1. It is what "exact decimal value" means, it
agrees with RFC 8785's own serialization of negative zero, and it is the
conservative choice for peers: a store that keeps doubles cannot tell
`-0` from `0` after canonicalization and does not need to. Option 2 would
refuse a value on a representation artifact, and refuse one that RFC 8785
serializes without complaint.

**Depends on this decision.** Under *Revisions*: "`-0.0` denotes zero, is
admissible, and is the same value as `0`". Fixture: same-value group
`zero` (`-0.0`, `0`, `0.0`, `-0`; serialized `0`). Test: `exactDecimal`
returns `0` for every spelling of zero, sign discarded. Row
`read-update.numeric-model.same-value-no-op`.

## NM2 — The round-trip rule, precisely

**Context.** The ruling says "does not round-trip through IEEE-754
binary64 unchanged". Three details fix what that means: how the decimal
is converted to binary64, how the binary64 is serialized back, and what
"unchanged" compares.

**Decision, as stated in the draft.** A literal is admissible if and only
if converting its exact decimal value to the *nearest* binary64 value and
serializing that value back in its *shortest round-trip form* yields a
literal denoting the *same exact decimal value*.

- *Nearest* is IEEE 754 round-to-nearest, ties-to-even — the default
  rounding of every correctly rounding parser (ECMAScript
  `StringToNumber`, Go `strconv.ParseFloat`, Rust, Python). The vectors
  include an exact tie, `9007199254740993`, which lands on `2^53` under
  ties-to-even and on `2^53 + 2` under ties-away; either way the result
  serializes to a different value, so the tie rule cannot change an
  admission outcome for a literal that is not itself the shortest form
  of one of the two neighbours.
- *Shortest round-trip form* is ECMAScript `Number::toString` (ECMA-262
  Section 7.1.12.1 with its Note 2), which RFC 8785 Section 3.2.2.3
  adopts and which `JSON.stringify` implements: the fewest significant
  digits that read back as the same binary64, the closest such digits on
  a tie. The rule compares *values*, not spellings, so the form's
  exponent notation (`1e+300` for `1e300`) is irrelevant.
- *Unchanged* means the exact decimal value denoted by the serialized
  form equals the exact decimal value denoted by the literal. `0.1` is
  admissible even though no binary64 is exactly one tenth, because the
  nearest binary64 serializes back to `0.1`; `0.10000000000000000555` —
  the same binary64 spelled more exactly — is refused, because that
  binary64's shortest form is still `0.1`, a different value.
- A literal with no finite nearest binary64 (`1e400`, RFC 7493's own
  example) is refused: there is nothing to serialize back.

**Why the rule is robust to parser latitude.** The shortest round-trip
form of any binary64 has at most 17 significant digits, and ECMAScript
guarantees correctly rounded conversion up to 20; a literal with more
than 17 significant digits therefore can never equal a shortest form and
is refused whatever binary64 a permissive parser picks. Admission is
decided identically by every conforming engine.

**Depends on this decision.** The whole *Revisions* paragraph. Fixture
`rule` member; groups `one`, `ten-to-the-300`; admitted `0.1`, `5e-324`,
`1.7976931348623157e308`; refused `0.10000000000000000555`, `1e400`. Test
functions `exactDecimal`, `binary64Form`, `isAdmissible`. Row
`read-update.numeric-model.round-trip-admission`.

## NM3 — Depth and carriers: any depth, whole documents and patch values alike

**Context.** The ruling says "any number literal" and "naming the member".
It does not say whether nested arrays and objects are covered, whether a
literal arriving as a Property Change `value` is covered as well as one
arriving in a creation's whole `properties`, or how the member is named.

**Options.**

1. Every number literal anywhere within the admitted `properties`
   document, at any depth, whether the document is supplied whole at
   creation or assembled by applying a Property Change; the diagnostic
   names the offending member by its JSON Pointer within `properties`
   (the write profiles' `instanceLocation`), one entry per offending
   literal within the advertised diagnostic bounds, in document order.
2. Top-level members only. Leaves nested literals to disagree between
   peers — exactly the disagreement the ruling closes.
3. Whole documents only, not patch values. A patch is how most literals
   arrive; the resulting `properties` is what the no-op law compares.

**Recommendation.** Option 1. The no-op law compares the complete
resulting `properties` value, so the admission rule must cover everything
that value contains, however it got there.

**Depends on this decision.** Under *Revisions*: "a `properties` document
— supplied whole or through a Property Change — that contains an
inadmissible literal at any depth". Under *Property-change values*: the
pointer sentence. Fixture document `nested-refusal` (offending
`/history/0/count`). Test: `numberLiterals` reports each literal with
its JSON Pointer. Row `read-update.numeric-model.nested-refusal`.

## NM4 — Scope: `properties` documents; protocol-owned numbers and Selector literals

**Context.** Number literals also occur outside `properties`: in
protocol-owned members (`max`, `limit`, `cardinality`, a Problem's
`status`) and in Selector expressions.

**Options and recommendation.**

- *Protocol-owned members.* The bundle already constrains every one of
  them to a JSON Schema `integer` of bounded range, and every such value
  round-trips; nothing to add. The draft states the rule over
  `properties` documents, where the open object admits any JSON.
- *Selector literals.* `$[?@.properties.count == 9007199254740993]` is a
  Read-profile request. Under the exact-decimal model that literal equals
  no admitted stored value, while a double-comparing implementation would
  match `9007199254740992` — the divergence the ruling closes on the
  write side reappears on the read side. **Not applied; proposed for
  ruling:** treat a Selector containing an inadmissible number literal as
  an invalid Selector, rejected like the grammar and byte-bound
  rejections whose Problem mapping the Read plan deliberately leaves
  unassigned. That keeps the closed Read problem table closed and admits
  no double-vs-exact divergence. The alternative — compare under exact
  decimals so the literal matches nothing — is silent and forces every
  implementation to keep exact decimals in its Selector evaluator. The
  Read cohort is sealed, so this is a ruling for the operator, not a
  transcription.

**Depends on this decision.** Nothing in the draft beyond the phrase
"a `properties` document". If the Selector proposal is ruled, one
sentence under *Collection retrieval and selection* and a row.

## NM5 — The vectors

**Context.** The ruling named `1.0`, `-0.0`, `1e300`, an integer past
2^53, and "a conformance vector for the round-trip rule". The brief added
a 20-significant-digit decimal and the expanded form of `1e300`, which
the issue itself asked about.

**Decision.** `fixtures/numeric-model/numeric-model.json` carries, as
JSON strings so their spellings survive parsing:

- *Same-value groups*, each with the RFC 8785 form every member shares:
  `one` (`1.0`, `1`, `1e0` → `1`); `zero` (`-0.0`, `0`, `0.0`, `-0` →
  `0`); `ten-to-the-300` (`1e300`, `1E300`, `1e+300`, the 301-digit
  expansion → `1e+300`).
- *Admitted boundaries*: `9007199254740992` (2^53 itself — the boundary
  is representability, not magnitude), `9007199254740994` (only the odd
  integers past 2^53 fail), `0.1`, `5e-324` and `1.7976931348623157e308`
  (RFC 8785 Appendix B's smallest and largest).
- *Refused*, each pinned with what binary64 would have made of it:
  `9007199254740993` (→ `9007199254740992`), `1.2345678901234567891`
  (twenty significant digits → `1.2345678901234567`),
  `0.10000000000000000555` (→ `0.1`, NM2), `18446744073709551615`
  (2^64 − 1, the integer RFC 7493 says to carry as a string →
  `18446744073709552000`), `1e400` (no finite binary64), and
  `3.141592653589793238462643383279` (RFC 7493's precision example).
- *Documents*: `admitted-document` and `respelled-document` — one
  `properties` value written two ways, members reordered — with the RFC
  8785 bytes and the `sha256-jcs` digest they share
  (`568aed678286bda489e6e819595bdbde671e32c1a709fcbdc40c9ad00f8d8ef0`),
  and `nested-refusal`, refused at `/history/0/count`.

The digest is the lowercase hex SHA-256 of the RFC 8785 UTF-8 bytes; the
token encoding a scheme applies to that digest is the scheme's own, and
BDP names none.

**Depends on this decision.** The fixture and the protocol test, which
pins every serialized form by hand and asserts it against the runtime.

## NM6 — Rows: profiles, identifiers, and the token row's applicability

**Context.** The ruling's consequences say "a row in the validation
diagnostics". Those rows live on the Read+Update wire draft
(`janet-w1-read-update-wire`, the `read-update.validation.*` table),
which this transcription does not edit. The rows therefore go in a small
catalog of their own, in the shape the owned-wildcard rows use.

**Decision.** Four normative rows, each prefixed by the lowest profile
that can observe it:

- `read-update.numeric-model.same-value-no-op`,
  `read-update.numeric-model.round-trip-admission`, and
  `read-update.numeric-model.nested-refusal` require mutation and are
  `read-update`.
- `read.numeric-model.declared-token-model` is `read`: a content-derived
  token is served on every read, and a target that declares `sha256-jcs`
  can be checked by recomputing the digest over the RFC 8785 bytes of
  the served record. The declaration itself is out of band — BDP has no
  wire member naming a token scheme, and revisions stay opaque to
  clients — so for a target declaring no content-derived scheme the row
  is honestly not applicable, recorded the way the sealed cohort records
  capability-gated rows. The row does not make revisions
  content-derived; it binds the obligation on schemes that are.

**Follow-up for the Read+Update wire PR.** When that draft merges, its
`validation-failed` cause list should add "a number literal that does not
round-trip through binary64, under Revisions", and either its rows table
absorbs `read-update.numeric-model.round-trip-admission` and
`read-update.numeric-model.nested-refusal` or this catalog stays beside
it; the citation tests hold either way.

**Depends on this decision.** The row table under *Normative conformance
matrix*, the catalog, and the catalog test's profile-prefix assertions.

## NM7 — Where the rule is stated; no bundle change, no keyword

**Context.** The brief asked for one paragraph in the data model beside
the equality/no-op law, and for any keyword need to be proposed rather
than applied to the sealed-cohort-reachable definitions.

**Decision.**

- The normative home is one paragraph under *Revisions*, immediately
  after the sentence that states the no-op law, because it defines the
  equality that sentence uses.
- Two one-line pointers keep the restatements coherent: *Property-change
  values* (the wire section restates the no-op law and is where the
  literal arrives) gains "Number equality in that comparison, and the
  admissibility of every number literal a change carries, are defined
  under Revisions"; the *Validation and results* checklist's
  "Type and properties-schema constraints" bullet gains "and the
  admissibility of every number literal under Revisions". Both are
  cross-references, not second statements; either can be dropped without
  loss of meaning.
- `docs/design/requirements.md` gains PROTO-016 so the reference
  implementation's requirement ledger carries the obligation the catalog
  cites, as PROTO-015 does for the wildcard.
- The bundle is untouched. `properties` is `{ "type": "object",
  "additionalProperties": true }`, and JSON Schema has no keyword for
  "round-trips through binary64"; a custom annotation keyword would be
  unenforceable by generic validators and would change a definition the
  sealed cohort's schema digest reaches. **Proposal: no keyword.** The
  rule is prose plus the write profiles' `validation-failed` diagnostic,
  whose existing shape already carries it — `type` and `schemaLocation`
  absent (it is not a Type-contract failure), `instanceLocation` the
  JSON Pointer within `properties`, `message` naming the literal.

**Depends on this decision.** The three specification edits, PROTO-016,
and the catalog's four anchors (`#revisions`, `#property-change-values`,
`#validation-and-results`, `#protocol-requirements`).

## NM8 — Evidence posture: the sealed Read cohort is untouched

**Context.** The brief asked whether any Read fixture at the pin contains
a non-round-tripping number.

**Finding.** A scan of every number literal in the sealed Read artifacts
at `0b7d86e7` — `packages/conformance/catalog/read-v1.json` (1 literal),
`packages/conformance/matrices/read-v1.json` (225),
`packages/conformance/fixtures/read-reference-v1.json` (108),
`packages/conformance/fixtures/read-bdpbd-v1.json` (64),
`fixtures/reference-domain/reference-domain.json` (1),
`docs/design/evidence/read-cohort/read-v1.json` (443), and
`schemas/bdp-v0.schema.json` (31) — found 873 literals and none that
fails the round-trip rule. The sealed cohort's fixtures, manifest,
catalog, artifact, and schema binding are unaffected; no bundle
definition changed, so the cohort's `bindings.schema` digest still
matches.

**Decision.** The protocol test asserts that finding over the same
artifacts, so a future fixture literal that does not round-trip fails a
test instead of silently making sealed evidence non-portable.
`STATUS.md` records the posture in one sentence. Nothing is claimed.

**Depends on this decision.** The last case of
`packages/protocol/src/numeric-model.test.ts`; the `STATUS.md` sentence.

## NM9 — Runtime lag: no implementation realizes the admission check

**Context.** `bdptest` and `bdpbd` implement the Read profile only and
have no mutation target, so there is nowhere to refuse a literal. The
reference stack parses with `JSON.parse`, which erases spelling: after
parsing, `9007199254740993` and `9007199254740992` are one double.

**Decision.** No implementation change in this transcription. The check
belongs at admission in the write profiles, before or during parsing,
and the test file shows one way to do it in a few lines: ES2025
`JSON.parse` source-text access hands the reviver each literal's source,
and comparing that literal's exact decimal value with `JSON.stringify` of
its `Number` decides admission without a big-decimal library. Go's
`encoding/json` offers the same with `UseNumber` and `json.Number`. The
beads bead-graph plane adds the check to its canonicalizer, as the ruling
records; the versioned-beads writer needs nothing, its `sha256-jcs`
being lossless over admitted values.

**Depends on this decision.** Nothing in the draft. PROTO-016 is the
requirement the eventual write-profile implementation answers to.

## NM10 — Data that was never admitted

**Context.** The rule is an admission rule. A store may hold literals
that never passed BDP admission — imported records, data written through
another surface — and a Read authority serves stored `properties`
verbatim.

**Options.**

1. Say nothing more. A served literal that would not have been admitted
   is not a protocol violation; it is non-portable data, and a
   `sha256-jcs` token over it is lossy in exactly the way RFC 7493 warns.
2. Require a Read authority to refuse to serve, or to rewrite, such
   literals. Rewriting changes stored values silently; refusing hides a
   Resource for a reason the Read problem table does not name.

**Recommendation.** Option 1, and note it here so it is not forgotten.
A future ruling could add a Read-side portability rule; the sealed
cohort's artifacts already satisfy it (NM8).

**Depends on this decision.** Nothing in the draft.

## NM11 — Ledger entry 17 and the merge collisions with #22

**Context.** The wildcard PR (#22, branch `janet-owned-wildcard`) adds
ledger entry 16 and changes "The 15 questions below" to 16. This
transcription was told to take 17.

**Decision and collision note.** This branch numbers its entry 17 and
changes the count to 17, which is correct once both land and wrong on
either branch alone: on this branch alone the list runs 1–15, 17 and
Markdown renders the last item as 16. Merging second will conflict on
exactly these lines, all trivially resolved by keeping both sides:

- the count sentence under *Open protocol questions* (15 → 16 there,
  15 → 17 here; resolve to 17);
- the insertion point of the rows table before `### Open protocol
  questions` (both add a `####` table there; keep both, wildcard first);
- the insertion point of PROTO-016 in `docs/design/requirements.md`
  (both insert after PROTO-014; keep both, PROTO-015 first);
- the `STATUS.md` paragraph after the evidence-discipline note and the
  `docs/design/README.md` bullet after the client-interface entry (both
  append; keep both).

If #22 does not land first, renumber this entry 16 and the count 16. A
count-free sentence — "The questions below carry recorded decisions or
explicit artifact gates" — would end this class of collision; it is
suggested, not applied.

**Depends on this decision.** The ledger entry, its cross-references
from the rows table ("entry 17") and this packet.
