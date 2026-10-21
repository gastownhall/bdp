/** New ordinary installed TX observations; no private runtime/owner controls. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry =
  process.env.BDP_OWNERSHIP_RECOVERY_ENTRY ?? path.join(root, "apps/bdptest/dist/main.js");
const { availablePort } = (await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
)) as { availablePort(): Promise<number> };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("wire object required");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw new Error("wire identity required");
  return value;
}
const contextFields = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
function responseContext(
  headers: Readonly<Record<string, string | undefined>>,
  expectedPosition: string,
) {
  const fields = contextFields.map((name) => {
    const value = headers[name];
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value))
      throw new Error(`missing or malformed BDP context field: ${name}`);
    return [name, value] as const;
  });
  const context = Object.fromEntries(fields);
  if (context["bdp-scope-position"] !== expectedPosition)
    throw new Error("unexpected BDP context position");
  return Object.freeze(context);
}
it("ownership/reopen context oracle rejects omitted, empty and malformed fields before equality", () => {
  const valid = {
    "bdp-scope-epoch": "epoch-fixture",
    "bdp-authorization-view": "view-fixture",
    "bdp-scope-position": "pos-2",
  };
  expect(responseContext(valid, "pos-2")).toEqual(valid);
  for (const name of contextFields) {
    const absent: Record<string, string | undefined> = { ...valid };
    delete absent[name];
    expect(() => responseContext(absent, "pos-2")).toThrow(
      "missing or malformed BDP context field",
    );
    for (const value of ["", "invalid value"])
      expect(() => responseContext({ ...valid, [name]: value }, "pos-2")).toThrow(
        "missing or malformed BDP context field",
      );
  }
  expect(() => responseContext(valid, "pos-3")).toThrow("unexpected BDP context position");
});
async function runtimeIdentity() {
  const manifest = process.env.BDP_OWNERSHIP_RECOVERY_RUNTIME_MANIFEST;
  if (process.env.BDP_OWNERSHIP_RECOVERY_ENTRY && !manifest)
    throw new Error("installed override requires exact runtime manifest");
  const raw = await readFile(entry);
  if (!manifest)
    return {
      kind: "workspace-emitted",
      entrySha256: createHash("sha256").update(raw).digest("hex"),
    };
  const bytes = await readFile(manifest);
  const selected = JSON.parse(bytes.toString("utf8")) as {
    sourceCommit: string;
    entry: string;
    files: { path: string; bytes: number; sha256: string }[];
  };
  expect(selected.entry).toBe(entry);
  expect(selected.sourceCommit).toBe("5ae40adfc4421a57242fb258e244bc51030ed3e0");
  expect(selected.files.some((f) => f.path === entry)).toBe(true);
  expect(selected.files.length).toBeGreaterThan(72);
  for (const file of selected.files) {
    const actual = await readFile(file.path);
    expect(actual.length, file.path).toBe(file.bytes);
    expect(createHash("sha256").update(actual).digest("hex"), file.path).toBe(file.sha256);
  }
  return {
    kind: "packed-installed",
    sourceCommit: selected.sourceCommit,
    files: selected.files.length,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
    entrySha256: createHash("sha256").update(raw).digest("hex"),
  };
}
// Adapted from reference-startup-cli.test.ts: ordinary argv, no private IPC.
function launch(configFile: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("BDP_")),
  );
  const child = spawn(process.execPath, [entry, "--serve", "--config", configFile], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[][] = [[], []];
  const counts = [0, 0];
  let overflow = false,
    forced = false;
  [child.stdout, child.stderr].forEach((stream, i) => {
    stream.on("data", (b: Buffer) => {
      const list = chunks[i];
      if (!list) throw new Error("channel missing");
      list.push(Buffer.from(b));
      counts[i] = (counts[i] ?? 0) + b.length;
      if ((counts[i] ?? 0) > 65536) {
        overflow = true;
        child.kill("SIGKILL");
      }
    });
  });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  const watchdog = setTimeout(() => {
    forced = true;
    child.kill("SIGKILL");
  }, 15000);
  void done.then(
    () => clearTimeout(watchdog),
    () => clearTimeout(watchdog),
  );
  const output = () => chunks.map((c) => Buffer.concat(c).toString("utf8"));
  return {
    async ready() {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const lines = (output()[1] ?? "").split("\n");
        lines.pop();
        for (const line of lines.filter(Boolean)) {
          const row = object(JSON.parse(line));
          if (row.event === "server.started") return row;
        }
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error("ordinary installed startup exited before ready");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("ordinary installed startup readiness deadline");
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const status = await done;
      expect(overflow).toBe(false);
      expect(forced).toBe(false);
      return {
        ...status,
        overflow,
        forced,
        stdout: output()[0],
        stderr: output()[1],
        bothEOF: child.stdout.readableEnded && child.stderr.readableEnded,
        directChildReaped: child.exitCode !== null,
      };
    },
  };
}

it("ordinary installed TX keeps principal-owned receipts and exact replay across create:false reopen", async () => {
  const identity = await runtimeIdentity();
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-ownership-recovery-"));
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error("ownership recovery cohort deadline")),
    30000,
  );
  const tokens = {
    alice: randomBytes(32).toString("base64url"),
    bob: randomBytes(32).toString("base64url"),
  };
  const observations: unknown[] = [],
    generations: unknown[] = [],
    failures: unknown[] = [];
  let child: ReturnType<typeof launch> | undefined,
    complete = false;
  try {
    const port = await availablePort(),
      scope = `http://127.0.0.1:${port}/acme/`;
    const store = path.join(directory, "store");
    await mkdir(store, { mode: 0o700 });
    const type = `${scope}types/bead`,
      schema = `${scope}schemas/n`;
    const artifacts = {
      descriptors: [
        {
          retrievalUri: type,
          utf8: JSON.stringify({
            id: type,
            name: "Bead",
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
            properties: { n: { type: "integer" } },
            required: ["n"],
            additionalProperties: false,
          }),
        },
      ],
    };
    const deploymentFile = path.join(directory, "deployment.json"),
      configFile = path.join(directory, "startup.json");
    const config = {
      scope: { url: scope },
      server: {
        host: "127.0.0.1",
        port,
        advertisedProfile: "transactional",
        limits: {
          page: { defaultItems: 2, maximumItems: 32 },
          selector: { bytes: 4096, depth: 32, nodes: 256 },
          cursorTtlMilliseconds: 1000,
        },
      },
      bdptest: { deploymentFile },
    };
    await writeFile(configFile, JSON.stringify(config));
    const start = async (create: boolean) => {
      await writeFile(
        deploymentFile,
        JSON.stringify({
          format: "bdptest-reference-deployment-1",
          profile: "transactional",
          configuration: {
            directory: store,
            create,
            credentials: Object.entries(tokens).map(([principal, token]) => ({
              principal,
              token,
              canMutate: true,
            })),
            artifacts,
          },
        }),
        { mode: 0o600 },
      );
      child = launch(configFile);
      const ready = await child.ready();
      expect(ready).toMatchObject({ scope, profile: "transactional", claimEligible: false });
      generations.push({ create, ready });
    };
    let requests = 0;
    const send = async (
      principal: keyof typeof tokens,
      target: string,
      method: "GET" | "HEAD" | "POST" = "GET",
      body?: unknown,
      key?: string,
      status = 200,
    ) => {
      if (++requests > 40) throw new Error("ownership recovery request ceiling");
      const url = new URL(target, scope).href;
      if (!url.startsWith(scope)) throw new Error("discovered URL escaped Scope");
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: "127.0.0.1", port },
        {
          requestTimeoutMs: 3000,
          maximumBodyBytes: 1048576,
          exactMode: {
            scope,
            profile: "transactional",
            routes: [{ method, url }],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: principal,
            credentialHandles: [{ id: principal, headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${tokens[principal]}` }),
          },
        },
      );
      const bodyText = body === undefined ? undefined : JSON.stringify(body);
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: principal,
        raw: {
          headerLines:
            body === undefined
              ? []
              : [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: key ?? "shared-key" },
                ],
          ...(bodyText === undefined ? {} : { bodyBytes: Buffer.from(bodyText) }),
        },
      });
      expect(response.status, response.bodyText).toBe(status);
      expect(response.exactRequest?.writeState).toBe("complete");
      if (!response.wireResponseBytes || !response.exactRequest)
        throw new Error("missing complete HTTP wire response or request observation");
      // Never serialize exactRequest.headerLines: they contain resolved credentials.
      observations.push({
        principal,
        method,
        url,
        requestBody: bodyText,
        requestWriteState: response.exactRequest.writeState,
        requestHeaderNames: response.exactRequest.headerLines.map((h) => h.name),
        status: response.status,
        headers: response.headers,
        body: response.bodyText,
        wireResponseBase64: Buffer.from(response.wireResponseBytes).toString("base64"),
      });
      return response;
    };
    await start(true);
    const probe = await send("alice", scope, "GET", undefined, undefined, 204);
    expect(probe.status).toBe(204);
    responseContext(probe.headers, "pos-0");
    const match = /^<([^>]+)>; rel="service-desc"; type="application\/json"$/.exec(
      probe.headers.link ?? "",
    );
    if (!match?.[1]) throw new Error("missing discovery Link");
    const descriptorUrl = new URL(match[1], scope).href;
    const discovery = object(JSON.parse((await send("alice", descriptorUrl)).bodyText));
    const operationsUrl = new URL(text(discovery.operations), descriptorUrl).href;
    const operations = object(JSON.parse((await send("alice", operationsUrl)).bodyText));
    const types = object(
      JSON.parse(
        (await send("alice", new URL(text(discovery.types), descriptorUrl).href)).bodyText,
      ),
    );
    if (!Array.isArray(types.items)) throw new Error("missing discovered Types");
    const bead = types.items.map(object).find((t) => t.describes === "bead");
    if (!bead) throw new Error("missing discovered Bead Type");
    const createUrl = new URL(text(operations.createBead), operationsUrl).href;
    const collectionUrl = new URL(text(discovery.beads), descriptorUrl).href;
    const commands = {
      alice: {
        id: new URL("alice", collectionUrl).href,
        type: text(bead.id),
        properties: { n: 1 },
      },
      bob: { id: new URL("bob", collectionUrl).href, type: text(bead.id), properties: { n: 2 } },
    };
    const initial: Record<string, { body: Record<string, unknown>; text: string }> = {};
    for (const principal of ["alice", "bob"] as const) {
      const response = await send(principal, createUrl, "POST", commands[principal]);
      const receipt = object(JSON.parse(response.bodyText));
      expect(receipt.status).toBe("completed");
      expect(receipt.idempotencyKey).toBe("shared-key");
      initial[principal] = { body: receipt, text: response.bodyText };
    }
    const alice = initial.alice,
      bob = initial.bob;
    if (!alice || !bob) throw new Error("missing original receipts");
    expect(alice.body.id).not.toBe(bob.body.id);
    expect(alice.body.transaction).not.toBe(bob.body.transaction);
    for (const [owner, other] of [
      ["alice", "bob"],
      ["bob", "alice"],
    ] as const) {
      const original = initial[owner];
      if (!original) throw new Error("missing owner receipt");
      expect((await send(owner, text(original.body.id))).bodyText).toBe(original.text);
      expect((await send(owner, text(original.body.id), "HEAD")).bodyText).toBe("");
      const refusal = await send(other, text(original.body.id), "GET", undefined, undefined, 404);
      expect(object(JSON.parse(refusal.bodyText)).code).toBe("resource-not-found");
      await send(other, text(original.body.id), "HEAD", undefined, undefined, 404);
    }
    const before = await send("alice", scope, "GET", undefined, undefined, 204);
    const beforeContext = responseContext(before.headers, "pos-2");
    const first = await child?.close();
    child = undefined;
    expect(first).toMatchObject({ code: 0, signal: null, bothEOF: true, directChildReaped: true });
    generations.push(first);
    await start(false);
    const reopened = await send("alice", scope, "GET", undefined, undefined, 204);
    expect(responseContext(reopened.headers, "pos-2")).toEqual(beforeContext);
    for (const [owner, other] of [
      ["alice", "bob"],
      ["bob", "alice"],
    ] as const) {
      const original = initial[owner];
      if (!original) throw new Error("missing owner receipt");
      expect((await send(owner, createUrl, "POST", commands[owner])).bodyText).toBe(original.text);
      expect((await send(owner, text(original.body.id))).bodyText).toBe(original.text);
      expect(
        object(
          JSON.parse(
            (await send(other, text(original.body.id), "GET", undefined, undefined, 404)).bodyText,
          ),
        ).code,
      ).toBe("resource-not-found");
      const resource = object(JSON.parse((await send(owner, commands[owner].id)).bodyText));
      expect(resource.properties).toEqual(commands[owner].properties);
      const conflict = await send(
        owner,
        createUrl,
        "POST",
        { ...commands[owner], properties: { n: 99 } },
        "shared-key",
        409,
      );
      expect(object(JSON.parse(conflict.bodyText)).code).toBe("idempotency-conflict");
      expect((await send(owner, text(original.body.id))).bodyText).toBe(original.text);
    }
    const after = await send("bob", scope, "GET", undefined, undefined, 204);
    expect(responseContext(after.headers, "pos-2")).toEqual(beforeContext);
    complete = true;
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(deadline);
    if (child) {
      try {
        const stopped = await child.close();
        generations.push(stopped);
        expect(stopped).toMatchObject({
          code: 0,
          signal: null,
          bothEOF: true,
          directChildReaped: true,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    const report = {
      observation: "ordinary-installed-TX-principal-ownership-reopen",
      identity,
      generations,
      observations,
      complete,
      failureCount: failures.length,
      directoryRetained: failures.length > 0 ? directory : undefined,
    };
    const encoded = JSON.stringify(report);
    for (const token of Object.values(tokens))
      if (encoded.includes(token)) failures.push(new Error("credential escaped observation"));
    if (!failures.length) await rm(directory, { recursive: true, force: true });
    console.log(
      Object.values(tokens).some((token) => encoded.includes(token))
        ? JSON.stringify({ observation: report.observation, credentialLeak: true })
        : encoded,
    );
  }
  if (failures.length)
    throw new AggregateError(failures, "installed ownership/recovery cohort failed");
}, 40000);
