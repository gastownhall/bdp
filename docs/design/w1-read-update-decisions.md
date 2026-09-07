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
whole. None is ruled. The operator rules on them one at a time; a ruling
that departs from the recommendation is applied by editing the quoted
specification sentence, the corresponding bundle definition, the fixtures,
and the catalog row together, and the lockstep tests
(`packages/protocol/src/read-update-wire.test.ts`,
`packages/conformance/src/read-update-catalog.test.ts`) fail until all
four agree.

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

**Depends on this decision.** Under *Idempotency keys*: "An idempotency key
is a case-sensitive ASCII token matching `[A-Za-z0-9_-]{1,256}` — the
character profile under Event-ID and checkpoint character profile — written
identically as a sequence member's `idempotencyKey` and as the value of a
singleton request's `Idempotency-Key` field, without quoting, padding, or
whitespace." Bundle: `idempotencyKey`.

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

**Depends on this decision.** Under *Idempotency keys*: "A key identifies
one semantic mutation within one **idempotency namespace**: the pair of the
canonical Scope URL and the authenticated principal, an anonymous principal
counting as one principal." and "The namespace is shared by every mutation
carrier in the profile".

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

**Depends on this decision.** Under *Idempotency keys*: "The **semantic
identity** of a member is its operation kind — from `operation`, or from
the singleton target — plus its normalized operation record." through "BDP
does not require a public request-hash algorithm."

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

**Depends on this decision.** Under *Duplicate keys and retained
dispositions*: "When a member reaches its terminal outcome, the authority
retains that disposition under the member's key unless the disposition is
transient." through "creates no disposition."

## D5 — Concurrent duplicate: refuse or join

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
3. Implementation choice between 1 and 2. Untestable: conformance cannot
   distinguish a slow join from a refusal that was never sent.

**Recommendation.** Option 1, a deliberate divergence from the Transactional
join because the join's payoff there is the pending receipt.

**Depends on this decision.** Under *Duplicate keys and retained
dispositions*, item 3: "the key is in flight — the member that first
presented it has not reached a terminal outcome: the member fails with
`idempotency-in-progress`, the authority executes nothing and retains
nothing for the presenting member, and a retry after the delay receives the
retained disposition". Problem row `idempotency-in-progress`.

## D6 — Retention window, tombstones, and expiry

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

**Depends on this decision.** The whole *Outcome retention* subsection,
from "Retention is finite." through "creates a different logical Scope under
the rule in that section." Also under *Advertised limits*:
"`retention.idempotency` is the minimum interval for which an authority
retains an idempotency-key disposition after its terminal outcome".
Problem row `idempotency-expired`.

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

**Depends on this decision.** Under *Mutation results*: "When the mutated
Link's type is owned by its source Bead's declared Type, the result
additionally carries `sourceRevision`, the source Bead's resulting
revision, on creation, update, and deletion alike" and "`sourceRevision` is
absent from every other result." Under *Validation and results*: "The
envelope member carrying that secondary revision is `sourceRevision`".

## D11 — Outcome vocabulary and the semantic no-op

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

**Recommendation.** Option 1.

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
operator prefers HTTP idiom over uniformity.

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

**Depends on this decision.** The row "| `binding-unavailable` | `request`
| 400 | `never` |" and, under *Sequence request envelope*: "a reference to
a forward, unknown, failed, or wrong-kind binding fails that member with
`binding-unavailable` rather than rejecting the request."

## D16 — Validation diagnostics and their limits

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

**Recommendation.** Option 1.

**Depends on this decision.** Under *Problem details*: "The problem MAY
carry `diagnostics`: a bounded array of `{ type?, schemaLocation?,
instanceLocation?, message }` entries" and "No other code carries
`diagnostics`." Under *Advertised limits*: the `validation.diagnostics` /
`validation.diagnosticBytes` bullet. Bundle: `validationDiagnostic`, the
`advertisedLimits.validation` group.

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

**Depends on this decision.** Under *Sequence request envelope*: "Once the
authority has admitted a sequence — validated its carrier and
operation-record syntax and started its first member — client
disconnection does not decide any member's outcome."

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

**Depends on this decision.** Under *Operation Directory and singleton
targets*: "A mutation target responds `405 Method Not Allowed` with
`Allow: POST` to every other method, and the Operation Directory responds
`405` with `Allow: GET, HEAD` to every method but those two".

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

**Depends on this decision.** Under *Operation Directory and singleton
targets*: "The bundle defines the Read+Update discovery document as
`readUpdateDiscovery` and the directory response above as
`readUpdateOperationDirectory`."

---

## Observations recorded while drafting

Not decisions, but things the operator may want to know:

- **Diagnostic limits had no home.** *Link endpoint constraints* promised
  advertised diagnostic count and byte limits that the *Advertised limits*
  section never listed. D16 adds them.
- **Media-type codes.** The Problem-details paragraph said the draft assigns
  no code for unsupported request media types; D14 assigns one for mutation
  targets, and the sentence now says so. The `406` condition stays
  unassigned.
- **Batch vs. sequence binding failures.** The batch text rejects forward,
  unknown, duplicate, and wrong-kind names for the whole request; the
  sequence text makes forward, unknown, failed, and wrong-kind references
  member failures. The draft now splits them for sequences: duplicate or
  invalid names are carrier rejections (D17); reference failures are member
  failures (D15).
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
