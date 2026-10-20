# Isolated JSONPath extension experiment

This is an executable design mechanism check, not a BDP implementation or
conformance suite. It pins `github.com/theory/jsonpath v0.12.2` in its own Go
module; it changes no BDP/Beads product dependency or installed backend.

Run from this directory with Go 1.26 or later:

```sh
GOWORK=off go test -json -count=1 -timeout=30s .
```

Executed on October 20, 2026: all six top-level tests and nine predicate/binding
subtests passed. Tests cover standard missing/null/presence, kind-sensitive
ordering, explicit JSON binding records/captures, a pure literal-substring
extension, a true graph-existence function receiving a literal nested selector,
and admission failures. The nested selector must return actual binding records;
selecting the root/captures or projecting away the record is rejected.

The graph input is a complete, coherent prepared in-memory adjacency fixture.
Exact edition labels are synthetic test keys. No graph provider, traversal engine,
CLI compiler, request/result serialization, global work accounting, numeric/Unicode
qualification, cancellation, or installed behavior was exercised. The demo graph
callback returns false on malformed input and missing adjacency: complete and
well-formed input is an explicit precondition, and this is **not** an implementation
of the proposed host failure contract. Its mutable compile registry is single-use
for the experiment, not a qualified concurrent request cache.

The initial private setup attempt failed because a research-source `.go` file
had a different package; it was moved outside the module's source file set. A
subsequent independent review found an inconsistent repeated-edition fixture and
an overly broad nested-selector result domain. Both were corrected; the final
recorded source passed. Earlier experiment attempts are retained separately and
are not profile qualification.

See the [BDP Query exercise](../../specs/profiles/query/query.md) for proposal
status and the remaining contract decisions.
