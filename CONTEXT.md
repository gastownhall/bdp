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
