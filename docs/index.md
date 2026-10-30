---
layout: default
title: Bead Protocol
---

BDP is an HTTP-based protocol for interacting with beads and the links between
beads. It defines the uniform mechanism for reading, creating, updating,
linking, and deleting beads independent of the type of the bead (e.g. Issue,
Task, Bug) or link (e.g. Dependency, Parent-Child, Assigned-To).

Beads and links are nominally typed and have a schema for their JSON-valued
properties, but the operations on a bead are consistent across all bead and
link types. This uniformity and adherence to HTTP and JSON norms lowers the bar
of entry for people, systems, and agents to interact with beads.

## Specification

The sole specification authority is
[`specs/`](https://github.com/gastownhall/bdp/tree/main/specs). Start with the
[selected profile entries and source-status map](https://github.com/gastownhall/bdp/blob/main/specs/README.md):

- [Retained Core and Read](https://github.com/gastownhall/bdp/blob/main/specs/profiles/core/retained-core.md)
- [Retained Write](https://github.com/gastownhall/bdp/blob/main/specs/profiles/write/retained-write.md)
- [Types profile](https://github.com/gastownhall/bdp/blob/main/specs/profiles/types/types.md) (optional)

Read an exact source revision. Publishing specification source does not upgrade
an implementation or its pinned contract.

## Why a protocol

A protocol carries the two problems no single bead-store implementation can
solve alone: **versioning** — naming and citing exact states of a bead with
tokens that survive copying, syncing, and storage changes — and **federation**
— stores referencing each other's beads and resolving those references.

## Reference implementation

A Node/TypeScript reference stack lives in the same repository: a generic
client (`bdp`), a deterministic test server (`bdptest`), and a server that
adapts the `bd` CLI (`bdpbd`), with a black-box conformance suite and a sealed
evidence artifact. See
[STATUS.md](https://github.com/gastownhall/bdp/blob/main/STATUS.md).

---

This page is informative. It is not part of the specification and does not
override BDP requirements.
