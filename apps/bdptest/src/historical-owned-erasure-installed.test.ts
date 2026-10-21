/** NEW packed owned-Link history, never live-version erasure. */
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
const entry = process.env.BDP_OWNED_ERASURE_ENTRY,
  source = process.env.BDP_OWNED_ERASURE_SOURCE,
  evidence = process.env.BDP_OWNED_ERASURE_EVIDENCE;
const fixtureChild = fileURLToPath(
  new URL("../test-support/historical-owned-erasure-installed-child.ts", import.meta.url),
);
const scope = "https://reference.invalid/acme/";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Resource = {
  id: string;
  type: string;
  revision: string;
  properties: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ownedLinks?: Record<string, Resource[]>;
  links?: unknown;
};
type Erasure = { subject: string; revision: string; digest: { scheme: string; value: string } };
type AdminResult = { group: { position: string; erasures: Erasure[] }; digestAnomalies: unknown[] };
// Independent known-fixture JSON canonicalization; no production digest helper.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
function erasure(resource: Resource): Erasure {
  const { links: _derived, ...version } = resource;
  return {
    subject: resource.id,
    revision: resource.revision,
    digest: { scheme: "sha-256-jcs", value: sha(Buffer.from(canonical(version))) },
  };
}
function records(actual: Erasure[], expected: Erasure[]) {
  const sorted = (rows: Erasure[]) =>
    [...rows].sort((a, b) =>
      `${a.subject} ${a.revision}`.localeCompare(`${b.subject} ${b.revision}`),
    );
  expect(actual).toHaveLength(expected.length);
  expect(sorted(actual)).toEqual(sorted(expected));
}
async function binding() {
  if (!entry || !source) throw new Error("explicit installed entry/source required");
  const emitted = process.env.BDP_OWNED_ERASURE_BUILD ?? path.join(root, "packages/server/dist"),
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
    env: { ...process.env, BDP_OWNED_ERASURE_RUNTIME: path.dirname(entry) },
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
  "packed historical owned-Link cascade preserves current owned set then withholds last-version graph facts",
  async () => {
    const modules = await binding(),
      directory = await mkdtemp(path.join(tmpdir(), "bdp-owned-erasure-installed-"));
    const token = randomBytes(32).toString("base64url"),
      type = `${scope}types/task`,
      linkType = `${scope}types/owned`,
      schema = `${scope}schemas/properties`;
    const configuration = {
      scope,
      directory,
      create: true,
      credentials: [{ token, principal: "writer", canMutate: true }],
      artifacts: {
        descriptors: [
          {
            id: type,
            name: "Task",
            describes: "bead",
            conformsTo: [],
            propertiesSchema: schema,
            ownsOutgoing: { [linkType]: { max: 4 } },
          },
          {
            id: linkType,
            name: "Owned",
            describes: "link",
            conformsTo: [],
            propertiesSchema: schema,
            source: { conformsTo: [type], external: "none" },
            target: { conformsTo: [type], external: "none" },
          },
        ].map((value) => ({ retrievalUri: value.id, utf8: JSON.stringify(value) })),
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
      () => controller.abort(Error("owned installed erasure deadline")),
      45000,
    );
    let stream: ReturnType<typeof recordRawSse> | undefined,
      terminal: unknown,
      failure: unknown,
      report: unknown;
    try {
      const ready = await run.ready;
      if (!source) throw Error("source missing");
      expect(ready.fixture).toBe("installed-historical-owned-administration-only");
      expect(ready.ordinaryDeployment).toBe(false);
      const baseline = installedTransactionBinding(ready, source, {
        bytes: await readFile(
          path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
        ),
      });
      const address = new URL(String(ready.listenUrl));
      async function exchange(
        target: string,
        method: HttpMethod = "GET",
        input?: unknown,
        key?: string,
      ) {
        const url = new URL(target, scope).href,
          parsed = new URL(url);
        if (
          parsed.origin !== new URL(scope).origin ||
          !parsed.pathname.startsWith("/acme/") ||
          parsed.hash ||
          wires.length >= 70
        )
          throw Error("unbound/excess owned erasure request");
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
              input === undefined
                ? []
                : [
                    { name: "Content-Type", value: "application/json" },
                    { name: "Idempotency-Key", value: key! },
                  ],
            ...(input === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(input)) }),
          },
        });
        wires.push({
          method,
          url,
          input,
          key,
          status: wire.status,
          headers: wire.headers,
          bodyText: wire.bodyText,
          wireBase64: Buffer.from(wire.wireResponseBytes ?? []).toString("base64"),
        });
        expect(wire.exactRequest?.writeState).toBe("complete");
        expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
        return { wire, value: wire.bodyText ? JSON.parse(wire.bodyText) : undefined };
      }
      async function mutate(operations: unknown[], key: string) {
        const response = await exchange("operations/batch", "POST", { operations }, key);
        expect(response.wire.status, response.wire.bodyText).toBe(200);
        expect(response.value.status).toBe("completed");
        return response;
      }
      async function resource(target: string) {
        const response = await exchange(target);
        expect(response.wire.status).toBe(200);
        return response.value as Resource;
      }
      async function events(target = "events/") {
        const all: Record<string, unknown>[] = [];
        const seen = new Set<string>();
        let next: string | null = new URL(target, scope).href;
        while (next !== null) {
          if (seen.has(next) || seen.size >= 12) throw Error("Event page bound/loop");
          seen.add(next);
          const response = await exchange(next);
          expect(response.wire.status).toBe(200);
          expect(Array.isArray(response.value.events)).toBe(true);
          all.push(...response.value.events);
          next = response.value.next;
        }
        return all;
      }
      async function erase(revision: string) {
        return await new Promise<AdminResult>((resolve, reject) => {
          const timer = setTimeout(() => {
            run.child.off("message", accept);
            reject(Error("owned administrator reply deadline"));
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
          run.child.send({ command: "erase-historical", subject: `${scope}links/l`, revision });
        });
      }
      const seeded = await mutate(
        ["a", "b"].map((id) => ({
          operation: "createBead",
          id: `beads/${id}`,
          type,
          properties: { title: id },
        })),
        "owned-seed",
      );
      const b = seeded.value.results[1].resource as Resource;
      const epoch = seeded.wire.headers["bdp-scope-epoch"],
        view = seeded.wire.headers["bdp-authorization-view"];
      expect(epoch).toBeTypeOf("string");
      expect(view).toBeTypeOf("string");
      expect(seeded.wire.headers["bdp-scope-position"]).toBe("pos-1");
      const initial = await exchange("changes/?after=genesis");
      expect(initial.wire.status).toBe(200);
      const checkpoint = initial.value.groups[0].checkpoint as string;
      const active = recordRawSse({
        dial: String(ready.listenUrl),
        host: new URL(scope).host,
        target: `/acme/changes/?after=${encodeURIComponent(checkpoint)}`,
        headers: [
          ["Authorization", `Bearer ${token}`],
          ["Accept", "text/event-stream"],
        ],
        signal: controller.signal,
        timeoutMs: 20000,
      });
      stream = active;
      await active.ready;
      expect(active.status).toBe(200);
      const created = await mutate(
        [
          {
            operation: "createLink",
            id: "links/l",
            type: linkType,
            source: "beads/a",
            target: "beads/b",
            properties: { title: "old-owned-secret" },
            metadata: {},
          },
        ],
        "owned-link-create",
      );
      const l1 = created.value.results.find(
        (entry: { resource?: Resource }) => entry.resource?.id === `${scope}links/l`,
      ).resource as Resource;
      const a1 = await resource("beads/a");
      expect(a1.ownedLinks?.[linkType]).toEqual([l1]);
      const updated = await mutate(
        [
          {
            operation: "updateLink",
            link: "links/l",
            propertiesChange: [{ op: "replace", path: "/title", value: "healthy-owned" }],
          },
        ],
        "owned-link-update",
      );
      const l2 = updated.value.results.find(
        (entry: { resource?: Resource }) => entry.resource?.id === l1.id,
      ).resource as Resource;
      expect(l2.revision).not.toBe(l1.revision);
      const a2 = await resource("beads/a");
      expect(a2.ownedLinks?.[linkType]).toEqual([l2]);
      expect(a2.revision).not.toBe(a1.revision);
      await active.until(() => active.frames.some((frame) => frame.includes('"position":"pos-3"')));
      const expectedFirst = [erasure(l1), erasure(a1)];
      const first = await erase(l1.revision);
      records(first.group.erasures, expectedFirst);
      expect(first.digestAnomalies).toEqual([]);
      expect(first.group.position).toBe("pos-4");
      await active.until(() => active.frames.some((frame) => frame.includes('"position":"pos-4"')));
      expect(await resource("beads/a")).toEqual(a2);
      expect(await resource("links/l")).toEqual(l2);
      const afterFirst = await events();
      expect(afterFirst.filter((event) => event.type === "linked")).toHaveLength(2);
      expect(JSON.stringify(afterFirst)).not.toContain("old-owned-secret");
      await mutate([{ operation: "deleteLink", link: "links/l" }], "owned-link-delete");
      const a3 = await resource("beads/a");
      expect(a3.ownedLinks?.[linkType]).toEqual([]);
      expect(a3.revision).not.toBe(a2.revision);
      const beforeLast = await events();
      const nestedDeleted = beforeLast.find(
        (event) =>
          event.type === "updated" &&
          (event.data as { ownedLink?: { operation: string } }).ownedLink?.operation === "deleted",
      );
      const deleted = beforeLast.find(
        (event) => event.type === "deleted" && event.subject === l1.id,
      );
      expect(nestedDeleted).toBeDefined();
      expect(deleted).toBeDefined();
      const endpointBefore = await events("beads/b?view=events");
      const linked = endpointBefore.find((event) => event.type === "linked");
      expect(linked?.id).toBeTypeOf("string");
      await active.until(() => active.frames.some((frame) => frame.includes('"position":"pos-5"')));
      const expectedSecond = [erasure(l2), erasure(a2)];
      const second = await erase(l2.revision);
      records(second.group.erasures, expectedSecond);
      expect(second.digestAnomalies).toEqual([]);
      expect(second.group.position).toBe("pos-6");
      await active.until(() => active.frames.some((frame) => frame.includes('"position":"pos-6"')));
      const finalEvents = await events();
      const expectedFinalEvents = beforeLast.filter(
        (event) => event.type !== "linked" && event.type !== "unlinked",
      );
      expect(expectedFinalEvents).toHaveLength(4);
      expect(finalEvents).toEqual(expectedFinalEvents); // Preserve every unaffected full fact and its order.
      expect(finalEvents).toContainEqual(nestedDeleted);
      expect(finalEvents).toContainEqual(deleted);
      expect(
        finalEvents.filter((event) => event.type === "linked" || event.type === "unlinked"),
      ).toEqual([]);
      expect(JSON.stringify(finalEvents)).not.toContain("old-owned-secret");
      expect(JSON.stringify(finalEvents)).not.toContain("healthy-owned");
      const endpointAfter = await events("beads/b?view=events");
      expect(endpointAfter).toEqual(
        endpointBefore.filter((event) => event.type !== "linked" && event.type !== "unlinked"),
      );
      expect(
        endpointAfter.filter((event) => event.type === "linked" || event.type === "unlinked"),
      ).toEqual([]);
      const exclusiveURL = new URL("beads/b?view=events", scope);
      exclusiveURL.searchParams.set("after", String(linked?.id));
      const exclusive = await events(exclusiveURL.href);
      expect(exclusive).toEqual([]);
      expect(await resource("beads/a")).toEqual(a3);
      expect(await resource("beads/b")).toEqual(b);
      const absent = await exchange("links/l");
      expect(absent.wire.status).toBe(404);
      expect(absent.value.code).toBe("resource-not-found");
      const snapshot = await exchange("snapshot");
      expect(snapshot.wire.status).toBe(200);
      expect(snapshot.value.beads.items).toEqual([a3, b]);
      expect(snapshot.value.links.items).toEqual([]);
      records(snapshot.value.erasures, [...expectedFirst, ...expectedSecond]);
      const receipts = [];
      for (const response of [created, updated]) {
        const current = await exchange(response.value.id);
        expect(current.wire.status).toBe(200);
        expect(current.wire.bodyText).not.toContain("old-owned-secret");
        expect(current.wire.bodyText).not.toContain("healthy-owned");
        const original = response.value.results.find(
          (entry: { resource?: Resource }) => entry.resource?.id === l1.id,
        );
        const { resource: originalResource, outcome: _outcome, ...identity } = original;
        expect(
          current.value.results.find(
            (entry: { erased?: { id: string } }) => entry.erased?.id === l1.id,
          ),
        ).toEqual({
          ...identity,
          outcome: "erased",
          erased: {
            id: originalResource.id,
            type: originalResource.type,
            revision: originalResource.revision,
          },
        });
        receipts.push(current.value);
      }
      const groups = active.frames
        .filter((frame) => frame.startsWith("id: "))
        .map((frame) => {
          const text = frame.split("\ndata: ")[1];
          if (!text) throw Error("missing SSE data");
          return JSON.parse(text);
        });
      expect(groups.map((group) => group.position)).toEqual([
        "pos-2",
        "pos-3",
        "pos-4",
        "pos-5",
        "pos-6",
      ]);
      records(groups[2].erasures, expectedFirst);
      records(groups[4].erasures, expectedSecond);
      for (const group of [groups[2], groups[4]]) {
        expect(group.changes).toEqual([]);
        expect(group.events).toEqual([]);
        expect(group.eventCount).toBe(0);
        expect(group.scopeEpoch).toBe(epoch);
        expect(group.authorizationView).toBe(view);
        expect(group).not.toHaveProperty("erasurePruned");
      }
      // Source-specific negative controls reject missing cascade, wrong digest and wrong revision.
      for (const wrong of [
        expectedFirst.slice(0, 1),
        expectedFirst.map((row, i) =>
          i ? row : { ...row, digest: { ...row.digest, value: "0".repeat(64) } },
        ),
        expectedFirst.map((row, i) => (i ? row : { ...row, revision: "wrong" })),
      ])
        expect(() => records(wrong, expectedFirst)).toThrow();
      report = {
        modules,
        baseline,
        ready,
        configuration,
        l1,
        a1,
        l2,
        a2,
        a3,
        b,
        expectedFirst,
        expectedSecond,
        first,
        second,
        afterFirst,
        beforeLast,
        finalEvents,
        endpointBefore,
        endpointAfter,
        oldCursor: linked?.id,
        exclusive,
        receipts,
        groups,
        snapshot: snapshot.value,
        negativeControls: ["missing-cascade", "wrong-digest", "wrong-revision"],
        privateAdministration: true,
        liveOwnedErasureSupported: false,
        wholeContract: false,
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
