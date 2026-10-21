/** Clause-specific inherited RU behavior on actual installed TX; not profile qualification. */
import { type ChildProcess, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createJsonSchemaValidator,
  createRawHttpExchangeExecutor,
  type HttpExchangeResponse,
  type HttpMethod,
} from "@bdp/conformance";
import { parseTransactionalDiscovery, parseTransactionalOperationDirectory } from "@bdp/protocol";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal: AbortSignal,
  ): Promise<{ child: ChildProcess; ready: Record<string, unknown>; close(): Promise<void> }>;
};
const scope = "https://reference.invalid/acme/",
  type = `${scope}types/task`;
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
function context(response: Pick<HttpExchangeResponse, "headers">, position: string) {
  for (const name of contextNames) expect(response.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(response.headers["bdp-scope-position"]).toBe(position);
}
function limitProblem(response: Pick<HttpExchangeResponse, "status" | "headers" | "bodyText">) {
  expect(response.status).toBe(413);
  expect(response.headers["content-type"]).toBe("application/problem+json");
  expect(JSON.parse(response.bodyText)).toMatchObject({
    code: "limit-exceeded",
    status: 413,
    retry: "never",
  });
}
function page(value: unknown, expected: unknown[], more: boolean) {
  expect(value).toMatchObject({ items: expected });
  const result = value as { items: unknown[]; next: unknown };
  expect(result.items).toEqual(expected);
  if (more) {
    expect(typeof result.next).toBe("string");
    const next = new URL(result.next as string);
    expect(next.origin).toBe(new URL(scope).origin);
    expect(next.pathname).toBe("/acme/beads/");
    expect(next.hash + next.username + next.password).toBe("");
  } else expect(result.next).toBeNull();
}
it("Read limit negative oracles reject truncation, false continuation and nonnormative refusal", () => {
  const expected = [{ id: scope + "beads/a" }];
  page({ items: expected, next: null }, expected, false);
  for (const value of [
    { items: [], next: null },
    { items: expected, next: scope + "beads/?cursor=x" },
  ])
    expect(() => page(value, expected, false)).toThrow();
  expect(() => page({ items: expected, next: null }, expected, true)).toThrow();
  expect(() =>
    page({ items: expected, next: "https://foreign.invalid/beads/" }, expected, true),
  ).toThrow();
  const valid = {
    status: 413,
    headers: { "content-type": "application/problem+json" },
    bodyText: JSON.stringify({ code: "limit-exceeded", status: 413, retry: "never" }),
  };
  limitProblem(valid);
  for (const bad of [
    { ...valid, status: 200 },
    {
      ...valid,
      bodyText: JSON.stringify({ code: "invalid-parameter", status: 413, retry: "never" }),
    },
  ])
    expect(() => limitProblem(bad)).toThrow();
});

type Session = {
  exchange(
    method: HttpMethod,
    url: string,
    body?: unknown,
    key?: string,
    anonymous?: boolean,
  ): Promise<HttpExchangeResponse>;
  targets: Record<string, string>;
  schema: ReturnType<typeof createJsonSchemaValidator>;
};
async function installed(label: string, body: (session: Session) => Promise<void>) {
  const entry = realpathSync(
    process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
      path.join(root, "packages/server/dist/transaction-installed-process.js"),
  );
  if (
    Boolean(process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY) !==
    Boolean(process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  )
    throw new Error("paired installed source overrides required");
  const sourceCommit =
    process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const schema = createJsonSchemaValidator(
    JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8")),
  );
  const fixture = {
    bytes: readFileSync(
      path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
    ),
  };
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-read-limits-")),
    controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("read limits cohort deadline")), 30000);
  const token = randomBytes(32).toString("base64url"),
    schemaUri = `${scope}schemas/title`;
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
            propertiesSchema: schemaUri,
          }),
        },
      ],
      schemas: [
        {
          retrievalUri: schemaUri,
          utf8: JSON.stringify({
            $id: schemaUri,
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          }),
        },
      ],
    },
  };
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined,
    childClosed: Promise<void> | undefined,
    binding: unknown,
    failure: unknown;
  const observations: unknown[] = [],
    cleanupErrors: unknown[] = [];
  const channels = { stdout: [] as string[], stderr: [] as string[] };
  try {
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
    childClosed = new Promise((resolve) => child?.child.once("close", () => resolve()));
    child.child.stdout?.on("data", (chunk: Buffer) =>
      channels.stdout.push(chunk.toString("base64")),
    );
    child.child.stderr?.on("data", (chunk: Buffer) =>
      channels.stderr.push(chunk.toString("base64")),
    );
    const bound = installedTransactionBinding(child.ready, sourceCommit, fixture);
    binding = bound;
    const dial = new URL(child.ready.listenUrl as string);
    const exchange: Session["exchange"] = async (method, url, input, key, anonymous = false) => {
      if (observations.length >= 100) throw new Error("read limits request bound");
      const credentialRef = anonymous ? "anonymous" : "writer";
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: dial.hostname, port: Number(dial.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 131072,
          exactMode: {
            scope,
            profile: "transactional",
            routes: [{ method, url }],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: credentialRef,
            credentialHandles: [
              { id: "writer", headerNames: ["authorization"] },
              { id: "anonymous", headerNames: [] },
            ],
            resolveCredentials: ({ credentialRef: selected }) =>
              selected === "anonymous" ? {} : { authorization: `Bearer ${token}` },
          },
        },
      );
      const bytes = input === undefined ? undefined : Buffer.from(JSON.stringify(input));
      const response = await execute({
        method,
        url,
        credentialRef,
        signal: controller.signal,
        raw: {
          headerLines: [
            { name: "accept", value: "application/json" },
            ...(bytes === undefined
              ? []
              : [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: key ?? "unused" },
                ]),
          ],
          ...(bytes === undefined ? {} : { bodyBytes: bytes }),
        },
      });
      observations.push({
        method,
        url,
        anonymous,
        key,
        requestBody: bytes?.toString(),
        requestHeaders: response.exactRequest?.headerLines.filter(
          (h) => h.name.toLowerCase() !== "authorization",
        ),
        status: response.status,
        headers: response.headers,
        bodyText: response.bodyText,
        bodyOctets: response.bodyOctets,
        wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
        writeState: response.exactRequest?.writeState,
      });
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      return response;
    };
    const discovery = await exchange("GET", `${scope}bdp.json`);
    expect(discovery.status).toBe(200);
    const document = parseTransactionalDiscovery(JSON.parse(discovery.bodyText));
    context(discovery, "pos-0");
    const directoryResponse = await exchange("GET", document.operations);
    expect(directoryResponse.status).toBe(200);
    const declaredTargets = parseTransactionalOperationDirectory(
      JSON.parse(directoryResponse.bodyText),
    );
    const targets = Object.fromEntries(
      Object.entries(declaredTargets).map(([name, reference]) => [
        name,
        new URL(reference, document.operations).href,
      ]),
    );
    expect(targets).toEqual(bound.operationTargets);
    expect(Object.keys(targets)).toHaveLength(12);
    await body({ exchange, targets: targets as unknown as Record<string, string>, schema });
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
    try {
      await child?.close();
      await childClosed;
      expect(child?.child.exitCode).toBe(0);
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    const report = {
      kind: "installed-read-limits-partial",
      label,
      sourceCommit,
      entry,
      entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
      binding,
      configuration: {
        ...configuration,
        credentials: [{ principal: "writer", canMutate: true, token: "<redacted>" }],
      },
      observations,
      channels,
      child: {
        pid: child?.child.pid,
        exit: child?.child.exitCode,
        signal: child?.child.signalCode,
        stdoutEOF: child?.child.stdout?.readableEnded,
        stderrEOF: child?.child.stderr?.readableEnded,
      },
      directoryAbsent: !existsSync(directory),
      failureCount: (failure === undefined ? 0 : 1) + cleanupErrors.length,
      claimEligible: false,
      wholeContract: false,
    };
    if (process.env.BDP_READ_LIMITS_OUTPUT)
      writeFileSync(
        `${process.env.BDP_READ_LIMITS_OUTPUT}-${label}.json`,
        `${JSON.stringify(report, null, 2)}\n`,
        { mode: 0o600 },
      );
    console.log(
      JSON.stringify({
        kind: report.kind,
        label,
        requests: observations.length,
        child: report.child,
        directoryAbsent: report.directoryAbsent,
        failureCount: report.failureCount,
      }),
    );
  }
  if (failure !== undefined || cleanupErrors.length)
    throw new AggregateError(
      [...(failure === undefined ? [] : [failure]), ...cleanupErrors],
      "installed read limits failed",
    );
}
it(
  "installed Read discovery limits bind collection default/max pages and Selector bytes/depth/nodes",
  () =>
    installed("read-boundaries", async ({ exchange, targets, schema }) => {
      const discoveryResponse = await exchange("GET", scope + "bdp.json");
      const discovery = JSON.parse(discoveryResponse.bodyText);
      expect(discovery.limits).toEqual({
        page: { defaultItems: 2, maximumItems: 32 },
        selector: { bytes: 4096, depth: 32, nodes: 256 },
        validation: { diagnostics: 16, diagnosticBytes: 524288 },
      });
      for (const omitted of ["request", "resource", "retention"])
        expect(discovery.limits).not.toHaveProperty(omitted);
      expect(discovery).not.toHaveProperty("order");
      expect(discovery).not.toHaveProperty("maximumEndpointMultiplicity");
      expect(discovery).not.toHaveProperty("historicalResolution");
      const expected: Record<string, unknown>[] = [];
      for (const [batch, count] of [
        [0, 32],
        [1, 1],
      ]) {
        const operations = Array.from({ length: count! }, (_, offset) => {
          const suffix = String(batch! * 32 + offset).padStart(2, "0");
          return {
            operation: "createBead",
            id: `beads/limit-${suffix}`,
            type,
            properties: { title: suffix },
            metadata: {},
          };
        });
        const response = await exchange("POST", targets.batch!, { operations }, `seed-${batch}`);
        expect(response.status).toBe(200);
        const receipt = JSON.parse(response.bodyText);
        expect(schema.validate("#/$defs/mutationReceipt", receipt)).toEqual([]);
        expect(receipt.status).toBe("completed");
        expect(receipt.results).toHaveLength(count!);
        for (const [i, result] of receipt.results.entries()) {
          expect(result.outcome).toBe("created");
          expect(result.resource).toEqual({
            id: scope + operations[i]!.id,
            type,
            revision: expect.any(String),
            properties: operations[i]!.properties,
            metadata: {},
          });
          expected.push(result.resource);
        }
      }
      const get = async (url: string) => {
        const response = await exchange("GET", url);
        expect(response.status).toBe(200);
        context(response, "pos-2");
        const value = JSON.parse(response.bodyText);
        expect(schema.validate("#/$defs/beadCollection", value)).toEqual([]);
        return value;
      };
      page(await get(discovery.beads), expected.slice(0, 2), true);
      const maximum = await get(discovery.beads + "?limit=32");
      page(maximum, expected.slice(0, 32), true);
      page(await get(maximum.next), expected.slice(32), false);
      limitProblem(await exchange("GET", discovery.beads + "?limit=33"));
      const bytes = (n: number) => `$[?@.missing${" ".repeat(n - 13)}]`;
      const depth = (n: number) => `$[?${"(".repeat(n)}@.missing${")".repeat(n)}]`;
      const nodes = (n: number) => {
        let term = "@.missing";
        for (let i = 0; i < 6; i++) term = `(${term}||${term})`;
        return `$[?${"(".repeat(n)}${term}${")".repeat(n)}]`;
      };
      for (const [accepted, refused] of [
        [bytes(4096), bytes(4097)],
        [depth(30), depth(31)],
        [nodes(2), nodes(3)],
      ]) {
        page(await get(discovery.beads + "?selector=" + encodeURIComponent(accepted!)), [], false);
        limitProblem(
          await exchange("GET", discovery.beads + "?selector=" + encodeURIComponent(refused!)),
        );
      }
    }),
  30000,
);
