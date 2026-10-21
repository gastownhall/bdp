/** New packed batch/set cases; unchanged public HTTP, limits, clock and configuration. */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_BATCH_SET_PRODUCT_ENTRY;
const source = process.env.BDP_BATCH_SET_PRODUCT_SOURCE;
const build = process.env.BDP_BATCH_SET_PRODUCT_BUILD;
const output = process.env.BDP_BATCH_SET_PRODUCT_OUTPUT;
const scope = "https://reference.invalid/acme/";
const type = `${scope}types/batch-task`,
  linkType = `${scope}types/batch-link`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);

function transport(
  address: URL,
  token: string,
  signal: AbortSignal,
  wires: unknown[],
  state: { position: string; epoch?: string | undefined; view?: string | undefined },
) {
  return async function exchange(target: string, body?: unknown, key?: string) {
    expect(wires.length).toBeLessThan(64);
    const method = body === undefined ? "GET" : "POST";
    const url = new URL(target, scope).href;
    expect(new URL(url).origin).toBe(new URL(scope).origin);
    expect(new URL(url).pathname.startsWith("/acme/")).toBe(true);
    const raw = body === undefined ? undefined : JSON.stringify(body);
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
    const wire = await execute({
      method,
      url,
      signal,
      raw: {
        headerLines:
          raw === undefined
            ? []
            : [
                { name: "Content-Type", value: "application/json" },
                { name: "Idempotency-Key", value: key! },
              ],
        ...(raw === undefined ? {} : { bodyBytes: Buffer.from(raw) }),
      },
    });
    wires.push({
      method,
      url,
      requestBody: raw,
      key,
      requestWriteState: wire.exactRequest?.writeState,
      requestBodyDigest: wire.exactRequest?.bodyDigest,
      status: wire.status,
      headers: wire.headers,
      bodyText: wire.bodyText,
      wireBase64: Buffer.from(wire.wireResponseBytes ?? []).toString("base64"),
    });
    expect(wire.exactRequest?.writeState).toBe("complete");
    expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
    if (raw !== undefined) expect(wire.exactRequest?.bodyDigest).toBe(sha(Buffer.from(raw)));
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(wire.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    state.epoch ??= wire.headers["bdp-scope-epoch"];
    state.view ??= wire.headers["bdp-authorization-view"];
    expect(wire.headers["bdp-scope-epoch"]).toBe(state.epoch);
    expect(wire.headers["bdp-authorization-view"]).toBe(state.view);
    expect(wire.headers["bdp-scope-position"]).toBe(state.position);
    return { wire, value: wire.bodyText === "" ? undefined : JSON.parse(wire.bodyText) };
  };
}
type Context = {
  exchange: ReturnType<typeof transport>;
  batch: (operations: unknown[], key: string) => ReturnType<ReturnType<typeof transport>>;
  position(value: string): void;
};
async function withInstalled(name: string, scenario: (c: Context) => Promise<void>) {
  if (!entry || !source || !build || !output)
    throw Error("explicit installed/source/build/output required");
  const fixtureBytes = await readFile(
    new URL("../test-support/transactional-batch-set-fixture.json", import.meta.url),
  );
  const fixture = JSON.parse(fixtureBytes.toString("utf8")),
    modules = [];
  for (const name of (await readdir(build)).filter((n) => n.endsWith(".js")).sort()) {
    const b = await readFile(path.join(path.dirname(entry), name));
    expect(b.equals(await readFile(path.join(build, name))), name).toBe(true);
    modules.push({ name, bytes: b.length, sha256: sha(b) });
  }
  const schema = await readFile(
    path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json"),
  );
  expect(schema.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(true);
  const failures: unknown[] = [],
    wires: unknown[] = [],
    state = { position: "pos-0" };
  const controller = new AbortController(),
    watchdog = setTimeout(() => controller.abort(Error("batch/set installed deadline")), 20000);
  let directory: string | undefined,
    configuration: unknown,
    ready: unknown,
    binding: unknown,
    terminal: unknown;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined,
    drained: Promise<void> | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "bdp-batch-set-product-"));
    const token = randomBytes(32).toString("base64url");
    configuration = {
      scope,
      directory,
      create: true,
      credentials: [{ token, principal: "writer", canMutate: true }],
      artifacts: fixture.artifacts,
    };
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
    ready = child.ready;
    const serving = child.child;
    drained = new Promise<void>((resolve) =>
      serving.once("close", (code: number | null, signal: string | null) => {
        terminal = {
          code,
          signal,
          stdoutEOF: serving.stdout?.readableEnded,
          stderrEOF: serving.stderr?.readableEnded,
        };
        resolve();
      }),
    );
    binding = installedTransactionBinding(child.ready, source, { bytes: fixtureBytes });
    const exchange = transport(
      new URL(String(child.ready.listenUrl)),
      token,
      controller.signal,
      wires,
      state,
    );
    await scenario({
      exchange,
      batch: (operations, key) => exchange("operations/batch", { operations }, key),
      position: (value) => {
        state.position = value;
      },
    });
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(watchdog);
    try {
      if (child) {
        await child.close();
        await drained;
        expect(terminal).toMatchObject({ code: 0, signal: null, stdoutEOF: true, stderrEOF: true });
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      await writeFile(
        path.join(output, `${name}-observation.json`),
        JSON.stringify(
          {
            source,
            entry,
            modules,
            schemaSHA256: sha(schema),
            fixtureSHA256: sha(fixtureBytes),
            fixtureId: fixture.id,
            configuration: directory
              ? {
                  scope,
                  directory,
                  create: true,
                  credentials: [{ credentialRef: "writer", principal: "writer", canMutate: true }],
                  artifacts: fixture.artifacts,
                }
              : undefined,
            ready,
            binding,
            terminal,
            wires,
            failures: failures.map((error) => inspect(error, { depth: 10 })),
            wholeRowsComplete: false,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch (error) {
      failures.push(error);
    }
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "batch/set installed observation or cleanup failed");
}
const create = (id: string, name?: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { label: id, n: 0 },
  metadata: { stage: "seed" },
  ...(name ? { name } : {}),
});
const update = (id: string, n: number) => ({
  operation: "updateBead",
  bead: id,
  propertiesChange: [{ op: "replace", path: "/n", value: n }],
});
const bead = (id: string, n: number, revision: unknown = expect.any(String)) => ({
  id: `${scope}beads/${id}`,
  type,
  revision,
  properties: { label: id, n },
  metadata: { stage: "seed" },
});
function complete(
  r: Awaited<ReturnType<ReturnType<typeof transport>>>,
  position: string,
  effect: boolean,
) {
  expect(r.wire.status).toBe(200);
  expect(r.value.status).toBe("completed");
  expect(r.value.detail).toBe("available");
  expect(r.value.requiredPosition).toBe(position);
  expect(r.value.next).toBeNull();
  if (effect) expect(r.value.effectPosition).toBe(position);
  else expect(r.value).not.toHaveProperty("effectPosition");
}
async function groups(c: Context) {
  const result: Array<{
    position: string;
    events: Array<{ type: string; subject: string; data?: unknown }>;
    changes: unknown[];
  }> = [];
  let target: string | null = "changes/?after=genesis";
  for (let page = 0; target !== null; page++) {
    expect(page).toBeLessThan(4);
    const r = await c.exchange(target);
    expect(r.wire.status).toBe(200);
    expect(Array.isArray(r.value.groups)).toBe(true);
    result.push(...r.value.groups);
    target = r.value.next;
  }
  return result;
}
async function seed(c: Context) {
  c.position("pos-1");
  const r = await c.batch([create("a"), create("b")], "seed");
  complete(r, "pos-1", true);
  expect(r.value.results).toEqual(
    ["a", "b"].map((id, i) => ({ operationIndex: i, outcome: "created", resource: bead(id, 0) })),
  );
  return r.value.results.map((r: { resource: unknown }) => r.resource);
}
function failed(
  r: Awaited<ReturnType<ReturnType<typeof transport>>>,
  position: string,
  pointer: string,
) {
  expect(r.wire.status).toBe(200);
  expect(r.value.status).toBe("failed");
  expect(r.value.requiredPosition).toBe(position);
  expect(r.value).not.toHaveProperty("results");
  expect(r.value).not.toHaveProperty("next");
  expect(r.value).not.toHaveProperty("effectPosition");
  expect(r.value.problem).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/conflict",
    code: "cardinality-violated",
    status: 409,
    retry: "after-state-change",
    operationIndex: 1,
    pointer,
  });
}

it.skipIf(!entry)(
  "packed batch resolves ordinary labels and opaque PinnedReference uri labels with staged order",
  async () =>
    withInstalled("labels", async (c) => {
      c.position("pos-1");
      const r = await c.batch(
        [
          create("a", "first"),
          create("b", "second"),
          update("@first", 1),
          {
            operation: "createLink",
            id: "links/l",
            type: linkType,
            source: "@first",
            target: { uri: "@second", revision: "opaque-byte-identical-pin" },
            properties: { weight: 7 },
            metadata: { purpose: "labels" },
          },
        ],
        "local-labels",
      );
      complete(r, "pos-1", true);
      expect(r.value.results).toEqual([
        { operationIndex: 0, operationName: "first", outcome: "created", resource: bead("a", 0) },
        { operationIndex: 1, operationName: "second", outcome: "created", resource: bead("b", 0) },
        { operationIndex: 2, outcome: "updated", resource: bead("a", 1) },
        {
          operationIndex: 3,
          outcome: "created",
          resource: {
            id: `${scope}links/l`,
            type: linkType,
            revision: expect.any(String),
            properties: { weight: 7 },
            metadata: { purpose: "labels" },
            source: `${scope}beads/a`,
            target: { uri: `${scope}beads/b`, revision: "opaque-byte-identical-pin" },
          },
        },
      ]);
      expect(r.value.results[2].resource.revision).not.toBe(r.value.results[0].resource.revision);
      for (const [url, expected] of [
        ["beads/a", r.value.results[2].resource],
        ["beads/b", r.value.results[1].resource],
        ["links/l", r.value.results[3].resource],
      ] as const) {
        const read = await c.exchange(url);
        expect(read.wire.status).toBe(200);
        expect(read.value).toEqual(expected);
      }
      const g = await groups(c);
      expect(g.map((g) => g.position)).toEqual(["pos-1"]);
      expect(g[0]!.events.map((e) => [e.type, e.subject])).toEqual([
        ["created", `${scope}beads/a`],
        ["created", `${scope}beads/b`],
        ["updated", `${scope}beads/a`],
        ["created", `${scope}links/l`],
        ["linked", `${scope}links/l`],
        ["linked", `${scope}links/l`],
      ]);
      expect(g[0]!.events.slice(4).map((e) => e.data)).toEqual(
        ["source", "target"].map((endpoint) => ({
          endpoint,
          link: { id: `${scope}links/l`, type: linkType },
          source: `${scope}beads/a`,
          target: { uri: `${scope}beads/b`, revision: "opaque-byte-identical-pin" },
        })),
      );
    }),
  30000,
);

it.skipIf(!entry)(
  "packed batch rollback retries the same failed receipt and preserves all-noop versus mixed entries/groups",
  async () =>
    withInstalled("rollback-noop", async (c) => {
      const originals = await seed(c),
        beforeGroups = await groups(c);
      const ops = [
        update("beads/a", 99),
        {
          operation: "updateWhere",
          collection: "beads",
          selector: "$[?@.properties.n == 999]",
          change: [{ op: "replace", path: "/n", value: 8 }],
          cardinality: { min: 1 },
        },
      ];
      const rejected = await c.batch(ops, "rollback");
      failed(rejected, "pos-1", "/operations/1/cardinality/min");
      const retry = await c.batch(ops, "rollback");
      expect(retry.wire.status).toBe(200);
      expect(retry.wire.bodyText).toBe(rejected.wire.bodyText);
      for (const [i, id] of ["a", "b"].entries())
        expect((await c.exchange(`beads/${id}`)).value).toEqual(originals[i]);
      expect(await groups(c)).toEqual(beforeGroups);
      const noop = await c.batch([update("beads/a", 0), update("beads/b", 0)], "all-noop");
      complete(noop, "pos-1", false);
      expect(noop.value.results).toEqual(
        originals.map((resource: unknown, operationIndex: number) => ({
          operationIndex,
          outcome: "updated",
          resource,
        })),
      );
      expect(await groups(c)).toEqual(beforeGroups);
      c.position("pos-2");
      const mixed = await c.batch([update("beads/a", 1), update("beads/b", 0)], "mixed");
      complete(mixed, "pos-2", true);
      expect(mixed.value.results).toEqual([
        { operationIndex: 0, outcome: "updated", resource: bead("a", 1) },
        { operationIndex: 1, outcome: "updated", resource: originals[1] },
      ]);
      expect(mixed.value.results[0].resource.revision).not.toBe(
        (originals[0] as { revision: string }).revision,
      );
      expect((await c.exchange("beads/a")).value).toEqual(mixed.value.results[0].resource);
      expect((await c.exchange("beads/b")).value).toEqual(originals[1]);
      const after = await groups(c);
      expect(after.map((g) => g.position)).toEqual(["pos-1", "pos-2"]);
      expect(after[1]!.events.map((e) => [e.type, e.subject])).toEqual([
        ["updated", `${scope}beads/a`],
      ]);
      expect(after[1]!.changes).toHaveLength(1);
    }),
  30000,
);

it.skipIf(!entry)(
  "packed set cardinality includes both endpoints and rolls back complete prior effects below and above range",
  async () =>
    withInstalled("cardinality", async (c) => {
      await seed(c);
      const set = (n: number, value: number, cardinality: unknown) => ({
        operation: "updateWhere",
        collection: "beads",
        selector: `$[?@.properties.n == ${n}]`,
        change: [{ op: "replace", path: "/n", value }],
        cardinality,
      });
      let current: unknown[] = [];
      for (const [from, to, cardinality] of [
        [0, 1, { min: 2, max: 3 }],
        [1, 2, { min: 1, max: 2 }],
      ] as const) {
        c.position(`pos-${to + 1}`);
        const r = await c.batch([set(from, to, cardinality)], `inclusive-${to}`);
        complete(r, `pos-${to + 1}`, true);
        expect(r.value.results).toEqual([
          { operationIndex: 0, outcome: "matched", count: 2 },
          ...["a", "b"].map((id) => ({
            operationIndex: 0,
            outcome: "updated",
            resource: bead(id, to),
          })),
        ]);
        current = r.value.results.slice(1).map((e: { resource: unknown }) => e.resource);
      }
      const baseline = await groups(c);
      expect(baseline.map((g) => g.position)).toEqual(["pos-1", "pos-2", "pos-3"]);
      for (const [label, range, bound] of [
        ["below", { min: 3 }, "min"],
        ["above", { max: 1 }, "max"],
      ] as const) {
        const r = await c.batch(
          [
            {
              operation: "updateBead",
              bead: "beads/a",
              propertiesChange: [{ op: "replace", path: "/label", value: "temporary-rolled-back" }],
            },
            set(2, 9, range),
          ],
          `outside-${label}`,
        );
        failed(r, "pos-3", `/operations/1/cardinality/${bound}`);
        for (const [i, id] of ["a", "b"].entries())
          expect((await c.exchange(`beads/${id}`)).value).toEqual(current[i]);
        expect(await groups(c)).toEqual(baseline);
      }
    }),
  30000,
);
