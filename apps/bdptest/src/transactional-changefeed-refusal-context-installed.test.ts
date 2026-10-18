/** Private installed changefeed refusal observations; no profile qualification. */
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
  throw new Error("installed changefeed entry override requires declared source commit");
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
const validPage = ajv.compile({ $ref: `${bundle.$id}#/$defs/changefeedPage` });
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

it("observes genuine installed current context on changefeed parameter refusals", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed changefeed context deadline");
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
    ordinal: number;
    method: HttpMethod;
    url: string;
    accept: string;
    lastEventId: string | null;
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
        id: "beads/a",
        type: beadType,
        properties: { title: "changefeed-context" },
      },
    ],
  });
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-changefeed-context-installed-"));
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
    const initialUrl = `${scope}changes/?after=genesis`;
    const invalidUrl = `${scope}changes/?after=genesis&start=now`;
    const routes: { method: HttpMethod; url: string }[] = [
      { method: "POST", url: `${scope}operations/batch` },
      { method: "GET", url: initialUrl },
      { method: "HEAD", url: initialUrl },
      { method: "GET", url: invalidUrl },
    ];
    function executor(grants: readonly { method: HttpMethod; url: string }[]) {
      return createRawHttpExchangeExecutor(
        { transport: "plain", host: address.hostname, port: Number(address.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 32768,
          exactMode: {
            scope,
            profile: "transactional",
            routes: grants,
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: "operator",
            credentialHandles: [
              { id: "operator", headerNames: ["authorization"] },
              { id: "anonymous", headerNames: [] },
            ],
            resolveCredentials: ({ credentialRef }) =>
              credentialRef === "anonymous" ? {} : { authorization: `Bearer ${operator}` },
          },
        },
      );
    }
    let execute = executor(routes);
    async function exchange(
      url: string,
      method: HttpMethod,
      accept: string,
      requestBody?: string,
      anonymous = false,
      lastEventId?: string,
    ) {
      controller.signal.throwIfAborted();
      expect(++attempted, "installed changefeed dispatch bound").toBeLessThanOrEqual(10);
      expect(Buffer.byteLength(url)).toBeLessThanOrEqual(8192);
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: anonymous ? "anonymous" : "operator",
        raw: {
          headerLines: [
            { name: "accept", value: accept },
            ...(lastEventId === undefined ? [] : [{ name: "last-event-id", value: lastEventId }]),
            ...(requestBody === undefined
              ? []
              : [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: "changefeed-context-a" },
                ]),
          ],
          ...(requestBody === undefined ? {} : { bodyBytes: Buffer.from(requestBody) }),
        },
      });
      responses.push({
        ordinal: attempted,
        method,
        url,
        accept,
        lastEventId: lastEventId ?? null,
        status: response.status,
        bodyOctets: response.bodyOctets,
        wireSha256: response.wireResponseBytes ? digest(response.wireResponseBytes) : null,
        bodySha256: digest(response.bodyText),
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers[name] ?? null]),
        ),
      });
      expect(response.exactRequest?.source).toBe("raw-http1-serializer");
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.url).toBe(url);
      expect(response.exactRequest?.bodyPresent).toBe(requestBody !== undefined);
      expect(response.exactRequest?.bodyOctets).toBe(
        requestBody === undefined ? 0 : Buffer.byteLength(requestBody),
      );
      expect(response.exactRequest?.bodyDigest).toBe(
        requestBody === undefined ? undefined : digest(requestBody),
      );
      const headers = response.exactRequest?.headerLines ?? [];
      const values = (name: string) =>
        headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
      expect(values("host")).toStrictEqual(["reference.invalid"]);
      expect(values("accept")).toStrictEqual([accept]);
      expect(values("last-event-id")).toStrictEqual(lastEventId === undefined ? [] : [lastEventId]);
      expect(values("idempotency-key")).toStrictEqual(
        requestBody === undefined ? [] : ["changefeed-context-a"],
      );
      if (requestBody !== undefined)
        expect(values("content-type")).toStrictEqual(["application/json"]);
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(Number.isSafeInteger(response.bodyOctets)).toBe(true);
      expect(response.bodyOctets).toBeGreaterThanOrEqual(0);
      expect(response.bodyOctets).toBeLessThanOrEqual(32768);
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      return response;
    }
    expect(Buffer.byteLength(body)).toBe(153);
    const seed = await exchange(`${scope}operations/batch`, "POST", "application/json", body);
    expect(seed.status).toBe(200);
    const receipt = JSON.parse(seed.bodyText);
    expect(validReceipt(receipt), JSON.stringify(validReceipt.errors)).toBe(true);
    expect(receipt).toMatchObject({
      status: "completed",
      idempotencyKey: "changefeed-context-a",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
    });
    const initial = await exchange(initialUrl, "GET", "application/json");
    expect(initial.status).toBe(200);
    const page = JSON.parse(initial.bodyText);
    expect(validPage(page), JSON.stringify(validPage.errors)).toBe(true);
    expect(page.scope).toBe(scope);
    expect(page.after).toBe("genesis");
    expect(page.observedHeadPosition).toBe("pos-1");
    expect(page.next).toBeNull();
    expect(page.groups).toHaveLength(1);
    const group = page.groups[0];
    expect(group).toMatchObject({ position: "pos-1", previousPosition: "pos-0" });
    expect(group.changes).toHaveLength(1);
    expect(group.changes[0]).toMatchObject({
      operation: "upsert",
      resourceKind: "bead",
      resource: {
        id: `${scope}beads/a`,
        type: beadType,
        properties: { title: "changefeed-context" },
      },
    });
    expect(group.events).toHaveLength(1);
    expect(group.events[0]).toMatchObject({ type: "created", subject: `${scope}beads/a` });
    const expected = [page.scopeEpoch, page.authorizationView, "pos-1"];
    expect(expected[0]).toBeTruthy();
    expect(expected[1]).toBeTruthy();
    expect(contextNames.map((name) => initial.headers[name])).toStrictEqual(expected);
    const match = /^(cg_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{43}_)1$/.exec(group.checkpoint);
    if (!match) throw new Error("unexpected issued checkpoint encoding");
    // Invalid private input derived from a real token; never a valid durable checkpoint.
    const futureUrl = `${scope}changes/?after=${match[1]}2`;
    execute = executor([
      ...routes,
      { method: "GET", url: futureUrl },
      { method: "HEAD", url: futureUrl },
    ]);
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/request",
      code: "invalid-parameter",
      retry: "never",
      status: 400,
    };
    const problemLength = String(Buffer.byteLength(JSON.stringify(problem)));
    async function contextual(
      url: string,
      method: "GET" | "HEAD",
      accept: string,
      lastEventId?: string,
    ) {
      const response = await exchange(url, method, accept, undefined, false, lastEventId);
      const label = `installed-changefeed-context:${attempted}`;
      expect(response.status, `${label}:prerequisite:${JSON.stringify(responses.at(-1))}`).toBe(
        400,
      );
      expect(response.headers["content-type"]).toBe("application/problem+json");
      expect(response.headers["cache-control"]).toBe("private, no-store");
      for (const name of ["retry-after", "www-authenticate", "x-bdp-development-limit"])
        expect(response.headers[name]).toBeUndefined();
      expect(response.headers["content-length"]).toBe(problemLength);
      if (method === "GET") {
        const actual = JSON.parse(response.bodyText);
        expect(validProblem(actual), JSON.stringify(validProblem.errors)).toBe(true);
        expect(actual).toStrictEqual(problem);
        expect(String(response.bodyOctets)).toBe(problemLength);
      } else {
        expect(response.bodyText).toBe("");
        expect(response.bodyOctets).toBe(0);
      }
      expect(
        contextNames.map((name) => response.headers[name]),
        label,
      ).toStrictEqual(expected);
    }
    for (const accept of ["application/json", "text/event-stream"])
      for (const method of ["GET", "HEAD"] as const) await contextual(futureUrl, method, accept);
    for (const method of ["GET", "HEAD"] as const)
      await contextual(initialUrl, method, "text/event-stream", "malformed");
    const anonymous = await exchange(futureUrl, "GET", "application/json", undefined, true);
    expect(anonymous.status).toBe(401);
    const unauthenticated = JSON.parse(anonymous.bodyText);
    expect(validProblem(unauthenticated), JSON.stringify(validProblem.errors)).toBe(true);
    expect(unauthenticated).toStrictEqual({
      type: "https://github.com/gastownhall/bdp/problems/authentication",
      code: "unauthenticated",
      retry: "after-state-change",
      status: 401,
    });
    expect(anonymous.headers["www-authenticate"]).toBe(
      'Bearer realm="bdp-transaction-development"',
    );
    expect(contextNames.map((name) => anonymous.headers[name])).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
    const malformed = await exchange(invalidUrl, "GET", "application/json");
    expect(malformed.status).toBe(400);
    expect(JSON.parse(malformed.bodyText)).toStrictEqual(problem);
    expect(contextNames.map((name) => malformed.headers[name])).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(attempted).toBe(10);
    expect(responses).toHaveLength(10);
    expect(responses.map(({ method, url, accept }) => ({ method, url, accept }))).toStrictEqual([
      { method: "POST", url: `${scope}operations/batch`, accept: "application/json" },
      { method: "GET", url: initialUrl, accept: "application/json" },
      ...["application/json", "text/event-stream"].flatMap((accept) =>
        ["GET", "HEAD"].map((method) => ({ method, url: futureUrl, accept })),
      ),
      ...["GET", "HEAD"].map((method) => ({
        method,
        url: initialUrl,
        accept: "text/event-stream",
      })),
      { method: "GET", url: futureUrl, accept: "application/json" },
      { method: "GET", url: invalidUrl, accept: "application/json" },
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
        observation: "private-installed-changefeed-parameter-context",
        outcome: failures.length === 0 ? "passed" : "failed",
        // Caller attribution verified separately against archives/consumer; not child-attested.
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
    throw new AggregateError(failures, "installed changefeed observation and cleanup failed");
}, 60000);

