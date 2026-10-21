/** NEW packed live correction boundary, with a private administrator sidecar. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { recordRawSse } from "../../../packages/server/test-support/raw-sse-recorder.js";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_LIVE_LINK_INSTALLED_ENTRY;
const source = process.env.BDP_LIVE_LINK_SOURCE;
const evidence = process.env.BDP_LIVE_LINK_EVIDENCE;
const fixtureChild = fileURLToPath(
  new URL("../test-support/live-link-installed-child.ts", import.meta.url),
);
const scope = "https://reference.invalid/acme/";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Row = {
  id: string;
  type: string;
  revision: string;
  source?: unknown;
  target?: unknown;
  properties: Record<string, unknown>;
  metadata: Record<string, unknown>;
};
type AdminResult = {
  group: {
    changes: { operation: string; resourceKind: string; resource: Row }[];
    erasures: unknown[];
    events: { type: string; subject: string; data: unknown }[];
    transaction: string;
    checkpoint: string;
  };
  digestAnomalies: unknown[];
};
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
function erasure(row: Row) {
  return {
    subject: row.id,
    revision: row.revision,
    digest: { scheme: "sha-256-jcs", value: sha(Buffer.from(canonical(row))) },
  };
}
function correctedData(actual: unknown, before: Row, after: Row) {
  expect(actual).toEqual({
    previousRevision: before.revision,
    revision: after.revision,
    change: [{ op: "replace", path: "", value: after.properties }],
    metadataChange: [{ op: "replace", path: "", value: after.metadata }],
  });
}
function deletedData(actual: unknown, row: Row) {
  expect(actual).toEqual({ revision: row.revision });
}
function completeRow(actual: unknown, expected: Row) {
  expect(actual).toEqual(expected);
}
it("installed Link correction/tombstone oracles reject wrong pins, partial roots, wrong digest and leaked deleted content", () => {
  const old: Row = {
    id: `${scope}links/l`,
    type: `${scope}types/relationship`,
    revision: "old",
    source: `${scope}beads/a`,
    target: { uri: `${scope}beads/b`, revision: "pin+ %" },
    properties: { secret: "old" },
    metadata: { secret: "meta" },
  };
  const next: Row = {
    ...old,
    revision: "next",
    properties: { title: "corrected-Link" },
    metadata: { corrected: true },
  };
  const good = {
    previousRevision: "old",
    revision: "next",
    change: [{ op: "replace", path: "", value: next.properties }],
    metadataChange: [{ op: "replace", path: "", value: next.metadata }],
  };
  correctedData(good, old, next);
  deletedData({ revision: "next" }, next);
  completeRow(next, next);
  for (const bad of [
    { ...good, previousRevision: "other" },
    { ...good, change: [{ op: "replace", path: "/title", value: "corrected-Link" }] },
    { ...good, change: [{ op: "replace", path: "", value: old.properties }] },
    { ...good, metadataChange: undefined },
  ])
    expect(() => correctedData(bad, old, next)).toThrow();
  for (const bad of [
    { revision: "old" },
    { revision: "next", properties: next.properties },
    { revision: "next", source: next.source },
  ])
    expect(() => deletedData(bad, next)).toThrow();
  expect(() =>
    completeRow({ ...next, target: { uri: `${scope}beads/b`, revision: "wrong" } }, next),
  ).toThrow();
  expect(() =>
    expect([{ ...erasure(old), digest: { scheme: "sha-256-jcs", value: "0".repeat(64) } }]).toEqual(
      [erasure(old)],
    ),
  ).toThrow();
});

function sourceLocalEvent(actual: unknown, expected: Record<string, unknown>, sourceUrl: string) {
  expect(actual).toEqual({
    ...expected,
    source: sourceUrl,
    id: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
  });
}
it("Event source-local oracle rejects wrong source, malformed cursor and extra payload", () => {
  const expected = {
    id: "scope-id",
    source: `${scope}events/`,
    type: "deleted",
    data: { revision: "r" },
  };
  const projected = { ...expected, id: "resource-id", source: `${scope}links/l?view=events` };
  sourceLocalEvent(projected, expected, projected.source);
  for (const bad of [
    { ...projected, source: expected.source },
    { ...projected, id: "bad cursor!" },
    { ...projected, priorContent: "secret" },
  ])
    expect(() => sourceLocalEvent(bad, expected, projected.source)).toThrow();
});
async function binding() {
  if (!entry || !source) throw new Error("explicit installed entry/source required");
  const emitted = process.env.BDP_LIVE_LINK_BUILD ?? path.join(root, "packages/server/dist"),
    installed = path.dirname(entry),
    pins = [];
  for (const name of (await readdir(emitted)).filter((f) => f.endsWith(".js")).sort()) {
    const bytes = await readFile(path.join(installed, name));
    expect(bytes.equals(await readFile(path.join(emitted, name))), name).toBe(true);
    pins.push({ name, bytes: bytes.length, sha256: sha(bytes) });
  }
  const schema = await readFile(path.join(installed, "../../protocol/schemas/bdp-v0.schema.json"));
  expect(schema.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(true);
  return { source, entry, pins, schemaSHA256: sha(schema) };
}

function launch(configuration: unknown) {
  if (!entry) throw new Error("missing installed entry");
  const child = spawn(process.execPath, [fixtureChild], {
    env: { ...process.env, BDP_LIVE_LINK_RUNTIME: path.dirname(entry) },
    cwd: "/tmp",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "",
    stderr = "",
    bytes = 0,
    overflow = false,
    forced = false;
  if (!child.stdout || !child.stderr) throw new Error("missing child pipes");
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    count(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    count(chunk);
  });
  function count(chunk: Buffer) {
    bytes += chunk.length;
    if (bytes > 65536) {
      overflow = true;
      child.kill("SIGKILL");
      return false;
    }
    return true;
  }
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  async function bounded<T>(operation: Promise<T>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            forced = true;
            child.kill("SIGKILL");
            void closed.then(() => reject(new Error("installed child deadline")), reject);
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const ready = bounded(
    new Promise<Record<string, unknown>>((resolve, reject) => {
      child.once("message", (value) => resolve(value as Record<string, unknown>));
      void closed.then(() => reject(new Error(`installed child exited before ready: ${stderr}`)));
      child.send({ configuration });
    }),
  );
  let terminal: Promise<unknown> | undefined;
  return {
    child,
    ready,
    close: () =>
      (terminal ??= (async () => {
        if (child.connected) child.send({ command: "close" });
        const result = await bounded(closed);
        return {
          ...result,
          stdout,
          stderr,
          bytes,
          overflow,
          forced,
          stdoutEOF: child.stdout!.readableEnded,
          stderrEOF: child.stderr!.readableEnded,
          reaped: true,
        };
      })()),
  };
}

it.skipIf(!entry)(
  "packed unowned live Link correction and last-version tombstone preserve actual administrative/HTTP/SSE/reopen boundaries",
  async () => {
    let directory: string | undefined,
      run: ReturnType<typeof launch> | undefined,
      stream: ReturnType<typeof recordRawSse> | undefined;
    let report: unknown, modules: unknown, configuration: Record<string, unknown> | undefined;
    const failures: unknown[] = [],
      wires: unknown[] = [],
      terminals: unknown[] = [],
      generations: unknown[] = [],
      closedPids = new Set<number>();
    const controller = new AbortController();
    const watchdog = setTimeout(
      () => controller.abort(Error("installed Link cohort deadline")),
      45000,
    );
    async function closeCurrent() {
      if (!run) return;
      const terminal = await run.close();
      if (run.child.pid !== undefined && !closedPids.has(run.child.pid)) {
        terminals.push(terminal);
        closedPids.add(run.child.pid);
      }
      expect(terminal).toMatchObject({
        code: 0,
        signal: null,
        overflow: false,
        forced: false,
        stdoutEOF: true,
        stderrEOF: true,
        reaped: true,
      });
    }
    try {
      modules = await binding();
      directory = await mkdtemp(path.join(tmpdir(), "bdp-live-link-installed-"));
      const token = randomBytes(32).toString("base64url"),
        type = `${scope}types/task`,
        linkType = `${scope}types/relationship`,
        schema = `${scope}schemas/open`;
      configuration = {
        scope,
        directory,
        create: true,
        credentials: [{ token, principal: "writer", canMutate: true }],
        artifacts: {
          descriptors: [
            { id: type, name: "Task", describes: "bead", conformsTo: [], propertiesSchema: schema },
            {
              id: linkType,
              name: "Relationship",
              describes: "link",
              conformsTo: [],
              propertiesSchema: schema,
              source: { conformsTo: [type], external: "none" },
              target: { conformsTo: [type], external: "none" },
            },
          ].map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
          schemas: [
            {
              retrievalUri: schema,
              utf8: JSON.stringify({ $id: schema, type: "object", additionalProperties: true }),
            },
          ],
        },
      };
      run = launch(configuration);
      const ready = await run.ready;
      generations.push(ready);
      expect(ready.fixture).toBe("installed-live-link-administration-only");
      expect(ready.ordinaryDeployment).toBe(false);
      expect(ready.administrationPublic).toBe(false);
      expect(ready.facadeKeys).toEqual([
        "close",
        "configurationMetadata",
        "listenUrl",
        "replaceAuthorizationPolicy",
        "scope",
        "targets",
      ]);
      if (!source) throw Error("explicit packed source required");
      const fixture = {
        bytes: await readFile(
          path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
        ),
      };
      const baseline = installedTransactionBinding(ready, source, fixture);
      let address = new URL(String(ready.listenUrl));
      async function exchange(
        target: string,
        method: HttpMethod = "GET",
        body?: unknown,
        key?: string,
      ) {
        const url = new URL(target, scope).href,
          parsed = new URL(url);
        if (
          parsed.origin !== new URL(scope).origin ||
          !parsed.pathname.startsWith("/acme/") ||
          parsed.hash ||
          wires.length >= 40
        )
          throw Error("unbound/excess Link request");
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
          signal: controller.signal,
          raw: {
            headerLines:
              body === undefined
                ? []
                : [
                    { name: "Content-Type", value: "application/json" },
                    { name: "Idempotency-Key", value: key! },
                  ],
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
          },
        });
        wires.push({
          method,
          url,
          body,
          key,
          status: wire.status,
          headers: wire.headers,
          bodyText: wire.bodyText,
          wireBase64: Buffer.from(wire.wireResponseBytes ?? []).toString("base64"),
        });
        expect(wire.exactRequest?.writeState).toBe("complete");
        expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
        return { wire, value: wire.bodyText === "" ? undefined : JSON.parse(wire.bodyText) };
      }
      async function administer(command: "correct-live" | "tombstone-live", row: Row) {
        const active = run;
        if (!active) throw Error("missing owned child");
        const activeChild = active.child;
        return new Promise<AdminResult>((resolve, reject) => {
          const timer = setTimeout(() => {
            activeChild.off("message", accept);
            reject(Error("private Link response deadline"));
          }, 5000);
          function accept(value: unknown) {
            if (
              value &&
              typeof value === "object" &&
              "event" in value &&
              value.event === "private-live-link.done" &&
              "command" in value &&
              value.command === command &&
              "result" in value
            ) {
              clearTimeout(timer);
              activeChild.off("message", accept);
              resolve(value.result as AdminResult);
            }
          }
          activeChild.on("message", accept);
          activeChild.send({ command, subject: row.id, revision: row.revision });
        });
      }
      const create = {
        operations: [
          {
            operation: "createBead",
            id: "beads/a",
            type,
            properties: { healthy: "a" },
            metadata: {},
          },
          {
            operation: "createBead",
            id: "beads/b",
            type,
            properties: { healthy: "b" },
            metadata: {},
          },
          {
            operation: "createLink",
            id: "links/l",
            type: linkType,
            source: "beads/a",
            target: { uri: "beads/b", revision: "opaque-pin+ %" },
            properties: { secret: "packed-Link-old-property" },
            metadata: { secret: "packed-Link-old-metadata" },
          },
        ],
      };
      const seeded = await exchange("operations/batch", "POST", create, "link-seed");
      expect(seeded.wire.status).toBe(200);
      expect(seeded.value.status).toBe("completed");
      expect(seeded.value.results).toHaveLength(3);
      const [a, b, old] = seeded.value.results.map((r: { resource: Row }) => r.resource) as [
        Row,
        Row,
        Row,
      ];
      completeRow(a, {
        id: `${scope}beads/a`,
        type,
        revision: a.revision,
        properties: { healthy: "a" },
        metadata: {},
      });
      completeRow(b, {
        id: `${scope}beads/b`,
        type,
        revision: b.revision,
        properties: { healthy: "b" },
        metadata: {},
      });
      completeRow(old, {
        id: `${scope}links/l`,
        type: linkType,
        revision: old.revision,
        source: a.id,
        target: { uri: b.id, revision: "opaque-pin+ %" },
        properties: { secret: "packed-Link-old-property" },
        metadata: { secret: "packed-Link-old-metadata" },
      });
      const epoch = seeded.wire.headers["bdp-scope-epoch"],
        view = seeded.wire.headers["bdp-authorization-view"];
      expect(epoch).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      expect(view).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      function context(response: Awaited<ReturnType<typeof exchange>>, position: string) {
        expect(response.wire.headers["bdp-scope-epoch"]).toBe(epoch);
        expect(response.wire.headers["bdp-authorization-view"]).toBe(view);
        expect(response.wire.headers["bdp-scope-position"]).toBe(position);
      }
      context(seeded, "pos-1");
      const endpointA = await exchange("beads/a?view=events"),
        endpointB = await exchange("beads/b?view=events");
      for (const [response, bead] of [
        [endpointA, a],
        [endpointB, b],
      ] as const) {
        expect(response.wire.status).toBe(200);
        context(response, "pos-1");
        expect(response.value.events.map((event: { type: string }) => event.type)).toEqual([
          "created",
          "linked",
        ]);
        expect(response.value.events[0]).toMatchObject({
          subject: bead.id,
          type: "created",
          data: { revision: bead.revision, properties: bead.properties, metadata: bead.metadata },
        });
      }
      const saved = await exchange("snapshot"),
        page = await exchange("beads/?limit=1"),
        first = await exchange("changes/?after=genesis"),
        initial = await exchange("events/");
      for (const result of [saved, page, first, initial]) {
        expect(result.wire.status).toBe(200);
        context(result, "pos-1");
      }
      expect(saved.value.links.items).toEqual([old]);
      expect(saved.value.beads.items).toEqual([a, b]);
      expect(page.value.items).toEqual([a]);
      expect(typeof page.value.next).toBe("string");
      expect(initial.value.events.map((e: { type: string }) => e.type)).toEqual([
        "created",
        "created",
        "created",
        "linked",
        "linked",
      ]);
      const oldCursor = initial.value.events[3].id,
        checkpoint = first.value.groups[0].checkpoint;
      stream = recordRawSse({
        dial: String(ready.listenUrl),
        host: new URL(scope).host,
        target: `/acme/changes/?after=${encodeURIComponent(checkpoint)}`,
        headers: [
          ["Authorization", `Bearer ${token}`],
          ["Accept", "text/event-stream"],
        ],
        signal: controller.signal,
        timeoutMs: 15000,
      });
      await stream.ready;
      expect(stream.status).toBe(200);
      const correction = await administer("correct-live", old);
      expect(correction).not.toHaveProperty("receipt");
      expect(correction.digestAnomalies).toEqual([]);
      expect(correction.group.erasures).toEqual([erasure(old)]);
      const successor = correction.group.changes[0]?.resource;
      if (!successor) throw Error("missing Link successor");
      completeRow(successor, {
        ...old,
        revision: successor.revision,
        properties: { title: "corrected-Link" },
        metadata: { corrected: true },
      });
      expect(successor.revision).not.toBe(old.revision);
      await stream.until(() => stream!.frames.some((f) => f.includes('"position":"pos-2"')));
      const groups = () =>
        stream!.frames
          .filter((f) => f.startsWith("id: "))
          .map((f) => JSON.parse(f.split("\ndata: ")[1]!));
      expect(groups()).toHaveLength(1);
      const correctedGroup = groups()[0];
      expect(correctedGroup).toMatchObject({
        position: "pos-2",
        scopeEpoch: epoch,
        authorizationView: view,
        transaction: correction.group.transaction,
        projectionAdvance: false,
        changes: [{ operation: "upsert", resourceKind: "link", resource: successor }],
        erasures: [erasure(old)],
        eventCount: 1,
        events: [{ type: "updated", subject: old.id }],
      });
      correctedData(correctedGroup.events[0].data, old, successor);
      expect(correctedGroup).not.toHaveProperty("erasurePruned");
      const correctedCurrent = await exchange("links/l");
      expect(correctedCurrent.wire.status).toBe(200);
      completeRow(correctedCurrent.value, successor);
      context(correctedCurrent, "pos-2");
      for (const target of [
        page.value.next,
        saved.value.id,
        `changes/?after=${encodeURIComponent(checkpoint)}`,
      ]) {
        const stale = await exchange(target);
        expect(stale.wire.status).toBe(410);
        expect(stale.value.code).toBe("cursor-expired");
        context(stale, "pos-2");
      }
      const beforeLast = await exchange(`events/?after=${encodeURIComponent(oldCursor)}`);
      expect(beforeLast.wire.status).toBe(200);
      expect(beforeLast.value.events.map((e: { type: string }) => e.type)).toEqual([
        "linked",
        "updated",
      ]);
      const tombstone = await administer("tombstone-live", successor);
      expect(tombstone).not.toHaveProperty("receipt");
      expect(tombstone.digestAnomalies).toEqual([]);
      expect(tombstone.group.erasures).toEqual([erasure(successor)]);
      await stream.until(() => stream!.frames.some((f) => f.includes('"position":"pos-3"')));
      expect(groups()).toHaveLength(2);
      const deletedGroup = groups()[1];
      expect(deletedGroup).toMatchObject({
        position: "pos-3",
        scopeEpoch: epoch,
        authorizationView: view,
        transaction: tombstone.group.transaction,
        projectionAdvance: false,
        changes: [
          {
            operation: "tombstone",
            resourceKind: "link",
            resource: { id: old.id, type: old.type, revision: successor.revision },
          },
        ],
        erasures: [erasure(successor)],
        eventCount: 1,
        events: [{ type: "deleted", subject: old.id }],
      });
      expect(Object.keys(deletedGroup.changes[0].resource).sort()).toEqual([
        "id",
        "revision",
        "type",
      ]);
      deletedData(deletedGroup.events[0].data, successor);
      expect(deletedGroup).not.toHaveProperty("erasurePruned");
      const after = await exchange(`events/?after=${encodeURIComponent(oldCursor)}`);
      expect(after.wire.status).toBe(200);
      expect(after.value.events).toEqual([deletedGroup.events[0]]);
      const allEvents = await exchange("events/");
      expect(allEvents.value.events).toEqual([
        initial.value.events[0],
        initial.value.events[1],
        deletedGroup.events[0],
      ]);
      for (const [target, expected] of [
        ["beads/a?view=events", endpointA.value.events[0]],
        ["beads/b?view=events", endpointB.value.events[0]],
        ["links/l?view=events", deletedGroup.events[0]],
      ] as const) {
        const response = await exchange(target);
        expect(response.wire.status).toBe(200);
        expect(response.value.events).toHaveLength(1);
        if (target === "links/l?view=events")
          sourceLocalEvent(response.value.events[0], expected, new URL(target, scope).href);
        else expect(response.value.events).toEqual([expected]);
        context(response, "pos-3");
      }
      const gone = await exchange("links/l");
      expect(gone.wire.status).toBe(404);
      expect(gone.value.code).toBe("resource-not-found");
      const receipt = await exchange(seeded.value.id),
        replay = await exchange("operations/batch", "POST", create, "link-seed");
      expect(receipt.wire.status).toBe(200);
      expect(receipt.value.results).toEqual([
        seeded.value.results[0],
        seeded.value.results[1],
        {
          operationIndex: 2,
          outcome: "erased",
          erased: { id: old.id, type: old.type, revision: old.revision },
        },
      ]);
      expect(replay.wire.status).toBe(200);
      expect(replay.value).toEqual(receipt.value);
      const fresh = await exchange("snapshot");
      expect(fresh.wire.status).toBe(200);
      expect(fresh.value.links.items).toEqual([]);
      expect(fresh.value.beads.items).toEqual([a, b]);
      expect(fresh.value.erasures).toEqual([erasure(old), erasure(successor)]);
      const checkpoint2 = correctedGroup.checkpoint;
      const stale2 = await exchange(`changes/?after=${encodeURIComponent(checkpoint2)}`);
      expect(stale2.wire.status).toBe(410);
      expect(stale2.value.code).toBe("cursor-expired");
      for (const observation of [after, allEvents, gone, receipt, replay, fresh, stale2]) {
        context(observation, "pos-3");
        expect(observation.wire.bodyText).not.toContain("packed-Link-old-");
        expect(observation.wire.bodyText).not.toContain("corrected-Link");
      }
      await stream.close();
      await closeCurrent();
      run = launch({ ...configuration, create: false });
      const reopened = await run.ready;
      generations.push(reopened);
      const reopenedBinding = installedTransactionBinding(reopened, source, fixture);
      expect(reopenedBinding.runtimeConfigurationIdentity).toBe(
        baseline.runtimeConfigurationIdentity,
      );
      expect(reopened.payloadIdentity).toBe(ready.payloadIdentity);
      address = new URL(String(reopened.listenUrl));
      const reopenedSnapshot = await exchange("snapshot"),
        reopenedReplay = await exchange("operations/batch", "POST", create, "link-seed"),
        reopenedGone = await exchange("links/l"),
        reopenedEvents = await exchange(`events/?after=${encodeURIComponent(oldCursor)}`);
      expect(reopenedSnapshot.value.beads.items).toEqual([a, b]);
      expect(reopenedSnapshot.value.links.items).toEqual([]);
      expect(reopenedSnapshot.value.erasures).toEqual([erasure(old), erasure(successor)]);
      expect(reopenedReplay.value).toEqual(receipt.value);
      expect(reopenedGone.wire.status).toBe(404);
      expect(reopenedEvents.wire.status).toBe(200);
      expect(reopenedEvents.value.events).toEqual([deletedGroup.events[0]]);
      for (const response of [reopenedSnapshot, reopenedReplay, reopenedGone, reopenedEvents]) {
        context(response, "pos-3");
        expect(response.wire.bodyText).not.toContain("packed-Link-old-");
        expect(response.wire.bodyText).not.toContain("corrected-Link");
      }
      report = {
        modules,
        configuration,
        baseline,
        reopenedBinding,
        generations,
        old,
        successor,
        correction,
        tombstone,
        sseGroups: groups(),
        expectedLedger: [erasure(old), erasure(successor)],
        freshSnapshot: fresh.value,
        privateAdministration: true,
        ordinaryDeployment: false,
        wholeContract: false,
      };
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(watchdog);
      try {
        if (stream) await stream.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await closeCurrent();
      } catch (error) {
        failures.push(error);
      }
      try {
        if (directory) await rm(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
      const completion = {
        report,
        modules,
        configuration,
        generations,
        terminals,
        wires,
        failureCount: failures.length,
        failures: failures.map((e) => inspect(e, { depth: 8 })),
        sse: stream
          ? {
              wireBase64: stream.wireBytes.toString("base64"),
              destroyed: stream.destroyed,
              status: stream.status,
            }
          : null,
        temporaryStoreRemoved:
          directory === undefined || !(await import("node:fs")).existsSync(directory),
        claimEligible: false,
      };
      try {
        if (evidence)
          await writeFile(
            path.join(evidence, "observation.json"),
            JSON.stringify(completion, null, 2),
            { mode: 0o600 },
          );
      } catch (error) {
        failures.push(error);
      }
      console.log(
        JSON.stringify({
          kind: "packed-installed-live-Link",
          requests: wires.length,
          generations: generations.length,
          terminals,
          temporaryStoreRemoved: completion.temporaryStoreRemoved,
          failureCount: failures.length,
          claimEligible: false,
        }),
      );
    }
    if (failures.length)
      throw new AggregateError(failures, "packed installed Link boundary failed");
  },
  60000,
);
