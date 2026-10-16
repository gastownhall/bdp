# Gas City packs as an out-of-band Type carrier — source notes

Date: 2026-10-08 (America/Los_Angeles). Research evidence and recommendations only; this document does not amend the BDP Type design or settle the Beads pack contract.

## Finding

Gas City already has a working schema-2 directory-and-TOML pack system, Git transport, a release catalog, dependency resolution, and a committed lockfile. Its existing `assets/` area can physically carry one or many passive Type documents. It does **not** currently provide a BDP Type payload format, Type inventory, Type registration operation, or Type identity/version semantics. Reuse is therefore plausible at the distribution layer, with shared BDP payload semantics and a Beads installation contract still required. This conclusion follows from the current manifest model, loader, and package manager, rather than the older PackV2 proposals. [G1][G2][G3][G4]

## Evidence freshness and authority

Remote HEADs were queried with `git ls-remote`, fetched without switching or editing checkouts, and inspected with `git show <head>:<path>`:

| Repository | Exact surveyed remote HEAD | Evidence role |
|---|---|---|
| `gastownhall/gascity` | `0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc` | Current upstream implementation, tests, public specification |
| `gastownhall/gascity-packs` | `520e95cb22992a8a1017f7a60da267f203497c7e` | Current first-party manifests and registry records |
| `donnabox/gascity-tools` | `413cca521b961ada85b5cf72b8b33036f8dcdd90` | Older copied contract material; useful historical comparison |

The local `/Users/dbox/repos/gc` checkout was at `d56197d25bb5d4c36dfbe0b0e6c4c70d7a53216e` (June 9); its `origin` is the separate `donnabox/gascityworkplace` fork, whose remote HEAD was `eee949b8f0d994e1cc55b2785e41cae89e519ade`. Current Gas City claims here refer to the **upstream** HEAD above, not that fork or the installed local binary. The local packs checkout was also stale (`6f2e9670b66eb50a3a11b21b07606b73706163ee`). No runtime tests or installed-binary compatibility claims were made.

Gas City's `engdocs/design/packv2/README.md` explicitly labels that directory historical and gives current code/tests precedence. Its old `doc-packman.md` says there is no registry launch story; current registry code and CLI prove that is no longer the current product surface. Schema 2 itself is implemented, not merely proposed. [G2][G12]

The tools repository's `contracts/pack-v2/contract.toml` remains version `0.0.0`, status `bootstrap`; its spec says last verified May 30. Some content is stale: it says import bindings do not namespace agents, whereas current upstream describes dot-qualified binding names. Its runtime/conformance directories contain placeholders. The dirty local, untracked `contracts/pack-v2/spec/lumen-native-packs.md` was excluded from evidence. [T1][T2][G1]

## Current implemented surface

