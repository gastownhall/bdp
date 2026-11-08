/** Public HTTP acceptance and explicitly private crash-timing witnesses.
 * Explicit batch1 provisioning; no historical Transactional suite.
 * Crash cases require pnpm build and use that same emitted build for recovery.
 * Process death preserves OS caches: no fsync, power-loss or media-failure proof.
 */
import { fork, type ChildProcess } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJsonSchemaValidator } from "@bdp/conformance";
import { afterEach, describe, expect, it } from "vitest";
import {
  referenceNavigation,
  startReferenceService,
} from "../../../packages/server/src/reference.js";

const media = "application/vnd.bdp.v0.1+json",
  capability = "https://github.com/gastownhall/bdp/capabilities/atomic-batch";
const scope = "https://records.invalid/atomic/",
  token = "x".repeat(32);
const type = { uri: "https://types.invalid/Record", revision: "definition-exact" };
const validate = createJsonSchemaValidator(
  JSON.parse(
    readFileSync(
      new URL("../../../specs/profiles/core/bdp-v0.1.schema.json", import.meta.url),
      "utf8",
    ),
  ),
);
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse())
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  if (errors.length) throw new AggregateError(errors, "atomic public cleanup");
});
async function fixture(atomicBatch = true) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-public-batch-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    directory,
    create: true,
    instance: "independent-batch-wire",
    scope,
    credentials: [{ token, principal: "actor" }],
    atomicBatch,
  };
  const service = await startReferenceService(config);
  cleanups.push(() => service.close());
  return { service, config };
}
function wire(listen: string, target: string, body?: string, key?: string, accept = media) {
  return new Promise<{
    status: number;
    text: string;
    headers: import("node:http").IncomingHttpHeaders;
  }>((resolve, reject) => {
    const socket = new URL(listen),
      url = new URL(target);
    const req = request(
      {
        hostname: socket.hostname,
        port: socket.port,
        path: url.pathname + url.search,
        method: body === undefined ? "GET" : "POST",
        headers: {
          host: url.host,
          authorization: `Bearer ${token}`,
          accept,
          ...(body === undefined
            ? {}
            : {
                "content-type": media,
                "content-length": String(Buffer.byteLength(body)),
                ...(key === undefined ? {} : { "idempotency-key": key }),
              }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            text: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("bounded batch HTTP timeout")));
    req.end(body);
  });
}
// Same emitted private-process IPC barrier and supervision as the retained CRUD
// witnesses. This selects the existing reference composition; IPC remains
// explicitly claimEligible:false and is not public startup/profile admission.
async function terminateBatchChild(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error("private batch child not reaped"));
    }, 4000);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      child.removeListener("exit", exited);
    };
    const exited = () => {
      cleanup();
      resolve();
    };
    child.once("exit", exited);
    child.kill(signal);
  });
}
async function crashChild(
  config: Awaited<ReturnType<typeof fixture>>["config"],
  barrier: "resource-staged" | "committed",
) {
  const child = fork(
    fileURLToPath(
      new URL("../../../packages/server/dist/retained-v01/private-process.js", import.meta.url),
    ),
    [],
    { execPath: process.execPath, silent: true },
  );
  cleanups.push(() => terminateBatchChild(child, "SIGKILL"));
  let stdout = "",
    stderr = "";
  child.stdout!.on("data", (data: Buffer) => {
    stdout += data.toString();
  });
  child.stderr!.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  function waitFor<T>(event: "ready" | "phase", inspect: (message?: unknown) => T | undefined) {
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        child.removeListener("message", observe);
        child.stdout!.removeListener("data", output);
        child.removeListener("exit", exited);
        child.removeListener("error", failed);
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const exited = () =>
        failed(new Error(`private batch child exited before ${event}; stderr=${stderr}`));
      const observe = (message?: unknown) => {
        const value = inspect(message);
        if (value !== undefined) {
          cleanup();
          resolve(value);
        }
      };
      const output = () => observe();
      const timer = setTimeout(
        () => failed(new Error(`private batch ${event} timeout; stderr=${stderr}`)),
        5000,
      );
      child.on("message", observe);
      child.stdout!.on("data", output);
      child.once("exit", exited);
      child.once("error", failed);
      observe();
    });
  }
  const ready = waitFor("ready", (message) => {
    const value = message as
      | { kind?: string; listenUrl?: string; claimEligible?: boolean }
      | undefined;
    return value?.kind === "ready" &&
      value.claimEligible === false &&
      typeof value.listenUrl === "string"
      ? value.listenUrl
      : undefined;
  });
  const { scope: _scope, ...options } = config;
  child.send({ ...options, navigation: referenceNavigation(scope), referenceCore: true, barrier });
  return {
    child,
    listenUrl: await ready,
    phase: () =>
      waitFor("phase", () => (stdout.includes(`"phase":"${barrier}"`) ? barrier : undefined)),
  };
}
function batchSnapshot(directory: string) {
  const db = new DatabaseSync(path.join(directory, "retained-reference.sqlite"), {
    readOnly: true,
  });
  try {
    return {
      metadata: db.prepare("SELECT * FROM metadata ORDER BY name").all(),
      identities: db.prepare("SELECT * FROM identities ORDER BY id").all(),
      resources: db.prepare("SELECT * FROM resources ORDER BY id").all(),
      aliases: db.prepare("SELECT * FROM aliases ORDER BY locator").all(),
      events: db.prepare("SELECT * FROM events ORDER BY position").all(),
      incidence: db.prepare("SELECT * FROM incidence ORDER BY position,bead").all(),
      boundaries: db.prepare("SELECT * FROM boundaries ORDER BY position").all(),
      outcomes: db.prepare("SELECT * FROM outcomes ORDER BY decision").all(),
      decisionFacts: db.prepare("SELECT * FROM decision_facts ORDER BY decision,position").all(),
      cursors: db.prepare("SELECT * FROM cursors ORDER BY token").all(),
    };
  } finally {
    db.close();
  }
}

