import { connect } from "node:net";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  captureTransactionRuntimeConfiguration,
  TRANSACTION_RUNTIME_DEFAULTS,
  transactionRuntimeDigest,
} from "./transaction-runtime-configuration.js";
import { TRANSACTION_SELECTOR_LIMITS } from "./transaction-set.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { openTransactionStore, TRANSACTION_RECEIPT_DETAIL_MS } from "./transaction-store.js";
import type {
  TransactionRuntimeOptions,
  TransactionRuntimeTestSeams,
} from "./transaction-runtime.js";
const { startTransactionRuntime } = (await import(
  new URL("../dist/transaction-runtime.js", import.meta.url).href
)) as typeof import("./transaction-runtime.js");
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const scope = "https://canonical.test/acme/",
  token = "a".repeat(32),
  readToken = "b".repeat(32);
function fixture(canonicalScope = scope) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-runtime-config-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const type = `${canonicalScope}types/item`,
    schema = `${canonicalScope}schemas/item`;
  const descriptor = {
    id: type,
    name: "Item",
    describes: "bead" as const,
    conformsTo: [],
    propertiesSchema: schema,
  };
  return {
    directory,
    scope: canonicalScope,
    create: true,
    port: 0,
    authorityMode: "canonical" as "canonical" | "listener",
    credentials: [
      { token, principal: "same", canMutate: true },
      { token: readToken, principal: "same", canMutate: false },
    ],
    artifacts: {
      descriptors: [{ retrievalUri: type, utf8: JSON.stringify(descriptor) }],
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
      limits: { ...CONTRACT_ARTIFACT_CEILINGS },
    },
  };
}
async function start(options: TransactionRuntimeOptions, seams?: TransactionRuntimeTestSeams) {
  const runtime = await startTransactionRuntime(options, seams);
  cleanup.push(() => runtime.close());
  return runtime;
}
/** Dial, Host and raw target are independent; no fetch Host synthesis. */
function wire(
  dial: string,
  host: string,
  target: string,
  options: { method?: string; body?: string; credential?: string; key?: string } = {},
) {
  return new Promise<{ status: number; headers: string; body: string }>((resolve, reject) => {
    const address = new URL(dial),
      socket = connect({ host: address.hostname, port: Number(address.port) });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => socket.destroy(new Error("runtime wire deadline")), 5000);
    socket.once("error", reject);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("close", () => clearTimeout(timer));
    socket.once("end", () => {
      const response = Buffer.concat(chunks).toString(),
        offset = response.indexOf("\r\n\r\n");
      resolve({
        status: Number(response.split(" ")[1]),
        headers: response.slice(0, offset),
        body: response.slice(offset + 4),
      });
    });
    socket.once("connect", () =>
      socket.end(
        `${options.method ?? "GET"} ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nAuthorization: Bearer ${options.credential ?? token}\r\n${options.body === undefined ? "" : `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(options.body)}\r\nIdempotency-Key: ${options.key ?? "once"}\r\n`}\r\n${options.body ?? ""}`,
      ),
    );
  });
}
function createBody(canonicalScope = scope, id = "beads/a") {
  return JSON.stringify({
    operations: [
      { operation: "createBead", id, type: `${canonicalScope}types/item`, properties: { n: 1 } },
    ],
  });
}
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing expected runtime metadata");
  return value;
}

