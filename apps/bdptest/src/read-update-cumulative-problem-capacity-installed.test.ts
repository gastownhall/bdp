/** One ordinary native RU capacity refusal; no private scheduler/clock/store control. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import type { TypeDescriptor } from "@bdp/protocol";
import { expect, it } from "vitest";
import {
  cumulativeRUConfiguration,
  type RUCampaignCredentials,
} from "../test-support/read-update-cumulative-product-configuration.js";

const installed = process.env.BDP_RU_PROBLEM_CAPACITY_INSTALLED;
const credentialsFile = process.env.BDP_RU_PROBLEM_CAPACITY_CREDENTIALS;
const evidence = process.env.BDP_RU_PROBLEM_CAPACITY_EVIDENCE;
const bindingFile = process.env.BDP_RU_PROBLEM_CAPACITY_SUBJECT_BINDING;
const scope = "https://reference.invalid/acme/";
const source = "5f3a67e89d62a0dcb4e9a7b9a6cb78b2c0a3e50c";
const helpers = await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
);
const sha = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
type Row = {
  id: string;
  type: string;
  revision: string;
  properties: { n: number };
  metadata: Record<string, never>;
};
type Page = { items: Row[]; next: string | null };

it.skipIf(!installed)(
  "ordinary installed RU rejects firstpage51 with exact503 and preserves an admitted continuation",
  async () => {
    if (!installed || !credentialsFile || !evidence || !bindingFile)
      throw Error("explicit installed/bank/evidence binding required");
    const failures: unknown[] = [],
      wires: unknown[] = [],
      firstPages: Page[] = [];
    const controller = new AbortController(),
      timer = setTimeout(
        () => controller.abort(Error("unchanged90s capacity cohort bound")),
        90000,
      );
    let directory: string | undefined,
      server: Awaited<ReturnType<typeof helpers.launchInstalledReference>> | undefined,
      closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
    let terminal: unknown,
      ready: unknown,
      configuration: unknown,
      moduleBindings: unknown,
      outcome: unknown,
      removed = false;
    let bank: RUCampaignCredentials | undefined;
    try {
      bank = JSON.parse(await readFile(credentialsFile, "utf8")) as RUCampaignCredentials;
      expect(Object.keys(bank).sort()).toEqual(["operator", "other", "restricted"]);
      expect(new Set(Object.values(bank)).size).toBe(3);
      const binding = JSON.parse(await readFile(bindingFile, "utf8")) as {
        moduleBindings: { name: string; bytes: number; sha256: string }[];
      };
      const modules = binding.moduleBindings.filter((m) => m.name.endsWith(".js"));
      expect((await readdir(installed)).filter((n) => n.endsWith(".js")).sort()).toEqual(
        modules.map((m) => m.name).sort(),
      );
      for (const m of binding.moduleBindings) {
        const file = m.name.endsWith(".js")
          ? path.join(installed, m.name)
          : path.join(installed, "../../protocol/schemas/bdp-v0.schema.json");
        const raw = await readFile(file);
        expect(raw.length).toBe(m.bytes);
        expect(sha(raw)).toBe(m.sha256);
      }
      moduleBindings = binding.moduleBindings;
      const configModule = (await import(
        pathToFileURL(path.join(installed, "installed-reference-configuration.js")).href
      )) as {
        referenceTypeArtifacts(scope: string): TypeDescriptor[];
        captureInstalledReferenceConfiguration(input: unknown): {
          identity: string;
          artifactIdentity: string;
          policyIdentity: string;
          authenticationIdentity: string;
        };
      };
      directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-problem-capacity-"));
      const port = await helpers.availablePort();
      const actual = cumulativeRUConfiguration(
        { scope, directory, create: true, listener: { host: "127.0.0.1", port } },
        configModule.referenceTypeArtifacts(scope),
        bank,
      );
      const captured = configModule.captureInstalledReferenceConfiguration(actual);
      expect(captured.identity).toBe(
        "9af00876e91f71137ff31c226d368590a018ce2367cdb93110ea246dc7420d46",
      );
      configuration = {
        ...actual,
        credentials: actual.credentials.map(({ token: _token, ...descriptor }) => descriptor),
        capture: {
          identity: captured.identity,
          artifactIdentity: captured.artifactIdentity,
          policyIdentity: captured.policyIdentity,
          authenticationIdentity: captured.authenticationIdentity,
        },
      };
      server = await helpers.launchInstalledReference(
        path.join(installed, "installed-reference-process.js"),
        actual,
      );
      const owned = server;
      closed = new Promise((resolve, reject) => {
        owned.child.once("close", (code: number | null, signal: NodeJS.Signals | null) =>
          resolve({ code, signal }),
        );
        owned.child.once("error", reject);
      });
      ready = server.ready;
      expect(ready).toMatchObject({
        event: "qualification.ready",
        configurationIdentity: captured.identity,
        profile: "read-update",
        history: false,
        claimEligible: false,
      });
      async function send(label: string, target: string, body?: unknown, key?: string) {
        if (wires.length >= 60) throw Error("sixty HTTP request bound");
        const url = new URL(target, scope).href;
        if (!url.startsWith(scope) || new URL(url).hash)
          throw Error("exact captured local HTTP target required");
        const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        const execute = createRawHttpExchangeExecutor(
          { transport: "plain", host: "127.0.0.1", port },
          {
            requestTimeoutMs: 5000,
            maximumBodyBytes: 1048576,
            exactMode: {
              scope,
              profile: "read-update",
              routes: [{ method: bytes ? "POST" : "GET", url }],
              maximumRequestHeaderBytes: 16384,
              maximumRequestBodyBytes: 65536,
              defaultCredentialRef: "operator",
              credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
              resolveCredentials: () => ({ authorization: `Bearer ${bank!.operator}` }),
            },
          },
        );
        const response = await execute({
          method: bytes ? "POST" : "GET",
          url,
          signal: controller.signal,
          raw: {
            headerLines: bytes
              ? [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: key! },
                ]
              : [],
            ...(bytes ? { bodyBytes: bytes } : {}),
          },
        });
        expect(response.wireResponseBytes).toBeDefined();
        wires.push({
          label,
          method: bytes ? "POST" : "GET",
          url,
          credentialRef: "operator",
          requestBody: body ?? null,
          requestBodySha256: bytes ? sha(bytes) : null,
          status: response.status,
          headers: response.headers,
          bodyText: response.bodyText,
          wireBase64: Buffer.from(response.wireResponseBytes!).toString("base64"),
          serializer: response.exactRequest,
        });
        expect(response.exactRequest?.writeState).toBe("complete");
        if (bytes) expect(response.exactRequest?.bodyDigest).toBe(sha(bytes));
        return {
          status: response.status,
          headers: response.headers,
          bodyText: response.bodyText,
          value: response.bodyText ? JSON.parse(response.bodyText) : null,
        };
      }
      const rows: Row[] = [];
      for (const [name, n] of [
        ["a", 1],
        ["b", 2],
      ] as const) {
        const made = await send(
          "seed-" + name,
          "operations/create-bead",
          { id: "beads/cap-" + name, type: scope + "types/task", properties: { n }, metadata: {} },
          "capacity-seed-" + name,
        );
        expect(made.status).toBe(200);
        expect(made.value.outcome).toBe("created");
        const row = made.value.resource as Row;
        expect(row.revision).toMatch(/^[a-f0-9]{64}$/);
        expect(row).toEqual({
          id: scope + "beads/cap-" + name,
          type: scope + "types/task",
          revision: row.revision,
          properties: { n },
          metadata: {},
        });
        rows.push(row);
      }
      const pressureStart = performance.now();
      // Native fixed retainedStateCapacity100 counts snapshot+reserved future
      // cursor. Two items/limit1 costs2, therefore exactly50 admissions, not100.
      for (let ordinal = 1; ordinal <= 50; ordinal++) {
        const response = await send("retained-firstpage-" + ordinal, "beads/?limit=1");
        expect(response.status).toBe(200);
        const page = response.value as Page;
        expect(page.items).toEqual([rows[0]]);
        expect(typeof page.next).toBe("string");
        expect(new URL(page.next!).origin).toBe(new URL(scope).origin);
        firstPages.push(page);
      }
      expect(new Set(firstPages.map((p) => p.next)).size).toBe(50);
      const refused = await send("firstpage-51-refused", "beads/?limit=1");
      expect(refused.status).toBe(503);
      expect(refused.headers["content-type"]).toBe("application/problem+json");
      expect(refused.headers["cache-control"]).toBe("private, no-store");
      expect(refused.value).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/unavailable",
        code: "temporarily-unavailable",
        retry: "after-delay",
        status: 503,
      });
      const continued = await send("oldest-admitted-cursor-still-healthy", firstPages[0]!.next!);
      expect(continued.status).toBe(200);
      expect(continued.value).toEqual({ items: [rows[1]], next: null });
      expect([...firstPages[0]!.items, ...continued.value.items]).toEqual(rows);
      // Terminal continuation traversal does not revoke the saved result either.
      const replay = await send("same-cursor-repeat-identical", firstPages[0]!.next!);
      expect(replay.status).toBe(200);
      expect(replay.value).toEqual(continued.value);
      const fresh = await send("complete-current-state-unmodified", "beads/");
      expect(fresh.status).toBe(200);
      expect(fresh.value).toEqual({ items: rows, next: null });
      expect(performance.now() - pressureStart).toBeLessThan(60000);
      outcome = {
        sourceDerivedAdmissionCount: 50,
        sourceDerivedRefusalOrdinal: 51,
        rows,
        refusal: refused.value,
        oldestContinuation: continued.value,
        pressureMilliseconds: performance.now() - pressureStart,
        privateTTLUnchanged: 60000,
        sameCursorResultStable: true,
      };
    } catch (error) {
      failures.push(error);
    }
    clearTimeout(timer);
    if (server) {
      try {
        await server.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        if (!closed) throw Error("owned close observer missing");
        let waitTimer: ReturnType<typeof setTimeout> | undefined;
        let result: { code: number | null; signal: NodeJS.Signals | null };
        try {
          result = await Promise.race([
            closed,
            new Promise<never>((_resolve, reject) => {
              waitTimer = setTimeout(() => {
                server!.child.kill("SIGKILL");
                void closed!.then(
                  () => reject(Error("owned capacity child close deadline")),
                  reject,
                );
              }, 10000);
            }),
          ]);
        } finally {
          clearTimeout(waitTimer);
        }
        let pidAbsent = false;
        try {
          process.kill(server.child.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          pidAbsent = true;
        }
        terminal = {
          pid: server.child.pid,
          ...result,
          ...server.output(),
          stdoutEOF: server.child.stdout.readableEnded,
          stderrEOF: server.child.stderr.readableEnded,
          reaped: true,
          pidAbsent,
        };
        expect(terminal).toMatchObject({
          code: 0,
          signal: null,
          stdout: "",
          stderr: "",
          stdoutEOF: true,
          stderrEOF: true,
          reaped: true,
          pidAbsent: true,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      if (directory) {
        await rm(directory, { recursive: true, force: true });
        await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
        removed = true;
      }
    } catch (error) {
      failures.push(error);
    }
    const text =
      JSON.stringify(
        {
          passed: failures.length === 0,
          productionSource: source,
          ordinaryConfiguration: true,
          ordinaryRuntimeConfigurationIdentity:
            "9af00876e91f71137ff31c226d368590a018ce2367cdb93110ea246dc7420d46",
          claimEligible: false,
          configuration,
          ready,
          moduleBindings,
          outcome,
          wires,
          terminal,
          removed,
          failures: failures.map((e) => inspect(e, { depth: 12 })),
        },
        null,
        2,
      ) + "\n";
    let redacted = text;
    for (const token of Object.values(bank ?? {}))
      redacted = redacted.replaceAll(token, "[REDACTED-owned-credential]");
    if (redacted !== text)
      await writeFile(path.join(evidence, "capacity.json.private"), text, {
        flag: "wx",
        mode: 0o600,
      });
    await writeFile(path.join(evidence, "capacity.json"), redacted, { flag: "wx", mode: 0o600 });
    if (failures.length)
      throw new AggregateError(
        failures,
        "NEW ordinary installed pagination capacity witness failed",
      );
  },
  90000,
);
