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
