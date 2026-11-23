# Reference service and Go implementation milestones

Source inventory dated October 29, 2026, against published BDP main
`c6dfb3c05fe707cf605030c5661123e8dda0d8f8`. This is implementation planning under
[BDP #59](https://github.com/gastownhall/bdp/issues/59), the sole plan of record.
Claudia owns this implementation work; Trish coordinates the subordinate tracker,
review and ordinary BDP landing. The [selected specification front door](../../specs/README.md)
governs semantics. This inventory supplies no runtime conformance claim.

## October 30 delivery and current staging

[PR #321](https://github.com/gastownhall/bdp/pull/321) now contains the private
retained client/HTTP/SQLite increment at
[bb515165](https://github.com/gastownhall/bdp/commit/bb5151653b54ef193e3b8b44ab07860b9a9b3c16),
composed from the reviewed 37-file implementation delta. The dated October 29
inventory, assessments and proposed slice order below remain historical records.
This section records the current delivery and implementation order.

The [retained client](../../packages/client/src/retained-read.ts) supports selected
discovery, current full/properties GET and HEAD, conditional reads, native Problems
and original response bytes. [Native Write preparation and submission](../../packages/client/src/retained-write.ts)
retain the selected invocation through the
[bounded HTTP transport](../../packages/client/src/bounded-http-transport.ts).
The private reference path has its own
[HTTP composition](../../packages/server/src/retained-v01/http.ts),
[SQLite owner](../../packages/server/src/retained-v01/store.ts),
[Event handling](../../packages/server/src/retained-v01/events.ts) and
[recovery](../../packages/server/src/retained-v01/recovery.ts), with Bead, Link,
edit and alias slices. The
[point-read HTTP tests](../../apps/bdptest/src/retained-v01-point-read.test.ts)
include an actual generic-client to HTTP to SQLite preparation/submission/read
case. This delivery remains private. It establishes no complete Core/Write
profile, canonical CLI activation, Go implementation or production TLS/auth
qualification. Query/List, exact History and pinned Reference objects,
projection, aggregates and a caller-owned durable journal remain outside this
increment. The non-HTTP URI/local-path overlap remains a known fixture gap.

On the received implementation subject, formatting, lint, dependency boundaries,
typecheck and a fresh normal build passed. The original eight-file focused run
remains **301 executions: 297 PASS and 4 FAIL**, with no pending cases. Two
fixture-only literal corrections changed no assertions or production code:
bodyless-response fixtures use `null` instead of an empty string, and the Link
read seed uses an unambiguous HTTPS target. Separately, exactly those **4 repaired
cases passed**, followed by **3 previously unrun HTTP controls passing**. The
other 53 and 44 cases respectively were filtered. This is no all-301-green rerun
or full conformance result. These results precede composition; the actual
composed-head CI verdict remains separate. This documentation amendment runs
only link and whitespace checks.

Donna's current staging is:

1. Finish the selected non-Types canonical CLI surface and independently validate
   its dry-run HTTP requests. Implement the matching SQLite semantic surface and
   establish live success, failure and recovery coverage alongside it. SQL
   lowering may be staged behind a correct reference execution path; atomic
   effects, guards, key recovery and required Event facts remain obligations.
   Core/Write Type affiliations and exact pins remain required while Types-profile
   implementation is deferred.
2. Once those gates are complete or in bounded final closure, Types-profile work
   can proceed in parallel with the Go service library and its integration into
   `donnabox/beads` through `bd serve`.
3. Implement the Go canonical CLI client later; the completed existing-language
   CLI supplies the bootstrap client and acceptance harness.

Types-profile and generic Go implementation in Claudia's lane remain deferred
while the first-stage gates are open. Legacy default build/test participation
and historical evidence retain the retirement obligations recorded below.

## First change and preserved behavior

Freeze `bdpbd` as a legacy v0 Read projection and stop recommending it for new
deployments. The first patch changes only this inventory, the root README,
the Read walkthrough and the application README. Runtime, package manifests,
default build/test/smoke and evidence admission remain unchanged.

The adapter's source and [revision declaration](../history/adapter-bd.md),
v0 schemas, fixtures and sealed evidence keep their existing bytes and identity.
The committed [Read cohort](evidence/read-cohort/read-v1.json) names run head
`647d8d7b746f2b5a6136640aed4af7b7d5766146`; the two shipping target entries share
one evidence constant. That record includes packaged, in-process and uncovered
cases. Its results cannot be transferred to a new provider or relabeled v0.1.

## Retirement dependency inventory

Classification applies to the first documentation slice. Each later batch needs
its own reviewed delta and validation receipt.

| Family and actual entry points | Classification now | Required follow-up before default retirement |
| --- | --- | --- |
| Root [README](../../README.md), [Read walkthrough](../read-demo.md), application README (`apps/bdpbd/README.md`, retired) | Migrate now | State frozen legacy status and link the replacement work |
| Application composition (`apps/bdpbd/src/server-composition.ts`), CLI (`apps/bdpbd/src/main.ts`), process adapter (`packages/adapter-bd/src/index.ts`) — all retired; the revision declaration is preserved at [adapter-bd](../history/adapter-bd.md) | Retired | Done: the explicit source cleanup removed the real-bd bridge; captured cohort evidence remains valid and is no longer regenerated |
| [Workspace build references](../../tsconfig.json), [workspace globs](../../pnpm-workspace.yaml), [source typecheck aliases](../../tsconfig.check.json), app/adapter manifests and lockfile, [boundary policy](../../scripts/check-dependency-boundaries.mjs), [build cleanup](../../scripts/clean-build.mjs) | Preserve for compatibility coverage | Separate default current-contract participation from an explicit legacy validation route; remove references together rather than only deleting a directory |
| [Default test discovery](../../vitest.config.ts), app composition/matrix/lifecycle tests, adapter tests | Preserve for compatibility coverage | Transfer the backend-independent obligations below and qualify their replacement targets before excluding legacy execution |
| [Executable smoke](../../scripts/smoke-executables.mjs) | Preserve for compatibility coverage | Replace each applicable lifecycle/configuration/package/admission check on the real replacement executable; discovery-only smoke is insufficient mutation evidence |
| [Readiness proof](../../scripts/e2e-ready.mjs), demo implementation (`scripts/demo-read.mjs`, retired with the bridge), `@bdp/bd-domain` | Keep as frozen (ruled 2026-11-23) | Keep the old real-bd oracle comparison explicit; a generic provider is not required to implement the Beads readiness domain. Its bdpbd half names the retired app and stays in place — see the ruling below |
| [Harness bindings](../../scripts/read-harness-bindings.ts), [cohort generator](../../scripts/generate-read-cohort.mts), [evidence verifier](../../scripts/read-cohort-evidence.mjs), [cohort verification](../../packages/conformance/src/cohort-verification.ts), Read matrices/fixtures/manifest | Keep as frozen (ruled 2026-11-23) | Do not delete. The cohort generator and [bd baseline](../../scripts/bd-baseline.mjs) became vestigial when the real-bd producer was retired, but the apparatus is kept as frozen evidence and the wire-level conformance gate does not subsume it — see the ruling below |
| [Read admission](../../packages/server/src/read-conformance-capability.ts), [public server target admission](../../packages/server/src/index.ts) | Preserve for compatibility coverage | Replace the hardcoded two-target Read admission deliberately; do not delete only the `bdpbd` constant or make it stand for a new provider |
| [CI](../../.github/workflows/ci.yml), including smoke and the evidence gate | Partly retired | Done: the real-bd matrix lane and its pinned bd installation are gone, so CI installs no Go toolchain and builds no `bd` binary — the implementation lanes are self-contained. Smoke and the evidence gate remain and must keep an honest legacy verification path |
| [STATUS history](../../STATUS.md), conformance matrix documentation, release/design/evidence records | Docs follow-up | Add current-status pointers where needed; preserve original claims, source/build pins and limitations |

### Ruling — keep as frozen (2026-11-23)

The real-Beads bridge is retired, but the Read-cohort and bd-baseline apparatus around it
is **kept as frozen evidence, not retired**. The following are deliberately retained and
must not be removed as dead code:

- [cohort generator](../../scripts/generate-read-cohort.mts) — it spawns the retired
  `apps/bdpbd`, so it can no longer regenerate anything;
- [bd baseline](../../scripts/bd-baseline.mjs) and its test;
- the bdpbd half of the [readiness proof](../../scripts/e2e-ready.mjs);
- the bdpbd entries in [harness bindings](../../scripts/read-harness-bindings.ts);
- the Read-cohort fixtures, [cohort verification](../../packages/conformance/src/cohort-verification.ts)
  and the cohort tests.

This is a ruling rather than an oversight, for two reasons. First, the wire-level
conformance gate does **not** subsume the Read cohort: the gate measures operation and
fault coverage against an in-memory reference, whereas the cohort binds a SHA-256 baseline
to a real `bd` executable's identity. Those are different guarantees, and the gate's merge
must not be read as retiring this apparatus. Second, a sealed cohort pins the document
paths it cites, and there is no verify-only re-seal path — re-sealing runs the generator
against the retired producer — so sealed evidence can only be superseded by a fresh seal,
never edited or repointed. Editing a sealed fixture fails the evidence gate outright.

Dead-code hygiene on the vestigial files above therefore needs its own explicit ruling.
| Sybil's OpenAPI/schema/CLI mapping, Trish's Types/startup work, existing Beads implementations and global bd installation | Ignore: separate ownership | Coordinate only at the named receiving seam; no edits in this cleanup |

There is no separate release workflow in this starting tree. The release-facing
surface includes the package/bin manifests and the tarballs exercised by smoke;
removing a binary there is part of the reviewed retirement change.

## Test-transfer ledger

These are inspected test obligations, not fresh passing results. Keep the legacy
tests until their replacement actually exercises the same boundary. Reuse the
existing shared tests where they already cover it; avoid copying an app-specific
test and counting it as independent coverage.

| Obligation and source | Replacement target and acceptance |
| --- | --- |
| App `server-composition.test.ts`: advertised limits equal enforcement; configured faults precede process dispatch | Retained reference composition and wire tests. Exercise exact boundary/over-bound requests and prove no provider call occurs on an earlier refusal |
| `apps/bdpbd/test-support/matrix-lifecycle{,.test}.ts`: abort, drain, close, remove, withdraw; preserve primary/cleanup failures; delayed deadline and parent cancellation | Shared conformance lifecycle helper used by an actual replacement matrix. Preserve phase ordering, successful cleanup and hostile-work failure tests; changing its evidence binding requires new evidence |
| `packages/adapter-bd/src/index.test.ts`: isolated environment, split UTF-8, deadline, output bound, final-reader cancellation and hostile descendants | Keep process-specific guarantees on the legacy adapter while it executes. Test HTTP disconnect/cancellation and bounded input/output on retained service/Go transports. The postponed inverse CLI provider receives subprocess tests only if separately authorized |
| `packages/server/src/{http-handler,node-http-listener,read-http}.test.ts`: bodyless responses, metadata, negotiation/auth order, private cache policy, disconnect and bounded listener shutdown | Keep these shared tests. Add retained v0.1 wire cases using the selected media and actual reference-service composition; old `application/json`/Read assertions remain old-contract coverage |
| `scripts/smoke-executables.mjs`: installed entry point, help/version, configuration, lifecycle, unsupported-profile refusal and admitted discovery | Pack and launch the replacement executable in isolation. Prove its real configuration and admission, then drive mutations/Events/recovery separately; a successful discovery probe alone does not qualify Write |
| `packages/conformance/test-support/bd-workspace.ts` and `apps/bdpbd/src/read-matrix.test.ts`: executable identity, fresh workspace, restoration and independent readiness oracle | Preserve as legacy-specific tests/evidence. Create separate retained-provider restart/recovery fixtures; never substitute a new target under the old matrix label |

## SQLite service assessment

The fixture adapter in `packages/adapter-in-memory` is deterministic Read data.
Mutable SQLite storage lives inside `packages/server`; there is no standalone
SQLite adapter package.

| Existing source | Reusable machinery | Selected retained v0.1 gap |
| --- | --- | --- |
| [recovery-store.ts](../../packages/server/src/recovery-store.ts), `openRecoveryStore`, `reference.sqlite`, private format 4 | Single SQLite owner for resources, identity non-reuse, aliases, principal/key state, synchronous effect/outcome commit, expiry and abandoned-claim recovery | No required Event table/commit path in this owner. Plan a distinct captured store/contract boundary before adding facts; old databases cannot silently become the new logical contract |
| [member-executor.ts](../../packages/server/src/member-executor.ts), [member-identity.ts](../../packages/server/src/member-identity.ts), [semantic-identity.ts](../../packages/server/src/semantic-identity.ts) | Original retained outcomes, alias witnesses, exact numeric identity and compare-before-execute | Identity and outcome formats still use inherited operations/contract context. Retained v0.1 and capability selection must enter semantic identity; same key across different meanings must conflict |
| [resource-evaluator.ts](../../packages/server/src/resource-evaluator.ts), alias evaluator | Guard/no-op/policy evaluation and transactional allocation | Existing fixed-root/kind assumptions, installed-descriptor interpretation and singular source revision results need explicit retained changes. Preserve whole URI/exact affiliations and both endpoint pins; emit complete initial/final `ownerRevisions` |
| [development-composition.ts](../../packages/server/src/development-composition.ts), [development-runtime.ts](../../packages/server/src/development-runtime.ts), [installed-reference.ts](../../packages/server/src/installed-reference.ts) | Listener, authentication, bounded receiving and configured authority capture | Still v0 `read-update`, generic JSON and inherited operation-directory/sequence routing. New composition needs selected discovery, eight distinct advertised POST URLs and version-specific media. Private installed factory returns `claimEligible:false` |
| [transaction-store.ts](../../packages/server/src/transaction-store.ts), `transaction.sqlite`, private format `bdp-private-transaction-snapshot-11`; [transaction-events.ts](../../packages/server/src/transaction-events.ts) | One owner already commits graph effects, groups and terminal receipt state; finite replay machinery provides useful implementation lessons | Different receipt/epoch/position/sequence model and inherited Event vocabulary. Reuse only reviewed mechanisms; required retained postimages/coverage and ordinary results need a separate implementation/acceptance path |

Prefer the smaller recovery-store/member path for the first ordinary-write slice,
subject to a concrete owner/format review. Required facts and original outcomes
must become durable with the same effects. A second journal around external writes
cannot provide that atomicity. Keep existing stores and private installed tests
untouched until the new composition has an explicit format and receiving plan.

## Sequential implementation slices

Each slice gets a reviewable delta under the subordinate implementation issue.
No slice advertises a complete profile before all of that profile's obligations
pass independent wire acceptance.

| Slice | Scope | Done when |
| --- | --- | --- |
| 0. Freeze and inventory | Four documentation files named above; test-transfer and service-gap ledger | Exact documentation delta passes local link/whitespace checks and Trish accepts its receiving scope on the child tracker |
| 1. Private retained service vertical slice | New retained composition, owner/format boundary and focused raw-HTTP acceptance beside existing server code | Discovery follows arbitrary configured navigation and selected media; create/read produces a complete original result and one committed postimage Event; disconnect/restart with the same key returns the original result without another allocation or Event; unsupported surfaces refuse and incomplete profile remains private |
| 2. Complete retained Core/Write | All ordinary reads, six CRUD targets, aliases, admission/guards, required scope/resource Event replay and durable recovery | Independently authored wire cases cover the acceptance families below, with source/build/evidence pins and exact failures/NOTRUN limits; Trish accepts the profile claim |
| 3. Retire default legacy participation | Transfer shared obligations to qualified replacement targets, then adjust build/test/smoke/package/CI/admission together | Every ledger row has a replacement check or explicit legacy-only disposition, normal affected checks pass, historical evidence remains verifiable at its own pins, and Trish reviews the default-path change |
| 4. Reusable Go client and canonical CLI | Product-independent module and thin CLI, after Sybil's concrete mapping/fidelity handoff | Both run against the reference service and an independently authored HTTP fixture. Verify URL/query preservation, omission/null, exact JSON numbers/References, complete results, frozen-key retry, Events and canonical CLI lowering; no product imports |
| 5. Embeddable Go handler/provider | HTTP handler plus backend interface for complete semantic decisions; configurable transport/auth/cancellation/IO | An independent provider/wire harness proves one owner atomically handles key identity, allocation, guards, owner effects, Event facts and original results. A receiving product can pin/vendor the module and adapt shared semantic operations without invoking separate committing singleton calls |

Acceptance families for slice 2 include discovery/media/kind/navigation; complete
ordinary and alias results; guard failure and no-op behavior; exact Type/endpoint
References and affiliation changes; all induced owners; authorization and refusal
ordering; uncertain-response/restart/expiry/key conflict; Event postimages,
scope/resource projection, captured replay boundaries and explicit gaps. Optional
capabilities are advertised only after their own complete tests. Six-CRUD
atomic-batch1, full History, projection and Types each retain their own gates.

Richer selection/Query/batch encodings, replication and public receipts, other
languages, a generic inverse executable provider and product-specific operations
remain outside this cut.

## Validation and split points

For slice 0, validate Markdown relative targets, the four-file scope and whitespace;
confirm no protected source/evidence bytes changed. Runtime tests and full workspace
build are NOTRUN because this patch changes no executable behavior. Source inspection
is not a substitute for their later execution.

For slices 1/2, schedule the exact runtime/toolchain/command scope with Janet and
Trish before SQLite/build/conformance work. Use pinned Node 24.22.1 and pnpm 11.20.0.
Start with focused new retained tests and affected store/member tests, then run the
normal build/static/package gates for the frozen delta. Record exit codes, exact
head, logs and skipped cases. The currently queued Types/startup validation belongs
to Trish and must not be absorbed into this patch.

For slice 3, the planned normal checks include `pnpm check:boundaries`,
`pnpm typecheck`, `pnpm build`, affected legacy/replacement matrix and harness tests,
`pnpm smoke`, readiness preflight and `pnpm evidence:verify`, with explicit expected
claim state. Freeze the exact selection before running it. Missing evidence,
skipped tests or an uninspectable claim are never a pass.

Split before modifying evidence bindings, installed startup files, shared schemas
or another owner's active scope. Reconsider the first service boundary if it
requires broadly porting Types/Transactional behavior. Any failed check introducing
a new failure family gets an updated scope/validation plan before more edits.
