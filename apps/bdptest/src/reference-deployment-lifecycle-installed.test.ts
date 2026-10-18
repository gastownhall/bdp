/** Private intended-listener observations; six TX cold cases require final combined D3a. */
import { it, expect } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer, connect, type Socket } from "node:net";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import {
  parseReadUpdateDiscovery,
  parseReadUpdateOperationDirectory,
  parseReadUpdateMutationResult,
  parseTransactionalDiscovery,
  parseTransactionalOperationDirectory,
  isJsonSchemaUri,
  isJsonSchemaDateTime,
} from "@bdp/protocol";

type Profile = "read-update" | "transactional";
type Role = "writer" | "reader" | "anonymous" | "old-writer";
type End = { code: number | null; signal: NodeJS.Signals | null };
type Session = {
  child: ChildProcess;
  category: "candidate" | "public" | "guard";
  ordinal: number;
  exit: End | null;
  close: End | null;
  exited: Promise<End>;
  closed: Promise<End>;
  ready: Record<string, unknown> | null;
  messages: unknown[];
  stdout: string;
  stderr: string;
  outputBytes: number;
};
type Reply = { status: number; headers: Readonly<Record<string, string>>; bodyText: string };
type ColdClient = {
  scope: string;
  type: string;
  send(
    label: string,
    method: "GET" | "HEAD" | "POST",
    url: string,
    status: number | readonly number[],
    role?: Role,
    body?: unknown,
    key?: string,
  ): Promise<Reply>;
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("expected received object");
  return value as Record<string, unknown>;
}
function local(value: string, scope: string) {
  const target = new URL(value, scope),
    root = new URL(scope);
  if (
    target.origin !== root.origin ||
    !target.pathname.startsWith(root.pathname) ||
    target.username ||
    target.password ||
    target.hash
  )
    throw Error("received URI escaped Scope");
  return target.href;
}
function childEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("BDP_") ||
      key.startsWith("VITEST_") ||
      ["NODE_OPTIONS", "NODE_PATH", "NODE_DEBUG"].includes(key)
    )
      delete env[key];
  return { ...env, NODE_NO_WARNINGS: "1" };
}
async function limited<T>(promise: Promise<T>, end: number) {
  const left = end - performance.now();
  if (left <= 0) {
    void promise.catch(() => {});
    throw Error("owned lifecycle deadline");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("owned lifecycle deadline")), left);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function reservation(port = 0) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("missing reserved address");
  return {
    server,
    port: address.port,
    async close() {
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
    },
  };
}
async function cohort(
  id: string,
  profile: Profile,
  httpExpected: number,
  generations: number,
  work: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
  guardChildren = 0,
) {
  const started = performance.now(),
    controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 45000);
  const preparation: { root?: string; reservation?: Awaited<ReturnType<typeof reservation>> } = {};
  let f: Awaited<ReturnType<typeof fixture>> | undefined,
    failure: unknown,
    cleanupKnown = true;
  try {
    f = await fixture(id, profile, started, controller, preparation);
    await work(f);
    expect(f.records).toHaveLength(httpExpected);
    expect(f.sessions.filter((s) => s.category !== "guard")).toHaveLength(generations);
    expect(f.sessions.filter((s) => s.category === "guard")).toHaveLength(guardChildren);
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    const cleanupEnd = performance.now() + 10000;
    if (!f) {
      cleanupKnown = false;
      try {
        await preparation.reservation?.close();
      } catch {
        /* unknown stays retained */
      }
      console.log(
        JSON.stringify({
          observation: "reference-lifecycle-installed",
          id,
          profile,
          phase: "fixture-preparation",
          outcome: "failed",
          claimEligible: false,
          ownership: "unknown",
          directory: preparation.root ?? null,
          directoryRetained: true,
        }),
      );
    }
    if (f) {
      const parentCleanup = f.cleanupParents(cleanupEnd);
      const cleanupFailures: unknown[] = [];
      for (const session of f.sessions)
        if (!session.exit && session.child.connected)
          session.child.send({ command: "close" }, () => {});
      const cleanup = await Promise.allSettled(
        f.sessions.map(async (session) => {
          try {
            await limited(Promise.all([session.exited, session.closed]), cleanupEnd);
          } catch (error) {
            if (!session.exit) session.child.kill("SIGKILL");
            throw error;
          }
        }),
      );
      const parentResults = await parentCleanup;
      cleanupFailures.push(
        ...[...cleanup, ...parentResults].flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        ),
      );
      cleanupKnown =
        cleanup.every((r) => r.status === "fulfilled") &&
        parentResults.every((r) => r.status === "fulfilled") &&
        f.parentOwnershipKnown() &&
        f.sessions.every((s) => s.exit !== null && s.close !== null) &&
        f.pending.size === 0;
      for (const socket of f.peers) {
        socket.resume();
        if (!socket.destroyed) socket.destroy();
      }
      try {
        await limited(f.reserved.close(), cleanupEnd);
      } catch (error) {
        cleanupKnown = false;
        cleanupFailures.push(error);
      }
      if (cleanupKnown) {
        try {
          rmSync(f.root, { recursive: true, force: true });
        } catch {
          cleanupKnown = false;
        }
      }
      if (cleanupFailures.length)
        failure = new AggregateError(
          [...(failure === undefined ? [] : [failure]), ...cleanupFailures],
          "lifecycle body and observed cleanup failed",
        );
      const report = {
        observation: "reference-lifecycle-installed",
        id,
        profile,
        source: process.env.BDP_REFERENCE_DEPLOYMENT_SOURCE_COMMIT ?? null,
        entry: f.entry,
        entrySha256: f.entrySha256,
        expected: { http: httpExpected, generations, guardChildren },
        actual: {
          scheduled: f.records.length,
          complete: f.records.filter((r) => r.complete === true).length,
          originalGenerations: f.sessions.filter((s) => s.category !== "guard").length,
          guardChildren: f.sessions.filter((s) => s.category === "guard").length,
        },
        records: f.records,
        generations: f.sessions.map((s) => ({
          category: s.category,
          ordinal: s.ordinal,
          pid: s.child.pid ?? null,
          ready: s.ready,
          exit: s.exit,
          close: s.close,
          outputBytes: s.outputBytes,
        })),
        lifecycle: {
          cleanupKnown,
          pending: f.pending.size,
          directory: f.root,
          directoryAbsent: !existsSync(f.root),
          ownerProbes: f.ownerProbes,
          parentOwnership: f.parentOwnership(),
          controls: f.controls,
        },
        elapsedMs: performance.now() - started,
        outcome: failure === undefined && cleanupKnown ? "passed" : "failed",
        claimEligible: false,
        limitations: [
          "private lifecycle only; no public admission",
          "all six TX cold cases require accepted combined D3a; fdd-only cannot pass them",
          "source/archive/consumer/lock/proof independently root-bound; no child attestation",
          "no crash, logical restore or whole-profile claim",
        ],
      };
      const text = JSON.stringify(report);
      if (f.secrets.some((secret) => text.includes(secret)))
        failure ??= Error("unsafe lifecycle report");
      else console.log(text);
    }
  }
  if (failure !== undefined) throw failure;
  expect(cleanupKnown).toBe(true);
}
async function fixture(
  _id: string,
  profile: Profile,
  started: number,
  controller: AbortController,
  preparation: { root?: string; reservation?: Awaited<ReturnType<typeof reservation>> },
) {
  const root = mkdtempSync(path.join(tmpdir(), "bdp-reference-lifecycle-"));
  preparation.root = root;
  const reserved = await reservation();
  preparation.reservation = reserved;
  const scope = `http://127.0.0.1:${reserved.port}/acme/`,
    type = scope + "types/bead",
    schema = scope + "schemas/n";
  const workspace = fileURLToPath(new URL("../../../", import.meta.url));
  const entry = realpathSync(
    process.env.BDP_REFERENCE_DEPLOYMENT_INSTALLED_ENTRY ??
      path.join(workspace, "packages/server/dist/reference-deployment-process.js"),
  );
  const entrySha256 = hash(readFileSync(entry));
  const directory = path.join(root, "store"),
    deploymentFile = path.join(root, "deployment.json");
  // Shared envelope is NOT understood by the existing flat installed launcher.
  if (profile === "transactional") mkdirSync(directory, { mode: 0o700 });
  let writer = randomBytes(32).toString("base64url"),
    oldWriter = writer;
  const reader = randomBytes(32).toString("base64url"),
    secrets = [writer, reader];
  const allow = { create: true, write: true, hidden: [], readOnly: [] };
  const artifacts = {
    descriptors: [
      {
        retrievalUri: type,
        utf8: JSON.stringify({
          id: type,
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
          properties: { n: { type: "integer" } },
          additionalProperties: false,
        }),
      },
    ],
  };
  const serverRoot = path.dirname(entry);
  const ownerModule = (await import(
    pathToFileURL(path.join(serverRoot, "development-authority.js")).href
  )) as typeof import("../../../packages/server/src/development-authority.js");
  const txDefaults = (await import(
    pathToFileURL(path.join(serverRoot, "transaction-runtime-configuration.js")).href
  )) as typeof import("../../../packages/server/src/transaction-runtime-configuration.js");
  const d = txDefaults.TRANSACTION_RUNTIME_DEFAULTS;
  const limits =
    profile === "read-update"
      ? ownerModule.DEVELOPMENT_READ_LIMITS
      : {
          page: {
            defaultItems: Math.min(d.readDefaultItems, d.receiptMaximumItems),
            maximumItems: d.receiptMaximumItems,
          },
          selector: d.selector,
          cursorTtlMilliseconds: d.pagination.cursorTtlMs,
        };
  const input = {
    deploymentFile,
    scope: { url: scope },
    server: { host: "127.0.0.1", port: reserved.port, advertisedProfile: profile, limits },
  };
  const document =
    profile === "read-update"
      ? {
          format: "bdptest-reference-deployment-1",
          profile,
          configuration: {
            directory,
            create: true,
            credentials: [
              { token: writer, principal: "writer" },
              { token: reader, principal: "reader" },
            ],
            policies: { writer: allow, reader: { ...allow, create: false, write: false } },
            contracts: artifacts,
            maximumEndpointMultiplicity: [],
          },
        }
      : {
          format: "bdptest-reference-deployment-1",
          profile,
          configuration: {
            directory,
            create: true,
            credentials: [
              { token: writer, principal: "writer", canMutate: true },
              { token: reader, principal: "reader", canMutate: false },
            ],
            artifacts,
          },
        };
  const sessions: Session[] = [],
    records: Record<string, unknown>[] = [],
    pending = new Set<Promise<unknown>>(),
    peers: Socket[] = [],
    controls: Record<string, unknown>[] = [],
    ownerProbes: Record<string, unknown>[] = [];
  const parentOwners: {
    state: {
      kind: "read-update-owner" | "transaction-owner" | "SQLite";
      stage: string;
      closeAttempted: boolean;
      closeSettled: boolean;
      closeSucceeded: boolean;
      uncertain: boolean;
    };
    close(): Promise<void>;
  }[] = [];
  async function withParentOwner<T extends { close(): unknown }, R>(
    kind: "read-update-owner" | "transaction-owner" | "SQLite",
    stage: string,
    value: T,
    work: (owned: T) => R | Promise<R>,
  ): Promise<R> {
    const state = {
      kind,
      stage,
      closeAttempted: false,
      closeSettled: false,
      closeSucceeded: false,
      uncertain: false,
    };
    let closing: Promise<void> | undefined;
    const close = () => {
      if (!closing) {
        state.closeAttempted = true;
        closing = Promise.resolve()
          .then(() => value.close())
          .then(
            () => {
              state.closeSettled = true;
              state.closeSucceeded = true;
            },
            (error: unknown) => {
              state.closeSettled = true;
              throw error;
            },
          );
        void closing.catch(() => {});
      }
      return closing;
    };
    // Register immediately after acquisition, before any read/parse/write or await.
    parentOwners.push({ state, close });
    let result!: R;
    let primary: { cause: unknown } | undefined;
    try {
      result = await work(value);
    } catch (cause) {
      primary = { cause };
    } finally {
      try {
        await limited(close(), started + 45000);
      } catch (cleanup) {
        state.uncertain = true; // Sticky even if a late close eventually settles.
        if (primary)
          throw new AggregateError(
            [primary.cause, cleanup],
            "parent owner operation and close failed",
          );
        throw cleanup;
      }
    }
    if (primary) throw primary.cause;
    return result;
  }
  const cleanupParents = (end: number) =>
    Promise.allSettled(
      parentOwners.map(async (owned) => {
        try {
          await limited(owned.close(), end); // Same memoized attempt, never a second close.
        } catch (error) {
          owned.state.uncertain = true;
          throw error;
        }
      }),
    );
  const parentOwnershipKnown = () =>
    parentOwners.every(
      ({ state }) => state.closeSettled && state.closeSucceeded && !state.uncertain,
    );
  const parentOwnership = () => parentOwners.map(({ state }) => ({ ...state }));
  const receiptSchema = JSON.parse(
    readFileSync(path.join(workspace, "schemas/bdp-v0.schema.json"), "utf8"),
  );
  const ajv = new Ajv2020({ strict: true });
  ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
  ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
  ajv.addSchema(receiptSchema);
  const validateReceipt = ajv.compile({ $ref: `${receiptSchema.$id}#/$defs/mutationReceipt` });
  function track<T>(promise: Promise<T>) {
    pending.add(promise);
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  }
  function own(args: string[], ipc: boolean, category: Session["category"]) {
    controller.signal.throwIfAborted();
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: childEnvironment(),
      stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    });
    const exit = Promise.withResolvers<End>(),
      close = Promise.withResolvers<End>();
    const session: Session = {
      child,
      category,
      ordinal: sessions.length + 1,
      exit: null,
      close: null,
      exited: exit.promise,
      closed: close.promise,
      ready: null,
      messages: [],
      stdout: "",
      stderr: "",
      outputBytes: 0,
    };
    sessions.push(session);
    child.once("exit", (code, signal) => {
      session.exit = { code, signal };
      exit.resolve(session.exit);
    });
    child.once("close", (code, signal) => {
      session.close = { code, signal };
      close.resolve(session.close);
    });
    child.on("error", () => {
      controls.push({ generation: session.ordinal, event: "spawn-error" });
    });
    child.on("message", (message) => {
      session.messages.push(message);
    });
    for (const [stream, field] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ] as const)
      stream?.on("data", (chunk: Buffer) => {
        session.outputBytes += chunk.length;
        if (session.outputBytes > 65536) {
          child.kill("SIGKILL");
          return;
        }
        session[field] += chunk.toString("utf8");
      });
    return session;
  }
  const ends = async (session: Session, bound = 10000) =>
    limited(
      Promise.all([session.exited, session.closed]),
      Math.min(started + 45000, performance.now() + bound),
    );
  async function launch(create = true, holdPort = false) {
    document.configuration.create = create;
    writeFileSync(deploymentFile, JSON.stringify(document));
    const session = own([entry], true, "candidate");
    const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
      session.child.once("message", (message) => {
        try {
          const value = object(message);
          expect(Object.keys(value).sort()).toEqual(
            ["event", "scope", "listenUrl", "profile", "history", "claimEligible"].sort(),
          );
          expect(value).toMatchObject({
            event: "qualification.ready",
            scope,
            profile,
            history: false,
            claimEligible: false,
          });
          resolve(value);
        } catch (error) {
          reject(error);
        }
      });
      void session.exited.then(() => reject(Error("bootstrap exited before ready")));
    });
    void ready.catch(() => {});
    if (!holdPort) await reserved.close();
    session.child.send({ configuration: input }, () => {});
    session.ready = await limited(ready, Math.min(started + 45000, performance.now() + 10000));
    expect(new URL(String(session.ready.listenUrl)).origin).toBe(new URL(scope).origin); // fixture law, not loader rewrite
    return session;
  }
  async function refused(create: boolean, holdPort = false) {
    document.configuration.create = create;
    writeFileSync(deploymentFile, JSON.stringify(document));
    const session = own([entry], true, "candidate");
    if (!holdPort) await reserved.close();
    session.child.send({ configuration: input }, () => {});
    await ends(session);
    expect(session.exit).toEqual({ code: 2, signal: null });
    expect(session.close).toEqual(session.exit);
    expect(session.messages).toEqual([]);
    expect(session.stdout).toBe("");
    expect(session.stderr).toBe("reference deployment startup failed\n");
    return session;
  }
  async function stop(
    session: Session,
    mode: "close" | "SIGTERM" | "SIGINT" | "disconnect" = "close",
  ) {
    controls.push({
      generation: session.ordinal,
      requested: mode,
      actualExitBefore: session.exit !== null,
    });
    expect(session.exit).toBeNull();
    expect(session.close).toBeNull();
    expect(session.child.exitCode).toBeNull();
    if (!session.exit) {
      if (mode === "close") {
        if (session.child.connected) session.child.send({ command: "close" }, () => {});
      } else if (mode === "disconnect") {
        expect(session.child.connected).toBe(true);
        session.child.disconnect();
      } else expect(session.child.kill(mode)).toBe(true);
    }
    await ends(session);
    expect(session.exit).toEqual({ code: 0, signal: null });
    expect(session.close).toEqual(session.exit);
  }
  async function send(
    label: string,
    method: "GET" | "HEAD" | "POST",
    target: string,
    expected: number | readonly number[],
    role: Role = "writer",
    body?: unknown,
    key?: string,
  ) {
    const session = sessions.at(-1);
    if (!session?.ready) throw Error("actual ready session required");
    const url = local(target, scope),
      address = new URL(String(session.ready.listenUrl));
    const credential =
      role === "writer"
        ? writer
        : role === "reader"
          ? reader
          : role === "old-writer"
            ? oldWriter
            : undefined;
    const record: Record<string, unknown> = {
      ordinal: records.length + 1,
      generation: session.ordinal,
      label,
      method,
      url,
      credential: role,
      complete: false,
      responseAvailable: false,
      wireAvailable: false,
    };
    records.push(record);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        maximumHeaderBytes: 16384,
        exactMode: {
          scope,
          profile,
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: role,
          credentialHandles: [{ id: role, headerNames: credential ? ["authorization"] : [] }],
          resolveCredentials: () => (credential ? { authorization: `Bearer ${credential}` } : {}),
        },
      },
    );
    try {
      const response = await track(
        execute({
          method,
          url,
          signal: controller.signal,
          credentialRef: role,
          raw: {
            headerLines:
              body === undefined
                ? []
                : [
                    { name: "Content-Type", value: "application/json" },
                    ...(key === undefined ? [] : [{ name: "Idempotency-Key", value: key }]),
                  ],
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
          },
        }),
      );
      Object.assign(record, {
        complete: true,
        responseAvailable: true,
        status: response.status,
        headers: response.headers,
        bodyText: response.bodyText,
        bodyOctets: response.bodyOctets,
        bodySha256: hash(response.bodyText),
        writeState: response.exactRequest?.writeState,
        wireAvailable: response.wireResponseBytes !== undefined,
        wireBase64: response.wireResponseBytes
          ? Buffer.from(response.wireResponseBytes).toString("base64")
          : null,
        wireSha256: response.wireResponseBytes ? hash(response.wireResponseBytes) : null,
      });
      expect(Array.isArray(expected) ? expected : [expected]).toContain(response.status);
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      if (method === "HEAD") expect(response.bodyText).toBe("");
      return { status: response.status, headers: response.headers, bodyText: response.bodyText };
    } catch (error) {
      record.terminal = "rejected";
      throw error;
    }
  }
  const client: ColdClient = { scope, type, send };
  let createdResource: Record<string, unknown> | undefined;
  function resource(reply: Reply) {
    const body = object(JSON.parse(reply.bodyText));
    let actual: Record<string, unknown>;
    if (profile === "read-update") {
      const parsed = parseReadUpdateMutationResult(body);
      expect(parsed.outcome).toBe("created");
      actual = object(parsed.resource);
    } else {
      expect(validateReceipt(body)).toBe(true);
      expect(body.status).toBe("completed");
      const results = body.results;
      expect(Array.isArray(results)).toBe(true);
      expect((results as unknown[]).length).toBe(1);
      const result = object((results as unknown[])[0]);
      expect(result.outcome).toBe("created");
      actual = object(result.resource);
    }
    expect(actual.id === scope + "beads/startup").toBe(true);
    expect(actual.type === type).toBe(true);
    expect(typeof actual.revision === "string" && actual.revision.length > 0).toBe(true);
    expect(isDeepStrictEqual(actual.properties, { n: 1 })).toBe(true);
    createdResource = structuredClone(actual);
    return actual;
  }
  async function ownerProbe(expectCreated: boolean) {
    document.configuration.create = false;
    writeFileSync(deploymentFile, JSON.stringify(document));
    const loader = (await import(
      pathToFileURL(path.join(serverRoot, "reference-deployment.js")).href
    )) as typeof import("../../../packages/server/src/reference-deployment.js");
    const registry = (await import(
      pathToFileURL(path.join(serverRoot, "reference-deployment-state.js")).href
    )) as typeof import("../../../packages/server/src/reference-deployment-state.js");
    const h = await loader.loadReferenceDeployment(input),
      state = registry.referenceDeploymentState(h);
    if (state.profile === "read-update") {
      await withParentOwner(
        "read-update-owner",
        "probe",
        await ownerModule.openDevelopmentAuthority({
          scope,
          directory,
          create: false,
          configuration: state.installed.configuration,
        }),
        () => undefined,
      );
    } else {
      const module = (await import(
        pathToFileURL(path.join(serverRoot, "transaction-store.js")).href
      )) as typeof import("../../../packages/server/src/transaction-store.js");
      const p = state.preflight;
      await withParentOwner(
        "transaction-owner",
        "probe",
        module.openTransactionStore({
          file: path.join(directory, "transaction.sqlite"),
          scope,
          create: false,
          types: p.types,
          contracts: p.contracts!,
          receiptMaximumItems: p.settings.receiptMaximumItems,
          maintenanceIntervalMs: p.settings.maintenanceIntervalMs,
        }),
        () => undefined,
      );
    }
    const rows = await withParentOwner(
      "SQLite",
      "probe-resource-read",
      new DatabaseSync(
        path.join(directory, profile === "read-update" ? "reference.sqlite" : "transaction.sqlite"),
      ),
      (db) =>
        db
          .prepare("SELECT body FROM resources")
          .all()
          .map((r) => object(JSON.parse(String(r.body)))),
    );
    const retained = rows.find((r) => r.id === scope + "beads/startup");
    expect(retained !== undefined).toBe(expectCreated);
    if (expectCreated) {
      expect(createdResource !== undefined).toBe(true);
      for (const field of ["id", "type", "revision", "properties", "metadata"])
        expect(isDeepStrictEqual(retained?.[field], createdResource?.[field])).toBe(true);
    }
    expect(rows.some((r) => r.id === scope + "beads/refused")).toBe(false);
    ownerProbes.push({
      profile,
      actualReopenAndClose: true,
      createdResourcePresent: expectCreated,
      refusedResourceAbsent: true,
    });
  }
  async function initialize() {
    // actual packed owner, no child/HTTP or guessed persisted metadata
    writeFileSync(deploymentFile, JSON.stringify(document));
    const loader = (await import(
      pathToFileURL(path.join(serverRoot, "reference-deployment.js")).href
    )) as typeof import("../../../packages/server/src/reference-deployment.js");
    const registry = (await import(
      pathToFileURL(path.join(serverRoot, "reference-deployment-state.js")).href
    )) as typeof import("../../../packages/server/src/reference-deployment-state.js");
    const state = registry.referenceDeploymentState(await loader.loadReferenceDeployment(input));
    if (state.profile === "read-update") {
      await withParentOwner(
        "read-update-owner",
        "initialize",
        await ownerModule.openDevelopmentAuthority({
          scope,
          directory,
          create: true,
          configuration: state.installed.configuration,
        }),
        () => undefined,
      );
    } else {
      const m = (await import(
        pathToFileURL(path.join(serverRoot, "transaction-store.js")).href
      )) as typeof import("../../../packages/server/src/transaction-store.js");
      const p = state.preflight;
      await withParentOwner(
        "transaction-owner",
        "initialize",
        m.openTransactionStore({
          file: path.join(directory, "transaction.sqlite"),
          scope,
          create: true,
          types: p.types,
          contracts: p.contracts!,
          receiptMaximumItems: p.settings.receiptMaximumItems,
          maintenanceIntervalMs: p.settings.maintenanceIntervalMs,
        }),
        () => undefined,
      );
    }
    ownerProbes.push({ profile, actualFixtureInitializationAndClose: true });
  }
  async function peer() {
    const session = sessions.at(-1);
    if (!session?.ready) throw Error("ready required");
    const dial = new URL(String(session.ready.listenUrl));
    const socket = connect({ host: dial.hostname, port: Number(dial.port) });
    peers.push(socket);
    const closed = Promise.withResolvers<void>();
    const state = {
      exitBeforeShutdown: false,
      closeBeforeShutdown: false,
      refusalWireBase64: "",
      refusalStatus: null as number | null,
      serverTransportLiveAtShutdown: "unknown",
      forcedServerDestructionClaimed: false,
    };
    socket.once("end", () => {
      state.exitBeforeShutdown = true;
    });
    socket.once("close", () => {
      state.closeBeforeShutdown = true;
      closed.resolve();
    });
    socket.on("error", () => {});
    await limited(
      new Promise<void>((resolve, reject) => {
        let bytes = Buffer.alloc(0);
        socket.on("data", (chunk) => {
          try {
            bytes = Buffer.concat([bytes, chunk]);
            if (bytes.length > 16384) {
              reject(Error("CONNECT refusal bound"));
              socket.destroy();
              return;
            }
            if (bytes.includes("\r\n\r\n")) {
              const match = /^HTTP\/1\.1 (\d{3}) /.exec(bytes.toString("latin1"));
              const status = match ? Number(match[1]) : 0;
              state.refusalStatus = status;
              state.refusalWireBase64 = bytes.toString("base64");
              socket.pause();
              expect(status).toBeGreaterThanOrEqual(400);
              expect(status).toBeLessThan(500);
              resolve();
            }
          } catch (error) {
            reject(error);
            socket.destroy();
          }
        });
        socket.once("connect", () =>
          socket.write(
            `CONNECT ${new URL(scope).host} HTTP/1.1\r\nHost: ${new URL(scope).host}\r\nAuthorization: Bearer ${writer}\r\n\r\n`,
          ),
        );
        socket.once("error", reject);
      }),
      Math.min(started + 45000, performance.now() + 5000),
    );
    const before = {
      ...state,
      socketDestroyed: socket.destroyed,
      socketReadableEnded: socket.readableEnded,
      socketReadyState: socket.readyState,
      observedAlreadyClosed: state.closeBeforeShutdown || socket.destroyed || socket.readableEnded,
    };
    controls.push({ CONNECT: "actual-refusal", beforeShutdown: before });
    return {
      async afterStop() {
        socket.resume();
        await limited(closed.promise, Math.min(started + 45000, performance.now() + 5000));
        controls.push({
          CONNECT: "actual-peer-close",
          wasAlreadyClosed: before.observedAlreadyClosed,
          closeObserved: true,
          forcedServerDestructionClaimed: false,
        });
      },
    };
  }
  async function guard(mode: "inert-no-ipc" | "inert-ipc" | "missing-ipc" | "invalid-ipc") {
    const inert = mode.startsWith("inert"),
      ipc = mode === "inert-ipc" || mode === "invalid-ipc";
    const program = `const names=['message','disconnect','SIGTERM','SIGINT']; const before={code:process.exitCode??null,counts:names.map(n=>process.listenerCount(n))}; await import(${JSON.stringify(pathToFileURL(entry).href)}); const after={code:process.exitCode??null,counts:names.map(n=>process.listenerCount(n))}; if(JSON.stringify(before)!==JSON.stringify(after))throw Error('non-inert entry'); console.log(JSON.stringify({guard:'inert',before,after})); if(process.connected)process.disconnect();`;
    const session = own(inert ? ["--input-type=module", "-e", program] : [entry], ipc, "guard");
    if (mode === "invalid-ipc") session.child.send({ configuration: {} }, () => {});
    await ends(session, inert ? 5000 : 10000);
    expect(session.messages).toEqual([]);
    expect(session.exit).toEqual({ code: inert ? 0 : 2, signal: null });
    expect(session.close).toEqual(session.exit);
    if (inert) {
      expect(object(JSON.parse(session.stdout)).guard).toBe("inert");
      expect(session.stderr).toBe("");
    } else {
      expect(session.stdout).toBe("");
      expect(session.stderr).toBe("reference deployment startup failed\n");
    }
    controls.push({ guard: mode, actualExitAndClose: true });
  }
  async function publicRefusal() {
    const config = path.join(root, "startup.json");
    writeFileSync(
      config,
      JSON.stringify({ scope: input.scope, server: input.server, bdptest: { deploymentFile } }),
    );
    writeFileSync(deploymentFile, JSON.stringify(document));
    const publicEntry = realpathSync(
      process.env.BDP_REFERENCE_DEPLOYMENT_PUBLIC_ENTRY ??
        path.join(workspace, "apps/bdptest/dist/main.js"),
    );
    const session = own([publicEntry, "--serve", "--config", config], false, "public");
    await ends(session);
    expect(session.exit).toEqual({ code: 2, signal: null });
    expect(session.close).toEqual(session.exit);
    expect(session.messages).toEqual([]);
    expect(session.stderr).toContain("startup.profile_refused");
    expect(
      existsSync(
        path.join(directory, profile === "read-update" ? "reference.sqlite" : "transaction.sqlite"),
      ),
    ).toBe(false);
  }
  return {
    root,
    reserved,
    entry,
    entrySha256,
    directory,
    document,
    input,
    profile,
    scope,
    type,
    secrets,
    sessions,
    records,
    pending,
    peers,
    controls,
    ownerProbes,
    withParentOwner,
    cleanupParents,
    parentOwnershipKnown,
    parentOwnership,
    client,
    launch,
    refused,
    stop,
    send,
    resource,
    ownerProbe,
    initialize,
    peer,
    guard,
    publicRefusal,
    async changeWriter() {
      oldWriter = writer;
      writer = randomBytes(32).toString("base64url");
      secrets.push(writer);
      document.configuration.credentials[0]!.token = writer;
    },
  };
}
async function navigate(client: ColdClient) {
  const root = await client.send("Scope", "GET", client.scope, [200, 204]);
  const links = [...(root.headers.link ?? "").matchAll(/<([^>]+)>;\s*rel="?service-desc"?/g)];
  expect(links).toHaveLength(1);
  const descriptorUrl = local(links[0]![1]!, client.scope),
    response = await client.send("descriptor", "GET", descriptorUrl, 200),
    value = JSON.parse(response.bodyText);
  const descriptor =
    object(value).profile === "transactional"
      ? parseTransactionalDiscovery(value)
      : parseReadUpdateDiscovery(value);
  expect(descriptor.scope).toBe(client.scope);
  const directoryUrl = local(descriptor.operations, client.scope),
    directoryReply = await client.send("Directory", "GET", directoryUrl, 200),
    raw = JSON.parse(directoryReply.bodyText);
  const directory =
    object(value).profile === "transactional"
      ? parseTransactionalOperationDirectory(raw)
      : parseReadUpdateOperationDirectory(raw);
  return {
    descriptorUrl,
    directoryUrl,
    descriptorResponse: response,
    directoryResponse: directoryReply,
    createTarget: local(new URL(directory.createBead, directoryUrl).href, client.scope),
  };
}
const payload = (client: ColdClient, id = "beads/startup") => ({
  id,
  type: client.type,
  properties: { n: 1 },
});
async function cold(f: Awaited<ReturnType<typeof fixture>>) {
  const client = f.client,
    routes = await navigate(client);
  expect(object(JSON.parse((await client.send("Type", "GET", client.type, 200)).bodyText)).id).toBe(
    client.type,
  );
  const created = await client.send(
      "create",
      "POST",
      routes.createTarget,
      200,
      "writer",
      payload(client),
      "startup-created",
    ),
    resource = f.resource(created);
  const id = String(resource.id);
  expect(id).toBe(client.scope + "beads/startup");
  expect(
    isDeepStrictEqual(JSON.parse((await client.send("read", "GET", id, 200)).bodyText), resource),
  ).toBe(true);
  const replay = await client.send(
    "replay",
    "POST",
    routes.createTarget,
    200,
    "writer",
    payload(client),
    "startup-created",
  );
  expect(replay.bodyText).toBe(created.bodyText);
  expect(
    isDeepStrictEqual(
      JSON.parse((await client.send("reader-read", "GET", id, 200, "reader")).bodyText),
      resource,
    ),
  ).toBe(true);
  await client.send(
    "reader-refused",
    "POST",
    routes.createTarget,
    403,
    "reader",
    payload(client, "beads/refused"),
    "reader-refused",
  );
  const anonymous = await client.send("anonymous-refused", "GET", id, 401, "anonymous");
  for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position", "link"])
    expect(anonymous.headers[name] === undefined).toBe(true);
  const descriptorHead = await client.send("descriptor-HEAD", "HEAD", routes.descriptorUrl, 200);
  const directoryHead = await client.send("Directory-HEAD", "HEAD", routes.directoryUrl, 200);
  for (const [get, head] of [
    [routes.descriptorResponse, descriptorHead],
    [routes.directoryResponse, directoryHead],
  ] as const)
    for (const name of [
      "content-type",
      "content-length",
      "cache-control",
      "etag",
      "last-modified",
      "vary",
    ])
      expect(head.headers[name] === get.headers[name]).toBe(true);
  await client.send("absent", "GET", client.scope + "beads/not-created", 404);
}
it.each([
  ["I01", "read-update"],
  ["I02", "transactional"],
] as const)(
  "%s %s cold prepared startup (TX requires combined D3a)",
  async (id, profile) =>
    cohort(id, profile, 13, 1, async (f) => {
      const session = await f.launch();
      await cold(f);
      await f.stop(session);
      await f.ownerProbe(true);
    }),
  60000,
);
it.each([
  ["I03", "read-update"],
  ["I04", "transactional"],
] as const)(
  "%s %s two-generation read and replay",
  async (id, profile) =>
    cohort(id, profile, 10, 2, async (f) => {
      const one = await f.launch(),
        routes = await navigate(f.client),
        reply = await f.send(
          "create",
          "POST",
          routes.createTarget,
          200,
          "writer",
          payload(f.client),
          "startup-created",
        ),
        resource = f.resource(reply);
      await f.send("read", "GET", String(resource.id), 200);
      await f.stop(one);
      const two = await f.launch(false),
        next = await navigate(f.client);
      expect(
        isDeepStrictEqual(
          JSON.parse((await f.send("reopened-read", "GET", String(resource.id), 200)).bodyText),
          resource,
        ),
      ).toBe(true);
      expect(
        (
          await f.send(
            "replay",
            "POST",
            next.createTarget,
            200,
            "writer",
            payload(f.client),
            "startup-created",
          )
        ).bodyText,
      ).toBe(reply.bodyText);
      await f.stop(two);
      await f.ownerProbe(true);
    }),
  60000,
);
it(
  "I05 RU current credential changes on the same store",
  async () =>
    cohort("I05", "read-update", 10, 2, async (f) => {
      const first = await f.launch(),
        routes = await navigate(f.client);
      const resource = f.resource(
        await f.send(
          "create",
          "POST",
          routes.createTarget,
          200,
          "writer",
          payload(f.client),
          "startup-created",
        ),
      );
      await f.stop(first);
      await f.changeWriter();
      const second = await f.launch(false),
        next = await navigate(f.client);
      await f.send("old-token", "GET", String(resource.id), 401, "old-writer");
      await f.send("new-token", "GET", String(resource.id), 200);
      await f.send(
        "reader-refused",
        "POST",
        next.createTarget,
        403,
        "reader",
        payload(f.client, "beads/refused"),
        "reader-refused",
      );
      await f.stop(second);
      await f.ownerProbe(true);
    }),
  60000,
);
it.each([
  ["I06", "read-update"],
  ["I07", "transactional"],
] as const)(
  "%s %s absent create:false refuses without file",
  async (id, profile) =>
    cohort(id, profile, 0, 1, async (f) => {
      const existed = existsSync(f.directory),
        files = existed ? readdirSync(f.directory) : [];
      await f.refused(false);
      expect(
        existsSync(
          path.join(
            f.directory,
            profile === "read-update" ? "reference.sqlite" : "transaction.sqlite",
          ),
        ),
      ).toBe(false);
      expect(existsSync(f.directory)).toBe(existed);
      expect(existed ? readdirSync(f.directory) : []).toEqual(files);
    }),
  60000,
);
it.each([
  ["I08", "read-update"],
  ["I09", "transactional"],
] as const)(
  "%s %s real persisted capture mismatch refuses",
  async (id, profile) =>
    cohort(id, profile, 0, 1, async (f) => {
      await f.initialize();
      const file = path.join(
        f.directory,
        profile === "read-update" ? "reference.sqlite" : "transaction.sqlite",
      );
      const prior = await f.withParentOwner(
        "SQLite",
        "persisted-capture-edit",
        new DatabaseSync(file),
        (db) => {
          const value = String(
            db.prepare("SELECT value FROM metadata WHERE name='contractCapture'").get()!.value,
          );
          db.prepare("UPDATE metadata SET value='null' WHERE name='contractCapture'").run();
          return value;
        },
      );
      await f.refused(false);
      await f.withParentOwner(
        "SQLite",
        "persisted-capture-restore",
        new DatabaseSync(file),
        (restore) => {
          restore.prepare("UPDATE metadata SET value=? WHERE name='contractCapture'").run(prior);
        },
      );
      await f.ownerProbe(false);
    }),
  60000,
);
it.each([
  ["I10", "read-update"],
  ["I11", "transactional"],
] as const)(
  "%s %s occupied listener retains blocker",
  async (id, profile) =>
    cohort(id, profile, 0, 1, async (f) => {
      await f.refused(true, true);
      expect(f.reserved.server.listening).toBe(true);
      await f.ownerProbe(false);
    }),
  60000,
);
it.each([
  ["I12", "read-update", "SIGTERM"],
  ["I13", "transactional", "SIGTERM"],
  ["I14", "read-update", "SIGINT"],
  ["I15", "transactional", "SIGINT"],
  ["I16", "read-update", "disconnect"],
  ["I17", "transactional", "disconnect"],
] as const)(
  "%s %s %s stops then reopens",
  async (id, profile, mode) =>
    cohort(id, profile, 9, 2, async (f) => {
      const one = await f.launch(),
        routes = await navigate(f.client),
        resource = f.resource(
          await f.send(
            "create",
            "POST",
            routes.createTarget,
            200,
            "writer",
            payload(f.client),
            "startup-created",
          ),
        );
      await f.send("read", "GET", String(resource.id), 200);
      await f.stop(one, mode);
      const proof = await reservation(f.input.server.port);
      await proof.close();
      const two = await f.launch(false);
      await navigate(f.client);
      expect(
        isDeepStrictEqual(
          JSON.parse((await f.send("reopened-read", "GET", String(resource.id), 200)).bodyText),
          resource,
        ),
      ).toBe(true);
      await f.stop(two);
      await f.ownerProbe(true);
    }),
  60000,
);
it.each([
  ["I18", "read-update"],
  ["I19", "transactional"],
] as const)(
  "%s %s observed non-reading peer chronology and reopen",
  async (id, profile) =>
    cohort(id, profile, 8, 2, async (f) => {
      const one = await f.launch(),
        routes = await navigate(f.client),
        resource = f.resource(
          await f.send(
            "create",
            "POST",
            routes.createTarget,
            200,
            "writer",
            payload(f.client),
            "startup-created",
          ),
        ),
        peer = await f.peer();
      await f.stop(one);
      await peer.afterStop();
      const two = await f.launch(false);
      await navigate(f.client);
      await f.send("reopened-read", "GET", String(resource.id), 200);
      await f.stop(two);
      await f.ownerProbe(true);
    }),
  60000,
);
it(
  "I20 ordinary RU refusal plus three actual private entry guards",
  async () =>
    cohort(
      "I20",
      "read-update",
      0,
      1,
      async (f) => {
        await f.publicRefusal();
        await f.guard("inert-no-ipc");
        await f.guard("inert-ipc");
        await f.guard("missing-ipc");
      },
      3,
    ),
  60000,
);
it(
  "I21 ordinary TX refusal plus invalid configuration IPC guard",
  async () =>
    cohort(
      "I21",
      "transactional",
      0,
      1,
      async (f) => {
        await f.publicRefusal();
        await f.guard("invalid-ipc");
      },
      1,
    ),
  60000,
);
