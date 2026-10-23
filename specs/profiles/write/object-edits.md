---
status: draft
intended-status: normative
version: "0.1"
---

# Ordinary object edits

Paired with the [canonical CLI edit modes](../../../docs/cli-design/object-edits.md)
under existing [#279](https://github.com/gastownhall/bdp/issues/279) and sole
[#59](https://github.com/gastownhall/bdp/issues/59). This extends the shared
ordinary update records in the [new v0.1 artifact](../core/bdp-v0.1.schema.json),
not the held v0 schema/runtime. [Affiliation/revision rules](../core/affiliations.md)
and [selected contract binding](../core/contract-binding.md) still apply. Actual
Types composition and required Event representation remain adoption gates.

## One operation, independent object planes

On creation, `properties` and `metadata` initialize their respective JSON objects,
defaulting to `{}` when omitted. Their existing creation grammar is unchanged.
On ordinary Bead or Link update, the request MAY supply:

| Member | Meaning |
| --- | --- |
| `type` | Whole affiliation replacement under the common affiliation rules |
| `properties` | Replacement of the caller-writable property set |
| `propertiesChange` | Ordered ordinary JSON Patch on properties |
| `metadata` | Complete metadata-object replacement |
| `metadataChange` | Ordered ordinary JSON Patch on metadata |

At least one of these five mutation members MUST be present. `properties` and
`propertiesChange` MUST NOT both occur, even if empty; the same applies to
`metadata` and `metadataChange`. The two object planes are independent, so a
properties replacement and metadata patch MAY accompany one another and `type`
in one atomic operation. Guard/provenance alone is not an edit. There are no
new mutable identity, endpoint, `ownedLinks`, revision or provenance-envelope fields.

Omitting both members for an object preserves it, subject only to the applicable
service-completion rules for an admitted write. An empty replacement `{}` supplies
an empty replacement set; it is not omission or an empty patch. An ordinary patch
`[]` is admitted and contributes zero patch operations. Arrays/null are not object
replacement values. JSON null inside an object is a value, distinct from removing
a member. No client-side read/modify/write implements these operations.

```json
{
  "bead":"task-42",
  "properties":{"title":"Reviewed"},
  "metadataChange":[{"op":"add","path":"/reviewed","value":true}],
  "expectedRevision":"resource-r7"
}
```

The field vocabulary and per-object exclusivity are the same in singleton and
shared operation-member positions. Existing sequence grammar inherits the shared
fields as staging accounting, not reinstatement of non-atomic sequence. This
amendment does not select atomic-batch discovery, supported subsets, result/retry
transport or deferred set writes; those remain #152 work. `updateWhere.change`
does not gain a replacement or Type member.

## Properties replacement and conditional policy

For Core-only carrying with no applicable Types property-access policy,
`properties` replaces the complete properties object literally, subject to native
invariants and ordinary admission. The provider MUST NOT turn it into an undocumented
partial merge. Absence of Types does not authorize corruption of native data.

Under Types, the selected [PR283 §3.6 authority](https://github.com/gastownhall/bdp/blob/a2aa88d9b5a0e0d78f48de2967d4ceaa38177876/specs/profiles/types/types.md#36-targeted-changes-and-replacement-have-different-responsibilities)
applies: replacement supplies the caller-writable set. Preserve existing init-only
values, enforce local/inherited restrictions and protected child paths, and refuse
explicit service-managed inputs even when equal to stored values. The service
completes its own fields before complete-result validation. Omission of a required
service-managed output field is not a malformed caller replacement merely because
that field is required in the stored properties schema.

The common request schema proves only that the carrier is a JSON object. Admission
MUST enforce caller-input policy; the completed properties object MUST satisfy every
applicable complete-result contract. A provider MUST NOT blindly require the caller
to supply all fields required by the stored-result schema or silently ignore a
prohibited supplied field. No public derived-input-schema endpoint or Type-definition
schema rewrite is introduced here; equivalent validation algorithms are permitted.

When retyping introduces init-only policy, preserve and validate an existing value;
an incompatible value refuses, and an absent value may be initialized. Leaving the
last applicable init-only contract preserves the value during departure; later writes
follow the destination contract. No hidden lifetime immutability or conversion is
added. These are the selected Types rules, not a new common policy vocabulary.
Metadata has no Types properties schema; replacing it replaces its entire common
object, not properties or revision provenance.

## JSON Patch retains its meaning

`propertiesChange` and `metadataChange` retain ordered `add`, `replace` and `remove`
with RFC6901 paths and RFC6902 object/array semantics. A root `replace` in a patch
remains a literal replacement attempt, subject to applicable input/path policy.
It is **not** reinterpreted as the distinct caller-writable-set replacement above.
Protected child restrictions cannot be bypassed through a parent/root patch.
`remove` and `replace` still require their targets to exist. `move`, `copy` and
`test` are not added. Array edit operations remain admitted where otherwise valid;
Types' whole-array policy designation is not a ban on patching arrays.

A CLI shallow merge or keyed set can lower to ordinary `add` operations. An
idempotent top-level unset can lower to `add null; remove` only when ordinary
property-access admission examines the entire submitted edit, including prohibited
attempts even if final state is unchanged. Final validation occurs after the complete
patch, not each temporary value. The composition MUST NOT bypass policy; if an
adapter cannot preserve it, it refuses rather than using a client read or relaxing
strict `remove`. Ordinary JSON Patch itself gains no idempotent-remove operation.

## Atomic outcome, guards and retries

All supplied members form one atomic update. Existing authorization, liveness,
optional `expectedRevision`, exact Type/default resolution, property admission,
limits, final graph checks and complete-result validation remain applicable. The
existing allowed final-graph batch repairs do not excuse input/path/guard checks.
Failure leaves no partial object, affiliation or induced-owner effects.

The primary [revision/no-op rule](write.md#mutation-revisions-and-guards) compares
complete affiliation, completed properties/metadata and applicable captured owned
state. Equal full state is a genuine no-op after checks; replacement alone is not
a force-version operation. A different Type pin is an effect despite empty patches.
The existing native result, original recorded source pair and provenance rules apply;
this input slice adds no `changed` or new result carrier. Required committed Event
facts remain required; their selected representation is still the separate D1/D2 gap.

Execution identity MUST distinguish replacement, ordered patch and omission in each
object plane. Even if two attempts happen to produce the same postimage, distinct
replacement/patch intent is not erased by comparing final state. Retained replay
uses the original frozen inputs, contract/capability/Scope/key and resolution witness;
it does not reread local files, resolve a new Type default or synthesize a new patch.
Existing complete-request semantic normalization still applies, including existing
JSON value equality; this does not select a new general canonicalizer or cross-carrier
key-equality rule. Rendering a replacement as an apparently equivalent root patch
would lose its policy meaning and is forbidden.
