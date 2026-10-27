# Prior bindings as transaction selection inputs

**Authoring reconciliation, October 27, 2026.** Donna selected the behavior below
in the Batch review. The CLI spelling, `refs.references` union and selector schema
are author proposals for that behavior. They do not select the ultimate query IR,
adopt a Batch wire version, change held production schemas/pins or qualify a
provider. The ongoing WOQL comparison remains a separate design decision.

This note reconciles the [logical read contract](../../../specs/profiles/core/query.md)
and [CLI candidate](../query-language.md) with the Batch owner's composition work.
The Batch owner retains the member grammar, version/capability advertisements,
outcomes, revisions, replay and concurrency contract. This note defines only the
selection-input correspondence and a bounded static check.

## Selected behavior

- Batch executes as one serializable logical decision. List and Query selection
  observe earlier staged writes. A captured typed set fixes membership once.
- A later List may use a previously captured typed set as candidates and apply
  only its ordinary candidate-local conditions. It reads those identities' content
  at that later staged point; it does not rerun the earlier selection predicate.
- A Query may use a prior scalar identity or typed set as explicit inputs. A walk
  requires Bead roots. Link sets can be selected/filtered as Links and navigated
  through their endpoints; they are not themselves Bead roots.
- Scalar Reference arguments are allowed in ordinary resource operands, Link
  endpoints and explicit read roots. Argument values resolve during assembly;
  native execution retains only earlier internal structural binding references.
- Transaction-scoped List and Query support are advertised independently.
  Standalone read support does not imply either transaction capability.
- The first transaction slice reads only the current staged graph: no historical
  acquisition, unpublished-revision tests or cross-Scope acquisition/mutation.
  Opaque external stored Link endpoints remain permitted under ordinary Type
  rules. Reading their bodies or expanding there is a different operation and
  refuses when required by this slice.
- Read-only batches are allowed. Selection does not require a mutation member.

The earlier scan-only standalone List profile did not already implement the second
bullet. This note adds a context-specific candidate source, not a traversal
exception to List and not a new standalone multi-GET API.

## Proposed encoding: extend the existing explicit-reference source

Keep the existing collection discriminator and the shared structural Batch
operand shape:

```json
{
  "op": "refs",
  "collection": "beads",
  "references": { "binding": "draft-notes" }
}
```

The ordinary alternative remains `references:[NATIVE_REFERENCE,...]` with its
existing shared string/pinned-object Reference grammar. The new object means
“take the identities in this earlier typed binding”; it is not a native Resource
Reference, JSON Pointer, arbitrary expression or string interpolation. The asserted
`collection` checks the binding's known Bead/Link kind, including an empty set.
The Batch grammar owns valid names and declaration order. It must reject unknown,
forward and wrong-kind references. The query's lexical `{"op":"binding",...}`
node remains separate: it names one Resource in a predicate, not a Batch variable.

This object is admitted only under a transaction selector. A standalone List or
Query rejects it, even though the shared review schema can describe the shape.
Thus no process-global name lookup, hidden service session or standalone binding
capability is introduced.

For **List**, the source is a current `scan` or this prior **set** source, optionally
wrapped by one ordinary candidate-local `filter`. No arbitrary nested Query result
or literal explicit-ID array becomes a List source in this first proposal. A
scalar creation binding is accepted for Query but is not silently promoted to a
List candidate set here; broadening that convenience remains reviewable.

For **Query**, the source may be a prior scalar or set of the asserted Resource
kind. Explicit Bead inputs can seed `walk`; Link input cannot. Query's existing
lexical binding and resource-kind checks continue to apply.

An external scalar argument in the same explicit-root position becomes an
ordinary singleton Reference array before the native request is frozen. No
unresolved external parameter reaches execution. This proposal admits one Batch
binding as the whole `references` source; it does not add array-splicing or a
mixture of several captured sets and literal roots.

## Proposed CLI correspondence

Use one candidate-source option rather than overload Link List's existing
incidence positions. These are complete authored member-emission invocations,
not implemented CLI examples. The Batch owner's emission/version proposal still
applies.

```sh
# Emit a List filtering captured Beads by their current staged status.
bd list --candidates batch-ref::draft-notes --property 'status = "ready"' \
  --batch-bind ready-notes --dry-run-mode batch

# Emit a List filtering captured Links by a candidate-local property.
bd link list --candidates batch-ref::ready-links --has-property body \
  --batch-bind described-links --dry-run-mode batch

# Emit a traversal using the captured Bead set as explicit roots.
bd query 'outgoing(beads("batch-ref::draft-notes"), depth: 2) as edge through edge is references' \
  --batch-bind reachable-links --dry-run-mode batch

# Emit a traversal using an earlier generated identity as its root.
bd query 'outgoing("batch-ref::created-note")' \
  --batch-bind created-note-links --dry-run-mode batch

```