it("serves a real default compiled canonical runtime and detaches inputs and seams before await", async () => {
  const options = fixture(),
    seams: Record<string, unknown> = {};
  const pending = start(options, seams);
  present(options.credentials[0]).canMutate = false;
  present(options.credentials[0]).principal = "changed";
  present(options.artifacts.descriptors[0]).utf8 = "bad";
  options.artifacts.schemas.length = 0;
  options.directory = "/not-the-captured-directory";
  seams.clock = () => 0;
  seams.receiptMaximumItems = 1;
  seams.maintenanceIntervalMs = 1;
  const runtime = await pending,
    metadata = present(runtime.configurationMetadata);
  expect(metadata).toMatchObject({
    profile: "transactional",
    history: false,
    claimEligible: false,
    scope,
    authorityMode: "canonical",
  });
  expect(metadata.runtimeConfigurationIdentity).toMatch(/^[a-f0-9]{64}$/);
  expect(metadata.artifactIdentity).toMatch(/^development-schema5-[a-f0-9]{64}$/);
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(JSON.stringify(metadata)).not.toContain(token);
  const response = await wire(runtime.listenUrl, "canonical.test", "/acme/operations/batch", {
    method: "POST",
    body: createBody(),
  });
  expect(response.status).toBe(200);
  const receipt = JSON.parse(response.body);
  expect(receipt.status).toBe("completed");
  expect(Date.parse(receipt.expiresAt)).toBeGreaterThan(Date.now());
  const record = await wire(runtime.listenUrl, "canonical.test", "/acme/beads/a");
  expect(record.status).toBe(200);
  expect(JSON.parse(record.body).properties).toEqual({ n: 1 });
  expect((await wire(runtime.listenUrl, "canonical.test", "/acme/types/item")).body).toContain(
    '"name":"Item"',
  );
});

it("separates all four authority cases, nondefault ports and request default-port refusal", async () => {
  const canonical = await start(fixture());
  // This private receiver deliberately requires the canonical Host bytes exactly;
  // it does not yet claim complete HTTP hostname-equivalence handling.
  for (const host of [
    new URL(canonical.listenUrl).host,
    "foreign.test",
    "canonical.test:443",
    "Canonical.Test",
    "canonical.test.",
  ]) {
    expect(
      (
        await wire(canonical.listenUrl, host, "/acme/operations/batch", {
          method: "POST",
          body: createBody(),
          key: host.replace(/[^a-z]/g, ""),
        })
      ).status,
    ).toBe(400);
  }
  expect((await wire(canonical.listenUrl, "canonical.test", "/acme/beads/a")).status).toBe(404);
  expect((await wire(canonical.listenUrl, "canonical.test", "/acme/types/item")).status).toBe(200);
  const options = fixture();
  options.authorityMode = "listener";
  const listener = await start(options);
  const canonicalMetadata = present(canonical.configurationMetadata),
    listenerMetadata = present(listener.configurationMetadata);
  expect(canonicalMetadata.authorityMode).toBe("canonical");
  expect(listenerMetadata.authorityMode).toBe("listener");
  expect(listenerMetadata.runtimeConfigurationIdentity).not.toBe(
    canonicalMetadata.runtimeConfigurationIdentity,
  );
  for (const field of ["artifactIdentity", "policyIdentity", "authenticationIdentity"] as const)
    expect(listenerMetadata[field]).toBe(canonicalMetadata[field]);
  expect((await wire(listener.listenUrl, "canonical.test", "/acme/types/item")).status).toBe(400);
  expect(
    (await wire(listener.listenUrl, new URL(listener.listenUrl).host, "/acme/types/item")).status,
  ).toBe(200);
  const nondefault = await start(fixture("https://canonical.test:8443/acme/"));
  expect((await wire(nondefault.listenUrl, "canonical.test:8443", "/acme/types/item")).status).toBe(
    200,
  );
  expect((await wire(nondefault.listenUrl, "canonical.test", "/acme/types/item")).status).toBe(400);
  await expect(
    startTransactionRuntime({ ...fixture(), scope: "https://canonical.test:443/acme/" }),
  ).rejects.toThrow();
});

