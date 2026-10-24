# Event decisions accepted October 22, 2026

Donna answered the two existing Event questions in Sybil's chat: **“Yes to 1”**
and **“Yes to 2.”** These are accepted design choices, not implementation approval.

1. **Every conforming source supports postimages; deltas are optional.** Two
   conforming peers have a common representation. Supporting delta does not remove
   postimage support. Choosing postimage when the CLI option is omitted is the
   consistent author choice in the paired draft, not a separately requested ruling.
2. **Required Events provide declared observation coverage, bounded replay and
   explicit gaps.** External sources do not promise original mutations they could
   not observe. Live-only delivery cannot claim this replay contract. There is no
   protocol-wide number of retained days or universal observation-latency promise.

Donna requested the Event ↔ mutation vocabulary details for the following day.
The concrete proposal is [Events CLI](events.md), paired with [Core Events](../../specs/profiles/core/events.md),
the separately named candidate schema helpers and [examples](../../fixtures/retained-events/candidate.json).

## Subsequent actual batch/Types/alias rulings

Donna has now [answered Trish's four questions](https://github.com/gastownhall/bdp/issues/59#issuecomment-6358504683):

1. Atomic batches publish final committed states, at most one new revision per
   affected Resource/owner. A common token across Resources is not required; token
   meaning remains Resource-qualified, with no equality/inequality guarantee.
2. Equal final covered state with no other durable semantic effect retains revisions
   and emits no lifecycle Event. Successful retry outcome/witnesses are still
   recorded. Allocation/create-delete is not automatically a no-op; ID nonreuse
   and ordinary abort rollback remain. Earlier PR292 operation-local results are
   superseded author input, not a compatibility constraint on this unadopted draft.
3. Strict truthful Scope-wide Types activation; no invented historic pins or
   prospective grandfather boundary. Trish owns its Types-local propagation.
4. Retain initial in-Scope Bead aliases; foreign/Link/pinned expansion is parked in
   [issue299](https://github.com/gastownhall/bdp/issues/299). Trish owns that source.

The paired [final-publication amendment](../../specs/profiles/core/publication.md)
defines concrete common result, owner, guard, attribution and Event consequences.
Those result spellings and ordinary admission details are reviewable author choices,
not additional quoted human rulings. Actual Types/intrinsic integration and normal
qualification remain separate. Vickie, runtime, product/main, `serve` and Experimental work
remain held. No new question or approval campaign follows from recording these
answers.
