# Bead Protocol

This repository is the source of truth for the Bead Protocol (BDP).

**The sole specification authority is [`specs/`](specs/README.md).**
Start with the [selected profile entries and source-status map](specs/README.md),
including [retained Core and Read](specs/profiles/core/retained-core.md) and
[retained Write](specs/profiles/write/retained-write.md). These entries identify
the v0.1 specification being aligned with the canonical CLI and distinguish it
from inherited v0 material and proposed extensions. Read an exact source revision;
publishing specification source does not upgrade an implementation or its pinned
contract. Material outside `specs/` is implementation, test evidence, informative
CLI correspondence or design context; it does not override BDP requirements.

BDP is an HTTP-based protocol for interacting with beads and the links
between beads. BDP defines the uniform mechanism for reading, creating,
updating, linking, and deleting beads independent of the type of the bead
(e.g., Issue, Task, Bug) or link (e.g., Dependency, Parent-Child,
Assigned-To). Beads and links are nominally typed and have a schema for
their JSON-valued properties, but the operations on a bead are consistent
across all bead and link types.

This uniformity and adherence to HTTP and JSON norms lowers the bar of
entry for people, systems, and agents to interact with beads.

## Optional Types profile

The [Types specification](specs/profiles/types/types.md) records the optional,
Scope-wide Types profile, including definitions as Beads, exact revisions,
conformance, graph constraints and lifecycle decisions. Its [candidate schemas and
examples](specs/profiles/types/README.md) support design review. Settled design rules and
open decisions are distinguished explicitly. Its common carrier/binding must
compose with the selected Core/Write entries at the same source revision. A
specification landing is not a claim of implementation or permission to change
a consumer's selected contract or release pin.
Issue/Dependency and Memory remain separate domain drafts linked from that document.

## Protocol and reference implementation

A protocol also carries the two problems no single bead-store
implementation can solve alone: **versioning** — naming and citing exact
states of a bead with tokens that survive copying, syncing, and storage
changes — and **federation** — stores referencing each other's beads and
resolving those references. BDP's core design choices follow from these:
opaque version tokens, optional revision guards, explicit retained-address and
recovery guarantees, required observations, and honest capability advertising.
Optional synchronization/Transactional machinery is not a prerequisite to
ordinary retained Core/Write.

What's in this repository:

- the selected specification entries and their canonical
  [v0.1 grammar](specs/profiles/core/bdp-v0.1.schema.json), alongside the
  separately retained [v0 schema](specs/profiles/core/bdp-v0.schema.json);
- a Node/TypeScript reference stack: a generic client (`bdp`), a
  deterministic test server (`bdptest`), and a server that adapts the `bd`
  CLI (`bdpbd`);
- a black-box conformance suite, and a sealed evidence artifact proving the
  Read profile against both implementations (see [STATUS.md](STATUS.md)).

Try the [three-minute BDP Read walkthrough](docs/read-demo.md) to follow Links
and run the same readiness client against both servers.
The [controlled History client walkthrough](docs/history-client-demo.md) follows
versions pages and requests old Beads and Links through the actual SDK against
an explicit HTTP fixture.

Conformance claims are backed by committed, CI-verified evidence — never by
assertion. See `packages/conformance/matrices/README.md` for how that
works. Open protocol questions are recorded at the end of the draft so
deferred work stays visible; contributions there are welcome.

License: MIT (Copyright 2026 Gas City Inc.).