`--candidates` is single-use and exclusive with positional/incidence candidate
selection and `--request-file`. It takes exactly one `batch-ref::NAME` and requires
member emission. Selection flags still AND together in their ordinary way. Without
`--candidates`, List uses staged inventory. A standalone invocation cannot use this
flag or a Batch reference; it does not silently interpret the name as a URI.

Within an emitted Query, `beads("batch-ref::NAME")`,
`links("batch-ref::NAME")` and the quoted-root shorthand recognize the reserved
Reference only in an explicit-reference position. The binding must be the sole
Reference in that call in this first proposal. An outer query alias can have the
same spelling without ambiguity: its scope is lexical and its AST node differs.
Outside those designated positions, strings remain literal data. For example,
`b.title = "batch-ref::draft-notes"` tests exactly that title.

## Complete selector examples

The selector envelope has `ir`, `profile` and `selection`. It is not an ordinary
read request: no result form, count, body delivery, masks, sort or paging. The
Batch owner supplies the member's capture name and result contract.

A later List checks the currently staged status of the originally captured notes:

```json
{
  "ir": "bdp-query-design-1",
  "profile": "list",
  "selection": {
    "op": "filter",
    "input": {
      "op": "refs",
      "collection": "beads",
      "references": { "binding": "draft-notes" }
    },
    "bind": "note",
    "predicate": {
      "op": "compare",
      "operator": "eq",
      "left": {
        "op": "field",
        "of": { "op": "binding", "name": "note" },
        "path": ["properties", "status"]
      },
      "right": { "op": "literal", "value": "ready" }
    }
  }
}
```

If an intervening update changed B from draft to ready, this can select B from
the earlier `{A,B}` capture. It does not alter that earlier membership or select
another newly ready Bead C outside it.

A Query uses a typed Bead set as traversal roots:

```json
{
  "ir": "bdp-query-design-1",
  "profile": "query",
  "selection": {
    "op": "walk",
    "roots": {
      "op": "refs",
      "collection": "beads",
      "references": { "binding": "draft-notes" }
    },
    "direction": "outgoing",
    "depth": 2,
    "bind": "edge",
    "through": {
      "op": "typeIs",
      "of": { "op": "binding", "name": "edge" },
      "type": "https://work.example/acme/references",
      "match": "family"
    }
  }
}
```

The new selection captures its distinct current staged Link identities. It does
not bind the root set, its old predicate or an invented set revision. Ordinary
Link liveness and endpoint integrity still apply to later operations.

## First-slice admission and execution boundaries

The selected current-staged/no-history boundary needs concrete admission rules.
This author proposal rejects explicit pinned read inputs, `rev()`, raw top-level
revision/provenance reads and resource-edition equality throughout a transaction
selector. Those conservative syntactic restrictions also reject some comparisons
that could concern unchanged committed content; they are not a new human ruling.
Use `id()` for identity tests. A property literally named `revision` remains
ordinary application data and is not scanned for tokens.

Ordinary stored source/target References, including opaque pins or external URIs,
remain data. Selecting a Link does not by itself acquire those endpoints. Explicit
endpoint navigation and deeper expansion require authorized current in-Scope
content. The provider must refuse required historical or foreign acquisition;
it cannot silently follow an identity's current adjacency instead of a stored
pin. Type affiliation uses its established authority rules, not a new string-only
fallback or an automatic demand to fetch arbitrary cross-Scope Type bodies.

A later selection uses then-current staged content for each captured identity.
Membership is fixed; bodies are not frozen by the capture. This proposal refuses
a required captured member that has since been deleted or become unavailable,
rather than silently dropping it. The Batch owner settles detailed liveness,
error reporting and consistency rules. A known-kind empty source remains empty.

The first slice admits no general Graph result/capture, count result or pagination.
A Query collection can select Links or endpoint Beads explicitly. Its traversal
shape does not imply a mixed graph can be used as a mutation operand.

## Authored acceptance artifacts

- [Selector schema](batch-selection.schema.json) reuses the shared review AST.
- [Cases](batch-selection-cases.json): 30 static admission cases, plus six separate
  unexecuted runtime obligations for fixed membership/fresh content, deletion,
  opaque external endpoints, staged identity, read-only execution and independent
  transaction capabilities.
- [Checker](validate-batch-selection.py) validates schema, source kind/cardinality,
  local-only List admission, explicit-root kinds and conservative first-slice
  restrictions. Its temporary normalization reuses the standalone static checker;
  it never evaluates a capture or executes a selection.
- [Receipt](BATCH-SELECTION-VALIDATION.json) records static checks and source hashes.

Run `uv run --no-project --with 'jsonschema[format-nongpl]==4.23.0' python
docs/cli-design/query-ir/validate-batch-selection.py` from the draft repository.
Passing this does not demonstrate parser behavior, staged visibility, isolation,
Type enforcement, provider execution, publication or recovery. Those are explicit
runtime obligations, not authored expected results presented as executed tests.
