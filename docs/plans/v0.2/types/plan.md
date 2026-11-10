# Plan: Types Infra

Area `types/` — owner Trish. The Types work as the full arc, per Donna's shape
(2026-11-09): the specs (BDP Types, Go design, CLI design — co-designed), the conformance
tests for each surface, and the implementation stages.

**Composition vs. dependencies.** The nesting below is composition — a parent's state is
`all(children)`. The real build order is the `after(...)` edges, which are node-to-node and
cross the tree; they are **not** the parent/child structure. The spec branches (`bdp`, `go`,
`cli`) are co-designed concurrently — the only hard edge among them is the shared TypeDef
format they design against. The edges here are Trish's proposal for Donna's review; this is
the basic shape and will grow.

**Cross-area anchors — re-pointed 2026-11-09 (Eva, mechanical; edges still Trish's to confirm).**
The `graph` area is now **core**, in this same mould. The DSL nodes are gone, so
`graph/dsls/type-def` no longer exists and `typedef-format` stands on its own here;
`data-model` is now `core/spec/bdp/data-model`. Only the paths changed. **Trish's calls
(2026-11-09):** (1) `typedef-format` also waits on `core/spec/bdp/json-schema` — the descriptor's
`propertiesSchema` *is* JSON Schema, so the format cannot finalize before that projection is
pinned; (2) the top node is renamed `plan:` for parity with the other areas. Edges remain open
to Donna's cross-dependency pass.

## Plan

```
plan: all {

  // Specs — the concert, co-designed (concurrent)
  spec: all {

    /// title: BDP Types spec
    bdp: all {
      /// title: TypeDef format — how a type descriptor is written
      typedef-format: after(core/spec/bdp/data-model, core/spec/bdp/json-schema)
      /// title: Link constraints — type constraints on links
      link-constraints: after(typedef-format, core/spec/bdp/data-model)
      /// title: UDTs and intrinsics for beads — user-defined types, types as beads
      udts-intrinsics: after(typedef-format, core/spec/bdp/data-model)
      /// title: Type-check rules — what enforcement checks
      type-check-rules: after(typedef-format, link-constraints, udts-intrinsics)
    }

    /// title: Go design
    go: all {
      /// title: Go design doc — the Go API surface for types (concurrent with the BDP spec)
      design-doc: after(spec/bdp/typedef-format)
    }

    /// title: CLI design
    cli: all {
      /// title: Canonical CLI — the type commands (concurrent with the Go design)
      canonical-cli: after(spec/bdp/typedef-format)
      /// title: Merge rules with the `bd` CLI
      bd-merge-rules: after(spec/cli/canonical-cli)
    }
  }

  // Conformance tests — one suite per surface
  conformance: all {
    /// title: BDP (protocol) conformance
    bdp: after(spec/bdp/type-check-rules)
    /// title: Go implementation conformance
    go: after(spec/go/design-doc, conformance/bdp)
    /// title: CLI conformance
    cli: after(spec/cli/canonical-cli, conformance/bdp)
  }

  // Implementation stages — grow as the spec subnodes firm
  impl: all {
    /// title: Go skeletons for the intrinsics
    go-skeletons: after(spec/go/design-doc, spec/bdp/udts-intrinsics)
    /// title: bd serve wiring
    bd-serve-wiring: after(impl/go-skeletons, conformance/go)
    /// title: CLI wiring
    cli-wiring: after(spec/cli/canonical-cli, impl/go-skeletons, conformance/cli)
  }
}
```

## Open — this is the basic shape (Donna: "probably more")

- Candidate additions: a type **catalog / registry** node (fold under `udts-intrinsics` or add
  to `bdp`); more `impl` stages as the spec subnodes split.
- The `after(...)` edges are Trish's proposal — Donna/Eva confirm the build order.
- Supersedes the first `types/` cut (type-desc / refines / enforcement / catalog), which folds
  into `spec/bdp`.
