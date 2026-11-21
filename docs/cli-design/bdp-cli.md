# Beads Protocol — CLI (`bdp`)

The `bdp` CLI is a **generic, discovery-driven `rep<T>` client**. Two layers:

- **Universal verbs** — the BDP primitives + the read-shaping/projection rules. Identical
  against any `rep<T>` scope; the CLI hard-codes no domain knowledge.
- **Typed commands** — generated *at runtime* from the connected scope's discovery
  (`GET /sys/capabilities` → `packs`): per-type `create` flags and per-operation
  signatures. So `bdp issue create "<title>" -p 1` and `bdp claim <ref>` exist only
  because the connected scope advertises the Issue pack.

This document is the **universal surface**: the primitives and the projection rules. The
typed surface is specified by each pack ([issue.lumen](../../specs/src/packs/issue/issue.lumen),
[stdlib.lumen](../../specs/src/packs/stdlib/stdlib.lumen)); §"Typed commands" pins how the
CLI renders it. The pre-v0.2 beads CLI (Links, History, Transfer, …) is archived in
[legacy-beads-cli.md](legacy-beads-cli.md) and is NOT part of v0.2.3.

> **Deferred to a later pass** (noted but not specified here): stdin/`--file` input
> mechanics, the full `--output-mode` mode set, and `pack install`/`uninstall`.

---

## 1. Connecting to a scope

A `bdp` invocation targets one **scope**, named by its URI (`BdpScope` = an `AbsoluteUri`;
in v0 this is also the reachable base URL). Resolution order:

```
--scope <uri>  ›  $BDP_SCOPE  ›  the saved default (bdp connect <uri>)  ›  http://127.0.0.1:8787
```

- `bdp connect <uri>` reads the scope's discovery, verifies it, and saves it as the default.
- `bdp connect` (no arg) prints the current default; `bdp connect --clear` forgets it.
- `--scope` is the only name (BDP addresses *scopes*, not transports). There is NO
  `--server`/`--service` alias — nothing has shipped, so no back-compat is carried.

## 2. Universal flags (accepted on every command)

These are cross-cutting; they layer uniformly onto the generic verbs AND the typed pack
commands (see §6).

| flag | effect |
|---|---|
| `--scope <uri>` | the target scope (§1) |
| `--principal <id>` | the acting principal — rides in a write/call's `provenance` |
| `--select` / `--include <ptr>` / `--omit <ptr>` / `--expand <name>` | read projection (§5) |
| `--output-mode <mode>` | `json` (default, pretty) · `raw` (compact) · `text` (shape-aware: lists → table, singletons → property view — §5.1). *Deferred:* `jsonl`, `ids` |
| `--if-revision <rev>` | optimistic-concurrency guard on a write (`If-Match`) |

## 3. The primitives — route table

Routes are relative to the scope base URL. Two first segments are reserved: `/sys/*`
(in-band system **resources**, `get`-addressed) and `/bdp/*` (the protocol's own fixed
**routes**). A `:verb` suffix is an action/projection on a target; the scope root `/` is the
collection. (Normative source: [core.lumen §3](../../specs/src/core/core.lumen).)

| command (CLI) | primitive | method · route | notes |
|---|---|---|---|
| `scope` | discovery | `GET /sys/capabilities` | the mandatory floor; **raw resources, not a rep**; §7 |
| `show <ref>` | get | `GET /{id}` | → a `rep` |
| `list` | list | `GET /` | → a `Page {items, cursor, head}` |
| `create …` | create | `POST /` | body = the rep (`body: any`); §6 |
| `put <ref> …` | put | `PUT /{id}` | create-or-replace; `If-Match` guard |
| `update <ref> …` | patch | `PATCH /{id}` | root-addressed JSON-Patch; §6 |
| `delete <ref>` | delete | `DELETE /{id}` | needs `--force`; tombstones |
| `revisions <ref>` | revisions | `GET /{id}:revisions` | history → a `Page`. **`:verb`, not `/revisions`** — ids contain slashes |
| `call <path> …` | call | `POST /{opPath}:call` | `+?mode=async` → 202 + AsyncResult |
| `cancel <ref>` | cancel | `POST /{asyncResultId}:cancel` | ref = the async `Location` |
| `pull [channel]` | pull | `GET /{channel}` | default `sys/changes` (the changefeed) |
| `push <channel>` | push | `POST /{channel}` | append JSONL to a sink Channel |
| `export` | export | `GET /bdp/export` | JSONL snapshot |
| `import` | import | `POST /bdp/import` | JSONL load → `ImportReport` |

> **Corrects the 30/N route table:** `revisions` is `GET /{id}:revisions`, not
> `GET /{id}/revisions`. Resource ids contain `/` (e.g. `foo/bar/one`), so a `/revisions`
> suffix is ambiguous with an id segment; the `:verb` form is unambiguous. (Spec fix
> pending in core.lumen.)

