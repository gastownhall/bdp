/** Reference correctness of the Callables mechanism, over real HTTP. No Issue knowledge. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CallablesComposition, startReferenceService } from "../reference.js";
import { CALLABLES_CAPABILITY, declarationDiagnostics, operationId } from "./callables.js";

const scope = "https://callables.invalid/work/";
const token = "C".repeat(32);
const media = "application/vnd.bdp.v0.1+json";
const specRevision = "a".repeat(40);
const QUERY = "https://github.com/gastownhall/bdp/types/callable/callable-query";
const BATCH = "https://github.com/gastownhall/bdp/types/callable/callable-batch";
const disposals: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of disposals.splice(0).reverse()) await close();
});

const composition = (registration: "root" | "provider" = "root"): CallablesComposition => ({
  registration,
  declarations: [
    {
      name: "echo",
      kind: "query",
      properties: {
        description: "Says back what it was given.",
        parameters: [
          { name: "greeting", schema: { type: "string" }, default: "hello" },
          { name: "note", schema: { type: ["string", "null"] } },
          { name: "count", schema: { type: "integer", minimum: 1 } },
        ],
        resultSchema: { type: "object" },
      },
      implementation: ({ arguments: args }) => ({ result: args }),
    },
    {
      name: "needs/value",
      kind: "query",
      properties: {
        title: "Needs a value",
        description: "",
        parameters: [{ name: "value", schema: { type: "string" }, required: true }],
      },
      implementation: ({ arguments: args }) => ({ result: args.value }),
    },
    {
      name: "unbuilt",
      kind: "query",
      properties: {
        description: "Declared and reachable, with nothing behind it.",
        parameters: [],
      },
    },
    {
      name: "crashes",
      kind: "query",
      properties: { description: "Throws.", parameters: [] },
      implementation: () => {
        throw new Error("boom");
      },
    },
    {
      name: "lies",
      kind: "query",
      properties: {
        description: "Answers outside its own schema.",
        parameters: [],
        resultSchema: { type: "string" },
      },
      implementation: () => ({ result: 1 }),
    },
    {
      name: "record",
      kind: "batch",
      properties: {
        description: "Creates a Bead for its key; refuses a taken one with its own error.",
        idempotent: true,
        parameters: [{ name: "label", schema: { type: "string" }, required: true }],
        errorSchema: {
          type: "object",
          properties: { reason: { const: "taken" } },
          required: ["reason"],
        },
      },
      implementation: ({ arguments: args, effects, read, scope: at }) => {
        const id = `records/${args.label}`;
        if (args.label === "taken") return { error: { reason: "taken" } };
        if (read(at + id) !== undefined) return { result: { id, created: false } };
        const created = effects!.createBead({
          id,
          type: "https://callables.invalid/types/Record",
          properties: {},
          metadata: {},
        });
        return created.status === 200 ? { result: { id, created: true } } : { problem: created };
      },
    },
    {
      name: "half-done",
      kind: "batch",
      properties: {
        description: "Commits one Bead, then fails.",
        atomic: true,
        parameters: [],
      },
      implementation: ({ effects }) => {
        effects!.createBead({
          id: "half/atomic",
          type: "https://callables.invalid/types/Record",
          properties: {},
          metadata: {},
        });
        return { error: { reason: "changed its mind" } };
      },
    },
    {
      name: "half-done-loosely",
      kind: "batch",
      properties: {
        description: "Commits one Bead, then fails, promising nothing.",
        parameters: [],
      },
      implementation: ({ effects }) => {
        effects!.createBead({
          id: "half/loose",
          type: "https://callables.invalid/types/Record",
          properties: {},
          metadata: {},
        });
        return { error: { reason: "changed its mind" } };
      },
    },
  ],
});

async function service(
  callables: CallablesComposition | null = composition(),
  directory = mkdtempSync(path.join(tmpdir(), "bdp-callables-")),
  create = true,
) {
  const config = {
    directory,
    create,
    instance: "callables-test",
    scope,
    specRevision,
    credentials: [{ token, principal: "p" }],
    ...(callables === null ? {} : { callables }),
  };
  const server = await startReferenceService(config);
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await server.close();
    }
  };
  disposals.push(() => rmSync(directory, { recursive: true, force: true }));
  disposals.push(close);
  const address = new URL(server.listenUrl);
  const wire = (
    target: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Promise<{ status: number; headers: Record<string, unknown>; text: string; json: any }>(
      (resolve, reject) => {
        const url = new URL(target, scope);
        const text =
          body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
        const req = request(
          {
            hostname: address.hostname,
            port: address.port,
            method,
            path: url.pathname + url.search,
            headers: {
              host: url.host,
              authorization: `Bearer ${token}`,
              accept: media,
              ...(text === undefined ? {} : { "content-type": media }),
              ...headers,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              const out = Buffer.concat(chunks).toString("utf8");
              let json: unknown;
              try {
                json = out ? JSON.parse(out) : undefined;
              } catch {}
              resolve({ status: res.statusCode!, headers: res.headers, text: out, json });
            });
          },
        );
        req.on("error", reject);
        req.end(text);
      },
    );
  const call = (name: string, body: unknown = { arguments: {} }, headers = {}) =>
    wire(`bdp/call/${name}`, "POST", body, headers);
  const revisions = async () => {
    const out: Record<string, string> = {};
    for (const kind of ["beads", "links"]) {
      const page = await wire(`bdp/${kind}?limit=1000`);
      for (const item of page.json.items) out[item.id] = item.revision;
    }
    return out;
  };
  return { server, wire, call, revisions, close, directory };
}

describe("Callables on the reference service", () => {
  it("is absent, and its namespace stays reserved, without the explicit composition", async () => {
    const { wire } = await service(null);
    expect((await wire("bdp")).json.capabilities[CALLABLES_CAPABILITY]).toBeUndefined();
    expect((await wire("bdp/call")).json.code).toBe("resource-not-found");
  });

  it("CB-1: advertises version 1 with closed empty detail", async () => {
    const { wire } = await service();
    expect((await wire("bdp")).json.capabilities[CALLABLES_CAPABILITY]).toEqual({ "1": {} });
  });

  it("CB-3: a query returns the closed callableResult, private and unversioned", async () => {
    const { call } = await service();
    const reply = await call("echo");
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe(media);
    expect(reply.headers["cache-control"]).toBe("private, no-store");
    expect(reply.headers.etag).toBeUndefined();
    expect(reply.headers.location).toBeUndefined();
    expect(reply.json).toEqual({ result: { greeting: "hello" } });
  });

  it("§4: absence stays absence, null is a supplied value, a default is the service's", async () => {
    const { call } = await service();
    expect((await call("echo", { arguments: { note: null } })).json.result).toEqual({
      greeting: "hello",
      note: null,
    });
    expect((await call("echo", { arguments: { greeting: "hi" } })).json.result).toEqual({
      greeting: "hi",
    });
  });

  it.each([
    ["an unknown argument", "echo", { zzz: 1 }, "zzz"],
    ["a missing required parameter", "needs/value", {}, "value"],
    ["a value outside its schema", "echo", { count: 0 }, "count"],
    ["a null its schema rules out", "echo", { greeting: null }, "greeting"],
  ])("CB-4, CB-5: %s is validation-failed naming the parameter", async (_, name, args, named) => {
    const { call } = await service();
    const reply = await call(name, { arguments: args });
    expect(reply.status).toBe(422);
    expect(reply.headers["content-type"]).toBe("application/problem+json");
    expect(reply.json).toMatchObject({
      type: "https://github.com/gastownhall/bdp/problems/validation",
      code: "validation-failed",
      retry: "never",
    });
    expect(JSON.stringify(reply.json.diagnostics)).toContain(named);
  });

  it("CB-6: no reachable Callable at the mount, by name or by spelling", async () => {
    const { call } = await service();
    for (const name of ["nope", "a/b/c", "..%2fecho"]) {
      const reply = await call(name);
      expect(reply.status, name).toBe(404);
      expect(reply.json).toMatchObject({
        type: "https://github.com/gastownhall/bdp/problems/not-found",
        code: "callable-not-found",
        retry: "after-state-change",
      });
    }
  });

  it("CB-7: under idempotency a key is required, and a replay is the original result", async () => {
    const { call, revisions } = await service();
    const body = { arguments: { label: "first" } };
    const keyless = await call("record", body);
    expect(keyless.status).toBe(400);
    expect(keyless.json.code).toBe("malformed-request");
    const first = await call("record", body, { "idempotency-key": "k1" });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({
      changed: true,
      result: { id: "records/first", created: true },
    });
    const state = await revisions();
    const replay = await call("record", body, { "idempotency-key": "k1" });
    expect(replay.text).toBe(first.text);
    expect(await revisions()).toEqual(state);
    const again = await call("record", body, { "idempotency-key": "k2" });
    expect(again.json).toEqual({
      changed: false,
      result: { id: "records/first", created: false },
    });
    expect(await revisions()).toEqual(state);
    const conflict = await call(
      "record",
      { arguments: { label: "other" } },
      {
        "idempotency-key": "k1",
      },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.json.code).toBe("idempotency-conflict");
  });

  it("§6: a retained key replays across reopen, even once the Callable is gone", async () => {
    const { call, close, directory } = await service();
    const body = { arguments: { label: "kept" } };
    const first = await call("record", body, { "idempotency-key": "k1" });
    await close();
    const reopened = await service(
      {
        ...composition(),
        declarations: composition().declarations.filter((d) => d.name !== "record"),
      },
      directory,
      false,
    );
    const replay = await reopened.call("record", body, { "idempotency-key": "k1" });
    expect(replay.text).toBe(first.text);
  });

  it("a Callable key and a Write key are one namespace", async () => {
    const { call, wire } = await service();
    await call("record", { arguments: { label: "one" } }, { "idempotency-key": "shared" });
    const reply = await wire(
      "bdp/operations/createBead",
      "POST",
      { type: "https://callables.invalid/types/Record", properties: {}, metadata: {} },
      { "idempotency-key": "shared" },
    );
    expect(reply.status).toBe(409);
    expect(reply.json.code).toBe("idempotency-conflict");
  });

  it("CB-8: a query invocation changes no revision, and has no way to", async () => {
    const { call, revisions } = await service();
    const state = await revisions();
    await call("echo");
    await call("needs/value", { arguments: { value: "x" } });
    expect(await revisions()).toEqual(state);
  });

  it("CB-9: a reachable Callable with nothing behind it is callable-unavailable", async () => {
    const { call } = await service();
    const reply = await call("unbuilt");
    expect(reply.status).toBe(503);
    expect(reply.json).toMatchObject({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "callable-unavailable",
      retry: "after-state-change",
    });
    expect(Object.hasOwn(reply.json, "error")).toBe(false);
  });

  it("CB-10: the operation's own error is a 409 carrying its value", async () => {
    const { call, revisions } = await service();
    const state = await revisions();
    const reply = await call(
      "record",
      { arguments: { label: "taken" } },
      {
        "idempotency-key": "k",
      },
    );
    expect(reply.status).toBe(409);
    expect(reply.json).toMatchObject({
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      code: "callable-error",
      retry: "after-state-change",
      error: { reason: "taken" },
    });
    expect(await revisions()).toEqual(state);
  });

  it("§9: a crash and an out-of-schema answer are 5xx, never callable-error or a result", async () => {
    const { call } = await service();
    for (const name of ["crashes", "lies"]) {
      const reply = await call(name);
      expect(reply.status, name).toBe(503);
      expect(reply.json.code).toBe("temporarily-unavailable");
      expect(Object.hasOwn(reply.json, "error")).toBe(false);
    }
  });

  it("CB-11: GET of a declaration's canonical URL is the ordinary record", async () => {
    const { wire } = await service();
    const reply = await wire("needs/value");
    expect(reply.status).toBe(200);
    expect(reply.headers["bdp-resource-kind"]).toBe("bead");
    expect(reply.json).toMatchObject({
      id: `${scope}needs/value`,
      type: QUERY,
      properties: { title: "Needs a value", description: "" },
      metadata: {},
    });
    expect(reply.headers.etag).toBe(`"${reply.json.revision}"`);
    const batch = await wire("record");
    expect(batch.json.type).toBe(BATCH);
    const inventory = await wire(`bdp/beads?type=${encodeURIComponent(QUERY)}&limit=1000`);
    expect(inventory.json.items.map((item: { id: string }) => item.id)).toContain(
      `${scope}needs/value`,
    );
  });

  it("CB-12: a declaration with no live Link is unreachable, and the Link makes it reachable", async () => {
    const { wire, call } = await service();
    const links = await wire(`sys/callables?view=links&direction=outbound&limit=1000`);
    expect(links.status).toBe(200);
    expect(links.json.items.length).toBe(composition().declarations.length);
    const created = await wire(
      "bdp/operations/createBead",
      "POST",
      {
        id: "later",
        type: QUERY,
        properties: { description: "Declared by a client.", parameters: [] },
        metadata: {},
      },
      { "idempotency-key": "later" },
    );
    expect(created.status).toBe(200);
    expect((await call("later")).json.code).toBe("callable-not-found");
    expect((await wire("bdp/call")).json.paths["/work/bdp/call/later"]).toBeUndefined();
    const linked = await wire(
      "bdp/operations/createLink",
      "POST",
      {
        type: links.json.items[0].type,
        source: "sys/callables",
        target: "later",
        properties: {},
        metadata: {},
      },
      { "idempotency-key": "link" },
    );
    expect(linked.status, linked.text).toBe(200);
    expect((await call("later")).json.code).toBe("callable-unavailable");
    expect((await wire("bdp/call")).json.paths["/work/bdp/call/later"]).toBeDefined();
    const removed = await wire(
      "bdp/operations/deleteLink",
      "POST",
      { link: linked.json.resource.id },
      { "idempotency-key": "unlink" },
    );
    expect(removed.status).toBe(200);
    expect((await call("later")).json.code).toBe("callable-not-found");
  });

  it("§2.5, §7: an invalid declaration is refused and `sys` is not a client's to fill", async () => {
    const { wire } = await service();
    const post = (operation: string, body: unknown, key: string) =>
      wire(`bdp/operations/${operation}`, "POST", body, { "idempotency-key": key });
    const invalid = await post(
      "createBead",
      {
        id: "bad",
        type: QUERY,
        properties: { description: "x", parameters: [], body: {} },
        metadata: {},
      },
      "bad",
    );
    expect(invalid.status).toBe(422);
    expect(invalid.json.code).toBe("validation-failed");
    const abstract = await post(
      "createBead",
      {
        type: "https://github.com/gastownhall/bdp/types/callable/callable",
        properties: { description: "x", parameters: [] },
        metadata: {},
      },
      "abstract",
    );
    expect(abstract.status).toBe(422);
    const reserved = await post(
      "createBead",
      {
        id: "sys/mine",
        type: "https://callables.invalid/types/Record",
        properties: {},
        metadata: {},
      },
      "sys",
    );
    expect(reserved.status).toBe(409);
    expect(reserved.json.code).toBe("identity-taken");
    const stray = await post(
      "createBead",
      { id: "plain", type: "https://callables.invalid/types/Record", properties: {}, metadata: {} },
      "plain",
    );
    expect(stray.status).toBe(200);
    const links = await wire(`sys/callables?view=links&direction=outbound&limit=1`);
    const notDeclaration = await post(
      "createLink",
      {
        type: links.json.items[0].type,
        source: "sys/callables",
        target: "plain",
        properties: {},
        metadata: {},
      },
      "stray-link",
    );
    expect(notDeclaration.status).toBe(422);
  });

  it("provider registration: no root Bead, and the provider's set is what is reachable", async () => {
    const { wire, call } = await service(composition("provider"));
    expect((await wire("sys/callables")).status).toBe(404);
    expect((await call("echo")).status).toBe(200);
    await wire(
      "bdp/operations/createBead",
      "POST",
      {
        id: "later",
        type: QUERY,
        properties: { description: "No endpoint.", parameters: [] },
        metadata: {},
      },
      { "idempotency-key": "later" },
    );
    expect((await call("later")).json.code).toBe("callable-not-found");
  });

  it("CB-13: an atomic Problem undoes its effects; without atomic the effect stands", async () => {
    const { call, wire, revisions } = await service();
    const state = await revisions();
    const atomic = await call("half-done", { arguments: {} }, { "idempotency-key": "a" });
    expect(atomic.status).toBe(409);
    expect(await revisions()).toEqual(state);
    expect((await wire("half/atomic")).status).toBe(404);
    const loose = await call("half-done-loosely", { arguments: {} }, { "idempotency-key": "b" });
    expect(loose.status).toBe(409);
    expect((await wire("half/loose")).status).toBe(200);
    const replayed = await call("half-done", { arguments: {} }, { "idempotency-key": "a" });
    expect(replayed.text).toBe(atomic.text);
  });

  it("a committed effect survives reopen: the store's recovery accepts it", async () => {
    const { call, close, directory } = await service();
    await call("record", { arguments: { label: "durable" } }, { "idempotency-key": "k" });
    await call("half-done", { arguments: {} }, { "idempotency-key": "a" });
    await close();
    const reopened = await service(composition(), directory, false);
    expect((await reopened.wire("records/durable")).status).toBe(200);
    expect((await reopened.wire("half/atomic")).status).toBe(404);
  });

  it("CB-14: one operation per reachable Callable, projected under §14", async () => {
    const { wire } = await service();
    const reply = await wire("bdp/call");
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toContain("application/vnd.oai.openapi+json");
    const { paths, openapi } = reply.json;
    expect(openapi).toMatch(/^3\.1\./);
    expect(Object.keys(paths).sort()).toEqual(
      composition()
        .declarations.map(({ name }) => `/work/bdp/call/${name}`)
        .sort(),
    );
    const query = paths["/work/bdp/call/needs/value"].post;
    expect(query.operationId).toBe("needsValue");
    expect(query.summary).toBe("Needs a value");
    expect(query.parameters).toBeUndefined();
    const args = query.requestBody.content[media].schema.properties.arguments;
    expect(args.additionalProperties).toBe(false);
    expect(args.required).toEqual(["value"]);
    expect(args.properties.value).toEqual({ type: "string" });
    expect(query["x-bdp-callable"]).toEqual({ type: QUERY });
    const batch = paths["/work/bdp/call/record"].post;
    expect(batch.parameters[0]).toMatchObject({ name: "Idempotency-Key", in: "header" });
    expect(batch["x-bdp-callable"]).toEqual({ type: BATCH, idempotent: true });
    expect(batch.responses["200"].content[media].schema.required).toEqual(["result", "changed"]);
    expect(batch.responses["409"].content["application/problem+json"].schema.allOf[1]).toEqual({
      properties: {
        error: {
          type: "object",
          properties: { reason: { const: "taken" } },
          required: ["reason"],
        },
      },
    });
    const head = await wire("bdp/call", "HEAD");
    expect(head.status).toBe(200);
    expect(head.text).toBe("");
  });

  it("§14: a $ref in a schema still resolves in the projected document", async () => {
    const { wire } = await service({
      registration: "provider",
      declarations: [
        {
          name: "refs",
          kind: "query",
          properties: {
            description: "",
            parameters: [
              {
                name: "shape",
                schema: { $ref: "#/$defs/shape", $defs: { shape: { type: "string" } } },
              },
            ],
          },
        },
      ],
    });
    const document = (await wire("bdp/call")).json;
    const schema = document.paths["/work/bdp/call/refs"].post.requestBody.content[media].schema;
    const parameter = schema.properties.arguments.properties.shape;
    const hoisted = document.components.schemas["refs.parameter.shape"];
    expect(parameter.$ref).toBe("#/components/schemas/refs.parameter.shape");
    expect(hoisted.$ref).toBe("#/components/schemas/refs.parameter.shape/$defs/shape");
  });

  it("§3: the mount's method, media and closed body", async () => {
    const { wire, call } = await service();
    for (const method of ["GET", "PUT", "DELETE"]) {
      const reply = await wire("bdp/call/echo", method);
      expect(reply.status, method).toBe(405);
      expect(reply.headers.allow).toBe("POST");
      expect(reply.text).toBe("");
    }
    const post = await wire("bdp/call", "POST", { arguments: {} });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    for (const contentType of ["application/json", "text/plain"]) {
      const reply = await call("echo", { arguments: {} }, { "content-type": contentType });
      expect(reply.status, contentType).toBe(415);
      expect(reply.json.code).toBe("unsupported-media-type");
    }
    for (const body of [
      "{",
      "[]",
      {},
      { arguments: [] },
      { arguments: {}, name: "echo" },
      '{"arguments":{},"arguments":{}}',
    ]) {
      const reply = await call("echo", body);
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(reply.json.code).toBe("malformed-request");
    }
  });

  it("§3: a query takes neither key nor provenance; a batch carries provenance onto revisions", async () => {
    const { wire, call } = await service();
    expect((await call("echo", { arguments: {} }, { "idempotency-key": "k" })).json.code).toBe(
      "malformed-request",
    );
    expect(
      (
        await call("echo", {
          arguments: {},
          revisionProvenance: { actor: { id: "sam", basis: "writer-supplied" } },
        })
      ).json.code,
    ).toBe("malformed-request");
    await call(
      "record",
      {
        arguments: { label: "signed" },
        revisionProvenance: { actor: { id: "sam", basis: "writer-supplied" } },
      },
      { "idempotency-key": "k" },
    );
    const record = await wire("records/signed");
    expect(record.json.revisionProvenance.actor).toEqual({ id: "sam", basis: "writer-supplied" });
  });

  it("refuses to start with an invalid declaration, naming it", async () => {
    await expect(
      service({
        registration: "provider",
        declarations: [
          {
            name: "bad",
            kind: "query",
            properties: {
              description: "",
              parameters: [{ name: "x", schema: { type: "string" }, default: 1 }],
            },
          },
        ],
      }),
    ).rejects.toThrow(/bad is not a valid declaration: .*default/);
  });
});

describe("declarationDiagnostics (§2.5)", () => {
  const base = { description: "", parameters: [] };
  const string = { type: "string" };
  it.each([
    ["no description", { parameters: [] }],
    ["no parameters", { description: "" }],
    ["a body", { ...base, body: {} }],
    [
      "duplicate names",
      {
        description: "",
        parameters: [
          { name: "a", schema: string },
          { name: "a", schema: string },
        ],
      },
    ],
    ["an empty name", { description: "", parameters: [{ name: "", schema: string }] }],
    [
      "required with default",
      {
        description: "",
        parameters: [{ name: "a", schema: string, required: true, default: "x" }],
      },
    ],
    [
      "a default failing its schema",
      { description: "", parameters: [{ name: "a", schema: string, default: 1 }] },
    ],
    [
      "a foreign $ref",
      { description: "", parameters: [{ name: "a", schema: { $ref: "https://x.invalid/s" } }] },
    ],
    [
      "a dangling $ref",
      { description: "", parameters: [{ name: "a", schema: { $ref: "#/$defs/none" } }] },
    ],
    [
      "a flag on an undeclared parameter",
      { ...base, cliMapping: { flags: [{ names: ["-x"], parameter: "x" }] } },
    ],
    [
      "a position on an undeclared parameter",
      { ...base, cliMapping: { positionals: [{ position: 0, parameter: "x" }] } },
    ],
    [
      "duplicate positions",
      {
        description: "",
        parameters: [
          { name: "a", schema: string },
          { name: "b", schema: string },
        ],
        cliMapping: {
          positionals: [
            { position: 0, parameter: "a" },
            { position: 0, parameter: "b" },
          ],
        },
      },
    ],
    [
      "duplicate flag spellings",
      {
        description: "",
        parameters: [
          { name: "a", schema: string },
          { name: "b", schema: string },
        ],
        cliMapping: { flags: [{ names: ["--a"], parameter: "b" }] },
      },
    ],
    [
      "a member the schema lacks",
      {
        description: "",
        parameters: [{ name: "p", schema: { type: "object", properties: {} } }],
        cliMapping: { memberFlags: [{ member: "m", parameter: "p" }] },
      },
    ],
    [
      "a member named actor",
      {
        description: "",
        parameters: [{ name: "p", schema: { type: "object", properties: { actor: string } } }],
        cliMapping: { memberFlags: [{ member: "actor", parameter: "p" }] },
      },
    ],
    [
      "a member flag spelled --help",
      {
        description: "",
        parameters: [{ name: "p", schema: { type: "object", properties: { m: string } } }],
        cliMapping: { memberFlags: [{ member: "m", names: ["--help"], parameter: "p" }] },
      },
    ],
    [
      "an unknown parameter member",
      { description: "", parameters: [{ name: "a", schema: string, extra: 1 }] },
    ],
  ])("refuses %s", (_, properties) => {
    expect(declarationDiagnostics(properties).length).toBeGreaterThan(0);
  });
  it("admits the profile's worked example and an open root", () => {
    expect(
      declarationDiagnostics({
        title: "Reserve a room",
        description: "x",
        idempotent: true,
        atomic: true,
        extra: "open root",
        parameters: [
          { name: "room", schema: { type: "string", minLength: 1 }, required: true },
          { name: "day", schema: { type: "string", format: "date" }, required: true },
        ],
        resultSchema: { type: "object" },
        errorSchema: { oneOf: [{ type: "object", properties: { reason: { const: "x" } } }] },
        cliMapping: { positionals: [{ position: 0, parameter: "room" }] },
      }),
    ).toEqual([]);
  });
  it("names the operationId by §14's rule", () => {
    expect(operationId("rooms/reserve")).toBe("roomsReserve");
    expect(operationId("issue/dep/add")).toBe("issueDepAdd");
    expect(operationId("reserve-room")).toBe("reserveRoom");
    expect(operationId("issue/metadata/compare-and-set")).toBe("issueMetadataCompareAndSet");
  });
  it("evaluates every published Issue declaration, so a package could be served", () => {
    const catalog = JSON.parse(
      readFileSync(
        new URL("../../../bd-domain/catalog/issue-callables-preview-1.json", import.meta.url),
        "utf8",
      ),
    ) as { declarations: readonly Record<string, unknown>[] };
    const refused = catalog.declarations.flatMap(({ name, type: _type, ...properties }) => {
      const diagnostics = declarationDiagnostics(properties);
      return diagnostics.length === 0 ? [] : [`${String(name)}: ${diagnostics[0]?.message}`];
    });
    expect(refused).toEqual([]);
    expect(catalog.declarations.length).toBe(45);
  });
});
