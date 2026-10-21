/** NEW core Read collection observation; not the retained Snapshot endpoint. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect, isDeepStrictEqual } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_COLLECTION_INSTALLED_ENTRY;
const source = process.env.BDP_COLLECTION_SOURCE_COMMIT;
const evidence = process.env.BDP_COLLECTION_EVIDENCE;
const scope = "https://reference.invalid/acme/";
type Row = {
  id: string;
  type: string;
  revision: string;
  properties: { title: string };
  metadata?: Record<string, unknown>;
};
type Page = { items: Row[]; next: string | null };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Expected records come from independently authored setup and mutation receipts. */
function assertRetained(pages: Page[], expected: Row[]) {
  if (pages.length !== expected.length || expected.length !== 3) throw new Error("page population");
  for (const [i, page] of pages.entries()) {
    if (page.items.length !== 1) throw new Error("filter-before-page limit");
    if (i === pages.length - 1 ? page.next !== null : typeof page.next !== "string")
      throw new Error("terminal continuation");
  }
  const rows = pages.flatMap((p) => p.items);
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error("duplicate IDs");
  if (!isDeepStrictEqual(rows, expected)) throw new Error("retained order/records/revisions");
}

it("collection continuation oracle rejects fresh, changed, duplicated, reordered and omitted rows", () => {
  const row = (id: string): Row => ({
    id: `${scope}beads/${id}`,
    type: `${scope}types/task`,
    revision: `old-${id}`,
    properties: { title: "selected" },
  });
  const a = row("a"),
    b = row("b"),
    c = row("c"),
    expected = [a, b, c];
  const pages = (rows: Row[]): Page[] =>
    rows.map((row, i) => ({
      items: [row],
      next: i === rows.length - 1 ? null : `${scope}beads/?opaque=${i}`,
    }));
  expect(() => assertRetained(pages(expected), expected)).not.toThrow();
  for (const changed of [
    [a, c, row("new")],
    [a, { ...b, revision: "new-b" }, c],
    [a, a, c],
    [b, a, c],
    [a, c],
  ])
    expect(() => assertRetained(pages(changed), expected)).toThrow();
});