const body = (operations: unknown[]) => JSON.stringify({ capabilityVersion: "1", operations });
async function operation(service: Awaited<ReturnType<typeof startReferenceService>>) {
  const discovery = await wire(service.listenUrl, service.navigation.description);
  expect(discovery.status).toBe(200);
  const document = JSON.parse(discovery.text);
  expect(document.capabilities[capability]["1"].operations).toEqual([
    "createBead",
    "updateBead",
    "deleteBead",
    "createLink",
    "updateLink",
    "deleteLink",
  ]);
  expect(document).not.toHaveProperty("events");
  // Core fixes the target at bdp/operations/atomicBatch; the detail names no URL.
  expect(document.capabilities[capability]["1"]).not.toHaveProperty("operation");
  return scope + "bdp/operations/atomicBatch";
}
function schemaResult(text: string) {
  const value = JSON.parse(text);
  expect(validate.validate("#/$defs/atomicBatchResult", value)).toEqual([]);
  return value;
}

describe("selected atomic batch1 public reference wire", () => {
  it("derives batch discovery from opened mode and refuses format5 batch without claiming its key", async () => {
    const { service, config } = await fixture(false);
    const discovery = JSON.parse(
      (await wire(service.listenUrl, service.navigation.description)).text,
    );
    expect(discovery.capabilities?.[capability]).toBeUndefined();
    const refused = await wire(
      service.listenUrl,
      scope + "bdp/operations/atomicBatch",
      body([{ operation: "createBead", id: "must-not-exist", type }]),
      "unclaimed",
    );
    // Unadvertised, the fixed route is not served: a POST to it answers as one to any
    // absent path does, Core's bodyless 405, and claims no key.
    expect(refused.status).toBe(405);
    expect(refused.text).toBe("");
    expect((await wire(service.listenUrl, scope + "must-not-exist")).status).toBe(404);
    expect(
      (
        await wire(
          service.listenUrl,
          service.navigation.targets.createBead,
          JSON.stringify({ id: "ordinary", type }),
          "unclaimed",
        )
      ).status,
    ).toBe(200);
    await service.close();
    const reopened = await startReferenceService({ ...config, create: false });
    cleanups.push(() => reopened.close());
    const again = JSON.parse(
      (await wire(reopened.listenUrl, reopened.navigation.description)).text,
    );
    expect(again.capabilities?.[capability]).toBeUndefined();
  });
  it("uses all six CRUD kinds through the advertised target, preserves pins, and reopens exact outcomes", async () => {
    const { service, config } = await fixture(),
      target = await operation(service);
    const input = body([
      { operation: "createBead", id: "z-node", type, name: "node", properties: { initial: true } },
      {
        operation: "createLink",
        id: "a-edge",
        type,
        name: "edge",
        source: { uri: "@node", revision: "literal-pin" },
        target: "urn:external:one",
      },
      { operation: "updateBead", bead: "@node", metadata: { updated: true } },
      {
        operation: "updateLink",
        link: "@edge",
        target: { uri: "urn:external:two", revision: "external-pin" },
      },
    ]);
    const first = await wire(service.listenUrl, target, input, "six-create-update");
    expect(first.status).toBe(200);
    const result = schemaResult(first.text);
    expect(result.resources.map((row: { id: string }) => row.id)).toEqual([
      scope + "a-edge",
      scope + "z-node",
    ]);
    expect(result.resources[0].resource).toMatchObject({
      type,
      source: { uri: scope + "z-node", revision: "literal-pin" },
      target: { uri: "urn:external:two", revision: "external-pin" },
      metadata: {},
    });
    const deletion = body([
      { operation: "deleteLink", link: "a-edge" },
      { operation: "deleteBead", bead: "z-node" },
    ]);
    const removed = await wire(service.listenUrl, target, deletion, "six-delete");
    expect(removed.status).toBe(200);
    expect(
      schemaResult(removed.text).resources.map((row: { outcome: string }) => row.outcome),
    ).toEqual(["deleted", "deleted"]);
    await service.close();
    const reopened = await startReferenceService({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect((await wire(reopened.listenUrl, target, input, "six-create-update")).text).toBe(
      first.text,
    );
    expect((await wire(reopened.listenUrl, target, deletion, "six-delete")).text).toBe(
      removed.text,
    );
    expect((await wire(reopened.listenUrl, scope + "z-node")).status).toBe(404);
  });
  it("does not claim a key for unsupported versions and never exposes a valid member prefix", async () => {
    const { service } = await fixture(),
      target = await operation(service);
    const unsupported = await wire(
      service.listenUrl,
      target,
      '{"capabilityVersion":"future","futureBody":[null]}',
      "free-key",
    );
    expect(unsupported.status).toBe(422);
    expect(JSON.parse(unsupported.text)).toMatchObject({
      capability,
      capabilityVersion: "future",
      pointer: "/capabilityVersion",
      code: "capability-not-supported",
    });
    const refused = await wire(
      service.listenUrl,
      target,
      body([
        { operation: "createBead", id: "no-prefix", type },
        { operation: "deleteBead", bead: "absent" },
      ]),
      "free-key",
    );
    expect(refused.status).toBe(404);
    expect((await wire(service.listenUrl, scope + "no-prefix")).status).toBe(404);
    const creation = await wire(
      service.listenUrl,
      service.navigation.targets.createBead,
      JSON.stringify({ id: "no-prefix", type }),
      "fresh-identity",
    );
    expect(creation.status).toBe(200);
    expect(
      (
        await wire(
          service.listenUrl,
          target,
          body([{ operation: "createBead", id: "no-prefix", type }]),
          "free-key",
        )
      ).status,
    ).toBe(409);
  });
  it("rejects malformed handles and keeps singleton and batch keys in one namespace", async () => {
    const { service } = await fixture(),
      target = await operation(service);
    const bad = await wire(
      service.listenUrl,
      target,
      body([{ operation: "createLink", type, source: "@future", target: "urn:opaque:x" }]),
      "same-key",
    );
    expect(bad.status).toBe(400);
    const singleton = await wire(
      service.listenUrl,
      service.navigation.targets.createBead,
      JSON.stringify({ id: "node", type }),
      "same-key",
    );
    expect(singleton.status).toBe(200);
    const conflict = await wire(
      service.listenUrl,
      target,
      body([{ operation: "updateBead", bead: "node", properties: {} }]),
      "same-key",
    );
    expect(conflict.status).toBe(409);
    expect(JSON.parse(conflict.text).code).toBe("idempotency-conflict");
  });
});

describe("private-process atomic batch1 crash timing witness over the reference composition", () => {
  it.each(["resource-staged", "committed"] as const)(
    "SIGKILL at %s preserves whole custody and exact original-key replay",
    async (phase) => {
      // Do not mix a stale compiled crash child with source-based recovery.
      // The ordinary pipeline builds before these installed-process witnesses;
      // file timestamps would not prove full transitive source/build custody.
      const startRecoveryService: typeof startReferenceService = (
        await import(new URL("../../../packages/server/dist/reference.js", import.meta.url).href)
      ).startReferenceService;
      const directory = mkdtempSync(path.join(tmpdir(), "bdp-atomic-crash-"));
      cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
      const config = {
        directory,
        create: true,
        instance: "atomic-crash-witness",
        scope,
        credentials: [{ token, principal: "actor" }],
        atomicBatch: true,
      };
      const input = body([
        { operation: "createBead", name: "left", type, properties: { side: "left" } },
        { operation: "createBead", name: "right", type, properties: { side: "right" } },
        { operation: "createLink", name: "edge", type, source: "@left", target: "@right" },
      ]);
      const first = await crashChild(config, phase);
      const discovery = await wire(first.listenUrl, referenceNavigation(scope).description);
      expect(discovery.status).toBe(200);
      expect(discovery.headers["x-bdp-private-fixture"]).toBeUndefined();
      const detail = JSON.parse(discovery.text).capabilities[capability]["1"];
      expect(detail).not.toHaveProperty("operation");
      const target = scope + "bdp/operations/atomicBatch";
      const database = path.join(directory, "retained-reference.sqlite");
      const imageBeforeRequest = readFileSync(database);
      const pending = wire(first.listenUrl, target, input, "lost-whole-batch").then(
        (response) => ({ kind: "response" as const, response }),
        (error: unknown) => ({ kind: "transport-failure" as const, error }),
      );
      expect(await first.phase()).toBe(phase);
      expect(first.child.exitCode).toBeNull();
      expect(first.child.signalCode).toBeNull();
      await terminateBatchChild(first.child, "SIGKILL");
      expect(first.child.exitCode).toBeNull();
      expect(first.child.signalCode).toBe("SIGKILL");
      expect(readFileSync(database).equals(imageBeforeRequest)).toBe(phase !== "committed");
      expect(readFileSync(`${database}-journal`).subarray(0, 8)).toEqual(Buffer.alloc(8));
      // This first-row staged request never spills pages into the main file;
      // it proves no durable partial group, not hot-journal rollback playback.
      // The killed request delivered no status/outcome. Recovered facts below,
      // not a fabricated caller result, establish what actually committed.
      expect(await pending).toMatchObject({
        kind: "transport-failure",
        error: { code: "ECONNRESET" },
      });

      // Let the real reference owner perform SQLite and semantic recovery BEFORE
      // opening any independent SQL observer, which could itself recover a hot journal.
      const recovered = await startRecoveryService({ ...config, create: false });
      cleanups.push(() => recovered.close());
      expect(await operation(recovered)).toBe(target);
      const beads = await wire(recovered.listenUrl, recovered.navigation.beads);
      const links = await wire(recovered.listenUrl, recovered.navigation.links);
      expect(beads.status).toBe(200);
      expect(links.status).toBe(200);
      expect(JSON.parse(beads.text).items).toHaveLength(phase === "committed" ? 2 : 0);
      expect(JSON.parse(links.text).items).toHaveLength(phase === "committed" ? 1 : 0);
      await recovered.close();
      const before = batchSnapshot(directory);
      const count = phase === "committed" ? 3 : 0;
      expect(before.identities).toHaveLength(count);
      expect(before.resources).toHaveLength(count);
      expect(before.events).toHaveLength(count);
      expect(before.incidence).toHaveLength(phase === "committed" ? 2 : 0);
      expect(before.boundaries).toHaveLength(count + 1);
      expect(before.outcomes).toHaveLength(phase === "committed" ? 1 : 0);
      expect(before.decisionFacts).toHaveLength(count);
      expect(before.aliases).toHaveLength(0);
      expect(before.cursors).toHaveLength(0);
      const capture = JSON.parse(
        String(before.metadata.find((row) => row.name === "capture")!.value),
      );
      expect(capture.format).toBe("bdp-private-retained-v01-6");
      expect(capture.atomicBatch.capabilityVersion).toBe("1");
      expect(capture).not.toHaveProperty("historicalUpdate");
      expect(before.metadata.find((row) => row.name === "decisions")!.value).toBe(
        phase === "committed" ? "1" : "0",
      );
      if (phase === "committed") {
        expect(before.outcomes[0]).toMatchObject({
          principal: "actor",
          key: "lost-whole-batch",
          operation: "batch",
          status: 200,
          decision: 1,
          event_position: 1,
        });
        expect(before.boundaries.map((row) => row.position)).toEqual([0, 1, 2, 3]);
        expect(before.decisionFacts.map((row) => row.position)).toEqual([1, 2, 3]);
        expect(before.decisionFacts.map((row) => row.decision)).toEqual([1, 1, 1]);
        expect(before.events.map((row) => JSON.parse(String(row.body)).transaction)).toEqual([
          JSON.parse(String(before.outcomes[0]!.body)).transaction,
          JSON.parse(String(before.outcomes[0]!.body)).transaction,
          JSON.parse(String(before.outcomes[0]!.body)).transaction,
        ]);
      }

      const service = await startRecoveryService({ ...config, create: false });
      cleanups.push(() => service.close());
      const replay = await wire(service.listenUrl, target, input, "lost-whole-batch");
      expect(replay.status).toBe(200);
      if (phase === "committed") expect(replay.text).toBe(before.outcomes[0]!.body);
      const result = schemaResult(replay.text);
      expect(result.changed).toBe(true);
      expect(result.results.map((row: { operationIndex: number }) => row.operationIndex)).toEqual([
        0, 1, 2,
      ]);
      expect(result.results.map((row: { operationName?: string }) => row.operationName)).toEqual([
        "left",
        "right",
        "edge",
      ]);
      const ids = result.results.map((row: { id: string }) => row.id) as string[];
      expect(new Set(ids).size).toBe(3);
      expect(result.resources).toHaveLength(3);
      expect(result.resources.map((row: { id: string }) => row.id).sort()).toEqual([...ids].sort());
      for (const row of result.resources) {
        expect(row.outcome).toBe("created");
        expect(row.changed).toBe(true);
        const current = await wire(service.listenUrl, row.id);
        expect(current.status).toBe(200);
        expect(JSON.parse(current.text)).toEqual(row.resource);
      }
      const [left, right, edge] = ids;
      const link = result.resources.find((row: { id: string }) => row.id === edge).resource;
      expect(link).toMatchObject({ source: left, target: right });
      for (const [bead, direction] of [
        [left, "outbound"],
        [right, "inbound"],
      ]) {
        const incident = await wire(service.listenUrl, `${bead}?view=links&direction=${direction}`);
        expect(incident.status).toBe(200);
        expect(JSON.parse(incident.text).items.map((row: { id: string }) => row.id)).toEqual([
          edge,
        ]);
      }
      expect((await wire(service.listenUrl, target, input, "lost-whole-batch")).text).toBe(
        replay.text,
      );
      // A changed current postimage must not replace the saved batch result.
      const changed = await wire(
        service.listenUrl,
        service.navigation.targets.updateBead,
        JSON.stringify({ bead: left, metadata: { later: true } }),
        "later-independent-update",
      );
      expect(changed.status).toBe(200);
      expect((await wire(service.listenUrl, target, input, "lost-whole-batch")).text).toBe(
        replay.text,
      );
      await service.close();
      const after = batchSnapshot(directory);
      expect(after.identities).toHaveLength(3);
      expect(after.resources).toHaveLength(3);
      expect(after.events).toHaveLength(4);
      expect(after.incidence).toHaveLength(2);
      expect(after.boundaries).toHaveLength(5);
      expect(after.aliases).toHaveLength(0);
      expect(after.cursors).toHaveLength(0);
      expect(after.outcomes).toHaveLength(2);
      expect(after.decisionFacts).toHaveLength(4);
      expect(after.decisionFacts.map((row) => row.decision)).toEqual([1, 1, 1, 2]);
      expect(after.decisionFacts.map((row) => row.position)).toEqual([1, 2, 3, 4]);
      expect(after.boundaries.map((row) => row.position)).toEqual([0, 1, 2, 3, 4]);
      expect(after.identities).toEqual(
        result.resources
          .map((row: { id: string; resourceKind: string }) => ({
            id: row.id,
            kind: row.resourceKind,
          }))
          .sort((a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      );
      const linkFact = after.events.find(
        (row) => JSON.parse(String(row.body)).effect.operation === "createLink",
      )!;
      expect(after.incidence).toEqual(
        [left!, right!].sort().map((bead) => ({ position: linkFact.position, bead })),
      );
      expect(new Set(after.events.map((row) => JSON.parse(String(row.body)).id)).size).toBe(4);
      expect(
        after.events.slice(0, 3).map((row) => JSON.parse(String(row.body)).transaction),
      ).toEqual([result.transaction, result.transaction, result.transaction]);
      expect(after.outcomes[0]!.body).toBe(replay.text);
      expect(after.outcomes[0]!.key).toBe("lost-whole-batch");
      expect(after.metadata.find((row) => row.name === "decisions")!.value).toBe("2");
      const last = await startRecoveryService({ ...config, create: false });
      cleanups.push(() => last.close());
      expect((await wire(last.listenUrl, target, input, "lost-whole-batch")).text).toBe(
        replay.text,
      );
      expect(JSON.parse((await wire(last.listenUrl, left!)).text).metadata).toEqual({
        later: true,
      });
      await last.close();
      expect(batchSnapshot(directory)).toEqual(after);
    },
    20000,
  );
});
