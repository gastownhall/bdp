# Human-readable schema and operation tables

New paired BDP sections use the table conventions developed in the Memory
experiment: [Markdown JSON Schema v0.5](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/specs/formats/markdown-json-schema.md)
and [Markdown OpenAPI v0.4](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/specs/formats/markdown-openapi.md).
That pin records the notation's source, not adoption of the experiment's older
BDP operation semantics or a new dependency on a converter.

## JSON shapes

Field tables use the original five columns, plain-text cells and explicit
requiredness. State whether other fields are allowed for the described object.
Named object and allowed-value tables can make shared shapes readable. A table
must identify whether it is a full object, an additional constraint, or a partial
review view; a partial list must never imply that omitted required fields vanish.

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| idRoot | text | yes | RootedCreate | Canonical Scope-relative prefix for service allocation. |

BDP References, external schema identities, inclusive/exclusive unions,
composition, conditional admission and canonical path constraints retain their
actual definitions. State rules beyond the table explicitly and link the
canonical JSON Schema. Do not simplify them merely to fit the experiment's
restricted conversion subset. In particular, JSON Schema OR is inclusive,
while mutually exclusive authored fields need a separate stated constraint.

## HTTP operations

Use the sister format's Schemas, Parameters, Request body, Responses and
Response headers tables. Name existing external schema documents rather than
copying and relocating their definitions. Required headers and bodyless status
branches must remain visible; conditions belong beside their tables.

For BDP, describe a discovered target as a discovered operation or Resource URL.
The original DSL's literal deployment-path heading cannot stand in for that
navigation contract. A synthetic tooling path stays labeled synthetic. Group
revision/view/projection forms beneath their one semantic command; HEAD and
paging add transport cases, not public commands.

## Authority and conversion

These are human-readable BDP authoring conventions drawn from the experimental
DSLs. A document using the tables is not automatically a strict DSL instance or
a lossless projection of all JSON Schema/OpenAPI features. The experiment omits
constructs used by BDP, including general composition/conditional schemas and
reusable Path Items. Canonical schema files keep structural authority; paired
protocol prose defines decisions, authorization, allocation, defaults and retry.
OpenAPI and the command map remain informative projections.

No automatic translator, DSL revision or whole-spec migration is introduced by
this editorial step. The new [rooted-allocation section](../../specs/profiles/write/id-root.md)
is the first concrete use in this follow-up; existing sections can adopt the
same presentation during deliberate editorial passes.
