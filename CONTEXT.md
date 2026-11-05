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
A Callable is a Bead declaring one named operation: help, parameters and the
schemas of its result and errors. Its name is its local Resource ID. A
CallableQuery is read-only; a CallableBatch mutates.
_Avoid_: procedure, command (a command is a client spelling)

**Declaration / definition**:
A declaration says how to call an operation and nothing about how it works; a
definition is a declaration with a readable body. Preview-1 has declarations only.
_Avoid_: extern, which named the implementation form

**Registry Bead**:
A real Bead whose typed outgoing Links name a Scope's reachable Callables. A live
Link is the whole fact. Registration is optional in preview-1.
_Avoid_: directory, catalog

**Mount**:
The URL that invokes one Callable: the advertised invoke base, a slash and its name.
_Avoid_: route
