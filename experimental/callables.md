# Callable Beads

> **NON-NORMATIVE EXPERIMENTAL DRAFT. NOT THE PLAN OF RECORD. NOT A RELEASED CAPABILITY OR AN IMPLEMENTATION CLAIM.**
>
> Donna requested this starting specification under Experimental. It records her selected direction and makes remaining author proposals explicit. It does not amend retained Core, Write, Types, existing Query/atomic-batch grammars, discovery, or installed products. [BDP #59](https://github.com/gastownhall/bdp/issues/59) remains the shared plan; [specs/](../specs/README.md) remains the selected protocol front door.

## 1. Scope and status

A **Callable** is a Bead describing a named, parameterized operation that a supporting service can invoke over BDP. It does not require a Pack. A Pack may compose/import Callables and register CLI placement; it does not define a second invocation engine.

The proposed UDT family is:

```text
Callable                 [Bead Type; proposed abstract base]
  ├─ CallableBatch       [Bead Type; refines Callable]
  └─ CallableQuery       [Bead Type; refines Callable]
```

These names are document-local draft labels, not assigned Type Bead identities or a new declaration language. Each Type definition is itself a Bead affiliated with BeadType. Actual refinement uses the existing [Refines](../specs/types/type-system/type-system.md#refines--link-type) contract with an exact captured parent definition; a `refines` descriptor property is not introduced.

| Status | Content |
| --- | --- |
| Donna's direction | Callable base and Batch/Query refinements; common help, declared parameters, declarative CLI projection; adopted AST or service-side Go extern implementations; independence from Packs. |
| Donna's transport decisions | Batch POST; named Query GET with an explicit query-string invocation mode and Query POST with JSON arguments; normal Bead GET retrieves the definition. `?call` was illustrative, not selected syntax. |
| First-pass author proposals | Abstract Callable; required description/parameter array; optional CLI mapping; `body` XOR `extern` in each concrete refinement; schema factoring and field spellings below. |
| Donna's parameter decision | Use JSON value schemas for declared parameter values. The draft uses `schema` for that field; spelling remains a first-pass author choice. |
| Still open | Parameter binding into executable bodies, full argument/result carriers, exact definition closure, extern implementation identity, capability/version selection, mode-selector grammar and mount registration. |

Package internal/external visibility and Memory/definition-relation normalization are deferred. Ordinary authorization, capability admission, Type interpretation, result semantics and mutation guarantees are not deferred by this experiment. Physical distribution, Go deployment and Pack definition schemas are outside this first callable draft.

## 2. Type definitions

The tables define the proposed descriptors; the [properties-schema projection](callables/callables.properties.schema.json) gives a machine-readable structural companion. It is not an installable Type graph or a complete callable interpreter. The effective `$defs` helpers conjoin schemas; they do not create Refines Links or enforce Type abstractness/registration.

### 2.1 Callable

**Own affiliation:** BeadType. **Direct refinement:** none in this proposed callable family. **Abstract:** proposed `true`; concrete Batch/Query refinements remain directly usable under ordinary Types rules.

Its `propertiesSchema` constrains a callable instance's properties:

| Property | Proposed shape | Meaning |
| --- | --- | --- |
| `description` | Required string | Standard operation help. This is help for this Callable instance, not the identity or invocation path. |
| `parameters` | Required array of Parameter declarations; may be empty | Declared named arguments. Names must be distinct within one callable. |
| `cliMapping` | Optional CliMapping object | Reusable mappings from flags/positionals to declared parameters; not a Pack/HTTP command path. |

The base properties schema is open so a refinement can add `body`, `extern` or later typed properties. The [existing composition rules](../specs/profiles/types/types.md#3-conformance-in-plain-language) apply ancestor and child constraints to the same unchanged properties object; closing the base over only its own names would prevent those additions.

The current [Type descriptor already has optional `description`](../specs/types/type-system/type-system.md#type--bead-type). That describes a Type definition itself. `Callable.description` describes an instance operation. No intrinsic Type/schema publication change is proposed or needed merely to add operation help.

### 2.2 Parameter — selected JSON value-schema contract

The user sketch used `parameters: [{ name: string, type: string }]`. Donna selected JSON value schemas for the parameter contract: existing BDP Type references describe Bead/Link Types, while invocation values may be scalar JSON, arrays, objects or References.

This first structural projection uses the selected value-schema direction with the following **author-proposed field spellings/default rules**:

| Field | Proposed shape | Meaning |
| --- | --- | --- |
| `name` | Nonempty string | Exact argument name. An ordinary parameter may share a spelling with a protocol control; carriers must keep them separate. |
| `schema` | Embedded Draft 2020-12 schema, object or boolean | Selected contract for the argument value. The field spelling `schema` is proposed for clarity. |
| `description` | Optional string | Parameter help, reused by CLI mappings. |
| `required` | Optional boolean | Proposed default false. Omission of an argument remains distinguishable from explicit null. |
| `default` | Optional JSON value | Proposed explicit callable default for an omitted argument; must satisfy its value schema. This is not automatic application of a JSON Schema `default` annotation. |

Proposed admission rejects duplicate declared names, unknown arguments, a required parameter with no supplied/default value, and incompatible supplied/default values. These are semantic checks in addition to the structural helper. Declaration and binding rules must settle required-plus-default behavior and exact Type/Reference resolution before implementation. An inline value schema alone does not establish Resource kind, nominal Type membership, authorization or exact Reference acquisition.

JSON value-schema validation does not equate shape with nominal BDP Type membership. If a parameter denotes a Resource Reference, its resolution, kind/Type requirements and exact edition semantics still need an explicit binding contract; a URI-shaped string alone establishes none of them.

### 2.3 CliMapping — proposed concrete starting shape

```json
{
  "flags": [
    { "names": ["--limit", "-l"], "parameter": "limit" }
  ],
  "positionals": [
    { "position": 0, "parameter": "text" }
  ]
}
```

This is declarative data. `flags` and `positionals` are distinct known record shapes; no mapping program, shell fragment, downloaded formatter or Pack-specific client shim is involved. Position numbering is proposed zero-based. Each mapping names an existing parameter. Duplicate/ambiguous flags and positional indexes refuse registration; supported CLI spelling, Boolean/collection input, aliases, requiredness and decoding need one shared CLI binding contract.

Help derives from `Callable.description` and Parameter descriptions. The Type/parameter contract is authoritative for validation/defaults; a mapping cannot change it. Operation identity and exact definition context are unchanged by CLI spelling. Pack placement separately chooses command routes/aliases and resolves collisions with other installed/core commands. The generic client must receive the effective declarative surface before ordinary argument parsing, with only Scope-specific metadata caching.

### 2.4 CallableBatch

**Own affiliation:** BeadType. **Direct refinement:** exact Callable definition. **Abstract:** false by default under ordinary Types rules.

Its local properties schema requires exactly one implementation:

| Property | Proposed shape | Meaning |
| --- | --- | --- |
| `body` | JSON representation of the explicitly selected Batch contract | AST/request implementation. It preserves the chosen engine's atomic owner, order, guards, publication, complete result and durable retry semantics. |
| `extern` | Proposed `{ "binding": nonempty-string }` | Declared service-side Go implementation lookup. Registry/deployment/implementation identity are separate from this structural binding name. |

For this first helper, literal `body` values reference the current common schema's [`batchRequest`](../specs/profiles/core/bdp-v0.1.schema.json), the retained six-CRUD optional atomic-batch version 1 carrier. This is a precise **literal-body baseline**, not adoption of richer read/set/query selection or parameterized Batch encodings. The existing [Batch source](../docs/cli-design/atomic-batch.md) explicitly requires an independently selected/versioned contract for stored parameterization.

### 2.5 CallableQuery

**Own affiliation:** BeadType. **Direct refinement:** exact Callable definition. **Abstract:** false by default.

Its local properties schema likewise requires `body` XOR `extern`:

| Property | Proposed shape | Meaning |
| --- | --- | --- |
| `body` | Selected JSON Query AST | Query implementation preserving actual List/Graph/Query subset, Resource edition, completeness/count and error meanings. |
| `extern` | Same proposed ExternBinding record | Service-side Go implementation of the declared read contract. It remains read-only through either GET or POST. |

The helper references the [existing Query AST schema](../docs/cli-design/query-ir/query.schema.json), SHA-256 `bf5fbf0b89f74273122c28b944907dd3e0fdb057d9266fdee4de9c0dfcbaeaa8`. It does not add parameter nodes or arbitrary scalar/computed-record results. Query result-contract declaration and the exact native wrapper remain adoption work; storing a Query cannot silently widen its evaluator or History capability.

### 2.6 Implementation and parameter binding gaps

Required behavior is clear: arguments are typed data, and AST/Go implementations use the same declared callable boundary. The binding representation is not yet selected. Predicate binders, Batch prior-creation handles, transaction captured sets and invocation parameters are different concepts.

Choose a versioned parameter-reference/body form or an explicitly typed materialization adapter before a parameterized AST implementation can be admitted. It must produce the existing chosen engine's admitted request without substituting strings into arbitrary JSON or reinterpreting old nodes/literals. The companion schema checks existing literal body grammars only. Its passing examples do not prove general parameterization, executable availability or full argument admission.

For Go externs, a binding name does not freeze implementation behavior. Availability, input/result compatibility, read-only versus update authority, exact implementation identity and historical/retry behavior require a service contract. This draft does not assume dynamic Go loading or client code installation. A missing implementation refuses under the selected capability/error contract; it is not a successful no-op or an unknown-Bead lookup.

## 3. Protocol revision outline

This section specifies the **scope of a future explicit callable extension**, not an amendment to current Core/Write methods or schemas. Concrete capability URI/version, mode grammar, JSON carrier and Problem-family changes remain unselected. Existing service URLs and supported callable Types must be discoverable; clients do not infer executable support from a stored Bead or a path prefix.

### 3.1 Resource identity and operational mounts

A callable is an ordinary Bead at its canonical URI. The service-owned `bdp/` namespace remains reserved from ordinary Bead allocation. A mount such as `<scope>/bdp/operations/recall` binds a protocol operation address to a selected callable/context; it does not create a second Resource identity. Standalone callables need no Pack. Mount creation/lifecycle, route collisions and binding retention still need design.

Existing BDP [aliases](../specs/profiles/core/core.md#alias-resolution) define GET/HEAD redirect resolution, not POST forwarding. Existing [operation URLs](../specs/profiles/write/retained-write.md#eight-ordinary-targets-one-scope-and-complete-outcomes) are discovered, not a universally mandated path suffix. Do not silently widen either contract to implement callable mounts.

### 3.2 Selected method behavior

| Target and method | Behavior |
| --- | --- |
| Canonical callable URI, ordinary GET/HEAD | Existing Bead definition read, with its ordinary authorization/media/conditional semantics. |
| Canonical CallableQuery URI, GET with explicit invocation mode | Invoke the stored Query; arguments use a defined URL carrier. No GET request body. |
| Canonical CallableQuery URI, POST | Invoke the same read-only operation with JSON arguments. |
| Canonical CallableBatch URI, POST | Invoke the update operation with JSON arguments and the applicable mutation/outcome contract. |
| Operational mount | Bind to the same selected callable/context. Exact mode-selector/description-read rules at the mount are still open. |

`?call` was an off-the-cuff example. **The distinction is selected; its spelling and bare-flag versus key/value grammar are deliberately open.** No Batch GET invocation is introduced. Unsupported callable methods, invocation HEAD, mode/control conflicts and non-callable invocation need a coherent advertised method/error table before adoption.

The existing inline-AST [Query POST](../specs/profiles/core/read-operations.md) carries an AST. Named Query invocation references a stored definition and carries arguments. Both remain read-only. This experimental extension neither replaces that inline transport nor invents GET-body semantics.

### 3.3 Argument and result carriers

Keep invocation controls, arguments, operation/definition selection and result-delivery controls separate. A parameter named like the eventual mode control must remain representable. JSON bodies can carry an argument object; a JSON-encoded argument-object URL member is one possible GET encoding, not selected syntax. Decide duplicate keys, exact JSON values, References, omitted/null/default values, limits and diagnostics under the shared admission rules.

Transport spelling must not change the declared argument environment or domain result. Query returns its selected resource/graph/count semantics; Batch preserves actual ordered per-operation/final-publication outcomes. Do not use definition ETags as if they validated results over mutable business data. Resource definition reads and invocation results need distinct response/media/validator semantics; their exact carrier is still open.

### 3.4 Definition closure and mutation recovery

An exact member/dependency closure is selected. Its **carrier and complete coverage are not**. Proposed next distinction: pin executable definition inputs while runtime data uses ordinary Query read-context or Batch transaction semantics. Neither a Callable Bead revision alone nor a Pack membership revision necessarily fixes every referenced Type/schema/body/extern dependency.

Before execution, define how to select and retain the operation revision, parameter/default contracts, exact Refines/schema closure, implementation version/binding, CLI/catalog witnesses and semantic dependency definitions. A stale mapping or replaced definition must not silently reinterpret previously parsed arguments. Static definition evidence must not invent historical business-data acquisition capability.

For mutations, preserve one atomic owner where the selected Batch contract promises it, one complete admitted request/outcome, original resolution witnesses, guards, and same-key replay/conflict semantics. A retained successful key must not reevaluate newer defaults, aliases, definitions or Go handlers. Large results do not justify a commit followed by a truncated/unknown success. Runtime data is not implicitly frozen with the definition; the service establishes its ordinary transaction context.

### 3.5 Discovery and authorization

Callable support needs its own explicit opt-in capability/version amendment. A definition's presence, a registered Type, an available implementation, a usable mount, and a CLI exposure are separate facts. Do not add arbitrary callable keys to the existing closed ordinary Write operation directory. Named-operation/catalog capability shape and the exact-Type/shape support advertisement need design before implementation claims.

Normal principal/Scope/data authorization applies. Package internal/external semantics are deferred this round; CLI registration is not an access grant. A stored Callable or cached help cannot manufacture supported AST shapes, an extern implementation, Type authority, History access or permission to mutate.

## 4. Acceptance cases to carry into adoption

These are authored expectations, not executed HTTP/provider conformance:

| Case | Required outcome or explicit remaining choice |
| --- | --- |
| Store/invoke a concrete callable without a Pack | No synthetic Pack requirement; apply explicit service capability and authorization. |
| Instantiate abstract Callable directly | Proposed refusal; abstractness is enforced by Types/service semantics, not the properties helper. |
| Refine CallableBatch/Query | Preserve common help/parameter/CLI constraints by conjunction; actual Refines declarations need exact parent identities. |
| Neither body nor extern, or both | Concrete structural projection rejects; implementation selection is unambiguous. |
| Existing body contains a parameter-looking literal string | Remains literal data; no implicit template expansion. |
| Duplicate parameter names, dangling CLI parameter, duplicate route/flag/position | Reject under explicit definition/registration semantics; JSON shape validation alone does not prove these relations. |
| Omitted/null/default/wrong-Type argument | Apply the agreed declaration and exact value/Reference contract; do not silently coerce or invent null/default semantics. |
| Query GET versus POST | Same read-only invocation and actual result/error meanings; carriers differ. |
| Plain Query Bead GET versus invocation mode | Definition and result remain distinct; illustrative `?call` is not a frozen control name. |
| Go extern unavailable or replaced | Explicit availability/compatibility/closure disposition; no inferred successful execution. |
| Changed definition/mapping during CLI use or mutation retry | Select/refuse using agreed exact evidence; preserve retained same-key outcome, never rebind implicitly. |
| Pinned data edition unsupported | Preserve real capability refusal; definition closure does not imply History support. |

## 5. Source and validation boundaries

This draft starts from main `37d30c7bd6fd6fe39925bb43cd241e77c6d6d8f4`. The current Type descriptor already supplies description, propertiesSchema, schemaResources, abstractness and Refines semantics. The companion retains normal open-base refinement behavior and does not modify intrinsic publications.

The property-schema document uses an illustrative schema-document `$id`, not a Type Bead identity. Its external Batch/Query schema references must be bound to retained exact source bytes in any definition publication. The [examples](callables/examples.json) exercise structural projections, including literal Query body and Go binding forms. They are not live Resources, Type registrations, executable invocations or parameter-binding evidence.

The helper intentionally does not prove embedded value-schema validity, duplicate-name relations, CLI mapping referential integrity, effective UDT closure, abstractness, method/discovery behavior, authorization, provider constraints or runtime results. Those need the stated admission and conformance work. No retained schema, profile, intrinsic graph, product source, build, installation or runtime is changed here.

The bounded [example checker](callables/check_examples.py) independently checks the companion/schema meta-shapes, these authored examples and mutations, and the embedded example value schemas/defaults. It forbids network schema retrieval. Run from the repository root with an existing/cached Draft 2020-12 validator:

```sh
uv run --offline --no-project --with 'jsonschema[format]' python experimental/callables/check_examples.py
```

These finite artifact checks do not resolve the semantic/adoption gaps above and do not run a service, CLI, store, build or HTTP/provider tests.
