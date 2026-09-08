# Owned-Link wildcard decisions

This packet records every judgment taken while transcribing the wildcard
ownership entry — the operator's ruling of 2026-09-08, recorded at
[gastownhall/bdp#1, item 5](https://github.com/gastownhall/bdp/issues/1#issuecomment-5586084982)
— into `docs/specs/bdp.md` (Owned Links, Types and Type Descriptors,
Resource records, the Owned-Link wildcard conformance rows, and ledger
entry 16), `schemas/bdp-v0.schema.json`, `fixtures/owned-wildcard/`, and
`packages/conformance/catalog/owned-wildcard-v1.json`.

The ruling fixed the shape and the rule: `ownsOutgoing` MAY contain the
entry `"*"` with a `max`, declaring every outgoing Link Type not listed
explicitly as owned; `max` bounds the whole owned set; explicit entries
take precedence for the types they name; `ownedLinks` carries one entry
per owned Link Type actually present plus an empty entry per explicitly
declared type; nothing else about ownership changes; and the price is
stated plainly — a view is closed over owned Links, so a wildcard owner
that owns a Link to a hidden Bead is hidden too. Those points are
transcribed, not decided. What follows is the remainder: each detail the
ruling did not fix, with the conservative choice applied in the draft and
the artifacts that depend on it. A ruling that departs from a
recommendation is applied by editing the quoted specification sentence,
the bundle definition, the fixture, and the catalog row together.

The lockstep tests (`packages/protocol/src/owned-wildcard.test.ts`,
`packages/conformance/src/owned-wildcard-catalog.test.ts`) check
structural, citation, and example consistency — the bundle admits the
wildcard where the ruling puts it and nowhere else, the fixture validates
and follows the entry rule and the bounds, every catalog citation still
appears in its anchored section, and the catalog mirrors the
specification's row table in order. They inspect none of the semantics:
a ruling can change a decision's meaning without failing a test, and a
green run establishes only that the artifact families still agree on
what they say.

Nothing in this packet is a conformance claim. No manifest, fixture
realization, runner, or evidence exists for any wildcard row;
`claimEligible` remains `false` everywhere, and the sealed Read cohort is
untouched.

Decisions are numbered in dependency order: what the bound covers, then
the entry's shape, then what the record carries, then how the rows are
scoped, then the transcription's edges, then evidence and runtime posture.

---

## OW1 — What the wildcard's `max` bounds

**Context.** The ruling says the wildcard's `max` bounds "the whole owned
set" and that explicit entries take precedence for the types they name,
each with its own `max`. Whether "the whole owned set" includes the Links
of explicitly declared types — or only the Links owned through the
wildcard — was not spelled out.

**Options.**

1. The whole owned set, explicitly declared types' Links included: every
   owned Link of the Bead, across every owned Link Type, counts against the
   wildcard's `max`; an explicit entry's own `max` additionally bounds its
   type. One number bounds the inline plane. An explicit `max` above the
   wildcard's is permitted and never reached.
2. Wildcard-owned Links only: explicit types are bounded by their own
   entries, and the plane's bound is the wildcard's `max` plus the sum of
   the explicit ones. Two numbers to reason about, and "the whole owned
   set" would mean "the rest".
3. A per-type bound applied separately to each wildcard-owned type. The
   plane would then be unbounded in the number of Link Types, defeating
   the purpose of `max`: a plane that is always servable inline.

**Recommendation.** Option 1. It is the ruling's literal words, it gives
the plane one bound, and it is the conservative reading: it admits fewer
Links, relaxing it later invalidates no existing record, and tightening
it later would.

**Depends on this decision.** Under *Owned Links*: "The wildcard's `max`
bounds the Bead's whole owned set: every owned Link of the Bead across
every owned Link Type, the explicitly declared types' Links included, so
a Bead never carries more owned Links than the wildcard's `max`, whatever
its explicit entries permit." Bundle: nothing — bounds are not
schema-checkable. Fixture: `mem-1` carries three owned Links under a
wildcard `max` of 64 and none under `cites` (`max` 16). Row
`read-update.owned-wildcard.explicit-precedence`.

## OW2 — No `label` on the wildcard entry

**Context.** An explicit declaration is `{ label?, max }`. The ruling
wrote the wildcard as `"*": { max }` and said nothing about `label`
there.

**Options.**

1. The wildcard entry is exactly `{ max }`: a closed
   `ownedWildcardDeclaration` in the bundle, distinct from
   `ownedLinkDeclaration`.
2. `{ label?, max }`, like an explicit entry — a display name for
   "everything else" in SDK projections.

**Recommendation.** Option 1. `label` documents one Link Type; the
wildcard names none, and a Link Type owned through it is described by its
own descriptor. It is also the conservative choice: admitting a label
later breaks no descriptor, while withdrawing one would.

**Depends on this decision.** Under *Owned Links*: "The wildcard entry
carries no `label`: it names no Link Type." Under *Types and Type
Descriptors*: "An `ownsOutgoing` entry is closed the same way:
`{ label?, max }` under a Link Type URL, `{ max }` under the wildcard."
Bundle: `$defs.ownedWildcardDeclaration`, bound to the `"*"` key through
`typeDescriptor.properties.ownsOutgoing.properties`. Fixture: rejection
`wildcard-with-label`. Row `read.owned-wildcard.max-required`.

## OW3 — The wildcard may be the only entry

**Context.** The ruling's motivating case, the Memory Bead, declares
exactly one entry: `"*"`. The bundle's `minProperties: 1` is satisfied by
it.

**Options.**

1. Yes: a descriptor whose `ownsOutgoing` is `{ "*": { max } }` is valid.
2. Require at least one explicit entry beside it — which would rule out
   the case the wildcard exists for.

**Recommendation.** Option 1.

**Depends on this decision.** Under *Owned Links*: "The wildcard MAY be
the only entry." Fixture: the `note` descriptor. Row
`read.owned-wildcard.declaration`.

## OW4 — The `ownedLinks` member of a wildcard owner with nothing present

**Context.** The ruling fixes the entries: one per owned Link Type
actually present, plus an empty one per explicitly declared type. The
existing rule keeps the member absent for Beads whose Type owns nothing.
A wildcard-only owner that has made no Links has no entry to carry, so
the member's presence for that Bead was not fixed.

**Options.**

1. Present and empty (`{}`): the member is present exactly when the
   Bead's Type carries `ownsOutgoing`. "Owns nothing" stays a property of
   the Type, and a reader tells an unowning Type (absent) from an owning
   Type with nothing present (`{}`) without fetching the descriptor.
2. Absent whenever it would be empty: presence would then depend on
   state, and a reader could not distinguish the two cases from the
   record alone.

**Recommendation.** Option 1. It keeps the present-iff-owns rule stable
and makes the record self-describing, as the existing rule intends.

**Depends on this decision.** Under *Owned Links*: "The member is
present, possibly empty, for every Bead whose Type carries
`ownsOutgoing`, and absent for Beads whose Type owns nothing." and "a
Link Type owned only through the wildcard has an entry exactly when an
owned Link of that type is present." Bundle: nothing — `ownedLinks`
already admits an empty object. Fixture: `note-1` carries
`"ownedLinks": {}`; `mem-2` carries only the explicit type's empty entry.
Row `read.owned-wildcard.present-entries`.

## OW5 — Row profiles and identifiers

**Context.** Six rows were asked for: declaration accepted, `max`
required on the wildcard, explicit-entry precedence, present-only
entries, an owned Link of an undeclared type versioning its source, and
closure over a wildcard-owned Link. Which profile each requires, and how
the rows are named, was not fixed.

**Options.**

1. Every row in Read. A Read-only target cannot create, update, or delete
   a Link, so the bounds and the source-versioning rows could be claimed
   by nothing that exercises them.
2. Split by what a black-box test can observe: descriptor and record
   shape and view closure are Read-observable; the bounds and the
   versioning of the source are exercised only by mutation, so those two
   rows require Read+Update. Identifiers are
   `<required profile>.owned-wildcard.<name>`, so the sealed Read
   catalog's `read.*` namespace is shared without collision and the
   profile is visible in the id.

**Recommendation.** Option 2.

**Depends on this decision.** The *Owned-Link wildcard conformance rows*
table; each catalog row's `requiredProfile`; the catalog test's
profile-prefix and profile-selection assertions.

## OW6 — Scope of the transcription

**Context.** Item 5 of the ruling also says that `derived-from` stays a
structured field rather than a Link, and that letting a descriptor mark
property members as References so they receive target validation is a
separate, later addition.

**Options.**

1. Transcribe the wildcard only, and record the deferral in one clause of
   ledger entry 16.
2. Open a new ledger question for property members as References.

**Recommendation.** Option 1. The ruling deferred the addition
explicitly; the ledger's purpose is to keep deferred work visible, and one
clause does that without opening a design the ruling did not make.

**Depends on this decision.** The last sentence of ledger entry 16:
"Letting a descriptor mark property members as References so they receive
target validation is a separate, later addition."

## OW7 — Evidence posture: the sealed Read cohort's schema binding

**Context.** The bundle changed. The sealed Read cohort
(`docs/design/evidence/read-cohort/read-v1.json`) records
`bindings.schema` as the SHA-256 of the bundle at `0b7d86e7`
(`552329e6…`), and the evidence gate checks that binding's shape without
recomputing it against the current bundle. This is the condition the
Read+Update draft (PR #19) records as D29.

**Options.**

1. Record the staleness in `STATUS.md` and here; do not re-seal. The
   cohort proves the Read surface against the bundle it was sealed with.
2. Re-seal now: `pnpm evidence:generate` needs `bd` on `PATH`, launches
   the packaged targets, and rewrites the evidence artifact — a separate
   reviewed step, and the operator's call.
3. Add a recomputing gate rule. It would fail the gate on every bundle
   change, this one included, until each is re-sealed.

**Recommendation.** Option 1.

**Depends on this decision.** The known-gap paragraph in `STATUS.md`. No
specification sentence.

## OW8 — Runtime lag: no implementation realizes the wildcard

**Context.** `@bdp/protocol` types `OwnedLinkDeclaration` as
`{ label?, max }` and its `BeadTypeDescriptor.ownsOutgoing` as a record of
those; the in-memory adapter (`packages/adapter-in-memory/src/index.ts`)
iterates `ownsOutgoing` keys literally and would emit `"*"` as an
`ownedLinks` key — which the bundle now rejects. The reference domain
(`fixtures/reference-domain/reference-domain.json`) declares no wildcard,
so no served record is affected.

**Options.**

1. Leave the runtime as it is. The rows stay unclaimed metadata, and an
   implementation follows this specification change under the evidence
   law, with its own review.
2. Implement now — parser, types, adapter, and `bdptest` fixtures — which
   widens a specification transcription into an implementation wave, and
   would still be claimed by nothing until rows are proved.

**Recommendation.** Option 1.

**Depends on this decision.** Under *Owned-Link wildcard conformance
rows*: "none carries an executable plan, a fixture realization, or
evidence." No bundle, fixture, or catalog artifact.