it("observes genuine installed finite start-now opaque minimum refusal", async () => {
  const controller = new AbortController();
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-changefeed-opaque-installed-"));
  const ownedDirectory = realpathSync(directory);
  const token = randomBytes(32).toString("base64url");
  const failures: unknown[] = [];
  const failureCategories: string[] = [];
  function fail(category: string, error: unknown) {
    if (!failures.includes(error)) {
      failures.push(error);
      failureCategories.push(category);
    }
  }
  let deadlineFired = false;
  const workTimer = setTimeout(() => {
    deadlineFired = true;
    const error = new Error("installed opaque changefeed work deadline");
    fail("work-deadline", error);
    controller.abort(error);
  }, 45000);
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let launchAttempted = false,
    attempted = 0,
    settledExchanges = 0,
    cleanClose = false,
    cleanupDeadlineExceeded = false,
    pendingDrained = false,
    directoryRemoved = false,
    assertionsCompleted = false;
  const processEvents: {
    exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    close: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  } = { exit: undefined, close: undefined };
  let childDrain: Promise<void> | undefined;
  let lateCleanupRejectionObserved = false;
  const pending = new Set<Promise<unknown>>();
  const responses: {
    method: string;
    url: string;
    status: number;
    bodyOctets: number;
    bodySha256: string;
    wireSha256: string;
    headers: Record<string, string | null>;
  }[] = [];
  const safeHeaders = [
    "bdp-scope-epoch",
    "bdp-authorization-view",
    "bdp-scope-position",
    "content-length",
    "content-type",
    "cache-control",
    "retry-after",
    "location",
    "etag",
    "x-bdp-development",
    "x-bdp-development-limit",
  ];
  const routes = [
    { method: "POST" as const, url: `${scope}operations/batch` },
    { method: "GET" as const, url: `${scope}changes/?start=now` },
    { method: "HEAD" as const, url: `${scope}changes/?start=now` },
  ];
  try {
    launchAttempted = true;
    const launching = launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [{ token, principal: "writer", canMutate: true }],
      },
      controller.signal,
    );
    void launching.catch((error: unknown) => fail("launch", error));
    child = await launching;
    child.child.once("exit", (code, signal) => {
      processEvents.exit = { code, signal };
    });
    const ownedProcess = child.child;
    childDrain = new Promise<void>((resolve) => {
      ownedProcess.once("close", (code, signal) => {
        processEvents.close = { code, signal };
        resolve();
      });
    });
    expect(child.ready.scope).toBe(scope);
    expect(child.ready.claimEligible).toBe(false);
    expect(child.ready.profile).toBe("transactional");
    expect(child.ready.history).toBe(false);
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    const address = new URL(child.ready.listenUrl as string);
    // Exactly one executor owns this callback's closed route set. It never follows redirects.
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
          defaultCredentialRef: "writer",
          credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
        },
      },
    );
    async function exchange(
      method: "GET" | "HEAD" | "POST",
      suffix: string,
      status: number,
      headers: Record<string, string> = {},
      input?: unknown,
      schemaName?: string,
    ) {
      const url = `${scope}${suffix}`;
      if (!routes.some((route) => route.method === method && route.url === url) || attempted >= 4)
        throw new Error("unbound or excess installed opaque changefeed request");
      controller.signal.throwIfAborted();
      expect(Buffer.byteLength(url)).toBeLessThanOrEqual(8192);
      attempted++;
      const operation = execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: "writer",
        raw: {
          headerLines: Object.entries(headers).map(([name, value]) => ({ name, value })),
          ...(input === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(input)) }),
        },
      });
      pending.add(operation);
      void operation.then(
        () => {
          pending.delete(operation);
          settledExchanges++;
        },
        () => {
          pending.delete(operation);
          settledExchanges++;
        },
      );
      const response = await operation;
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(
        response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
      ).toBe("reference.invalid");
      if (!response.wireResponseBytes?.length) throw new Error("missing actual wire response");
      if (
        response.bodyOctets === undefined ||
        !Number.isSafeInteger(response.bodyOctets) ||
        response.bodyOctets < 0
      )
        throw new Error("completed body octets unavailable");
      responses.push({
        method,
        url,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: digest(response.bodyText),
        wireSha256: digest(response.wireResponseBytes),
        headers: Object.fromEntries(
          safeHeaders.map((name) => [name, response.headers[name] ?? null]),
        ),
      });
      expect(response.url).toBe(url);
      expect(response.status, response.bodyText).toBe(status);
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      const value: unknown = response.bodyText === "" ? undefined : JSON.parse(response.bodyText);
      if (schemaName) {
        const validate =
          schemaName === "mutationReceipt"
            ? validReceipt
            : schemaName === "changefeedPage"
              ? validPage
              : schemaName === "transactionalProblem"
                ? validProblem
                : undefined;
        if (!validate) throw new Error("missing schema");
        expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      }
      return { response, value };
    }
    const seeded = await exchange(
      "POST",
      "operations/batch",
      200,
      { "content-type": "application/json", "idempotency-key": "opaque-feed-installed-a" },
      {
        operations: [
          {
            operation: "createBead",
            id: "beads/a",
            type: beadType,
            properties: { title: "opaque-changefeed" },
          },
        ],
      },
      "mutationReceipt",
    );
    expect(seeded.value).toMatchObject({
      status: "completed",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
    });
    if (!seeded.value || typeof seeded.value !== "object" || Array.isArray(seeded.value))
      throw new Error("missing actual seed receipt");
    const receipt = seeded.value as Record<string, unknown>;
    if (
      typeof receipt.scopeEpoch !== "string" ||
      typeof receipt.authorizationView !== "string" ||
      typeof receipt.requiredPosition !== "string"
    )
      throw new Error("missing actual seed context");
    const current = {
      "bdp-scope-epoch": receipt.scopeEpoch,
      "bdp-authorization-view": receipt.authorizationView,
      "bdp-scope-position": receipt.requiredPosition,
    };
    for (const value of Object.values(current)) expect(value.length).toBeGreaterThan(0);
    const minimum = {
      "bdp-scope-epoch": receipt.scopeEpoch,
      "bdp-authorization-view": receipt.authorizationView,
      "bdp-minimum-scope-position": receipt.requiredPosition,
      "last-event-id": "malformed reconnect ignored",
    };
    function assertContext(response: typeof seeded.response) {
      for (const [name, value] of Object.entries(current))
        expect(response.headers[name]).toBe(value);
    }
    const eligible = await exchange(
      "GET",
      "changes/?start=now",
      200,
      minimum,
      undefined,
      "changefeedPage",
    );
    assertContext(eligible.response);
    expect(eligible.value).toMatchObject({
      scope,
      scopeEpoch: receipt.scopeEpoch,
      authorizationView: receipt.authorizationView,
      observedHeadPosition: "pos-1",
      groups: [],
      next: null,
    });
    if (!eligible.value || typeof eligible.value !== "object" || Array.isArray(eligible.value))
      throw new Error("missing actual finite page");
    const page = eligible.value as Record<string, unknown>;
    expect(page.after).not.toBe("genesis");
    expect(page.after).toMatch(/^cg_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{43}_1$/);
    expect(eligible.response.headers["content-length"]).toBe(String(eligible.response.bodyOctets));
    const opaque = {
      ...minimum,
      "bdp-minimum-scope-position": "unknown",
      "if-none-match": "*",
    };
    const get = await exchange(
      "GET",
      "changes/?start=now",
      503,
      opaque,
      undefined,
      "transactionalProblem",
    );
    expect(get.value).toMatchObject({
      code: "catch-up-timeout",
      status: 503,
      retry: "after-delay",
    });
    assertContext(get.response);
    expect(get.response.bodyOctets).toBeGreaterThan(0);
    expect(get.response.headers["content-length"]).toBe(String(get.response.bodyOctets));
    const head = await exchange("HEAD", "changes/?start=now", 503, opaque);
    assertContext(head.response);
    expect(head.response.bodyOctets).toBe(0);
    expect(head.response.bodyText).toBe("");
    for (const response of [get.response, head.response]) {
      expect(response.headers["content-type"]).toBe("application/problem+json");
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
    }
    for (const name of ["content-type", "content-length", "cache-control", "retry-after"])
      expect(head.response.headers[name]).toBe(get.response.headers[name]);
    expect(attempted).toBe(4);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 503, 503]);
    expect(settledExchanges).toBe(4);
    controller.signal.throwIfAborted();
    assertionsCompleted = true;
  } catch (error) {
    fail("work", error);
  } finally {
    clearTimeout(workTimer);
    controller.abort();
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleaning = (async () => {
      await Promise.allSettled([...pending]);
      pendingDrained = pending.size === 0;
      if (!pendingDrained) throw new Error("raw exchanges remain pending");
      // Executor settlement destroys the socket; it does not expose a socket-close census.
      if (child) {
        await child.close();
        if (!childDrain) throw new Error("child close observer unavailable");
        await childDrain;
      } else if (launchAttempted) throw new Error("pre-ready child ownership remains unknown");
    })();
    void cleaning.catch((error: unknown) => {
      lateCleanupRejectionObserved = cleanupDeadlineExceeded;
      fail(cleanupDeadlineExceeded ? "late-cleanup" : "cleanup", error);
    });
    try {
      await Promise.race([
        cleaning,
        new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => {
            cleanupDeadlineExceeded = true;
            child?.child.kill("SIGKILL");
            reject(new Error("installed opaque changefeed total cleanup deadline"));
          }, 10000);
        }),
      ]);
      if (
        cleanupDeadlineExceeded ||
        !child ||
        child.child.exitCode !== 0 ||
        child.child.signalCode !== null ||
        processEvents.exit?.code !== 0 ||
        processEvents.exit.signal !== null ||
        processEvents.close?.code !== 0 ||
        processEvents.close.signal !== null
      )
        fail(
          "unclean-close",
          new Error("installed opaque changefeed clean exit was not established"),
        );
      else cleanClose = true;
    } catch (error) {
      fail("cleanup", error);
    } finally {
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    }
    try {
      if (cleanClose && pendingDrained && assertionsCompleted && failures.length === 0) {
        if (!existsSync(directory) || realpathSync(directory) !== ownedDirectory) {
          fail(
            "directory-ownership",
            new Error("installed opaque changefeed directory ownership changed"),
          );
        } else {
          rmSync(directory, { recursive: true, force: false });
          directoryRemoved = !existsSync(directory);
          if (!directoryRemoved)
            fail("directory-cleanup", new Error("installed opaque changefeed directory remains"));
        }
      }
    } catch (error) {
      fail("directory-cleanup", error);
    }
    const lifecycleAtReport = {
      launchAttempted,
      returnedChild: child !== undefined,
      pid: child?.child.pid ?? null,
      exitCode: child?.child.exitCode ?? null,
      signalCode: child?.child.signalCode ?? null,
      observedExit: processEvents.exit ?? null,
      observedClose: processEvents.close ?? null,
      childStdioDrainObserved: processEvents.close !== undefined,
      closure: cleanupDeadlineExceeded || !cleanClose ? "unknown-or-failed" : "clean",
      cleanClose,
      cleanupDeadlineExceeded,
      pendingExchanges: pending.size,
      pendingDrained,
      settledExchanges,
      socketCloseCensusAvailable: false,
      transportSettlementContract: "executor destroys socket before exchange settles",
      lateCleanupRejectionObserved,
      directory,
      directoryRemoved,
      directoryPresent: existsSync(directory),
    };
    console.log(
      JSON.stringify({
        observation: "private-installed-changefeed-opaque-minimum",
        declaredSourceCommit: sourceCommit,
        workspaceDirty,
        entry: resolvedEntry,
        entrySha256,
        artifactSha256: digest(JSON.stringify(artifacts)),
        binding,
        attempted,
        exchanges: responses.length,
        completedResponses: responses,
        assertionsCompleted,
        deadlineFired,
        lifecycleAtReport,
        failureCategories,
        outcome: failures.length ? "failed" : "passed",
        claimEligible: false,
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, "installed opaque changefeed observation or cleanup failed");
}, 60000);

