// Small wire fixture for CHECKER regression tests, not a substitute for provider staging.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
export async function serveFixture(mutation = "none") {
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
    scope: { storageClasses: [], revisionModel: "versioned" },
    packs: { stdlib: { query: { via: true }, count: {} } },
  };
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
  const server = http.createServer(async (req, res) => {
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
        (req.headers.accept === "application/jsonl" ? "jsonl" : undefined);
      const accept = req.headers.accept;
      if (accept === "text/html" || accept?.startsWith("application/json;q=0"))
        fail(406, "capability-not-supported");
      if (method === "POST") {
        if (!["/stdlib/query:call", "/stdlib/count:call"].includes(url.pathname))
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
        const items = data.filter((r) => predicate(where, r));
        let result = url.pathname.includes("count")
          ? items.length
          : window(
              items,
              args.request,
              JSON.stringify([where, args.select, args.request?.select]),
              "query",
              args.select ?? args.request?.select,
            );
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
          (!url.searchParams.has("revision") && !url.searchParams.has("selector")))
      ) {
        if (format === "sse") fail(422, "capability-not-supported");
        if (url.searchParams.has("after") && url.searchParams.get("after") !== "cut") fail();
        value = { items: [], cursor: "cut", head: true };
        if (format === "jsonl") {
          contentType = "application/jsonl";
          value = "";
        }
      } else if (url.pathname === "/bdp/export") {
        if (url.searchParams.get("revisions") === "true") fail(422, "capability-not-supported");
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
        if (format === "sse") fail(422, "capability-not-supported");
        const where = JSON.parse(url.searchParams.get("filter") ?? "[]");
        if (where.some((c) => c.kind !== "is-type" && !Array.isArray(c.field))) fail();
        const items =
          mutation === "filter" ? data : data.filter((r) => where.every((c) => match(c, r)));
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
        const id = decodeURIComponent(url.pathname.slice(1));
        if (id.endsWith(":revisions")) fail(422, "capability-not-supported");
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
          url.searchParams.has("selector")
            ? JSON.parse(url.searchParams.get("selector"))
            : undefined,
        );
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
  return { scope: `${origin}/`, cleanup: () => new Promise((resolve) => server.close(resolve)) };
}
