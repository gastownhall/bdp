# Set writes

> **NON-NORMATIVE EXPLORATION. NOT THE PLAN OF RECORD. NOT A PRODUCT COMMITMENT. NOT A CONFORMANCE OBLIGATION. NO PROMISED IMPLEMENTATION.**
>
> This is deferred design context, not a selected operation or predicate language. [BDP #59](https://github.com/gastownhall/bdp/issues/59) is the shared plan; [specs/](../specs/README.md) is the protocol authority. Core/Write/Types do not depend on this document.

## Why retain the idea

Updating or deleting all matching Resources at one authoritative selection point may eventually matter. A client that lists IDs and then edits them is working on an observed set; concurrent writes can change which Resources match. That workflow does not establish an atomic update-where or delete-where guarantee.

## Constraints that inform the retained contract

- Consider paired update/delete functionality together. Neither operation is required by ordinary CRUD or explicit-member atomic batch.
- Atomic selection, cardinality bounds, authorization, final-state constraints and bounded results need a coherent contract. A supported prefix or partial execution cannot be reported as an atomic success.
- A newly submitted atomic batch containing unsupported required semantics must refuse as a whole under its admission rules. Enabling a capability later must preserve retained retry/conflict dispositions.
- Observation would describe concrete committed Resource effects, with shared mutation vocabulary and transaction association. A subscriber must not rerun the original predicate against a later database.
- Set writes do not logically require replica snapshots, public receipt URLs or a new mutation language. Any such dependency needs a concrete reason.

No selector grammar, set-operation schema, CLI command, parameterized-batch language or server query execution facility is defined here. Event predicate filtering and individual-property path projection remain outside the current exercise.

Historical source: [set mutation](https://github.com/gastownhall/bdp/blob/37d6622f95e71cac022478cfbcb3e8f2d6bdf444/specs/profiles/write/write.md#set-mutation), and [existing batch discussion #152](https://github.com/gastownhall/bdp/issues/152). These are source references, not a promise to implement set writes.
