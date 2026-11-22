// Independent observable assertions for optional read-only stdlib operations.
import { requireThat, resource, reference } from "./contract.mjs";
import { canonical, identity, projected } from "./evaluate.mjs";
export async function searchCase({ caps, resources, scope, invoke, fault }) {
  const witness =
    resources.find((r) => typeof r.body?.text === "string" && r.body.text.length > 80) ??
    resources.find((r) => typeof r.body?.title === "string");
  requireThat(!!witness, "Search needs a text-bearing inventory witness");
  const text = (witness.body.text ?? witness.body.title).slice(0, 64).trim();
  const where = {
    kind: "cond",
    condition: { kind: "compare", field: ["id", "id"], op: "eq", value: witness.id.id },
  };
  const hits = await invoke("search", { text, where, limit: 1 });
  requireThat(
    Array.isArray(hits) && hits.length === 1,
    "Search must return a nonempty bounded array, not a Page",
  );
  for (const hit of hits) {
    reference(hit.resource);
    requireThat(
      identity(hit.resource, scope) === identity(witness.id, scope),
      "Search ignored its QueryExpr prefilter",
    );
    requireThat(hit.resource.rev === witness.id.rev, "Search reference lost revision");
    requireThat(Number.isFinite(hit.score), "Search score must be finite");
    if (hit.snippet !== undefined)
      requireThat(
        typeof hit.snippet === "string" && hit.snippet.length > 0,
        "Invalid search snippet",
      );
  }
  const all = await invoke("search", { text, limit: 3 });
  requireThat(Array.isArray(all) && all.length > 0 && all.length <= 3, "Search limit ignored");
  requireThat(
    all.every((h, i) => Number.isFinite(h.score) && (!i || all[i - 1].score >= h.score)),
    "Search scores must descend",
  );
  const upper = await invoke("search", {
    text: text.toUpperCase(),
    where,
    mode: "lexical",
    limit: 1,
  });
  requireThat(upper.length === 1, "Lexical search lost case-insensitive matching");
  const select = { include: ["/body/title"] },
    expanded = await invoke("search", { text, where, select, limit: 1 });
  requireThat(
    canonical(expanded[0]?.resource) === canonical(projected(witness, select)),
    "Search selector did not expand/project its resource",
  );
  const empty = await invoke("search", { text, where: { kind: "any", of: [] }, limit: 3 });
  requireThat(Array.isArray(empty) && empty.length === 0, "Search ignored empty predicate");
  const modes = caps.packs.stdlib.search.modes ?? ["lexical"];
  for (const mode of ["semantic", "hybrid"].filter((m) => !modes.includes(m)))
    await fault("stdlib/search:call", [400, 422], "search-mode-unsupported", {
      method: "POST",
      body: {
        arguments: [
          { name: "text", value: text },
          { name: "mode", value: mode },
        ],
        idempotencyKey: "search-mode-test",
      },
    });
}
export async function sortingCase({
  caps,
  resources,
  scope,
  invoke,
  request,
  decoded,
  fault,
  numericSort,
}) {
  requireThat(caps.core.list?.sort === true, "Required server sorting capability is missing");
  const chosen = numericSort
    ? resources.filter((r) => typeof r.body?.ordinal === "number").slice(0, 12)
    : [];
  const sortOrdinal = chosen.length > 2;
  const set = chosen.length > 2 ? chosen : resources.slice(0, 12);
  const filter = [
      { kind: "compare", field: ["id", "id"], op: "in", value: set.map((r) => r.id.id) },
    ],
    where = { kind: "cond", condition: filter[0] };
  const sort = [
    { field: sortOrdinal ? ["body", "ordinal"] : ["id", "id"], order: "desc" },
    { field: ["id", "id"], order: "asc" },
  ];
  const scalar = (a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    const x = [...String(a)],
      y = [...String(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      return x[i] === undefined
        ? -1
        : y[i] === undefined
          ? 1
          : x[i].codePointAt(0) - y[i].codePointAt(0);
    }
    return 0;
  };
  const expected = [...set]
    .sort(
      (a, b) =>
        scalar(sortOrdinal ? b.body.ordinal : b.id.id, sortOrdinal ? a.body.ordinal : a.id.id) ||
        scalar(a.id.id, b.id.id),
    )
    .map((r) => identity(r.id, scope));
  const collected = [];
  let after, first;
  do {
    const p = await invoke("query", {
      where,
      sort,
      request: { limit: 2, ...(after ? { after } : {}) },
    });
    requireThat(Array.isArray(p.items), "Sorted query did not return Page");
    if (!first) first = p.cursor;
    collected.push(...p.items.map((r) => identity(r.id, scope)));
    after = p.cursor;
    if (collected.length > set.length) requireThat(false, "Sorted cursor repeats results");
  } while (after);
  requireThat(
    canonical(collected) === canonical(expected),
    "Query sorting/continuation order is wrong",
  );
  const p = decoded(
    await request(
      "?" +
        new URLSearchParams({
          filter: JSON.stringify(filter),
          sort: JSON.stringify(sort),
          limit: String(Math.min(set.length, caps.core.list.maxLimit ?? 100)),
        }),
    ),
  );
  requireThat(
    canonical(p.items.map((r) => identity(r.id, scope))) ===
      canonical(expected.slice(0, p.items.length)),
    "List sorting is wrong",
  );
  if (first)
    await fault("stdlib/query:call", [400, 410, 422], undefined, {
      method: "POST",
      body: {
        arguments: [
          { name: "where", value: where },
          { name: "sort", value: [{ field: ["id", "id"], order: "desc" }] },
          { name: "request", value: { after: first, limit: 2 } },
        ],
        idempotencyKey: "sort-cursor-test",
      },
    });
}
export async function graphCase({ caps, resources, scope, invoke, fault }) {
  const edge = resources.find((r) => r.body?.source?.id && r.body?.target?.id);
  requireThat(!!edge, "Graph needs a relationship witness");
  const root = edge.body.source,
    edges = resources.filter((r) => r.body?.source?.id && r.body?.target?.id),
    byKey = new Map(resources.map((r) => [identity(r.id, scope), r]));
  for (const direction of ["out", "in", "both"])
    for (const depth of [0, 1, 2]) {
      const adjacency = new Map();
      for (const e of edges) {
        const s = identity(e.body.source, scope),
          t = identity(e.body.target, scope);
        for (const [a, b] of [
          ...(direction !== "in" ? [[s, t]] : []),
          ...(direction !== "out" ? [[t, s]] : []),
        ]) {
          const entries = adjacency.get(a) ?? [];
          entries.push([b, e]);
          adjacency.set(a, entries);
        }
      }
      const depths = new Map([[identity(root, scope), 0]]),
        visitedEdges = new Set(),
        queue = [identity(root, scope)];
      for (const current of queue) {
        const level = depths.get(current);
        if (level >= depth) continue;
        for (const [to, e] of adjacency.get(current) ?? []) {
          visitedEdges.add(identity(e.id, scope));
          if (!depths.has(to)) {
            depths.set(to, level + 1);
            queue.push(to);
          }
        }
      }
      const g = await invoke("graph", { roots: [root], direction, depth });
      requireThat(
        g && Array.isArray(g.nodes) && Array.isArray(g.edges),
        "Graph must return Subgraph, not Page",
      );
      requireThat(
        g.nodes.length === depths.size &&
          new Set(g.nodes.map((n) => identity(n.resource, scope))).size === g.nodes.length,
        "Graph duplicates or omits nodes",
      );
      for (const n of g.nodes) {
        requireThat(
          n.depth === depths.get(identity(n.resource, scope)),
          "Graph did not retain minimum BFS depth",
        );
        requireThat(
          n.resource.rev === byKey.get(identity(n.resource, scope))?.id.rev,
          "Graph node lost revision",
        );
      }
      requireThat(
        canonical(g.edges.map((e) => identity(e.edge, scope)).sort()) ===
          canonical([...visitedEdges].sort()),
        "Graph omitted traversed/cycle edges",
      );
      for (const e of g.edges) {
        const original = byKey.get(identity(e.edge, scope));
        requireThat(
          e.type === original.type &&
            identity(e.source, scope) === identity(original.body.source, scope) &&
            identity(e.target, scope) === identity(original.body.target, scope),
          "Graph edge endpoints changed",
        );
      }
    }
  const prefix = edge.type.slice(0, -1),
    g = await invoke("graph", { roots: [root], depth: 1, edgeTypes: [prefix] });
  requireThat(
    g.edges.length === 0 && g.nodes.length === 1,
    "Graph edge type prefixes must end on segment boundaries",
  );
  const max = caps.packs.stdlib.graph.maxGraphDepth;
  requireThat(Number.isSafeInteger(max) && max >= 2, "Graph needs advertised depth limit");
  await fault("stdlib/graph:call", [400, 422], "graph-depth-exceeded", {
    method: "POST",
    body: {
      arguments: [
        { name: "roots", value: [root] },
        { name: "depth", value: max + 1 },
      ],
      idempotencyKey: "graph-depth-test",
    },
  });
}
export async function duplicatesCase({ resources, scope, invoke, fault }) {
  const witness = resources.find((r) => r.body?.kind !== undefined);
  requireThat(!!witness, "Duplicates needs content-bearing witness");
  const selected = resources.filter((r) => r.type === witness.type).slice(0, 20),
    where = {
      kind: "cond",
      condition: {
        kind: "compare",
        field: ["id", "id"],
        op: "in",
        value: selected.map((r) => r.id.id),
      },
    };
  const groups = new Map();
  for (const r of selected) {
    const k = canonical(r.body.kind);
    groups.set(k, [...(groups.get(k) ?? []), identity(r.id, scope)]);
  }
  const expected = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort())
    .sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const actual = await invoke("duplicates", {
    type: witness.type,
    fields: [["body", "kind"]],
    where,
  });
  requireThat(Array.isArray(actual), "Duplicates must return an array");
  const members = actual
    .map((g) => {
      requireThat(
        Array.isArray(g.members) && g.members.length >= 2,
        "Duplicate groups need at least two members",
      );
      return g.members
        .map((r) => {
          reference(r);
          return identity(r, scope);
        })
        .sort();
    })
    .sort((a, b) => canonical(a).localeCompare(canonical(b)));
  requireThat(
    canonical(members) === canonical(expected),
    "Duplicate groups do not match identical field tuples",
  );
  await fault("stdlib/duplicates:call", [400, 422], undefined, {
    method: "POST",
    body: {
      arguments: [{ name: "type", value: witness.type }],
      idempotencyKey: "duplicates-fields-test",
    },
  });
}
export async function similarCase({ caps, resources, scope, invoke, fault }) {
  const witness = resources.find((r) => typeof r.body?.text === "string");
  requireThat(!!witness, "Similarity needs text-bearing witnesses");
  const selected = resources.filter((r) => r.type === witness.type).slice(0, 8),
    keys = new Set(selected.map((r) => identity(r.id, scope))),
    where = {
      kind: "cond",
      condition: {
        kind: "compare",
        field: ["id", "id"],
        op: "in",
        value: selected.map((r) => r.id.id),
      },
    };
  const pairs = await invoke("similar", {
    type: witness.type,
    fields: [["body", "text"]],
    where,
    threshold: 0,
    limit: 3,
  });
  requireThat(
    Array.isArray(pairs) && pairs.length > 0 && pairs.length <= 3,
    "Similarity must return bounded ranked pairs",
  );
  const seen = new Set();
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i],
      a = identity(p.a, scope),
      b = identity(p.b, scope),
      key = canonical([a, b].sort());
    requireThat(
      a !== b && keys.has(a) && keys.has(b) && !seen.has(key),
      "Similarity repeated a pair or ignored type/predicate",
    );
    seen.add(key);
    requireThat(
      Number.isFinite(p.score) && p.score >= 0 && (!i || pairs[i - 1].score >= p.score),
      "Similarity score ordering/threshold is wrong",
    );
  }
  const none = await invoke("similar", {
    type: witness.type,
    fields: [["body", "text"]],
    where: { kind: "any", of: [] },
    threshold: 0,
    limit: 1,
  });
  requireThat(Array.isArray(none) && none.length === 0, "Similarity ignored predicate");
  const modes = caps.packs.stdlib.similar.similarityModes ?? ["lexical"];
  if (!modes.includes("semantic"))
    await fault("stdlib/similar:call", [400, 422], "similarity-mode-unsupported", {
      method: "POST",
      body: {
        arguments: [
          { name: "type", value: witness.type },
          { name: "fields", value: [["body", "text"]] },
          { name: "mode", value: "semantic" },
        ],
        idempotencyKey: "similar-mode-test",
      },
    });
}
export async function lintCase({ resources, scope, invoke }) {
  const declarations = resources.filter(
    (r) => r.type === "core/type-def" && Array.isArray(r.metadata?.lint),
  );
  const byType = new Map(
    declarations.map((d) => [d.id.id.replace(/^types\//, ""), d.metadata.lint]),
  );
  const selected = declarations.length
      ? [...byType.keys()].flatMap((type) => resources.filter((r) => r.type === type).slice(0, 4))
      : resources.slice(0, 16),
    where = {
      kind: "cond",
      condition: {
        kind: "compare",
        field: ["id", "id"],
        op: "in",
        value: selected.map((r) => r.id.id),
      },
    };
  const actual = await invoke("lint", { where, limit: 100 });
  requireThat(
    Array.isArray(actual) && actual.length <= 100,
    "Lint must return bounded findings array",
  );
  const expected = new Map();
  for (const r of selected) {
    const findings = [];
    for (const rule of byType.get(r.type) ?? []) {
      let v = r;
      for (const p of rule.field ?? []) v = v && Object.hasOwn(v, p) ? v[p] : undefined;
      if (
        (rule.required && (v === undefined || v === null)) ||
        (rule.nonempty && (typeof v !== "string" || !v.trim()))
      )
        findings.push(rule.message);
      if (
        rule.reference &&
        v?.id &&
        !resources.some((t) => identity(t.id, scope) === identity(v, scope))
      )
        findings.push(rule.message);
    }
    expected.set(identity(r.id, scope), [...new Set(findings)].sort());
  }
  const seen = new Set();
  for (const item of actual) {
    const key = identity(item.resource, scope);
    requireThat(
      expected.has(key) &&
        !seen.has(key) &&
        Array.isArray(item.findings) &&
        item.findings.every((s) => typeof s === "string"),
      "Lint ignored predicate or produced malformed findings",
    );
    seen.add(key);
    if (declarations.length)
      requireThat(
        canonical([...item.findings].sort()) === canonical(expected.get(key)),
        "Lint findings differ from declared requirements",
      );
  }
  for (const [key, findings] of expected)
    requireThat(
      !findings.length || seen.has(key),
      "Lint omitted a resource with declared-rule violations",
    );
  const empty = await invoke("lint", { where: { kind: "any", of: [] }, limit: 1 });
  requireThat(Array.isArray(empty) && empty.length === 0, "Lint ignored empty predicate");
}
export async function historyCase({ caps, resources, scope, request, decoded, fault }) {
  requireThat(
    !!caps.core.revisions && caps.scope.revisionModel === "versioned",
    "Required versioned resource history capability is missing",
  );
  await fault("./%ZZ:revisions", [400], undefined);
  const samples = [...new Map(resources.map((r) => [r.type, r])).values()].slice(0, 16);
  for (const r of samples) {
    const values = [],
      cursors = new Set();
    let after;
    do {
      const path = `${r.id.id.split("/").map(encodeURIComponent).join("/")}:revisions`;
      const p = decoded(
        await request(
          `./${path}?${new URLSearchParams({ limit: "1", ...(after ? { after } : {}) })}`,
        ),
      );
      requireThat(Array.isArray(p.items), "History must return Page");
      values.push(...p.items);
      after = p.cursor;
      if (after) {
        requireThat(!cursors.has(after), "History cursor did not advance");
        cursors.add(after);
      }
      requireThat(values.length < 10000, "History exceeded case bound");
    } while (after);
    requireThat(
      values.length > 0 && values.some((v) => v.id.rev === r.id.rev),
      "History omits known current revision",
    );
    const revisions = new Set();
    for (const v of values) {
      resource(v);
      requireThat(
        identity(v.id, scope) === identity(r.id, scope) &&
          typeof v.id.rev === "string" &&
          !revisions.has(v.id.rev),
        "History repeats a revision or crosses resource identity",
      );
      revisions.add(v.id.rev);
      const url =
        v.id.id.split("/").map(encodeURIComponent).join("/") +
        "?revision=" +
        encodeURIComponent(v.id.rev);
      requireThat(
        canonical(decoded(await request(url))) === canonical(v),
        "Pinned history Get differs from immutable revision",
      );
    }
  }
}
