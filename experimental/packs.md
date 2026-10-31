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

Starting graph proposal, pending concrete Type descriptors:

```text
Package --PackDeclares--> definition Bead
Package --PackImports--> dependency Package/member selection
Scope installation --selects--> exact Package/member/dependency closure
Scope installation --exposes--> CLI mount + bound routes + unbound optional shortcuts
```

Package membership remains explicit. Donna selected requiring a Package's declared definition Beads to be subordinate to its own ID. Containment constrains where a declared member may live; it does not make every Bead sharing a prefix a declared member. Exact endpoint constraints, relation ownership and import fields remain to settle.

### Definition ID space

A Package may have an arbitrary root ID and is discovered through installation Links rather than a universal definition-location prefix. For Package root acme/tools, its declared definition Beads must have proper descendant IDs such as acme/tools/types/Task or acme/tools/actions/laugh. Compare complete path segments: acme/toolsmith is not beneath acme/tools. The internal types/ and actions/ subdivisions are examples, not required names.

Imported definitions retain their original defining Package and ID. An import is not a declaration owned by the importing Package; an export or CLI binding may refer to that import without copying it into a second defining home. Package-owned binding names can still be subordinate to the importing Package.

This is a selected Package-specific admission rule; it does not change Core's rule that arbitrary Resource ID prefixes alone imply no containment. The rule covers declared definition Beads. Any extension to Link IDs or other owned bindings, nested Package boundaries, unrelated Beads under the same prefix, and how admission checks the cross-record ID relationship remain open. Existing properties schemas alone do not express that relationship.

Authoring root, installation selection and CLI mount remain distinct. A different CLI mount does not rename canonical member IDs. If mounting also means materializing a Package beneath a different graph ID root, reference rebasing, resulting identities and exact closure must be specified; canonical Resource identities are immutable, so this cannot be treated as renaming the original Resources.

### Named exports

Export names expose bindings to existing definitions; they do not create another defining home or an access-control boundary. Internal/external visibility remains deferred. A re-export requires the importing Package's explicit import and preserves the original definition identity and provenance.

Donna selected named export Links from the exporting Package to the original definition. Each Link carries an export name, and multiple names may target the same definition. Ordinary outgoing-Link enumeration and Link revisions apply. Package ownership of this Link family is a proposal that could revision-cover its export table; concrete Type name, property schema, name uniqueness/normalization, ownership, import provenance and exact target-selection rules remain open. Exact target pinning does not by itself capture transitive closure.

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

**Selected cardinality:** a Scope has at most one current live installation Link per Package identity, regardless of selected revision or CLI mount. A second Link cannot create a simultaneous installation of the same Package at another revision or mount. The registry/Package identity pair must be unique for live admitted installation Links; concrete Type constraints and duplicate-request behavior remain to be specified. Different Package identities can coexist, subject to ordinary closure and command collision rules. Updates change the existing installation selection through the admission protocol still to be defined. This does not remove retained historical revisions or decide dependency-version conflict policy.

Once admitted and published, the Link is authoritative installation state. Creating/deleting its live record is the model's install/uninstall transition. The command/transport and atomic validation/publication rules remain open: incomplete closure or conflicting required mounts must be dispositioned before a successful installation is published, rather than relying on a second installed flag. A Package definition or convenience alias alone does not establish installation, and an installed Link does not grant invocation permission or prove handler availability.

Ordinary BDP aliases are locators, not Resources, and have no collection membership. An alias-prefix Bead inventory therefore cannot replace this installation-Link query. A registry Type could own the installation-Link family so membership changes have ordinary owning-Bead revision behavior; the registry Type and ownership descriptor remain to be authored.

The representation choice is now settled as a Link. Any supplementary exact-closure object or graph must preserve that installation fact; it cannot rely on local Links being Bead endpoints. Exact closure representation and update/uninstall effects remain open.

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

Collision recommendations awaiting detailed adoption:

| Case | Proposed rule |
| --- | --- |
| General built-in or bootstrap path | Reserve it explicitly; a Package may not replace call, general CRUD or bootstrap/help controls through ordinary exposure. |
| Required main Package mount or command conflicts | Require a different mount/explicit resolution before activating the conflicting required tree. The optional-shortcut fallback does not waive required-tree conflicts. |
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

A second requested installation of the same Package identity at another revision or mount cannot publish another live installation Link in this Scope. A distinct Package identity is not prohibited by this cardinality rule; its closure and CLI bindings still require validation.

## Open package decisions

These are the five active design decisions. Installation representation is now selected; the remaining parts still need decisions and complete Type descriptors.

| Issue | Decision area | Selected foundation | Still to decide |
| --- | --- | --- | --- |
| PKG-O1 | Installation shape and cardinality | Installation is a Link; live presence/absence is installed/not installed; at most one live installation per Package identity per Scope. | Registry/Link properties, endpoint/uniqueness descriptors and duplicate-request behavior. |
| PKG-O2 | Declarations, imports and exports | One defining Package; imports explicitly select named exports; subordinate declared definition Bead IDs under arbitrary discoverable Package roots; named export Links. | Member eligibility/ownership, import endpoint/fields/grouping/local-name aliasing, export name/schema/uniqueness/ownership, containment boundary details and any graph-root materialization/rebasing. |
| PKG-O3 | Exact closure | Explicit exact member/dependency closure retained by installation. | Coverage/carrier/selection/retention, alias and Type/schema evidence, conflicting dependency versions and reconciliation with deferred CALL-O3 extern identity. |
| PKG-O4 | Installation lifecycle and admission | Accepted Link creation/deletion changes installation presence; no extra installed boolean. | bd pack subcommands or CRUD transport, atomic admission/publication, update/uninstall effects, authorization and any externally meaningful loaded availability. |
| PKG-O5 | Registry and CLI catalog | sys/ namespace, Package mounts, cliCommands/cliShortcuts and optional-shortcut collision fallback. | Registry discovery/reservation and owning Type, effective catalog carrier/revisions, required-tree conflicts, collision equivalence/ownership, group behavior, explicit rebinding and help/completion/cache rules. |

Concrete Package, PackDeclares, PackImports, registry and installation-Link descriptors remain incomplete. The reusable Package definition remains separate from installation. CALL-O1/O2/O3 stay open for the return after package shape, rather than being silently resolved by these conventions.

## Depends on

These rows are authoring locators for candidate dependency Links. They do not assert stored identities, imported definitions or normative adoption. Dependencies are one way: this Specification uses Callables and Types.

| Title | Target | Status | Body |
| --- | --- | --- | --- |
| Callables | [Callable Beads](callables.md) | draft | Defines the named operation, argument projection and invocation contract reused by Package command paths. |
| Types | [Type system](../specs/types/type-system/type-system.md) | — | Governs package and callable Type descriptors, References/refinement and schema resources. |
| Effective Type validation | [Types profile](../specs/profiles/types/types.md) | — | Governs interpretation/admission of actual Type definitions rather than inventing package-local Type semantics. |
| Existing aliases and namespace | [Core](../specs/profiles/core/core.md) | — | Existing locator/namespace limits; does not already supply package alias enumeration or invocation forwarding. |
