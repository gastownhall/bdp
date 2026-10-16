/** Private installed receipt absence observations; no profile qualification. */
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
  throw new Error("installed receipt entry override requires declared source commit");
const resolvedEntry = realpathSync(entry);
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const entrySha256 = digest(readFileSync(resolvedEntry));
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const sourceCommit =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(
  readFileSync(path.join(root, "specs/profiles/core/bdp-v0.schema.json"), "utf8"),
);
ajv.addSchema(bundle);
const validReceipt = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceipt` });
const validPage = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceiptPage` });
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
];

it("observes genuine installed receipt root and page absence context at current heads", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed receipt context deadline");
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
  let attempted = 0;
  const responses: {
    method: HttpMethod;
    url: string;
    accept: string;
    status: number;
    bodyOctets: number | undefined;
    wireSha256: string | null;
    bodySha256: string;
    headers: Record<string, string | null>;
  }[] = [];
  const writer = randomBytes(32).toString("base64url");
  const other = randomBytes(32).toString("base64url");
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
  const advanceBody = JSON.stringify({ id: "beads/later", type: beadType, properties: { n: 0 } });
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-receipt-missing-context-installed-"));
    controller.signal.throwIfAborted();
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
    expect(child.ready.claimEligible).toBe(false);
    expect(child.ready.history).toBe(false);
    expect(binding.operationTargets.batch).toBe(`${scope}operations/batch`);
    const address = new URL(child.ready.listenUrl as string);
    // Only operation routes are known before a real receipt issues its exact page.
    const routes: { method: HttpMethod; url: string }[] = [
      { method: "POST", url: `${scope}operations/batch` },
      { method: "POST", url: `${scope}operations/update-where` },
      { method: "POST", url: `${scope}operations/create-bead` },
    ];
    const executor = () =>
      createRawHttpExchangeExecutor(
        { transport: "plain", host: address.hostname, port: Number(address.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 32768,
          maximumHeaderBytes: 65536,
          exactMode: {
            scope,
            profile: "transactional",
            routes,
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: "writer",
            credentialHandles: [
              { id: "writer", headerNames: ["authorization"] },
              { id: "other", headerNames: ["authorization"] },
              { id: "anonymous", headerNames: [] },
            ],
            resolveCredentials: ({ credentialRef }) =>
              credentialRef === "anonymous"
                ? {}
                : {
                    authorization: `Bearer ${credentialRef === "other" ? other : writer}`,
                  },
          },
        },
      );
    const exchange = async (
      url: string,
      method: HttpMethod,
      accept: string,
      requestBody?: string,
      credential: "writer" | "other" | "anonymous" = "writer",
      key?: string,
    ) => {
      controller.signal.throwIfAborted();
      expect(++attempted, "installed receipt dispatch bound").toBeLessThanOrEqual(14);
      const response = await executor()({
        method,
        url,
        signal: controller.signal,
        credentialRef: credential,
        raw: {
          headerLines: [
            { name: "accept", value: accept },
            ...(requestBody === undefined
              ? []
              : [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: key ?? "receipt-context-seed" },
                ]),
          ],
          ...(requestBody === undefined ? {} : { bodyBytes: Buffer.from(requestBody) }),
        },
      });
      // Persist only bounded safe response fields/fingerprints, never credential headers.
      responses.push({
        method,
        url,
        accept,
        status: response.status,
        bodyOctets: response.bodyOctets,
        wireSha256: response.wireResponseBytes ? digest(response.wireResponseBytes) : null,
        bodySha256: digest(response.bodyText),
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers[name] ?? null]),
        ),
      });
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.url).toBe(url);
      expect(response.exactRequest?.source).toBe("raw-http1-serializer");
      expect(response.exactRequest?.bodyPresent).toBe(requestBody !== undefined);
      expect(response.exactRequest?.bodyOctets).toBe(
        requestBody === undefined ? 0 : Buffer.byteLength(requestBody),
      );
      expect(response.exactRequest?.bodyDigest).toBe(
        requestBody === undefined ? undefined : digest(requestBody),
      );
      const headers = response.exactRequest?.headerLines ?? [];
      expect(headers.find((header) => header.name.toLowerCase() === "host")?.value).toBe(
        "reference.invalid",
      );
      expect(headers.find((header) => header.name.toLowerCase() === "accept")?.value).toBe(accept);
      if (requestBody !== undefined) {
        expect(
          headers.find((header) => header.name.toLowerCase() === "idempotency-key")?.value,
        ).toBe(key ?? "receipt-context-seed");
        expect(headers.find((header) => header.name.toLowerCase() === "content-type")?.value).toBe(
          "application/json",
        );
      }
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(Number.isSafeInteger(response.bodyOctets)).toBe(true);
      expect(response.bodyOctets).toBeGreaterThanOrEqual(0);
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      return response;
    };
    expect([seedBody, setBody, advanceBody].map((body) => Buffer.byteLength(body))).toStrictEqual([
      3728, 179, 92,
    ]);
    const receiptAt = (
      response: Awaited<ReturnType<typeof exchange>>,
      key: string,
      position: string,
    ) => {
      expect(response.status).toBe(200);
      const value = JSON.parse(response.bodyText);
      expect(validReceipt(value), JSON.stringify(validReceipt.errors)).toBe(true);
      expect(value).toMatchObject({
        status: "completed",
        idempotencyKey: key,
        requiredPosition: position,
        effectPosition: position,
      });
      expect(response.headers["bdp-scope-position"]).toBe(position);
      return value;
    };
    const seed = await exchange(
      `${scope}operations/batch`,
      "POST",
      "application/json",
      seedBody,
      "writer",
      "receipt-context-seed",
    );
    const seedReceipt = receiptAt(seed, "receipt-context-seed", "pos-1");
    expect(seedReceipt.results).toHaveLength(32);
    expect(seedReceipt.next).toBeNull();
    const update = await exchange(
      `${scope}operations/update-where`,
      "POST",
      "application/json",
      setBody,
      "writer",
      "receipt-context-paged",
    );
    const receipt = receiptAt(update, "receipt-context-paged", "pos-2");
    expect(receipt.results).toHaveLength(32);
    const receiptRoot = receipt.id,
      pageUrl = receipt.next;
    // Validate the actually issued root and page before adding exact wire grants.
    if (typeof receiptRoot !== "string" || typeof pageUrl !== "string")
      throw new Error("issued root/page required");
    const rootUrl = new URL(receiptRoot),
      issuedPage = new URL(pageUrl);
    for (const [value, url] of [
      [receiptRoot, rootUrl],
      [pageUrl, issuedPage],
    ] as const) {
      expect(Buffer.byteLength(value)).toBeLessThanOrEqual(8192);
      expect(url.href).toBe(value);
      expect(url.origin).toBe(new URL(scope).origin);
      expect([url.search, url.hash, url.username, url.password]).toStrictEqual(["", "", "", ""]);
    }
    const rootSuffix = receiptRoot.slice(`${scope}receipts/`.length);
    expect(receiptRoot.startsWith(`${scope}receipts/`)).toBe(true);
    expect(rootSuffix).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pageUrl.startsWith(`${receiptRoot}/pages/`)).toBe(true);
    expect(pageUrl.slice(`${receiptRoot}/pages/`.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    const unknownRoot = `${receiptRoot.slice(0, receiptRoot.lastIndexOf("/") + 1)}unknown`;
    expect(unknownRoot).not.toBe(receiptRoot);
    for (const url of [receiptRoot, pageUrl, unknownRoot])
      for (const method of ["GET", "HEAD"] as const) routes.push({ method, url });
    const tail = await exchange(pageUrl, "GET", "application/json");
    expect(tail.status).toBe(200);
    const tailPage = JSON.parse(tail.bodyText);
    expect(validPage(tailPage), JSON.stringify(validPage.errors)).toBe(true);
    expect(tailPage.receipt).toBe(receiptRoot);
    expect(tailPage.next).toBeNull();
    expect(tailPage.results).toHaveLength(1);
    const firstContext = contextNames.map((name) => update.headers[name]);
    expect(firstContext[0]).toBeTruthy();
    expect(firstContext[1]).toBeTruthy();
    expect(firstContext[2]).toBe("pos-2");
    expect(firstContext.slice(0, 2)).toStrictEqual(
      contextNames.slice(0, 2).map((name) => seed.headers[name]),
    );
    expect(contextNames.map((name) => tail.headers[name])).toStrictEqual(firstContext);
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
      status: 404,
    };
    const missing = async (
      url: string,
      method: "GET" | "HEAD",
      credential: "writer" | "other",
      expected: (string | undefined)[],
      label: string,
      getLength?: string,
    ) => {
      const response = await exchange(url, method, "application/json", undefined, credential);
      expect(response.status, label).toBe(404);
      expect(response.headers["content-type"]).toBe("application/problem+json");
      expect(response.headers["cache-control"]).toBe("private, no-store");
      for (const name of [
        "etag",
        "last-modified",
        "retry-after",
        "www-authenticate",
        "x-bdp-development-limit",
      ])
        expect(response.headers[name]).toBeUndefined();
      if (method === "GET") {
        const value = JSON.parse(response.bodyText);
        expect(validProblem(value), JSON.stringify(validProblem.errors)).toBe(true);
        expect(value).toStrictEqual(problem);
        expect(Number(response.headers["content-length"])).toBe(response.bodyOctets);
      } else {
        expect(response.bodyText).toBe("");
        expect(response.bodyOctets).toBe(0);
        expect(response.headers["content-length"]).toBe(getLength);
      }
      expect(
        contextNames.map((name) => response.headers[name]),
        label,
      ).toStrictEqual(expected);
      return response.headers["content-length"];
    };
    for (const [url, credential, label] of [
      [unknownRoot, "writer", "unknown-root"],
      [receiptRoot, "other", "foreign-root"],
      [pageUrl, "other", "foreign-page"],
    ] as const) {
      const length = await missing(
        url,
        "GET",
        credential,
        firstContext,
        `${label} GET at first head`,
      );
      await missing(url, "HEAD", credential, firstContext, `${label} HEAD at first head`, length);
    }
    const advanced = await exchange(
      `${scope}operations/create-bead`,
      "POST",
      "application/json",
      advanceBody,
      "writer",
      "receipt-context-advance",
    );
    receiptAt(advanced, "receipt-context-advance", "pos-3");
    const laterContext = contextNames.map((name) => advanced.headers[name]);
    expect(laterContext).toStrictEqual([firstContext[0], firstContext[1], "pos-3"]);
    await missing(receiptRoot, "GET", "other", laterContext, "foreign-root GET at later head");
    await missing(pageUrl, "GET", "other", laterContext, "foreign-page GET at later head");
    for (const [url, method] of [
      [receiptRoot, "GET"],
      [pageUrl, "HEAD"],
    ] as const) {
      const response = await exchange(url, method, "application/json", undefined, "anonymous");
      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toBe(
        'Bearer realm="bdp-transaction-development"',
      );
      for (const name of contextNames) expect(response.headers[name]).toBeUndefined();
      if (method === "GET") {
        const value = JSON.parse(response.bodyText);
        expect(validProblem(value), JSON.stringify(validProblem.errors)).toBe(true);
        expect(value).toMatchObject({ code: "unauthenticated", status: 401 });
      } else {
        expect(response.bodyText).toBe("");
        expect(response.bodyOctets).toBe(0);
      }
    }
    expect(attempted).toBe(14);
    expect(responses).toHaveLength(14);
    expect(responses.map(({ method, url }) => ({ method, url }))).toStrictEqual([
      { method: "POST", url: `${scope}operations/batch` },
      { method: "POST", url: `${scope}operations/update-where` },
      { method: "GET", url: pageUrl },
      ...[unknownRoot, receiptRoot, pageUrl].flatMap((url) =>
        ["GET", "HEAD"].map((method) => ({ method, url })),
      ),
      { method: "POST", url: `${scope}operations/create-bead` },
      { method: "GET", url: receiptRoot },
      { method: "GET", url: pageUrl },
      { method: "GET", url: receiptRoot },
      { method: "HEAD", url: pageUrl },
    ]);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    try {
      if (child) {
        await child.close();
        closed = true;
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      if (directory) rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    clearTimeout(deadline);
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    console.log(
      JSON.stringify({
        observation: "private-installed-receipt-missing-context",
        outcome: failures.length === 0 ? "passed" : "failed",
        // Caller label verified by external supervisor/package provenance, not child attestation.
        declaredSourceCommit: sourceCommit,
        workspaceDirty,
        entry: resolvedEntry,
        entrySha256,
        binding: binding ?? null,
        artifactBytes:
          artifacts.descriptors.reduce((n, d) => n + Buffer.byteLength(d.utf8), 0) +
          artifacts.schemas.reduce((n, s) => n + Buffer.byteLength(s.utf8), 0),
        deadlineExceeded,
        attempted,
        exchanges: responses.length,
        completedResponses: responses,
        closed,
        startupCompleted: child !== undefined,
        childPid: child?.child.pid ?? null,
        childExitCode: child?.child.exitCode ?? null,
        childSignalCode: child?.child.signalCode ?? null,
        directory: directory ?? null,
        directoryAbsent: directory === undefined || !existsSync(directory),
        failureCount: failures.length,
        claimEligible: false,
        retention: "response fingerprints and selected headers; full body assertions ran in memory",
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed receipt observation and cleanup failed");
}, 60000);
