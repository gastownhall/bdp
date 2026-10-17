---
status: draft
intended-status: normative
version: 0
---

# BDP Conformance index

This index accompanies [Core and Read](profiles/core/core.md) and
[Write](profiles/write/write.md). Requirements apply only to their stated profile.
The common draft status and requirement-language rules are defined in Core.

<!-- protocol-text -->

## Conformance index and informative end matter

### Normative conformance matrix

BDP v0 publishes one machine-readable, black-box conformance matrix. Cases
are tagged by cumulative profile, so an implementation runs only the Read,
Read+Update, or Transactional obligations it advertises. Tests exercise public
HTTP behavior and consume the normative schema bundle; they do not inspect an
implementation's storage or internal server interfaces.

The matrix covers, where applicable:

- discovery, client rejection of unsupported discovered versions and profiles,
  canonical references, Resource reads, collection selection, pagination,
  Type inventory, and incident Links;
- malformed input, schema failures, authorization projections, limits,
  problem codes, and retry dispositions;
- singleton mutation, revisions, idempotency, strict sequence order, local
  bindings, partial failure, and allowed request interleaving;
- Transactional ordering, atomicity, set mutation, receipts, Events, snapshot
  and changefeed agreement, disconnect recovery, expiry, restore, and
  Authorization View changes; and
- cross-implementation client/server combinations, including the reference
  implementations and every shipping product claiming the applicable profile.

The decision and coverage categories are normative. The matrix, fixtures, and
expected results must exist in the repository for an implementation to claim
complete acceptance evidence.

#### Owned-Link wildcard conformance rows

These rows name the Owned-Link wildcard obligations.
`packages/conformance/catalog/owned-wildcard-v1.json` carries their metadata and
source citations. Metadata alone is not executable evidence; claims require
the applicable runs under `packages/conformance/matrices/README.md`.

| Row | Obligation |
| --- | --- |
| `read.owned-wildcard.declaration` | A Bead Type Descriptor's `ownsOutgoing` MAY carry the wildcard entry `"*"`, alone or beside explicit entries, and is served schema-valid; a Link Type Descriptor carries no `ownsOutgoing` |
| `read.owned-wildcard.max-required` | The wildcard entry is exactly `{ max }`: a wildcard without `max`, or with a `label`, is not a valid descriptor |
| `read-update.owned-wildcard.explicit-precedence` | An explicitly declared Link Type is governed by its own entry's `max`; the wildcard's `max` bounds the Bead's whole owned set, the explicitly declared types' Links included |
| `read.owned-wildcard.explicit-max-bounded` | An explicitly declared entry's `max` does not exceed the wildcard's `max` in the same descriptor: a descriptor whose explicit `max` exceeds the wildcard's is not a valid descriptor and is not installed, although the schema bundle accepts it |
| `read.owned-wildcard.present-entries` | A wildcard owner's `ownedLinks` carries one entry per owned Link Type present plus an empty entry per explicitly declared type, keyed by Link Type URL and never by `"*"`, and is present, possibly empty, whenever the Type owns |
| `read-update.owned-wildcard.undeclared-type-versions-source` | Creating, updating, or deleting a Link whose type is owned only through the wildcard versions the source Bead and never the target |
| `read.owned-wildcard.closure` | A view is closed over wildcard-owned Links: a Bead that owns a Link to a hidden Bead is hidden from that view |

#### Numeric-model conformance rows

These rows name the Numeric-model obligations.
`packages/conformance/catalog/numeric-model-v1.json` carries their metadata and
source citations. Metadata alone is not executable evidence; claims require
the applicable runs under `packages/conformance/matrices/README.md`.

| Row | Obligation |
| --- | --- |
| `read-update.numeric-model.same-value-no-op` | A Property Change that rewrites a number as another admissible spelling of the same exact decimal value — `1.0` as `1` or `1e0`, `0` as `-0.0`, `1e300` as `1E300` — is a no-op that retains the revision and emits no `updated` Event, while an admissible literal of a different exact value mints a fresh revision |
| `read-update.numeric-model.round-trip-admission` | A number literal whose exact decimal value does not round-trip through binary64 — an integer past 2^53, a decimal of twenty significant digits, a magnitude beyond binary64 — is refused at admission with `validation-failed` and a diagnostic naming the member, changing nothing, while `1.0`, `-0.0`, `1e300`, and its expanded form are admitted |
| `read-update.numeric-model.nested-refusal` | The refusal applies at any depth within `properties`, whether the document is supplied whole or as a Property Change `value`, and the diagnostic names the offending input; an `instanceLocation` within an available failing document is document-relative, while an unapplied `properties` or `metadata` patch may omit it |
| `read.numeric-model.declared-token-model` | A revision-token scheme that derives tokens from content declares its number model by name; a target declaring `sha256-jcs` produces one token for every admissible spelling of the same value, over RFC 8785 bytes with numbers as binary64; honestly not applicable to a target declaring no content-derived scheme |

#### History conformance rows

These rows apply only to the complete optional `historicalResolution` capability,
with the minimum profile shown by `history-v1.json`. Suffixes `.read-update`
and `.transactional` identify higher-profile sibling obligations. An executable
manifest must gate each row on the target's actual capability and preserve its
cumulative profile obligations. Metadata alone supplies no runner realization
or observations. Claims require the applicable runs under
`packages/conformance/matrices/README.md`, including its Read schema projection,
coverage and current-input requirements.

