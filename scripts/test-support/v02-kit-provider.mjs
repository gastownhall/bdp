// Small wire fixture for CHECKER regression tests, not a substitute for provider staging.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
export async function serveFixture(mutation = "none") {
  const extended = mutation.startsWith("extended");
  let origin;
  const caps = {
    core: {
      get: { selector: true },
      list: {
        conditions: [
          "compare",
          "matches",
          "has",
          "missing",
          "contains",
          "containsAny",
          "excludes",
          "isType",
        ],
        selector: true,
        sort: false,
        maxLimit: 2,
      },
      pull: { sse: false, jsonl: true, filter: false, selector: false },
      export: { revisions: false },
    },
    scope: { storageClasses: [], revisionModel: "versioned", idModel: "permanent" },
    packs: { stdlib: { query: { via: true }, count: {} } },
  };
  // A scope advertising the alias overlay: the kit must FLAG the unexercised read
  // obligation (Alias#2 -> not-run), never silently qualify it.
  if (mutation === "aliases-advertised") caps.scope.aliases = {};
  const wrap = (id, type, body) => ({
    id: { id, rev: "1" },
    type,
    body,
    storageClass: { kind: "intrinsic" },
  });
  const a = wrap("a", "note", { title: "Alpha", priority: 10, tags: ["red"] }),
    b = wrap("b", "note/task", { title: "Beta", priority: 2, tags: ["blue"] }),
    c = wrap("c", "notebook", { title: "Gamma", priority: 0, tags: [] });
  const data = [
    a,
    b,
    c,
    wrap("edge/ab", "edge", { source: { id: "a" }, target: { id: "b" } }),
    wrap("sys/capabilities", "capabilities", caps),
    wrap("sys/changes", "channel", {
      direction: "source",
      pushSchema: null,
      pullSchema: { type: "object" },
      retention: { kind: "forever" },
      cardinality: "broadcast",
    }),
  ];
  if (extended) {
    a.body.text = "Alpha reference content ".repeat(6);
    b.body.text = "Beta reference content ".repeat(6);
    a.body.kind = b.body.kind = "article";
    a.body.ordinal = 2;
    b.body.ordinal = 10;
    c.body.ordinal = 0;
    b.type = "note";
    caps.core.list.sort = true;
    caps.packs.stdlib.query.sortOrder = "scalar";
    caps.core.pull.sse = true;
    caps.core.revisions = {};
    caps.core.export.revisions = true;
    Object.assign(caps.packs.stdlib, {
      search: { modes: ["lexical"] },
      graph: { maxGraphDepth: 4 },
      duplicates: {},
      similar: { similarityModes: ["lexical"] },
      lint: {},
    });
    data.push(wrap("edge/ba", "edge", { source: { id: "b" }, target: { id: "a" } }));
    const decl = wrap("types/note", "core/type-def", {
      properties: [{ name: "title", type: { type: "string" } }],
    });
    decl.metadata = {
      lint: [{ field: ["body", "published"], required: true, message: "Publication date missing" }],
    };
    data.push(decl);
  }
  const field = (r, path) => {
    let x = r;
    for (const p of path) {
      if (x === null || typeof x !== "object" || !Object.hasOwn(x, p)) return { exists: false };
      x = x[p];
    }
    return { exists: true, value: x };
  };
  // Kept separate from the checker reference evaluator. Tests below also assert literal results.
  function match(c, r) {
    if (c.kind === "is-type")
      return r.type === c.type || (c.match !== "exact" && r.type.startsWith(`${c.type}/`));
    const f = field(r, c.field);
    if (c.kind === "has") return f.exists;
    if (c.kind === "missing") return !f.exists;
    if (!f.exists) return false;
    const x = f.value;
    if (c.kind === "matches") {
      if (typeof x !== "string") return false;
      if (c.using === "substring") return x.includes(c.pattern);
      if (c.using === "glob") return c.pattern === "*" || x === c.pattern;
      throw Error();
    }
    if (c.kind === "contains")
      return Array.isArray(x) && x.some((y) => isDeepStrictEqual(y, c.value));
    if (c.kind === "contains-any")
      return Array.isArray(x) && x.some((y) => c.values.some((z) => isDeepStrictEqual(y, z)));
    if (c.kind === "excludes")
      return Array.isArray(x) && !x.some((y) => isDeepStrictEqual(y, c.value));
    if (c.op === "eq") return isDeepStrictEqual(x, c.value);
    if (c.op === "ne") return !isDeepStrictEqual(x, c.value);
    if (c.op === "in") return c.value.some((y) => isDeepStrictEqual(x, y));
    const l = String(x),
      rvalue = String(c.value);
    return { lt: l < rvalue, le: l <= rvalue, gt: l > rvalue, ge: l >= rvalue }[c.op];
  }
  function admit(expr) {
    if (!expr || typeof expr !== "object" || Array.isArray(expr)) throw Error();
    const keys = {
      all: ["kind", "of"],
      any: ["kind", "of"],
      not: ["kind", "expr"],
      cond: ["kind", "condition"],
      via: ["kind", "edge", "direction", "where"],
    }[expr.kind];
    if (!keys || Object.keys(expr).some((k) => !keys.includes(k))) throw Error();
    if (["all", "any"].includes(expr.kind)) {
      if (!Array.isArray(expr.of)) throw Error();
      expr.of.forEach(admit);
    }
    if (expr.kind === "not") admit(expr.expr);
    if (expr.kind === "via" && expr.where) admit(expr.where);
    if (
      expr.kind === "cond" &&
      !Array.isArray(expr.condition.field) &&
      expr.condition.kind !== "is-type"
    )
      throw Error();
  }
  function predicate(expr, r) {
    switch (expr.kind) {
      case "all":
        return expr.of.every((x) => predicate(x, r));
      case "any":
        return expr.of.some((x) => predicate(x, r));
      case "not":
        return !predicate(expr.expr, r);
      case "cond":
        return match(expr.condition, r);
      case "via":
        return data
          .filter((x) => x.type === expr.edge)
          .some((edge) => {
            const inbound = mutation === "via-direction" ? false : expr.direction === "in";
            const from = inbound ? edge.body.target : edge.body.source,
              to = inbound ? edge.body.source : edge.body.target;
            const neighbor = data.find((r) => r.id.id === to.id);
            return from.id === r.id.id && (!expr.where || predicate(expr.where, neighbor));
          });
    }
  }
  function select(r, s) {
    if (!s) return structuredClone(r);
    if (s.include?.includes("")) return structuredClone(r);
    const out = s.include ? { id: r.id, type: r.type } : structuredClone(r);
    if (s.include?.includes("/body/title") && r.body.title !== undefined)
      out.body = { title: r.body.title };
    if (s.omit?.includes("/body")) delete out.body;
    return mutation === "selector" ? structuredClone(r) : out;
  }
  const token = (stream, selection, offset) =>
    Buffer.from(JSON.stringify({ stream, selection, offset })).toString("base64url");
  const position = (t, stream, selection) => {
    const c = JSON.parse(Buffer.from(t, "base64url"));
    if (c.stream !== stream || (mutation !== "cursor-unbound" && c.selection !== selection))
      throw Error();
    return c.offset;
  };
  function window(items, request = {}, selection = "all", stream = "list", selector) {
    if (request.after !== undefined && request.from !== undefined) throw Error();
    const start = request.after
      ? position(request.after, stream, selection)
      : Number(request.from ?? 0);
    const n = Number(request.limit ?? (mutation === "default-limit" ? 1 : 2));
    const end = Math.min(items.length, start + n);
    return {
      items: items.slice(start, end).map((r) => select(r, selector)),
      cursor: end < items.length ? token(stream, selection, end) : null,
      head: end === items.length,
    };
  }
  const sorted = (items, sort) =>
    !sort || mutation === "extended-sort"
      ? items
      : [...items].sort((a, b) => {
          for (const k of sort) {
            const left = field(a, k.field).value,
              right = field(b, k.field).value,
              x = typeof left === "number" && typeof right === "number" ? left : String(left),
              y = typeof left === "number" && typeof right === "number" ? right : String(right),
              n = x < y ? -1 : x > y ? 1 : 0;
            if (n) return k.order === "desc" ? -n : n;
          }
          return a.id.id < b.id.id ? -1 : a.id.id > b.id.id ? 1 : 0;
        });
  function optional(name, args, items, fail) {
    if (name === "search") {
      if (args.mode && args.mode !== "lexical") fail(422, "search-mode-unsupported");
      const matches = items
        .filter((r) => JSON.stringify(r.body).toLowerCase().includes(args.text.toLowerCase()))
        .slice(0, args.limit ?? 20)
        .map((r) => ({
          resource: args.select ? select(r, args.select) : r.id,
          score: 1,
          snippet: r.body.text ?? r.body.title,
        }));
      return mutation === "extended-search" ? { items: matches, cursor: null } : matches;
    }
    if (name === "graph") {
      if (args.depth > 4) fail(422, "graph-depth-exceeded");
      const dir = args.direction ?? "out",
        depth = args.depth ?? 1,
        depths = new Map(args.roots.map((r) => [r.id, 0])),
        queue = [...depths.keys()],
        edges = new Map();
      for (const current of queue) {
        if (depths.get(current) >= depth) continue;
        for (const edge of data.filter((r) => r.body.source && r.body.target)) {
          if (
            args.edgeTypes &&
            !args.edgeTypes.some((t) => edge.type === t || edge.type.startsWith(`${t}/`))
          )
            continue;
          const next = [];
          if (dir !== "in" && edge.body.source.id === current) next.push(edge.body.target.id);
          if (dir !== "out" && edge.body.target.id === current) next.push(edge.body.source.id);
          for (const id of next) {
            edges.set(edge.id.id, {
              edge: edge.id,
              type: edge.type,
              source: edge.body.source,
              target: edge.body.target,
            });
            if (!depths.has(id)) {
              depths.set(id, depths.get(current) + 1);
              queue.push(id);
            }
          }
        }
      }
      return {
        nodes: queue.map((id) => ({
          resource: data.find((r) => r.id.id === id).id,
          depth: depths.get(id),
        })),
        edges: mutation === "extended-graph" ? [] : [...edges.values()],
      };
    }
    if (name === "duplicates") {
      if (!args.fields) fail();
      const groups = new Map();
      for (const r of items.filter(
        (r) => r.type === args.type || r.type.startsWith(`${args.type}/`),
      )) {
        const k = JSON.stringify(args.fields.map((f) => field(r, f).value));
        groups.set(k, [...(groups.get(k) ?? []), r.id]);
      }
      return mutation === "extended-duplicates"
        ? [{ members: [a.id] }]
        : [...groups.values()].filter((g) => g.length > 1).map((members) => ({ members }));
    }
    if (name === "similar") {
      if (args.mode && args.mode !== "lexical") fail(422, "similarity-mode-unsupported");
      const selected = items.filter(
          (r) => r.type === args.type || r.type.startsWith(`${args.type}/`),
        ),
        pairs = [];
      for (let i = 0; i < selected.length; i++)
        for (let j = i + 1; j < selected.length; j++)
          if ((args.threshold ?? 0) <= 0.5)
            pairs.push({
              a: selected[i].id,
              b: mutation === "extended-similar" ? selected[i].id : selected[j].id,
              score: 0.5,
            });
      return pairs.slice(0, args.limit ?? 20);
    }
    if (name === "lint")
      return mutation === "extended-lint"
        ? []
        : items
            .filter((r) => r.type === "note" && !r.body.published)
            .slice(0, args.limit ?? 100)
            .map((r) => ({ resource: r.id, findings: ["Publication date missing"] }));
  }
  const server = http.createServer(async (req, res) => {
    // Model an HTTP server rejecting a malformed request target before routing.
    // This is not a BDP reply and deliberately carries no protocol headers.
    if (mutation === "extended-edge-parser" && /%(?![0-9a-f]{2})/i.test(req.url)) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h1>400 Bad Request</h1>");
      return;
    }
    const url = new URL(req.url, origin),
      method = req.method;
    let code = 200,
      contentType = "application/json",
      value;
    const cause = req.headers["bdp-cause"] ?? randomUUID();
    res.setHeader("BDP-Cause", cause);
    const fail = (status = 400, code = "invalid-parameter") => {
      throw Object.assign(Error(), { status, code });
    };
    try {
      const bytes = ["bdp-cause", "bdp-provenance", "bdp-metadata"].reduce(
        (n, k) => n + Buffer.byteLength(req.headers[k] ?? ""),
        0,
      );
      if (bytes > (mutation === "context-floor" ? 4095 : 4096)) fail(413, "request-too-large");
      if (!["GET", "HEAD", "POST"].includes(method)) fail(405, "capability-not-supported");
      const format =
        url.searchParams.get("format") ??
        (req.headers.accept === "application/jsonl"
          ? "jsonl"
          : req.headers.accept === "text/event-stream"
            ? "sse"
            : undefined);
      const accept = req.headers.accept;
      if (accept === "text/html" || accept?.startsWith("application/json;q=0"))
        fail(406, "capability-not-supported");
      if (method === "POST") {
        const name = /^\/stdlib\/([a-z]+)\/-\/call$/.exec(url.pathname)?.[1];
        if (
          ![
            "query",
            "count",
            ...(extended ? ["search", "graph", "duplicates", "similar", "lint"] : []),
          ].includes(name)
        )
          fail(405, "capability-not-supported");
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks));
        const args = Object.fromEntries(input.arguments.map((a) => [a.name, a.value]));
        let where = args.where ?? { kind: "all", of: [] };
        try {
          admit(where);
        } catch {
          if (mutation !== "malformed-query") fail(400, "malformed-query");
          where = { kind: "any", of: [] };
        }
        const items = sorted(
          data.filter((r) => predicate(where, r)),
          args.sort,
        );
        let result = url.pathname.includes("count")
          ? items.length
          : window(
              items,
              args.request,
              JSON.stringify([
                where,
                args.select,
                args.request?.select,
                ...(args.sort ? [args.sort] : []),
              ]),
              "query",
              args.select ?? args.request?.select,
            );
        if (!["query", "count"].includes(name)) result = optional(name, args, items, fail);
        if (mutation === "count" && typeof result === "number") result = String(result);
        value = {
          outcome: { kind: "success", value: result },
          cause: input.causedBy ?? cause,
          callId: randomUUID(),
        };
        res.setHeader("BDP-Cause", value.cause);
        if (mutation === "safe-transaction") value.transaction = "invented-commit";
      } else if (
        url.pathname === "/sys/changes" &&
        (mutation === "channel-point" ||
          (!url.searchParams.has("revision") && !url.searchParams.has("select")))
      ) {
        if (format === "sse") {
          if (!extended) fail(422, "capability-not-supported");
          if (url.searchParams.has("after") && url.searchParams.get("after") !== "cut") fail();
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write(": waiting\n\n");
          if (mutation === "extended-live") res.end();
          return;
        }
        if (url.searchParams.has("after") && url.searchParams.get("after") !== "cut") fail();
        value = { items: [], cursor: "cut", head: true };
        if (format === "jsonl") {
          contentType = "application/jsonl";
          value = "";
        }
      } else if (url.pathname === "/-/export") {
        if (!extended && url.searchParams.get("revisions") === "true")
          fail(422, "capability-not-supported");
        contentType = "application/jsonl";
        const records = [
          {
            kind: "export-begin",
            scope: `${origin}/`,
            cursor: mutation === "export-cut" ? "wrong-cut" : "cut",
          },
          ...data,
          { kind: "export-end", count: mutation === "export-count" ? 999 : data.length },
        ];
        if (mutation === "export-truncated") records.pop();
        if (mutation === "export-state") records[1] = { ...records[1], body: { title: "changed" } };
        value = `${records.map(JSON.stringify).join("\n")}\n`;
      } else if (url.pathname === "/") {
        // GET / is the discovery signpost (ServiceDescriptor), not the collection.
        value = {
          version: mutation === "bad-version" ? "nope" : "0.2.3",
          base: `${origin}/`,
          links: {
            serviceDesc: `${origin}/bdp/openapi`,
            serviceMeta: `${origin}/sys/capabilities`,
            changes: `${origin}/sys/changes`,
          },
        };
        res.setHeader(
          "Link",
          `<${origin}/bdp/openapi>; rel="service-desc", <${origin}/sys/capabilities>; rel="service-meta"`,
        );
      } else if (url.pathname === "/-/list") {
        // The scope collection moved off the bare root to the action fence (/-/list).
        if (format === "sse") fail(400, "invalid-parameter");
        const where = JSON.parse(url.searchParams.get("where") ?? "[]");
        if (where.some((c) => c.kind !== "is-type" && !Array.isArray(c.field))) fail();
        const items = sorted(
          mutation === "filter" ? data : data.filter((r) => where.every((c) => match(c, r))),
          url.searchParams.has("sort") ? JSON.parse(url.searchParams.get("sort")) : undefined,
        );
        if (format === "jsonl") {
          if (mutation === "no-jsonl") fail(422, "capability-not-supported");
          contentType = "application/jsonl";
          const start = url.searchParams.has("after")
            ? position(
                url.searchParams.get("after"),
                "list",
                JSON.stringify([where, url.searchParams.get("select")]),
              )
            : 0;
          value = `${items.slice(start).map(JSON.stringify).join("\n")}\n`;
        } else
          value = window(
            items,
            Object.fromEntries(url.searchParams),
            JSON.stringify([where, url.searchParams.get("select")]),
            "list",
            url.searchParams.has("select") ? JSON.parse(url.searchParams.get("select")) : undefined,
          );
      } else {
        if (mutation === "magic-path" && url.searchParams.get("select")?.includes("__proto__"))
          fail();
        const id = decodeURIComponent(url.pathname.slice(1));
        if (id.endsWith("/-/revisions")) {
          if (!extended) fail(422, "capability-not-supported");
          const found = data.find((r) => r.id.id === id.slice(0, -"/-/revisions".length));
          if (!found) fail(404, "resource-not-found");
          value = window(
            mutation === "extended-history" ? [] : [found],
            Object.fromEntries(url.searchParams),
            id,
            "revisions",
          );
        } else {
          const found = data.find((r) => r.id.id === id);
          if (!found) fail(404, "resource-not-found");
          res.setHeader("ETag", '"1"');
          if (req.headers["if-none-match"] === '"1"') {
            res.writeHead(304);
            res.end();
            return;
          }
          value = select(
            found,
            url.searchParams.has("select")
              ? JSON.parse(url.searchParams.get("select"))
              : undefined,
          );
        }
      }
      if (mutation === "extra-envelope") {
        const mutate = (r) =>
          r?.id && r.type ? { ...r, notDefined: "DO_NOT_REPORT_SERVER_VALUE" } : r;
        if (contentType === "application/json") {
          if (value?.items) value.items = value.items.map(mutate);
          else value = mutate(value);
        }
      }
      if (mutation === "storage" && value?.id) value.storageClass = "intrinsic";
      if (mutation === "discovery" && url.pathname === "/sys/capabilities")
        value.body = { ...value.body, core: { list: caps.core.list } };
      if (mutation === "missing-cause") res.removeHeader("BDP-Cause");
    } catch (error) {
      code = error.status ?? 400;
      contentType = "application/problem+json";
      value = {
        type: "urn:bdp:test-problem",
        title: "Fixture refusal",
        status: code,
        code: error.code ?? "invalid-parameter",
        retry: "never",
      };
    }
    if (
      mutation === "extended-history-missing-cause" &&
      code === 400 &&
      url.pathname.endsWith("/-/revisions")
    )
      res.removeHeader("BDP-Cause");
    res.writeHead(code, { "Content-Type": contentType });
    res.end(
      method === "HEAD"
        ? undefined
        : typeof value === "string" && contentType !== "application/json"
          ? value
          : JSON.stringify(value),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    scope: `${origin}/`,
    cleanup: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
