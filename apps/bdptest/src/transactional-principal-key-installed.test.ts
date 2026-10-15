/** Private installed principal-key observations; no profile qualification. */
import { execFileSync, type ChildProcess } from "node:child_process";
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
  throw new Error("installed principal-key entry override requires declared source commit");
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
// The repository admission mock is harness-only; all state oracles use child HTTP.
const mode = process.env.BDP_TRANSACTIONAL_PRINCIPAL_KEY_MODE ?? "positive";
if (mode !== "positive" && mode !== "collapse-b-to-a")
  throw new Error("invalid installed principal-key mode");
const output = process.env.BDP_TRANSACTIONAL_PRINCIPAL_KEY_OUTPUT;
if (output !== undefined && !path.isAbsolute(output))
  throw new Error("principal-key output must be absolute");
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
const routeBindings: { method: HttpMethod; url: string }[] = [
  { method: "POST", url: `${scope}operations/batch` },
  { method: "GET", url: `${scope}beads/?limit=32` },
  { method: "GET", url: `${scope}events/` },
];
const routeSha256 = "40b5131d96ba76a7a77212c92b9336148142f8afb648caac0107f1dc9af3a837";
// Independent reviewed literals; no dynamic extra receipt fetches or credential probes.
const requests = [
  {
    index: 1,
    label: "a-create",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "a",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/a","type":"https://reference.invalid/acme/types/task","properties":{"title":"a"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "54f0fefb0965a8210bb22cf09601c18296ef450489eff1aef5a8bea8b99d83b8",
    status: 200,
    currentPosition: "pos-1",
  },
  {
    index: 2,
    label: "b-independent-create",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "b",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/b","type":"https://reference.invalid/acme/types/task","properties":{"title":"b"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "b26bbe9a43f5cc9b54d7fe7778786b33e5e8d613bf30248de3af65f5eac0cdc8",
    status: 200,
    currentPosition: "pos-2",
  },
  {
    index: 3,
    label: "a-rotated-replay",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "a-rotated",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/a","type":"https://reference.invalid/acme/types/task","properties":{"title":"a"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "54f0fefb0965a8210bb22cf09601c18296ef450489eff1aef5a8bea8b99d83b8",
    status: 200,
    currentPosition: "pos-2",
  },
  {
    index: 4,
    label: "b-replay",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "b",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/b","type":"https://reference.invalid/acme/types/task","properties":{"title":"b"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "b26bbe9a43f5cc9b54d7fe7778786b33e5e8d613bf30248de3af65f5eac0cdc8",
    status: 200,
    currentPosition: "pos-2",
  },
  {
    index: 5,
    label: "a-conflict",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "a",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/c","type":"https://reference.invalid/acme/types/task","properties":{"title":"c"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "3de2f9bb5fb4b4b0537d252ba722b05a3385414129cf35fc6ab0355720f9ff62",
    status: 409,
    currentPosition: "pos-2",
  },
  {
    index: 6,
    label: "current-complete",
    method: "GET",
    url: "https://reference.invalid/acme/beads/?limit=32",
    credentialRef: "a",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
    ],
    body: null,
    bodyBytes: 0,
    bodySha256: null,
    status: 200,
    currentPosition: "pos-2",
  },
  {
    index: 7,
    label: "events-complete",
    method: "GET",
    url: "https://reference.invalid/acme/events/",
    credentialRef: "a",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
    ],
    body: null,
    bodyBytes: 0,
    bodySha256: null,
    status: 200,
    currentPosition: "pos-2",
  },
] as const;
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected response record");
  return value as Record<string, unknown>;
}
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("expected response array");
  return value.map(record);
}
function outsideStore(filename: string, directory: string) {
  if (!path.isAbsolute(filename)) throw new Error("principal-key evidence path must be absolute");
  const relative = path.relative(directory, path.resolve(filename));
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
    throw new Error("principal-key evidence must remain outside store directory");
}
const conflictProblem = {
  type: "https://github.com/gastownhall/bdp/problems/conflict",
  code: "idempotency-conflict",
  status: 409,
  retry: "never",
} as const;

