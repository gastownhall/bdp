---
type: Specification
id: ""
status: draft
subjects:
  - Pack
  - PackDeclares
  - PackImports
  - CLI command trees
---

# Packs

> **NON-NORMATIVE EXPERIMENTAL DRAFT. NOT THE PLAN OF RECORD. NOT A RELEASED CAPABILITY OR AN IMPLEMENTATION CLAIM.**
>
> [BDP #59](https://github.com/gastownhall/bdp/issues/59) remains the shared plan; [specs/](../specs/README.md) remains the retained protocol front door. This draft collects the selected package composition and CLI exposure direction; it does not advertise installable Types or package runtime support.

This is a standalone Specification draft following the pinned [Memory authoring bundle](https://github.com/donnabox/memory-beads/blob/cc32cba35758a8dbbd89d5cf953c7035203cd836/specs/formats/markdown-bead-bundles.md). The H1 is its title, its identity is unassigned, and the Scenario index projects candidate owned definition Links rather than stored records.

## Scope and dependency direction

Packs group definitions, declare explicit imports, retain an exact member/dependency closure and provide installed CLI command trees. This Specification depends on [Callables](callables.md) and [Types](../specs/types/type-system/type-system.md). Callables can be defined and invoked without a Pack; their Specification has no dependency on this one.

| Specification | Owns |
| --- | --- |
| Types | Type descriptors, affiliation, refinement, schema resources and effective validation. |
| Callables | Callable/Batch/Query definitions, parameters, reusable argument projection/help, implementations and BDP/direct CLI invocation. |
| Packs | Defining membership, imports, exact installed composition, CLI mounts, hierarchical command/shortcut aliases, catalog bindings and collision behavior. |

A Pack does not add a second callable signature or executor. Command paths select the existing callable contract; its implementation may be the selected AST or service-side Go extern. Clients discover the service-supplied surface with only Scope-specific caching and no Pack-specific client installation.

## Composition contract

The selected working vocabulary is Pack, PackDeclares and PackImports. Use distinct uniquely named Bead/Link Types for this round; their complete descriptors, properties and endpoint constraints remain to be authored. This vocabulary does not install definitions or broaden Memory's defines/references constraints.

- A Pack-declared entity has one defining Pack; other Packs require explicit imports. Standalone Callables have no synthetic Pack requirement.
- Pack and Specification are distinct; no Pack-as-Specification conformance is selected.
- Imports retain an explicit exact member/dependency closure. Complete coverage, carrier, resolution, retention and update semantics remain open.
- Package internal/external visibility and later definition-relation refinement/normalization are deferred. Ordinary principal/Scope/data authorization remains applicable.
- Saved CLI profile selection is initially user-global with compat as default; per-call overrides do not persist. Profile selection and Scope-specific catalog caching are independent.

Concrete package schemas, installation/catalog APIs, root/mount metadata and closure carriers are incomplete. Physical distribution, registries, version solving and Go deployment are outside this draft. The CLI direction below is more specific than the currently unfinished Pack descriptors.

## Definition and installation

Donna selected separate concepts for the reusable Pack definition and a Scope's installation. A Pack's definition does not change merely because a Scope chooses another CLI mount. Installation does not create a second defining home for its members.

| Concept | Responsibility | Modeling status |
| --- | --- | --- |
| Pack definition | Describes declared members, explicit dependencies and authored command/shortcut aliases. | Pack remains the working Bead Type name; its concrete propertiesSchema is not yet selected. |
| Declared member relation | Identifies a definition's single defining Pack. | PackDeclares remains the working Link Type name; Pack to definition Bead is the proposed endpoint shape. |
| Import relation | Expresses a dependency on definitions supplied by another Pack. | PackImports remains the working Link Type name; whole-Pack versus selected-member import detail remains open. |
| Installation | Binds a selected Pack definition and exact resolved member/dependency closure to an installing Scope, CLI mount and effective bound/unbound exposures. | Separate installation concept selected; representation as a Bead, a service-owned record or a catalog structure remains open. |

For example, the same reusable Memory Pack can be installed at CLI mount memory in one Scope and notes in another. Its cliCommands/remember alias then exposes bd memory remember or bd notes remember, respectively, using the same selected Callable contract. Root shortcut bindings and collision diagnoses are installation results; they are not edits to the reusable Pack's authored command tree. This example does not choose cross-Scope transport, copy/identity or retention mechanics.

An installation must retain enough exact selection evidence to avoid drifting when authoring definitions/imports/aliases later change. The closure carrier, validation point and update protocol remain open. Definitions and installation bindings are distinct from the ordinary runtime data the operations read or mutate; installed exact definitions do not create a separate business-data store or imply historical data capability.

Starting graph proposal, pending concrete Type descriptors:

```text
Pack --PackDeclares--> definition Bead
Pack --PackImports--> dependency Pack/member selection
Scope installation --selects--> exact Pack/member/dependency closure
Scope installation --exposes--> CLI mount + bound routes + unbound optional shortcuts
```

Pack membership is explicit rather than inferred from every Bead whose ID shares a path prefix. Hierarchical IDs have a selected role in the cliCommands/cliShortcuts convention; the member/import graph still supplies definition and dependency meaning. Exact endpoint constraints, relation ownership, import selections and whether a Scope permits multiple installations of the same Pack remain to settle.

## Current design sequence

The active design pass is Packs: give the definition/member/import graph and installation/closure/catalog boundary a concrete shape. The standalone Callable issues [CALL-O1 through CALL-O3](callables.md#open-issues) remain open and are revisited once this package shape can inform them. Work here may clarify required closure inputs, but must not invent unresolved Callable parameter nodes, invocation envelopes or Go implementation identity rules by implication.

## Installed CLI surface

Donna selected Pack-provided friendly trees using hierarchical aliases under a well-known Pack-relative cliCommands/ root. Loose callables use the Callables Specification's bd call entry. This supersedes independent friendly-tree registration and separate path-array proposals for this round.

Client options precede the selected command; arguments after the command use the callable's existing projection:

```text
bd [client options] PACK-MOUNT COMMAND-PATH [callable arguments]
```

## Hierarchical alias convention

The CLI path is the installed Pack mount path followed by the alias path relative to that Pack's cliCommands/ root. The Pack's storage/definition prefix and chosen CLI mount are independent. For a Pack rooted at mypack:

| Pack alias | CLI with mount mypack | CLI with mount fun |
| --- | --- | --- |
| mypack/cliCommands/chris/sells/laughs | bd mypack chris sells laughs | bd fun chris sells laughs |
| mypack/cliCommands/chris/sells/cries | bd mypack chris sells cries | bd fun chris sells cries |
| mypack/cliCommands/chris/anderson/smirks | bd mypack chris anderson smirks | bd fun chris anderson smirks |
| mypack/cliCommands/chris/list | bd mypack chris list | bd fun chris list |

Each alias targets a Callable, whether defined by this Pack or available through an explicit import. Its selected callable supplies parameters, CLI argument mapping and help. Common prefixes create groups. A callable ID outside this explicit convention does not create a command path. No separate path array is required to duplicate the hierarchical alias name.

The service must admit the chosen alias namespace and advertise the installed tree. Existing BDP aliases provide individual GET/HEAD redirect resolution, not a complete alias inventory, stored revisions, alias chains or invocation forwarding. The Pack catalog must provide a complete discoverable alias set for help/completion and retain selected targets/definition closure. Invoke the resolved callable through the callable contract; do not POST through an assumed alias-forwarding behavior. The alias set, selected definitions and effective installation bindings must not drift silently through live repointing or latest-on-retry resolution.

## Optional top-level shortcuts and collisions

A Pack can also request explicit top-level CLI shortcuts. Donna's motivating example is the Memory Pack exposing bd memory remember and a top-level bd remember shortcut to the same selected operation. The working Pack-relative cliShortcuts/ root requests these optional root exposures: memory/cliCommands/remember supplies the grouped command, and memory/cliShortcuts/remember requests bd remember. Both aliases target the same selected Callable directly. Exact inventory/admission metadata remains open; the client must not mechanically strip the Pack mount from every command. Both exposures use the same callable, parameter mapping and execution semantics. A CLI shortcut to a grouped command does not require a chain of BDP aliases.

**Selected collision outcome:** if an optional top-level shortcut conflicts while the Pack's grouped commands are valid, keep the grouped commands and report the shortcut as unbound. An already accepted binding keeps its meaning. For example:

| Requested exposure | Existing situation | Outcome |
| --- | --- | --- |
| bd memory remember | Grouped Memory tree is valid | Install/retain the grouped command. |
| bd remember | Path already belongs to another binding | Keep that binding; report Memory's optional shortcut as unbound, with bd memory remember as its usable alternative. |

Collision recommendations awaiting detailed adoption:

| Case | Proposed rule |
| --- | --- |
| General built-in or bootstrap path | Reserve it explicitly; a Pack may not replace call, general CRUD or bootstrap/help controls through ordinary exposure. |
| Required main Pack mount or command conflicts | Require a different mount/explicit resolution before activating the conflicting required tree. The optional-shortcut fallback does not waive required-tree conflicts. |
| New candidates request the same optional root path | Publish no arbitrary winner based on load/enumeration order; leave conflicting optional candidates unbound unless there is an explicit selected owner. |
| Shared prefixes or executable group conflicts | Distinguish grouping from callable leaves and validate complete token paths before publishing. Extendable groups and executable groups still need a rule. |
| Unbound shortcut diagnosis | Identify requested path, requesting Pack, current owner/conflict and the usable grouped alternative in installation/catalog diagnostics. |

The active catalog must distinguish requested aliases, successfully bound routes and unbound optional shortcuts. This effective selection participates in exact installed composition/catalog evidence. An unbound shortcut does not remove the Callable, change authorization, or prevent direct bd call invocation. Exact collision equivalence/normalization, same-target duplicate ownership, shortcut catalog encoding, explicit remapping, activation after a conflict disappears, uninstall/update behavior, profiles and group help remain open. Independent friendly-tree registration outside Packs is deferred.

## Scenarios

These embedded draft expectations are authoring content, not executed package/client conformance. Their index projects this Specification's candidate defining Links.

| Scenario | Meaning |
| --- | --- |
| [S1. Mount a Pack alias tree](#s1-mount-a-pack-alias-tree) | Alias suffixes become a tree below the selected CLI mount. |
| [S2. Keep grouped commands when a shortcut conflicts](#s2-keep-grouped-commands-when-a-shortcut-conflicts) | An optional root collision reports an unbound shortcut while valid grouped commands remain usable. |

### S1. Mount a Pack alias tree

Status: draft

Given mypack/cliCommands/chris/sells/laughs targeting a selected Callable and an installed mount fun, the advertised tree exposes bd fun chris sells laughs using that Callable's argument mapping and help. Replacing the mount changes the prefix, not the Callable identity. A loose Callable remains usable through bd call without a Pack. The catalog captures the alias set and exact selected definitions; ordinary point alias resolution alone does not prove enumeration or closure.

### S2. Keep grouped commands when a shortcut conflicts

Status: draft

Given a valid Memory Pack grouped tree and an optional requested bd remember shortcut whose path is already bound, installation keeps bd memory remember and reports Memory's shortcut as unbound. The existing bd remember binding keeps its meaning. No optional collision turns the grouped operation into a failure or silently overrides another binding. Required grouped-tree conflicts and root-exposure encoding remain separate design questions.

## Remaining package design work

Complete Pack/PackDeclares/PackImports descriptors and concrete exact import/member closure, alias inventory and installed catalog binding contracts. Settle mount admission, shortcut catalog encoding, collision equivalence/ownership, reserved built-ins, executable/extendable groups, updates/uninstall, explicit rebinding and help/completion/cache revalidation. These are package decisions; they must not be added as prerequisites to the standalone Callable Type contract.

## Depends on

These rows are authoring locators for candidate dependency Links. They do not assert stored identities, imported definitions or normative adoption. Dependencies are one way: this Specification uses Callables and Types.

| Title | Target | Status | Body |
| --- | --- | --- | --- |
| Callables | [Callable Beads](callables.md) | draft | Defines the named operation, argument projection and invocation contract reused by Pack command paths. |
| Types | [Type system](../specs/types/type-system/type-system.md) | — | Governs package and callable Type descriptors, References/refinement and schema resources. |
| Effective Type validation | [Types profile](../specs/profiles/types/types.md) | — | Governs interpretation/admission of actual Type definitions rather than inventing package-local Type semantics. |
| Existing aliases and namespace | [Core](../specs/profiles/core/core.md) | — | Existing locator/namespace limits; does not already supply package alias enumeration or invocation forwarding. |
