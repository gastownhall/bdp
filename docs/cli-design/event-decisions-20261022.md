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

## A separate, still unanswered batch question

Trish has presented a choice between per-operation published Resource revisions
and final-per-Resource revisions for an atomic batch, plus the related net-zero
policy. Neither proposal is accepted by these two answers. The earlier PR292
operation-local examples are unadopted input, not an answer to that question.

The Event proposal describes each **published** transition, whatever the selected
commit model ultimately makes public. It does not turn every authored batch member
into a mandatory Event, select intermediate owner snapshots, or determine the
Event count for A→B→A or create-then-delete inside one batch. Actual batch/owner
composition stays with Trish. The worked two-update example uses two separately
committed singleton writes, avoiding an inferred batch ruling.

Types activation/intrinsics and normal integration/implementation qualification
also remain separate. Vickie, runtime, product/main, `serve` and Experimental work
remain held. No new question or approval campaign follows from recording these
answers.
