# Canonical CLI: Scope, names and Resource routing

Paired author candidate for [BDP #280](https://github.com/gastownhall/bdp/issues/280), extracted from private CLI C1 successor `6b9a029a22d2936686575c2ac1b2e75ac523354e`. This defines the relevant CLI design before its matching Core/Write amendment. It is not a shipped client, a complete CLI publication or an independently adoptable BDP contract. The [correspondence record](../design/bdp-v0.1-scope-namespace-correspondence.md) binds the files, proposals and composition holds. [#59](https://github.com/gastownhall/bdp/issues/59) is the sole plan.

## Set context once

```sh
export BDP_SCOPE_URL=https://work.example/acme/
bdp show task-42
bdp list
bdp link show relations/81
bdp create --type Task --properties '{"title":"Review BDP"}'
bdp link create --type Relates --source task-42 --target task-17
```

Select context by explicit `--scope SCOPE`, then `BDP_SCOPE_URL`, then configuration `scope.url`. Commands addressing a Scope (`scope inspect`, `list`, `link list`, `create`, `link create`, `batch`, `type list`) also allow one positional Scope; it conflicts with `--scope` even when equal. Point commands use their primary operand as a Resource, never a guessed Scope. Configuration-file discovery belongs to the selected client configuration contract; this adds no connection-management commands.

Every relative primary Resource ID, authored Type ID and Link endpoint uses the established command Scope. The whole local path is identity: do not prepend `beads/`, `links/` or `types/`, strip apparent kind words, or try multiple namespaces. The Scope may choose those words as ordinary path components. Removing prefixes does not relax canonical URI syntax, identity non-reuse, authorization, guards or exact revision binding.

## Absolute URLs stay directly usable

```sh
bdp show https://work.example/acme/task-42
bdp show https://work.example/acme/task-42 --revision saved-r1
bdp --scope https://work.example/acme/ update task-42 --if-revision saved-r1 --set-property title=Reviewed
```

An absolute point read needs no configured Scope or inventory lookup. A configured default never rewrites it. An absolute mutation uses a verified owning-Scope/operation binding, either explicitly supplied, already established in context, or obtained through the Resource response's `service-desc` relation. The returned discovery document supplies canonical `scope` and operation navigation. Do not strip path segments from the Resource URL, treat a Type/endpoint URL as the destination, or use an unrelated ambient default as ownership evidence.

Relative secondary operands use that established command Scope. An explicit contradictory binding refuses before mutation. Authority admission still checks membership, kind, authorization and guards; discovery is not a reservation or proof an edit will succeed. A writer unable to read a target can supply a Scope binding rather than treating missing read permission as an invitation to guess routing. Navigation supplies no credential grant across authorities.

## Kind is independent of path

Root mutations and collections select Beads; `link` mutations and collections select Links. Root point readers `show`, `versions` and Resource `events` are generic; `link` point readers assert Link. A Bead named `links/81` remains a Bead; a Link named `task-42` remains a Link. Wrong-kind operation subjects refuse under the selected BDP diagnosis rather than being rewritten into another path.

Successful BDP point-read responses supply `BDP-Resource-Kind: bead|link`, including properties-only, incident/aggregate views, HEAD and304. It identifies the **subject**, not the kind of every item within an incident-Link collection. A full native record agrees with it. The CLI validates asserted kind without treating user properties or URI spelling as a discriminator. JSON output preserves native data and exposes transport metadata in its outer context; no new `kind` member is inserted into a Resource or properties document.

```sh
bdp link show task-42 --properties-only
bdp link show https://work.example/acme/task-42 --head
```

These commands cannot silently succeed on a Bead simply because a body is absent or properties resemble Link fields. A generic `show --head` reports response metadata. Conditions and exact revision selection retain their separate selected meanings; this patch does not define new Type or History lifecycle commands.

## Discover inventories and operations

`scope inspect` returns the advertised description. `list`, `link list` and the deferred Type CLI's sole placeholder `type list` use its respective inventory URL. They do not append known suffixes or assume that records sit beneath the inventory path. A Scope may advertise `/inventory/items` while assigning a Bead `/task-42`.

CRUD uses the discovered operation directory and selected operation kind. An implementation's existing fixed-root constructors are accepted-target deltas; they are not universal parsing rules. No domain default, native Issue classification, public template engine or domain convenience is added.

## Alias names and collisions

`alias resolve NAME`, `alias put NAME --target REF` and `alias delete NAME` use a complete Scope-relative alias path or absolute alias URL. Resolve a relative alias against `scope`; do not prepend the advertised alias base. The base defines admitted namespace, not a new implicit search path. A Scope advertising its own Scope URL as alias base can use an ordinary name such as `current-plan`. A Scope choosing a narrower base may require a name such as `names/current-plan`.

An actual binding, not spelling alone, establishes that a locator is an alias. It redirects once to a canonical in-Scope Bead. Alias mutation creates no Resource revision. The authority resolves aliases at the operation's selected admission point and retains replay witnesses; the compiler preserves authored operands rather than replacing them with freshly fetched targets.

`alias resolve` expects the one-step307 and its canonical Location. A normal200 Resource response is not an alias resolution and produces a local `not_an_alias` diagnosis; it is never relabeled as a BDP404 or silently returned as an alias binding. Generic `show` can follow an admitted alias to its canonical Resource, subject to the target's authorization.

Collision compares the complete resolved URL. A live alias prevents either kind of Resource creation at that URL. An ever-committed Bead or Link identity prevents alias occupation even after deletion. Different complete paths with equal suffixes remain different identities. No path-stripping heuristic imports an underlying product's native key rules into the protocol. A deleted alias may be reused; a deleted canonical identity is never released. Navigation URLs remain unavailable for conflicting Resource/alias assignment.

## Scope of this pair

These concrete syntax and transport-binding details are author proposals under the selected prefix-removal direction. The pair does not choose Event payload/replay duties, change Type affiliation, relocate a Scope, settle portable identity/equality, or specify hosting. Future paired source handles those independent issues. No runtime implementation or product pin changes follow from this paper.
