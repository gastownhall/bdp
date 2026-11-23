> Historical source snapshot from commit `692d801231c78e12b456d8c5213bdf137a6b534d`. This is not the canonical review specification. See the [current specification](../../../../README.md). Original source and hash are recorded in the archive index.

# Intrinsic Types publication 1

This is a selected draft source publication under [Types §2.3](types.md#23-shared-intrinsic-publication-and-illustrative-graph), not a public installation protocol or evidence of provider support. The immutable artifact is [intrinsic-1.json](intrinsic-1.json); its [publication record](intrinsic-1.publication.json) records the SHA256 of the complete UTF-8 artifact, including its final newline. A digest identifies bytes. It does not authenticate a publisher, allocate ordinary Resource revisions or select a generic package format.

## Assigned exact graph

The repository publishes these protocol identities. URI spelling does not imply a live Resource service, authoring Scope or network dereference.

| Definition identity | Exact revision | Own exact affiliation |
| --- | --- | --- |
| `https://github.com/gastownhall/bdp/types/type-system/type` | `type-1` | `bead-type` at `bead-type-1` |
| `https://github.com/gastownhall/bdp/types/type-system/bead-type` | `bead-type-1` | itself at `bead-type-1` |
| `https://github.com/gastownhall/bdp/types/type-system/link-type` | `link-type-1` | `bead-type` at `bead-type-1` |
| `https://github.com/gastownhall/bdp/types/type-system/refines` | `refines-1` | `link-type` at `link-type-1` |

Short names in the table abbreviate the complete identities in its first column. They are not installed aliases. Type, BeadType, LinkType and Refines remain the concepts' prose names; case and path spelling do not derive category or equality.

Two declaration identities share that namespace: `bead-type-refines-type` and `link-type-refines-type`, each at exact revision `declaration-1`. Each has exact affiliation with Refines at `refines-1`, a floating source naming its definition, an exact target naming Type at `type-1`, and empty properties. The declaration copies in `declarations` equal the records captured in their sources' `ownedLinks`; the latter are the authority for interpreting each definition edition. There are no task, Issue, Dependency or Memory definitions in this publication.

Type is abstract. BeadType and LinkType conform to its exact published edition; Refines is a Link Type. BeadType's metatype self-reference and the mutually needed bootstrap references are not Refines cycles. The Refines graph over exact definition editions must remain acyclic. Refines itself has neither generic identity acyclicity nor a generic self-link prohibition: an ordinary explicit T@2 → T@1 declaration is not an exact-edition cycle merely because both editions have the same identity.

## Retained meaning and trusted initialization

The assigned revision labels are opaque values of this trusted publication. Clients cannot assign server revisions through ordinary create. Implementations explicitly provision and admit the entire coherent intrinsic graph and required schema closure at a trusted initialization boundary. Provisioning must validate the exact bytes and all selected Types obligations; merely loading this JSON is not registration. Public install/register/update/default-selection operations are separate from this publication.

The actual application schema identifiers in the artifact are under `https://github.com/gastownhall/bdp/schemas/types/intrinsic-1/`. These are versioned protocol resource identifiers, not fetching instructions. Standard 2020-12 resources retain their original identities and content. Each definition carries its required application schema environment. Resolve that retained environment without fetching current remote content or inventing a base from the Type identity. The older illustrative [definitions.json](definitions.json), adjacent illustrative schemas and historical qualification records remain unchanged.

A later intrinsic publication uses new exact editions and retains prior exact meaning and required dependencies. It must not overwrite this artifact or silently upgrade affiliations, registered exact versions or local defaults. Incompatible capability meaning requires its own selected version; new intrinsic bytes do not redefine version `"1"` implicitly. Ordinary Scope clients cannot update or remove intrinsic definitions.

## Origin and inspection boundary

This publication records **no original authoring Scope**. An exact-definition lookup serving these records MUST omit `originScope`; it MUST NOT use the GitHub namespace, the repository URL or the interpreting Scope as a fabricated origin. If a later separately recorded origin fact exists, the common lookup's actual recorded-context rules apply. Availability of retained bytes does not establish ordinary Resource point ownership or local graph membership.

The selected [local materialization direction](types.md#24-ordinary-local-records-for-shared-intrinsic-definitions) provides genuinely local definition records through trusted initialization, with an explicit exact correspondence to this shared publication. Their local IDs/revisions and ownership are distinct from the shared protocol identities; their own affiliations retain the shared metatypes. Included local declaration Links have real local allocations and owned captures. Local mirror state does not re-author global intrinsic conformance, and no schema URI is rewritten. Public mapping transport and producer implementation remain separate obligations.

Consequently, this artifact alone does not make `bd show INTRINSIC-ID` an executable ordinary Resource read. Such a read needs an actual owning route under the common contract. The [first vertical sequence](../../../docs/cli-design/types-first-sequence.md) records that inspection mapping explicitly. An interpreting exact-definition lookup must keep its complete `{definition, originScope?}` wrapper; it cannot silently become ordinary `show` output. No fake live intrinsic service is selected here.

## Source validation limits

`scripts/check_types_selected.py` checks the feature-owned schema against the unchanged common bundle and the finite assigned graph: exact membership, metatype pins, recorded declaration copies, category-preserving edges, exact-target uniqueness, exact-edition acyclicity, retained schema validation and complete artifact digest. Negative mutations exercise these checks. This is finite source/artifact validation, not a general Type admission engine, public provisioning API, ordinary graph read or provider qualification.
