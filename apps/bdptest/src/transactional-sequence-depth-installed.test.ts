/** Private installed sequence-member/depth observations; no profile qualification. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal?: AbortSignal,
  ): Promise<{
    child: ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const scope = "https://reference.invalid/acme/";
const beadType = `${scope}types/task`;
const schemaUri = `${scope}schemas/properties`;
const artifacts = {
  descriptors: [
    {
      retrievalUri: beadType,
      utf8: JSON.stringify({
        id: beadType,
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
};
const entry =
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/transaction-installed-process.js");
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("installed sequence depth entry override requires declared source commit");
const resolvedEntry = realpathSync(entry);
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const entrySha256 = digest(readFileSync(resolvedEntry));
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const sourceCommit =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("invalid declared source commit");
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
ajv.addSchema(bundle);
const validators = Object.fromEntries(
  ["mutationReceipt", "transactionalSequenceResponse", "beadRecord"].map((name) => [
    name,
    ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` }),
  ]),
);
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected response record");
  return value as Record<string, unknown>;
}
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("expected response array");
  return value.map(record);
}
function checked(text: string, schema: string) {
  const value = record(JSON.parse(text)),
    validate = validators[schema];
  if (!validate) throw new Error("unbound response schema");
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  return value;
}
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
const retainedHeaders = [
  ...contextNames,
  "content-type",
  "content-length",
  "cache-control",
  "vary",
  "retry-after",
  "www-authenticate",
  "x-bdp-development",
  "x-bdp-development-limit",
];
// Independently measured literal requests; metadata has 41 nested objects.
const requests = [
  {
    index: 1,
    label: "seed",
    method: "POST",
    url: "https://reference.invalid/acme/operations/create-bead",
    key: "sequence-retained",
    accept: "application/json",
    contentType: "application/json",
    body: '{"id":"beads/sequence-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"sequence-a"},"metadata":{}}',
    bodyBytes: 126,
    bodySha256: "764bc2f11265c9581533352015d0313596277a928c88556eedb32ef732ceadd1",
    status: 200,
  },
  {
    index: 2,
    label: "retained-deep",
    method: "POST",
    url: "https://reference.invalid/acme/operations/sequence",
    key: null,
    accept: "application/json",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/sequence-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"sequence-a"},"metadata":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":"leaf"}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}},"idempotencyKey":"sequence-retained","name":"present"}]}',
    bodyBytes: 677,
    bodySha256: "7fd1a9710303612edcccee2ebc29d408193283f02ddc3804e75b128d30fb2d23",
    status: 200,
  },
  {
    index: 3,
    label: "original-replay",
    method: "POST",
    url: "https://reference.invalid/acme/operations/create-bead",
    key: "sequence-retained",
    accept: "application/json",
    contentType: "application/json",
    body: '{"id":"beads/sequence-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"sequence-a"},"metadata":{}}',
    bodyBytes: 126,
    bodySha256: "764bc2f11265c9581533352015d0313596277a928c88556eedb32ef732ceadd1",
    status: 200,
  },
  {
    index: 4,
    label: "original-resource",
    method: "GET",
    url: "https://reference.invalid/acme/beads/sequence-a",
    key: null,
    accept: "application/json",
    contentType: null,
    body: null,
    bodyBytes: 0,
    bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: 200,
  },
  {
    index: 5,
    label: "fresh-deep",
    method: "POST",
    url: "https://reference.invalid/acme/operations/sequence",
    key: null,
    accept: "application/json",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/sequence-b","type":"https://reference.invalid/acme/types/task","properties":{"title":"sequence-b"},"metadata":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":"leaf"}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}},"idempotencyKey":"sequence-fresh","name":"present"}]}',
    bodyBytes: 674,
    bodySha256: "66f3c980ebb072c775200bda8b73f5d64176d00196eecf4de0fa69240958735e",
    status: 200,
  },
  {
    index: 6,
    label: "fresh-key-reuse",
    method: "POST",
    url: "https://reference.invalid/acme/operations/sequence",
    key: null,
    accept: "application/json",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/sequence-b","type":"https://reference.invalid/acme/types/task","properties":{"title":"sequence-b"},"metadata":{},"idempotencyKey":"sequence-fresh","name":"present"}]}',
    bodyBytes: 219,
    bodySha256: "6542f995ee8619607353fd01b5c2f3b257c9ae85ef43f0357e2393bffd81fd62",
    status: 200,
  },
  {
    index: 7,
    label: "retained-deep-negotiation",
    method: "POST",
    url: "https://reference.invalid/acme/operations/sequence",
    key: null,
    accept: "text/plain",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/sequence-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"sequence-a"},"metadata":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":"leaf"}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}},"idempotencyKey":"sequence-retained","name":"present"}]}',
    bodyBytes: 677,
    bodySha256: "7fd1a9710303612edcccee2ebc29d408193283f02ddc3804e75b128d30fb2d23",
    status: 406,
  },
  {
    index: 8,
    label: "fresh-deep-negotiation",
    method: "POST",
    url: "https://reference.invalid/acme/operations/sequence",
    key: null,
    accept: "text/plain",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/sequence-c","type":"https://reference.invalid/acme/types/task","properties":{"title":"sequence-c"},"metadata":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":"leaf"}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}},"idempotencyKey":"sequence-negotiation","name":"present"}]}',
    bodyBytes: 680,
    bodySha256: "37f093585358ce052ca89c3d8c7f4ce32e3945ff5406c0c17f942688a082be3e",
    status: 406,
  },
] as const;

it("observes retained sequence member conflict and fresh deep execution over packed bytes", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed sequence depth work deadline");
  let deadlineExceeded = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  const failures: unknown[] = [];
  let directory: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let closed = false;
  let cleanupExceeded = false;
  let attempted = 0;
  let expectedContext: readonly [string, string] | undefined;
  const responses: {
    ordinal: number;
    label: string;
    method: HttpMethod;
    url: string;
    accept: string;
    key: string | null;
    requestBodyBytes: number;
    requestBodySha256: string;
    status: number;
    bodyOctets: number | undefined;
    bodySha256: string;
    wireSha256: string | null;
    headers: Record<string, string | null>;
  }[] = [];
  const operator = randomBytes(32).toString("base64url");
  const routeBindings: { method: HttpMethod; url: string }[] = [
    { method: "POST", url: `${scope}operations/create-bead` },
    { method: "POST", url: `${scope}operations/sequence` },
    { method: "GET", url: `${scope}beads/sequence-a` },
  ];
  let launchAttempted = false;
  try {
    expect(requests).toHaveLength(8);
    expect(requests.reduce((sum, row) => sum + row.bodyBytes, 0)).toBe(3179);
    expect(Math.max(...requests.map((row) => row.bodyBytes))).toBe(680);
    let deepChecked = 0;
    for (const row of requests) {
      expect(Buffer.byteLength(row.body ?? ""), row.label).toBe(row.bodyBytes);
      expect(digest(row.body ?? ""), row.label).toBe(row.bodySha256);
      if (row.label.includes("deep") || row.label.endsWith("fresh-depth")) {
        deepChecked++;
        const parsed = record(JSON.parse(row.body!));
        const input = "operations" in parsed ? records(parsed.operations)[0]! : parsed;
        let value: unknown = input.metadata;
        for (let i = 0; i < 41; i++) {
          const object = record(value);
          expect(Object.keys(object), row.label).toStrictEqual(["nested"]);
          value = object.nested;
        }
        expect(value, row.label).toBe("leaf");
      }
    }
    expect(deepChecked).toBe(4);
    directory = mkdtempSync(path.join(tmpdir(), "bdp-sequence-depth-installed-"));
    controller.signal.throwIfAborted();
    launchAttempted = true;
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [{ token: operator, principal: "writer", canMutate: true }],
      },
      controller.signal,
    );
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    expect(child.ready.scope).toBe(scope);
    expect(child.ready.claimEligible).toBe(false);
    expect(child.ready.history).toBe(false);
    expect(binding.operationTargets.sequence).toBe(`${scope}operations/sequence`);
    expect(binding.operationTargets.createBead).toBe(`${scope}operations/create-bead`);
    const address = new URL(child.ready.listenUrl as string);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        maximumHeaderBytes: 65536,
        exactMode: {
          scope,
          profile: "transactional",
          routes: routeBindings,
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "operator",
          credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${operator}` }),
        },
      },
    );
    async function exchange(index: number) {
      const row = requests[index - 1];
      if (!row) throw new Error("unbound installed sequence depth request");
      controller.signal.throwIfAborted();
      expect(attempted + 1, "installed sequence depth exact dispatch order").toBe(index);
      expect(++attempted, "installed sequence depth dispatch bound").toBeLessThanOrEqual(8);
      expect(Buffer.byteLength(row.url)).toBeLessThanOrEqual(8192);
      const response = await execute({
        method: row.method,
        url: row.url,
        signal: controller.signal,
        credentialRef: "operator",
        raw: {
          headerLines: [
            { name: "accept", value: row.accept },
            ...(row.contentType === null ? [] : [{ name: "content-type", value: row.contentType }]),
            ...(row.key === null ? [] : [{ name: "idempotency-key", value: row.key }]),
          ],
          ...(row.body === null ? {} : { bodyBytes: Buffer.from(row.body) }),
        },
      });
      // Safe response projection is retained before any status/schema assertion.
      responses.push({
        ordinal: attempted,
        label: row.label,
        method: row.method,
        url: row.url,
        accept: row.accept,
        key: row.key,
        requestBodyBytes: row.bodyBytes,
        requestBodySha256: row.bodySha256,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: digest(response.bodyText),
        wireSha256: response.wireResponseBytes ? digest(response.wireResponseBytes) : null,
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers[name] ?? null]),
        ),
      });
      expect(response.exactRequest?.source).toBe("raw-http1-serializer");
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.url).toBe(row.url);
      expect(response.exactRequest?.bodyPresent).toBe(row.body !== null);
      expect(response.exactRequest?.bodyOctets).toBe(row.bodyBytes);
      expect(response.exactRequest?.bodyDigest).toBe(
        row.body === null ? undefined : row.bodySha256,
      );
      const headers = response.exactRequest?.headerLines ?? [];
      const values = (name: string) =>
        headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
      expect(values("host")).toStrictEqual(["reference.invalid"]);
      expect(values("accept")).toStrictEqual([row.accept]);
      expect(values("content-type")).toStrictEqual(
        row.contentType === null ? [] : [row.contentType],
      );
      expect(values("idempotency-key")).toStrictEqual(row.key === null ? [] : [row.key]);
      expect(values("authorization").length).toBe(1);
      expect(
        values("authorization")[0] === `Bearer ${operator}`,
        "exact credential serialization",
      ).toBe(true);
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(Number.isSafeInteger(response.bodyOctets)).toBe(true);
      expect(response.bodyOctets).toBeGreaterThanOrEqual(0);
      expect(response.bodyOctets).toBeLessThanOrEqual(131072);
      expect(Buffer.byteLength(response.bodyText)).toBe(response.bodyOctets);
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      expect(response.headers["cache-control"]).toBe("private, no-store");
      if (row.method === "POST") expect(response.headers.vary).toBe("Accept");
      return response;
    }
    type Wire = Awaited<ReturnType<typeof exchange>>;
    function status(response: Wire, expected: number, label: string) {
      expect(response.status, `${label}:${JSON.stringify(responses.at(-1))}`).toBe(expected);
    }
    function context(response: Wire, position: string) {
      if (!expectedContext) throw new Error("missing seed context");
      expect(contextNames.map((name) => response.headers[name])).toStrictEqual([
        ...expectedContext,
        position,
      ]);
    }
    function completed(response: Wire, name: string, key: string, position: string) {
      status(response, 200, `depth-key:${name}:completed`);
      expect(response.headers["content-type"]).toBe("application/json");
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
      const receipt = checked(response.bodyText, "mutationReceipt");
      expect(typeof receipt.scopeEpoch).toBe("string");
      expect(receipt.scopeEpoch).not.toBe("");
      expect(typeof receipt.authorizationView).toBe("string");
      expect(receipt.authorizationView).not.toBe("");
      if (!expectedContext)
        expectedContext = [receipt.scopeEpoch as string, receipt.authorizationView as string];
      context(response, position);
      const results = records(receipt.results);
      expect(results).toHaveLength(1);
      const resource = record(results[0]!.resource);
      expect(typeof resource.revision).toBe("string");
      expect(resource.revision).not.toBe("");
      expect(resource).toStrictEqual({
        id: `${scope}beads/${name}`,
        type: beadType,
        revision: resource.revision,
        properties: { title: name },
        metadata: {},
      });
      expect(results).toStrictEqual([{ operationIndex: 0, outcome: "created", resource }]);
      expect(receipt).toStrictEqual({
        id: receipt.id,
        status: "completed",
        detail: "available",
        idempotencyKey: key,
        scopeEpoch: expectedContext[0],
        authorizationView: expectedContext[1],
        transaction: receipt.transaction,
        requiredPosition: position,
        effectPosition: position,
        results,
        next: null,
        expiresAt: receipt.expiresAt,
      });
      expect(typeof receipt.id).toBe("string");
      expect(typeof receipt.transaction).toBe("string");

      return { receipt, resource };
    }
    const seed = completed(await exchange(1), "sequence-a", "sequence-retained", "pos-1");
    const conflict = await exchange(2);
    status(conflict, 200, "sequence-depth:retained-member-conflict");
    expect(conflict.headers["content-type"]).toBe("application/json");
    expect(conflict.headers["x-bdp-development-limit"]).toBeUndefined();
    context(conflict, "pos-1");
    expect(checked(conflict.bodyText, "transactionalSequenceResponse")).toStrictEqual({
      results: [
        {
          type: "https://github.com/gastownhall/bdp/problems/conflict",
          code: "idempotency-conflict",
          status: 409,
          retry: "never",
          operationIndex: 0,
          operationName: "present",
        },
      ],
    });
    const replay = await exchange(3);
    status(replay, 200, "sequence-depth:original-replay");
    expect(checked(replay.bodyText, "mutationReceipt")).toStrictEqual(seed.receipt);
    context(replay, "pos-1");
    const point = await exchange(4);
    status(point, 200, "sequence-depth:original-resource");
    expect(checked(point.bodyText, "beadRecord")).toStrictEqual(seed.resource);
    context(point, "pos-1");
    const fresh = await exchange(5);
    status(fresh, 200, "sequence-depth:fresh-completed");
    expect(fresh.headers["content-type"]).toBe("application/json");
    context(fresh, "pos-2");
    expect(fresh.headers["x-bdp-development-limit"]).toBeUndefined();
    const created = checked(fresh.bodyText, "transactionalSequenceResponse");
    const resource = record(records(created.results)[0]!.resource);
    expect(typeof resource.revision).toBe("string");
    expect(resource.revision).not.toBe("");
    expect(resource).toStrictEqual({
      id: `${scope}beads/sequence-b`,
      type: beadType,
      revision: resource.revision,
      properties: { title: "sequence-b" },
      metadata: records(record(JSON.parse(requests[4].body)).operations)[0]!.metadata,
    });
    expect(created).toStrictEqual({
      results: [{ operationIndex: 0, operationName: "present", outcome: "created", resource }],
    });
    const reuse = await exchange(6);
    status(reuse, 200, "sequence-depth:fresh-retained-conflict");
    expect(reuse.headers["content-type"]).toBe("application/json");
    context(reuse, "pos-2");
    expect(reuse.headers["x-bdp-development-limit"]).toBeUndefined();
    expect(checked(reuse.bodyText, "transactionalSequenceResponse")).toStrictEqual({
      results: [
        {
          type: "https://github.com/gastownhall/bdp/problems/conflict",
          code: "idempotency-conflict",
          status: 409,
          retry: "never",
          operationIndex: 0,
          operationName: "present",
        },
      ],
    });
    for (const index of [7, 8]) {
      const refused = await exchange(index);
      status(refused, 406, `sequence-depth:negotiation-${index}`);
      expect(refused.bodyText).toBe("");
      expect(refused.bodyOctets).toBe(0);
      expect(refused.headers["content-length"]).toBe("0");
      expect(refused.headers["content-type"]).toBeUndefined();
      expect(refused.headers["x-bdp-development-limit"]).toBeUndefined();
      context(refused, "pos-2");
    }
    expect(attempted).toBe(8);
    expect(responses).toHaveLength(8);
    expect(
      responses.map(({ ordinal, label, method, url, accept, key, status: actual }) => ({
        ordinal,
        label,
        method,
        url,
        accept,
        key,
        status: actual,
      })),
    ).toStrictEqual(
      requests.map(({ index, label, method, url, accept, key, status: expected }) => ({
        ordinal: index,
        label,
        method,
        url,
        accept,
        key,
        status: expected,
      })),
    );
    expect(new Set(responses.map(({ method, url }) => `${method} ${url}`))).toStrictEqual(
      new Set(routeBindings.map(({ method, url }) => `${method} ${url}`)),
    );
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    const cleanupReason = new Error("installed sequence depth cleanup deadline");
    let cleanupReject: ((reason: Error) => void) | undefined;
    const cleanupTimer = setTimeout(() => {
      cleanupExceeded = true;
      child?.child.kill("SIGKILL");
      cleanupReject?.(cleanupReason);
    }, 10000);
    try {
      if (child) {
        await Promise.race([
          child.close(),
          new Promise<never>((_, reject) => {
            // The cleanup timer also forces the owned child to stop on overrun.
            cleanupReject = reject;
          }),
        ]);
        closed = true;
      }
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(cleanupTimer);
    }
    const stopped =
      !launchAttempted ||
      (child !== undefined && (child.child.exitCode !== null || child.child.signalCode !== null));
    if (!stopped)
      failures.push(
        new Error(
          child === undefined
            ? "installed sequence depth child stop unproven"
            : "installed sequence depth child remains active",
        ),
      );
    try {
      if (directory && stopped) rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    const directoryAbsent = directory === undefined || !existsSync(directory);
    if (stopped && !directoryAbsent)
      failures.push(new Error("installed sequence depth directory remains"));
    clearTimeout(deadline);
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    try {
      console.log(
        JSON.stringify({
          observation: "private-installed-sequence-depth",
          outcome: failures.length === 0 ? "passed" : "failed",
          // Supervisor attribution to archives/consumer, never child-attested Git provenance.
          declaredSourceCommit: sourceCommit,
          workspaceDirty,
          entry: resolvedEntry,
          entrySha256,
          binding: binding ?? null,
          routeBindings,
          artifactBytes:
            artifacts.descriptors.reduce((n, d) => n + Buffer.byteLength(d.utf8), 0) +
            artifacts.schemas.reduce((n, s) => n + Buffer.byteLength(s.utf8), 0),
          attempted,
          exchanges: responses.length,
          completedResponses: responses,
          deadlineExceeded,
          cleanupExceeded,
          closed,
          launchAttempted,
          startupCompleted: child !== undefined,
          stopKnown: stopped,
          childPid: child?.child.pid ?? null,
          childExitCode: child?.child.exitCode ?? null,
          childSignalCode: child?.child.signalCode ?? null,
          directory: directory ?? null,
          directoryAbsent,
          failureCount: failures.length,
          claimEligible: false,
          retention:
            "response fingerprints and selected safe headers; full receipt/resource equality assertions ran in memory; no raw Authorization retained",
          startupLimitation:
            "Before ready, no child handle is returned; startup cleanup is launcher-owned and independent supervisor process evidence remains required",
        }),
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed sequence depth observation and cleanup failed");
}, 60000);