| Scenario | Required behavior |
| --- | --- |
| `history.discovery` | Complete optional History on all three profiles |
| `history.exact` | Exact Bead and Link records preserve the requested revision and complete owned state |
| `history.query` | Opaque once-decoded revisions and rejected mixtures |
| `history.authorization` | Whole-record authorization and independent subject-history refusal gate |
| `history.diagnoses` | Five evidence-gated read diagnoses and bounded missing-state details |
| `history.gone` | Required Gone reasons survive removal without weakening non-History Read |
| `history.missing` | Bounded diagnostic inventory never returns partial content |
| `history.enumeration` | All retained current and replaced versions, newest authority order first |
| `history.row-authorization` | Whole-row context authorization and no hidden counts |
| `history.cursors` | Stable bounded progress, true expiry and temporary failure are distinct |
| `history.navigation` | Truthful authorized multiple direct relations, no invented replacement adjacency |
| `history.http` | Private no-store, existing validators and HEAD decision parity |
| `history.retained-address` | Restore preserves surviving retained addresses and independent token fences |
| `history.allocation` | Persistent allocation conflict409 versus transient503 and admitted failure rules |
| `history.context` | Immutable context and truthful legacy metadata across all copies |
| `history.context-time` | Authority commit time and independently committed sequence instants |
| `history.context-inputs` | Optional per-operation context with no timestamp or actor override |
| `history.context-fanout` | Fan-out to actual minted versions without context-only transitions |
| `history.erasure` | Every controlled copy and retained context obey erasure before further serving |
| `history.imports` | Positive authoritative erasure status before import visibility |
| `history.assurance` | Scoped tested consumer routes without generic acquisition claims |
| `history.retained-address.read-update` | Retained historical addresses grant no current revision guard |
| `history.allocation.transactional` | Transactional allocation failure rolls back and retains the failure |
| `history.context.read-update` | Native History context accompanies complete mutation postimages |
| `history.context.transactional` | Native History context accompanies receipt postimages and Event versions |
| `history.context-time.transactional` | Atomic versions share commit time without changing Event-time meaning |
| `history.context-inputs.transactional` | Set and batch context inputs remain operation-local |
| `history.context-fanout.transactional` | Set and batch context fans out to every version actually minted |
| `history.erasure.transactional` | History obeys Transactional erasure ledger and recovery requirements |
| `history.assurance.transactional` | Transactional retained copies use the required erasure acquisition route |

#### Read+Update conformance rows

These rows name the Read+Update obligations.
`packages/conformance/catalog/read-update-v1.json` carries their metadata and
source citations. Metadata alone is not executable evidence; claims require
the applicable runs under `packages/conformance/matrices/README.md`. The Read+Update
profile is not realized until every applicable row is proved.

A Read+Update claim inherits the Read obligations it preserves and replaces
the closed Read discovery shape. The retiring row names the predecessor in
its `retires` member; cumulative selection excludes that predecessor while
retaining the shared navigation, optional-contract and omitted-order rules:

- `read-update.discovery.document` retires `read.discovery.document`

This retirement also applies to a Transactional claim; replacing the
Read+Update discovery row does not restore the Read-only shape.

