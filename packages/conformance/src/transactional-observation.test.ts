import { expect, it } from "vitest";
import {
  createTransactionalObservations,
  TransactionalHarnessError,
  TransactionalReceiptFailure,
  validateReceiptWire,
  type TransactionalRunContext,
  type TransactionalSessionBinding,
} from "./transactional-observation.js";
import { createJsonSchemaValidator } from "./schema-validator.js";
import type { HttpExchangeResponse } from "./http-executor.js";
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
const scope = "https://reference.invalid/acme/",
  id = `${scope}receipts/r1`;
const body = {
  id,
  status: "completed",
  detail: "available",
  idempotencyKey: "key",
  scopeEpoch: "epoch",
  authorizationView: "view",
  transaction: "tx",
  requiredPosition: "pos-0",
  results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
  next: null,
  expiresAt: "2030-01-01T00:00:00Z",
};
const validator = createJsonSchemaValidator(schema);
function response(value: unknown = body): HttpExchangeResponse {
  const bodyText = JSON.stringify(value),
    headers = {
      "content-length": String(Buffer.byteLength(bodyText)),
      "content-type": "application/json",
    };
  return {
    url: scope + "operations/batch",
    status: 200,
    headers,
    bodyText,
    bodyOctets: Buffer.byteLength(bodyText),
    wireResponseBytes: Buffer.from(
      `HTTP/1.1 200 OK\r\ncontent-length: ${headers["content-length"]}\r\ncontent-type: application/json\r\n\r\n${bodyText}`,
    ),
  };
}
function fixture() {
  const controller = new AbortController();
  let binding: TransactionalSessionBinding = {
    scenario: "row",
    generation: 1,
    listenUrl: "http://127.0.0.1:12345/",
    runtimeConfigurationIdentity: "a".repeat(64),
    configurationDigest: "b".repeat(64),
    responseLimits: { headerBytes: 65536, bodyBytes: 1048576, wireBytes: 2097152 },
  };
  const context: TransactionalRunContext = {
    current: () => ({
      binding,
      dialRoute: { transport: "plain", host: "127.0.0.1", port: 12345 },
      signal: controller.signal,
      resolveCredentials: () => ({}),
      register: (p) => p,
    }),
    reopen: async () => {
      binding = { ...binding, generation: 2, listenUrl: "http://127.0.0.1:23456/" };
    },
  };
  const observations = createTransactionalObservations(context, "row", scope, 4);
  const config = {
    scope,
    profile: "transactional" as const,
    routes: [{ method: "POST" as const, url: scope + "operations/batch" }],
    maximumRequestHeaderBytes: 16384,
    maximumRequestBodyBytes: 65536,
    defaultCredentialRef: "operator",
    credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
  };
  const register = (
    r = response(),
    value: unknown = body,
    pointer = "/id",
    request = { method: "POST", url: scope + "operations/batch" },
    bindingName = "receipt",
  ) =>
    observations.register(
      bindingName,
      pointer,
      "post",
      request,
      r,
      value,
      config,
      undefined,
      validator,
      observations.session().binding,
    );
  return {
    observations,
    controller,
    register,
    change: (change: Partial<TransactionalSessionBinding>) => {
      binding = { ...binding, ...change };
    },
  };
}
it("retains immutable original wire provenance across explicit validated reopen", async () => {
  const f = fixture();
  f.register();
  const before = f.observations.resolve("receipt", id).source;
  await f.observations.reopen(new AbortController().signal);
  const after = f.observations.resolve("receipt", id);
  expect(after.source).toBe(before);
  expect(after.source.session.generation).toBe(1);
  expect(after.active.binding.generation).toBe(2);
  expect(() => after.validate(response(), "GET")).not.toThrow();
  expect(() => after.validate(response({ ...body, requiredPosition: "pos-2" }), "GET")).toThrow(
    "original wire facts",
  );
});
it.each(["unknown", `${scope}receipts/other`, `${scope}beads/a`, `${id}?x=1`, `${id}/../r1`])(
  "rejects unobserved/substituted receipt %s",
  (value) => {
    const f = fixture();
    f.register();
    expect(() => f.observations.resolve("receipt", value)).toThrow();
    expect(() => f.observations.resolve("other", id)).toThrow();
  },
);
it.each([
  { listenUrl: "http://127.0.0.1:9999/" },
  { generation: 2 },
  { scenario: "other" },
  { runtimeConfigurationIdentity: "c".repeat(64) },
])("rejects unvalidated session change %j", (change) => {
  const f = fixture();
  f.register();
  f.change(change);
  expect(() => f.observations.resolve("receipt", id)).toThrow();
});
it("refuses a wrong source pointer, aborted session, reused authority and malformed schema", () => {
  const f = fixture();
  f.register(response(), body, "/transaction");
  expect(() => f.observations.resolve("receipt", id)).toThrow();
  expect(() => f.register(response(), { ...body, unexpected: true })).toThrow("schema");
  f.register();
  expect(() => f.register()).toThrow("reuse");
  f.controller.abort();
  expect(() => f.observations.resolve("receipt", id)).toThrow("unavailable");
});
it.each(["body", "octets", "status", "headers", "wire", "absent"])(
  "refuses inconsistent %s evidence before authority registration",
  (kind) => {
    const f = fixture(),
      r = response();
    const changed =
      kind === "body"
        ? { ...r, bodyText: "{}" }
        : kind === "octets"
          ? { ...r, bodyOctets: 0 }
          : kind === "status"
            ? { ...r, status: 201 }
            : kind === "headers"
              ? { ...r, headers: {} }
              : kind === "absent"
                ? { ...r, wireResponseBytes: undefined }
                : { ...r, wireResponseBytes: Buffer.from("HTTP/1.1 200 OK\r\n\r\n{}") };
    expect(() => f.register(changed as unknown as HttpExchangeResponse)).toThrow();
    expect(() => f.observations.resolve("receipt", id)).toThrow();
  },
);
it("validates bodyless HEAD wire independently from retained representation length", () => {
  const r = { ...response(), bodyText: "", bodyOctets: 0 };
  r.wireResponseBytes = Buffer.from(
    `HTTP/1.1 200 OK\r\ncontent-length: ${r.headers["content-length"]}\r\ncontent-type: application/json\r\n\r\n`,
  );
  expect(() => validateReceiptWire(r, "HEAD")).not.toThrow();
  expect(() => validateReceiptWire(response(), "HEAD")).toThrow();
});

