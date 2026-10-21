/** Opt-in NEW packed S1 observations. Foreign/unknown precedence is not selected. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import type { ClockAdvance } from "../test-support/snapshot-clock-child.js";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_SNAPSHOT_PACKED_ENTRY;
const source = process.env.BDP_SNAPSHOT_PACKED_SOURCE;
const evidence = process.env.BDP_SNAPSHOT_PACKED_EVIDENCE;
const scope = "https://reference.invalid/acme/";
type Manifest = {
  id: string;
  scopeEpoch: string;
  authorizationView: string;
  scopePosition: string;
  expiresAt: string;
  beads: { items: unknown[]; next: string | null };
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function moduleBindings() {
  if (!entry || !source) throw new Error("explicit packed entry and source commit required");
  const installed = path.dirname(entry),
    emitted = path.join(root, "packages/server/dist");
  const pins = [];
  for (const name of (await readdir(emitted)).filter((n) => n.endsWith(".js")).sort()) {
    const actual = await readFile(path.join(installed, name));
    expect(actual.equals(await readFile(path.join(emitted, name))), name).toBe(true);
    pins.push({ name, bytes: actual.length, sha256: sha(actual) });
  }
  const schema = await readFile(path.join(installed, "../../protocol/schemas/bdp-v0.schema.json"));
  expect(schema.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(true);
  return { source, pins, schemaSHA256: sha(schema) };
}
function launch(configuration: unknown, selectedEntry = entry) {
  if (!selectedEntry) throw new Error("missing packed entry");
  const child = spawn(process.execPath, [selectedEntry], {
    cwd: "/tmp",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, ...(entry ? { BDP_SNAPSHOT_CLOCK_RUNTIME: path.dirname(entry) } : {}) },
  });
  let stdout = "",
    stderr = "",
    bytes = 0,
    overflow = false,
    forced = false;
  for (const [stream, append] of [
    [
      child.stdout,
      (s: string) => {
        stdout += s;
      },
    ],
    [
      child.stderr,
      (s: string) => {
        stderr += s;
      },
    ],
  ] as const) {
    if (!stream) throw new Error("missing packed child output pipe");
    stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 65536) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      append(chunk.toString("utf8"));
    });
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
            reject(new Error("packed child deadline"));
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
      void closed.then(() => reject(new Error(`packed child exited before ready: ${stderr}`)));
      child.send({ configuration });
    }),
  );
  let stopped: Promise<unknown> | undefined;
  return {
    child,
    ready,
    close: () =>
      (stopped ??= (async () => {
        if (child.connected) child.send({ command: "close" });
        const terminal = await bounded(closed);
        expect(overflow).toBe(false);
        expect(forced).toBe(false);
        return { ...terminal, stdout, stderr, bytes, overflow, forced, eof: true, reaped: true };
      })()),
  };
}

it.skipIf(!entry)(
  "packed saved Snapshot manifest and issued continuation preserve anchor or return direct409",
  async () => {
    const bindings = await moduleBindings();
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-s1-packed-"));
    const token = randomBytes(32).toString("base64url");
    const configuration = {
      scope,
      directory,
      create: true,
      credentials: [{ token, principal: "writer", canMutate: true }],
      artifacts: {
        descriptors: [
          {
            retrievalUri: `${scope}types/bead`,
            utf8: JSON.stringify({
              id: `${scope}types/bead`,
              name: "Bead",
              describes: "bead",
              conformsTo: [],
              propertiesSchema: `${scope}schemas/n`,
            }),
          },
        ],
        schemas: [
          {
            retrievalUri: `${scope}schemas/n`,
            utf8: JSON.stringify({
              $id: `${scope}schemas/n`,
              type: "object",
              properties: { n: { type: "integer" } },
              additionalProperties: false,
            }),
          },
        ],
      },
    };
    const run = launch(configuration),
      observations: unknown[] = [];
    let terminal: unknown;
    const controller = new AbortController(),
      watchdog = setTimeout(() => controller.abort(), 45000);
    try {
      const ready = await run.ready;
      if (!source) throw new Error("missing source identity");
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
        if (!url.startsWith(scope)) throw new Error("escaped Scope");
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
        const response = await execute({
          method,
          url,
          signal: controller.signal,
          raw: {
            headerLines: Object.entries(headers).map(([name, value]) => ({ name, value })),
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
          },
        });
        expect(response.exactRequest?.writeState).toBe("complete");
        expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
        observations.push({
          url,
          method,
          headers,
          body,
          response: {
            status: response.status,
            headers: response.headers,
            bodyText: response.bodyText,
            wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
          },
        });
        return response;
      }
      let key = 0;
      async function write(operations: unknown[]) {
        const wire = await exchange(
          `${scope}operations/batch`,
          "POST",
          { "content-type": "application/json", "idempotency-key": `s1-packed-${key++}` },
          { operations },
        );
        expect(wire.status).toBe(200);
        expect(JSON.parse(wire.bodyText).status).toBe("completed");
      }
      const rows = Array.from({ length: 33 }, (_, n) => ({
        operation: "createBead",
        id: `beads/b${String(n).padStart(2, "0")}`,
        type: `${scope}types/bead`,
        properties: { n },
      }));
      await write(rows.slice(0, 32));
      await write(rows.slice(32));
      const capture = await exchange(`${scope}snapshot`);
      expect(capture.status).toBe(200);
      const saved = JSON.parse(capture.bodyText) as Manifest;
      expect(saved.scopePosition).toBe("pos-2");
      expect(saved.beads.next).toBeTypeOf("string");
      const continuation = saved.beads.next;
      if (!continuation) throw new Error("missing actual issued continuation");
      const page = await exchange(continuation);
      expect(page.status).toBe(200);
      await write([
        {
          operation: "updateBead",
          bead: "beads/b00",
          propertiesChange: [{ op: "replace", path: "/n", value: 999 }],
        },
      ]);
      for (const [url, original] of [
        [saved.id, capture],
        [continuation, page],
      ] as const) {
        const minimum = {
          "bdp-scope-epoch": saved.scopeEpoch,
          "bdp-authorization-view": saved.authorizationView,
          "bdp-minimum-scope-position": "pos-2",
        };
        for (const method of ["GET", "HEAD"] as const) {
          const eligible = await exchange(url, method, minimum);
          expect(eligible.status).toBe(200);
          expect(eligible.headers["bdp-scope-position"]).toBe("pos-3");
          expect(eligible.headers["bdp-scope-epoch"]).toBe(saved.scopeEpoch);
          expect(eligible.headers["bdp-authorization-view"]).toBe(saved.authorizationView);
          expect(eligible.bodyText).toBe(method === "HEAD" ? "" : original.bodyText);
          const old = await exchange(url, method, {
            ...minimum,
            "bdp-minimum-scope-position": "pos-3",
            "if-none-match": "*",
          });
          expect(old.status).toBe(409);
          expect(old.headers["x-bdp-development-limit"]).toBeUndefined();
          expect(old.headers["bdp-scope-position"]).toBe("pos-3");
          if (method === "HEAD") expect(old.bodyText).toBe("");
          else
            expect(JSON.parse(old.bodyText)).toEqual({
              type: "https://github.com/gastownhall/bdp/problems/conflict",
              title: "snapshot-position-too-old",
              status: 409,
              code: "snapshot-position-too-old",
              retry: "after-state-change",
            });
        }
      }
      expect((await exchange(saved.id)).bodyText).toBe(capture.bodyText);
      terminal = await run.close();
      expect(terminal).toMatchObject({ code: 0, signal: null });
      if (evidence)
        await writeFile(
          path.join(evidence, "saved-anchor.json"),
          JSON.stringify(
            { bindings, baseline, ready, configuration, saved, terminal, observations },
            null,
            2,
          ),
          { mode: 0o600 },
        );
    } finally {
      clearTimeout(watchdog);
      try {
        terminal = await run.close();
      } finally {
        if (evidence)
          await writeFile(
            path.join(evidence, "saved-anchor-cleanup.json"),
            JSON.stringify({ terminal, observations }, null, 2),
            { mode: 0o600 },
          );
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
  60000,
);

it.skipIf(!entry)(
  "packed runtime trusted-clock expiry410 wins over retained minimum and conditions",
  async () => {
    const bindings = await moduleBindings();
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-s1-clock-"));
    const token = randomBytes(32).toString("base64url");
    const configuration = {
      scope,
      directory,
      create: true,
      credentials: [{ token, principal: "writer", canMutate: true }],
      artifacts: {
        descriptors: [
          {
            retrievalUri: `${scope}types/bead`,
            utf8: JSON.stringify({
              id: `${scope}types/bead`,
              name: "Bead",
              describes: "bead",
              conformsTo: [],
              propertiesSchema: `${scope}schemas/n`,
            }),
          },
        ],
        schemas: [
          {
            retrievalUri: `${scope}schemas/n`,
            utf8: JSON.stringify({
              $id: `${scope}schemas/n`,
              type: "object",
              properties: { n: { type: "integer" } },
              additionalProperties: false,
            }),
          },
        ],
      },
    };
    const childEntry = fileURLToPath(
      new URL("../test-support/snapshot-clock-child.ts", import.meta.url),
    );
    const run = launch(configuration, childEntry),
      observations: unknown[] = [];
    let terminal: unknown;
    const controller = new AbortController(),
      watchdog = setTimeout(() => controller.abort(), 45000);
    try {
      const ready = await run.ready;
      expect(ready).toMatchObject({
        event: "snapshot-clock.ready",
        now: 1000000,
        claimEligible: false,
        ordinaryDeployment: false,
        selectedSeam: "clock-only",
      });
      const address = new URL(String(ready.listenUrl));
      async function exchange(
        url: string,
        method: HttpMethod = "GET",
        headers: Record<string, string> = {},
        body?: unknown,
      ) {
        if (!url.startsWith(scope)) throw new Error("escaped Scope");
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
        const response = await execute({
          method,
          url,
          signal: controller.signal,
          raw: {
            headerLines: Object.entries(headers).map(([name, value]) => ({ name, value })),
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
          },
        });
        expect(response.exactRequest?.writeState).toBe("complete");
        expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
        observations.push({
          url,
          method,
          headers,
          body,
          response: {
            status: response.status,
            headers: response.headers,
            bodyText: response.bodyText,
            wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
          },
        });
        return response;
      }
      let key = 0;
      async function write(operations: unknown[]) {
        const wire = await exchange(
          `${scope}operations/batch`,
          "POST",
          { "content-type": "application/json", "idempotency-key": `s1-clock-${key++}` },
          { operations },
        );
        expect(wire.status).toBe(200);
        expect(JSON.parse(wire.bodyText).status).toBe("completed");
      }
      const create = (n: number) => ({
        operation: "createBead",
        id: `beads/b${String(n).padStart(2, "0")}`,
        type: `${scope}types/bead`,
        properties: { n },
      });
      await write(Array.from({ length: 32 }, (_, n) => create(n)));
      await write([create(32)]);
      const captured = await exchange(`${scope}snapshot`);
      expect(captured.status).toBe(200);
      const saved = JSON.parse(captured.bodyText) as Manifest;
      expect(saved.scopePosition).toBe("pos-2");
      expect(Date.parse(saved.expiresAt) - Number(ready.now)).toBe(300000);
      if (!saved.beads.next) throw new Error("missing issued continuation");
      await write([create(33)]);
      const time = Date.parse(saved.expiresAt) + 1;
      const advanced = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("clock acknowledgment deadline")), 5000);
        run.child.once("message", (value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      run.child.send({ command: "advance-clock", time } satisfies ClockAdvance);
      expect(await advanced).toEqual({ event: "clock-advanced", now: time });
      for (const url of [saved.id, saved.beads.next])
        for (const method of ["GET", "HEAD"] as const)
          for (const conditions of [{ "if-none-match": "*" }, { "if-match": '"absent"' }]) {
            const expired = await exchange(url, method, {
              "bdp-scope-epoch": saved.scopeEpoch,
              "bdp-authorization-view": saved.authorizationView,
              "bdp-minimum-scope-position": "pos-3",
              ...conditions,
            });
            expect(expired.status).toBe(410);
            expect(expired.headers["x-bdp-development-limit"]).toBeUndefined();
            if (method === "HEAD") expect(expired.bodyText).toBe("");
            else
              expect(JSON.parse(expired.bodyText)).toMatchObject({
                code: "cursor-expired",
                status: 410,
                type: "https://github.com/gastownhall/bdp/problems/gone",
              });
          }
      terminal = await run.close();
      expect(terminal).toMatchObject({ code: 0, signal: null });
      if (evidence)
        await writeFile(
          path.join(evidence, "expiry-clock.json"),
          JSON.stringify(
            {
              bindings,
              ready,
              configuration,
              saved,
              clockAdvance: { time },
              selectedBridge: { path: childEntry, sha256: sha(await readFile(childEntry)) },
              terminal,
              observations,
              ordinaryDeployment: false,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
    } finally {
      clearTimeout(watchdog);
      try {
        terminal = await run.close();
      } finally {
        if (evidence)
          await writeFile(
            path.join(evidence, "expiry-clock-cleanup.json"),
            JSON.stringify({ terminal, observations }, null, 2),
            { mode: 0o600 },
          );
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
  60000,
);
