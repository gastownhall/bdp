/** NEW packed sequence presentation boundary; private clock/policy/admin controls only. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_SEQUENCE_PROJECTION_INSTALLED_ENTRY;
const source = process.env.BDP_SEQUENCE_PROJECTION_SOURCE;
const evidence = process.env.BDP_SEQUENCE_PROJECTION_EVIDENCE;
const fixtureChild = fileURLToPath(
  new URL("../test-support/sequence-projection-installed-child.ts", import.meta.url),
);
const scope = "https://reference.invalid/acme/";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function binding() {
  if (!entry || !source) throw new Error("explicit installed entry/source required");
  const emitted =
      process.env.BDP_SEQUENCE_PROJECTION_BUILD ?? path.join(root, "packages/server/dist"),
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
    env: { ...process.env, BDP_SEQUENCE_PROJECTION_RUNTIME: path.dirname(entry) },
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
    async control(command: Record<string, unknown>) {
      const answer = new Promise<Record<string, unknown>>((resolve, reject) => {
        child.once("message", (value) => resolve(value as Record<string, unknown>));
        void closed.then(() => reject(new Error("child closed before control reply")));
      });
      child.send(command);
      return bounded(answer);
    },
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

const type = `${scope}types/task`;
const creator = (name = "creator") => ({
  operation: "createBead",
  idempotencyKey: "create",
  name,
  id: "beads/a",
  type,
  properties: { title: "old-secret" },
});
const update = {
  operation: "updateBead",
  idempotencyKey: "update",
  bead: "beads/a",
  propertiesChange: [{ op: "replace", path: "/title", value: "healthy-successor" }],
};
const alias = {
  operation: "putAlias",
  idempotencyKey: "alias",
  alias: "alias/current",
  target: "beads/a",
};
const forbidden = (index: number, name?: string) => ({
  type: "https://github.com/gastownhall/bdp/problems/authorization",
  code: "forbidden",
  status: 403,
  retry: "after-state-change",
  operationIndex: index,
  ...(name ? { operationName: name } : {}),
});
function assertErased(result: unknown) {
  expect(result).toEqual({ results: [forbidden(0, "present")] });
}
it("sequence erasure oracle rejects raw erased facts, withheld result entries and leaked postimages", () => {
  assertErased({ results: [forbidden(0, "present")] });
  for (const entry of [
    { outcome: "erased", erased: { id: `${scope}beads/a` } },
    { outcome: "withheld" },
    { outcome: "created", resource: { properties: { title: "old-secret" } } },
  ]) {
    expect(() =>
      assertErased({ results: [{ operationIndex: 0, operationName: "present", ...entry }] }),
    ).toThrow();
  }
});
it.skipIf(!entry)(
  "packed sequence projects erased creations, expires only creation allocations and preserves private binding",
  async () => {
    const modules = await binding(),
      directory = await mkdtemp(path.join(tmpdir(), "bdp-sequence-projection-")),
      token = randomBytes(32).toString("base64url");
    const configuration = {
      scope,
      directory,
      create: true,
      credentials: [{ token, principal: "writer", canMutate: true }],
      artifacts: {
        descriptors: [
          {
            retrievalUri: type,
            utf8: JSON.stringify({ id: type, name: "Task", describes: "bead", conformsTo: [] }),
          },
          {
            retrievalUri: `${scope}types/link`,
            utf8: JSON.stringify({
              id: `${scope}types/link`,
              name: "Link",
              describes: "link",
              conformsTo: [],
              source: { conformsTo: [type], external: "none" },
              target: { conformsTo: [type], external: "none" },
            }),
          },
        ],
        schemas: [],
      },
    };
    let run: ReturnType<typeof launch> | undefined,
      terminal: unknown,
      ready: Record<string, unknown> | undefined;
    const wires: unknown[] = [],
      controls: unknown[] = [],
      failures: unknown[] = [];
    const controller = new AbortController(),
      watchdog = setTimeout(
        () => controller.abort(new Error("installed sequence cohort deadline")),
        45000,
      );
    try {
      run = launch(configuration);
      ready = await run.ready;
      expect(ready.fixture).toBe("installed-sequence-private-clock-policy-administration");
      expect(ready.ordinaryDeployment).toBe(false);
      expect(ready.claimEligible).toBe(false);
      expect(ready.facadeKeys).toEqual([
        "close",
        "configurationMetadata",
        "listenUrl",
        "replaceAuthorizationPolicy",
        "scope",
        "targets",
      ]);
      const address = new URL(String(ready.listenUrl));
      async function exchange(target: string, method: HttpMethod = "GET", body?: unknown) {
        const url = new URL(target, scope).href;
        if (new URL(url).origin !== new URL(scope).origin || wires.length >= 20)
          throw new Error("unbound/excess sequence request");
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
              body === undefined ? [] : [{ name: "Content-Type", value: "application/json" }],
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
          },
        });
        wires.push({
          method,
          url,
          body,
          status: wire.status,
          headers: wire.headers,
          bodyText: wire.bodyText,
          wireBase64: Buffer.from(wire.wireResponseBytes ?? []).toString("base64"),
        });
        expect(wire.exactRequest?.writeState).toBe("complete");
        expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
        return {
          status: wire.status,
          value: wire.bodyText === "" ? undefined : JSON.parse(wire.bodyText),
          headers: wire.headers,
        };
      }
      const sequence = (operations: unknown[]) =>
        exchange("operations/sequence", "POST", { operations });
      const created = await sequence([creator()]);
      expect(created.status).toBe(200);
      const original = created.value.results[0].resource;
      expect(original.properties).toEqual({ title: "old-secret" });
      const changed = await sequence([update, alias]);
      expect(changed.status).toBe(200);
      expect(changed.value.results[0].resource.properties).toEqual({ title: "healthy-successor" });
      controls.push(
        await run.control({ command: "erase", subject: original.id, revision: original.revision }),
      );
      const replay = await sequence([creator("present")]);
      expect(replay.status).toBe(200);
      assertErased(replay.value);
      const dependent = {
        operation: "createLink",
        idempotencyKey: "dependent",
        name: "child",
        id: "links/l",
        type: `${scope}types/link`,
        source: "@present",
        target: "@present",
      };
      const bound = await sequence([creator("present"), dependent]);
      expect(bound.status).toBe(200);
      expect(bound.value.results[0]).toEqual(forbidden(0, "present"));
      expect(bound.value.results[1]).toMatchObject({
        operationIndex: 1,
        operationName: "child",
        outcome: "created",
        resource: { source: original.id, target: original.id },
      });
      const fresh = await exchange("beads/a");
      expect(fresh.status).toBe(200);
      expect(fresh.value.properties).toEqual({ title: "healthy-successor" });
      controls.push(await run.control({ command: "expire" }));
      const expired = await sequence([creator("present"), update, alias]);
      expect(expired.status).toBe(200);
      expect(expired.value.results[0]).toMatchObject({
        operationIndex: 0,
        operationName: "present",
        code: "idempotency-expired",
        status: 410,
        allocated: { id: original.id, type },
      });
      expect(expired.value.results[0].allocated).toEqual({ id: original.id, type });
      for (const item of expired.value.results.slice(1)) {
        expect(item.code).toBe("idempotency-expired");
        expect(item).not.toHaveProperty("allocated");
      }
      const later = await sequence([
        creator("present"),
        { ...dependent, idempotencyKey: "later", id: "links/later" },
      ]);
      expect(later.status).toBe(200);
      expect(later.value.results[1].outcome).toBe("created");
      controls.push(await run.control({ command: "empty-policy" }));
      const refused = await sequence([creator("present")]);
      expect(refused.status).toBe(403);
      expect(refused.value.code).toBe("forbidden");
      expect(refused.value).not.toHaveProperty("results");
      // Empty policy refuses the carrier before retained-turn admission; it is not
      // represented here as an observed withheld member or a History grant.
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(watchdog);
      try {
        if (run) {
          terminal = await run.close();
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
      } catch (error) {
        failures.push(error);
      }
      try {
        if (evidence)
          await writeFile(
            path.join(evidence, "observation.json"),
            JSON.stringify(
              {
                modules,
                configuration: {
                  ...configuration,
                  credentials: [{ credentialRef: "writer", principal: "writer", canMutate: true }],
                },
                ready,
                terminal,
                wires,
                controls,
                failures: failures.map((error) => inspect(error, { depth: 8 })),
                ordinaryDeployment: false,
                wholeContract: false,
                historyDisclosureGrant: false,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
      } catch (error) {
        failures.push(error);
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "installed sequence projection or cleanup failed");
  },
  45000,
);