it("preserves logical identity across reopen and separate live listener ports; permissions are per token", async () => {
  const options = fixture(),
    first = await start(options),
    other = await start({ ...options, directory: fixture().directory });
  expect(other.listenUrl).not.toBe(first.listenUrl); // Both sockets are bound concurrently.
  expect(other.configurationMetadata).toEqual(first.configurationMetadata);
  expect(
    (
      await wire(first.listenUrl, "canonical.test", "/acme/operations/batch", {
        method: "POST",
        body: createBody(),
        credential: readToken,
      })
    ).status,
  ).toBe(403);
  const response = await wire(first.listenUrl, "canonical.test", "/acme/operations/batch", {
    method: "POST",
    body: createBody(),
  });
  expect(response.status).toBe(200);
  const metadata = present(first.configurationMetadata);
  await first.close();
  const reopened = await start({ ...options, create: false });
  expect(reopened.configurationMetadata).toEqual(metadata);
  expect(
    (
      await wire(reopened.listenUrl, "canonical.test", "/acme/operations/batch", {
        method: "POST",
        body: createBody(),
      })
    ).body,
  ).toBe(response.body);
  await reopened.close();
  const swapped = await start({
    ...options,
    create: false,
    credentials: options.credentials.map((c) => ({ ...c, canMutate: !c.canMutate })),
  });
  const changed = present(swapped.configurationMetadata);
  for (const field of [
    "runtimeConfigurationIdentity",
    "policyIdentity",
    "authenticationIdentity",
  ] as const)
    expect(changed[field]).not.toBe(metadata[field]);
  expect(changed.artifactIdentity).toBe(metadata.artifactIdentity);
  expect(
    (
      await wire(swapped.listenUrl, "canonical.test", "/acme/operations/batch", {
        method: "POST",
        body: createBody(scope, "beads/b"),
        key: "new",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await wire(swapped.listenUrl, "canonical.test", "/acme/operations/batch", {
        method: "POST",
        body: createBody(scope, "beads/b"),
        key: "new",
        credential: readToken,
      })
    ).status,
  ).toBe(200);
  expect((await wire(swapped.listenUrl, "canonical.test", "/acme/beads/b")).status).toBe(200);
});

it.each([
  "clock",
  "scheduler",
  "comparison",
  "minimumReads",
  "maximumOperations",
  "receiptMaximumItems",
  "maintenanceIntervalMs",
])("suppresses metadata for explicitly supplied undefined seam %s", async (key) => {
  const runtime = await start(fixture(), { [key]: undefined });
  expect(runtime.configurationMetadata).toBeUndefined();
});
it("suppresses numeric seams and schema-free metadata without changing private serving", async () => {
  const runtime = await start(fixture(), { receiptMaximumItems: 2 });
  expect(runtime.configurationMetadata).toBeUndefined();
  expect((await wire(runtime.listenUrl, "canonical.test", "/acme/types/item")).status).toBe(200);
  const options = fixture();
  const { artifacts: _artifacts, ...schemaFree } = options;
  const descriptor = {
    id: `${scope}types/plain`,
    name: "Plain",
    describes: "bead" as const,
    conformsTo: [],
  };
  expect(
    (await start({ ...schemaFree, types: [descriptor] })).configurationMetadata,
  ).toBeUndefined();
});
it("rejects accessors, proxies and unknown data before provisioning without getter evaluation", async () => {
  let calls = 0;
  const getter = {
    get clock() {
      calls++;
      return () => 0;
    },
  };
  const options = fixture();
  for (const seams of [
    getter,
    new Proxy({}, {}),
    { unknown: 1 },
    {
      comparison: {
        get now() {
          calls++;
          return () => 0;
        },
      },
    },
  ]) {
    await expect(
      startTransactionRuntime(options, seams as TransactionRuntimeTestSeams),
    ).rejects.toThrow();
    expect(existsSync(path.join(options.directory, "transaction.sqlite"))).toBe(false);
  }
  await expect(
    startTransactionRuntime({
      ...options,
      get credentials() {
        calls++;
        return options.credentials;
      },
    }),
  ).rejects.toThrow();
  await expect(startTransactionRuntime(new Proxy(options, {}))).rejects.toThrow();
  expect(calls).toBe(0);
});
it("bounds administrative credentials by count and UTF8 principal bytes, preserving non-ASCII", () => {
  const options = fixture();
  const bounded = {
    ...options,
    credentials: [{ token, principal: "é".repeat(8192), canMutate: true }],
  };
  expect(
    captureTransactionRuntimeConfiguration(bounded).authenticate(Buffer.from(`Bearer ${token}`)),
  ).toMatchObject({ principal: bounded.credentials[0]?.principal });
  expect(() =>
    captureTransactionRuntimeConfiguration({
      ...bounded,
      credentials: [{ token, principal: "é".repeat(8192) + "x", canMutate: true }],
    }),
  ).toThrow();
  const credentials = Array.from({ length: 32 }, (_, i) => ({
    token: String(i).padStart(32, "x"),
    principal: "p",
    canMutate: true,
  }));
  expect(() => captureTransactionRuntimeConfiguration({ ...options, credentials })).not.toThrow();
  expect(() =>
    captureTransactionRuntimeConfiguration({
      ...options,
      credentials: [...credentials, { token: "z".repeat(32), principal: "p", canMutate: true }],
    }),
  ).toThrow();
  expect(existsSync(path.join(options.directory, "transaction.sqlite"))).toBe(false);
});
it("binds the live closure and fixed policy, not compatibility JSON; credential ordering is immaterial", () => {
  const options = fixture(),
    captured = captureTransactionRuntimeConfiguration(options);
  const owner = openTransactionStore({
    file: path.join(options.directory, "transaction.sqlite"),
    scope,
    create: true,
    types: captured.types,
    contracts: present(captured.contracts),
  });
  cleanup.push(() => owner.close());
  const actual = owner.readConfiguration(),
    metadata = present(captured.metadata(actual, scope));
  expect(metadata.runtimeConfigurationIdentity).not.toBe(
    actual.scopeConfiguration.configurationIdentity,
  );
  expect(metadata.policyIdentity).not.toBe(actual.scopeConfiguration.policyIdentity);
  expect(metadata.artifactIdentity).toBe(captured.contracts?.identity);
  expect(
    captureTransactionRuntimeConfiguration({
      ...options,
      credentials: [...options.credentials].reverse(),
    }).metadata(actual, scope),
  ).toEqual(metadata);
  expect(() =>
    captured.metadata(
      { ...actual, authorizationView: "forged" } as unknown as typeof actual,
      scope,
    ),
  ).toThrow(/policy/);
  expect(() => captured.metadata({ ...actual, installedTypes: [] }, scope)).toThrow(/closure/);
  expect(TRANSACTION_RUNTIME_DEFAULTS.receiptDetailMs).toBe(TRANSACTION_RECEIPT_DETAIL_MS);
  expect(TRANSACTION_RUNTIME_DEFAULTS.selector).toEqual(TRANSACTION_SELECTOR_LIMITS);
  expect(captured.settings.selector).toBe(captured.readOptions(scope).selectorLimits);
  expect(captured.readOptions(scope).advertisedLimits.selector).toBe(captured.settings.selector);
});
it("binds the owner Scope Snapshot tuple separately from query pagination and store compatibility", () => {
  const options = fixture(),
    captured = captureTransactionRuntimeConfiguration(options);
  const owner = openTransactionStore({
    file: path.join(options.directory, "transaction.sqlite"),
    scope,
    create: true,
    types: captured.types,
    contracts: present(captured.contracts),
  });
  cleanup.push(() => owner.close());
  const actual = owner.readConfiguration(),
    metadata = present(captured.metadata(actual, scope));
  expect(actual.scopeSnapshot).toEqual(captured.settings.scopeSnapshot);
  expect(Object.isFrozen(actual.scopeSnapshot)).toBe(true);
  expect(Object.isFrozen(actual.scopeSnapshot.limits)).toBe(true);
  const stored = JSON.parse(actual.scopeConfiguration.configurationIdentity);
  expect(stored.snapshotLimits).toEqual(actual.scopeSnapshot.limits);
  expect(stored.snapshotTokenPolicy).toBe(actual.scopeSnapshot.tokenPolicy);
  expect(captured.settings.scopeSnapshot.limits.lifetimeMs).not.toBe(
    captured.settings.pagination.cursorTtlMs,
  );
  expect(metadata.runtimeConfigurationIdentity).toBe(
    transactionRuntimeDigest({
      revision: "transaction-runtime-1",
      scope,
      artifactIdentity: metadata.artifactIdentity,
      settings: captured.settings,
      authorityMode: metadata.authorityMode,
      policyIdentity: metadata.policyIdentity,
      authenticationIdentity: metadata.authenticationIdentity,
      profile: "transactional",
      history: false,
    }),
  );
  for (const scopeSnapshot of [
    {
      ...actual.scopeSnapshot,
      limits: {
        ...actual.scopeSnapshot.limits,
        lifetimeMs: actual.scopeSnapshot.limits.lifetimeMs + 1,
      },
    },
    { ...actual.scopeSnapshot, tokenPolicy: "different-policy" },
  ])
    expect(() => captured.metadata({ ...actual, scopeSnapshot } as typeof actual, scope)).toThrow(
      "Snapshot configuration mismatch",
    );
});
it("binds every default tuple leaf in the pure digest dependency test (not a served override)", () => {
  const original = transactionRuntimeDigest(TRANSACTION_RUNTIME_DEFAULTS);
  function visit(value: unknown, keys: string[] = []) {
    if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) visit(v, [...keys, key]);
      return;
    }
    const changed: Record<string, unknown> = structuredClone(TRANSACTION_RUNTIME_DEFAULTS);
    let parent = changed;
    for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    parent[present(keys.at(-1))] =
      typeof value === "number" ? value + 1 : `${String(value)}-changed`;
    expect(transactionRuntimeDigest(changed), keys.join(".")).not.toBe(original);
  }
  visit(TRANSACTION_RUNTIME_DEFAULTS);
});

