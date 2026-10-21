/** Core Read incident directions over actual installed TX HTTP; partial clause coverage. */
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
import { createJsonSchemaValidator, createRawHttpExchangeExecutor } from "@bdp/conformance";
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
  ): Promise<{
    child: ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const scope = "https://reference.invalid/acme/",
  type = `${scope}types/task`,
  linkType = `${scope}types/relationship`;
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected record");
  return value as Record<string, unknown>;
}
function context(headers: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(
    contextNames.map((name) => {
      const value = headers[name];
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value))
        throw new Error(`invalid context: ${name}`);
      return [name, value];
    }),
  );
}
function page(actual: unknown, expected: readonly unknown[]) {
  const value = object(actual);
  expect(Object.keys(value).sort()).toEqual(["items", "next"]);
  expect(value.next).toBeNull();
  // Expected complete records originate in the public mutation receipt, checked
  // against the independently authored setup before any incident read occurs.
  expect(value.items).toEqual(expected);
}

it("incident direction oracle rejects swapped sets, duplicated self, endpoint and revision corruption", () => {
  const a = {
    id: `${scope}links/a-out`,
    source: `${scope}beads/a`,
    target: `${scope}beads/b`,
    revision: "r-out",
  };
  const self = {
    id: `${scope}links/m-self`,
    source: `${scope}beads/a`,
    target: `${scope}beads/a`,
    revision: "r-self",
  };
  const incoming = {
    id: `${scope}links/z-in`,
    source: `${scope}beads/b`,
    target: `${scope}beads/a`,
    revision: "r-in",
  };
  const expected = [self, incoming];
  page({ items: expected, next: null }, expected);
  for (const items of [
    [a, self],
    [self, self, incoming],
    [{ ...self, target: `${scope}beads/b` }, incoming],
    [{ ...self, revision: "wrong" }, incoming],
    [incoming, self],
    [self],
  ])
    expect(() => page({ items, next: null }, expected)).toThrow();
});

