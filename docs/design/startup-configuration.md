# Startup configuration contract

Implements the **partial role-specific closure** of the startup-controls
design question: the base, plus the first three role controls (advertised
profile, `bdptest` fixture selection, the four conformance runner fields, and
the binding Read page, Selector, and cursor lifetime limits). Non-normative.

Public server admission is fail-closed. `--serve` is the only CLI action that
requests a listener; supplying `--config` merely selects configuration and does
not imply service startup. Before binding, each server requires an explicit
`server.advertisedProfile` and proves that the executable has established the
entire cumulative surface it would advertise. Absent recorded evidence for a
profile, both executables refuse it—including `read`—with exit code 2 before
calling `listen`; Read admission is currently backed by the committed
two-target evidence cohort (see `STATUS.md`), and higher profiles remain
refused because their cumulative surfaces are not implemented. This
fail-closed design is intentional, not a default-profile substitute.

Four roles need startup configuration: the client (`bdp`), the
server (`bdptest`, `bdpbd`), the `bd` adapter (inside `bdpbd`), and the
conformance runner. They share **one** contract, implemented once in
`@bdp/config`. There is no per-role schema: each role reads a fixed set of
sections and ignores the rest.

`loadStartupConfig` takes an optional `role`. When a role is supplied, the
loader consults *only* the sections that role owns and returns a role-scoped
view of the resolved config; a mistake in a section that role does not read
cannot block startup. Omitting `role` is the shared-contract test seam: every
section is validated and every section is present in the returned config.

The conformance runner is a **future consumer**: it is named here because the
field list was designed for it, but `@bdp/conformance` does not depend on
`@bdp/config` yet and will not until it has something to configure.

Storing an advertised profile or a fixture identifier neither opens a listener
nor loads a fixture; it fixes what a Wave 2 consumer will read. The limit fields
are different: once a server is admitted, they are binding public discovery
claims and the same resolved values must configure its Read controls. Admission
remains closed until that complete behavior has executable evidence.

`ProtocolProfile` — the wire vocabulary `read`, `read-update`, `transactional`
— lives in `@bdp/protocol`, not `@bdp/config`. Config imports the type and its
validator so no consumer invents its own spelling. See **Scope discovery and
human documentation** in `docs/specs/bdp.md` for the normative source of these
three tokens; the
human label `read+update` is not a wire token and is refused.

This document defines process startup only. It answers no BDP wire question, adds
no HTTP route or listener, and names no schema `$id`, problem URI, media type, or
link relation.

## Role sections

Each role reads exactly these sections; content in every other section is
silently ignored. Structural vocabulary (unknown top-level sections or nested
field names) is validated globally so a typo cannot hide under an unrelated
role — see the "Loudness" section below.

| role | sections read | scope-derivation inputs |
| --- | --- | --- |
| `bdp` | `mode`, `scope`, `auth` | `server.host`, `server.port` (see field-level dependency) |
| `bdptest` | `mode`, `scope`, `server`, `bdptest` | — (server owns them outright) |
| `bdpbd` | `mode`, `scope`, `server`, `bd` | — (server owns them outright) |
| `conformance` | `mode`, `scope`, `auth`, `conformance` | `server.host`, `server.port` (see field-level dependency) |

`server.advertisedProfile` is one field with two consumers: `bdptest` and
`bdpbd` both consult it, on purpose, because the shared server admission boundary
enforces the same profile-guarantee rule regardless of adapter. Splitting it
into two fields would let two servers under the same operator disagree by
accident about which surface they claim.

### Field-level dependency: `server.host`/`server.port` for scope derivation

`server.host` and `server.port` are section-owned by the server role, but they
are *also* shared inputs to the derived local-test Scope URL. Whenever the
derivation is going to fire — that is, whenever `scope.url` is absent and
`mode` is `local-test` — every role consults and validates them so all four
role views resolve to the *same* Scope. Without this rule, a shared local-test
configuration with `BDP_SERVER_PORT=9000` would let `bdptest` derive port 9000
while `bdp` derived the default 8080; the one-identity contract would break.