it("does not grant or retain receipt authority from ordinary capture routes", () => {
  const f = fixture();
  f.register();
  const ordinary = { ...response(), url: scope + "beads/a" };
  f.register(ordinary, body, "/id", { method: "GET", url: ordinary.url });
  expect(() => f.observations.resolve("receipt", id)).toThrow("not authorized");
  // Even receipt-looking JSON and an original receipt ID on this Resource route
  // do not turn a new ordinary binding back into receipt-follow authority.
  f.register(ordinary, body, "/id", { method: "GET", url: ordinary.url });
  expect(() => f.observations.resolve("receipt", id)).toThrow("not authorized");
});
it("rejects a claimed receipt whose actual response route differs", () => {
  const f = fixture();
  expect(() => f.register({ ...response(), url: scope + "beads/a" })).toThrow("route mismatch");
});

it("refuses a session whose recorded response bounds differ from the supported transport", () => {
  const f = fixture();
  f.change({
    responseLimits: {
      headerBytes: 1,
      bodyBytes: 1048576,
      wireBytes: 2097152,
    } as unknown as TransactionalSessionBinding["responseLimits"],
  });
  expect(() => f.observations.session()).toThrow("response limits mismatch");
});

it("distinguishes evidence self-disagreement from invalid target receipt facts", () => {
  const f = fixture();
  expect(() => f.register({ ...response(), headers: {} })).toThrow(TransactionalHarnessError);
  expect(() => f.register({ ...response(), headers: {} })).toThrow("receipt wire headers mismatch");
  expect(() =>
    f.register(response({ ...body, unexpected: true }), { ...body, unexpected: true }),
  ).toThrow(TransactionalReceiptFailure);
  expect(() =>
    f.register(response({ ...body, unexpected: true }), { ...body, unexpected: true }),
  ).toThrow("source receipt schema invalid");
  f.register();
  expect(() =>
    f.observations
      .resolve("receipt", id)
      .validate(response({ ...body, requiredPosition: "pos-9" }), "GET"),
  ).toThrow(TransactionalReceiptFailure);
  expect(() =>
    f.observations
      .resolve("receipt", id)
      .validate(response({ ...body, requiredPosition: "pos-9" }), "GET"),
  ).toThrow("retained receipt differs from original wire facts");
});
it("does not regrant receipt authority from a retained receipt GET", () => {
  const f = fixture();
  f.register();
  f.register({ ...response(), url: id }, body, "/id", { method: "GET", url: id });
  expect(() => f.observations.resolve("receipt", id)).toThrow("not authorized");
});

