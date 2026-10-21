/** New actual competing-admission witnesses; the private scheduler supplies no member truth. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

const installed = process.env.BDP_RU_CONCURRENCY_INSTALLED;
const credentialsFile = process.env.BDP_RU_CONCURRENCY_CREDENTIALS;
const evidence = process.env.BDP_RU_CONCURRENCY_EVIDENCE;
const bindingFile = process.env.BDP_RU_CONCURRENCY_SUBJECT_BINDING;
const scope = "https://reference.invalid/acme/";
const source = "5f3a67e89d62a0dcb4e9a7b9a6cb78b2c0a3e50c";
const childFixture = fileURLToPath(
  new URL("../test-support/read-update-cumulative-concurrency-child.ts", import.meta.url),
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

function launch(configuration: unknown) {
  const child = spawn(process.execPath, [childFixture], {
    env: { ...process.env, BDP_RU_CONCURRENCY_INSTALLED: installed },
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
            void closed.then(() => reject(Error("owned concurrency child deadline")), reject);
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
  const ready = wait("ru-concurrency.ready");
  child.send({ configuration });
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

for (const dependency of ["local-name", "state-reference"] as const) {
  it.skipIf(!installed)(
    `installed competing admission preserves ${dependency} creator/dependent claims and unrelated progress`,
    async () => {
      if (!installed || !credentialsFile || !evidence || !bindingFile)
        throw Error("explicit installed subject, private credentials and evidence required");
      const started = performance.now(),
        failures: unknown[] = [],
        wires: unknown[] = [],
        inflight: Promise<unknown>[] = [];
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(Error("unchanged90s concurrency bound")), 90000);
      let directory: string | undefined,
        run: ReturnType<typeof launch> | undefined,
        terminal: unknown,
        ready: unknown,
        outcome: unknown;
      let moduleBindings: unknown, capturedBinding: unknown;
      const credentials = JSON.parse(
        await readFile(credentialsFile, "utf8"),
      ) as RUCampaignCredentials;
      if (
        Object.keys(credentials).sort().join() !== "operator,other,restricted" ||
        new Set(Object.values(credentials)).size !== 3 ||
        Object.values(credentials).some((v) => typeof v !== "string" || v.length < 32)
      )
        throw Error("exact genuine campaign bank required");
      try {
        const originalBinding = JSON.parse(await readFile(bindingFile, "utf8")) as {
          moduleBindings: { name: string; bytes: number; sha256: string }[];
        };
        const modules = originalBinding.moduleBindings.filter((m) => m.name.endsWith(".js"));
        expect((await readdir(installed)).filter((n) => n.endsWith(".js")).sort()).toEqual(
          modules.map((m) => m.name).sort(),
        );
        for (const module of originalBinding.moduleBindings) {
          const location = module.name.endsWith(".js")
            ? path.join(installed, module.name)
            : path.join(installed, "../../protocol/schemas/bdp-v0.schema.json");
          const raw = await readFile(location);
          expect(raw.byteLength).toBe(module.bytes);
          expect(sha(raw)).toBe(module.sha256);
        }
        moduleBindings = originalBinding.moduleBindings;
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
        directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-concurrency-"));
        const port = await helpers.availablePort();
        const configuration = cumulativeRUConfiguration(
          { scope, directory, create: true, listener: { host: "127.0.0.1", port } },
          configModule.referenceTypeArtifacts(scope),
          credentials,
        );
        const captured = configModule.captureInstalledReferenceConfiguration(configuration);
        expect(captured.identity).toBe(
          "9af00876e91f71137ff31c226d368590a018ce2367cdb93110ea246dc7420d46",
        );
        // Do not retain the captured live configuration (which contains private
        // capabilities/credentials) as an apparent portable semantic graph.
        capturedBinding = {
          identity: captured.identity,
          artifactIdentity: captured.artifactIdentity,
          policyIdentity: captured.policyIdentity,
          authenticationIdentity: captured.authenticationIdentity,
        };
        run = launch(configuration);
        ready = await run.ready;
        expect(ready).toMatchObject({
          event: "ru-concurrency.ready",
          scope,
          configurationIdentity: captured.identity,
          ordinaryDeployment: false,
          claimEligible: false,
          clockInjected: false,
          policyChanged: false,
        });
        const routes = [
          "operations/sequence",
          "operations/update-bead",
          "beads/",
          "beads/concurrent-owner",
          "beads/concurrent-tail",
        ].map((p) => ({
          method: p.startsWith("operations/") ? ("POST" as const) : ("GET" as const),
          url: scope + p,
        }));
        const execute = createRawHttpExchangeExecutor(
          { transport: "plain", host: "127.0.0.1", port },
          {
            exactMode: {
              scope,
              profile: "read-update",
              routes,
              maximumRequestBodyBytes: 65536,
              maximumRequestHeaderBytes: 16384,
              defaultCredentialRef: "operator",
              credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
              resolveCredentials: () => ({ authorization: `Bearer ${credentials.operator}` }),
            },
            requestTimeoutMs: 5000,
          },
        );
        function request(label: string, target: string, body?: unknown, key?: string) {
          const method = body === undefined ? ("GET" as const) : ("POST" as const);
          const raw = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
          const pending = execute({
            method,
            url: scope + target,
            credentialRef: "operator",
            signal: controller.signal,
            raw: {
              headerLines: raw
                ? [
                    { name: "content-type", value: "application/json" },
                    ...(key ? [{ name: "idempotency-key", value: key }] : []),
                  ]
                : [],
              ...(raw ? { bodyBytes: raw } : {}),
            },
          }).then((response) => {
            const value = response.bodyText === "" ? null : JSON.parse(response.bodyText);
            wires.push({
              label,
              method,
              url: scope + target,
              requestBody: body,
              requestUtf8Bytes: raw?.length ?? 0,
              requestUtf8Sha256: raw ? sha(raw) : null,
              status: response.status,
              headers: response.headers,
              bodyText: response.bodyText,
              value,
              exactRequest: response.exactRequest,
            });
            expect(response.exactRequest?.writeState).toBe("complete");
            return { status: response.status, value };
          });
          pending.catch(() => undefined);
          inflight.push(pending);
          return pending;
        }
        const creator = {
          operation: "createBead",
          idempotencyKey: "concurrent-create-key",
          name: "made",
          id: "beads/concurrent-owner",
          type: scope + "types/task",
          properties: { title: "original" },
          metadata: {},
        };
        const dependent = {
          operation: "updateBead",
          idempotencyKey: "concurrent-dependent-key",
          bead: dependency === "local-name" ? "@made" : "beads/concurrent-owner",
          propertiesChange: [{ op: "add", path: "/done", value: true }],
        };
        const original = {
          operations: dependency === "local-name" ? [creator] : [creator, dependent],
        };
        const tail = {
          operation: "createBead",
          idempotencyKey: "independent-tail-key",
          id: "beads/concurrent-tail",
          type: scope + "types/task",
          properties: { title: "independent" },
          metadata: {},
        };
        const competing = { operations: [creator, dependent, tail] };
        let originalCompleted = false;
        const originalResponse = request(
          "original-admitted-held",
          "operations/sequence",
          original,
        ).finally(() => {
          originalCompleted = true;
        });
        originalResponse.catch(() => undefined);
        await run.queued(1);
        const competitorResponse = request("competing-admission", "operations/sequence", competing);
        await run.queued(2);
        expect((await request("no-effect-before-turns", "beads/")).value).toMatchObject({
          items: [],
          next: null,
        });
        expect(originalCompleted).toBe(false);
        await run.release(2);
        await run.release(3);
        await run.release(4);
        const competitor = await competitorResponse;
        expect(competitor.status).toBe(200);
        const first = competitor.value as Result;
        for (const index of [0, 1])
          expect(first.results[index]).toMatchObject({
            code: "idempotency-in-progress",
            status: 409,
            retry: "after-delay",
            operationIndex: index,
          });
        expect(first.results[2]?.resource).toMatchObject({
          id: scope + "beads/concurrent-tail",
          type: scope + "types/task",
          properties: { title: "independent" },
          metadata: {},
        });
        expect(first.results).toHaveLength(3);
        expect(originalCompleted).toBe(false);
        expect((await request("creator-still-not-executed", "beads/concurrent-owner")).status).toBe(
          404,
        );
        expect(
          (await request("independent-tail-committed", "beads/")).value.items.map((r: Row) => r.id),
        ).toEqual([scope + "beads/concurrent-tail"]);
        await run.release(1);
        let interleaved: Row | undefined;
        let originalResult: Result;
        let replay: { status: number; value: Result };
        if (dependency === "local-name") {
          const actual = await originalResponse;
          expect(actual.status).toBe(200);
          originalResult = actual.value as Result;
          expect(originalResult.results).toHaveLength(1);
          // B had claimed its previously unknown dependent key at admission,
          // then released that claim when @made's creator was transient.
          const retry = request(
            "retry-transients-and-retained-tail",
            "operations/sequence",
            competing,
          );
          await run.release(5); // Real retained creator establishes this request's binding.
          const middle = request(
            "unrelated-between-members",
            "operations/update-bead",
            {
              bead: "beads/concurrent-owner",
              propertiesChange: [{ op: "replace", path: "/title", value: "interleaved" }],
            },
            "unrelated-between-key",
          );
          await run.release(7); // The dependent is queued6, but is not isolated.
          const middleResponse = await middle;
          expect(middleResponse.status).toBe(200);
          interleaved = middleResponse.value.resource as Row;
          expect(interleaved.properties).toEqual({ title: "interleaved" });
          await run.release(6);
          await run.release(8);
          replay = await retry;
          expect(replay.value.results[1]).toMatchObject({ outcome: "updated", operationIndex: 1 });
        } else {
          await run.release(5);
          const actual = await originalResponse;
          expect(actual.status).toBe(200);
          originalResult = actual.value as Result;
          expect(originalResult.results).toHaveLength(2);
          const retry = request(
            "retry-transients-and-retained-tail",
            "operations/sequence",
            competing,
          );
          await run.release(6);
          await run.release(7);
          await run.release(8);
          replay = await retry;
          expect(replay.value.results.slice(0, 2)).toEqual(originalResult.results);
        }
        expect(replay.status).toBe(200);
        expect(replay.value.results[0]).toEqual(originalResult.results[0]);
        expect(replay.value.results[2]).toEqual(first.results[2]);
        const before = originalResult.results[0]!.resource!,
          after = replay.value.results[1]!.resource!;
        expect(before).toMatchObject({
          id: scope + "beads/concurrent-owner",
          type: scope + "types/task",
          properties: { title: "original" },
          metadata: {},
        });
        expect(after).toMatchObject({
          id: before.id,
          type: before.type,
          properties: {
            title: dependency === "local-name" ? "interleaved" : "original",
            done: true,
          },
          metadata: {},
        });
        expect(after.revision).not.toBe(before.revision);
        if (interleaved) {
          expect(interleaved.revision).not.toBe(before.revision);
          expect(after.revision).not.toBe(interleaved.revision);
        }
        expect((await request("final-original-current", "beads/concurrent-owner")).value).toEqual(
          after,
        );
        expect(
          (await request("final-independent-tail-current", "beads/concurrent-tail")).value,
        ).toEqual(first.results[2]!.resource);
        const collection = await request("final-complete-state", "beads/");
        expect(collection.value.items).toEqual([after, first.results[2]!.resource]);
        expect(collection.value.next).toBeNull();
        outcome = {
          originalResult,
          firstCompeting: first,
          interleaved: interleaved ?? null,
          retry: replay.value,
          finalCollection: collection.value,
        };
      } catch (error) {
        failures.push(error);
      } finally {
        clearTimeout(timer);
        try {
          if (run) {
            terminal = await run.close();
            expect(terminal).toMatchObject({
              code: 0,
              signal: null,
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
          if (directory) await rm(directory, { recursive: true, force: true });
        } catch (error) {
          failures.push(error);
        }
        const raw =
          JSON.stringify(
            {
              dependency,
              passed: failures.length === 0,
              productionSource: source,
              ordinaryDeployment: false,
              claimEligible: false,
              selectedControl:
                "original installed scheduler callbacks retained and explicitly released",
              capturedBinding,
              ready,
              moduleBindings,
              outcome,
              wires,
              nativeChildTerminal: terminal,
              storeDirectory: directory,
              storeRemovalAttempted: directory !== undefined,
              elapsedMs: performance.now() - started,
              aggregateBudgetMs: 90000,
              failures: failures.map((e) => inspect(e, { depth: 12 })),
            },
            null,
            2,
          ) + "\n";
        let redacted = raw;
        for (const secret of Object.values(credentials))
          redacted = redacted.replaceAll(secret, "[REDACTED-owned-credential]");
        const filename = path.join(evidence, `${dependency}.json`);
        if (raw !== redacted)
          await writeFile(filename + ".private", raw, { flag: "wx", mode: 0o600 });
        await writeFile(filename, redacted, { flag: "wx", mode: 0o600 });
      }
      if (failures.length)
        throw new AggregateError(failures, "NEW installed RU concurrency witness failed");
    },
    110000,
  );
}
