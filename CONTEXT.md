# Bead Protocol

This glossary defines BDP-specific terms used across the repository.

## Language

**Protocol identifier**:
A URI assigned by BDP to identify protocol vocabulary independently of where
the corresponding source artifact is hosted. Dereferenceability is not part of
its identity.
_Avoid_: download URL

**Normative schema bundle**:
The single JSON Schema bundle containing BDP v0's normative JSON wire
definitions.
_Avoid_: schema fragments, implementation schema

**External reference**:
A Link endpoint URI outside its Scope, opaque to that Scope; it may be
written as the citation object `{ uri, revision }` to pin the external
state it was made against.
_Avoid_: external Type, remote Bead Type
