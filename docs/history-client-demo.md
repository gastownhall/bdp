# Looking up an earlier decision

This three-minute walkthrough uses the **real BDP client and HTTP transport with
controlled fixture responses**. It shows the client asking for versions and reading
an old record. The Beads engine does not serve these History routes yet.

## Run it

From this repository, with Node **24.16.0** and pnpm **11.20.0** (pinned in
`package.json`). The required History SDK was introduced in source commit
`fd11bebabfb181c3b2a29dd1d147d75b5bcdb8f1`; build this checkout before running:

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/demo-history.mjs /tmp/bdp-history-demo-NEW
```

Choose a fresh absolute output directory. The script refuses to overwrite an
existing one. It starts a private loopback HTTP listener on an available port,
prints its observations, and closes the client and listener before reporting PASS.
It writes `transcript.txt`, `http.json` and `result.json` into that directory.
No Beads installation or account is needed.

## What to say

“Let's look at an earlier decision. This is a controlled History HTTP fixture
using the actual BDP SDK; the responses are invented demo data.

“First, we ask which versions are visible. We get two entries and a next-page
link. We explicitly follow that link to get the remaining two. The labels and
order come from the server; the client doesn't invent an ancestry chain.

“Next, we choose an old revision. Its identifier includes punctuation and Unicode.
The record comes back with its original title and recorded change context.

“We separately request an old Link. Its target still names the revision recorded
in that Link. That pin isn't a request to fetch today's target.

“Finally, one listed revision has incomplete retained content. Asking for it gives
us a typed explanation and an incomplete inventory of what is missing. We don't
silently substitute today's record.

“This controlled History HTTP fixture using the actual BDP SDK demonstrates
paging and explicit revision reads. The managed Memory graph restart demo is
separate. Serving that graph's retained History through BDP remains integration
work.”

## What this exercises

| Demonstrated here | Separate implementation or qualification |
| --- | --- |
| Actual SDK discovery and HTTP Fetch requests | Production History server and capability admission |
| Two explicitly requested version pages | Beads retained-version persistence and history authorization |
| Exact old Bead and Link reads; opaque revision spelling and target pin preserved | Automatic traversal, whole-graph rewind, or fetching a pinned target |
| Typed `revision-unretained` response with no fallback | Real storage loss, erasure enforcement, or complete missing-content inventory |
| Recorded requests, SDK results and listener cleanup | Full History conformance, HTTP metadata/HEAD behavior, or production graph authority |

The [Read walkthrough](read-demo.md) separately exercises actual BDP dependency
reads over the established reference or real-bd adapter. The managed Memory graph
restart demonstration is a separate engine test. This History fixture connects
neither adapter to a retained-history implementation and does not qualify Chris's
memory proposal.