it("installed nonempty incident inbound/outbound/both/default and HEAD share exact canonical Link sets", async () => {
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
  const fixture = {
    bytes: readFileSync(
      path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
    ),
  };
  const schema = createJsonSchemaValidator(
    JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8")),
  );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-incident-read-")),
    controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("incident Read cohort deadline")),
    30000,
  );
  const token = randomBytes(32).toString("base64url"),
    propertiesSchema = `${scope}schemas/title`;
  const artifacts = {
    descriptors: [
      { id: type, name: "Task", describes: "bead", conformsTo: [], propertiesSchema },
      {
        id: linkType,
        name: "Relationship",
        describes: "link",
        conformsTo: [],
        propertiesSchema,
        source: { conformsTo: [type], external: "none" },
        target: { conformsTo: [type], external: "none" },
      },
    ].map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
    schemas: [
      {
        retrievalUri: propertiesSchema,
        utf8: JSON.stringify({
          $id: propertiesSchema,
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
          additionalProperties: false,
        }),
      },
    ],
  };
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts,
    credentials: [{ token, principal: "writer", canMutate: true }],
  };
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let childClosed: Promise<void> | undefined, binding: unknown, failure: unknown;
  const cleanupErrors: unknown[] = [],
    observations: unknown[] = [];
  const childChannels = { stdout: [] as string[], stderr: [] as string[] };
  let directoryAbsent = false;
  try {
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
    childClosed = new Promise((resolve) => child?.child.once("close", () => resolve()));
    child.child.stdout?.on("data", (chunk: Buffer) =>
      childChannels.stdout.push(chunk.toString("base64")),
    );
    child.child.stderr?.on("data", (chunk: Buffer) =>
      childChannels.stderr.push(chunk.toString("base64")),
    );
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    const address = new URL(child.ready.listenUrl as string);
    const suffixes = [
      "?view=links&direction=inbound&limit=32",
      "?view=links&direction=outbound&limit=32",
      "?view=links&direction=both&limit=32",
      "?view=links&limit=32",
    ];
    const routes = new Set([
      `${scope}bdp.json`,
      `${scope}operations/batch`,
      ...suffixes.map((suffix) => `${scope}beads/a${suffix}`),
    ]);
    let attempts = 0;
    const exchange = async (method: "GET" | "HEAD" | "POST", url: string, body?: unknown) => {
      if (++attempts > 10 || !routes.has(url)) throw new Error("undeclared incident exchange");
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
            defaultCredentialRef: "writer",
            credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
          },
        },
      );
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: "writer",
        raw: {
          headerLines: [
            { name: "accept", value: "application/json" },
            ...(bytes === undefined
              ? []
              : [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: "incident-read-seed" },
                ]),
          ],
          ...(bytes === undefined ? {} : { bodyBytes: bytes }),
        },
      });
      observations.push({
        method,
        url,
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
      expect(response.status, response.bodyText).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      return response;
    };
    const discovery = await exchange("GET", `${scope}bdp.json`),
      document = JSON.parse(discovery.bodyText);
    expect(schema.validate("#/$defs/transactionalDiscovery", document)).toEqual([]);
    expect(context(discovery.headers)["bdp-scope-position"]).toBe("pos-0");
    expect(document.limits.page.maximumItems).toBeGreaterThanOrEqual(32);
    const authored = [
      { id: "links/z-in", source: "beads/b", target: "beads/a", title: "incoming" },
      { id: "links/a-out", source: "beads/a", target: "beads/b", title: "outgoing" },
      { id: "links/m-self", source: "beads/a", target: "beads/a", title: "self" },
    ];
    const seeded = await exchange("POST", `${scope}operations/batch`, {
      operations: [
        ...["a", "b"].map((id) => ({
          operation: "createBead",
          id: `beads/${id}`,
          type,
          properties: { title: id },
          metadata: {},
        })),
        ...authored.map(({ id, source, target, title }) => ({
          operation: "createLink",
          id,
          type: linkType,
          source,
          target,
          properties: { title },
          metadata: {},
        })),
      ],
    });
    const receipt = object(JSON.parse(seeded.bodyText));
    expect(schema.validate("#/$defs/mutationReceipt", receipt)).toEqual([]);
    expect(receipt.status).toBe("completed");
    expect(Array.isArray(receipt.results)).toBe(true);
    const results = receipt.results as Record<string, unknown>[];
    expect(results).toHaveLength(5);
    const records = authored.map((expected, index) => {
      const result = object(results[index + 2]);
      expect(result.operationIndex).toBe(index + 2);
      expect(result.outcome).toBe("created");
      const record = object(result.resource);
      expect(schema.validate("#/$defs/currentLinkRecord", record)).toEqual([]);
      expect(record).toMatchObject({
        id: scope + expected.id,
        type: linkType,
        source: scope + expected.source,
        target: scope + expected.target,
        properties: { title: expected.title },
        metadata: {},
      });
      expect(typeof record.revision).toBe("string");
      expect(String(record.revision).length).toBeGreaterThan(0);
      return record;
    });
    const incoming = records[0],
      outgoing = records[1],
      self = records[2];
    const expectedSets = [
      [self, incoming],
      [outgoing, self],
      [outgoing, self, incoming],
      [outgoing, self, incoming],
    ];
    const expectedContext = context(seeded.headers);
    expect(expectedContext["bdp-scope-position"]).toBe("pos-1");
    for (const [index, suffix] of suffixes.entries()) {
      const url = `${scope}beads/a${suffix}`;
      const get = await exchange("GET", url);
      expect(context(get.headers)).toEqual(expectedContext);
      const body = JSON.parse(get.bodyText);
      page(body, expectedSets[index] ?? []);
      for (const record of object(body).items as unknown[])
        expect(schema.validate("#/$defs/currentLinkRecord", record)).toEqual([]);
      const head = await exchange("HEAD", url);
      expect(head.bodyOctets).toBe(0);
      expect(head.bodyText).toBe("");
      expect(context(head.headers)).toEqual(expectedContext);
      for (const name of [
        "content-type",
        "content-length",
        "cache-control",
        "etag",
        "last-modified",
        ...contextNames,
      ])
        expect(head.headers[name]).toBe(get.headers[name]);
    }
    expect(attempts).toBe(10);
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
    try {
      await child?.close();
      await childClosed;
      expect(child?.child.exitCode).toBe(0);
      expect(child?.child.signalCode).toBeNull();
      expect(child?.child.stdout?.readableEnded).toBe(true);
      expect(child?.child.stderr?.readableEnded).toBe(true);
      rmSync(directory, { recursive: true, force: false });
      directoryAbsent = !existsSync(directory);
      expect(directoryAbsent).toBe(true);
    } catch (error) {
      cleanupErrors.push(error);
    }
    const report = {
      kind: "installed-incident-directions-partial",
      sourceCommit,
      entry,
      entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
      binding,
      configuration: {
        ...configuration,
        credentials: configuration.credentials.map(({ principal, canMutate }) => ({
          principal,
          canMutate,
          token: "<redacted>",
        })),
      },
      observations,
      childChannels,
      child: {
        pid: child?.child.pid,
        exit: child?.child.exitCode,
        signal: child?.child.signalCode,
        stdoutEOF: child?.child.stdout?.readableEnded,
        stderrEOF: child?.child.stderr?.readableEnded,
      },
      directoryAbsent,
      failureCount: (failure === undefined ? 0 : 1) + cleanupErrors.length,
      wholeContract: false,
      claimEligible: false,
    };
    if (process.env.BDP_INCIDENT_READ_OUTPUT)
      writeFileSync(process.env.BDP_INCIDENT_READ_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, {
        mode: 0o600,
      });
    console.log(
      JSON.stringify({
        kind: report.kind,
        requests: observations.length,
        child: report.child,
        directoryAbsent,
        failureCount: report.failureCount,
        claimEligible: false,
      }),
    );
  }
  if (failure !== undefined || cleanupErrors.length)
    throw new AggregateError(
      [...(failure === undefined ? [] : [failure]), ...cleanupErrors],
      "installed incident Read failed",
    );
}, 45000);