Server roles emit `host` and `port` in their `server` section as before.
Non-server roles do not — they need the values only to compute the Scope URL,
and emitting them would create the appearance of a listener they never bind.

When `scope.url` is supplied explicitly, the derivation never fires and
non-server roles ignore `server.host` and `server.port` entirely. An invalid
value in a purely server-only field (like `server.advertisedProfile`) is
always irrelevant to `bdp` and `conformance` and never blocks their startup.

## What this contract does not yet cover

The public page, Selector, and cursor-lifetime controls are fixed below. Cache
capacity is still an implementation safety concern rather than a discovery
claim and remains outside this public startup contract.

| pending control | owner | why deferred |
| --- | --- | --- |
| retained snapshot byte/node/state capacities | servers | They protect one implementation's memory budget but are not BDP discovery fields. A later deployment-control decision may expose them without changing the binding public limits below. |

Adding a public capacity control is a change to this document first.

## Fields

| field | env var | roles that read it | default |
| --- | --- | --- | --- |
| `mode` | `BDP_MODE` | all | `local-test` |
| `scope.url` | `BDP_SCOPE_URL` | all | derived local-test URL, below |
| `auth.token` | `BDP_AUTH_TOKEN` | client, conformance runner | unset |
| `server.host` | `BDP_SERVER_HOST` | server | `127.0.0.1` |
| `server.port` | `BDP_SERVER_PORT` | server | `8080` |
| `server.advertisedProfile` | `BDP_SERVER_ADVERTISED_PROFILE` | server | unset (an explicit value is required before a listener may bind) |
| `server.limits.page.defaultItems` | `BDP_SERVER_PAGE_DEFAULT_ITEMS` | server | `50` Resources |
| `server.limits.page.maximumItems` | `BDP_SERVER_PAGE_MAXIMUM_ITEMS` | server | `200` Resources |
| `server.limits.selector.bytes` | `BDP_SERVER_SELECTOR_BYTES` | server | `16384` UTF-8 bytes after percent-decoding |
| `server.limits.selector.depth` | `BDP_SERVER_SELECTOR_DEPTH` | server | `32` parsed nodes deep |
| `server.limits.selector.nodes` | `BDP_SERVER_SELECTOR_NODES` | server | `256` parsed nodes |
| `server.limits.cursorTtlMilliseconds` | `BDP_SERVER_CURSOR_TTL_MILLISECONDS` | server | `300000` ms |
| `server.internalFaultResource` | `BDP_SERVER_INTERNAL_FAULT_RESOURCE` | server | unset |
| `bd.executable` | `BDP_BD_EXECUTABLE` | `bd` adapter | `bd` |
| `bd.workspace` | `BDP_BD_WORKSPACE` | `bd` adapter | unset |
| `bdptest.fixture` | `BDP_BDPTEST_FIXTURE` | `bdptest` | unset |
| `conformance.profile` | `BDP_CONFORMANCE_PROFILE` | conformance runner | `read` |
| `conformance.scenarioFilter` | `BDP_CONFORMANCE_SCENARIO_FILTER` | conformance runner | unset |
| `conformance.seed` | `BDP_CONFORMANCE_SEED` | conformance runner | `0` |
| `conformance.reportFormat` | `BDP_CONFORMANCE_REPORT_FORMAT` | conformance runner | `json` |

The six public Read limits are tunable only inside these explicit safety
ceilings:

| field | default | maximum | safety basis |
| --- | ---: | ---: | --- |
| `server.limits.page.defaultItems` | `50` | `1000` | caps accidental response fan-out when a caller omits `limit` |
| `server.limits.page.maximumItems` | `200` | `10000` | caps per-request item materialization while the server's independent 64 MiB / 1,000,000-node snapshot guards remain authoritative |
| `server.limits.selector.bytes` | `16384` | `65536` | bounds the worst-case percent-encoded Node request/header budget to 212,992 bytes |
| `server.limits.selector.depth` | `32` | `128` | matches the repository's bounded JSON-value depth ceiling |
| `server.limits.selector.nodes` | `256` | `4096` | bounds parser and evaluator work inside the Selector byte ceiling |
| `server.limits.cursorTtlMilliseconds` | `300000` | `86400000` | caps retained snapshot lifetime at 24 hours; retained-state, byte, and node capacities remain independent hard bounds |

