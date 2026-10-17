/** Private installed minimum receiving observations; no profile qualification. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { request as httpRequest } from "node:http";
import type { ClientRequest } from "node:http";
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
        properties: { n: { type: "number" } },
        required: ["n"],
        additionalProperties: false,
      }),
    },
  ],
};
const entry =
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/transaction-installed-process.js");
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("installed minimum entry override requires declared source commit");
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
const validReceipt = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceipt` });
const validResource = ajv.compile({ $ref: `${bundle.$id}#/$defs/currentBeadRecord` });
const validProblem = ajv.compile({ $ref: `${bundle.$id}#/$defs/transactionalProblem` });
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
const retainedHeaders = [
  ...contextNames,
  "content-type",
  "content-length",
  "cache-control",
  "retry-after",
  "www-authenticate",
  "x-bdp-development",
  "x-bdp-development-limit",
  "etag",
  "last-modified",
  "allow",
  "location",
  "link",
];

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected response record");
  return value as Record<string, unknown>;
}
function receiptResults(value: Record<string, unknown>) {
  if (!Array.isArray(value.results)) throw new Error("expected receipt results");
  return value.results.map(record);
}
const seedBody = JSON.stringify({
  operations: Array.from({ length: 32 }, (_, n) => ({
    operation: "createBead",
    id: `beads/r${String(n).padStart(2, "0")}`,
    type: beadType,
    properties: { n: 0 },
  })),
});
const setBody = JSON.stringify({
  collection: "beads",
  selector: `$[?@.type == "${beadType}"]`,
  cardinality: { min: 32, max: 32 },
  change: [{ op: "replace", path: "/n", value: 1 }],
});

it("rejects malformed read minimum tuples before observation while preserving receipt nondisclosure", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed minimum receiving deadline");
  let deadlineExceeded = false,
    cleanupExceeded = false,
    launchAttempted = false,
    closed = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  const failures: unknown[] = [];
  const categories: string[] = [];
  const fail = (error: unknown, category: string) => {
    if (!failures.includes(error)) {
      failures.push(error);
      categories.push(category);
    }
  };
  let phase = "setup";
  let directory: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let attempted = 0;
  const active = new Set<ClientRequest>();
  const pending = new Set<Promise<unknown>>();
  const responses: {
    ordinal: number;
    label: string;
    method: string;
    url: string;
    credential: string;
    requestBodyBytes: number;
    requestBodySha256: string | null;
    minimumFieldOccurrences: number[];
    status: number;
    bodyOctets: number;
    bodySha256: string;
    headers: Record<string, string | null>;
  }[] = [];
  const writer = randomBytes(32).toString("base64url"),
    other = randomBytes(32).toString("base64url");
  try {
    expect([Buffer.byteLength(seedBody), Buffer.byteLength(setBody)]).toStrictEqual([3728, 179]);
    directory = mkdtempSync(path.join(tmpdir(), "bdp-minimum-receiving-installed-"));
    controller.signal.throwIfAborted();
    launchAttempted = true;
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [
          { token: writer, principal: "writer", canMutate: true },
          { token: other, principal: "other", canMutate: false },
        ],
      },
      controller.signal,
    );
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    expect(child.ready.scope).toBe(scope);
    expect(binding.operationTargets.batch).toBe(`${scope}operations/batch`);
    expect(binding.operationTargets.updateWhere).toBe(`${scope}operations/update-where`);
    const address = new URL(child.ready.listenUrl as string);
    const granted = new Set([
      `${scope}operations/batch`,
      `${scope}operations/update-where`,
      `${scope}beads/r00`,
      `${scope}beads/missing`,
    ]);
    const exchange = async (
      label: string,
      method: "GET" | "HEAD" | "POST",
      url: string,
      fields: string[] = [],
      credential: "writer" | "other" | "anonymous" = "writer",
      requestBody?: string,
      key?: string,
    ) => {
      phase = label;
      controller.signal.throwIfAborted();
      expect(++attempted, "installed minimum dispatch bound").toBeLessThanOrEqual(22);
      expect(granted.has(url), "fixed or actually issued URL grant").toBe(true);
      const target = new URL(url);
      expect(target.origin).toBe(new URL(scope).origin);
      expect([target.hash, target.username, target.password]).toStrictEqual(["", "", ""]);
      expect(Buffer.byteLength(url)).toBeLessThanOrEqual(8192);
      const headers = [
        "Host",
        new URL(scope).host,
        "Connection",
        "close",
        "Accept",
        "application/json",
        ...(credential === "anonymous"
          ? []
          : ["Authorization", `Bearer ${credential === "writer" ? writer : other}`]),
        ...(requestBody === undefined
          ? []
          : [
              "Content-Type",
              "application/json",
              "Content-Length",
              String(Buffer.byteLength(requestBody)),
              "Idempotency-Key",
              key ?? "missing-key",
            ]),
        ...fields,
      ];
      const operation = new Promise<{
        status: number;
        headers: Headers;
        text: string;
        bytes: number;
      }>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: address.hostname,
            port: Number(address.port),
            path: target.pathname + target.search,
            method,
            agent: false,
            headers,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          },
          (response) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 32768) {
                const error = new Error("installed minimum response overflow");
                response.destroy(error);
                request.destroy(error);
                return;
              }
              chunks.push(chunk);
            });
            response.once("aborted", () => reject(new Error("installed minimum response aborted")));
            response.once("error", reject);
            response.once("end", () => {
              const received = new Headers();
              for (let i = 0; i < response.rawHeaders.length; i += 2)
                received.append(response.rawHeaders[i]!, response.rawHeaders[i + 1]!);
              resolve({
                status: response.statusCode ?? 0,
                headers: received,
                text: Buffer.concat(chunks).toString("utf8"),
                bytes,
              });
            });
          },
        );
        active.add(request);
        request.once("close", () => active.delete(request));
        request.once("error", reject);
        request.end(requestBody);
      });
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      const response = await operation;
      const minimumNames = [
        "bdp-minimum-scope-position",
        "bdp-scope-epoch",
        "bdp-authorization-view",
      ];
      responses.push({
        ordinal: attempted,
        label,
        method,
        url,
        credential,
        requestBodyBytes: requestBody === undefined ? 0 : Buffer.byteLength(requestBody),
        requestBodySha256: requestBody === undefined ? null : digest(requestBody),
        minimumFieldOccurrences: minimumNames.map(
          (name) => fields.filter((field, i) => i % 2 === 0 && field.toLowerCase() === name).length,
        ),
        status: response.status,
        bodyOctets: response.bytes,
        bodySha256: digest(response.text),
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers.get(name)]),
        ),
      });
      expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
      return response;
    };
    type Response = Awaited<ReturnType<typeof exchange>>;
    const context = (response: Response) => contextNames.map((name) => response.headers.get(name));
    const problem = (response: Response, status: number, code: string) => {
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      const value = record(JSON.parse(response.text));
      expect(validProblem(value), JSON.stringify(validProblem.errors)).toBe(true);
      expect(value).toMatchObject({ status, code });
      return value;
    };
    const receipt = (response: Response, key: string, position: string) => {
      expect(response.status).toBe(200);
      const value = record(JSON.parse(response.text));
      expect(validReceipt(value), JSON.stringify(validReceipt.errors)).toBe(true);
      expect(value).toMatchObject({
        status: "completed",
        idempotencyKey: key,
        requiredPosition: position,
        effectPosition: position,
      });
      expect(context(response)[2]).toBe(position);
      expect([value.scopeEpoch, value.authorizationView]).toStrictEqual(
        context(response).slice(0, 2),
      );
      expect(
        context(response)
          .slice(0, 2)
          .every((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(v)),
      ).toBe(true);
      return value;
    };
    const seed = await exchange(
      "seed-post-ignores-malformed-minimum",
      "POST",
      `${scope}operations/batch`,
      ["BDP-Minimum-Scope-Position", "invalid,invalid"],
      "writer",
      seedBody,
      "minimum-receiving-seed",
    );
    const seeded = receipt(seed, "minimum-receiving-seed", "pos-1");
    expect(receiptResults(seeded)).toHaveLength(32);
    expect(seeded.next).toBeNull();
    const updated = await exchange(
      "issue-real-page",
      "POST",
      `${scope}operations/update-where`,
      [],
      "writer",
      setBody,
      "minimum-receiving-paged",
    );
    const paged = receipt(updated, "minimum-receiving-paged", "pos-2");
    expect(receiptResults(paged)).toHaveLength(32);
    const receiptRoot = paged.id,
      pageUrl = paged.next;
    if (typeof receiptRoot !== "string" || typeof pageUrl !== "string")
      throw new Error("actual issued receipt/page required");
    for (const url of [receiptRoot, pageUrl]) {
      const parsed = new URL(url);
      expect(parsed.href).toBe(url);
      expect(parsed.origin).toBe(new URL(scope).origin);
      expect([parsed.search, parsed.hash, parsed.username, parsed.password]).toStrictEqual([
        "",
        "",
        "",
        "",
      ]);
      granted.add(url);
    }
    expect(receiptRoot.startsWith(`${scope}receipts/`)).toBe(true);
    expect(receiptRoot.slice(`${scope}receipts/`.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pageUrl.startsWith(`${receiptRoot}/pages/`)).toBe(true);
    expect(pageUrl.slice(`${receiptRoot}/pages/`.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    const expectedContext = context(updated);
    expect(expectedContext.slice(0, 2)).toStrictEqual(context(seed).slice(0, 2));
    const tuple = [
      "BDP-Minimum-Scope-Position",
      "pos-2",
      "BDP-Scope-Epoch",
      expectedContext[0]!,
      "BDP-Authorization-View",
      expectedContext[1]!,
    ];
    const point = `${scope}beads/r00`;
    const first = await exchange("all-absent", "GET", point);
    expect(first.status).toBe(200);
    const resource = record(JSON.parse(first.text));
    expect(validResource(resource), JSON.stringify(validResource.errors)).toBe(true);
    expect(resource).toStrictEqual({
      id: point,
      type: beadType,
      properties: { n: 1 },
      metadata: {},
      revision: resource.revision,
    });
    expect(typeof resource.revision).toBe("string");
    expect(
      receiptResults(paged).find((result) => record(result.resource ?? {}).id === point),
    ).toStrictEqual({ operationIndex: 0, outcome: "updated", resource });
    expect(context(first)).toStrictEqual(expectedContext);
    let malformedLength: string | null = null;
    const malformed = (response: Response, head = false) => {
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      for (const name of [
        ...contextNames,
        "etag",
        "last-modified",
        "location",
        "link",
        "x-bdp-development-limit",
      ])
        expect(response.headers.has(name), name).toBe(false);
      if (head) {
        expect(response.text).toBe("");
        expect(response.bytes).toBe(0);
        expect(response.headers.get("content-length")).toBe(malformedLength);
      } else {
        expect(problem(response, 400, "malformed-request")).toMatchObject({ retry: "never" });
        expect(Number(response.headers.get("content-length"))).toBe(response.bytes);
        malformedLength = response.headers.get("content-length");
      }
    };
    malformed(await exchange("missing-two", "GET", point, ["BDP-Minimum-Scope-Position", "pos-2"]));
    malformed(
      await exchange("head-missing-epoch", "HEAD", point, [
        "BDP-Minimum-Scope-Position",
        "pos-2",
        "BDP-Authorization-View",
        expectedContext[1]!,
        "If-None-Match",
        "*",
      ]),
      true,
    );
    for (let index = 0; index < 3; index++)
      malformed(
        await exchange(`raw-duplicate-${index}`, "GET", point, [
          ...tuple,
          tuple[index * 2]!.toLowerCase(),
          tuple[index * 2 + 1]!,
        ]),
      );
    malformed(
      await exchange("single-comma-value", "GET", point, [
        tuple[0]!,
        "pos-2,pos-2",
        ...tuple.slice(2),
      ]),
    );
    for (const url of [receiptRoot, pageUrl])
      for (const credential of ["writer", "other"] as const)
        malformed(
          await exchange(
            `malformed-${url === receiptRoot ? "receipt" : "page"}-${credential}`,
            "GET",
            url,
            ["BDP-Minimum-Scope-Position", "pos-2"],
            credential,
          ),
        );
    const unknown = [tuple[0]!, "unknown", ...tuple.slice(2)];
    for (const url of [receiptRoot, pageUrl]) {
      const response = await exchange(
        `foreign-unknown-${url === receiptRoot ? "receipt" : "page"}`,
        "GET",
        url,
        unknown,
        "other",
      );
      problem(response, 404, "resource-not-found");
      expect(context(response)).toStrictEqual(expectedContext);
      expect(response.headers.has("x-bdp-development-limit")).toBe(false);
    }
    for (const url of [receiptRoot, pageUrl]) {
      const response = await exchange(
        `own-unknown-${url === receiptRoot ? "receipt" : "page"}`,
        "GET",
        url,
        unknown,
      );
      if (url === receiptRoot) {
        expect(problem(response, 503, "catch-up-timeout")).toMatchObject({ retry: "after-delay" });
        expect(response.headers.get("retry-after")).toBe("1");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("x-bdp-development-limit")).toBeNull();
        expect(context(response)).toStrictEqual(expectedContext);
      } else {
        expect(problem(response, 503, "catch-up-timeout")).toMatchObject({ retry: "after-delay" });
        expect(response.headers.get("retry-after")).toBe("1");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.has("x-bdp-development-limit")).toBe(false);
        expect(context(response)).toStrictEqual(expectedContext);
      }
    }
    const missing = await exchange("compatible-missing", "GET", `${scope}beads/missing`, tuple);
    problem(missing, 404, "resource-not-found");
    expect(context(missing)).toStrictEqual(expectedContext);
    const compatible = await exchange("compatible-existing", "GET", point, tuple);
    expect(compatible.status).toBe(200);
    expect(record(JSON.parse(compatible.text))).toStrictEqual(resource);
    expect(context(compatible)).toStrictEqual(expectedContext);
    const ahead = await exchange("same-view-ahead", "GET", point, [
      tuple[0]!,
      "pos-3",
      ...tuple.slice(2),
    ]);
    problem(ahead, 503, "catch-up-timeout");
    expect(context(ahead)).toStrictEqual(expectedContext);
    const anonymous = await exchange(
      "anonymous-malformed",
      "GET",
      point,
      [tuple[0]!, "pos-2"],
      "anonymous",
    );
    problem(anonymous, 401, "unauthenticated");
    expect(context(anonymous)).toStrictEqual([null, null, null]);
    const method = await exchange("method-before-minimum", "POST", point, [tuple[0]!, "pos-2"]);
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET, HEAD");
    expect(method.text).toBe("");
    expect(context(method)).toStrictEqual([null, null, null]);
    expect(attempted).toBe(22);
    expect(responses).toHaveLength(22);
    controller.signal.throwIfAborted();
  } catch (error) {
    fail(error, phase);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    for (const request of active) request.destroy();
    const cleanupReason = new Error("installed minimum cleanup deadline");
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleaning = (async () => {
      for (const result of await Promise.allSettled([...pending]))
        if (result.status === "rejected") fail(result.reason, "transport-drain");
      if (child) {
        await child.close();
        closed = true;
      }
    })();
    try {
      await Promise.race([
        cleaning,
        new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => {
            cleanupExceeded = true;
            child?.child.kill("SIGKILL");
            reject(cleanupReason);
          }, 10000);
        }),
      ]);
    } catch (error) {
      fail(error, "cleanup");
    } finally {
      clearTimeout(cleanupTimer);
    }
    const stopped =
      !launchAttempted ||
      (child !== undefined && (child.child.exitCode !== null || child.child.signalCode !== null));
    if (!stopped) fail(new Error("installed minimum child stop unknown"), "unknown-stop");
    try {
      if (directory && stopped) rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      fail(error, "directory-cleanup");
    }
    const directoryAbsent = directory === undefined || !existsSync(directory);
    if (!directoryAbsent)
      fail(new Error("installed minimum directory preserved"), "directory-retained");
    if (deadlineExceeded) fail(deadlineReason, "deadline");
    try {
      console.log(
        JSON.stringify({
          observation: "private-installed-minimum-receiving",
          outcome: failures.length ? "failed" : "passed",
          declaredSourceCommit: sourceCommit,
          workspaceDirty,
          entry: resolvedEntry,
          entrySha256,
          binding: binding ?? null,
          artifactBytes:
            artifacts.descriptors.reduce((n, d) => n + Buffer.byteLength(d.utf8), 0) +
            artifacts.schemas.reduce((n, s) => n + Buffer.byteLength(s.utf8), 0),
          attempted,
          exchanges: responses.length,
          completedResponses: responses,
          deadlineExceeded,
          cleanupExceeded,
          launchAttempted,
          startupCompleted: child !== undefined,
          closed,
          childPid: child?.child.pid ?? null,
          childExitCode: child?.child.exitCode ?? null,
          childSignalCode: child?.child.signalCode ?? null,
          directory: directory ?? null,
          directoryAbsent,
          failureCount: failures.length,
          failureCategories: categories,
          claimEligible: false,
          retention:
            "safe response headers and body fingerprints; actual bodies asserted in memory; no credentials or raw configuration retained",
          startupLimitation:
            "attempted launch without returned child leaves stop unknown and preserves owned directory for supervisor evidence",
        }),
      );
    } catch (error) {
      fail(error, "report");
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed minimum receiving and cleanup failed");
}, 60000);

it("observes installed opaque receipt root timeout with principal nondisclosure", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed receipt root receiving deadline");
  let deadlineExceeded = false,
    cleanupExceeded = false,
    launchAttempted = false,
    closed = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  const failures: unknown[] = [];
  const categories: string[] = [];
  const fail = (error: unknown, category: string) => {
    if (!failures.includes(error)) {
      failures.push(error);
      categories.push(category);
    }
  };
  let phase = "setup";
  let directory: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let attempted = 0;
  const active = new Set<ClientRequest>();
  const pending = new Set<Promise<unknown>>();
  const responses: {
    ordinal: number;
    label: string;
    method: string;
    url: string;
    credential: string;
    requestBodyBytes: number;
    requestBodySha256: string | null;
    minimumFieldOccurrences: number[];
    status: number;
    bodyOctets: number;
    bodySha256: string;
    headers: Record<string, string | null>;
  }[] = [];
  const writer = randomBytes(32).toString("base64url"),
    other = randomBytes(32).toString("base64url");
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-receipt-root-minimum-installed-"));
    controller.signal.throwIfAborted();
    launchAttempted = true;
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [
          { token: writer, principal: "writer", canMutate: true },
          { token: other, principal: "other", canMutate: false },
        ],
      },
      controller.signal,
    );
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    expect(child.ready.scope).toBe(scope);
    expect(binding.operationTargets.batch).toBe(`${scope}operations/batch`);
    const address = new URL(child.ready.listenUrl as string);
    const granted = new Set([`${scope}operations/batch`, `${scope}receipts/missing`]);
    const exchange = async (
      label: string,
      method: "GET" | "HEAD" | "POST",
      url: string,
      fields: string[] = [],
      credential: "writer" | "other" | "anonymous" = "writer",
      requestBody?: string,
      key?: string,
    ) => {
      phase = label;
      controller.signal.throwIfAborted();
      expect(++attempted, "installed receipt root dispatch bound").toBeLessThanOrEqual(5);
      expect(granted.has(url), "fixed or actually issued URL grant").toBe(true);
      const target = new URL(url);
      expect(target.origin).toBe(new URL(scope).origin);
      expect([target.hash, target.username, target.password]).toStrictEqual(["", "", ""]);
      expect(Buffer.byteLength(url)).toBeLessThanOrEqual(8192);
      const headers = [
        "Host",
        new URL(scope).host,
        "Connection",
        "close",
        "Accept",
        "application/json",
        ...(credential === "anonymous"
          ? []
          : ["Authorization", `Bearer ${credential === "writer" ? writer : other}`]),
        ...(requestBody === undefined
          ? []
          : [
              "Content-Type",
              "application/json",
              "Content-Length",
              String(Buffer.byteLength(requestBody)),
              "Idempotency-Key",
              key ?? "missing-key",
            ]),
        ...fields,
      ];
      const operation = new Promise<{
        status: number;
        headers: Headers;
        text: string;
        bytes: number;
      }>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: address.hostname,
            port: Number(address.port),
            path: target.pathname + target.search,
            method,
            agent: false,
            headers,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          },
          (response) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 32768) {
                const error = new Error("installed receipt root response overflow");
                response.destroy(error);
                request.destroy(error);
                return;
              }
              chunks.push(chunk);
            });
            response.once("aborted", () =>
              reject(new Error("installed receipt root response aborted")),
            );
            response.once("error", reject);
            response.once("end", () => {
              const received = new Headers();
              for (let i = 0; i < response.rawHeaders.length; i += 2)
                received.append(response.rawHeaders[i]!, response.rawHeaders[i + 1]!);
              resolve({
                status: response.statusCode ?? 0,
                headers: received,
                text: Buffer.concat(chunks).toString("utf8"),
                bytes,
              });
            });
          },
        );
        active.add(request);
        request.once("close", () => active.delete(request));
        request.once("error", reject);
        request.end(requestBody);
      });
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      const response = await operation;
      const minimumNames = [
        "bdp-minimum-scope-position",
        "bdp-scope-epoch",
        "bdp-authorization-view",
      ];
      responses.push({
        ordinal: attempted,
        label,
        method,
        url,
        credential,
        requestBodyBytes: requestBody === undefined ? 0 : Buffer.byteLength(requestBody),
        requestBodySha256: requestBody === undefined ? null : digest(requestBody),
        minimumFieldOccurrences: minimumNames.map(
          (name) => fields.filter((field, i) => i % 2 === 0 && field.toLowerCase() === name).length,
        ),
        status: response.status,
        bodyOctets: response.bytes,
        bodySha256: digest(response.text),
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers.get(name)]),
        ),
      });
      expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
      return response;
    };
    type Response = Awaited<ReturnType<typeof exchange>>;
    const context = (response: Response) => contextNames.map((name) => response.headers.get(name));
    const problem = (response: Response, status: number, code: string) => {
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      const value = record(JSON.parse(response.text));
      expect(validProblem(value), JSON.stringify(validProblem.errors)).toBe(true);
      expect(value).toMatchObject({ status, code });
      return value;
    };
    const receipt = (response: Response, key: string, position: string) => {
      expect(response.status).toBe(200);
      const value = record(JSON.parse(response.text));
      expect(validReceipt(value), JSON.stringify(validReceipt.errors)).toBe(true);
      expect(value).toMatchObject({
        status: "completed",
        idempotencyKey: key,
        requiredPosition: position,
        effectPosition: position,
      });
      expect(context(response)[2]).toBe(position);
      expect([value.scopeEpoch, value.authorizationView]).toStrictEqual(
        context(response).slice(0, 2),
      );
      expect(
        context(response)
          .slice(0, 2)
          .every((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(v)),
      ).toBe(true);
      return value;
    };
    const key = `receipt-root-${randomBytes(12).toString("hex")}`;
    const payload = JSON.stringify({
      operations: [
        {
          operation: "createBead",
          id: "beads/receipt-root",
          type: beadType,
          properties: { n: 0 },
        },
      ],
    });
    const seed = await exchange(
      "seed",
      "POST",
      `${scope}operations/batch`,
      [],
      "writer",
      payload,
      key,
    );
    const seeded = receipt(seed, key, "pos-1");
    expect(receiptResults(seeded)).toHaveLength(1);
    expect(seeded.next).toBeNull();
    const receiptRoot = seeded.id;
    if (typeof receiptRoot !== "string") throw new Error("actual issued receipt root required");
    const parsed = new URL(receiptRoot);
    expect(parsed.href).toBe(receiptRoot);
    expect(parsed.origin).toBe(new URL(scope).origin);
    expect([parsed.search, parsed.hash, parsed.username, parsed.password]).toStrictEqual([
      "",
      "",
      "",
      "",
    ]);
    expect(receiptRoot.startsWith(`${scope}receipts/`)).toBe(true);
    expect(receiptRoot.slice(`${scope}receipts/`.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    granted.add(receiptRoot);
    const expectedContext = context(seed);
    const tuple = [
      "BDP-Minimum-Scope-Position",
      "unknown",
      "BDP-Scope-Epoch",
      expectedContext[0]!,
      "BDP-Authorization-View",
      expectedContext[1]!,
    ];
    const own = await exchange("owned-root", "GET", receiptRoot, [...tuple, "If-None-Match", "*"]);
    expect(problem(own, 503, "catch-up-timeout")).toMatchObject({ retry: "after-delay" });
    const head = await exchange("owned-root-head", "HEAD", receiptRoot, [
      ...tuple,
      "If-Match",
      '"absent"',
    ]);
    expect(head.status).toBe(503);
    expect(head.text).toBe("");
    expect(head.bytes).toBe(0);
    expect(own.bytes).toBeGreaterThan(0);
    expect(Number(own.headers.get("content-length"))).toBe(own.bytes);
    expect(head.headers.get("content-length")).toBe(own.headers.get("content-length"));
    for (const response of [own, head]) {
      expect(context(response)).toStrictEqual(expectedContext);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("retry-after")).toBe("1");
      for (const name of ["etag", "last-modified", "x-bdp-development-limit"])
        expect(response.headers.has(name)).toBe(false);
    }
    const foreign = await exchange("other-principal", "GET", receiptRoot, tuple, "other");
    const missing = await exchange("missing-root", "GET", `${scope}receipts/missing`, tuple);
    for (const response of [foreign, missing]) {
      problem(response, 404, "resource-not-found");
      expect(context(response)).toStrictEqual(expectedContext);
      expect(response.headers.has("x-bdp-development-limit")).toBe(false);
    }
    expect(attempted).toBe(5);
    expect(responses).toHaveLength(5);
    expect(responses.map(({ method, status }) => ({ method, status }))).toStrictEqual([
      { method: "POST", status: 200 },
      { method: "GET", status: 503 },
      { method: "HEAD", status: 503 },
      { method: "GET", status: 404 },
      { method: "GET", status: 404 },
    ]);
    controller.signal.throwIfAborted();
  } catch (error) {
    fail(error, phase);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    const cleanupReason = new Error("installed receipt root cleanup deadline");
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    // Await both operation settlement and transport close; one deadline also covers child close.
    const transportDrain = Promise.all(
      [...active].map(
        (request) =>
          new Promise<void>((resolve) => {
            request.once("close", resolve);
            request.destroy();
          }),
      ),
    );
    const cleaning = (async () => {
      for (const result of await Promise.allSettled([...pending]))
        if (result.status === "rejected") fail(result.reason, "transport-drain");
      await transportDrain;
      if (child) await child.close();
    })();
    // Retain late failures after the race without letting a late close mark ownership clean.
    void cleaning.catch((error) => fail(error, "late-cleanup"));
    try {
      await Promise.race([
        cleaning,
        new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => {
            cleanupExceeded = true;
            child?.child.kill("SIGKILL");
            reject(cleanupReason);
          }, 10000);
        }),
      ]);
      if (
        child &&
        !cleanupExceeded &&
        child.child.exitCode === 0 &&
        child.child.signalCode === null
      )
        closed = true;
      else if (launchAttempted)
        fail(new Error("installed receipt root clean close unproved"), "unclean-close");
    } catch (error) {
      fail(error, "cleanup");
    } finally {
      clearTimeout(cleanupTimer);
    }
    if (deadlineExceeded) fail(deadlineReason, "deadline");
    const stopped =
      !launchAttempted ||
      (child !== undefined && (child.child.exitCode !== null || child.child.signalCode !== null));
    if (!stopped) fail(new Error("installed receipt root child stop unknown"), "unknown-stop");
    try {
      if (directory && (!launchAttempted || (closed && failures.length === 0)))
        rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      fail(error, "directory-cleanup");
    }
    const directoryAbsent = directory === undefined || !existsSync(directory);
    if (!directoryAbsent)
      fail(new Error("installed receipt root directory preserved"), "directory-retained");
    try {
      console.log(
        JSON.stringify({
          observation: "private-installed-receipt-root-minimum",
          outcome: failures.length ? "failed" : "passed",
          declaredSourceCommit: sourceCommit,
          workspaceDirty,
          entry: resolvedEntry,
          entrySha256,
          binding: binding ?? null,
          artifactBytes:
            artifacts.descriptors.reduce((n, d) => n + Buffer.byteLength(d.utf8), 0) +
            artifacts.schemas.reduce((n, s) => n + Buffer.byteLength(s.utf8), 0),
          attempted,
          exchanges: responses.length,
          completedResponses: responses,
          deadlineExceeded,
          cleanupExceeded,
          launchAttempted,
          startupCompleted: child !== undefined,
          closed,
          childPid: child?.child.pid ?? null,
          childExitCode: child?.child.exitCode ?? null,
          childSignalCode: child?.child.signalCode ?? null,
          directory: directory ?? null,
          directoryAbsent,
          activeRequests: active.size,
          pendingOperations: pending.size,
          failureCount: failures.length,
          failureCategories: categories,
          claimEligible: false,
          retention:
            "safe response metadata/fingerprints; bodies asserted in memory; no credentials logged",
          startupLimitation:
            "pre-ready or unclean ownership preserves directory for supervisor evidence",
        }),
      );
    } catch (error) {
      fail(error, "report");
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed receipt root and cleanup failed");
}, 60000);

it("observes installed current observation minima within37requests", async () => {
  const started = performance.now();
  const controller = new AbortController();
  const deadlineReason = new Error("installed current observation receiving deadline");
  let deadlineExceeded = false,
    cleanupExceeded = false,
    launchAttempted = false,
    closed = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  const failures: unknown[] = [];
  const categories: string[] = [];
  const fail = (error: unknown, category: string) => {
    if (!failures.includes(error)) {
      failures.push(error);
      categories.push(category);
    }
  };
  let phase = "setup";
  let directory: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let attempted = 0;
  const childLifetime: {
    close: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  } = { close: undefined };
  let childDrain: Promise<void> | undefined;
  const active = new Set<ClientRequest>();
  const pending = new Set<Promise<unknown>>();
  const responses: {
    ordinal: number;
    label: string;
    method: string;
    url: string;
    credential: string;
    requestBodyBytes: number;
    requestBodySha256: string | null;
    minimumFieldOccurrences: number[];
    status: number;
    bodyOctets: number;
    bodySha256: string;
    headers: Record<string, string | null>;
  }[] = [];
  const writer = randomBytes(32).toString("base64url"),
    other = randomBytes(32).toString("base64url");
  const linkType = `${scope}types/relation`;
  const localArtifacts = {
    ...artifacts,
    descriptors: [
      ...artifacts.descriptors,
      {
        retrievalUri: linkType,
        utf8: JSON.stringify({
          id: linkType,
          name: "Relation",
          describes: "link",
          conformsTo: [],
          source: { conformsTo: [beadType], external: "opaque" },
          target: { conformsTo: [beadType], external: "opaque" },
        }),
      },
    ],
  };
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-current-observation-minimum-installed-"));
    controller.signal.throwIfAborted();
    launchAttempted = true;
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts: localArtifacts,
        credentials: [
          { token: writer, principal: "writer", canMutate: true },
          { token: other, principal: "other", canMutate: false },
        ],
      },
      controller.signal,
    );
    childDrain = new Promise<void>((resolve) => {
      child!.child.once("close", (code, signal) => {
        childLifetime.close = { code, signal };
        resolve();
      });
    });
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    expect(child.ready.scope).toBe(scope);
    expect(binding.operationTargets.batch).toBe(`${scope}operations/batch`);
    const address = new URL(child.ready.listenUrl as string);
    const granted = new Set([
      `${scope}operations/batch`,
      `${scope}operations/update-where`,
      `${scope}types/task`,
      `${scope}types/`,
      `${scope}types/missing`,
      `${scope}beads/r00?view=links`,
      `${scope}beads/missing?view=links`,
    ]);
    const exchange = async (
      label: string,
      method: "GET" | "HEAD" | "POST",
      url: string,
      fields: string[] = [],
      credential: "writer" | "other" | "anonymous" = "writer",
      requestBody?: string,
      key?: string,
    ) => {
      phase = label;
      controller.signal.throwIfAborted();
      expect(++attempted, "installed current observation dispatch bound").toBeLessThanOrEqual(37);
      expect(granted.has(url), "fixed or actually issued URL grant").toBe(true);
      const target = new URL(url);
      expect(target.origin).toBe(new URL(scope).origin);
      expect([target.hash, target.username, target.password]).toStrictEqual(["", "", ""]);
      expect(Buffer.byteLength(url)).toBeLessThanOrEqual(8192);
      const headers = [
        "Host",
        new URL(scope).host,
        "Connection",
        "close",
        ...(fields.some((field, i) => i % 2 === 0 && field.toLowerCase() === "accept")
          ? []
          : ["Accept", "application/json"]),
        ...(credential === "anonymous"
          ? []
          : ["Authorization", `Bearer ${credential === "writer" ? writer : other}`]),
        ...(requestBody === undefined
          ? []
          : [
              "Content-Type",
              "application/json",
              "Content-Length",
              String(Buffer.byteLength(requestBody)),
              "Idempotency-Key",
              key ?? "missing-key",
            ]),
        ...fields,
      ];
      const operation = new Promise<{
        status: number;
        headers: Headers;
        text: string;
        bytes: number;
      }>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: address.hostname,
            port: Number(address.port),
            path: target.pathname + target.search,
            method,
            agent: false,
            headers,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          },
          (response) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 32768) {
                const error = new Error("installed current observation response overflow");
                response.destroy(error);
                request.destroy(error);
                return;
              }
              chunks.push(chunk);
            });
            response.once("aborted", () =>
              reject(new Error("installed current observation response aborted")),
            );
            response.once("error", reject);
            response.once("end", () => {
              const received = new Headers();
              for (let i = 0; i < response.rawHeaders.length; i += 2)
                received.append(response.rawHeaders[i]!, response.rawHeaders[i + 1]!);
              resolve({
                status: response.statusCode ?? 0,
                headers: received,
                text: Buffer.concat(chunks).toString("utf8"),
                bytes,
              });
            });
          },
        );
        active.add(request);
        request.once("close", () => active.delete(request));
        request.once("error", reject);
        request.end(requestBody);
      });
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      const response = await operation;
      const minimumNames = [
        "bdp-minimum-scope-position",
        "bdp-scope-epoch",
        "bdp-authorization-view",
      ];
      responses.push({
        ordinal: attempted,
        label,
        method,
        url,
        credential,
        requestBodyBytes: requestBody === undefined ? 0 : Buffer.byteLength(requestBody),
        requestBodySha256: requestBody === undefined ? null : digest(requestBody),
        minimumFieldOccurrences: minimumNames.map(
          (name) => fields.filter((field, i) => i % 2 === 0 && field.toLowerCase() === name).length,
        ),
        status: response.status,
        bodyOctets: response.bytes,
        bodySha256: digest(response.text),
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers.get(name)]),
        ),
      });
      expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
      return response;
    };
    type Response = Awaited<ReturnType<typeof exchange>>;
    const context = (response: Response) => contextNames.map((name) => response.headers.get(name));
    const problem = (response: Response, status: number, code: string) => {
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      const value = record(JSON.parse(response.text));
      expect(validProblem(value), JSON.stringify(validProblem.errors)).toBe(true);
      expect(value).toMatchObject({ status, code });
      return value;
    };
    const receipt = (response: Response, key: string, position: string) => {
      expect(response.status).toBe(200);
      const value = record(JSON.parse(response.text));
      expect(validReceipt(value), JSON.stringify(validReceipt.errors)).toBe(true);
      expect(value).toMatchObject({
        status: "completed",
        idempotencyKey: key,
        requiredPosition: position,
        effectPosition: position,
      });
      expect(context(response)[2]).toBe(position);
      expect([value.scopeEpoch, value.authorizationView]).toStrictEqual(
        context(response).slice(0, 2),
      );
      expect(
        context(response)
          .slice(0, 2)
          .every((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(v)),
      ).toBe(true);
      return value;
    };
    const seed = await exchange(
      "seed",
      "POST",
      `${scope}operations/batch`,
      [],
      "writer",
      seedBody,
      "current-observation-seed",
    );
    const seeded = receipt(seed, "current-observation-seed", "pos-1");
    expect(receiptResults(seeded)).toHaveLength(32);
    const updated = await exchange(
      "issue-page",
      "POST",
      `${scope}operations/update-where`,
      [],
      "writer",
      setBody,
      "current-observation-update",
    );
    const paged = receipt(updated, "current-observation-update", "pos-2");
    const pageUrl = paged.next;
    if (typeof pageUrl !== "string" || typeof paged.id !== "string")
      throw new Error("actual second mutation page required");
    const parsedPage = new URL(pageUrl);
    expect(parsedPage.origin).toBe(new URL(scope).origin);
    expect([parsedPage.search, parsedPage.hash, parsedPage.username, parsedPage.password]).toEqual([
      "",
      "",
      "",
      "",
    ]);
    expect(pageUrl.startsWith(`${paged.id}/pages/`)).toBe(true);
    expect(pageUrl.slice(`${paged.id}/pages/`.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    granted.add(pageUrl);
    const linked = await exchange(
      "link",
      "POST",
      `${scope}operations/batch`,
      [],
      "writer",
      JSON.stringify({
        operations: [
          {
            operation: "createLink",
            id: "links/l",
            type: linkType,
            source: "beads/r00",
            target: "beads/r01",
            properties: { n: 0 },
          },
        ],
      }),
      "current-observation-link",
    );
    receipt(linked, "current-observation-link", "pos-3");
    const expectedContext = context(linked);
    expect(expectedContext.slice(0, 2)).toEqual(context(seed).slice(0, 2));
    const minimum = (position: string, epoch = expectedContext[0]!, view = expectedContext[1]!) => [
      "BDP-Minimum-Scope-Position",
      position,
      "BDP-Scope-Epoch",
      epoch,
      "BDP-Authorization-View",
      view,
    ];
    const validType = ajv.compile({ $ref: `${bundle.$id}#/$defs/typeDescriptor` });
    const validTypes = ajv.compile({ $ref: `${bundle.$id}#/$defs/typesInventory` });
    const validLinks = ajv.compile({ $ref: `${bundle.$id}#/$defs/currentLinkCollection` });
    const validPage = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceiptPage` });
    const pair = async (
      label: string,
      url: string,
      fields: string[],
      status: number,
      code: string,
    ) => {
      const get = await exchange(`${label}-get`, "GET", url, [
        ...fields,
        ...(status === 503 ? ["If-None-Match", "*"] : []),
      ]);
      const head = await exchange(`${label}-head`, "HEAD", url, [
        ...fields,
        ...(status === 503 ? ["If-Match", '"mismatch"', "Accept", "image/png"] : []),
      ]);
      problem(get, status, code);
      expect(head.status).toBe(status);
      expect(head.text).toBe("");
      expect(head.bytes).toBe(0);
      expect(get.bytes).toBeGreaterThan(0);
      expect(get.headers.get("content-length")).toBe(String(get.bytes));
      for (const name of [
        "content-length",
        "content-type",
        "cache-control",
        "retry-after",
        ...contextNames,
      ])
        expect(head.headers.get(name), name).toBe(get.headers.get(name));
      for (const response of [get, head]) {
        expect(context(response)).toEqual(expectedContext);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.has("x-bdp-development-limit")).toBe(false);
        if (status === 503) expect(response.headers.get("retry-after")).toBe("1");
      }
    };
    for (const [label, target] of [
      ["type", `${scope}types/task`],
      ["types", `${scope}types/`],
      ["incident", `${scope}beads/r00?view=links`],
      ["page", pageUrl],
    ] as const) {
      const known = await exchange(`${label}-known`, "GET", target, minimum("pos-3"));
      expect(known.status).toBe(200);
      expect(context(known)).toEqual(expectedContext);
      const value = record(JSON.parse(known.text));
      const validate =
        label === "type"
          ? validType
          : label === "types"
            ? validTypes
            : label === "incident"
              ? validLinks
              : validPage;
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      if (label === "type") expect(value).toMatchObject({ id: beadType, describes: "bead" });
      else if (label === "types") {
        expect(value.items).toEqual([
          { id: linkType, name: "Relation", describes: "link" },
          { id: beadType, name: "Task", describes: "bead" },
        ]);
        expect(value.next).toBeNull();
      } else if (label === "incident") {
        expect(value).toMatchObject({
          items: [
            {
              id: `${scope}links/l`,
              type: linkType,
              source: `${scope}beads/r00`,
              target: `${scope}beads/r01`,
            },
          ],
          next: null,
        });
      } else {
        expect(value.receipt).toBe(paged.id);
        if (!Array.isArray(value.results) || value.results.length === 0)
          throw new Error("nonempty real page required");
        for (const result of value.results)
          expect(record(result)).toMatchObject({
            outcome: "updated",
            resource: { type: beadType, properties: { n: 1 } },
          });
        expect(paged.requiredPosition).toBe("pos-2");
      }
      await pair(`${label}-opaque`, target, minimum("opaque"), 503, "catch-up-timeout");
      await pair(
        `${label}-epoch`,
        target,
        minimum("opaque", "foreign", expectedContext[1]!),
        410,
        "cursor-expired",
      );
      await pair(
        `${label}-view`,
        target,
        minimum("opaque", expectedContext[0]!, "foreign"),
        409,
        "foreign-view",
      );
    }
    await pair("missing-type", `${scope}types/missing`, minimum("opaque"), 503, "catch-up-timeout");
    const missingIncident = await exchange(
      "missing-incident",
      "GET",
      `${scope}beads/missing?view=links`,
      minimum("opaque"),
    );
    const otherPage = await exchange("other-page", "GET", pageUrl, minimum("opaque"), "other");
    for (const response of [missingIncident, otherPage]) {
      problem(response, 404, "resource-not-found");
      expect(context(response)).toEqual(expectedContext);
      expect(response.headers.has("x-bdp-development-limit")).toBe(false);
    }
    const malformed = await exchange("malformed-page", "GET", pageUrl, [
      "BDP-Minimum-Scope-Position",
      "opaque",
    ]);
    problem(malformed, 400, "malformed-request");
    expect(context(malformed)).toEqual([null, null, null]);
    const anonymous = await exchange(
      "anonymous-page",
      "GET",
      pageUrl,
      minimum("opaque"),
      "anonymous",
    );
    problem(anonymous, 401, "unauthenticated");
    expect(context(anonymous)).toEqual([null, null, null]);
    expect(attempted).toBe(37);
    expect(responses).toHaveLength(37);
    expect(
      Object.fromEntries(
        [200, 503, 410, 409, 404, 400, 401].map((status) => [
          status,
          responses.filter((r) => r.status === status).length,
        ]),
      ),
    ).toEqual({ 200: 7, 503: 10, 410: 8, 409: 8, 404: 2, 400: 1, 401: 1 });
    expect(
      Object.fromEntries(
        ["POST", "GET", "HEAD"].map((method) => [
          method,
          responses.filter((r) => r.method === method).length,
        ]),
      ),
    ).toEqual({ POST: 3, GET: 21, HEAD: 13 });
    controller.signal.throwIfAborted();
  } catch (error) {
    fail(error, phase);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    const cleanupReason = new Error("installed current observation cleanup deadline");
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    // Await both operation settlement and transport close; one deadline also covers child close.
    const transportDrain = Promise.all(
      [...active].map(
        (request) =>
          new Promise<void>((resolve) => {
            request.once("close", resolve);
            request.destroy();
          }),
      ),
    );
    const cleaning = (async () => {
      for (const result of await Promise.allSettled([...pending]))
        if (result.status === "rejected") fail(result.reason, "transport-drain");
      await transportDrain;
      if (child) {
        await child.close();
        await childDrain;
      }
    })();
    // Retain late failures after the race without letting a late close mark ownership clean.
    void cleaning.catch((error) => fail(error, "late-cleanup"));
    try {
      await Promise.race([
        cleaning,
        new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => {
            cleanupExceeded = true;
            child?.child.kill("SIGKILL");
            reject(cleanupReason);
          }, 10000);
        }),
      ]);
      if (
        child &&
        !cleanupExceeded &&
        child.child.exitCode === 0 &&
        child.child.signalCode === null &&
        childLifetime.close?.code === 0 &&
        childLifetime.close.signal === null
      )
        closed = true;
      else if (launchAttempted)
        fail(new Error("installed current observation clean close unproved"), "unclean-close");
    } catch (error) {
      fail(error, "cleanup");
    } finally {
      clearTimeout(cleanupTimer);
    }
    if (deadlineExceeded) fail(deadlineReason, "deadline");
    const stopped =
      !launchAttempted ||
      (child !== undefined && (child.child.exitCode !== null || child.child.signalCode !== null));
    if (!stopped)
      fail(new Error("installed current observation child stop unknown"), "unknown-stop");
    try {
      if (directory && (!launchAttempted || (closed && failures.length === 0)))
        rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      fail(error, "directory-cleanup");
    }
    const directoryAbsent = directory === undefined || !existsSync(directory);
    if (!directoryAbsent)
      fail(new Error("installed current observation directory preserved"), "directory-retained");
    try {
      console.log(
        JSON.stringify({
          observation: "private-installed-current-observation-minimum",
          outcome: failures.length ? "failed" : "passed",
          declaredSourceCommit: sourceCommit,
          workspaceDirty,
          entry: resolvedEntry,
          entrySha256,
          binding: binding ?? null,
          artifactBytes:
            localArtifacts.descriptors.reduce((n, d) => n + Buffer.byteLength(d.utf8), 0) +
            localArtifacts.schemas.reduce((n, s) => n + Buffer.byteLength(s.utf8), 0),
          elapsedMs: performance.now() - started,
          attempted,
          exchanges: responses.length,
          completedResponses: responses,
          deadlineExceeded,
          cleanupExceeded,
          launchAttempted,
          startupCompleted: child !== undefined,
          closed,
          childClose: childLifetime.close ?? null,
          childPid: child?.child.pid ?? null,
          childExitCode: child?.child.exitCode ?? null,
          childSignalCode: child?.child.signalCode ?? null,
          directory: directory ?? null,
          directoryAbsent,
          activeRequests: active.size,
          pendingOperations: pending.size,
          failureCount: failures.length,
          failureCategories: categories,
          claimEligible: false,
          retention:
            "safe response metadata/fingerprints; bodies asserted in memory; no credentials logged",
          startupLimitation:
            "pre-ready or unclean ownership preserves directory for supervisor evidence",
        }),
      );
    } catch (error) {
      fail(error, "report");
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed current observation and cleanup failed");
}, 60000);
