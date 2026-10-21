/** Genuine owner/listener witnesses. Counts are prospective until this exact source runs. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as http from "node:http";
import * as fsPromises from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { createServer as createPortReservation } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as authority from "./development-authority.js";
import * as stores from "./transaction-store.js";
import * as services from "./transaction-service.js";
import * as compositions from "./development-composition.js";
import { DEVELOPMENT_READ_LIMITS } from "./development-authority.js";
import { TRANSACTION_RUNTIME_DEFAULTS } from "./transaction-runtime-configuration.js";
import {
  loadReferenceDeployment,
  type PreparedReferenceDeployment,
} from "./reference-deployment.js";
import { referenceDeploymentState } from "./reference-deployment-state.js";
import { startPreparedReferenceDeployment } from "./reference-deployment-runtime.js";
import {
  assemblePreparedDevelopmentArguments,
  startDevelopmentReferenceRuntime,
} from "./development-runtime.js";
import { startTransactionRuntime } from "./transaction-runtime.js";

// Plain mocked builtin namespaces permit delegating observation without replacing behavior.
vi.mock("node:http", async (original) => ({ ...(await original<typeof import("node:http")>()) }));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
}));
const sql = vi.hoisted(() => ({ rows: [] as { file: string; closed: boolean }[] }));
vi.mock("node:sqlite", async (original) => {
  const actual = await original<typeof import("node:sqlite")>();
  return {
    ...actual,
    DatabaseSync: class extends actual.DatabaseSync {
      readonly witness: { file: string; closed: boolean };
      constructor(...args: ConstructorParameters<typeof actual.DatabaseSync>) {
        super(...args);
        this.witness = { file: String(args[0]), closed: false };
        sql.rows.push(this.witness);
      }
      override close() {
        super.close();
        this.witness.closed = true;
      }
    },
  };
});
type Profile = "read-update" | "transactional";
const openRU = authority.openDevelopmentAuthority,
  openTX = stores.openTransactionStore,
  construct = services.createTransactionService,
  compose = compositions.createDevelopmentComposition,
  createHTTP = http.createServer;
const pendingStarts = new Set<
  Promise<Awaited<ReturnType<typeof startPreparedReferenceDeployment>>>
>();
const preparationControllers: AbortController[] = [];
const roots: string[] = [],
  active: { close(): Promise<unknown> }[] = [],
  servers: http.Server[] = [];
const token = "lifecycle_writer_" + "a".repeat(32),
  reader = "lifecycle_reader_" + "b".repeat(32);
const allow = { create: true, write: true, hidden: [], readOnly: [] };
let trace: string[],
  listenArgs: unknown[][],
  acquired: number,
  returned: number,
  ownerCloses: number,
  serviceCloses: number,
  serviceAttempts: number,
  configurationReads: number;
let corruption: string | undefined,
  primary: Error | undefined,
  closeFailure: Error | undefined,
  listenFailure: Error | undefined,
  eventFailure: Error | undefined,
  constructorThrow = false,
  abortOnOpen: AbortController | undefined;
let secondPrincipal:
  | { entered: PromiseWithResolvers<void>; release: PromiseWithResolvers<void>; fail: boolean }
  | undefined;
let mutation:
  | { entered: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> }
  | undefined;
let actualComposition: ReturnType<typeof compose> | undefined;
let sqlStart = 0;
const callbackSQLite = () => sql.rows.slice(sqlStart);
const previousUnresolvedSQLite = () => sql.rows.slice(0, sqlStart).filter((row) => !row.closed);
let observedCase = "",
  assertionsCompleted = false,
  bodyExtra: unknown = null,
  emittedId: string | null = null;
function altered<T>(value: T, key: string | undefined): T {
  if (!key) return value;
  const copy = structuredClone(value) as Record<string, unknown>;
  if (key === "scope") copy.scope = "https://different.invalid/acme/";
  else if (key === "readLimits") copy.readLimits = {};
  else if (key === "installedTypes") copy.installedTypes = [];
  else if (key === "receiptMaximumItems") copy.receiptMaximumItems = 1;
  else if (key === "scopeSnapshot") copy.scopeSnapshot = {};
  else if (key === "authorizationView") copy.authorizationView = "wrong";
  return copy as T;
}
beforeEach((context) => {
  sqlStart = sql.rows.length;
  observedCase = context.task.name;
  assertionsCompleted = false;
  bodyExtra = null;
  emittedId = null;
  trace = [];
  listenArgs = [];
  acquired = returned = ownerCloses = serviceCloses = serviceAttempts = configurationReads = 0;
  corruption = undefined;
  primary = closeFailure = listenFailure = eventFailure = undefined;
  constructorThrow = false;
  abortOnOpen = undefined;
  secondPrincipal = undefined;
  mutation = undefined;
  actualComposition = undefined;
  vi.spyOn(http, "createServer").mockImplementation((...args: Parameters<typeof createHTTP>) => {
    const server = Reflect.apply(createHTTP, undefined, args) as http.Server;
    servers.push(server);
    const listen = server.listen;
    vi.spyOn(server, "listen").mockImplementation((...values: unknown[]) => {
      trace.push("listen");
      listenArgs.push(values);
      if (listenFailure) throw listenFailure;
      return Reflect.apply(listen, server, values) as http.Server;
    });
    server.once("listening", () => {
      acquired++;
      trace.push("listening");
      if (eventFailure) server.emit("error", eventFailure);
    });
    return server;
  });
  vi.spyOn(compositions, "createDevelopmentComposition").mockImplementation((...args) => {
    trace.push("composition");
    const actual = compose(...args);
    actualComposition = {
      ...actual,
      createReadRoute(...values) {
        trace.push("route");
        return actual.createReadRoute(...values);
      },
    };
    return actualComposition;
  });
  vi.spyOn(authority, "openDevelopmentAuthority").mockImplementation(async (...args) => {
    trace.push("open-RU");
    const owner = await openRU(...args);
    returned++;
    return {
      ...owner,
      readConfiguration() {
        configurationReads++;
        trace.push("readback");
        return altered(owner.readConfiguration(), corruption);
      },
      forPrincipal(principal) {
        const view = owner.forPrincipal(principal);
        return {
          ...view,
          async discover() {
            if (secondPrincipal && principal.id === "reader") {
              secondPrincipal.entered.resolve();
              await secondPrincipal.release.promise;
              if (secondPrincipal.fail) throw primary;
            }
            return view.discover();
          },
          async mutate(...values) {
            const result = await view.mutate(...values);
            if (mutation) {
              mutation.entered.resolve();
              await mutation.release.promise;
            }
            return result;
          },
        };
      },
      async close() {
        ownerCloses++;
        trace.push("owner-close");
        await owner.close();
        if (closeFailure) throw closeFailure;
      },
    };
  });
  vi.spyOn(stores, "openTransactionStore").mockImplementation((...args) => {
    trace.push("open-TX");
    const owner = openTX(...args);
    returned++;
    if (abortOnOpen) queueMicrotask(() => abortOnOpen?.abort());
    return {
      ...owner,
      readConfiguration() {
        configurationReads++;
        trace.push("readback");
        if (constructorThrow && configurationReads > 1) throw primary;
        return altered(owner.readConfiguration(), corruption);
      },
      close() {
        ownerCloses++;
        trace.push("owner-close");
        owner.close();
        if (closeFailure) throw closeFailure;
      },
    };
  });
  vi.spyOn(services, "createTransactionService").mockImplementation((...args) => {
    serviceAttempts++;
    trace.push("service-attempt");
    const service = construct(...args);
    return {
      ...service,
      async submit(...values) {
        const result = await service.submit(...values);
        if (mutation) {
          mutation.entered.resolve();
          await mutation.release.promise;
        }
        return result;
      },
      async close() {
        serviceCloses++;
        await service.close();
      },
    };
  });
});
afterEach(async () => {
  const directories = roots.splice(0);
  console.log(
    JSON.stringify({
      observation: "reference-lifecycle-source-before-cleanup",
      callback: observedCase,
      id: emittedId,
      assertionsCompleted,
      counts: counts(),
      extra: bodyExtra,
      SQLite: callbackSQLite().map((r) => ({ ...r })),
      previousUnresolvedSQLite: previousUnresolvedSQLite().map((r) => ({ ...r })),
      claimEligible: false,
    }),
  );
  for (const controller of preparationControllers.splice(0)) controller.abort();
  secondPrincipal?.release.resolve();
  mutation?.release.resolve();
  await Promise.allSettled([...pendingStarts]);
  const cleanup = await Promise.allSettled(active.splice(0).map((runtime) => runtime.close()));
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
  const unknown =
    cleanup.some((r) => r.status === "rejected") || callbackSQLite().some((r) => !r.closed);
  if (!unknown) for (const root of directories) rmSync(root, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      observation: "reference-lifecycle-source-terminal",
      callback: observedCase,
      assertionsCompleted,
      cleanupKnown: !unknown,
      SQLite: callbackSQLite().map((r) => ({ ...r })),
      previousUnresolvedSQLite: previousUnresolvedSQLite().map((r) => ({ ...r })),
      counts: counts(),
      directories: directories.map((directory) => ({ directory, absent: !existsSync(directory) })),
      claimEligible: false,
    }),
  );
  // Unknown ownership deliberately retains evidence; no timeout or missing event is clean.
});
async function port() {
  const reservation = createPortReservation();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") throw Error("missing reservation");
  await new Promise<void>((resolve, reject) =>
    reservation.close((e) => (e ? reject(e) : resolve())),
  );
  return address.port;
}
async function fixture(profile: Profile) {
  const root = mkdtempSync(path.join(tmpdir(), "bdp-prepared-source-"));
  roots.push(root);
  const p = await port(),
    scope = `http://127.0.0.1:${p}/acme/`,
    type = `${scope}types/bead`,
    schema = `${scope}schemas/n`,
    directory = path.join(root, "store");
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
  const configuration =
    profile === "read-update"
      ? {
          directory,
          create: true,
          credentials: [
            { token, principal: "writer" },
            { token: reader, principal: "reader" },
          ],
          policies: { writer: allow, reader: { ...allow, create: false, write: false } },
          contracts: artifacts,
          maximumEndpointMultiplicity: [],
        }
      : {
          directory,
          create: true,
          credentials: [
            { token, principal: "writer", canMutate: true },
            { token: reader, principal: "reader", canMutate: false },
          ],
          artifacts,
        };
  const document = { format: "bdptest-reference-deployment-1", profile, configuration };
  const defaults = TRANSACTION_RUNTIME_DEFAULTS;
  const limits =
    profile === "read-update"
      ? DEVELOPMENT_READ_LIMITS
      : {
          page: {
            defaultItems: Math.min(defaults.readDefaultItems, defaults.receiptMaximumItems),
            maximumItems: defaults.receiptMaximumItems,
          },
          selector: defaults.selector,
          cursorTtlMilliseconds: defaults.pagination.cursorTtlMs,
        };
  const input = {
    deploymentFile: path.join(root, "deployment.json"),
    scope: { url: scope },
    server: { host: "127.0.0.1", port: p, advertisedProfile: profile, limits },
  };
  const prepare = async (create = true) => {
    document.configuration.create = create;
    writeFileSync(input.deploymentFile, JSON.stringify(document));
    return loadReferenceDeployment(input);
  };
  if (profile === "transactional") mkdirSync(directory, { mode: 0o700 });
  return {
    root,
    directory,
    profile,
    input,
    document,
    type,
    scope,
    prepare,
    file: path.join(
      directory,
      profile === "read-update" ? "reference.sqlite" : "transaction.sqlite",
    ),
  };
}
async function bare(handle: PreparedReferenceDeployment) {
  const state = referenceDeploymentState(handle);
  if (state.profile === "read-update")
    return openRU({
      scope: state.installed.scope,
      directory: state.installed.directory,
      create: state.installed.create,
      configuration: state.installed.configuration,
    });
  const p = state.preflight;
  return openTX({
    file: path.join(p.directory, "transaction.sqlite"),
    scope: p.configuredScope!,
    create: p.create,
    types: p.types,
    contracts: p.contracts!,
    receiptMaximumItems: p.settings.receiptMaximumItems,
    maintenanceIntervalMs: p.settings.maintenanceIntervalMs,
  });
}
function counts() {
  return {
    returned,
    ownerCloses,
    serviceCloses,
    serviceAttempts,
    configurationReads,
    listenAttempts: listenArgs.length,
    listeningAcquisitions: acquired,
    trace: [...trace],
  };
}
function emit(id: string, extra: unknown = null) {
  emittedId = id;
  bodyExtra = extra;
  assertionsCompleted = true;
}
function start(handle: PreparedReferenceDeployment, signal?: AbortSignal) {
  const controller = new AbortController();
  preparationControllers.push(controller);
  const pending = startPreparedReferenceDeployment(
    handle,
    signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
  ).then((runtime) => {
    active.push(runtime);
    return runtime;
  });
  pendingStarts.add(pending);
  void pending.then(
    () => pendingStarts.delete(pending),
    () => pendingStarts.delete(pending),
  );
  return pending;
}

it.each(["plain", "frozen", "getter", "proxy"] as const)(
  "S01 registered handle refuses %s without traps",
  async (kind) => {
    const f = await fixture("read-update"),
      genuine = await f.prepare();
    let traps = 0;
    const object = { ...genuine };
    if (kind === "getter")
      Object.defineProperty(object, "profile", {
        enumerable: true,
        get() {
          traps++;
          throw Error("trap");
        },
      });
    const forged =
      kind === "proxy"
        ? new Proxy(genuine, {
            get() {
              traps++;
              throw Error("trap");
            },
            ownKeys() {
              traps++;
              throw Error("trap");
            },
          })
        : kind === "frozen"
          ? Object.freeze(object)
          : object;
    const fileOpen = vi.spyOn(fsPromises, "open");
    await expect(
      startPreparedReferenceDeployment(forged as PreparedReferenceDeployment),
    ).rejects.toThrow("registered reference deployment required");
    expect(fileOpen).not.toHaveBeenCalled();
    expect(traps).toBe(0);
    expect(returned).toBe(0);
    expect(listenArgs).toHaveLength(0);
    emit("S01-" + kind);
  },
);
it.each([false, true])("S02 RU completes second principal before bind; reject=%s", async (fail) => {
  const f = await fixture("read-update"),
    handle = await f.prepare();
  primary = new Error("principal sentinel");
  secondPrincipal = {
    entered: Promise.withResolvers<void>(),
    release: Promise.withResolvers<void>(),
    fail,
  };
  const pending = start(handle);
  void pending.catch(() => {});
  await secondPrincipal.entered.promise;
  expect(listenArgs).toHaveLength(0);
  expect(acquired).toBe(0);
  const state = referenceDeploymentState(handle);
  if (state.profile !== "read-update" || !actualComposition)
    throw Error("missing genuine RU capture");
  expect(
    isDeepStrictEqual(assemblePreparedDevelopmentArguments(state.installed, actualComposition), [
      {
        directory: state.installed.directory,
        port: state.installed.port,
        create: state.installed.create,
        token: state.installed.credentials[0]!.token,
      },
      actualComposition,
      { configuration: state.installed.configuration, credentials: state.installed.credentials },
      {
        scope: state.installed.scope,
        host: state.installed.host,
        schemas: state.installed.schemas,
      },
    ]),
  ).toBe(true);
  expect(vi.mocked(compositions.createDevelopmentComposition)).toHaveBeenCalledTimes(1);
  secondPrincipal.release.resolve();
  if (fail) {
    await expect(pending).rejects.toBe(primary);
    expect(ownerCloses).toBe(1);
    expect(listenArgs).toHaveLength(0);
  } else {
    const runtime = await pending;
    expect(trace.lastIndexOf("route")).toBeLessThan(trace.indexOf("listen"));
    await runtime.close();
  }
  emit("S02-" + fail);
});
it("S03 TX explicit preflight precedes constructor and intended bind; constructor throw owns direct close", async () => {
  const f = await fixture("transactional"),
    h = await f.prepare(),
    runtime = await start(h);
  expect(trace.indexOf("readback")).toBeLessThan(trace.indexOf("service-attempt"));
  expect(listenArgs[0]!.slice(0, 2)).toEqual([h.listener.port, h.listener.host]);
  expect(h.listener.port).toBeGreaterThan(0);
  await runtime.close();
  expect(serviceCloses).toBe(1);
  expect(ownerCloses).toBe(1);
  const phaseA = counts();
  const next = await fixture("transactional");
  trace = [];
  listenArgs = [];
  returned = ownerCloses = serviceCloses = serviceAttempts = configurationReads = acquired = 0;
  primary = new Error("constructor read sentinel");
  constructorThrow = true;
  await expect(startPreparedReferenceDeployment(await next.prepare())).rejects.toBe(primary);
  expect(configurationReads).toBe(2);
  expect(serviceAttempts).toBe(1);
  expect(serviceCloses).toBe(0);
  expect(ownerCloses).toBe(1);
  expect(listenArgs).toHaveLength(0);
  emit("S03", { phaseA, phaseB: counts() });
});
it.each([
  ["read-update", "scope"],
  ["read-update", "readLimits"],
  ["read-update", "installedTypes"],
  ["transactional", "receiptMaximumItems"],
  ["transactional", "scopeSnapshot"],
  ["transactional", "authorizationView"],
  ["transactional", "installedTypes"],
] as const)("S04 owner readback refuses %s %s before construction/bind", async (profile, field) => {
  const f = await fixture(profile);
  corruption = field;
  await expect(startPreparedReferenceDeployment(await f.prepare())).rejects.toThrow();
  expect(listenArgs).toHaveLength(0);
  expect(returned).toBe(1);
  expect(ownerCloses).toBe(1);
  expect(serviceCloses).toBe(0);
  expect(serviceAttempts).toBe(0);
  emit("S04-" + profile + "-" + field);
});
const persisted = [
  ...[
    "format",
    "scope",
    "installation",
    "lineage",
    "contractCapture",
    "installed-types",
    "resource-uninstalled-type",
    "retained-runtime-compatibility",
  ].map((row) => ["read-update", row] as const),
  ...[
    "format",
    "receiptMaximumItems",
    "snapshotLimits",
    "snapshotTokenPolicy",
    "initialAuthorizationView",
    "policyStorageRevision",
    "identityPolicy",
    "contractIdentity",
    "runtimeLimits",
    "scope",
    "types",
    "contractCapture",
    "authorizationPolicy",
  ].map((row) => ["transactional", row] as const),
];
it.each(persisted)(
  "S05 persisted %s %s refuses with observed internal SQLite close",
  async (profileName, row) => {
    const profile = profileName as Profile,
      f = await fixture(profile),
      initial = await f.prepare(),
      seed = await bare(initial);
    if (
      profile === "read-update" &&
      (row === "resource-uninstalled-type" || row === "retained-runtime-compatibility")
    ) {
      if (!("forPrincipal" in seed)) throw Error("RU owner required");
      await seed.forPrincipal({ id: "writer" }).mutate(
        "createBead",
        JSON.stringify({
          id: "beads/seed",
          type: f.type,
          properties: { n: row === "retained-runtime-compatibility" ? "invalid" : 1 },
        }),
        "seed",
      );
    }
    await seed.close();
    const db = new DatabaseSync(f.file);
    db.function("bdp_json_syntax_v2", { deterministic: true }, (text) => {
      try {
        JSON.parse(String(text));
        return 1;
      } catch {
        return 0;
      }
    });
    const originalMetadata = db.prepare("SELECT name,value FROM metadata").all();
    const originalTypes =
      profile === "read-update" ? db.prepare("SELECT id,body FROM installed_types").all() : [];
    const originalResources = db.prepare("SELECT id,body FROM resources").all();
    const outcomes =
      profile === "read-update"
        ? db.prepare("SELECT principal,key,outcome FROM key_state WHERE state='retained'").all()
        : [];
    if (profile === "transactional" && !["contractCapture", "authorizationPolicy"].includes(row)) {
      const config = JSON.parse(
        String(db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()!.value),
      );
      config[row] = "invalid-selected-installation-field";
      db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(
        JSON.stringify(config),
      );
    } else if (row === "installed-types") {
      const first = originalTypes[0]!;
      const body = JSON.parse(String(first.body));
      body.name = "Changed";
      db.prepare("UPDATE installed_types SET body=? WHERE id=?").run(
        JSON.stringify(body),
        String(first.id),
      );
    } else if (row === "resource-uninstalled-type") {
      const first = originalResources[0]!;
      const body = JSON.parse(String(first.body));
      body.type = f.scope + "types/absent";
      db.prepare("UPDATE resources SET body=? WHERE id=?").run(
        JSON.stringify(body),
        String(first.id),
      );
    } else if (row === "retained-runtime-compatibility") {
      const first = outcomes[0]!;
      const body = JSON.parse(String(first.outcome));
      expect(body.disposition.diagnostics.length).toBeGreaterThan(0);
      body.disposition.diagnostics = Array.from(
        { length: 33 },
        () => body.disposition.diagnostics[0],
      );
      db.prepare("UPDATE key_state SET outcome=? WHERE principal=? AND key=?").run(
        JSON.stringify(body),
        String(first.principal),
        String(first.key),
      );
    } else
      db.prepare("UPDATE metadata SET value=? WHERE name=?").run(
        row === "authorizationPolicy" ? "{}" : "invalid-selected-metadata",
        row,
      );
    db.close();
    const marker = sql.rows.length,
      attempts = trace.length;
    await expect(startPreparedReferenceDeployment(await f.prepare(false))).rejects.toThrow();
    const internal = sql.rows.slice(marker).map((value) => ({ ...value }));
    expect(internal).toHaveLength(1);
    expect(internal[0]!.closed).toBe(true);
    expect(returned).toBe(0);
    expect(listenArgs).toHaveLength(0);
    const restore = new DatabaseSync(f.file);
    restore.function("bdp_json_syntax_v2", { deterministic: true }, (text) => {
      try {
        JSON.parse(String(text));
        return 1;
      } catch {
        return 0;
      }
    });
    for (const record of originalMetadata)
      restore
        .prepare("UPDATE metadata SET value=? WHERE name=?")
        .run(String(record.value), String(record.name));
    for (const record of originalTypes)
      restore
        .prepare("UPDATE installed_types SET body=? WHERE id=?")
        .run(String(record.body), String(record.id));
    for (const record of originalResources)
      restore
        .prepare("UPDATE resources SET body=? WHERE id=?")
        .run(String(record.body), String(record.id));
    for (const record of outcomes)
      restore
        .prepare("UPDATE key_state SET outcome=? WHERE principal=? AND key=?")
        .run(String(record.outcome), String(record.principal), String(record.key));
    restore.close();
    const probe = await bare(await f.prepare(false));
    await probe.close();
    emit("S05-" + profile + "-" + row, {
      openerTrace: trace.slice(attempts),
      internalAcquisitionAndClose: internal,
      genuineProbeClosed: true,
      databaseBytesUnchangedClaim: false,
    });
  },
);
it.each(["read-update", "transactional"] as const)(
  "S06 absent create:false %s never acquires SQLite or listener",
  async (profile) => {
    const f = await fixture(profile),
      before = sql.rows.length,
      directoryBefore = existsSync(f.directory),
      filesBefore = directoryBefore ? readdirSync(f.directory) : [];
    await expect(startPreparedReferenceDeployment(await f.prepare(false))).rejects.toThrow();
    expect(sql.rows.length).toBe(before);
    expect(returned).toBe(0);
    expect(listenArgs).toHaveLength(0);
    expect(existsSync(f.file)).toBe(false);
    expect(existsSync(f.directory)).toBe(directoryBefore);
    expect(directoryBefore ? readdirSync(f.directory) : []).toEqual(filesBefore);
    emit("S06-" + profile);
  },
);
it.each(["read-update", "transactional"] as const)(
  "S07 occupied intended port %s closes owner without acquisition",
  async (profile) => {
    const f = await fixture(profile),
      blocker = createPortReservation();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(f.input.server.port, f.input.server.host, resolve);
    });
    try {
      await expect(startPreparedReferenceDeployment(await f.prepare())).rejects.toThrow();
      expect(blocker.listening).toBe(true);
      expect(listenArgs).toHaveLength(1);
      expect(acquired).toBe(0);
      expect(ownerCloses).toBe(1);
      expect(existsSync(f.file)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
    emit("S07-" + profile);
  },
);
it.each(["read-update", "transactional"] as const)(
  "S08 synchronous listen throw %s keeps primary and closes owner",
  async (profile) => {
    const f = await fixture(profile);
    listenFailure = new Error("listen sentinel");
    await expect(startPreparedReferenceDeployment(await f.prepare())).rejects.toBe(listenFailure);
    expect(listenArgs).toHaveLength(1);
    expect(acquired).toBe(0);
    expect(ownerCloses).toBe(1);
    emit("S08-" + profile);
  },
);
it.each(["read-update", "transactional"] as const)(
  "S09 post-listening fault %s suppresses result and closes acquired owner",
  async (profile) => {
    const f = await fixture(profile);
    eventFailure = new Error("post-event sentinel");
    await expect(startPreparedReferenceDeployment(await f.prepare())).rejects.toBe(eventFailure);
    expect(acquired).toBe(1);
    expect(ownerCloses).toBe(1);
    expect(servers.every((s) => !s.listening)).toBe(true);
    emit("S09-" + profile, {
      injectedTurn: "first native listening event before startup continuation",
    });
  },
);
it.each(["read-update", "transactional"] as const)(
  "S10 observed primary plus close failure %s preserves both causes",
  async (profile) => {
    const f = await fixture(profile);
    listenFailure = new Error("primary sentinel");
    closeFailure = new Error("cleanup sentinel");
    let failure: unknown;
    try {
      await startPreparedReferenceDeployment(await f.prepare());
    } catch (error) {
      failure = error;
    }
    const causes = (value: unknown): unknown[] =>
      value instanceof AggregateError
        ? [value, ...value.errors.flatMap(causes)]
        : value instanceof Error && "cause" in value
          ? [value, ...causes(value.cause)]
          : [value];
    expect(failure).toBeInstanceOf(AggregateError);
    expect(causes(failure).includes(listenFailure)).toBe(true);
    expect(causes(failure).includes(closeFailure)).toBe(true);
    expect(ownerCloses).toBe(1);
    expect(callbackSQLite().every((value) => value.closed)).toBe(true);
    emit("S10-" + profile, { observedPrimary: true, observedCleanupFailure: true });
  },
);
it.each(["read-update", "transactional"] as const)(
  "S11 memoized trusted close and exact legacy shape %s",
  async (profile) => {
    const f = await fixture(profile),
      runtime = await start(await f.prepare());
    let completed = false;
    void runtime.completion.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    await Promise.resolve();
    expect(completed).toBe(false);
    const first = runtime.close();
    expect(runtime.close()).toBe(first);
    await Promise.all([first, runtime.close(), runtime.completion]);
    expect(ownerCloses).toBe(1);
    const trusted = counts(),
      next = await fixture(profile),
      handle = await next.prepare(),
      state = referenceDeploymentState(handle);
    const old =
      state.profile === "read-update"
        ? await startDevelopmentReferenceRuntime(
            {
              directory: state.installed.directory,
              port: 0,
              create: true,
              token: state.installed.credentials[0]!.token,
            },
            undefined,
            undefined,
            compose(new URL(state.installed.scope).pathname),
            {
              configuration: state.installed.configuration,
              credentials: state.installed.credentials,
            },
            {
              scope: state.installed.scope,
              host: state.installed.host,
              schemas: state.installed.schemas,
            },
          )
        : await startTransactionRuntime(state.installed);
    active.push(old);
    expect(Object.keys(old).sort()).toEqual(
      (profile === "read-update"
        ? ["scope", "close"]
        : [
            "scope",
            "listenUrl",
            "configurationMetadata",
            "replaceAuthorizationPolicy",
            "targets",
            "close",
          ]
      ).sort(),
    );
    expect(servers.at(-1)!.listenerCount("error")).toBe(0);
    await old.close();
    expect(ownerCloses).toBe(2);
    emit("S11-" + profile, { trusted, additionalLegacyRuntimeAcquisitions: 1 });
  },
);
it.each(["read-update", "transactional"] as const)(
  "S12 admitted mutation %s drains after transport abort and persists",
  async (profile) => {
    const f = await fixture(profile),
      runtime = await start(await f.prepare());
    mutation = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
    const body =
      profile === "read-update"
        ? { id: "beads/startup", type: f.type, properties: { n: 1 } }
        : { id: "beads/startup", type: f.type, properties: { n: 1 } };
    const response = fetch(new URL("operations/create-bead", f.scope), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": "admitted",
      },
      body: JSON.stringify(body),
    }).then(
      async (r) => ({ state: "response", status: r.status, body: await r.text() }),
      () => ({ state: "aborted-transport" }),
    );
    await mutation.entered.promise;
    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });
    const delivered = await response;
    expect(closed).toBe(false);
    mutation.release.resolve();
    await closing;
    expect(delivered.state).toBe("aborted-transport");
    const reopened = await bare(await f.prepare(false));
    await reopened.close();
    const db = new DatabaseSync(f.file);
    const rows = db.prepare("SELECT body FROM resources").all();
    db.close();
    expect(
      rows
        .map((row) => JSON.parse(String(row.body)))
        .some((row) => row.id === f.scope + "beads/startup" && row.properties.n === 1),
    ).toBe(true);
    emit("S12-" + profile, { HTTP: 1, delivered: delivered.state, persistedActualResource: true });
  },
);
it.each(["read-update", "transactional"] as const)(
  "S13 cancellation %s observes preparation settlement and never late binds",
  async (profile) => {
    const f = await fixture(profile),
      controller = new AbortController(),
      handle = await f.prepare();
    const already = new AbortController();
    already.abort();
    await expect(startPreparedReferenceDeployment(handle, already.signal)).rejects.toThrow();
    expect(returned).toBe(0);
    if (profile === "read-update") {
      secondPrincipal = {
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
        fail: false,
      };
      const pending = startPreparedReferenceDeployment(handle, controller.signal);
      void pending.catch(() => {});
      await secondPrincipal.entered.promise;
      controller.abort();
      expect(listenArgs).toHaveLength(0);
      secondPrincipal.release.resolve();
      await expect(pending).rejects.toThrow();
    } else {
      abortOnOpen = controller;
      await expect(startPreparedReferenceDeployment(handle, controller.signal)).rejects.toThrow();
    }
    expect(ownerCloses).toBe(1);
    expect(listenArgs).toHaveLength(0);
    emit("S13-" + profile);
  },
);
