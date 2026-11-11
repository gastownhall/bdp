# Dependency-graph style guide

Shared, living convention for how we draw the plan graphs so every render reads the same way.
Owner/recorder: Trish (here at `bdp/plan/`, beside `AUTHORING.md`); transfers to Britt on the
`common/` promotion (Donna's call, Britt lifts it at roll-up). Contributions: propose entries to the
owner (model (a)); the `## Log` is the intake, the owner promotes confirmed entries into the
sections below.

**Conventions ratified by Donna 2026-11-09.**

## Arrow direction — the arrow points at the DEPENDENT

`X: after(Y)` renders **`Y → X`**: the arrowhead lands on `X`, the dependent (the node that needs
the other); `Y`, the prerequisite, is the source. A keystone — the thing most work depends on — is
the node arrows **fan out from** (it is many nodes' prerequisite). (Ruled by Donna 2026-11-09, from
Melinda's SVG: `marker-end` on the dependent.)

## Edges — encode the insight (Melinda)

- Thin faint-gray lines = the shared `begin-after` dependency — the base web every node shares.
- One bold colored arrow per node = its distinguishing dependency. The eye reads the meaningful edges.

## Edge types (Donna)

- **begin-after** — the default: a node may begin once its prerequisite is available; usually pinned
  to a specific subnode.
- **must-complete** — the exception: a node genuinely can't *finish* until something is done (e.g.
  reference-impl must-complete ← bdp-conformance). Add only where real.

## Composition is not dependency — never one arrow for both

- **Composition** — a node is *made of* subnodes; state is `all(children)`. Show by grouping / boxes.
  No direction.
- **Dependency** — `after()`. Show by arrows (direction above).

## Flow views are the exception — label them

A pipeline / process view (data through stages, `admit → evaluate → lower`) reads in *flow*
direction, opposite depends-on. Fine, but **label it "flow"** so the two aren't silently mixed.

## Colors — CDS ramp classes (not hex; dark mode auto-works)

- **spec** — `c-purple`
- **conformance** — `c-teal`
- **impl** — `c-amber`
- **origin / neutral** — `c-gray`
- **design** (go / CLI design) — *unassigned; pick a ramp when first drawn* (candidate `c-coral`).

≤2 ramps per diagram; add a one-line legend when color encodes meaning.

## Nodes — rounded rects, clickable

Rounded rectangles (`rx="8"`), not sharp boxes, not circles. Clickable for drill-in:
`onclick="sendPrompt('…')"`.

## Tool — inline SVG via show_widget (not Mermaid)

Hand-author inline SVG; call `read_me({modules:["diagram"]})` first for the ramps; render inline via
`visualize.show_widget`. `viewBox="0 0 680 H"`, `role="img"` + `<title>`/`<desc>`, text classes
`t` / `ts` / `th`, arrow marker in `<defs>`.

## Views

Top-level graph + drill-in diagrams per composite node; one relation per view (composition *or*
dependency).

## Log (intake — tag proposer + confirmed)

- 2026-11-09 — seeded (Trish).
- 2026-11-09 — Melinda: flow-view rule; direction confirmed from her SVG.
- 2026-11-09 — Eva: CDS palette, inline-SVG tool, edge encoding, begin-after/must-complete, rounded rects.
- 2026-11-09 — Britt: home (bdp/plan/ now, common/ later) + single-owner propose-in model.
- **2026-11-09 — Donna RULED (confirmed): adopt the full set above** — arrow-at-dependent, CDS
  colors, inline-SVG tool, edge encoding, edge types, rounded rects. Direction flipped from the seed.
