# W1 Read+Update wire decisions

This packet records every provisional judgment taken while drafting the
Read+Update wire artifacts — the `operations/sequence` request and response
envelopes, mutation results, the singleton response, idempotency-key syntax
and qualification, duplicate handling, finite outcome retention, and the
Read+Update problem rows — in `docs/specs/bdp.md`,
`schemas/bdp-v0.schema.json`, `fixtures/read-update/`, and
`packages/conformance/catalog/read-update-v1.json`.

Each decision is applied in the draft as its recommendation so that the
profile is implementable on paper and the artifacts can be reviewed as a
whole. D29 is ruled (option C, 2026-09-08) and its corrective is applied,
and D9 is superseded by the cross-packet ruling X1 (option B, 2026-09-08)
applied as D32; the rest are provisional. The operator rules on them one
at a time; a
ruling that departs from the recommendation is applied by editing the quoted
specification sentence, the corresponding bundle definition, the fixtures,
and the catalog row together. The lockstep tests
(`packages/protocol/src/read-update-wire.test.ts`,
`packages/conformance/src/read-update-catalog.test.ts`) check selected
structural, table, citation, and example consistency — the problem rows
mirror the bundle's branches, every catalog citation still appears in its
anchored section, the catalog mirrors the specification's row table in
order, the fixtures validate and align member by member, retained
dispositions are byte-identical wherever they are replayed, and the wire
shapes the council found admitted are now rejected. They inspect none of
the semantics D1–D32 describe: a ruling can change a decision's meaning
without failing a test, and a green run establishes only that the four
artifact families still agree on what they say.