it("detaches supplied Type inventory and nested seams without qualifying injected behavior", async () => {
  const options = fixture();
  const captured = captureTransactionRuntimeConfiguration(options);
  const types = structuredClone(captured.types);
  const comparison = { budgetMs: 1000 },
    minimumReads = { budgetMs: 1000 };
  const pending = start({ ...options, types }, { comparison, minimumReads });
  comparison.budgetMs = -1;
  minimumReads.budgetMs = -1;
  Object.assign(present(types[0]), { name: "changed" });
  const runtime = await pending;
  expect(runtime.configurationMetadata).toBeUndefined();
  expect(
    (
      await wire(runtime.listenUrl, "canonical.test", "/acme/operations/batch", {
        method: "POST",
        body: createBody(),
      })
    ).status,
  ).toBe(200);
  expect((await wire(runtime.listenUrl, "canonical.test", "/acme/types/item")).body).toContain(
    '"name":"Item"',
  );
});
it("retains exact supplied closure refusal and closes startup resources for a valid retry", async () => {
  const options = fixture(),
    capture = captureTransactionRuntimeConfiguration(options);
  const wrongTypes = capture.types.map((d) => ({ ...d, name: "mismatch" }));
  await expect(startTransactionRuntime({ ...options, types: wrongTypes })).rejects.toThrow(
    /descriptor mismatch/,
  );
  expect(existsSync(path.join(options.directory, "transaction.sqlite"))).toBe(false);
  const runtime = await start(options);
  expect(runtime.configurationMetadata).toBeDefined();
  expect((await wire(runtime.listenUrl, "canonical.test", "/acme/types/item")).status).toBe(200);
});
it("refuses invalid numeric seams before store provisioning", async () => {
  const options = fixture();
  for (const seam of [
    { receiptMaximumItems: 0 },
    { maintenanceIntervalMs: 0 },
    { maximumOperations: 0 },
    { comparison: { budgetMs: -1 } },
  ]) {
    await expect(startTransactionRuntime(options, seam)).rejects.toThrow();
    expect(existsSync(path.join(options.directory, "transaction.sqlite"))).toBe(false);
  }
});

