/** Private installed collection minimum observations, not profile admission or matrix credit. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import {
  createRawHttpExchangeExecutor,
  type HttpExchangeResponse,
  type HttpMethod,
} from "@bdp/conformance";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal?: AbortSignal,
  ): Promise<{
    child: ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const scope = "https://reference.invalid/acme/";
const beadType = `${scope}types/task`,
  linkType = `${scope}types/relationship`;
const entry =
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/transaction-installed-process.js");
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error(
    "installed collection minimum entry override requires an explicit declared source commit",
  );
const resolvedEntry = realpathSync(entry);
const entrySha256 = createHash("sha256").update(readFileSync(resolvedEntry)).digest("hex");
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const sourceCommit =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
type Row = {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  revision: string;
  ownedLinks?: Record<string, Row[]>;
};
type Page = { items: Row[]; next: string | null };
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(
  readFileSync(path.join(root, "specs/profiles/core/bdp-v0.schema.json"), "utf8"),
);
ajv.addSchema(bundle);
const receiptSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceipt` });
const problemSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/transactionalProblem` });
function json<T>(response: HttpExchangeResponse, status = 200): T {
  expect(response.status, response.bodyText).toBe(status);
  expect(response.exactRequest?.writeState).toBe("complete");
  expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
  expect(response.headers["content-type"]?.split(";", 1)[0]).toBe(
    status >= 400 ? "application/problem+json" : "application/json",
  );
  const value = JSON.parse(response.bodyText);
  if (status >= 400) expect(problemSchema(value), JSON.stringify(problemSchema.errors)).toBe(true);
  return value as T;
}
function artifacts() {
  const schema = `${scope}schemas/properties`;
  const descriptors = [
    {
      id: beadType,
      name: "Task",
      describes: "bead",
      conformsTo: [],
      propertiesSchema: schema,
      ownsOutgoing: { [linkType]: { max: 32 } },
    },
    {
      id: linkType,
      name: "Relationship",
      describes: "link",
      conformsTo: [],
      propertiesSchema: schema,
      source: { conformsTo: [beadType], external: "none" },
      target: { conformsTo: [beadType], external: "none" },
    },
  ];
  return {
    descriptors: descriptors.map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
    schemas: [
      {
        retrievalUri: schema,
        utf8: JSON.stringify({
          $id: schema,
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
          additionalProperties: false,
        }),
      },
    ],
  };
}
/** Local test lifecycle only; no target responses or shared launcher changes. */
async function finishObservation<T>(
  run: () => Promise<T>,
  cleanup: () => Promise<void>,
  signal?: AbortSignal,
  report?: (ok: boolean) => void,
): Promise<T> {
  const failures: unknown[] = [];
  let value: T | undefined;
  const checkDeadline = () => {
    try {
      signal?.throwIfAborted();
    } catch (error) {
      if (!failures.includes(error)) failures.push(error);
    }
  };
  try {
    value = await run();
  } catch (error) {
    failures.push(error);
  }
  checkDeadline();
  try {
    await cleanup();
  } catch (error) {
    failures.push(error);
  }
  checkDeadline();
  report?.(failures.length === 0);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "collection minimum observation and cleanup failed");
  return value as T;
}
async function failureAfterCleanup(error: unknown, cleanup: () => Promise<void>): Promise<never> {
  return finishObservation(async () => {
    throw error;
  }, cleanup);
}
async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  milliseconds = 90000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("installed collection minimum test deadline")),
    milliseconds,
  );
  return finishObservation(
    () => run(controller.signal),
    async () => {
      clearTimeout(timer);
    },
    controller.signal,
  );
}
async function withInstalled(
  run: (f: Awaited<ReturnType<typeof start>>) => Promise<void>,
  signal?: AbortSignal,
  label = "private-installed-collection-minimum",
): Promise<void> {
  if (!signal) return withDeadline((shared) => withInstalled(run, shared, label));
  signal.throwIfAborted();
  const f = await start(signal, label);
  await finishObservation(
    () => run(f),
    () => f.close(),
    signal,
    (ok) => f.report(ok),
  );
}
async function start(signal: AbortSignal, label: string) {
  signal.throwIfAborted();
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-collection-minimum-installed-"));
  const operator = randomBytes(32).toString("base64url"),
    reader = randomBytes(32).toString("base64url");
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts: artifacts(),
    credentials: [
      { token: operator, principal: "writer", canMutate: true },
      { token: reader, principal: "reader", canMutate: false },
    ],
  };
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>>;
  try {
    child = await launchInstalledTransaction(entry, configuration, signal);
  } catch (error) {
    return failureAfterCleanup(error, async () => {
      rmSync(directory, { recursive: true, force: true });
    });
  }
  let baseline: ReturnType<typeof installedTransactionBinding>;
  try {
    baseline = installedTransactionBinding(child.ready, sourceCommit, fixture);
    expect(child.ready.claimEligible).toBe(false);
    expect(child.ready.history).toBe(false);
  } catch (error) {
    return failureAfterCleanup(error, () =>
      finishObservation(
        () => child.close(),
        async () => {
          rmSync(directory, { recursive: true, force: true });
        },
      ),
    );
  }
  let key = 0;
  let closed = false;
  const observations: {
    url: string;
    status: number;
    method: string;
    responseBytes: number;
    wireSha256: string;
    bodySha256: string;
  }[] = [];
  async function exchange(
    url = `${scope}beads/`,
    method: HttpMethod = "GET",
    headers: Record<string, string> = {},
    body?: unknown,
    credentialRef = "operator",
  ) {
    const canonical = new URL(url);
    if (
      canonical.username !== "" ||
      canonical.password !== "" ||
      canonical.hash !== "" ||
      canonical.origin !== new URL(scope).origin ||
      !canonical.pathname.startsWith(new URL(scope).pathname)
    )
      throw new Error("collection minimum observation escaped the configured Scope");
    const address = new URL(child.ready.listenUrl as string);
    // Authorization-view is authored protocol context, not credential decoration.
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 32768,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "operator",
          credentialHandles: [
            { id: "operator", headerNames: ["authorization"] },
            { id: "reader", headerNames: ["authorization"] },
            { id: "anonymous", headerNames: [] },
          ],
          resolveCredentials: ({ credentialRef }) =>
            credentialRef === "anonymous"
              ? {}
              : {
                  authorization: `Bearer ${credentialRef === "reader" ? reader : operator}`,
                },
        },
      },
    );
    const response = await execute({
      method,
      url,
      signal,
      credentialRef,
      raw: {
        headerLines: Object.entries(headers).map(([name, value]) => ({ name, value })),
        ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
      },
    });
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(
      response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
    ).toBe("reference.invalid");
    if (!response.wireResponseBytes?.length) throw new Error("missing actual wire response");
    if (
      response.bodyOctets === undefined ||
      !Number.isSafeInteger(response.bodyOctets) ||
      response.bodyOctets < 0
    )
      throw new Error("completed response body octets unavailable");
    observations.push({
      url,
      method,
      status: response.status,
      responseBytes: response.bodyOctets,
      wireSha256: createHash("sha256").update(response.wireResponseBytes).digest("hex"),
      bodySha256: createHash("sha256").update(response.bodyText).digest("hex"),
    });
    expect(observations.length).toBeLessThanOrEqual(80);
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    return response;
  }
  return {
    exchange,
    baseline,
    signal,
    async write(operations: unknown[], credential = "operator") {
      const response = await exchange(
        `${scope}operations/batch`,
        "POST",
        {
          "content-type": "application/json",
          "idempotency-key": `snapshot_${key++}`,
        },
        { operations },
        credential,
      );
      const receipt = json<{ status: string }>(response);
      expect(receipt.status).toBe("completed");
      return response;
    },
    async close() {
      await finishObservation(
        async () => {
          await child.close();
          closed = true;
        },
        async () => {
          rmSync(directory, { recursive: true, force: true });
        },
      );
    },
    report(ok: boolean) {
      // Never log raw credentials, exactRequest headers or authored request bodies.
      console.log(
        JSON.stringify({
          observation: label,
          outcome: ok ? "passed" : "failed",
          aborted: signal.aborted,
          declaredSourceCommit: sourceCommit,
          workspaceDirty,
          closed,
          childPid: child.child.pid,
          childExitCode: child.child.exitCode,
          entry: resolvedEntry,
          entrySha256,
          binding: baseline,
          exchanges: observations.length,
          completedResponses: observations,
          claimEligible: false,
        }),
      );
    },
  };
}

