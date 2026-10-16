# Type distribution, packs and registries — discussion note

October 8, 2026. Owner: Trish. Plan: [BDP #59](https://github.com/gastownhall/bdp/issues/59).
This is investigation and proposed decision framing, not new product rulings.
The reviewed [Type design](type-lifecycle-preview2.md) remains unchanged for
Donna's detailed review. Gas City source evidence is in the companion
[pack survey](type-packaging-source-notes-20261008.md).

## Proposed separation

Use the same Type definition artifacts in two distribution paths:

1. **Online source:** a BDP publishing Scope serves Type Beads and exact retained
   versions, with ordinary access control and discovery.
2. **Out-of-band carrier:** a package contains selected exact definitions and their
   resolved dependencies, preserving their original identities and meanings.
3. **Installation:** a consuming authority verifies and admits the artifacts for
   validation; it does not silently rewrite their identities or adopt them on
   existing instances. A client may separately activate pack commands/skills.

The registry is a source of content, not a prerequisite on the admitted mutation
path. An archive filename, package version, publisher URL and exact Type version
are different concepts. This is consistent with the existing offline installed-
closure requirement, not a decision to add a new live registry dependency.

## Can a registry just be a BDP server?

Under the proposed Types-as-Beads model, yes: a registry can be an ordinary BDP
server hosting a Scope of Type Beads. We should first identify a deployment's
required capabilities, rather than invent a second registry protocol.

The canonical ID of a Type Bead published in that Scope is under its canonical
Scope URL, following the chosen Bead identity rules. That does not make an
installed copy a new definition owned by the consumer Scope. If a consuming
Scope uses that global Type, its instances retain the publisher's Type identity
and the selected exact version. Copying content into a newly identified local
Bead would instead create another identity unless a separate mirror mechanism
explicitly preserves origin identity. Rehosting/mirroring remains a design choice.

Two reads must be distinguished. Reading the Bead whose identity is the Invoice
Type ID obtains its definition. Filtering a Bead collection by the metatype finds
Type-definition Beads. Filtering by Invoice's Type ID instead finds Invoice
instances. The exact metatype identity/discovery form is still D01; no wire query
form is selected here.

A useful registry needs more than current-only listing:

- Discover definitions and their exact revisions, and obtain the requested exact
  immutable version. Current BDP has an optional complete History capability;
  serving current Beads alone does not imply exact historical reads.
- Retain published versions for the promised support period and expose explicit
  unavailability. History capability alone promises no minimum retention duration.
- Provide dependency data sufficient for an installer to resolve the whole exact
  closure, including parents, metatype requirements and schema resources.
- Separate publisher designation/defaults from consumer-local installed choices,
  authorization and trust. Content delivery is not semantic compatibility proof.

No new global cross-registry search, package index, transactional installation API
or signature infrastructure is necessary merely to host the definitions. Those
features would each have their own product requirements if needed.

## What the package needs to carry

A candidate portable Type payload should identify selected roots and exact
contract-bearing artifacts, including dependencies, original identities, exact
version bindings and integrity evidence. Schema identifiers and reference bases
must keep their meaning when moved into local files; archive-relative paths must
not silently rebase original contract references.

An offline/self-contained export can include all required artifacts, with shared
artifacts deduplicated by exact identity. A thinner package could name external
dependencies, but then it is not a self-contained offline handoff. Either way,
installation must finish acquiring and validating the required closure before the
Type becomes usable for admitted writes. Metatype artifact availability does not
supply missing validator capability.

Gas City packs are a candidate outer product envelope: one package may carry Type
payloads together with commands, skills, documentation and other client assets.
The Type payload should remain consumable by a BDP provider that does not run the
Gas City agent runtime or execute the pack's product features. A generic passive
payload plus a host-specific pack integration is the current recommendation, not
a final format or execution policy.

A pack release may include multiple Type identities, multiple exact versions,
and definitions belonging to different major families. Its own version cannot
stand in for each Type's version or compatibility claim. A lock on the carrier
must also not erase the need for exact definition/dependency bindings inside it.

## Small worked handoff to develop next

Publisher P exports a Bead Type and a Link Type that requires it, together with
the exact parent/schema/metatype dependencies. Recipient Q installs offline.

Required observations to decide/test:

1. Q can identify the publisher's original Type IDs and exact definitions; no
   rebasing to Q's Scope URL occurs merely because Q stores the artifacts.
2. A missing, conflicting or unsupported dependency prevents partial usability.
   Reinstalling identical content and overlapping packages have explicit outcomes.
3. The same exact content obtained from P's BDP service and from the package gives
   the same contract, regardless of local filenames or transport.
4. Q can validate using installed artifacts after P goes offline.
5. Updating the pack changes neither existing instance pins nor stored history.
6. Removing the pack distinguishes removal of commands/skills from deactivation,
   retention and eventual collection of Type artifacts still referenced by data
   or another package.
7. A globally named definition inaccessible through the registry can still be
   installed from an authorized package if identity, integrity and admission rules
   permit it; fetchability and authority are separate questions.

These are design probes, not new executable tests or approved behavior for all
failure cases. There is no installation implementation in this note.

## Decisions to make with Donna; work suitable for AFK

The most useful joint decision is whether installation preserves foreign publisher
identity as installed artifacts, with re-publication under a new identity treated
as a distinct explicit action. Next choose whether the first out-of-band carrier
must be self-contained, and whether passive Type installation is independent of
activation of the pack's executable/client features.

Useful bounded AFK work: complete the pack reuse/gap matrix; prepare one illustrative
multi-Type package and dependency manifest; walk install/update/remove/overlap and
missing-definition cases; check registry discovery/exact-history requirements;
coordinate the Type-payload seam with the client/pack design owner. All can be
prepared as review material without deciding wire syntax or staging features.
No recurring or overnight automation is created by this discussion note.

## Primary source evidence and overlap

BDP main was rechecked at `182f1fcf8a01d896976bff3c9e3fb87c596c6ca6`.

- [Scopes and identity](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#scopes-and-identity)
  derives canonical Bead identity from the owning Scope and forbids reassignment.
- [Types](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#types)
  defines global descriptor identities and requires an installed local closure
  before offline mutation validation. This is current descriptor law, not an
  implemented Type-Bead registry or versioned-Type installer.
- [Types and Type Descriptors](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#types-and-type-descriptors)
  permits descriptors inside or outside the consumer Scope; inventory does not
  relocate or rename them.
- [Historical resolution](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#historical-resolution)
  is optional and includes exact historical reads; it is not a retention SLA.

Vickie's active plan moved from withdrawn upstream #7403 to the fork
[BDP client design](https://github.com/donnabox/beads/blob/bcc483738411da7eec649ab74b55edb190f0cc2e/docs/architecture/bdp-client-v2/design.md),
reviewed through [draft PR78](https://github.com/donnabox/beads/pull/78). Its agreed
direction already builds packs on Gas City concepts carrying Bead/Link definitions,
skills and extensible CLI commands. Its C3 pack details remain open. That is the
client-side coordination seam, not a reason to reopen the withdrawn tracker or
change the Preview 2 release gate. No Vickie or Janet files were edited.
