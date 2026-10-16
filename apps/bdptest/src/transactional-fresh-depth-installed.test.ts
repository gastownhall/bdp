/** Finite private deep-value observation; no public profile qualification. */
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
const ownerType = `${scope}types/owner`;
const linkType = `${scope}types/link`;
const artifacts = {
  descriptors: [
    {
      retrievalUri: "https://reference.invalid/acme/types/owner",
      utf8: '{"id":"https://reference.invalid/acme/types/owner","name":"Owner","describes":"bead","conformsTo":[],"ownsOutgoing":{"https://reference.invalid/acme/types/link":{"max":4}},"propertiesSchema":"https://reference.invalid/acme/schemas/fresh-depth"}',
    },
    {
      retrievalUri: "https://reference.invalid/acme/types/link",
      utf8: '{"id":"https://reference.invalid/acme/types/link","name":"Link","describes":"link","conformsTo":[],"source":{"conformsTo":[],"external":"none"},"target":{"conformsTo":[],"external":"none"},"propertiesSchema":"https://reference.invalid/acme/schemas/fresh-depth"}',
    },
  ],
  schemas: [
    {
      retrievalUri: "https://reference.invalid/acme/schemas/fresh-depth",
      utf8: '{"$id":"https://reference.invalid/acme/schemas/fresh-depth","type":"object","properties":{"n":{"type":"number"},"deep":true},"additionalProperties":true}',
    },
  ],
};
const entry =
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/transaction-installed-process.js");
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("installed fresh depth entry override requires declared source commit");
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
  [
    "mutationReceipt",
    "transactionalSequenceResponse",
    "linkRecord",
    "eventPage",
    "snapshotManifest",
    "transactionalProblem",
  ].map((name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })]),
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
// Compare admitted JSON using an explicit worklist. Never pass deep values to a matcher.
function sameJson(actual: unknown, expected: unknown, label: string): void {
  const pending: [unknown, unknown][] = [[actual, expected]];
  let valid = true;
  while (pending.length && valid) {
    const pair = pending.pop();
    if (!pair) throw new Error("oracle worklist invariant");
    const [left, right] = pair;
    if (left === right) continue; // JSON numeric equality includes -0/0.
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
      valid = false;
      break;
    }
    if (Array.isArray(left) !== Array.isArray(right)) {
      valid = false;
      break;
    }
    const l = left as Record<string, unknown>,
      r = right as Record<string, unknown>;
    const keys = Object.keys(r);
    if (
      Object.keys(l).length !== keys.length ||
      (Array.isArray(left) && left.length !== (right as unknown[]).length)
    ) {
      valid = false;
      break;
    }
    for (const key of keys) {
      if (!Object.hasOwn(l, key)) {
        valid = false;
        break;
      }
      pending.push([l[key], r[key]]);
    }
  }
  expect(valid, label).toBe(true);
}
const deepText = "[".repeat(12000) + "1" + "]".repeat(12000);
const deepValue: unknown = JSON.parse(deepText);
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
const bodies = {
  seed:
    '{"operations":[{"operation":"createBead","id":"beads/a","type":"https://reference.invalid/acme/types/owner","properties":{}},{"operation":"createBead","id":"beads/b","type":"https://reference.invalid/acme/types/owner","properties":{}},{"operation":"createLink","id":"links/l","type":"https://reference.invalid/acme/types/link","source":"beads/a","target":"beads/b","properties":{"n":-0,"deep":' +
    deepText +
    '},"metadata":{"tag":"initial"}}]}',
  update:
    '{"link":"links/l","metadataChange":[{"op":"replace","path":"","value":{"tag":"updated","deep":' +
    deepText +
    "}}]}",
  noop:
    '{"link":"links/l","propertiesChange":[{"op":"replace","path":"/n","value":0}],"metadataChange":[{"op":"replace","path":"","value":{"deep":' +
    deepText +
    ',"tag":"updated"}}]}',
  conflict:
    '{"link":"links/l","metadataChange":[{"op":"replace","path":"","value":{"tag":"different","deep":' +
    deepText +
    "}}]}",
  set: '{"collection":"links","selector":"$[?@.properties.n == 0]","cardinality":{"min":1,"max":1},"change":[{"op":"replace","path":"/n","value":1}]}',
  sequence:
    '{"operations":[{"operation":"createBead","id":"beads/c","type":"https://reference.invalid/acme/types/owner","properties":{"deep":' +
    deepText +
    '},"idempotencyKey":"fresh-c","name":"created"},{"operation":"createLink","id":"links/l2","type":"https://reference.invalid/acme/types/link","source":"beads/a","target":"@created","properties":{"deep":' +
    deepText +
    '},"idempotencyKey":"fresh-l2"}]}',
  "late-failure":
    '{"operations":[{"operation":"updateLink","link":"links/l","propertiesChange":[{"op":"replace","path":"/n","value":2}]},{"operation":"updateLink","link":"links/l","metadataChange":[{"op":"remove","path":"/absent"}]}]}',
} as const;
const requests = [
  {
    index: 1,
    label: "seed",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    key: "fresh-seed",
    accept: "application/json",
    contentType: "application/json",
    bodyRef: "seed",
    bodyBytes: 24427,
    bodySha256: "c2b9b50eac523660681ed4c0832da33849555e7d0afa0a913545b2803651b8a7",
    status: 200,
  },
  {
    index: 2,
    label: "update",
    method: "POST",
    url: "https://reference.invalid/acme/operations/update-link",
    key: "fresh-update",
    accept: "application/json",
    contentType: "application/json",
    bodyRef: "update",
    bodyBytes: 24099,
    bodySha256: "916905c2080f92583db1097ed6c2b813a2b68b9fd760aff3cb93b176db884506",
    status: 200,
  },
  {
    index: 3,
    label: "no-op",
    method: "POST",
    url: "https://reference.invalid/acme/operations/update-link",
    key: "fresh-noop",
    accept: "application/json",
    contentType: "application/json",
    bodyRef: "noop",
    bodyBytes: 24159,
    bodySha256: "322f89d2c4e8133819775293e5423a7c2e23f4e869ff79e652c7a3bb17f26dfc",
    status: 200,
  },
  {
    index: 4,
    label: "replay",
    method: "POST",
    url: "https://reference.invalid/acme/operations/update-link",
    key: "fresh-update",
    accept: "application/json",
    contentType: "application/json",
    bodyRef: "update",
    bodyBytes: 24099,
    bodySha256: "916905c2080f92583db1097ed6c2b813a2b68b9fd760aff3cb93b176db884506",
    status: 200,
  },
  {
    index: 5,
    label: "conflict",
    method: "POST",
    url: "https://reference.invalid/acme/operations/update-link",
    key: "fresh-update",
    accept: "application/json",
    contentType: "application/json",
    bodyRef: "conflict",
    bodyBytes: 24101,
    bodySha256: "6b45a53165bd6a92344eaa8d49c3543a365485591db84b71baa5d569924f04ed",
    status: 409,
  },
  {
    index: 6,
    label: "set",
    method: "POST",
    url: "https://reference.invalid/acme/operations/update-where",
    key: "fresh-set",
    accept: "application/json",
    contentType: "application/json",
    bodyRef: "set",
    bodyBytes: 141,
    bodySha256: "08fb068040f562d9dfa692a0eb506867aacafdde63b2f1525de6d01a6eb79719",
    status: 200,
  },
  {
    index: 7,
    label: "dependent-sequence",
    method: "POST",
    url: "https://reference.invalid/acme/operations/sequence",
    key: null,
    accept: "application/json",
    contentType: "application/json",
    bodyRef: "sequence",
    bodyBytes: 48363,
    bodySha256: "c20b577e95a267d41bac22686fd89044c16138d1cc377126129b7da23a09662d",
    status: 200,
  },
  {
    index: 8,
    label: "late-failure",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    key: "fresh-failed",
    accept: "application/json",
    contentType: "application/json",
    bodyRef: "late-failure",
    bodyBytes: 216,
    bodySha256: "9508f3e784eb06f621f31d8a63d03282594bc386a10a62ad8dad3406b17a3d18",
    status: 200,
  },
  {
    index: 9,
    label: "failed-replay",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    key: "fresh-failed",
    accept: "application/json",
    contentType: "application/json",
    bodyRef: "late-failure",
    bodyBytes: 216,
    bodySha256: "9508f3e784eb06f621f31d8a63d03282594bc386a10a62ad8dad3406b17a3d18",
    status: 200,
  },
  {
    index: 10,
    label: "current-link",
    method: "GET",
    url: "https://reference.invalid/acme/links/l",
    key: null,
    accept: "application/json",
    contentType: null,
    bodyRef: null,
    bodyBytes: 0,
    bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: 200,
  },
  {
    index: 11,
    label: "link-events",
    method: "GET",
    url: "https://reference.invalid/acme/links/l?view=events",
    key: null,
    accept: "application/json",
    contentType: null,
    bodyRef: null,
    bodyBytes: 0,
    bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: 200,
  },
  {
    index: 12,
    label: "snapshot",
    method: "GET",
    url: "https://reference.invalid/acme/snapshot",
    key: null,
    accept: "application/json",
    contentType: null,
    bodyRef: null,
    bodyBytes: 0,
    bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: 200,
  },
  {
    index: 13,
    label: "receipt",
    method: "GET",
    url: null,
    key: null,
    accept: "application/json",
    contentType: null,
    bodyRef: null,
    bodyBytes: 0,
    bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: 200,
  },
] as const;

