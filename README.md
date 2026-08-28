# Bead Protocol

This repository is the source of truth for the Bead Protocol (BDP).

BDP is an HTTP-based protocol for interacting with beads and the links between beads. BDP defines the uniform mechanism for reading, creating, updating, linking, and deleting beads independent of the type of the bead (e.g., Issue, Task, Bug) or link (e.g., Dependency, Parent-Child, Assigned-To). Beads and links are nominally typed and have a schema for their JSON-valued properties, but the operations on a bead are consistent across all bead and link types.

This uniformity and adherence to HTTP and JSON norms lowers the bar of entry for people, systems and agents to interact with beads.

This repository will contain:

- [BDP v0 draft specification](./docs/specs/bdp.md)
- Open protocol questions and the implementation-evidence backlog are recorded
  at the end of the draft so deferred work remains visible during development.
- A reference implementation of a BDP Client
- A reference implementation of a BDP Service
- Validation suites to assert conformance