it("refuses unused scheduler keys before provisioning while preserving the turn-only seam", async () => {
  const options = fixture();
  const turn = () => () => {};
  expect(() =>
    captureTransactionRuntimeConfiguration(options, { scheduler: { turn } }),
  ).not.toThrow();
  for (const delay of [undefined, () => () => {}]) {
    const scheduler = { turn, delay };
    await expect(startTransactionRuntime(options, { scheduler })).rejects.toThrow(
      "closed own-data runtime configuration required",
    );
    expect(existsSync(path.join(options.directory, "transaction.sqlite"))).toBe(false);
  }
});

it("binds credentials through the versioned credential domain without asserting entropy", async () => {
  const runtime = await start(fixture());
  const associations = [
    { token, principal: "same", canMutate: true },
    { token: readToken, principal: "same", canMutate: false },
  ]
    .map(({ token, ...rest }) => ({
      tokenDigest: transactionRuntimeDigest({ revision: "transaction-credential-1", token }),
      ...rest,
    }))
    .sort((a, b) => (a.tokenDigest < b.tokenDigest ? -1 : a.tokenDigest > b.tokenDigest ? 1 : 0));
  expect(present(runtime.configurationMetadata).authenticationIdentity).toBe(
    transactionRuntimeDigest({
      revision: "transaction-authentication-1",
      scheme: "bearer",
      associations,
    }),
  );
  // The predictable fixture tokens intentionally demonstrate no entropy-provenance
  // claim; installed evidence must generate credentials with a CSPRNG.
  expect((await wire(runtime.listenUrl, "canonical.test", "/acme/types/item")).status).toBe(200);
});

