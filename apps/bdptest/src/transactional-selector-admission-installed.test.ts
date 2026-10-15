/** Actual bounded Selector admission; private serving evidence, not qualification. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { isJsonSchemaUri, isJsonSchemaDateTime } from "@bdp/protocol";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal: AbortSignal,
  ): Promise<{ child: ChildProcess; ready: Record<string, unknown>; close(): Promise<void> }>;
};
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw Error("installed Selector override requires explicit source attribution");
const source =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const scope = "https://reference.invalid/acme/",
  type = `${scope}types/bead`,
  schema = `${scope}schemas/n`;
const descriptor = {
  id: type,
  name: "Bead",
  describes: "bead",
  conformsTo: [],
  propertiesSchema: schema,
};
const artifacts = {
  descriptors: [{ retrievalUri: type, utf8: JSON.stringify(descriptor) }],
  schemas: [
    {
      retrievalUri: schema,
      utf8: JSON.stringify({
        $id: schema,
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
        additionalProperties: false,
      }),
    },
  ],
};
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
ajv.addSchema(bundle);
const validators = Object.fromEntries(
  [
    "mutationReceipt",
    "transactionalProblem",
    "readProblem",
    "eventPage",
    "changefeedPage",
    "beadRecord",
  ].map((name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })]),
);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("expected wire object");
  return value as Record<string, unknown>;
}
function array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw Error("expected wire array");
  return value.map(object);
}
function checked(name: string, value: unknown) {
  const validate = validators[name];
  if (!validate) throw Error("missing schema validator");
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}
function bytes(n: number) {
  return `$[?@.missing${" ".repeat(n - 13)}]`;
}
function depth(groups: number) {
  return `$[?${"(".repeat(groups)}@.missing${")".repeat(groups)}]`;
}
function nodes(groups: number) {
  let expression = "@.missing";
  for (let level = 0; level < 6; level++) expression = `(${expression}||${expression})`;
  return `$[?${"(".repeat(groups)}${expression}${")".repeat(groups)}]`;
}
const input = (selector: string, update = false) => ({
  collection: "beads",
  selector,
  ...(update ? { change: [{ op: "replace", path: "/n", value: 1 }] } : {}),
});
const batch = (...operations: unknown[]) => ({ operations });
const create = (id: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { n: 0 },
});
const set = (selector: string, update = false) => ({
  operation: update ? "updateWhere" : "deleteWhere",
  ...input(selector, update),
});

it("installed Selector grammar and fresh capacity preserve keys receipts and complete effects", async () => {
  const controller = new AbortController();
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-selector-installed-"));
  const deadline = setTimeout(
    () => controller.abort(Error("installed Selector cohort deadline")),
    90000,
  );
  const token = randomBytes(32).toString("base64url");
  const failures: unknown[] = [],
    observations: unknown[] = [];
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let childAbsent = false;
  const routes = new Set(
    [
      "POST operations/batch",
      "POST operations/delete-where",
      "POST operations/update-where",
      "GET beads/late",
      "GET beads/a",
      "GET changes/?after=genesis",
      "GET events/",
    ].map((route) => {
      const [method, target] = route.split(" ");
      return `${method} ${new URL(target!, scope).href}`;
    }),
  );
  const initialRoutes = [...routes];
  let epoch: string | undefined, view: string | undefined;
  try {
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [{ token, principal: "writer", canMutate: true }],
      },
      controller.signal,
    );
    binding = installedTransactionBinding(child.ready, source, fixture);
    for (const [name, target] of [
      ["batch", "batch"],
      ["deleteWhere", "delete-where"],
      ["updateWhere", "update-where"],
    ])
      expect(object(child.ready.targets)[name!]).toBe(`${scope}operations/${target}`);
    const address = new URL(String(child.ready.listenUrl));
    async function send(
      target: string,
      payload: unknown | undefined,
      key: string | undefined,
      status: number,
      position?: string,
    ) {
      if (!child || !binding) throw Error("missing installed child");
      expect(installedTransactionBinding(child.ready, source, fixture)).toEqual(binding);
      const url = new URL(target, scope).href,
        method = payload === undefined ? "GET" : "POST";
      expect(routes.has(`${method} ${url}`), "confined Selector route").toBe(true);
      if (observations.length >= 25) throw Error("Selector exchange bound exceeded");
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: address.hostname, port: Number(address.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 1048576,
          exactMode: {
            scope,
            profile: "transactional",
            routes: [{ method, url }],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: "writer",
            credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
          },
        },
      );
      const requestBody = payload === undefined ? undefined : JSON.stringify(payload);
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: "writer",
        raw: {
          headerLines:
            payload === undefined
              ? []
              : [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: key! },
                ],
          ...(requestBody === undefined ? {} : { bodyBytes: Buffer.from(requestBody) }),
        },
      });
      observations.push({
        method,
        url,
        key,
        requestBody,
        status: response.status,
        headers: response.headers,
        body: response.bodyText,
        wireResponseBase64: response.wireResponseBytes
          ? Buffer.from(response.wireResponseBytes).toString("base64")
          : null,
        wireSha256: response.wireResponseBytes
          ? createHash("sha256").update(response.wireResponseBytes).digest("hex")
          : null,
      });
      expect(
        response.status,
        JSON.stringify({
          oracle: "installed Selector status",
          exchange: observations.length,
          status: response.status,
          developmentLimit: response.headers["x-bdp-development-limit"],
          contentLength: response.headers["content-length"],
        }),
      ).toBe(status);
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
      if (position !== undefined) {
        epoch ??= response.headers["bdp-scope-epoch"];
        view ??= response.headers["bdp-authorization-view"];
        expect(epoch).toEqual(expect.any(String));
        expect(view).toEqual(expect.any(String));
        expect(response.headers["bdp-scope-epoch"]).toBe(epoch);
        expect(response.headers["bdp-authorization-view"]).toBe(view);
        expect(response.headers["bdp-scope-position"]).toBe(position);
      } else if (status === 400) {
        for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(response.headers[name]).toBeUndefined();
      }
      const value = object(JSON.parse(response.bodyText));
      if (status === 200 && method === "POST") {
        checked("mutationReceipt", value);
        expect(value).toMatchObject({
          status: "completed",
          detail: "available",
          idempotencyKey: key,
          scopeEpoch: epoch,
          authorizationView: view,
          next: null,
        });
      } else if (status >= 400) {
        checked(status === 404 ? "readProblem" : "transactionalProblem", value);
        expect(response.headers["content-type"]).toBe("application/problem+json");
        expect(response.headers.location).toBeUndefined();
        expect(response.headers["retry-after"]).toBeUndefined();
      }
      return value;
    }
    function problem(
      value: Record<string, unknown>,
      status: 400 | 413,
      pointer: string,
      limit?: string,
    ) {
      expect(value).toEqual({
        type: `https://github.com/gastownhall/bdp/problems/${status === 400 ? "request" : "size"}`,
        status,
        code: status === 400 ? "malformed-request" : "limit-exceeded",
        retry: "never",
        pointer,
        ...(limit ? { limit } : {}),
      });
    }
    function noop(value: Record<string, unknown>) {
      expect(value.results).toEqual([{ operationIndex: 0, outcome: "matched", count: 0 }]);
      expect(value.requiredPosition).toBe("pos-1");
      expect(value).not.toHaveProperty("effectPosition");
    }
    function resource(value: unknown, n: number) {
      const row = object(value);
      checked("beadRecord", row);
      expect(row).toEqual({
        id: `${scope}beads/a`,
        type,
        properties: { n },
        metadata: {},
        revision: expect.any(String),
      });
      expect(String(row.revision).length).toBeGreaterThan(0);
      return row;
    }
    const seedBody = batch(create("a"));
    const seed = await send("operations/batch", seedBody, "seed", 200, "pos-1"); //1
    const seeded = resource(array(seed.results)[0]?.resource, 0);
    expect(seed.results).toEqual([{ operationIndex: 0, outcome: "created", resource: seeded }]);
    expect(seed.requiredPosition).toBe("pos-1");
    expect(seed.effectPosition).toBe("pos-1");
    problem(
      await send("operations/delete-where", input("$..*"), "bad-single", 400),
      400,
      "/selector",
    ); //2
    noop(await send("operations/delete-where", input("$[?@.missing]"), "bad-single", 200, "pos-1")); //3
    problem(
      await send("operations/batch", batch(create("late"), set("$..*", true)), "bad-batch", 400),
      400,
      "/operations/1/selector",
    ); //4
    expect(await send("beads/late", undefined, undefined, 404, "pos-1")).toMatchObject({
      code: "resource-not-found",
      status: 404,
      retry: "after-state-change",
    }); //5
    noop(await send("operations/batch", batch(set("$[?@.missing]")), "bad-batch", 200, "pos-1")); //6
    problem(
      await send("operations/delete-where", input(bytes(4097)), "bytes", 413, "pos-1"),
      413,
      "/selector",
      "selector.bytes",
    ); //7
    noop(await send("operations/delete-where", input("$[?@.missing]"), "bytes", 200, "pos-1")); //8
    problem(
      await send("operations/update-where", input(depth(31), true), "depth", 413, "pos-1"),
      413,
      "/selector",
      "selector.depth",
    ); //9
    noop(
      await send("operations/update-where", input("$[?@.missing]", true), "depth", 200, "pos-1"),
    ); //10
    problem(
      await send(
        "operations/batch",
        batch({ operation: "deleteBead", bead: "beads/missing" }, set(nodes(3))),
        "nodes",
        413,
        "pos-1",
      ),
      413,
      "/operations/1/selector",
      "selector.nodes",
    ); //11
    noop(await send("operations/batch", batch(set("$[?@.missing]")), "nodes", 200, "pos-1")); //12
    noop(await send("operations/delete-where", input(bytes(4096)), "exact-bytes", 200, "pos-1")); //13
    noop(
      await send("operations/update-where", input(depth(30), true), "exact-depth", 200, "pos-1"),
    ); //14
    noop(await send("operations/batch", batch(set(nodes(2))), "exact-nodes", 200, "pos-1")); //15
    problem(
      await send("operations/delete-where", input(`${depth(10000)} true`), "seed", 400),
      400,
      "/selector",
    ); //16
    expect(await send("operations/delete-where", input(bytes(4097)), "seed", 409, "pos-1")).toEqual(
      {
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "idempotency-conflict",
        status: 409,
        retry: "never",
      },
    ); //17
    expect(await send("operations/batch", seedBody, "seed", 200, "pos-1")).toEqual(seed); //18
    const writeBody = input(`$[?@.id == "${scope}beads/a"]`, true);
    const write = await send("operations/update-where", writeBody, "write", 200, "pos-2"); //19
    const updated = resource(array(write.results)[1]?.resource, 1);
    expect(updated.revision).not.toBe(seeded.revision);
    expect(write.results).toEqual([
      { operationIndex: 0, outcome: "matched", count: 1 },
      { operationIndex: 0, outcome: "updated", resource: updated },
    ]);
    expect(write.requiredPosition).toBe("pos-2");
    expect(write.effectPosition).toBe("pos-2");
    expect(await send("operations/update-where", writeBody, "write", 200, "pos-2")).toEqual(write); //20
    const receiptUrl = new URL(String(write.id));
    expect(receiptUrl.href).toBe(write.id);
    expect(receiptUrl.href.length).toBeLessThanOrEqual(8192);
    expect(receiptUrl.origin).toBe(new URL(scope).origin);
    expect(receiptUrl.search + receiptUrl.hash + receiptUrl.username + receiptUrl.password).toBe(
      "",
    );
    expect(receiptUrl.href).toMatch(
      /^https:\/\/reference\.invalid\/acme\/receipts\/[A-Za-z0-9_-]+$/,
    );
    routes.add(`GET ${receiptUrl.href}`);
    const receipt = await send(receiptUrl.href, undefined, undefined, 200, "pos-2"); //21
    checked("mutationReceipt", receipt);
    expect(receipt).toEqual(write);
    expect(await send("beads/a", undefined, undefined, 200, "pos-2")).toEqual(updated); //22
    const first = await send("changes/?after=genesis", undefined, undefined, 200, "pos-2"); //23
    checked("changefeedPage", first);
    expect(first).toMatchObject({
      scope,
      scopeEpoch: epoch,
      authorizationView: view,
      after: "genesis",
      observedHeadPosition: "pos-2",
    });
    expect(array(first.groups)).toHaveLength(1);
    const firstGroup = array(first.groups)[0]!;
    const next = new URL(String(first.next));
    expect(next.href).toBe(first.next);
    expect(next.href.length).toBeLessThanOrEqual(8192);
    expect(next.origin).toBe(new URL(scope).origin);
    expect(next.pathname).toBe("/acme/changes/");
    expect(next.username + next.password + next.hash).toBe("");
    expect([...next.searchParams]).toEqual([["after", firstGroup.checkpoint]]);
    routes.add(`GET ${next.href}`);
    const events = await send("events/", undefined, undefined, 200, "pos-2"); //24
    checked("eventPage", events);
    expect(events.source).toBe(`${scope}events/`);
    expect(events.next).toBeNull();
    const facts = array(events.events);
    expect(facts).toHaveLength(2);
    const expectedFacts = [
      {
        type: "created",
        transaction: seed.transaction,
        data: { revision: seeded.revision, properties: { n: 0 }, metadata: {} },
      },
      {
        type: "updated",
        transaction: write.transaction,
        data: {
          previousRevision: seeded.revision,
          revision: updated.revision,
          change: [{ op: "replace", path: "/n", value: 1 }],
        },
      },
    ];
    for (const [index, fact] of facts.entries()) {
      expect(fact.id).toMatch(
        new RegExp(`^ev_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{43}_pos-${index + 1}_0$`),
      );
      expect(fact).toEqual({
        id: fact.id,
        ordinal: 0,
        source: `${scope}events/`,
        subject: `${scope}beads/a`,
        subjectType: type,
        time: expect.any(String),
        ...expectedFacts[index],
      });
    }
    const second = await send(next.href, undefined, undefined, 200, "pos-2"); //25
    checked("changefeedPage", second);
    expect(second).toMatchObject({
      scope,
      scopeEpoch: epoch,
      authorizationView: view,
      after: firstGroup.checkpoint,
      observedHeadPosition: "pos-2",
      next: null,
    });
    expect(array(second.groups)).toHaveLength(1);
    for (const [index, group] of [firstGroup, array(second.groups)[0]!].entries()) {
      expect(group.checkpoint).toEqual(expect.any(String));
      expect(group).toEqual({
        scopeEpoch: epoch,
        authorizationView: view,
        checkpoint: group.checkpoint,
        position: `pos-${index + 1}`,
        previousPosition: `pos-${index}`,
        projectionAdvance: false,
        transaction: index === 0 ? seed.transaction : write.transaction,
        changes: [
          { operation: "upsert", resourceKind: "bead", resource: index === 0 ? seeded : updated },
        ],
        erasures: [],
        eventCount: 1,
        events: [facts[index]],
      });
    }
    expect(observations).toHaveLength(25);
    const successfulKeys = new Set(
      (observations as { method: string; status: number; key?: string }[])
        .filter((row) => row.method === "POST" && row.status === 200)
        .map((row) => row.key),
    );
    expect([...successfulKeys].sort()).toEqual([
      "bad-batch",
      "bad-single",
      "bytes",
      "depth",
      "exact-bytes",
      "exact-depth",
      "exact-nodes",
      "nodes",
      "seed",
      "write",
    ]);
    expect(routes.size).toBe(9);
    expect(
      new Set(
        (observations as { method: string; url: string }[]).map((r) => `${r.method} ${r.url}`),
      ),
    ).toEqual(routes);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await child?.close();
    } catch (error) {
      failures.push(error);
    }
    if (controller.signal.aborted) failures.push(controller.signal.reason);
    clearTimeout(deadline);
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    if (child?.child.pid) {
      try {
        process.kill(child.child.pid, 0);
        failures.push(Error("installed child still present"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") childAbsent = true;
        else failures.push(error);
      }
    }
    if (existsSync(directory)) failures.push(Error("installed directory still present"));
  }
  console.log(
    JSON.stringify({
      kind: "installed-selector-admission",
      sourceAttribution: source,
      sourceAttributionKind:
        "supervisor-verified only when external frozen packaging audit supplies it; not child attestation",
      workspaceDirty:
        execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0,
      entry,
      entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
      binding,
      claimEligible: false,
      initialRoutes,
      observations,
      cleanup: {
        pid: child?.child.pid,
        exitCode: child?.child.exitCode,
        signalCode: child?.child.signalCode,
        childAbsent,
        directoryAbsent: !existsSync(directory),
      },
      failureCount: failures.length,
    }),
  );
  if (failures.length)
    throw new AggregateError(failures, "installed Selector observation or cleanup failed");
}, 120000);
