/** Private installed retained-key/depth observations; no profile qualification. */
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
  throw new Error("installed depth/key entry override requires declared source commit");
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
  ["mutationReceipt", "transactionalProblem", "beadRecord", "currentBeadCollection"].map((name) => [
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
// Independent reviewed request literals and byte hashes; changes require remeasurement.
const requests = [
  {
    index: 1,
    label: "batch-seed",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    key: "depth-b-retained",
    accept: "application/json",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/depth-b-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-b-a"},"metadata":{}}]}',
    bodyBytes: 166,
    bodySha256: "b7be4a13a3dfe2ac7507f07248e4469d3e0bf8d13cc5bdd509c6ef375c043c54",
    status: 200,
    contextPosition: "pos-1",
  },
  {
    index: 2,
    label: "batch-deep-conflict",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    key: "depth-b-retained",
    accept: "text/plain",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/depth-b-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-b-a"},"metadata":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":"leaf"}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}]}',
    bodyBytes: 621,
    bodySha256: "6195d74e5bafdc5a9e30d5571f0d98d7711462541e1879aea37b8c20fb42db62",
    status: 409,
    contextPosition: "pos-1",
  },
  {
    index: 3,
    label: "batch-equal-replay",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    key: "depth-b-retained",
    accept: "application/json",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/depth-b-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-b-a"},"metadata":{}}]}',
    bodyBytes: 166,
    bodySha256: "b7be4a13a3dfe2ac7507f07248e4469d3e0bf8d13cc5bdd509c6ef375c043c54",
    status: 200,
    contextPosition: "pos-1",
  },
  {
    index: 4,
    label: "batch-fresh-depth",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    key: "depth-b-fresh",
    accept: "application/json",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/depth-b-b","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-b-b"},"metadata":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":"leaf"}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}]}',
    bodyBytes: 621,
    bodySha256: "a6116425a627b6949f395c388ec39aacf778683fc99f4118d0fd78e4d49c7f12",
    status: 200,
    contextPosition: "pos-2",
  },
  {
    index: 5,
    label: "batch-fresh-reuse",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    key: "depth-b-fresh",
    accept: "application/json",
    contentType: "application/json",
    body: '{"operations":[{"operation":"createBead","id":"beads/depth-b-b","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-b-b"},"metadata":{}}]}',
    bodyBytes: 166,
    bodySha256: "ae6c62f1c4ae74a2fb9ce1332d9c3d261bcf6cb0a53791579f2d6a6112a0db01",
    status: 409,
    contextPosition: "pos-2",
  },
  {
    index: 6,
    label: "batch-point-unchanged",
    method: "GET",
    url: "https://reference.invalid/acme/beads/depth-b-a",
    key: null,
    accept: "application/json",
    contentType: null,
    body: null,
    bodyBytes: 0,
    bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: 200,
    contextPosition: "pos-2",
  },
  {
    index: 7,
    label: "singleton-seed",
    method: "POST",
    url: "https://reference.invalid/acme/operations/create-bead",
    key: "depth-s-retained",
    accept: "application/json",
    contentType: "application/json",
    body: '{"id":"beads/depth-s-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-s-a"},"metadata":{}}',
    bodyBytes: 124,
    bodySha256: "eeb6c0a0aea472198f3727781f249b29d4c84889c9ffceee594d7150376fe41f",
    status: 200,
    contextPosition: "pos-3",
  },
  {
    index: 8,
    label: "singleton-deep-conflict",
    method: "POST",
    url: "https://reference.invalid/acme/operations/create-bead",
    key: "depth-s-retained",
    accept: "text/plain",
    contentType: "application/json",
    body: '{"id":"beads/depth-s-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-s-a"},"metadata":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":"leaf"}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    bodyBytes: 579,
    bodySha256: "614b03a62ce2d2107e5f1c391f9ebdcd7a7be349ad9e74b0f6a44763fb7bfb8b",
    status: 409,
    contextPosition: "pos-3",
  },
  {
    index: 9,
    label: "singleton-equal-replay",
    method: "POST",
    url: "https://reference.invalid/acme/operations/create-bead",
    key: "depth-s-retained",
    accept: "application/json",
    contentType: "application/json",
    body: '{"id":"beads/depth-s-a","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-s-a"},"metadata":{}}',
    bodyBytes: 124,
    bodySha256: "eeb6c0a0aea472198f3727781f249b29d4c84889c9ffceee594d7150376fe41f",
    status: 200,
    contextPosition: "pos-3",
  },
  {
    index: 10,
    label: "singleton-fresh-depth",
    method: "POST",
    url: "https://reference.invalid/acme/operations/create-bead",
    key: "depth-s-fresh",
    accept: "application/json",
    contentType: "application/json",
    body: '{"id":"beads/depth-s-b","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-s-b"},"metadata":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":{"nested":"leaf"}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    bodyBytes: 579,
    bodySha256: "6d0e2cfadf5a0b4b5463aea20839d1b5b0346e1dd92470bc785a006c80082086",
    status: 200,
    contextPosition: "pos-4",
  },
  {
    index: 11,
    label: "singleton-fresh-reuse",
    method: "POST",
    url: "https://reference.invalid/acme/operations/create-bead",
    key: "depth-s-fresh",
    accept: "application/json",
    contentType: "application/json",
    body: '{"id":"beads/depth-s-b","type":"https://reference.invalid/acme/types/task","properties":{"title":"depth-s-b"},"metadata":{}}',
    bodyBytes: 124,
    bodySha256: "a1c0118b2e89a4f3697bdffae475794ea95ead3f7a5d67feb03ec19dd793e976",
    status: 409,
    contextPosition: "pos-4",
  },
  {
    index: 12,
    label: "singleton-point-unchanged",
    method: "GET",
    url: "https://reference.invalid/acme/beads/depth-s-a",
    key: null,
    accept: "application/json",
    contentType: null,
    body: null,
    bodyBytes: 0,
    bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: 200,
    contextPosition: "pos-4",
  },
  {
    index: 13,
    label: "final-complete-collection",
    method: "GET",
    url: "https://reference.invalid/acme/beads/?limit=32",
    key: null,
    accept: "application/json",
    contentType: null,
    body: null,
    bodyBytes: 0,
    bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: 200,
    contextPosition: "pos-4",
  },
] as const;

