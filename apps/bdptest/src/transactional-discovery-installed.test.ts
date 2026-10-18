/** Private installed discovery and owner observations; no public profile qualification. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  isJsonSchemaDateTime,
  isJsonSchemaUri,
  parseTransactionalDiscovery,
  parseTransactionalOperationDirectory,
  parseTypeDescriptor,
} from "@bdp/protocol";
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
    child: ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("installed discovery override requires explicit source commit");
const source =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const scope = "https://reference.invalid/acme/",
  bead = `${scope}types/bead`,
  schema = `${scope}schemas/n`;
const artifacts = {
  descriptors: [
    {
      retrievalUri: bead,
      utf8: JSON.stringify({
        id: bead,
        name: "Bead",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: schema,
      }),
    },
  ],
  schemas: [
    {
      retrievalUri: schema,
      utf8: JSON.stringify({
        $id: schema,
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
        additionalProperties: false,
      }),
    },
  ],
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
ajv.addSchema(bundle);
const receiptSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceipt` });
const beadSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/currentBeadRecord` });
it("private installed discovery owner regression successor", async () => {
  // Bounded C3 fixture: 45s aggregate, 60s outer, 5s/exchange, launcher 10s.
  // Retained owner regression: six authenticated projections now succeed.
  // This original target-bound callback is not positive cold-client evidence.
  const controller = new AbortController(),
    timer = setTimeout(
      () => controller.abort(new Error("installed discovery boundary deadline")),
      45000,
    );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-discovery-installed-")),
    token = randomBytes(32).toString("base64url");
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let childEvents: ReturnType<typeof d3ObservedChild> | undefined;
  let cleanupKnown = false;
  const observations: {
      method: string;
      url: string;
      status: number;
      bodyOctets: number | undefined;
      bodySha256: string;
      wireSha256: string;
    }[] = [],
    failures: unknown[] = [];
  let session: { pid: number | undefined; exit: number | null } | undefined;
  const targets = new Set(["", "bdp.json", "operations/", "operations/batch", "beads/a"]);
  async function exchange(
    relative: string,
    method: "GET" | "HEAD" | "POST",
    authenticated: boolean,
    expectedStatus: number,
    input?: unknown,
  ) {
    if (!targets.has(relative) || !child) throw new Error("unbound installed discovery request");
    expect(observations.length).toBeLessThan(16);
    const url = `${scope}${relative}`,
      address = new URL(child.ready.listenUrl as string);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        maximumHeaderBytes: 16384,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: authenticated ? "writer" : "anonymous",
          credentialHandles: [
            { id: "writer", headerNames: ["authorization"] },
            { id: "anonymous", headerNames: [] },
          ],
          resolveCredentials: ({ credentialRef }) =>
            credentialRef === "writer" ? { authorization: `Bearer ${token}` } : {},
        },
      },
    );
    const response = await execute({
      method,
      url,
      signal: controller.signal,
      ...(authenticated ? { credentialRef: "writer" } : {}),
      raw: {
        headerLines:
          input === undefined
            ? []
            : [
                { name: "content-type", value: "application/json" },
                { name: "idempotency-key", value: "discovery-create" },
              ],
        ...(input === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(input)) }),
      },
    });
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(
      response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
    ).toBe("reference.invalid");
    if (!response.wireResponseBytes?.length) throw new Error("missing actual wire response");
    expect(response.bodyOctets).toBe(Buffer.byteLength(response.bodyText));
    observations.push({
      method,
      url,
      status: response.status,
      bodyOctets: response.bodyOctets,
      bodySha256: hash(response.bodyText),
      wireSha256: hash(response.wireResponseBytes),
    });
    expect(response.status).toBe(expectedStatus);
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    return response;
  }
  try {
    child = await launchInstalledTransaction(
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
    childEvents = d3ObservedChild(child.child);
    binding = installedTransactionBinding(child.ready, source, fixture);
    expect(child.ready).toMatchObject({
      profile: "transactional",
      history: false,
      claimEligible: false,
    });
    for (const method of ["GET", "HEAD"] as const)
      for (const route of ["", "bdp.json", "operations/"]) {
        const response = await exchange(route, method, true, route === "" ? 204 : 200);
        expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
        if (route === "") {
          expect(response.headers.link).toBe(
            `<${new URL("bdp.json", scope).href}>; rel="service-desc"; type="application/json"`,
          );
          expect(response.bodyText).toBe("");
        } else if (method === "HEAD") expect(response.bodyText).toBe("");
        else if (route === "bdp.json") parseTransactionalDiscovery(JSON.parse(response.bodyText));
        else
          expect(
            Object.keys(parseTransactionalOperationDirectory(JSON.parse(response.bodyText))),
          ).toHaveLength(12);
      }
    for (const route of ["", "bdp.json", "operations/"]) {
      const response = await exchange(route, "GET", false, 401);
      expect(response.headers.link).toBeUndefined();
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(response.headers[name]).toBeUndefined();
      expect(response.bodyText).not.toContain(`${scope}operations/`);
    }
    const input = {
      operations: [{ operation: "createBead", id: "beads/a", type: bead, properties: { n: 1 } }],
    };
    const first = await exchange("operations/batch", "POST", true, 200, input),
      receipt = JSON.parse(first.bodyText);
    expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
    expect(receipt).toMatchObject({
      status: "completed",
      requiredPosition: "pos-1",
      next: null,
      results: [
        {
          operationIndex: 0,
          outcome: "created",
          resource: { id: `${scope}beads/a`, type: bead, properties: { n: 1 } },
        },
      ],
    });
    expect(receipt.results).toHaveLength(1);
    const after = await exchange("beads/a", "GET", true, 200),
      value = JSON.parse(after.bodyText);
    expect(beadSchema(value), JSON.stringify(beadSchema.errors)).toBe(true);
    expect(value).toMatchObject({ id: `${scope}beads/a`, type: bead, properties: { n: 1 } });
    expect(value).toEqual(receipt.results[0].resource);
    const retry = await exchange("operations/batch", "POST", true, 200, input);
    expect(JSON.parse(retry.bodyText)).toEqual(receipt);
    for (const response of [first, after, retry]) {
      expect(response.headers["bdp-scope-epoch"]).toMatch(/\S+/);
      expect(response.headers["bdp-authorization-view"]).toMatch(/\S+/);
      expect(response.headers["bdp-scope-position"]).toBe("pos-1");
    }
    expect(new Set(observations.map((o) => o.url))).toEqual(
      new Set([...targets].map((target) => `${scope}${target}`)),
    );
    expect(observations).toHaveLength(12);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    if (child) {
      try {
        if (!childEvents) failures.push(new Error("missing immediate child terminal observers"));
        else {
          await d3CloseKnown(child, childEvents, performance.now() + 10000);
          cleanupKnown = true;
        }
      } catch (error) {
        failures.push(error);
      } finally {
        session = { pid: child.child.pid, exit: child.child.exitCode };
      }
    }
    clearTimeout(timer);
    if (cleanupKnown) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (controller.signal.aborted && !failures.includes(controller.signal.reason))
      failures.push(controller.signal.reason);
    if (!failures.length) {
      try {
        expect(session?.exit).toBe(0);
        expect(session?.pid).toBeGreaterThan(0);
        expect(() => process.kill(session?.pid as number, 0)).toThrow();
      } catch (error) {
        failures.push(error);
      }
    }
    const report = {
      observation: "private-installed-discovery-owner-regression",
      declaredSourceCommit: source,
      workspaceDirty,
      entry,
      entrySha256: hash(readFileSync(entry)),
      binding,
      session,
      childTerminal: childEvents?.state,
      cleanupKnown,
      directory,
      directoryAbsent: !existsSync(directory),
      exchanges: observations.length,
      completedResponses: observations,
      outcome: failures.length ? "failed" : "passed",
      claimEligible: false,
    };
    const serialized = JSON.stringify(report);
    if (serialized.includes(token)) failures.push(new Error("unsafe observation report"));
    else console.log(serialized);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, "installed discovery boundary or cleanup failed");
}, 60000);

// New D3a callbacks own their input capture, observations and finite cleanup.
const d3OperationNames = [
  "createBead",
  "updateBead",
  "deleteBead",
  "createLink",
  "updateLink",
  "deleteLink",
  "putAlias",
  "deleteAlias",
  "batch",
  "sequence",
  "updateWhere",
  "deleteWhere",
] as const;
type D3InstalledMethod = "GET" | "HEAD" | "POST" | "PUT";
type D3InstalledResponse = {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyOctets?: number;
  wireResponseBytes?: Uint8Array;
};
function d3Object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("D3 expected object");
  return value as Record<string, unknown>;
}
function d3String(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("D3 expected string");
  return value;
}
function d3Array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("D3 expected array");
  return value.map(d3Object);
}
const d3Validators = Object.fromEntries(
  [
    "transactionalDiscovery",
    "transactionalOperationDirectory",
    "typeDescriptor",
    "typesInventory",
    "currentBeadRecord",
    "currentBeadCollection",
    "currentLinkRecord",
    "mutationReceipt",
    "transactionalSequenceResponse",
    "transactionalProblem",
    "snapshotManifest",
    "changefeedPage",
    "eventPage",
  ].map((name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })]),
);
function d3Checked(name: string, value: unknown) {
  const validate = d3Validators[name];
  if (!validate) throw new Error("D3 missing schema");
  expect(validate(value), `D3 schema ${name}`).toBe(true);
  return d3Object(value);
}
function d3Json(response: D3ColdResponse, name?: string) {
  const value: unknown = JSON.parse(response.bodyText);
  return name ? d3Checked(name, value) : d3Object(value);
}
const d3HostedLink = `${scope}types/link`;
const d3Artifacts = {
  descriptors: [
    ...artifacts.descriptors,
    {
      retrievalUri: d3HostedLink,
      utf8: JSON.stringify({
        id: d3HostedLink,
        name: "Link",
        describes: "link",
        conformsTo: [],
        propertiesSchema: schema,
        source: { conformsTo: [bead], external: "opaque" },
        target: { conformsTo: [bead], external: "opaque" },
      }),
    },
  ],
  schemas: artifacts.schemas,
};
function d3Safe(value: unknown, base = scope, allowQuery = false): string {
  const raw = d3String(value);
  if (Buffer.byteLength(raw) > 8192) throw new Error("D3 target bound");
  const url = new URL(raw, base),
    canonical = new URL(scope);
  if (
    url.origin !== canonical.origin ||
    !url.pathname.startsWith(canonical.pathname) ||
    url.username ||
    url.password ||
    url.hash ||
    (!allowQuery && url.search)
  )
    throw new Error("D3 target confinement");
  return url.href;
}
function d3ObservedChild(child: ChildProcess) {
  const closed = Promise.withResolvers<void>();
  void closed.promise.catch(() => {});
  const state = {
    exitSeen: false,
    closeSeen: false,
    code: null as number | null,
    signal: null as NodeJS.Signals | null,
  };
  child.once("exit", (code, signal) => {
    state.exitSeen = true;
    state.code = code;
    state.signal = signal;
  });
  child.once("close", (code, signal) => {
    state.closeSeen = true;
    state.code = code;
    state.signal = signal;
    closed.resolve();
  });
  child.once("error", (error) => closed.reject(error));
  return { state, closed: closed.promise };
}
async function d3Remaining<T>(promise: Promise<T>, end: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const remaining = end - performance.now();
    if (remaining <= 0) throw new Error("D3 cleanup deadline");
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("D3 cleanup deadline")), remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function d3PidAbsent(pid: number | undefined) {
  if (!pid) throw new Error("D3 missing child PID");
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw new Error("D3 child absence unknown", { cause: error });
  }
  throw new Error("D3 child remains present");
}
type D3Session = Awaited<ReturnType<typeof launchInstalledTransaction>>;
async function d3CloseKnown(
  child: D3Session,
  events: ReturnType<typeof d3ObservedChild>,
  end: number,
) {
  await d3Remaining(Promise.all([child.close(), events.closed]), end);
  expect(events.state).toMatchObject({ exitSeen: true, closeSeen: true, code: 0, signal: null });
  d3PidAbsent(child.child.pid);
}
class D3RawTerminal extends Error {
  constructor(
    readonly category: "abort" | "timeout" | "network" | "bound" | "incomplete",
    readonly partialStatus?: number,
  ) {
    super(`D3 local raw ${category}`);
  }
}
async function d3Installed(
  name: string,
  expected: { scheduled: number; completed: number; aborts: number; exact: number; raw: number },
  work: (f: Awaited<ReturnType<typeof d3InstalledFixture>>) => Promise<void>,
) {
  const f = await d3InstalledFixture(name, expected),
    failures: unknown[] = [];
  let workSettled = false,
    cleanupKnown = false;
  const task = Promise.resolve().then(() => work(f));
  void task.then(
    () => {
      workSettled = true;
    },
    () => {
      workSettled = true;
    },
  );
  try {
    expect(f.metadata).toMatchObject({
      scope,
      profile: "transactional",
      history: false,
      claimEligible: false,
    });
    await Promise.race([task, f.cancelled]);
    expect(f.counts).toEqual({
      scheduled: expected.scheduled,
      completed: expected.completed,
      aborts: expected.aborts,
      exact: expected.exact,
      raw: expected.raw,
    });
  } catch (error) {
    failures.push(error);
  } finally {
    f.stopWork();
    const end = performance.now() + 10000;
    try {
      await d3Remaining(
        task.catch(() => {}),
        end,
      );
    } catch (error) {
      failures.push(error);
    }
    try {
      await d3Remaining(Promise.allSettled([...f.pending]), end);
      await d3CloseKnown(f.child, f.events, end);
      cleanupKnown = workSettled && f.pending.size === 0;
      if (!cleanupKnown) failures.push(new Error("D3 unresolved work ownership"));
    } catch (error) {
      failures.push(error);
    }
    if (cleanupKnown) {
      try {
        rmSync(f.directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    const report = {
      observation: name,
      declaredSourceCommit: source,
      workspaceDirty,
      entryLiteral: process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ?? "workspace-dist",
      entry,
      entrySha256: hash(readFileSync(entry)),
      sourceAttribution:
        "externally bound by exact source/archive/consumer/lock/proof; no child attestation",
      metadata: f.metadata,
      counts: f.counts,
      records: f.records,
      child: { pid: f.child.child.pid, ...f.events.state },
      workSettled,
      cleanupKnown,
      pending: f.pending.size,
      directory: f.directory,
      directoryAbsent: !existsSync(f.directory),
      elapsedMs: performance.now() - f.started,
      failureCount: failures.length,
      outcome: failures.length ? "failed" : "passed",
      claimEligible: false,
    };
    const serialized = JSON.stringify(report);
    if (f.tokens.some((value) => serialized.includes(value)))
      failures.push(new Error("D3 unsafe report"));
    else console.log(serialized);
  }
  if (failures.length) throw new AggregateError(failures, "D3 installed witness or cleanup failed");
}
async function d3InstalledFixture(
  name: string,
  expected: { scheduled: number; completed: number; aborts: number; exact: number; raw: number },
) {
  const started = performance.now(),
    controller = new AbortController(),
    cancelled = Promise.withResolvers<never>();
  void cancelled.promise.catch(() => {});
  controller.signal.addEventListener("abort", () => cancelled.reject(controller.signal.reason), {
    once: true,
  });
  const timer = setTimeout(() => controller.abort(new Error("D3 installed work deadline")), 45000);
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-d3-installed-")),
    writer = randomBytes(32).toString("base64url"),
    reader = randomBytes(32).toString("base64url");
  let child: D3Session;
  try {
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts: d3Artifacts,
        credentials: [
          { token: writer, principal: "writer", canMutate: true },
          { token: reader, principal: "reader", canMutate: false },
        ],
      },
      controller.signal,
    );
  } catch (error) {
    clearTimeout(timer);
    controller.abort();
    // Launcher did not return a process handle. Keep evidence; no invented absence.
    console.log(
      JSON.stringify({
        observation: name,
        directory,
        startupOwnership: "unknown",
        outcome: "failed",
        claimEligible: false,
      }),
    );
    throw error;
  }
  const events = d3ObservedChild(child.child);
  const metadata = Object.fromEntries(
    [
      "scope",
      "profile",
      "history",
      "claimEligible",
      "payloadIdentity",
      "artifactIdentity",
      "policyIdentity",
      "authenticationIdentity",
      "runtimeConfigurationIdentity",
      "authorityMode",
    ].map((key) => [key, child.ready[key]]),
  );
  const counts = { scheduled: 0, completed: 0, aborts: 0, exact: 0, raw: 0 },
    records: unknown[] = [];
  const pending = new Set<Promise<unknown>>();
  function track<T>(promise: Promise<T>) {
    pending.add(promise);
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  }
  const credential = (role: string) =>
    role === "writer" ? writer : role === "reader" ? reader : undefined;
  async function send(
    id: string,
    method: D3InstalledMethod,
    value: string,
    status: number,
    options: {
      body?: unknown;
      key?: string;
      role?: "writer" | "reader" | "anonymous";
      fields?: readonly { name: string; value: string }[];
    } = {},
  ) {
    controller.signal.throwIfAborted();
    if (++counts.scheduled > expected.scheduled) throw new Error("D3 request inventory bound");
    counts.exact++;
    const url = d3Safe(value, scope, true),
      role = options.role ?? "writer",
      dial = new URL(d3String(child.ready.listenUrl));
    const fields = [
      ...(options.fields ?? []),
      ...(options.body === undefined ? [] : [{ name: "content-type", value: "application/json" }]),
      ...(options.key === undefined ? [] : [{ name: "idempotency-key", value: options.key }]),
    ];
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: dial.hostname, port: Number(dial.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        maximumHeaderBytes: 16384,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: role,
          credentialHandles: [
            { id: "writer", headerNames: ["authorization"] },
            { id: "reader", headerNames: ["authorization"] },
            { id: "anonymous", headerNames: [] },
          ],
          resolveCredentials: ({ credentialRef }) => {
            const token = credential(credentialRef);
            return token === undefined ? {} : { authorization: `Bearer ${token}` };
          },
        },
      },
    );
    const task = execute({
      method,
      url,
      signal: controller.signal,
      credentialRef: role,
      raw: {
        headerLines: fields,
        ...(options.body === undefined
          ? {}
          : { bodyBytes: Buffer.from(JSON.stringify(options.body)) }),
      },
    });
    try {
      const response = await track(task);
      counts.completed++;
      records.push({
        id,
        transport: "public-exact",
        method,
        url,
        credential: role,
        fieldOccurrences: fields,
        status: response.status,
        headers: response.headers,
        bodyOctets: response.bodyOctets,
        bodySha256: hash(response.bodyText),
        wireSha256: response.wireResponseBytes ? hash(response.wireResponseBytes) : undefined,
        requestWriteState: response.exactRequest?.writeState,
      });
      expect(response.status, id).toBe(status);
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(response.bodyOctets).toBe(Buffer.byteLength(response.bodyText));
      if (method === "HEAD" || status === 204 || status === 304) expect(response.bodyText).toBe("");
      return response;
    } catch (error) {
      records.push({
        id,
        transport: "public-exact",
        terminal: "rejected",
        errorClass: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    }
  }
  function localRaw(
    id: string,
    url: string,
    options: { host?: string; role: "writer" | "anonymous"; fields?: readonly [string, string][] },
  ) {
    controller.signal.throwIfAborted();
    if (++counts.scheduled > expected.scheduled)
      throw new Error("D3 local request inventory bound");
    counts.raw++;
    const target = new URL(d3Safe(url)),
      dial = new URL(d3String(child.ready.listenUrl)),
      socket = connect({ host: dial.hostname, port: Number(dial.port) });
    const socketClosed = Promise.withResolvers<void>();
    track(socketClosed.promise);
    socket.once("close", () => socketClosed.resolve());
    const written = Promise.withResolvers<void>();
    void written.promise.catch(() => {});
    const state = {
      settled: false,
      responseStarted: false,
      written: false,
      closeRequested: false,
      writeAtMs: undefined as number | undefined,
      closeRequestedAtMs: undefined as number | undefined,
      responseAtMs: undefined as number | undefined,
    };
    let bytes = Buffer.alloc(0),
      ended = false,
      terminalRecorded = false;
    const recordTerminal = (terminal: string, partialStatus?: number) => {
      if (terminalRecorded) return;
      terminalRecorded = true;
      records.push({
        id,
        transport: "callback-local-raw",
        method: "GET",
        url: target.href,
        credential: options.role,
        state: { ...state },
        terminal,
        partialStatus,
        partialWireAvailable: bytes.length > 0,
        actualWireOctets: bytes.length,
        actualWireSha256: bytes.length ? hash(bytes) : undefined,
      });
    };
    const response = track(
      new Promise<D3InstalledResponse>((resolve, reject) => {
        const partialStatus = () => {
          const match = /^HTTP\/1\.1 (\d{3}) /.exec(bytes.subarray(0, 32).toString("latin1"));
          return match ? Number(match[1]) : undefined;
        };
        const fail = (error: D3RawTerminal) => {
          if (!state.settled) {
            state.settled = true;
            written.reject(error);
            recordTerminal(error.category, error.partialStatus);
            reject(error);
          }
          socket.destroy();
        };
        socket.setTimeout(5000, () => fail(new D3RawTerminal("timeout", partialStatus())));
        socket.on("error", () =>
          fail(
            new D3RawTerminal(
              state.closeRequested && state.written ? "abort" : "network",
              partialStatus(),
            ),
          ),
        );
        socket.on("data", (chunk: Buffer) => {
          state.responseStarted = true;
          state.responseAtMs ??= performance.now() - started;
          if (bytes.length + chunk.length > 163840) {
            fail(new D3RawTerminal("bound", partialStatus()));
            return;
          }
          bytes = Buffer.concat([bytes, chunk]);
          const split = bytes.indexOf("\r\n\r\n");
          if (
            (split < 0 && bytes.length > 16384) ||
            (split >= 0 && split + 4 > 16384) ||
            (split >= 0 && bytes.length - split - 4 > 131072)
          )
            fail(new D3RawTerminal("bound", partialStatus()));
        });
        socket.once("end", () => {
          ended = true;
          if (state.settled) return;
          try {
            const split = bytes.indexOf("\r\n\r\n"),
              status = partialStatus();
            if (split < 0 || status === undefined) throw new Error("D3 incomplete raw headers");
            const headers: Record<string, string> = {};
            for (const line of bytes.subarray(0, split).toString("latin1").split("\r\n").slice(1)) {
              const colon = line.indexOf(":");
              if (colon <= 0) throw new Error("D3 raw invalid header");
              headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
            }
            const bodyText = bytes.subarray(split + 4).toString("utf8");
            if (Buffer.byteLength(bodyText) !== Number(headers["content-length"]))
              throw new Error("D3 incomplete raw entity");
            state.settled = true;
            counts.completed++;
            recordTerminal("response", status);
            resolve({
              status,
              headers,
              bodyText,
              bodyOctets: Buffer.byteLength(bodyText),
              wireResponseBytes: bytes,
            });
          } catch {
            fail(
              new D3RawTerminal(
                state.closeRequested && state.written ? "abort" : "incomplete",
                partialStatus(),
              ),
            );
          }
        });
        socket.once("close", () => {
          if (!ended && !state.settled)
            fail(
              new D3RawTerminal(
                state.closeRequested && state.written ? "abort" : "incomplete",
                partialStatus(),
              ),
            );
        });
        socket.once("connect", () => {
          const token = credential(options.role),
            fields = options.fields ?? [];
          const request = `GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${options.host ?? target.host}\r\nConnection: close\r\nContent-Length: 0\r\n${token ? `Authorization: Bearer ${token}\r\n` : ""}${fields.map(([key, value]) => `${key}: ${value}\r\n`).join("")}\r\n`;
          if (Buffer.byteLength(request) > 16384) {
            fail(new D3RawTerminal("bound"));
            return;
          }
          socket.write(request, (error) => {
            if (error) {
              fail(new D3RawTerminal("network"));
              return;
            }
            state.written = true;
            state.writeAtMs = performance.now() - started;
            written.resolve();
          });
        });
        const abort = () => {
          if (!state.settled) fail(new D3RawTerminal("timeout", partialStatus()));
        };
        controller.signal.addEventListener("abort", abort, { once: true });
        socket.once("close", () => controller.signal.removeEventListener("abort", abort));
      }),
    );
    void response.catch(() => {});
    return {
      response,
      written: written.promise,
      state,
      requestClose: () => {
        state.closeRequested = true;
        state.closeRequestedAtMs = performance.now() - started;
        return child.close();
      },
    };
  }
  return {
    canonicalScope: scope,
    child,
    events,
    directory,
    metadata,
    counts,
    pending,
    records,
    started,
    tokens: [writer, reader],
    send,
    localRaw,
    stopWork: () => {
      clearTimeout(timer);
      controller.abort(new Error("D3 work ended"));
    },
    cancelled: cancelled.promise,
    expectedAbort: () => {
      counts.aborts++;
    },
  };
}
type D3Fixture = Awaited<ReturnType<typeof d3InstalledFixture>>;
type D3ColdResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  bodyText: string;
}>;
type D3ColdClient = Readonly<{
  canonicalScope: string;
  send: (...args: Parameters<D3Fixture["send"]>) => Promise<D3ColdResponse>;
}>;
function d3InstalledCold(
  name: string,
  expected: Parameters<typeof d3Installed>[1],
  work: (client: D3ColdClient) => Promise<void>,
) {
  return d3Installed(name, expected, (fixture) => {
    // Only this client and detached received response fields cross the cold boundary.
    const client: D3ColdClient = Object.freeze({
      canonicalScope: fixture.canonicalScope,
      send: async (...args: Parameters<D3Fixture["send"]>): Promise<D3ColdResponse> => {
        const response = await fixture.send(...args);
        return Object.freeze({
          status: response.status,
          headers: Object.freeze({ ...response.headers }),
          bodyText: response.bodyText,
        });
      },
    });
    return work(client);
  });
}
function d3Context(response: D3ColdResponse, epoch: string, view: string, position: string) {
  expect(response.headers["bdp-scope-epoch"]).toBe(epoch);
  expect(response.headers["bdp-authorization-view"]).toBe(view);
  expect(response.headers["bdp-scope-position"]).toBe(position);
}
function d3Private(response: D3InstalledResponse) {
  for (const name of [
    "link",
    "etag",
    "location",
    "bdp-scope-epoch",
    "bdp-authorization-view",
    "bdp-scope-position",
  ])
    expect(response.headers[name]).toBeUndefined();
}
async function d3Navigate(f: D3ColdClient) {
  const probe = await f.send("N1", "GET", f.canonicalScope, 204),
    link = d3String(probe.headers.link);
  expect(link).toBe(
    `<${new URL("bdp.json", f.canonicalScope).href}>; rel="service-desc"; type="application/json"`,
  );
  expect(probe.headers["cache-control"]).toBe("private, no-store");
  const match = /^<([^>]+)>; rel="service-desc"; type="application\/json"$/.exec(link);
  if (!match) throw new Error("D3 actual service description Link missing");
  const descriptorUrl = d3Safe(match[1]);
  const response = await f.send("N2", "GET", descriptorUrl, 200);
  const descriptor = d3Object(parseTransactionalDiscovery(JSON.parse(response.bodyText)));
  expect(descriptor).toMatchObject({
    bdpVersion: "0",
    profile: "transactional",
    scope,
    headPosition: "pos-0",
  });
  const epoch = d3String(descriptor.scopeEpoch),
    view = d3String(descriptor.authorizationView);
  d3Context(response, epoch, view, "pos-0");
  d3Context(probe, epoch, view, "pos-0");
  const directoryUrl = d3Safe(descriptor.operations, descriptorUrl),
    directoryResponse = await f.send("N3", "GET", directoryUrl, 200);
  const directory = d3Object(
    parseTransactionalOperationDirectory(JSON.parse(directoryResponse.bodyText)),
  );
  expect(Object.keys(directory).sort()).toEqual([...d3OperationNames].sort());
  const targets = Object.fromEntries(
    d3OperationNames.map((name) => [name, d3Safe(directory[name], directoryUrl)]),
  ) as Record<(typeof d3OperationNames)[number], string>;
  for (const name of [
    "beads",
    "links",
    "types",
    "aliases",
    "receipts",
    "snapshot",
    "changes",
    "events",
  ])
    d3Safe(descriptor[name], descriptorUrl);
  d3Context(directoryResponse, epoch, view, "pos-0");
  return {
    descriptor,
    descriptorUrl,
    directoryUrl,
    directoryLength: Buffer.byteLength(directoryResponse.bodyText),
    targets,
    epoch,
    view,
    link,
  };
}
type D3Navigation = Awaited<ReturnType<typeof d3Navigate>>;
async function d3Types(f: D3ColdClient, nav: D3Navigation) {
  const inventory = d3Json(
      await f.send("T1", "GET", d3Safe(nav.descriptor.types), 200),
      "typesInventory",
    ),
    summaries = d3Array(inventory.items);
  expect(inventory.next).toBeNull();
  expect(summaries).toHaveLength(2);
  const beadSummary = summaries.filter((item) => item.describes === "bead"),
    linkSummary = summaries.filter((item) => item.describes === "link");
  expect(beadSummary).toHaveLength(1);
  expect(linkSummary).toHaveLength(1);
  const beadId = d3Safe(beadSummary[0]!.id),
    linkId = d3Safe(linkSummary[0]!.id);
  const B = d3Object(
    parseTypeDescriptor(JSON.parse((await f.send("T2", "GET", beadId, 200)).bodyText)),
  );
  const L = d3Object(
    parseTypeDescriptor(JSON.parse((await f.send("T3", "GET", linkId, 200)).bodyText)),
  );
  expect(B).toMatchObject({ id: beadId, describes: "bead" });
  expect(L).toMatchObject({ id: linkId, describes: "link" });
  // Schema navigation uses received IDs only; provisioning retrieval URIs are private.
  expect(d3Safe(L.propertiesSchema)).toBe(d3Safe(B.propertiesSchema));
  expect(B.conformsTo).toEqual([]);
  expect(L.conformsTo).toEqual([]);
  for (const endpoint of [L.source, L.target])
    expect(endpoint).toMatchObject({ conformsTo: [beadId], external: "opaque" });
  return { bead: beadId, link: linkId };
}
async function d3Command(
  f: D3ColdClient,
  nav: D3Navigation,
  name: (typeof d3OperationNames)[number],
  id: string,
  input: unknown,
  position: string,
) {
  const response = await f.send(id, "POST", nav.targets[name], 200, {
    body: input,
    key: `cold-${id}`,
  });
  const receipt = d3Json(response, "mutationReceipt");
  expect(receipt).toMatchObject({ status: "completed", requiredPosition: position, next: null });
  d3Context(response, nav.epoch, nav.view, position);
  const receiptUrl = d3Safe(receipt.id),
    rootUrl = d3Safe(nav.descriptor.receipts);
  if (!receiptUrl.startsWith(rootUrl)) throw new Error("D3 actual receipt outside discovered root");
  const retained = await f.send(`${id}-receipt`, "GET", receiptUrl, 200);
  expect(d3Json(retained, "mutationReceipt")).toEqual(receipt);
  d3Context(retained, nav.epoch, nav.view, position);
  return receipt;
}
function d3Only(receipt: Record<string, unknown>) {
  const results = d3Array(receipt.results);
  expect(results).toHaveLength(1);
  return results[0]!;
}
function d3Resource(
  result: Record<string, unknown>,
  kind: "bead" | "link",
  type: string,
  n: number,
  outcome: string,
) {
  expect(result.outcome).toBe(outcome);
  expect(result.operationIndex).toBe(0);
  const resource = d3Checked(
    kind === "bead" ? "currentBeadRecord" : "currentLinkRecord",
    result.resource,
  );
  expect(resource).toMatchObject({ type, properties: { n } });
  d3Safe(resource.id);
  d3String(resource.revision);
  return resource;
}
async function d3After(
  f: D3ColdClient,
  id: string,
  resource: Record<string, unknown>,
  kind: "bead" | "link",
) {
  const response = await f.send(id, "GET", d3Safe(resource.id), 200);
  expect(d3Json(response, kind === "bead" ? "currentBeadRecord" : "currentLinkRecord")).toEqual(
    resource,
  );
}
function d3Deleted(
  result: Record<string, unknown>,
  resource: Record<string, unknown>,
  kind: string,
) {
  expect(result).toEqual({
    operationIndex: 0,
    outcome: "deleted",
    deleted: {
      resourceKind: kind,
      resource: { id: resource.id, type: resource.type, revision: resource.revision },
    },
  });
}
async function d3Missing(f: D3ColdClient, id: string, url: string) {
  const response = await f.send(id, "GET", url, 404);
  expect(d3Json(response, "transactionalProblem").code).toBe("resource-not-found");
  expect(response.headers.location).toBeUndefined();
}
async function d3FinalHeads(f: D3ColdClient, nav: D3Navigation, position: string) {
  const refreshed = await f.send("refresh-descriptor", "GET", nav.descriptorUrl, 200),
    body = d3Object(parseTransactionalDiscovery(JSON.parse(refreshed.bodyText)));
  expect(body).toMatchObject({
    scopeEpoch: nav.epoch,
    authorizationView: nav.view,
    headPosition: position,
  });
  expect(body.headPosition).not.toBe(nav.descriptor.headPosition);
  d3Context(refreshed, nav.epoch, nav.view, position);
  const descriptor = await f.send("head-descriptor", "HEAD", nav.descriptorUrl, 200),
    directory = await f.send("head-directory", "HEAD", nav.directoryUrl, 200),
    probe = await f.send("head-scope", "HEAD", scope, 204);
  expect(descriptor.headers["content-length"]).toBe(String(Buffer.byteLength(refreshed.bodyText)));
  expect(directory.headers["content-length"]).toBe(String(nav.directoryLength));
  expect(probe.headers.link).toBe(nav.link);
  expect(probe.headers["cache-control"]).toBe("private, no-store");
  for (const response of [descriptor, directory, probe])
    d3Context(response, nav.epoch, nav.view, position);
}
it("private installed cold resource-alias", async () => {
  await d3InstalledCold(
    "private installed cold resource-alias",
    { scheduled: 43, completed: 43, aborts: 0, exact: 43, raw: 0 },
    async (f) => {
      const nav = await d3Navigate(f),
        types = await d3Types(f, nav);
      // These identifiers are client choices under received collection roots.
      const aId = new URL("a", d3Safe(nav.descriptor.beads)).href,
        bId = new URL("b", d3Safe(nav.descriptor.beads)).href,
        lId = new URL("l", d3Safe(nav.descriptor.links)).href;
      const createA = { id: aId, type: types.bead, properties: { n: 1 } };
      const first = await d3Command(
        f,
        nav,
        "createBead",
        "resource-alias-create-a",
        createA,
        "pos-1",
      );
      const a = d3Resource(d3Only(first), "bead", types.bead, 1, "created");
      expect(a.id).toBe(aId);
      await d3After(f, "create-a-after", a, "bead");
      const b = d3Resource(
        d3Only(
          await d3Command(
            f,
            nav,
            "createBead",
            "resource-alias-create-b",
            { id: bId, type: types.bead, properties: { n: 2 } },
            "pos-2",
          ),
        ),
        "bead",
        types.bead,
        2,
        "created",
      );
      expect(b.id).toBe(bId);
      await d3After(f, "create-b-after", b, "bead");
      const updatedA = d3Resource(
        d3Only(
          await d3Command(
            f,
            nav,
            "updateBead",
            "resource-alias-update-a",
            { bead: a.id, propertiesChange: [{ op: "replace", path: "/n", value: 10 }] },
            "pos-3",
          ),
        ),
        "bead",
        types.bead,
        10,
        "updated",
      );
      expect(updatedA.id).toBe(a.id);
      expect(updatedA.revision).not.toBe(a.revision);
      await d3After(f, "update-a-after", updatedA, "bead");
      const l = d3Resource(
        d3Only(
          await d3Command(
            f,
            nav,
            "createLink",
            "resource-alias-create-l",
            { id: lId, type: types.link, source: a.id, target: b.id, properties: { n: 1 } },
            "pos-4",
          ),
        ),
        "link",
        types.link,
        1,
        "created",
      );
      expect(l).toMatchObject({ id: lId, source: a.id, target: b.id });
      await d3After(f, "create-l-after", l, "link");
      const updatedL = d3Resource(
        d3Only(
          await d3Command(
            f,
            nav,
            "updateLink",
            "resource-alias-update-l",
            { link: l.id, propertiesChange: [{ op: "replace", path: "/n", value: 11 }] },
            "pos-5",
          ),
        ),
        "link",
        types.link,
        11,
        "updated",
      );
      expect(updatedL).toMatchObject({ id: l.id, source: a.id, target: b.id });
      expect(updatedL.revision).not.toBe(l.revision);
      await d3After(f, "update-l-after", updatedL, "link");
      const alias = new URL("work", d3Safe(nav.descriptor.aliases)).href;
      expect(
        d3Only(
          await d3Command(
            f,
            nav,
            "putAlias",
            "resource-alias-put-alias",
            { alias, target: a.id },
            "pos-5",
          ),
        ),
      ).toEqual({ operationIndex: 0, outcome: "created", alias, target: a.id });
      const redirect = await f.send("alias-after", "GET", alias, 307);
      expect(redirect.headers.location).toBe(a.id);
      expect(
        d3Json(
          await f.send("alias-follow", "GET", d3Safe(redirect.headers.location), 200),
          "currentBeadRecord",
        ),
      ).toEqual(updatedA);
      expect(
        d3Only(
          await d3Command(f, nav, "deleteAlias", "resource-alias-delete-alias", { alias }, "pos-5"),
        ),
      ).toEqual({ operationIndex: 0, outcome: "deleted", alias });
      await d3Missing(f, "alias-missing", alias);
      for (const [id, operation, field, resource, kind, position] of [
        ["delete-l", "deleteLink", "link", updatedL, "link", "pos-6"],
        ["delete-b", "deleteBead", "bead", b, "bead", "pos-7"],
        ["delete-a", "deleteBead", "bead", updatedA, "bead", "pos-8"],
      ] as const) {
        d3Deleted(
          d3Only(
            await d3Command(
              f,
              nav,
              operation,
              `resource-alias-${id}`,
              { [field]: resource.id },
              position,
            ),
          ),
          resource,
          kind,
        );
        await d3Missing(f, `${id}-after`, d3Safe(resource.id));
      }
      const replay = await f.send("replay-create", "POST", nav.targets.createBead, 200, {
        body: createA,
        key: "cold-resource-alias-create-a",
      });
      expect(d3Json(replay, "mutationReceipt")).toEqual(first);
      d3Context(replay, nav.epoch, nav.view, "pos-8");
      await d3Missing(f, "replay-after-a", d3Safe(a.id));
      await d3FinalHeads(f, nav, "pos-8");
    },
  );
}, 60000);
async function d3Collection(
  f: D3ColdClient,
  nav: D3Navigation,
  id: string,
  expected: readonly Record<string, unknown>[],
  n: readonly number[],
) {
  const url = new URL(d3Safe(nav.descriptor.beads));
  url.searchParams.set("limit", "32");
  const response = await f.send(id, "GET", url.href, 200),
    body = d3Json(response, "currentBeadCollection"),
    items = d3Array(body.items);
  expect(body.next).toBeNull();
  expect(items.map((item) => item.id)).toEqual(expected.map((item) => item.id));
  expect(items).toHaveLength(n.length);
  for (const [index, item] of items.entries()) {
    d3Checked("currentBeadRecord", item);
    expect(item.properties).toEqual({ n: n[index] });
  }
  return items;
}
it("private installed cold transactional-carriers", async () => {
  await d3InstalledCold(
    "private installed cold transactional-carriers",
    { scheduled: 28, completed: 28, aborts: 0, exact: 28, raw: 0 },
    async (f) => {
      const nav = await d3Navigate(f),
        types = await d3Types(f, nav),
        rootUrl = d3Safe(nav.descriptor.beads);
      const ids = ["a", "b", "c", "d", "missing"].map((name) => new URL(name, rootUrl).href);
      const seed = {
        operations: ids.slice(0, 3).map((id, index) => ({
          operation: "createBead",
          id,
          type: types.bead,
          properties: { n: index + 1 },
        })),
      };
      const batchReceipt = await d3Command(
          f,
          nav,
          "batch",
          "transactional-carriers-batch-seed",
          seed,
          "pos-1",
        ),
        initial = d3Array(batchReceipt.results).map((result, index) => {
          expect(result.operationIndex).toBe(index);
          expect(result.outcome).toBe("created");
          const value = d3Checked("currentBeadRecord", result.resource);
          expect(value).toMatchObject({
            id: ids[index],
            type: types.bead,
            properties: { n: index + 1 },
          });
          return value;
        });
      expect(initial).toHaveLength(3);
      await d3Collection(f, nav, "batch-after", initial, [1, 2, 3]);
      // d is a client chosen ID. name=made supplies operationName; no @made dependency is sent.
      const sequenceResponse = await f.send("sequence-turns", "POST", nav.targets.sequence, 200, {
        body: {
          operations: [
            {
              operation: "createBead",
              id: ids[3],
              type: types.bead,
              properties: { n: 4 },
              name: "made",
              idempotencyKey: "cold-seq-create",
            },
            { operation: "deleteBead", bead: ids[4], idempotencyKey: "cold-seq-missing" },
            {
              operation: "updateBead",
              bead: ids[3],
              propertiesChange: [{ op: "replace", path: "/n", value: 5 }],
              idempotencyKey: "cold-seq-update",
            },
          ],
        },
      });
      const sequence = d3Json(sequenceResponse, "transactionalSequenceResponse"),
        turns = d3Array(sequence.results);
      expect(turns).toHaveLength(3);
      expect(turns[0]).toMatchObject({
        operationIndex: 0,
        operationName: "made",
        outcome: "created",
        resource: { id: ids[3], properties: { n: 4 } },
      });
      expect(turns[1]).toMatchObject({
        operationIndex: 1,
        code: "resource-not-found",
        status: 404,
      });
      expect(turns[2]).toMatchObject({
        operationIndex: 2,
        outcome: "updated",
        resource: { id: ids[3], properties: { n: 5 } },
      });
      d3Context(sequenceResponse, nav.epoch, nav.view, "pos-3");
      const d = d3Checked("currentBeadRecord", turns[2]!.resource);
      await d3After(f, "sequence-after-d", d, "bead");
      await d3Missing(f, "sequence-after-missing", d3String(ids[4]));
      const updated = await d3Command(
        f,
        nav,
        "updateWhere",
        "transactional-carriers-set-update",
        {
          collection: "beads",
          selector: "$[?@.id]",
          change: [{ op: "replace", path: "/n", value: 9 }],
        },
        "pos-4",
      );
      const updatedResults = d3Array(updated.results);
      expect(updatedResults).toHaveLength(5);
      expect(updatedResults[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 4 });
      const updatedBeads = updatedResults.slice(1).map((result, index) => {
        const resource = d3Resource(result, "bead", types.bead, 9, "updated");
        expect(resource.id).toBe(ids[index]);
        return resource;
      });
      await d3Collection(f, nav, "set-update-after", updatedBeads, [9, 9, 9, 9]);
      const deleted = await d3Command(
        f,
        nav,
        "deleteWhere",
        "transactional-carriers-set-delete",
        { collection: "beads", selector: `$[?@.id == ${JSON.stringify(updatedBeads[1]!.id)}]` },
        "pos-5",
      );
      const deletedResults = d3Array(deleted.results);
      expect(deletedResults).toHaveLength(2);
      expect(deletedResults[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 1 });
      d3Deleted(deletedResults[1]!, updatedBeads[1]!, "bead");
      await d3Missing(f, "set-delete-after", d3Safe(updatedBeads[1]!.id));
      const replay = await f.send("replay-batch", "POST", nav.targets.batch, 200, {
        body: seed,
        key: "cold-transactional-carriers-batch-seed",
      });
      expect(d3Json(replay, "mutationReceipt")).toEqual(batchReceipt);
      d3Context(replay, nav.epoch, nav.view, "pos-5");
      await d3Missing(f, "replay-after-b", d3Safe(initial[1]!.id));
      await d3Collection(
        f,
        nav,
        "final-state",
        [updatedBeads[0]!, updatedBeads[2]!, updatedBeads[3]!],
        [9, 9, 9],
      );
      await d3FinalHeads(f, nav, "pos-5");
      const snapshot = await f.send("snapshot-root", "GET", d3Safe(nav.descriptor.snapshot), 200),
        manifest = d3Json(snapshot, "snapshotManifest");
      d3Context(snapshot, nav.epoch, nav.view, "pos-5");
      expect(manifest).toMatchObject({
        scope,
        scopeEpoch: nav.epoch,
        authorizationView: nav.view,
        scopePosition: "pos-5",
      });
      d3String(manifest.checkpoint);
      d3Safe(manifest.id, scope, true);
      for (const name of ["beads", "links"]) {
        const collection = d3Object(manifest[name]);
        if (collection.next !== null) d3Safe(collection.next, scope, true);
      }
      const changesUrl = new URL(d3Safe(nav.descriptor.changes));
      changesUrl.searchParams.set("start", "now");
      const changes = d3Json(
        await f.send("changes-root", "GET", changesUrl.href, 200),
        "changefeedPage",
      );
      expect(changes).toMatchObject({
        scope,
        scopeEpoch: nav.epoch,
        authorizationView: nav.view,
        observedHeadPosition: "pos-5",
        groups: [],
        next: null,
      });
      d3String(changes.after);
      const events = d3Json(
        await f.send("events-root", "GET", d3Safe(nav.descriptor.events), 200),
        "eventPage",
      );
      expect(events.source).toBe(d3Safe(nav.descriptor.events));
      if (events.next !== null) d3Safe(events.next, d3Safe(nav.descriptor.events), true);
    },
  );
}, 60000);
function d3Tuple(nav: D3Navigation, minimum = "pos-0", epoch = nav.epoch, view = nav.view) {
  return [
    { name: "bdp-minimum-scope-position", value: minimum },
    { name: "bdp-scope-epoch", value: epoch },
    { name: "bdp-authorization-view", value: view },
  ];
}
function d3DiscoveryRoutes(nav: D3Navigation) {
  return [
    { name: "scope", url: scope, status: 204 },
    { name: "descriptor", url: nav.descriptorUrl, status: 200 },
    { name: "directory", url: nav.directoryUrl, status: 200 },
  ] as const;
}
it("private installed raw receiving and minimum syntax", async () => {
  await d3Installed(
    "private installed raw receiving and minimum syntax",
    { scheduled: 21, completed: 21, aborts: 0, exact: 21, raw: 0 },
    async (f) => {
      const nav = await d3Navigate(f);
      for (const route of d3DiscoveryRoutes(nav)) {
        for (const name of [
          "bdp-minimum-scope-position",
          "bdp-scope-epoch",
          "bdp-authorization-view",
        ]) {
          const fields = [
            ...d3Tuple(nav),
            {
              name,
              value:
                name === "bdp-minimum-scope-position"
                  ? "pos-0"
                  : name === "bdp-scope-epoch"
                    ? nav.epoch
                    : nav.view,
            },
          ];
          const response = await f.send(`${route.name}-duplicate-${name}`, "GET", route.url, 400, {
            fields,
          });
          d3Private(response);
          d3Json(response, "transactionalProblem");
        }
        const partialFields = [{ name: "bdp-minimum-scope-position", value: "pos-0" }];
        const partial = await f.send(`${route.name}-partial`, "GET", route.url, 400, {
          fields: partialFields,
        });
        d3Private(partial);
        d3Json(partial, "transactionalProblem");
        const head = await f.send(`${route.name}-head-partial`, "HEAD", route.url, 400, {
          fields: partialFields,
        });
        d3Private(head);
        expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(partial.bodyText)));
        const comma = await f.send(`${route.name}-comma`, "GET", route.url, 400, {
          fields: d3Tuple(nav, "pos-0, pos-0"),
        });
        d3Private(comma);
        d3Json(comma, "transactionalProblem");
      }
    },
  );
}, 60000);
it("private installed discovery methods auth and transport", async () => {
  await d3Installed(
    "private installed discovery methods auth and transport",
    { scheduled: 26, completed: 26, aborts: 0, exact: 25, raw: 1 },
    async (f) => {
      const nav = await d3Navigate(f),
        routes = d3DiscoveryRoutes(nav);
      for (const route of routes) {
        const response = await f.send(`${route.name}-post`, "POST", route.url, 405);
        expect(response.headers.allow).toBe("GET, HEAD");
        d3Private(response);
        expect(response.bodyText).toBe("");
      }
      for (const method of ["GET", "HEAD", "PUT"] as const) {
        const response = await f.send(`known-${method}`, method, nav.targets.createBead, 405);
        expect(response.headers.allow).toBe("POST");
        d3Private(response);
      }
      const unknown = new URL("unknown", nav.directoryUrl).href;
      // An unknown noncanonical encoded suffix, not an alternate spelling of the operation.
      const encoded = `${nav.targets.createBead}%2C`;
      const queried = new URL(nav.targets.createBead);
      queried.search = "unexpected=1";
      // All three are ordinary allowlisted URL values with an anonymous credential handle.
      for (const [id, url] of [
        ["unknown", unknown],
        ["encoded", encoded],
        ["query", queried.href],
      ] as const) {
        const response = await f.send(id, "GET", url, 404, { role: "anonymous" });
        d3Private(response);
      }
      for (const route of routes)
        for (const method of ["GET", "HEAD"] as const) {
          const response = await f.send(
            `${route.name}-anonymous-${method}`,
            method,
            route.url,
            401,
            {
              role: "anonymous",
              ...(method === "GET"
                ? { fields: [{ name: "bdp-minimum-scope-position", value: "pos-0" }] }
                : {}),
            },
          );
          expect(response.headers["www-authenticate"]).toBe(
            'Bearer realm="bdp-transaction-development"',
          );
          d3Private(response);
        }
      for (const route of routes)
        for (const method of ["GET", "HEAD"] as const) {
          const response = await f.send(
            `${route.name}-reader-${method}`,
            method,
            route.url,
            route.status,
            { role: "reader" },
          );
          d3Context(response, nav.epoch, nav.view, "pos-0");
          if (route.name === "scope") expect(response.headers.link).toBe(nav.link);
        }
      const wrong = f.localRaw("wrong-host", nav.descriptorUrl, {
        host: "other.invalid",
        role: "anonymous",
      });
      await wrong.written;
      const wrongResponse = await wrong.response;
      expect(wrongResponse.status).toBe(400);
      d3Private(wrongResponse);
      const origin = await f.send("origin", "GET", nav.descriptorUrl, 403, {
        fields: [{ name: "origin", value: "https://other.invalid" }],
      });
      d3Private(origin);
    },
  );
}, 60000);
for (const routeName of ["scope", "descriptor", "directory"] as const) {
  it(`private installed discovery minimum ordering ${routeName}`, async () => {
    await d3Installed(
      `private installed discovery minimum ordering ${routeName}`,
      { scheduled: 15, completed: 15, aborts: 0, exact: 15, raw: 0 },
      async (f) => {
        const nav = await d3Navigate(f),
          route = d3DiscoveryRoutes(nav).find((item) => item.name === routeName)!;
        // This negative non-cold fixture alone receives the configured Type ID.
        const seedResponse = await f.send("minimum-seed", "POST", nav.targets.createBead, 200, {
          key: "d3-minimum-seed",
          body: { id: "beads/seed", type: bead, properties: { n: 1 } },
        });
        const receipt = d3Json(seedResponse, "mutationReceipt");
        expect(receipt.requiredPosition).toBe("pos-1");
        d3Context(seedResponse, nav.epoch, nav.view, "pos-1");
        const receiptUrl = d3Safe(receipt.id);
        if (!receiptUrl.startsWith(d3Safe(nav.descriptor.receipts)))
          throw new Error("D3 seed receipt confinement");
        expect(
          d3Json(await f.send("minimum-seed-receipt", "GET", receiptUrl, 200), "mutationReceipt"),
        ).toEqual(receipt);
        const cases = [
          ["known-get", "GET", "pos-1", nav.epoch, nav.view, [], route.status, undefined],
          ["known-head", "HEAD", "pos-1", nav.epoch, nav.view, [], route.status, undefined],
          ["genesis", "GET", "pos-0", nav.epoch, nav.view, [], route.status, undefined],
          [
            "epoch-first",
            "GET",
            "opaque-minimum",
            "foreign-epoch",
            nav.view,
            [{ name: "if-none-match", value: "*" }],
            410,
            "cursor-expired",
          ],
          [
            "view-before-accept",
            "GET",
            "opaque-minimum",
            nav.epoch,
            "foreign-view",
            [{ name: "accept", value: "text/plain" }],
            409,
            "foreign-view",
          ],
          [
            "view-head",
            "HEAD",
            "opaque-minimum",
            nav.epoch,
            "foreign-view",
            [{ name: "if-match", value: '"absent"' }],
            409,
            "foreign-view",
          ],
          [
            "opaque-accept",
            "GET",
            "opaque-minimum",
            nav.epoch,
            nav.view,
            [{ name: "accept", value: "text/plain" }],
            503,
            "catch-up-timeout",
          ],
          [
            "opaque-conditional",
            "GET",
            "opaque-minimum",
            nav.epoch,
            nav.view,
            [{ name: "if-none-match", value: "*" }],
            503,
            "catch-up-timeout",
          ],
          [
            "opaque-head",
            "HEAD",
            "opaque-minimum",
            nav.epoch,
            nav.view,
            [{ name: "if-match", value: '"absent"' }],
            503,
            "catch-up-timeout",
          ],
          ["known-future", "GET", "pos-2", nav.epoch, nav.view, [], 503, "catch-up-timeout"],
        ] as const;
        let viewBytes = 0,
          timeoutBytes = 0;
        for (const [id, method, minimum, epoch, view, extras, status, code] of cases) {
          const response = await f.send(id, method, route.url, status, {
            fields: [...d3Tuple(nav, minimum, epoch, view), ...extras],
          });
          d3Context(response, nav.epoch, nav.view, "pos-1");
          if (code) {
            expect(response.headers.link).toBeUndefined();
            expect(response.headers.etag).toBeUndefined();
            if (method === "GET") {
              expect(d3Json(response, "transactionalProblem").code).toBe(code);
              if (status === 409) viewBytes = Buffer.byteLength(response.bodyText);
              if (status === 503) timeoutBytes = Buffer.byteLength(response.bodyText);
            } else
              expect(response.headers["content-length"]).toBe(
                String(status === 409 ? viewBytes : timeoutBytes),
              );
            if (status === 503) expect(response.headers["retry-after"]).toBe("1");
          } else if (route.name === "scope") expect(response.headers.link).toBe(nav.link);
        }
      },
    );
  }, 60000);
  it(`private installed discovery close pending ${routeName}`, async () => {
    await d3Installed(
      `private installed discovery close pending ${routeName}`,
      { scheduled: 5, completed: 4, aborts: 1, exact: 4, raw: 1 },
      async (f) => {
        const nav = await d3Navigate(f),
          route = d3DiscoveryRoutes(nav).find((item) => item.name === routeName)!;
        const pending = f.localRaw("pending-minimum", route.url, {
          role: "writer",
          fields: d3Tuple(nav, "opaque-minimum").map(({ name, value }): [string, string] => [
            name,
            value,
          ]),
        });
        // A successful write callback means sent-only; it proves no admission or wait.
        await pending.written;
        const independent = await f.send("independent-descriptor", "GET", nav.descriptorUrl, 200);
        d3Context(independent, nav.epoch, nav.view, "pos-0");
        expect(pending.state.written).toBe(true);
        expect(pending.state.settled).toBe(false);
        expect(pending.state.responseStarted).toBe(false);
        const closing = pending.requestClose(); // No intervening await after the last actual pending checks.
        void closing.catch(() => {});
        let terminal: unknown;
        try {
          await pending.response;
          throw new Error("D3 pending read completed before close abort");
        } catch (error) {
          terminal = error;
        }
        expect(terminal).toBeInstanceOf(D3RawTerminal);
        if (!(terminal instanceof D3RawTerminal)) throw terminal;
        expect(terminal.category).toBe("abort");
        expect(terminal.partialStatus).toBeUndefined();
        expect(pending.state.closeRequested).toBe(true);
        expect(pending.state.responseStarted).toBe(false);
        f.expectedAbort();
        await closing;
        await f.events.closed;
        expect(f.events.state).toMatchObject({
          exitSeen: true,
          closeSeen: true,
          code: 0,
          signal: null,
        });
        d3PidAbsent(f.child.child.pid);
      },
    );
  }, 60000);
}
