# Beads Protocol

This glossary defines BDP-specific terms used across the repository.

## Language

**Protocol identifier**:
A URI assigned by BDP to identify protocol vocabulary independently of where
the corresponding source artifact is hosted. Dereferenceability is not part of
its identity.
_Avoid_: download URL

**Schema bundle**:
A machine-readable distribution for an identified BDP specification baseline.
The current Core definitions are authored beside their rules as visible Markdown
schema fragments and distributed in the common v0.1 bundle. The retained v0
bundles are historical evidence inputs, not current specification authority.
_Avoid_: treating an old bundle or an unused helper as a current requirement

**Reference / Pinned Reference**:
How anything in BDP points at anything: a URI — or a Pinned Reference,
`{ uri, revision }`, the URI plus the revision it was made against. Either
reference class may be pinned; the URI alone is identity.
_Avoid_: external Type, remote Bead Type

**Callable / CallableQuery / CallableBatch**:
A Callable is a Bead describing one named operation: help, parameters, result
schema and the implementation it binds to. A CallableQuery is read-only; a
CallableBatch mutates.
_Avoid_: procedure, command (a command is a client spelling)

**Callable directory**:
The object at the URL a Scope advertises in its Callables capability, mapping
each invocable name to its pinned definition and its mount. Only a directory
entry makes a name invocable.
_Avoid_: catalog, registry

**Mount**:
The URL a directory entry names for invoking one Callable.
_Avoid_: route

**Extern binding**:
An opaque name in the provider's own registry that says which implementation a
definition runs.
_Avoid_: plugin

**View**:
A callable result built over complete Bead or Link records with added
observations. It is not a Resource and carries no revision of its own.
_Avoid_: projection, which Core uses for Resource projection