| Concern | Current behavior and implication |
|---|---|
| Container | A directory with UTF-8 `pack.toml`; only that manifest is required. There is no required archive format. Files may be transported through a Git repository/subdirectory. [G1][G4] |
| Manifest | `[pack]` holds `name`, `schema`, optional `version`, `description`, `requires_gc`, and agent requirements. Schema 2 is current. Current loading rejects unknown TOML fields; adding `[types]` or `[bdp]` cannot be assumed compatible. [G2][G3] |
| Dependencies | `[imports.<local-binding>]` uses `source` and optional `version`. Sources cover local paths and Git URLs/subdirectories, with browser-readable GitHub tree URLs preferred. Imports form a transitive graph; the resolver reconciles constraints for each source. This is package dependency resolution, not resolution of references inside Type documents. [G3][G4][G5] |
| Requirements | `requires_gc` is parsed but explicitly not enforced by current load/import/doctor. `[[pack.requires]]` means required **agents** in city/rig scope; it is not a general package, BDP capability, or Type dependency declaration. [G1][G3] |
| Version selection | Git sources support `sha:<commit>` or the implementation's semver-like constraints. Registry-published sources resolve matching active catalog releases; a missing matching release does not silently fall back to Git tags. Supported numeric versions and constraints are narrower than every possible npm-style semver expression. [G5][G7] |
| Lock | Current file is plural `packs.lock`, schema 1. A source-keyed entry contains `version`, `commit`, and `fetched`. It does **not** contain the registry content hash. Plain local path dependencies do not receive remote lock entries. The older `internal/config/pack_fetch.go` and singular `pack.lock` are not the schema-2 contract to copy. [G4][G6] |
| Registry | `registry.toml`, schema 1, describes packs and releases. A release includes version, ref, exact commit, SHA-256 hash, description, and optional withdrawal metadata. Catalog sources can be HTTPS or local files; HTTP is rejected. Default `main` points at the first-party raw GitHub catalog. Catalog discovery and Git payload transport are distinct. [G8][G9][P1] |
| Integrity | Canonical release hashing covers a sorted manifest of tracked relative paths, modes, and blob SHA-256 digests at the pinned commit. Registry-resolved sync verifies that content hash and has a test for rejecting mismatch. This is not a signed-publisher or Type-semantic guarantee. Do not imply every lock restore rechecks a hash: `InstallLocked` restores commits and the lock has no digest field. [G4][G6][G7][G10] |
| Management | `gc import` exposes add/remove/check/install/upgrade/list/status/why/migrate/prune/credential operations. It manages imports/cache/locks. `gc pack registry` handles discovery, registry configuration, authentication and publish submission. Persisted imports store durable sources, not `main:foo` handles. [G4][G11] |
| Code reuse | Resolver and registry code live in Go `internal/packman` and `internal/packregistry`, coupled to Gas City config, home/cache and imports. They are implementation evidence, not an independently consumable Beads SDK. Reusing the format or extracting a supported library are separate choices. [G4][G8] |

A concrete current manifest example is `cass/pack.toml`: it contains only `[pack]` with name, version, and schema 2. That demonstrates a small manifest, **not** a passive pack: cass also ships skills/overlays. `slack-mini/pack.toml` demonstrates the opposite extreme: a supervised service launches `./adapter/run.sh`. Manifest brevity alone is not a non-execution guarantee. [P2][P3]

## Passive payload versus activation

Current Gas City reserves conventional directories such as agents, commands, doctor, formulas, orders, skills, MCP configuration and overlays. `assets/` is the documented support-file area and is not directly scanned for definitions. A Beads Type payload can therefore be carried there without inventing a new Gas City top-level directory. No BDP Type support was found in the surveyed pack manifest model, loader, resolver or registry surface. This is a bounded finding about those components, not a claim about every future branch. [G1][G2][G3]

Gas City packs also carry executable behavior. Commands use `commands/<path>/run.sh` (with optional metadata); doctor checks run scripts, optional fixes, and can opt into start warm-up. Agent configuration includes setup/hook facilities, `[global].session_live` supplies live-session commands, and services/runtime providers can launch processes. The package manager has no general `preinstall`/`postinstall` Type registration hook in its surveyed manifest/install surface. Installing bytes and later activating Gas City contributions must not be conflated. [G3][G4][G13][P3]

**Recommendation, not a settled contract:** define a Beads passive Type installation path that parses data, validates it, and records provenance without invoking commands, doctor scripts, skills, lifecycle hooks, services or runtimes. If a product pack also carries skills/CLI commands, activation must be a separately specified client behavior; the mere presence of a Type payload should not execute those contributions. Check the transitive dependency closure as well as the direct pack. A registry hash proves matching bytes, not harmless behavior. [G4][G10][G13]

## Candidate use by BDP and Beads

**Recommendation:** reuse the existing outer Gas City pack shape and transport where useful; keep the payload an independently specified passive export of Type definitions. An illustrative, unapproved layout is:

```text
example-types/
  pack.toml
  assets/
    bdp-types/
      inventory.json
      customer.json
      invoice.json
```

The names, JSON format, inventory fields and filenames above are deliberately illustrative. Current Gas City does not recognize them. A portable inventory could identify the included definitions explicitly so a consumer need not infer authoritative Type identity from filenames or recursively interpret arbitrary JSON. Keeping this contract under `assets/` avoids relying on unknown `pack.toml` fields or reserved top-level expansion. [G1][G2]

