# Canonical CLI: ordinary object edits

Closed C1 edit-mode subset paired with [ordinary Write object edits](../../specs/profiles/write/object-edits.md),
following [Scope/defaults](scope-and-references.md), [Type affiliations](affiliations-and-owned-state.md)
and [contract binding](contract-binding.md). This is paper source, not an implemented
parser. `bdp` follows the requested `bd <verb>` / `bd link <verb>` hierarchy.
Existing #279/#59 remain the pipeline; no new domain or Type lifecycle commands.

## Author each object independently

| Intent | Properties option | Metadata option |
| --- | --- | --- |
| Initialize create; shallow merge update | `--properties JSON` | `--metadata JSON` |
| Replace writable set; replace metadata | `--replace-properties JSON` | `--replace-metadata JSON` |
| Ordered strict JSON Patch | `--patch-properties JSON` | `--patch-metadata JSON` |
| Set literal top-level key, repeatable | `--set-property KEY=VALUE` | `--set-metadata KEY=VALUE` |
| Idempotently remove top-level key, repeatable | `--unset-property KEY` | `--unset-metadata KEY` |

Create admits initialization only for each object. On update, merge/replacement/patch/
keyed mode are mutually exclusive **per object**; keyed mode can combine set+unset.
Properties and metadata choose modes independently and may accompany `--type` in the
same atomic update. An omitted object remains untouched under the provider rules.
Empty merge contributes no patch operations, empty ordinary patch is admitted, and
empty replacement is still replacement subject to policy. A guard or provenance
alone is not an update. Mutation subjects remain unpinned; `--if-revision` is the
ordinary optional Resource guard, not the Type definition pin.

Object/patch/provenance inputs use inline JSON, `@FILE` or `@-`; read/freeze UTF-8
inputs before dispatch and permit only one stdin consumer. Reject duplicate members,
invalid Unicode and inadmissible exact numeric literals; never round an invalid
number. Direct JSON input is literal JSON, not file/string interpolation. These
rules do not turn an input object into a whole raw protocol-request escape.

## Deterministic lowering

Create initialization uses the existing `properties`/`metadata` members. Update
replacement uses the **distinct** `properties`/`metadata` members, never an RFC6902
root patch. Shallow merge emits `add` for each supplied top-level value; nested objects
are values, not recursive merges. Merge keys emit in ascending code-unit order.
Strict patch emits its complete ordered array.
A keyed set emits `add` at the escaped top-level key. Keys are literal strings:
escape `~` as `~0` and `/` as `~1` when constructing an RFC6901 path.

Split `KEY=VALUE` at its first `=`. `null`, `true`, `false` and admitted JSON numeric
literals have those values; other text is a string. A syntactically numeric but
inadmissible JSON number refuses instead of becoming text. Use object/patch JSON
for exact numeric-looking strings, arrays or objects. Last repeated set wins;
distinct set keys keep first-occurrence order. Unsets are deduplicated in first-
occurrence order and applied after sets regardless of flag order. This ordering
makes emission deterministic without changing ordered raw patch semantics.

An absent writable unset succeeds. Its composed patch may be `add null; remove`
for that top-level key only when the authority checks policy over the whole
submitted edit and validates the final result. It cannot bypass protected-path
rules; unsupported faithful lowering refuses. No client GET/modify/write emulation
or weakening of an explicit strict patch is allowed.

```sh
bdp update task-42 --replace-properties '{"title":"Reviewed"}'   --set-metadata reviewed=true --if-revision resource-r7
```

```json
{
  "bead":"task-42",
  "properties":{"title":"Reviewed"},
  "metadataChange":[{"op":"add","path":"/reviewed","value":true}],
  "expectedRevision":"resource-r7"
}
```

The singleton operation URL supplies `updateBead`; a member record includes that
discriminator with the same fields. Link update substitutes `link`/`updateLink`.
The [paper pairs](../../fixtures/object-edits/candidate.json) cover merge, replacement,
strict patch, keyed set/unset, literal key escaping and independent object planes.
They check request shapes without claiming a parser/round-trip execution.

## Preserve policy and intent

For Types, replacement supplies the caller-writable set: existing init-only values
survive, prohibited service-managed input refuses even when equal, and parent/root
paths cannot evade child policy. The service completes fields before final validation.
Retyping follows the accepted initialization/departure policy; it does not force a
client full-body overwrite or invent lifetime immutability. A Core-only provider
uses literal replacement subject to its native invariants. Metadata and provenance
remain separate. See the protocol source for the conditional input/result boundary.

Omitting Type preserves its exact affiliation. Explicit unpinned/default resolution
and exact pins keep their existing meanings. Empty patch plus changed Type is an
effect; equal completed state is a genuine no-op after guards/policy checks. Emission
never fetches a definition, allocates IDs/keys, claims successful validation or mutates.
Retained retry uses the original complete input/intent; a renderer cannot replace a
replacement with a root patch, silently drop an empty authored member, or turn
omission into a freshly read object. Ordinary signatures render every admitted
ordinary update field using explicit replacement/patch/Type/guard/provenance options.

> **Cleo — Object edit vocabulary:** Keep singular `--set-property`/`--unset-property`
> and the unified merge/replace/patch/set/unset model for both planes. This records
> the shared design, without asking you to interrupt your current work. Direct
> replacement fields preserve the intent that a generic root patch cannot carry.

Optional batch/result/recovery transport is separate source work; these shared
ordinary fields add no non-atomic sequence, set-write operation or public receipt.
The [accepted D1/D2 Event minimum](event-decisions-20261022.md) has a paired
[source](events.md), and [final batch publication](../../specs/profiles/core/publication.md)
is selected. Types/source integration and qualification remain explicit gates.
