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
const linkType = `${scope}types/relationship`,
  linkSchemaUri = `${scope}schemas/weight`;
type Resource = {
  id: string;
  type: string;
  revision: string;
  properties: Record<string, unknown>;
  metadata: Record<string, unknown>;
  source?: unknown;
  target?: unknown;
};
function recordOracle(
  response: Pick<HttpExchangeResponse, "status" | "headers" | "bodyText">,
  expected: Resource,
  bead: boolean,
) {
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toBe("application/json");
  expect(response.headers["cache-control"]).toBe("private, no-store");
  const actual = JSON.parse(response.bodyText);
  expect(actual).toEqual(expected);
  expect(actual.revision).toMatch(/^.+$/);
  expect(response.headers.etag).toBe(JSON.stringify(expected.revision));
  expect(actual).not.toHaveProperty("links");
  expect(actual).not.toHaveProperty("revisionProvenance"); // No native attribution is recorded in this target.
  if (bead) expect(actual).not.toHaveProperty("ownedLinks"); // This Type owns nothing.
  return actual as Resource;
}
function propertiesOracle(
  response: Pick<HttpExchangeResponse, "status" | "headers" | "bodyText">,
  expected: Resource,
) {
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toBe("application/json");
  expect(response.headers.etag).toBe(JSON.stringify(expected.revision));
  expect(JSON.parse(response.bodyText)).toEqual(expected.properties);
}
it("Read Resource negative oracles reject dropped open fields, metadata confusion, wrong pins and incident embedding", () => {
  const bead: Resource = {
    id: `${scope}beads/a`,
    type,
    revision: "r-a",
    properties: {
      title: "a",
      undeclared: { retain: [1, null, "x"] },
      metadata: { property: true },
    },
    metadata: { common: true },
  };
  const response = (r: Resource) => ({
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      etag: JSON.stringify(r.revision),
    },
    bodyText: JSON.stringify(r),
  });
  recordOracle(response(bead), bead, true);
  for (const wrong of [
    { ...bead, properties: { title: "a" } },
    { ...bead, metadata: {} },
    { ...bead, links: { items: [], next: null } },
    { ...bead, revisionProvenance: { actor: { id: "fabricated", basis: "writer-supplied" } } },
  ])
    expect(() => recordOracle(response(wrong), bead, true)).toThrow();
  const link: Resource = {
    ...bead,
    id: `${scope}links/l`,
    type: linkType,
    source: `${scope}beads/a`,
    target: { uri: `${scope}beads/b`, revision: "opaque+% /☃" },
  };
  recordOracle(response(link), link, false);
  for (const wrong of [
    { ...link, target: { uri: `${scope}beads/b`, revision: "changed" } },
    { ...link, source: `${scope}beads/b` },
  ])
    expect(() => recordOracle(response(wrong), link, false)).toThrow();
  const properties = { ...response(bead), bodyText: JSON.stringify(bead.properties) };
  propertiesOracle(properties, bead);
  for (const wrong of [
    response(bead),
    { ...properties, bodyText: JSON.stringify({ title: "a" }) },
    { ...properties, headers: { ...properties.headers, etag: '"other"' } },
  ])
    expect(() => propertiesOracle(wrong, bead)).toThrow();
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
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-read-resource-")),
    controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Read resource cohort deadline")),
    30000,
  );
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
        {
          retrievalUri: linkType,
          utf8: JSON.stringify({
            id: linkType,
            name: "Relationship",
            describes: "link",
            conformsTo: [],
            propertiesSchema: linkSchemaUri,
            source: { conformsTo: [type], external: "none" },
            target: { conformsTo: [type], external: "opaque" },
          }),
        },
      ],
      schemas: [
        {
          retrievalUri: linkSchemaUri,
          utf8: JSON.stringify({
            $id: linkSchemaUri,
            type: "object",
            properties: { weight: { type: "number" } },
            required: ["weight"],
            additionalProperties: true,
          }),
        },
        {
          retrievalUri: schemaUri,
          utf8: JSON.stringify({
            $id: schemaUri,
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: true,
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
      if (observations.length >= 100) throw new Error("Read resource request bound");
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
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    const report = {
      kind: "installed-read-resource-partial",
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
    if (process.env.BDP_READ_RESOURCE_OUTPUT)
      writeFileSync(
        `${process.env.BDP_READ_RESOURCE_OUTPUT}-${label}.json`,
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
      "installed Read resource failed",
    );
}
it(
  "installed Bead and Link reads preserve open state, common metadata, immutable pins and properties-view revisions",
  () =>
    installed("complete-records", async ({ exchange, targets, schema }) => {
      const beadProperties = {
        title: "before",
        undeclared: { nested: [1, null, "x"] },
        metadata: { domainProperty: true },
        revisionProvenance: { ordinaryProperty: true },
      };
      const commonMetadata = { flag: true, nested: { count: 3 } };
      const linkProperties = {
        weight: 1,
        undeclared: { values: [false, 2] },
        metadata: { propertyOnly: true },
      };
      const linkMetadata = { common: "link", nested: [1, 2] };
      async function write(operations: unknown[], key: string, position: string) {
        const response = await exchange("POST", targets.batch!, { operations }, key);
        expect(response.status).toBe(200);
        context(response, position);
        const receipt = JSON.parse(response.bodyText);
        expect(schema.validate("#/$defs/mutationReceipt", receipt)).toEqual([]);
        expect(receipt.status).toBe("completed");
        expect(receipt.results).toHaveLength(operations.length);
        return receipt.results.map((r: { resource: Resource }) => r.resource) as Resource[];
      }
      const [a, b] = await write(
        [
          {
            operation: "createBead",
            id: "beads/a",
            type,
            properties: beadProperties,
            metadata: commonMetadata,
          },
          {
            operation: "createBead",
            id: "beads/b",
            type,
            properties: { title: "target", unknown: true },
            metadata: {},
          },
        ],
        "beads",
        "pos-1",
      );
      if (!a || !b) throw Error("missing authored Beads");
      expect(a).toEqual({
        id: `${scope}beads/a`,
        type,
        revision: expect.any(String),
        properties: beadProperties,
        metadata: commonMetadata,
      });
      expect(b).toEqual({
        id: `${scope}beads/b`,
        type,
        revision: expect.any(String),
        properties: { title: "target", unknown: true },
        metadata: {},
      });
      // Pins are opaque recorded provenance; v0 never validates their spelling against history.
      const pin = "opaque+% /☃";
      const [local, external] = await write(
        [
          {
            operation: "createLink",
            id: "links/local",
            type: linkType,
            source: "beads/a",
            target: { uri: "beads/b", revision: pin },
            properties: linkProperties,
            metadata: linkMetadata,
          },
          {
            operation: "createLink",
            id: "links/external",
            type: linkType,
            source: { uri: "beads/a", revision: a.revision },
            target: { uri: "urn:resource:opaque-target", revision: "external/β +%" },
            properties: { weight: 2, extra: { keep: true } },
            metadata: {},
          },
        ],
        "links",
        "pos-2",
      );
      if (!local || !external) throw Error("missing authored Links");
      expect(local).toEqual({
        id: `${scope}links/local`,
        type: linkType,
        revision: expect.any(String),
        source: a.id,
        target: { uri: b.id, revision: pin },
        properties: linkProperties,
        metadata: linkMetadata,
      });
      expect(external).toEqual({
        id: `${scope}links/external`,
        type: linkType,
        revision: expect.any(String),
        source: { uri: a.id, revision: a.revision },
        target: { uri: "urn:resource:opaque-target", revision: "external/β +%" },
        properties: { weight: 2, extra: { keep: true } },
        metadata: {},
      });
      async function get(r: Resource, bead: boolean, position: string) {
        const response = await exchange("GET", r.id);
        context(response, position);
        expect(
          schema.validate(
            bead ? "#/$defs/currentBeadRecord" : "#/$defs/currentLinkRecord",
            JSON.parse(response.bodyText),
          ),
        ).toEqual([]);
        recordOracle(response, r, bead);
        const properties = await exchange("GET", `${r.id}?view=properties`);
        context(properties, position);
        propertiesOracle(properties, r);
      }
      await get(a, true, "pos-2");
      await get(local, false, "pos-2");
      await get(external, false, "pos-2");
      const incident = await exchange("GET", `${a.id}?view=links`);
      expect(incident.status).toBe(200);
      context(incident, "pos-2");
      expect(JSON.parse(incident.bodyText)).toEqual({ items: [external, local], next: null });
      const [updatedA, updatedLink] = await write(
        [
          {
            operation: "updateBead",
            bead: "beads/a",
            propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
          },
          {
            operation: "updateLink",
            link: "links/local",
            propertiesChange: [{ op: "replace", path: "/weight", value: 3 }],
          },
        ],
        "updates",
        "pos-3",
      );
      if (!updatedA || !updatedLink) throw Error("missing updated Resource postimages");
      expect(updatedA).toEqual({
        ...a,
        revision: expect.any(String),
        properties: { ...beadProperties, title: "after" },
      });
      expect(updatedA.revision).not.toBe(a.revision);
      expect(updatedLink).toEqual({
        ...local,
        revision: expect.any(String),
        properties: { ...linkProperties, weight: 3 },
      });
      expect(updatedLink.revision).not.toBe(local.revision);
      await get(updatedA, true, "pos-3");
      await get(updatedLink, false, "pos-3");
      const pinnedAfterSourceUpdate = await exchange("GET", external.id);
      context(pinnedAfterSourceUpdate, "pos-3");
      recordOracle(pinnedAfterSourceUpdate, external, false);
    }),
  30000,
);