There are at least four separate values to retain: **pack format schema**, **package release version**, **payload format version**, and **Type identity plus exact Type version/reference**. One pack can carry multiple Types, and a new pack release can change documentation or a command while leaving its Type definitions unchanged. Package semver therefore must not become a Type version, and the package import binding must not become the Type namespace. The first two values exist in Gas City; the latter two require the BDP/Beads contract, not inference from Gas City's package metadata. [G3][G6][G7]

Root-agent coordination context: the Beads client direction already contemplates packs containing Type definitions, skills, and CLI commands, with detailed C3 design still open. This survey supplies implementation constraints for that discussion; it does not independently ratify that plan or choose BDP Type identity rules.

## Decisions still open

1. Who owns the portable Type export and inventory schema, and what exact content constitutes one exported Type definition?
2. How does installation preserve publisher Type IDs and exact Type versions while exposing definitions in the consumer's local inventory? Gas City import bindings and pack names do not answer this.
3. How are Type dependencies, metatype/runtime requirements and unsupported definitions validated? Existing agent requirements and unenforced `requires_gc` cannot carry those guarantees.
4. Is a Beads install strictly passive, or can a separately authorized client operation activate skills/commands? How does that rule apply to transitive packages?
5. What provenance does Beads retain after installation: package source, release, commit, digest, payload inventory and exact Type refs? Current `packs.lock` alone does not preserve the content digest or Type refs.
6. What are update, conflict, rollback and uninstall semantics for installed Types already referenced by Beads? Existing cache/import removal does not specify Type lifecycle.
7. Should Beads interoperate through a shared file contract, a deliberately extracted library, or a CLI adapter? Current private Go packages do not settle the product boundary.

## Pinned primary sources

All G links use Gas City HEAD `0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc`.

- [G1: current pack specification](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/docs/reference/specs/pack-spec.md), especially sections 0–1, 1.3.1, 2.2.
- [G2: manifest model and loader](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/config/pack.go), `currentPackSchema`, `PackConfig`, unknown-field gate around line 1268, discovery around line 1498.
- [G3: import, metadata, requirements and executable fields](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/config/config.go), `Import` (839), `PackMeta` (862), `PackRequirement` (1097), `PackGlobal` (1173).
- [G4: install/resolution lifecycle](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/packman/install.go), `SourcePolicy`, `InstallLocked`, `syncLock`; [CLI contract](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/cmd/gc/cmd_import.go); [Git/cache implementation](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/packman/cache.go).
- [G5: version selection and constraints](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/packman/resolve.go), `ResolveVersion`, `SelectVersion`, `matchesConstraint`.
- [G6: actual lock schema and serialization](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/packman/lockfile.go), `Lockfile`, `LockedPack`, `WriteLockfile`.
- [G7: registry release selection and verification](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/packman/registry_release.go); [mismatch/no-fallback tests](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/packman/registry_release_test.go).
- [G8: catalog structures and transports](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/packregistry/catalog.go), `CatalogRelease`, `NormalizeSource`.
- [G9: default registry configuration](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/packregistry/config.go).
- [G10: canonical content hash](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/packregistry/content_hash.go), `PackContentHash`, `VerifyPackContentHash`.
- [G11: current registry guide](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/docs/guides/registry-showcase.md).
- [G12: historical-design authority notice](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/engdocs/design/packv2/README.md); [old import-management proposal](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/engdocs/design/packv2/doc-packman.md).
- [G13: doctor execution](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/internal/doctor/pack_checks.go), `Run`, `Fix`, `WarmupEligible`; [command registration/execution routing](https://github.com/gastownhall/gascity/blob/0ccc208c2b7155b4e3c3a52bf1636e6e6fb7c4dc/cmd/gc/cmd_pack_commands.go).
- [P1: actual registry releases](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/registry.toml).
- [P2: minimal cass manifest](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/cass/pack.toml).
- [P3: service-bearing Slack manifest](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-mini/pack.toml).
- [T1: bootstrap contract status](https://github.com/donnabox/gascity-tools/blob/413cca521b961ada85b5cf72b8b33036f8dcdd90/contracts/pack-v2/contract.toml).
- [T2: copied May-verified specification](https://github.com/donnabox/gascity-tools/blob/413cca521b961ada85b5cf72b8b33036f8dcdd90/contracts/pack-v2/spec/pack-spec.md).