Decisions D1–D20 were drafted with the artifacts; D21–D31, and the
revisions marked *Revised (council 9)* below, fold the review council's
findings recorded under [Council 9 fold](#council-9-fold). D26–D31 fold
the Claude report, which arrived after the first pass. D32 applies the
cross-packet ruling X1 (option B, 2026-09-08), which supersedes D9.

Nothing in this packet is a conformance claim. The Read+Update profile has
no manifest, fixture realization, runner, or evidence; `claimEligible`
remains `false` everywhere, and the sealed Read cohort is untouched.

Decisions are numbered in dependency order: key syntax and qualification
first, then what a key retains, then the envelopes that carry the outcomes,
then the problem rows, then carrier and HTTP discipline.

---

## D1 — Idempotency-key syntax and field spelling

**Context.** The draft required a key syntax before the profile could be
implemented. The Transactional `Idempotency-Key` example in the draft is an
unquoted token; the IETF `draft-ietf-httpapi-idempotency-key-header` spells
the field as a quoted Structured Field string.

**Options.**

1. Reuse the Event-ID and checkpoint character profile
   `[A-Za-z0-9_-]{1,256}`, case-sensitive, compared byte-exactly; the
   `Idempotency-Key` field value is the bare token. One wire-safe alphabet
   for every BDP token; safe in JSON, headers, logs, and URLs; the existing
   draft example already reads this way.
2. Follow the IETF draft: any string, quoted in the header, with a
   length bound. Interoperates with generic middleware that expects the
   quoted form; but introduces quoting rules, escaping, and a second token
   alphabet into BDP.
3. UUID only. Simplest to state, but forecloses ULIDs, hashes, and
   client-structured keys the checkpoint profile already admits.

**Recommendation.** Option 1.

**Clarified (council 9).** A repeated `Idempotency-Key` field is rejected,
not resolved: the authority does not choose an occurrence. Reusing the
Event-ID character grammar imports no Event semantics.

**Depends on this decision.** Under *Idempotency keys*: "An idempotency key
is a case-sensitive ASCII token matching `[A-Za-z0-9_-]{1,256}` — the
character profile under Event-ID and checkpoint character profile — written
identically as a sequence member's `idempotencyKey` and as the value of a
singleton request's `Idempotency-Key` field, without quoting, padding, or
whitespace." and "as is a singleton request that omits the field or
carries it more than once: the authority rejects a repeated
`Idempotency-Key` field rather than choosing an occurrence." Bundle:
`idempotencyKey`. Fixture `singletons.json`, exchanges
`repeated-idempotency-key-field` and `malformed-idempotency-key`.

## D2 — Idempotency namespace

**Context.** The Transactional profile scopes a key to the canonical Scope
URL, the Scope epoch, and the authenticated principal. Read+Update exposes
no epoch, and the draft did not say whether singleton and sequence keys
share a space.

**Options.**

1. The pair (canonical Scope URL, authenticated principal), with the
   anonymous principal as one principal; one namespace shared by both
   carriers; Authorization View changes do not re-namespace. Mirrors
   Transactional minus the epoch it does not have; a principal can never
   see, block, or probe another principal's keys.
2. The canonical Scope URL alone. Simpler bookkeeping, but one principal's
   key collides with another's — an `idempotency-conflict` becomes an
   oracle for the existence of another principal's request, and one
   principal can pin a key another needs.
3. Per carrier or per operation target as well. Prevents nothing useful:
   the same key with a different operation kind is already a semantic
   mismatch, which is exactly the conflict a client wants reported.

**Recommendation.** Option 1.

**Clarified (council 9).** The authenticated principal is the identity
authentication established for the request, as the authority identifies
it across restart and failover; it is never the carried
`attribution.principal`, which is data and takes no part in the namespace.
Sharing the namespace across carriers and preserving it across
Authorization View changes stand; disclosure of a retained result is
re-authorized on every replay under D21.

**Depends on this decision.** Under *Idempotency keys*: "A key identifies
one semantic mutation within one **idempotency namespace**: the pair of the
canonical Scope URL and the authenticated principal, an anonymous principal
counting as one principal.", "it is not the carried `attribution.principal`,
which is data under Carried attribution and takes no part in the
namespace", and "The namespace is shared by every mutation carrier in the
profile". Fixture `idempotency-recovery.json`, exchanges
`principal-isolation` and `cross-carrier-key-equivalence`.

## D3 — Semantic identity of a member

**Context.** "Same semantics" decides between a retained disposition and an
`idempotency-conflict`. The Transactional normalization rules exist for
batch bodies but say nothing about `name`, `@name`, or the singleton target.

**Options.**

1. Identity = operation kind (from `operation` or the singleton target) plus
   the normalized record: durable references canonicalized, `@name`
   resolved to the durable identity it bound (unresolved spellings compared
   as written), defaults expanded, array order preserved, member order
   ignored, `idempotencyKey` and `name` excluded; no public hash. A retried
   sequence and the equivalent singletons compare equal; renaming a label
   is not a semantic change.
2. Treat `name` as semantic. Simpler to state, but a retry that renames a
   label — or a member resubmitted as a singleton — conflicts for no
   protocol reason.
3. Publish a canonical request hash. Makes conflicts reproducible by
   clients, at the cost of freezing a serialization and hash algorithm in
   v0 that Transactional deliberately avoided.

**Recommendation.** Option 1.

**Revised (council 9).** The unresolved-spelling fallback is struck: it
made a concurrent retry's dependent member retain an identity computed
over `@x` while the original's was computed over the resolved URL, so the
two conflicted (Codex H2, Gemini C1). A `@name` reference now resolves to
the identity its creating member bound, taken from that member's fresh,
retained, or expired disposition (D24) and never from the spelling; a
transient creator yields no identity, and the dependent member is
answered transiently before any comparison (D15). A reference that
resolves to no identity because its creator allocated none — forward,
unknown, or permanently failed — normalizes to one distinguished unbound
marker, so renaming a label never changes an identity; under D27 only the
permanently failed creator reaches comparison at all, since forward,
unknown, and wrong-kind references are rejected before execution. The
normalized records compare under the JSON value-equality rules of RFC 6902
Section 4.6 (Claude L2). Opaque external
URIs and Pinned References compare byte-exactly as written;
`expectedRevision` and `attribution` are members of the record and
therefore of its identity. The alternative — normalizing an unresolvable
reference to the creating member's key — would put a client-minted token
into identity, which the exclusion of `idempotencyKey` deliberately avoids.

**Depends on this decision.** Under *Idempotency keys*: "The **semantic
identity** of a member is its operation kind — from `operation`, or from
the singleton target — plus its normalized operation record." through "BDP
does not require a public request-hash algorithm.", including "resolves
each `@name` reference to the identity its creating member bound — taken
from that member's fresh, retained, or expired disposition, never from the
spelling", "is normalized to one distinguished unbound marker rather than
to its spelling", and "Opaque external URIs and Pinned References are
compared byte-exactly as written; `expectedRevision` and `attribution` are
members of the record and therefore of its identity." Fixture
`semantic-identity.json`.

## D4 — Which dispositions are retained

**Context.** The draft said a repeated member "returns its retained
outcome". It did not say whether a failure is an outcome, and a retained
`temporarily-unavailable` with `retry: after-delay` would contradict its
own disposition.

**Options.**

1. Retain every terminal disposition, success or failure, except transient
   ones — dispositions whose `retry` is `after-delay` (`rate-limited`,
   `temporarily-unavailable`, `idempotency-in-progress`) are never retained;
   pre-admission rejections retain nothing. Deterministic: a retry under
   the same key is always answered the same way; a client that has
   refreshed state must construct a new request, which changes its semantic
   identity and therefore needs a new key anyway. Mirrors Transactional
   ("Retrying returns that same failed receipt").
2. Retain successes only; failed members re-execute on retry. Lets a client
   retry into a changed world under the same key, but a retry may then
   succeed where the recorded disposition said it failed, so two responses
   to one key disagree, and `forbidden`/`resource-not-found` become
   re-executable probes.
3. Retain everything, transient dispositions included. Contradicts
   `after-delay`.

**Recommendation.** Option 1. Note that `forbidden` is retained under it:
after a grant, the principal presents a new key. This mirrors the model's
rule that an Authorization View change does not create a new namespace.

**Revised (council 9).** Two exceptions are made explicit. A dependent
member whose creator's disposition in the same request was transient is
itself transient and retains nothing (D15), so a transient predecessor can
never become a permanent `binding-unavailable`. A replay-time disclosure
refusal (D21) is not a disposition: it neither replaces the original
outcome nor is retained. The retained `forbidden` above is the one an
operation earned when it was reached; the replay `forbidden` is answered
from the present view and leaves the retained disposition intact. Two
further points from the Claude report: a retained `binding-unavailable`
forces a re-key of every dependent once its creator is corrected, since
the dependent's identity changes from the unbound marker to a real
identity (Claude M1) — the specification now says so plainly ("a client
that corrects a creator presents new keys for its dependents as well")
rather than un-retaining `binding-unavailable`, which would make it the
one `never` disposition a retry re-evaluates; and a retained failure
outlives the retention interval differently from a success (D28).

**Depends on this decision.** Under *Duplicate keys and retained
dispositions*: "When a member reaches its terminal outcome, the authority
retains that disposition under the member's key unless the disposition is
transient." through "creates no disposition.", including "A member whose
`@name` reference names a creating member of the same request whose
disposition was transient is transient by the same rule". Fixture
`sequence-dependent-bindings.json`, exchanges
`creator-fails-permanently-dependent-is-binding-unavailable` and
`retained-failures-answer-a-retry-unchanged`.

## D5 — Concurrent duplicate: refuse or join

**Status: RATIFIED 2026-09-08** (via X3: Read+Update refuses a concurrent duplicate; Transactional joins through a receipt).

**Context.** The draft listed "duplicate-join behavior" as missing. The
Transactional profile joins a concurrent duplicate to one execution and may
hand it a pending receipt. Read+Update has no receipt to hand out.

**Options.**

1. Refuse: the member fails with `idempotency-in-progress` (family
   `conflict`, `409`, `after-delay`), the authority executes nothing and
   retains nothing for it, and a retry after the delay receives the retained
   disposition. Never blocks a request on another request; bounded server
   state; the client's uniform `after-delay` handling covers it; exactly-once
   per key still holds.
2. Join: the duplicate waits for the in-flight member's terminal outcome and
   returns it. One round trip for the client, but the authority holds the
   duplicate's connection for an unbounded interval, and for a sequence the
   wait recurs member by member against another request's progress.
3. Implementation choice between 1 and 2. Hard to test rather than
   untestable: a conformance row would have to bound how long a join may
   take before it counts as a refusal that was never sent, and two
   conforming authorities would answer the same probe differently.

**Recommendation.** Option 1, a deliberate divergence from the Transactional
join because the join's payoff there is the pending receipt.

**Clarified (council 9).** A retry after the delay is not guaranteed the
retained disposition: it may still find the key in flight, meet a
transient disposition of its own, or, after a long delay, find the
disposition expired (D25). The refusal is safe only once dependent-member
poisoning is fixed (D15): a refused creator makes its dependents in the
same request transient, not permanently failed.

**Depends on this decision.** Under *Duplicate keys and retained
dispositions*, item 3: "the key is in flight — the member that first
presented it has not reached a terminal outcome: the member fails with
`idempotency-in-progress`, the authority executes nothing and retains
nothing for the presenting member, and a retry after the delay receives the
retained disposition once the first presentation has reached a retained
outcome — a delayed retry may instead find the key still in flight, meet a
transient disposition of its own, or, after a long delay, find the
disposition expired". Problem row `idempotency-in-progress`. Fixture
`sequence-idempotent-retry.json`, exchange
`concurrent-retry-meets-the-creator-in-flight`.

## D6 — Retention window, tombstones, and expiry

**Status: RULED A 2026-09-08** (Q19: tombstones only for committed effects, Scope lifetime; failed dispositions retained for the window, then forgettable).

**Context.** The draft required "finite outcome-retention rules" tied to the
advertised `retention.idempotency`, and a problem code for what a client
sees after expiry. The Transactional profile keeps a compact tombstone for
the rest of the Scope epoch and answers an expired retry without
re-executing.

**Options.**

1. Retain each disposition for at least `retention.idempotency` when
   advertised (a finite interval of the authority's choosing otherwise);
   afterwards the authority MAY discard the disposition but MUST keep a
   compact tombstone — key plus semantic-identity fingerprint — for the
   lifetime of the logical Scope, exactly like the identity non-reuse
   guarantee; an expired key with the same identity fails
   `idempotency-expired` (family `gone`, `410`, `never`) and never
   re-executes; with a different identity it is still
   `idempotency-conflict`. Storage for outcomes is bounded; a key can never
   silently execute twice; a restore that loses tombstones is a different
   logical Scope, which the draft already says.
2. Forget the key entirely after the window; a late retry executes as new.
   Bounded storage with no tombstones, but at-least-once semantics past the
   window: a late retried create allocates a second identity.
3. Retain full dispositions for the Scope lifetime. Simplest contract, but
   unbounded bulky storage, which is why Transactional split the tombstone
   out.
4. Advertise a second, longer tombstone window after which option 2
   applies. Honest, but two windows for one key confuse more than they
   bound.

**Recommendation.** Option 1. `never` rather than `after-state-change` for
`idempotency-expired`: the same request under the same key can never
succeed; a new intent is a new key.

**Revised (council 9).** The safety direction stands; the contract is
completed by four decisions the council found missing: the client's
recovery window is observable only when `retention.idempotency` is
advertised (D25); retention is crash-safe as part of one durable unit and
survives restart and failover, and a restore that loses it is a different
Scope (D22); the tombstone carries binding metadata — the allocated
identity and its kind — so an expired creator still binds its dependents
(D24); and the cumulative storage of Scope-lifetime tombstones was
unbounded and growable by any principal, which D28 bounds to committed
effects: only dispositions that committed state keep a Scope-lifetime
tombstone, and a failure is forgotten after its interval. The distinction between an expired key with the same identity
(`410`) and with a different one (`409`) is kept and now illustrated.

**Depends on this decision.** The whole *Outcome retention* subsection,
from "Retention is finite." through "creates a different logical Scope under
the rule in that section." Also under *Advertised limits*:
"`retention.idempotency` is the minimum interval for which an authority
retains an idempotency-key disposition after its terminal outcome".
Problem row `idempotency-expired`. Fixture
`sequence-idempotency-dispositions.json`, exchanges
`expired-key-never-executes-again` and
`expired-key-with-different-semantics-is-still-a-conflict`.

## D7 — `idempotency-conflict` status and family

**Context.** The draft called key reuse for different semantics "an
idempotency conflict" without a status. The IETF draft answers a mismatched
payload with `422 Unprocessable Content` and an in-flight duplicate with
`409 Conflict`.

**Options.**

1. Family `conflict`, `409`, retry `never`. Matches the draft's own word and
   the `conflict` family; `never` because the same request under that key
   can never succeed.
2. Family `validation`, `422`, `never`, following the IETF draft. Aligns
   with generic idempotency middleware; but the request is not
   unprocessable, it is contradicted by retained state, which is what
   `conflict` means.

**Recommendation.** Option 1.

**Depends on this decision.** The row "| `idempotency-conflict` | `conflict`
| 409 | `never` |" under *Problem details*, and item 2 under *Duplicate keys
and retained dispositions*.

## D8 — Sequence envelope shapes

**Context.** The draft sketched members with their own `idempotencyKey`,
inline results, and problems carrying `status`, `operationIndex`, and
`operationName`, but no envelope.

**Options.**

1. Request `{ operations: [member…] }` where a member is the batch-shaped
   operation record (with `operation` and, on creates, `name`) plus a
   body-level `idempotencyKey`; response `{ results: [entry…] }` with one
   entry per member in order; every entry — result or problem — carries
   `operationIndex` and, when the member declared `name`, `operationName`;
   a result entry is closed and discriminated by `outcome`, a problem entry
   is the Problem Details shape and never carries `outcome`; results echo
   neither the key nor a replay marker. One field vocabulary with batch
   (`operations`, `name`, `operation`, `@name`), the limit is already named
   `sequence.operations`, entries are self-describing when logged in
   isolation, and a retained disposition is byte-for-byte the original
   disposition repositioned.
2. Wrap each member as `{ idempotencyKey, name?, operation: {…} }`. Cleaner
   separation of carrier and record, but a second record vocabulary that
   batch and singletons do not use.
3. Carry `operationIndex` on problems only, as the draft's sketch literally
   says. Results are then positional-only, and a result copied out of its
   array loses its member.
4. Echo `idempotencyKey` and/or mark replayed dispositions (`retained:
   true`). Helps debugging, but creates a second response shape for one
   semantic outcome and puts client-minted tokens into every response;
   clients that need to know compare revisions.

**Recommendation.** Option 1, without the option-4 members.

**Depends on this decision.** Under *Sequence request envelope*: "The body
is one object whose only member, `operations`, is an ordered, nonempty
array of members." Under *Sequence response envelope*: "Every entry carries
`operationIndex`, the member's zero-based position in the request's
`operations` array, and carries `operationName` exactly when the member
declared `name`." and "it never carries `outcome`." Bundle:
`sequenceRequest`, `sequenceResponse`, `sequenceMemberResult`,
`sequenceMemberProblem`, the six `sequence*` members.

## D9 — Spelling of the deleted identity

**Superseded by X1 (RULED B, 2026-09-08).** The operator ruled the
cross-packet decision X1 as option B: the deleted identity is a record in
both write profiles — `{ resourceKind, resource: { id, type, revision } }`,
`revision` the Resource's final live revision, the one it had when it was
deleted and not a newly minted one, matching the Transactional changefeed
tombstone and `DeletedData.revision`. Option 1 below, the bare canonical
URL, no longer applies. The member that carries the record is decided as
[D32](#d32--the-member-that-carries-the-deleted-identity-record), and the
specification sentence, bundle definition, fixtures, catalog rows, and
lockstep test that depended on this decision now follow D32. The original
text is kept for the record.

**Context.** "Deletes return the canonical deleted identity." No member was
named.

**Options.**

1. `deleted`: the absolute canonical Resource URL, with `resource` absent.
   Literal to the draft's words; a string, so `resource` keeps one shape
   (a complete record).
2. `resource: { id }`, a partial record. Reuses the member name but makes
   `resource` polymorphic and tempts implementations to add `type` or a
   final `revision`, which deletion does not mint.
3. A top-level `id`. Terse, but asymmetric with `resource.id` on the other
   outcomes.

**Recommendation.** Option 1.

**Depends on this decision.** Under *Mutation results*: "`deleted` carries
`deleted`, the absolute canonical URL of the removed Resource, and no
record: deletion mints no version." Bundle: `mutationResultMembers`.

## D10 — The owned-Link source-revision member

**Context.** The model says an owned-Link mutation "additionally reports the
source Bead's resulting `revision`" and that "the envelope member carrying
that secondary revision is defined with the write profiles."

**Options.**

1. `sourceRevision`: the source Bead's resulting revision, on creation,
   update, and deletion of an owned Link, absent from every other result.
   The Link record already names the source; only the revision is new
   information. On a semantic no-op update the value is the source's
   unchanged current revision — "resulting", not "fresh".
2. A Pinned Reference `source: { uri, revision }`. Reuses Reference
   vocabulary, but collides in meaning with the Link's own `source` and
   with a pin, which is recorded provenance rather than a result.
3. Return the source's full postimage. Complete, but doubles the response
   for every owned mutation; the postimage is one `GET` away.

**Recommendation.** Option 1.

**Revised (council 9).** The deletion case broke option 1's rationale: a
deleted Link returns no record, so nothing in the response named the
Resource whose revision `sourceRevision` reported (Codex M9). Owned-Link
results now carry `source`, the source Bead's absolute canonical URL,
beside `sourceRevision` on creation, update, and deletion alike; each is
present exactly when the other is, and the bundle rejects either on a
Bead postimage. On a semantic no-op update `sourceRevision` is the
source's unchanged revision. This is a shared result-shape rule: the
Transactional packet's T22 fixes `sourceRevision` for receipt entries and
must carry `source` the same way, so the pair is to be ruled once for
both profiles (cross-packet note X4). T22's deleted-identity shape,
`{ resourceKind, resource: { id, type, revision } }`, differed from D9's
bare `deleted` URL; that divergence was tracked as cross-packet X1 and
ruled B on 2026-09-08 — the record in both profiles — applied here as
D32, so a deleted owned Link now reports its own identity in `deleted`
beside `source` and `sourceRevision`.

**Depends on this decision.** Under *Mutation results*: "the result
additionally carries `source`, the source Bead's absolute canonical URL,
and `sourceRevision`, the source Bead's resulting revision, on creation,
update, and deletion alike" and "`source` and `sourceRevision` are absent
from every other result, and each is present exactly when the other is."
Under *Validation and results*: "The envelope member carrying that
secondary revision is `sourceRevision`". Bundle: `mutationResultMembers`
(`source`, `dependentRequired`, the Bead-postimage branch). Fixture
`singletons.json`, exchanges `create-link-owned-versions-the-source`
through `delete-link-owned-versions-the-source`.

## D11 — Outcome vocabulary and the semantic no-op

**Status: RULED A 2026-09-08** (Q20: a semantic no-op reports `updated` with the retained revision; rows assert revision and attribution equality).

**Context.** Results need an outcome discriminator. The revision rule says a
no-op update "retains the existing revision and emits no `updated` Event",
which leaves open how the result reports it.

**Options.**

1. Exactly `created`, `updated`, `deleted`; a semantic no-op update succeeds
   as `updated` with the retained revision and postimage. Three outcomes to
   handle; the no-op is visible through revision equality, which a client
   holding `expectedRevision` already has.
2. Add `unchanged`. Honest about the absence of a new version and cheap to
   produce, but a fourth outcome every client must handle for a condition
   the Transactional receipt does not distinguish per operation either.

**Recommendation.** Option 1. The Claude report notes the trade-off the
operator should rule with in view: `unchanged` would make the no-op rows
testable without a prior read of the revision, whereas `updated` needs the
row to compare against the guard or an earlier read.

**Depends on this decision.** Under *Mutation results*: "A semantic no-op
update, defined under Revisions, succeeds with outcome `updated` and the
retained revision." Bundle: `mutationOutcome`.

## D12 — Singleton success response

**Context.** The draft says a singleton "returns its final Resource
postimage, deleted identity, or direct problem inline", without a status,
body shape, or place for `sourceRevision`.

**Options.**

1. `200 OK` for every singleton success with the `mutationResult` record as
   the body — the same record a sequence member carries, minus the
   positional members. One result vocabulary across carriers; `outcome`,
   `deleted`, and `sourceRevision` have a home; no `ETag` or `Location`
   obligation on an operation target that is not the Resource's URL.
2. The bare Resource record as the body (as a `GET` would return it) with
   `ETag`. Closest to the draft's wording, but a deletion and
   `sourceRevision` have nowhere to go without a header, and the closed
   record schema cannot carry them.
3. `201 Created` plus `Location` for creates, `200` otherwise, with body
   per option 1. HTTP-idiomatic, at the cost of a status branch clients
   do not need because `outcome` already says it.

**Recommendation.** Option 1; option 3 is the natural amendment if the
operator prefers HTTP idiom over uniformity. The specification now states
the absence of `ETag` and `Location` on a singleton success explicitly
(Claude L2).

**Depends on this decision.** Under *Operation Directory and singleton
targets*: "A successful singleton returns `200 OK` whose body is the
mutation result defined under Mutation results". Under *Mutation results*:
"a singleton target returns it as the body of a `200 OK` response".

## D13 — The new problem rows

**Context.** The Read table is closed and mutation codes are "defined with
their profiles". The mutation failure conditions the model enumerates under
*Validation and results* needed names, families, statuses, and retry
dispositions. `type-not-installed` was already named by the draft.

**Options.**

1. Eight rows beyond the three idempotency rows, with one new family:
   - `validation-failed` — `validation`, `422`, `never`: inadmissible
     result (Type contract, patch target missing or non-object result,
     endpoint constraint, external-endpoint policy); may carry
     `diagnostics` (D16);
   - `type-not-installed` — `validation`, `422`, `after-state-change`;
   - `identity-taken` — `conflict`, `409`, `never`: the identity is never
     reassigned, so the same request can never succeed;
   - `revision-mismatch` — `conflict`, `409`, `after-state-change`;
   - `incident-links-exist` — `conflict`, `409`, `after-state-change`;
   - `aggregate-constraint-violation` — `conflict`, `409`,
     `after-state-change` (v0: maximum endpoint multiplicity);
   - `binding-unavailable` — `request`, `400`, `never` (D15);
   - `unsupported-media-type` — `request`, `415`, `never` (D14).
   Read codes are reused where the condition is the Read condition:
   `resource-not-found` for a missing or invisible subject or in-Scope
   endpoint (same non-disclosure), `forbidden`, `limit-exceeded`,
   `request-too-large`, `malformed-request`.
2. One coarse `mutation-rejected` code with `detail`. Fewer rows, but
   clients cannot branch on the conditions that matter (revision race vs.
   contract failure vs. taken identity), and retry dispositions differ.
3. Finer rows: split `validation-failed` into `patch-failed`,
   `endpoint-constraint-violation`, and `type-contract-violation`. More
   precise, but all three are `422`/`never` and `diagnostics` already
   locates the failure; more rows is more table to keep closed.

**Recommendation.** Option 1. The names are the part most worth the
operator's eye: `identity-taken` and `incident-links-exist` in particular
are plain rather than formal, and `aggregate-constraint-violation` is
generic on purpose so that later aggregate policies need no new row.

**Boundaries completed (council 9).** The taxonomy is unchanged; the
classifications the council found implicit are now explicit: a binding
whose creator ended transiently is `idempotency-in-progress`, not
`binding-unavailable` (D15); a replay whose retained record the present
view does not project is `forbidden` (D21); a durable reference whose
spelling is not a canonical reference of the required kind, or that names
a Resource of another kind, is `resource-not-found` — the subject does
not exist as the required kind, under the same non-disclosure rule; a
patch `path` that is not a JSON Pointer and a `@name` in a singleton are
carrier syntax, `malformed-request` before execution; and an owned set
that would exceed the owning Type's declared `max` is `validation-failed`
with a diagnostic naming the owning Bead Type and its `ownsOutgoing`
entry, because the source's resulting state violates its declared Type.
The operator may prefer `aggregate-constraint-violation` for the owned-set
case; the packet chose the Type-contract reading because `max` is declared
by the Type Descriptor, not by Scope policy.

**Depends on this decision.** The eleven-row table and the "The Read+Update
rows mean:" list under *Problem details*; bundle `readUpdateProblemCode`
and the `readUpdateProblem` branches; `packages/protocol/src/read-update-wire.test.ts`
holds the same rows and fails on drift.

## D14 — `unsupported-media-type` now

**Context.** The Read table "deliberately omits" codes for unacceptable
response media types and unsupported request media types. Read has no
request bodies; Read+Update does.

**Options.**

1. Assign `unsupported-media-type` (`request`, `415`, `never`) for mutation
   targets now, and leave the response-media-type (`406`) condition
   unassigned as before. A `POST` carrier cannot be implemented without a
   normative answer to a non-JSON body.
2. Keep both deferred; answer a non-JSON body with a bodyless `415`, like
   `405`. Consistent with the Read table's silence, but a second
   HTTP-native rejection that carries no BDP Problem, for a condition BDP
   can name.

**Recommendation.** Option 1.

**Depends on this decision.** The row "| `unsupported-media-type` |
`request` | 415 | `never` |" and, under *Problem details*: "the Read+Update
rows above assign the latter, for mutation targets only, as
`unsupported-media-type`."

## D15 — `binding-unavailable` family and status

**Context.** A sequence member that references a forward, unknown, failed,
or wrong-kind `@name` "fails normally" per the draft, while the batch text
rejects the whole request for the statically detectable cases. A member
failure needs a code.

**Options.**

1. Family `request`, `400`, `never`. The member as written can never
   succeed: a forward or unknown name is a client error, and a failed
   binding means the creating member's retained disposition is a failure,
   so a retry under the same keys reproduces it.
2. `424 Failed Dependency`. Semantically exact for the failed-binding case,
   but an unfamiliar status BDP uses nowhere else, and wrong for the
   forward/unknown cases.
3. Family `conflict`, `409`, `after-state-change`. Treats the failed
   creation as state, but nothing a client can refresh makes the same
   request succeed.

**Recommendation.** Option 1.

**Revised (council 9).** `400`/`never` fits a permanently failed binding —
and, under D27, only that: forward, unknown, and wrong-kind references are
carrier syntax rejected before execution. A binding missing because
its creator is in flight elsewhere, or ended `rate-limited` or
`temporarily-unavailable` in this request, is not a client error: the
dependent member now fails transiently with `idempotency-in-progress`, the
authority consults no key state for it, executes nothing, retains nothing,
and releases its claim, so a retry after the delay executes the
creator and then the dependent, and a concurrent retry can never poison
the dependent member of the request that first presented the keys.
Unrelated later members still run. The alternatives were Gemini's — halt
the whole request at the first `idempotency-in-progress` and fail every
remaining member transiently, which is simpler but abandons "later
independent work can run" — and mirroring the creator's own transient code
on the dependent, which reports a `rate-limited` dependent that was never
rate-limited; one code for "your binding's creator has not resolved, retry
after the delay" was preferred.

**Depends on this decision.** The row "| `binding-unavailable` | `request`
| 400 | `never` |" and, under *Sequence request envelope*: "A reference to
a creating member whose retained disposition is a failure fails that
member with `binding-unavailable`, a retained failure; a reference to a
creating member whose disposition in this request was transient —
`idempotency-in-progress`, `rate-limited`, or `temporarily-unavailable` —
is transient too: the member fails with `idempotency-in-progress`, the
authority consults no key state for it, executes nothing, retains nothing,
and releases its claim on the member's key". Problem-row meaning of
`binding-unavailable`. Fixtures `sequence-dependent-bindings.json` and
`sequence-idempotent-retry.json`; catalog rows
`read-update.sequence.transient-predecessor` and
`read-update.idempotency.concurrent-dependent-retry`.

## D16 — Validation diagnostics and their limits

**Status: RULED A 2026-09-08** (Q25: mandatory nonempty diagnostics with Type and absolute schema location for Type-contract failures; truncation only against an advertised bound).

**Context.** Under *Link endpoint constraints* the draft says a validation
failure "returns a bounded diagnostic list identifying the failing
effective Type and schema location" and that "Discovery advertises the
diagnostic count and byte limits" — but the *Advertised limits* list had no
such group and no diagnostic shape existed anywhere.

**Options.**

1. Define now, minimally: `validation-failed` MAY carry `diagnostics`, an
   array of closed `{ type?, schemaLocation?, instanceLocation?, message }`
   entries, and `limits.validation.diagnostics` /
   `limits.validation.diagnosticBytes` bound it. Resolves a dangling
   promise in the draft with the smallest shape that names Type, keyword
   location, and instance pointer; optional, so a small authority may omit
   it.
2. Defer the shape; `detail` carries prose. Leaves the sentence about
   advertised diagnostic limits unbacked and makes machine-readable
   validation feedback vendor-specific.
3. Adopt the JSON Schema 2020-12 output format verbatim. Rich, but large,
   schema-dialect-specific, and not what endpoint or patch failures
   produce.

**Recommendation.** Option 1 as originally drafted was rejected by the
council: making the list and both identifying fields optional weakened the
existing normative sentence that a validation failure "returns a bounded
diagnostic list identifying the failing effective Type and schema
location" (Codex M5).

**Revised (council 9).** The small shape and the `validation` limits group
are kept; the mandatory content is restored. `validation-failed` MUST carry
a nonempty `diagnostics` array. For an effective Type-contract failure
every entry names the effective Type in `type` and the failed keyword in
`schemaLocation` — the absolute keyword location, the contract schema's
`$id` plus a JSON Pointer fragment, as JSON Schema output defines it —
and, when the failure lies within `properties`, `instanceLocation`, a JSON
Pointer within `properties`; an owned-set overflow names the owning Bead
Type and its descriptor's `ownsOutgoing` entry. For the causes without a
Type-schema location — a missing patch target, a non-object result, an
endpoint constraint, an external-endpoint policy — `type` and
`schemaLocation` are absent, `message` names the cause, and
`instanceLocation` locates it when it lies within `properties`; the two
identifying fields are present together or not at all. When the complete
set exceeds a bound, the authority keeps at least one entry in evaluation
order, sets `diagnosticsTruncated` to `true`, and MUST have advertised
that bound; an authority that advertises neither bound returns the
complete list. Silent truncation is what *Advertised limits* forbids
generally, so the marker was preferred over an unannounced cut.

**Depends on this decision.** Under *Problem details*: "The problem MUST
carry `diagnostics`: a nonempty, bounded array of `{ type?,
schemaLocation?, instanceLocation?, message }` entries." through "No other
code carries `diagnostics` or `diagnosticsTruncated`." Under *Link endpoint
constraints*: "An authority that bounds the list advertises
`validation.diagnostics` and `validation.diagnosticBytes` in its
Read+Update discovery document's `limits`." Under *Advertised limits*: the
`validation.diagnostics` / `validation.diagnosticBytes` bullet. Bundle:
`validationDiagnostic` (`dependentRequired`), `validationDiagnostics`,
`readUpdateProblem` (`diagnosticsTruncated`, the required-diagnostics
branch), the `readUpdateAdvertisedLimits.validation` group.

**Corrected (D29 ruled C, 2026-09-08).** The `validation` limits group is
Read+Update surface. The draft had placed it in the shared
`advertisedLimits`, which `readDiscovery` references, so the Read
projection of the bundle had changed under the seal; the group now lives
only in `readUpdateAdvertisedLimits`, and `advertisedLimits` is
byte-identical to the bundle at `0b7d86e7`. The bullet under *Advertised
limits* says the group is Read+Update surface, and the *Link endpoint
constraints* sentence names the Read+Update discovery document as where
the bounds are advertised.

## D17 — Carrier discipline: keys, names, and the stray field

**Context.** Several syntactic conditions had no stated disposition: a key
repeated within one sequence, an `Idempotency-Key` field on a sequence
request, a singleton without one, and duplicate or invalid `name` values.

**Options.**

1. All are carrier syntax, rejected before execution with the direct
   `malformed-request`; the stray field is rejected rather than ignored.
   Nothing partial ever commits for a malformed carrier; a client that
   sends a carrier-level key does not understand the carrier, and BDP
   already treats unsupported parameters as errors rather than
   instructions to ignore.
2. Handle a repeated key member-by-member (the second occurrence is a
   within-request duplicate: retained disposition or conflict). Consistent
   with the general key rules, but it lets a buggy client commit half a
   sequence before its bug is reported.
3. Ignore a stray `Idempotency-Key` field, as HTTP conventionally ignores
   unknown fields. Silently drops what the client believed was protecting
   it.

**Recommendation.** Option 1.

**Extended (council 9).** D27 applies this decision's own rationale to
static `@name` errors: a forward, unknown, or wrong-kind reference is
decidable from the request text and is a carrier rejection, as in a batch.

**Depends on this decision.** Under *Read+Update sequence target*: "a
sequence request that carries the field is rejected before execution with
`malformed-request`." Under *Sequence request envelope*: "Two members of one
sequence MUST NOT carry the same `idempotencyKey`; a sequence that repeats a
key is rejected before execution with `malformed-request`, as is one whose
`name` values repeat or whose key or name violates its syntax." Under
*Idempotency keys*: "as is a singleton request that omits the field."

## D18 — Client disconnection after admission

**Context.** The Transactional profile says admission decides the outcome
and disconnection does not. Read+Update's non-atomic carrier could instead
stop at the next member boundary.

**Options.**

1. An admitted sequence runs every remaining member to its terminal
   disposition and retains each; a retry recovers the lost response member
   by member. One rule ("admission decides"), no partially-observed
   half-runs whose extent the client cannot know, and it is exactly the
   case retained dispositions exist for.
2. Stop before starting the next member when the client is gone. Wastes
   less work on abandoned requests, but "gone" is not reliably observable
   mid-request, and the client must then discover how far the sequence got.

**Recommendation.** Option 1.

**Qualified (council 9).** Client disconnection is not an authority
failure: an authority crash, restart, or failover mid-sequence is D23's
case, not this one. Only retainable dispositions are retained after a
disconnect, consistent with D4. And "every other failure is a member
problem" respects the existing body-less `500` rule: an unexpected internal
fault mid-sequence is the body-less `500`, members with a durable
disposition stay retained, the faulting member's claim is cleared, and the
client resubmits exactly as after a crash.

**Depends on this decision.** Under *Sequence request envelope*: "Once the
authority has admitted a sequence — validated its carrier and
operation-record syntax and started its first member — client
disconnection does not decide any member's outcome." and "Client
disconnection is not an authority failure". Under *Sequence response
envelope*: "an unexpected internal fault is the body-less `500` under
Problem details even mid-sequence." Catalog rows
`read-update.sequence.disconnect` and `read-update.sequence.internal-fault`.

## D19 — Methods and `Allow` values for the mutation surface

**Context.** The Read profile's method rules end with "Those profiles define
their additional methods and `Allow` values."

**Options.**

1. Mutation targets accept `POST` only and answer every other method with
   a bodyless `405` and `Allow: POST`; the Operation Directory accepts
   `GET` and `HEAD` and answers otherwise with `405` and
   `Allow: GET, HEAD`; `OPTIONS` joins `Allow` exactly as in Read when
   cross-origin access is enabled. Mirrors the Read rule shape.
2. Also answer `GET` on a mutation target with a description of the target.
   Friendly to browsers, but a second representation with no protocol
   meaning.

**Recommendation.** Option 1.

**Clarified (council 9).** The CORS-enabled `OPTIONS` exception is stated
explicitly: when cross-origin access is enabled, `OPTIONS` is answered
according to the CORS rules rather than with `405`, and it joins `Allow`;
merely listing it in `Allow` is not the preflight behavior.

**Depends on this decision.** Under *Operation Directory and singleton
targets*: "A mutation target responds `405 Method Not Allowed` with
`Allow: POST` to every other method, and the Operation Directory responds
`405` with `Allow: GET, HEAD` to every method but those two" and "when
cross-origin access is enabled, `OPTIONS` is answered according to the
CORS rules rather than with `405` and joins `Allow`; listing it in `Allow`
is not the preflight behavior."

## D20 — Discovery and directory definitions

**Context.** The bundle had only `readDiscovery` (profile `read`). The
Read+Update discovery membership table and the exact seven-member directory
JSON existed only in prose.

**Options.**

1. Add `readUpdateDiscovery` as a separate closed definition — the Read
   members, `profile: "read-update"`, and a required `operations` URL, with
   every Transactional member prohibited by closure — and
   `readUpdateOperationDirectory` pinning the seven relative target
   spellings as constants. Structural projection of prose the draft already
   fixes ("fixed BDP vocabulary").
2. One `discovery` definition with `if/then` per profile. Fewer names, but
   each profile's required and prohibited members become branch logic
   instead of a readable closed shape.

**Recommendation.** Option 1.

**Tightened (council 9).** Closure prohibited Transactional members at the
top level only: `limits` referenced the unrestricted shared definition, so
a Read+Update discovery document carrying `limits.transaction.operations`
and `limits.retention.receipt` validated (Codex M7). `readUpdateDiscovery`
now references `readUpdateAdvertisedLimits`, which composes the shared
`advertisedLimits` primitives and rejects the `transaction` group and the
Transactional `retention.receipt` and `retention.replay` members, while
keeping `retention.idempotency` and the pagination
`retention.maximumSnapshotLifetime` that Read's snapshot-preserving
cursors already use. `readDiscovery` is untouched: it is sealed Read
surface, and the same tightening there is a separate proposal.

**Corrected (D29 ruled C, 2026-09-08).** `readUpdateAdvertisedLimits` no
longer composes `advertisedLimits` by reference. The shared definition is
closed, so once the `validation` group was withdrawn from it under D29 no
composition could admit the group; the Read+Update definition is now a
closed definition of its own — the `page`, `request`, `resource`,
`selector`, `patch`, and `sequence` groups restated unchanged and held
equal to `advertisedLimits` by the lockstep test, the `validation` group,
and a `retention` group of `idempotency` and `maximumSnapshotLifetime`
only — sharing the `positiveInteger` and `iso8601Duration` primitives.
The rejections Codex M7 asked for are unchanged: `transaction`,
`retention.receipt`, `retention.replay`, and any unknown group fail
closure.

**Depends on this decision.** Under *Operation Directory and singleton
targets*: "The bundle defines the Read+Update discovery document as
`readUpdateDiscovery` and the directory response above as
`readUpdateOperationDirectory`." Under *Advertised limits*: "the
Read+Update discovery document's `limits` is `readUpdateAdvertisedLimits`,
a closed definition of its own that shares every limit primitive with
`advertisedLimits`". Bundle: `readUpdateAdvertisedLimits`. Catalog row
`read-update.discovery.limits`.

## D21 — Replay re-authorization

**Status: RULED A 2026-09-08** (Q21: replay re-authorizes disclosure; key, identity, and outcome preserved; non-disclosing `forbidden` replaces nothing and executes nothing).

**Context.** The draft returned a retained postimage unconditionally. A
principal could create or update a Resource, lose access to it, replay its
key, and receive the old record — owned Links and their targets included —
which contradicts *Authorization views*: every representation for a
request observes its authorized projection (Codex H1).

**Options.**

1. Keep the key, its semantic identity, and its terminal outcome retained
   and principal-bound; re-authorize *disclosure* of a retained `created`
   or `updated` record against the present request's Authorization View on
   every replay; when the view no longer projects the record, answer the
   member with `forbidden` carrying nothing retained. That response is not
   a disposition: it replaces neither the outcome nor the identity, permits
   no execution, and a later replay under a view that projects the record
   receives the original disposition. Retained problems and `deleted`
   identities disclose no record and are returned as retained. Mirrors the
   Transactional rule that detailed receipt results are re-authorized when
   later read.
2. Answer with the uniform `resource-not-found`. The Read non-disclosure
   code, but a creation member has no subject to be "not found", and the
   code's meaning — the subject does not exist or is not visible —
   misdescribes a retained allocation the principal itself made. The
   enumeration-oracle argument for `404` does not apply: the namespace is
   principal-bound, so no other principal can present the key.
3. Return the retained disposition regardless. The draft; violates the
   projection rule.
4. Execute again under the present view. Violates exactly-once.

**Recommendation.** Option 1. Note what it cannot hide: a replay that is
refused differs from an unknown key that executes, so a principal always
learns that *some* disposition exists under its own key. That is
inherent in any option except re-execution, and the key is the
principal's own.

**Depends on this decision.** Under *Duplicate keys and retained
dispositions*: "Returning a retained result discloses a Resource record, so
it observes the present request's Authorization View like every other
representation" through "Retained problems and `deleted` identities
disclose no record and are returned as retained." Under *Authorization
views*: "a retained Read+Update disposition is re-authorized for
disclosure when it is replayed". Under *Idempotency keys*: "though its
disclosure is re-authorized on every replay". Under *Problem details*: "as
does the replay of a retained result whose record the present
Authorization View does not project". Fixture
`idempotency-recovery.json`, exchanges
`replay-after-view-change-is-re-authorized` and
`replay-after-visibility-is-restored-returns-the-retained-disposition`.
Catalog row `read-update.idempotency.authorization-view`.

## D22 — Durable boundary and in-flight recovery

**Status: RULED A 2026-09-08** (Q22: mutation, semantic identity, allocated identities, and terminal disposition are one atomic durable unit; abandoned claims cleared on restart; one authoritative key state; restore losing recovery state is a different Scope URL).

**Context.** "Executes and its disposition is retained" never required the
mutation and its disposition to become durable together. A crash between
them could leave an allocated Resource committed behind an unknown key, or
an in-flight key answering `idempotency-in-progress` forever; the logical
single-writer rule said nothing about recovering that state on restart or
failover, two mutation routes could each think a key unknown, and
preserving tombstones alone does not preserve an unexpired result's
promised retention interval (Codex H3).

**Options.**

1. One atomic durable unit — the mutation, its semantic identity, the
   identities it allocated, and its terminal disposition — so a key is
   either unknown with nothing committed or retained with its committed
   outcome. Claims are made at admission for a sequence (D26) and before
   execution for a singleton. A claim abandoned by a crash (no durable
   disposition) is *cleared* on restart or failover, so a retry executes
   the member once;
   the authority never completes an abandoned member on its own. Every
   mutation route — each singleton target, the sequence target, every
   mutating replica — consults one authoritative key state. Recovery state
   is every unexpired retained disposition, every tombstone, and the
   resolution of every claim; restart and failover preserve it, and a
   restore that cannot is a different logical Scope at a different
   canonical Scope URL under the existing identity rule.
2. *Resume* abandoned claims: the authority persists the admitted member
   and completes it during recovery. Saves the client a retry, but requires
   durable request bodies before execution and a recovery executor, and
   the client cannot tell a resumed execution from a cleared one until it
   retries anyway.
3. Tombstones only as recovery state. Simpler restore, but an unexpired
   disposition lost on restore answers `idempotency-expired` inside the
   advertised minimum, which breaks D25's only observable promise.

**Recommendation.** Option 1, clearing rather than resuming. The clear is
the choice a client can already handle: it retries and either recovers the
disposition or executes once.

**Depends on this decision.** Under *Durability and recovery*, the first
three paragraphs: "A member's mutation, its semantic identity, the
identities it allocated, and its terminal disposition become durable
together" through "a client MUST NOT treat a restored Scope as a
transparent continuation of the old key namespace." Fixture
`idempotency-recovery.json`, exchanges
`retained-across-restart-and-failover`,
`abandoned-in-flight-claim-is-cleared-on-restart`, and
`restore-losing-recovery-state-is-a-different-scope`. Catalog rows
`read-update.idempotency.durable-boundary` and
`read-update.idempotency.restore`.

## D23 — Authority crash mid-sequence: resume or resubmit

**Status: RULED A 2026-09-08** (Q22: resubmit, not resume, after an authority crash mid-sequence).

**Context.** D18 covers client disconnection only. An authority that
crashes after some members committed and before others started needs a
rule for the unstarted ones (Codex H3, D18 assessment).

**Options.**

1. *Resubmit*: committed members stay retained, the member in flight is an
   abandoned claim recovered under D22, and unstarted members are never
   executed by recovery — the authority does not resume a sequence. The
   client resubmits; retained dispositions answer the committed members
   and the rest execute in order. No durable request queue, no execution
   the client did not just ask for, and the client's existing retry path
   is the recovery path.
2. *Resume*: the authority persists the admitted sequence and runs the
   unstarted members after recovery. Symmetric with D18's "admission
   decides", but it turns admission into durable intent the client can no
   longer withdraw, and a client that disconnected *and* saw the authority
   fail cannot know whether its members are still coming.

**Recommendation.** Option 1. D18 stays as it is: disconnection decides
nothing because the *authority* is still running the members; a crash
means it is not.

**Depends on this decision.** Under *Durability and recovery*, the last
paragraph: "An authority crash is not a client disconnection." through
"the remaining members execute in order." Under *Sequence request
envelope*: "Client disconnection is not an authority failure". Fixture
`idempotency-recovery.json`, exchange
`crash-mid-sequence-resubmission-completes-the-sequence`. Catalog row
`read-update.idempotency.crash-mid-sequence`.

## D24 — Binding metadata in tombstones

**Status: RULED A 2026-09-08** (Q24: tombstones keep allocated identity and kind so expired creators still bind dependents).

**Context.** A fingerprint-only tombstone cannot reconstruct the identity
an expired creation allocated. On retry the creator answers
`idempotency-expired`, and its dependent's `@name` could then compare an
unresolved spelling against a previously resolved identity, so an
unchanged request received `idempotency-conflict` even though the
dependent's own result was still retained (Codex H4).

**Options.**

1. Retain, in the tombstone of a creation that allocated an identity, that
   identity and its Resource kind — binding metadata — so that a later
   `@name` reference resolves through an expired creator exactly as through
   a retained one, and the dependent's semantic identity uses the resolved
   binding (D3). Two small members per creation tombstone; no new
   disposition; the dependent behaves identically whether its creator is
   fresh, retained, or expired.
2. Define a dependency-expiry disposition: a dependent whose creator
   expired fails with a new code. Honest, but it classifies missing
   recovery metadata as a client-visible failure of a request the client
   did not change, and it adds a row.
3. Treat the case as `idempotency-conflict`. The draft's accidental
   behavior; punishes an unchanged retry.

**Recommendation.** Option 1.

**Depends on this decision.** Under *Outcome retention*: "and, for a
creation that allocated an identity, that identity and its Resource kind,
through which a later `@name` reference still resolves". Under *Sequence
request envelope*: "or an `idempotency-expired` disposition, whose
tombstone keeps the identity the creation allocated and its Resource
kind". Under *Idempotency keys*: "taken from that member's fresh,
retained, or expired disposition, never from the spelling". Fixture
`sequence-dependent-bindings.json`, exchange
`expired-creator-still-binds-its-dependent`. Catalog row
`read-update.sequence.expired-creator-binding`.

## D25 — The recovery window

**Status: RULED A 2026-09-08** (Q24: the client MUST applies only when `retention.idempotency` is advertised; otherwise no client-known recovery window).

**Context.** The draft made a client "MUST retry within" an interval the
authority need not advertise or return, which a client cannot satisfy
predictably; and the expiry row's title said a key presented "after
retention" fails although the text lets an authority retain longer
(Codex M6).

**Options.**

1. The client MUST applies only when `retention.idempotency` is
   advertised. When it is not, the specification says plainly that no
   client-known recovery window exists: the authority still retains for a
   finite interval of its choosing, a late retry may be answered by the
   retained disposition or by `idempotency-expired`, and a client that
   needs a recoverable window uses an authority that advertises one.
   Conformance tests expiry after *controlled eviction* of the disposition,
   not merely after the advertised minimum elapses, and keeps the
   `410`-same-identity / `409`-different-identity distinction.
2. Require Read+Update authorities to advertise `retention.idempotency`.
   Observable everywhere, but it makes `limits` mandatory for one profile
   when *Advertised limits* deliberately keeps it optional for small
   implementations.
3. Return the deadline on every mutation response. Observable per
   response, but a new response member on every success for a value most
   clients never read.

**Recommendation.** Option 1.

**Depends on this decision.** Under *Outcome retention*: "When the limit is
advertised, a client that needs a lost response MUST retry within it. When
it is not, no client-known recovery window exists" through "uses an
authority that advertises one." Catalog rows
`read-update.idempotency.retention-minimum` and
`read-update.idempotency.expired`; fixture
`sequence-idempotency-dispositions.json`, exchange
`expired-key-never-executes-again`, whose condition narrates controlled
eviction.

## D26 — Key reservation at admission

**Status: RULED A 2026-09-08** (Q23: every member's key is reserved at admission in declaration order; a reservation that does not survive restart is released).

**Context.** A key became in flight only when its member started. A
byte-identical resubmission of an admitted sequence could therefore run its
*later* members before the original reached them: the retry's first
member met the in-flight key, but its second member's key was still
unknown and executed out of order — poisoning `@name` dependents under the
old D3 rule, and, even after D15's fix, reordering members that depend on
each other through state rather than through `@name` (a `createLink` to
`X` followed by `deleteBead X` yields different outcomes in the two orders,
and both would be retained). Dependency normalization does not see that
case (Claude H1).

**Options.**

1. Claim every member's unknown key at admission, in declaration order,
   before the first member starts; a claimed key is in flight until its
   member reaches a terminal outcome. A concurrent resubmission is then
   transient in every member the original will run, so it can neither
   execute ahead of the original's earlier members nor retain a
   disposition the original would contradict. Members whose keys could not
   be claimed — retained, expired, or in flight elsewhere — are answered in
   their turn, as of that turn. Composes with D15 (same-request transient
   creators) and with D22 (a claim abandoned by a crash is cleared, so the
   claims of unstarted members vanish with the crash and D23's resubmission
   executes them).
2. Keep per-member claiming and accept that a concurrent resubmission may
   reorder state-dependent members. Simpler, but it makes "members run
   strictly in declaration order" false across a retry, which is the case
   retries exist for.

**Recommendation.** Option 1.

**Depends on this decision.** Under *Read+Update sequence target*: "claims
every member's key in declaration order under Duplicate keys and retained
dispositions". Under *Duplicate keys and retained dispositions*: "A key is
**claimed** before it executes" through "retain a disposition the original
would contradict." and item 3, "claimed by a request whose member has not
reached a terminal outcome". Under *Durability and recovery*: "A sequence
claims every member's unknown key at admission and a singleton claims its
key before executing". Fixture `sequence-idempotent-retry.json`, exchange
`concurrent-retry-meets-the-creator-in-flight`. Catalog row
`read-update.idempotency.key-reservation`.

## D27 — Static reference errors are carrier rejections

**Status: RULED A 2026-09-08** (Q23: forward, unknown, and wrong-kind `@name` references are carrier rejections; `binding-unavailable` only for a creation that failed).

**Context.** D15 made forward, unknown, and wrong-kind `@name` references
member failures while D17 rejected repeated keys and names before
execution, and D17's own rationale — nothing partial commits for a request
the client wrote wrong — applies to a forward reference exactly as to a
repeated name; the batch text already rejects all four for the whole
request (Claude M2).

**Options.**

1. A `@name` reference that is forward, unknown, or of the wrong Resource
   kind is carrier syntax, decidable from the request text: the sequence is
   rejected before execution with `malformed-request`, as a batch rejects
   it. `binding-unavailable` narrows to the one case that is not static — a
   creating member whose retained disposition is a failure. Parity with
   batch, consistency with D17, and fewer retained `binding-unavailable`
   failures for D4's re-key rule to bite on.
2. Keep them as member failures so that later independent members still
   run. Keeps more of a buggy request executing; but a client that writes a
   forward reference does not understand the carrier, and "later work
   still runs" was never the reason to execute half of a request the
   authority could have refused whole.

**Recommendation.** Option 1.

**Depends on this decision.** Under *Read+Update sequence target*: "A
reference that is forward, unknown, or of the wrong Resource kind is
decidable from the request text and is rejected before execution, as in a
batch." Under *Sequence request envelope*: "A `@name` reference that is
forward, unknown, or of the wrong Resource kind is carrier syntax,
decidable from the request text: the sequence is rejected before execution
with `malformed-request`, exactly as a batch rejects it." Problem-row
meaning of `binding-unavailable`. Fixtures `carrier-rejections.json`
(exchanges `unknown-binding`, `forward-binding`, `wrong-kind-binding`) and
`sequence-partial-failure.json` (the unknown `@adr` member replaced by a
Read-coded `resource-not-found` member). Catalog rows
`read-update.sequence.local-bindings` and
`read-update.sequence.carrier-rejection`.

## D28 — Tombstones only for committed effects

**Status: RULED A 2026-09-08** (Q19, with D6).

**Context.** D6 kept a Scope-lifetime tombstone for *every* retained
disposition, so any authenticated principal could grow permanent storage
with requests that commit nothing — a principal whose every request is
`forbidden` still minted tombstones (Claude M3, Codex M6).

**Options.**

1. After the retention interval, a disposition that committed state —
   `created`, `updated` including a semantic no-op, or `deleted` — keeps
   its compact tombstone for the Scope's lifetime, exactly as before; a
   retained failure committed nothing, so after the interval the authority
   MAY forget it entirely, and a later presentation of its key is unknown
   and executes — a first execution, under whatever guards the request
   carries. Tombstone storage is bounded by committed effects, which
   identity tombstones already bound. Exactly-once is a promise about
   effects, and a failed member had none.
2. Keep tombstones for every disposition. Deterministic answers forever,
   at the cost of unbounded, principal-growable storage.
3. Forget failures immediately. Loses D4's determinism within the window
   for no storage gain worth having.

**Recommendation.** Option 1. What changes for a client: within the
interval a failed key answers the same way every time; after it, a retry
of a failed member may execute and succeed, which is the friendly outcome
for `forbidden` after a grant. A client that needs the window observable
uses an authority that advertises `retention.idempotency` (D25).

**Depends on this decision.** Under *Outcome retention*: "For a
disposition that committed state — `created`, `updated` including a
semantic no-op, or `deleted` — it MUST then retain a compact tombstone"
through "and no principal can grow it with requests that commit nothing."
and "A retained failure committed nothing: after the interval the
authority MAY forget it entirely, and a later presentation of its key is
unknown and executes". Under *Duplicate keys and retained dispositions*:
"for as long as it is retained; what outlives the retention interval
differs". Fixture `sequence-idempotency-dispositions.json`, exchange
`expired-failure-executes-as-new`. Catalog row
`read-update.idempotency.expired-failure`.

## D29 — The sealed Read cohort binds a stale schema digest

**Status: RULED C (2026-09-08).** The sealed Read cohort binds the digest
of the Read-reachable projection of the bundle, and a separate PR adds
that gate; the consequence for this branch is that the `validation`
limits group is withdrawn from the shared `advertisedLimits`, which
`readDiscovery` references, into `readUpdateAdvertisedLimits`, so that
every definition reachable from the Read definitions is byte-identical to
the bundle at `0b7d86e7` and the Read projection at this head is exactly
what the seal attests.

**Context.** This is an evidence-discipline finding, not a wire decision,
and it is the operator's to act on. The Read cohort artifact binds the
bundle at `0b7d86e7` (digest `552329e6…`). The draft's first commit added
the `validation` group to `advertisedLimits`, a definition reachable from
`readDiscovery`, so Read discovery now accepts a `limits.validation` group
it rejected when sealed; this fold adds nothing to `advertisedLimits` but
adds six more definitions to the bundle. (The whole-bundle digest the fold
recorded here, `0dd903d4…`, matches no committed bundle; the fold commit's
bundle digests `febd266e…`, and after the corrective below it digests
`14d3c207…` — a figure the ruling makes immaterial, since the seal
attests the Read-reachable projection, not the whole bundle.)
`pnpm evidence:verify` is green because the gate checks the `schema`
binding's presence and shape and never recomputes it against the current
bundle (Claude H3).

**Options.**

1. Re-seal the Read cohort at the merge head with `pnpm evidence:generate`,
   which this fold may not run.
2. Add a gate rule that recomputes `bindings.schema` and refuses any
   bundle change reachable from a Read definition, under which this branch
   must re-seal because `advertisedLimits` is reachable from
   `readDiscovery`.
3. Accept and document: the sealed cohort proved the Read surface against
   the bundle as it was, and the reachable change is additive
   (`readDiscovery` accepts one more optional group).

**Recommendation.** Option 2 for the repository, applied by the operator
outside this fold; this fold applies option 3's documentation only, in
STATUS.md and here, and makes no claim that the Read cohort covers the
current bundle.

**Ruled C (2026-09-08).** Option 2's gate, defined over the Read-reachable
projection of the bundle rather than the whole bundle, is a separate PR.
For this branch the ruling means the corrective recorded under
[Council 9 fold](#council-9-fold): `advertisedLimits` is restored to its
bytes at `0b7d86e7`, `readUpdateAdvertisedLimits` carries the
`validation` group (D16 and D20 corrected), and the Read projection at
this head is unchanged, so no re-seal is required and none is claimed.

**Depends on this decision.** STATUS.md's evidence-discipline paragraph;
after the ruling, also the bundle's `advertisedLimits` and
`readUpdateAdvertisedLimits`, the *Advertised limits* definition sentence
and the `validation` bullet, the *Link endpoint constraints* advertising
sentence, and catalog row `read-update.discovery.limits`.

## D30 — A member-level delay hint

**Context.** `after-delay` problems "SHOULD carry `Retry-After`", but a
member problem lives inside a `200 OK` envelope, where `Retry-After` has no
carrier and no standard meaning (Claude M5).

**Options.**

1. An optional `retryAfter` member — a non-negative integer of
   delay-seconds — on a member problem whose `retry` is `after-delay`;
   rejected by the bundle on any other problem. The member-level
   counterpart of `Retry-After`; the header's SHOULD applies to direct
   problems; a member problem without it gives no hint and the client
   backs off on its own.
2. State that member-level `after-delay` carries no hint. Honest and
   smaller, but it leaves the client guessing exactly where the authority
   knows the answer — how long the in-flight member will take.

**Recommendation.** Option 1.

**Depends on this decision.** Under *Sequence response envelope*: "A member
problem whose `retry` is `after-delay` MAY carry `retryAfter`, a
non-negative integer of delay-seconds" through "the client backs off on its
own." Bundle: `readUpdateProblem.retryAfter` and its `after-delay` branch.
Fixtures `sequence-idempotent-retry.json` and
`sequence-idempotency-dispositions.json` (in-progress members carrying
`retryAfter`). Catalog row `read-update.sequence.retry-after-hint`.

## D31 — Alias mutation is deferred beyond Read+Update

**Context.** *Aliases* said alias creation, repointing, and deletion "are
defined with the mutation profiles", but the Read+Update Operation
Directory is exactly the six singleton targets plus `sequence`, so the
promise dangled for this profile (Claude M8).

**Options.**

1. Defer: alias mutation is beyond Read+Update; a Read+Update Scope serves
   alias resolution over aliases established administratively, and alias
   mutation targets are defined with the Transactional profile or the
   administrator specification. Keeps the seven-entry directory the draft
   fixed and the Read-surface resolution rule unchanged.
2. Add alias targets to Read+Update now. Extends the directory, the
   bundle, the rows, and the fixtures for a surface no profile has designed.

**Recommendation.** Option 1.

**Depends on this decision.** Under *Aliases*: "Alias creation, repointing,
and deletion are mutation surface deferred beyond the Read+Update profile"
through "defined with the Transactional profile or the administrator
specification." Catalog row `read-update.discovery.no-alias-mutation`.

## D32 — The member that carries the deleted identity record

**Context.** Cross-packet X1 was ruled B on 2026-09-08: a `deleted`
outcome carries the identity record
`{ resourceKind, resource: { id, type, revision } }` in both write
profiles, `revision` the Resource's final live revision — the revision it
had when it was deleted, not a newly minted one, because deletion mints
nothing — matching the Transactional changefeed tombstone and
`DeletedData.revision`. D9's bare URL is superseded. The ruling fixes the
record; it leaves open which result member carries it and how the bundle
spells it.

**Options.**

1. `deleted` remains the member name and becomes the record; `resource`
   stays the complete postimage of `created` and `updated`, and the two
   members remain mutually exclusive per outcome exactly as the bundle
   already held `resource` and `deleted` apart. The bundle spells the
   record as `deletedIdentity` — `resourceKind` (`bead` or `link`) and
   `resource` as `resourceIdentity`, the closed `{ id, type, revision }`
   whose member types are the Bead and Link records' own — reusing the
   Transactional packet's `resourceKind` and `resourceIdentity` names and
   shapes so the two profiles paste together. A client reads
   `deleted.resource.id` where it read `deleted`; every other member is
   untouched, and a deleted owned Link still carries `source` and
   `sourceRevision` beside its identity.
2. Carry the record's members at the top level of the result:
   `resourceKind` beside a `resource` that is an identity on `deleted` and
   a postimage otherwise. Literal to the ruling's spelling and one level
   flatter, but it makes `resource` polymorphic — the shape D9 rejected as
   its option 2 — and a result copied out of its envelope no longer says
   by its member names whether `resource` is a record or an identity.
3. Spell the identity flat under `deleted` as `{ id, type, revision }`
   without `resourceKind`, the Transactional packet's draft bundle text.
   Shorter, but not the ruled record: the ruling names `resourceKind`,
   which is what the changefeed tombstone carries and what the
   idempotency tombstone retains for an allocated identity.

**Recommendation.** Option 1, applied.

**Depends on this decision.** Under *Mutation results*: the `deleted?`
line of the sketch; "`deleted` carries `deleted`, the identity record of
the removed Resource, and no Resource record: `resourceKind`, `bead` or
`link`, and `resource`, holding the absolute canonical `id`, the immutable
`type`, and `revision`, the Resource's final live revision." through "The
bundle defines the identity record as `deletedIdentity`, over
`resourceKind` and `resourceIdentity`."; and the owned-Link sentence "a
deletion returns the Link's identity and no Link record, so `source` is
the only member that names the source Bead whose revision
`sourceRevision` reports." Bundle: `resourceKind`, `resourceIdentity`,
`deletedIdentity`, and `mutationResultMembers.deleted` in both its
`properties` and its `deleted`-outcome branch. Fixtures: every `deleted`
outcome — `singletons.json` (`delete-bead`,
`delete-link-owned-versions-the-source`), `sequence-positive.json`,
`idempotency-recovery.json`, `sequence-idempotency-dispositions.json` —
each carrying the revision the member guarded as the final live revision.
Catalog rows `read-update.singleton.delete-bead` and
`read-update.singleton.delete-link`. The wire test's result-shape check,
its deleted-identity correspondence, its definition check, and the
rejected shapes (a URL string, an identity without its revision, an
identity beside a postimage, a postimage outcome carrying an identity).

---

## Observations recorded while drafting

Not decisions, but things the operator may want to know:

- **Diagnostic limits had no home.** *Link endpoint constraints* promised
  advertised diagnostic count and byte limits that the *Advertised limits*
  section never listed. D16 adds them; after D29's ruling they are
  advertised only by `readUpdateAdvertisedLimits`.
- **Media-type codes.** The Problem-details paragraph said the draft assigns
  no code for unsupported request media types; D14 assigns one for mutation
  targets, and the sentence now says so. The `406` condition stays
  unassigned.
- **Batch vs. sequence binding failures.** The batch text rejects forward,
  unknown, duplicate, and wrong-kind names for the whole request; the
  sequence text made forward, unknown, failed, and wrong-kind references
  member failures. After council 9 the two agree on everything static:
  duplicate, invalid, forward, unknown, and wrong-kind names are carrier
  rejections in both (D17, D27); the only sequence-specific member failure
  is a reference to a creating member that failed — impossible in a batch,
  which rolls back — and a reference to a transient creator is a transient
  member failure (D15, revised).
- **`retention.idempotency` had no semantics.** It was listed as a limit
  without any section defining what it bounds; D6 defines it.
- **Divergence from Transactional on duplicates.** Transactional joins
  concurrent duplicates and hands out pending receipts; D5 refuses instead
  because there is no receipt to hand out. If the operator rules for
  joining, the `idempotency-in-progress` row is removed and the Read+Update
  fixture `sequence-idempotency-dispositions.json` loses two exchanges.
- **`readProblem` untouched.** The Read Problem definition and its
  lockstep test are unchanged; `readUpdateProblem` routes Read codes
  through it by reference so the closed Read table cannot drift.

---

## Council 9 fold

Council 9 (Codex, Gemini, Claude) reviewed `0b7d86e7..df718aa`. The Codex
and Gemini findings were folded first from the fold brief; the Claude
report arrived during the fold and was folded in a second pass. Each finding
below records what was done and where, or why it was not folded. Every
judgment the fold required is a numbered decision above, applied
provisionally as its recommendation, not a ruling.

| Finding | Disposition |
| --- | --- |
| Gemini C1 / Codex H2 — a concurrent retry poisons the original's dependent member | Folded: dependency normalization (D15 revised, D3 revised, D4 exceptions, D5 clarified); spec text under *Sequence request envelope*, *Idempotency keys*, *Duplicate keys and retained dispositions*; fixtures `sequence-idempotent-retry.json` (concurrent retry) and `sequence-dependent-bindings.json`; rows `read-update.sequence.transient-predecessor`, `read-update.idempotency.concurrent-dependent-retry`. Codex's shape (only dependents go transient; unrelated members run) was chosen over Gemini's halt-the-request fallback, recorded as D15's alternative. |
| Codex H1 — retained results bypass current authorization | Folded: D21; spec under *Duplicate keys and retained dispositions*, *Authorization views*, *Idempotency keys*, *Problem details*; fixture `idempotency-recovery.json`; row `read-update.idempotency.authorization-view`. |
| Codex H3 — no crash boundary for durable deduplication | Folded: D22 (durable unit, cleared claims, one key state, restore ⇒ different Scope) and D23 (resubmit after an authority crash); new subsection *Durability and recovery*; fixture `idempotency-recovery.json`; rows `read-update.idempotency.durable-boundary`, `read-update.idempotency.crash-mid-sequence`, `read-update.idempotency.restore`. |
| Codex H4 — fingerprint-only tombstones cannot recover dependency identity | Folded: D24 (binding metadata in the tombstone); spec under *Outcome retention*, *Sequence request envelope*, *Idempotency keys*; fixture `sequence-dependent-bindings.json`; row `read-update.sequence.expired-creator-binding`. |
| Codex M5 — D16 weakened the mandatory diagnostics contract | Folded: D16 rejected as written and revised; `diagnostics` mandatory on `validation-failed`, `type` + `schemaLocation` together for Type-contract failures, location formats, `diagnosticsTruncated`, advertised-bound rule; bundle `validationDiagnostic`, `validationDiagnostics`, `readUpdateProblem`; row `read-update.validation.diagnostics`. |
| Codex M6 — unknowable recovery deadline; expiry row title; unbounded tombstones | Folded: D25; D6 revised to acknowledge Scope-lifetime tombstone storage; row `read-update.idempotency.expired` retitled and `read-update.idempotency.retention-minimum` added; fixture condition narrates controlled eviction and the `410`/`409` distinction. |
| Codex M7 — nested Transactional limits leak through discovery | Folded: `readUpdateAdvertisedLimits` (D20 tightened); spec under *Advertised limits*; row `read-update.discovery.limits`; negative checks in `read-update-wire.test.ts`. `readDiscovery` left untouched as sealed Read surface. |
| Codex M8 — forbidden wire shapes pass the schema | Folded: `durableResourceReference` / `localBindingReference` / `durableInputReference` (singletons reject `@name`, pinned forms included; a supplied `id` is always durable), `jsonPointer` for patch paths, `source`/`sourceRevision` rejected on Bead postimages; contextual checks documented under *Normative schema bundle* and tested as result/request correspondence; row `read-update.sequence.contextual-validation`; singleton `@name` row `read-update.singleton.no-local-bindings`. |
| Codex M9 — owned-Link deletion returns a revision without its subject | Folded: D10 revised; `source` beside `sourceRevision` on every owned-Link result, `dependentRequired` in the bundle; every owned-Link fixture updated; cross-packet note X4 (rule once with T22). |
| Codex M10 — catalog rows contradict the model | Folded: `read-update.singleton.update-link-properties` restricted to unowned Links; `read-update.singleton.owned-link-source-revision` rewritten around effectful mutations and "versions no endpoint"; `read-update.singleton.attribution` rewritten (no-op keeps prior revision and attribution); new `read-update.singleton.owned-link-no-op`; fixture `singletons.json` exchange `update-link-properties-owned-semantic-no-op`. |
| Gemini H2 / Codex M11 — missing rows and fixtures; fixture checks assume `results`; attribution helper wrong for no-ops | Folded: 19 rows added (48 total) for disconnect, restore, authorization change, principal isolation, cross-carrier equivalence, crash/failover, transient predecessors, semantic equivalence and difference, retained failures, expired creator, carrier rejections, owned-Link no-ops, diagnostics, discovery limits, contextual validation, internal fault; four fixtures added (`carrier-rejections`, `idempotency-recovery`, `semantic-identity`, `sequence-dependent-bindings`); the wire test branches direct rejections from admitted sequences, checks singleton results with the same helper, treats a result that keeps its guarded revision as a no-op and stops expecting the input attribution on it, and verifies retained dispositions across fixtures. Every fixture condition is a narrated assumption, labeled as such. |
| Codex L12 — "executable catalog"; tests overstated | Folded: "metadata catalog" in the specification; the tests are described as structure, table, citation, and example checks in the specification, in this packet's introduction, and in both test files' comments. |
| Codex assessment: D1 repeated header; D2 principal ≠ `attribution.principal`; D5 delayed retry; D18 crash ≠ disconnect and body-less `500`; D19 CORS `OPTIONS` | Folded as the *Clarified* / *Qualified* notes on D1, D2, D5, D18, D19, with spec sentences and fixtures where they apply. |
| Codex assessment: D13 boundaries | Folded as *Boundaries completed* on D13, including the owned-set `max` classification proposed as `validation-failed`. |
| Gemini F3 — no executable manifest or runner for Read+Update | Not folded: expected and out of scope for a wire draft; the profile's implementation wave, manifest, and runner support begin only after the rulings, and no manifest may bind these rows before then. |
| Gemini F4 — boundary verified, no Transactional leakage | No action: praise, and now also enforced for nested limits by Codex M7's fold. |
| Cross-packet X2 (`retention.idempotency` is Read+Update-only on Transactional discovery) and X1 (deleted-identity shape) | Not folded at the fold: raised by the Transactional packet's council, not this one; both were recorded for a single ruling across packets. X1 was ruled B on 2026-09-08 and is applied as D32 (D9 superseded); X2 remains pending. |
| Claude H1 — a byte-identical retry of a disconnected sequence executes members out of order | Folded: D26 (keys claimed at admission in declaration order); spec under *Read+Update sequence target*, *Duplicate keys and retained dispositions*, *Durability and recovery*; row `read-update.idempotency.key-reservation`; concurrent-retry fixture condition rewritten. |
| Claude H2 — disposition durability bound to commit; in-flight release on restart; one authority owns the namespace | Already folded as D22 from Codex H3; the replica sentence is D22's "every replica that accepts mutations consults one authoritative key state". |
| Claude H3 — the bundle changed under the sealed Read cohort; the gate does not recompute the digest | Folded as D29: documented here and in STATUS.md as an operator decision (re-seal or add a recomputing gate rule); `evidence:generate` was not run and no Read evidence was touched. Ruled C on 2026-09-08; see the corrective below. |
| Claude M1 — retained `binding-unavailable` forces re-keying dependents after a creator is corrected | Folded into D4: the specification now says a client that corrects a creator presents new keys for its dependents; un-retaining `binding-unavailable` is recorded as the alternative. D27 and D28 shrink the case. |
| Claude M2 — D15 contradicts D17; static `@name` errors should be carrier rejections | Folded: D27; `binding-unavailable` narrows to a failed creator; fixtures `carrier-rejections.json` (three new exchanges) and `sequence-partial-failure.json` (member 4 replaced by a Read-coded `resource-not-found` member). |
| Claude M3 — Scope-lifetime tombstones for every disposition are unbounded and principal-growable | Folded: D28 (tombstones only for committed effects; failures forgotten after the interval); fixture `expired-failure-executes-as-new`; row `read-update.idempotency.expired-failure`. |
| Claude M4 — restore honesty; no restore signal in Read+Update | Folded into D22's text and one added sentence under *Outcome retention*: Read+Update exposes no epoch and offers no restore signal beyond `resource-not-found`, `revision-mismatch`, and `idempotency-expired`. |
| Claude M5 — member-level `after-delay` has no `Retry-After` carrier | Folded: D30 (`retryAfter`); bundle, spec, fixtures, row `read-update.sequence.retry-after-hint`. |
| Claude M6 — catalog incomplete against Q13's categories | Folded: rows added for key reservation, unauthenticated, hidden subject, incident-Link non-disclosure, expected-revision race, transient-not-retained, forbidden-retained, expired failure, retry hint, request-too-large, CORS `Idempotency-Key`, no alias mutation, and singleton result headers; expired-different-identity and local-name rows already existed after the first pass. |
| Claude M7 — fixtures contradict the reference domain; missing exchanges | Folded: the aggregate-constraint example now uses the domain's `blocks` Link under a `maximumEndpointMultiplicity` policy on `dependency` declared in `discovery.json`; exchanges added for a singleton idempotent retry (after the Resource's deletion), a Read-coded member problem inside the envelope, carrier rejections, and a transient member disposition. |
| Claude M8 — alias mutation is a dangling promise for Read+Update | Folded: D31 (deferred beyond Read+Update); row `read-update.discovery.no-alias-mutation`. |
| Claude L1 — `identity-taken` is an existence oracle for supplied ids | Folded: acknowledged in the problem-row meaning as the one inherent exception to the no-enumeration-oracle posture; row `read-update.validation.identity-taken` reworded. |
| Claude L2 — spec gaps (no-op sentence, `ETag`/`Location`, repeated field, `@name` in a singleton, non-canonical spellings, RFC 6902 §4.6 equality, anonymous namespace, credential rotation) | Folded: every item now has a specification sentence (D10, D12, D1, D13, D3, D2). |
| Claude L3 — schema nits | Folded where they were loopholes (Codex M8); the duplicated `archivedAt: false` branch is kept because the `readProblem` routing applies only to Read codes and the prohibition must also hold for Read+Update codes. |
| Claude L4 — catalog nits (anchors to child headings; attribution and interleaving wording) | Folded: every citation is anchored to the deepest heading that contains it; `read-update.sequence.interleaving` reworded as suggested. |
| Claude L5 — Transactional `sequence` response shape; profile qualification; Q13 ledger | Q13 now notes the drafted unclaimed rows. The Transactional `sequence` response shape belongs to the Transactional packet and is not folded here. |
| Claude L6 — export Read+Update problem definitions and the outcome enum from `packages/protocol` | Not folded: exporting unruled draft rows from the protocol package would put them on the library surface before the rulings; the tests' local tables are deliberate until the implementation wave. |
| Claude D-verdicts (D11 `unchanged` trade-off; D16 absolute keyword location) | Folded as a note on D11 and in D16's location format. |

### Corrective after the fold (D29 ruled C, 2026-09-08)

The operator ruled D29 as option C: the sealed Read cohort binds the
digest of the Read-reachable projection of the bundle, and the gate that
recomputes it is a separate PR. The fold had left the `validation` limits
group inside the shared `advertisedLimits`, which `readDiscovery`
references, so the Read projection at the fold's head was not what the
seal attests. The corrective withdraws the group into
`readUpdateAdvertisedLimits`, now a closed definition of its own (D16 and
D20 corrected), restores `advertisedLimits` to its bytes at `0b7d86e7`,
and touches nothing else reachable from a Read definition. Adjusted in
lockstep: the *Advertised limits* definition sentence and `validation`
bullet, the *Link endpoint constraints* advertising sentence, the
Open-protocol-questions bundle entry, catalog row
`read-update.discovery.limits`, the wire test (a Read discovery document
carrying `limits.validation` is rejected, a Read+Update one is admitted,
the shared groups are held equal to `advertisedLimits`), STATUS.md, and
this packet. A projection check over every definition reachable from
`readDiscovery`, `beadRecord`, `linkRecord`, `typeDescriptor`, the
collections, `reference`, `attribution`, `properties`, `readProblem`, and
`advertisedLimits` — and every one of the 26 definitions the sealed
bundle holds — found each byte-identical to `0b7d86e7`. No sealed
artifact was touched, no Read evidence was regenerated, and nothing here
is a conformance claim.

Validation at the fold: the lockstep tests, strict Ajv compilation of every
bundle definition, validation of every fixture body, and the repository's
typecheck, lint, format, boundary, and evidence gates were run and are
reported with the fold. None of it is conformance evidence; `claimEligible`
remains `false`, no manifest binds a Read+Update row, and the sealed Read
cohort is untouched.

### Cross-packet ruling X1 applied (RULED B, 2026-09-08)

The operator ruled X1 as option B: the deleted identity is a record in
both write profiles, `{ resourceKind, resource: { id, type, revision } }`,
`revision` the final live revision — the one the Resource had when it was
deleted, since deletion mints nothing. D9 is superseded and D32 records
the member that carries the record. Adjusted in lockstep: the *Mutation
results* sketch and prose, the bundle (`resourceKind`, `resourceIdentity`,
`deletedIdentity`; `mutationResultMembers.deleted` in both branches), the
five `deleted` outcomes across four fixtures, the two deletion rows, the
wire test and the bundle's definition list, the Open-protocol-questions
bundle entry, STATUS.md, the design index, and this packet. Nothing
reachable from a Read definition changed: the projection check found
every one of the 26 sealed definitions byte-identical to `0b7d86e7`. The
Transactional packet applies the same ruling on its own branch; nothing
here is a conformance claim.