| Row | Obligation |
| --- | --- |
| `read-update.discovery.document` | Read+Update discovery carries `operations` and no Transactional member |
| `read-update.discovery.aliases` | `aliases` is required in Read+Update discovery: every Read+Update Scope offers the alias targets, serves alias resolution, and advertises the member |
| `read-update.discovery.limits` | Read+Update discovery `limits` carries no `transaction` group and no `retention.receipt` or `retention.replay` |
| `read-update.discovery.operation-directory` | The directory lists exactly eight singleton targets — the six Resource targets plus `put-alias` and `delete-alias` — and `sequence` |
| `read-update.singleton.create-bead` | `create-bead` returns the created postimage; omitted `id` is allocated, supplied `id` is honored |
| `read-update.singleton.update-bead` | `update-bead` applies the patch, returns the postimage and fresh revision, and retains the revision on a semantic no-op |
| `read-update.singleton.document-patch-merge-replace` | On both Beads and Links, top-level `add` replaces only the named member while root `replace` replaces the complete selected `properties` or `metadata` object; `{}` clears that object |
| `read-update.singleton.document-patch-atomicity` | One update changes `properties` and `metadata` atomically under one revision; an equal combined result retains the revision and the entire `revisionProvenance` envelope |
| `read-update.singleton.document-patch-validation` | A patch yielding a non-object document or Type-invalid `properties` fails the whole update without changing either document |
| `read-update.singleton.delete-bead` | `delete-bead` returns the deleted identity, the identity then reads as `404`, and a live incident Link fails it with `incident-links-exist` |
| `read-update.singleton.incident-links-nondisclosure` | A Bead deletion blocked by hidden incident Links fails with `incident-links-exist` and withholds the hidden Links that caused it |
| `read-update.singleton.create-link` | `create-link` resolves endpoint spellings to canonical URLs and echoes a pin byte-identically |
| `read-update.singleton.update-link` | `update-link` returns the Link postimage; an unowned Link's update moves only the Link's own revision and versions no endpoint |
| `read-update.singleton.delete-link` | `delete-link` returns the deleted identity and the Link then reads as `404` |
| `read-update.singleton.owned-link-source-revision` | An effectful owned-Link creation, update, or deletion carries `source` and `sourceRevision` and versions the source; an unowned one carries neither and versions no endpoint |
| `read-update.singleton.owned-link-no-op` | A semantic no-op update of an owned Link retains the Link's revision and the entire `revisionProvenance` envelope and reports the source's unchanged revision in `sourceRevision` |
| `read-update.singleton.attribution` | The `revisionProvenance` input is recorded on every version an effectful mutation mints, the owned source's included; a semantic no-op keeps the prior version's revision and the entire `revisionProvenance` envelope |
| `read-update.singleton.expected-revision` | A matching `expectedRevision` applies; a stale one fails with `revision-mismatch` and changes nothing |
| `read-update.singleton.expected-revision-race` | Of two concurrent guarded updates of one Resource, exactly one applies and the other fails with `revision-mismatch` |
| `read-update.singleton.hidden-subject` | A subject or in-Scope endpoint hidden from the request's Authorization View fails with the uniform `resource-not-found`, never `revision-mismatch` or `forbidden` |
| `read-update.singleton.idempotency-key-required` | A missing, malformed, or repeated `Idempotency-Key` field is rejected with `malformed-request` before execution |
| `read-update.singleton.unauthenticated` | An unauthenticated request to a mutation target is rejected with `unauthenticated` before admission and creates no disposition |
| `read-update.singleton.idempotent-retry` | The same key with the same semantic identity returns the retained disposition, including the same allocated identity, without re-execution |
| `read-update.singleton.idempotency-conflict` | The same key with a different semantic identity fails with `idempotency-conflict` and leaves the retained disposition unchanged |
| `read-update.singleton.unsupported-media-type` | A non-JSON or undeclared request body media type is rejected with `unsupported-media-type`; media-type parameters are ignored |
| `read-update.singleton.method-405` | Mutation targets answer other methods with a bodyless `405` and `Allow: POST`; with cross-origin access enabled, `OPTIONS` is answered by the CORS rules and joins `Allow` |
| `read-update.singleton.no-local-bindings` | A singleton request that spells `@name`, bare or within a Pinned Reference, is rejected before execution with `malformed-request` |
| `read-update.singleton.result-headers` | A singleton success carries no `ETag` and no `Location`; `resource.id` and `resource.revision` say what those fields would |
| `read-update.alias.put-creates` | `put-alias` creates an alias to exactly one canonical in-Scope Bead and reports the absolute alias URL and the canonical target with outcome `created` |
| `read-update.alias.put-repoints` | `put-alias` on an existing alias repoints it as the same operation and reports `updated`, a put to the target the alias already has included; resolution then follows the new target |
| `read-update.alias.delete-releases` | `delete-alias` removes the alias and reports `deleted` with no `target`; the alias then resolves as `404`, and the path is reusable by a later put |
| `read-update.alias.uniqueness-invariant` | Alias paths and canonical Bead segments share one uniqueness namespace, checked first: a put on a committed Bead's path, a deleted one included, fails with `identity-taken`, and a Bead creation on a live alias path fails with `alias-path-taken`, a condition that clears when the alias is deleted |
| `read-update.alias.link-coexistence` | Link segments and alias paths coexist: a Link created at `links/foo` beside a live `alias/foo` collides with nothing |
| `read-update.alias.allocation-avoids-aliases` | An authority-allocated Bead id is never a live alias path |
| `read-update.alias.non-canonical-target` | A put whose `target` is an alias, a Link, or an external URI fails with `validation-failed`, carrying one diagnostic that names the cause |
| `read-update.alias.unknown-subject` | An unknown or invisible target, an unknown alias on delete, and an `alias` member beneath the wrong root fail with `resource-not-found`: aliases are not an enumeration oracle |
| `read-update.alias.carrier-syntax` | An `alias` value that violates the grammar or is no reference shape at all is carrier syntax: the sequence is rejected whole with `malformed-request` before any member executes, while a well-formed inadmissible target fails only its member |
| `read-update.alias.authorization` | Alias operations are authorized as mutations of the Beads they touch: a put requires write on the proposed target, a repoint or delete also on the current target, and an invisible current target makes the alias `resource-not-found` |
| `read-update.alias.forbidden` | A put or delete the principal may not perform fails with `forbidden` |
| `read-update.alias.no-version-minted` | Alias mutation mints no version: the target Bead's revision is unchanged by a put, a repoint, or a delete, and an alias result carries no revision |
| `read-update.alias.sequence-binding` | Alias members are sequence members with their own keys: a put's `target` may name a `@name` bound by an earlier Bead creation in the same sequence, a Link-bound `@name` is rejected before execution, an entry is the alias result plus `operationIndex` and never `operationName`, and alias dispositions are retained and replayed as every member's are |
| `read-update.alias.retained-without-reauthorization` | A retained alias disposition discloses no record and is returned as retained, inside a sequence as in a singleton, without replay re-authorization |
| `read-update.alias.reference-resolution` | An alias spelling as a `bead` subject or a Link endpoint resolves to the alias's current target when the member is reached and is stored and served canonical; one naming no live alias, or spelled as a `link` subject, fails with `resource-not-found` |
| `read-update.alias.reference-idempotency` | Alias retries reuse recorded targets or misses; new locators resolve in the retry turn and compare canonically, distinct missing locators differ, and original metadata and retention remain unchanged; an equal retry receives the retained disposition subject to current disclosure authorization, or `idempotency-expired` from a tombstone |
| `read-update.sequence.order-and-partial-commit` | Members run strictly in order; a failed member leaves earlier successes committed and later independent members run |
| `read-update.sequence.local-bindings` | A `@name` binding is usable after its creating member commits; a reference to a creating member whose retained disposition is a failure fails only its member with `binding-unavailable` |
| `read-update.sequence.transient-predecessor` | A member whose `@name` creator ended transiently in the same request fails with `idempotency-in-progress`, retains nothing, releases its claim, and later independent members still run |
| `read-update.sequence.expired-creator-binding` | An expired creator still binds `@name` through its tombstone's allocated identity and kind, so an unchanged dependent retry receives its retained disposition rather than a conflict |
| `read-update.sequence.retained-failure` | A retained failure answers a retry exactly as a retained success while retained: a failed creator and its `binding-unavailable` dependent return unchanged, and correcting the creator means new keys for its dependents |
| `read-update.sequence.member-problem-shape` | A member problem carries its would-be `status`, `operationIndex`, and `operationName` when declared, inside a `200 OK` envelope |
| `read-update.sequence.retry-after-hint` | A member problem with `retry: after-delay` MAY carry `retryAfter` delay-seconds; no other member problem carries it |
| `read-update.sequence.carrier-rejection` | An oversized member count, a repeated or invalid key or name, a forward, unknown, or wrong-kind `@name` reference, a malformed later member, a non-JSON-Pointer patch path, or a stray `Idempotency-Key` field is rejected before execution with a direct problem, and nothing executes |
| `read-update.sequence.contextual-validation` | Schema validity is not admission: Scope containment, Resource kind, `@name` kind, ownership, result correspondence, and key and name uniqueness are enforced by the authority, and a wrong-kind durable reference fails with `resource-not-found` |
| `read-update.sequence.idempotent-retry` | A retried sequence returns every retained disposition at the present member's position without re-execution |
| `read-update.sequence.disconnect` | An admitted sequence runs every remaining member to its terminal disposition after the client disconnects, and a retry recovers the lost response member by member |
| `read-update.sequence.internal-fault` | An unexpected internal fault mid-sequence is the body-less `500`; members with durable dispositions stay retained and the faulting member's claim is cleared |
| `read-update.sequence.interleaving` | No sequence-wide lock: an unrelated request completes between two members without waiting, and the later member observes its commit |
| `read-update.idempotency.in-progress` | A concurrent duplicate fails with `idempotency-in-progress` and executes nothing; a retry after the delay receives the retained disposition once the first presentation has one, and may otherwise still find the key in flight, transient, or expired |
| `read-update.idempotency.key-reservation` | A sequence claims every member's unknown key at admission in declaration order, so a concurrent resubmission is transient in every member the original will run and can neither execute ahead of it nor retain a disposition it would contradict |
| `read-update.idempotency.claim-atomicity` | A carrier's admission claims are one linearizable step: a competing presentation observes all of them or none, so identical sequences never split their keys, and no lock outlives admission |
| `read-update.idempotency.concurrent-dependent-retry` | A concurrent retry that meets its creator in flight fails the dependent member transiently and claims nothing, so the first presentation's dependent member commits and retains normally |
| `read-update.idempotency.transient-not-retained` | A transient disposition is never retained: a later presentation of the key executes the member |
| `read-update.idempotency.semantic-identity` | Semantic identity ignores the label, protocol defaults, member order, and local-versus-canonical spelling, and includes pins, attribution, revision guards, and array order |
| `read-update.idempotency.principal-isolation` | A key is scoped to the authenticated principal: another principal's identical key is unknown and executes, and carried `revisionProvenance.actor.id` plays no part |
| `read-update.idempotency.cross-carrier` | A sequence member and a singleton request presenting the same key in the same namespace present the same key and share one semantic identity |
| `read-update.idempotency.authorization-view` | An Authorization View change keeps the key, identity, and disposition retained; a replay re-authorizes disclosure, answers a no-longer-visible retained result with `forbidden`, and executes and replaces nothing |
| `read-update.idempotency.forbidden-retained` | A `forbidden` disposition is retained for the retention interval: a retry after a grant under the same key still answers `forbidden`, and the principal presents a new key |
| `read-update.idempotency.retention-minimum` | When `retention.idempotency` is advertised, a retry within it receives the retained disposition; when it is not, no client-known recovery window exists |
| `read-update.idempotency.expired` | A key whose retained disposition was discarded after the retention interval fails with `idempotency-expired` and never re-executes; the same key with different semantics remains `idempotency-conflict` |
| `read-update.idempotency.expired-failure` | A forgotten failure — retained for the interval, then discarded — leaves its key unknown, so a later presentation executes the member for the first time under its guards, while a committed disposition keeps its tombstone |
| `read-update.idempotency.durable-boundary` | The mutation, its identity, allocated identities, and disposition are one durable unit; after restart or failover a retry receives the retained disposition, and a cleared abandoned claim executes exactly once |
| `read-update.idempotency.crash-mid-sequence` | After an authority crash mid-sequence, committed members stay retained, unstarted members are not executed by recovery, and a resubmission completes the sequence in order |
| `read-update.idempotency.restore` | A restore that loses recovery state is a different logical Scope at a different canonical Scope URL, never a continuation of the old key namespace; Read+Update offers no other restore signal |
| `read-update.problem.table` | Every Read+Update code serializes with its exact family, status, retry disposition, Problem media type, and `private, no-store` protection |
| `read-update.validation.type-contract` | An inadmissible result fails with `validation-failed`, and an uninstalled Type fails with `type-not-installed`, changing nothing |
| `read-update.validation.diagnostics` | A Type-contract `validation-failed` carries `diagnostics` naming the effective Type and absolute keyword location within advertised bounds, and flags omitted entries with `diagnosticsTruncated` |
| `read-update.validation.identity-taken` | A supplied `id` that was ever committed, including a hidden or deleted one, fails with `identity-taken` — the one inherent existence signal, acknowledged as such |
| `read-update.validation.aggregate-constraint` | A mutation that would cross an advertised maximum endpoint multiplicity fails with `aggregate-constraint-violation` |
| `read-update.http.command-minimum-fields` | Mutation POSTs ignore the three read-consistency fields without a minimum-position barrier or command-identity effect, preserving ordinary admission and read minima |
| `read-update.http.request-too-large` | A request body above the advertised `request.bodyBytes` is rejected with `request-too-large` before execution |
| `read-update.http.cache-no-store` | Every mutation response carries `Cache-Control: private, no-store` |
| `read-update.http.cors-idempotency-key` | With cross-origin access enabled, the CORS policy allows the `Idempotency-Key` request field and exposes `Retry-After` |

