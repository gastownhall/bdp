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

**Reference / Pinned Reference**:
How anything in BDP points at anything: a URI — or a Pinned Reference,
`{ uri, revision }`, the URI plus the revision it was made against. Either
reference class may be pinned; the URI alone is identity.
_Avoid_: external Type, remote Bead Type

## Proposed Type lifecycle vocabulary

These terms belong to the [Type design proposal](docs/design/type-lifecycle-preview2.md),
not the adopted v0 wire specification.

**Type Bead**:
A Bead whose versions contain Type definitions describing Bead or Link instances.
_Avoid_: Link definition as a Link

**Type affiliation**:
Under the proposed new model, the intrinsic association of a resource version with its nominal Type identity and
exact governing definition version.
_Avoid_: affiliation Link

**Type compatibility family**:
An ordered family of definitions required to preserve both earlier valid data and
earlier consumers' structural and semantic guarantees; declared membership and
trusted evidence of compliance remain distinct.
_Avoid_: identical definitions

**Type adoption**:
An explicit change of an instance's governing Type definition, represented in a
new resource version when its exact affiliation changes.
_Avoid_: automatic upgrade on property edit

## Existing Beads domain vocabulary

These established meanings do not prescribe Type-versus-kind norms for new designs.

**Issue**:
The established Beads work record, carried into the graph as a Bead Type.
Its classifications, such as task and bug, retain their existing meanings.
_Avoid_: renaming the enclosing Type Task

**Dependency**:
The established relationship in the Issue domain, carried into the graph as a
Link Type. Its classification determines the relationship's existing meaning;
not every Dependency is blocking.
_Avoid_: treating Dependency as a synonym for blocking

## Proposed provenance vocabulary

These terms belong to the [provenance proposal](docs/design/provenance-on-resource-versions-proposal.md),
not the adopted v0 specification.

**Revision provenance**:
The recorded account of who a Bead or Link version is attributed to, when it was
committed, and which information it was based on, with optional assisting-agent
and change-message information.
_Avoid_: activity history of the subject

**Activity provenance**:
Recorded reports of work involving a subject, such as a handoff, commit, or use
of information, which can arrive independently of changes to that subject.
_Avoid_: revision source list

**Activity Bead**:
A Bead recording a reported activity concerning a Bead, Link, or external
resource. Its own revision provenance describes recording the report.
_Avoid_: protocol Event

**Source relation**:
An optional statement of how referenced information relates to a revision or
activity, such as evidence used or an output produced. It does not identify the
referenced resource's Type or create a graph Link.
_Avoid_: target Type
