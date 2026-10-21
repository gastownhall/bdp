/** NEW packed native restore boundary; ordinary HTTP before and after offline administration. */
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
const entry = process.env.BDP_NATIVE_RESTORE_INSTALLED_ENTRY;
const source = process.env.BDP_NATIVE_RESTORE_SOURCE;
const evidence = process.env.BDP_NATIVE_RESTORE_EVIDENCE;
const fixtureChild = fileURLToPath(
  new URL("../test-support/native-restore-installed-child.ts", import.meta.url),
);
const scope = "https://reference.invalid/acme/";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function binding() {
  if (!entry || !source) throw new Error("explicit installed entry/source required");
  const emitted = process.env.BDP_NATIVE_RESTORE_BUILD ?? path.join(root, "packages/server/dist"),
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
    env: { ...process.env, BDP_RESTORE_RUNTIME: path.dirname(entry) },
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

function restoredContext(
  headers: Record<string, string>,
  epoch: string,
  view: string,
  position: string,
) {
  for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
    expect(typeof headers[name] === "string" && headers[name]!.length > 0).toBe(true);
  expect(headers["bdp-scope-epoch"]).toBe(epoch);
  expect(headers["bdp-authorization-view"]).toBe(view);
  expect(headers["bdp-scope-position"]).toBe(position);
}
it("restore context oracle rejects missing/stale/empty context and old-epoch success", () => {
  const headers = {
    "bdp-scope-epoch": "new-epoch",
    "bdp-authorization-view": "view",
    "bdp-scope-position": "pos-1",
  };
  restoredContext(headers, "new-epoch", "view", "pos-1");
  for (const key of Object.keys(headers)) {
    const missing = { ...headers };
    delete missing[key as keyof typeof missing];
    expect(() => restoredContext(missing, "new-epoch", "view", "pos-1")).toThrow();
    expect(() =>
      restoredContext({ ...headers, [key]: "" }, "new-epoch", "view", "pos-1"),
    ).toThrow();
  }
  expect(() =>
    restoredContext({ ...headers, "bdp-scope-epoch": "old-epoch" }, "new-epoch", "view", "pos-1"),
  ).toThrow();
  expect(() =>
    restoredContext({ ...headers, "bdp-scope-position": "pos-4" }, "new-epoch", "view", "pos-1"),
  ).toThrow();
});

it.skipIf(!entry)(
  "packed native restore preserves permanent erasure state and fences epoch-local HTTP handles before normal serving",
  async () => {
    let directory: string | undefined, run: ReturnType<typeof launch> | undefined;
    let report: unknown;
    const failures: unknown[] = [],
      wires: unknown[] = [],
      terminals: unknown[] = [],
      generations: unknown[] = [];
    const controller = new AbortController(),
      watchdog = setTimeout(() => controller.abort(Error("native restore cohort deadline")), 45000);
    async function closeCurrent() {
      if (!run) return;
      const terminal = await run.close();
      terminals.push(terminal);
      expect(terminal).toMatchObject({
        code: 0,
        signal: null,
        overflow: false,
        forced: false,
        stdoutEOF: true,
        stderrEOF: true,
        reaped: true,
      });
      run = undefined;
    }
    try {
      const modules = await binding();
      directory = await mkdtemp(path.join(tmpdir(), "bdp-native-restore-installed-"));
      const token = randomBytes(32).toString("base64url"),
        type = `${scope}types/task`,
        schema = `${scope}schemas/open`;
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
              utf8: JSON.stringify({ $id: schema, type: "object", additionalProperties: true }),
            },
          ],
        },
      };
      run = launch(configuration);
      let ready = await run.ready;
      generations.push(ready);
      const fixture = {
        bytes: await readFile(
          path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
        ),
      };
      if (!source) throw Error("source binding required");
      const baseline = installedTransactionBinding(ready, source, fixture);
      let address = new URL(String(ready.listenUrl));
      const facade = [
        "close",
        "configurationMetadata",
        "listenUrl",
        "replaceAuthorizationPolicy",
        "scope",
        "targets",
      ];
      expect(ready.facadeKeys).toEqual(facade);
      async function command(command: string, extra: Record<string, string> = {}) {
        const active = run;
        if (!active) throw Error("missing child");
        const activeChild = active.child;
        const response = await new Promise<Record<string, any>>((resolve, reject) => {
          const timer = setTimeout(() => {
            activeChild.off("message", accept);
            reject(Error("private restore command deadline"));
          }, 10000);
          function accept(value: unknown) {
            if (
              value &&
              typeof value === "object" &&
              "event" in value &&
              value.event === "native-restore.done" &&
              "command" in value &&
              value.command === command
            ) {
              clearTimeout(timer);
              activeChild.off("message", accept);
              resolve(value as Record<string, any>);
            }
          }
          activeChild.on("message", accept);
          activeChild.send({ command, ...extra });
        });
        ready = response.ready;
        generations.push(ready);
        expect(ready.facadeKeys).toEqual(facade);
        expect(ready.payloadIdentity).toEqual(
          generations[0] && (generations[0] as Record<string, unknown>).payloadIdentity,
        );
        address = new URL(String(ready.listenUrl));
        return response.result;
      }
      async function exchange(
        target: string,
        method: HttpMethod = "GET",
        body?: unknown,
        key?: string,
      ) {
        if (wires.length >= 30) throw Error("finite native restore request limit");
        const url = new URL(target, scope).href;
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
        return { wire, value: wire.bodyText ? JSON.parse(wire.bodyText) : undefined };
      }
      const create = await exchange(
        "operations/create-bead",
        "POST",
        { id: "beads/a", type, properties: { value: "original" }, metadata: {} },
        "create",
      );
      expect(create.wire.status).toBe(200);
      const original = create.value.results[0].resource;
      const update = (value: string) => ({
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/value", value }],
      });
      const backupReceipt = await exchange(
        "operations/update-bead",
        "POST",
        update("backup"),
        "backup-update",
      );
      expect(backupReceipt.value.status).toBe("completed");
      const backupImage = backupReceipt.value.results[0].resource;
      await command("save");
      const prior = await exchange(
        "operations/update-bead",
        "POST",
        update("current"),
        "current-update",
      );
      expect(prior.value.status).toBe("completed");
      const erased = await command("erase", { subject: original.id, revision: original.revision });
      const saved = await exchange("snapshot");
      expect(saved.wire.status).toBe(200);
      const oldEpoch = saved.value.scopeEpoch,
        oldCheckpoint = saved.value.checkpoint;
      const beforeEvents = await exchange("events/");
      expect(beforeEvents.wire.status).toBe(200);
      const oldEvent = beforeEvents.value.events.at(-1).id;
      const restored = await command("restore");
      expect(restored.configuration.scopeEpoch).not.toBe(oldEpoch);
      expect(restored.ledger).toEqual(erased.group.erasures);
      expect(restored.history.groups).toHaveLength(1);
      expect(restored.history.groups[0]).toMatchObject({
        changes: [],
        events: [],
        erasures: erased.group.erasures,
        position: "pos-1",
      });
      const fresh = await exchange("snapshot");
      expect(fresh.wire.status).toBe(200);
      expect(fresh.value.scopeEpoch).toBe(restored.configuration.scopeEpoch);
      const expectCurrent = (response: Awaited<ReturnType<typeof exchange>>, position = "pos-1") =>
        restoredContext(
          response.wire.headers,
          fresh.value.scopeEpoch,
          fresh.value.authorizationView,
          position,
        );
      expectCurrent(fresh);
      const canonical = await exchange("beads/a");
      expect(canonical.wire.status).toBe(200);
      expect(canonical.value).toEqual(backupImage);
      expectCurrent(canonical);
      expect(fresh.value.beads.items).toEqual([backupImage]);
      expect(fresh.value.erasures).toEqual(erased.group.erasures);
      for (const target of [
        saved.value.id,
        `changes/?after=${encodeURIComponent(oldCheckpoint)}`,
        `events/?after=${encodeURIComponent(oldEvent)}`,
      ]) {
        const stale = await exchange(target);
        expect(stale.wire.status).toBe(410);
        expect(stale.value.code).toBe("cursor-expired");
        expectCurrent(stale);
      }
      const oldReceipt = await exchange(backupReceipt.value.id);
      expect(oldReceipt.wire.status).toBe(404);
      expect(oldReceipt.value.code).toBe("resource-not-found");
      expectCurrent(oldReceipt);
      const replacement = await exchange(
        "operations/update-bead",
        "POST",
        update("backup"),
        "backup-update",
      );
      expect(replacement.value.status).toBe("completed");
      expect(replacement.value.id).not.toBe(backupReceipt.value.id);
      expect(replacement.value.scopeEpoch).toBe(fresh.value.scopeEpoch);
      expectCurrent(replacement);
      await command("reopen");
      const reopened = await exchange("snapshot");
      expect(reopened.value.scopeEpoch).toBe(fresh.value.scopeEpoch);
      expectCurrent(reopened);
      expect(reopened.value.erasures).toEqual(fresh.value.erasures);
      expect(reopened.value.beads.items).toEqual([backupImage]);
      report = {
        modules,
        configuration,
        baseline,
        generations,
        original,
        backupImage,
        erased,
        restored,
        privateOfflineAdministration: true,
        publicFacadeUnchanged: true,
        wholeContract: false,
        profileClaimEligible: false,
      };
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(watchdog);
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
      try {
        if (evidence)
          await writeFile(
            evidence,
            JSON.stringify(
              {
                report,
                wires,
                terminals,
                generations,
                errors: failures.map((error) => inspect(error, { depth: 8 })),
              },
              null,
              2,
            ) + "\n",
            { mode: 0o600 },
          );
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "packed native restore boundary failed");
  },
);
