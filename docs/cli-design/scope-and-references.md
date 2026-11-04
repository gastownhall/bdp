# Canonical CLI: Scope, names and Resource routing

Paired author candidate for [BDP #280](https://github.com/gastownhall/bdp/issues/280), extracted from private CLI C1 successor `6b9a029a22d2936686575c2ac1b2e75ac523354e`. This defines the relevant CLI design before its matching Core/Write amendment. It is not a shipped client, a complete CLI publication or an independently adoptable BDP contract. The [correspondence record](../design/bdp-v0.1-scope-namespace-correspondence.md) binds the files, proposals and composition holds. [#59](https://github.com/gastownhall/bdp/issues/59) is the sole plan.

## Set context once

```sh
bdp scope set https://work.example/acme/
bdp show task-42
bdp list
bdp link show relations/81
bdp create --type Task --properties '{"title":"Review BDP"}'
bdp link create task-42 task-17 --type Relates
```

Commands use the selected default Scope. A fresh install has no default; set one with `bdp scope set SCOPE`, which stores `scope.url` in the per-user BDP config (`$XDG_CONFIG_HOME/bdp/config.json`, defaulting to `~/.config/bdp/config.json`). This location is independent of the current working directory. The same client executable works from other project directories and against any BDP server; it does not require a server-specific build. The client context rule selects explicit `--scope SCOPE`, then `BDP_SCOPE_URL`, then configuration `scope.url`; the flag or environment variable can override the saved default. Commands addressing a Scope (`scope inspect`, `list`, `create`, `batch`, `type list`) also allow one positional Scope; it conflicts with `--scope` even when equal. Link create/list/count positionals denote Resources; use `--scope` or the configured default there. Point commands use their primary operand as a Resource, never a guessed Scope.

Every relative primary Resource ID, authored Type ID and Link endpoint uses the established command Scope. The whole local path is identity: do not prepend `beads/`, `links/` or `types/`, strip apparent kind words, or try multiple namespaces. The Scope may choose those words as ordinary path components. Removing prefixes does not relax canonical URI syntax, identity non-reuse, authorization, guards or exact revision binding.

## Absolute URLs stay directly usable

```sh
bdp show https://work.example/acme/task-42
bdp show '[https://work.example/acme/task-42]@=saved-r1'
bdp --scope https://work.example/acme/ update task-42 --if-revision saved-r1 --set-property title=Reviewed
```

An absolute point read needs no configured Scope or inventory lookup. A configured default never rewrites it. An absolute mutation uses a verified owning-Scope/operation binding, either explicitly supplied, already established in context, or obtained through the Resource response's `service-desc` relation. The returned discovery document supplies canonical `scope` and operation navigation. Do not strip path segments from the Resource URL, treat a Type/endpoint URL as the destination, or use an unrelated ambient default as ownership evidence.

Relative secondary operands use that established command Scope. An explicit contradictory binding refuses before mutation. Authority admission still checks membership, kind, authorization and guards; discovery is not a reservation or proof an edit will succeed. A writer unable to read a target can supply a Scope binding rather than treating missing read permission as an invitation to guess routing. Navigation supplies no credential grant across authorities.

## Revision selectors

| Local spelling | Meaning |
| --- | --- |
| `item` | Bare identity; the command defines its current-read/incidence meaning |
| `item@4` | Stable ordinal 4 in the selected store's history for this Resource |
| `item@=123` | Exact portable revision token `123`, not ordinal 123 |
| `item@current` | Explicit current selection where the command admits it |

Generated local IDs and current token spellings make these happy paths shell-safe
in Bash/Zsh; arbitrary caller-supplied tokens may still require quoting. The first
raw @ in a local convenience spelling starts its selector. Unknown suffix syntax
refuses rather than treating a former `@TOKEN` spelling as an ordinal or current.
Absolute HTTP URLs remain literal, including raw @. To select their revision,
wrap the URL in brackets and quote the whole shell argument, for example
`'[https://work.example/acme/task-42]@=saved-r1'`. Brackets require a suffix.
A literal local `notes@4` remains selectable through its full canonical URL.
Explicit `--id` input is always literal; newly created local IDs reserve `@` for
selectors. No already-issued identity is renamed by this grammar.

N is a positive decimal int64, parsed without rounding. For `show` and `link show`,
an ordinal is the one-based position in the selected authority's newest-first
retained History sequence: `@1` is its newest retained row. The CLI follows
History continuations and sends the selected row's exact token in the wire read.
This rank can change when a version is added or pruned; use `@=TOKEN` for a stable
portable selection. Token spelling never establishes order. Deletion is not a
synthetic Resource version and has no readable body; no nearest-live fallback.

Resolve a point-read ordinal to the exact full token before the Resource read.
`--if-revision TOKEN` instead takes an exact opaque token
unchanged, including numeric-looking tokens and literal leading `=`. There is no
ordinal guard shorthand. Bead historical Update's `--from-revision` adapter uses
its separate `N` / `=TOKEN` source grammar; it does not define guard syntax.
The resolved exact token selects the optional
[historical-update extension](../../specs/profiles/write/write.md#historical-base-bead-update-and-recovery),
not an implicit current-state guard. Link historical recovery is not selected. There is no standalone
canonical `--revision`, `--type-revision` or `json:` Reference escape.
Type and endpoint pins use the shared Reference suffixes, including the quoted
bracketed absolute-URL form. `@current` is not an authored durable pin.
Canonical Link creation has no `--source-revision` / `--target-revision` flags;
use the shared `@N` / `@=TOKEN` endpoint suffixes. The separate [Beads typed endpoint-flag operations](preview3-alignment.md#product-endpoint-pin-operations)
are product adapter intents; exact @=current/@=unpinned still name literal tokens.
Point mutation subjects stay unpinned. The Bead historical-content adapter lowers
to the selected feature-owned `fromRevision` field; it does not widen ordinary
base Write or permit historical Link recovery.
Offline emission requires exact tokens and refuses unresolved ordinals. Native
Reference objects remain unchanged; no ordinal wire field or token-generation
change is implied. The [alignment map](preview3-alignment.md) records adapter limits.

## Kind is independent of path

Root mutations and collections select Beads; `link` mutations and collections select Links. Root point readers `show`, `versions` and Resource `events` are generic; `link` point readers assert Link. A Bead named `links/81` remains a Bead; a Link named `task-42` remains a Link. Wrong-kind operation subjects refuse under the selected BDP diagnosis rather than being rewritten into another path.

Successful BDP point-read responses supply `BDP-Resource-Kind: bead|link`, including properties-only, incident/aggregate views, HEAD and304. It identifies the **subject**, not the kind of every item within an incident-Link collection. A full native record agrees with it. The CLI validates asserted kind without treating user properties or URI spelling as a discriminator. JSON output preserves native data and exposes transport metadata in its outer context; no new `kind` member is inserted into a Resource or properties document.

```sh
bdp link show task-42 --properties-only
bdp link show https://work.example/acme/task-42
```

These commands cannot silently succeed on a Bead simply because a body is absent or properties resemble Link fields. Core HEAD/conditional-read semantics and exact revision selection remain distinct. Their CLI flags are [deferred](bdp-cli.md#deferred-http-read-conditions-and-metadata); this example selects no HTTP flag grammar or new Type/History lifecycle command.

## Discover inventories and operations

`scope inspect` returns the advertised description. `list` and `link list` use their respective advertised inventory URLs. The future `type list` location selects neither a Type inventory nor its navigation/payload; those requirements belong to the developing Types and packaging contracts. Clients do not append known suffixes or assume that records sit beneath an inventory path. A Scope may advertise `/inventory/items` while assigning a Bead `/task-42`.

CRUD uses the discovered operation directory and selected operation kind. An implementation's existing fixed-root constructors are accepted-target deltas; they are not universal parsing rules. No domain default, native Issue classification, public template engine or domain convenience is added.

## Alias names and collisions

`alias resolve NAME`, `alias put NAME --target REF` and `alias delete NAME` use a complete Scope-relative alias path or absolute alias URL. Resolve a relative alias against `scope`; do not prepend the advertised alias base. The base defines admitted namespace, not a new implicit search path. A Scope advertising its own Scope URL as alias base can use an ordinary name such as `current-plan`. A Scope choosing a narrower base may require a name such as `names/current-plan`.

An actual binding, not spelling alone, establishes that a locator is an alias. It redirects once to a canonical in-Scope Bead. Alias mutation creates no Resource revision. The authority resolves aliases at the operation's selected admission point and retains replay witnesses; the compiler preserves authored operands rather than replacing them with freshly fetched targets.

`alias resolve` expects the one-step307 and its canonical Location. A normal200 Resource response is not an alias resolution and produces a local `not_an_alias` diagnosis; it is never relabeled as a BDP404 or silently returned as an alias binding. Generic `show` can follow an admitted alias to its canonical Resource, subject to the target's authorization.

Collision compares the complete resolved URL. A live alias prevents either kind of Resource creation at that URL. An ever-committed Bead or Link identity prevents alias occupation even after deletion. Different complete paths with equal suffixes remain different identities. No path-stripping heuristic imports an underlying product's native key rules into the protocol. A deleted alias may be reused; a deleted canonical identity is never released. Navigation URLs remain unavailable for conflicting Resource/alias assignment.

## Scope of this pair

These concrete syntax and transport-binding details are author proposals under the selected prefix-removal direction. The pair does not choose Event payload/replay duties, change Type affiliation, relocate a Scope, settle portable identity/equality, or specify hosting. Future paired source handles those independent issues. No runtime implementation or product pin changes follow from this paper.
