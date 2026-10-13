/** Private installed Snapshot observations, not profile admission or matrix credit. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
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
type Row = { id: string; properties: Record<string, unknown>; ownedLinks?: Record<string, Row[]> };
type Page = { items: Row[]; next: string | null };
type Manifest = {
  id: string;
  scope: string;
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
  if (response.headers["content-length"] !== undefined)
    expect(Number(response.headers["content-length"])).toBe(response.bodyOctets);
  return JSON.parse(response.bodyText) as T;
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
async function withInstalled(run: (f: Awaited<ReturnType<typeof start>>) => Promise<void>) {
  const f = await start();
  await finishObservation(
    () => run(f),
    () => f.close(),
    f.signal,
    (ok) => f.report(ok),
  );
}
async function start() {
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
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("installed Snapshot test deadline")),
    45000,
  );
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>>;
  try {
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
  } catch (error) {
    return failureAfterCleanup(error, async () => {
      clearTimeout(timer);
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
          clearTimeout(timer);
          rmSync(directory, { recursive: true, force: true });
        },
      ),
    );
  }
  let key = 0;
  const observations: { url: string; status: number; method: string; responseBytes: number }[] = [];
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
              : { authorization: `Bearer ${credentialRef === "reader" ? reader : operator}` },
        },
      },
    );
    const response = await execute({
      method,
      url,
      signal: controller.signal,
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
    if (
      response.bodyOctets === undefined ||
      !Number.isSafeInteger(response.bodyOctets) ||
      response.bodyOctets < 0
    )
      throw new Error("completed response body octets unavailable");
    observations.push({ url, method, status: response.status, responseBytes: response.bodyOctets });
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    return response;
  }
  return {
    exchange,
    baseline,
    signal: controller.signal,
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
      child = await launchInstalledTransaction(
        entry,
        { ...configuration, create: false },
        controller.signal,
      );
      expect(installedTransactionBinding(child.ready, sourceCommit, fixture)).toEqual(baseline);
    },
    async close() {
      await finishObservation(
        () => child.close(),
        async () => {
          clearTimeout(timer);
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
          aborted: controller.signal.aborted,
          declaredSourceCommit: sourceCommit,
          workspaceDirty,
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
    const beads = await collect(f, snapshot.beads),
      links = await collect(f, snapshot.links);
    expect(beads.rows.map((r) => r.id)).toEqual(names.map((n) => `${scope}beads/${n}`));
    expect(links.rows.map((r) => r.id)).toEqual(edges.map((e) => `${scope}${e.id}`));
    function assertSeeded(beadRows: Row[], linkRows: Row[]) {
      for (const [i, row] of beadRows.entries())
        expect(row).toMatchObject({
          id: `${scope}beads/${names[i]}`,
          type: beadType,
          properties: { title: `café 🦉 ${names[i]}` },
          metadata: { seeded: names[i] },
        });
      for (const [i, row] of linkRows.entries())
        expect(row).toMatchObject({
          id: `${scope}${edges[i]?.id}`,
          type: linkType,
          properties: { title: `edge ${i}` },
          metadata: { seeded: `e${String(i).padStart(2, "0")}` },
          source: `${scope}beads/${names[i]}`,
          target: `${scope}beads/b00`,
        });
    }
    assertSeeded(beads.rows, links.rows);
    // Even a consistently wrong cross-surface postimage fails the seeded oracle.
    const wrongSeed = structuredClone(beads.rows);
    if (!wrongSeed[0]) throw new Error("missing seeded Bead");
    wrongSeed[0].properties = { title: "consistently wrong" };
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
  let calibratedPayload: string | undefined;
  await withInstalled(async (f) => {
    calibratedPayload = f.baseline.served.installedPayloadDigest;
    await f.write([createBead("a")]);
    const ids = new Set<string>();
    for (let i = 0; i < 8; i++) ids.add((await f.capture()).id);
    expect(ids.size).toBe(8);
    expect(json<{ code: string }>(await f.exchange(), 503).code).toBe("temporarily-unavailable");
  });
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
    expect(unsupported.status).toBe(500);
    expect(unsupported.headers["x-bdp-development-limit"]).toBe("minimum-position");
    const last = await f.capture();
    expect(new Set([...prior, last].map((s) => s.id)).size).toBe(8);
    const refused = await f.exchange();
    expect(json<{ code: string }>(refused, 503).code).toBe("temporarily-unavailable");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    for (const snapshot of [...prior, last])
      expect(json<Manifest>(await f.exchange(snapshot.id))).toEqual(snapshot);
    await f.reopen();
    expect(json<{ code: string }>(await f.exchange(), 503).code).toBe("temporarily-unavailable");
    expect(json<Manifest>(await f.exchange(last.id, "GET", {}, undefined, "reader"))).toEqual(last);
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