#### Transactional conformance rows

These rows name the Transactional obligations.
`packages/conformance/catalog/transactional-v1.json` carries their metadata and
source citations. Metadata alone is not executable evidence; claims require
the applicable runs under `packages/conformance/matrices/README.md`. The Transactional
profile is not realized until every applicable row is proved.

A Transactional claim inherits the Read and Read+Update rows whose
obligations the profile preserves, including the Read+Update retirement of
`read.discovery.document` — the Read+Update singleton obligations
are observed through the receipt's one entry — and retires the twelve
Read+Update rows the profile contradicts: the rows bound to Read+Update's
discovery document, limits, and directory shapes, to its inline singleton
result, to its refused, `410`, forgotten, and restore forms of the key
dispositions, and to direct-disposition replay and immediate internal-fault
claim clearing. The retiring row names them in its `retires` member, and the
selection rule excludes a retired row from the claim that retires it:

- `transactional.discovery.document` retires `read-update.discovery.document`
- `transactional.discovery.operation-directory` retires `read-update.discovery.operation-directory`
- `transactional.discovery.limits` retires `read-update.discovery.limits`
- `transactional.discovery.no-idempotency-retention` retires `read-update.idempotency.retention-minimum`
- `transactional.singleton.receipt` retires `read-update.singleton.result-headers`
- `transactional.receipt.reauthorization` retires `read-update.idempotency.authorization-view`
- `transactional.idempotency.concurrent-join` retires `read-update.idempotency.in-progress`
- `transactional.idempotency.expired-detail` retires `read-update.idempotency.expired`
- `transactional.idempotency.failed-retained` retires `read-update.idempotency.expired-failure`
- `transactional.restore.key-namespace` retires `read-update.idempotency.restore`
- `transactional.idempotency.cross-carrier` retires `read-update.singleton.idempotent-retry`
- `transactional.idempotency.durable-admission` retires `read-update.sequence.internal-fault`

