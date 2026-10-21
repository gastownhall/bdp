/** Private installed exact schema traversal; no public discovery or profile qualification. */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal: AbortSignal,
  ): Promise<{
    child: import("node:child_process").ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("installed schema override requires explicit source commit");
const declaredSourceCommit =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(declaredSourceCommit)) throw new Error("invalid declared source commit");
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const entrySha256 = hash(readFileSync(entry));
const scope = "https://reference.invalid/acme/",
  task = `${scope}types/task`,
  rootSchema = `${scope}schemas/root`,
  referencedSchema = `${scope}schemas/value`;
const descriptor = {
  id: task,
  name: "Task",
  describes: "bead",
  conformsTo: [],
  propertiesSchema: rootSchema,
};
const rootBytes = `{\n "$id": "${rootSchema}", "type": "object", "properties": {"title": {"$ref": "value"}}, "required": ["title"], "additionalProperties": false\n}\n`;
const referencedBytes = `{ "$id": "${referencedSchema}", "description": "café", "type": "string", "minLength": 1e0 }\n`;
const artifacts = {
  descriptors: [{ retrievalUri: task, utf8: JSON.stringify(descriptor) }],
  schemas: [
    { retrievalUri: rootSchema, utf8: rootBytes },
    { retrievalUri: referencedSchema, utf8: referencedBytes },
  ],
};
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const schema = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
ajv.addSchema(schema);
const validators = Object.fromEntries(
  ["typesInventory", "typeDescriptor", "mutationReceipt", "readProblem"].map((name) => [
    name,
    ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` }),
  ]),
);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected object");
  return value as Record<string, unknown>;
}
function checked(text: string, name: string) {
  const value = record(JSON.parse(text));
  const validate = validators[name];
  if (!validate) throw new Error("unbound schema");
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  return value;
}
function confinedObserved(value: unknown, expected: string): string {
  if (typeof value !== "string" || value.length > 8192 || Buffer.byteLength(value) > 8192)
    throw new Error("unbound schema traversal identity");
  const url = new URL(value);
  if (
    url.href !== value ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value !== expected ||
    !value.startsWith(scope)
  )
    throw new Error("unbound schema traversal identity");
  return value;
}
it("confines observed Type and schema traversal to exact administrative identities", () => {
  for (const value of [task, rootSchema, referencedSchema])
    expect(confinedObserved(value, value)).toBe(value);
  for (const value of [
    rootSchema + "?x=1",
    rootSchema + "#fragment",
    rootSchema + "/",
    rootSchema.replace("root", "%72oot"),
    rootSchema.replace("reference.invalid", "user@reference.invalid"),
    rootSchema.replace("reference.invalid", "other.invalid"),
    rootSchema.replace("reference.invalid", "REFERENCE.invalid"),
    rootSchema + "?",
  ])
    expect(() => confinedObserved(value, rootSchema)).toThrow("unbound schema traversal identity");
});
it("traverses installed local schema bytes with current context within14requests", async () => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("installed schema cohort deadline")),
    90000,
  );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-schema-installed-"));
  const token = randomBytes(32).toString("base64url");
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts,
    credentials: [{ token, principal: "writer", canMutate: true }],
  };
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  const failures: unknown[] = [],
    observations: Record<string, unknown>[] = [];
  const sessions: { pid: number | undefined; exit: number | null; signal: string | null }[] = [];
  const routes = [
    { method: "GET", url: `${scope}types/?limit=32` },
    { method: "HEAD", url: rootSchema },
    { method: "GET", url: `${scope}schemas/unknown` },
    { method: "POST", url: rootSchema },
    { method: "GET", url: scope },
    { method: "POST", url: `${scope}operations/create-bead` },
  ];
  const grants = new Set<string>();
  let requests = 0;
  let epoch: string | undefined, view: string | undefined;
  async function exchange(
    label: string,
    method: "GET" | "HEAD" | "POST",
    url: string,
    headers: Record<string, string> = {},
    input?: unknown,
    wrongCredential = false,
  ) {
    if (!child) throw new Error("installed child missing");
    if (
      !routes.some((r) => r.method === method && r.url === url) &&
      !(method === "GET" && grants.has(url))
    )
      throw new Error("unbound installed schema route");
    if (++requests > 14) throw new Error("installed schema request ceiling");
    const address = new URL(child.ready.listenUrl as string);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "writer",
          credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
          resolveCredentials: () => ({
            authorization: `Bearer ${wrongCredential ? "wrong-credential" : token}`,
          }),
        },
      },
    );
    const bodyBytes = input === undefined ? undefined : Buffer.from(JSON.stringify(input));
    const response = await execute({
      method,
      url,
      signal: controller.signal,
      credentialRef: "writer",
      raw: {
        headerLines: Object.entries(headers).map(([name, value]) => ({ name, value })),
        ...(bodyBytes ? { bodyBytes } : {}),
      },
    });
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(
      response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
    ).toBe("reference.invalid");
    if (
      !response.wireResponseBytes?.length ||
      !Number.isSafeInteger(response.bodyOctets) ||
      response.bodyOctets === undefined ||
      response.bodyOctets < 0
    )
      throw new Error("missing exact schema wire evidence");
    observations.push({
      label,
      method,
      url,
      status: response.status,
      requestBodyBytes: bodyBytes?.length ?? 0,
      requestBodySha256: hash(bodyBytes ?? new Uint8Array()),
      responseBodyBytes: response.bodyOctets,
      responseBodySha256: hash(response.bodyText),
      wireSha256: hash(response.wireResponseBytes),
      context: {
        epoch: response.headers["bdp-scope-epoch"],
        view: response.headers["bdp-authorization-view"],
        position: response.headers["bdp-scope-position"],
      },
    });
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    return response;
  }
  type Wire = Awaited<ReturnType<typeof exchange>>;
  function context(response: Wire, position: string) {
    for (const [key, value] of Object.entries({
      "bdp-scope-epoch": epoch,
      "bdp-authorization-view": view,
      "bdp-scope-position": position,
    })) {
      expect(typeof response.headers[key], `schema context presence: ${key}`).toBe("string");
      expect(response.headers[key], `schema current context: ${key}`).toBe(value);
    }
  }
  function exact(response: Wire, bytes: string) {
    expect(response.status, "known installed schema status").toBe(200);
    expect(response.bodyText, "exact installed schema bytes").toBe(bytes);
    expect(response.bodyOctets).toBe(Buffer.byteLength(bytes));
    expect(response.headers["content-length"]).toBe(String(Buffer.byteLength(bytes)));
    expect(hash(response.bodyText)).toBe(hash(bytes));
    expect(response.headers["content-type"]).toBe("application/json");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.vary).toBe("Accept");
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers["last-modified"]).toBeUndefined();
  }
  try {
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
    binding = installedTransactionBinding(child.ready, declaredSourceCommit, fixture);
    expect(child.ready.claimEligible).toBe(false);
    const inventory = await exchange("types", "GET", routes[0]!.url);
    expect(inventory.status).toBe(200);
    expect(checked(inventory.bodyText, "typesInventory")).toEqual({
      items: [{ id: task, name: "Task", describes: "bead" }],
      next: null,
    });
    const observedType = confinedObserved(
      record((record(JSON.parse(inventory.bodyText)).items as unknown[])[0]).id,
      task,
    );
    grants.add(observedType);
    const typeResponse = await exchange("type", "GET", observedType);
    expect(typeResponse.status).toBe(200);
    const actualDescriptor = checked(typeResponse.bodyText, "typeDescriptor");
    expect(actualDescriptor).toEqual(descriptor);
    const observedRoot = confinedObserved(actualDescriptor.propertiesSchema, rootSchema);
    grants.add(observedRoot);
    const schemaResponse = await exchange("root", "GET", observedRoot);
    exact(schemaResponse, rootBytes);
    const parsedRoot = record(JSON.parse(schemaResponse.bodyText));
    expect(parsedRoot.$id).toBe(rootSchema);
    expect(parsedRoot).toEqual({
      $id: rootSchema,
      type: "object",
      properties: { title: { $ref: "value" } },
      required: ["title"],
      additionalProperties: false,
    });
    const actualRef = record(record(parsedRoot.properties).title).$ref;
    expect(actualRef).toBe("value");
    const resolved = confinedObserved(
      new URL(actualRef as string, parsedRoot.$id as string).href,
      referencedSchema,
    );
    grants.add(resolved);
    epoch = schemaResponse.headers["bdp-scope-epoch"];
    view = schemaResponse.headers["bdp-authorization-view"];
    context(schemaResponse, "pos-0");
    const referenced = await exchange("referenced", "GET", resolved);
    exact(referenced, referencedBytes);
    context(referenced, "pos-0");
    expect(JSON.parse(referenced.bodyText)).toEqual({
      $id: referencedSchema,
      description: "café",
      type: "string",
      minLength: 1,
    });
    const head = await exchange("head", "HEAD", observedRoot);
    expect(head.status).toBe(200);
    expect(head.bodyText).toBe("");
    expect(head.bodyOctets).toBe(0);
    expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(rootBytes)));
    expect(head.headers["content-type"]).toBe("application/json");
    expect(head.headers["cache-control"]).toBe("private, no-store");
    expect(head.headers.vary).toBe("Accept");
    expect(head.headers.etag).toBeUndefined();
    context(head, "pos-0");
    for (const [label, headers, status] of [
      ["unacceptable", { accept: "text/plain" }, 406],
      ["not-modified", { "if-none-match": "*" }, 304],
      ["precondition", { "if-match": '"missing"' }, 412],
    ] as const) {
      const selected = await exchange(label, "GET", observedRoot, headers);
      expect(selected.status).toBe(status);
      expect(selected.bodyText).toBe("");
      expect(selected.bodyOctets).toBe(0);
      context(selected, "pos-0");
      expect(selected.headers["content-type"]).toBeUndefined();
      expect(selected.headers["content-length"]).toBe(status === 304 ? undefined : "0");
      expect(selected.headers["cache-control"]).toBe("private, no-store");
      expect(selected.headers.vary).toBe("Accept");
      expect(selected.headers.etag).toBeUndefined();
    }
    const unknown = await exchange("unknown", "GET", `${scope}schemas/unknown`);
    expect(unknown.status).toBe(404);
    expect(checked(unknown.bodyText, "readProblem")).toMatchObject({
      status: 404,
      code: "resource-not-found",
    });
    expect(
      (await exchange("unauthenticated", "GET", observedRoot, {}, undefined, true)).status,
    ).toBe(401);
    const method = await exchange("method", "POST", observedRoot);
    expect(method.status).toBe(405);
    expect(method.headers.allow).toBe("GET, HEAD");
    expect(method.bodyText).toBe("");
    const discovery = await exchange("discovery", "GET", scope);
    expect(discovery.status).toBe(204);
    expect(discovery.bodyText).toBe("");
    expect(discovery.headers.link).toBe(
      `<${new URL("bdp.json", scope).href}>; rel="service-desc"; type="application/json"`,
    );
    expect(discovery.headers["cache-control"]).toBe("private, no-store");
    expect(discovery.headers["x-bdp-development-limit"]).toBeUndefined();
    context(discovery, "pos-0");
    const mutation = await exchange(
      "create",
      "POST",
      `${scope}operations/create-bead`,
      { "content-type": "application/json", "idempotency-key": "schema-valid" },
      { id: "beads/a", type: task, properties: { title: "café" } },
    );
    expect(mutation.status).toBe(200);
    const receipt = checked(mutation.bodyText, "mutationReceipt");
    expect(receipt).toMatchObject({
      status: "completed",
      detail: "available",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
      next: null,
    });
    const results = receipt.results as unknown[];
    expect(results).toHaveLength(1);
    const created = record(results[0]);
    expect(created).toMatchObject({ operationIndex: 0, outcome: "created" });
    expect(record(created.resource)).toMatchObject({
      id: `${scope}beads/a`,
      type: task,
      properties: { title: "café" },
      metadata: {},
    });
    context(mutation, "pos-1");
    const after = await exchange("root-after", "GET", observedRoot);
    exact(after, rootBytes);
    context(after, receipt.effectPosition as string);
    expect(requests).toBe(14);
    expect(observations.map((o) => o.label)).toEqual([
      "types",
      "type",
      "root",
      "referenced",
      "head",
      "unacceptable",
      "not-modified",
      "precondition",
      "unknown",
      "unauthenticated",
      "method",
      "discovery",
      "create",
      "root-after",
    ]);
    expect(new Set(observations.map((o) => `${o.method} ${o.url}`))).toEqual(
      new Set([
        ...routes.map((r) => `${r.method} ${r.url}`),
        ...[...grants].map((url) => `GET ${url}`),
      ]),
    );
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    if (child) {
      try {
        await child.close();
      } catch (error) {
        failures.push(error);
      }
      sessions.push({
        pid: child.child.pid,
        exit: child.child.exitCode,
        signal: child.child.signalCode,
      });
      if (child.child.exitCode === null && child.child.signalCode === null)
        failures.push(new Error("installed schema child remains active"));
    }
    clearTimeout(timer);
    let directoryAbsent: boolean | undefined;
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    try {
      directoryAbsent = !existsSync(directory);
      if (!directoryAbsent) failures.push(new Error("schema store remains"));
    } catch (error) {
      failures.push(error);
    }
    if (controller.signal.aborted && !failures.includes(controller.signal.reason))
      failures.push(controller.signal.reason);
    console.log(
      JSON.stringify({
        observation: "private-installed-local-schemas",
        declaredSourceCommit,
        workspaceDirty,
        entry,
        entrySha256,
        binding,
        routes,
        observedGrants: [...grants],
        artifactBytes: artifacts.schemas.map((a) => ({
          uri: a.retrievalUri,
          bytes: Buffer.byteLength(a.utf8),
          sha256: hash(a.utf8),
        })),
        sessions,
        attemptedRequests: requests,
        completedResponses: observations,
        directoryAbsent,
        outcome: failures.length ? "failed" : "passed",
        claimEligible: false,
        evidenceRetention:
          "Response fingerprints/context only; full wire/body bytes are not retained",
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "installed schema or cleanup failed");
}, 120000);

// Separate minimum cohorts: the historical fourteen-request traversal above is unchanged.
type G09InstalledRow = {
  ordinal: number;
  label: string;
  method: string;
  url: string;
  settled: boolean;
  received: boolean;
  validated: boolean;
  status: number | null;
  responseHeaders: Record<string, string> | null;
  requestBodyBytes: number;
  requestBodySha256: string;
  bodyText: string | null;
  bodyOctets: number | null;
  wireBase64: string | null;
  wireSha256: string | null;
  writeState: string | null;
  errorCategory: string | null;
};
async function g09InstalledBound<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("G09 installed lifetime exceeded")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function g09InstalledCase(
  id: string,
  maximum: number,
  run: (
    exchange: (
      label: string,
      method: "GET" | "HEAD" | "POST",
      url: string,
      headers?: Record<string, string>,
      input?: unknown,
      wrongCredential?: boolean,
    ) => Promise<Awaited<ReturnType<ReturnType<typeof createRawHttpExchangeExecutor>>>>,
  ) => Promise<void>,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-g09-installed-"));
  const token = randomBytes(32).toString("base64url");
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts,
    credentials: [{ token, principal: "writer", canMutate: true }],
  };
  const controller = new AbortController(),
    failures: unknown[] = [],
    rows: G09InstalledRow[] = [],
    pending = new Set<Promise<unknown>>();
  const started = performance.now();
  const timer = setTimeout(() => controller.abort(new Error("G09 installed work deadline")), 45000);
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let launching: Promise<Awaited<ReturnType<typeof launchInstalledTransaction>>> | undefined;
  let readyValidated = false,
    closePromiseSettled = false,
    closeSucceeded = false,
    directoryAbsent: boolean | null = null;
  let exit: { code: number | null; signal: string | null } | null = null;
  let close: { code: number | null; signal: string | null } | null = null;
  let closed: Promise<void> | undefined;
  const routes: { method: "GET" | "HEAD" | "POST"; url: string }[] = [
    { method: "GET", url: rootSchema },
    { method: "HEAD", url: rootSchema },
    { method: "GET", url: referencedSchema },
    { method: "HEAD", url: referencedSchema },
    { method: "POST", url: rootSchema },
    { method: "POST", url: `${scope}operations/create-bead` },
    { method: "GET", url: rootSchema + "?x=1" },
    { method: "GET", url: `${scope}schemas/unknown` },
    { method: "GET", url: `${scope}beads/missing` },
    { method: "HEAD", url: `${scope}links/missing?view=properties` },
  ];
  const exchange = (
    label: string,
    method: "GET" | "HEAD" | "POST",
    url: string,
    headers: Record<string, string> = {},
    input?: unknown,
    wrongCredential = false,
  ) => {
    if (
      !child ||
      rows.length >= maximum ||
      !routes.some((r) => r.method === method && r.url === url)
    )
      throw new Error("unbound G09 installed request");
    controller.signal.throwIfAborted();
    const bodyBytes = input === undefined ? undefined : Buffer.from(JSON.stringify(input));
    const row: G09InstalledRow = {
      ordinal: rows.length + 1,
      label,
      method,
      url,
      settled: false,
      received: false,
      validated: false,
      status: null,
      responseHeaders: null,
      requestBodyBytes: bodyBytes?.length ?? 0,
      requestBodySha256: hash(bodyBytes ?? new Uint8Array()),
      bodyText: null,
      bodyOctets: null,
      wireBase64: null,
      wireSha256: null,
      writeState: null,
      errorCategory: null,
    };
    rows.push(row);
    const address = new URL(child.ready.listenUrl as string);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "writer",
          credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
          resolveCredentials: () => ({
            authorization: `Bearer ${wrongCredential ? "wrong-credential" : token}`,
          }),
        },
      },
    );
    const task = execute({
      method,
      url,
      signal: controller.signal,
      credentialRef: "writer",
      raw: {
        headerLines: Object.entries(headers).map(([name, value]) => ({ name, value })),
        ...(bodyBytes ? { bodyBytes } : {}),
      },
    }).then(
      (response) => {
        row.settled = true;
        row.received = true;
        row.status = response.status;
        row.responseHeaders = { ...response.headers };
        row.bodyText = response.bodyText;
        row.bodyOctets = response.bodyOctets ?? null;
        row.writeState = response.exactRequest?.writeState ?? null;
        row.wireBase64 = response.wireResponseBytes
          ? Buffer.from(response.wireResponseBytes).toString("base64")
          : null;
        row.wireSha256 = response.wireResponseBytes ? hash(response.wireResponseBytes) : null;
        // Retain the actual result before assertions, including malformed/partial evidence.
        expect(row.writeState).toBe("complete");
        expect(
          response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
        ).toBe("reference.invalid");
        expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
        expect(Number.isSafeInteger(response.bodyOctets)).toBe(true);
        expect(response.bodyOctets).toBeGreaterThanOrEqual(0);
        expect(response.headers["x-bdp-development"]).toBe("non-attesting");
        return response;
      },
      (error: unknown) => {
        row.settled = true;
        row.errorCategory = "exchange-failed";
        throw error;
      },
    );
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };
  try {
    await g09InstalledBound(
      (async () => {
        launching = launchInstalledTransaction(entry, configuration, controller.signal).then(
          (acquired) => {
            child = acquired;
            acquired.child.once("exit", (code, signal) => {
              exit = { code, signal };
            });
            closed = new Promise<void>((resolve) =>
              acquired.child.once("close", (code, signal) => {
                close = { code, signal };
                resolve();
              }),
            );
            return acquired;
          },
        );
        await launching;
        if (!child) throw new Error("G09 installed acquisition unavailable");
        installedTransactionBinding(child.ready, declaredSourceCommit, fixture);
        readyValidated = true;
        await run(exchange);
        expect(rows).toHaveLength(maximum);
        for (const row of rows) row.validated = true;
        controller.signal.throwIfAborted();
      })(),
      45000,
    );
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    clearTimeout(timer);
    try {
      await g09InstalledBound(
        (async () => {
          if (launching) await launching.catch(() => {});
          await Promise.allSettled([...pending]);
          if (!child || !closed) throw new Error("G09 child ownership unavailable");
          try {
            await child.close();
            closeSucceeded = true;
          } finally {
            closePromiseSettled = true;
          }
          await closed;
          expect(exit).toEqual({ code: 0, signal: null });
          expect(close).toEqual({ code: 0, signal: null });
          expect(pending.size).toBe(0);
        })(),
        10000,
      );
      rmSync(directory, { recursive: true });
      directoryAbsent = !existsSync(directory);
      expect(directoryAbsent).toBe(true);
    } catch (error) {
      failures.push(error);
    }
    // Failed/unknown close retains its store. No expected process fact is fabricated.
    console.log(
      JSON.stringify({
        observation: id,
        declaredSourceCommit,
        workspaceDirty,
        entry,
        entrySha256,
        ready: child
          ? {
              scope: child.ready.scope ?? null,
              profile: child.ready.profile ?? null,
              history: child.ready.history ?? null,
              authorityMode: child.ready.authorityMode ?? null,
              claimEligible: child.ready.claimEligible ?? null,
              payloadIdentity: child.ready.payloadIdentity ?? null,
              runtimeConfigurationIdentity: child.ready.runtimeConfigurationIdentity ?? null,
              listenUrl: child.ready.listenUrl ?? null,
            }
          : null,
        readyValidated,
        authenticationIdentityRetention:
          "not emitted; actual credential binding is source-attested",
        artifactBytes: artifacts.schemas.map((a) => ({
          uri: a.retrievalUri,
          bytes: Buffer.byteLength(a.utf8),
          sha256: hash(a.utf8),
        })),
        rows,
        attemptedRequests: rows.length,
        completedResponses: rows.filter((r) => r.received && r.settled && r.errorCategory === null)
          .length,
        pending: pending.size,
        session: {
          pid: child?.child.pid ?? null,
          exit,
          close,
          closePromiseSettled,
          closeSucceeded,
          stdoutEnded: child?.child.stdout?.readableEnded ?? null,
          stderrEnded: child?.child.stderr?.readableEnded ?? null,
        },
        directoryAbsent,
        elapsedMs: performance.now() - started,
        outcome: failures.length ? "failed" : "passed",
        failureCount: failures.length,
        claimEligible: false,
        evidenceRetention:
          "Full actual returned wire/body bytes; unavailable partial exchange evidence remains null; child stdout/stderr bytes are not retained",
      }),
    );
  }
  if (failures.length) throw new AggregateError(failures, "G09 installed work and cleanup failed");
}
type G09Response = Awaited<ReturnType<ReturnType<typeof createRawHttpExchangeExecutor>>>;
function g09InstalledMinimum(response: G09Response, position = "pos-0") {
  const epoch = response.headers["bdp-scope-epoch"],
    view = response.headers["bdp-authorization-view"];
  if (typeof epoch !== "string" || typeof view !== "string")
    throw new Error("G09 installed context unavailable");
  return {
    "bdp-scope-epoch": epoch,
    "bdp-authorization-view": view,
    "bdp-minimum-scope-position": position,
  };
}
function g09InstalledContext(response: G09Response, baseline: G09Response, position: string) {
  expect(g09InstalledMinimum(response, position)).toEqual(g09InstalledMinimum(baseline, position));
  expect(response.headers["bdp-scope-position"]).toBe(position);
}
function g09InstalledExact(response: G09Response, bytes: string, head = false) {
  expect(response.status).toBe(200);
  expect(response.bodyText).toBe(head ? "" : bytes);
  expect(response.bodyOctets).toBe(head ? 0 : Buffer.byteLength(bytes));
  expect(response.headers["content-length"]).toBe(String(Buffer.byteLength(bytes)));
  expect(response.headers["content-type"]).toBe("application/json");
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers.vary).toBe("Accept");
  expect(response.headers.etag).toBeUndefined();
  expect(response.headers["last-modified"]).toBeUndefined();
}
const g09ProblemValidator = ajv.compile({ $ref: `${schema.$id}#/$defs/transactionalProblem` });
function g09InstalledProblem(response: G09Response, status: number, code: string, head = false) {
  expect(response.status).toBe(status);
  expect(response.headers["content-type"]).toBe("application/problem+json");
  if (head) {
    expect(response.bodyText).toBe("");
    expect(response.bodyOctets).toBe(0);
    expect(Number(response.headers["content-length"])).toBeGreaterThan(0);
  } else {
    const value = record(JSON.parse(response.bodyText));
    expect(g09ProblemValidator(value), JSON.stringify(g09ProblemValidator.errors)).toBe(true);
    expect(value).toMatchObject({ status, code });
  }
  if (status === 503) expect(response.headers["retry-after"]).toBe("1");
}
it("G09-I01 installed exact schema current minimum", async () => {
  await g09InstalledCase("G09-I01", 14, async (exchange) => {
    const baseline = await exchange("root", "GET", rootSchema);
    g09InstalledExact(baseline, rootBytes);
    expect(baseline.headers["bdp-scope-position"]).toBe("pos-0");
    const referenced = await exchange("ref", "GET", referencedSchema);
    g09InstalledExact(referenced, referencedBytes);
    g09InstalledContext(referenced, baseline, "pos-0");
    const mutation = await exchange(
      "create",
      "POST",
      `${scope}operations/create-bead`,
      { "content-type": "application/json", "idempotency-key": "g09-create" },
      { id: "beads/g09", type: task, properties: { title: "café" } },
    );
    expect(mutation.status).toBe(200);
    expect(checked(mutation.bodyText, "mutationReceipt")).toMatchObject({
      status: "completed",
      detail: "available",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
      next: null,
    });
    g09InstalledContext(mutation, baseline, "pos-1");
    const atZero = g09InstalledMinimum(baseline),
      atOne = g09InstalledMinimum(baseline, "pos-1");
    const known = await exchange("root-min-zero", "GET", rootSchema, atZero);
    g09InstalledExact(known, rootBytes);
    g09InstalledContext(known, baseline, "pos-1");
    const head = await exchange("root-head-min-one", "HEAD", rootSchema, atOne);
    g09InstalledExact(head, rootBytes, true);
    g09InstalledContext(head, baseline, "pos-1");
    const ref = await exchange("ref-min-one", "GET", referencedSchema, atOne);
    g09InstalledExact(ref, referencedBytes);
    g09InstalledContext(ref, baseline, "pos-1");
    const notModified = await exchange("not-modified", "GET", rootSchema, {
      ...atOne,
      "if-none-match": "*",
    });
    expect(notModified.status).toBe(304);
    expect(notModified.bodyText).toBe("");
    expect(notModified.headers["content-length"]).toBeUndefined();
    g09InstalledContext(notModified, baseline, "pos-1");
    const precondition = await exchange("precondition", "HEAD", referencedSchema, {
      ...atOne,
      "if-match": '\"missing\"',
    });
    expect(precondition.status).toBe(412);
    expect(precondition.bodyText).toBe("");
    expect(precondition.headers["content-length"]).toBe("0");
    g09InstalledContext(precondition, baseline, "pos-1");
    const unacceptable = await exchange("unacceptable", "GET", rootSchema, {
      ...atOne,
      accept: "text/plain",
    });
    expect(unacceptable.status).toBe(406);
    expect(unacceptable.bodyText).toBe("");
    g09InstalledContext(unacceptable, baseline, "pos-1");
    const ahead = await exchange("ahead", "GET", rootSchema, {
      ...atOne,
      "bdp-minimum-scope-position": "pos-999",
      "if-none-match": "*",
    });
    g09InstalledProblem(ahead, 503, "catch-up-timeout");
    g09InstalledContext(ahead, baseline, "pos-1");
    const opaque = await exchange("opaque", "GET", rootSchema, {
      ...atOne,
      "bdp-minimum-scope-position": "opaque",
      "if-match": '\"missing\"',
    });
    g09InstalledProblem(opaque, 503, "catch-up-timeout");
    g09InstalledContext(opaque, baseline, "pos-1");
    const epoch = await exchange("foreign-epoch", "HEAD", rootSchema, {
      ...atOne,
      "bdp-scope-epoch": "foreign",
      "bdp-minimum-scope-position": "opaque",
    });
    g09InstalledProblem(epoch, 410, "cursor-expired", true);
    g09InstalledContext(epoch, baseline, "pos-1");
    const view = await exchange("foreign-view", "GET", referencedSchema, {
      ...atOne,
      "bdp-authorization-view": "foreign",
      "bdp-minimum-scope-position": "opaque",
    });
    g09InstalledProblem(view, 409, "foreign-view");
    g09InstalledContext(view, baseline, "pos-1");
    const after = await exchange("root-final", "GET", rootSchema);
    g09InstalledExact(after, rootBytes);
    g09InstalledContext(after, baseline, "pos-1");
  });
}, 60000);
it("G09-I02 installed receiving and exact retrieval membership", async () => {
  await g09InstalledCase("G09-I02", 16, async (exchange) => {
    const baseline = await exchange("root", "GET", rootSchema);
    g09InstalledExact(baseline, rootBytes);
    expect(baseline.headers["bdp-scope-position"]).toBe("pos-0");
    const minimum = g09InstalledMinimum(baseline),
      partial = { "bdp-minimum-scope-position": "pos-0", "if-none-match": "*" },
      comma = { ...minimum, "bdp-minimum-scope-position": "pos-0, pos-1" };
    const partialResponse = await exchange("partial", "GET", rootSchema, partial);
    g09InstalledProblem(partialResponse, 400, "malformed-request");
    const commaValued = await exchange("comma", "GET", rootSchema, comma);
    g09InstalledProblem(commaValued, 400, "malformed-request");
    const headMalformed = await exchange("comma-head", "HEAD", rootSchema, comma);
    g09InstalledProblem(headMalformed, 400, "malformed-request", true);
    const unauthenticated = await exchange(
      "unauthenticated",
      "GET",
      rootSchema,
      partial,
      undefined,
      true,
    );
    g09InstalledProblem(unauthenticated, 401, "unauthenticated");
    const method = await exchange("method", "POST", rootSchema, partial, undefined, true);
    expect(method.status).toBe(405);
    expect(method.headers.allow).toBe("GET, HEAD");
    expect(method.bodyText).toBe("");
    const origin = await exchange("origin", "GET", rootSchema, {
      ...partial,
      origin: "https://other.invalid",
    });
    g09InstalledProblem(origin, 403, "forbidden");
    const unknown = await exchange("unknown", "GET", `${scope}schemas/unknown`);
    g09InstalledProblem(unknown, 404, "resource-not-found");
    const query = await exchange("query", "GET", rootSchema + "?x=1");
    g09InstalledProblem(query, 404, "resource-not-found");
    const queryMinimum = await exchange("query-minimum", "GET", rootSchema + "?x=1", minimum);
    expect(queryMinimum.status).toBe(500);
    expect(queryMinimum.headers["x-bdp-development-limit"]).toBe("minimum-position-route");
    expect(queryMinimum.bodyText).toBe("");
    const head = await exchange("head", "HEAD", rootSchema);
    g09InstalledExact(head, rootBytes, true);
    g09InstalledContext(head, baseline, "pos-0");
    const unknownMinimum = await exchange(
      "unknown-minimum",
      "GET",
      `${scope}schemas/unknown`,
      minimum,
    );
    expect(unknownMinimum.status).toBe(500);
    expect(unknownMinimum.headers["x-bdp-development-limit"]).toBe("minimum-position-route");
    expect(unknownMinimum.bodyText).toBe("");
    const unknownOpaque = await exchange("unknown-opaque", "GET", `${scope}schemas/unknown`, {
      ...minimum,
      "bdp-minimum-scope-position": "opaque",
    });
    expect(unknownOpaque.status).toBe(500);
    expect(unknownOpaque.headers["x-bdp-development-limit"]).toBe("minimum-position");
    expect(unknownOpaque.bodyText).toBe("");
    const bead = await exchange("missing-bead", "GET", `${scope}beads/missing`, {
      ...minimum,
      "bdp-minimum-scope-position": "opaque",
    });
    g09InstalledProblem(bead, 404, "resource-not-found");
    g09InstalledContext(bead, baseline, "pos-0");
    const link = await exchange(
      "missing-link-properties",
      "HEAD",
      `${scope}links/missing?view=properties`,
      { ...minimum, "bdp-minimum-scope-position": "opaque" },
    );
    g09InstalledProblem(link, 404, "resource-not-found", true);
    g09InstalledContext(link, baseline, "pos-0");
    const ref = await exchange("ref-final", "GET", referencedSchema);
    g09InstalledExact(ref, referencedBytes);
    g09InstalledContext(ref, baseline, "pos-0");
    for (const response of [
      partialResponse,
      commaValued,
      headMalformed,
      unauthenticated,
      method,
      origin,
      unknown,
      query,
      queryMinimum,
      unknownMinimum,
      unknownOpaque,
    ]) {
      for (const key of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(response.headers[key]).toBeUndefined();
    }
  });
}, 60000);
