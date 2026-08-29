# Gate 0 item 9: client interface and Scope port — design finding

Status: living design record, non-normative. A public Read client, Scope port,
both adapters, the Read schema/problem prerequisites, external Type Descriptor
safe-fetch support, a complete dual-target matrix lane, and the committed
atomic two-target Read evidence cohort now exist (see `STATUS.md` for the
current evidence state). Item 9 remains **open** until the programmatic
authentication and retry seams, remaining boundary policy, shared adapter
evidence, and port freeze are complete. The current contract is an implementation checkpoint
rather than a frozen compatibility promise; the port is frozen only after both
the deterministic and `bd` adapters exercise the complete Read surface, per
[component-specifications.md → Server module and Scope port](./component-specifications.md#server-module-and-scope-port).

The normative source of truth is the [BDP v0 draft](../specs/bdp.md); if this
document conflicts with the draft, the draft governs.

## Why item 9 is still open

Item 9 asks that the reusable client (`@bdp/client`) and server Scope port
(`@bdp/server`) be deep compile-time and runtime contracts informed by both
adapters. The earlier schema and Read Problem prerequisites have landed. The
current client now exposes typed request/result unions, validates successful
Read envelopes and direct Problems from the canonical schema bundle, and keeps
transport success distinct from transport-observed Problem responses.

What remains is completion rather than initial existence:

- the programmatic authentication seam is still open and must remain
  scheme-agnostic;
- automated retry policy must combine the normative disposition with operation
  idempotency rather than treating `retry` as a complete decision;
- external Type Descriptor retrieval now has an explicit exact-Type-ID allowlist,
  credential-omission, manual-redirect, and response-bound policy, while
  off-Scope `service-desc` discovery remains unsupported;
- higher-profile discovery cannot be accepted from a partial Read-shaped
  envelope; the applicable reviewed schema must exist first; and
- the contract and port remain unfrozen until the shared real-adapter
  contract suite and the remaining port-freeze work complete; the atomic
  target-bound evidence cohort itself is committed and gate-verified (see
  `STATUS.md`).

The startup-configuration contract already accepts an `auth.token` input on
the process side
([startup-configuration.md → Fields](./startup-configuration.md#fields));
that is a runtime input to the executables and does not settle the
programmatic client's authentication seam, which is still open and must not
assume a specific scheme
([architecture.md → Client module](./architecture.md#client-module),
[CLIENT-001..003](./requirements.md#client-requirements)).

## Read surface represented by the current contracts

From the [Conformance profiles](../specs/bdp.md#conformance-profiles-and-reading-guide),
[Types and Type Descriptors](../specs/bdp.md#types-and-type-descriptors), and
[Collection retrieval and selection](../specs/bdp.md#collection-retrieval-and-selection)
sections of the normative draft, the minimum Read profile is:

- the canonical Scope response and its `service-desc` discovery document;
- the discovered **`beads/`, `links/`, and `types/`** inventories as three
  paginated retrieval operations;
- individual canonical Bead and Link Resource reads;
- Bead and Link collection retrieval with the structural predicates and
  bounded Selector defined in the collection-retrieval section (paginated
  per that section);
- the `properties` view for a Bead or Link; and
- the incident-Link `links` view for an in-Scope Bead.

The current discriminated request union represents each operation above. That
does not make the implementation conformant by itself: target behavior remains
subject to the cumulative matrix and target-bound evidence gate.

## Current selected Read shape — not frozen

The implemented Read checkpoint uses one deep `perform` entry taking a
discriminated request union on both the client and the Scope port:

- one entry composes with generic wrappers (retry decided from *both* the
  normative failure disposition and the request's idempotency guarantees,
  tracing) without one wrapper per method;
- adding a Read+Update or Transactional operation is one new variant in the
  request-kind union plus one branch in an adapter, not a new method on
  both the client and the port; and
- the port never mirrors HTTP routes
  ([architecture.md → Server module](./architecture.md#server-module)).

This shape is exercised but not frozen. Operation-family or capability-shaped
interfaces remain possible if later-profile pressure demonstrates a deeper
boundary. The one shape ruled out is one interface method per Read HTTP route.
That rejection rests on
architecture, interface depth, and duplication: mirroring the wire produces
a wide shallow interface and duplicates route vocabulary and dispatch logic
between the port surface and each adapter. It does not rest on
[PROTO-001](./requirements.md#protocol-requirements), which is only about
truthful profile advertisement and neither requires nor forbids any
particular interface shape. Route mirroring remains one rejected extreme;
family- and capability-shaped alternatives require evidence before replacing
the selected shape.

## Local errors remain separate from protocol Problems

The normative problem-family table covers failures returned by a BDP HTTP
authority. Client lifecycle, capability, request-construction, configuration,
and transport implementation failures are local and must not acquire invented
wire meaning.

The current public taxonomy is:

- `BdpClientClosedError` / `client-closed` after close has stopped admission;
- `BdpClientOperationAbortedError` / `operation-aborted` for caller or close
  cancellation;
- `BdpClientCapabilityError` / `safe-fetch-policy-required` when navigation
  names an external Type Descriptor ID outside the explicit exact-ID allowlist or
  an off-Scope `service-desc` target;
- `BdpClientRequestError` / `invalid-request` for runtime request-shape errors
  such as invalid limits, directions, or fields;
- `BdpClientContinuationCapacityError` / `continuation-capacity-exceeded` when
  retained and in-flight continuation capabilities or their retained traversal
  history reach the client's local bounds; and
- `BdpClientTransportError` / `transport-failed` when a custom transport rejects
  before producing its discriminated result.

Capacity failure never fabricates a wire Problem and never silently evicts an
issued capability. Because the successful page whose `next` cannot be retained
is not exposed, the caller creates an opaque `BdpContinuationScope`, passes it
on each operation in that logical traversal, and can call
`forgetContinuations(scope)` to discard only that scope's retained but currently
unleased capabilities before retrying the idempotent Read. The method preserves
in-flight leases and their capacity accounting; another scope's capabilities
are unaffected. Consuming one retained continuation also reclaims one slot;
`close()` discards the entire registry after admitted operations settle. The
`bd-domain` readiness traversal creates one scope, carries it through every
read, and performs this scoped reclamation automatically whenever a traversal
returns a Problem or throws before consuming every issued continuation.

The current Fetch boundary has one additional rule: only a non-success response
carrying a valid BDP Problem may become that protocol Problem. A body-less
normative `500`, HTML, wrong-media, or otherwise non-Problem error response is
a local `BdpClientTransportError`, because assigning any of them a Problem code
or retry disposition would invent wire meaning.
Read application success is exactly `200 OK` with a JSON representation;
unexpected `2xx` responses are likewise a local transport contract failure.
Before any response status is observed, deadline and connection failures remain
bounded `temporarily-unavailable` results. An unreadable successful response,
including a body deadline, response-limit violation, or malformed JSON, also
maps to `temporarily-unavailable` when no more precise local failure is
available. Once a non-success status is observed, however, an unreadable,
timed-out, oversized, wrong-media, or malformed body cannot be promoted into a
wire Problem: it is a local `BdpClientTransportError`. Only a schema-valid BDP
Problem crosses that boundary. The explicitly permitted body-less `500` remains
an HTTP observation without a BDP retry disposition. This is the reviewed retry
surface for the current Read slice; later profiles may extend it only with an
explicit problem-table decision.

## Owned, schema-validated response values

`BdpTransport` now returns a discriminated success or Problem observation. The
HTTP outcome, rather than JSON member names, identifies the branch, so a legal
successful `properties` object that happens to contain `type`, `code`, and
`retry` remains ordinary properties.

At the client boundary, canonical-schema parsers validate and deeply snapshot
Read discovery, direct Problems, Bead and Link records and collections, Type
inventory entries, Type Descriptors, and properties. The snapshots are frozen
before callers receive them. The client then applies request-context checks the
standalone schemas cannot express: exact singleton identity, fixed Scope roots,
canonical local Bead and Link IDs, authoritative continuation confinement,
endpoint-reference classification, and the requirement that every Link have
at least one in-Scope endpoint. Cached discovery is therefore owned and
immutable rather than a transport-owned object that can change navigation after
validation.

Public client results remain direct success values or direct `ReadProblem`
values. Because a legal properties object may itself contain valid-looking
`type`, `code`, and `retry` members, consumers must use the exported
`isBdpClientProblem` guard rather than the protocol's structural
`isReadProblem` guard. The client guard is backed by a module-private weak brand
applied only on known Problem branches, so successful properties cannot forge
it. `@bdp/bd-domain` uses this client-specific guard at every direct
`BdpClient` result boundary and exports `isReadinessProblem` for its own
ready-array-versus-Problem result.

The server applies the same provenance rule at the backend seam. `ScopePort`
adapters return an internal discriminated result created with
`scopePortSuccess()` or `scopePortProblem()`. The Read server unwraps that
result only after exact-shape validation. Problems are parsed against the
closed mapping; each success body is parsed and deeply snapshotted with its
request-specific protocol parser, then checked for the requested Resource ID,
Scope confinement, filters, and incident-Link direction where applicable.
Malformed or subsequently mutated adapter values therefore cannot become a
nonconformant `200`. The owned result carries failure provenance to the HTTP
boundary instead of structurally inspecting `type`, `code`, and `retry`, so a
complete stored properties object containing those names remains a `200`
success end to end. Direct in-process consumers use
`isReadServerProblem()` for the same non-structural distinction.

This checkpoint validates only the reviewed Read discovery envelope. A higher
cumulative profile is not accepted through an incomplete Read-shaped discovery
object; support waits for that profile's reviewed discovery schema.

## Current external-navigation policy

The `@bdp/client` Fetch transport is Scope-confined by default. A Type Descriptor
hosted anywhere beneath the canonical Scope may be retrieved by its exact Type
ID; it is not required to be a child of the `types/` inventory URL. An external
Type Descriptor may be fetched only when its exact canonical, credential-free
HTTP(S) Type ID appears in `externalTypeDescriptors.typeIds`; admitting one ID
does not admit another path on the same authority. The request uses
`credentials: "omit"`, Fetch remains in manual-redirect mode, the observed
response URL must equal the requested descriptor identity, and the same
deadline, byte, JSON-shape, media-type, schema, and contextual checks apply as
for an in-Scope response. Userinfo and unlisted Type IDs fail locally with
`BdpClientCapabilityError` before dispatch.

The controlled conformance authority is exactly `https://work.example`. It
rejects Authorization and Cookie fields and publishes the selected Task and
Blocks descriptors. The Task contract describes Beads and conforms to Work
Item. The Blocks contract describes Links, conforms to Dependency, and carries
closed source and target constraints with empty `conformsTo` arrays. Those two
reads close the external `read.types.descriptor` execution row without turning
the exact-ID allowlist into authority-wide or general external navigation.

An off-Scope `service-desc` target remains valid protocol topology but is not
admitted by this policy. It still requires a separately reviewed discovery
authority policy; the client throws `BdpClientCapabilityError` before external
dispatch.

An injected Fetch implementation must preserve the semantic observed URL in
`Response.url`, just as native Fetch does. An empty URL is not treated as
evidence that no redirect occurred; it fails confinement validation. Test dial
adapters that route a semantic URL to a loopback listener therefore restore the
semantic URL on the returned `Response` before handing it to the transport.

## Lifecycle policy selected for Read

The implementation policy is selected separately for the client and server:

- Client Read close stops admission, cancels already admitted logical
  operations, and waits for bounded cleanup before reporting close complete.
  Fetch implementations that ignore abort cannot be force-settled by the
  client; after the response cleanup deadline the underlying promise is
  explicitly abandoned, and any late response body is still cancelled through
  the same bounded cleanup path. This is an explicit incomplete-transport
  policy, not an unbounded close wait.
- Custom transports receive the same liveness boundary through the validated
  `transportSettlementTimeoutMs` client option, which defaults to 30 seconds.
  `close()` waits up to that bound for already-observed transport Promises and
  then explicitly abandons any that remain unsettled. Their settlement wrappers
  continue observing late rejection, so abandonment cannot create an unhandled
  rejection.
- Server close stops admission, allows admitted Read operations a configurable
  grace period (250 ms by default), and then forwards one shared cancellation
  signal. It waits for backend cleanup only through the configurable total
  close bound (two seconds by default); a still-unsettled Scope port is then
  explicitly abandoned while its late settlement remains observed.
- A listener disconnect settles the caller-facing logical operation and forwards
  one aborted signal to the Scope port, which owns backend cleanup. Server
  deadlines remain open pending the reviewed timeout policy.
- Non-idempotent operation cancellation remains gated on the Read+Update
  contract.

This policy is implemented by the public client and Read server lifecycle
surfaces. It remains design guidance rather than a compatibility freeze: later
profiles still need reviewed deadline and non-idempotent cancellation rules,
and those rules must extend the same admission-and-drain model rather than add
private lifecycle gates or test-only close machinery.

## Adapter evidence milestones

The contract is no longer only a prototype. A typed request union and
schema-backed response parsers cover the minimum Read operation surface; the
Read server translates that wire-neutral union through `ScopePort`; and both
the deterministic fixture port and the process-backed `bd` port implement it.
Package tests exercise operation dispatch, Problem translation, cancellation,
close/drain behavior, and bounded process execution. The non-attesting matrix
can run all 33 Read scenarios against the reference target and a controlled
real-`bd` lane.

The target-specific topology is explicit. The reference external-endpoint branch
proves both external-source and external-target `blocks` Links around its
Decision Bead. When a pinned `bd` executable is available, the real-`bd` branch
exercises the native local-source/external-target orientation created by
`bd dep add` and preserves the opaque external identity. CI skips that
conditional lane only outside the required hosted gate: the workflow
source-builds pinned `bd` 1.0.5, selects it with
`BDP_BD_MATRIX_EXECUTABLE`, and sets `BDP_REQUIRE_BD_MATRIX=1` so missing
real-binary coverage fails instead of skipping. Local execution is not itself
admitted target evidence.
For restore identity, the reference branch reopens the logical data at the same
canonical Scope and preserves Resource URLs while retaining deletion. The
real-`bd` branch exposes restored data at a newly configured Scope, changes the
canonical Resource URLs, and returns `404` from both old Resource URLs. These
differences are fixture-owned evidence rather than normalization into one false
common mechanism.

That evidence is necessary but not yet the item-9 exit or port-freeze evidence:

- the existing package-specific tests must be reconciled into a shared port
  contract suite that runs the complete operation and lifecycle obligations
  against both real adapter constructions;
- the executable matrix implements every catalog scenario, including the
  programmable client/lifecycle action family, and remains non-attesting by
  construction (`claimEligible` stays `false` in every runner report); and
- admission and any Read claim are governed solely by the committed atomic,
  target-bound evidence cohort for both implementations (see the conformance
  matrices document and `STATUS.md` for the current state).

The port stays evolvable while the remaining freeze work completes. The
atomic target-bound dual-target cohort is committed and green; the port
freezes only after the shared real-adapter suite joins it. "Serves partial
Read" is never a valid advertised state.

Where existing component or conformance documents already name these
suites, that terminology governs and this document must be updated to
track it.

## Closed typed interface checkpoint

The two earlier prerequisites have landed. The canonical Read schema bundle
now fixes discovery, paginated `types/`, Resource and collection envelopes,
Type Descriptors, properties, and direct Problems. The compact Read Problem
table supplies the finite `code`/status/`retry` relationships used by the
schema-derived validators and result unions. The public client therefore no
longer returns `unknown` bodies or relies on member-name heuristics to
distinguish success from a transport-observed Problem.

This closes the schema and Problem-definition prerequisites; it does not close
item 9. The remaining open interface work is the scheme-agnostic authentication
seam, reviewed automated retry classification, off-Scope `service-desc`
navigation, higher-profile discovery schemas, consistent local-versus-protocol
error boundaries, and the shared adapter evidence required before the port
freezes.

## Client navigation and opaque tokens

The current client honors the discovery and continuation obligations
[CLIENT-002](./requirements.md#client-requirements) already places on the
reusable client:

- follow the `service-desc`, discovered inventory, view, and authoritative
  continuation URLs the server returns (for example, pagination `next`
  URLs and other authoritative next-hop links) rather than reconstructing
  them from base URLs, path templates, or query recipes; and
- preserve opaque Resource revisions, Scope positions, cursors, and
  Event IDs verbatim on the request that consumes them, without parsing,
  re-encoding, or synthesizing new shapes for them.

The client accepts a continuation only after it has issued the exact `next` URL
and recorded its collection or incident-Link context. A continuation cannot be
rebound to another collection, Bead, or direction; the direction for a later
incident-Link page comes from the issued context rather than caller input.
One authoritative URL may be issued repeatedly or for multiple distinguishable
contexts, so the registry retains each URL/context issuance capability rather
than one mutable value per URL. A request synchronously leases exactly one
matching issuance owned by its continuation scope before discovery or network
dispatch; a second concurrent
request cannot replay that issuance. Any Problem, local error, invalid response,
abort, or failed registry commit restores the lease, while a valid successful
page consumes it and may replace it with `next`. Reserved capabilities continue
to count against the registry bound. A self-loop, a cycle to any URL previously
issued in that traversal, and a URL that would be ambiguous between directions
for the same Bead fail the response closed. The client retains at most 1,024
unconsumed pairs and 10,000 total URL-history entries across live traversals; it
rejects a response that would exceed either bound instead of silently evicting
an earlier authoritative continuation. Callers that intentionally
abandon pagination can reclaim that traversal's retained, currently unleased
capabilities with `forgetContinuations(scope)`; active leases remain valid and
counted, and continuations owned by other scopes remain usable. `close()` clears
the complete registry. Unknown continuations, including capabilities issued to
another scope, are rejected locally before discovery or network dispatch.

For currently supported navigation, contextual validation also confines Scope
data, continuation URLs, and local Resource identities to the configured
Scope. An exact Type Descriptor ID may point outside the Scope only when that
same ID is explicitly allowlisted and follows the credential-free safe-fetch
policy above. An off-Scope `service-desc` URL remains deferred with
`BdpClientCapabilityError`.
The server module owns HTTP discovery, routing, and the authoritative navigation
URLs it emits; the Scope port remains wire-neutral and does not produce or
follow those URLs.

## What this slice does *not* ship

- No frozen `@bdp/client` or `ScopePort` compatibility promise.
- No programmatic authentication integration or automated retry executor.
- No generic external-fetch capability or off-Scope `service-desc` discovery;
  external Type fetching is limited to explicit credential-free Type IDs.
- No acceptance of higher cumulative profiles through an incomplete Read
  discovery envelope.
- No shipping Read claim: admission and evidence state are governed by the
  committed atomic dual-target cohort and its gate, never by the execution
  manifest alone.
- No reviewed resolution yet for the Fetch/custom-transport and
  request-error/Problem classification asymmetries recorded above.

## Item 9 exit status

Item 9 is **open**. This document is the Gate 0 deliverable for item 9: a
living design record for an implemented but unfrozen checkpoint. The Read
schema and Problem prerequisites, public client, Scope port, adapter
constructions, lifecycle behavior, and non-attesting dual-target lane are
present. Item 9 remains open on authentication, automated retry, external
`service-desc` policy, higher-profile discovery, boundary-classification
review, and the shared real-adapter contract suite.
The evidence state of record is the committed cohort artifact and its gate
(`pnpm evidence:verify`), not any snapshot in this document; runner reports
keep `claimEligible` `false` by construction. Exact-head CI, whole-branch
adversarial review, and tree-equality proof remain mandatory final gates.
None of the current implementation or test coverage is a shipping
Read-conformance claim.
