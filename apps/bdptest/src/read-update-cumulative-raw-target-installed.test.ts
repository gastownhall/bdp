/** Only missing authenticated unsafe receiver literals; prior237 cases are not replayed. */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
import {
  fixedRawRead,
  type FixedTarget,
} from "../test-support/read-update-cumulative-raw-target-wire.js";
const helpers = await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
);
const entry = process.env.BDP_RU_RAW_TARGET_ENTRY,
  bankPath = process.env.BDP_RU_RAW_TARGET_CREDENTIALS,
  output = process.env.BDP_RU_RAW_TARGET_OUTPUT,
  bindingPath = process.env.BDP_RU_RAW_TARGET_BINDING;
const scope = "https://reference.invalid/acme/",
  id = scope + "beads/raw-target",
  type = scope + "types/task";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function unsafeOracle(
  kind: Exclude<FixedTarget, "canonical">,
  value: { status: number; headers: Record<string, string>; body: Buffer },
) {
  expect(value.status).toBe(400);
  expect(value.headers.location).toBeUndefined();
  if (kind !== "backslash") {
    // Native HTTP parsing refuses these fixed control/invalid-UTF8 octets before application authentication.
    expect(value.body.length).toBe(0);
    expect([undefined, "0"]).toContain(value.headers["content-length"]);
    expect(value.headers["content-type"]).toBeUndefined();
  } else {
    expect(value.headers["content-type"]).toBe("application/problem+json");
    expect(value.headers["cache-control"]).toBe("private, no-store");
    expect(JSON.parse(value.body.toString())).toMatchObject({
      code: "malformed-request",
      status: 400,
    });
    expect(value.headers["www-authenticate"]).toBeUndefined();
  }
}
it("rejects a normalized-success or authentication-shortcut oracle", () => {
  expect(() =>
    unsafeOracle("backslash", { status: 200, headers: {}, body: Buffer.from("{}") }),
  ).toThrow();
  expect(() =>
    unsafeOracle("backslash", { status: 401, headers: {}, body: Buffer.from("{}") }),
  ).toThrow();
  expect(() =>
    unsafeOracle("backslash", {
      status: 400,
      headers: { "content-type": "application/problem+json", "cache-control": "private, no-store" },
      body: Buffer.from('{"code":"resource-not-found","status":400}'),
    }),
  ).toThrow();
  expect(() =>
    unsafeOracle("control", {
      status: 400,
      headers: { "content-length": "1" },
      body: Buffer.from("x"),
    }),
  ).toThrow();
});
it.skipIf(!entry)(
  "rejects authenticated fixed unsafe request-target bytes before Scope lookup",
  async () => {
    if (!entry || !bankPath || !output || !bindingPath)
      throw Error("exact installed inputs required");
    const failures: unknown[] = [],
      wires: unknown[] = [],
      privateRequests: unknown[] = [];
    let directory: string | undefined,
      runtime: Awaited<ReturnType<typeof helpers.launchInstalledReference>> | undefined;
    let childClosed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
    let terminal: unknown,
      ready: unknown,
      configuration: unknown,
      capture: unknown,
      modules: unknown,
      before: unknown,
      after: unknown;
    let absent = false,
      bank: RUCampaignCredentials | undefined;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(Error("raw-target90s bound")), 90000);
    try {
      const rawBank = await readFile(bankPath);
      bank = JSON.parse(rawBank.toString()) as RUCampaignCredentials;
      expect(Object.keys(bank).sort()).toEqual(["operator", "other", "restricted"]);
      expect(new Set(Object.values(bank)).size).toBe(3);
      directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-raw-target-"));
      const binding = JSON.parse(await readFile(bindingPath, "utf8")) as {
        subject?: unknown;
        moduleBindings: { name: string; bytes: number; sha256: string }[];
      };
      const installed = path.dirname(entry);
      expect((await readdir(installed)).filter((n) => n.endsWith(".js")).sort()).toEqual(
        binding.moduleBindings
          .filter((m) => m.name.endsWith(".js"))
          .map((m) => m.name)
          .sort(),
      );
      for (const m of binding.moduleBindings) {
        const b = await readFile(
          m.name.endsWith(".js")
            ? path.join(installed, m.name)
            : path.join(installed, "../../protocol/schemas/bdp-v0.schema.json"),
        );
        expect(b.length).toBe(m.bytes);
        expect(sha(b)).toBe(m.sha256);
      }
      modules = binding.moduleBindings;
      const module = (await import(
        pathToFileURL(path.join(installed, "installed-reference-configuration.js")).href
      )) as {
        referenceTypeArtifacts(scope: string): TypeDescriptor[];
        captureInstalledReferenceConfiguration(c: unknown): Record<string, unknown>;
      };
      const port = await helpers.availablePort();
      const config = cumulativeRUConfiguration(
        { scope, directory, create: true, listener: { host: "127.0.0.1", port } },
        module.referenceTypeArtifacts(scope),
        bank,
      );
      const captured = module.captureInstalledReferenceConfiguration(config);
      capture = captured;
      expect(captured.identity).toBe(
        "9af00876e91f71137ff31c226d368590a018ce2367cdb93110ea246dc7420d46",
      );
      configuration = {
        ...config,
        credentials: config.credentials.map(({ token: _token, ...r }) => r),
      };
      runtime = await helpers.launchInstalledReference(entry, config);
      childClosed = new Promise((resolve) =>
        runtime!.child.once("close", (code: number | null, signal: NodeJS.Signals | null) =>
          resolve({ code, signal }),
        ),
      );
      ready = runtime.ready;
      expect(ready).toMatchObject({
        configurationIdentity: captured.identity,
        artifactIdentity: captured.artifactIdentity,
        policyIdentity: captured.policyIdentity,
        authenticationIdentity: captured.authenticationIdentity,
        profile: "read-update",
        history: false,
        claimEligible: false,
      });
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: "127.0.0.1", port },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 1048576,
          exactMode: {
            scope,
            profile: "read-update",
            routes: [
              { method: "POST", url: scope + "operations/create-bead" },
              { method: "GET", url: scope + "beads/" },
            ],
            maximumRequestBodyBytes: 65536,
            maximumRequestHeaderBytes: 16384,
            defaultCredentialRef: "operator",
            credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${bank!.operator}` }),
          },
        },
      );
      async function ordinary(target: string, body?: unknown) {
        const raw = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        const r = await execute({
          method: body === undefined ? "GET" : "POST",
          url: scope + target,
          credentialRef: "operator",
          signal: controller.signal,
          raw: {
            headerLines: raw
              ? [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: "raw-target-create" },
                ]
              : [],
            ...(raw ? { bodyBytes: raw } : {}),
          },
        });
        wires.push({
          kind: target,
          status: r.status,
          headers: r.headers,
          bodyText: r.bodyText,
          wireBase64: Buffer.from(r.wireResponseBytes!).toString("base64"),
          exactRequest: r.exactRequest,
        });
        expect(r.exactRequest?.writeState).toBe("complete");
        expect(r.status).toBe(200);
        return JSON.parse(r.bodyText);
      }
      const created = await ordinary("operations/create-bead", {
        id: "beads/raw-target",
        type,
        properties: { title: "literal identity" },
        metadata: {},
      });
      const record = created.resource;
      expect(record.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      expect(record).toEqual({
        id,
        type,
        revision: record.revision,
        properties: { title: "literal identity" },
        metadata: {},
      });
      const selectedUnsafe = process.env.BDP_RU_RAW_TARGET_SELECTED_UNSAFE
        ? (JSON.parse(process.env.BDP_RU_RAW_TARGET_SELECTED_UNSAFE) as Exclude<
            FixedTarget,
            "canonical"
          >[])
        : (["backslash", "control", "invalidUTF8"] as const);
      if (
        !Array.isArray(selectedUnsafe) ||
        selectedUnsafe.length === 0 ||
        new Set(selectedUnsafe).size !== selectedUnsafe.length ||
        selectedUnsafe.some((k) => !["backslash", "control", "invalidUTF8"].includes(k))
      )
        throw Error("finite fixed unsafe selection required");
      for (const kind of ["canonical", ...selectedUnsafe, "canonical"] as const) {
        const r = await fixedRawRead(port, bank.operator, kind, controller.signal);
        privateRequests.push({ kind, rawRequestBase64: r.privateRequest.toString("base64") });
        const publicRequest = r.privateRequest
          .toString("latin1")
          .replace(bank.operator, "[REDACTED-owned-credential]");
        wires.push({
          kind,
          requestTargetBase64: r.privateRequest
            .subarray(4, r.privateRequest.indexOf(" HTTP/1.1"))
            .toString("base64"),
          requestRedactedBase64: Buffer.from(publicRequest, "latin1").toString("base64"),
          requestBytes: r.privateRequest.length,
          status: r.status,
          headers: r.headers,
          bodyText: r.body.toString(),
          wireBase64: r.response.toString("base64"),
          writeComplete: r.writeComplete,
          responseEOF: r.responseEOF,
          socketClosed: r.socketClosed,
          receivingStage:
            kind === "control" || kind === "invalidUTF8"
              ? "native HTTP parser before application authentication"
              : kind === "canonical"
                ? "ordinary authenticated Resource lookup"
                : "authenticated native raw-target gate before Scope lookup",
        });
        expect(r.writeComplete && r.responseEOF && r.socketClosed).toBe(true);
        if (kind === "canonical") {
          expect(r.status).toBe(200);
          expect(JSON.parse(r.body.toString())).toEqual(record);
          if (before === undefined) before = JSON.parse(r.body.toString());
          else after = JSON.parse(r.body.toString());
        } else unsafeOracle(kind, r);
      }
      expect(after).toEqual(before);
      expect(await ordinary("beads/")).toEqual({ items: [record], next: null });
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(timer);
      try {
        if (runtime) {
          await runtime.close();
          const closed = await childClosed!;
          terminal = {
            pid: runtime.child.pid,
            ...closed,
            ...runtime.output(),
            stdoutEOF: runtime.child.stdout!.readableEnded,
            stderrEOF: runtime.child.stderr!.readableEnded,
            reaped: true,
          };
          expect(terminal).toMatchObject({
            code: 0,
            signal: null,
            stdout: "",
            stderr: "",
            stdoutEOF: true,
            stderrEOF: true,
            reaped: true,
          });
        }
      } catch (error) {
        failures.push(error);
      }
      try {
        if (directory) {
          await rm(directory, { recursive: true, force: true });
          await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
          absent = true;
        }
      } catch (error) {
        failures.push(error);
      }
      const data = {
        passed: failures.length === 0,
        sourceBase: "4f9b51d269d1631bd183cf663e8d855a2909dd69",
        productionSource: "5f3a67e89d62a0dcb4e9a7b9a6cb78b2c0a3e50c",
        ordinaryDeployment: true,
        ordinaryRuntimeConfigurationIdentity: (capture as Record<string, unknown> | undefined)
          ?.identity,
        configuration,
        capture,
        ready,
        modules,
        wires,
        before,
        after,
        terminal,
        storeAbsent: absent,
        failures: failures.map((e) => inspect(e, { depth: 8 })),
      };
      if (output) {
        let raw = JSON.stringify(data, null, 2) + "\n";
        for (const v of Object.values(bank ?? {}))
          raw = raw.replaceAll(v, "[REDACTED-owned-credential]");
        try {
          await writeFile(path.join(output, "observation.json"), raw, { flag: "wx", mode: 0o600 });
        } catch (error) {
          failures.push(error);
        }
        try {
          await writeFile(
            path.join(output, "requests.private.json"),
            JSON.stringify(privateRequests, null, 2) + "\n",
            { flag: "wx", mode: 0o600 },
          );
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "new authenticated raw-target witness failed");
  },
  90000,
);