it("serves byte-bounded deep mutations receipts Events and owned-Link Snapshots over packed bytes", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed fresh depth work deadline");
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
  let receiptTarget: string | undefined;
  const responseSizes: number[] = [];
  const prerequisites: string[] = [];
  let expectedContext: readonly [string, string] | undefined;
  const responses: {
    ordinal: number;
    label: string;
    method: HttpMethod;
    url: string;
    targetBytes: number;
    targetSha256: string;
    accept: string;
    key: string | null;
    requestBodyBytes: number;
    requestBodyPresent: boolean | null;
    requestBodySha256: string;
    status: number;
    bodyOctets: number | undefined;
    bodySha256: string;
    wireSha256: string | null;
    headers: Record<string, string | null>;
  }[] = [];
  const operator = randomBytes(32).toString("base64url");
  const routeBindings: { method: HttpMethod; url: string }[] = [
    ...new Map(
      requests
        .filter((row) => row.url !== null)
        .map((row) => [`${row.method} ${row.url}`, { method: row.method, url: row.url as string }]),
    ).values(),
  ];
  let launchAttempted = false;
  try {
    expect(requests).toHaveLength(13);
    expect(requests.reduce((sum, row) => sum + row.bodyBytes, 0)).toBe(169821);
    expect(Math.max(...requests.map((row) => row.bodyBytes))).toBe(48363);
    for (const row of requests) {
      const body = row.bodyRef === null ? "" : bodies[row.bodyRef];
      expect(Buffer.byteLength(body), row.label).toBe(row.bodyBytes);
      expect(digest(body), row.label).toBe(row.bodySha256);
    }
    sameJson(
      { a: -0, b: deepValue },
      { b: JSON.parse(deepText), a: 0 },
      "independent deep oracle numeric and key-order equality",
    );
    for (const [actual, expected, label] of [
      [deepValue, JSON.parse("[".repeat(12000) + "2" + "]".repeat(12000)), "changed deep leaf"],
      [{ a: 1 }, { a: 1, b: 2 }, "unequal key counts"],
      [[], {}, "array versus object"],
      [null, {}, "null versus object"],
    ] as const) {
      const rejection = `independent deep oracle rejects ${label}`;
      expect(() => sameJson(actual, expected, rejection)).toThrow(rejection);
    }
    // Qualification requires an explicit external executable; development fallback earns no such claim.
    if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY) {
      expect(workspaceDirty).toBe(false);
      expect(path.relative(realpathSync(root), resolvedEntry).startsWith(`..${path.sep}`)).toBe(
        true,
      );
    }
    directory = mkdtempSync(path.join(tmpdir(), "bdp-fresh-depth-installed-"));
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
    const executor = (routes: { method: HttpMethod; url: string }[]) =>
      createRawHttpExchangeExecutor(
        { transport: "plain", host: address.hostname, port: Number(address.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 1048576,
          maximumHeaderBytes: 65536,
          exactMode: {
            scope,
            profile: "transactional",
            routes,
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: "operator",
            credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${operator}` }),
          },
        },
      );
    async function exchange(index: number) {
      const literal = requests[index - 1];
      if (!literal) throw new Error("unbound fresh-depth request");
      const url = literal.url ?? receiptTarget;
      if (!url) throw new Error("validated receipt target unavailable");
      const row = {
        ...literal,
        url,
        body: literal.bodyRef === null ? null : bodies[literal.bodyRef],
      };
      controller.signal.throwIfAborted();
      expect(attempted + 1, "installed fresh depth exact dispatch order").toBe(index);
      expect(++attempted, "installed fresh depth dispatch bound").toBeLessThanOrEqual(13);
      expect(Buffer.byteLength(row.url)).toBeLessThanOrEqual(8192);
      if (index === 13) routeBindings.push({ method: "GET", url });
      const response = await executor(routeBindings)({
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
      responseSizes.push(response.bodyOctets ?? -1);
      // Safe response projection is retained before any status/schema assertion.
      responses.push({
        ordinal: attempted,
        label: row.label,
        method: row.method,
        url: row.url,
        targetBytes: Buffer.byteLength(row.url),
        targetSha256: digest(row.url),
        accept: row.accept,
        key: row.key,
        requestBodyBytes: row.bodyBytes,
        requestBodyPresent: response.exactRequest?.bodyPresent ?? null,
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
      expect(response.bodyOctets).toBeLessThanOrEqual(1048576);
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
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    const receiptIds = new Set<string>(),
      transactions = new Set<string>();
    function receipt(response: Wire, key: string, position: string) {
      status(response, 200, `fresh-depth:${key}:receipt`);
      expect(response.headers["content-type"]).toBe("application/json");
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
      const value = checked(response.bodyText, "mutationReceipt");
      if (!expectedContext)
        expectedContext = [String(value.scopeEpoch), String(value.authorizationView)];
      context(response, position);
      expect(value.scopeEpoch).toBe(expectedContext[0]);
      expect(value.authorizationView).toBe(expectedContext[1]);
      expect(typeof value.id).toBe("string");
      const id = String(value.id);
      expect(id.startsWith(`${scope}receipts/`)).toBe(true);
      expect(uuid.test(id.slice(`${scope}receipts/`.length))).toBe(true);
      expect(uuid.test(String(value.transaction))).toBe(true);
      expect(receiptIds.has(id)).toBe(false);
      expect(transactions.has(String(value.transaction))).toBe(false);
      receiptIds.add(id);
      transactions.add(String(value.transaction));
      expect(value.idempotencyKey).toBe(key);
      expect(value.requiredPosition).toBe(position);
      expect(value.detail).toBe("available");
      expect(Number.isFinite(Date.parse(String(value.expiresAt)))).toBe(true);
      return value;
    }
    function fullReceipt(
      value: Record<string, unknown>,
      key: string,
      position: string,
      results: unknown[],
      effect = true,
    ) {
      sameJson(
        value,
        {
          id: value.id,
          status: "completed",
          detail: "available",
          idempotencyKey: key,
          scopeEpoch: expectedContext?.[0],
          authorizationView: expectedContext?.[1],
          transaction: value.transaction,
          requiredPosition: position,
          ...(effect ? { effectPosition: position } : {}),
          results,
          next: null,
          expiresAt: value.expiresAt,
        },
        `fresh-depth:${key}:full-receipt`,
      );
    }
    function revision(resource: Record<string, unknown>): string {
      expect(typeof resource.revision).toBe("string");
      expect(resource.revision).not.toBe("");
      return String(resource.revision);
    }
    function owner(name: string, rev: unknown, properties: unknown, links: unknown[]) {
      return {
        id: `${scope}beads/${name}`,
        type: ownerType,
        revision: rev,
        properties,
        metadata: {},
        ownedLinks: { [linkType]: links },
      };
    }
    function link(
      name: string,
      rev: unknown,
      source: string,
      n: number | undefined,
      metadata: unknown,
      target = "b",
    ) {
      return {
        id: `${scope}links/${name}`,
        type: linkType,
        revision: rev,
        source: `${scope}beads/${source}`,
        target: `${scope}beads/${target}`,
        properties: { ...(n === undefined ? {} : { n }), deep: deepValue },
        metadata,
      };
    }
    function ownedResult(
      value: Record<string, unknown>,
      resource: unknown,
      source: string,
      operationIndex: number,
      outcome: string,
    ) {
      expect(typeof value.sourceRevision).toBe("string");
      expect(value.sourceRevision).not.toBe("");
      return {
        operationIndex,
        outcome,
        resource,
        source: `${scope}beads/${source}`,
        sourceRevision: value.sourceRevision,
      };
    }
    const seed = receipt(await exchange(1), "fresh-seed", "pos-1"),
      seedResults = records(seed.results);
    expect(seedResults).toHaveLength(3);
    const a = record(seedResults[0]!.resource),
      b = record(seedResults[1]!.resource),
      l0 = record(seedResults[2]!.resource);
    const expectedL0 = link("l", revision(l0), "a", 0, { tag: "initial" });
    fullReceipt(seed, "fresh-seed", "pos-1", [
      { operationIndex: 0, outcome: "created", resource: owner("a", revision(a), {}, []) },
      { operationIndex: 1, outcome: "created", resource: owner("b", revision(b), {}, []) },
      ownedResult(seedResults[2]!, expectedL0, "a", 2, "created"),
    ]);
    prerequisites.push("genuine-deep-owned-link-created");
    const update = receipt(await exchange(2), "fresh-update", "pos-2"),
      updateResult = records(update.results)[0]!;
    const l1 = record(updateResult.resource),
      expectedL1 = link("l", revision(l1), "a", 0, { tag: "updated", deep: deepValue });
    expect(l1.revision).not.toBe(l0.revision);
    expect(updateResult.sourceRevision).not.toBe(seedResults[2]!.sourceRevision);
    fullReceipt(update, "fresh-update", "pos-2", [
      ownedResult(updateResult, expectedL1, "a", 0, "updated"),
    ]);
    receiptTarget = String(update.id); // validated canonical Scope receipts/UUID above, never a fabricated target.
    const noop = receipt(await exchange(3), "fresh-noop", "pos-2");
    fullReceipt(
      noop,
      "fresh-noop",
      "pos-2",
      [ownedResult(updateResult, expectedL1, "a", 0, "updated")],
      false,
    );
    const replay = await exchange(4);
    status(replay, 200, "fresh-depth:exact-update-replay");
    context(replay, "pos-2");
    sameJson(checked(replay.bodyText, "mutationReceipt"), update, "fresh-depth:full-update-replay");
    const conflict = await exchange(5);
    status(conflict, 409, "fresh-depth:changed-body-conflict");
    context(conflict, "pos-2");
    expect(conflict.headers["content-type"]).toBe("application/problem+json");
    sameJson(
      checked(conflict.bodyText, "transactionalProblem"),
      {
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "idempotency-conflict",
        status: 409,
        retry: "never",
      },
      "fresh-depth:full-conflict",
    );
    const set = receipt(await exchange(6), "fresh-set", "pos-3"),
      setResults = records(set.results);
    expect(setResults).toHaveLength(2);
    const setResult = setResults[1]!,
      l2 = record(setResult.resource),
      expectedL2 = link("l", revision(l2), "a", 1, { tag: "updated", deep: deepValue });
    expect(l2.revision).not.toBe(l1.revision);
    expect(setResult.sourceRevision).not.toBe(updateResult.sourceRevision);
    fullReceipt(set, "fresh-set", "pos-3", [
      { operationIndex: 0, outcome: "matched", count: 1 },
      ownedResult(setResult, expectedL2, "a", 0, "updated"),
    ]);
    const sequenceWire = await exchange(7);
    status(sequenceWire, 200, "fresh-depth:dependent-sequence");
    context(sequenceWire, "pos-5");
    const sequence = checked(sequenceWire.bodyText, "transactionalSequenceResponse"),
      sequenceResults = records(sequence.results);
    expect(sequenceResults).toHaveLength(2);
    const c = record(sequenceResults[0]!.resource),
      secondLink = record(sequenceResults[1]!.resource);
    const expectedSecond = link("l2", revision(secondLink), "a", undefined, {}, "c");
    sameJson(
      sequence,
      {
        results: [
          {
            operationIndex: 0,
            operationName: "created",
            outcome: "created",
            resource: owner("c", revision(c), { deep: deepValue }, []),
          },
          ownedResult(sequenceResults[1]!, expectedSecond, "a", 1, "created"),
        ],
      },
      "fresh-depth:full-dependent-sequence",
    );
    const failed = receipt(await exchange(8), "fresh-failed", "pos-5");
    sameJson(
      failed,
      {
        id: failed.id,
        status: "failed",
        detail: "available",
        idempotencyKey: "fresh-failed",
        scopeEpoch: expectedContext?.[0],
        authorizationView: expectedContext?.[1],
        transaction: failed.transaction,
        requiredPosition: "pos-5",
        expiresAt: failed.expiresAt,
        problem: {
          type: "https://github.com/gastownhall/bdp/problems/validation",
          code: "validation-failed",
          status: 422,
          retry: "never",
          operationIndex: 1,
          diagnostics: [
            {
              message: "metadata: Property Change target does not exist",
              instanceLocation: "/absent",
              document: "metadata",
            },
          ],
        },
      },
      "fresh-depth:full-late-failure",
    );
    const failedReplay = await exchange(9);
    status(failedReplay, 200, "fresh-depth:failed-replay");
    context(failedReplay, "pos-5");
    sameJson(
      checked(failedReplay.bodyText, "mutationReceipt"),
      failed,
      "fresh-depth:full-failed-replay",
    );
    const current = await exchange(10);
    status(current, 200, "fresh-depth:rollback-current-link");
    context(current, "pos-5");
    sameJson(checked(current.bodyText, "linkRecord"), expectedL2, "fresh-depth:full-rollback-link");
    const eventsWire = await exchange(11);
    status(eventsWire, 200, "fresh-depth:Events");
    context(eventsWire, "pos-5");
    const page = checked(eventsWire.bodyText, "eventPage"),
      events = records(page.events);
    expect(events).toHaveLength(3);
    const eventSource = `${scope}links/l?view=events`;
    const tag = (kind: string, value: string) =>
      createHash("sha256")
        .update(JSON.stringify([kind, value]))
        .digest("base64url");
    const eventData = [
      {
        revision: l0.revision,
        properties: { n: 0, deep: deepValue },
        metadata: { tag: "initial" },
        source: `${scope}beads/a`,
        target: `${scope}beads/b`,
      },
      {
        previousRevision: l0.revision,
        revision: l1.revision,
        metadataChange: [{ op: "replace", path: "", value: { tag: "updated", deep: deepValue } }],
      },
      {
        previousRevision: l1.revision,
        revision: l2.revision,
        change: [{ op: "replace", path: "/n", value: 1 }],
      },
    ];
    sameJson(
      page,
      {
        source: eventSource,
        next: null,
        events: events.map((event, i) => {
          expect(Number.isFinite(Date.parse(String(event.time)))).toBe(true);
          const ordinal = i === 0 ? 2 : 0;
          // Private fixed-fixture projection spelling, not a normative token format.
          return {
            id: `ev_${tag("epoch", expectedContext![0])}_${tag("view", expectedContext![1])}_${tag("source", eventSource)}_pos-${i + 1}_${ordinal}`,
            ordinal,
            type: i === 0 ? "created" : "updated",
            source: eventSource,
            subject: `${scope}links/l`,
            subjectType: linkType,
            transaction: [seed, update, set][i]!.transaction,
            time: event.time,
            data: eventData[i],
          };
        }),
      },
      "fresh-depth:full-Events-no-noop-or-rollback-event",
    );
    const snapshotWire = await exchange(12);
    status(snapshotWire, 200, "fresh-depth:snapshot-capture");
    context(snapshotWire, "pos-5");
    const snapshot = checked(snapshotWire.bodyText, "snapshotManifest");
    expect(String(snapshot.id).startsWith(`${scope}snapshot?`)).toBe(true);
    expect(snapshot.checkpoint).not.toBe("genesis");
    expect(Number.isFinite(Date.parse(String(snapshot.expiresAt)))).toBe(true);
    sameJson(
      snapshot,
      {
        id: snapshot.id,
        scope,
        scopeEpoch: expectedContext?.[0],
        authorizationView: expectedContext?.[1],
        scopePosition: "pos-5",
        checkpoint: snapshot.checkpoint,
        expiresAt: snapshot.expiresAt,
        erasures: [],
        beads: {
          items: [
            owner("a", sequenceResults[1]!.sourceRevision, {}, [expectedL2, expectedSecond]),
            owner("b", b.revision, {}, []),
            owner("c", c.revision, { deep: deepValue }, []),
          ],
          next: null,
        },
        links: { items: [expectedL2, expectedSecond], next: null },
      },
      "fresh-depth:complete-Snapshot-and-owned-copies",
    );
    const retained = await exchange(13);
    status(retained, 200, "fresh-depth:actual-receipt-id");
    context(retained, "pos-5");
    sameJson(
      checked(retained.bodyText, "mutationReceipt"),
      update,
      "fresh-depth:original-receipt-current-context",
    );
    prerequisites.push(
      "full-receipt-resource-Event-Snapshot-oracles",
      "no-op-replay-rollback-position-stability",
    );
    expect(attempted).toBe(13);
    expect(responses).toHaveLength(13);
    expect(responses.map((row) => row.status)).toStrictEqual(requests.map((row) => row.status));
    expect(responses.map((row) => row.url)).toStrictEqual(
      requests.map((row) => row.url ?? receiptTarget),
    );
    expect(responseSizes.every((bytes) => bytes >= 0 && bytes <= 1048576)).toBe(true);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    const cleanupReason = new Error("installed fresh depth cleanup deadline");
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
            ? "installed fresh depth child stop unproven"
            : "installed fresh depth child remains active",
        ),
      );
    if (child && stopped && (child.child.exitCode !== 0 || child.child.signalCode !== null))
      failures.push(new Error("installed fresh depth child abnormal exit"));
    try {
      if (directory && stopped) rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    const directoryAbsent = directory === undefined || !existsSync(directory);
    if (stopped && !directoryAbsent)
      failures.push(new Error("installed fresh depth directory remains"));
    clearTimeout(deadline);
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    try {
      console.log(
        JSON.stringify({
          observation: "private-installed-fresh-depth",
          outcome: failures.length === 0 ? "passed" : "failed",
          // Supervisor attribution to archives/consumer, never child-attested Git provenance.
          declaredSourceCommit: sourceCommit,
          workspaceDirty,
          entry: resolvedEntry,
          entrySha256,
          binding: binding
            ? {
                served: binding.served,
                operationTargets: binding.operationTargets,
                authorityMode: binding.authorityMode,
              }
            : null,
          routeBindings,
          prerequisites,
          responseBytesTotal: responseSizes.reduce((a, b) => a + b, 0),
          responseBytesMaximum: Math.max(0, ...responseSizes),
          qualifiedEntryRequested: Boolean(process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY),
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
          failureCategories: [
            ...(deadlineExceeded ? ["work-deadline"] : []),
            ...(cleanupExceeded ? ["cleanup-deadline"] : []),
            ...(failures.length ? ["observation-or-cleanup"] : []),
          ],
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
    throw new AggregateError(failures, "installed fresh depth observation and cleanup failed");
}, 60000);