it("observes installed current changefeed minimum admission and retained replay", async () => {
  const { recordRawSse } = await import("@bdp/server/testing");
  const { stringifyJsonValue } = await import("@bdp/protocol");
  type Page = {
    after: string;
    observedHeadPosition: string;
    next: string | null;
    groups: { checkpoint: string; changes: { resource: { id: string } }[] }[];
  };
  const controller = new AbortController(),
    streamController = new AbortController();
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-current-feed-installed-"));
  const ownedDirectory = realpathSync(directory),
    token = randomBytes(32).toString("base64url");
  const failures: unknown[] = [],
    failureCategories: string[] = [];
  function fail(category: string, error: unknown) {
    if (!failures.includes(error)) {
      failures.push(error);
      failureCategories.push(category);
    }
  }
  const workBegan = performance.now();
  let trackedDiffSha256: string | null = null,
    trackedDiffUnavailableReason: string | null = null;
  let deadlineFired = false;
  const workTimer = setTimeout(() => {
    deadlineFired = true;
    const error = new Error("installed current feed work deadline");
    fail("work-deadline", error);
    controller.abort(error);
  }, 45000);
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let recorder: ReturnType<typeof recordRawSse> | undefined, childDrain: Promise<void> | undefined;
  let attempted = 0,
    settledFiniteExchanges = 0,
    launchAttempted = false,
    cleanClose = false,
    pendingDrained = false,
    streamDrained = false,
    directoryRemoved = false,
    stopUnknown = false,
    lateCleanupRejectionObserved = false,
    assertionsCompleted = false;
  const processEvents: {
    exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    close: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  } = { exit: undefined, close: undefined };
  const pending = new Set<Promise<unknown>>();
  const responses: {
    ordinal: number;
    method: string;
    url: string;
    status: number;
    bodyOctets: number;
    bodySha256: string;
    wireSha256: string;
    requestHeaders: { name: string; value: string }[];
    headers: Record<string, string | null>;
  }[] = [];
  let stream: Record<string, unknown> | null = null;
  const safeHeaders = [...retainedHeaders, "etag"];
  function dispatch() {
    controller.signal.throwIfAborted();
    if (attempted >= 10) throw new Error("installed current feed global dispatch bound");
    return ++attempted;
  }
  async function bounded<T>(operation: Promise<T>, deadline: number, label: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(label)),
            Math.max(1, deadline - performance.now()),
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  function track<T>(operation: Promise<T>) {
    pending.add(operation);
    void operation.then(
      () => {
        pending.delete(operation);
        settledFiniteExchanges++;
      },
      () => {
        pending.delete(operation);
        settledFiniteExchanges++;
      },
    );
    return operation;
  }
  try {
    try {
      controller.signal.throwIfAborted();
      const timeout = Math.min(1500, Math.floor(workBegan + 45000 - performance.now()));
      if (timeout < 1000) throw new Error("tracked diff work budget unavailable");
      const diff = execFileSync("git", ["diff", "--binary", "HEAD"], {
        cwd: root,
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (performance.now() >= workBegan + 45000)
        throw new Error("tracked diff work budget expired");
      trackedDiffSha256 = digest(diff);
    } catch {
      trackedDiffSha256 = null;
      trackedDiffUnavailableReason = "bounded tracked diff capture unavailable";
      const error = new Error(trackedDiffUnavailableReason);
      fail("tracked-diff-metadata", error);
      throw error;
    }
    launchAttempted = true;
    const launching = launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [{ token, principal: "writer", canMutate: true }],
      },
      controller.signal,
    );
    void launching.catch((error: unknown) => fail("launch", error));
    child = await launching;
    const ownedProcess = child.child;
    ownedProcess.once("exit", (code, signal) => {
      processEvents.exit = { code, signal };
    });
    childDrain = new Promise<void>((resolve) => {
      ownedProcess.once("close", (code, signal) => {
        processEvents.close = { code, signal };
        resolve();
      });
    });
    expect(ownedProcess.exitCode).toBeNull();
    expect(ownedProcess.signalCode).toBeNull();
    expect(child.ready).toMatchObject({
      scope,
      profile: "transactional",
      history: false,
      claimEligible: false,
    });
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    const address = new URL(child.ready.listenUrl as string);
    const routes = [
      { method: "POST" as const, url: scope + "operations/batch" },
      { method: "GET" as const, url: scope + "changes/?after=genesis" },
      { method: "GET" as const, url: scope + "changes/?start=now" },
    ];
    function executor() {
      return createRawHttpExchangeExecutor(
        { transport: "plain", host: address.hostname, port: Number(address.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 131072,
          exactMode: {
            scope,
            profile: "transactional",
            routes: [...routes],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: "writer",
            credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: "Bearer " + token }),
          },
        },
      );
    }
    let execute = executor();
    async function exchange(
      method: "POST" | "GET",
      url: string,
      expected: number,
      headerLines: { name: string; value: string }[],
      input?: unknown,
    ) {
      if (!routes.some((r) => r.method === method && r.url === url))
        throw new Error("unbound installed current feed target");
      const ordinal = dispatch();
      const response = await track(
        execute({
          method,
          url,
          signal: controller.signal,
          credentialRef: "writer",
          raw: {
            headerLines,
            ...(input === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(input)) }),
          },
        }),
      );
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(
        response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
      ).toBe("reference.invalid");
      expect(response.url).toBe(url);
      if (!response.wireResponseBytes?.length || response.bodyOctets === undefined)
        throw new Error("missing installed current feed actual wire/body");
      expect(response.bodyOctets).toBe(Buffer.byteLength(response.bodyText));
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      responses.push({
        ordinal,
        method,
        url,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: digest(response.bodyText),
        wireSha256: digest(response.wireResponseBytes),
        requestHeaders: headerLines.map((h) => ({ ...h })),
        headers: Object.fromEntries(
          safeHeaders.map((name) => [name, response.headers[name] ?? null]),
        ),
      });
      expect(response.status).toBe(expected);
      const value: unknown = JSON.parse(response.bodyText);
      return { response, value };
    }
    let secondReceipt: Record<string, unknown> | undefined;
    for (const id of ["a", "b"]) {
      const seed = await exchange(
        "POST",
        scope + "operations/batch",
        200,
        [
          { name: "content-type", value: "application/json" },
          { name: "accept", value: "application/json" },
          { name: "idempotency-key", value: "current-feed-" + id },
        ],
        {
          operations: [
            {
              operation: "createBead",
              id: "beads/" + id,
              type: beadType,
              properties: { title: "current-feed-" + id },
            },
          ],
        },
      );
      expect(validReceipt(seed.value), JSON.stringify(validReceipt.errors)).toBe(true);
      expect(seed.value).toMatchObject({
        status: "completed",
        requiredPosition: id === "a" ? "pos-1" : "pos-2",
      });
      secondReceipt = seed.value as Record<string, unknown>;
    }
    if (!secondReceipt) throw new Error("missing second installed receipt");
    const current = [secondReceipt.scopeEpoch, secondReceipt.authorizationView, "pos-2"];
    const k = [
      { name: "bdp-scope-epoch", value: String(secondReceipt.scopeEpoch) },
      { name: "bdp-authorization-view", value: String(secondReceipt.authorizationView) },
      { name: "bdp-minimum-scope-position", value: "pos-2" },
    ];
    const u = k.map((h) => ({
      ...h,
      value: h.name === "bdp-minimum-scope-position" ? "unknown" : h.value,
    }));
    const p = u.map((h) => ({
      ...h,
      value: h.name === "bdp-minimum-scope-position" ? "pos-01" : h.value,
    }));
    const json = { name: "Accept", value: "application/json" },
      sse = { name: "Accept", value: "text/event-stream" };
    const firstResponse = await exchange("GET", scope + "changes/?after=genesis", 200, [
      json,
      ...k,
    ]);
    expect(validPage(firstResponse.value), JSON.stringify(validPage.errors)).toBe(true);
    const first = firstResponse.value as Page;
    expect(first.groups).toHaveLength(1);
    expect(first.observedHeadPosition).toBe("pos-2");
    const cp1 = first.groups[0]!.checkpoint;
    expect(first.next).toBe(scope + "changes/?after=" + cp1);
    const afterUrl = first.next!;
    routes.push({ method: "GET", url: afterUrl });
    execute = executor();
    const secondResponse = await exchange("GET", afterUrl, 200, [json, ...k]);
    expect(validPage(secondResponse.value), JSON.stringify(validPage.errors)).toBe(true);
    const page2 = secondResponse.value as Page;
    expect(page2.groups).toHaveLength(1);
    expect(page2.next).toBeNull();
    expect(page2.after).toBe(cp1);
    expect(page2.observedHeadPosition).toBe("pos-2");
    for (const response of [firstResponse.response, secondResponse.response])
      expect(contextNames.map((name) => response.headers[name])).toEqual(current);
    expect(page2.groups[0]!.changes[0]!.resource.id).toBe(scope + "beads/b");
    const cp2 = page2.groups[0]!.checkpoint;
    expect(cp2).not.toBe(cp1);
    for (const [url, headers] of [
      [scope + "changes/?after=genesis", [json, ...u, { name: "If-None-Match", value: "*" }]],
      [afterUrl, [json, ...p, { name: "If-Match", value: '"missing"' }]],
      [scope + "changes/?start=now", [sse, ...u]],
      [scope + "changes/?start=now", [sse, ...u, { name: "Last-Event-ID", value: cp1 }]],
      [
        scope + "changes/?after=genesis",
        [
          json,
          ...u,
          { name: "Last-Event-ID", value: "bad" },
          { name: "Last-Event-ID", value: "also-bad" },
        ],
      ],
    ] as const) {
      const result = await exchange("GET", url, 503, [...headers]);
      expect(validProblem(result.value), JSON.stringify(validProblem.errors)).toBe(true);
      expect(result.value).toMatchObject({
        code: "catch-up-timeout",
        status: 503,
        retry: "after-delay",
      });
      expect(contextNames.map((name) => result.response.headers[name])).toEqual(current);
      expect(result.response.headers["content-type"]).toBe("application/problem+json");
      expect(result.response.headers["cache-control"]).toBe("private, no-store");
      expect(result.response.headers["retry-after"]).toBe("1");
      expect(result.response.headers.etag).toBeUndefined();
      expect(result.response.headers["x-bdp-development-limit"]).toBeUndefined();
      expect(result.response.bodyText).not.toContain("event: change-group");
    }
    const ordinal = dispatch();
    const streamHeaders: [string, string][] = [
      ["Authorization", "Bearer " + token],
      ...[sse, ...k, { name: "Last-Event-ID", value: cp1 }].map((h): [string, string] => [
        h.name,
        h.value,
      ]),
    ];
    recorder = recordRawSse({
      dial: child.ready.listenUrl as string,
      host: new URL(scope).host,
      target: new URL(scope).pathname + "changes/?after=genesis",
      headers: streamHeaders,
      signal: AbortSignal.any([controller.signal, streamController.signal]),
      timeoutMs: 5000,
    });
    const rec = recorder;
    await rec.ready;
    expect(rec.status).toBe(200);
    await rec.until(() => rec.frames.filter((f) => f.startsWith("id: ")).length >= 1);
    const expectedFrame =
      "id: " + cp2 + "\nevent: change-group\ndata: " + stringifyJsonValue(page2.groups[0]);
    expect(rec.frames.filter((f) => f.startsWith("id: "))).toEqual([expectedFrame]);
    expect(rec.headers["content-type"]).toBe("text/event-stream");
    expect(contextNames.map((name) => rec.headers[name])).toEqual(current);
    expect(controller.signal.aborted).toBe(false);
    expect(streamController.signal.aborted).toBe(false);
    expect(rec.destroyed).toBe(false);
    const liveBeforeClose =
      !rec.destroyed && !controller.signal.aborted && !streamController.signal.aborted;
    await rec.close();
    streamDrained = true;
    expect(rec.frames.filter((f) => f.startsWith("id: "))).toEqual([expectedFrame]);
    const actualGroup: unknown = JSON.parse(
      rec.frames.filter((f) => f.startsWith("id: "))[0]!.split("\ndata: ")[1]!,
    );
    expect(actualGroup).toEqual(page2.groups[0]);
    stream = {
      request: ordinal,
      status: rec.status,
      readyObserved: true,
      liveBeforeClose,
      afterDrain: true,
      frames: rec.frames,
      group: actualGroup,
      checkpoint: cp2,
      wireSha256: digest(rec.wireBytes),
      bodySha256: digest(rec.body),
      requestHeaders: streamHeaders.filter(([name]) => name !== "Authorization"),
      headers: Object.fromEntries(safeHeaders.map((name) => [name, rec.headers[name] ?? null])),
    };
    expect(attempted).toBe(10);
    expect(settledFiniteExchanges).toBe(9);
    expect(responses).toHaveLength(9);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 503, 503, 503, 503, 503]);
    assertionsCompleted = true;
    controller.signal.throwIfAborted();
  } catch (error) {
    fail("observation", error);
  } finally {
    controller.abort();
    streamController.abort();
    clearTimeout(workTimer);
    const cleanupDeadline = performance.now() + 10000;
    const cleaning = (async () => {
      const cleanupFailures: unknown[] = [];
      try {
        if (recorder) {
          await recorder.close();
          streamDrained = true;
        }
      } catch (error) {
        cleanupFailures.push(error);
      }
      const pendingResults = await Promise.allSettled([...pending]);
      pendingDrained = pending.size === 0;
      for (const result of pendingResults)
        if (result.status === "rejected") cleanupFailures.push(result.reason);
      if (child) {
        const closing = child.close();
        void closing.catch((error: unknown) => {
          lateCleanupRejectionObserved = true;
          fail("late-child-close", error);
        });
        const results = await Promise.allSettled([closing, childDrain]);
        for (const result of results)
          if (result.status === "rejected") cleanupFailures.push(result.reason);
        if (!cleanupFailures.length) {
          expect(processEvents.exit).toEqual({ code: 0, signal: null });
          expect(processEvents.close).toEqual({ code: 0, signal: null });
          expect(child.child.exitCode).toBe(0);
          if (!child.child.pid) throw new Error("missing owned child pid");
          expect(() => process.kill(child!.child.pid!, 0)).toThrow();
          cleanClose = true;
        }
      }
      if (cleanupFailures.length)
        throw new AggregateError(cleanupFailures, "installed current feed cleanup failed");
    })();
    void cleaning.catch((error: unknown) => fail("cleanup-operation", error));
    try {
      await bounded(cleaning, cleanupDeadline, "installed current feed total cleanup deadline");
      if (
        cleanClose &&
        pendingDrained &&
        (recorder === undefined || streamDrained) &&
        realpathSync(directory) === ownedDirectory
      ) {
        rmSync(directory, { recursive: true, force: false });
        directoryRemoved = true;
      } else if (launchAttempted) stopUnknown = true;
    } catch (error) {
      stopUnknown = true;
      fail("cleanup", error);
    }
    console.log(
      JSON.stringify({
        observation: "private-installed-current-changefeed-minimum",
        outcome: failures.length ? "failed" : "passed",
        attempted,
        settledFiniteExchanges,
        responses,
        stream,
        declaredSourceCommit: sourceCommit,
        workspaceDirty,
        witnessSourceSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
        trackedDiffSha256,
        trackedDiffUnavailableReason,
        sourceLimitation:
          "Declared source and witness/diff hashes; installed payload/configuration independently bound by external validation",
        entryLiteral: entry,
        entry: resolvedEntry,
        entrySha256,
        binding,
        ready: child?.ready ?? null,
        childPid: child?.child.pid ?? null,
        processEvents,
        cleanClose,
        closed: cleanClose,
        stopUnknown,
        lateCleanupRejectionObserved,
        pendingDrained,
        streamDrained,
        pendingOperationsAtReport: pending.size,
        directory,
        directoryRemoved,
        directoryAbsent: !existsSync(directory),
        launchAttempted,
        assertionsCompleted,
        deadlineFired,
        failureCategories,
        failureCount: failures.length,
        claimEligible: false,
      }),
    );
  }
  if (failures.length) throw new AggregateError(failures, "installed current feed witness failed");
}, 60000);
