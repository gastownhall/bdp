/** New actual competing-admission witnesses; the private scheduler supplies no member truth. */
import { DatabaseSync } from "node:sqlite";
import { connect } from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import type { TypeDescriptor } from "@bdp/protocol";
import { expect, it } from "vitest";
import {
  cumulativeRUConfiguration,
  type RUCampaignCredentials,
} from "../test-support/read-update-cumulative-product-configuration.js";

const installed = process.env.BDP_RU_RECOVERY_INSTALLED;
const credentialsFile = process.env.BDP_RU_RECOVERY_CREDENTIALS;
const evidence = process.env.BDP_RU_RECOVERY_EVIDENCE;
const bindingFile = process.env.BDP_RU_RECOVERY_SUBJECT_BINDING;
const scope = "https://reference.invalid/acme/";
const source = "5f3a67e89d62a0dcb4e9a7b9a6cb78b2c0a3e50c";
const childFixture = fileURLToPath(
  new URL("../test-support/read-update-cumulative-recovery-child.ts", import.meta.url),
);
const helpers = await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
);
const sha = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
type Message = Record<string, unknown>;
type Row = {
  id: string;
  type: string;
  revision: string;
  properties: Record<string, unknown>;
  metadata: Record<string, unknown>;
};
type Result = {
  results: {
    resource?: Row;
    code?: string;
    status?: number;
    retry?: string;
    operationIndex: number;
    operationName?: string;
  }[];
};

