# Synchronization

> **NON-NORMATIVE EXPLORATION. NOT THE PLAN OF RECORD. NOT A PRODUCT COMMITMENT. NOT A CONFORMANCE OBLIGATION. NO PROMISED IMPLEMENTATION.**
>
> This is deferred design context, not a future protocol specification. No implementation, interface or guarantee described here is selected. [BDP #59](https://github.com/gastownhall/bdp/issues/59) is the shared plan; [specs/](../specs/README.md) is the protocol authority. Core/Write/Types do not depend on this document.

## Why retain the idea

A replica consumer may eventually need a consistent starting image and every subsequent change in its authorized view. Ordinary collection pages and application Event observation do not establish that promise. A future design might combine snapshot bootstrap, complete postimages/tombstones, atomic application groups and durable applied checkpoints. None is needed just to perform an ordinary guarded edit.

## Constraints that inform the retained contract

- Required Events still need truthful committed facts, ordering/transaction association and explicit replay/retention outcomes. Extract those foundations rather than moving them away with replica machinery.
- A bare sequence number cannot distinguish a changed source/history or authorization context. Keep enough internal context to reject incompatible continuations; human-facing tokens can stay opaque.
- Transport delivery is not durable application. A consumer cannot checkpoint an atomic group after dropping a required state transition.
- Bootstrap, projection removals and erasure reconciliation must agree before claiming a complete replica. A cache miss or discarded archive is not authoritative absence or proof of erasure.
- Enabling synchronization cannot change base Resource identity, guard meaning, mutation results or the retry namespace of previously committed basic writes.

No endpoint, checkpoint encoding, epoch field, strict-read tuple, retention duration or capability vocabulary is defined here. Active-active writes, merge/conflict resolution and federation remain outside this exercise.

Historical source: [Scope history and authorization fences](https://github.com/gastownhall/bdp/blob/37d6622f95e71cac022478cfbcb3e8f2d6bdf444/specs/profiles/write/write.md#scope-history), [change groups](https://github.com/gastownhall/bdp/blob/37d6622f95e71cac022478cfbcb3e8f2d6bdf444/specs/profiles/write/write.md#change-groups-and-replication), [snapshots](https://github.com/gastownhall/bdp/blob/37d6622f95e71cac022478cfbcb3e8f2d6bdf444/specs/profiles/write/write.md#scope-snapshots), and [changefeed](https://github.com/gastownhall/bdp/blob/37d6622f95e71cac022478cfbcb3e8f2d6bdf444/specs/profiles/write/write.md#scope-changefeed). These links preserve existing draft context; they do not adopt it as future work.