it("observes independent principal keys and same-principal credential rotation through installed HTTP", async () => {
  const started = performance.now();
  const controller = new AbortController();
  const deadlineReason = new Error("installed principal-key work deadline");
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
  let currentAssertion = "principal-key:setup";
  const passedAssertions: string[] = [];
  const responses: {
    index: number;
    label: string;
    method: HttpMethod;
    url: string;
    credentialRef: string;
    requestBodyBytes: number;
    requestBodySha256: string | null;
    writeState: string | null;
    status: number;
    bodyOctets: number | null;
    bodySha256: string;
    responseWireSha256: string | null;
    scopeEpoch: string | null;
    authorizationView: string | null;
    scopePosition: string | null;
    contentType: string | null;
    contentLength: string | null;
    validatedNegativeProblem: typeof conflictProblem | null;
  }[] = [];
  const roles = {
    a: { token: randomBytes(32).toString("base64url"), principal: "principal-a", canMutate: true },
    "a-rotated": {
      token: randomBytes(32).toString("base64url"),
      principal: "principal-a",
      canMutate: true,
    },
    b: { token: randomBytes(32).toString("base64url"), principal: "principal-b", canMutate: true },
  };
  type Role = keyof typeof roles;
  const roleNames = ["a", "a-rotated", "b"] as const;
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
    ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
    const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
    ajv.addSchema(bundle);
    const validators = Object.fromEntries(
      [
        "mutationReceipt",
        "transactionalProblem",
        "beadRecord",
        "currentBeadCollection",
        "eventPage",
      ].map((name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })] as const),
    );
    function checked(text: string, schema: string) {
      const value = record(JSON.parse(text)),
        validate = validators[schema];
      if (!validate) throw new Error("unbound response schema");
      expect(validate(value), `principal-key:schema:${schema}`).toBe(true);
      return value;
    }
    expect(requests).toHaveLength(7);
    expect(requests.map((r) => r.method)).toStrictEqual([
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
      "GET",
      "GET",
    ]);
    expect(requests.reduce((sum, r) => sum + r.bodyBytes, 0)).toBe(750);
    expect(digest(JSON.stringify(routeBindings))).toBe(routeSha256);
    for (const row of requests) {
      expect(Buffer.byteLength(row.body ?? ""), row.label).toBe(row.bodyBytes);
      expect(row.body === null ? null : digest(row.body), row.label).toBe(row.bodySha256);
    }
    expect(
      artifacts.descriptors.map((a) => [Buffer.byteLength(a.utf8), digest(a.utf8)]),
    ).toStrictEqual([[170, "f448e126550b2809d01dc6b24811d1796e82b2599c35b438550ed3bec65a2a22"]]);
    expect(artifacts.schemas.map((a) => [Buffer.byteLength(a.utf8), digest(a.utf8)])).toStrictEqual(
      [[166, "1ed8b24d90a8c278bc466fd48ba1e849afac01326c377e5c6985855e62373f95"]],
    );
    // Boolean checks avoid ever placing live tokens in assertion diffs.
    expect(new Set(roleNames.map((r) => roles[r].token)).size, "distinct credential tokens").toBe(
      3,
    );
    expect(
      roleNames.every((r) => /^[A-Za-z0-9_-]{43}$/.test(roles[r].token)),
      "credential token shape",
    ).toBe(true);
    expect(roleNames.map((r) => roles[r].principal)).toStrictEqual([
      "principal-a",
      "principal-a",
      "principal-b",
    ]);
    expect(roleNames.every((r) => roles[r].canMutate)).toBe(true);
    if (mode === "collapse-b-to-a") roles.b.principal = "principal-a";
    directory = mkdtempSync(path.join(tmpdir(), "bdp-principal-key-installed-"));
    if (output !== undefined) outsideStore(output, directory);
    // Vitest owns result emission; keep its configured paths outside the removable store too.
    for (let i = 0; i < process.argv.length; i++) {
      const argument = process.argv[i]!;
      let filename: string | undefined;
      if (argument === "--outputFile") {
        filename = process.argv[++i];
        if (filename?.startsWith("-")) throw new Error("principal-key missing outputFile value");
      } else if (argument.startsWith("--outputFile=")) filename = argument.slice(13);
      else continue;
      if (!filename) throw new Error("principal-key missing outputFile value");
      outsideStore(path.resolve(filename), directory);
    }
    controller.signal.throwIfAborted();
    launchAttempted = true;
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        // No ref field is accepted by the closed runtime configuration parser.
        credentials: roleNames.map((role) => ({ ...roles[role] })),
      },
      controller.signal,
    );
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    expect(child.ready.scope).toBe(scope);
    expect(child.ready.claimEligible).toBe(false);
    expect(child.ready.history).toBe(false);
    expect(binding.operationTargets.batch).toBe(`${scope}operations/batch`);
    const address = new URL(child.ready.listenUrl as string);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        // Accepted decoded body <=32KiB; raw wire buffer <=B+2H=160KiB.
        // Receive framed-body rejection threshold B+H=96KiB is not a heap bound.
        maximumBodyBytes: 32768,
        maximumHeaderBytes: 65536,
        exactMode: {
          scope,
          profile: "transactional",
          routes: routeBindings,
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "a",
          credentialHandles: roleNames.map((id) => ({ id, headerNames: ["authorization"] })),
          resolveCredentials: ({ credentialRef }) => {
            if (!roleNames.some((r) => r === credentialRef))
              throw new Error("unknown principal-key credential role");
            return { authorization: `Bearer ${roles[credentialRef as Role].token}` };
          },
        },
      },
    );
    async function exchange(index: number) {
      const row = requests[index - 1];
      if (!row) throw new Error("unbound principal-key request");
      currentAssertion = `principal-key:${row.label}:wire`;
      controller.signal.throwIfAborted();
      expect(attempted + 1, "principal-key exact dispatch order").toBe(index);
      expect(++attempted, "principal-key dispatch bound").toBeLessThanOrEqual(7);
      expect(Buffer.byteLength(row.url)).toBeLessThanOrEqual(8192);
      const response = await execute({
        method: row.method,
        url: row.url,
        signal: controller.signal,
        credentialRef: row.credentialRef,
        raw: {
          headerLines: row.headerLines,
          ...(row.body === null ? {} : { bodyBytes: Buffer.from(row.body) }),
        },
      });
      // Explicit response-only allowlist, before assertions. Never retain whole exchange,
      // effectiveRequest, exactRequest.headerLines, request wire, roles, or runtime config.
      const observation = {
        index,
        label: row.label,
        method: row.method,
        url: row.url,
        credentialRef: row.credentialRef,
        requestBodyBytes: row.bodyBytes,
        requestBodySha256: row.bodySha256,
        writeState: response.exactRequest?.writeState ?? null,
        status: response.status,
        bodyOctets: response.bodyOctets ?? null,
        bodySha256: digest(response.bodyText),
        responseWireSha256: response.wireResponseBytes ? digest(response.wireResponseBytes) : null,
        scopeEpoch: response.headers["bdp-scope-epoch"] ?? null,
        authorizationView: response.headers["bdp-authorization-view"] ?? null,
        scopePosition: response.headers["bdp-scope-position"] ?? null,
        contentType: response.headers["content-type"] ?? null,
        contentLength: response.headers["content-length"] ?? null,
        validatedNegativeProblem: null as typeof conflictProblem | null,
      };
      responses.push(observation);
      expect(response.exactRequest?.source).toBe("raw-http1-serializer");
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.url).toBe(row.url);
      expect(response.exactRequest?.bodyPresent).toBe(row.body !== null);
      expect(response.exactRequest?.bodyOctets).toBe(row.bodyBytes);
      expect(response.exactRequest?.bodyDigest).toBe(row.bodySha256 ?? undefined);
      const headers = response.exactRequest?.headerLines ?? [];
      const values = (name: string) =>
        headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
      expect(values("host")).toStrictEqual(["reference.invalid"]);
      for (const name of ["accept", "content-type", "idempotency-key"]) {
        expect(values(name)).toStrictEqual(
          row.headerLines.filter((h) => h.name === name).map((h) => h.value),
        );
      }
      expect(values("authorization").length, "one credential header").toBe(1);
      expect(
        values("authorization")[0] === `Bearer ${roles[row.credentialRef].token}`,
        "exact credential serialization",
      ).toBe(true);
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(Number.isSafeInteger(response.bodyOctets)).toBe(true);
      expect(response.bodyOctets).toBeGreaterThanOrEqual(0);
      expect(response.bodyOctets).toBeLessThanOrEqual(32768);
      expect(Buffer.byteLength(response.bodyText)).toBe(response.bodyOctets);
      expect(response.headers["content-length"]).toBe(String(response.bodyOctets));
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
      for (const name of contextNames) {
        expect(typeof response.headers[name], `principal-key:${row.label}:${name}`).toBe("string");
        expect(response.headers[name]).not.toBe("");
      }
      if (row.method === "POST") {
        expect(response.headers["cache-control"]).toBe("private, no-store");
        expect(response.headers.vary).toBe("Accept");
        for (const name of ["etag", "last-modified", "retry-after", "www-authenticate"])
          expect(response.headers[name]).toBeUndefined();
      }
      if (response.status === 409) {
        expect(response.headers["content-type"]).toBe("application/problem+json");
        const problem = checked(response.bodyText, "transactionalProblem");
        expect(problem).toStrictEqual(conflictProblem);
        observation.validatedNegativeProblem = { ...conflictProblem };
      }
      return response;
    }
    type Wire = Awaited<ReturnType<typeof exchange>>;
    function status(response: Wire, expected: number, label: string) {
      currentAssertion = label;
      expect(response.status, label).toBe(expected);
      passedAssertions.push(label);
    }
    function context(response: Wire, epoch: unknown, view: unknown, position: string) {
      expect(contextNames.map((name) => response.headers[name])).toStrictEqual([
        epoch,
        view,
        position,
      ]);
    }
    function completed(response: Wire, name: "a" | "b", position: string) {
      status(
        response,
        200,
        `principal-key:${name === "a" ? "a-create" : "b-independent-create"}:completed`,
      );
      expect(response.headers["content-type"]).toBe("application/json");
      const receipt = checked(response.bodyText, "mutationReceipt");
      expect(typeof receipt.scopeEpoch).toBe("string");
      expect(receipt.scopeEpoch).not.toBe("");
      expect(typeof receipt.authorizationView).toBe("string");
      expect(receipt.authorizationView).not.toBe("");
      context(response, receipt.scopeEpoch, receipt.authorizationView, position);
      const results = records(receipt.results);
      expect(results).toHaveLength(1);
      const resource = record(results[0]!.resource);
      expect(validators.beadRecord!(resource), "principal-key:resource-schema").toBe(true);
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
        idempotencyKey: "principal-shared",
        scopeEpoch: receipt.scopeEpoch,
        authorizationView: receipt.authorizationView,
        transaction: receipt.transaction,
        requiredPosition: position,
        effectPosition: position,
        results,
        next: null,
        expiresAt: receipt.expiresAt,
      });
      expect(typeof receipt.id).toBe("string");
      const id = receipt.id as string,
        parsed = new URL(id),
        prefix = `${scope}receipts/`;
      expect(Buffer.byteLength(id)).toBeLessThanOrEqual(8192);
      expect(parsed.href).toBe(id);
      expect(parsed.username).toBe("");
      expect(parsed.password).toBe("");
      expect(parsed.search).toBe("");
      expect(parsed.hash).toBe("");
      expect(id.startsWith(prefix)).toBe(true);
      expect(/^[A-Za-z0-9_-]+$/.test(id.slice(prefix.length))).toBe(true);
      expect(typeof receipt.transaction).toBe("string");
      expect(receipt.transaction).not.toBe("");
      return { receipt, resource };
    }
    const a = completed(await exchange(1), "a", "pos-1");
    const b = completed(await exchange(2), "b", "pos-2");
    expect(b.receipt.scopeEpoch).toBe(a.receipt.scopeEpoch);
    expect(b.receipt.id).not.toBe(a.receipt.id);
    expect(b.receipt.transaction).not.toBe(a.receipt.transaction);
    // No assumption that A and B views must differ or coincide.
    const replayA = await exchange(3);
    status(replayA, 200, "principal-key:a-rotated-replay:completed");
    expect(replayA.headers["content-type"]).toBe("application/json");
    context(replayA, a.receipt.scopeEpoch, a.receipt.authorizationView, "pos-2");
    expect(checked(replayA.bodyText, "mutationReceipt")).toStrictEqual(a.receipt);
    const replayB = await exchange(4);
    status(replayB, 200, "principal-key:b-replay:completed");
    expect(replayB.headers["content-type"]).toBe("application/json");
    context(replayB, b.receipt.scopeEpoch, b.receipt.authorizationView, "pos-2");
    expect(checked(replayB.bodyText, "mutationReceipt")).toStrictEqual(b.receipt);
    const conflict = await exchange(5);
    status(conflict, 409, "principal-key:a-conflict:refused");
    context(conflict, a.receipt.scopeEpoch, a.receipt.authorizationView, "pos-2");
    expect(checked(conflict.bodyText, "transactionalProblem")).toStrictEqual(conflictProblem);
    const collectionWire = await exchange(6);
    status(collectionWire, 200, "principal-key:current-complete");
    expect(collectionWire.headers["content-type"]).toBe("application/json");
    expect(collectionWire.headers["bdp-scope-epoch"]).toBe(a.receipt.scopeEpoch);
    expect(collectionWire.headers["bdp-scope-position"]).toBe("pos-2");
    // A-credentialed Read uses the fixed serving view, not principal-scoped filtering.
    expect(checked(collectionWire.bodyText, "currentBeadCollection")).toStrictEqual({
      items: [a.resource, b.resource],
      next: null,
    });
    const eventsWire = await exchange(7);
    status(eventsWire, 200, "principal-key:events-complete");
    expect(eventsWire.headers["content-type"]).toBe("application/json");
    expect(eventsWire.headers["bdp-scope-epoch"]).toBe(a.receipt.scopeEpoch);
    expect(eventsWire.headers["bdp-scope-position"]).toBe("pos-2");
    const page = checked(eventsWire.bodyText, "eventPage"),
      events = records(page.events);
    expect(events).toHaveLength(2);
    const hash = (tag: string, value: string) =>
      createHash("sha256")
        .update(JSON.stringify([tag, value]))
        .digest("base64url");
    const eventSource = `${scope}events/`;
    // Deliberately independent exact private projection, not a normative Event-ID format.
    const expectedEvents = [a, b].map((saved, index) => ({
      id: `ev_${hash("epoch", eventsWire.headers["bdp-scope-epoch"]!)}_${hash("view", eventsWire.headers["bdp-authorization-view"]!)}_${hash("source", eventSource)}_pos-${index + 1}_0`,
      ordinal: 0,
      type: "created",
      source: eventSource,
      subject: saved.resource.id,
      subjectType: beadType,
      transaction: saved.receipt.transaction,
      time: events[index]!.time,
      data: {
        revision: saved.resource.revision,
        properties: saved.resource.properties,
        metadata: saved.resource.metadata,
      },
    }));
    expect(page).toStrictEqual({ source: eventSource, events: expectedEvents, next: null });
    expect(attempted).toBe(7);
    expect(responses).toHaveLength(7);
    expect(
      responses.map(({ index, label, method, url, credentialRef, status: actual }) => ({
        index,
        label,
        method,
        url,
        credentialRef,
        status: actual,
      })),
    ).toStrictEqual(
      requests.map(({ index, label, method, url, credentialRef, status: expected }) => ({
        index,
        label,
        method,
        url,
        credentialRef,
        status: expected,
      })),
    );
    controller.signal.throwIfAborted();
    currentAssertion = "principal-key:complete";
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    const cleanupReason = new Error("installed principal-key cleanup deadline");
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
    const stopState = !launchAttempted
      ? "not-started"
      : child === undefined
        ? "unknown-pre-ready"
        : stopped
          ? "stopped"
          : "active";
    if (!stopped) failures.push(new Error("installed principal-key child stop is unproven"));
    try {
      if (directory && stopped) rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    const directoryAbsent = directory === undefined || !existsSync(directory);
    if (!directoryAbsent) failures.push(new Error("installed principal-key directory remains"));
    clearTimeout(deadline);
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    // Only this allowlisted projection persists: no credential-bearing config/roles/requests.
    const report = () => ({
      observation: "private-installed-principal-key",
      mode,
      outcome: failures.length === 0 ? "passed" : "failed",
      declaredSourceCommit: sourceCommit,
      workspaceDirty,
      entry: resolvedEntry,
      entrySha256,
      binding: binding ?? null,
      routeDigest: routeSha256,
      descriptorSchemaUtf8: artifacts,
      elapsedMs: performance.now() - started,
      attempted,
      exchanges: responses.length,
      completedResponses: responses,
      passedAssertions,
      currentAssertion,
      failureCount: failures.length,
      deadlineExceeded,
      cleanupExceeded,
      closed,
      launchAttempted,
      stopState,
      startupCompleted: child !== undefined,
      childPid: child?.child.pid ?? null,
      childExitCode: child?.child.exitCode ?? null,
      childSignalCode: child?.child.signalCode ?? null,
      directory: directory ?? null,
      directoryAbsent,
      claimEligible: false,
      retention:
        "response fingerprints/allowlisted fields and validated negative Problem; full receipt/Resource/Event equality in memory; no request wire or credential-bearing objects",
      startupLimitation:
        "Pre-ready PID unknown; independent supervisor owned-process evidence required",
    });
    if (output !== undefined) {
      try {
        writeFileSync(output, `${JSON.stringify(report(), null, 2)}\n`);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      console.log(JSON.stringify(report()));
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed principal-key observation and cleanup failed");
}, 60000);
