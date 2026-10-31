# Selected affiliation and nominal ownership: paired source

Candidate under [#279](https://github.com/gastownhall/bdp/issues/279) and sole plan
[#59](https://github.com/gastownhall/bdp/issues/59). This builds on reviewed PR287
head `5c3f9090cc53470c62a55d6675e31b72175f015f`, including PR286 ancestry. It ports
selected PR284 carrier content into the **new v0.1 slot**, pairs the retained
[CLI design](../cli-design/affiliations-and-owned-state.md) with [common protocol
rules](../../specs/profiles/core/affiliations.md), and amends the corresponding
Core/Write seams and illustrative operation schema. It does not merge those
other draft PRs or claim complete adoption.

Original PR284 remains unchanged at `42cfdf2c7ff6ca419932be55b4b17f8124ef09d7`.
Types source is Trish's PR283 at
`a2aa88d9b5a0e0d78f48de2967d4ceaa38177876`, especially §§2, 3.6, 3.14, 5.5 and
5.7. No Types artifact is edited or silently imported. Integration must compose
that actual source; the working tree's inherited Types file is not a substitute.
Molly owns the disjoint front-door/register/status pointers.

## Carrier and ordinary input correspondence

```json
{"type":"https://work.example/acme/Task"}
```

```json
{"type":{"uri":"https://work.example/acme/Task","revision":"definition-r4"}}
```

```json
{
  "bead":"task-42",
  "type":{"uri":"https://work.example/acme/Task","revision":"definition-r4"},
  "expectedRevision":"resource-r7"
}
```

`bdp update task-42 --type Task --type-revision definition-r4 --if-revision resource-r7`
expresses the third input for command Scope `https://work.example/acme/`.
The Type definition pin and optional Resource guard are independent. Omission
preserves the full old affiliation; explicit input replaces it wholly. Under
Types, unpinned input resolves once to the eligible selected registered exact
default, with exact output. There is no acquisition, registration or latest guess.
No new mandatory guard, endpoint repin, property conversion or Type lifecycle CLI
follows. A pin-only change is an effect; equal whole resulting state is a real
no-op after all checks. Retained retries distinguish omitted/unpinned/exact intent
and preserve the original exact resolution witness.

The canonical and distribution **v0.1** schema changes exactly ten inherited
definitions and adds `typeReference`/`pinnedTypeReference`, porting the selected
PR284 grammar without advancing the old slot. Shared records, create/update
members, deletion identity, typed Link facts, owned-Link deltas and `event.subjectType`
use the carrier. Event `type` remains its fact discriminator. The v0.1 contract ID,
capability-version helpers and all other definitions are preserved from PR287.
The illustrative Write schema uses the new common carrier and admits Type-only
updates; its inherited eight-operation union is still a staged profile input.
Neither that union nor a historical sequence schema reinstates them in the target
Write design. Set-write Type replacement is not added.

## Owned captures and filters

New owned captures use the union of effective selectors and recorded conformance,
deduplicated and bucketed by actual nominal Link Type URI. Different pins share
one bucket while full records retain exact affiliations; refinements get their
own bucket once. New empty sets are `{}`, without empty selector/wildcard buckets.
Old snapshots and unchanged retained revisions preserve recorded shape. A global
`minItems:1` on the shared record schema would incorrectly reject such old state;
new-capture grouping/nonempty/deduplication need contextual semantic checks.
The [paired fixtures](../../fixtures/affiliations/candidate.json) include complete
mixed-pin/refinement, new-empty and retained-empty postimages.

Link entry **and exit** from ownership create atomic source effects; a pin change
can change effective membership. A source retype recomputes ownership without
inventing edits/revisions on unchanged Links. Literal source pins stay recorded
citations with independent Source/Link tokens; retained S@r1 never gains membership
because S@r2 captures a new Link. Remaining Types pin/admission/traversal/creation-token
mechanics and exact induced-owner counts for multi-operation batches are not chosen.

Structural `type` / CLI `--exact-type` compares nominal identity across both carrier
forms. `conformsTo` / CLI `--type` uses accepted recorded exact authority and refuses
when unavailable. Pins are invalid filter operands. Raw bounded JSONPath sees the
actual union without rewriting/virtual fields; this is an explicit changed-contract
boundary rather than string-only v0 compatibility. No general ID relocation/equality
solution or legacy HTTP endpoint follows.

## Fanout and evidence disposition

Pre-edit inventory separates new schema/prose, held runtime/fixtures, and live
catalog quotations. The old v0 schema/mirror, runtime version/parsers, existing
behavior fixtures, Types/PR284 and previous run/report identities remain untouched.
No provider/build campaign is needed to prove this source/artifact boundary.

The active catalog reader assembles **current** Core/Write/conformance source.
Fourteen now-stale quotations in five catalogs and the two identical companion-row
titles are updated to that actual source. IDs, ordering, profiles, sources,
anchors, row counts and retirement/selection edges remain unchanged. No new file
is added inside the sealed active catalog directory. An old PASS cannot be inherited
under changed source/catalog digests. The companion owned-wildcard row remains
identical in both catalogs. This is quotation maintenance, not activation of a
new v0.1 provider conformance selection.

## Validation and adoption limits

The strict-Ajv carrier matrix must run afresh against this new target, including
singleton, historical sequence and batch positions; no original PR284 result is
inherited. Focused artifact tests cover paired operation/postimage samples,
legacy-slot isolation, exact closed carriers, empty-update controls, unchanged
nominal/endpoint domains and the illustrative common fields. Existing catalog,
citation/selection and pure wire/source consistency checks validate only their
bounded responsibilities. All semantic cases in the candidate fixture are
explicitly unexecuted; grammar acceptance does not prove Type resolution,
authorization, no-op detection, graph validation, owner revisions or retry execution.

Required Events remain an explicit adoption gap: inherited `updatedData` and
`ownedLinkDelta` cannot yet encode Type-only changes or full bucket membership
transitions. A fake patch or omitted Event is forbidden. D1/D2 baseline payload and
read-only observation guarantees remain unanswered; no example chooses postimages
versus deltas. Profile factoring, Types composition and Event transport/payload
amendments still precede any v0.1 advertisement. Vickie/runtime/product/main pins,
Experimental, `serve` and broader implementation work remain held.

## Author result at this candidate

Fresh strict-Ajv/full-format carrier checks pass **408/408**, with exactly ten
changed/two new definitions in the new slot, byte-identical distribution mirror,
and all 163 candidate definitions compiled by the binding tests. The held v0
schema remains SHA256 `15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327`.
All twelve initial artifact tests passed in the original nine-file run: **436 passed,
one failed, zero skipped** (Vitest4.1.10, Node24.19.0). The failure was the stale
`read-update-wire.test.ts:414` expectation that `[]` is invalid. It reproduced on
clean parent PR287@5c3f909 in a one-test diagnostic (137 other tests filtered);
both original failure logs and that reproduction are preserved. The initial new
illustrative schema strictRequired failure was corrected in source while retaining
strict validation, and that test passed.

Trish confirmed that [#281](https://github.com/gastownhall/bdp/pull/281) / `365f337`
already integrated supplied-empty ordinary patches. The bounded author repair
therefore aligns this one old test with that existing rule: empty patches are
valid for both Resource kinds and both object planes; root replacements stay
valid; malformed patches, omitted-all edits and guard-only updates are rejected.
This is the explicit held-boundary exception, not a v0 schema/runtime/behavior-fixture
upgrade or a skipped/weakened malformed-input rule. It remains in this isolated
[#279](https://github.com/gastownhall/bdp/issues/279) lane under the existing
[#59](https://github.com/gastownhall/bdp/issues/59) plan. The same nine-file slice
now passes **437/437 tests across nine files, zero failed or skipped** after the
test/source-evidence update. The original failure is not rewritten into a PASS;
this new run qualifies the corrected assertion at its new source.

After final prose-only wrapping/clarification, fresh carrier/source checks confirm
569 live quotations resolve across six catalogs, companion metadata is identical,
36 JSON fences parse, 71 local file links resolve, ten changed code/JSON files
pass Biome and whitespace checks pass. The candidate has 29 unexecuted semantic
scenarios and six paired CLI/operation samples; these are not parser or provider
execution. Original PR284/Types/runtime/behavior fixtures stay held. No hosted,
installed, HTTP/CLI or full provider qualification is claimed.

## Primary revision and result rule alignment

Parent source review caught one remaining unconditional properties/metadata-only
no-op predicate in Write [Mutation revisions and guards](../../specs/profiles/write/write.md#mutation-revisions-and-guards).
That operative rule now includes the complete affiliation and applicable captured
owned state, while retaining ordinary optional guards. The existing `pin-only`,
`same-affiliation` and `empty-patches-with-retype` semantic cases link directly to
that rule: changed pin is an effect, equal full state is a no-op after checks,
and empty patches do not erase a changed affiliation. This corrects the actual
rule without selecting an Event payload or changing runtime/schema behavior.

The result rule also uses effective ownership before **or** after the operation,
so a Link leaving ownership still reports the actual induced `source`/`sourceRevision`
pair with its unowned postimage. Ordered results refer to that common rule; retained
results keep the original recorded pair. Existing owned-Link no-op and unrelated
unowned results retain their respective unchanged-pair/source-less behavior. Three
native samples and paired-field refusal checks cover the existing schema carrier;
pre/post membership execution remains an explicitly unexecuted semantic case.

After both operative-source repairs, the same nine-file slice passes **438/438**,
zero failed or skipped, including thirteen affiliation-artifact tests. The added
test validates native/ordered Link result carriers and rejects incomplete secondary
revision pairs; it does not claim ownership execution. Fresh quotation checks
include the three revised primary-rule citations and one ordered-result citation,
for fourteen changes across five catalogs. The original failure, clean-parent
reproduction and earlier passing repair runs remain distinct evidence.
