# Bead Protocol

This repository is the source of truth for the Bead Protocol (BDP).

**📜 The specification lives at [`docs/specs/bdp.md`](docs/specs/bdp.md).**
It is a draft: by its own terms, it is not a conformance target until
adopted.

BDP is an HTTP-based protocol for interacting with beads and the links
between beads. BDP defines the uniform mechanism for reading, creating,
updating, linking, and deleting beads independent of the type of the bead
(e.g., Issue, Task, Bug) or link (e.g., Dependency, Parent-Child,
Assigned-To). Beads and links are nominally typed and have a schema for
their JSON-valued properties, but the operations on a bead are consistent
across all bead and link types.

This uniformity and adherence to HTTP and JSON norms lowers the bar of
entry for people, systems, and agents to interact with beads.

A protocol also carries the two problems no single bead-store
implementation can solve alone: **versioning** — naming and citing exact
states of a bead with tokens that survive copying, syncing, and storage
changes — and **federation** — stores referencing each other's beads and
resolving those references. BDP's core design choices follow from these:
opaque version tokens, compare-and-swap updates, epoch fencing for history
rewrites, an ordered change feed, and honest capability advertising.

What's in this repository:

- the normative specification and its canonical JSON Schemas
  (`schemas/bdp-v0.schema.json`);
- a Node/TypeScript reference stack: a generic client (`bdp`), a
  deterministic test server (`bdptest`), and a server that adapts the `bd`
  CLI (`bdpbd`);
- a black-box conformance suite, and a sealed evidence artifact proving the
  Read profile against both implementations (see [STATUS.md](STATUS.md)).

Conformance claims are backed by committed, CI-verified evidence — never by
assertion. See `packages/conformance/matrices/README.md` for how that
works. Open protocol questions are recorded at the end of the draft so
deferred work stays visible; contributions there are welcome.

License: MIT (Copyright 2026 Gas City Inc.).
