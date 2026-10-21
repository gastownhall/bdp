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
const entry = process.env.BDP_OWNED_LINK_INSTALLED_ENTRY;
const source = process.env.BDP_OWNED_LINK_SOURCE;
const evidence = process.env.BDP_OWNED_LINK_EVIDENCE;
const fixtureChild = fileURLToPath(
  new URL("../test-support/live-owned-link-installed-child.ts", import.meta.url),
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
  ownedLinks?: Record<string, Row[]>;
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
function sourceLocalEvent(actual: unknown, expected: Record<string, unknown>, sourceUrl: string) {
  expect(actual).toEqual({
    ...expected,
    source: sourceUrl,
    id: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
  });
}
function ownedCorrectionData(
  actual: unknown,
  before: Row,
  after: Row,
  oldLink: Row,
  nextLink: Row,
) {
  expect(actual).toEqual({
    previousRevision: before.revision,
    revision: after.revision,
    ownedLink: {
      operation: "updated",
      link: {
        id: oldLink.id,
        type: oldLink.type,
        previousRevision: oldLink.revision,
        revision: nextLink.revision,
        change: [{ op: "replace", path: "", value: nextLink.properties }],
        metadataChange: [{ op: "replace", path: "", value: nextLink.metadata }],
      },
    },
  });
}
function deletionFraming(actual: unknown, wire: unknown) {
  expect(actual).toMatchObject({
    erasurePruned: true,
    originalEventCount: 4,
    events: [
      { type: "deleted", ordinal: 0 },
      { type: "updated", ordinal: 3 },
    ],
  });
  expect(wire).not.toHaveProperty("erasurePruned");
  expect(wire).not.toHaveProperty("originalEventCount");
}
it("owned installed oracles reject lost siblings, stale inline Links and non-root nested correction", () => {
  const old: Row = {
    id: `${scope}links/l`,
    type: `${scope}types/relationship`,
    revision: "old",
    properties: { secret: "old" },
    metadata: { secret: "old" },
  };
  const next: Row = {
    ...old,
    revision: "next",
    properties: { title: "corrected-Link" },
    metadata: { corrected: true },
  };
  const sibling: Row = {
    ...old,
    id: `${scope}links/sibling`,
    revision: "sibling",
    properties: { healthy: true },
  };
  const before: Row = {
    id: `${scope}beads/a`,
    type: `${scope}types/task`,
    revision: "source-old",
    properties: {},
    metadata: {},
    ownedLinks: { [old.type]: [old, sibling] },
  };
  const after: Row = {
    ...before,
    revision: "source-new",
    ownedLinks: { [old.type]: [next, sibling] },
  };
  const good = {
    previousRevision: before.revision,
    revision: after.revision,
    ownedLink: {
      operation: "updated",
      link: {
        id: old.id,
        type: old.type,
        previousRevision: old.revision,
        revision: next.revision,
        change: [{ op: "replace", path: "", value: next.properties }],
        metadataChange: [{ op: "replace", path: "", value: next.metadata }],
      },
    },
  };
  ownedCorrectionData(good, before, after, old, next);
  completeRow(after, after);
  for (const broken of [
    { ...after, ownedLinks: { [old.type]: [next] } },
    { ...after, ownedLinks: { [old.type]: [old, sibling] } },
  ])
    expect(() => completeRow(broken, after)).toThrow();
  for (const broken of [
    { ...good, change: [{ op: "replace", path: "", value: {} }] },
    { ...good, previousRevision: "wrong" },
    {
      ...good,
      ownedLink: {
        ...good.ownedLink,
        link: {
          ...good.ownedLink.link,
          change: [{ op: "replace", path: "/title", value: "corrected-Link" }],
        },
      },
    },
  ])
    expect(() => ownedCorrectionData(broken, before, after, old, next)).toThrow();
});
it("owned installed gap oracle rejects renumbered source fact and leaked private framing", () => {
  const privateGroup = {
    erasurePruned: true,
    originalEventCount: 4,
    events: [
      { type: "deleted", ordinal: 0 },
      { type: "updated", ordinal: 3 },
    ],
  };
  const wire = { events: [{ type: "deleted" }, { type: "updated" }], eventCount: 2 };
  deletionFraming(privateGroup, wire);
  expect(() =>
    deletionFraming(
      {
        ...privateGroup,
        events: [
          { type: "deleted", ordinal: 0 },
          { type: "updated", ordinal: 1 },
        ],
      },
      wire,
    ),
  ).toThrow();
  expect(() => deletionFraming(privateGroup, { ...wire, originalEventCount: 4 })).toThrow();
  expect(() => deletionFraming(privateGroup, { ...wire, erasurePruned: true })).toThrow();
});

async function binding() {
  if (!entry || !source) throw new Error("explicit installed entry/source required");
  const emitted = process.env.BDP_OWNED_LINK_BUILD ?? path.join(root, "packages/server/dist"),
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
  "packed owned Link correction and tombstone preserve complete source sets, erasure cascade and opaque Event gaps",
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
            properties: { secret: "packed-owned-old-property" },
            metadata: { secret: "packed-owned-old-metadata" },
          },
        ],
      };
      const seeded = await exchange("operations/batch", "POST", create, "owned-seed");
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
        ownedLinks: { [linkType]: [] },
      });
      completeRow(b, {
        id: `${scope}beads/b`,
        type,
        revision: b.revision,
        properties: { healthy: "b" },
        metadata: {},
        ownedLinks: { [linkType]: [] },
      });
      completeRow(old, {
        id: `${scope}links/l`,
        type: linkType,
        revision: old.revision,
        source: a.id,
        target: { uri: b.id, revision: "opaque-pin+ %" },
        properties: { secret: "packed-owned-old-property" },
        metadata: { secret: "packed-owned-old-metadata" },
      });
      const firstSource = await exchange("beads/a");
      expect(firstSource.wire.status).toBe(200);
      const sourceFirst: Row = firstSource.value;
      completeRow(sourceFirst, {
        ...a,
        revision: seeded.value.results[2].sourceRevision,
        ownedLinks: { [linkType]: [old] },
      });
      const addSibling = {
        operations: [
          {
            operation: "createLink",
            id: "links/sibling",
            type: linkType,
            source: "beads/a",
            target: "beads/b",
            properties: { healthy: "sibling" },
            metadata: {},
          },
        ],
      };
      const siblingReceipt = await exchange(
        "operations/batch",
        "POST",
        addSibling,
        "owned-sibling",
      );
      expect(siblingReceipt.wire.status).toBe(200);
      const sibling: Row = siblingReceipt.value.results[0].resource;
      completeRow(sibling, {
        id: `${scope}links/sibling`,
        type: linkType,
        revision: sibling.revision,
        source: a.id,
        target: b.id,
        properties: { healthy: "sibling" },
        metadata: {},
      });
      const priorSource = await exchange("beads/a");
      expect(priorSource.wire.status).toBe(200);
      const sourcePrior: Row = priorSource.value;
      completeRow(sourcePrior, {
        ...a,
        revision: siblingReceipt.value.results[0].sourceRevision,
        ownedLinks: { [linkType]: [old, sibling] },
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
      for (const result of [priorSource, siblingReceipt]) context(result, "pos-2");
      const endpointA = await exchange("beads/a?view=events"),
        endpointB = await exchange("beads/b?view=events");
      expect(endpointA.wire.status).toBe(200);
      expect(endpointB.wire.status).toBe(200);
      const saved = await exchange("snapshot"),
        page = await exchange("beads/?limit=1"),
        first = await exchange("changes/?after=genesis"),
        initial = await exchange("events/");
      for (const result of [saved, page, first, initial]) {
        expect(result.wire.status).toBe(200);
        context(result, "pos-2");
      }
      expect(saved.value.links.items).toEqual([old, sibling]);
      expect(saved.value.beads.items).toEqual([sourcePrior, b]);
      expect(page.value.items).toEqual([sourcePrior]);
      expect(page.value.next).toBeTypeOf("string");
      expect(initial.value.events).toHaveLength(10);
      if (typeof first.value.next !== "string")
        throw Error("authoritative next group page required");
      const tail = await exchange(first.value.next);
      expect(tail.wire.status).toBe(200);
      context(tail, "pos-2");
      expect(tail.value.groups).toHaveLength(1);
      expect(tail.value.groups[0].position).toBe("pos-2");
      const oldCursor = initial.value.events.find(
          (v: { type: string; subject: string }) => v.type === "linked" && v.subject === old.id,
        ).id,
        checkpoint = tail.value.groups[0].checkpoint;
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
      const correctedErasures = [erasure(old), erasure(sourceFirst), erasure(sourcePrior)];
      expect(correction.group.erasures).toHaveLength(3);
      expect(correction.group.erasures).toEqual(expect.arrayContaining(correctedErasures));
      const successor = correction.group.changes.find((v) => v.resource.id === old.id)?.resource;
      const sourceAfter = correction.group.changes.find((v) => v.resource.id === a.id)?.resource;
      if (!successor || !sourceAfter) throw Error("complete Link/source successors required");
      completeRow(successor, {
        ...old,
        revision: successor.revision,
        properties: { title: "corrected-Link" },
        metadata: { corrected: true },
      });
      expect(successor.revision).not.toBe(old.revision);
      completeRow(sourceAfter, {
        ...sourcePrior,
        revision: sourceAfter.revision,
        ownedLinks: { [linkType]: [successor, sibling] },
      });
      expect(sourceAfter.revision).not.toBe(sourcePrior.revision);
      await stream.until(() => stream!.frames.some((f) => f.includes('"position":"pos-3"')));
      const groups = () =>
        stream!.frames
          .filter((f) => f.startsWith("id: "))
          .map((f) => JSON.parse(f.split("\ndata: ")[1]!));
      expect(groups()).toHaveLength(1);
      const correctedGroup = groups()[0];
      expect(correctedGroup).toMatchObject({
        position: "pos-3",
        scopeEpoch: epoch,
        authorizationView: view,
        transaction: correction.group.transaction,
        projectionAdvance: false,
        changes: correction.group.changes,
        erasures: correction.group.erasures,
        eventCount: 2,
        events: [
          { type: "updated", subject: old.id },
          { type: "updated", subject: a.id },
        ],
      });
      correctedData(correctedGroup.events[0].data, old, successor);
      ownedCorrectionData(correctedGroup.events[1].data, sourcePrior, sourceAfter, old, successor);
      expect(correctedGroup).not.toHaveProperty("erasurePruned");
      expect(correctedGroup).not.toHaveProperty("originalEventCount");
      for (const [url, expected] of [
        ["links/l", successor],
        ["beads/a", sourceAfter],
        ["links/sibling", sibling],
        ["beads/b", b],
      ] as const) {
        const got = await exchange(url);
        expect(got.wire.status).toBe(200);
        completeRow(got.value, expected);
        context(got, "pos-3");
      }
      for (const target of [
        page.value.next,
        saved.value.id,
        `changes/?after=${encodeURIComponent(checkpoint)}`,
      ]) {
        const stale = await exchange(target);
        expect(stale.wire.status).toBe(410);
        expect(stale.value.code).toBe("cursor-expired");
        context(stale, "pos-3");
      }
      const beforeLast = await exchange(`events/?after=${encodeURIComponent(oldCursor)}`);
      expect(beforeLast.wire.status).toBe(200);
      expect(beforeLast.value.events.map((v: { type: string }) => v.type)).toEqual([
        "linked",
        "created",
        "linked",
        "linked",
        "updated",
        "updated",
      ]);
      const tombstone = await administer("tombstone-live", successor);
      expect(tombstone).not.toHaveProperty("receipt");
      expect(tombstone.digestAnomalies).toEqual([]);
      const deletedErasures = [erasure(successor), erasure(sourceAfter)];
      expect(tombstone.group.erasures).toHaveLength(2);
      expect(tombstone.group.erasures).toEqual(expect.arrayContaining(deletedErasures));
      const sourceFinal = tombstone.group.changes.find((v) => v.resource.id === a.id)?.resource;
      if (!sourceFinal) throw Error("new complete owning source required");
      completeRow(sourceFinal, {
        ...sourceAfter,
        revision: sourceFinal.revision,
        ownedLinks: { [linkType]: [sibling] },
      });
      expect(sourceFinal.revision).not.toBe(sourceAfter.revision);
      expect(
        tombstone.group.events.map((v) => [v.type, (v as { ordinal?: number }).ordinal]),
      ).toEqual([
        ["deleted", 0],
        ["updated", 3],
      ]);
      expect(tombstone.group).toMatchObject({ erasurePruned: true, originalEventCount: 4 });
      await stream.until(() => stream!.frames.some((f) => f.includes('"position":"pos-4"')));
      expect(groups()).toHaveLength(2);
      const deletedGroup = groups()[1];
      expect(deletedGroup).toMatchObject({
        position: "pos-4",
        scopeEpoch: epoch,
        authorizationView: view,
        transaction: tombstone.group.transaction,
        projectionAdvance: false,
        changes: tombstone.group.changes,
        erasures: tombstone.group.erasures,
        eventCount: 2,
        events: [
          { type: "deleted", subject: old.id },
          { type: "updated", subject: a.id },
        ],
      });
      deletionFraming(tombstone.group, deletedGroup);
      const marker = deletedGroup.changes.find(
        (v: { operation: string }) => v.operation === "tombstone",
      ).resource;
      expect(marker).toEqual({ id: old.id, type: old.type, revision: successor.revision });
      deletedData(deletedGroup.events[0].data, successor);
      expect(deletedGroup.events[1].data).toEqual({
        previousRevision: sourceAfter.revision,
        revision: sourceFinal.revision,
        ownedLink: { operation: "deleted", link: marker },
      });
      for (const group of groups()) {
        expect(group).not.toHaveProperty("erasurePruned");
        expect(group).not.toHaveProperty("originalEventCount");
      }
      const after = await exchange(`events/?after=${encodeURIComponent(oldCursor)}`);
      expect(after.wire.status).toBe(200);
      expect(after.value.events.map((v: { type: string }) => v.type)).toEqual([
        "created",
        "linked",
        "linked",
        "deleted",
        "updated",
      ]);
      expect(after.value.events.slice(-2)).toEqual(deletedGroup.events);
      const allEvents = await exchange("events/");
      expect(allEvents.value.events.map((v: { type: string }) => v.type)).toEqual([
        "created",
        "created",
        "created",
        "linked",
        "linked",
        "deleted",
        "updated",
      ]);
      const sibA = endpointA.value.events.find(
        (v: { type: string; subject: string }) => v.type === "linked" && v.subject === sibling.id,
      );
      const sibB = endpointB.value.events.find(
        (v: { type: string; subject: string }) => v.type === "linked" && v.subject === sibling.id,
      );
      const aEvents = await exchange("beads/a?view=events");
      expect(aEvents.value.events).toHaveLength(3);
      expect(aEvents.value.events.slice(0, 2)).toEqual([endpointA.value.events[0], sibA]);
      sourceLocalEvent(aEvents.value.events[2], deletedGroup.events[1], `${a.id}?view=events`);
      const bEvents = await exchange("beads/b?view=events");
      expect(bEvents.value.events).toEqual([endpointB.value.events[0], sibB]);
      const linkEvents = await exchange("links/l?view=events");
      expect(linkEvents.value.events).toHaveLength(1);
      sourceLocalEvent(linkEvents.value.events[0], deletedGroup.events[0], `${old.id}?view=events`);
      const gone = await exchange("links/l");
      expect(gone.wire.status).toBe(404);
      expect(gone.value.code).toBe("resource-not-found");
      const receipt = await exchange(seeded.value.id),
        replay = await exchange("operations/batch", "POST", create, "owned-seed");
      expect(receipt.value.results).toEqual([
        seeded.value.results[0],
        seeded.value.results[1],
        {
          operationIndex: 2,
          outcome: "erased",
          source: seeded.value.results[2].source,
          sourceRevision: seeded.value.results[2].sourceRevision,
          erased: { id: old.id, type: old.type, revision: old.revision },
        },
      ]);
      expect(replay.value).toEqual(receipt.value);
      const sibReceipt = await exchange(siblingReceipt.value.id),
        sibReplay = await exchange("operations/batch", "POST", addSibling, "owned-sibling");
      expect(sibReceipt.value).toEqual(siblingReceipt.value);
      expect(sibReplay.value).toEqual(siblingReceipt.value);
      const order = (values: unknown[]) =>
        [...values].sort((x, y) => {
          const a = x as { subject: string; revision: string },
            b = y as { subject: string; revision: string };
          return a.subject < b.subject
            ? -1
            : a.subject > b.subject
              ? 1
              : a.revision < b.revision
                ? -1
                : a.revision > b.revision
                  ? 1
                  : 0;
        });
      const expectedLedger = [...order(correctedErasures), ...order(deletedErasures)];
      const fresh = await exchange("snapshot");
      expect(fresh.value.links.items).toEqual([sibling]);
      expect(fresh.value.beads.items).toEqual([sourceFinal, b]);
      expect(fresh.value.erasures).toEqual(expectedLedger);
      const stale2 = await exchange(
        `changes/?after=${encodeURIComponent(correctedGroup.checkpoint)}`,
      );
      expect(stale2.wire.status).toBe(410);
      expect(stale2.value.code).toBe("cursor-expired");
      for (const observation of [
        after,
        allEvents,
        aEvents,
        bEvents,
        linkEvents,
        gone,
        receipt,
        replay,
        sibReceipt,
        sibReplay,
        fresh,
        stale2,
      ]) {
        context(observation, "pos-4");
        expect(observation.wire.bodyText).not.toContain("packed-owned-old-");
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
        reopenedReplay = await exchange("operations/batch", "POST", create, "owned-seed"),
        reopenedGone = await exchange("links/l"),
        reopenedEvents = await exchange(`events/?after=${encodeURIComponent(oldCursor)}`),
        reopenedSource = await exchange("beads/a"),
        reopenedSibling = await exchange("links/sibling");
      expect(reopenedSnapshot.value.beads.items).toEqual([sourceFinal, b]);
      expect(reopenedSnapshot.value.links.items).toEqual([sibling]);
      expect(reopenedSnapshot.value.erasures).toEqual(expectedLedger);
      expect(reopenedReplay.value).toEqual(receipt.value);
      expect(reopenedGone.wire.status).toBe(404);
      expect(reopenedEvents.value.events).toEqual(after.value.events);
      completeRow(reopenedSource.value, sourceFinal);
      completeRow(reopenedSibling.value, sibling);
      for (const observation of [
        reopenedSnapshot,
        reopenedReplay,
        reopenedGone,
        reopenedEvents,
        reopenedSource,
        reopenedSibling,
      ]) {
        context(observation, "pos-4");
        expect(observation.wire.bodyText).not.toContain("packed-owned-old-");
        expect(observation.wire.bodyText).not.toContain("corrected-Link");
      }
      expect(wires.length).toBe(37);
      report = {
        modules,
        configuration,
        baseline,
        reopenedBinding,
        generations,
        old,
        sibling,
        sourceFirst,
        sourcePrior,
        successor,
        sourceAfter,
        sourceFinal,
        correction,
        tombstone,
        sseGroups: groups(),
        expectedLedger,
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
          kind: "packed-installed-owned-Link",
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
