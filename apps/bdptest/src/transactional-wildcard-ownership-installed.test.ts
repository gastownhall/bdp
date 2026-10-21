/** Finite packaged wildcard boundary; no runtime/manifest/profile qualification. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const entry = process.env.BDP_WILDCARD_INSTALLED_ENTRY;
const source = process.env.BDP_WILDCARD_SOURCE;
const build = process.env.BDP_WILDCARD_BUILD;
const evidence = process.env.BDP_WILDCARD_EVIDENCE;
const scope = "https://reference.invalid/acme/";
const mixed = `${scope}types/mixed`,
  only = `${scope}types/only`,
  plain = `${scope}types/plain`;
const explicit = `${scope}types/explicit`,
  empty = `${scope}types/empty`;
const wild = `${scope}types/wild`,
  other = `${scope}types/other`;
const schema = `${scope}schemas/n`;
type Row = Record<string, unknown>;
function object(v: unknown): Row {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("wire object required");
  return v as Row;
}
function text(v: unknown): string {
  if (typeof v !== "string" || !v.length) throw new Error("wire identity required");
  return v;
}
function revision(v: unknown): string {
  const value = text(v);
  expect(value).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  return value;
}
const descriptors = [
  {
    id: mixed,
    name: "Mixed",
    describes: "bead",
    conformsTo: [],
    propertiesSchema: schema,
    ownsOutgoing: { "*": { max: 3 }, [explicit]: { max: 1 }, [empty]: { max: 1 } },
  },
  {
    id: only,
    name: "Wildcard only",
    describes: "bead",
    conformsTo: [],
    propertiesSchema: schema,
    ownsOutgoing: { "*": { max: 2 } },
  },
  { id: plain, name: "Plain", describes: "bead", conformsTo: [], propertiesSchema: schema },
  ...[explicit, empty, wild, other].map((id) => ({
    id,
    name: id,
    describes: "link",
    conformsTo: [],
    propertiesSchema: schema,
    source: { conformsTo: [] },
    target: { conformsTo: [] },
  })),
];
const artifacts = {
  descriptors: descriptors.map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
  schemas: [
    {
      retrievalUri: schema,
      utf8: JSON.stringify({
        $id: schema,
        type: "object",
        properties: { n: { type: "integer" } },
        required: ["n"],
        additionalProperties: false,
      }),
    },
  ],
};
const fixtureBytes = Buffer.from(
  JSON.stringify({
    fixtureVersion: 1,
    id: "installed-wildcard-mixed-v1",
    seed: 0,
    capabilities: ["installed-transactional-http", "transactional-receipt-observation"],
    bindings: { batch: `${scope}operations/batch`, subject: `${scope}beads/a` },
    scope,
    artifacts,
  }),
);
function modules() {
  if (!entry || !source || !build)
    throw new Error("paired packaged wildcard entry/source/build required");
  const server = path.dirname(entry),
    protocol = path.resolve(server, "../../protocol");
  const files: { file: string; bytes: number; sha256: string }[] = [];
  // Compare the actual packaged JS/schema closure against this exact fresh build.
  for (const name of ["server", "protocol"]) {
    const dir = name === "server" ? server : path.join(protocol, "dist");
    const manifest = JSON.parse(readFileSync(path.resolve(dir, "../package.json"), "utf8")) as Row;
    expect(manifest.name).toBe(`@bdp/${name}`);
    const expected = name === "server" ? build : path.resolve(build, "../../protocol/dist");
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .sort()) {
      const raw = readFileSync(path.join(dir, file));
      expect(raw.equals(readFileSync(path.join(expected, file))), file).toBe(true);
      files.push({
        file: `${name}/dist/${file}`,
        bytes: raw.length,
        sha256: createHash("sha256").update(raw).digest("hex"),
      });
    }
    if (name === "protocol")
      for (const file of readdirSync(path.join(protocol, "schemas"))
        .filter((f) => f.endsWith(".json"))
        .sort()) {
        const raw = readFileSync(path.join(protocol, "schemas", file));
        expect(
          raw.equals(readFileSync(path.resolve(build, "../../protocol/schemas", file))),
          file,
        ).toBe(true);
        files.push({
          file: `protocol/schemas/${file}`,
          bytes: raw.length,
          sha256: createHash("sha256").update(raw).digest("hex"),
        });
      }
  }
  return { server, protocol, files };
}
function ownedOracle(actual: unknown, expected: Row, links: readonly Row[]) {
  expect(actual).toEqual(expected);
  const owned = object(object(actual).ownedLinks);
  expect(owned).not.toHaveProperty("*");
  const flattened = Object.entries(owned).flatMap(([type, values]) => {
    if (!Array.isArray(values)) throw new Error("owned array required");
    for (const value of values) expect(object(value).type).toBe(type);
    const ids = values.map((v) => text(object(v).id));
    expect(ids).toEqual([...ids].sort());
    return values;
  });
  expect(flattened).toHaveLength(links.length);
  for (const link of links) expect(flattened).toContainEqual(link);
}
it("wildcard oracle rejects literal-star, omitted empty, wrong record/pin/revision and order", () => {
  const link = {
    id: `${scope}links/a`,
    type: wild,
    revision: "l1",
    source: `${scope}beads/a`,
    target: { uri: `${scope}beads/b`, revision: "b1" },
    properties: { n: 1 },
    metadata: {},
  };
  const later = { ...link, id: `${scope}links/z`, revision: "l2" };
  const expected = {
    id: `${scope}beads/a`,
    type: mixed,
    revision: "a1",
    properties: { n: 1 },
    metadata: {},
    ownedLinks: { [explicit]: [], [empty]: [], [wild]: [link, later] },
  };
  ownedOracle(expected, expected, [link, later]);
  const bad = [
    { ...expected, ownedLinks: { ...expected.ownedLinks, "*": [] } },
    { ...expected, ownedLinks: { [wild]: [link, later], [explicit]: [] } },
    { ...expected, revision: "wrong" },
    { ...expected, ownedLinks: { ...expected.ownedLinks, [wild]: [later, link] } },
    ...[
      { type: other },
      { target: `${scope}beads/b` },
      { source: `${scope}beads/b` },
      { revision: "wrong" },
      { properties: { n: 99 } },
    ].map((patch) => ({
      ...expected,
      ownedLinks: { ...expected.ownedLinks, [wild]: [{ ...link, ...patch }, later] },
    })),
  ];
  for (const value of bad) expect(() => ownedOracle(value, expected, [link, later])).toThrow();
});

/** Same inherited IPC bootstrap as transaction-installed-observation; retain all
 * actual channels from spawn through close, including rejected configuration. */
