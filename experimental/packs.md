---
type: Specification
id: ""
status: draft
subjects:
  - Package
  - PackDeclares
  - PackImports
  - CLI command trees
---

# Packages

> **NON-NORMATIVE EXPERIMENTAL DRAFT. NOT THE PLAN OF RECORD. NOT A RELEASED CAPABILITY OR AN IMPLEMENTATION CLAIM.**
>
> [BDP #59](https://github.com/gastownhall/bdp/issues/59) remains the shared plan; [specs/](../specs/README.md) remains the retained protocol front door. This draft collects the selected package composition and CLI exposure direction; it does not advertise installable Types or package runtime support.

This is a standalone Specification draft following the pinned [Memory authoring bundle](https://github.com/donnabox/memory-beads/blob/cc32cba35758a8dbbd89d5cf953c7035203cd836/specs/formats/markdown-bead-bundles.md). The H1 is its title, its identity is unassigned, and the Scenario index projects candidate owned definition Links rather than stored records.

## Scope and dependency direction

Packages group definitions, declare explicit imports, retain an exact member/dependency closure and provide installed CLI command trees. This Specification depends on [Callables](callables.md) and [Types](../specs/types/type-system/type-system.md). Callables can be defined and invoked without a Package; their Specification has no dependency on this one.

| Specification | Owns |
| --- | --- |
| Types | Type descriptors, affiliation, refinement, schema resources and effective validation. |
| Callables | Callable/Batch/Query definitions, parameters, reusable argument projection/help, implementations and BDP/direct CLI invocation. |
| Packages | Defining membership, imports, exact installed composition, CLI mounts, hierarchical command/shortcut aliases, catalog bindings and collision behavior. |

A Package does not add a second callable signature or executor. Command paths select the existing callable contract; its implementation may be the selected AST or service-side Go extern. Clients discover the service-supplied surface with only Scope-specific caching and no Package-specific client installation.

## Naming

Donna selected Package as the Bead Type name and bd pack as the package-management CLI prefix. Management subcommands are still to be specified. Generated package commands retain their chosen mounts, such as bd memory remember; bd pack is not an extra prefix on those commands. PackDeclares and PackImports remain provisional relation names pending concrete Link Type declarations.

### Global identity, declared version and exact revision

Donna selected designing global Package identity first; loose/local package identity is later work. A generally deployed Memory Package must have a stable logical identity independent of the local Scope, canonical deployment URL, graph root or CLI mount. The concrete identity scheme, publisher/authority and relationship to a source repository remain open following comparison with Gas City and Lumen.

Declared SemVer and exact revision/commit are distinct. A declared version expresses the Package author's version label; it is not by itself an immutable selection of source or deployed graph content. A source commit and a BDP Resource revision also identify different things. Exact installation evidence must identify the selected content under the eventual identity/resolution contract, rather than treating a version string, repository locator, CLI spelling or local Bead URL as interchangeable evidence.

One live installation per Package identity per Scope applies to the selected global logical identity. Where a global identity can have different local deployment URLs, endpoint-pair uniqueness alone does not enforce that rule. The global identity carrier and admission constraint must be specified together. Same-version/different-revision publication and dependency-conflict policy remain open; this distinction does not select a version solver or side-by-side snapshot execution.

Research against exact current sources found useful separations rather than a complete global identity design to copy. Gas City distinguishes source/version requests, registry release version, commit and pack-content hash; its import identity remains source-based despite its scoped publishing-name convention. See [Gas City import coordinates](https://github.com/gastownhall/gascity/blob/cdfa7791c731cbd2283628ace9866afc2075bcfa/docs/reference/specs/pack-spec.md#L240-L272), [publishing namespace](https://github.com/gastownhall/gascity/blob/cdfa7791c731cbd2283628ace9866afc2075bcfa/docs/guides/shareable-packs.md#L138-L143) and [release fields](https://github.com/gastownhall/gascity/blob/cdfa7791c731cbd2283628ace9866afc2075bcfa/internal/packregistry/catalog.go#L83-L91).

Lumen separates local names/bindings and source/version requests from an opaque exact PackageRef that reopens an immutable snapshot without resolving again. Its global publisher identity, package SemVer and publication/version-solving policies remain host work. See [exact PackageRef](https://github.com/donnabox/formula-language/blob/95e4db3b043a4332b7a8bd8ab7a91bc66f4c0e74/docs/spec/ir.lumen#L170-L204) and [explicit package deferrals](https://github.com/donnabox/formula-language/blob/95e4db3b043a4332b7a8bd8ab7a91bc66f4c0e74/docs/spec/packages.md#L784-L813). Its multiple-exact-reference partition rule is not adopted into BDP by this research.

Open recommendation: use a stable authority-qualified global Package ID, with declared SemVer, source provenance and exact published selection carried separately. The publisher's canonical Package definition Bead URI is a natural candidate; the correspondence to local deployment/member IDs still needs an explicit contract. An explicit publisher URI preserves identity through source-host moves; repository-plus-subdirectory identity is a simpler alternative with different migration costs. No URI scheme, actual Memory publisher namespace or field spelling is selected. Likewise, binding each published global-ID/SemVer pair immutably to one exact selection is a recommendation, not a ruling. Source commits are provenance when applicable; Packages authored as Beads need not originate in Git. The exact graph-selection mechanism remains deferred.

### Package source references and Bead identity

Donna requested verifying pack.toml references before deciding whether global Package IDs can or must be Bead IDs. Current Gas City named imports author source plus optional version, where a numeric request and sha:commit are alternatives; the resolved lock separately records version and commit. A tree URI's browse ref is not an additional pin. See [current import contract](https://github.com/gastownhall/gascity/blob/a5a48145c3b0e6294320fde820ffa1309b5d57e3/docs/reference/specs/pack-spec.md#L240-L272), [exact/numeric alternatives](https://github.com/gastownhall/gascity/blob/a5a48145c3b0e6294320fde820ffa1309b5d57e3/internal/packman/resolve.go#L22-L53), [source matching](https://github.com/gastownhall/gascity/blob/a5a48145c3b0e6294320fde820ffa1309b5d57e3/internal/packregistry/source_lookup.go#L33-L42) and [lock record](https://github.com/gastownhall/gascity/blob/a5a48145c3b0e6294320fde820ffa1309b5d57e3/internal/packman/lockfile.go#L22-L33).

Acquisition source URI and resolved canonical Package identity are independent contracts. Donna selected that a global Package ID MAY be a Bead ID; it need not always identify an allocated Bead. An installed graph representation is still a Package Bead under the selected installation-Link model. Accepting a source URI does not automatically make that URI the Package identity.

Whether identity comes from a normalized source coordinate or an independently declared publisher identity remains open. Version/ref selection is separate from the canonical identity used for installation uniqueness. No import selector or generic Reference grammar is adopted into BDP by this comparison.

### Global definitions and local representations — shared open issue

Donna identified the same problem for Packages and Types: a globally meaningful definition can have a concrete representation at an in-Scope Bead ID. She asked to explore a generic mechanism, including aliases, before choosing whether stored Type affiliations should use a global exact reference or a local exact reference. Neither carrier is selected by this discussion.

Keep four concepts separate while comparing mechanisms. These are explanatory concepts, not new Types, Links or wire fields:

| Concept | Question |
| --- | --- |
| Global definition identity | Which Package or Type is meant across Scopes? |
| Exact definition selection | Which immutable meaning is selected? A declared SemVer alone is insufficient. |
| Local representation | Which actual local Bead and Resource revision represent that selection? |
| Scope resolution and acceptance | How does a name find that representation, and what establishes its correspondence and permission for use? |

Current Types provides a limited precedent, not an already general solution. Ordinary user Type identity/revision equals its definition Bead identity/revision. Intrinsic materializations instead retain a checked correspondence between an exact shared definition and an exact actual local record, without creating another nominal Type or equating local and shared revision tokens. Wider foreign-definition registration preserves global identity but does not itself create ordinary in-Scope Beads. See [ordinary identity](https://github.com/gastownhall/bdp/blob/52393e411f1ebd7a7ff4ce6ffc9e4879fedff11f/specs/profiles/types/types.md#L122-L158), [intrinsic correspondence](https://github.com/gastownhall/bdp/blob/52393e411f1ebd7a7ff4ce6ffc9e4879fedff11f/specs/profiles/types/types.md#L378-L435) and [foreign registration](https://github.com/gastownhall/bdp/blob/52393e411f1ebd7a7ff4ce6ffc9e4879fedff11f/specs/profiles/types/types.md#L2006-L2158). Generalizing that distinction would require coordinated Types design; this Package draft does not amend it.

Donna requested three viable concrete designs and their tradeoffs. The following alternatives all describe the same relation: an exact global definition selection corresponds to an exact actual local Bead. None is selected. For comparison only, their worked Type example stores the exact global reference; each could instead support exact local storage with retained correspondence. Mapping location and affiliation storage are separate choices.

Illustrative example: global Type identity https://definitions.example.org/memory/Fact, selected definition revision r7, has local representation https://scope.example.org/team/memory/types/Fact at actual Resource revision l12. The token spellings are examples, not new URI or Reference syntax. The analogous Package mapping uses its global identity and exact published selection; declared SemVer and source provenance remain separate. A Package global ID need not identify a Bead, so it cannot always serve as a Link endpoint. Native definitions whose global and local IDs coincide need no artificial duplicate record.

#### Design 1: Generalized aliases carry the correspondence

A Scope-aware alias resolver accepts a global identity plus exact selection and resolves it to a selected exact local record. Its accepted alias binding is the authority for the correspondence. A friendly local alias can feed that resolver; using a local name as input does not make it the stored semantic identity in this comparison. Ordinary local reads still report the actual local Bead identity and revision.

This gives one generic naming and resolution facility for Packages, Types and later definitions. The cost is a substantial alias extension: global URI lookup keys, exact target pins, retained bindings, inverse lookup and conflict/admission rules. A Scope resolving a global name is not automatically an HTTP redirect hosted at that name's origin. Mutable convenience aliases must be distinguishable from the exact correspondence retained for past use. Alias creation does not itself register a Type or install a Package. Existing aliases supply none of these added guarantees: their retained cut targets unpinned in-Scope Beads; foreign/Link/exact-revision targets remain deferred in [BDP #299](https://github.com/gastownhall/bdp/issues/299).

#### Design 2: Local definition Beads describe what they represent

Each local definition record carries common, validated metadata identifying the global definition and exact selection it represents. A Scope index resolves that metadata to the local exact record. Friendly aliases remain convenience locators. The metadata contract must be shared across definition families; its property/envelope placement and spelling are not selected here.

The correspondence travels with the Bead revision and can be inspected or exported with that record. There is no separate binding object or Link to retain. Conversely, every applicable Package/Type/Callable descriptor or common envelope must support the metadata contract. Changing correspondence changes the local record revision. Duplicate records making the same claim need explicit selection/uniqueness rules, and ordinary creates or arbitrary copied metadata cannot establish trusted acceptance. Updates must prevent editing a represented definition while continuing to claim its old global exact meaning. Schema resource IDs and semantic references cannot be recursively rewritten merely because the envelope has a local ID.

#### Design 3: Explicit graph Links carry the correspondence

A discovered Scope registry Bead has a typed binding Link to the exact local representation. The Link records the global identity and exact selection in properties and pins the target's local revision. A working Link Type name is DefinitionRepresentation; no descriptor, field spelling or registry location is selected. Using the global URI as a property accommodates Package identities that are not Bead IDs. Exact correspondence is validated before acceptance; adding an arbitrary Link is not sufficient authority.

This keeps mapping separate from definition bodies and uses ordinary graph enumeration, authorization and Link revisions. It also supports inverse lookup from a local Bead without broadening ordinary HTTP aliases. The cost is another relation family, a discoverable registry and coherent admission/retention of the binding and its target. A local-record update requires a new accepted exact binding; historical bindings required for existing references cannot simply disappear. The active selection must be explicit when several representations exist. A binding Link alone does not register a Type, install a Package or capture an executable graph closure.

| Tradeoff | 1. Generalized aliases | 2. Metadata on Beads | 3. Binding Links |
| --- | --- | --- | --- |
| Authoritative mapping lives in | Scope alias/resolution facility | Each exact local definition record | An explicit registry relationship |
| Broadest spec change | Alias semantics and retained resolution | Shared definition metadata/envelope contract | Binding Type, discovery and admission rules |
| Ordinary graph queryability | Needs explicit alias inventory/projection | Query Beads and their metadata | Query ordinary Links and targets |
| Exporting one Bead | Also retain/export its alias binding | Correspondence metadata travels with it | Also retain/export its binding Link |
| Changing local placement/selection | New coherent exact alias binding | New record/metadata and accepted index selection | New coherent exact binding and target selection |

Pacabel's tentative recommendation is Design 3 with ordinary aliases as optional convenience names. It gives this generic datastore an inspectable mapping without changing every definition schema or turning all aliases into identity claims. This is a recommendation, not a ruling; mapping lifecycle and admission are real additional work. Design 2 is attractive if correspondence is intrinsic metadata of every represented definition. Design 1 is attractive if a richer Scope resolver is already a desired platform capability.

All three require tests for the same exact definition at different local IDs in two Scopes, native identity equality, multiple accepted exact Type revisions, alias/default changes after storage, conflicting claims and unauthorized edits. Both global storage and local storage with retained exact correspondence remain open. Package installation cardinality remains separate from Type revision retention; mapping changes must not reinterpret an existing exact reference. Stable canonical IDs and no implicit relocation remain selected. Exact graph closure and labelled-revision carriers remain deferred.

## Composition contract

The selected Bead Type name is Package; PackDeclares and PackImports remain working Link Type names. Use distinct uniquely named Bead/Link Types for this round; their complete descriptors, properties and endpoint constraints remain to be authored. This vocabulary does not install definitions or broaden Memory's defines/references constraints.

- A Package-declared entity has one defining Package; other Packages require explicit imports. Standalone Callables have no synthetic Package requirement.
- Package and Specification are distinct; no Package-as-Specification conformance is selected.
- Imports retain an explicit exact member/dependency closure. Complete coverage, carrier, resolution, retention and update semantics remain open.
- Package internal/external visibility and later definition-relation refinement/normalization are deferred. Ordinary principal/Scope/data authorization remains applicable.
- Saved CLI profile selection is initially user-global with compat as default; per-call overrides do not persist. Profile selection and Scope-specific catalog caching are independent.

Concrete package schemas, installation/catalog APIs, root/mount metadata and closure carriers are incomplete. Physical distribution, registries, version solving and Go deployment are outside this draft. The CLI direction below is more specific than the currently unfinished Package descriptors.

## Definition and installation

Donna selected separate concepts for the reusable Package definition and a Scope's installation. A Package's definition does not change merely because a Scope chooses another CLI mount. Installation does not create a second defining home for its members.

| Concept | Responsibility | Modeling status |
| --- | --- | --- |
| Package definition | Describes declared members, explicit dependencies and authored command/shortcut aliases. | Package is the selected Bead Type name; its concrete propertiesSchema is not yet selected. |
| Declared member relation | Identifies a definition's single defining Package. | PackDeclares remains the working Link Type name; Package to definition Bead is the proposed endpoint shape. |
| Import relation | Selects named exports supplied by another Package. | Named-export selection chosen; PackImports remains the working Link Type name, with concrete endpoint/fields still open. |
| Export relation | Gives an original definition a name in the exporting Package. | Named Link selected; exact Type name, name property schema, ownership and uniqueness rules remain open. |
| Installation | Binds a selected Package definition and exact resolved member/dependency closure to an installing Scope, CLI mount and effective bound/unbound exposures. | Installation Link selected, at most one live installation per Package identity per Scope. Presence means installed; absence means no such installation. Exact properties and admission remain open. |

For example, the same reusable Memory Package can be installed at CLI mount memory in one Scope and notes in another. Its cliCommands/remember alias then exposes bd memory remember or bd notes remember, respectively, using the same selected Callable contract. Root shortcut bindings and collision diagnoses are installation results; they are not edits to the reusable Package's authored command tree. This example does not choose cross-Scope transport, copy/identity or retention mechanics.

An installation must retain enough exact selection evidence to avoid drifting when authoring definitions/imports/aliases later change. The closure carrier, validation point and update protocol remain open. Definitions and installation bindings are distinct from the ordinary runtime data the operations read or mutate; installed exact definitions do not create a separate business-data store or imply historical data capability.

Selected relationship roles, pending concrete Type descriptors:

```text
Package --PackDeclares--> definition Bead
Package --named export [export name]--> original definition Bead
registry --installed-package [installation selection properties]--> deployed Package
```

Imports select a supplying Package and named exports; concrete import endpoints/fields remain open. The installation Link carries or references exact selection evidence, CLI mount and effective bound/unbound exposures. It is not itself a Bead endpoint for additional relationships.

Package membership remains explicit. Donna selected requiring a Package's declared definition Beads to be subordinate to its own ID. Containment constrains where a declared member may live; it does not make every Bead sharing a prefix a declared member. Exact endpoint constraints, relation ownership and import fields remain to settle.

### Definition ID space

A Package may have an arbitrary root ID and is discovered through installation Links rather than a universal definition-location prefix. For Package root acme/tools, its declared definition Beads must have proper descendant IDs such as acme/tools/types/Task or acme/tools/actions/laugh. Compare complete path segments: acme/toolsmith is not beneath acme/tools. The internal types/ and actions/ subdivisions are examples, not required names.

Imported definitions retain their original defining Package and ID. An import is not a declaration owned by the importing Package; an export or CLI binding may refer to that import without copying it into a second defining home. Package-owned binding names can still be subordinate to the importing Package.

This is a selected Package-specific admission rule; it does not change Core's rule that arbitrary Resource ID prefixes alone imply no containment. The rule covers declared definition Beads. Any extension to Link IDs or other owned bindings, nested Package boundaries, unrelated Beads under the same prefix, and how admission checks the cross-record ID relationship remain open. Existing properties schemas alone do not express that relationship.

Authoring root, installation selection and CLI mount remain distinct. A different CLI mount does not rename canonical member IDs. If mounting also means materializing a Package beneath a different graph ID root, reference rebasing, resulting identities and exact closure must be specified; canonical Resource identities are immutable, so this cannot be treated as renaming the original Resources.

Donna selected this stable-placement model as the long-term direction: create/install at an arbitrary initial graph root, register the installation through sys/packages, and preserve the resulting canonical IDs. Implicit graph relocation/rebasing is not selected. Global Package identity remains distinct from that deployment location; the global identity scheme is still to be designed.

### Named exports

Export names expose bindings to existing definitions; they do not create another defining home or an access-control boundary. Internal/external visibility remains deferred. A re-export requires the importing Package's explicit import and preserves the original definition identity and provenance.

Donna selected named export Links from the exporting Package to the original definition. Each Link carries an export name, and multiple names may target the same definition. Ordinary outgoing-Link enumeration and Link revisions apply. Donna selected Package ownership/revision coverage of its outgoing declaration/import/export tables. Concrete Type name, property schema, name uniqueness/normalization, descriptor representation, import provenance and exact target-selection rules remain open. Exact target pinning does not by itself capture transitive closure.

For example, Package acme/tools declares acme/tools/actions/laugh and may export it as chuckle. The export Link's source is acme/tools, its target is the original definition and its export name is chuckle. An illustrative Link ID is acme/tools/exports/chuckle; this subordinate Link-ID convention is not itself required. Reading that Link URL returns the relationship, not an alias redirect to the definition. A consumer may explicitly import and re-export the same definition under another name without becoming its defining Package. Export names need not equal canonical definition suffixes or CLI command paths.

Ordinary aliases under exports/ were not selected as the authoritative export table. They would reuse the hierarchical CLI naming approach but need inventory/snapshot evidence: existing aliases are unrevisioned, repointable in-Scope Bead locators with no collection membership and no alias chains. Derived convenience aliases may be considered later; no second independently authored export authority is selected. The selected CLI alias convention is unchanged.

### Imports select named exports

Donna selected explicit named-export imports rather than importing every export of a Package. Each import selection identifies its supplying Package and the export names it uses. It does not automatically include all current exports or acquire newly added exports. Imports preserve the original definition identities and defining homes, including through re-exports.

For example, a consumer may select chuckle from acme/tools without importing another export named cry. Its exact closure must retain the selected export binding, original target definition and required transitive dependencies. An unselected export is not an explicit import merely because it exists in the dependency Package; whether closure also retains unreferenced definitions is a separate coverage decision.

The concrete import Link endpoint/fields, one-Link-per-name versus grouped selections, local-name aliasing, missing/ambiguous-name diagnostics and exact selection/admission mechanics remain open. This import rule is not a visibility policy for direct bd call invocation. The treatment of differing exact dependency revisions across installed Packages remains a closure decision; one installation per Package identity does not silently select a version solver or per-consumer snapshot execution.

## Installed-package discovery and system data

Donna selected the installation-Link representation: a real registry Bead at the working location sys/packages has typed outgoing installation Links to selected Package definitions. A current live installation Link is the installation fact. Its presence means installed; its absence means there is no corresponding installation. No separate installed boolean, installation Bead or hidden status table is required by this model.

The distinguishing query has this design shape; the Link Type name remains provisional:

```text
bd link list sys/packages --type installed-package --direction out

sys/packages [registry Bead]
    --installed-package [installation Link, own identity/revision]-->
    selected exact Package definition
```

An installation Link binds its selected Package/closure, CLI mount and effective exposure choices. Exact property names/carriers remain open. A target Package revision alone is not a complete member/import/alias/extern closure.

**Selected cardinality:** a Scope has at most one current live installation Link per global Package identity, regardless of selected revision, local deployment URL or CLI mount. A second Link cannot create a simultaneous installation of the same global Package at another revision or mount. Concrete identity fields, uniqueness enforcement and duplicate-request behavior remain to be specified. Different global Package identities can coexist, subject to ordinary closure and command collision rules. Updates change the existing installation selection through the admission protocol still to be defined. This does not remove retained historical revisions or decide dependency-version conflict policy.

Once admitted and published, the Link is authoritative installation state. Creating/deleting its live record is the model's install/uninstall transition. Donna selected validating/staging a proposed selection and required CLI bindings before atomically publishing the installation change and effective catalog generation. Failed updates retain the prior admitted selection. Required-tree conflicts reject the proposed change; optional shortcuts retain their selected unbound fallback. Removing a dependency still required by an active installation initially refuses rather than implicitly cascading. Concrete transport, admission transaction/concurrency and in-flight invocation rules remain open. A Package definition or convenience alias alone does not establish installation, and an installed Link does not grant invocation permission or prove handler availability.

Ordinary BDP aliases are locators, not Resources, and have no collection membership. An alias-prefix Bead inventory therefore cannot replace this installation-Link query. Donna selected registry ownership/revision coverage of the installation-Link family. The registry Type and concrete ownership descriptor remain to be authored alongside the generic ownership/publication work.

The representation choice is now settled as a Link. Any supplementary exact-closure object or graph must preserve that installation fact; it cannot rely on local Links being Bead endpoints. Exact closure representation and update/uninstall effects remain open.

### Ownership, labelled revisions and deferred closure representation

Package composition-table ownership/revision coverage is selected, but this does not settle the generic owned-Link replacement or the representation of a frozen graph. Donna explicitly deferred the closure-carrier decision until the other Package identity/version/placement/ownership/publication issues are reconciled. A PackageClosure Bead was an author recommendation, not an adopted Type.

The next comparison must include generic labelled revisions or Editions that select exact Bead AND Link revisions without mutating their members. It must also establish a complete immutable membership boundary and exact endpoint selections for captured Links whose original References float, plus the graph context needed for ordinary traversal. Olivia's ownership/publication exploration is the consultation source; no generic Edition/label mechanism or retained Core/Types amendment is adopted here. Concrete descriptor/mechanism choices remain open rather than silently hard-coding today's ownsOutgoing implementation.

### Graph-data namespace and protocol navigation

The service's chosen bdp/ prefix holds protocol navigation and is reserved from ordinary Bead allocation in the current design. Those HTTP endpoints are addressable; they are not ordinary graph Beads. Existing Core more generally protects the actual advertised navigation addresses against conflicting Resource/alias allocation and does not mandate the same literal prefix for every service.

**Selected namespace:** service-managed graph data uses the name sys/. The selected registry-Link model uses a real registry Bead, with sys/packages as its working location. Service-managed Beads and Links there use ordinary typed Resource reads, queries, revisions and authorization. Path spelling does not confer authority, Type membership or containment, and does not create a parent Bead automatically.

The supporting extension should advertise the actual registry URI so clients do not infer it by stripping/adding path segments. Exact discovery carrier and whether sys/ is a reserved prefix or a default placement are still open; no new field is silently added to the existing closed Core discovery schema. An existing ordinary identity cannot be overwritten or repurposed just to establish the convention.

### Installed versus loaded

Installed now means presence of the admitted installation Link. Loaded or available may describe the service's current ability to use that binding, including implementation availability; no separate loaded lifecycle has been selected. Do not treat a persistent installation Link as proof that Go code is currently loaded or that invocation is authorized/supported.

Start with a durable installation query and explicit service availability reporting if callers need it. A separate loaded lifecycle, a second Link Type, state field values and persistence/observation rules are not selected. Runtime observation must not be disguised as an evergreen stored boolean. These package questions do not resolve the deferred Callable invocation/extern contracts by implication.

## Current design sequence

The active design pass is Packages: give the definition/member/import graph and installation/closure/catalog boundary a concrete shape. The standalone Callable issues [CALL-O1 through CALL-O3](callables.md#open-issues) remain open and are revisited once this package shape can inform them. Work here may clarify required closure inputs, but must not invent unresolved Callable parameter nodes, invocation envelopes or Go implementation identity rules by implication.

## Installed CLI surface

Donna selected Package-provided friendly trees using hierarchical aliases under a well-known Package-relative cliCommands/ root. Loose callables use the Callables Specification's bd call entry. This supersedes independent friendly-tree registration and separate path-array proposals for this round.

Client options precede the selected command; arguments after the command use the callable's existing projection:

```text
bd [client options] PACKAGE-MOUNT COMMAND-PATH [callable arguments]
```

## Hierarchical alias convention

The CLI path is the installed Package mount path followed by the alias path relative to that Package's cliCommands/ root. The Package's storage/definition prefix and chosen CLI mount are independent. For a Package rooted at mypack:

| Package alias | CLI with mount mypack | CLI with mount fun |
| --- | --- | --- |
| mypack/cliCommands/chris/sells/laughs | bd mypack chris sells laughs | bd fun chris sells laughs |
| mypack/cliCommands/chris/sells/cries | bd mypack chris sells cries | bd fun chris sells cries |
| mypack/cliCommands/chris/anderson/smirks | bd mypack chris anderson smirks | bd fun chris anderson smirks |
| mypack/cliCommands/chris/list | bd mypack chris list | bd fun chris list |

Each alias targets a Callable, whether defined by this Package or available through an explicit import. Its selected callable supplies parameters, CLI argument mapping and help. Common prefixes create groups. A callable ID outside this explicit convention does not create a command path. No separate path array is required to duplicate the hierarchical alias name.

The service must admit the chosen alias namespace and advertise the installed tree. Existing BDP aliases provide individual GET/HEAD redirect resolution, not a complete alias inventory, stored revisions, alias chains or invocation forwarding. The Package catalog must provide a complete discoverable alias set for help/completion and retain selected targets/definition closure. Invoke the resolved callable through the callable contract; do not POST through an assumed alias-forwarding behavior. The alias set, selected definitions and effective installation bindings must not drift silently through live repointing or latest-on-retry resolution.

## Optional top-level shortcuts and collisions

A Package can also request explicit top-level CLI shortcuts. Donna's motivating example is the Memory Package exposing bd memory remember and a top-level bd remember shortcut to the same selected operation. The working Package-relative cliShortcuts/ root requests these optional root exposures: memory/cliCommands/remember supplies the grouped command, and memory/cliShortcuts/remember requests bd remember. Both aliases target the same selected Callable directly. Exact inventory/admission metadata remains open; the client must not mechanically strip the Package mount from every command. Both exposures use the same callable, parameter mapping and execution semantics. A CLI shortcut to a grouped command does not require a chain of BDP aliases.

**Selected collision outcome:** if an optional top-level shortcut conflicts while the Package's grouped commands are valid, keep the grouped commands and report the shortcut as unbound. An already accepted binding keeps its meaning. For example:

| Requested exposure | Existing situation | Outcome |
| --- | --- | --- |
| bd memory remember | Grouped Memory tree is valid | Install/retain the grouped command. |
| bd remember | Path already belongs to another binding | Keep that binding; report Memory's optional shortcut as unbound, with bd memory remember as its usable alternative. |

Collision rules and remaining recommendations:

| Case | Proposed rule |
| --- | --- |
| General built-in or bootstrap path | Reserve it explicitly; a Package may not replace call, general CRUD or bootstrap/help controls through ordinary exposure. |
| Required main Package mount or command conflicts | Selected admission gate: reject a conflicting required tree. Different-mount/explicit-resolution controls remain to be specified; optional-shortcut fallback does not waive the gate. |
| New candidates request the same optional root path | Publish no arbitrary winner based on load/enumeration order; leave conflicting optional candidates unbound unless there is an explicit selected owner. |
| Shared prefixes or executable group conflicts | Distinguish grouping from callable leaves and validate complete token paths before publishing. Extendable groups and executable groups still need a rule. |
| Unbound shortcut diagnosis | Identify requested path, requesting Package, current owner/conflict and the usable grouped alternative in installation/catalog diagnostics. |

The active catalog must distinguish requested aliases, successfully bound routes and unbound optional shortcuts. This effective selection participates in exact installed composition/catalog evidence. An unbound shortcut does not remove the Callable, change authorization, or prevent direct bd call invocation. Exact collision equivalence/normalization, same-target duplicate ownership, shortcut catalog encoding, explicit remapping, activation after a conflict disappears, uninstall/update behavior, profiles and group help remain open. Independent friendly-tree registration outside Packages is deferred.

## Scenarios

These embedded draft expectations are authoring content, not executed package/client conformance. Their index projects this Specification's candidate defining Links.

| Scenario | Meaning |
| --- | --- |
| [S1. Mount a Package alias tree](#s1-mount-a-package-alias-tree) | Alias suffixes become a tree below the selected CLI mount. |
| [S2. Keep grouped commands when a shortcut conflicts](#s2-keep-grouped-commands-when-a-shortcut-conflicts) | An optional root collision reports an unbound shortcut while valid grouped commands remain usable. |
| [S3. Discover installations through the graph](#s3-discover-installations-through-the-graph) | Current installation-Link presence is the installed fact, separate from aliases and runtime availability. |

### S1. Mount a Package alias tree

Status: draft

Given mypack/cliCommands/chris/sells/laughs targeting a selected Callable and an installed mount fun, the advertised tree exposes bd fun chris sells laughs using that Callable's argument mapping and help. Replacing the mount changes the prefix, not the Callable identity. A loose Callable remains usable through bd call without a Package. The catalog captures the alias set and exact selected definitions; ordinary point alias resolution alone does not prove enumeration or closure.

### S2. Keep grouped commands when a shortcut conflicts

Status: draft

Given a valid Memory Package grouped tree and an optional requested bd remember shortcut whose path is already bound, installation keeps bd memory remember and reports Memory's shortcut as unbound. The existing bd remember binding keeps its meaning. No optional collision turns the grouped operation into a failure or silently overrides another binding. Required grouped-tree conflicts and root-exposure encoding remain separate design questions.

### S3. Discover installations through the graph

Status: draft

Under the selected registry-Link model, a real registry Bead has one admitted installation Link to a selected Package/closure with its own Scope-specific mount. The outgoing typed-Link query returns that installation even if the Package's canonical ID is outside sys/packages. The admitted Link's presence means installed, and deleting that live Link removes the corresponding installation. A convenient alias under packages/ does not make the Package appear under that prefix in a normal Bead inventory. Removing or repointing a convenience alias does not by itself install or uninstall the Package. Current loaded/available state requires the separately agreed service observation contract; the durable installation Link alone does not establish it.

A second requested installation of the same global Package identity at another revision, local deployment URL or mount cannot publish another live installation Link in this Scope. A distinct global Package identity is not prohibited by this cardinality rule; its closure and CLI bindings still require validation.

## Open package decisions

These are the five active design decisions. Installation representation is now selected; the remaining parts still need decisions and complete Type descriptors.

| Issue | Decision area | Selected foundation | Still to decide |
| --- | --- | --- | --- |
| PKG-O1 | Installation shape and cardinality | Installation is a Link; live presence/absence is installed/not installed; at most one live installation per global Package identity per Scope; registry owns its installation table. Global Package ID may, but need not, be a Bead ID. | Global identity carrier and generic correspondence to local Beads (including alias candidates), registry/Link properties, uniqueness/ownership descriptors and duplicate-request behavior. |
| PKG-O2 | Declarations, imports and exports | Global identity first; arbitrary initial graph root with stable canonical IDs; one defining Package; imports select named exports; subordinate declared Bead IDs; named export Links; Package owns its composition tables. | Global identity/authority scheme, member eligibility, import endpoint/fields/grouping/local aliases, export name/schema/uniqueness, containment boundary and concrete ownership representation. |
| PKG-O3 | Exact closure | Explicit exact member/dependency closure retained; declared SemVer distinct from exact revision/commit. | Identity/version research and dependency conflicts first; then coverage/carrier/selection/retention, generic labelled Bead-and-Link revisions/Edition traversal and deferred CALL-O3 extern identity. |
| PKG-O4 | Installation lifecycle and admission | Live Link presence is installation; staged validation and atomic installation/catalog publication; failed updates retain old selection; required dependencies prevent implicit uninstall cascade. | bd pack subcommands/transport, transaction/concurrency and in-flight rules, authorization and any externally meaningful loaded availability. |
| PKG-O5 | Registry and CLI catalog | sys/ namespace, Package mounts, cliCommands/cliShortcuts and optional-shortcut collision fallback. | Registry discovery/reservation and owning Type, effective catalog carrier/revisions, required-tree conflicts, collision equivalence/ownership, group behavior, explicit rebinding and help/completion/cache rules. |

Concrete Package, PackDeclares, PackImports, registry and installation-Link descriptors remain incomplete. The reusable Package definition remains separate from installation. CALL-O1/O2/O3 stay open for the return after package shape, rather than being silently resolved by these conventions.

## Next five design questions

Current disposition after Donna's replies: question1 requires identity/version choices informed by Gas City/Lumen research before choosing dependency-conflict behavior; question2 A is selected as the long-term placement model; question3 A composition ownership/revision coverage is selected; question4 is deferred for iteration with generic owned-Link replacement/labelled revisions; question5 A atomic publication is selected. Recommendations still open below are explicitly marked. The selected Package Type/name, bd pack prefix, subordinate declared Bead IDs, named export Links, explicit named-export imports, one live installation per global Package identity per Scope, and optional-shortcut fallback remain settled.

### 1. Conflicting exact dependency revisions — PKG-O3

Context: installed Package A selects dependency D at revision r1 while Package B selects the same dependency identity at r2. One installation per Package identity settles registry cardinality, but does not by itself decide whether different consumer closures may execute against different retained revisions.

Option A rejects conflicting exact dependency selections across active installation closures. It gives a Scope one consistent selected revision per dependency identity and simpler invocation/Type resolution, but a dependency update may require coordinated updates of its consumers. Option B permits separate exact dependency snapshots per consumer. It allows more independent updates, but execution, Type/schema bindings and inspection must carry the consumer's closure context; retention and diagnostics become more involved.

Open recommendation: A, not selected. Donna requires declared SemVer to be distinguished from actual revision/commit, and global Package identity to be designed first using Gas City/Lumen as research inputs. Revisit this conflict example using the resulting distinct identity/version/exact-selection concepts before ruling. No silent latest selection or version solver is inferred.

### 2. Does installing under another graph root create new identities? — PKG-O2

Context: a Package's declared Beads must be subordinate to its root, and that root may be anywhere. CLI mounting is already independent: bd memory remember versus bd notes remember need not change any canonical Bead IDs. Graph relocation is a different issue: changing acme/memory to team/memory changes the Package/member identity URLs.

Option A chooses an arbitrary graph root when the Package and members are first created, then preserves their canonical IDs through installation and CLI remounting. It uses existing identity rules and requires no implicit rewriting, but does not provide transparent graph relocation. Option B materializes a fresh Package/member graph beneath an installation-supplied root. It offers portable placement, but needs explicit relative-reference/rebasing rules, provenance and a decision about how the new Package identity relates to installation deduplication. It is not a rename of the original Resources.

Selected: A as the long-term direction. Promise arbitrary initial placement, registration through the sys/packages installation Link and independent CLI mounts, preserving the deployed canonical IDs. Design the global Package identity independently of that placement before loose/local cases. No implicit graph rebasing or identity translation is selected.

### 3. What changes are covered by the Package's own revision? — PKG-O1/PKG-O2

Context: declarations, named imports and named exports are separate Links. We need to decide whether changing one also changes the Package's revision, so an authoring revision identifies its composition table.

Option A makes Package own the outgoing declaration/import/export Link families. Existing owned-Link semantics then revision-cover those tables and support coherent reads and concurrency checks; the cost is more Package-revision changes and shared concurrency on composition edits. Option B keeps the Links independently versioned without Package ownership. It allows more independent edits, but Package revision alone does not identify its tables, and every reader/installer needs a separate complete composition snapshot.

Selected: A, including registry ownership/revision coverage of the installation table. These are the selected composition-history semantics; concrete descriptors and their relationship to the generic owned-Link replacement remain to be reconciled. Neither choice alone pins target member bodies. Multiple export names may target one definition; export-name uniqueness needs its own per-Package rule rather than endpoint-pair uniqueness.

### 4. Where is the exact installed closure retained? — PKG-O3

Context: exact closure is selected, but its carrier and detailed coverage remain open. A Package revision alone cannot fix member bodies, imported export targets, Type/schema bindings or repointable CLI aliases.

Option A retains an immutable closure Bead referenced exactly by the installation Link. It gives the snapshot ordinary graph identity/readability and permits sharing between installations or updates, at the cost of another Type and retention policy. Option B embeds the complete manifest in the installation Link's properties. It avoids a separate Resource and makes the binding self-contained, but enlarges Link reads/revisions and duplicates shared closure data. Neither option changes the selected installation fact: that remains the live installation Link.

Deferred: neither carrier is selected. Donna asks to iterate after the other four issues, consulting Olivia and comparing generic labelled revisions/Edition membership for BOTH Beads and Links. PackageClosure remains a former author proposal. Coverage, endpoint selection, traversal and retention need explicit design. Runtime business data remains outside definition closure; concrete extern identity remains deferred CALL-O3 work. Effective bound/unbound CLI routes remain installation/catalog results rather than reusable Package definition state.

### 5. What is the publication boundary for install, update and uninstall? — PKG-O4/PKG-O5

Context: installation-Link presence is the installation fact, and clients derive their command surface from admitted installations. An update must not expose a new Link selection with an old or incomplete CLI tree.

Option A validates/stages the closure and required CLI bindings, then publishes the installation change and effective catalog generation atomically. It provides one coherent visible state and clear failures, but requires an admission path that handles graph/catalog effects together. Option B accepts ordinary installation-Link CRUD first and reconciles the catalog later. It makes asynchronous processing easier, but needs pending/error/availability semantics and allows installed state to precede its usable command surface.

Selected: A. bd pack provides the management affordance while mutations follow the agreed admission rules, without another installed boolean or installation record. Required-tree conflicts reject the proposed change; optional-shortcut fallback still keeps grouped commands and reports an unbound shortcut. Failed updates retain the prior selection. Removing a dependency still needed by an active installation initially refuses rather than implicitly cascading. Concrete transport/transaction and in-flight invocation rules remain open; runtime handler availability and unresolved Callable retry behavior remain distinct contracts.

After the identity/version choices and deferred graph-capture comparison, author the concrete Package/member/import/export/registry/installation descriptors and required admission rules. Detailed naming, local import aliases, namespace discovery and CLI normalization/group/cache behavior still need an explicit pass; the selected dispositions do not yet complete the Specification.

## Depends on

These rows are authoring locators for candidate dependency Links. They do not assert stored identities, imported definitions or normative adoption. Dependencies are one way: this Specification uses Callables and Types.

| Title | Target | Status | Body |
| --- | --- | --- | --- |
| Callables | [Callable Beads](callables.md) | draft | Defines the named operation, argument projection and invocation contract reused by Package command paths. |
| Types | [Type system](../specs/types/type-system/type-system.md) | — | Governs package and callable Type descriptors, References/refinement and schema resources. |
| Effective Type validation | [Types profile](../specs/profiles/types/types.md) | — | Governs interpretation/admission of actual Type definitions rather than inventing package-local Type semantics. |
| Existing aliases and namespace | [Core](../specs/profiles/core/core.md) | — | Existing locator/namespace limits; does not already supply package alias enumeration or invocation forwarding. |