`scope.url` is the deployment's canonical Scope identity for every role. The
client dials it, a server advertises it, and the conformance runner targets it —
one name, not three.

`server.advertisedProfile` names what the server *intends* to advertise. It has
**no default**: silently defaulting to `read` would let a server claim a profile
the operator never asked for. `@bdp/config` stores and emits the field when
supplied; the server admission boundary separately requires it before a listener
may bind and refuses it unless the executable's cumulative profile surface is
established. `@bdp/config` does not decide
whether a chosen profile actually satisfies its required surface — advertising
a profile the implementation does not supply is a `PROTO-001` violation and is
the server module's responsibility to reject.

The three enumerated profile values — `read`, `read-update`, `transactional`
— are the exact wire tokens defined under **Scope discovery and human
documentation** in the normative draft (`docs/specs/bdp.md`). They are the only strings accepted for either
`server.advertisedProfile` or `conformance.profile`. The human label
`read+update` is not a wire token and is refused; the type union and the
runtime validator both live in `@bdp/protocol`, so no consumer invents its own
spelling.

All six `server.limits` leaves are positive integers no greater than their
field-specific safety maximum. Environment values and JSON strings use
canonical decimal spelling: no whitespace, sign, radix prefix, exponent,
decimal point, or leading zero. JSON numbers are judged by their parsed integer
value. Values above a maximum fail closed rather than reaching the server's
allocation and transport seams. Diagnostics name the field and accepted range,
never the rejected value. `server.limits.page.defaultItems` must not exceed
`server.limits.page.maximumItems`.

An admitted server copies the page and Selector groups into discovery without
changing units or values. It converts `cursorTtlMilliseconds` exactly to an ISO
8601 seconds duration at
`limits.retention.maximumSnapshotLifetime`; the default `300000` therefore
appears as `PT300S`. An admission-opening composition must give the cursor
engine the same millisecond value; advertising it alone is insufficient. These
claims do not weaken admission: whenever cumulative Read evidence is absent
for a target, `--serve` still exits 2 before binding even when every limit is
valid.

The reference server retains cursor snapshots in one process. A multi-instance
deployment must keep every continuation on the instance that issued its cursor
for at most the advertised lifetime; this implementation does not provide a
shared cursor store. Process restart rotates the Scope epoch and invalidates
all prior cursors with the ordinary expired-cursor behavior. Operators must
therefore configure sticky routing for the advertised lifetime or choose a
different reviewed pagination implementation.

`bdptest.fixture` is the identifier a Wave 2 test-rig will resolve into a
fixture bundle. `@bdp/config` does not attempt to locate or read a fixture;
that is deliberately outside startup configuration. The value follows a stable
implementation-only grammar — 1 to 128 ASCII characters matching
`^[A-Za-z0-9][A-Za-z0-9._-]*$` — chosen to exclude whitespace, path
separators, and `..` traversal. It is not a wire decision; a future fixture
engine remains free to add richer selectors above this identifier layer. The
rejection message names the grammar, never the offending value.

`conformance.scenarioFilter` selects which scenarios the future runner
executes. The semantics are pinned now so Wave 2 does not invent them:

- **Case-sensitive substring** matched against the stable scenario identifier
  only. It is not a glob and not a regex, and it never examines a scenario's
  title or tags.
- **Absent** means every scenario in the selected profile runs.
- **Empty** is invalid — an empty substring would match every scenario without
  the operator meaning to, so the field is refused rather than treated as
  absent.
- **Zero matches at runtime is a runner error**, not a silent success. That
  belongs to the runner; `@bdp/config` only stores the value.

The value is stored verbatim: punctuation like `*` or `[a-z]+` is not a glob
or a regex, so the caller gets exactly those characters back.

