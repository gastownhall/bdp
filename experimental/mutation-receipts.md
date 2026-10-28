# Public mutation receipts

> **NON-NORMATIVE EXPLORATION. NOT THE PLAN OF RECORD. NOT A PRODUCT COMMITMENT. NOT A CONFORMANCE OBLIGATION. NO PROMISED IMPLEMENTATION.**
>
> This is deferred design context, not a selected service contract. [BDP #59](https://github.com/gastownhall/bdp/issues/59) is the shared plan; [specs/](../specs/README.md) is the protocol authority. Core/Write/Types do not depend on this document.

## Why retain the idea

An independently readable outcome might help with long-running mutations or results too large for a bounded inline response. Pending status, receipt URLs and result pagination have substantial lifetime/disclosure costs. They need not be mandatory machinery for an ordinary CRUD operation or a bounded atomic batch.

## Constraints that inform the retained contract

- A durable internal outcome/key record is distinct from a public receipt Resource. Moving a public receipt service out of Write cannot discard safe retry or compact successful-key non-reexecution evidence.
- Losing a response leaves an uncertain outcome until recovered. It is not permission to submit the same intent with a new key.
- Result-detail expiry and authorization changes may limit disclosure; neither permits executing a successful mutation again.
- A richer service cannot silently replace the base inline result with a receipt or change an existing retry namespace merely because it supports this feature.
- Restore or storage-tier changes cannot turn lost retry evidence into a transparent continuation of the same write authority. The retained contract must settle this independently.

No receipt URL shape, polling interval, pending-state schema, paging contract or result lifetime is defined here. Whether receipts would be independent of synchronization is a future design question, not a dependency selected by this file.

Historical source: [Mutation Transactions](https://github.com/gastownhall/bdp/blob/37d6622f95e71cac022478cfbcb3e8f2d6bdf444/specs/profiles/write/write.md#mutation-transactions), [mutation receipts](https://github.com/gastownhall/bdp/blob/37d6622f95e71cac022478cfbcb3e8f2d6bdf444/specs/profiles/write/write.md#mutation-receipts), and [receipt responses](https://github.com/gastownhall/bdp/blob/37d6622f95e71cac022478cfbcb3e8f2d6bdf444/specs/profiles/write/write.md#mutation-receipt-responses). Existing cumulative-v0 behavior is not rewritten by parking this exploration.