async function binding() {
  if (!entry || !source) throw new Error("explicit installed entry/source required");
  const emitted = path.join(root, "packages/server/dist"),
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
  const child = spawn(process.execPath, [entry], {
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
  "installed filtered collection continuation retains original rows across real commit",
  async () => {
    const modules = await binding();
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-collection-installed-"));
    const token = randomBytes(32).toString("base64url"),
      type = `${scope}types/task`,
      linkType = `${scope}types/relationship`,
      schema = `${scope}schemas/properties`;
    const configuration = {
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
            source: { conformsTo: [type], external: "opaque" },
            target: { conformsTo: [type], external: "opaque" },
          },
        ].map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
        schemas: [
          {
            retrievalUri: schema,
            utf8: JSON.stringify({
              $id: schema,
              type: "object",
              properties: { title: { type: "string" } },
              additionalProperties: false,
            }),
          },
        ],
      },
    };
    const run = launch(configuration),
      wires: unknown[] = [],
      pages: Page[] = [],
      consumedNext: string[] = [];
    const controller = new AbortController(),
      watchdog = setTimeout(() => controller.abort(), 45000);
    let terminal: unknown, failure: unknown, report: unknown;
    try {
      const ready = await run.ready;
      if (!source) throw new Error("missing source");
      const baseline = installedTransactionBinding(ready, source, {
        bytes: await readFile(
          path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
        ),
      });
      const address = new URL(String(ready.listenUrl));
      async function exchange(
        url: string,
        method: HttpMethod = "GET",
        headers: Record<string, string> = {},
        body?: unknown,
      ) {
        const target = new URL(url);
        if (
          target.origin !== new URL(scope).origin ||
          !target.pathname.startsWith(new URL(scope).pathname) ||
          target.hash ||
          target.username ||
          target.password
        )
          throw new Error("escaped Scope");
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
            headerLines: Object.entries(headers).map(([name, value]) => ({ name, value })),
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
          },
        });
        expect(wire.exactRequest?.writeState).toBe("complete");
        expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
        for (const h of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"]) {
          expect(wire.headers[h]).toBeTypeOf("string");
          expect(wire.headers[h]).not.toBe("");
        }
        wires.push({
          url,
          method,
          headers,
          body,
          status: wire.status,
          responseHeaders: wire.headers,
          bodyText: wire.bodyText,
          wireBase64: Buffer.from(wire.wireResponseBytes ?? []).toString("base64"),
        });
        return wire;
      }
      const probe = await exchange(scope);
      expect(probe.status).toBe(204);
      const description = /^<([^>]+)>; rel="service-desc"; type="application\/json"$/.exec(
        probe.headers.link ?? "",
      );
      if (!description?.[1]) throw new Error("missing description");
      const descriptionUrl = new URL(description[1], scope).href;
      const descriptionWire = await exchange(descriptionUrl);
      expect(descriptionWire.status).toBe(200);
      const discovery = JSON.parse(descriptionWire.bodyText) as {
        beads: string;
        operations: string;
        order?: string;
      };
      expect(discovery.order ?? "canonical-uri").toBe("canonical-uri");
      const operationsUrl = new URL(discovery.operations, descriptionUrl).href;
      const operationsWire = await exchange(operationsUrl);
      expect(operationsWire.status).toBe(200);
      const operations = JSON.parse(operationsWire.bodyText) as { batch: string };
      let key = 0;
      async function mutate(ops: unknown[]) {
        const wire = await exchange(
          new URL(operations.batch, operationsUrl).href,
          "POST",
          { "content-type": "application/json", "idempotency-key": `collection-${key++}` },
          { operations: ops },
        );
        expect(wire.status).toBe(200);
        const receipt = JSON.parse(wire.bodyText) as {
          status: string;
          results: { resource: Row }[];
        };
        expect(receipt.status).toBe("completed");
        expect(receipt.results).toHaveLength(ops.length);
        return receipt.results.map((r) => r.resource);
      }
      const authored = ["a0", "b1", "b2", "b3"].map((id) => ({
        operation: "createBead",
        id: `beads/${id}`,
        type,
        properties: { title: id === "a0" ? "excluded" : "selected" },
      }));
      const seeded = await mutate(authored);
      for (const [i, row] of seeded.entries()) {
        expect(row).toMatchObject({
          id: `${scope}${authored[i]?.id}`,
          type,
          properties: authored[i]?.properties,
        });
        expect(row.revision).toBeTypeOf("string");
      }
      const expected = seeded.slice(1);
      expect(expected.map((r) => r.id)).toEqual(
        ["b1", "b2", "b3"].map((id) => `${scope}beads/${id}`),
      );
      const initialUrl = new URL(discovery.beads, descriptionUrl);
      initialUrl.searchParams.set("type", type);
      initialUrl.searchParams.set("selector", '$[?@.properties.title == "selected"]');
      initialUrl.searchParams.set("limit", "1");
      const first = await exchange(initialUrl.href);
      expect(first.status).toBe(200);
      expect(first.headers["bdp-scope-position"]).toBe("pos-1");
      pages.push(JSON.parse(first.bodyText) as Page);
      expect(pages[0]?.items).toEqual(expected.slice(0, 1));
      const changed = await mutate([
        {
          operation: "updateBead",
          bead: "beads/b2",
          propertiesChange: [{ op: "replace", path: "/title", value: "changed" }],
        },
        { operation: "createBead", id: "beads/b4", type, properties: { title: "selected" } },
      ]);
      let next = pages[0]?.next;
      while (next !== null) {
        if (typeof next !== "string" || pages.length >= 3 || consumedNext.includes(next))
          throw new Error("invalid/looping continuation");
        consumedNext.push(next); // Use the complete captured string, without decoding its opaque cursor.
        const wire = await exchange(next);
        expect(wire.status).toBe(200);
        expect(wire.headers["bdp-scope-position"]).toBe("pos-2");
        expect(wire.headers["bdp-scope-epoch"]).toBe(first.headers["bdp-scope-epoch"]);
        expect(wire.headers["bdp-authorization-view"]).toBe(
          first.headers["bdp-authorization-view"],
        );
        const page = JSON.parse(wire.bodyText) as Page;
        pages.push(page);
        next = page.next;
      }
      assertRetained(pages, expected);
      expect(consumedNext).toHaveLength(2);
      const freshUrl = new URL(initialUrl);
      freshUrl.searchParams.set("limit", "10");
      const freshWire = await exchange(freshUrl.href);
      expect(freshWire.status).toBe(200);
      expect(freshWire.headers["bdp-scope-position"]).toBe("pos-2");
      const fresh = JSON.parse(freshWire.bodyText) as Page;
      expect(fresh.next).toBeNull();
      expect(fresh.items).toEqual([expected[0], expected[2], changed[1]]);
      const current = await exchange(`${scope}beads/b2`);
      expect(current.status).toBe(200);
      expect(JSON.parse(current.bodyText)).toEqual(changed[0]);
      expect(changed[0]?.revision).not.toBe(expected[1]?.revision);
      expect(changed[0]?.properties.title).toBe("changed");
      report = {
        modules,
        baseline,
        ready,
        configuration,
        authored,
        seeded,
        changed,
        pages,
        expected,
        consumedNext,
        fresh,
        originalSourceContext: "pos-1",
        currentServingContext: "pos-2",
        wholeContract: false,
        portableManifestLinked: false,
      };
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      clearTimeout(watchdog);
      try {
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