`conformance.seed` is a nonnegative integer that a future runner will use to
seed deterministic sampling. The accepted range is `0..Number.MAX_SAFE_INTEGER`
inclusive, so a seed can never round silently — a value larger than
`MAX_SAFE_INTEGER` is not exactly representable in IEEE 754 double precision
and would drift under any downstream arithmetic. The spelling rule matches
`server.port`: an environment or JSON string must be a canonical decimal
integer with no whitespace, sign, radix prefix, exponent, or leading zero,
while a JSON number is judged only as a value (`1e3` is indistinguishable from
`1000` after `JSON.parse`). `0` is the default so a runner without further
configuration produces the same trace every time.

`conformance.reportFormat` chooses between machine-readable (`json`) and
human-readable (`text`) output. Any other value is refused.

The config file is a JSON object with the same names:

```json
{
  "mode": "production",
  "scope": { "url": "https://beads.example/scopes/main/" },
  "server": {
    "host": "0.0.0.0",
    "port": 8080,
    "advertisedProfile": "read-update",
    "limits": {
      "page": { "defaultItems": 50, "maximumItems": 200 },
      "selector": { "bytes": 16384, "depth": 32, "nodes": 256 },
      "cursorTtlMilliseconds": 300000
    }
  },
  "bdptest": { "fixture": "minimal-read" },
  "conformance": {
    "profile": "read",
    "scenarioFilter": "discovery-",
    "seed": 42,
    "reportFormat": "json"
  }
}
```

## Precedence

Highest wins, per field. There is no deep merge and no override mini-language:
a field is taken whole from the first layer that supplies it.

1. `BDP_*` environment variables.
2. The JSON file named by `--config <path>`, or by `BDP_CONFIG` when the flag is
   absent. The flag wins; the two are never merged.
3. Compiled-in defaults.

## Canonical Scope identity

`scope.url` is stored in exactly one serialization, so two deployments cannot
disagree about whether they are the same Scope. The rule separates spellings that
*mean* the same thing from content that changes the meaning.

**Normalized, not refused.** The value is stored as `new URL(value).href` with a
trailing slash added if absent. Scheme and host case and a written-out default
port are differences a URL parser erases, so refusing them would be pedantry
rather than safety:

| supplied | stored |
| --- | --- |
| `https://EXAMPLE.com:443/scope/` | `https://example.com/scope/` |
| `http://example.com:80/scope/` | `http://example.com/scope/` |
| `https://example.com/scope` | `https://example.com/scope/` |

**Refused.** Startup fails, naming `scope.url`, when the value is not a non-empty
absolute URL, does not use `http` or `https`, embeds credentials, carries a query
string or fragment, or uses a path spelling that the URL parser would rewrite.
Path identity is fail-closed: repeated separators, dot segments, backslashes,
encoded dot segments, encoded unreserved characters, and noncanonical percent
escapes are refused rather than silently assigned a different identity. Scheme
and host case and a written-out default port remain the parser-normalized cases
listed above. A refused value produces exactly one finding: it is not also
reported as a mode violation, because a value that cannot establish one
canonical Scope is not evidence about which Scope was intended.

The trailing slash is a *storage* rule so that relative resolution against the
Scope URL is unambiguous. It states nothing about how any wire form must spell a
URL.

## Modes

`mode` exists only to make a production Scope identity impossible to acquire by
accident.

- **`local-test`** (default) derives `scope.url` from the configured listener:
  `http://<server.host>:<server.port>/local-test/`, with a bare IPv6 host
  bracketed and a default port dropped by URL serialization. Deriving it means
  the advertised Scope identity cannot drift from the address actually bound.
  Under the default host and port that is `http://127.0.0.1:8080/local-test/`.
  It must never be persisted or served as a real Scope identity.
- **`production`** has no default Scope URL. Startup fails with exit code 2
  unless `scope.url` is supplied explicitly.

A derived URL goes through the **same validator as a supplied one**. One function
decides what a Scope URL is; deriving a value does not exempt it from the rule,
and the stored form is normalized identically.

### A derived Scope URL must be dialable

Deriving only works when the listener address is also an address a client can
reach. Two configurations are not, and in both the derivation is refused rather
than producing a URL that names nothing:

- **a wildcard host** — `0.0.0.0` or `::` is every interface and no particular
  address, so it identifies no deployment. Non-canonical spellings of the same
  thing (`0`, `::0`, `0:0:0:0:0:0:0:0`) are caught too, because the check runs on
  the parsed host rather than the text.