it("allows changed serving headers while retaining original receipt JSON facts", () => {
  const f = fixture();
  f.register();
  const original = response();
  const headers = { ...original.headers, "bdp-scope-position": "pos-9" };
  const later = {
    ...original,
    headers,
    wireResponseBytes: Buffer.from(
      `HTTP/1.1 200 OK\r\n${Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join("")}\r\n${original.bodyText}`,
    ),
  };
  expect(() => f.observations.resolve("receipt", id).validate(later, "GET")).not.toThrow();
});
it("classifies a real schema-valid but foreign receipt identity as target failure", () => {
  const f = fixture(),
    foreign = { ...body, id: "https://other.invalid/receipts/r1" };
  expect(() => f.register(response(foreign), foreign)).toThrow(TransactionalReceiptFailure);
  expect(() => f.register(response(foreign), foreign)).toThrow("source receipt identity invalid");
});

it.each([201, 202, "missing", "oversize"])(
  "refuses unavailable source wire %s before comparing evidence",
  (kind) => {
    const f = fixture(),
      original = response();
    const { wireResponseBytes: _wire, ...withoutWire } = original;
    const changed =
      typeof kind === "number"
        ? {
            ...original,
            status: kind,
            wireResponseBytes: Buffer.from(
              `HTTP/1.1 ${kind} ${kind === 201 ? "Created" : "Accepted"}\r\n\r\n`,
            ),
          }
        : kind === "missing"
          ? withoutWire
          : { ...original, wireResponseBytes: Buffer.alloc(2097153) };
    expect(() => f.register(changed)).toThrow(TransactionalHarnessError);
    expect(() => f.register(changed)).toThrow("source receipt wire unavailable");
  },
);

it.each(["update-where", "delete-where"])(
  "grants completed and failed %s receipt authority only from matching actual source bytes",
  (suffix) => {
    const { results: _results, next: _next, ...common } = body;
    const failed = {
      ...common,
      status: "failed",
      problem: {
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        status: 409,
        code: "cardinality-violated",
        retry: "after-state-change",
        operationIndex: 0,
        pointer: "/cardinality/min",
      },
    };
    const url = scope + "operations/" + suffix;
    for (const value of [body, failed]) {
      const f = fixture();
      const r = { ...response(value), url };
      f.register(r, value, "/id", { method: "POST", url });
      const resolved = f.observations.resolve("receipt", id);
      expect(resolved.source.action).toBe("post");
      expect(resolved.source.credentialRef).toBe("operator");
      expect(() => resolved.validate(response(value), "GET")).not.toThrow();
      const ordinary = { ...response(value), url: scope + "beads/a" };
      f.register(ordinary, value, "/id", { method: "GET", url: ordinary.url });
      expect(() => f.observations.resolve("receipt", id)).toThrow("not authorized");
    }
    const f = fixture();
    const { wireResponseBytes: _wire, ...withoutWire } = response();
    expect(() =>
      f.register({ ...withoutWire, url }, body, "/id", {
        method: "POST",
        url,
      }),
    ).toThrow(TransactionalHarnessError);
    const invalid = { ...body, unexpected: true };
    expect(() =>
      f.register({ ...response(invalid), url }, invalid, "/id", { method: "POST", url }),
    ).toThrow(TransactionalReceiptFailure);
  },
);

