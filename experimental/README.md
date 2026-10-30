# Experimental BDP explorations

> **NON-NORMATIVE EXPLORATION. NOT THE PLAN OF RECORD. NOT A PRODUCT COMMITMENT. NOT A CONFORMANCE OBLIGATION. NO PROMISED IMPLEMENTATION.**
>
> These documents explore possibilities. They do not select a protocol, advertise support, authorize implementation or promise that any feature will ship. Current BDP requirements live only in [specs/](../specs/README.md). Core, Write and Types must not depend on these documents.

This is the parking area for deferred BDP ideas during the BDPv0.1 consolidation. [BDP #59](https://github.com/gastownhall/bdp/issues/59) is the sole shared plan of record. Experimental is a maturity label, not a new discovery value or a cumulative profile a small provider must implement.

| Exploration | Question worth preserving | Outside the retained contract |
| --- | --- | --- |
| [Synchronization](synchronization.md) | How could a consumer bootstrap and maintain a complete authorized replica? | Snapshot/bootstrap, replica state feed, history/view fences, applied checkpoints and distributed recovery |
| [Public mutation receipts](mutation-receipts.md) | When would independently readable/paged/pending outcomes be useful? | A public receipt service; durable retry/non-reexecution foundations remain required by retained Write |
| [Set writes](set-writes.md) | How could update/delete select a bounded set atomically? | Generalized predicate-selected writes; ordinary CRUD and optional always-atomic batch are independent |
| [Callable Beads](callables.md) | How could ordinary Beads define parameterized Batch/Query operations and declarative CLI projections? | Callable UDTs, invocation methods/modes, mounts and parameter/closure carriers; no retained profile or installed capability changes |

The [Core/Write disposition map](../docs/design/bdp-v0.1-core-write-disposition.md) accounts for the pinned source and separates shared foundations from these experiments. That initial parking patch created exploration/navigation and accounting only. The later [retained cutline](../docs/design/bdp-v0.1-retained-cutline.md) records positive Core/Write entries and discovery extraction; it does not promote these explorations or qualify an implementation.

Preserve only constraints useful to avoid obvious dead ends in the retained contract. Do not complete an advanced wire protocol or build an extension framework here. Required Events, safe retries, atomic mutation effects, revision meaning and authorization are not Experimental escape hatches. Atomic batch does not require replication; delete does not mean erase; exact retained-version access remains a separate History concern.

If an idea is reconsidered later, it needs its own concrete BDP issue, explicit semantic/capability selection and coordinated normative adoption. A maturity-label change cannot reinterpret issued mutation keys, revisions or cursors. No review date, parking target or quiet interval automatically restarts work.