function launch(configuration: unknown) {
  if (!entry) throw new Error("packaged entry required");
  const child = spawn(process.execPath, [entry], {
    cwd: "/tmp",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const stdout = child.stdout,
    stderr = child.stderr;
  if (!stdout || !stderr) {
    child.kill("SIGKILL");
    throw new Error("owned output pipes missing");
  }
  const chunks: [Buffer[], Buffer[]] = [[], []],
    bytes: [number, number] = [0, 0];
  let forced = false;
  for (const [i, stream] of [stdout, stderr].entries())
    stream.on("data", (chunk: Buffer) => {
      const list = chunks[i];
      if (!list) throw new Error("output channel missing");
      list.push(Buffer.from(chunk));
      bytes[i] = (bytes[i] ?? 0) + chunk.length;
      if (bytes[0] + bytes[1] > 65536) {
        forced = true;
        child.kill("SIGKILL");
      }
    });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  const timer = setTimeout(() => {
    forced = true;
    child.kill("SIGKILL");
  }, 15000);
  const ready = new Promise<Row>((resolve, reject) => {
    child.once("message", (value) => {
      try {
        const v = object(value);
        if (v.event !== "qualification.ready") throw new Error("invalid ready");
        resolve(v);
      } catch (e) {
        reject(e);
      }
    });
    void closed.then(() => reject(new Error("installed wildcard exited before ready")), reject);
  });
  child.send({ configuration });
  return {
    child,
    ready,
    async close() {
      if (child.exitCode === null && child.signalCode === null && child.connected)
        child.send({ command: "close" });
      try {
        const terminal = await closed;
        return {
          ...terminal,
          pid: child.pid,
          forced,
          bytes,
          stdout: Buffer.concat(chunks[0]).toString(),
          stderr: Buffer.concat(chunks[1]).toString(),
          stdoutEOF: stdout.readableEnded,
          stderrEOF: stderr.readableEnded,
          reaped: child.exitCode !== null || child.signalCode !== null,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
function failure(e: unknown): unknown {
  return e instanceof AggregateError
    ? { name: e.name, message: e.message, stack: e.stack, errors: [...e.errors].map(failure) }
    : e instanceof Error
      ? {
          name: e.name,
          message: e.message,
          stack: e.stack,
          cause: e.cause === undefined ? undefined : failure(e.cause),
        }
      : e;
}

it.skipIf(!entry)(
  "packaged wildcard-only/mixed descriptors and atomic owned Link lifecycle",
  async () => {
    const issues: unknown[] = [],
      observations: unknown[] = [],
      processes: unknown[] = [];
    let directory: string | undefined, live: ReturnType<typeof launch> | undefined;
    let binding: unknown,
      modulePins: unknown,
      complete = false,
      count = 0;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("wildcard cohort45s deadline")),
      45000,
    );
    try {
      modulePins = modules();
      directory = mkdtempSync(path.join(tmpdir(), "bdp-wildcard-installed-"));
      const token = randomBytes(32).toString("base64url");
      live = launch({
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [{ token, principal: "writer", canMutate: true }],
      });
      const ready = await live.ready;
      binding = installedTransactionBinding(ready, text(source), { bytes: fixtureBytes });
      const address = new URL(text(ready.listenUrl));
      let key = 0;
      const exchange = async (target: string, operations?: unknown[], status = 200) => {
        if (++count > 64) throw new Error("wildcard HTTP request ceiling");
        const url = new URL(target, scope).href,
          method = operations ? ("POST" as const) : ("GET" as const);
        if (!url.startsWith(scope)) throw new Error("escaped Scope");
        const execute = createRawHttpExchangeExecutor(
          { transport: "plain", host: address.hostname, port: Number(address.port) },
          {
            requestTimeoutMs: 3000,
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
        const body = operations ? JSON.stringify({ operations }) : undefined;
        const r = await execute({
          method,
          url,
          signal: controller.signal,
          credentialRef: "writer",
          raw: {
            headerLines: operations
              ? [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: `wild_${key++}` },
                ]
              : [],
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(body) }),
          },
        });
        observations.push({
          target,
          method,
          requestBody: body,
          status: r.status,
          headers: r.headers,
          body: r.bodyText,
          wireResponseBase64: Buffer.from(r.wireResponseBytes ?? []).toString("base64"),
          writeState: r.exactRequest?.writeState,
        });
        expect(r.exactRequest?.writeState).toBe("complete");
        expect(r.wireResponseBytes?.length).toBeGreaterThan(0);
        expect(r.status, r.bodyText).toBe(status);
        expect(r.headers["cache-control"]).toBe("private, no-store");
        for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(text(r.headers[name])).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
        return { r, value: object(JSON.parse(r.bodyText)) };
      };
      const commit = async (operations: unknown[]) => {
        const value = (await exchange("operations/batch", operations)).value;
        expect(value.status).toBe("completed");
        expect(value.detail).toBe("available");
        if (!Array.isArray(value.results)) throw new Error("receipt results required");
        return value;
      };
      const bead = (id: string, type: string) => ({
        operation: "createBead",
        id: `beads/${id}`,
        type,
        properties: { n: 1 },
      });
      const initial = await commit([bead("a", mixed), bead("b", plain), bead("n", only)]);
      const results = initial.results as Row[];
      const a0 = object(object(results[0]).resource),
        b0 = object(object(results[1]).resource),
        n0 = object(object(results[2]).resource);
      for (const v of [a0, b0, n0]) revision(v.revision);
      const expectedA = (rev: unknown, ownedLinks: Row) => ({
        id: `${scope}beads/a`,
        type: mixed,
        revision: revision(rev),
        properties: { n: 1 },
        metadata: {},
        ownedLinks,
      });
      const explicitEmpty = { [explicit]: [], [empty]: [] };
      ownedOracle((await exchange("beads/a")).value, expectedA(a0.revision, explicitEmpty), []);
      expect((await exchange("beads/n")).value).toEqual({
        id: `${scope}beads/n`,
        type: only,
        revision: n0.revision,
        properties: { n: 1 },
        metadata: {},
        ownedLinks: {},
      });
      expect((await exchange("beads/b")).value).toEqual({
        id: `${scope}beads/b`,
        type: plain,
        revision: b0.revision,
        properties: { n: 1 },
        metadata: {},
      });
      for (const d of descriptors.slice(0, 2)) expect((await exchange(d.id)).value).toEqual(d);
      const makeLink = (id: string, type: string) => ({
        operation: "createLink",
        id: `links/${id}`,
        type,
        source: { uri: "beads/a", revision: a0.revision },
        target: { uri: "beads/b", revision: b0.revision },
        properties: { n: 1 },
      });
      const created = await commit([makeLink("z", wild)]);
      const c = object((created.results as Row[])[0]);
      expect(c.source).toBe(`${scope}beads/a`);
      expect(c.sourceRevision).not.toBe(a0.revision);
      const z = {
        id: `${scope}links/z`,
        type: wild,
        revision: revision(object(c.resource).revision),
        source: { uri: `${scope}beads/a`, revision: a0.revision },
        target: { uri: `${scope}beads/b`, revision: b0.revision },
        properties: { n: 1 },
        metadata: {},
      };
      expect((await exchange("links/z")).value).toEqual(z);
      ownedOracle(
        (await exchange("beads/a")).value,
        expectedA(c.sourceRevision, { ...explicitEmpty, [wild]: [z] }),
        [z],
      );
      expect((await exchange("beads/b")).value).toEqual(b0);
      const noOp = await commit([
        {
          operation: "updateLink",
          link: "links/z",
          propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
        },
      ]);
      expect(noOp).not.toHaveProperty("effectPosition");
      expect(noOp.requiredPosition).toBe(created.effectPosition);
      expect((noOp.results as Row[])[0]).toEqual({
        operationIndex: 0,
        outcome: "updated",
        resource: z,
        source: `${scope}beads/a`,
        sourceRevision: c.sourceRevision,
      });
      const updated = await commit([
        {
          operation: "updateLink",
          link: "links/z",
          propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
          metadataChange: [{ op: "add", path: "/note", value: "second" }],
        },
      ]);
      const u = object((updated.results as Row[])[0]),
        z2 = {
          ...z,
          revision: revision(object(u.resource).revision),
          properties: { n: 2 },
          metadata: { note: "second" },
        };
      expect(z2.revision).not.toBe(z.revision);
      expect(u.sourceRevision).not.toBe(c.sourceRevision);
      expect((await exchange("links/z")).value).toEqual(z2);
      ownedOracle(
        (await exchange("beads/a")).value,
        expectedA(u.sourceRevision, { ...explicitEmpty, [wild]: [z2] }),
        [z2],
      );
      expect((await exchange("beads/b")).value).toEqual(b0);
      const eReceipt = await commit([makeLink("e", explicit)]),
        er = object((eReceipt.results as Row[])[0]);
      const e = {
        ...z,
        id: `${scope}links/e`,
        type: explicit,
        revision: revision(object(er.resource).revision),
      };
      const a2 = expectedA(er.sourceRevision, { [explicit]: [e], [empty]: [], [wild]: [z2] });
      const beforeType = (await exchange("beads/a")).value;
      ownedOracle(beforeType, a2, [e, z2]);
      const failedType = (await exchange("operations/batch", [makeLink("e-over", explicit)])).value;
      expect(failedType).toMatchObject({
        status: "failed",
        problem: { code: "validation-failed", status: 422, operationIndex: 0 },
      });
      expect(failedType).not.toHaveProperty("effectPosition");
      expect(failedType.requiredPosition).toBe(eReceipt.effectPosition);
      expect((await exchange("beads/a")).value).toEqual(beforeType);
      expect((await exchange("links/e-over", undefined, 404)).value.code).toBe(
        "resource-not-found",
      );
      const ar = await commit([makeLink("a", wild)]),
        ac = object((ar.results as Row[])[0]);
      const aLink = {
        ...z,
        id: `${scope}links/a`,
        revision: revision(object(ac.resource).revision),
      };
      const full = expectedA(ac.sourceRevision, {
        [explicit]: [e],
        [empty]: [],
        [wild]: [aLink, z2],
      });
      ownedOracle((await exchange("beads/a")).value, full, [e, aLink, z2]);
      const failedTotal = (
        await exchange("operations/batch", [
          {
            operation: "updateLink",
            link: "links/z",
            propertiesChange: [{ op: "replace", path: "/n", value: 99 }],
          },
          makeLink("over", other),
        ])
      ).value;
      expect(failedTotal).toMatchObject({
        status: "failed",
        problem: { code: "validation-failed", status: 422, operationIndex: 1 },
      });
      expect(failedTotal).not.toHaveProperty("effectPosition");
      expect(failedTotal.requiredPosition).toBe(ar.effectPosition);
      expect((await exchange("beads/a")).value).toEqual(full);
      expect((await exchange("links/z")).value).toEqual(z2);
      expect((await exchange("links/over", undefined, 404)).value.code).toBe("resource-not-found");
      expect((await exchange("beads/b")).value).toEqual(b0);
      const deleted = await commit([{ operation: "deleteLink", link: "links/z" }]),
        dr = object((deleted.results as Row[])[0]);
      expect(dr).toEqual({
        operationIndex: 0,
        outcome: "deleted",
        deleted: {
          resourceKind: "link",
          resource: { id: z2.id, type: wild, revision: z2.revision },
        },
        source: `${scope}beads/a`,
        sourceRevision: dr.sourceRevision,
      });
      expect(dr.sourceRevision).not.toBe(ac.sourceRevision);
      ownedOracle(
        (await exchange("beads/a")).value,
        expectedA(dr.sourceRevision, { [explicit]: [e], [empty]: [], [wild]: [aLink] }),
        [e, aLink],
      );
      expect((await exchange("links/z", undefined, 404)).value.code).toBe("resource-not-found");
      const last = await commit([{ operation: "deleteLink", link: "links/a" }]),
        lr = object((last.results as Row[])[0]);
      expect(lr.sourceRevision).not.toBe(dr.sourceRevision);
      ownedOracle(
        (await exchange("beads/a")).value,
        expectedA(lr.sourceRevision, { [explicit]: [e], [empty]: [] }),
        [e],
      );
      expect((await exchange("beads/b")).value).toEqual(b0);
      expect((await exchange("links/e")).value).toEqual(e);
      expect(modules()).toEqual(modulePins);
      complete = true;
    } catch (e) {
      issues.push(e);
    } finally {
      clearTimeout(timer);
      if (live) {
        try {
          const terminal = await live.close();
          processes.push(terminal);
          expect(terminal).toMatchObject({
            code: 0,
            signal: null,
            forced: false,
            stdoutEOF: true,
            stderrEOF: true,
            reaped: true,
          });
        } catch (e) {
          issues.push(e);
        }
      }
      if (directory) {
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch (e) {
          issues.push(e);
        }
      }
    }
    // Evidence I/O cannot bypass independent store removal; combine all causes.
    try {
      if (evidence)
        writeFileSync(
          path.join(evidence, "observation.json"),
          JSON.stringify(
            {
              source,
              entry,
              fixtureSha256: createHash("sha256").update(fixtureBytes).digest("hex"),
              artifacts,
              binding,
              modulePins,
              observations,
              processes,
              complete,
              directoryAbsent: directory === undefined || !existsSync(directory),
              issues: issues.map(failure),
              claimEligible: false,
              wholeContract: false,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
    } catch (e) {
      issues.push(e);
    }
    if (issues.length) throw new AggregateError(issues, "wildcard installed cohort failed");
  },
  50000,
);

it.skipIf(!entry)(
  "packaged descriptor rejects explicit max above wildcard before serving",
  async () => {
    const issues: unknown[] = [];
    let directory: string | undefined, live: ReturnType<typeof launch> | undefined;
    let terminal: unknown,
      parserRefusal = false;
    try {
      const selected = modules();
      const installed = (await import(
        pathToFileURL(path.join(selected.protocol, "dist/index.js")).href
      )) as { parseTypeDescriptor(value: unknown): unknown };
      const invalid = {
        ...descriptors[0],
        ownsOutgoing: { "*": { max: 1 }, [explicit]: { max: 2 } },
      };
      expect(() => installed.parseTypeDescriptor(invalid)).toThrow("exceeds the wildcard max");
      parserRefusal = true;
      directory = mkdtempSync(path.join(tmpdir(), "bdp-wildcard-invalid-"));
      live = launch({
        scope,
        directory,
        create: true,
        artifacts: {
          ...artifacts,
          descriptors: artifacts.descriptors.map((d) =>
            d.retrievalUri === mixed ? { ...d, utf8: JSON.stringify(invalid) } : d,
          ),
        },
        credentials: [{ token: "test-only-refusal-token", principal: "writer", canMutate: true }],
      });
      await expect(live.ready).rejects.toThrow("exited before ready");
      terminal = await live.close();
      live = undefined;
      expect(terminal).toMatchObject({
        code: 2,
        signal: null,
        forced: false,
        stdout: "",
        stderr: "installed transaction qualification failed\n",
        stdoutEOF: true,
        stderrEOF: true,
        reaped: true,
      });
    } catch (e) {
      issues.push(e);
    } finally {
      if (live) {
        try {
          terminal = await live.close();
        } catch (e) {
          issues.push(e);
        }
      }
      if (directory) {
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch (e) {
          issues.push(e);
        }
      }
    }
    try {
      if (evidence)
        writeFileSync(
          path.join(evidence, "descriptor-refusal.json"),
          JSON.stringify(
            {
              source,
              entry,
              parserRefusal,
              terminal,
              directoryAbsent: directory === undefined || !existsSync(directory),
              issues: issues.map(failure),
            },
            null,
            2,
          ),
        );
    } catch (e) {
      issues.push(e);
    }
    if (issues.length) throw new AggregateError(issues, "wildcard descriptor refusal failed");
  },
  20000,
);