function minimum(
  response: HttpExchangeResponse,
  position = response.headers["bdp-scope-position"],
) {
  const epoch = response.headers["bdp-scope-epoch"],
    view = response.headers["bdp-authorization-view"];
  if (typeof epoch !== "string" || typeof view !== "string" || typeof position !== "string")
    throw new Error("missing actual serving context");
  return {
    "bdp-scope-epoch": epoch,
    "bdp-authorization-view": view,
    "bdp-minimum-scope-position": position,
  };
}
function context(
  response: HttpExchangeResponse,
  expected: ReturnType<typeof minimum>,
  position = expected["bdp-minimum-scope-position"],
) {
  expect(response.headers["bdp-scope-epoch"]).toBe(expected["bdp-scope-epoch"]);
  expect(response.headers["bdp-authorization-view"]).toBe(expected["bdp-authorization-view"]);
  expect(response.headers["bdp-scope-position"], "actual current serving position").toBe(position);
  expect(response.headers.etag).toBeUndefined();
}
it("observes genuine installed initial collection minimums, fixed-budget failures, conditionals and retained rows", async () => {
  await withInstalled(async (f) => {
    const empty = await f.exchange(`${scope}beads/`),
      genesis = minimum(empty, "genesis");
    for (const collection of ["beads", "links"]) {
      const response = await f.exchange(`${scope}${collection}/`, "GET", genesis);
      expect(json<Page>(response)).toEqual({ items: [], next: null });
      context(response, genesis, "pos-0");
    }
    const seeded = await f.write([
        ...["a", "b", "c"].map((id, i) => ({
          operation: "createBead",
          id: `beads/${id}`,
          type: beadType,
          properties: { title: `before_${i}` },
          metadata: { seeded: id },
        })),
        ...["l", "m"].map((id) => ({
          operation: "createLink",
          id: `links/${id}`,
          type: linkType,
          source: id === "l" ? "beads/a" : "beads/b",
          target: "beads/b",
          properties: { title: `before_${id}` },
        })),
      ]),
      headers = minimum(seeded);
    const expected: Record<string, Row[]> = {};
    for (const collection of ["beads", "links"]) {
      const target = `${scope}${collection}/?limit=32&type=${encodeURIComponent(collection === "beads" ? beadType : linkType)}`;
      const response = await f.exchange(target, "GET", headers);
      const page = json<Page>(response);
      expected[collection] = page.items;
      expect(page.next).toBe(null);
      expect(page.items.map((r) => [r.id, r.properties.title])).toEqual(
        collection === "beads"
          ? [
              [`${scope}beads/a`, "before_0"],
              [`${scope}beads/b`, "before_1"],
              [`${scope}beads/c`, "before_2"],
            ]
          : [
              [`${scope}links/l`, "before_l"],
              [`${scope}links/m`, "before_m"],
            ],
      );
      for (const row of page.items) {
        expect(row.revision.length).toBeGreaterThan(0);
        expect(row.type).toBe(collection === "beads" ? beadType : linkType);
        expect(row.metadata).toEqual(
          collection === "beads" ? { seeded: row.id.split("/").at(-1) } : {},
        );
      }
      context(response, headers);
      expect(response.headers["bdp-scope-position"]).toBe(headers["bdp-minimum-scope-position"]);
      const head = await f.exchange(target, "HEAD", headers);
      expect(head.status).toBe(200);
      expect(head.bodyOctets).toBe(0);
      context(head, headers);
      // Assertion-input corruption only, after actual HEAD and context checks.
      // A syntactically valid invented position must fail the exact oracle.
      expect(() =>
        context(
          {
            ...head,
            headers: { ...head.headers, "bdp-scope-position": "pos-999" },
          },
          headers,
        ),
      ).toThrow("actual current serving position");
      console.log(
        JSON.stringify({
          observation: "installed-position-oracle-control",
          collection,
          actualPosition: head.headers["bdp-scope-position"],
          changedPosition: "pos-999",
          rejected: true,
          extraExchanges: 0,
          claimEligible: false,
        }),
      );
      for (const method of ["GET", "HEAD"] as const) {
        for (const [condition, status] of [
          [{ "if-none-match": "*" }, 304],
          [{ "if-match": '"wrong"' }, 412],
        ] as const) {
          const conditional = await f.exchange(target, method, { ...headers, ...condition });
          expect(conditional.status).toBe(status);
          expect(conditional.bodyOctets).toBe(0);
          context(conditional, headers);
        }
        const started = performance.now();
        const timeout = await f.exchange(target, method, {
          ...minimum(seeded, "pos-999"),
          "if-none-match": "*",
        });
        expect(timeout.status).toBe(503);
        context(timeout, headers);
        expect(timeout.headers["bdp-scope-position"]).toBe(headers["bdp-minimum-scope-position"]);
        if (method === "GET")
          expect(json<Record<string, unknown>>(timeout, 503)).toMatchObject({
            code: "catch-up-timeout",
            status: 503,
            retry: "after-delay",
          });
        else expect(timeout.bodyOctets).toBe(0);
        console.log(
          JSON.stringify({
            observation: "installed-minimum-timeout",
            collection,
            method,
            elapsedMs: performance.now() - started,
          }),
        );
      }
      for (const [field, value, status, code] of [
        ["bdp-authorization-view", "foreign", 409, "foreign-view"],
        ["bdp-scope-epoch", "foreign", 410, "cursor-expired"],
      ] as const) {
        for (const method of ["GET", "HEAD"] as const) {
          const response = await f.exchange(target, method, {
            ...headers,
            [field]: value,
            "if-match": '"wrong"',
          });
          expect(response.status).toBe(status);
          if (method === "GET")
            expect(json<Record<string, unknown>>(response, status)).toMatchObject({ status, code });
          else expect(response.bodyOctets).toBe(0);
          context(response, headers);
        }
      }
    }
    // The two Links have different sources: ignoring this filter returns an extra row.
    const filtered = await f.exchange(
      `${scope}links/?source=${encodeURIComponent(`${scope}beads/a`)}`,
      "GET",
      headers,
    );
    expect(json<Page>(filtered)).toEqual({ items: expected.links?.slice(0, 1), next: null });
    context(filtered, headers);
    // A valid nonmatching Type distinguishes filtering from an unfiltered collection.
    const noTypeMatch = await f.exchange(
      `${scope}beads/?type=${encodeURIComponent(linkType)}`,
      "GET",
      headers,
    );
    expect(json<Page>(noTypeMatch)).toEqual({ items: [], next: null });
    context(noTypeMatch, headers);
    for (const [query, status, code] of [
      ["limit=33", 413, "limit-exceeded"],
      [`selector=${encodeURIComponent("$[?")}`, 400, "invalid-parameter"],
    ] as const) {
      const response = await f.exchange(
        `${scope}beads/?${query}`,
        "GET",
        minimum(seeded, "pos-999"),
      );
      expect(json<Record<string, unknown>>(response, status)).toMatchObject({
        status,
        code,
        retry: "never",
      });
    }
    const anonymous = await f.exchange(`${scope}beads/`, "GET", headers, undefined, "anonymous");
    expect(anonymous.status).toBe(401);
    for (const h of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(anonymous.headers[h]).toBeUndefined();
    // Capture after slow timeout witnesses: default collection cursors live only1s.
    const first = await f.exchange(`${scope}beads/?limit=2`, "GET", headers),
      page = json<Page>(first);
    expect(page.items).toEqual(expected.beads?.slice(0, 2));
    if (typeof page.next !== "string") throw new Error("missing actual collection continuation");
    const changed = await f.write([
      {
        operation: "updateBead",
        bead: "beads/c",
        propertiesChange: [{ op: "replace", path: "/title", value: "after_c" }],
      },
    ]);
    const retained = await f.exchange(page.next),
      second = json<Page>(retained);
    expect(second.items).toEqual(expected.beads?.slice(2));
    expect(second.next).toBe(null);
    context(retained, minimum(changed));
    expect(retained.headers["bdp-scope-position"]).toBe(changed.headers["bdp-scope-position"]);
    const current = json<Page>(
      await f.exchange(`${scope}beads/?limit=32`, "GET", minimum(changed)),
    );
    expect(current.items[2]?.properties.title).toBe("after_c");
    expect(current.items[2]?.revision).not.toBe(second.items[0]?.revision);
    const continuationMinimum = await f.exchange(page.next, "GET", minimum(changed));
    expect(continuationMinimum.status).toBe(500);
    expect(continuationMinimum.headers["x-bdp-development-limit"]).toBe("minimum-position-route");
  });
}, 120000);

it("observes genuine installed compatible missing minimum404 and preserved behind gap", async () => {
  await withInstalled(
    async (f) => {
      let count = 0;
      const urls = new Set<string>();
      const exchange = async (...args: Parameters<typeof f.exchange>) => {
        count++;
        expect(count).toBeLessThanOrEqual(10);
        urls.add(args[0] ?? `${scope}beads/`);
        return f.exchange(...args);
      };
      type Result = {
        operationIndex: number;
        outcome: string;
        resource?: Row & { source: string; target: string };
        deleted?: { resourceKind: string; resource: Pick<Row, "id" | "type" | "revision"> };
        source?: string;
        sourceRevision?: string;
      };
      type Receipt = {
        status: string;
        detail: string;
        requiredPosition: string;
        effectPosition: string;
        results: Result[];
      };
      const receipt = (response: HttpExchangeResponse, position: string, size: number) => {
        const value = json<Receipt>(response);
        expect(receiptSchema(value), JSON.stringify(receiptSchema.errors)).toBe(true);
        expect(value).toMatchObject({
          status: "completed",
          detail: "available",
          requiredPosition: position,
          effectPosition: position,
        });
        expect(value.results).toHaveLength(size);
        expect(response.headers["bdp-scope-position"]).toBe(position);
        return value;
      };
      const seeded = await exchange(
        `${scope}operations/batch`,
        "POST",
        { "content-type": "application/json", "idempotency-key": "missing_seed" },
        {
          operations: [
            ...["a", "b"].map((id) => ({
              operation: "createBead",
              id: `beads/${id}`,
              type: beadType,
              properties: { title: id },
            })),
            {
              operation: "createLink",
              id: "links/l",
              type: linkType,
              source: "beads/a",
              target: "beads/b",
              properties: { title: "l" },
            },
          ],
        },
      );
      const first = receipt(seeded, "pos-1", 3),
        [a, b, l] = first.results;
      if (!a?.resource || !b?.resource || !l?.resource || !l.sourceRevision)
        throw new Error("missing created resources");
      for (const [index, result, id, type] of [
        [0, a, "beads/a", beadType],
        [1, b, "beads/b", beadType],
        [2, l, "links/l", linkType],
      ] as const) {
        expect(result).toMatchObject({
          operationIndex: index,
          outcome: "created",
          resource: {
            id: `${scope}${id}`,
            type,
            properties: { title: id.slice(id.indexOf("/") + 1) },
            metadata: {},
          },
        });
        expect(result.resource?.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      }
      expect(l.resource).toMatchObject({ source: `${scope}beads/a`, target: `${scope}beads/b` });
      expect(l.source).toBe(`${scope}beads/a`);
      expect(l.sourceRevision).not.toBe(a.resource.revision);
      const removed = await exchange(
        `${scope}operations/batch`,
        "POST",
        { "content-type": "application/json", "idempotency-key": "missing_delete" },
        {
          operations: [
            { operation: "deleteLink", link: "links/l", expectedRevision: l.resource.revision },
            { operation: "deleteBead", bead: "beads/a" },
          ],
        },
      );
      const second = receipt(removed, "pos-2", 2),
        [dl, da] = second.results;
      if (!dl?.sourceRevision) throw new Error("missing owned deletion revision");
      expect(dl).toEqual({
        operationIndex: 0,
        outcome: "deleted",
        deleted: {
          resourceKind: "link",
          resource: { id: l.resource.id, type: linkType, revision: l.resource.revision },
        },
        source: `${scope}beads/a`,
        sourceRevision: dl.sourceRevision,
      });
      expect(dl.sourceRevision).not.toBe(l.sourceRevision);
      expect(da).toEqual({
        operationIndex: 1,
        outcome: "deleted",
        deleted: {
          resourceKind: "bead",
          resource: { id: `${scope}beads/a`, type: beadType, revision: dl.sourceRevision },
        },
      });
      const earlier = minimum(seeded),
        equal = minimum(removed);
      for (const [suffix, method, headers] of [
        ["beads/never", "GET", earlier],
        ["beads/never?view=properties", "HEAD", equal],
        ["links/never", "GET", { ...equal, "if-none-match": "*" }],
        ["links/never?view=properties", "HEAD", earlier],
        ["beads/a", "GET", equal],
        ["beads/a?view=properties", "GET", earlier],
        ["links/l", "GET", { ...equal, "if-match": '"mismatch"' }],
      ] as const) {
        const response = await exchange(`${scope}${suffix}`, method, headers);
        expect(response.status).toBe(404);
        context(response, equal);
        expect(response.headers["cache-control"]).toBe("private, no-store");
        if (method === "HEAD") {
          expect(response.bodyText).toBe("");
          expect(response.bodyOctets).toBe(0);
        } else
          expect(json<Record<string, unknown>>(response, 404)).toMatchObject({
            code: "resource-not-found",
            status: 404,
          });
      }
      const behind = await exchange(
        `${scope}links/l?view=properties`,
        "GET",
        minimum(removed, "pos-3"),
      );
      expect(behind.status).toBe(500);
      expect(behind.bodyText).toBe("");
      expect(behind.headers["x-bdp-development-limit"]).toBe("minimum-position-visibility");
      for (const name of ["bdp-scope-position", "bdp-scope-epoch", "bdp-authorization-view"])
        expect(behind.headers[name]).toBeUndefined();
      expect(count).toBe(10);
      expect(urls.size).toBe(9);
    },
    undefined,
    "private-installed-compatible-missing-minimum",
  );
}, 120000);

it("observes genuine installed current Type and incident-Link minimums within20requests", async () => {
  await withInstalled(
    async (f) => {
      let count = 0;
      const urls = new Set<string>();
      const exchange = async (...args: Parameters<typeof f.exchange>) => {
        if (++count > 20) throw new Error("Type/incident request ceiling exceeded");
        const response = await f.exchange(...args);
        urls.add(args[0]!);
        const expected = args[2]?.["bdp-authorization-view"];
        if (expected !== undefined)
          expect(
            response.exactRequest?.headerLines.find(
              (h) => h.name.toLowerCase() === "bdp-authorization-view",
            )?.value,
          ).toBe(expected);
        return response;
      };
      const seeded = await exchange(
        `${scope}operations/batch`,
        "POST",
        { "content-type": "application/json", "idempotency-key": "type_incident_seed" },
        {
          operations: [
            ...["a", "b", "c"].map((id) => ({
              operation: "createBead",
              id: `beads/${id}`,
              type: beadType,
              properties: { title: id },
              metadata: { seed: id },
            })),
            ...[
              ["l-ab", "a", "b"],
              ["l-ba", "b", "a"],
            ].map(([id, source, target]) => ({
              operation: "createLink",
              id: `links/${id}`,
              type: linkType,
              source: `beads/${source}`,
              target: `beads/${target}`,
              properties: { title: id },
              metadata: { seed: id },
            })),
          ],
        },
      );
      const receipt = json<{
        status: string;
        detail: string;
        results: {
          operationIndex: number;
          outcome: string;
          resource: Row & { source?: string; target?: string };
          source?: string;
          sourceRevision?: string;
        }[];
        requiredPosition: string;
        effectPosition: string;
      }>(seeded);
      expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
      expect(receipt).toMatchObject({
        status: "completed",
        detail: "available",
        requiredPosition: "pos-1",
        effectPosition: "pos-1",
      });
      expect(receipt.results).toHaveLength(5);
      const names = ["a", "b", "c", "l-ab", "l-ba"];
      for (const [i, result] of receipt.results.entries()) {
        const name = names[i]!;
        expect(result.operationIndex).toBe(i);
        expect(result.outcome).toBe("created");
        expect(result.resource.revision).toEqual(expect.any(String));
        expect(result.resource).toEqual({
          id: `${scope}${i < 3 ? "beads" : "links"}/${name}`,
          type: i < 3 ? beadType : linkType,
          properties: { title: name },
          metadata: { seed: name },
          revision: result.resource.revision,
          ...(i < 3
            ? { ownedLinks: { [linkType]: [] } }
            : {
                source: `${scope}beads/${i === 3 ? "a" : "b"}`,
                target: `${scope}beads/${i === 3 ? "b" : "a"}`,
              }),
        });
        if (i >= 3) {
          expect(result.source).toBe(`${scope}beads/${i === 3 ? "a" : "b"}`);
          expect(result.sourceRevision).toEqual(expect.any(String));
          expect(result.sourceRevision).not.toBe(receipt.results[i - 3]!.resource.revision);
        }
      }
      const bound = minimum(seeded);
      context(seeded, bound, "pos-1");
      const links = receipt.results.slice(3).map((r) => r.resource);
      const descriptor = JSON.parse(artifacts().descriptors[0]!.utf8);
      const targets = [`${scope}types/task`, `${scope}types/`, `${scope}beads/a?view=links`];
      const expected = [
        descriptor,
        {
          items: [
            { id: linkType, name: "Relationship", describes: "link" },
            { id: beadType, name: "Task", describes: "bead" },
          ],
          next: null,
        },
        { items: links, next: null },
      ];
      for (const [i, target] of targets.entries()) {
        const get = await exchange(target, "GET", bound);
        expect(json(get)).toEqual(expected[i]);
        context(get, bound);
        const head = await exchange(target, "HEAD", bound);
        expect(head.status).toBe(200);
        expect(head.bodyText).toBe("");
        expect(head.bodyOctets).toBe(0);
        context(head, bound);
      }
      for (const [index, method, header, status] of [
        [0, "GET", { "if-none-match": "*" }, 304],
        [1, "HEAD", { "if-match": '"mismatch"' }, 412],
        [2, "GET", { "if-none-match": "*" }, 304],
      ] as const) {
        const response = await exchange(targets[index]!, method, { ...bound, ...header });
        expect(response.status).toBe(status);
        expect(response.bodyText).toBe("");
        expect(response.bodyOctets).toBe(0);
        context(response, bound);
      }
      for (const [index, method] of [
        [0, "GET"],
        [1, "HEAD"],
        [2, "GET"],
      ] as const) {
        const response = await exchange(targets[index]!, method, {
          ...bound,
          "bdp-minimum-scope-position": "pos-2",
          "if-none-match": "*",
        });
        expect(response.status).toBe(503);
        context(response, bound);
        expect(response.headers["retry-after"]).toBe("1");
        if (method === "HEAD") {
          expect(response.bodyText).toBe("");
          expect(response.bodyOctets).toBe(0);
        } else
          expect(json<Record<string, unknown>>(response, 503)).toMatchObject({
            code: "catch-up-timeout",
            status: 503,
            retry: "after-delay",
          });
      }
      for (const [index, method, field, status, code] of [
        [0, "GET", "bdp-scope-epoch", 410, "cursor-expired"],
        [1, "GET", "bdp-authorization-view", 409, "foreign-view"],
        [2, "HEAD", "bdp-scope-epoch", 410, "cursor-expired"],
      ] as const) {
        const response = await exchange(targets[index]!, method, { ...bound, [field]: "foreign" });
        expect(response.status).toBe(status);
        context(response, bound);
        if (method === "HEAD") {
          expect(response.bodyText).toBe("");
          expect(response.bodyOctets).toBe(0);
        } else
          expect(json<Record<string, unknown>>(response, status)).toMatchObject({ code, status });
      }
      for (const [suffix, rows] of [
        ["beads/c?view=links", []],
        ["beads/a?view=links&direction=inbound", [links[1]]],
        ["beads/a?view=links&direction=outbound", [links[0]]],
      ] as const) {
        const response = await exchange(`${scope}${suffix}`, "GET", bound);
        expect(json(response)).toEqual({ items: rows, next: null });
        context(response, bound);
      }
      const anonymous = await exchange(targets[1]!, "GET", bound, undefined, "anonymous");
      expect(anonymous.status).toBe(401);
      expect(anonymous.bodyText).not.toContain("Relationship");
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(anonymous.headers[name]).toBeUndefined();
      expect(count).toBe(20);
      expect([...urls].sort()).toEqual(
        [
          `${scope}operations/batch`,
          ...targets,
          `${scope}beads/c?view=links`,
          `${scope}beads/a?view=links&direction=inbound`,
          `${scope}beads/a?view=links&direction=outbound`,
        ].sort(),
      );
    },
    undefined,
    "private-installed-type-incident-minimum",
  );
}, 120000);

it("observes genuine installed current alias minimums within18requests", async () => {
  await withInstalled(
    async (f) => {
      let count = 0;
      const urls = new Set<string>();
      const exchange = async (...args: Parameters<typeof f.exchange>) => {
        if (++count > 18) throw new Error("alias minimum request ceiling exceeded");
        const response = await f.exchange(...args);
        urls.add(args[0]!);
        const view = args[2]?.["bdp-authorization-view"];
        if (view !== undefined)
          expect(
            response.exactRequest?.headerLines.find(
              (h) => h.name.toLowerCase() === "bdp-authorization-view",
            )?.value,
          ).toBe(view);
        return response;
      };
      const seeded = await exchange(
        `${scope}operations/batch`,
        "POST",
        { "content-type": "application/json", "idempotency-key": "alias-min-seed" },
        {
          operations: ["a", "b"].map((id) => ({
            operation: "createBead",
            id: `beads/${id}`,
            type: beadType,
            properties: { title: id },
            metadata: { seed: id },
          })),
        },
      );
      const receipt = json<{
        status: string;
        requiredPosition: string;
        effectPosition?: string;
        results: { operationIndex: number; outcome: string; resource: Row }[];
      }>(seeded);
      expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
      expect(receipt).toMatchObject({
        status: "completed",
        requiredPosition: "pos-1",
        effectPosition: "pos-1",
      });
      expect(receipt.results).toHaveLength(2);
      for (const [i, result] of receipt.results.entries()) {
        const id = ["a", "b"][i]!;
        expect(result.operationIndex).toBe(i);
        expect(result.outcome).toBe("created");
        expect(result.resource.revision).toEqual(expect.any(String));
        expect(result.resource.revision.length).toBeGreaterThan(0);
        expect(result.resource).toEqual({
          id: `${scope}beads/${id}`,
          type: beadType,
          properties: { title: id },
          metadata: { seed: id },
          ownedLinks: { [linkType]: [] },
          revision: result.resource.revision,
        });
      }
      const headers = minimum(seeded, "pos-1");
      context(seeded, headers);
      const aliasCommand = async (
        operation: "put-alias" | "delete-alias",
        key: string,
        outcome: string,
        target?: string,
      ) => {
        const response = await exchange(
          `${scope}operations/${operation}`,
          "POST",
          { "content-type": "application/json", "idempotency-key": key },
          { alias: "alias/work", ...(target ? { target: `beads/${target}` } : {}) },
        );
        const result = json<{
          status: string;
          requiredPosition: string;
          effectPosition?: string;
          results: unknown[];
        }>(response);
        expect(receiptSchema(result), JSON.stringify(receiptSchema.errors)).toBe(true);
        expect(result.status).toBe("completed");
        expect(result.requiredPosition).toBe("pos-1");
        expect(result).not.toHaveProperty("effectPosition");
        expect(result.results).toEqual([
          {
            operationIndex: 0,
            outcome,
            alias: `${scope}alias/work`,
            ...(target ? { target: `${scope}beads/${target}` } : {}),
          },
        ]);
        context(response, headers);
      };
      const redirect = (response: HttpExchangeResponse, target: string) => {
        expect(response.status).toBe(307);
        expect(response.headers.location).toBe(`${scope}beads/${target}`);
        expect(response.bodyOctets).toBe(0);
        expect(response.bodyText).toBe("");
        expect(response.headers["content-length"]).toBe("0");
        expect(response.headers["cache-control"]).toBe("private, no-store");
        context(response, headers);
      };
      await aliasCommand("put-alias", "alias-min-put", "created", "a");
      redirect(await exchange(`${scope}alias/work`, "GET", headers), "a");
      redirect(await exchange(`${scope}alias/work`, "HEAD", headers), "a");
      redirect(
        await exchange(`${scope}alias/work`, "GET", {
          ...headers,
          "if-none-match": "*",
          "if-match": '"different"',
        }),
        "a",
      );
      redirect(
        await exchange(`${scope}alias/work`, "HEAD", { ...headers, accept: "text/plain" }),
        "a",
      );
      await aliasCommand("put-alias", "alias-min-repoint", "updated", "b");
      const repointed = await exchange(`${scope}alias/work`, "GET", headers);
      redirect(repointed, "b");
      // Same actual-response oracle, no extra requests: wrong locator/context must fail.
      expect(() =>
        redirect(
          { ...repointed, headers: { ...repointed.headers, location: `${scope}beads/a` } },
          "b",
        ),
      ).toThrow();
      expect(() =>
        redirect(
          { ...repointed, headers: { ...repointed.headers, "bdp-scope-position": "pos-0" } },
          "b",
        ),
      ).toThrow();
      const followed = await exchange(`${scope}beads/b`, "GET", headers);
      expect(json<Row>(followed)).toEqual(receipt.results[1]!.resource);
      // Resource ETag is a separate oracle; context() still forbids ETags on redirects/pages.
      expect(followed.headers["bdp-scope-epoch"]).toBe(headers["bdp-scope-epoch"]);
      expect(followed.headers["bdp-authorization-view"]).toBe(headers["bdp-authorization-view"]);
      expect(followed.headers["bdp-scope-position"]).toBe("pos-1");
      expect(followed.headers.etag).toBe(`"${receipt.results[1]!.resource.revision}"`);
      const future = { ...headers, "bdp-minimum-scope-position": "pos-2" };
      const behind = await exchange(`${scope}alias/work`, "GET", {
        ...future,
        "if-none-match": "*",
        "if-match": '"different"',
      });
      expect(json(behind, 503)).toMatchObject({ code: "catch-up-timeout", retry: "after-delay" });
      expect(behind.headers["retry-after"]).toBe("1");
      expect(behind.headers.location).toBeUndefined();
      context(behind, headers);
      const foreignView = await exchange(`${scope}alias/work`, "HEAD", {
        ...headers,
        "bdp-authorization-view": "foreign",
      });
      expect(foreignView.status).toBe(409);
      expect(foreignView.bodyOctets).toBe(0);
      expect(foreignView.bodyText).toBe("");
      expect(foreignView.headers["content-type"]?.split(";", 1)[0]).toBe(
        "application/problem+json",
      );
      expect(Number(foreignView.headers["content-length"])).toBeGreaterThan(0);
      expect(foreignView.headers.location).toBeUndefined();
      context(foreignView, headers);
      const foreignEpoch = await exchange(`${scope}alias/work`, "GET", {
        ...headers,
        "bdp-scope-epoch": "foreign",
      });
      expect(json(foreignEpoch, 410)).toMatchObject({
        code: "cursor-expired",
        retry: "after-state-change",
      });
      expect(foreignEpoch.headers.location).toBeUndefined();
      context(foreignEpoch, headers);
      const absent = await exchange(`${scope}alias/never`, "GET", headers);
      expect(json(absent, 404)).toMatchObject({ code: "resource-not-found" });
      expect(absent.headers.location).toBeUndefined();
      context(absent, headers);
      const noDisclosure = (response: HttpExchangeResponse, status: number) => {
        expect(response.status).toBe(status);
        expect(response.headers.location).toBeUndefined();
        for (const h of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(response.headers[h]).toBeUndefined();
      };
      const collision = await exchange(`${scope}alias/never`, "HEAD", future);
      noDisclosure(collision, 500);
      expect(collision.bodyOctets).toBe(0);
      expect(collision.headers["x-bdp-development-limit"]).toBe("minimum-position-visibility");
      await aliasCommand("delete-alias", "alias-min-delete", "deleted");
      const deleted = await exchange(`${scope}alias/work`, "GET", headers);
      expect(json(deleted, 404)).toMatchObject({ code: "resource-not-found" });
      expect(deleted.headers.location).toBeUndefined();
      context(deleted, headers);
      noDisclosure(
        await exchange(`${scope}alias/work`, "GET", headers, undefined, "anonymous"),
        401,
      );
      const malformed = await exchange(`${scope}alias/work?invalid=1`, "GET", future);
      noDisclosure(malformed, 404);
      expect(json(malformed, 404)).toMatchObject({ code: "resource-not-found" });
      expect(count).toBe(18);
      expect([...urls].sort()).toEqual(
        [
          `${scope}operations/batch`,
          `${scope}operations/put-alias`,
          `${scope}operations/delete-alias`,
          `${scope}alias/work`,
          `${scope}alias/never`,
          `${scope}alias/work?invalid=1`,
          `${scope}beads/b`,
        ].sort(),
      );
    },
    undefined,
    "private-installed-alias-minimum",
  );
}, 120000);

it("ignores command read controls while enforcing a later installed receipt minimum", async () => {
  await withInstalled(
    async (f) => {
      const collection = `${scope}beads/?limit=32`;
      const routes = new Set([
        collection,
        ...["create-bead", "update-bead", "batch", "sequence"].map(
          (name) => `${scope}operations/${name}`,
        ),
        ...["a", "b", "c"].map((name) => `${scope}beads/${name}`),
      ]);
      const observedUrls = new Set<string>();
      let calls = 0;
      async function exchange(
        url: string,
        method: HttpMethod = "GET",
        headers: Record<string, string> = {},
        input?: unknown,
      ) {
        expect(routes.has(url), "command minimum exact route grant").toBe(true);
        expect(calls).toBeLessThan(18);
        calls++;
        observedUrls.add(url);
        return f.exchange(url, method, headers, input);
      }
      async function post(
        target: string,
        input: unknown,
        key: string | undefined,
        copied: Record<string, string>,
      ) {
        return exchange(
          `${scope}operations/${target}`,
          "POST",
          {
            "content-type": "application/json",
            ...(key === undefined ? {} : { "idempotency-key": key }),
            ...copied,
          },
          input,
        );
      }
      function pointContext(
        response: HttpExchangeResponse,
        expected: ReturnType<typeof minimum>,
        position: string,
      ) {
        expect(response.headers["bdp-scope-epoch"]).toBe(expected["bdp-scope-epoch"]);
        expect(response.headers["bdp-authorization-view"]).toBe(expected["bdp-authorization-view"]);
        expect(response.headers["bdp-scope-position"]).toBe(position);
        expect(response.headers.etag).toEqual(expect.any(String));
      }
      function receipt(response: HttpExchangeResponse, status = "completed") {
        const value = json<Record<string, unknown>>(response);
        expect(receiptSchema(value), JSON.stringify(receiptSchema.errors)).toBe(true);
        expect(value.status).toBe(status);
        expect(value.detail).toBe("available");
        expect(value.scopeEpoch).toBe(response.headers["bdp-scope-epoch"]);
        expect(value.authorizationView).toBe(response.headers["bdp-authorization-view"]);
        if (status === "completed") expect(value.next).toBeNull();
        return value;
      }
      function resource(value: unknown, name: string) {
        const row = value as Row;
        expect(row).toEqual({
          id: `${scope}beads/${name}`,
          type: beadType,
          properties: { title: name },
          metadata: {},
          revision: expect.any(String),
          ownedLinks: { [linkType]: [] },
        });
        expect(row.revision.length).toBeGreaterThan(0);
        return row;
      }
      function created(value: Record<string, unknown>, name: string) {
        const entries = value.results as Record<string, unknown>[];
        expect(entries).toHaveLength(1);
        const row = resource(entries[0]!.resource, name);
        expect(entries).toEqual([{ operationIndex: 0, outcome: "created", resource: row }]);
        return row;
      }
      const malformed = {
        "bdp-minimum-scope-position": "not a position!",
        "bdp-scope-epoch": "",
        "bdp-authorization-view": "view-one, view-two",
      };
      const foreign = {
        "bdp-minimum-scope-position": "pos-99",
        "bdp-scope-epoch": "foreign-epoch",
        "bdp-authorization-view": "foreign-view",
      };
      const empty = await exchange(collection);
      expect(json<Page>(empty)).toEqual({ items: [], next: null });
      const initial = minimum(empty);
      context(empty, initial, "pos-0");
      const aInput = { id: "beads/a", type: beadType, properties: { title: "a" } };
      const made = await post("create-bead", aInput, "minimum-a", malformed);
      const aReceipt = receipt(made);
      expect(aReceipt.idempotencyKey).toBe("minimum-a");
      expect(aReceipt.requiredPosition).toBe("pos-1");
      expect(aReceipt.effectPosition).toBe("pos-1");
      const a = created(aReceipt, "a");
      context(made, initial, "pos-1");
      const readA = await exchange(`${scope}beads/a`);
      expect(json(readA)).toEqual(a);
      pointContext(readA, initial, "pos-1");
      const replayA = await post("create-bead", aInput, "minimum-a", foreign);
      expect(receipt(replayA)).toEqual(aReceipt);
      context(replayA, initial, "pos-1");
      const bInput = {
        operations: [
          { operation: "createBead", id: "beads/b", type: beadType, properties: { title: "b" } },
        ],
      };
      const madeB = await post("batch", bInput, "minimum-b", { "bdp-scope-epoch": "partial" });
      const bReceipt = receipt(madeB);
      expect(bReceipt.idempotencyKey).toBe("minimum-b");
      expect(bReceipt.requiredPosition).toBe("pos-2");
      expect(bReceipt.effectPosition).toBe("pos-2");
      const b = created(bReceipt, "b");
      context(madeB, initial, "pos-2");
      const readB = await exchange(`${scope}beads/b`);
      expect(json(readB)).toEqual(b);
      pointContext(readB, initial, "pos-2");
      const replayB = await post("batch", bInput, "minimum-b", { "bdp-scope-epoch": "" });
      expect(receipt(replayB)).toEqual(bReceipt);
      context(replayB, initial, "pos-2");
      const sequenceInput = {
        operations: [
          {
            operation: "createBead",
            id: "beads/c",
            type: beadType,
            properties: { title: "c" },
            idempotencyKey: "minimum-c",
          },
        ],
      };
      const madeC = await post("sequence", sequenceInput, undefined, minimum(madeB, "pos-99"));
      const sequence = json<Record<string, unknown>>(madeC);
      const validateSequence = ajv.compile({
        $ref: `${bundle.$id}#/$defs/transactionalSequenceResponse`,
      });
      expect(validateSequence(sequence), JSON.stringify(validateSequence.errors)).toBe(true);
      const c = created(sequence, "c");
      expect(sequence).toEqual({
        results: [{ operationIndex: 0, outcome: "created", resource: c }],
      });
      context(madeC, initial, "pos-3");
      const readC = await exchange(`${scope}beads/c`);
      expect(json(readC)).toEqual(c);
      pointContext(readC, initial, "pos-3");
      const replayC = await post("sequence", sequenceInput, undefined, malformed);
      expect(json(replayC)).toEqual(sequence);
      context(replayC, initial, "pos-3");
      const conflict = await post(
        "batch",
        {
          operations: [
            {
              operation: "createBead",
              id: "beads/conflict-extra",
              type: beadType,
              properties: { title: "conflict-extra" },
            },
          ],
        },
        "minimum-b",
        foreign,
      );
      expect(json(conflict, 409)).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        status: 409,
        code: "idempotency-conflict",
        retry: "never",
      });
      context(conflict, initial, "pos-3");
      const refused = await post(
        "update-bead",
        {
          bead: "beads/a",
          expectedRevision: "wrong",
          propertiesChange: [{ op: "replace", path: "/title", value: "not-admitted" }],
        },
        "minimum-stale",
        foreign,
      );
      const failed = receipt(refused, "failed");
      expect(failed.idempotencyKey).toBe("minimum-stale");
      expect(failed.requiredPosition).toBe("pos-3");
      expect(failed).not.toHaveProperty("effectPosition");
      expect(failed.problem).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        status: 409,
        code: "revision-mismatch",
        retry: "after-state-change",
        operationIndex: 0,
      });
      context(refused, initial, "pos-3");
      const unchanged = await exchange(`${scope}beads/a`);
      expect(json(unchanged)).toEqual(a);
      pointContext(unchanged, initial, "pos-3");
      // Grant only the exact receipt root actually observed on the successful command.
      const target = aReceipt.id;
      expect(typeof target).toBe("string");
      if (typeof target !== "string" || target.length > 8192)
        throw new Error("invalid observed receipt root");
      const url = new URL(target);
      const prefix = `${scope}receipts/`;
      if (
        url.href !== target ||
        !target.startsWith(prefix) ||
        !/^[A-Za-z0-9_-]+$/.test(target.slice(prefix.length)) ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        throw new Error("invalid observed receipt root");
      routes.add(target);
      const timeout = await exchange(target, "GET", minimum(madeC, "pos-99"));
      expect(json(timeout, 503)).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/unavailable",
        status: 503,
        code: "catch-up-timeout",
        retry: "after-delay",
      });
      expect(timeout.headers["retry-after"]).toBe("1");
      context(timeout, initial, "pos-3");
      const otherView = await exchange(target, "GET", {
        ...minimum(madeC),
        "bdp-authorization-view": "foreign",
      });
      expect(json(otherView, 409)).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        status: 409,
        code: "foreign-view",
        retry: "after-state-change",
      });
      context(otherView, initial, "pos-3");
      const compatible = await exchange(target, "GET", minimum(madeC));
      expect(receipt(compatible)).toEqual(aReceipt);
      context(compatible, initial, "pos-3");
      const head = await exchange(target, "HEAD", minimum(madeC, "pos-99"));
      expect(head.status).toBe(503);
      expect(head.bodyText).toBe("");
      expect(head.bodyOctets).toBe(0);
      expect(head.headers["retry-after"]).toBe("1");
      context(head, initial, "pos-3");
      const final = await exchange(collection);
      expect(json<Page>(final)).toEqual({ items: [a, b, c], next: null });
      context(final, initial, "pos-3");
      expect(calls).toBe(18);
      expect([...observedUrls].sort()).toEqual([...routes].sort());
      expect(routes.size).toBe(9);
    },
    undefined,
    "private-installed-command-minimum",
  );
}, 120000);
