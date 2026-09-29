# Extending Beads Beyond Issues

<!-- Working draft for Donna. Edit freely. This is a blog draft, not a specification or a claim that proposed Beads features have shipped. -->

This post is about work that is in progress, not work that's already been done. The work is pretty impactful, so sharing it now while we are at the early phases of implementation makes a lot of sense. This blog entry is a snapshot in time - as always, look at [gastownhall/beads](https://github.com/gastownhall/beads) for the authoritative state of the world.

## Beads, Issues, and Dependencies, oh my!

Beads has been a wildly successful project, and agents have been well-trained to be able to use beads to model and manage work, especially work that requires agent activity.

Steve [introduced Beads in October 2025](https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a), after running into the limits of asking agents to keep track of a large development effort. Less than a year later, the [repository](https://github.com/gastownhall/beads) has more than 27,000 stars and 1,800 forks (as of September 27, 2026). Pretty good for an issue tracker.

What's interesting is how naturally beads fit into an agent's work. An agent can record something it discovered, connect it to work already in progress, and ask what's ready to do next. When that agent runs out of context, the work is still there. The community that creates and maintains beads have given us a useful foundation, and they've done it without requiring every coding agent to grow its own project management system.

Beads was originally built as a way to track work for both agents and humans. As users look to expand the utility of beads, there are numerous scenarios emerging that don't fit neatly into the way beads organizes information. The primary way information is modeled in beads today is as _Issues_, and the relationships between Issues are modeled as _Dependencies_.

An Issue comes with some fairly specific expectations. Someone can claim it. It can be blocked. Eventually, someone may close it. These are useful semantics when the thing you're modeling is work.

Now imagine putting the project's release policy in an Issue. What does it mean to close that Issue? Have we finished writing the policy, stopped following it, or just made it harder to find? And if a release Issue depends on the policy, does that mean the release is blocked until someone closes the policy? We can teach every caller a convention for dealing with this, but the conventions accumulate. Eventually, every operation needs to know which Issues aren't really Issues.

It's better to make the distinction explicit in the model rather than shoehorn everything into a single abstraction that is laden with details and semantics specific to a problem.

Instead, we are enablig new kinds of information to be added to the system without making agents and humans that are used to the existing Issue operations guess what we meant.

## Beads and Memory

The most immediate example that needs induces these requirements is memory. An agent figures out why a particular approach won't work, you agree on an alternative, and then the session ends. A few days later, another agent proposes the same approach. You get to have the conversation again. Sometimes with the same agent.

The work tracker can tell us that a task is done. We also want to help the next person understand why we did it that way. That knowledge needs to survive the conversation and the work, and it needs to be findable from the work it explains.

Beads already has a small memory system. `bd remember` stores text under a key, `bd recall` reads it, and `bd memories` lists or searches what we've saved. `bd prime` can put those memories into an agent's starting context. This is useful, especially for a handful of project reminders.

But a keyed string only gets us so far. The memory commands don't give each entry a canonical Bead identity, explicit Links, or addressable versions with change attribution. If I revise a policy, a task can't cite the exact policy state it used through those commands. And loading all the bodies at startup spends context before the agent knows which ones matter. These are the gaps [Chris' Memory Beads proposal](https://github.com/gastownhall/beads/issues/5877) is trying to close.

The proposed Memory Bead has an identity, a title, and a Markdown body. A task can link to it. It can link to other memories. A caller can discover a few promising memories and then explicitly read the ones it needs. Changes participate in shared Beads History, so a caller can inspect an earlier state and see the attribution recorded with it.

Unlike an Issue, a Memory doesn't become ready or blocked, and we don't close it when we've finished reading it. We can correct it or retire it. The proposal keeps retained history available after deletion and treats erasing that history as a separate operation. That seems like a much better fit for project knowledge.

## Generalizing the data model

At this point, we could build a memory store beside the Issue store and add some special machinery to connect them. Then we'd have two answers to questions like how to identify a record, read its properties, or follow a relationship. Every tool that wanted to work with both would get to learn both.

Instead, we're making the common model explicit and defining Memory in terms of it. Issues participate in that model too. The test for this generalization is fairly concrete: can a release Issue depend on a prerequisite Issue, cite a policy Memory, and let us follow that policy's Links to the reasoning behind it? Can it do that while the existing Issue workflow continues to make sense? That's the first graph people should be able to use.

A Bead is an identified, typed thing with properties. A Link is an identified, typed, directed relationship with properties of its own. Together, they form a graph; Beads are nodes, Links are edges. An Issue and a Memory are different kinds of Bead; a blocking Dependency is a kind of Link between Issue-typed Beads.

Giving Links their own identity matters. We can read a particular Link, change its properties, or remove it without guessing which relationship between two Beads the caller intended. In the proposed model, its Type and endpoint References stay fixed; changing an which beads are being linked means deleting the Link and creting a new one.

The meaning of a Bead or Link still comes from the Type. Closing a prerequisite can make a release Issue ready. Editing a policy Memory doesn't. An informational Link to that policy doesn't acquire blocking behavior just because one endpoint happens to be an Issue. The [generic graph CLI proposal](https://github.com/gastownhall/beads/issues/6703) describes how the familiar commands could work over this model.

We also need room for application-specific data to be attached to Beads and Links. The Beads proposal calls that extension point `metadata`: an open record on both Beads and Links. A tool can record a confidence value or a validity window without coining a Type for every variation.

## Beads Protocol

As described so far, a graph of Beads and Links can live in one project. But the release policy might belong to the team, while the task following it belongs to one of the team's repositories. Copying the policy into every project creates another problem: which copy did we use, and which copies need to change when the team corrects it?

This is where the Bead Protocol, or [BDP](https://github.com/gastownhall/bdp), comes in. It defines the shared data model and an HTTP interface for working with it. A viewer should be able to read a Bead, inspect its Type, and follow its Links without knowing the database schema behind the server. The same is true of an agent or a tool assembling context for one. A local CLI can call the engine directly; it doesn't need to send itself an HTTP request to participate in the model.

Types make these distinctions something tools can understand. In BDP, a Bead or Link has one declared Type, identified by a URL. Its Type descriptor can supply a JSON Schema for its properties and, for a Link, constraints on its endpoints. A Type can also declare conformance to other Types; it then has to satisfy all of their contracts. There is no "last parent wins" rule hiding in there.

Before a store accepts a Link of a particular Type, that Type has to be known to the store. User-defined Types are part of the direction, but inventing a new name in a create command doesn't install a new contract. BDP requires the validation contract to be installed ahead of the write, so admitting a Link doesn't depend on fetching a schema from somebody else's server at that moment.

BDP calls the owning boundary a _Scope_. A Scope has a canonical URL, and each Bead and Link belongs to exactly one Scope. For example, within `https://beads.example/team/`, the local identity `beads/release-policy` resolves to `https://beads.example/team/beads/release-policy`. Links have their own identities under `links/`. The rest of the path is an identifier; slashes don't secretly create folders or nested Scopes.

Once created, that canonical identity stays with the record. Where aliases are supported, a friendly name can resolve to it and later be repointed. Stored References use the canonical identity, so repointing an alias doesn't quietly rewrite existing relationships. This gives us two useful concepts: the thing itself and a name we use to find it.

A Link can cross a Scope boundary. The project can keep a Link from its release Issue to the team's policy without importing the team's entire database. At least one endpoint belongs to the Scope holding the Link; an endpoint outside it is carried as a Reference, which is the URL to the Bead in another scoe. Reading that target is a separate operation, with its own availability and authorization checks. Knowing its URL doesn't grant permission to read it - just how to find it.

There are limits to what this buys us. A local write can't guarantee that another Scope will remain online or retain a policy forever, and it doesn't become a transaction across both stores. We need to be explicit about that. Cross-Scope Links let us record the relationship without pretending we own the other end.

## Versioning

Let's say the release policy changes on Friday. On Monday, I want to know why Thursday's release was approved. Reading the current policy may be actively misleading. I need the policy as it stood when the decision was made, including the relationships that were part of that state.

That gives us two useful ways to refer to a Bead. We can follow its current state using just its URL, or pin a Reference to one exact retained version. Both are useful. A task preparing the next release may want the latest policy; a record of an approval should be able to name exactly what it used. Changing the policy later must not change the meaning of that citation.

Relationships need to participate too. If a Memory cites a different source after an edit, its text might be unchanged while its meaning has changed substantially. In BDP, a Type can declare ownership of outgoing Link Types. Changing one of those owned Links changes the source Bead's version, and the old state preserves the old owned Links. Merely pointing at another Bead doesn't version the target.

There is also the more immediate problem of two agents editing the same record. Each should be able to say which revision it started from. If another write has landed, a guarded write fails so the caller can read the new state and decide what to do. The Memory proposal also allows unguarded writes, but requires the result to identify the version replaced and its attribution. Keeping history doesn't excuse a silent overwrite.

HTTP already has useful machinery here. BDP exposes a Resource revision as an opaque `ETag`, which a client can use for conditional reads. For BDP mutation commands, the caller supplies `expectedRevision` for the Resource it intends to change. Putting `If-Match` on an operation URL doesn't guard every Bead named inside that request.

An ETag by itself doesn't promise that the server kept yesterday's record. Retained history needs an additional contract: an old address must continue to mean the same state, and a store that can no longer serve that state must say so. It must never substitute the current version. BDP's historical resolution capability makes that promise explicit; clients discover whether a store offers it. Revision tokens are opaque to callers, so none of this requires a client to understand Dolt commit hashes or another engine's internal version numbers.

## Try it out and let us know what you think!

If you'd like to try the functionality as we build it, you can! We have [a branch](TODO) that implements some initial functionality. To see it in action, try some of the following commands:

TODO:Donna to double-check these commands

```sh
# create a new memory bead
$ bd remember "call your mom on mother's day"
...output including bead id...

# create a new version of the memory
$ bd update <<bd-id>> "Call your mom on Mother's Day!"

# see the history of a bead
$ bd history <<bd-id>>
...output...

# create and link an issue bead
$ bd create "build a phone app"
...output including bead id...
$ bd link <<memory-bd-id>> <<issue-bd-id>>

# see your beads on wire via the Beads Protocol (BDP)
$ bd serve
...output to include local service port...
$ curl https://localhost:<<port>>/...
...output of the memory and issue beads...
```

If you'd like your agents to be able to automatically create and use memories, add the following to your AGENTS.md:

```markdown
TODO:Stephanie
```

In our tests, these rules work pretty well with Claude Code and Codex and we'd be interested in hear your experience.

In fact, we'd love to hear about your experience across the board about this new memory, versioning and beads protocol functionality. If you having joined the Gas Town Hall Discord, please join and jump into the `#beads` and `#memory-beads` channels to report on what worked and didn't. Also, feel free to log bugs on the beads repo with prefixes like `[Memory]` or `[BDP]` and memory the branch by name so we can see how things are going.

## Where are we?

> This section needs to be rewritten once we get everything integrated, ideally on Monday.

We've made a lot of progress, but have a lot of work in front of us.

In our [Beads integration branch](https://github.com/donnabox/beads/tree/codex/janet-graph-integration), we can initialize a store, create Issue and Memory Beads, and connect them with Links. We can edit their content and Link properties through the CLI, follow the relationships, and read and compare exact saved versions. Blocking Dependencies still connect Issues to Issues; informational Links can connect Issues and Memories. These paths have been exercised against both embedded Dolt and an ordinary shared Dolt server. This is working integration code, with a subset of the proposed commands available. It hasn't landed in upstream Beads yet.

The Beads BDP endpoint can read that graph over HTTP on shared-server Dolt. An independent BDP client can discover Types, read Beads and Links, filter and page through collections, and see changes made through the CLI. Writing through BDP is still ahead of us in this integration. The [BDP project](https://github.com/gastownhall/bdp/blob/main/STATUS.md) already has a write client and mutation runtime components, but those aren't a complete, qualified write service or a finished Beads adapter.

The model and protocol drafts describe a larger destination. The remaining Beads work includes complete Memory-required History and lifecycle behavior, user-installed Types, cross-Scope References, and full compatibility with existing Issue workflows. Reading an exact saved version is useful progress; there's more to delivering the whole History contract.

---

## Working references

- [Memory Beads proposal](https://github.com/gastownhall/beads/issues/5877)
- [Generic graph CLI proposal](https://github.com/gastownhall/beads/issues/6703)
- [BDP specification](../specs/bdp.md)
- [Repository implementation status](../../STATUS.md)

<!-- Editorial reminders: deletion, repinning, nominal Issue Types, metadata placement, and compatibility defaults still need reconciliation across proposals. Do not present an open choice as settled. Keep the implementation plan/review in donnabox/beads. -->
