/** Two new core Read receiving-boundary observations, using exact packed runtime. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_READ_LITERALS_ENTRY;
const source = process.env.BDP_READ_LITERALS_SOURCE;
const evidence = process.env.BDP_READ_LITERALS_EVIDENCE;
const scope = "https://reference.invalid/acme/";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function binding() {
  if (!entry || !source) throw new Error("explicit installed entry/source required");
  const emitted = process.env.BDP_READ_LITERALS_BUILD ?? path.join(root, "packages/server/dist"),
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

async function observe(kind: "selector" | "fragment") {
  const modules = await binding();
  const directory = await mkdtemp(path.join(tmpdir(), `bdp-read-${kind}-installed-`));
  const token = randomBytes(32).toString("base64url");
  const type = `${scope}types/task`,
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
    wires: unknown[] = [];
  const controller = new AbortController();
  const watchdog = setTimeout(
    () => controller.abort(Error("installed read literals deadline")),
    45000,
  );
  let terminal: unknown, failure: unknown, report: unknown;
  try {
    const ready = await run.ready;
    if (!source) throw Error("missing source");
    const baseline = installedTransactionBinding(ready, source, {
      bytes: await readFile(
        path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
      ),
    });
    const address = new URL(String(ready.listenUrl));
    async function exchange(
      suffix: string,
      method: HttpMethod = "GET",
      body?: unknown,
      rawTarget?: string,
    ) {
      const url = new URL(suffix, scope).href;
      const parsed = new URL(url);
      if (
        parsed.origin !== new URL(scope).origin ||
        !parsed.pathname.startsWith("/acme/") ||
        parsed.hash ||
        wires.length >= 10
      )
        throw Error("unbound request");
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
        ...(rawTarget === undefined ? {} : { rawRequestTarget: Buffer.from(rawTarget, "ascii") }),
        raw: {
          headerLines:
            body === undefined
              ? []
              : [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: `read-${kind}-${wires.length}` },
                ],
          ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
        },
      });
      wires.push({
        method,
        url,
        rawTarget: rawTarget ?? null,
        requestBody: body,
        exactRequest: wire.exactRequest,
        status: wire.status,
        headers: wire.headers,
        bodyText: wire.bodyText,
        wireBase64: Buffer.from(wire.wireResponseBytes ?? []).toString("base64"),
      });
      expect(wire.exactRequest?.writeState).toBe("complete");
      expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
      return wire;
    }
    const seeded = await exchange("operations/batch", "POST", {
      operations: [
        { operation: "createBead", id: "beads/a", type, properties: { title: "first" } },
        { operation: "createBead", id: "beads/b", type, properties: { title: "second" } },
      ],
    });
    expect(seeded.status).toBe(200);
    const receipt = JSON.parse(seeded.bodyText) as {
      status: string;
      results: { resource: Record<string, unknown> }[];
    };
    expect(receipt.status).toBe("completed");
    expect(receipt.results).toHaveLength(2);
    const expected = receipt.results.map((r) => r.resource);
    expect(expected.map((r) => r.id)).toEqual([`${scope}beads/a`, `${scope}beads/b`]);
    const context = Object.fromEntries(
      ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"].map((key) => {
        expect(seeded.headers[key]).toBeTypeOf("string");
        expect(seeded.headers[key]).not.toBe("");
        return [key, seeded.headers[key]];
      }),
    );
    expect(context["bdp-scope-position"]).toBe("pos-1");
    function current(wire: Awaited<ReturnType<typeof exchange>>) {
      for (const [key, value] of Object.entries(context)) expect(wire.headers[key]).toBe(value);
    }
    if (kind === "selector") {
      const select = async (literal: string) => {
        const url = new URL("beads/", scope);
        url.searchParams.set("selector", `$[?@.id == ${JSON.stringify(literal)}]`);
        const wire = await exchange(url.href);
        expect(wire.status).toBe(200);
        current(wire);
        return JSON.parse(wire.bodyText) as { items: unknown[]; next: null };
      };
      const absolute = await select(`${scope}beads/a`);
      expect(absolute).toEqual({ items: [expected[0]], next: null });
      const local = await select("beads/a");
      expect(local).toEqual({ items: [], next: null });
      const untouched = await exchange("beads/a");
      expect(untouched.status).toBe(200);
      current(untouched);
      expect(JSON.parse(untouched.bodyText)).toEqual(expected[0]);
      report = {
        modules,
        baseline,
        ready,
        configuration,
        expected,
        absolute,
        local,
        context,
        oracle:
          "literal canonical absolute ID equality; local-looking string is not reference-resolved",
        wholeContract: false,
        portableManifestLinked: false,
      };
    } else {
      const put = await exchange("operations/put-alias", "POST", {
        alias: "alias/work",
        target: "beads/a",
      });
      expect(put.status).toBe(200);
      current(put);
      const normal = await exchange("alias/work");
      expect(normal.status).toBe(307);
      current(normal);
      expect(normal.headers.location).toBe(`${scope}beads/a`);
      expect(normal.bodyText).toBe("");
      const missing = await exchange("alias/missing");
      expect(missing.status).toBe(404);
      const unknown = JSON.parse(missing.bodyText) as Record<string, unknown>;
      expect(unknown).toMatchObject({ status: 404, code: "resource-not-found" });
      // Semantic audience stays canonical; only exact request-line bytes carry #.
      // Never use URL.hash, which HTTP URL serialization would omit.
      const fragment = await exchange("alias/work", "GET", undefined, "/acme/alias/work#opaque");
      report = {
        modules,
        baseline,
        ready,
        configuration,
        expected,
        context,
        rawTarget: "/acme/alias/work#opaque",
        receivingBoundary: "exact raw request target, existing conformance executor",
        wholeContract: false,
        portableManifestLinked: false,
      };
      expect(fragment.status, fragment.bodyText).toBe(404);
      expect(JSON.parse(fragment.bodyText)).toEqual(unknown);
      for (const name of [
        "location",
        "etag",
        "retry-after",
        "bdp-scope-epoch",
        "bdp-authorization-view",
        "bdp-scope-position",
      ])
        expect(fragment.headers[name]).toBeUndefined();
      expect(fragment.bodyText).not.toContain(`${scope}beads/a`);
      expect(fragment.bodyText).not.toContain("opaque");
      const healthy = await exchange("alias/work");
      expect(healthy.status).toBe(307);
      current(healthy);
      expect(healthy.headers.location).toBe(`${scope}beads/a`);
    }
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
          path.join(evidence, `${kind}-observation.json`),
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
}
it.skipIf(!entry)(
  "installed core Read Selector ID comparison uses literal absolute equality",
  () => observe("selector"),
  60000,
);
it.skipIf(!entry)(
  "installed alias fragment receiving boundary returns nonobserving 404",
  () => observe("fragment"),
  60000,
);