it("observes installed retained key conflicts and fresh deep carrier execution", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed depth/key work deadline");
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
  let launchAttempted = false;
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
    { method: "POST", url: `${scope}operations/batch` },
    { method: "GET", url: `${scope}beads/depth-b-a` },
    { method: "POST", url: `${scope}operations/create-bead` },
    { method: "GET", url: `${scope}beads/depth-s-a` },
    { method: "GET", url: `${scope}beads/?limit=32` },
  ];
  const savedResources: Record<string, unknown>[] = [];
  const receiptIds = new Set<string>();
  const transactions = new Set<string>();
  try {
    expect(requests).toHaveLength(13);
    expect(requests.reduce((sum, row) => sum + row.bodyBytes, 0)).toBe(3270);
    expect(Math.max(...requests.map((row) => row.bodyBytes))).toBe(621);
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
    directory = mkdtempSync(path.join(tmpdir(), "bdp-depth-key-installed-"));
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
    expect(binding.operationTargets.batch).toBe(`${scope}operations/batch`);
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
      if (!row) throw new Error("unbound installed depth/key request");
      controller.signal.throwIfAborted();
      expect(attempted + 1, "installed depth/key exact dispatch order").toBe(index);
      expect(++attempted, "installed depth/key dispatch bound").toBeLessThanOrEqual(13);
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
    function completed(
      response: Wire,
      name: string,
      key: string,
      position: string,
      metadata: unknown = {},
    ) {
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
        metadata,
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
      expect(receiptIds.has(receipt.id as string)).toBe(false);
      expect(transactions.has(receipt.transaction as string)).toBe(false);
      receiptIds.add(receipt.id as string);
      transactions.add(receipt.transaction as string);
      savedResources.push(resource);
      return { receipt, resource };
    }
    for (const carrier of ["batch", "singleton"] as const) {
      const base = carrier === "batch" ? 0 : 6;
      const tag = carrier === "batch" ? "b" : "s";
      const retainedName = `depth-${tag}-a`,
        freshName = `depth-${tag}-b`;
      const retainedKey = `depth-${tag}-retained`,
        freshKey = `depth-${tag}-fresh`;
      const originalPosition = carrier === "batch" ? "pos-1" : "pos-3";
      const advancedPosition = carrier === "batch" ? "pos-2" : "pos-4";
      const seed = completed(await exchange(base + 1), retainedName, retainedKey, originalPosition);
      const conflict = await exchange(base + 2);
      status(conflict, 409, `depth-key:${carrier}:conflict-before-depth`);
      expect(conflict.headers["content-type"]).toBe("application/problem+json");
      expect(conflict.headers["x-bdp-development-limit"]).toBeUndefined();
      expect(conflict.headers["retry-after"]).toBeUndefined();
      expect(conflict.headers["www-authenticate"]).toBeUndefined();
      context(conflict, originalPosition);
      expect(checked(conflict.bodyText, "transactionalProblem")).toStrictEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "idempotency-conflict",
        status: 409,
        retry: "never",
      });
      const replay = await exchange(base + 3);
      status(replay, 200, `depth-key:${carrier}:equal-replay`);
      expect(replay.headers["content-type"]).toBe("application/json");
      expect(replay.headers["x-bdp-development-limit"]).toBeUndefined();
      context(replay, originalPosition);
      expect(checked(replay.bodyText, "mutationReceipt")).toStrictEqual(seed.receipt);
      const freshBody = record(JSON.parse(requests[base + 3]!.body!));
      const freshInput = carrier === "batch" ? records(freshBody.operations)[0]! : freshBody;
      completed(
        await exchange(base + 4),
        freshName,
        freshKey,
        advancedPosition,
        freshInput.metadata,
      );
      const changed = await exchange(base + 5);
      status(changed, 409, `depth-key:${carrier}:fresh-retained-conflict`);
      context(changed, advancedPosition);
      expect(changed.headers["x-bdp-development-limit"]).toBeUndefined();
      expect(changed.headers["content-type"]).toBe("application/problem+json");
      expect(changed.headers["retry-after"]).toBeUndefined();
      expect(changed.headers["www-authenticate"]).toBeUndefined();
      expect(checked(changed.bodyText, "transactionalProblem")).toStrictEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "idempotency-conflict",
        status: 409,
        retry: "never",
      });
      const point = await exchange(base + 6);
      status(point, 200, `depth-key:${carrier}:point-unchanged`);
      expect(point.headers["content-type"]).toBe("application/json");
      context(point, advancedPosition);
      expect(checked(point.bodyText, "beadRecord")).toStrictEqual(seed.resource);
    }
    const final = await exchange(13);
    status(final, 200, "depth-key:complete-collection");
    expect(final.headers["content-type"]).toBe("application/json");
    context(final, "pos-4");
    const collection = checked(final.bodyText, "currentBeadCollection");
    expect(collection.next).toBeNull();
    const items = records(collection.items);
    expect(items.map((item) => item.id)).toStrictEqual([
      `${scope}beads/depth-b-a`,
      `${scope}beads/depth-b-b`,
      `${scope}beads/depth-s-a`,
      `${scope}beads/depth-s-b`,
    ]);
    expect(items).toStrictEqual(savedResources);
    expect(responses.map(({ headers }) => headers["bdp-scope-position"])).toStrictEqual(
      requests.map(({ contextPosition }) => contextPosition),
    );
    expect(attempted).toBe(13);
    expect(responses).toHaveLength(13);
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
    const cleanupReason = new Error("installed depth/key cleanup deadline");
    const cleanupTimer = setTimeout(() => {
      cleanupExceeded = true;
      failures.push(cleanupReason);
      child?.child.kill("SIGKILL");
    }, 10000);
    try {
      if (child) {
        await child.close();
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
            ? "installed depth/key child stop unproven"
            : "installed depth/key child remains active",
        ),
      );
    try {
      if (directory && stopped) rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    const directoryAbsent = directory === undefined || !existsSync(directory);
    if (stopped && !directoryAbsent)
      failures.push(new Error("installed depth/key directory remains"));
    clearTimeout(deadline);
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    try {
      console.log(
        JSON.stringify({
          observation: "private-installed-depth-key-order",
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
    throw new AggregateError(failures, "installed depth/key observation and cleanup failed");
}, 60000);