- **port `0`** — the port is not chosen until `listen()` returns, so a URL naming
  port 0 cannot be dialed and will not match the port actually bound.

Both are legitimate *listener* settings, so neither is refused as a listener.
What is refused is inferring an identity from them: set `BDP_SCOPE_URL`
explicitly and the same listener is accepted.

### Exactly what production refuses

Two things.

A Scope URL whose **path begins with the reserved `local-test` segment**, on
any host. `https://beads.example/local-test/` fails; so does the default
local-test URL.

**`server.internalFaultResource` in any form.** The field is a conformance
launch flag: it names one canonical absolute HTTP(S) resource URL (no
credentials, query, fragment, or non-canonical spelling) whose read the server
fails with a private internal fault, observed on the wire as the body-less
`500` the internal-fault conformance row requires. It exists so the packaged
evidence generator can drive that row against a launched payload without any
runtime control channel. A production server that silently fails one
configured resource is an outage wearing a test harness, so production refuses
the field outright, exactly like the reserved path segment.

Production does **not** refuse a loopback host. `http://127.0.0.1:9000/main/` is
accepted, because a deliberate loopback deployment — a sidecar, a tunnel
endpoint, an integration host — is a legitimate choice and not the accident this
rule exists to catch. Nor does it refuse a path that merely starts with the same
letters: `/local-testing/` is a different first segment.

The BDP v0 protocol-identifier prefix is separate from `scope.url`, which is a
*deployment* address chosen by whoever runs the server. This seam invents no
protocol namespace, schema `$id`, or problem URI, and the
provisional-namespace decision does not change the deployment's Scope URL. `local-test` is a
reserved *path segment* in a deployment address, not a protocol identifier.

## Role rules

Two rules exist today.

**`bdpbd` in `production` mode requires an explicit `bd.workspace`.** In
`local-test` it may keep the deterministic default. A production `bd` adapter
that silently picked up whatever workspace the working directory resolves to
would serve one deployment's data under another deployment's Scope identity;
there is no safe default for that field outside local testing.

**A server listener requires an explicit profile and established cumulative
capability.** Configuration may store any protocol profile token, but both
server executables refuse listener admission unless the selected token is
implemented and reviewed cumulative packaged evidence exists. The compile-time
per-target record holds one shared constant for both targets and must never be
populated independently; it is valid only together with the one atomic Read
cohort artifact covering exact unfiltered runs of both packaged targets with
required scenario IDs derived from the bound catalog. Any missing, failing,
mismatched, or test-admitted target closes the cohort for both targets. The
cohort also binds the schema, validator, runner, harness, executor, installed
payload, launched process, fixture/workspace, and the actual `bd` executable
used by `bdpbd`. Whenever that predicate does not hold, all profiles are
refused before `listen`.

`bdptest.fixture` and the four `conformance.*` fields add no further role rule
today. Each is either optional or has a safe default, and `bdptest.fixture` is
not consumed by the built-in reference adapter yet. When their runtime
consumers add new "must be set" constraints, this section records those rules
before implementation.

## Diagnostics

The startup, lifecycle, and server diagnostics covered by this contract are a
single JSON line on stderr, matching the Wave 1 executable diagnostic
convention. `--help`, `--version`, and command results are program output on
stdout, not diagnostics. `bd.ready.failed` is a `bd`-command diagnostic and is
specified below rather than in this startup table.

For the read-only `bdp bd ready` slice, successful `--json` output remains the
selected `bd ready`-compatible Bead array. A failed JSON command uses one
top-level envelope: protocol failures are `{ "error": { "kind": "protocol",
"problem": ... } }`, while local client failures are `{ "error": { "kind":
"local", "code": ... } }`. Human-readable failures remain the structured
`bd.ready.failed` diagnostic on stderr.