**Capability gating.** A scope advertises which primitives it offers; **absent means not
supported**. `get` + discovery are the only mandatory floor. A request for an un-offered
primitive is refused `capability-not-supported` (not a bare 404). Internal/runtime-native
primitives (e.g. the store's atomic `apply`) are NOT BDP wire primitives and MUST NOT appear
in the advertised capabilities.

## 4. Scope in a resource id

A resource id carries a `scope` that is either **`This`** (a local/relative ref — the common
case) or the scope's **base URL** as an `AbsoluteUri` (a cross-scope ref). It is NEVER the
internal scope *name* (`inmem`, …). `This`/absent and the base URL are the only legal forms.

## 5. Projection — read-shaping

Every read (`show`, `list`, `revisions`, and the discovered `query`) accepts a **selector**
that projects the `rep` before it is returned ([core.lumen#selector](../../specs/src/core/core.lumen)):

- `--include <json-pointer>` — keep only these subtrees (repeatable).
- `--omit <json-pointer>` — drop these subtrees (repeatable).
- `--expand <name>` — inline a named reference instead of leaving it a ref.
- `--select <spec>` — shorthand that lowers to the above.

`id` and `type` are never dropped. When honored **server-side** (a scope advertising
`selector: true`), the selector is a query-string parameter, so a projected read has its own
cacheable identity. When a scope advertises `selector: false`, the CLI applies
`--include`/`--omit` as a **client-side projection** of the received rep (no cache benefit,
same view); `--expand` (inlining a ref) requires server support. The default output shaping
below is always client-side. Server-side honoring is the tracked follow-up.

**Default output shaping** (so `show` isn't a wall of noise):
1. Field order by importance: `id`, `type`, `body`, then `metadata` / `provenance` /
   timestamps / envelope.
2. **Default-valued computed fields are omitted by default** — empty collections
   (`labels: []`, `comments: []`, `dependencies: []`), zero counts (`blockedByCount: 0`),
   and false flags (`isBlocked: false`) — precisely, via each property's `computed` marker
   in discovery (no blanket guessing; a non-computed field is never hidden). They appear
   only under `--include`/`--expand`.

**Lists** return a `Page {items, cursor, head}`; `--limit <n>` caps the window, `--cursor <c>`
resumes after it. With no `--limit`, a read returns the whole current set in one page, bounded
by the scope's advertised `maxLimit` (a larger set returns `maxLimit` + a resume cursor).

### 5.1 The `text` output mode — tables & property views

`--output-mode text` renders by the **shape of the response**:

- A **list / `Page`** → a **table**: one row per item; columns are the type's summary
  properties (default: `id`, the title/name, `status`, `priority`; a type MAY later declare
  its columns via a `cli.summary` hint). Long values truncate; `--limit`/`--cursor` page it.
- A **single resource** → a **property view**: `id` and `type` first, then the body properties
  as aligned `key: value` lines, grouped, with empty computed collections omitted.

Both honor the default shaping (§5) and any `--include`/`--omit`. `text` is the natural TTY
mode; `json` stays the default and the scripting form.

## 6. Typed commands — `create`, `update`, pack operations

The **type drives the shape of the command**: the CLI reads a type's property declarations +
`cli` hints and each operation's signature from discovery, and renders the verb. It ships no
pack knowledge.

**EXACT correspondence (normative).** For a pack like Issue, the rendered command shape — the
verbs, their positionals, flags, short aliases, defaults, and edge sugar — MUST match the
pack's declaration (issue.lumen's `cli` hints + op signatures) **exactly**: no command or flag
the pack does not declare, none it declares missing. The only additions are the **universal
flags** (§2), which layer on uniformly, and (deferred) the stdin/`--file` input mechanics.

**Native parity + superset (A/B).** Where a pack mirrors a native tool (Issue ↔ `bd`), its
declared `cli` hints SHOULD use the SAME domain flag names/aliases as the native command, so
`bdp` and `bd` are A/B-comparable on the domain surface. `bdp` is then a **superset**: the
native domain flags (via the pack) PLUS the canonical universals — `--output-mode`, the
filter/selector flags, the write-guard set — layered uniformly (§2). (This requires an
issue.lumen ↔ `bd` flag diff to align the hints; tracked for the review.)

**`create`.** Each body property is a flag named for it (`--priority`, short alias where the
hint gives one; positionals where `cli.positional` is set). `--kind <leaf>` picks the concrete
subtype; `--metadata <json>` sets the open metadata record. The concrete type is required —
there is no pack-shipped default (a scope `defaultType` or `$BDP_DEFAULT_TYPE` may supply one;
a pack MUST NOT).

**Write modifiers — the canonical 5 + 5.** `create` and `update` share ONE modifier set over
the two open sub-trees, `/body` (properties) and `/metadata` — five operations each, all
lowering to root-addressed JSON-Patch:

| property flag | metadata flag | effect |
|---|---|---|
| `--properties <json>` | `--metadata <json>` | shallow-**merge** the object in |
| `--replace-properties <json>` | `--replace-metadata <json>` | **replace** the whole sub-tree |
| `--set-property K=V` | `--set-metadata K=V` | set one key (repeatable) |
| `--unset-property K` | `--unset-metadata K` | remove one key (repeatable) |
| `--patch-properties <jsonpatch>` | `--patch-metadata <jsonpatch>` | apply an RFC-6902 patch |

The **typed per-property `--<prop>` flags** (from the type's cli hints) are sugar over
`--set-property` on `/body`. A collision between a typed flag / `--set-property` and a
whole-tree `--properties` / `--replace-properties` / `--patch-properties` is **refused**, not
silently merged. `update` and `create` accept the same 5+5; `create` additionally takes
`--kind`/`--type` and the edge sugar. Write guards layer on: `--if-revision` (If-Match) and a
CAS/expected-value guard.

**Edge sugar.** A type's `cli.edge` hints render as repeatable create flags that also invoke an
edge op (e.g. `--blocks <ref>` / `--blocked-by <ref>` → an `issue/dep/add` with `type: Blocks`).

**Relationship field names.** `rel<F, T>` is `{ source, target }` (core.lumen) — so edge ops
take `source`/`target` and a `Dependency`'s JSON carries `body.source`/`body.target`. (Not
`from`/`to`; that was the legacy link CLI.)

## 7. Introspection — `scope`, `type`, `pack`

- `bdp scope` — the scope's **discovery document** (capabilities + packs). This is **NOT a
  `rep<T>` bead**: it is raw resources, parked at the fixed well-known location
  `/sys/capabilities` off the scope root, and read directly — not through the generic `show`
  envelope. (Was `scope-inspect`.)

`type` and `pack` are **NOT new primitives** — they are **convenience wrappers around the
generic `show` / `list`**, targeting the scope's `TypeDef` / `PackageDef` resources. Each
accepts domain-specific flags and renders HUMAN output tailored to the domain; `--output-mode
json` always returns the plain underlying rep.

- `bdp type list` — `list` over the `TypeDef` resources. **MUST surface the full type graph** —
  the issue subtypes AND the `rel<>` dependency hierarchy (Dependency → ReadyAffecting →
  HardBlocking → Blocks/…). A `type list` that omits the dependency types is a lie; discovery
  must emit them.
- `bdp type show <type>` — `show` of one `TypeDef`: properties, `extends`, `abstract`, edges.
- `bdp pack list` — `list` over the `PackageDef` resources (name, version, mount).
- `bdp pack show <pack>` — `show` of one `PackageDef`: its types + operations.
- `bdp pack install <ref>` / `uninstall <pack>` — **deferred** (a real mutating lifecycle
  capability, not a `show`/`list` wrapper; advertised when offered, stubbed for now).

## 8. Aliases — `alias`

A human-friendly name bound to a resource ref, kept in a well-known registry at
`/sys/aliases/<name>` (a system resource, like `/sys/changes` / `/sys/capabilities`).

- `bdp alias set <name> <target>` — bind (`PUT /sys/aliases/<name>`).
- `bdp alias unset <name>` — remove the binding (`DELETE /sys/aliases/<name>`); the target is untouched.
- `bdp alias resolve <name>` — the resource the name points at (`GET /sys/aliases/<name>`).
- `bdp alias isalias <name>` — whether `name` is a bound alias vs a raw id (a `GET` existence check).

## 9. The service-side CLI — `bdpd serve`

> **First-cut shape, for design** (replaces the ad-hoc `bdp-issue-serve`). The service side
> gets its own binary so the client (`bdp`) stays purely a client.

A single service binary (`bdpd`, name TBD) runs a backend behind the BDP HTTP surface:

```
bdpd serve --backend <inmem|postgres|fs> [--port <p>] [--scope <name|uri>] [--default-type <path>] [--no-default-type]
```

- One uniform `serve` verb (shaped after `bd serve`); the backend is selected, not a distinct
  binary per backend (aggregator). `--scope` names/identifies the served scope; `--default-type`
  sets the deployment create-default (a scope fact, never a pack hint).
- Prints its listening address; the client points `--scope`/`bdp connect` at it.

## 10. Errors, exit status, Outcome rendering

- A primitive returns its value or **faults** with an RFC 9457 `Problem` (the non-2xx body).
- A `call` returns an `Outcome`, internally `kind`-tagged: `success` (200) · `failure` (409,
  a declared domain `E`) · `fault` (the Problem's status) · `canceled` (202-settled async).
- Exit status: `0` ok · `3` capability-not-supported (501) · `4` a 4xx (not-found, conflict,
  domain failure) · `5` other. The Problem/Outcome body is always emitted.

---

### Open / deferred (tracked for the review)

- `--output-mode`: the `text` table/property view is specified (§5.1); the `jsonl`/`ids`
  modes, the `cli.summary` table-column hint, and stdin/`--file` input are the next pass.
- `pack install`/`uninstall` lifecycle capability.
- `rel<F, T>` endpoints: **`source`/`target`** (resolved — bd's dep output is
  `issue_id`/`depends_on_id`, and `from`/`to` is inverse-oriented).
- The alias registry mechanism (how names bind/resolve) — confirm in the addressing design.
- Backend-discovery cleanups this doc assumes: drop the legacy top-level `operations` list
  (the `packs[].operations` are authoritative), filter `apply` out of wire caps, emit the
  dependency types, disambiguate the type-level `edges` field from the `dep edges` op.
