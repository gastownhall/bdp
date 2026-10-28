# Canonical CLI: selected contract and truthful output

Paired candidate for the [v0.1 protocol binding](../../specs/profiles/core/contract-binding.md), following the [Scope/reference design](scope-and-references.md). The command hierarchy, default Scope, Resource IDs and revision flags remain the C1 design. This step binds their wire meaning; it does not implement or adopt the complete CLI.

## Ordinary commands select their implemented contract

```sh
bdp show task-42
bdp update task-42 --if-revision saved-r1 --set-property status=closed
```

The user need not repeat a protocol-version flag. The client verifies discovery, chooses a contract it actually implements and binds the request/response to it. For the proposed v0.1 client, discovery `bdpVersion:"0.1"` maps to `https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json` and `application/vnd.bdp.v0.1+json`. An old-only client or service is not silently upgraded by similar JSON or by the presence of a new schema file.

The CLI sends the selected JSON media in Accept and, for writes, Content-Type. Unsupported/contradictory binding produces local `unsupported_contract` or the received BDP/HTTP refusal before mutation. The CLI never retries415/406 using generic JSON, a different contract or a fresh key. Type/History/optional-operation capability checks still apply independently; knowing the protocol version is not permission to execute every operation.

## One output identity

```json
{
  "schema_version": 2,
  "bdp_spec": "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json",
  "result_kind": "resource_collection",
  "outcome": "success",
  "data": {"items": [], "next": null},
  "completion": {"returned": 0, "exhausted": true, "stop_reason": "exhausted"}
}
```

This candidate empty-collection envelope illustrates the binding, not a current runtime result. `schema_version:2` versions Cleo's CLI framing; `bdp_spec` identifies the actual selected BDP contract independently. Do not emit the new identity merely because the executable's output renderer implements schema 2 or a candidate file exists. A CLI-derived result identifies its own result kind while retaining the selected BDP identity governing its native values. A raw/emit artifact omits that framing and makes no self-contained contract claim.

JSONL headers use the same actual selected identity. Native Resource/property/result JSON is unchanged by the framing. HEAD/304 expose their selected context without fabricated body data. Existing current-v0 client/server behavior remains bound to its actual contract; this paper grants it no v0.1 label.

## Capabilities, emission and retries

Unknown capability entries can be ignored while using the selected base contract. A capability the command requires must be explicitly supported at its required version; the CLI does not silently narrow a Type-family predicate, drop an endpoint pin, split an atomic batch or omit an unfamiliar effect. Feature-owned details are interpreted only by that feature's implementation. Required Event meaning cannot change merely because a server advertises an extra feature.

The selected feature's lowering must fail safely on an implementation lacking it. A critical version cannot live only in an HTTP field or parameter that an older endpoint ignores; ordinary property strings cannot silently become feature instructions. Explicit selection and refusal belong to the feature's operation/subscription binding, beyond its passive discovery entry.

The semantic operation includes its selected contract as invocation context. Ordinary
singleton emission writes its canonical body without invented version fields. The
[optional atomic batch](atomic-batch.md) explicitly declares its required
`capabilityVersion` discriminator in the existing operations wrapper; it is part
of that selected feature's request grammar, not an extra field inserted into a
closed singleton or old-contract schema. Such a body alone still does not identify
its global BDP contract or a retry. Execution validates it against the actually selected context; the canonical compile/render equations compare that context as well as body fields.

The ordinary mutation journal freezes the selected identity/media/Scope and capability versions, original operands, files/stdin values and key before first transmission. Retry-file mode loads that frozen invocation; it never changes meaning to match a newly advertised contract or rereads changed inputs. A contract mismatch is a refusal, not evidence that the original write failed. Bodyless errors and interrupted output retain their truthful outcome rules.

## Completion boundary

The eventual HTTP-to-executable adapter must verify the registered executable's selected contract and required capabilities **before** effectful dispatch. Checking `bdp_spec` only after execution is too late to prevent wrong-contract effects. Input/output binding must agree; post-execution mismatch cannot be reported as if nothing ran. This is a semantic translation requirement, not a hosting/registration design or permission to start `serve` work.

The separately named v0.1 schema and JSON export are source artifacts. Existing v0 parsers, exported runtime constants, providers and fixtures remain held and unchanged. Their tests/results do not qualify the candidate. The [current source map](../design/bdp-v0.1-current-source-map.md) records the assembled Types/common-source contract; implementation and concrete consumer qualification remain separate. [final batch publication](../../specs/profiles/core/publication.md) is selected. [D1/D2 are answered](event-decisions-20261022.md); the paired [Event source](events.md) supplies the selected finite-JSON observation contract. No extra service endpoint, user-facing request family, hosting design or runtime migration follows from this binding slice.
