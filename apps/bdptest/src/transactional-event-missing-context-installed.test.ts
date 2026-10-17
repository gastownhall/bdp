/** Private installed Event absence observations; no profile qualification. */
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
  throw new Error("installed Event entry override requires declared source commit");
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
const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
ajv.addSchema(bundle);
const validReceipt = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceipt` });
const validPage = ajv.compile({ $ref: `${bundle.$id}#/$defs/eventPage` });
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
];

it("observes genuine installed missing Event context across Bead and Link JSON and SSE GET and HEAD", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed Event context deadline");
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
  const operator = randomBytes(32).toString("base64url");
  const body = JSON.stringify({
    operations: [
      {
        operation: "createBead",
        id: "beads/known",
        type: beadType,
        properties: { title: "event-context" },
      },
    ],
  });
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-event-missing-context-installed-"));
    controller.signal.throwIfAborted();
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
    const address = new URL(child.ready.listenUrl as string);
    const routes = [
      { method: "POST", url: `${scope}operations/batch` },
      { method: "GET", url: `${scope}events/` },
      ...["beads", "links"].flatMap((collection) =>
        ["GET", "HEAD"].map((method) => ({
          method,
          url: `${scope}${collection}/missing?view=events`,
        })),
      ),
    ] as { method: HttpMethod; url: string }[];
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 32768,
        exactMode: {
          scope,
          profile: "transactional",
          routes,
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "operator",
          credentialHandles: [
            { id: "operator", headerNames: ["authorization"] },
            { id: "anonymous", headerNames: [] },
          ],
          resolveCredentials: ({ credentialRef }) =>
            credentialRef === "anonymous"
              ? {}
              : {
                  authorization: `Bearer ${operator}`,
                },
        },
      },
    );
    const exchange = async (
      url: string,
      method: HttpMethod,
      accept: string,
      requestBody?: string,
      anonymous = false,
    ) => {
      controller.signal.throwIfAborted();
      expect(++attempted, "installed Event dispatch bound").toBeLessThanOrEqual(11);
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: anonymous ? "anonymous" : "operator",
        raw: {
          headerLines: [
            { name: "accept", value: accept },
            ...(requestBody === undefined
              ? []
              : [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: "missing-event-context-seed" },
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
        ).toBe("missing-event-context-seed");
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
    expect(Buffer.byteLength(body)).toBe(152);
    const seed = await exchange(`${scope}operations/batch`, "POST", "application/json", body);
    expect(seed.status).toBe(200);
    const receipt = JSON.parse(seed.bodyText);
    expect(validReceipt(receipt), JSON.stringify(validReceipt.errors)).toBe(true);
    expect(receipt).toMatchObject({
      status: "completed",
      idempotencyKey: "missing-event-context-seed",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
    });
    const known = await exchange(`${scope}events/`, "GET", "application/json");
    expect(known.status).toBe(200);
    const page = JSON.parse(known.bodyText);
    expect(validPage(page), JSON.stringify(validPage.errors)).toBe(true);
    expect(page.source).toBe(`${scope}events/`);
    expect(page.next).toBe(null);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({ type: "created", subject: `${scope}beads/known` });
    const expected = contextNames.map((name) => known.headers[name]);
    expect(expected[0]).toBeTruthy();
    expect(expected[1]).toBeTruthy();
    expect(expected[2]).toBe("pos-1");
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
      status: 404,
    };
    for (const [kind, collection] of [
      ["Bead", "beads"],
      ["Link", "links"],
    ] as const) {
      for (const [media, accept] of [
        ["JSON", "application/json"],
        ["SSE", "text/event-stream"],
      ] as const) {
        let getLength: string | undefined;
        for (const method of ["GET", "HEAD"] as const) {
          const response = await exchange(
            `${scope}${collection}/missing?view=events`,
            method,
            accept,
          );
          const label = `missing-event-context:${kind}:${media}:${method}`;
          expect(response.status, label).toBe(404);
          expect(response.headers["content-type"]).toBe("application/problem+json");
          expect(response.headers["cache-control"]).toBe("private, no-store");
          for (const name of ["retry-after", "www-authenticate", "x-bdp-development-limit"])
            expect(response.headers[name]).toBeUndefined();
          if (method === "GET") {
            const actual = JSON.parse(response.bodyText);
            expect(validProblem(actual), JSON.stringify(validProblem.errors)).toBe(true);
            expect(actual).toStrictEqual(problem);
            getLength = response.headers["content-length"];
            expect(Number(getLength)).toBe(response.bodyOctets);
          } else {
            expect(response.bodyText).toBe("");
            expect(response.bodyOctets).toBe(0);
            expect(response.headers["content-length"]).toBe(getLength);
          }
          expect(
            contextNames.map((name) => response.headers[name]),
            label,
          ).toStrictEqual(expected);
        }
      }
    }
    const anonymous = await exchange(
      `${scope}beads/missing?view=events`,
      "GET",
      "text/event-stream",
      undefined,
      true,
    );
    expect(anonymous.status).toBe(401);
    const unauthenticated = JSON.parse(anonymous.bodyText);
    expect(validProblem(unauthenticated), JSON.stringify(validProblem.errors)).toBe(true);
    expect(unauthenticated).toMatchObject({ code: "unauthenticated", status: 401 });
    expect(anonymous.headers["www-authenticate"]).toBe(
      'Bearer realm="bdp-transaction-development"',
    );
    for (const name of contextNames) expect(anonymous.headers[name]).toBeUndefined();
    expect(attempted).toBe(11);
    expect(responses).toHaveLength(11);
    expect(responses.map(({ method, url, accept }) => ({ method, url, accept }))).toStrictEqual([
      { method: "POST", url: `${scope}operations/batch`, accept: "application/json" },
      { method: "GET", url: `${scope}events/`, accept: "application/json" },
      ...["beads", "links"].flatMap((collection) =>
        ["application/json", "text/event-stream"].flatMap((accept) =>
          ["GET", "HEAD"].map((method) => ({
            method,
            url: `${scope}${collection}/missing?view=events`,
            accept,
          })),
        ),
      ),
      { method: "GET", url: `${scope}beads/missing?view=events`, accept: "text/event-stream" },
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
        observation: "private-installed-event-missing-context",
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
    throw new AggregateError(failures, "installed Event observation and cleanup failed");
}, 60000);

it("observes installed initial finite Scope Event opaque minimum timeout", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed finite Event minimum deadline");
  const expiresAt = Date.now() + 45000;
  let deadlineExceeded = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  const failures: unknown[] = [];
  let directory: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let launchStarted = false,
    closeAttempted = false,
    closed = false,
    attempted = 0;
  const responses: {
    method: HttpMethod;
    status: number;
    bodyOctets: number | undefined;
    bodySha256: string;
    wireSha256: string | null;
    headers: Record<string, string | null>;
  }[] = [];
  const operator = randomBytes(32).toString("base64url");
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-event-minimum-installed-"));
    controller.signal.throwIfAborted();
    launchStarted = true;
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
    const address = new URL(child.ready.listenUrl as string);
    const url = `${scope}events/`;
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 32768,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [
            { method: "GET", url },
            { method: "HEAD", url },
          ],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "operator",
          credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${operator}` }),
        },
      },
    );
    const exchange = async (method: HttpMethod, minimum: Record<string, string> = {}) => {
      controller.signal.throwIfAborted();
      expect(++attempted, "installed finite Event dispatch bound").toBeLessThanOrEqual(3);
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: "operator",
        raw: {
          headerLines: [
            { name: "accept", value: "application/json" },
            ...Object.entries(minimum).map(([name, value]) => ({ name, value })),
          ],
        },
      });
      responses.push({
        method,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: digest(response.bodyText),
        wireSha256: response.wireResponseBytes ? digest(response.wireResponseBytes) : null,
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers[name] ?? null]),
        ),
      });
      expect(response.url).toBe(url);
      expect(response.exactRequest?.source).toBe("raw-http1-serializer");
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.exactRequest?.bodyPresent).toBe(false);
      expect(response.exactRequest?.bodyOctets).toBe(0);
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      for (const [name, value] of Object.entries(minimum))
        expect(
          response.exactRequest?.headerLines.find((field) => field.name.toLowerCase() === name)
            ?.value,
        ).toBe(value);
      return response;
    };
    const setup = await exchange("GET");
    expect(setup.status).toBe(200);
    const page: unknown = JSON.parse(setup.bodyText);
    expect(validPage(page), JSON.stringify(validPage.errors)).toBe(true);
    expect(page).toEqual({ source: url, events: [], next: null });
    const context = Object.fromEntries(
      contextNames.map((name) => {
        const value = setup.headers[name];
        if (!value) throw new Error(`missing ${name}`);
        return [name, value];
      }),
    );
    const minimum = {
      "bdp-scope-epoch": context["bdp-scope-epoch"]!,
      "bdp-authorization-view": context["bdp-authorization-view"]!,
      "bdp-minimum-scope-position": "opaque",
    };
    let getBytes = 0;
    let getMedia: string | undefined;
    for (const method of ["GET", "HEAD"] as const) {
      const response = await exchange(method, minimum);
      expect(response.status).toBe(503);
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["last-modified"]).toBeUndefined();
      for (const name of contextNames) expect(response.headers[name], name).toBe(context[name]);
      if (method === "GET") {
        const problem: unknown = JSON.parse(response.bodyText);
        expect(validProblem(problem), JSON.stringify(validProblem.errors)).toBe(true);
        // Exact reference Problem shape, not a ban on protocol extension members.
        expect(problem).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/unavailable",
          status: 503,
          code: "catch-up-timeout",
          retry: "after-delay",
        });
        getBytes = Buffer.byteLength(response.bodyText);
        expect(getBytes).toBeGreaterThan(0);
        expect(response.bodyOctets).toBe(getBytes);
        getMedia = response.headers["content-type"];
        expect(getMedia?.split(";", 1)[0]).toBe("application/problem+json");
      } else {
        expect(response.bodyOctets).toBe(0);
        expect(response.bodyText).toBe("");
        // Reference HEAD metadata describes GET bytes, not transmitted HEAD bytes.
        expect(response.headers["content-length"]).toBe(String(getBytes));
        expect(response.headers["content-type"]).toBe(getMedia);
      }
    }
    expect(attempted).toBe(3);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (child) {
        closeAttempted = true;
        const closing = child.close();
        // Observe late rejection even if the shared remaining deadline wins.
        void closing.catch(() => {});
        await Promise.race([
          closing,
          new Promise<never>((_, reject) => {
            cleanupTimer = setTimeout(
              () => {
                deadlineExceeded = true;
                reject(deadlineReason);
              },
              Math.max(0, expiresAt - Date.now()),
            );
          }),
        ]);
        if (Date.now() >= expiresAt) deadlineExceeded = true;
        if (deadlineExceeded || child.child.exitCode !== 0 || child.child.signalCode !== null) {
          failures.push(new Error("installed finite Event child close was not clean and timely"));
        } else {
          closed = true;
          if (directory) rmSync(directory, { recursive: true, force: true });
        }
      }
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(cleanupTimer);
      clearTimeout(deadline);
    }
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    if (launchStarted && !closed && failures.length === 0)
      failures.push(new Error("installed finite Event child ownership unverified"));
    console.log(
      JSON.stringify({
        observation: "private-installed-finite-event-minimum",
        outcome: failures.length === 0 ? "passed" : "failed",
        declaredSourceCommit: sourceCommit,
        workspaceDirty,
        entry: resolvedEntry,
        entrySha256,
        binding: binding ?? null,
        deadlineExceeded,
        attempted,
        exchanges: responses.length,
        completedResponses: responses,
        closeAttempted,
        closed,
        launchStarted,
        startupCompleted: child !== undefined,
        childPid: child?.child.pid ?? null,
        childExitCode: child?.child.exitCode ?? null,
        childSignalCode: child?.child.signalCode ?? null,
        ownership: !launchStarted ? "not-started" : closed ? "closed" : "unverified",
        directory: directory ?? null,
        directoryAbsent: directory === undefined || !existsSync(directory),
        failureCount: failures.length,
        claimEligible: false,
        retention: "response fingerprints and selected headers; no conformance credit",
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed finite Event minimum and cleanup failed");
}, 60000);

it("observes installed initial finite Bead Event opaque minimum timeout", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed finite Event minimum deadline");
  const expiresAt = Date.now() + 45000;
  let deadlineExceeded = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  const failures: unknown[] = [];
  let directory: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let launchStarted = false,
    closeAttempted = false,
    closed = false,
    attempted = 0;
  const responses: {
    method: HttpMethod;
    url: string;
    status: number;
    bodyOctets: number | undefined;
    bodySha256: string;
    wireSha256: string | null;
    headers: Record<string, string | null>;
  }[] = [];
  const operator = randomBytes(32).toString("base64url");
  const seedBody = JSON.stringify({
    operations: [
      {
        operation: "createBead",
        id: "beads/known",
        type: beadType,
        properties: { title: "bead-event-minimum" },
      },
    ],
  });
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-bead-event-minimum-installed-"));
    controller.signal.throwIfAborted();
    launchStarted = true;
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
    const address = new URL(child.ready.listenUrl as string);
    const url = `${scope}beads/known?view=events`;
    const batchUrl = `${scope}operations/batch`;
    expect(binding.operationTargets.batch).toBe(batchUrl);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 32768,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [
            { method: "POST", url: batchUrl },
            { method: "GET", url },
            { method: "HEAD", url },
          ],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "operator",
          credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${operator}` }),
        },
      },
    );
    const exchange = async (
      method: HttpMethod,
      minimum: Record<string, string> = {},
      requestBody?: string,
    ) => {
      controller.signal.throwIfAborted();
      expect(++attempted, "installed Bead Event dispatch bound").toBeLessThanOrEqual(4);
      const requestUrl = requestBody === undefined ? url : batchUrl;
      const response = await execute({
        method,
        url: requestUrl,
        signal: controller.signal,
        credentialRef: "operator",
        raw: {
          headerLines: [
            { name: "accept", value: "application/json" },
            ...Object.entries(minimum).map(([name, value]) => ({ name, value })),
            ...(requestBody === undefined
              ? []
              : [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: "bead-event-minimum-seed" },
                ]),
          ],
          ...(requestBody === undefined ? {} : { bodyBytes: Buffer.from(requestBody) }),
        },
      });
      responses.push({
        method,
        url: requestUrl,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: digest(response.bodyText),
        wireSha256: response.wireResponseBytes ? digest(response.wireResponseBytes) : null,
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers[name] ?? null]),
        ),
      });
      expect(response.url).toBe(requestUrl);
      expect(response.exactRequest?.source).toBe("raw-http1-serializer");
      expect(response.exactRequest?.writeState).toBe("complete");
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
      expect(headers.find((header) => header.name.toLowerCase() === "accept")?.value).toBe(
        "application/json",
      );
      if (requestBody !== undefined) {
        expect(
          headers.find((header) => header.name.toLowerCase() === "idempotency-key")?.value,
        ).toBe("bead-event-minimum-seed");
        expect(headers.find((header) => header.name.toLowerCase() === "content-type")?.value).toBe(
          "application/json",
        );
      }
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      for (const [name, value] of Object.entries(minimum))
        expect(
          response.exactRequest?.headerLines.find((field) => field.name.toLowerCase() === name)
            ?.value,
        ).toBe(value);
      return response;
    };
    const seed = await exchange("POST", {}, seedBody);
    expect(seed.status).toBe(200);
    const receipt: unknown = JSON.parse(seed.bodyText);
    expect(validReceipt(receipt), JSON.stringify(validReceipt.errors)).toBe(true);
    expect(receipt).toMatchObject({
      status: "completed",
      idempotencyKey: "bead-event-minimum-seed",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
    });
    const setup = await exchange("GET");
    expect(setup.status).toBe(200);
    const page: unknown = JSON.parse(setup.bodyText);
    expect(validPage(page), JSON.stringify(validPage.errors)).toBe(true);
    expect(page).toMatchObject({
      source: url,
      events: [{ type: "created", subject: `${scope}beads/known` }],
      next: null,
    });
    const context = Object.fromEntries(
      contextNames.map((name) => {
        const value = setup.headers[name];
        if (!value) throw new Error(`missing ${name}`);
        return [name, value];
      }),
    );
    expect(context["bdp-scope-position"]).toBe("pos-1");
    const minimum = {
      "bdp-scope-epoch": context["bdp-scope-epoch"]!,
      "bdp-authorization-view": context["bdp-authorization-view"]!,
      "bdp-minimum-scope-position": "opaque",
    };
    let getBytes = 0;
    let getMedia: string | undefined;
    for (const method of ["GET", "HEAD"] as const) {
      const response = await exchange(method, minimum);
      expect(response.status).toBe(503);
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["last-modified"]).toBeUndefined();
      for (const name of contextNames) expect(response.headers[name], name).toBe(context[name]);
      if (method === "GET") {
        const problem: unknown = JSON.parse(response.bodyText);
        expect(validProblem(problem), JSON.stringify(validProblem.errors)).toBe(true);
        // Exact reference Problem shape, not a ban on protocol extension members.
        expect(problem).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/unavailable",
          status: 503,
          code: "catch-up-timeout",
          retry: "after-delay",
        });
        getBytes = Buffer.byteLength(response.bodyText);
        expect(getBytes).toBeGreaterThan(0);
        expect(response.bodyOctets).toBe(getBytes);
        getMedia = response.headers["content-type"];
        expect(getMedia?.split(";", 1)[0]).toBe("application/problem+json");
      } else {
        expect(response.bodyOctets).toBe(0);
        expect(response.bodyText).toBe("");
        // Reference HEAD metadata describes GET bytes, not transmitted HEAD bytes.
        expect(response.headers["content-length"]).toBe(String(getBytes));
        expect(response.headers["content-type"]).toBe(getMedia);
      }
    }
    expect(attempted).toBe(4);
    expect(responses.map(({ method, url, status }) => ({ method, url, status }))).toEqual([
      { method: "POST", url: batchUrl, status: 200 },
      { method: "GET", url, status: 200 },
      { method: "GET", url, status: 503 },
      { method: "HEAD", url, status: 503 },
    ]);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (child) {
        closeAttempted = true;
        const closing = child.close();
        // Observe late rejection even if the shared remaining deadline wins.
        void closing.catch(() => {});
        await Promise.race([
          closing,
          new Promise<never>((_, reject) => {
            cleanupTimer = setTimeout(
              () => {
                deadlineExceeded = true;
                reject(deadlineReason);
              },
              Math.max(0, expiresAt - Date.now()),
            );
          }),
        ]);
        if (Date.now() >= expiresAt) deadlineExceeded = true;
        if (deadlineExceeded || child.child.exitCode !== 0 || child.child.signalCode !== null) {
          failures.push(new Error("installed finite Event child close was not clean and timely"));
        } else {
          closed = true;
          if (directory) rmSync(directory, { recursive: true, force: true });
        }
      }
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(cleanupTimer);
      clearTimeout(deadline);
    }
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    if (launchStarted && !closed && failures.length === 0)
      failures.push(new Error("installed finite Event child ownership unverified"));
    console.log(
      JSON.stringify({
        observation: "private-installed-bead-event-minimum",
        outcome: failures.length === 0 ? "passed" : "failed",
        declaredSourceCommit: sourceCommit,
        workspaceDirty,
        entry: resolvedEntry,
        entrySha256,
        binding: binding ?? null,
        deadlineExceeded,
        attempted,
        exchanges: responses.length,
        completedResponses: responses,
        closeAttempted,
        closed,
        launchStarted,
        startupCompleted: child !== undefined,
        childPid: child?.child.pid ?? null,
        childExitCode: child?.child.exitCode ?? null,
        childSignalCode: child?.child.signalCode ?? null,
        ownership: !launchStarted ? "not-started" : closed ? "closed" : "unverified",
        directory: directory ?? null,
        directoryAbsent: directory === undefined || !existsSync(directory),
        failureCount: failures.length,
        claimEligible: false,
        retention: "response fingerprints and selected headers; no conformance credit",
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed finite Event minimum and cleanup failed");
}, 60000);

it("observes installed initial finite Link Event opaque minimum timeout", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed finite Event minimum deadline");
  const expiresAt = Date.now() + 45000;
  let deadlineExceeded = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  const failures: unknown[] = [];
  let directory: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let launchStarted = false,
    closeAttempted = false,
    closed = false,
    attempted = 0;
  const responses: {
    method: HttpMethod;
    url: string;
    status: number;
    bodyOctets: number | undefined;
    bodySha256: string;
    wireSha256: string | null;
    headers: Record<string, string | null>;
  }[] = [];
  const operator = randomBytes(32).toString("base64url");
  const linkType = `${scope}types/link`;
  const linkArtifacts = {
    descriptors: [
      ...artifacts.descriptors,
      {
        retrievalUri: linkType,
        utf8: JSON.stringify({
          id: linkType,
          name: "Link",
          describes: "link",
          conformsTo: [],
          source: { conformsTo: [], external: "opaque" },
          target: { conformsTo: [], external: "opaque" },
          propertiesSchema: schemaUri,
        }),
      },
    ],
    schemas: artifacts.schemas,
  };
  const seedBody = JSON.stringify({
    operations: [
      {
        operation: "createBead",
        id: "beads/known",
        type: beadType,
        properties: { title: "link-event-minimum" },
      },
      {
        operation: "createBead",
        id: "beads/other",
        type: beadType,
        properties: { title: "link-event-minimum-other" },
      },
      {
        operation: "createLink",
        id: "links/known",
        type: linkType,
        source: "beads/known",
        target: "beads/other",
        properties: { title: "link-event-minimum" },
      },
    ],
  });
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-link-event-minimum-installed-"));
    controller.signal.throwIfAborted();
    launchStarted = true;
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts: linkArtifacts,
        credentials: [{ token: operator, principal: "writer", canMutate: true }],
      },
      controller.signal,
    );
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    expect(child.ready.scope).toBe(scope);
    expect(child.ready.claimEligible).toBe(false);
    expect(child.ready.history).toBe(false);
    const address = new URL(child.ready.listenUrl as string);
    const url = `${scope}links/known?view=events`;
    const batchUrl = `${scope}operations/batch`;
    expect(binding.operationTargets.batch).toBe(batchUrl);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 32768,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [
            { method: "POST", url: batchUrl },
            { method: "GET", url },
            { method: "HEAD", url },
          ],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "operator",
          credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${operator}` }),
        },
      },
    );
    const exchange = async (
      method: HttpMethod,
      minimum: Record<string, string> = {},
      requestBody?: string,
    ) => {
      controller.signal.throwIfAborted();
      expect(++attempted, "installed Link Event dispatch bound").toBeLessThanOrEqual(4);
      const requestUrl = requestBody === undefined ? url : batchUrl;
      const response = await execute({
        method,
        url: requestUrl,
        signal: controller.signal,
        credentialRef: "operator",
        raw: {
          headerLines: [
            { name: "accept", value: "application/json" },
            ...Object.entries(minimum).map(([name, value]) => ({ name, value })),
            ...(requestBody === undefined
              ? []
              : [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: "link-event-minimum-seed" },
                ]),
          ],
          ...(requestBody === undefined ? {} : { bodyBytes: Buffer.from(requestBody) }),
        },
      });
      responses.push({
        method,
        url: requestUrl,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: digest(response.bodyText),
        wireSha256: response.wireResponseBytes ? digest(response.wireResponseBytes) : null,
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers[name] ?? null]),
        ),
      });
      expect(response.url).toBe(requestUrl);
      expect(response.exactRequest?.source).toBe("raw-http1-serializer");
      expect(response.exactRequest?.writeState).toBe("complete");
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
      expect(headers.find((header) => header.name.toLowerCase() === "accept")?.value).toBe(
        "application/json",
      );
      if (requestBody !== undefined) {
        expect(
          headers.find((header) => header.name.toLowerCase() === "idempotency-key")?.value,
        ).toBe("link-event-minimum-seed");
        expect(headers.find((header) => header.name.toLowerCase() === "content-type")?.value).toBe(
          "application/json",
        );
      }
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      for (const [name, value] of Object.entries(minimum))
        expect(
          response.exactRequest?.headerLines.find((field) => field.name.toLowerCase() === name)
            ?.value,
        ).toBe(value);
      return response;
    };
    const seed = await exchange("POST", {}, seedBody);
    expect(seed.status).toBe(200);
    const receipt: unknown = JSON.parse(seed.bodyText);
    expect(validReceipt(receipt), JSON.stringify(validReceipt.errors)).toBe(true);
    expect(receipt).toMatchObject({
      status: "completed",
      idempotencyKey: "link-event-minimum-seed",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
    });
    const setup = await exchange("GET");
    expect(setup.status).toBe(200);
    const page: unknown = JSON.parse(setup.bodyText);
    expect(validPage(page), JSON.stringify(validPage.errors)).toBe(true);
    expect(page).toMatchObject({
      source: url,
      events: [{ type: "created", subject: `${scope}links/known` }],
      next: null,
    });
    const context = Object.fromEntries(
      contextNames.map((name) => {
        const value = setup.headers[name];
        if (!value) throw new Error(`missing ${name}`);
        return [name, value];
      }),
    );
    expect(context["bdp-scope-position"]).toBe("pos-1");
    const minimum = {
      "bdp-scope-epoch": context["bdp-scope-epoch"]!,
      "bdp-authorization-view": context["bdp-authorization-view"]!,
      "bdp-minimum-scope-position": "opaque",
    };
    let getBytes = 0;
    let getMedia: string | undefined;
    for (const method of ["GET", "HEAD"] as const) {
      const response = await exchange(method, minimum);
      expect(response.status).toBe(503);
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["last-modified"]).toBeUndefined();
      for (const name of contextNames) expect(response.headers[name], name).toBe(context[name]);
      if (method === "GET") {
        const problem: unknown = JSON.parse(response.bodyText);
        expect(validProblem(problem), JSON.stringify(validProblem.errors)).toBe(true);
        // Exact reference Problem shape, not a ban on protocol extension members.
        expect(problem).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/unavailable",
          status: 503,
          code: "catch-up-timeout",
          retry: "after-delay",
        });
        getBytes = Buffer.byteLength(response.bodyText);
        expect(getBytes).toBeGreaterThan(0);
        expect(response.bodyOctets).toBe(getBytes);
        getMedia = response.headers["content-type"];
        expect(getMedia?.split(";", 1)[0]).toBe("application/problem+json");
      } else {
        expect(response.bodyOctets).toBe(0);
        expect(response.bodyText).toBe("");
        // Reference HEAD metadata describes GET bytes, not transmitted HEAD bytes.
        expect(response.headers["content-length"]).toBe(String(getBytes));
        expect(response.headers["content-type"]).toBe(getMedia);
      }
    }
    expect(attempted).toBe(4);
    expect(responses.map(({ method, url, status }) => ({ method, url, status }))).toEqual([
      { method: "POST", url: batchUrl, status: 200 },
      { method: "GET", url, status: 200 },
      { method: "GET", url, status: 503 },
      { method: "HEAD", url, status: 503 },
    ]);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (child) {
        closeAttempted = true;
        const closing = child.close();
        // Observe late rejection even if the shared remaining deadline wins.
        void closing.catch(() => {});
        await Promise.race([
          closing,
          new Promise<never>((_, reject) => {
            cleanupTimer = setTimeout(
              () => {
                deadlineExceeded = true;
                reject(deadlineReason);
              },
              Math.max(0, expiresAt - Date.now()),
            );
          }),
        ]);
        if (Date.now() >= expiresAt) deadlineExceeded = true;
        if (deadlineExceeded || child.child.exitCode !== 0 || child.child.signalCode !== null) {
          failures.push(new Error("installed finite Event child close was not clean and timely"));
        } else {
          closed = true;
          if (directory) rmSync(directory, { recursive: true, force: true });
        }
      }
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(cleanupTimer);
      clearTimeout(deadline);
    }
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    if (launchStarted && !closed && failures.length === 0)
      failures.push(new Error("installed finite Event child ownership unverified"));
    console.log(
      JSON.stringify({
        observation: "private-installed-link-event-minimum",
        outcome: failures.length === 0 ? "passed" : "failed",
        declaredSourceCommit: sourceCommit,
        workspaceDirty,
        entry: resolvedEntry,
        entrySha256,
        binding: binding ?? null,
        deadlineExceeded,
        attempted,
        exchanges: responses.length,
        completedResponses: responses,
        closeAttempted,
        closed,
        launchStarted,
        startupCompleted: child !== undefined,
        childPid: child?.child.pid ?? null,
        childExitCode: child?.child.exitCode ?? null,
        childSignalCode: child?.child.signalCode ?? null,
        ownership: !launchStarted ? "not-started" : closed ? "closed" : "unverified",
        directory: directory ?? null,
        directoryAbsent: directory === undefined || !existsSync(directory),
        failureCount: failures.length,
        claimEligible: false,
        retention: "response fingerprints and selected headers; no conformance credit",
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed finite Event minimum and cleanup failed");
}, 60000);
