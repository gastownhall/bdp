/** Private installed Snapshot observations, not profile admission or matrix credit. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaUri, isJsonSchemaDateTime } from "@bdp/protocol";
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
  throw new Error("installed Snapshot entry override requires an explicit declared source commit");
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
  properties: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ownedLinks?: Record<string, Row[]>;
};
type Page = { items: Row[]; next: string | null };
type Manifest = {
  id: string;
  scope: string;
  scopeEpoch: string;
  authorizationView: string;
  scopePosition: string;
  checkpoint: string;
  beads: Page;
  links: Page;
  expiresAt: string;
};
function json<T>(response: HttpExchangeResponse, status = 200): T {
  expect(response.status, response.bodyText).toBe(status);
  expect(response.exactRequest?.writeState).toBe("complete");
  expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
  expect(response.headers["content-type"]?.split(";", 1)[0]).toBe(
    status >= 400 ? "application/problem+json" : "application/json",
  );
  return JSON.parse(response.bodyText) as T;
}
const snapshotSchemaBundle = JSON.parse(
  readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"),
);
const snapshotAjv = new Ajv2020({ strict: true, allErrors: true });
snapshotAjv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
snapshotAjv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
snapshotAjv.addSchema(snapshotSchemaBundle);
const validateSnapshotManifest = snapshotAjv.compile({
  $ref: `${snapshotSchemaBundle.$id}#/$defs/snapshotManifest`,
});
const validateSnapshotProblem = snapshotAjv.compile({
  $ref: `${snapshotSchemaBundle.$id}#/$defs/transactionalProblem`,
});
function checkedManifest(wire: HttpExchangeResponse) {
  const value = json<Manifest>(wire);
  expect(validateSnapshotManifest(value), JSON.stringify(validateSnapshotManifest.errors)).toBe(
    true,
  );
  return value;
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
    throw new AggregateError(failures, "Snapshot observation and cleanup failed");
  return value as T;
}
async function failureAfterCleanup(error: unknown, cleanup: () => Promise<void>): Promise<never> {
  return finishObservation(async () => {
    throw error;
  }, cleanup);
}
async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  milliseconds = 45000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("installed Snapshot test deadline")),
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
): Promise<void> {
  if (!signal) return withDeadline((shared) => withInstalled(run, shared));
  signal.throwIfAborted();
  const f = await start(signal);
  await finishObservation(
    () => run(f),
    () => f.close(),
    signal,
    (ok) => f.report(ok),
  );
}
async function start(signal: AbortSignal) {
  signal.throwIfAborted();
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-snapshot-installed-"));
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
  const children = [child.child];
  let key = 0;
  const observations: {
    url: string;
    status: number;
    method: string;
    responseBytes: number;
    wireSha256: string;
  }[] = [];
  async function exchange(
    url = `${scope}snapshot`,
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
      throw new Error("Snapshot observation escaped the configured Scope");
    const address = new URL(child.ready.listenUrl as string);
    // Authorization-view is authored protocol context, not credential decoration.
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 1024 * 1024,
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
    expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
    if (headers["bdp-authorization-view"] !== undefined)
      expect(
        response.exactRequest?.headerLines.find(
          (h) => h.name.toLowerCase() === "bdp-authorization-view",
        )?.value,
      ).toBe(headers["bdp-authorization-view"]);
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
      wireSha256: createHash("sha256").update(response.wireResponseBytes!).digest("hex"),
    });
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    return response;
  }
  return {
    exchange,
    get exchangeCount() {
      return observations.length;
    },
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
    },
    async capture() {
      return json<Manifest>(await exchange());
    },
    async reopen() {
      await child.close();
      child = await launchInstalledTransaction(entry, { ...configuration, create: false }, signal);
      children.push(child.child);
      expect(installedTransactionBinding(child.ready, sourceCommit, fixture)).toEqual(baseline);
    },
    async close() {
      await finishObservation(
        () => child.close(),
        async () => {
          rmSync(directory, { recursive: true, force: true });
        },
      );
    },
    report(ok: boolean) {
      // Never log raw credentials, exactRequest headers or authored request bodies.
      console.log(
        JSON.stringify({
          observation: "private-installed-snapshot",
          outcome: ok ? "passed" : "failed",
          aborted: signal.aborted,
          declaredSourceCommit: sourceCommit,
          workspaceDirty,
          entry: resolvedEntry,
          entrySha256,
          binding: baseline,
          children: children.map((process) => ({
            pid: process.pid,
            exitCode: process.exitCode,
            signalCode: process.signalCode,
          })),
          exchanges: observations.length,
          completedResponses: observations,
          claimEligible: false,
        }),
      );
    },
  };
}
const createBead = (id: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type: beadType,
  properties: { title: `café 🦉 ${id}` },
  metadata: { seeded: id },
});
async function collect(f: Awaited<ReturnType<typeof start>>, first: Page) {
  const rows = [...first.items],
    literals = new Map<string, string>();
  let next = first.next;
  while (next) {
    expect(literals.has(next)).toBe(false);
    const response = await f.exchange(next, "GET", {}, undefined, "operator");
    literals.set(next, response.bodyText);
    const page = json<Page>(response);
    rows.push(...page.items);
    next = page.next;
  }
  return { rows, literals };
}
function assertReplica(replica: Map<string, Row>, observed: Map<string, Row>) {
  expect([...replica.keys()].sort()).toEqual([...observed.keys()].sort());
  for (const [id, row] of observed) expect(replica.get(id)).toEqual(row);
}

it("observes packed-capable canonical Snapshot streams, retained bytes and changefeed-to-point convergence", async () => {
  await withInstalled(async (f) => {
    // Hosting is observed over the same installed listener, not reconstructed from metadata.
    for (const artifact of artifacts().descriptors) {
      const hosted = await f.exchange(artifact.retrievalUri, "GET", {}, undefined, "reader");
      expect(hosted.status).toBe(200);
      expect(json<unknown>(hosted)).toEqual(JSON.parse(artifact.utf8));
    }
    const denied = await f.exchange(
      `${scope}operations/batch`,
      "POST",
      {
        "content-type": "application/json",
        "idempotency-key": "reader_denied",
      },
      { operations: [createBead("reader-must-not-create")] },
      "reader",
    );
    expect(json<{ code: string }>(denied, 403).code).toBe("forbidden");
    expect(
      json<{ code: string }>(await f.exchange(`${scope}beads/reader-must-not-create`), 404).code,
    ).toBe("resource-not-found");
    const empty = json<Manifest>(await f.exchange(undefined, "GET", {}, undefined, "reader"));
    expect(empty.checkpoint).toBe("genesis");
    expect(empty.beads).toEqual({ items: [], next: null });
    expect(empty.links).toEqual({ items: [], next: null });
    const names = Array.from({ length: 34 }, (_, i) => `b${String(i).padStart(2, "0")}`);
    await f.write(names.slice(0, 32).map(createBead));
    await f.write(names.slice(32).map(createBead));
    const edges = names.map((name, i) => ({
      operation: "createLink",
      id: `links/e${String(i).padStart(2, "0")}`,
      type: linkType,
      source: `beads/${name}`,
      target: "beads/b00",
      properties: { title: `edge ${i}` },
      metadata: { seeded: `e${String(i).padStart(2, "0")}` },
    }));
    await f.write(edges.slice(0, 32));
    await f.write(edges.slice(32));
    const snapshot = await f.capture();
    expect(snapshot.scope).toBe(scope);
    expect(snapshot.scopePosition).toBe("pos-4");
    expect(snapshot.checkpoint).not.toBe("genesis");
    expect(Date.parse(snapshot.expiresAt)).toBeGreaterThan(Date.now());
    expect(snapshot.beads.items).toHaveLength(32);
    expect(snapshot.links.items).toHaveLength(32);
    expect(snapshot.beads.next).not.toBeNull();
    expect(snapshot.links.next).not.toBeNull();
    const retainedMinimum = await f.exchange(snapshot.beads.next as string, "GET", {
      "bdp-scope-epoch": snapshot.scopeEpoch,
      "bdp-authorization-view": snapshot.authorizationView,
      "bdp-minimum-scope-position": "pos-4",
    });
    expect(retainedMinimum.status).toBe(500);
    expect(retainedMinimum.headers["x-bdp-development-limit"]).toBe("minimum-position");
    const beads = await collect(f, snapshot.beads),
      links = await collect(f, snapshot.links);
    expect(beads.rows.map((r) => r.id)).toEqual(names.map((n) => `${scope}beads/${n}`));
    expect(links.rows.map((r) => r.id)).toEqual(edges.map((e) => `${scope}${e.id}`));
    function assertSeeded(beadRows: Row[], linkRows: Row[]) {
      for (const [i, row] of beadRows.entries()) {
        expect(row).toMatchObject({
          id: `${scope}beads/${names[i]}`,
          type: beadType,
          properties: { title: `café 🦉 ${names[i]}` },
          metadata: { seeded: names[i] },
        });
        expect(row.properties).toEqual({ title: `café 🦉 ${names[i]}` });
        expect(row.metadata).toEqual({ seeded: names[i] });
      }
      for (const [i, row] of linkRows.entries()) {
        expect(row).toMatchObject({
          id: `${scope}${edges[i]?.id}`,
          type: linkType,
          properties: { title: `edge ${i}` },
          metadata: { seeded: `e${String(i).padStart(2, "0")}` },
          source: `${scope}beads/${names[i]}`,
          target: `${scope}beads/b00`,
        });
        expect(row.properties).toEqual({ title: `edge ${i}` });
        expect(row.metadata).toEqual({ seeded: `e${String(i).padStart(2, "0")}` });
      }
    }
    assertSeeded(beads.rows, links.rows);
    // Even a consistently wrong cross-surface postimage fails the seeded oracle.
    const wrongSeed = structuredClone(beads.rows);
    if (!wrongSeed[0]) throw new Error("missing seeded Bead");
    wrongSeed[0].properties = { title: "consistently wrong" };
    expect(() => assertSeeded(wrongSeed, links.rows)).toThrow();
    wrongSeed[0].properties = { title: `café 🦉 ${names[0]}`, injected: 1 };
    expect(() => assertSeeded(wrongSeed, links.rows)).toThrow();
    for (const [i, row] of beads.rows.entries())
      expect(row.ownedLinks?.[linkType]).toEqual([links.rows[i]]);
    const literals = new Map([...beads.literals, ...links.literals]);
    const manifestWire = await f.exchange(snapshot.id);
    literals.set(snapshot.id, manifestWire.bodyText);
    expect(manifestWire.bodyOctets).toBeGreaterThan(manifestWire.bodyText.length);
    const head = await f.exchange(snapshot.id, "HEAD");
    expect(head.status).toBe(200);
    expect(head.bodyText).toBe("");
    expect(Number(head.headers["content-length"])).toBe(manifestWire.bodyOctets);
    const borrowed = new URL(snapshot.beads.next as string);
    borrowed.searchParams.set("stream", "links");
    expect(json<{ code: string }>(await f.exchange(borrowed.href), 404).code).toBe(
      "resource-not-found",
    );
    await f.write([
      {
        operation: "updateBead",
        bead: "beads/b00",
        propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
      },
    ]);
    await f.reopen();
    for (const [url, text] of literals) {
      const response = await f.exchange(url, "GET", {}, undefined, "reader");
      expect(response.status).toBe(200);
      expect(response.bodyText).toBe(text);
      expect(response.headers["bdp-scope-position"]).toBe("pos-5");
    }
    const feedUrl = new URL("changes/", scope);
    feedUrl.searchParams.set("after", snapshot.checkpoint);
    const feed = json<{
      after: string;
      next: string | null;
      groups: {
        position: string;
        previousPosition: string;
        changes: { operation: string; resource: Row }[];
      }[];
    }>(await f.exchange(feedUrl.href));
    expect(feed.after).toBe(snapshot.checkpoint);
    expect(feed.groups).toHaveLength(1);
    expect(feed.groups[0]?.position).toBe("pos-5");
    expect(feed.groups[0]?.previousPosition).toBe("pos-4");
    expect(feed.groups[0]?.changes).toHaveLength(1);
    expect(feed.next).toBeNull();
    const replica = new Map([...beads.rows, ...links.rows].map((row) => [row.id, row]));
    const oldReplica = new Map(replica);
    for (const group of feed.groups)
      for (const change of group.changes) {
        if (change.operation === "tombstone") replica.delete(change.resource.id);
        else {
          expect(change.operation).toBe("upsert");
          replica.set(change.resource.id, change.resource);
        }
      }
    const current = new Map<string, Row>();
    for (const id of [
      ...names.map((n) => `${scope}beads/${n}`),
      ...edges.map((e) => `${scope}${e.id}`),
    ]) {
      const wire = json<Row & { links?: unknown }>(await f.exchange(id));
      // Ordinary point-read navigation is not a captured Snapshot Resource field.
      delete wire.links;
      current.set(id, wire);
    }
    assertReplica(replica, current);
    expect(replica.get(`${scope}beads/b00`)?.properties).toEqual({ title: "after" });
    // Countercontrols use actual observed bytes: dropping the real feed or a Snapshot row fails.
    expect(() => assertReplica(oldReplica, current)).toThrow();
    const incomplete = new Map(replica);
    incomplete.delete(`${scope}links/e33`);
    expect(() => assertReplica(incomplete, current)).toThrow();
  });
}, 60000);

it("observes nonallocating creation decisions through the actual eight-handle capacity boundary", async () => {
  await withDeadline(async (signal) => {
    let calibratedPayload: string | undefined;
    await withInstalled(async (f) => {
      calibratedPayload = f.baseline.served.installedPayloadDigest;
      await f.write([createBead("a")]);
      const ids = new Set<string>();
      for (let i = 0; i < 8; i++) ids.add((await f.capture()).id);
      expect(ids.size).toBe(8);
      expect(json<{ code: string }>(await f.exchange(), 503).code).toBe("temporarily-unavailable");
    }, signal);
    await withInstalled(async (f) => {
      expect(f.baseline.served.installedPayloadDigest).toBe(calibratedPayload);
      await f.write([createBead("a")]);
      const prior: Manifest[] = [];
      for (let i = 0; i < 7; i++) prior.push(await f.capture());
      for (const [status, method, headers, credential] of [
        [200, "HEAD", {}, "operator"],
        [304, "GET", { "if-none-match": "*" }, "operator"],
        [412, "GET", { "if-match": '"absent"' }, "operator"],
        [406, "GET", { accept: "text/plain" }, "operator"],
        [401, "GET", {}, "anonymous"],
        [405, "POST", {}, "operator"],
        [403, "GET", { origin: "https://other.invalid" }, "operator"],
      ] as [number, HttpMethod, Record<string, string>, string][]) {
        const response = await f.exchange(undefined, method, headers, undefined, credential);
        expect(response.status).toBe(status);
        if ([200, 304, 412, 406].includes(status)) {
          expect(response.bodyText).toBe("");
          expect(response.headers.location).toBeUndefined();
          expect(response.headers["bdp-scope-position"]).toBe("pos-1");
        }
        if (status === 406) expect(response.headers.vary).toBe("Accept");
        if (status === 304 || method === "HEAD")
          expect(response.headers["content-length"]).toBeUndefined();
      }
      const malformed = await f.exchange(`${scope}snapshot?snapshot=a&snapshot=b`);
      expect(json<{ code: string }>(malformed, 400).code).toBe("invalid-parameter");
      const unsupported = await f.exchange(undefined, "GET", {
        "bdp-minimum-scope-position": "genesis",
      });
      expect(json<{ code: string }>(unsupported, 400).code).toBe("malformed-request");
      expect(unsupported.headers["x-bdp-development-limit"]).toBeUndefined();
      const last = await f.capture();
      expect(new Set([...prior, last].map((s) => s.id)).size).toBe(8);
      const refused = await f.exchange();
      expect(json<{ code: string }>(refused, 503).code).toBe("temporarily-unavailable");
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      for (const snapshot of [...prior, last])
        expect(json<Manifest>(await f.exchange(snapshot.id))).toEqual(snapshot);
      await f.reopen();
      expect(json<{ code: string }>(await f.exchange(), 503).code).toBe("temporarily-unavailable");
      expect(json<Manifest>(await f.exchange(last.id, "GET", {}, undefined, "reader"))).toEqual(
        last,
      );
    }, signal);
  });
}, 60000);

it("preserves original observation and cleanup failures instead of reporting success", async () => {
  const original = new Error("original HTTP observation"),
    cleanup = new Error("cleanup");
  const reports: boolean[] = [];
  const result = await finishObservation(
    async () => {
      throw original;
    },
    async () => {
      throw cleanup;
    },
    undefined,
    (ok) => reports.push(ok),
  ).catch((error) => error);
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toEqual([original, cleanup]);
  expect(reports).toEqual([false]);
});
it("preserves startup metadata failure together with cleanup failure", async () => {
  const original = new Error("startup metadata"),
    cleanup = new Error("child cleanup");
  const result = await failureAfterCleanup(original, async () => {
    throw cleanup;
  }).catch((error) => error);
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toEqual([original, cleanup]);
});
it.each(["after-wire", "during-cleanup"])("refuses late deadline success %s", async (timing) => {
  const controller = new AbortController(),
    reason = new Error("late deadline");
  const reports: boolean[] = [];
  let closed = false;
  const result = await finishObservation(
    async () => {
      if (timing === "after-wire") controller.abort(reason);
    },
    async () => {
      closed = true;
      if (timing === "during-cleanup") controller.abort(reason);
    },
    controller.signal,
    (ok) => reports.push(ok),
  ).catch((error) => error);
  expect(result).toBe(reason);
  expect(closed).toBe(true);
  expect(reports).toEqual([false]);
});

it("expires one aggregate budget between fixtures without starting an aborted fixture", async () => {
  vi.useFakeTimers();
  const reports: boolean[] = [];
  let secondObservationStarted = false;
  try {
    const result = await withDeadline(async (signal) => {
      await finishObservation(
        async () => {
          await vi.advanceTimersByTimeAsync(12);
        },
        async () => {},
        signal,
        (ok) => reports.push(ok),
      );
      await vi.advanceTimersByTimeAsync(9);
      await withInstalled(async () => {
        secondObservationStarted = true;
      }, signal);
    }, 20).catch((error) => error);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("installed Snapshot test deadline");
    expect(secondObservationStarted).toBe(false);
    expect(reports).toEqual([true]); // First fixture finished before expiry; no second ledger.
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("charges sequential observations to the same budget and cannot report late success", async () => {
  vi.useFakeTimers();
  const reports: boolean[] = [];
  let cleaned = 0;
  try {
    const result = await withDeadline(async (signal) => {
      for (let fixture = 0; fixture < 2; fixture++)
        await finishObservation(
          async () => {
            await vi.advanceTimersByTimeAsync(12);
          },
          async () => {
            cleaned++;
          },
          signal,
          (ok) => reports.push(ok),
        );
    }, 20).catch((error) => error);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("installed Snapshot test deadline");
    expect(cleaned).toBe(2);
    expect(reports).toEqual([true, false]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

function snapshotMinimum(context: HttpExchangeResponse, minimumPosition: string) {
  const epoch = context.headers["bdp-scope-epoch"],
    view = context.headers["bdp-authorization-view"];
  if (!epoch || !view) throw new Error("missing actual Snapshot context");
  return {
    "bdp-scope-epoch": epoch,
    "bdp-authorization-view": view,
    "bdp-minimum-scope-position": minimumPosition,
  };
}
function exactSnapshotContext(
  response: HttpExchangeResponse,
  actual: HttpExchangeResponse,
  position: string,
) {
  expect(response.headers["bdp-scope-epoch"]).toBe(actual.headers["bdp-scope-epoch"]);
  expect(response.headers["bdp-authorization-view"]).toBe(actual.headers["bdp-authorization-view"]);
  expect(response.headers["bdp-scope-position"]).toBe(position);
}
function snapshotTimeout(
  response: HttpExchangeResponse,
  actual: HttpExchangeResponse,
  position: string,
  head = false,
) {
  expect(response.status).toBe(503);
  exactSnapshotContext(response, actual, position);
  expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  if (head) expect(response.bodyText).toBe("");
  else {
    const value = json<Record<string, unknown>>(response, 503);
    expect(validateSnapshotProblem(value), JSON.stringify(validateSnapshotProblem.errors)).toBe(
      true,
    );
    expect(value).toMatchObject({
      code: "catch-up-timeout",
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      status: 503,
      retry: "after-delay",
    });
  }
}
it("observes fresh Snapshot minima with exact current context and retained gaps over packed bytes", async () => {
  await withInstalled(async (f) => {
    const empty = await f.exchange(); // 1: actual initial context and empty handle
    expect(checkedManifest(empty)).toMatchObject({
      scopePosition: "pos-0",
      checkpoint: "genesis",
      beads: { items: [], next: null },
      links: { items: [], next: null },
    });
    const unauthorized = await f.exchange(
      undefined,
      "GET",
      snapshotMinimum(empty, "genesis"),
      undefined,
      "anonymous",
    ); // 2
    expect(unauthorized.status).toBe(401);
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(unauthorized.headers[name]).toBeUndefined();
    await f.write([
      createBead("a"),
      createBead("b"),
      {
        operation: "createLink",
        id: "links/ab",
        type: linkType,
        source: "beads/a",
        target: "beads/b",
        properties: { title: "edge" },
      },
    ]); // 3
    const current = snapshotMinimum(empty, "pos-1"),
      future = snapshotMinimum(empty, "pos-2");
    function state(manifest: Manifest, title = "café 🦉 a", position = "pos-1") {
      expect(manifest.scopePosition).toBe(position);
      expect(manifest.checkpoint).not.toBe("genesis");
      expect(manifest.beads.items.map((row) => [row.id, row.properties])).toEqual([
        [`${scope}beads/a`, { title }],
        [`${scope}beads/b`, { title: "café 🦉 b" }],
      ]);
      expect(manifest.links.items.map((row) => [row.id, row.properties])).toEqual([
        [`${scope}links/ab`, { title: "edge" }],
      ]);
      expect(manifest.beads.next).toBeNull();
      expect(manifest.links.next).toBeNull();
    }
    const firstWire = await f.exchange(undefined, "GET", current); // 4
    const first = checkedManifest(firstWire);
    state(first);
    exactSnapshotContext(firstWire, empty, "pos-1");
    for (const [method, conditions, status] of [
      ["HEAD", {}, 200],
      ["GET", { "if-none-match": "*" }, 304],
      ["GET", { "if-match": '"absent"' }, 412],
      ["GET", { accept: "text/plain" }, 406],
    ] as [HttpMethod, Record<string, string>, number][]) {
      // 5–8
      const wire = await f.exchange(undefined, method, { ...current, ...conditions });
      expect(wire.status).toBe(status);
      expect(wire.bodyText).toBe("");
      exactSnapshotContext(wire, empty, "pos-1");
    }
    for (const [method, conditions] of [
      ["GET", {}],
      ["HEAD", {}],
      ["GET", { "if-none-match": "*" }],
      ["GET", { "if-match": '"absent"' }],
      ["GET", { accept: "text/plain" }],
    ] as [HttpMethod, Record<string, string>][]) // 9–13
      snapshotTimeout(
        await f.exchange(undefined, method, { ...future, ...conditions }),
        empty,
        "pos-1",
        method === "HEAD",
      );
    for (const [header, status, code, family] of [
      ["bdp-scope-epoch", 410, "cursor-expired", "gone"],
      ["bdp-authorization-view", 409, "foreign-view", "conflict"],
    ] as const)
      for (const method of ["GET", "HEAD"] as const) {
        // 14–17
        const wire = await f.exchange(undefined, method, { ...current, [header]: "foreign" });
        expect(wire.status).toBe(status);
        exactSnapshotContext(wire, empty, "pos-1");
        if (method === "HEAD") expect(wire.bodyText).toBe("");
        else
          expect(json<Record<string, unknown>>(wire, status)).toMatchObject({
            code,
            status,
            type: `https://github.com/gastownhall/bdp/problems/${family}`,
          });
      }
    const laterWire = await f.exchange(undefined, "GET", current); // 18
    const later = checkedManifest(laterWire);
    state(later);
    expect(later.id).not.toBe(first.id);
    exactSnapshotContext(laterWire, empty, "pos-1");
    for (const headers of [
      // 19–21
      { ...current, "bdp-minimum-scope-position": "unknown" },
      { "bdp-minimum-scope-position": "pos-1" },
      {
        "bdp-scope-epoch": current["bdp-scope-epoch"],
        "bdp-authorization-view": current["bdp-authorization-view"],
        "bdp-minimum-scope-positions": "pos-1",
      },
    ]) {
      const wire = await f.exchange(undefined, "GET", headers);
      if (headers["bdp-minimum-scope-position"] === "unknown") {
        snapshotTimeout(wire, empty, "pos-1");
        expect(wire.headers["x-bdp-development-limit"]).toBeUndefined();
      } else {
        expect(json<{ code: string }>(wire, 400).code).toBe("malformed-request");
        expect(wire.headers["x-bdp-development-limit"]).toBeUndefined();
        for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(wire.headers[name]).toBeUndefined();
      }
    }
    const retained = await f.exchange(first.id, "GET", current); // 22
    expect(retained.status).toBe(500);
    expect(retained.headers["x-bdp-development-limit"]).toBe("minimum-position");
    for (const method of ["GET", "HEAD"] as const) {
      // 23–24
      const wire = await f.exchange(first.id, method);
      expect(wire.status).toBe(200);
      exactSnapshotContext(wire, empty, "pos-1");
      expect(wire.bodyText).toBe(method === "HEAD" ? "" : firstWire.bodyText);
    }
    await f.write([
      {
        operation: "updateBead",
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
      },
    ]); // 25
    const advanced = await f.exchange(undefined, "GET", future); // 26
    state(checkedManifest(advanced), "after", "pos-2");
    exactSnapshotContext(advanced, empty, "pos-2");
    const old = await f.exchange(first.id); // 27
    expect(old.bodyText).toBe(firstWire.bodyText);
    exactSnapshotContext(old, empty, "pos-2");
    await f.reopen();
    for (const method of ["GET", "HEAD"] as const) {
      // 28–29
      const wire = await f.exchange(first.id, method);
      expect(wire.status).toBe(200);
      exactSnapshotContext(wire, empty, "pos-2");
      expect(wire.bodyText).toBe(method === "HEAD" ? "" : firstWire.bodyText);
    }
    snapshotTimeout(
      await f.exchange(undefined, "GET", snapshotMinimum(empty, "pos-3")),
      empty,
      "pos-2",
    ); // 30
    const final = await f.exchange(undefined, "GET", future); // 31
    state(checkedManifest(final), "after", "pos-2");
    exactSnapshotContext(final, empty, "pos-2");
    expect(f.exchangeCount).toBe(31);
  });
}, 60000);

// The same two-request oracle is selected explicitly against a separately bound
// derivative payload during counterfactual validation. No runtime fault switch.
it("requires a real fixed-head Snapshot wait over packed bytes", async () => {
  await withInstalled(async (f) => {
    const initial = await f.exchange();
    expect(checkedManifest(initial).scopePosition).toBe("pos-0");
    snapshotTimeout(
      await f.exchange(undefined, "GET", snapshotMinimum(initial, "pos-1")),
      initial,
      "pos-0",
    );
    expect(f.exchangeCount).toBe(2);
  });
}, 60000);

it("observes installed fresh Snapshot opaque minimum timeout", async () => {
  const started = performance.now();
  let directory: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let launchStarted = false,
    closeAttempted = false,
    closed = false,
    attempted = 0;
  const responses: {
    method: string;
    url: string;
    status: number;
    responseBytes: number;
    wireSha256: string;
    elapsedSeconds: number;
  }[] = [];
  await withDeadline((signal) =>
    finishObservation(
      async () => {
        signal.throwIfAborted();
        directory = mkdtempSync(path.join(tmpdir(), "bdp-snapshot-opaque-installed-"));
        const operator = randomBytes(32).toString("base64url");
        const configuration = {
          scope,
          directory,
          create: true,
          artifacts: artifacts(),
          credentials: [{ token: operator, principal: "writer", canMutate: true }],
        };
        const validReceipt = snapshotAjv.compile({
          $ref: `${snapshotSchemaBundle.$id}#/$defs/mutationReceipt`,
        });
        launchStarted = true;
        child = await launchInstalledTransaction(entry, configuration, signal);
        binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
        expect(child.ready.claimEligible).toBe(false);
        expect(child.ready.history).toBe(false);
        const address = new URL(child.ready.listenUrl as string);
        const batchUrl = `${scope}operations/batch`,
          snapshotUrl = `${scope}snapshot`;
        const execute = createRawHttpExchangeExecutor(
          { transport: "plain", host: address.hostname, port: Number(address.port) },
          {
            requestTimeoutMs: 5000,
            maximumBodyBytes: 1024 * 1024,
            exactMode: {
              scope,
              profile: "transactional",
              routes: [
                { method: "POST", url: batchUrl },
                { method: "GET", url: snapshotUrl },
                { method: "HEAD", url: snapshotUrl },
              ],
              maximumRequestHeaderBytes: 16384,
              maximumRequestBodyBytes: 65536,
              defaultCredentialRef: "operator",
              credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
              resolveCredentials: () => ({ authorization: `Bearer ${operator}` }),
            },
          },
        );
        async function exchange(
          method: HttpMethod,
          minimum: Record<string, string> = {},
          body?: string,
        ) {
          signal.throwIfAborted();
          expect(++attempted, "installed Snapshot dispatch bound").toBeLessThanOrEqual(3);
          const url = method === "POST" ? batchUrl : snapshotUrl;
          const requestStarted = performance.now();
          const response = await execute({
            method,
            url,
            signal,
            credentialRef: "operator",
            raw: {
              headerLines: [
                { name: "accept", value: "application/json" },
                ...Object.entries(minimum).map(([name, value]) => ({ name, value })),
                ...(body === undefined
                  ? []
                  : [
                      { name: "content-type", value: "application/json" },
                      { name: "idempotency-key", value: "snapshot-opaque-seed" },
                    ]),
              ],
              ...(body === undefined ? {} : { bodyBytes: Buffer.from(body) }),
            },
          });
          expect(response.url).toBe(url);
          expect(response.exactRequest?.source).toBe("raw-http1-serializer");
          expect(response.exactRequest?.writeState).toBe("complete");
          expect(response.exactRequest?.bodyPresent).toBe(body !== undefined);
          expect(response.exactRequest?.bodyOctets).toBe(
            body === undefined ? 0 : Buffer.byteLength(body),
          );
          expect(response.exactRequest?.bodyDigest).toBe(
            body === undefined ? undefined : createHash("sha256").update(body).digest("hex"),
          );
          const headers = response.exactRequest?.headerLines ?? [];
          expect(headers.find((header) => header.name.toLowerCase() === "host")?.value).toBe(
            "reference.invalid",
          );
          expect(headers.find((header) => header.name.toLowerCase() === "accept")?.value).toBe(
            "application/json",
          );
          if (body !== undefined) {
            expect(
              headers.find((header) => header.name.toLowerCase() === "content-type")?.value,
            ).toBe("application/json");
            expect(
              headers.find((header) => header.name.toLowerCase() === "idempotency-key")?.value,
            ).toBe("snapshot-opaque-seed");
          }
          for (const [name, value] of Object.entries(minimum))
            expect(headers.find((header) => header.name.toLowerCase() === name)?.value).toBe(value);
          expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
          if (
            response.bodyOctets === undefined ||
            !Number.isSafeInteger(response.bodyOctets) ||
            response.bodyOctets < 0
          )
            throw new Error("completed response body octets unavailable");
          responses.push({
            method,
            url,
            status: response.status,
            responseBytes: response.bodyOctets,
            wireSha256: createHash("sha256").update(response.wireResponseBytes!).digest("hex"),
            elapsedSeconds: (performance.now() - requestStarted) / 1000,
          });
          expect(response.headers["x-bdp-development"]).toBe("non-attesting");
          return response;
        }
        const seed = await exchange(
          "POST",
          {},
          JSON.stringify({ operations: [createBead("opaque-snapshot")] }),
        );
        const receipt = json<unknown>(seed);
        expect(validReceipt(receipt), JSON.stringify(validReceipt.errors)).toBe(true);
        expect(receipt).toMatchObject({
          status: "completed",
          idempotencyKey: "snapshot-opaque-seed",
          requiredPosition: "pos-1",
          effectPosition: "pos-1",
          results: [
            {
              outcome: "created",
              resource: {
                id: `${scope}beads/opaque-snapshot`,
                type: beadType,
                properties: { title: "café 🦉 opaque-snapshot" },
              },
            },
          ],
        });
        expect(seed.headers["bdp-scope-position"]).toBe("pos-1");
        const minimum = snapshotMinimum(seed, "opaque");
        for (const method of ["GET", "HEAD"] as const) {
          const response = await exchange(method, minimum);
          snapshotTimeout(response, seed, "pos-1", method === "HEAD");
          expect(response.headers["retry-after"]).toBe("1");
          expect(response.headers["cache-control"]).toBe("private, no-store");
          expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
        }
        expect(attempted).toBe(3);
        expect(responses.map(({ method, status }) => [method, status])).toEqual([
          ["POST", 200],
          ["GET", 503],
          ["HEAD", 503],
        ]);
      },
      async () => {
        if (!child) {
          if (launchStarted) throw new Error("Snapshot child ownership was not returned");
          if (directory) rmSync(directory, { recursive: true, force: true });
          return;
        }
        closeAttempted = true;
        await child.close();
        if (child.child.exitCode !== 0 || child.child.signalCode !== null)
          throw new Error("Snapshot child did not close cleanly");
        signal.throwIfAborted();
        closed = true;
        if (directory) rmSync(directory, { recursive: true, force: true });
      },
      signal,
      (ok) => {
        console.log(
          JSON.stringify({
            observation: "private-installed-snapshot-opaque-minimum",
            ok,
            declaredSourceCommit: sourceCommit,
            workspaceDirty,
            entry: resolvedEntry,
            entrySha256,
            binding,
            attempted,
            exchanges: responses.length,
            responses,
            launchStarted,
            startupCompleted: child !== undefined,
            closeAttempted,
            closed,
            childPid: child?.child.pid ?? null,
            childExitCode: child?.child.exitCode ?? null,
            childSignalCode: child?.child.signalCode ?? null,
            ownership: child ? "returned" : launchStarted ? "unknown" : "not-started",
            directory: directory ?? null,
            directoryAbsent: directory === undefined || !existsSync(directory),
            aborted: signal.aborted,
            elapsedSeconds: (performance.now() - started) / 1000,
            claimEligible: false,
          }),
        );
      },
    ),
  );
}, 60000);
