/** NEW packed unowned-Bead tombstone boundary, with a private administrator sidecar. */
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
const entry = process.env.BDP_TOMBSTONE_INSTALLED_ENTRY;
const source = process.env.BDP_TOMBSTONE_SOURCE;
const evidence = process.env.BDP_TOMBSTONE_EVIDENCE;
const fixtureChild = fileURLToPath(
  new URL("../test-support/tombstone-installed-child.ts", import.meta.url),
);
const scope = "https://reference.invalid/acme/";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type AdminResult = {
  group: {
    erasures: unknown[];
    changes: { resource: Row }[];
    events: { type: string; subject: string; data: unknown }[];
    transaction: string;
    eventCount: number;
  };
  digestAnomalies: unknown[];
};
type Row = {
  id: string;
  type: string;
  revision: string;
  properties: { title: string };
  metadata: Record<string, unknown>;
};
function tombstoneGroup(actual: AdminResult["group"], original: Row, erasures: unknown[]) {
  expect(actual.erasures).toEqual(erasures);
  expect(actual.changes).toEqual([
    {
      operation: "tombstone",
      resourceKind: "bead",
      resource: { id: original.id, type: original.type, revision: original.revision },
    },
  ]);
  expect(actual.eventCount).toBe(1);
  expect(actual.events).toHaveLength(1);
  expect(actual.events[0]).toMatchObject({
    type: "deleted",
    subject: original.id,
    data: { revision: original.revision },
  });
  expect(actual.events[0]?.data).toEqual({ revision: original.revision });
}
it("tombstone oracle rejects missing tombstones, wrong digests and missing deleted facts", () => {
  const original: Row = {
    id: `${scope}beads/b`,
    type: `${scope}types/task`,
    revision: "old",
    properties: { title: "secret" },
    metadata: {},
  };
  const erasures = [
    {
      subject: original.id,
      revision: original.revision,
      digest: { scheme: "sha-256-jcs", value: "known" },
    },
  ];
  const good = {
    erasures,
    changes: [
      {
        operation: "tombstone",
        resourceKind: "bead",
        resource: { id: original.id, type: original.type, revision: original.revision },
      },
    ],
    events: [{ type: "deleted", subject: original.id, data: { revision: original.revision } }],
    eventCount: 1,
    transaction: "fixture",
  } as unknown as AdminResult["group"];
  tombstoneGroup(good, original, erasures);
  for (const bad of [
    { ...good, changes: [] },
    { ...good, erasures: [{ ...erasures[0], digest: { scheme: "sha-256-jcs", value: "wrong" } }] },
    { ...good, events: [] },
  ])
    expect(() => tombstoneGroup(bad, original, erasures)).toThrow();
});
async function binding() {
  if (!entry || !source) throw new Error("explicit installed entry/source required");
  const emitted = process.env.BDP_TOMBSTONE_BUILD ?? path.join(root, "packages/server/dist"),
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
    env: { ...process.env, BDP_TOMBSTONE_RUNTIME: path.dirname(entry) },
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
  "packed unowned-Bead tombstone atomically withholds current content and survives same-epoch reopen",
  async () => {
    const modules = await binding(),
      directory = await mkdtemp(path.join(tmpdir(), "bdp-erasure-installed-"));
    const token = randomBytes(32).toString("base64url"),
      type = `${scope}types/task`,
      schema = `${scope}schemas/properties`;
    const configuration = {
      scope,
      directory,
      create: true,
      credentials: [{ token, principal: "writer", canMutate: true }],
      artifacts: {
        descriptors: [
          {
            retrievalUri: type,
            utf8: JSON.stringify({
              id: type,
              name: "Task",
              describes: "bead",
              conformsTo: [],
              propertiesSchema: schema,
            }),
          },
        ],
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
      },
    };
    let run = launch(configuration);
    const wires: unknown[] = [],
      terminals: unknown[] = [],
      generations: unknown[] = [];
    const controller = new AbortController();
    const watchdog = setTimeout(
      () => controller.abort(Error("installed erasure cohort deadline")),
      45000,
    );
    let stream: ReturnType<typeof recordRawSse> | undefined,
      terminal: unknown,
      report: unknown,
      failure: unknown;
    try {
      const ready = await run.ready;
      generations.push(ready);
      if (!source) throw Error("explicit source missing");
      expect(ready.fixture).toBe("installed-tombstone-administration-only");
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
      const baseline = installedTransactionBinding(ready, source, {
        bytes: await readFile(
          path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
        ),
      });
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
          wires.length >= 28
        )
          throw Error("unbound/excess erasure request");
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
      const create = {
        operations: [
          { operation: "createBead", id: "beads/a", type, properties: { title: "safe" } },
          {
            operation: "createBead",
            id: "beads/b",
            type,
            properties: { title: "installed-tombstone-old-property" },
            metadata: { secret: "installed-tombstone-old-metadata" },
          },
        ],
      };
      const seeded = await exchange("operations/batch", "POST", create, "erasure-seed");
      expect(seeded.wire.status).toBe(200);
      expect(seeded.value.status).toBe("completed");
      expect(seeded.value.results).toHaveLength(2);
      const originals = seeded.value.results.map((r: { resource: Row }) => r.resource) as Row[];
      const old = originals[1];
      if (!old) throw Error("missing original");
      expect(old).toEqual({
        id: `${scope}beads/b`,
        type,
        revision: expect.any(String),
        properties: { title: "installed-tombstone-old-property" },
        metadata: { secret: "installed-tombstone-old-metadata" },
      });
      const epoch = seeded.wire.headers["bdp-scope-epoch"],
        view = seeded.wire.headers["bdp-authorization-view"];
      expect(epoch).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      expect(view).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      expect(seeded.wire.headers["bdp-scope-position"]).toBe("pos-1");
      const initialCurrent = await exchange("beads/b");
      expect(initialCurrent.wire.status).toBe(200);
      expect(initialCurrent.value).toEqual(old);
      const first = await exchange("beads/?limit=1");
      expect(first.wire.status).toBe(200);
      expect(first.value.items).toEqual([originals[0]]);
      expect(first.value.next).toBeTypeOf("string");
      const continuation = first.value.next as string;
      const saved = await exchange("snapshot");
      expect(saved.wire.status).toBe(200);
      expect(saved.value.beads.items).toEqual(originals);
      const originalEvents = await exchange("events/");
      expect(originalEvents.wire.status).toBe(200);
      const oldCursor = originalEvents.value.events.find(
        (event: { subject: string }) => event.subject === old.id,
      )?.id;
      expect(oldCursor).toBeTypeOf("string");
      const initial = await exchange("changes/?after=genesis");
      expect(initial.wire.status).toBe(200);
      expect(initial.value.groups).toHaveLength(1);
      const checkpoint = initial.value.groups[0].checkpoint as string;
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
      const result = await new Promise<AdminResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          run.child.off("message", accept);
          reject(Error("private administration response deadline"));
        }, 5000);
        function accept(value: unknown) {
          if (
            value &&
            typeof value === "object" &&
            "event" in value &&
            value.event === "private-tombstone.done" &&
            "result" in value
          ) {
            clearTimeout(timer);
            run.child.off("message", accept);
            resolve(value.result as AdminResult);
          }
        }
        run.child.on("message", accept);
        run.child.send({ command: "tombstone-live", subject: old.id, revision: old.revision });
      });
      await stream.until(() =>
        stream!.frames.some((frame) => frame.includes('"position":"pos-2"')),
      );
      const groups = stream.frames
        .filter((frame) => frame.startsWith("id: "))
        .map((frame) => JSON.parse(frame.split("\ndata: ")[1]!));
      expect(groups).toHaveLength(1);
      const canonicalOriginal = JSON.stringify({
        id: old.id,
        metadata: old.metadata,
        properties: old.properties,
        revision: old.revision,
        type: old.type,
      });
      const erasures = [
        {
          subject: old.id,
          revision: old.revision,
          digest: { scheme: "sha-256-jcs", value: sha(Buffer.from(canonicalOriginal)) },
        },
      ];
      expect(result.group.erasures).toEqual(erasures);
      expect(result.digestAnomalies).toEqual([]);
      tombstoneGroup(result.group, old, erasures);
      expect(result.group.transaction).toMatch(/^[a-f0-9-]{36}$/);
      expect(groups[0]).toMatchObject({
        position: "pos-2",
        scopeEpoch: epoch,
        authorizationView: view,
        projectionAdvance: false,
        transaction: result.group.transaction,
        changes: result.group.changes,
        events: result.group.events.map((event) => ({ ...event, id: expect.any(String) })),
        eventCount: 1,
        erasures,
      });
      tombstoneGroup(groups[0], old, erasures);
      expect(groups[0]).not.toHaveProperty("receipt");
      expect(groups[0]).not.toHaveProperty("erasurePruned");
      expect(JSON.stringify(groups[0])).not.toContain("installed-tombstone-old-");
      const stale = await exchange(continuation);
      expect(stale.wire.status).toBe(410);
      expect(stale.value.code).toBe("cursor-expired");
      const staleSnapshot = await exchange(saved.value.id);
      expect(staleSnapshot.wire.status).toBe(410);
      expect(staleSnapshot.value.code).toBe("cursor-expired");
      const staleChanges = await exchange(`changes/?after=${encodeURIComponent(checkpoint)}`);
      expect(staleChanges.wire.status).toBe(410);
      expect(staleChanges.value.code).toBe("cursor-expired");
      const current = await exchange("beads/b");
      expect(current.wire.status).toBe(404);
      expect(current.value.code).toBe("resource-not-found");
      const fresh = await exchange("beads/?limit=10");
      expect(fresh.wire.status).toBe(200);
      expect(fresh.value).toEqual({ items: [originals[0]], next: null });
      const healthy = await exchange("beads/a");
      expect(healthy.wire.status).toBe(200);
      expect(healthy.value).toEqual(originals[0]);
      const receipt = await exchange(seeded.value.id);
      expect(receipt.wire.status).toBe(200);
      const erasedResult = {
        operationIndex: 1,
        outcome: "erased",
        erased: { id: old.id, type: old.type, revision: old.revision },
      };
      expect(receipt.value.results).toEqual([seeded.value.results[0], erasedResult]);
      const replay = await exchange("operations/batch", "POST", create, "erasure-seed");
      expect(replay.wire.status).toBe(200);
      expect(replay.value.id).toBe(seeded.value.id);
      expect(replay.value.results).toEqual(receipt.value.results);
      const freshSnapshot = await exchange("snapshot");
      expect(freshSnapshot.wire.status).toBe(200);
      expect(freshSnapshot.value.beads.items).toEqual([originals[0]]);
      expect(freshSnapshot.value.erasures).toEqual(erasures);
      const events = await exchange(`events/?after=${encodeURIComponent(oldCursor)}`);
      expect(events.wire.status).toBe(200);
      expect(events.value.events).toHaveLength(1);
      expect(events.value.events[0]).toEqual(groups[0].events[0]);
      expect(events.wire.bodyText).not.toContain("installed-tombstone-old-");
      for (const observation of [
        stale,
        staleSnapshot,
        staleChanges,
        current,
        fresh,
        healthy,
        receipt,
        replay,
        freshSnapshot,
        events,
      ]) {
        expect(observation.wire.bodyText).not.toContain("installed-tombstone-old-");
        expect(observation.wire.headers["bdp-scope-epoch"]).toBe(epoch);
        expect(observation.wire.headers["bdp-authorization-view"]).toBe(view);
        expect(observation.wire.headers["bdp-scope-position"]).toBe("pos-2");
      }
      await stream.close();
      terminal = await run.close();
      terminals.push(terminal);
      expect(terminal).toMatchObject({
        code: 0,
        signal: null,
        overflow: false,
        forced: false,
        stdoutEOF: true,
        stderrEOF: true,
      });
      run = launch({ ...configuration, create: false });
      const reopened = await run.ready;
      generations.push(reopened);
      const reopenedBinding = installedTransactionBinding(reopened, source, {
        bytes: await readFile(
          path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
        ),
      });
      address = new URL(String(reopened.listenUrl));
      const reopenedCurrent = await exchange("beads/b");
      expect(reopenedCurrent.wire.status).toBe(404);
      expect(reopenedCurrent.value.code).toBe("resource-not-found");
      const reopenedReplay = await exchange("operations/batch", "POST", create, "erasure-seed");
      expect(reopenedReplay.wire.status).toBe(200);
      expect(reopenedReplay.value.id).toBe(seeded.value.id);
      expect(reopenedReplay.value.results).toEqual(receipt.value.results);
      const reopenedSnapshot = await exchange("snapshot");
      expect(reopenedSnapshot.wire.status).toBe(200);
      expect(reopenedSnapshot.value.erasures).toEqual(erasures);
      expect(reopenedSnapshot.value.beads.items).toEqual([originals[0]]);
      for (const response of [reopenedCurrent, reopenedReplay, reopenedSnapshot]) {
        expect(response.wire.headers["bdp-scope-epoch"]).toBe(epoch);
        expect(response.wire.headers["bdp-authorization-view"]).toBe(view);
        expect(response.wire.headers["bdp-scope-position"]).toBe("pos-2");
        expect(response.wire.bodyText).not.toContain("installed-tombstone-old-");
      }
      report = {
        modules,
        reopenedBinding,
        generations,
        baseline,
        ready,
        configuration,
        fixtureSHA256: sha(await readFile(fixtureChild)),
        originals,
        oldCursor,
        continuation,
        savedSnapshot: saved.value,
        erasures,
        administratorResult: result,
        sseGroups: groups,
        freshSnapshot: freshSnapshot.value,
        receipt: receipt.value,
        replay: replay.value,
        wholeContract: false,
        privateAdministration: true,
        ordinaryDeployment: false,
      };
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      clearTimeout(watchdog);
      try {
        if (stream) await stream.close();
        terminal = await run.close();
        terminals.push(terminal);
        expect(terminal).toMatchObject({
          code: 0,
          signal: null,
          overflow: false,
          forced: false,
          stdoutEOF: true,
          stderrEOF: true,
        });
      } finally {
        let evidenceFailure: unknown;
        try {
          if (evidence)
            await writeFile(
              path.join(evidence, "observation.json"),
              JSON.stringify(
                {
                  report,
                  terminal,
                  terminals,
                  generations,
                  failure: failure === undefined ? null : inspect(failure, { depth: 8 }),
                  wires,
                  sse: stream
                    ? {
                        wireBase64: stream.wireBytes.toString("base64"),
                        destroyed: stream.destroyed,
                        status: stream.status,
                      }
                    : null,
                },
                null,
                2,
              ),
              { mode: 0o600 },
            );
        } catch (error) {
          evidenceFailure = error;
          throw error;
        } finally {
          try {
            await rm(directory, { recursive: true, force: true });
          } catch (cleanupError) {
            if (evidenceFailure !== undefined)
              throw new AggregateError(
                [evidenceFailure, cleanupError],
                "evidence writing and temporary-store cleanup failed",
              );
            throw cleanupError;
          }
        }
      }
    }
  },
  60000,
);