| event | when | exit |
| --- | --- | --- |
| `cli.usage` | an unsupported or malformed argument is supplied; argv is never echoed | 2 |
| `startup.config` | after a successful load, before the lifecycle starts | — |
| `startup.config_error` | on any validation failure, listing every offending path | 2 |
| `startup.profile_refused` | when `--serve` lacks an explicit, cumulatively proven profile | 2 |
| `lifecycle.started` / `lifecycle.stopped` | the non-serving lifecycle starts or stops | — / 0 |
| `server.started` / `server.stopped` | an admitted `--serve` listener starts or stops; `server.stopped` may accompany either a clean signal shutdown or a listener failure | — / 0 or 2 |
| `server.request_failed` | an unexpected request failure is hidden behind a body-less HTTP 500 | — |
| `server.listener_failed` | an admitted listener reports a post-bind Node listener failure | 2 |
| `startup.listen_failed` | an admitted listener cannot bind its configured host and port | 2 |

Validation collects all issues before throwing, so one launch reports every
problem rather than one per attempt.

On shutdown, the shared Node listener allows existing peers one second by
default to close before forcibly disconnecting them. The Read server separately
allows admitted Scope-port work 250 milliseconds by default to settle, then
forwards one shared cancellation signal and waits only through its two-second
total close bound. Any still-unsettled Scope port is explicitly abandoned while
late settlement remains observed.

## Redaction

`auth.token` is the only secret in the contract. `redactStartupConfig()` replaces
it with `"<redacted>"`; the resolved config keeps the real value in memory.
Everything that leaves the process goes through that function — the
`startup.config` diagnostic already does.

Supplying a token on the command line is not possible: there is no value flag for
it, only `BDP_AUTH_TOKEN` or a config file, so tokens do not land in host process
listings.

## Loudness

Anything ambiguous fails at startup rather than resolving to a guess. There
are two loudness *scopes*, corresponding to two kinds of mistake:

**Structural vocabulary — always loud, regardless of role.** A mistake in the
config file's *shape* is not a role-specific value that another deployment
might legitimately consume; it is a typo in the file. These are surfaced
under every role:

- an unknown top-level key (`nope`, `scop`);
- an unknown nested field name inside any known section (`scope.uri`,
  `bdptest.fixtre`, `conformance.reprot`);
- an unreadable or malformed config file, so a deployment that thought it had
  a Scope URL never starts without one;
- `BDP_CONFIG` set to the empty string, rather than treating it as unset;
- `--config` with no path, with an empty path, or given more than once.

**Field content — validated only for the fields the active role consumes.**
The value inside a known field is judged only when the role actually reads
that field. That is how one shared config file can serve every role:
`{"bdptest":{"fixture":"bad name"}}` fails under `bdptest` but is silently
ignored under `bdp`, while `{"bdptest":{"fixtre":"x"}}` fails everywhere.
Field-content rules currently enforced for the role that consumes the field:

- `mode` must be `local-test` or `production`;
- `scope.url` obeys the canonical-identity rules above;
- `server.port` outside `0..65535`, or not an integer;
- `server.host` that is not a bare host;
- `server.advertisedProfile` must be one of the three normative wire tokens;
- every `server.limits` leaf is a positive safe integer within its documented
  field-specific maximum, and page default does not exceed page maximum;
- `bd.executable` / `bd.workspace` non-empty when supplied;
- `bdptest.fixture` obeys its 1..128-character grammar;
- `conformance.profile` / `conformance.reportFormat` match their enums;
- `conformance.scenarioFilter` is non-empty when supplied;
- `conformance.seed` is `0..Number.MAX_SAFE_INTEGER`.

Unknown `BDP_*` environment variables are ignored, because the process reads
only the names listed in the field table and never scans the ambient
environment.

### `server.port`: what is checkable depends on how it arrived

A port is checked as strictly as its representation allows, and no more.

| supplied as | rule | `8e3` |
| --- | --- | --- |
| a string — every environment value, and a JSON string | canonical decimal spelling | refused |
| a JSON number | an integer in `0..65535` | accepted as `8000` |

A string still carries its spelling, so whitespace, a sign, a radix prefix, an
exponent, a leading zero, and an empty string are refused rather than coerced. A
JSON number does not: `{"port": 8e3}` and `{"port": 8000}` are the *same value*
by the time `JSON.parse` returns, and no check downstream can distinguish them.
Claiming otherwise in this document would describe a rule the code cannot
enforce, so the contract states the weaker guarantee that is actually true.

