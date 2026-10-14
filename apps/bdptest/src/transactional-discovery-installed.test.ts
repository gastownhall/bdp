/** Bounded private installed discovery-boundary observations, not discovery or profile qualification. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal: AbortSignal,
  ): Promise<{
    child: ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("installed discovery override requires explicit source commit");
const source =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const scope = "https://reference.invalid/acme/",
  bead = `${scope}types/bead`,
  schema = `${scope}schemas/n`;
const artifacts = {
  descriptors: [
    {
      retrievalUri: bead,
      utf8: JSON.stringify({
        id: bead,
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
        properties: { n: { type: "number" } },
        required: ["n"],
        additionalProperties: false,
      }),
    },
  ],
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
ajv.addSchema(bundle);
const receiptSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceipt` });
const beadSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/currentBeadRecord` });
it("keeps installed discovery private while the same actual owner writes, reads and replays", async () => {
  // Bounded C3 fixture: 45s aggregate, 60s outer, 5s/exchange, launcher 10s.
  // Candidate assembly is tested directly; these are real refusal/writer paths,
  // not a claim that the installed client can discover the private service.
  const controller = new AbortController(),
    timer = setTimeout(
      () => controller.abort(new Error("installed discovery boundary deadline")),
      45000,
    );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-discovery-installed-")),
    token = randomBytes(32).toString("base64url");
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  const observations: {
      method: string;
      url: string;
      status: number;
      bodyOctets: number | undefined;
      bodySha256: string;
      wireSha256: string;
    }[] = [],
    failures: unknown[] = [];
  let session: { pid: number | undefined; exit: number | null } | undefined;
  const targets = new Set(["", "bdp.json", "operations/", "operations/batch", "beads/a"]);
  async function exchange(
    relative: string,
    method: "GET" | "HEAD" | "POST",
    authenticated: boolean,
    expectedStatus: number,
    input?: unknown,
  ) {
    if (!targets.has(relative) || !child) throw new Error("unbound installed discovery request");
    expect(observations.length).toBeLessThan(16);
    const url = `${scope}${relative}`,
      address = new URL(child.ready.listenUrl as string);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: authenticated ? "writer" : "anonymous",
          credentialHandles: [
            { id: "writer", headerNames: ["authorization"] },
            { id: "anonymous", headerNames: [] },
          ],
          resolveCredentials: ({ credentialRef }) =>
            credentialRef === "writer" ? { authorization: `Bearer ${token}` } : {},
        },
      },
    );
    const response = await execute({
      method,
      url,
      signal: controller.signal,
      ...(authenticated ? { credentialRef: "writer" } : {}),
      raw: {
        headerLines:
          input === undefined
            ? []
            : [
                { name: "content-type", value: "application/json" },
                { name: "idempotency-key", value: "discovery-create" },
              ],
        ...(input === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(input)) }),
      },
    });
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(
      response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
    ).toBe("reference.invalid");
    if (!response.wireResponseBytes?.length) throw new Error("missing actual wire response");
    expect(response.bodyOctets).toBe(Buffer.byteLength(response.bodyText));
    observations.push({
      method,
      url,
      status: response.status,
      bodyOctets: response.bodyOctets,
      bodySha256: hash(response.bodyText),
      wireSha256: hash(response.wireResponseBytes),
    });
    expect(response.status).toBe(expectedStatus);
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    return response;
  }
  try {
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [{ token, principal: "writer", canMutate: true }],
      },
      controller.signal,
    );
    binding = installedTransactionBinding(child.ready, source, fixture);
    expect(child.ready).toMatchObject({
      profile: "transactional",
      history: false,
      claimEligible: false,
    });
    for (const method of ["GET", "HEAD"] as const)
      for (const route of ["", "bdp.json", "operations/"]) {
        const response = await exchange(route, method, true, 500);
        expect(response.headers["x-bdp-development-limit"]).toBe("transactional-discovery");
        expect(response.headers.link).toBeUndefined();
        expect(response.bodyText).toBe("");
      }
    for (const route of ["", "bdp.json", "operations/"]) {
      const response = await exchange(route, "GET", false, 401);
      expect(response.headers.link).toBeUndefined();
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(response.headers[name]).toBeUndefined();
      expect(response.bodyText).not.toContain(`${scope}operations/`);
    }
    const input = {
      operations: [{ operation: "createBead", id: "beads/a", type: bead, properties: { n: 1 } }],
    };
    const first = await exchange("operations/batch", "POST", true, 200, input),
      receipt = JSON.parse(first.bodyText);
    expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
    expect(receipt).toMatchObject({
      status: "completed",
      requiredPosition: "pos-1",
      next: null,
      results: [
        {
          operationIndex: 0,
          outcome: "created",
          resource: { id: `${scope}beads/a`, type: bead, properties: { n: 1 } },
        },
      ],
    });
    expect(receipt.results).toHaveLength(1);
    const after = await exchange("beads/a", "GET", true, 200),
      value = JSON.parse(after.bodyText);
    expect(beadSchema(value), JSON.stringify(beadSchema.errors)).toBe(true);
    expect(value).toMatchObject({ id: `${scope}beads/a`, type: bead, properties: { n: 1 } });
    expect(value).toEqual(receipt.results[0].resource);
    const retry = await exchange("operations/batch", "POST", true, 200, input);
    expect(JSON.parse(retry.bodyText)).toEqual(receipt);
    for (const response of [first, after, retry]) {
      expect(response.headers["bdp-scope-epoch"]).toMatch(/\S+/);
      expect(response.headers["bdp-authorization-view"]).toMatch(/\S+/);
      expect(response.headers["bdp-scope-position"]).toBe("pos-1");
    }
    expect(new Set(observations.map((o) => o.url))).toEqual(
      new Set([...targets].map((target) => `${scope}${target}`)),
    );
    expect(observations).toHaveLength(12);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    if (child) {
      try {
        await child.close();
      } catch (error) {
        failures.push(error);
      } finally {
        session = { pid: child.child.pid, exit: child.child.exitCode };
      }
    }
    clearTimeout(timer);
    rmSync(directory, { recursive: true, force: true });
    if (controller.signal.aborted && !failures.includes(controller.signal.reason))
      failures.push(controller.signal.reason);
    if (!failures.length) {
      try {
        expect(session?.exit).toBe(0);
        expect(session?.pid).toBeGreaterThan(0);
        expect(() => process.kill(session?.pid as number, 0)).toThrow();
      } catch (error) {
        failures.push(error);
      }
    }
    const report = {
      observation: "private-installed-discovery-boundary",
      declaredSourceCommit: source,
      workspaceDirty,
      entry,
      entrySha256: hash(readFileSync(entry)),
      binding,
      session,
      exchanges: observations.length,
      completedResponses: observations,
      outcome: failures.length ? "failed" : "passed",
      claimEligible: false,
    };
    const serialized = JSON.stringify(report);
    if (serialized.includes(token)) failures.push(new Error("unsafe observation report"));
    else console.log(serialized);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, "installed discovery boundary or cleanup failed");
}, 60000);
