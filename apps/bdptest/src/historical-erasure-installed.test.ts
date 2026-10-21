/** NEW packed historical erasure boundary, with a private administrator sidecar. */
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
const entry = process.env.BDP_ERASURE_INSTALLED_ENTRY;
const source = process.env.BDP_ERASURE_SOURCE;
const evidence = process.env.BDP_ERASURE_EVIDENCE;
const fixtureChild = fileURLToPath(
  new URL("../test-support/historical-erasure-installed-child.ts", import.meta.url),
);
const scope = "https://reference.invalid/acme/";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type AdminResult = { group: { erasures: unknown[] }; digestAnomalies: unknown[] };
type Row = {
  id: string;
  type: string;
  revision: string;
  properties: { title: string };
  metadata: Record<string, unknown>;
};
async function binding() {
  if (!entry || !source) throw new Error("explicit installed entry/source required");
  const emitted = process.env.BDP_ERASURE_BUILD ?? path.join(root, "packages/server/dist"),
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
    env: { ...process.env, BDP_ERASURE_RUNTIME: path.dirname(entry) },
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
    if (count(chunk)) stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (count(chunk)) stderr += chunk.toString("utf8");
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
        return { ...result, stdout, stderr, bytes, overflow, forced, eof: true, reaped: true };
      })()),
  };
}

it.skipIf(!entry)(
  "packed historical erasure purges continuation, receipt and Snapshot while preserving successor and public SSE group",
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
    const run = launch(configuration),
      wires: unknown[] = [],
      controller = new AbortController();
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
      if (!source) throw Error("explicit source missing");
      expect(ready.fixture).toBe("installed-historical-administration-only");
      expect(ready.ordinaryDeployment).toBe(false);
      expect(ready.administrationPublic).toBe(false);
      const baseline = installedTransactionBinding(ready, source, {
        bytes: await readFile(
          path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
        ),
      });
      const address = new URL(String(ready.listenUrl));
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
          wires.length >= 20
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
            properties: { title: "installed-erasure-secret" },
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
        properties: { title: "installed-erasure-secret" },
        metadata: {},
      });
      const epoch = seeded.wire.headers["bdp-scope-epoch"],
        view = seeded.wire.headers["bdp-authorization-view"];
      expect(epoch).toBeTypeOf("string");
      expect(view).toBeTypeOf("string");
      expect(seeded.wire.headers["bdp-scope-position"]).toBe("pos-1");
      const first = await exchange("beads/?limit=1");
      expect(first.wire.status).toBe(200);
      expect(first.value.items).toEqual([originals[0]]);
      expect(first.value.next).toBeTypeOf("string");
      const continuation = first.value.next as string;
      const saved = await exchange("snapshot");
      expect(saved.wire.status).toBe(200);
      expect(saved.value.beads.items).toEqual(originals);
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
      const update = await exchange(
        "operations/batch",
        "POST",
        {
          operations: [
            {
              operation: "updateBead",
              bead: "beads/b",
              propertiesChange: [{ op: "replace", path: "/title", value: "replacement" }],
            },
          ],
        },
        "erasure-update",
      );
      expect(update.wire.status).toBe(200);
      const successor = update.value.results[0].resource as Row;
      expect(successor.revision).not.toBe(old.revision);
      expect(successor.properties).toEqual({ title: "replacement" });
      await stream.until(() =>
        stream!.frames.some((frame) => frame.includes('"position":"pos-2"')),
      );
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
            value.event === "private-erasure.done" &&
            "result" in value
          ) {
            clearTimeout(timer);
            run.child.off("message", accept);
            resolve(value.result as AdminResult);
          }
        }
        run.child.on("message", accept);
        run.child.send({ command: "erase-historical", subject: old.id, revision: old.revision });
      });
      await stream.until(() =>
        stream!.frames.some((frame) => frame.includes('"position":"pos-3"')),
      );
      const groups = stream.frames
        .filter((frame) => frame.startsWith("id: "))
        .map((frame) => JSON.parse(frame.split("\ndata: ")[1]!));
      expect(groups).toHaveLength(2);
      const canonicalOriginal = JSON.stringify({
        id: old.id,
        metadata: {},
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
      expect(groups[1]).toMatchObject({
        position: "pos-3",
        scopeEpoch: epoch,
        authorizationView: view,
        changes: [],
        events: [],
        eventCount: 0,
        erasures,
      });
      expect(groups[1]).not.toHaveProperty("erasurePruned");
      expect(JSON.stringify(groups[1])).not.toContain("installed-erasure-secret");
      const stale = await exchange(continuation);
      expect(stale.wire.status).toBe(410);
      expect(stale.value.code).toBe("cursor-expired");
      const staleSnapshot = await exchange(saved.value.id);
      expect(staleSnapshot.wire.status).toBe(410);
      expect(staleSnapshot.value.code).toBe("cursor-expired");
      const current = await exchange("beads/b");
      expect(current.wire.status).toBe(200);
      expect(current.value).toEqual(successor);
      const fresh = await exchange("beads/?limit=10");
      expect(fresh.wire.status).toBe(200);
      expect(fresh.value).toEqual({ items: [originals[0], successor], next: null });
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
      expect(freshSnapshot.value.beads.items).toEqual([originals[0], successor]);
      expect(freshSnapshot.value.erasures).toEqual(erasures);
      const events = await exchange("events/");
      expect(events.wire.status).toBe(200);
      expect(events.wire.bodyText).not.toContain("installed-erasure-secret");
      for (const observation of [
        stale,
        staleSnapshot,
        current,
        fresh,
        receipt,
        replay,
        freshSnapshot,
        events,
      ]) {
        expect(observation.wire.bodyText).not.toContain("installed-erasure-secret");
        expect(observation.wire.headers["bdp-scope-epoch"]).toBe(epoch);
        expect(observation.wire.headers["bdp-authorization-view"]).toBe(view);
        expect(observation.wire.headers["bdp-scope-position"]).toBe("pos-3");
      }
      report = {
        modules,
        baseline,
        ready,
        configuration,
        fixtureSHA256: sha(await readFile(fixtureChild)),
        originals,
        successor,
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
        expect(terminal).toMatchObject({ code: 0, signal: null, overflow: false, forced: false });
      } finally {
        if (evidence)
          await writeFile(
            path.join(evidence, "observation.json"),
            JSON.stringify(
              {
                report,
                terminal,
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
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
  60000,
);