### `server.host`: a host and nothing else

`server.host` is a bare host name, IP address, or bracketed IPv6 literal.
Userinfo, a scheme, an embedded port, a path, a query, and a fragment are all
refused — none of them are listener addresses, and each would otherwise parse
cleanly as some *other* URL component. A malformed bracketed IPv6 literal is
refused; a valid but uncompressed one such as `0:0:0:0:0:0:0:1` is accepted and
canonicalized downstream.

### Rejected values are never echoed

`server.host` and `scope.url` diagnostics name the field and the rule, never the
value. Both are printed on startup, and both are variables a credential can be
pasted into by mistake — a token typed into `BDP_SCOPE_URL` would otherwise be
copied straight into a log line by the parse error that rejects it.

The same rule covers the command line: an unsupported argument is reported by
**count**, never echoed. Errors from `--config` itself are fixed strings that
contain no user input, so they are surfaced verbatim.

## Tests

`packages/config/src/index.test.ts` covers defaults, every precedence step
including `--config` over `BDP_CONFIG`, the `bd` fields, the `bdpbd` production
workspace rule, each Scope URL normalization and refusal, the derived
local-test URL including IPv6 bracketing and the wildcard and port-0 refusals,
the absence of a follow-on mode finding after an unparseable URL, production's
exact reserved-path rule, the host-only rule for `server.host`, both halves of
the port contract, all six limit defaults, environment/file precedence,
canonical positive-integer spelling, the page-order invariant, nested-key
loudness, that neither a host nor a Scope URL diagnostic echoes its
value, unknown keys, unreadable files, and redaction. The role-specific
extensions add coverage for the three normative wire tokens (accepted for both
`server.advertisedProfile` and `conformance.profile`; the human label
`read+update` is explicitly refused), the fixture grammar including the 1- and
128-character boundaries and rejection of whitespace, path separators, and
traversal, both halves of the `conformance.seed` contract at `0`,
`MAX_SAFE_INTEGER`, and `MAX_SAFE_INTEGER + 1`, and `conformance.reportFormat`
accepting only `json` or `text`. Role-scoped views (`loadStartupConfig({ role:
… })`) are tested to return only the sections the role owns, to leave
unrelated sections out of the resolved config, to ignore an invalid *value*
in an unrelated section entirely, and to still surface a nested vocabulary
typo (like `bdptest.fixtre`) under any role. Cross-role tests prove that all
four role views derive the same Scope URL from a shared
`BDP_SERVER_HOST`/`BDP_SERVER_PORT` in local-test mode, and that an explicit
`BDP_SCOPE_URL` isolates `bdp` and `conformance` from invalid server-only
inputs. All of it runs off injected `env` and `readFile`, so no test touches
the real environment or disk.

`scripts/smoke-executables.mjs` covers the command-line paths end to end
against installed tarballs: an unsupported argument is not echoed, a
`--config` error is, and the `startup.config` diagnostic for each role
contains exactly the sections that role owns. Extra runs assert non-default
mappings for `BDP_SERVER_ADVERTISED_PROFILE` and `BDP_BDPTEST_FIXTURE` (and
their `BDP_BD_*` sibling for `bdpbd`) round-trip through the packed tarball.
The public-admission loop proves both installed server executables exit 2
before binding for an unset profile and for either higher profile, and that
`read` admission opens exactly when the recorded cumulative Read evidence for
that executable is present — the recorded state today is the committed atomic
two-target cohort (see `STATUS.md`); the shared server package's real-socket
tests exercise the bridge independently.
The role-isolation probe runs the normal `bdp` lifecycle — not `--version`,
which would short-circuit before the configuration path — with invalid
`BDP_BDPTEST_FIXTURE` and `BDP_SERVER_ADVERTISED_PROFILE` values, and asserts
exit 0 plus the expected `bdp` section set on `startup.config`. Every run
starts with the ambient `BDP_*` environment stripped, so a developer who
exports one in their shell cannot change what the smoke test proves. Failures
surface only the failing check, never the resolved config, because
`startup.config` can carry a bearer token in `auth.token`.
