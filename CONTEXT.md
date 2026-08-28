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

**External Reference sentinel**:
The BDP protocol identifier used as the endpoint Type when a Link endpoint is
outside its Scope and therefore opaque to that Scope.
_Avoid_: external Type, remote Bead Type