function launch(configuration: unknown, faultSecondTurn = false) {
  const child = spawn(process.execPath, [childFixture], {
    env: { ...process.env, BDP_RU_RECOVERY_INSTALLED: installed },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: true,
  });
  const messages: Message[] = [];
  let stdout = "",
    stderr = "",
    bytes = 0,
    forced = false,
    overflow = false;
  const observe = (channel: "stdout" | "stderr", chunk: Buffer) => {
    bytes += chunk.length;
    if (channel === "stdout") stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
    if (bytes > 65536) {
      overflow = true;
      forced = true;
      child.kill("SIGKILL");
    }
  };
  child.stdout!.on("data", (chunk: Buffer) => observe("stdout", chunk));
  child.stderr!.on("data", (chunk: Buffer) => observe("stderr", chunk));
  child.on("message", (value) => {
    if (messages.length >= 256) {
      overflow = true;
      forced = true;
      child.kill("SIGKILL");
      return;
    }
    messages.push(value as Message);
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            forced = true;
            child.kill("SIGKILL");
            void closed.then(() => reject(Error("owned recovery child deadline")), reject);
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const wait = (event: string, id?: number) =>
    bounded(
      new Promise<Message>((resolve, reject) => {
        const matches = (message: Message) =>
          message.event === event && (id === undefined || message.id === id);
        const existing = messages.find(matches);
        if (existing) return resolve(existing);
        const onMessage = (value: unknown) => {
          if (matches(value as Message)) {
            child.off("message", onMessage);
            resolve(value as Message);
          }
        };
        child.on("message", onMessage);
        void closed.then(() => {
          child.off("message", onMessage);
          reject(Error(`child closed before ${event}/${id}: ${stderr}`));
        }, reject);
      }),
    );
  const ready = wait("ru-recovery.ready");
  child.send({ configuration, faultSecondTurn });
  let closing: Promise<unknown> | undefined;
  return {
    child,
    ready,
    messages,
    queued: (id: number) => wait("scheduler.queued", id),
    release: async (id: number) => {
      await wait("scheduler.queued", id);
      child.send({ command: "release", id });
      return wait("scheduler.ran", id);
    },
    kill: async () => {
      if (!child.kill("SIGKILL")) throw Error("owned SIGKILL was not sent");
      await bounded(closed);
    },
    close: () =>
      (closing ??= (async () => {
        if (child.connected) child.send({ command: "close" });
        const result = await bounded(closed);
        let group = "absent";
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, 0);
            group = "present";
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
        return {
          pid: child.pid,
          ...result,
          stdout,
          stderr,
          bytes,
          forced,
          overflow,
          stdoutEOF: child.stdout!.readableEnded,
          stderrEOF: child.stderr!.readableEnded,
          directChildReaped: true,
          processGroup: group,
          messages,
        };
      })()),
  };
}

/** Read-only native observation only when every owner of this directory is dead/closed. */
function nativeClosed(directory: string) {
  const db = new DatabaseSync(path.join(directory, "reference.sqlite"), { readOnly: true });
  try {
    return {
      keys: db
        .prepare(
          "SELECT principal,key,state,owner,identity,fingerprint,resolutions,outcome,effect,completed_at,retain_until FROM key_state ORDER BY key",
        )
        .all(),
      resources: db.prepare("SELECT * FROM resources ORDER BY id").all(),
    };
  } finally {
    db.close();
  }
}

for (const scenario of ["crash", "disconnect", "schedule-fault"] as const) {
  it.skipIf(!installed)(
    `installed RU ${scenario} preserves committed prefix and original ordered recovery`,
    async () => {
      if (!installed || !credentialsFile || !evidence || !bindingFile)
        throw Error("explicit installed subject/private bank/output binding required");
      const failures: unknown[] = [],
        wires: unknown[] = [],
        generations: unknown[] = [],
        native: unknown[] = [],
        inflight: Promise<unknown>[] = [];
      const started = performance.now(),
        controller = new AbortController();
      let directory: string | undefined,
        run: ReturnType<typeof launch> | undefined,
        outcome: unknown,
        capturedBinding: unknown,
        moduleBindings: unknown,
        socketEvidence: unknown,
        storeAbsent = false;
      let socket: ReturnType<typeof connect> | undefined;
      const credentials = JSON.parse(
        await readFile(credentialsFile, "utf8"),
      ) as RUCampaignCredentials;
      expect(Object.keys(credentials).sort()).toEqual(["operator", "other", "restricted"]);
      expect(new Set(Object.values(credentials)).size).toBe(3);
      const timer = setTimeout(() => controller.abort(Error("unchanged90s recovery bound")), 90000);
      try {
        const binding = JSON.parse(await readFile(bindingFile, "utf8")) as {
          moduleBindings: { name: string; bytes: number; sha256: string }[];
        };
        const modules = binding.moduleBindings.filter((m) => m.name.endsWith(".js"));
        expect((await readdir(installed)).filter((n) => n.endsWith(".js")).sort()).toEqual(
          modules.map((m) => m.name).sort(),
        );
        for (const m of binding.moduleBindings) {
          const location = m.name.endsWith(".js")
            ? path.join(installed, m.name)
            : path.join(installed, "../../protocol/schemas/bdp-v0.schema.json");
          const raw = await readFile(location);
          expect(raw.length).toBe(m.bytes);
          expect(sha(raw)).toBe(m.sha256);
        }
        moduleBindings = binding.moduleBindings;
        const configModule = (await import(
          pathToFileURL(path.join(installed, "installed-reference-configuration.js")).href
        )) as {
          referenceTypeArtifacts(scope: string): TypeDescriptor[];
          captureInstalledReferenceConfiguration(value: unknown): {
            identity: string;
            artifactIdentity: string;
            policyIdentity: string;
            authenticationIdentity: string;
          };
        };
        directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-recovery-"));
        const port = await helpers.availablePort();
        const config = (create: boolean) =>
          cumulativeRUConfiguration(
            { scope, directory: directory!, create, listener: { host: "127.0.0.1", port } },
            configModule.referenceTypeArtifacts(scope),
            credentials,
          );
        const captured = configModule.captureInstalledReferenceConfiguration(config(true));
        expect(captured.identity).toBe(
          "9af00876e91f71137ff31c226d368590a018ce2367cdb93110ea246dc7420d46",
        );
        capturedBinding = {
          identity: captured.identity,
          artifactIdentity: captured.artifactIdentity,
          policyIdentity: captured.policyIdentity,
          authenticationIdentity: captured.authenticationIdentity,
          ordinaryDeployment: false,
          claimEligible: false,
          clockInjected: false,
          policyChanged: false,
          selectedSeam:
            "installed original LifecycleScheduler.turn callbacks; selected fault throws only during turn scheduling",
        };
        async function open(create: boolean, fault = false) {
          run = launch(config(create), fault);
          const ready = await run.ready;
          expect(ready).toMatchObject({
            event: "ru-recovery.ready",
            configurationIdentity: captured.identity,
            ordinaryDeployment: false,
            claimEligible: false,
            clockInjected: false,
            policyChanged: false,
          });
          generations.push({ ready });
        }
        async function close(expectedSignal: NodeJS.Signals | null = null, expectedCode = 0) {
          if (!run) throw Error("missing current owner");
          const terminal = await run.close();
          generations.push({ terminal });
          run = undefined;
          expect(terminal).toMatchObject({
            code: expectedSignal ? null : expectedCode,
            signal: expectedSignal,
            forced: false,
            overflow: false,
            stdoutEOF: true,
            stderrEOF: true,
            directChildReaped: true,
            processGroup: "absent",
          });
        }
        const execute = createRawHttpExchangeExecutor(
          { transport: "plain", host: "127.0.0.1", port },
          {
            exactMode: {
              scope,
              profile: "read-update",
              routes: [
                "operations/sequence",
                "beads/",
                "beads/recovery-owner",
                "beads/recovery-tail",
              ].map((p) => ({
                method: p.startsWith("operations/") ? ("POST" as const) : ("GET" as const),
                url: scope + p,
              })),
              maximumRequestBodyBytes: 65536,
              maximumRequestHeaderBytes: 16384,
              defaultCredentialRef: "operator",
              credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
              resolveCredentials: () => ({ authorization: `Bearer ${credentials.operator}` }),
            },
            requestTimeoutMs: 5000,
          },
        );
        function request(label: string, target: string, body?: unknown) {
          const raw = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
          const pending = execute({
            method: raw ? "POST" : "GET",
            url: scope + target,
            credentialRef: "operator",
            signal: controller.signal,
            raw: {
              headerLines: raw ? [{ name: "content-type", value: "application/json" }] : [],
              ...(raw ? { bodyBytes: raw } : {}),
            },
          }).then((response) => {
            const value = response.bodyText ? JSON.parse(response.bodyText) : null;
            wires.push({
              label,
              method: raw ? "POST" : "GET",
              url: scope + target,
              requestBody: body ?? null,
              requestUtf8Bytes: raw?.length ?? 0,
              requestUtf8Sha256: raw ? sha(raw) : null,
              status: response.status,
              headers: response.headers,
              bodyText: response.bodyText,
              wireBase64: Buffer.from(response.wireResponseBytes!).toString("base64"),
              exactRequest: response.exactRequest,
            });
            expect(response.exactRequest?.writeState).toBe("complete");
            return { status: response.status, value, bodyText: response.bodyText };
          });
          pending.catch(() => undefined);
          inflight.push(pending);
          return pending;
        }
        const sequence = {
          operations: [
            {
              operation: "createBead",
              idempotencyKey: "recovery-prefix-key",
              name: "made",
              id: "beads/recovery-owner",
              type: scope + "types/task",
              properties: { title: "durable-prefix" },
              metadata: {},
            },
            {
              operation: "updateBead",
              idempotencyKey: "recovery-pending-key",
              bead: "@made",
              propertiesChange: [{ op: "add", path: "/done", value: true }],
            },
            {
              operation: "createBead",
              idempotencyKey: "recovery-tail-key",
              id: "beads/recovery-tail",
              type: scope + "types/task",
              properties: { title: "ordered-tail" },
              metadata: {},
            },
          ],
        };
        await open(true, scenario === "schedule-fault");
        let first: Promise<Awaited<ReturnType<typeof request>>> | undefined;
        let disconnected: Promise<void> | undefined;
        if (scenario === "disconnect") {
          const body = Buffer.from(JSON.stringify(sequence));
          const raw = Buffer.from(
            `POST /acme/operations/sequence HTTP/1.1\r\nHost: reference.invalid\r\nAuthorization: Bearer ${credentials.operator}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body.toString("utf8")}`,
          );
          socket = connect({ host: "127.0.0.1", port });
          const responses: Buffer[] = [],
            errors: string[] = [];
          socket.on("data", (b) => responses.push(Buffer.from(b)));
          socket.on("error", (e) => errors.push(inspect(e)));
          disconnected = new Promise<void>((resolve) =>
            socket!.once("close", (hadError) => {
              socketEvidence = {
                rawRequestUtf8: raw.toString("utf8"),
                requestBodySha256: sha(body),
                requestBytes: raw.length,
                intentionalClientDisconnect: true,
                hadError,
                errors,
                receivedBase64: Buffer.concat(responses).toString("base64"),
                destroyed: socket!.destroyed,
              };
              resolve();
            }),
          );
          await new Promise<void>((resolve, reject) => {
            socket!.once("connect", () =>
              socket!.write(raw, (error) => (error ? reject(error) : resolve())),
            );
            socket!.once("error", reject);
          });
        } else first = request("original-carrier", "operations/sequence", sequence);
        await run!.queued(1);
        await run!.release(1);
        if (scenario === "schedule-fault") {
          const refused = await first!;
          expect(refused.status).toBe(500);
          expect(refused.bodyText).toBe("");
          expect(run!.messages).toContainEqual({
            event: "scheduler.fault",
            id: 2,
            phase: "real-turn-scheduling-before-original-callback",
          });
        } else await run!.queued(2);
        if (scenario === "schedule-fault") {
          // Native schedule failure fences the owner; do not pretend that this
          // observer can keep using its Read plane or retry without reopening.
          expect((await request("faulted-owner-refuses-read", "beads/recovery-owner")).status).toBe(
            500,
          );
          await close(null, 2);
          const faultTerminal = (
            generations.at(-1) as { terminal: { stderr: string; messages: Message[] } }
          ).terminal;
          expect(faultTerminal.stderr).toContain(
            "NEW selected scheduler infrastructure refusal after committed prefix",
          );
          expect(
            faultTerminal.messages.find((m) => m.event === "scheduler.closed")?.closeFailure,
          ).toEqual(expect.stringContaining("sequence lifecycle schedule failed"));
          const closedFault = nativeClosed(directory);
          native.push({ phase: "after-scheduler-fault-owner-closed", ...closedFault });
          expect(closedFault.keys.map((k) => [k.key, k.state])).toEqual([
            ["recovery-prefix-key", "retained"],
          ]);
          expect(closedFault.resources).toHaveLength(1);
          await open(false);
        }
        const prefix = (await request("durable-prefix-current", "beads/recovery-owner"))
          .value as Row;
        expect(prefix).toMatchObject({
          id: scope + "beads/recovery-owner",
          type: scope + "types/task",
          properties: { title: "durable-prefix" },
          metadata: {},
        });
        expect(typeof prefix.revision).toBe("string");
        expect((await request("tail-not-started", "beads/recovery-tail")).status).toBe(404);
        if (scenario === "crash") {
          await run!.kill();
          await close("SIGKILL");
          const failedDelivery = await Promise.allSettled([first!]);
          expect(failedDelivery[0]?.status).toBe("rejected");
          generations.push({
            expectedLostResponse: failedDelivery.map((v) =>
              v.status === "rejected" ? inspect(v.reason) : v.value,
            ),
          });
          const dead = nativeClosed(directory);
          native.push({ phase: "after-owned-SIGKILL-before-reopen", ...dead });
          expect(dead.keys.map((k) => [k.key, k.state])).toEqual([
            ["recovery-pending-key", "claimed"],
            ["recovery-prefix-key", "retained"],
            ["recovery-tail-key", "claimed"],
          ]);
          await open(false);
          expect((await request("reopen-no-auto-member", "beads/recovery-owner")).value).toEqual(
            prefix,
          );
          expect((await request("reopen-no-auto-tail", "beads/recovery-tail")).status).toBe(404);
          await close();
          const recovered = nativeClosed(directory);
          native.push({ phase: "after-reopen-without-any-resubmission", ...recovered });
          expect(recovered.keys.map((k) => [k.key, k.state])).toEqual([
            ["recovery-prefix-key", "retained"],
          ]);
          expect(recovered.resources).toHaveLength(1);
          await open(false);
        } else if (scenario === "disconnect") {
          socket!.destroy();
          await disconnected;
          expect(socketEvidence).toMatchObject({
            intentionalClientDisconnect: true,
            destroyed: true,
            receivedBase64: "",
          });
          await run!.release(2);
          await run!.release(3);
          expect(
            (await request("completed-without-observer", "beads/recovery-owner")).value.properties,
          ).toEqual({ title: "durable-prefix", done: true });
          expect(
            (await request("tail-completed-without-observer", "beads/recovery-tail")).value
              .properties,
          ).toEqual({ title: "ordered-tail" });
        }
        const retry = request("client-resubmission", "operations/sequence", sequence);
        const firstRetry = scenario === "disconnect" ? 4 : 1;
        await run!.release(firstRetry);
        expect(
          (await request("replayed-prefix-no-new-effect", "beads/recovery-owner")).value,
        ).toEqual(
          scenario === "disconnect"
            ? expect.objectContaining({ properties: { title: "durable-prefix", done: true } })
            : prefix,
        );
        await run!.release(firstRetry + 1);
        const after = (
          await request("ordered-dependent-committed-before-tail", "beads/recovery-owner")
        ).value as Row;
        expect(after.properties).toEqual({ title: "durable-prefix", done: true });
        expect(after.revision).not.toBe(prefix.revision);
        if (scenario !== "disconnect")
          expect(
            (await request("tail-still-unstarted-before-third-turn", "beads/recovery-tail")).status,
          ).toBe(404);
        await run!.release(firstRetry + 2);
        const response = await retry;
        expect(response.status).toBe(200);
        const result = response.value as Result;
        expect(result.results).toHaveLength(3);
        expect(result.results[0]!.resource).toEqual(prefix);
        expect(result.results[1]!.resource).toEqual(after);
        const tail = result.results[2]!.resource!;
        expect(tail).toMatchObject({
          id: scope + "beads/recovery-tail",
          properties: { title: "ordered-tail" },
          metadata: {},
        });
        const current = (await request("complete-final-state", "beads/")).value;
        expect(current.items).toEqual([after, tail]);
        expect(current.next).toBeNull();
        await close();
        const final = nativeClosed(directory);
        native.push({ phase: "after-all-dispositions-owner-closed", ...final });
        expect(final.keys).toHaveLength(3);
        expect(final.keys.every((k) => k.state === "retained")).toBe(true);
        expect(final.resources).toHaveLength(2);
        expect(
          JSON.parse(String(final.keys.find((k) => k.key === "recovery-prefix-key")!.outcome)),
        ).toEqual({
          format: "ru-member-outcome-1",
          operation: "createBead",
          disposition: { outcome: "created", resource: prefix },
        });
        outcome = { prefix, after, tail, response: result, finalCollection: current };
      } catch (error) {
        failures.push(error);
      } finally {
        clearTimeout(timer);
        socket?.destroy();
        try {
          if (run) {
            const terminal = await run.close();
            generations.push({ cleanupTerminal: terminal });
            expect(terminal).toMatchObject({
              forced: false,
              overflow: false,
              stdoutEOF: true,
              stderrEOF: true,
              directChildReaped: true,
              processGroup: "absent",
            });
          }
        } catch (error) {
          failures.push(error);
        }
        await Promise.allSettled(inflight);
        try {
          if (directory) {
            await rm(directory, { recursive: true, force: true });
            await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
            storeAbsent = true;
          }
        } catch (error) {
          failures.push(error);
        }
        const record = {
          scenario,
          passed: failures.length === 0,
          productionSource: source,
          ordinaryDeployment: false,
          ordinaryRuntimeConfigurationIdentity: null,
          claimEligible: false,
          capturedBinding,
          moduleBindings,
          outcome,
          wires,
          socketEvidence,
          generations,
          native,
          storeDirectory: directory,
          storeAbsent,
          elapsedMs: performance.now() - started,
          aggregateBudgetMs: 90000,
          failures: failures.map((e) => inspect(e, { depth: 12 })),
        };
        const raw = JSON.stringify(record, null, 2) + "\n";
        let redacted = raw;
        for (const secret of Object.values(credentials))
          redacted = redacted.replaceAll(secret, "[REDACTED-owned-credential]");
        const filename = path.join(evidence, scenario + ".json");
        if (raw !== redacted)
          await writeFile(filename + ".private", raw, { flag: "wx", mode: 0o600 });
        await writeFile(filename, redacted, { flag: "wx", mode: 0o600 });
      }
      if (failures.length)
        throw new AggregateError(failures, "NEW installed RU recovery witness failed");
    },
    90000,
  );
}