The last two retirements preserve cross-carrier replay through receipts and
the bodyless internal-fault response while rejecting the Read+Update-only
direct-disposition and immediate claim-clearing obligations.

The alias rows below bind the locator-only Transactional receipt contract. The Read+Update alias path and operation semantics remain
inherited; the general singleton receipt retirement already replaces their
profile-specific response vehicle.

| Row | Obligation |
| --- | --- |
| `transactional.discovery.document` | Transactional discovery has the exact required history and replication members |
| `transactional.discovery.operation-directory` | The Transactional Operation Directory lists all twelve targets |
| `transactional.discovery.limits` | Transactional discovery may advertise the transaction group and receipt and replay retention |
| `transactional.discovery.no-idempotency-retention` | Transactional discovery never advertises retention.idempotency |
| `transactional.batch.atomic-commit` | A multi-operation batch commits atomically with ordered postimages |
| `transactional.batch.local-references` | Batch-local labels bind staged identity, including as Link endpoints and inside pins |
| `transactional.batch.rollback` | A failing operation rolls back the complete batch into a failed receipt |
| `transactional.batch.label-errors` | Forward, unknown, duplicate, and wrong-kind labels are rejected before admission |
| `transactional.batch.envelope-errors` | A batch without exactly one header key, or with a body or per-operation key, is malformed |
| `transactional.batch.pre-admission-precedence` | Pre-admission checks run bounds, syntax, principal, key, then admission controls, and never consult key state for an invalid request |
| `transactional.batch.transaction-limits` | Advertised transaction limits fail the whole transaction without partial effect |
| `transactional.batch.duration-limit` | Exceeding transaction.duration is a permanent limit-exceeded failure naming the limit, not a transient abort |
| `transactional.batch.deletion-safety` | Deleting a Bead with live incident Links fails the transaction |
| `transactional.batch.owned-link-transitions` | Several owned-Link transitions of one source in one batch mint one source version and one updated Event each, in operation order, each carrying its attribution |
| `transactional.batch.no-op-entries` | A no-op update reports updated at the retained revision, and an all-no-op transaction completes without a group or effectPosition |
| `transactional.batch.revision-guard-race` | Racing guarded updates serialize into one success and one revision-mismatch |
| `transactional.batch.aggregate-constraint-race` | Racing Link creations cannot jointly cross a maximum multiplicity |
| `transactional.set.mutation` | Set mutation mutates the complete matched set and reports flat entries in canonical-uri order |
| `transactional.set.zero-match` | A zero-match set operation reports matched 0 and induces no Events |
| `transactional.set.cardinality` | A matched count outside the supplied cardinality fails the transaction with cardinality-violated |
| `transactional.set.singleton-targets` | The update-where and delete-where singleton targets accept the set-operation body without the discriminator and return receipts |
| `transactional.set.attribution-fanout` | A set mutation's attribution is recorded on every version it mints, owned sources included |
| `transactional.singleton.receipt` | Singleton targets execute one-operation transactions and return receipts under the batch statuses |
| `transactional.singleton.semantics` | A singleton and the equivalent one-operation batch have identical allocation, validation, idempotency, and Event semantics |
| `transactional.receipt.readable` | Receipts are independently readable with GET and HEAD |
| `transactional.receipt.pagination` | Large set results continue through immutable pages bounded by page.maximumItems, every entry counting as one |
| `transactional.receipt.page-expiry` | A page URL returns 410 cursor-expired after detail expiry, decided after authentication and non-disclosure |
| `transactional.receipt.nondisclosure` | Unknown, foreign-principal, retracted, forgotten, and prior-epoch receipt URLs share one 404 |
| `transactional.receipt.root` | The receipts root is a namespace with no listing or key lookup |
| `transactional.receipt.headers` | Receipt responses carry the serving request's observation in the response fields and the execution's facts in the body |
| `transactional.receipt.reauthorization` | A view change withholds record-bearing entries under owned closure without changing the disposition |
| `transactional.receipt.reauthorization-paths` | The synchronous response, a duplicate's response, later reads, pages, and sequence projections share one authorization projection |
| `transactional.receipt.non-record-entries` | Matched counts, deleted and erased identities, withheld entries, and failed problems are served as retained |
| `transactional.receipt.whole-withheld` | A completed receipt whose every entry is withheld reports detail withheld; a failed receipt is never withheld |
| `transactional.receipt.pending-202` | The original submission receives 202 only past the wait bound; a duplicate may receive it any time before terminal |
| `transactional.receipt.deleted-identity` | A deleted entry carries the identity record with the final live revision |
| `transactional.receipt.owned-link-source` | Owned-Link entries carry source and sourceRevision together on creation, update, and deletion |
| `transactional.receipt.problem-shape` | A receipt problem carries the would-be status, the failing operationIndex, and a request-body pointer |
| `transactional.receipt.transaction-level-failure` | A transaction-wide failure omits operationIndex rather than fabricating one |
| `transactional.receipt.validation-diagnostics` | A validation-failed receipt problem carries the Read+Update diagnostics and truncation marker |
| `transactional.receipt.no-transient-failure` | No failed receipt ever carries temporarily-unavailable |
| `transactional.receipt.expiry-allocated` | An expired receipt keeps its disposition, positions, and allocated identities and never re-executes |
| `transactional.receipt.retention-minimum` | expiresAt is no earlier than the terminal instant plus an advertised retention.receipt |
| `transactional.idempotency.concurrent-join` | Concurrent identical requests join one execution and one receipt |
| `transactional.idempotency.conflict` | A reused key with different semantics is refused without execution for as long as the key is bound |
| `transactional.idempotency.semantic-identity` | Semantic identity excludes name and the carrier, normalizes labels to the creator's index or supplied identity, and includes pins, attribution, guards, and order |
| `transactional.idempotency.cross-carrier` | A one-operation batch, the equivalent singleton, and the equivalent sequence member present one semantic request and share one receipt |
| `transactional.idempotency.key-grammar` | Keys are bare checkpoint-profile tokens compared byte-exactly, and an absent, repeated, or invalid key is malformed |
| `transactional.idempotency.expired-detail` | A retry after detail expiry receives the expired receipt with 200 and never re-executes |
| `transactional.idempotency.transient-abort` | A transient abort after admission retracts the pending receipt, unbinds the key, answers 503, and a retry executes anew |
| `transactional.idempotency.failed-retained` | A failed receipt is retained for at least retention.receipt and a retry returns it; once forgotten, its URL answers 404 and its key executes anew |
| `transactional.idempotency.durable-admission` | Admission records key, identity, pending receipt, transaction identity, and ownership as one durable step |
| `transactional.idempotency.ownership-fencing` | A commit succeeds only while the committing execution owns the pending receipt; a fenced execution produces no group |
| `transactional.idempotency.pending-recovery` | After a crash every uncommitted pending receipt is retracted within the bound; an older pending receipt is a conformance failure |
| `transactional.idempotency.one-key-state` | Every mutation route consults one authoritative key state |
| `transactional.sequence.member-transactions` | Each sequence member is a one-operation transaction with its own receipt, admitted in declaration order, in an unchanged envelope |
| `transactional.sequence.completed-projection` | A completed member projects its receipt's one entry in the Read+Update result shape |
| `transactional.sequence.in-flight-projection` | A member whose key is bound to a pending receipt projects a transient idempotency-in-progress problem without waiting or retaining |
| `transactional.sequence.expired-projection` | A member whose receipt detail expired projects idempotency-expired carrying the allocated identity of a creation |
| `transactional.sequence.pending-creator` | A dependent whose creator is pending or transient fails transiently and holds no key |
| `transactional.sequence.failed-creator` | A dependent whose creator's receipt is failed fails with binding-unavailable in its own failed receipt |
| `transactional.sequence.member-reauthorization` | A withheld entry projects as a forbidden member problem and an erased one as resource-erased to an authorized caller |
| `transactional.event.owned-link-delta` | Owned-Link mutations emit source updated Events carrying exactly one ownedLink delta |
| `transactional.event.owned-link-update-delta` | An updated owned-Link transition carries the Link's delta, not its record |
| `transactional.event.owned-link-deleted-identity` | A deleted owned-Link transition carries the Link's identity with its final live revision |
| `transactional.event.fact-order` | One owned-Link operation's facts are ordered lifecycle, graph facts source before target, then the source's updated fact |
| `transactional.event.no-op-owned-update` | A no-op owned-Link update versions neither the Link nor the source and emits no Event |
| `transactional.event.graph-facts` | Link lifecycle produces linked and unlinked facts at every in-Scope endpoint |
| `transactional.event.self-link` | A self-Link's one endpoint receives a source fact and a target fact in the same group |
| `transactional.event.set-expansion-order` | A set operation's induced facts and receipt entries follow canonical-uri order |
| `transactional.event.history-expired` | event-history-expired is disclosed only to a principal authorized for the subject's retained history |
| `transactional.event.cursor-after-withheld` | A cursor naming a withheld Event remains a valid exclusive after position, and eventCount counts served Events |
| `transactional.changefeed.group` | Change groups carry normalized postimages and ordered Events behind one checkpoint |
| `transactional.changefeed.wire-form` | Every group carries changes, erasures, and events; a visible group carries transaction and at least one non-empty array |
| `transactional.changefeed.sse` | SSE delivery frames one complete group per message |
| `transactional.changefeed.start-intent` | A changefeed read without an explicit starting intent is an error |
| `transactional.changefeed.owned-link-agreement` | A group carries the owned Link's and the source's postimages, and their inline and first-class records agree |
| `transactional.changefeed.consistency-fields` | Scope-bounded responses carry epoch, view, and position, and honor minimum positions |
| `transactional.changefeed.catch-up-timeout` | A minimum-position read that cannot be served within the wait bound fails with catch-up-timeout |
| `transactional.changefeed.replay-window` | Late, foreign-epoch, and foreign-view cursors fail explicitly |
| `transactional.changefeed.sse-reconnect` | SSE reconnection uses the durable applied checkpoint with header precedence |
| `transactional.changefeed.projection-advance` | A hidden transaction projects an identifier-free advance |
| `transactional.changefeed.owned-closure` | Feeds and Event Sources project owned Links with their visible source |
| `transactional.snapshot.rendezvous` | A snapshot checkpoint continues losslessly into the changefeed |
| `transactional.snapshot.closed-projection` | A snapshot is a closed projection whose inline and first-class owned-Link records agree; a disagreeing snapshot is rejected |
| `transactional.snapshot.expiry` | A snapshot stays continuable through expiresAt, and a page it cannot serve before then is a service failure |
| `transactional.snapshot.erasure-ledger` | Every snapshot manifest carries the erasure ledger projected for its view |
| `transactional.erasure.record-digest` | Erasure records propagate with a verifiable sha-256-jcs digest |
| `transactional.erasure.digest-domain` | BDP JSON follows the number model, so every record has one canonical serialization, and digest computation never gates erasure |
| `transactional.erasure.historical-version` | Erasing a historical version commits no state change and induces no Event |
| `transactional.erasure.live-successor` | A live-version erasure commits its successor in the same group; a property correction carries the content-free root-replace delta, an owned-Link-induced source successor carries only `ownedLink`, and the successor differs in the durable state that determines its revision |
| `transactional.erasure.live-tombstone` | A live-version erasure with a tombstone is an administrative deletion under deletion safety, inducing the ordinary facts |
| `transactional.erasure.owned-link-cascade` | Erasing an owned Link's version erases every source version that inlined it, one record each |
| `transactional.erasure.event-withholding` | Event Sources withhold every Event whose data carries erased content, leaving ordinal gaps |
| `transactional.erasure.graph-facts` | Graph facts are withheld exactly when every version of the Link that carried their endpoints is erased; deleted facts never are |
| `transactional.erasure.receipts` | Receipts and pages stop serving an erased postimage at once, serving erased to authorized callers and withheld otherwise |
| `transactional.erasure.replication-invalidation` | An erasure at P expires every checkpoint and snapshot anchored before P in the views that receive it |
| `transactional.erasure.retention-non-propagation` | Retention removals do not propagate; a longer-window replica keeps what the authority dropped, while erasure reaches it |
| `transactional.erasure.restore` | After a restore the ledger is re-emitted at the new epoch's first positions and no prior-epoch group is served |
| `transactional.erasure.unestablishable-content` | A replica destroys retained content whose erasure status it cannot establish |
| `transactional.erasure.view-projection` | An erasure record reaches only views that observed the subject |
| `transactional.erasure.reads` | Reads of an erased version disclose resource-erased without a pointer to authorized callers and 404 to everyone else |
| `transactional.erasure.epoch-unrotated` | An erasure does not rotate the epoch; tokens anchored at or after it stay valid |
| `transactional.http.status-matrix` | Every mutation-surface target answers with exactly the statuses of the matrix |
| `transactional.http.method-405` | Mutation targets answer non-POST methods with 405 and Allow: POST, with enabled CORS OPTIONS answered by the CORS rules |
| `transactional.http.problem-table` | Every Transactional Problem preserves its status, family, code, and retry row |
| `transactional.http.problem-contexts` | Direct and receipt codes are disjoint contexts, and the Read+Update key dispositions never appear as direct problems |
| `transactional.http.internal-fault` | A bodyless 500 or transport failure after admission decides nothing; the receipt records the disposition |
| `transactional.http.disconnect-admitted` | A disconnect after admission does not decide the outcome |
| `transactional.http.timestamps` | Every emitted instant is a valid RFC 3339 date-time with uppercase T and Z |
| `transactional.http.ijson-strings-objects` | Unicode scalar strings and unique decoded member names are checked as carrier syntax before execution |
| `transactional.http.token-profile` | Epochs, view tokens, positions, transaction ids, receipt tokens, and keys use the checkpoint character profile; revisions do not |
| `transactional.restore.epoch-fence` | A restore keeps canonical URLs and surviving retained Resource-version addresses; all other prior-epoch token classes retain their individual epoch-fence handling |
| `transactional.restore.key-namespace` | A prior-epoch key is unbound under the new epoch and executes anew, never as a replay |
| `transactional.alias.receipt` | Alias singletons use durable one-entry receipts with the ordinary key and replay rules |
| `transactional.alias.locator-only` | Alias changes occupy no Scope position and appear in no Event, change group or snapshot |
| `transactional.alias.no-batch` | Alias operations are excluded from atomic batch membership |
| `transactional.sequence.withheld-allocation` | An expired creation projects the disclosed identity or exactly withheld true |
| `transactional.sequence.withheld-binding` | Withheld allocation preserves internal binding and independently authorizes every dependent |
| `transactional.erasure.live-publication` | Only already admitted caught-up streams in views receiving the erasure cross its atomic publication fence |
| `transactional.erasure.disconnect-race` | Reconnect uses the atomically applied durable checkpoint and resnapshots when it precedes erasure |
| `transactional.idempotency.unresolved-admission` | Atomic all-member admission preserves unresolved creator attempts and immutable terminal bindings |
| `transactional.idempotency.unresolved-comparison` | Direct unresolved comparison uses a separate finite wait, proven conflict or receipt, and retryable 503 at its deadline |
| `transactional.idempotency.retraction-retry` | A waiting direct request may win fresh admission in the same epoch without inheriting ownership or resetting its deadline |
| `transactional.erasure.persistent-event-consumer` | Persistent Event consumers claiming protocol-backed erasure handling integrate Scope changefeed and snapshot ledger recovery and cleanup |
| `transactional.snapshot.manifest-refetch` | Snapshot GET/HEAD retrieves the same valid manifest without replacing its anchor or renewing expiry |
| `transactional.snapshot.handle-refusal` | Snapshot handle expiry and non-disclosure precede conditionals and never disguise a pre-expiry service failure |
| `transactional.receipt.page-restart` | Issued receipt-page URLs preserve boundaries across same-epoch restart while detail remains available |
| `transactional.http.accept-refusal` | Unacceptable successful response media yields bodyless 406 before admission while ordinary refusals retain precedence |
| `transactional.receipt.validator-omission` | Receipt and page responses omit optional validators while retaining private no-store and HTTP preconditions |
| `transactional.http.finite-validator-omission` | Finite changes and Event pages omit optional validators without changing cursor semantics or adding SSE group validators |
| `transactional.http.conditional-reads` | Read conditionals preserve ordinary refusal precedence and produce native bodyless 304 or 412 without checkpoint advancement |
| `transactional.http.head-parity` | HEAD preserves GET decisions and required metadata and ends without bodies or SSE frames |

### Deferred model features

Endpoint Type unions, minimum multiplicity, tuple-uniqueness constraints,
acyclicity, and additional aggregate graph policies are deferred beyond BDP
v0. They are not implicit authority behavior.