it("hashes actual stream defaults and all four transport timers; timing seams remain unattestable", async () => {
  const options = fixture(),
    captured = captureTransactionRuntimeConfiguration(options);
  expect(captured.settings.changefeedStream).toEqual({
    pollMilliseconds: 100,
    heartbeatMilliseconds: 5000,
    maximumStreams: 1,
  });
  expect(captured.settings.transport).toMatchObject({
    requestTimeout: 10000,
    headersTimeout: 10000,
    timeout: 10000,
    keepAliveTimeout: 1000,
  });
  expect(Object.isFrozen(captured.settings.changefeedStream)).toBe(true);
  expect(captured.settings.eventStream).toEqual({
    maximumGroupsPerObservation: 1,
    packetBytes: 4194304,
  });
  expect(Object.isFrozen(captured.settings.eventStream)).toBe(true);
  const runtime = await startTransactionRuntime(options, { transport: { timeout: 100 } });
  cleanup.push(() => runtime.close());
  expect(runtime.configurationMetadata).toBeUndefined();
  for (const transport of [
    { timeout: 0 },
    { timeout: undefined },
    { headersTimeout: 20000 },
    { unknown: 1 },
  ])
    expect(() =>
      captureTransactionRuntimeConfiguration(options, { transport } as TransactionRuntimeTestSeams),
    ).toThrow();
  const getter = {
    get timeout(): number {
      throw Error("executed getter");
    },
  };
  expect(() => captureTransactionRuntimeConfiguration(options, { transport: getter })).toThrow(
    "own-data",
  );
});

it("effective stream availability preserves finite-only idle seams at the strict boundary", () => {
  const options = fixture();
  for (const [timeout, available] of [
    [100, false],
    [5000, false],
    [5001, true],
  ] as const) {
    const captured = captureTransactionRuntimeConfiguration(options, { transport: { timeout } });
    expect(captured.liveStreamsAvailable).toBe(available);
    expect(captured.settings.transport.timeout).toBe(timeout);
    expect(captured.settings.changefeedStream).toEqual(
      TRANSACTION_RUNTIME_DEFAULTS.changefeedStream,
    );
    expect(Object.isFrozen(captured.settings.changefeedStream)).toBe(true);
    expect(captured.settings.eventStream).toEqual({
      maximumGroupsPerObservation: 1,
      packetBytes: 4194304,
    });
    expect(Object.isFrozen(captured.settings.eventStream)).toBe(true);
  }
});
