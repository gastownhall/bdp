/** Private raw-stream evidence; not a finite exchange or public profile claim. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { recordRawSse } from "@bdp/server/testing";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal: AbortSignal,
  ): Promise<{ child: ChildProcess; ready: Record<string, unknown>; close(): Promise<void> }>;
};
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw Error("installed SSE override requires explicit source commit");
const source =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const scope = "https://reference.invalid/acme/",
  type = `${scope}types/task`,
  schema = `${scope}schemas/task`;
const artifacts = {
  descriptors: [
    {
      retrievalUri: type,
      utf8: JSON.stringify({
        id: type,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: schema,
      }),
    },
    {
      retrievalUri: `${scope}types/link`,
      utf8: JSON.stringify({
        id: `${scope}types/link`,
        name: "Link",
        describes: "link",
        conformsTo: [],
        propertiesSchema: schema,
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "none" },
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
it("installed Scope/Bead/Link Event SSE matches finite bytes and sparse Bead survives fifteen seconds", async () => {
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error("installed SSE cohort deadline")),
    45000,
  );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-sse-installed-")),
    token = randomBytes(32).toString("base64url");
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let stream: ReturnType<typeof recordRawSse> | undefined;
  const failures: unknown[] = [];
  let report: unknown;
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
    const binding = installedTransactionBinding(child.ready, source, fixture);
    const installedConfiguration = (await import(
      pathToFileURL(path.join(path.dirname(entry), "transaction-runtime-configuration.js")).href
    )) as typeof import("../../../packages/server/src/transaction-runtime-configuration.js");
    const actualSettings = installedConfiguration.TRANSACTION_RUNTIME_DEFAULTS;
    expect(child.ready.runtimeConfigurationIdentity).toBe(
      installedConfiguration.transactionRuntimeDigest({
        revision: "transaction-runtime-1",
        scope,
        artifactIdentity: child.ready.artifactIdentity,
        settings: actualSettings,
        authorityMode: "canonical",
        policyIdentity: child.ready.policyIdentity,
        authenticationIdentity: child.ready.authenticationIdentity,
        profile: "transactional",
        history: false,
      }),
    );
    const address = new URL(child.ready.listenUrl as string);
    let key = 0;
    const exchange = async (target: string, body?: unknown) => {
      const url = new URL(target, scope).href,
        method = body === undefined ? ("GET" as const) : ("POST" as const);
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: address.hostname, port: Number(address.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 65536,
          exactMode: {
            scope,
            profile: "transactional",
            routes: [{ method, url }],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: "writer",
            credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
          },
        },
      );
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: "writer",
        raw: {
          headerLines:
            body === undefined
              ? []
              : [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: `sse_${key++}` },
                ],
          ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
        },
      });
      expect(response.status, response.bodyText).toBe(200);
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      return {
        bodyText: response.bodyText,
        parsed: JSON.parse(response.bodyText) as { events: unknown[]; next: string | null },
      };
    };
    const observations: unknown[] = [];
    const frames = (r: ReturnType<typeof recordRawSse>) =>
      r.frames.filter((f) => f.startsWith("id: "));
    const parsed = (frame: string) => JSON.parse(frame.split("\ndata: ")[1]!);
    const run = (operations: unknown[]) => exchange("operations/batch", { operations });
    const create = (id: string) => ({
      operation: "createBead",
      id: `beads/${id}`,
      type,
      properties: { n: 0 },
    });
    await run([
      create("a"),
      create("b"),
      {
        operation: "createLink",
        id: "links/l",
        type: `${scope}types/link`,
        source: "beads/a",
        target: "beads/a",
        properties: { n: 0 },
      },
    ]);
    const open = (target: string) =>
      recordRawSse({
        dial: address.href,
        host: "reference.invalid",
        target: `/acme/${target}`,
        headers: [
          ["Authorization", `Bearer ${token}`],
          ["Accept", "text/event-stream"],
        ],
        signal: controller.signal,
        timeoutMs: 25000,
      });
    const observe = (r: ReturnType<typeof recordRawSse>, target: string) => ({
      target,
      headers: r.headers,
      frames: r.frames,
      elapsedMs: r.elapsedMs,
      wireBytes: r.wireBytes.length,
      wireResponseBase64: r.wireBytes.toString("base64"),
      wireSha256: createHash("sha256").update(r.wireBytes).digest("hex"),
    });
    for (const target of ["events/", "beads/a?view=events", "links/l?view=events"]) {
      const finite = await exchange(target);
      expect(finite.parsed.next).toBeNull();
      stream = open(target);
      const live = stream;
      await live.until(() => frames(live).length === finite.parsed.events.length);
      expect(frames(live).map(parsed)).toEqual(finite.parsed.events);
      for (const frame of frames(live))
        expect(finite.bodyText).toContain(frame.split("\ndata: ")[1]!);
      expect(live.headers).toMatchObject({
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        vary: "Accept",
        "x-bdp-development": "non-attesting",
      });
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(live.headers[name]).toBeTruthy();
      await live.close();
      observations.push(observe(live, target));
      stream = undefined;
    }
    const initial = await exchange("beads/a?view=events");
    const last = (initial.parsed.events.at(-1)! as { id: string }).id;
    for (let n = 1; n <= 12; n++)
      await run([
        {
          operation: "updateBead",
          bead: "beads/b",
          propertiesChange: [{ op: "replace", path: "/n", value: n }],
        },
      ]);
    const sparseTarget = `beads/a?view=events&after=${last}`;
    stream = open(sparseTarget);
    const current = stream;
    await current.ready;
    expect(current.status).toBe(200);
    const idleStarted = performance.now();
    await delay(15100, undefined, { signal: controller.signal });
    expect(current.destroyed).toBe(false);
    expect(frames(current)).toEqual([]);
    const comments = current.frames.filter((f) => f.startsWith(":"));
    expect(comments.length).toBeGreaterThanOrEqual(2);
    expect(comments.every((f) => !f.includes("id:"))).toBe(true);
    await run([
      {
        operation: "updateBead",
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
      },
    ]);
    await current.until(() => frames(current).length === 1);
    expect(parsed(frames(current)[0]!).subject).toBe(`${scope}beads/a`);
    const finiteLive = await exchange(sparseTarget);
    expect(finiteLive.parsed.events).toEqual(frames(current).map(parsed));
    expect(finiteLive.bodyText).toContain(frames(current)[0]!.split("\ndata: ")[1]!);
    const elapsedIdle = performance.now() - idleStarted;
    expect(elapsedIdle).toBeGreaterThanOrEqual(15000);
    await current.close();
    observations.push(observe(current, sparseTarget));
    stream = undefined;
    expect(actualSettings.eventStream).toEqual({
      maximumGroupsPerObservation: 1,
      packetBytes: 4194304,
    });
    report = {
      observation: "private-installed-event-source-sse",
      claimEligible: false,
      source,
      workspaceDirty:
        execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0,
      entry,
      entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
      binding,
      node: process.version,
      settings: actualSettings,
      deadlines: { ...actualSettings.transport, recorder: 25000, cohort: 45000, cleanup: 10000 },
      idleMilliseconds: elapsedIdle,
      streamMilliseconds: current.elapsedMs,
      comments: comments.length,
      liveEventFrames: 1,
      observations,
      wireBytes: current.wireBytes.length,
      wireResponseBase64: current.wireBytes.toString("base64"),
      wireSha256: createHash("sha256").update(current.wireBytes).digest("hex"),
      headers: current.headers,
      frames: current.frames,
    };
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await stream?.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await child?.close();
    } catch (error) {
      failures.push(error);
    }
    clearTimeout(deadline);
    rmSync(directory, { recursive: true, force: true });
  }
  if (failures.length)
    throw new AggregateError(failures, "installed SSE observation or cleanup failed");
  console.log(JSON.stringify(report));
}, 60000);

it("installed Event cursors survive restart with Last-Event-ID precedence and source binding", async () => {
  // The full suite executes this same witness locally; only externally bound artifacts
  // can supply installed attribution. A declared source string alone proves no provenance.
  const entryOverride = process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY;
  const sourceOverride = process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT;
  const hasEntryOverride = entryOverride !== undefined;
  const hasSourceOverride = sourceOverride !== undefined;
  if (hasEntryOverride !== hasSourceOverride)
    throw new Error("Event restart overrides must include both installed entry and source");
  expect(source).toMatch(/^[0-9a-f]{40}$/);
  const attribution = hasEntryOverride ? "external-installed-candidate" : "development-local";
  if (hasEntryOverride) {
    if (!entryOverride || !sourceOverride || !/^[0-9a-f]{40}$/.test(sourceOverride))
      throw new Error(
        "Event restart installed overrides must be nonempty and source must be a commit",
      );
    const installedRelative = path.relative(realpathSync(root), entry);
    if (!installedRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(installedRelative))
      throw new Error("Event restart installed attribution requires an external entry");
  }
  const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const witnessPath = fileURLToPath(import.meta.url);
  const witnessSource = {
    fingerprintScope:
      "witness file bytes and tracked working-tree diff only; excludes untracked inputs and installed payload provenance",
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    fileSha256: hash(readFileSync(witnessPath)),
    diffSha256: hash(execFileSync("git", ["diff", "HEAD"], { cwd: root })),
    dirtyPaths: execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean),
  };
  const controller = new AbortController();
  const started = performance.now(),
    workEnd = started + 45000;
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-event-restart-installed-"));
  const token = randomBytes(32).toString("base64url");
  function safeFailureMessage(error: unknown): string {
    return (error instanceof Error ? error.message : "non-Error failure").replaceAll(
      token,
      "[credential redacted]",
    );
  }
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts,
    credentials: [{ token, principal: "writer", canMutate: true }],
  };
  const seedKey = "event-restart-two-created-v1";
  const seedBytes = Buffer.from(
    JSON.stringify({
      operations: ["a", "b"].map((id) => ({
        operation: "createBead",
        id: `beads/${id}`,
        type,
        properties: { n: 0 },
      })),
    }),
  );
  type Handle = Awaited<ReturnType<typeof launchInstalledTransaction>>;
  type Session = {
    ordinal: number;
    create: boolean;
    state: "launching" | "owned" | "unknown-no-handle";
    handle?: Handle;
    pid?: number | undefined;
    listenUrl?: string | undefined;
    binding?: ReturnType<typeof installedTransactionBinding>;
    exit?: { code: number | null; signal: NodeJS.Signals | null };
    closing?: Promise<void>;
    closed: boolean;
    stopUnknown: boolean;
  };
  const sessions: Session[] = [];
  const failures: { phase: string; error: unknown }[] = [];
  const pending = new Set<Promise<unknown>>();
  const localSensitivityControls: string[] = [];
  const requests: { ordinal: number; session: number; method: string; target: string }[] = [];
  const responses: unknown[] = [];
  let phase = "setup",
    cleanupStarted = false,
    abortedForCleanup = false,
    removed = false;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let epoch: string | undefined;
  let events: Record<string, unknown>[] = [];
  let sseEvidence: unknown;
  let stream:
    | {
        recorder: ReturnType<typeof recordRawSse>;
        closing?: Promise<void>;
        drained: boolean;
      }
    | undefined;
  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise);
    // Both handlers are attached before any race; even a late failure is observed.
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  }
  function closeStream(): Promise<void> {
    if (!stream) return Promise.resolve();
    const owned = stream;
    owned.closing ??= track(
      owned.recorder.close().then(() => {
        owned.drained = true;
      }),
    );
    return owned.closing;
  }
  function closeSession(session: Session): Promise<void> {
    if (!session.handle) {
      session.stopUnknown = true;
      return Promise.reject(new Error("no returned child handle; stop unknown"));
    }
    const handle = session.handle;
    session.closing ??= track(
      handle.close().then(() => {
        session.exit = { code: handle.child.exitCode, signal: handle.child.signalCode };
        if (session.exit.code !== 0 || session.exit.signal !== null)
          throw new Error("child normal exit not established");
        session.closed = true;
      }),
    );
    return session.closing;
  }
  const workTimer = setTimeout(() => {
    // Initiate socket stop before abort causes the launcher's automatic child stop.
    void closeStream().catch(() => {});
    controller.abort(new Error("Event restart work deadline"));
  }, 45000);
  async function bounded<T>(promise: Promise<T>, end: number, label: string): Promise<T> {
    track(promise);
    const remaining = end - performance.now();
    if (remaining <= 0) throw new Error(`${label}: deadline exhausted`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label}: deadline`)), remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function boundedDrain(promise: Promise<void>, end: number, label: string) {
    // A reporting bound, not evidence that helper kill/drain completed within ten seconds.
    await bounded(promise, end, label);
  }
  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("expected Event witness object");
    return value as Record<string, unknown>;
  }
  function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error("expected Event witness array");
    return value;
  }
  function sameEvent(actual: unknown, expected: unknown) {
    expect(actual).toEqual(expected);
  }
  function frameEvent(frame: string): unknown {
    const data = frame.split("\n").filter((line) => line.startsWith("data: "));
    expect(data).toHaveLength(1);
    return JSON.parse(data[0]!.slice(6));
  }
  function sameFrame(frame: string, expected: Record<string, unknown>) {
    const fields = frame.split("\n");
    expect(fields.filter((line) => line.startsWith("id: "))).toEqual([`id: ${expected.id}`]);
    expect(fields.filter((line) => line.startsWith("event: "))).toEqual([
      `event: ${expected.type}`,
    ]);
    sameEvent(frameEvent(frame), expected);
  }
  function idFrames(recorder: ReturnType<typeof recordRawSse>) {
    return recorder.frames.filter((frame) =>
      frame.split("\n").some((line) => line.startsWith("id: ")),
    );
  }
  function context(headers: Readonly<Record<string, string | undefined>>) {
    expect(headers["bdp-scope-position"]).toBe("pos-1");
    expect(headers["bdp-authorization-view"]).toBe("development-all-visible");
    expect(headers["bdp-scope-epoch"]).toEqual(expect.any(String));
    expect(headers["bdp-scope-epoch"]?.length).toBeGreaterThan(0);
    if (epoch === undefined) epoch = headers["bdp-scope-epoch"];
    else expect(headers["bdp-scope-epoch"]).toBe(epoch);
  }
  function beginRequest(session: Session, method: string, target: string) {
    controller.signal.throwIfAborted();
    if (cleanupStarted || performance.now() >= workEnd)
      throw new Error("request outside work budget");
    if (!session.handle || session.closed || session.closing)
      throw new Error("request without active owner");
    expect(requests.length).toBeLessThan(5);
    requests.push({ ordinal: requests.length + 1, session: session.ordinal, method, target });
  }
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
    ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
    const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
    ajv.addSchema(bundle);
    const validators = Object.fromEntries(
      ["mutationReceipt", "currentBeadRecord", "eventPage", "event", "transactionalProblem"].map(
        (name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })] as const,
      ),
    );
    function validate(name: string, value: unknown) {
      const validator = validators[name];
      if (!validator) throw new Error("missing Event witness schema");
      expect(validator(value), JSON.stringify(validator.errors)).toBe(true);
    }
    const installedConfiguration = (await bounded(
      import(
        pathToFileURL(path.join(path.dirname(entry), "transaction-runtime-configuration.js")).href
      ),
      workEnd,
      "installed configuration import",
    )) as typeof import("../../../packages/server/src/transaction-runtime-configuration.js");
    const digest = installedConfiguration.transactionRuntimeDigest;
    const associations = [
      {
        tokenDigest: digest({ revision: "transaction-credential-1", token }),
        principal: "writer",
        canMutate: true,
      },
    ];
    const expectedAuthentication = digest({
      revision: "transaction-authentication-1",
      scheme: "bearer",
      associations,
    });
    const expectedPolicy = digest({
      revision: "transaction-policy-1",
      view: "development-all-visible",
      read: "all-visible",
      aggregate: [],
      associations,
    });
    async function launch(create: boolean) {
      controller.signal.throwIfAborted();
      if (cleanupStarted || performance.now() >= workEnd)
        throw new Error("launch outside work budget");
      if (sessions.length >= 2) throw new Error("extra Event witness launch");
      const session: Session = {
        ordinal: sessions.length + 1,
        create,
        state: "launching",
        closed: false,
        stopUnknown: false,
      };
      sessions.push(session);
      const launching = track(
        launchInstalledTransaction(entry, { ...configuration, create }, controller.signal).then(
          (handle) => {
            session.handle = handle;
            session.pid = handle.child.pid;
            session.listenUrl =
              typeof handle.ready.listenUrl === "string" ? handle.ready.listenUrl : undefined;
            session.state = "owned";
            handle.child.once("exit", (code, signal) => {
              session.exit = { code, signal };
            });
            if (handle.child.exitCode !== null || handle.child.signalCode !== null)
              session.exit = { code: handle.child.exitCode, signal: handle.child.signalCode };
            if (cleanupStarted || controller.signal.aborted || performance.now() >= workEnd) {
              session.stopUnknown = true;
              void closeSession(session).catch(() => {});
            }
            return handle;
          },
          (error: unknown) => {
            session.state = "unknown-no-handle";
            session.stopUnknown = true;
            throw error;
          },
        ),
      );
      let handle: Handle;
      try {
        handle = await bounded(launching, workEnd, `launch ${session.ordinal}`);
      } catch (error) {
        session.stopUnknown = true;
        throw error;
      }
      controller.signal.throwIfAborted();
      expect(session.pid).toEqual(expect.any(Number));
      expect(session.pid).toBeGreaterThan(0);
      expect(handle.child.exitCode).toBeNull();
      expect(handle.child.signalCode).toBeNull();
      expect(handle.ready.scope).toBe(scope);
      expect(handle.ready.authenticationIdentity).toBe(expectedAuthentication);
      expect(handle.ready.policyIdentity).toBe(expectedPolicy);
      expect(handle.ready.runtimeConfigurationIdentity).toBe(
        digest({
          revision: "transaction-runtime-1",
          scope,
          artifactIdentity: handle.ready.artifactIdentity,
          settings: installedConfiguration.TRANSACTION_RUNTIME_DEFAULTS,
          authorityMode: "canonical",
          policyIdentity: expectedPolicy,
          authenticationIdentity: expectedAuthentication,
          profile: "transactional",
          history: false,
        }),
      );
      const actual = installedTransactionBinding(handle.ready, source, fixture);
      session.binding = actual;
      if (binding) expect(actual).toEqual(binding);
      else binding = actual;
      return session;
    }
    async function finite(
      session: Session,
      target: string,
      status: number,
      schemaName: string,
      body?: Uint8Array,
    ) {
      const method = body === undefined ? ("GET" as const) : ("POST" as const);
      beginRequest(session, method, target);
      const url = new URL(target, scope).href;
      const address = new URL(session.handle!.ready.listenUrl as string);
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
            resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
          },
        },
      );
      const response = await bounded(
        execute({
          method,
          url,
          signal: controller.signal,
          credentialRef: "writer",
          raw: {
            headerLines: [
              { name: "Accept", value: "application/json" },
              ...(body === undefined
                ? []
                : [
                    { name: "Content-Type", value: "application/json" },
                    { name: "Idempotency-Key", value: seedKey },
                  ]),
            ],
            ...(body === undefined ? {} : { bodyBytes: body }),
          },
        }),
        workEnd,
        `request ${requests.length}`,
      );
      responses.push({
        ordinal: requests.length,
        session: session.ordinal,
        method,
        target,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: hash(response.bodyText),
        wireSha256: response.wireResponseBytes ? hash(response.wireResponseBytes) : undefined,
        headers: Object.fromEntries(
          [
            "content-type",
            "bdp-scope-epoch",
            "bdp-authorization-view",
            "bdp-scope-position",
            "x-bdp-development",
          ].map((name) => [name, response.headers[name]] as const),
        ),
      });
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(
        response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
      ).toBe("reference.invalid");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(response.status, response.bodyText).toBe(status);
      expect(response.headers["content-type"]?.split(";")[0]).toBe(
        status === 400 ? "application/problem+json" : "application/json",
      );
      expect(response.bodyOctets).toBe(Buffer.byteLength(response.bodyText));
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      context(response.headers);
      const value: unknown = JSON.parse(response.bodyText);
      validate(schemaName, value);
      return object(value);
    }
    phase = "first launch";
    const first = await launch(true);
    phase = "seed batch";
    const receipt = await finite(first, "operations/batch", 200, "mutationReceipt", seedBytes);
    expect(receipt).toMatchObject({
      status: "completed",
      detail: "available",
      idempotencyKey: seedKey,
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
      scopeEpoch: epoch,
      authorizationView: "development-all-visible",
      next: null,
    });
    expect(receipt.transaction).toEqual(expect.any(String));
    expect((receipt.transaction as string).length).toBeGreaterThan(0);
    const results = array(receipt.results).map(object);
    expect(results).toHaveLength(2);
    const resources = results.map((result, i) => {
      expect(result.operationIndex).toBe(i);
      expect(result.outcome).toBe("created");
      const resource = object(result.resource);
      validate("currentBeadRecord", resource);
      // Independent complete shape; the authority-issued revision is opaque.
      expect(resource).toEqual({
        id: `${scope}beads/${i === 0 ? "a" : "b"}`,
        type,
        revision: expect.any(String),
        properties: { n: 0 },
        metadata: {},
      });
      // Unattributed seed with recordChangeContext:false must not invent native provenance.
      expect(resource).not.toHaveProperty("revisionProvenance");
      expect((resource.revision as string).length).toBeGreaterThan(0);
      return resource;
    });
    phase = "initial Event page";
    const initial = await finite(first, "events/", 200, "eventPage");
    expect(initial.source).toBe(`${scope}events/`);
    expect(initial.next).toBeNull();
    events = array(initial.events).map(object);
    expect(events).toHaveLength(2);
    events.forEach((event, i) => {
      validate("event", event);
      expect(event).toEqual({
        id: expect.any(String),
        ordinal: i,
        type: "created",
        source: `${scope}events/`,
        subject: resources[i]!.id,
        subjectType: type,
        transaction: receipt.transaction,
        time: expect.any(String),
        data: {
          revision: resources[i]!.revision,
          properties: { n: 0 },
          metadata: {},
        },
      });
      expect(object(event.data)).not.toHaveProperty("revisionProvenance");
      expect((event.id as string).length).toBeGreaterThan(0);
    });
    const e0 = events[0]!,
      e1 = events[1]!;
    expect(e0.id).not.toBe(e1.id);
    phase = "first clean shutdown";
    try {
      await boundedDrain(closeSession(first), workEnd, phase);
    } catch (error) {
      first.stopUnknown = true;
      throw error;
    }
    expect(first.closed).toBe(true);
    expect(first.exit).toEqual({ code: 0, signal: null });
    phase = "reopen";
    const second = await launch(false);
    expect(second.pid).not.toBe(first.pid);
    phase = "restored Event page";
    const restored = await finite(
      second,
      `events/?after=${encodeURIComponent(e0.id as string)}`,
      200,
      "eventPage",
    );
    expect(restored.source).toBe(`${scope}events/`);
    expect(restored.next).toBeNull();
    expect(array(restored.events)).toHaveLength(1);
    sameEvent(array(restored.events)[0], e1);
    const corrupted = structuredClone(object(array(restored.events)[0]));
    corrupted.ordinal = 0;
    expect(() => sameEvent(corrupted, e1)).toThrow();
    localSensitivityControls.push("restored-event-ordinal");
    phase = "header-precedence stream";
    const sseTarget = `events/?after=${encodeURIComponent(e1.id as string)}`;
    beginRequest(second, "GET", sseTarget);
    const recorder = recordRawSse({
      dial: second.handle!.ready.listenUrl as string,
      host: "reference.invalid",
      target: `/acme/${sseTarget}`,
      headers: [
        ["Authorization", `Bearer ${token}`],
        ["Accept", "text/event-stream"],
        ["Last-Event-ID", e0.id as string],
      ],
      signal: controller.signal,
      timeoutMs: 5000,
    });
    stream = { recorder, drained: false };
    await bounded(recorder.ready, workEnd, "SSE ready");
    expect(recorder.status).toBe(200);
    expect(recorder.headers).toMatchObject({
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      "x-bdp-development": "non-attesting",
    });
    context(recorder.headers);
    await bounded(
      recorder.until(() => idFrames(recorder).length > 0),
      workEnd,
      "SSE first Event",
    );
    sameFrame(idFrames(recorder)[0]!, e1);
    expect(controller.signal.aborted).toBe(false);
    expect(recorder.destroyed).toBe(false);
    const beforeCloseMs = recorder.elapsedMs;
    expect(beforeCloseMs).toBeLessThan(5000);
    const streamClosing = closeStream();
    await boundedDrain(
      streamClosing,
      Math.min(workEnd, performance.now() + 10000),
      "intentional SSE drain",
    );
    expect(recorder.status).toBe(200);
    const observedFrames = idFrames(recorder);
    expect(observedFrames).toHaveLength(1);
    observedFrames.forEach((frame) => {
      sameFrame(frame, e1);
    });
    expect(() => sameFrame(observedFrames[0]!, e0)).toThrow();
    localSensitivityControls.push("frame-event-identity");
    sseEvidence = {
      requestOrdinal: 4,
      session: second.ordinal,
      target: sseTarget,
      lastEventId: e0.id,
      status: recorder.status,
      headers: Object.fromEntries(
        [
          "content-type",
          "cache-control",
          "bdp-scope-epoch",
          "bdp-authorization-view",
          "bdp-scope-position",
        ].map((name) => [name, recorder.headers[name]] as const),
      ),
      completeObservedFrames: observedFrames,
      beforeIntentionalCloseMs: beforeCloseMs,
      wireBytes: recorder.wireBytes.length,
      wireSha256: hash(recorder.wireBytes),
      drained: stream.drained,
      observationLimit:
        "complete frames observed in the bounded window; no indefinite absence claim",
    };
    phase = "known Bead rejects Scope cursor";
    const foreign = await finite(
      second,
      `beads/a?view=events&after=${encodeURIComponent(e0.id as string)}`,
      400,
      "transactionalProblem",
    );
    expect(foreign.code).toBe("invalid-parameter");
    expect(foreign.status).toBe(400);
    expect(requests.map(({ ordinal, session, method }) => ({ ordinal, session, method }))).toEqual([
      { ordinal: 1, session: 1, method: "POST" },
      { ordinal: 2, session: 1, method: "GET" },
      { ordinal: 3, session: 2, method: "GET" },
      { ordinal: 4, session: 2, method: "GET" },
      { ordinal: 5, session: 2, method: "GET" },
    ]);
    expect(responses).toHaveLength(4);
    expect(localSensitivityControls).toEqual(["restored-event-ordinal", "frame-event-identity"]);
    controller.signal.throwIfAborted();
    if (performance.now() >= workEnd) throw new Error("Event restart work exceeded budget");
  } catch (error) {
    failures.push({ phase, error });
  } finally {
    cleanupStarted = true;
    clearTimeout(workTimer);
    const cleanupEnd = performance.now() + 10000;
    try {
      await boundedDrain(closeStream(), cleanupEnd, "final stream drain");
    } catch (error) {
      failures.push({ phase: "stream cleanup", error });
    }
    if (failures.length && !controller.signal.aborted) {
      abortedForCleanup = true;
      controller.abort(new Error("Event restart observation failed"));
    }
    for (const session of sessions) {
      if (!session.handle) {
        session.stopUnknown = true;
        failures.push({
          phase: `child ${session.ordinal} cleanup`,
          error: new Error("launch stop unknown-no-handle"),
        });
        continue;
      }
      try {
        await boundedDrain(closeSession(session), cleanupEnd, `child ${session.ordinal} drain`);
      } catch (error) {
        session.stopUnknown = true;
        failures.push({ phase: `child ${session.ordinal} cleanup`, error });
      }
    }
    if (controller.signal.aborted && !abortedForCleanup)
      failures.push({ phase: "work signal", error: controller.signal.reason });
    try {
      expect(sessions).toHaveLength(2);
      expect(sessions.map((session) => session.create)).toEqual([true, false]);
      for (const session of sessions) {
        expect(session.state).toBe("owned");
        expect(session.stopUnknown).toBe(false);
        expect(session.closed).toBe(true);
        expect(session.exit).toEqual({ code: 0, signal: null });
      }
      expect(stream?.drained).toBe(true);
      expect(pending.size).toBe(0);
    } catch (error) {
      failures.push({ phase: "ownership proof", error });
    }
    // Any semantic or second-launch failure preserves the store for separate diagnosis.
    if (failures.length === 0) {
      try {
        rmSync(directory, { recursive: true, force: false });
        removed = true;
      } catch (error) {
        failures.push({ phase: "directory cleanup", error });
      }
    }
    const reportedStream = stream;
    console.log(
      JSON.stringify({
        observation: "private-event-restart-cursor",
        attribution,
        installedProvenance:
          attribution === "external-installed-candidate"
            ? "requires separately verified external package/consumer/source binding"
            : "none; development fallback is not installed evidence",
        claimEligible: false,
        outcome: failures.length ? "failed" : "passed",
        declaredSourceCommit: source,
        witnessSource,
        entry,
        entrySha256: hash(readFileSync(entry)),
        binding,
        node: process.version,
        seedBodySha256: hash(seedBytes),
        seedBodyBytes: seedBytes.length,
        seedKey,
        deadlines: {
          work: 45000,
          cleanup: 10000,
          callback: 60000,
          outerSupervisor: 120000,
          finite: 5000,
          recorder: 5000,
        },
        requests,
        completedFiniteResponses: responses,
        localSensitivityControls,
        events,
        sse: sseEvidence,
        // Preserve available safe transport facts even when assertions failed before success evidence.
        streamAtReport: reportedStream
          ? {
              status: reportedStream.recorder.status,
              headers: Object.fromEntries(
                [
                  "content-type",
                  "cache-control",
                  "bdp-scope-epoch",
                  "bdp-authorization-view",
                  "bdp-scope-position",
                ].map((name) => [name, reportedStream.recorder.headers[name]] as const),
              ),
              wireBytes: reportedStream.recorder.wireBytes.length,
              wireSha256: hash(reportedStream.recorder.wireBytes),
              completeObservedFrames: idFrames(reportedStream.recorder),
              drained: reportedStream.drained,
              destroyed: reportedStream.recorder.destroyed,
            }
          : undefined,
        sessions: sessions.map((session) => ({
          ordinal: session.ordinal,
          create: session.create,
          state: session.state,
          pid: session.pid,
          listenUrl: session.listenUrl,
          binding: session.binding,
          exit: session.exit,
          closed: session.closed,
          stopUnknown: session.stopUnknown,
        })),
        pendingOperationsAtReport: pending.size,
        directory,
        directoryRemoved: removed,
        failures: failures.map(({ phase, error }) => ({
          phase,
          name:
            error instanceof Error
              ? error.name.replaceAll(token, "[credential redacted]")
              : "non-Error",
          message: safeFailureMessage(error),
        })),
        diagnosticLimit:
          "startup helper may expose only generic error and no returned handle; no private child trace claimed",
        supervisorAcceptanceRequired:
          "isolated owned group; no survivors or forced cleanup; intervention always fails",
      }),
    );
  }
  if (failures.length)
    throw new AggregateError(
      failures.map(({ phase, error }) => new Error(`${phase}: ${safeFailureMessage(error)}`)),
      "Event restart observation or cleanup failed",
    );
}, 60000);

it("observes genuine installed initial Scope Event SSE opaque minimum refusal", async () => {
  // The full suite executes this same witness locally; only externally bound artifacts
  // can supply installed attribution. A declared source string alone proves no provenance.
  const entryOverride = process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY;
  const sourceOverride = process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT;
  const hasEntryOverride = entryOverride !== undefined;
  const hasSourceOverride = sourceOverride !== undefined;
  if (hasEntryOverride !== hasSourceOverride)
    throw new Error(
      "Scope Event SSE minimum overrides must include both installed entry and source",
    );
  expect(source).toMatch(/^[0-9a-f]{40}$/);
  const attribution = hasEntryOverride ? "external-installed-candidate" : "development-local";
  if (hasEntryOverride) {
    if (!entryOverride || !sourceOverride || !/^[0-9a-f]{40}$/.test(sourceOverride))
      throw new Error(
        "Scope Event SSE minimum installed overrides must be nonempty and source must be a commit",
      );
    const installedRelative = path.relative(realpathSync(root), entry);
    if (!installedRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(installedRelative))
      throw new Error("Scope Event SSE minimum installed attribution requires an external entry");
  }
  const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const witnessPath = fileURLToPath(import.meta.url);
  const witnessSource = {
    fingerprintScope:
      "witness file bytes and tracked working-tree diff only; excludes untracked inputs and installed payload provenance",
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    fileSha256: hash(readFileSync(witnessPath)),
    diffSha256: hash(execFileSync("git", ["diff", "HEAD"], { cwd: root })),
    dirtyPaths: execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean),
  };
  const controller = new AbortController();
  const started = performance.now(),
    workEnd = started + 45000;
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-scope-sse-minimum-installed-"));
  const token = randomBytes(32).toString("base64url");
  function safeFailureMessage(error: unknown): string {
    return (error instanceof Error ? error.message : "non-Error failure").replaceAll(
      token,
      "[credential redacted]",
    );
  }
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts,
    credentials: [{ token, principal: "writer", canMutate: true }],
  };
  const seedKey = "scope-sse-minimum-one-created-v1";
  const seedBytes = Buffer.from(
    JSON.stringify({
      operations: ["a"].map((id) => ({
        operation: "createBead",
        id: `beads/${id}`,
        type,
        properties: { n: 0 },
      })),
    }),
  );
  type Handle = Awaited<ReturnType<typeof launchInstalledTransaction>>;
  type Session = {
    ordinal: number;
    create: boolean;
    state: "launching" | "owned" | "unknown-no-handle";
    handle?: Handle;
    pid?: number | undefined;
    listenUrl?: string | undefined;
    binding?: ReturnType<typeof installedTransactionBinding>;
    exit?: { code: number | null; signal: NodeJS.Signals | null };
    closing?: Promise<void>;
    drained?: Promise<void>;
    closeEvent?: { code: number | null; signal: NodeJS.Signals | null };
    closed: boolean;
    stopUnknown: boolean;
  };
  const sessions: Session[] = [];
  const failures: { phase: string; error: unknown }[] = [];
  const pending = new Set<Promise<unknown>>();
  const localSensitivityControls: string[] = [];
  const requests: { ordinal: number; session: number; method: string; target: string }[] = [];
  const responses: unknown[] = [];
  let phase = "setup",
    cleanupStarted = false,
    abortedForCleanup = false,
    removed = false;
  let cleanupEnd: number | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let epoch: string | undefined;
  let events: Record<string, unknown>[] = [];
  let sseEvidence: unknown;
  let stream:
    | {
        recorder: ReturnType<typeof recordRawSse>;
        closing?: Promise<void>;
        drained: boolean;
      }
    | undefined;
  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise);
    // Both handlers are attached before any race; even a late failure is observed.
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  }
  function closeStream(): Promise<void> {
    if (!stream) return Promise.resolve();
    const owned = stream;
    owned.closing ??= track(
      owned.recorder.close().then(() => {
        owned.drained = true;
      }),
    );
    return owned.closing;
  }
  function closeSession(session: Session): Promise<void> {
    if (!session.handle) {
      session.stopUnknown = true;
      return Promise.reject(new Error("no returned child handle; stop unknown"));
    }
    const handle = session.handle;
    session.closing ??= track(
      handle.close().then(async () => {
        await session.drained;
        session.exit = { code: handle.child.exitCode, signal: handle.child.signalCode };
        if (
          session.exit.code !== 0 ||
          session.exit.signal !== null ||
          session.closeEvent?.code !== 0 ||
          session.closeEvent.signal !== null
        )
          throw new Error("child normal exit not established");
        session.closed = true;
      }),
    );
    return session.closing;
  }
  const workTimer = setTimeout(() => {
    // Initiate socket stop before abort causes the launcher's automatic child stop.
    void closeStream().catch(() => {});
    controller.abort(new Error("Scope Event SSE minimum work deadline"));
  }, 45000);
  async function bounded<T>(promise: Promise<T>, end: number, label: string): Promise<T> {
    track(promise);
    const remaining = end - performance.now();
    if (remaining <= 0) throw new Error(`${label}: deadline exhausted`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label}: deadline`)), remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function boundedDrain(promise: Promise<void>, end: number, label: string) {
    // A reporting bound, not evidence that helper kill/drain completed within ten seconds.
    await bounded(promise, end, label);
  }
  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("expected Event witness object");
    return value as Record<string, unknown>;
  }
  function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error("expected Event witness array");
    return value;
  }
  function sameEvent(actual: unknown, expected: unknown) {
    expect(actual).toEqual(expected);
  }
  function frameEvent(frame: string): unknown {
    const data = frame.split("\n").filter((line) => line.startsWith("data: "));
    expect(data).toHaveLength(1);
    return JSON.parse(data[0]!.slice(6));
  }
  function sameFrame(frame: string, expected: Record<string, unknown>) {
    const fields = frame.split("\n");
    expect(fields.filter((line) => line.startsWith("id: "))).toEqual([`id: ${expected.id}`]);
    expect(fields.filter((line) => line.startsWith("event: "))).toEqual([
      `event: ${expected.type}`,
    ]);
    sameEvent(frameEvent(frame), expected);
  }
  function idFrames(recorder: ReturnType<typeof recordRawSse>) {
    return recorder.frames.filter((frame) =>
      frame.split("\n").some((line) => line.startsWith("id: ")),
    );
  }
  function context(headers: Readonly<Record<string, string | undefined>>) {
    expect(headers["bdp-scope-position"]).toBe("pos-1");
    expect(headers["bdp-authorization-view"]).toBe("development-all-visible");
    expect(headers["bdp-scope-epoch"]).toEqual(expect.any(String));
    expect(headers["bdp-scope-epoch"]?.length).toBeGreaterThan(0);
    if (epoch === undefined) epoch = headers["bdp-scope-epoch"];
    else expect(headers["bdp-scope-epoch"]).toBe(epoch);
  }
  function beginRequest(session: Session, method: string, target: string) {
    controller.signal.throwIfAborted();
    if (cleanupStarted || performance.now() >= workEnd)
      throw new Error("request outside work budget");
    if (!session.handle || session.closed || session.closing)
      throw new Error("request without active owner");
    expect(requests.length).toBeLessThan(6);
    requests.push({ ordinal: requests.length + 1, session: session.ordinal, method, target });
  }
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
    ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
    const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
    ajv.addSchema(bundle);
    const validators = Object.fromEntries(
      ["mutationReceipt", "currentBeadRecord", "eventPage", "event", "transactionalProblem"].map(
        (name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })] as const,
      ),
    );
    function validate(name: string, value: unknown) {
      const validator = validators[name];
      if (!validator) throw new Error("missing Event witness schema");
      expect(validator(value), JSON.stringify(validator.errors)).toBe(true);
    }
    const installedConfiguration = (await bounded(
      import(
        pathToFileURL(path.join(path.dirname(entry), "transaction-runtime-configuration.js")).href
      ),
      workEnd,
      "installed configuration import",
    )) as typeof import("../../../packages/server/src/transaction-runtime-configuration.js");
    const digest = installedConfiguration.transactionRuntimeDigest;
    const associations = [
      {
        tokenDigest: digest({ revision: "transaction-credential-1", token }),
        principal: "writer",
        canMutate: true,
      },
    ];
    const expectedAuthentication = digest({
      revision: "transaction-authentication-1",
      scheme: "bearer",
      associations,
    });
    const expectedPolicy = digest({
      revision: "transaction-policy-1",
      view: "development-all-visible",
      read: "all-visible",
      aggregate: [],
      associations,
    });
    async function launch(create: boolean) {
      controller.signal.throwIfAborted();
      if (cleanupStarted || performance.now() >= workEnd)
        throw new Error("launch outside work budget");
      if (sessions.length >= 1) throw new Error("extra Event witness launch");
      const session: Session = {
        ordinal: sessions.length + 1,
        create,
        state: "launching",
        closed: false,
        stopUnknown: false,
      };
      sessions.push(session);
      const launching = track(
        launchInstalledTransaction(entry, { ...configuration, create }, controller.signal).then(
          (handle) => {
            session.handle = handle;
            session.pid = handle.child.pid;
            session.listenUrl =
              typeof handle.ready.listenUrl === "string" ? handle.ready.listenUrl : undefined;
            session.state = "owned";
            session.drained = track(
              new Promise<void>((resolve) => {
                handle.child.once("close", (code, signal) => {
                  session.closeEvent = { code, signal };
                  resolve();
                });
              }),
            );
            handle.child.once("exit", (code, signal) => {
              session.exit = { code, signal };
            });
            if (handle.child.exitCode !== null || handle.child.signalCode !== null)
              session.exit = { code: handle.child.exitCode, signal: handle.child.signalCode };
            if (cleanupStarted || controller.signal.aborted || performance.now() >= workEnd) {
              session.stopUnknown = true;
              void closeSession(session).catch(() => {});
            }
            return handle;
          },
          (error: unknown) => {
            session.state = "unknown-no-handle";
            session.stopUnknown = true;
            throw error;
          },
        ),
      );
      let handle: Handle;
      try {
        handle = await bounded(launching, workEnd, `launch ${session.ordinal}`);
      } catch (error) {
        session.stopUnknown = true;
        throw error;
      }
      controller.signal.throwIfAborted();
      expect(session.pid).toEqual(expect.any(Number));
      expect(session.pid).toBeGreaterThan(0);
      expect(handle.child.exitCode).toBeNull();
      expect(handle.child.signalCode).toBeNull();
      expect(handle.ready.scope).toBe(scope);
      expect(handle.ready.authenticationIdentity).toBe(expectedAuthentication);
      expect(handle.ready.policyIdentity).toBe(expectedPolicy);
      expect(handle.ready.runtimeConfigurationIdentity).toBe(
        digest({
          revision: "transaction-runtime-1",
          scope,
          artifactIdentity: handle.ready.artifactIdentity,
          settings: installedConfiguration.TRANSACTION_RUNTIME_DEFAULTS,
          authorityMode: "canonical",
          policyIdentity: expectedPolicy,
          authenticationIdentity: expectedAuthentication,
          profile: "transactional",
          history: false,
        }),
      );
      const actual = installedTransactionBinding(handle.ready, source, fixture);
      session.binding = actual;
      if (binding) expect(actual).toEqual(binding);
      else binding = actual;
      return session;
    }
    phase = "launch";
    const session = await launch(true);
    const handle = session.handle;
    if (!handle) throw new Error("missing returned child handle");
    const address = new URL(handle.ready.listenUrl as string);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [
            { method: "POST", url: `${scope}operations/batch` },
            { method: "GET", url: `${scope}events/` },
            { method: "HEAD", url: `${scope}events/` },
          ],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "writer",
          credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
        },
      },
    );
    async function finite(
      method: "GET" | "HEAD" | "POST",
      target: string,
      status: number,
      headers: [string, string][],
      body?: Uint8Array,
    ) {
      beginRequest(session, method, target);
      const response = await bounded(
        execute({
          method,
          url: new URL(target, scope).href,
          signal: controller.signal,
          credentialRef: "writer",
          raw: {
            headerLines: headers.map(([name, value]) => ({ name, value })),
            ...(body === undefined ? {} : { bodyBytes: body }),
          },
        }),
        workEnd,
        `request ${requests.length}`,
      );
      responses.push({
        ordinal: requests.length,
        session: session.ordinal,
        method,
        target,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: hash(response.bodyText),
        wireSha256: response.wireResponseBytes ? hash(response.wireResponseBytes) : undefined,
        headers: Object.fromEntries(
          [
            "content-type",
            "content-length",
            "cache-control",
            "retry-after",
            "bdp-scope-epoch",
            "bdp-authorization-view",
            "bdp-scope-position",
            "x-bdp-development",
          ].map((name) => [name, response.headers[name]] as const),
        ),
      });
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(
        response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
      ).toBe("reference.invalid");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(response.status, response.bodyText).toBe(status);
      expect(response.bodyOctets).toBe(Buffer.byteLength(response.bodyText));
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      context(response.headers);
      if (method === "HEAD") expect(response.bodyText).toBe("");
      return response;
    }
    phase = "seed";
    const seed = await finite(
      "POST",
      "operations/batch",
      200,
      [
        ["Content-Type", "application/json"],
        ["Accept", "application/json"],
        ["Idempotency-Key", seedKey],
      ],
      seedBytes,
    );
    expect(seed.headers["content-type"]).toBe("application/json");
    const receipt: unknown = JSON.parse(seed.bodyText);
    validate("mutationReceipt", receipt);
    const value = object(receipt);
    expect(value).toMatchObject({
      status: "completed",
      detail: "available",
      idempotencyKey: seedKey,
      effectPosition: "pos-1",
      requiredPosition: "pos-1",
      scopeEpoch: epoch,
      authorizationView: "development-all-visible",
      next: null,
    });
    expect(value.transaction).toEqual(expect.any(String));
    expect((value.transaction as string).length).toBeGreaterThan(0);
    const results = array(value.results).map(object);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ operationIndex: 0, outcome: "created" });
    const resource = object(results[0]!.resource);
    validate("currentBeadRecord", resource);
    expect(resource).toEqual({
      id: `${scope}beads/a`,
      type,
      revision: expect.any(String),
      properties: { n: 0 },
      metadata: {},
    });
    expect((resource.revision as string).length).toBeGreaterThan(0);
    phase = "finite baseline";
    const pageResponse = await finite("GET", "events/", 200, [["Accept", "application/json"]]);
    expect(pageResponse.headers["content-type"]).toBe("application/json");
    const page: unknown = JSON.parse(pageResponse.bodyText);
    validate("eventPage", page);
    expect(object(page)).toMatchObject({ source: `${scope}events/`, next: null });
    events = array(object(page).events).map(object);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    validate("event", event);
    expect(event).toEqual({
      id: expect.any(String),
      ordinal: 0,
      type: "created",
      source: `${scope}events/`,
      subject: resource.id,
      subjectType: type,
      transaction: value.transaction,
      time: expect.any(String),
      data: { revision: resource.revision, properties: { n: 0 }, metadata: {} },
    });
    expect((event.id as string).length).toBeGreaterThan(0);
    const minimum = (position: string): [string, string][] => [
      ["Accept", "text/event-stream"],
      ["BDP-Scope-Epoch", epoch!],
      ["BDP-Authorization-View", "development-all-visible"],
      ["BDP-Minimum-Scope-Position", position],
    ];
    const known = minimum("pos-1");
    phase = "known HEAD";
    const head = await finite("HEAD", "events/", 200, known);
    expect(head.headers["content-type"]).toBe("text/event-stream");
    expect(head.headers["cache-control"]).toBe("no-store, no-transform");
    expect(head.headers["content-length"]).toBeUndefined();
    expect(head.headers["etag"]).toBeUndefined();
    const opaque: [string, string][] = [...minimum("unknown"), ["If-None-Match", "*"]];
    phase = "opaque conditional GET";
    const refused = await finite("GET", "events/", 503, opaque);
    const problem: unknown = JSON.parse(refused.bodyText);
    validate("transactionalProblem", problem);
    expect(problem).toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      status: 503,
      code: "catch-up-timeout",
      retry: "after-delay",
    });
    phase = "opaque conditional HEAD";
    const refusedHead = await finite("HEAD", "events/", 503, opaque);
    for (const response of [refused, refusedHead]) {
      expect(response.headers["content-type"]).toBe("application/problem+json");
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["etag"]).toBeUndefined();
      expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
    }
    expect(refusedHead.headers["content-length"]).toBe(String(Buffer.byteLength(refused.bodyText)));
    expect(refusedHead.headers["content-length"]).toBe(refused.headers["content-length"]);
    phase = "known live stream";
    beginRequest(session, "GET", "events/");
    const recorder = recordRawSse({
      dial: handle.ready.listenUrl as string,
      host: "reference.invalid",
      target: "/acme/events/",
      headers: [["Authorization", `Bearer ${token}`], ...known],
      signal: controller.signal,
      timeoutMs: 5000,
    });
    stream = { recorder, drained: false };
    track(recorder.closed);
    await bounded(recorder.ready, workEnd, "SSE ready");
    expect(recorder.status).toBe(200);
    expect(recorder.headers).toMatchObject({
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      "x-bdp-development": "non-attesting",
    });
    expect(recorder.headers["content-length"]).toBeUndefined();
    expect(recorder.headers["etag"]).toBeUndefined();
    context(recorder.headers);
    await bounded(
      recorder.until(() => idFrames(recorder).length >= 1),
      workEnd,
      "SSE Event",
    );
    const beforeClose = [...idFrames(recorder)];
    expect(beforeClose).toHaveLength(1);
    sameFrame(beforeClose[0]!, event);
    expect(() => sameFrame(beforeClose[0]!, { ...event, ordinal: 1 })).toThrow();
    localSensitivityControls.push("frame-event-identity");
    expect(controller.signal.aborted).toBe(false);
    expect(recorder.destroyed).toBe(false);
    expect(recorder.elapsedMs).toBeLessThan(5000);
    const liveBeforeClose = {
      aborted: controller.signal.aborted,
      destroyed: recorder.destroyed,
      elapsedMs: recorder.elapsedMs,
    };
    // One cleanup envelope begins at intentional stream stop and includes child drain below.
    cleanupStarted = true;
    cleanupEnd = performance.now() + 10000;
    await boundedDrain(closeStream(), cleanupEnd, "intentional SSE drain");
    const afterDrain = idFrames(recorder);
    expect(afterDrain).toEqual(beforeClose);
    sameFrame(afterDrain[0]!, event);
    sseEvidence = {
      requestOrdinal: 6,
      status: recorder.status,
      headers: { ...recorder.headers },
      framesBeforeClose: beforeClose,
      completeObservedFrames: afterDrain,
      liveBeforeClose,
      drained: stream.drained,
      wireBytes: recorder.wireBytes.length,
      wireSha256: hash(recorder.wireBytes),
    };
    expect(requests.map(({ method }) => method)).toEqual([
      "POST",
      "GET",
      "HEAD",
      "GET",
      "HEAD",
      "GET",
    ]);
    expect(responses).toHaveLength(5);
    controller.signal.throwIfAborted();
    if (performance.now() >= workEnd) throw new Error("Scope SSE minimum work exceeded budget");
  } catch (error) {
    failures.push({ phase, error });
  } finally {
    cleanupStarted = true;
    clearTimeout(workTimer);
    cleanupEnd ??= performance.now() + 10000;
    try {
      await boundedDrain(closeStream(), cleanupEnd, "final stream drain");
    } catch (error) {
      failures.push({ phase: "stream cleanup", error });
    }
    if (failures.length && !controller.signal.aborted) {
      abortedForCleanup = true;
      controller.abort(new Error("Scope Event SSE minimum observation failed"));
    }
    for (const session of sessions) {
      if (!session.handle) {
        session.stopUnknown = true;
        failures.push({
          phase: `child ${session.ordinal} cleanup`,
          error: new Error("launch stop unknown-no-handle"),
        });
        continue;
      }
      try {
        await boundedDrain(closeSession(session), cleanupEnd, `child ${session.ordinal} drain`);
      } catch (error) {
        session.stopUnknown = true;
        failures.push({ phase: `child ${session.ordinal} cleanup`, error });
      }
    }
    if (controller.signal.aborted && !abortedForCleanup)
      failures.push({ phase: "work signal", error: controller.signal.reason });
    try {
      expect(sessions).toHaveLength(1);
      expect(sessions.map((session) => session.create)).toEqual([true]);
      for (const session of sessions) {
        expect(session.state).toBe("owned");
        expect(session.stopUnknown).toBe(false);
        expect(session.closed).toBe(true);
        expect(session.exit).toEqual({ code: 0, signal: null });
        expect(session.closeEvent).toEqual({ code: 0, signal: null });
      }
      expect(stream?.drained).toBe(true);
      expect(pending.size).toBe(0);
    } catch (error) {
      failures.push({ phase: "ownership proof", error });
    }
    // Any semantic or ownership failure preserves the store for separate diagnosis.
    if (failures.length === 0) {
      try {
        rmSync(directory, { recursive: true, force: false });
        removed = true;
      } catch (error) {
        failures.push({ phase: "directory cleanup", error });
      }
    }
    const reportedStream = stream;
    console.log(
      JSON.stringify({
        observation: "private-installed-scope-event-sse-opaque-minimum",
        attribution,
        installedProvenance:
          attribution === "external-installed-candidate"
            ? "requires separately verified external package/consumer/source binding"
            : "none; development fallback is not installed evidence",
        claimEligible: false,
        outcome: failures.length ? "failed" : "passed",
        declaredSourceCommit: source,
        witnessSource,
        entry,
        entrySha256: hash(readFileSync(entry)),
        binding,
        node: process.version,
        seedBodySha256: hash(seedBytes),
        seedBodyBytes: seedBytes.length,
        seedKey,
        deadlines: {
          work: 45000,
          cleanup: 10000,
          callback: 60000,
          outerSupervisor: 120000,
          finite: 5000,
          recorder: 5000,
        },
        requests,
        completedFiniteResponses: responses,
        localSensitivityControls,
        baselineEvents: events,
        sse: sseEvidence,
        // Preserve available safe transport facts even when assertions failed before success evidence.
        streamAtReport: reportedStream
          ? {
              status: reportedStream.recorder.status,
              headers: Object.fromEntries(
                [
                  "content-type",
                  "cache-control",
                  "bdp-scope-epoch",
                  "bdp-authorization-view",
                  "bdp-scope-position",
                ].map((name) => [name, reportedStream.recorder.headers[name]] as const),
              ),
              wireBytes: reportedStream.recorder.wireBytes.length,
              wireSha256: hash(reportedStream.recorder.wireBytes),
              completeObservedFrames: idFrames(reportedStream.recorder),
              drained: reportedStream.drained,
              destroyed: reportedStream.recorder.destroyed,
            }
          : undefined,
        sessions: sessions.map((session) => ({
          ordinal: session.ordinal,
          create: session.create,
          state: session.state,
          pid: session.pid,
          listenUrl: session.listenUrl,
          binding: session.binding,
          exit: session.exit,
          closeEvent: session.closeEvent,
          closed: session.closed,
          stopUnknown: session.stopUnknown,
        })),
        pendingOperationsAtReport: pending.size,
        directory,
        directoryRemoved: removed,
        failures: failures.map(({ phase, error }) => ({
          phase,
          name:
            error instanceof Error
              ? error.name.replaceAll(token, "[credential redacted]")
              : "non-Error",
          message: safeFailureMessage(error),
        })),
        diagnosticLimit:
          "startup helper may expose only generic error and no returned handle; no private child trace claimed",
        supervisorAcceptanceRequired:
          "isolated owned group; no survivors or forced cleanup; intervention always fails",
      }),
    );
  }
  if (failures.length)
    throw new AggregateError(
      failures.map(({ phase, error }) => new Error(`${phase}: ${safeFailureMessage(error)}`)),
      "Scope Event SSE minimum observation or cleanup failed",
    );
}, 60000);

it("observes installed current Event replay minimum admission across sources", async () => {
  // The full suite executes this same witness locally; only externally bound artifacts
  // can supply installed attribution. A declared source string alone proves no provenance.
  const entryOverride = process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY;
  const sourceOverride = process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT;
  const hasEntryOverride = entryOverride !== undefined;
  const hasSourceOverride = sourceOverride !== undefined;
  if (hasEntryOverride !== hasSourceOverride)
    throw new Error("Event replay minimum overrides must include both installed entry and source");
  expect(source).toMatch(/^[0-9a-f]{40}$/);
  const attribution = hasEntryOverride ? "external-installed-candidate" : "development-local";
  if (hasEntryOverride) {
    if (!entryOverride || !sourceOverride || !/^[0-9a-f]{40}$/.test(sourceOverride))
      throw new Error(
        "Event replay minimum installed overrides must be nonempty and source must be a commit",
      );
    const installedRelative = path.relative(realpathSync(root), entry);
    if (!installedRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(installedRelative))
      throw new Error("Event replay minimum installed attribution requires an external entry");
  }
  const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const witnessPath = fileURLToPath(import.meta.url);
  const witnessSource = {
    fingerprintScope:
      "witness file bytes and tracked working-tree diff only; excludes untracked inputs and installed payload provenance",
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    fileSha256: hash(readFileSync(witnessPath)),
    diffSha256: hash(execFileSync("git", ["diff", "HEAD"], { cwd: root })),
    dirtyPaths: execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean),
  };
  const controller = new AbortController();
  const started = performance.now(),
    workEnd = started + 45000;
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-event-replay-minimum-installed-"));
  const token = randomBytes(32).toString("base64url");
  function safeFailureMessage(error: unknown): string {
    return (error instanceof Error ? error.message : "non-Error failure").replaceAll(
      token,
      "[credential redacted]",
    );
  }
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts: {
      descriptors: artifacts.descriptors.map((value) => ({ ...value })),
      schemas: artifacts.schemas.map((value) => ({ ...value })),
    },
    credentials: [{ token, principal: "writer", canMutate: true }],
  };
  const seedKey = "event-replay-minimum-three-operations-v1";
  const seedBytes = Buffer.from(
    JSON.stringify({
      operations: [
        ...["a", "b"].map((id) => ({
          operation: "createBead",
          id: `beads/${id}`,
          type,
          properties: { n: 0 },
        })),
        {
          operation: "createLink",
          id: "links/l",
          type: `${scope}types/link`,
          source: "beads/a",
          target: "beads/b",
          properties: { n: 0 },
        },
      ],
    }),
  );
  type Handle = Awaited<ReturnType<typeof launchInstalledTransaction>>;
  type Session = {
    ordinal: number;
    create: boolean;
    state: "launching" | "owned" | "unknown-no-handle";
    handle?: Handle;
    pid?: number | undefined;
    listenUrl?: string | undefined;
    binding?: ReturnType<typeof installedTransactionBinding>;
    exit?: { code: number | null; signal: NodeJS.Signals | null };
    closing?: Promise<void>;
    drained?: Promise<void>;
    closeEvent?: { code: number | null; signal: NodeJS.Signals | null };
    closed: boolean;
    stopUnknown: boolean;
  };
  const sessions: Session[] = [];
  const failures: { phase: string; error: unknown }[] = [];
  const pending = new Set<Promise<unknown>>();
  const localSensitivityControls: string[] = [];
  const requests: { ordinal: number; session: number; method: string; target: string }[] = [];
  const responses: unknown[] = [];
  let phase = "setup",
    cleanupStarted = false,
    abortedForCleanup = false,
    removed = false;
  let cleanupEnd: number | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let epoch: string | undefined;
  let events: Record<string, unknown>[] = [];
  let sseEvidence: unknown;
  let stream:
    | {
        recorder: ReturnType<typeof recordRawSse>;
        closing?: Promise<void>;
        drained: boolean;
      }
    | undefined;
  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise);
    // Both handlers are attached before any race; even a late failure is observed.
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  }
  function closeStream(): Promise<void> {
    if (!stream) return Promise.resolve();
    const owned = stream;
    owned.closing ??= track(
      owned.recorder.close().then(() => {
        owned.drained = true;
      }),
    );
    return owned.closing;
  }
  function closeSession(session: Session): Promise<void> {
    if (!session.handle) {
      session.stopUnknown = true;
      return Promise.reject(new Error("no returned child handle; stop unknown"));
    }
    const handle = session.handle;
    session.closing ??= track(
      handle.close().then(async () => {
        await session.drained;
        session.exit = { code: handle.child.exitCode, signal: handle.child.signalCode };
        if (
          session.exit.code !== 0 ||
          session.exit.signal !== null ||
          session.closeEvent?.code !== 0 ||
          session.closeEvent.signal !== null
        )
          throw new Error("child normal exit not established");
        session.closed = true;
      }),
    );
    return session.closing;
  }
  const workTimer = setTimeout(() => {
    // Initiate socket stop before abort causes the launcher's automatic child stop.
    void closeStream().catch(() => {});
    controller.abort(new Error("Event replay minimum work deadline"));
  }, 45000);
  async function bounded<T>(promise: Promise<T>, end: number, label: string): Promise<T> {
    track(promise);
    const remaining = end - performance.now();
    if (remaining <= 0) throw new Error(`${label}: deadline exhausted`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label}: deadline`)), remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function boundedDrain(promise: Promise<void>, end: number, label: string) {
    // A reporting bound, not evidence that helper kill/drain completed within ten seconds.
    await bounded(promise, end, label);
  }
  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("expected Event witness object");
    return value as Record<string, unknown>;
  }
  function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error("expected Event witness array");
    return value;
  }
  function sameEvent(actual: unknown, expected: unknown) {
    expect(actual).toEqual(expected);
  }
  function frameEvent(frame: string): unknown {
    const data = frame.split("\n").filter((line) => line.startsWith("data: "));
    expect(data).toHaveLength(1);
    return JSON.parse(data[0]!.slice(6));
  }
  function sameFrame(frame: string, expected: Record<string, unknown>) {
    const fields = frame.split("\n");
    expect(fields.filter((line) => line.startsWith("id: "))).toEqual([`id: ${expected.id}`]);
    expect(fields.filter((line) => line.startsWith("event: "))).toEqual([
      `event: ${expected.type}`,
    ]);
    sameEvent(frameEvent(frame), expected);
  }
  function idFrames(recorder: ReturnType<typeof recordRawSse>) {
    return recorder.frames.filter((frame) =>
      frame.split("\n").some((line) => line.startsWith("id: ")),
    );
  }
  function context(headers: Readonly<Record<string, string | undefined>>) {
    expect(headers["bdp-scope-position"]).toBe("pos-1");
    expect(headers["bdp-authorization-view"]).toBe("development-all-visible");
    expect(headers["bdp-scope-epoch"]).toEqual(expect.any(String));
    expect(headers["bdp-scope-epoch"]?.length).toBeGreaterThan(0);
    if (epoch === undefined) epoch = headers["bdp-scope-epoch"];
    else expect(headers["bdp-scope-epoch"]).toBe(epoch);
  }
  function beginRequest(session: Session, method: string, target: string) {
    controller.signal.throwIfAborted();
    if (cleanupStarted || performance.now() >= workEnd)
      throw new Error("request outside work budget");
    if (!session.handle || session.closed || session.closing)
      throw new Error("request without active owner");
    expect(requests.length).toBeLessThan(10);
    requests.push({ ordinal: requests.length + 1, session: session.ordinal, method, target });
  }
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
    ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
    const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
    ajv.addSchema(bundle);
    const validators = Object.fromEntries(
      [
        "mutationReceipt",
        "currentBeadRecord",
        "currentLinkRecord",
        "eventPage",
        "event",
        "transactionalProblem",
      ].map((name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })] as const),
    );
    function validate(name: string, value: unknown) {
      const validator = validators[name];
      if (!validator) throw new Error("missing Event witness schema");
      expect(validator(value), JSON.stringify(validator.errors)).toBe(true);
    }
    const installedConfiguration = (await bounded(
      import(
        pathToFileURL(path.join(path.dirname(entry), "transaction-runtime-configuration.js")).href
      ),
      workEnd,
      "installed configuration import",
    )) as typeof import("../../../packages/server/src/transaction-runtime-configuration.js");
    const digest = installedConfiguration.transactionRuntimeDigest;
    const associations = [
      {
        tokenDigest: digest({ revision: "transaction-credential-1", token }),
        principal: "writer",
        canMutate: true,
      },
    ];
    const expectedAuthentication = digest({
      revision: "transaction-authentication-1",
      scheme: "bearer",
      associations,
    });
    const expectedPolicy = digest({
      revision: "transaction-policy-1",
      view: "development-all-visible",
      read: "all-visible",
      aggregate: [],
      associations,
    });
    async function launch(create: boolean) {
      controller.signal.throwIfAborted();
      if (cleanupStarted || performance.now() >= workEnd)
        throw new Error("launch outside work budget");
      if (sessions.length >= 1) throw new Error("extra Event witness launch");
      const session: Session = {
        ordinal: sessions.length + 1,
        create,
        state: "launching",
        closed: false,
        stopUnknown: false,
      };
      sessions.push(session);
      const launching = track(
        launchInstalledTransaction(entry, { ...configuration, create }, controller.signal).then(
          (handle) => {
            session.handle = handle;
            session.pid = handle.child.pid;
            session.listenUrl =
              typeof handle.ready.listenUrl === "string" ? handle.ready.listenUrl : undefined;
            session.state = "owned";
            session.drained = track(
              new Promise<void>((resolve) => {
                handle.child.once("close", (code, signal) => {
                  session.closeEvent = { code, signal };
                  resolve();
                });
              }),
            );
            handle.child.once("exit", (code, signal) => {
              session.exit = { code, signal };
            });
            if (handle.child.exitCode !== null || handle.child.signalCode !== null)
              session.exit = { code: handle.child.exitCode, signal: handle.child.signalCode };
            if (cleanupStarted || controller.signal.aborted || performance.now() >= workEnd) {
              session.stopUnknown = true;
              void closeSession(session).catch(() => {});
            }
            return handle;
          },
          (error: unknown) => {
            session.state = "unknown-no-handle";
            session.stopUnknown = true;
            throw error;
          },
        ),
      );
      let handle: Handle;
      try {
        handle = await bounded(launching, workEnd, `launch ${session.ordinal}`);
      } catch (error) {
        session.stopUnknown = true;
        throw error;
      }
      controller.signal.throwIfAborted();
      expect(session.pid).toEqual(expect.any(Number));
      expect(session.pid).toBeGreaterThan(0);
      expect(handle.child.exitCode).toBeNull();
      expect(handle.child.signalCode).toBeNull();
      expect(handle.ready.scope).toBe(scope);
      expect(handle.ready.authenticationIdentity).toBe(expectedAuthentication);
      expect(handle.ready.policyIdentity).toBe(expectedPolicy);
      expect(handle.ready.runtimeConfigurationIdentity).toBe(
        digest({
          revision: "transaction-runtime-1",
          scope,
          artifactIdentity: handle.ready.artifactIdentity,
          settings: installedConfiguration.TRANSACTION_RUNTIME_DEFAULTS,
          authorityMode: "canonical",
          policyIdentity: expectedPolicy,
          authenticationIdentity: expectedAuthentication,
          profile: "transactional",
          history: false,
        }),
      );
      const actual = installedTransactionBinding(handle.ready, source, fixture);
      session.binding = actual;
      if (binding) expect(actual).toEqual(binding);
      else binding = actual;
      return session;
    }
    phase = "launch";
    const session = await launch(true);
    const handle = session.handle;
    if (!handle) throw new Error("missing returned child handle");
    const address = new URL(handle.ready.listenUrl as string);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [
            { method: "POST", url: `${scope}operations/batch` },
            { method: "GET", url: `${scope}events/` },
            { method: "GET", url: `${scope}beads/a?view=events` },
            { method: "GET", url: `${scope}links/l?view=events` },
          ],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "writer",
          credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
        },
      },
    );
    async function finite(
      method: "GET" | "HEAD" | "POST",
      target: string,
      status: number,
      headers: [string, string][],
      body?: Uint8Array,
    ) {
      beginRequest(session, method, target);
      const response = await bounded(
        execute({
          method,
          url: new URL(target, scope).href,
          signal: controller.signal,
          credentialRef: "writer",
          raw: {
            headerLines: headers.map(([name, value]) => ({ name, value })),
            ...(body === undefined ? {} : { bodyBytes: body }),
          },
        }),
        workEnd,
        `request ${requests.length}`,
      );
      responses.push({
        ordinal: requests.length,
        session: session.ordinal,
        method,
        target,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: hash(response.bodyText),
        wireSha256: response.wireResponseBytes ? hash(response.wireResponseBytes) : undefined,
        headers: Object.fromEntries(
          [
            "content-type",
            "content-length",
            "cache-control",
            "retry-after",
            "bdp-scope-epoch",
            "bdp-authorization-view",
            "bdp-scope-position",
            "x-bdp-development",
          ].map((name) => [name, response.headers[name]] as const),
        ),
      });
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(
        response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
      ).toBe("reference.invalid");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(response.status, response.bodyText).toBe(status);
      expect(response.bodyOctets).toBe(Buffer.byteLength(response.bodyText));
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      context(response.headers);
      if (method === "HEAD") expect(response.bodyText).toBe("");
      return response;
    }
    phase = "seed";
    const seed = await finite(
      "POST",
      "operations/batch",
      200,
      [
        ["Content-Type", "application/json"],
        ["Accept", "application/json"],
        ["Idempotency-Key", seedKey],
      ],
      seedBytes,
    );
    expect(seed.headers["content-type"]).toBe("application/json");
    const receipt: unknown = JSON.parse(seed.bodyText);
    validate("mutationReceipt", receipt);
    const value = object(receipt);
    expect(value).toMatchObject({
      status: "completed",
      detail: "available",
      idempotencyKey: seedKey,
      effectPosition: "pos-1",
      requiredPosition: "pos-1",
      scopeEpoch: epoch,
      authorizationView: "development-all-visible",
      next: null,
    });
    expect(value.transaction).toEqual(expect.any(String));
    expect((value.transaction as string).length).toBeGreaterThan(0);
    const results = array(value.results).map(object);
    expect(results).toHaveLength(3);
    for (const [index, result] of results.entries()) {
      expect(result).toMatchObject({ operationIndex: index, outcome: "created" });
      const resource = object(result.resource);
      validate(index === 2 ? "currentLinkRecord" : "currentBeadRecord", resource);
      expect(resource.id).toBe(
        `${scope}${index === 2 ? "links/l" : index === 0 ? "beads/a" : "beads/b"}`,
      );
      expect(resource.type).toBe(index === 2 ? `${scope}types/link` : type);
      expect(resource.revision).toEqual(expect.any(String));
    }
    phase = "finite baselines";
    const histories: Record<string, Record<string, unknown>[]> = {};
    for (const [kind, target, count] of [
      ["scope", "events/", 5],
      ["bead", "beads/a?view=events", 2],
      ["link", "links/l?view=events", 1],
    ] as const) {
      const response = await finite("GET", target, 200, [["Accept", "application/json"]]);
      expect(response.headers["content-type"]).toBe("application/json");
      const page: unknown = JSON.parse(response.bodyText);
      validate("eventPage", page);
      expect(object(page)).toMatchObject({ source: `${scope}${target}`, next: null });
      const observed = array(object(page).events).map(object);
      expect(observed).toHaveLength(count);
      for (const event of observed) {
        validate("event", event);
        expect(event).toMatchObject({
          source: `${scope}${target}`,
          transaction: value.transaction,
        });
        expect(event.id).toEqual(expect.any(String));
      }
      histories[kind] = observed;
      events.push(...observed);
    }
    const minimum = (position: string, media = "text/event-stream"): [string, string][] => [
      ["Accept", media],
      ["BDP-Scope-Epoch", epoch!],
      ["BDP-Authorization-View", "development-all-visible"],
      ["BDP-Minimum-Scope-Position", position],
    ];
    async function refusedRaw(target: string, headers: [string, string][]) {
      beginRequest(session, "GET", target);
      const recorder = recordRawSse({
        dial: handle!.ready.listenUrl as string,
        host: "reference.invalid",
        target: `/acme/${target}`,
        headers: [["Authorization", `Bearer ${token}`], ...headers],
        signal: controller.signal,
        timeoutMs: 5000,
      });
      stream = { recorder, drained: false };
      const owned = stream;
      const drained = track(
        recorder.closed.then(() => {
          owned.drained = true;
        }),
      );
      const ready = track(recorder.ready);
      await bounded(ready, workEnd, "refusal ready");
      await bounded(drained, workEnd, "refusal natural drain");
      expect(recorder.status).toBe(503);
      context(recorder.headers);
      expect(recorder.headers).toMatchObject({
        "content-type": "application/problem+json",
        "retry-after": "1",
        "cache-control": "private, no-store",
        "x-bdp-development": "non-attesting",
      });
      expect(recorder.headers["content-length"]).toBe(String(Buffer.byteLength(recorder.body)));
      expect(recorder.headers["etag"]).toBeUndefined();
      expect(recorder.headers["x-bdp-development-limit"]).toBeUndefined();
      expect(recorder.frames).toHaveLength(0);
      const problem: unknown = JSON.parse(recorder.body);
      validate("transactionalProblem", problem);
      expect(problem).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/unavailable",
        status: 503,
        code: "catch-up-timeout",
        retry: "after-delay",
      });
      responses.push({
        ordinal: requests.length,
        session: session.ordinal,
        method: "GET",
        target,
        status: recorder.status,
        bodyOctets: Buffer.byteLength(recorder.body),
        bodySha256: hash(recorder.body),
        wireSha256: hash(recorder.wireBytes),
        headers: { ...recorder.headers },
        completeObservedFrames: idFrames(recorder),
        drained: owned.drained,
      });
    }
    phase = "opaque current admissions";
    await refusedRaw("beads/a?view=events", minimum("unknown"));
    await refusedRaw("links/l?view=events", minimum("unknown"));
    await refusedRaw(
      `events/?after=${encodeURIComponent(histories.scope![0]!.id as string)}`,
      minimum("unknown", "application/json"),
    );
    await refusedRaw("links/l?view=events", [
      ...minimum("unknown"),
      ["Last-Event-ID", histories.link![0]!.id as string],
    ]);
    await refusedRaw("beads/a?view=events", [
      ...minimum("unknown", "application/json"),
      ["Last-Event-ID", ""],
      ["Last-Event-ID", "malformed"],
    ]);
    const event = histories.bead![1]!;
    const positiveTarget = `beads/a?view=events&after=${encodeURIComponent(histories.scope![0]!.id as string)}`;
    const known: [string, string][] = [
      ...minimum("pos-1"),
      ["Last-Event-ID", histories.bead![0]!.id as string],
    ];
    phase = "known live stream";
    beginRequest(session, "GET", positiveTarget);
    const recorder = recordRawSse({
      dial: handle.ready.listenUrl as string,
      host: "reference.invalid",
      target: `/acme/${positiveTarget}`,
      headers: [["Authorization", `Bearer ${token}`], ...known],
      signal: controller.signal,
      timeoutMs: 5000,
    });
    stream = { recorder, drained: false };
    track(recorder.closed);
    await bounded(recorder.ready, workEnd, "SSE ready");
    expect(recorder.status).toBe(200);
    expect(recorder.headers).toMatchObject({
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      "x-bdp-development": "non-attesting",
    });
    expect(recorder.headers["content-length"]).toBeUndefined();
    expect(recorder.headers["etag"]).toBeUndefined();
    context(recorder.headers);
    await bounded(
      recorder.until(() => idFrames(recorder).length >= 1),
      workEnd,
      "SSE Event",
    );
    const beforeClose = [...idFrames(recorder)];
    expect(beforeClose).toHaveLength(1);
    sameFrame(beforeClose[0]!, event);
    expect(() => sameFrame(beforeClose[0]!, { ...event, ordinal: 1 })).toThrow();
    localSensitivityControls.push("frame-event-identity");
    expect(controller.signal.aborted).toBe(false);
    expect(recorder.destroyed).toBe(false);
    expect(recorder.elapsedMs).toBeLessThan(5000);
    const liveBeforeClose = {
      aborted: controller.signal.aborted,
      destroyed: recorder.destroyed,
      elapsedMs: recorder.elapsedMs,
    };
    // One cleanup envelope begins at intentional stream stop and includes child drain below.
    cleanupStarted = true;
    cleanupEnd = performance.now() + 10000;
    await boundedDrain(closeStream(), cleanupEnd, "intentional SSE drain");
    const afterDrain = idFrames(recorder);
    expect(afterDrain).toEqual(beforeClose);
    sameFrame(afterDrain[0]!, event);
    sseEvidence = {
      requestOrdinal: 10,
      status: recorder.status,
      headers: { ...recorder.headers },
      framesBeforeClose: beforeClose,
      completeObservedFrames: afterDrain,
      liveBeforeClose,
      drained: stream.drained,
      wireBytes: recorder.wireBytes.length,
      wireSha256: hash(recorder.wireBytes),
    };
    expect(requests.map(({ method }) => method)).toEqual(["POST", ...Array<string>(9).fill("GET")]);
    expect(requests).toHaveLength(10);
    expect(responses).toHaveLength(9);
    controller.signal.throwIfAborted();
    if (performance.now() >= workEnd) throw new Error("Event replay minimum work exceeded budget");
  } catch (error) {
    failures.push({ phase, error });
  } finally {
    cleanupStarted = true;
    clearTimeout(workTimer);
    cleanupEnd ??= performance.now() + 10000;
    try {
      await boundedDrain(closeStream(), cleanupEnd, "final stream drain");
    } catch (error) {
      failures.push({ phase: "stream cleanup", error });
    }
    if (failures.length && !controller.signal.aborted) {
      abortedForCleanup = true;
      controller.abort(new Error("Event replay minimum observation failed"));
    }
    for (const session of sessions) {
      if (!session.handle) {
        session.stopUnknown = true;
        failures.push({
          phase: `child ${session.ordinal} cleanup`,
          error: new Error("launch stop unknown-no-handle"),
        });
        continue;
      }
      try {
        await boundedDrain(closeSession(session), cleanupEnd, `child ${session.ordinal} drain`);
      } catch (error) {
        session.stopUnknown = true;
        failures.push({ phase: `child ${session.ordinal} cleanup`, error });
      }
    }
    if (controller.signal.aborted && !abortedForCleanup)
      failures.push({ phase: "work signal", error: controller.signal.reason });
    try {
      expect(sessions).toHaveLength(1);
      expect(sessions.map((session) => session.create)).toEqual([true]);
      for (const session of sessions) {
        expect(session.state).toBe("owned");
        expect(session.stopUnknown).toBe(false);
        expect(session.closed).toBe(true);
        expect(session.exit).toEqual({ code: 0, signal: null });
        expect(session.closeEvent).toEqual({ code: 0, signal: null });
      }
      expect(stream?.drained).toBe(true);
      expect(pending.size).toBe(0);
    } catch (error) {
      failures.push({ phase: "ownership proof", error });
    }
    // Any semantic or ownership failure preserves the store for separate diagnosis.
    if (failures.length === 0) {
      try {
        rmSync(directory, { recursive: true, force: false });
        removed = true;
      } catch (error) {
        failures.push({ phase: "directory cleanup", error });
      }
    }
    const reportedStream = stream;
    console.log(
      JSON.stringify({
        observation: "private-installed-event-admission-replay-minimum",
        attribution,
        installedProvenance:
          attribution === "external-installed-candidate"
            ? "requires separately verified external package/consumer/source binding"
            : "none; development fallback is not installed evidence",
        claimEligible: false,
        outcome: failures.length ? "failed" : "passed",
        declaredSourceCommit: source,
        witnessSource,
        entryLiteral:
          entryOverride ?? path.join(root, "packages/server/dist/transaction-installed-process.js"),
        entry,
        entrySha256: hash(readFileSync(entry)),
        binding,
        node: process.version,
        seedBodySha256: hash(seedBytes),
        seedBodyBytes: seedBytes.length,
        seedKey,
        deadlines: {
          work: 45000,
          cleanup: 10000,
          callback: 60000,
          outerSupervisor: 120000,
          finite: 5000,
          recorder: 5000,
        },
        requests,
        completedFiniteResponses: responses,
        localSensitivityControls,
        baselineEvents: events,
        sse: sseEvidence,
        // Preserve available safe transport facts even when assertions failed before success evidence.
        streamAtReport: reportedStream
          ? {
              status: reportedStream.recorder.status,
              headers: Object.fromEntries(
                [
                  "content-type",
                  "cache-control",
                  "bdp-scope-epoch",
                  "bdp-authorization-view",
                  "bdp-scope-position",
                ].map((name) => [name, reportedStream.recorder.headers[name]] as const),
              ),
              wireBytes: reportedStream.recorder.wireBytes.length,
              wireSha256: hash(reportedStream.recorder.wireBytes),
              completeObservedFrames: idFrames(reportedStream.recorder),
              drained: reportedStream.drained,
              destroyed: reportedStream.recorder.destroyed,
            }
          : undefined,
        sessions: sessions.map((session) => ({
          ordinal: session.ordinal,
          create: session.create,
          state: session.state,
          pid: session.pid,
          listenUrl: session.listenUrl,
          binding: session.binding,
          exit: session.exit,
          closeEvent: session.closeEvent,
          closed: session.closed,
          stopUnknown: session.stopUnknown,
        })),
        pendingOperationsAtReport: pending.size,
        directory,
        directoryRemoved: removed,
        failures: failures.map(({ phase, error }) => ({
          phase,
          name:
            error instanceof Error
              ? error.name.replaceAll(token, "[credential redacted]")
              : "non-Error",
          message: safeFailureMessage(error),
        })),
        diagnosticLimit:
          "startup helper may expose only generic error and no returned handle; no private child trace claimed",
        supervisorAcceptanceRequired:
          "isolated owned group; no survivors or forced cleanup; intervention always fails",
      }),
    );
  }
  if (failures.length)
    throw new AggregateError(
      failures.map(({ phase, error }) => new Error(`${phase}: ${safeFailureMessage(error)}`)),
      "Event replay minimum observation or cleanup failed",
    );
}, 60000);
