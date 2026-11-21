import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  resource,
  capabilities,
  page,
  reply,
  problem,
  descriptor,
  changeEvent,
  requireThat,
  Violation,
  writeCapabilities,
} from "./contract.mjs";
import { canonical, identity, filter, query, projected } from "./evaluate.mjs";
import { transport, parseJson, HarnessError, hash } from "./transport.mjs";
import { loadCoverage, qualify } from "./specification.mjs";
export const rowIds = [
  "spec.coverage",
  "core.discovery",
  "core.read-only",
  "core.inventory",
  "core.representations",
  "core.point-read",
  "core.stability",
  "core.absence",
  "core.http",
  "core.context",
  "core.projection",
  "core.list-filter",
  "core.list-cursors",
  "core.list-formats",
  "core.descriptors",
  "stdlib.query",
  "stdlib.query-cursors",
  "stdlib.query-rejections",
  "stdlib.query-via",
  "stdlib.count",
  "core.feed",
  "core.export",
  "core.safe-reads",
  "core.unoffered",
  "core.history",
  "core.restart",
];
export class NotApplicable extends Error {}
export class NotRun extends Error {}
const ifOffered = (condition, reason) => {
  if (!condition) throw new NotApplicable(reason);
};
const cond = (condition) => ({ kind: "cond", condition });
export async function runV02Provider(target, options = {}) {
  const report = {
    kit: "bdp-v0.2-read-only",
    qualificationScope: "Core read-only; advertised stdlib query/count",
    specification:
      "https://github.com/gastownhall/bdp/blob/e108a3241e8127e5325748e9325aedd984ff5117/specs/src/core/core.lumen",
    profile: "read-only",
    scope: target.scope,
    qualificationComplete: false,
    claimEligible: false,
    obligations: [],
    exchanges: [],
    lifecycle: { provision: "pass", cleanup: "not-run" },
  };
  const io = transport(target.scope, { ...options, authorization: target.authorization });
  let coverage,
    caps,
    discovery,
    resources,
    samples,
    initialFeed,
    readOnlyVerified = false;
  const safeCalls = new Set();
  const progress = options.progress ?? (() => {}),
    done = new Map();
  const requiredValue = (value, name) => {
    if (value === undefined) throw new NotRun(`Prerequisite did not complete: ${name}`);
    return value;
  };
  const urlOf = (ref) => {
    const scope = ref.scope ?? target.scope;
    if (scope === "uri") return ref.id;
    return new URL(ref.id.split("/").map(encodeURIComponent).join("/"), scope).href;
  };
  const pointUrl = (r) => {
    const url = new URL(urlOf(r.id));
    if (r.type.split("/").at(-1) === "channel") {
      if (r.id.rev !== undefined) url.searchParams.set("revision", r.id.rev);
      else if (caps.core.get.selector) url.searchParams.set("selector", "{}");
      else
        throw new NotRun(
          "Get/Pull share a channel URL; no defined disambiguating parameter is available",
        );
    }
    return url.href;
  };
  const decoded = (r, expected = 200) => {
    requireThat(r.status === expected, "Unexpected HTTP status");
    requireThat(
      (r.headers["content-type"] ?? "").split(";")[0].trim() === "application/json",
      "Expected application/json",
    );
    return parseJson(r.text);
  };
  const causeHeader = (r) => {
    requireThat(
      typeof r.headers["bdp-cause"] === "string" && r.headers["bdp-cause"].length > 0,
      "Missing response BDP-Cause",
    );
    requireThat(
      r.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === "bdp-cause").length === 1,
      "Repeated response BDP-Cause",
    );
  };
  const request = async (...args) => {
    const r = await io.request(...args);
    causeHeader(r);
    return r;
  };
  const fault = async (target, statuses, code, init) => {
    const r = await request(target, init);
    requireThat(statuses.includes(r.status), "Expected refusal HTTP status");
    requireThat(
      (r.headers["content-type"] ?? "").split(";")[0].trim() === "application/problem+json",
      "Fault must use application/problem+json",
    );
    const p = parseJson(r.text);
    problem(p, r.status);
    if (code) requireThat(p.code === code, "Incorrect Problem code");
    return p;
  };
  const key = (r) => identity(r.id, target.scope);
  const sameSet = (actual, expected) => {
    requireThat(
      actual.length === new Set(actual.map(key)).size,
      "Result repeats a resource identity",
    );
    requireThat(
      canonical(actual.map(key).sort()) === canonical(expected.map(key).sort()),
      "Read selected the wrong resource identities",
    );
  };
  const collect = async (load, { check = () => {}, name = "stream" } = {}) => {
    const result = [],
      _seen = new Set(),
      tokens = new Set();
    let after;
    for (let n = 0; n < (options.maxPages ?? 10000); n++) {
      const p = await load(after);
      page(p);
      for (const r of p.items) {
        check(r);
        result.push(r);
      }
      if (p.head === true || p.cursor == null) return result;
      requireThat(!tokens.has(p.cursor), "Continuation cursor made no progress");
      tokens.add(p.cursor);
      after = p.cursor;
      if (n && n % 100 === 0) progress({ stream: name, pages: n, items: result.length });
    }
    throw new HarnessError("Read exceeded checker page bound");
  };
  const list = async (where, extra = {}) =>
    collect(
      async (after) => {
        const p = new URLSearchParams({
          ...extra,
          ...(where === undefined ? {} : { filter: JSON.stringify(where) }),
          ...(after ? { after } : {}),
        });
        return decoded(await request(`?${p}`));
      },
      { check: (r) => resource(r, { revisionModel: caps.scope.revisionModel }), name: "list" },
    );
  const invoke = async (name, args, init = {}) => {
    const cause = randomUUID();
    const r = await request(`stdlib/${name}:call`, {
      method: "POST",
      body: {
        arguments: Object.entries({ scope: null, ...args }).map(([name, value]) => ({
          name,
          value,
        })),
        idempotencyKey: randomUUID(),
        causedBy: cause,
      },
      ...init,
    });
    const v = decoded(r);
    reply(v);
    requireThat(v.outcome.kind === "success", "Safe operation did not succeed");
    requireThat(
      v.cause === cause && r.headers["bdp-cause"] === cause,
      "Call correlation was not propagated",
    );
    requireThat(
      v.transaction === undefined && r.headers["bdp-transaction"] === undefined,
      "Safe read reported a commit",
    );
    safeCalls.add(v.callId);
    return v.outcome.value;
  };
  const queryAll = (where, select) =>
    collect(
      (after) =>
        invoke("query", {
          where,
          ...(select ? { select } : {}),
          request: {
            limit: Math.min(caps.core.list?.maxLimit ?? 100, 100),
            ...(after ? { after } : {}),
          },
        }),
      {
        check: (r) => resource(r, { partial: !!select, revisionModel: caps.scope.revisionModel }),
        name: "query",
      },
    );
  const hasStdlib = (name) => !!caps?.packs?.stdlib && Object.hasOwn(caps.packs.stdlib, name);
  const restricted = () => {
    requiredValue(resources, "inventory");
    return resources
      .slice(0, 8)
      .concat(resources.find((r) => r.id.id === "sys/capabilities") ?? []);
  };
  const guard = () => ({
    kind: "compare",
    field: ["id", "id"],
    op: "in",
    value: restricted().map((r) => r.id.id),
  });
  const rows = {
    "spec.coverage": async () => {
      coverage = await loadCoverage();
      report.inputs = coverage.inputs;
    },
    "core.discovery": async () => {
      discovery = decoded(await request("sys/capabilities"));
      resource(discovery);
      caps = capabilities(discovery.body);
      report.discovered = {
        core: Object.keys(caps.core),
        revisionModel: caps.scope.revisionModel,
        storageClasses: caps.scope.storageClasses.map((v) => v.kind),
        stdlib: { query: !!caps.packs?.stdlib?.query, count: !!caps.packs?.stdlib?.count },
      };
      resource(discovery, { revisionModel: caps.scope.revisionModel });
    },
    "core.read-only": async () => {
      requiredValue(caps, "discovery");
      requireThat(
        writeCapabilities.every((k) => !Object.hasOwn(caps.core, k)),
        "Read-only qualification refuses an advertised mutation capability",
      );
      readOnlyVerified = true;
    },
    "core.inventory": async () => {
      requiredValue(caps, "discovery");
      ifOffered(caps.core.list, "List is not offered");
      resources = await list();
      requireThat(
        new Set(resources.map(key)).size === resources.length,
        "Inventory repeats a stable identity",
      );
      requireThat(
        resources.some((r) => key(r) === key(discovery)),
        "List omits the readable capabilities resource",
      );
      samples = [...new Map(resources.map((r) => [r.type, r])).values()];
      report.inventory = {
        resources: resources.length,
        types: samples.length,
        sha256: hash(canonical(resources)),
      };
    },
    "core.representations": async () => {
      requiredValue(caps, "discovery");
      for (const r of resources ?? [discovery])
        resource(r, { revisionModel: caps.scope.revisionModel });
    },
    "core.point-read": async () => {
      requiredValue(caps, "discovery");
      for (const r of samples ?? [discovery]) {
        const v = decoded(await request(pointUrl(r)));
        resource(v, { revisionModel: caps.scope.revisionModel });
        requireThat(isDeepStrictEqual(v, r), "Point read differs from inventory representation");
        if (r.id.rev !== undefined) {
          const u = new URL(urlOf(r.id));
          u.searchParams.set("revision", r.id.rev);
          requireThat(
            isDeepStrictEqual(decoded(await request(u.href)), r),
            "Pinned revision differs from current state",
          );
        }
      }
    },
    "core.stability": async () => {
      requiredValue(caps, "discovery");
      for (const r of samples ?? [discovery]) {
        const again = decoded(await request(pointUrl(r)));
        requireThat(
          isDeepStrictEqual(again, r),
          "Safe repeat read changed identity, revision, type, body or metadata",
        );
      }
    },
    "core.absence": async () => {
      const p = await fault(`provider-kit-missing-${randomUUID()}`, [404], "resource-not-found");
      const q = await fault(
        "provider-kit-missing-" +
          randomUUID() +
          "?selector=" +
          encodeURIComponent('{"include":["/type"]}'),
        [404],
        "resource-not-found",
      );
      requireThat(p.status === q.status && p.code === q.code, "Absence varies by read shaping");
    },
    "core.http": async () => {
      await fault("sys/capabilities", [406], undefined, { headers: { Accept: "text/html" } });
      await fault("sys/capabilities", [406], undefined, {
        headers: { Accept: "application/json;q=0, */*;q=1" },
      });
      const r = await request("sys/capabilities", { method: "HEAD" });
      requireThat([200, 405].includes(r.status), "HEAD has an invalid HTTP result");
      requireThat(r.text === "", "HEAD returned a response body");
      const get = await request("sys/capabilities");
      if (get.headers.etag) {
        const notModified = await request("sys/capabilities", {
          headers: { "If-None-Match": get.headers.etag },
        });
        requireThat(
          notModified.status === 304 && notModified.text === "",
          "Conditional GET did not preserve HTTP semantics",
        );
      }
    },
    "core.context": async () => {
      const cause = randomUUID(),
        metadata = { opaque: "", nested: { array: [true, null, 1] } };
      metadata.opaque = "x".repeat(
        4096 - Buffer.byteLength(cause) - Buffer.byteLength(JSON.stringify(metadata)),
      );
      decoded(
        await request("sys/capabilities", {
          headers: { "BDP-Cause": cause, "BDP-Metadata": JSON.stringify(metadata) },
        }),
      );
      const r = await request("sys/capabilities", { headers: { "BDP-Cause": cause } });
      requireThat(r.headers["bdp-cause"] === cause, "Response changed incoming cause");
      requireThat(r.headers["bdp-transaction"] === undefined, "Safe point read reported a commit");
    },
    "core.projection": async () => {
      requiredValue(caps, "discovery");
      if (!caps.core.get.selector) {
        await fault(
          `sys/capabilities?selector=${encodeURIComponent('{"include":["/type"]}')}`,
          [422, 405],
          "capability-not-supported",
        );
        return;
      }
      for (const selector of [
        { include: ["/id", "/type"] },
        { omit: ["/id", "/type", "/body"] },
        { include: [""] },
        { include: ["/body/__proto__/provider-kit-missing"] },
      ]) {
        const u = `sys/capabilities?selector=${encodeURIComponent(JSON.stringify(selector))}`;
        const v = decoded(await request(u));
        resource(v, { partial: true, revisionModel: caps.scope.revisionModel });
        requireThat(
          isDeepStrictEqual(v, projected(discovery, selector)),
          "Selector changed retained identity/type or projected the wrong fields",
        );
      }
    },
    "core.list-filter": async () => {
      requiredValue(caps, "discovery");
      ifOffered(caps.core.list, "List is not offered");
      if (caps.core.list.sort)
        throw new NotRun("Advertised server sorting needs additional qualification cases");
      requiredValue(resources, "inventory");
      const r = restricted()[0],
        type = r.type;
      const probes = {
        compare: [
          { kind: "compare", field: ["id", "id"], op: "eq", value: r.id.id },
          { kind: "compare", field: ["id", "id"], op: "ne", value: r.id.id },
          { kind: "compare", field: ["id", "id"], op: "lt", value: 2 },
          { kind: "compare", field: ["id", "id"], op: "ge", value: "10" },
          { kind: "compare", field: [], op: "ne", value: null },
        ],
        matches: [
          { kind: "matches", field: ["type"], using: "substring", pattern: type },
          { kind: "matches", field: ["type"], using: "substring", pattern: type.toUpperCase() },
          { kind: "matches", field: ["type"], using: "glob", pattern: "*" },
        ],
        has: [{ kind: "has", field: ["body"] }],
        missing: [
          { kind: "missing", field: ["provider-kit-absent"] },
          { kind: "missing", field: ["body", "constructor"] },
          { kind: "missing", field: ["body", "__proto__", "provider-kit-missing"] },
        ],
        contains: [
          {
            kind: "contains",
            field: ["body", "scope", "storageClasses"],
            value: { kind: "durable" },
          },
        ],
        containsAny: [
          { kind: "contains-any", field: ["body", "scope", "storageClasses"], values: [] },
        ],
        excludes: [
          { kind: "excludes", field: ["body", "scope", "storageClasses"], value: "absent" },
        ],
        isType: [
          { kind: "is-type", type: type.split("/")[0] },
          { kind: "is-type", type: type.slice(0, -1), match: "prefix" },
          { kind: "is-type", type, match: "exact" },
        ],
      };
      for (const kind of caps.core.list.conditions) {
        for (const c of probes[kind]) {
          const where = caps.core.list.conditions.includes("compare") ? [guard(), c] : [c];
          sameSet(
            await list(where),
            resources.filter((r) => filter(where, r)),
          );
        }
      }
      await fault(`?filter=${encodeURIComponent('[{"kind":"has","field":"body.x"}]')}`, [400]);
    },
    "core.list-cursors": async () => {
      requiredValue(caps, "discovery");
      ifOffered(caps.core.list, "List is not offered");
      requiredValue(resources, "inventory");
      const first = decoded(await request("?limit=1"));
      page(first);
      if (resources.length > 1) {
        requireThat(typeof first.cursor === "string" && !first.head, "List omitted continuation");
        const second = decoded(await request(`?limit=1&after=${encodeURIComponent(first.cursor)}`));
        page(second);
        requireThat(
          isDeepStrictEqual([...first.items, ...second.items], resources.slice(0, 2)),
          "Cursor is not exclusive or ordered consistently",
        );
        const ordinal = decoded(await request("?limit=1&from=1"));
        requireThat(
          isDeepStrictEqual(ordinal.items, resources.slice(1, 2)),
          "Ordinal read selected wrong item",
        );
        if (caps.core.list.selector)
          await fault(
            "?limit=1&after=" +
              encodeURIComponent(first.cursor) +
              "&select=" +
              encodeURIComponent('{"include":["/type"]}'),
            [400, 410],
          );
        await fault(`?from=0&after=${encodeURIComponent(first.cursor)}`, [400]);
      }
      const normal = decoded(await request(""));
      const bound = caps.core.list.maxLimit;
      requireThat(
        normal.items.length === Math.min(resources.length, bound ?? resources.length),
        "Default Page did not return the set up to its advertised maxLimit",
      );
    },
    "core.list-formats": async () => {
      requiredValue(caps, "discovery");
      ifOffered(caps.core.list, "List is not offered");
      requiredValue(resources, "inventory");
      const r = await request("?format=jsonl", { headers: { Accept: "application/jsonl" } });
      requireThat(
        r.status === 200 && (r.headers["content-type"] ?? "").split(";")[0] === "application/jsonl",
        "List does not implement its snapshot JSONL transport",
      );
      const items = r.text.trim() ? r.text.trimEnd().split("\n").map(parseJson) : [];
      items.forEach((v) => {
        resource(v, { revisionModel: caps.scope.revisionModel });
      });
      sameSet(items, resources);
      if (resources.length > 1) {
        const first = decoded(await request("?limit=1"));
        const continued = await request(`?after=${encodeURIComponent(first.cursor)}`, {
          headers: { Accept: "application/jsonl" },
        });
        requireThat(continued.status === 200, "A JSON cursor did not resume in JSONL");
        sameSet(continued.text.trimEnd().split("\n").map(parseJson), resources.slice(1));
      }
      await fault("?format=sse", [406, 422, 400], "capability-not-supported");
    },
    "core.descriptors": async () => {
      requiredValue(caps, "discovery");
      for (const r of resources ?? [discovery]) descriptor(r);
      for (const p of (resources ?? []).filter((r) => r.type.split("/").at(-1) === "package-def"))
        for (const [path, element] of Object.entries(p.body.elements)) {
          if (element.type.split("/").at(-1) === "type-def") {
            const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
            if (parent)
              requireThat(
                Object.hasOwn(p.body.elements, parent),
                "Type hierarchy omits its implicit same-package parent",
              );
          }
        }
    },
    "stdlib.query": async () => {
      requiredValue(caps, "discovery");
      ifOffered(hasStdlib("query"), "stdlib/query is not offered");
      requiredValue(resources, "inventory");
      sameSet(await queryAll({ kind: "all", of: [] }), resources);
      for (const expr of [
        { kind: "any", of: [] },
        { kind: "all", of: [cond(guard()), { kind: "not", expr: { kind: "any", of: [] } }] },
        {
          kind: "all",
          of: [
            cond(guard()),
            {
              kind: "any",
              of: [
                { kind: "not", expr: cond({ kind: "has", field: ["body"] }) },
                cond({ kind: "has", field: ["id"] }),
              ],
            },
          ],
        },
      ])
        sameSet(
          await queryAll(expr),
          resources.filter((r) => query(expr, r, resources, target.scope)),
        );
    },
    "stdlib.query-cursors": async () => {
      requiredValue(caps, "discovery");
      ifOffered(hasStdlib("query"), "stdlib/query is not offered");
      requiredValue(resources, "inventory");
      if (resources.length < 2)
        throw new NotRun("Two visible resources are needed for continuation");
      const where = cond(guard()),
        first = await invoke("query", { where, request: { limit: 1 } });
      page(first);
      requireThat(first.cursor && !first.head, "Query lost continuation");
      const second = await invoke("query", { where, request: { limit: 1, after: first.cursor } });
      requireThat(
        first.items[0].id.id !== second.items[0]?.id.id,
        "Query cursor repeated its last item",
      );
      const bad = {
        arguments: [
          { name: "scope", value: null },
          { name: "where", value: { kind: "all", of: [] } },
          { name: "request", value: { limit: 1, after: first.cursor } },
        ],
        idempotencyKey: randomUUID(),
      };
      await fault("stdlib/query:call", [400, 410], undefined, { method: "POST", body: bad });
    },
    "stdlib.query-rejections": async () => {
      requiredValue(caps, "discovery");
      ifOffered(hasStdlib("query"), "stdlib/query is not offered");
      for (const where of [
        { kind: "unknown" },
        { kind: "any", of: [{ kind: "all", of: [] }, { kind: "unknown" }] },
        { kind: "cond", condition: { kind: "has", field: "body.x" } },
        { all: [] },
        { kind: "all", of: [], extra: true },
      ])
        await fault("stdlib/query:call", [400], "malformed-query", {
          method: "POST",
          body: {
            arguments: [
              { name: "scope", value: null },
              { name: "where", value: where },
            ],
            idempotencyKey: randomUUID(),
          },
        });
    },
    "stdlib.query-via": async () => {
      requiredValue(caps, "discovery");
      ifOffered(hasStdlib("query"), "stdlib/query is not offered");
      if (caps.packs.stdlib.query.via !== true) {
        await fault("stdlib/query:call", [422], "query-capability-unsupported", {
          method: "POST",
          body: {
            arguments: [
              { name: "scope", value: null },
              { name: "where", value: { kind: "via", edge: "provider-kit/absent" } },
            ],
            idempotencyKey: randomUUID(),
          },
        });
        return;
      }
      requiredValue(resources, "inventory");
      const edge = resources.find((r) => r.body?.source && r.body?.target);
      if (!edge) throw new NotRun("An existing relationship is needed as a traversal witness");
      for (const direction of ["out", "in"]) {
        const subject = direction === "out" ? edge.body.source : edge.body.target,
          neighbor = direction === "out" ? edge.body.target : edge.body.source;
        const where = {
          kind: "all",
          of: [
            cond({ kind: "compare", field: ["id", "id"], op: "eq", value: subject.id }),
            {
              kind: "via",
              edge: edge.type,
              direction,
              where: cond({ kind: "compare", field: ["id", "id"], op: "eq", value: neighbor.id }),
            },
          ],
        };
        sameSet(
          await queryAll(where),
          resources.filter((r) => query(where, r, resources, target.scope)),
        );
      }
    },
    "stdlib.count": async () => {
      requiredValue(caps, "discovery");
      ifOffered(hasStdlib("count"), "stdlib/count is not offered");
      requiredValue(resources, "inventory");
      requireThat(
        (await invoke("count", {})) === resources.length,
        "Count with omitted where differs from inventory",
      );
      const where = {
        kind: "not",
        expr: cond({ kind: "is-type", type: resources[0].type, match: "exact" }),
      };
      requireThat(
        (await invoke("count", { where })) ===
          resources.filter((r) => query(where, r, resources, target.scope)).length,
        "Count ignored the Query predicate",
      );
    },
    "core.feed": async () => {
      requiredValue(caps, "discovery");
      ifOffered(caps.core.pull, "Pull is not offered");
      if (caps.core.pull.filter || caps.core.pull.selector)
        throw new NotRun("Filtered/projected event streams need additional qualification cases");
      const r = decoded(await request("sys/changes"));
      page(r);
      r.items.forEach((e) => {
        changeEvent(e, caps.scope.revisionModel);
      });
      let p = r;
      const cursors = new Set();
      while (!p.head) {
        if (!p.cursor || cursors.has(p.cursor))
          throw new Violation("Changefeed continuation made no progress");
        cursors.add(p.cursor);
        p = decoded(await request(`sys/changes?after=${encodeURIComponent(p.cursor)}`));
        page(p);
        p.items.forEach((e) => {
          changeEvent(e, caps.scope.revisionModel);
        });
      }
      requireThat(
        typeof p.cursor === "string",
        "At-head changefeed must supply a cursor for future resumption",
      );
      initialFeed = p.cursor;
      const again = decoded(await request(`sys/changes?after=${encodeURIComponent(initialFeed)}`));
      page(again);
      if (caps.core.pull.jsonl) {
        const stream = await request(
          `sys/changes?format=jsonl&after=${encodeURIComponent(initialFeed)}`,
          { headers: { Accept: "application/jsonl" } },
        );
        requireThat(
          stream.status === 200 &&
            (stream.headers["content-type"] ?? "").split(";")[0] === "application/jsonl",
          "Advertised JSONL pull is missing",
        );
        if (stream.text.trim())
          stream.text
            .trimEnd()
            .split("\n")
            .map(parseJson)
            .forEach((e) => {
              changeEvent(e, caps.scope.revisionModel);
            });
      }
      if (caps.core.pull.sse)
        throw new NotRun("Live SSE qualification is not implemented by this read-only runner");
      if (!caps.core.pull.sse)
        await fault("sys/changes?format=sse", [400, 406, 422], "capability-not-supported");
    },
    "core.export": async () => {
      requiredValue(caps, "discovery");
      ifOffered(caps.core.export, "Export is not offered");
      const r = await request("bdp/export?format=jsonl", {
        headers: { Accept: "application/jsonl" },
      });
      requireThat(
        r.status === 200 && (r.headers["content-type"] ?? "").split(";")[0] === "application/jsonl",
        "Export must offer JSONL",
      );
      if (caps.core.export.revisions)
        throw new NotRun("History export qualification is not implemented");
      const lines = r.text.trimEnd().split("\n").map(parseJson),
        begin = lines.shift(),
        end = lines.pop();
      requireThat(
        begin?.kind === "export-begin" &&
          begin.scope === target.scope &&
          typeof begin.cursor === "string",
        "Missing or malformed export begin",
      );
      requireThat(
        end?.kind === "export-end" && end.count === lines.length,
        "Export is truncated or count is wrong",
      );
      for (const r of lines) resource(r, { revisionModel: caps.scope.revisionModel });
      requireThat(
        lines.every((r) => r.storageClass?.kind !== "ephemeral"),
        "Export leaked ephemeral resources",
      );
      if (resources) {
        const expected = resources.filter((r) => r.storageClass?.kind !== "ephemeral");
        sameSet(lines, expected);
        const byId = new Map(expected.map((r) => [key(r), canonical(r)]));
        requireThat(
          lines.every((r) => canonical(r) === byId.get(key(r))),
          "Export post-images differ from the same baseline inventory",
        );
      }
      if (caps.core.pull) {
        const p = decoded(await request(`sys/changes?after=${encodeURIComponent(begin.cursor)}`));
        page(p);
      }
      if (!caps.core.export.revisions)
        await fault("bdp/export?revisions=true", [400, 422, 405], "capability-not-supported");
    },
    "core.safe-reads": async () => {
      requiredValue(caps, "discovery");
      ifOffered(caps.core.pull, "Pull is not offered");
      requiredValue(initialFeed, "feed");
      const events = await collect(
        (after) =>
          request(`sys/changes?after=${encodeURIComponent(after ?? initialFeed)}`).then(decoded),
        { check: (e) => changeEvent(e, caps.scope.revisionModel) },
      );
      requireThat(
        !events.some(
          (e) => ["call-enter", "call-leave"].includes(e.kind) && safeCalls.has(e.callId),
        ),
        "Safe operation emitted an unsafe call frame",
      );
    },
    "core.unoffered": async () => {
      requiredValue(caps, "discovery");
      if (!readOnlyVerified) throw new NotRun("Read-only capability admission failed");
      if (!options.allowRefusalProbes)
        throw new NotRun(
          "Explicit refusal-probe permission is required for mutation-method negative checks",
        );
      const targetId = `provider-kit-refusal-${randomUUID()}`;
      for (const method of ["PUT", "PATCH", "DELETE", "POST"])
        await fault(targetId, [405, 422], "capability-not-supported", { method, body: {} });
      if (!caps.core.revisions)
        await fault("sys/capabilities:revisions", [405, 422], "capability-not-supported");
    },
    "core.history": async () => {
      requiredValue(caps, "discovery");
      ifOffered(caps.core.revisions, "Prior history is not offered");
      throw new NotRun("This profile does not yet qualify offered revision-history reads");
    },
    "core.restart": async () => {
      requiredValue(caps, "discovery");
      const durable =
        caps.scope.storageClasses.some((c) => c.kind === "durable") ||
        (resources ?? []).some((r) => r.storageClass?.kind === "durable");
      ifOffered(durable, "No durable persistence is offered; intrinsic baseline is computed");
      if (!target.restart)
        throw new NotRun("Durable read-only data needs a provider restart witness");
      await target.restart();
      for (const r of samples ?? [discovery])
        requireThat(
          isDeepStrictEqual(decoded(await request(pointUrl(r))), r),
          "Resource changed after restart",
        );
    },
  };
  try {
    for (const id of rowIds) {
      const start = performance.now();
      const row = { id, required: true, state: "not-run" };
      try {
        await rows[id]();
        row.state = "pass";
      } catch (error) {
        row.state =
          error instanceof NotApplicable
            ? "not-applicable"
            : error instanceof NotRun
              ? "not-run"
              : error instanceof Violation
                ? "fail"
                : "harness-error";
        row.reason =
          error instanceof Violation ||
          error instanceof NotApplicable ||
          error instanceof NotRun ||
          error instanceof HarnessError
            ? error.message
            : "Checker could not complete observation";
        if (error instanceof NotApplicable) row.required = false;
      }
      row.durationMs = Math.round(performance.now() - start);
      report.obligations.push(row);
      done.set(id, row);
      progress({ completed: done.size, total: rowIds.length, id, state: row.state });
    }
  } finally {
    io.close();
    try {
      await target.cleanup?.();
      report.lifecycle.cleanup = "pass";
    } catch {
      report.lifecycle.cleanup = "harness-error";
    }
  }
  report.exchanges = io.receipts;
  if (coverage)
    report.normative = coverage.points.map((p) => {
      if (p.appliesWhen === "unoffered-write")
        return {
          ...p,
          state: done.get("core.read-only")?.state === "pass" ? "not-applicable" : "not-run",
          reason: "Mutation semantics are outside this explicitly read-only profile",
        };
      if (p.appliesWhen?.startsWith("stdlib:") && !hasStdlib(p.appliesWhen.slice(7)))
        return {
          ...p,
          state: "not-applicable",
          reason: "The optional stdlib capability is not offered",
        };
      const states = p.checks.map((id) => done.get(id)?.state ?? "not-run");
      return {
        ...p,
        state: states.includes("harness-error")
          ? "harness-error"
          : states.includes("fail")
            ? "fail"
            : states.includes("not-run")
              ? "not-run"
              : states.every((s) => s === "not-applicable")
                ? "not-applicable"
                : "pass",
      };
    });
  return qualify(report, { executionIds: rowIds, normativeIds: coverage?.points.map((p) => p.id) });
}