it.each(["GET", "HEAD", "query", "slash", "foreign", "other-scope", "sequence"])(
  "does not grant set authority from %s source variants",
  (variant) => {
    for (const suffix of ["update-where", "delete-where"]) {
      const f = fixture();
      let url = scope + "operations/" + suffix;
      if (variant === "query") url += "?x=1";
      if (variant === "slash") url += "/";
      if (variant === "foreign") url = url.replace("reference.invalid", "other.invalid");
      if (variant === "other-scope") url = url.replace("/acme/", "/other/");
      if (variant === "sequence") url = scope + "operations/sequence";
      f.register({ ...response(), url }, body, "/id", {
        method: variant === "GET" || variant === "HEAD" ? variant : "POST",
        url,
      });
      expect(() => f.observations.resolve("receipt", id)).toThrow("not authorized");
    }
  },
);

const pageUrl = `${id}/pages/p1`;
const paginated = { ...body, next: pageUrl };
const pageBody = { receipt: id, results: body.results, next: null };
function pageHead(): HttpExchangeResponse {
  const r = response(pageBody);
  return {
    ...r,
    bodyText: "",
    bodyOctets: 0,
    wireResponseBytes: Buffer.from(
      `HTTP/1.1 200 OK\r\ncontent-length: ${r.headers["content-length"]}\r\ncontent-type: application/json\r\n\r\n`,
    ),
  };
}
it.each([
  ["/id", "/next"],
  ["/next", "/id"],
])("grants only each requested binding independently in capture order %j", async (...pointers) => {
  const f = fixture();
  for (const pointer of pointers) {
    f.register(response(paginated), paginated, pointer, undefined, pointer);
    const resolved = f.observations.resolve(pointer, pointer === "/id" ? id : pageUrl);
    expect(resolved.source.pointer).toBe(pointer);
    expect(resolved.source.receipt).toBe(id);
    expect(resolved.target).toBe(pointer === "/id" ? id : pageUrl);
    expect(() => f.observations.resolve("implicit", pageUrl)).toThrow("not authorized");
  }
  expect(() => f.observations.resolve("/id", pageUrl)).toThrow("not authorized");
  expect(() => f.observations.resolve("/next", id)).toThrow("not authorized");
  const original = f.observations.resolve("/next", pageUrl).source;
  const read = () => f.observations.resolve("/next", pageUrl);
  expect(() => read().validate(pageHead(), "HEAD")).not.toThrow();
  expect(() =>
    read().validate(response({ ...pageBody, receipt: `${scope}receipts/wrong` }), "GET"),
  ).toThrow("schema or identity");
  expect(() => read().validate(response(pageBody), "GET")).not.toThrow();
  expect(() =>
    read().validate(
      response({ ...pageBody, results: [{ operationIndex: 0, outcome: "matched", count: 1 }] }),
      "GET",
    ),
  ).toThrow("original wire facts");
  await f.observations.reopen(new AbortController().signal);
  expect(read().source).toBe(original);
  expect(read().active.binding.generation).toBe(2);
  expect(() => read().validate(response(pageBody), "GET")).not.toThrow();
  expect(() => read().validate(pageHead(), "HEAD")).not.toThrow();
  expect(() =>
    f.observations.resolve("/id", id).validate(response(paginated), "GET"),
  ).not.toThrow();
});
it.each([
  `${id}/pages/`,
  `${id}/pages/${"a".repeat(257)}`,
  `${id}/pages/a.b`,
  `${id}/pages/a/b`,
  `${id}/pages/p1?x=1`,
  `${id}/pages/p1#x`,
  `${scope}receipts/other/pages/p1`,
  `${id}/pages/../p1`,
  `https://user@reference.invalid/acme/receipts/r1/pages/p1`,
  `https://REFERENCE.invalid/acme/receipts/r1/pages/p1`,
  `${id}/pages/${"a".repeat(8192)}`,
])("refuses disclosed but noncanonical or wrong-parent page %s", (next) => {
  const f = fixture(),
    value = { ...body, next };
  expect(() => f.register(response(value), value, "/next")).toThrow();
  expect(() => f.observations.resolve("receipt", next)).toThrow("not authorized");
});
it("requires page disclosure and preserves duplicate/refused/revoked binding boundaries", () => {
  const f = fixture();
  expect(() => f.register(response(), body, "/next")).toThrow(TransactionalReceiptFailure);
  expect(() => f.register(response(), body, "/next")).toThrow("page unavailable");
  f.register(response(paginated), paginated, "/next");
  expect(() => f.register(response(paginated), paginated, "/next")).toThrow("reuse");
  expect(() => f.observations.resolve("receipt", `${id}/pages/other`)).toThrow("not authorized");
  f.register(response(paginated), paginated, "/transaction");
  expect(() => f.observations.resolve("receipt", pageUrl)).toThrow("not authorized");
  const ordinary = { ...response(paginated), url: scope + "beads/a" };
  f.register(ordinary, paginated, "/next", { method: "GET", url: ordinary.url });
  expect(() => f.observations.resolve("receipt", pageUrl)).toThrow("not authorized");
});
it("does not initialize a page baseline from invalid schema, nonterminal page or mismatched wire", () => {
  const f = fixture();
  f.register(response(paginated), paginated, "/next");
  const read = f.observations.resolve("receipt", pageUrl);
  expect(() => read.validate(response({ ...pageBody, results: [] }), "GET")).toThrow("schema");
  expect(() => read.validate(response({ ...pageBody, next: `${id}/pages/p2` }), "GET")).toThrow(
    TransactionalHarnessError,
  );
  expect(() => read.validate(response({ ...pageBody, next: `${id}/pages/p2` }), "GET")).toThrow(
    "single-page fixture",
  );
  expect(() => read.validate({ ...response(pageBody), bodyText: "{}" }, "GET")).toThrow(
    "wire body",
  );
  expect(() => read.validate(response(pageBody), "GET")).not.toThrow();
  const changed = () => read.validate(response({ ...pageBody, next: `${id}/pages/p2` }), "GET");
  expect(changed).toThrow(TransactionalReceiptFailure);
  expect(changed).toThrow("retained receipt page differs from original wire facts");
  expect(() => read.validate(response(pageBody), "GET")).not.toThrow();
});
it("requires the independently validated whole source body to agree with actual wire on each capture", () => {
  const f = fixture();
  expect(() =>
    f.register(response(paginated), { ...paginated, next: `${id}/pages/p2` }, "/next"),
  ).toThrow("body disagrees with wire");
  expect(() => f.observations.resolve("receipt", `${id}/pages/p2`)).toThrow("not authorized");
});

it.each(["x", "a".repeat(256)])("accepts the declared page-token boundary of %s", (token) => {
  const f = fixture(),
    value = { ...body, next: `${id}/pages/${token}` };
  f.register(response(value), value, "/next");
  expect(f.observations.resolve("receipt", value.next).target).toBe(value.next);
});
it("charges each explicit root/page binding to the same existing bounded ledger", () => {
  const f = fixture();
  for (let index = 0; index < 4; index++)
    f.register(response(paginated), paginated, index % 2 ? "/next" : "/id", undefined, `b${index}`);
  expect(() => f.register(response(paginated), paginated, "/next", undefined, "overflow")).toThrow(
    "binding limit or reuse",
  );
  expect(() => f.observations.resolve("overflow", pageUrl)).toThrow("not authorized");
});
