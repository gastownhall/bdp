import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEVELOPMENT_READ_LIMITS } from "./development-authority.js";
import { captureInstalledReferenceConfiguration } from "./installed-reference-configuration.js";
import { captureInstalledTransactionConfiguration } from "./transaction-installed-configuration.js";
import {
  captureTransactionRuntimeConfiguration,
  TRANSACTION_RUNTIME_DEFAULTS,
} from "./transaction-runtime-configuration.js";
import { referenceDeploymentState } from "./reference-deployment-state.js";
import * as publicEntry from "./reference-deployment.js";
import {
  loadReferenceDeployment,
  ReferenceDeploymentError,
  type ReferenceDeploymentInput,
} from "./reference-deployment.js";

const forbidden = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("loader attempted owner/listener startup");
  }),
);
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
vi.mock("node:http", async (original) => ({
  ...(await original<typeof import("node:http")>()),
  createServer: forbidden,
}));
vi.mock("node:net", async (original) => ({
  ...(await original<typeof import("node:net")>()),
  createServer: forbidden,
}));
vi.mock("./recovery-store.js", async (original) => ({
  ...(await original<typeof import("./recovery-store.js")>()),
  openRecoveryStore: forbidden,
}));
vi.mock("./transaction-store.js", async (original) => ({
  ...(await original<typeof import("./transaction-store.js")>()),
  openTransactionStore: forbidden,
}));
vi.mock("./transaction-runtime.js", () => ({ startTransactionRuntime: forbidden }));
vi.mock("./transaction-installed.js", () => ({ startInstalledTransactionCandidate: forbidden }));
vi.mock("./installed-reference.js", () => ({ startInstalledReferenceCandidate: forbidden }));

const scope = "https://deployment.test/acme/";
const token = "deployment_writer_sentinel_01234567890123456789";
const readToken = "deployment_reader_sentinel_01234567890123456789";
const allow = { create: true, write: true, hidden: [], readOnly: [] };
const roots: string[] = [];
beforeEach(() => {
  forbidden.mockClear();
  vi.mocked(open).mockClear();
});
afterEach(() => {
  try {
    expect(forbidden).not.toHaveBeenCalled();
  } finally {
    vi.mocked(open).mockReset();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  }
});
// Reset only the mock history/one-shot implementations; the next test reinstalls
// the real open so it exercises an actual ordinary-file handle by default.
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
beforeEach(() => {
  vi.mocked(open).mockImplementation(realFs.open);
});
function artifacts() {
  const base = `${scope}types/base`,
    owner = `${scope}types/owner`,
    edge = `${scope}types/edge`,
    schema = `${scope}schemas/item`;
  return {
    descriptors: [
      {
        retrievalUri: base,
        utf8: JSON.stringify({
          id: base,
          name: "Base",
          describes: "bead",
          conformsTo: [],
          propertiesSchema: schema,
        }),
      },
      {
        retrievalUri: owner,
        utf8: JSON.stringify({
          id: owner,
          name: "Owner",
          describes: "bead",
          conformsTo: [base],
          ownsOutgoing: { [edge]: { max: 2 } },
        }),
      },
      {
        retrievalUri: edge,
        utf8: JSON.stringify({
          id: edge,
          name: "Edge",
          describes: "link",
          conformsTo: [],
          source: { conformsTo: [base], external: "opaque" },
          target: { conformsTo: [base], external: "opaque" },
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
}
function ru(directory: string) {
  return {
    format: "bdptest-reference-deployment-1",
    profile: "read-update",
    configuration: {
      directory,
      create: true,
      credentials: [
        { token, principal: "writer" },
        { token: readToken, principal: "reader" },
      ],
      policies: { writer: allow, reader: { ...allow, create: false, write: false } },
      contracts: {
        descriptors: [] as { retrievalUri: string; utf8: string }[],
        schemas: [] as { retrievalUri: string; utf8: string }[],
      },
      maximumEndpointMultiplicity: [] as {
        endpoint: string;
        linkConformsTo: string;
        max: number;
      }[],
    },
  };
}
function tx(directory: string) {
  return {
    format: "bdptest-reference-deployment-1",
    profile: "transactional",
    configuration: {
      directory,
      create: true,
      credentials: [
        { token, principal: "same", canMutate: true },
        { token: readToken, principal: "same", canMutate: false },
      ],
      artifacts: artifacts(),
    },
  };
}
function fixture(profile: "read-update" | "transactional" = "read-update") {
  const root = mkdtempSync(path.join(tmpdir(), "bdp-deployment-"));
  roots.push(root);
  const directory = path.join(root, "absent-store"),
    deploymentFile = path.join(root, "deployment.json");
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
    deploymentFile,
    scope: { url: scope },
    server: {
      host: "127.0.0.1",
      port: 43210,
      advertisedProfile: profile,
      limits: { ...structuredClone(limits), page: { ...limits.page } },
    },
  };
  const write = (value: unknown) => writeFileSync(deploymentFile, JSON.stringify(value));
  write(profile === "read-update" ? ru(directory) : tx(directory));
  return { root, directory, input, write };
}
async function failure(input: ReferenceDeploymentInput, code: string) {
  try {
    await loadReferenceDeployment(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ReferenceDeploymentError);
    expect(error).toMatchObject({ code });
    expect(error).not.toHaveProperty("cause");
    const text = `${String(error)} ${JSON.stringify(error)}`;
    for (const secret of [token, readToken, "payload_sentinel", "unsafe_key_sentinel"])
      expect(text).not.toContain(secret);
    return;
  }
  throw new Error("expected local preparation failure");
}
function inert(value: unknown) {
  expect(typeof value).not.toBe("function");
  if (value !== null && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    for (const [key, child] of Object.entries(value)) {
      expect([
        "credentials",
        "token",
        "authenticate",
        "metadata",
        "readOptions",
        "installed",
        "preflight",
        "projectedInput",
      ]).not.toContain(key);
      inert(child);
    }
  }
}
it("captures the RU default closure through the existing capture and exposes only an inert handle", async () => {
  const f = fixture(),
    body = ru(f.directory);
  const prepared = await loadReferenceDeployment(f.input);
  expect(open).toHaveBeenCalledTimes(1);
  const direct = captureInstalledReferenceConfiguration({
    scope,
    listener: { host: "127.0.0.1", port: 43210 },
    ...body.configuration,
  });
  expect(prepared).toMatchObject({
    profile: "read-update",
    canonicalScope: scope,
    listener: { host: "127.0.0.1", port: 43210 },
    preflightReadLimits: DEVELOPMENT_READ_LIMITS,
    artifactIdentity: direct.artifactIdentity,
    configurationIdentity: direct.identity,
    policyIdentity: direct.policyIdentity,
    authenticationIdentity: direct.authenticationIdentity,
    fileDigest: createHash("sha256").update(readFileSync(f.input.deploymentFile)).digest("hex"),
  });
  inert(prepared);
  expect(JSON.stringify(prepared)).not.toContain(token);
  const state = referenceDeploymentState(prepared);
  expect(state.profile).toBe("read-update");
  if (state.profile !== "read-update") throw new Error("wrong capture");
  expect(state.installed.identity).toBe(direct.identity);
  expect(state.installed.credentials).toEqual(direct.credentials);
  expect(state.installed.configuration.contracts.identity).toBe(
    direct.configuration.contracts.identity,
  );
  expect(state.installed.configuration.access.capture("reader").write).toBe(false);
  expect(Object.isFrozen(state.projectedInput)).toBe(true);
  expect(existsSync(f.directory)).toBe(false);
  for (const fake of [{ ...prepared }, Object.freeze({}), null, "handle"])
    expect(() => referenceDeploymentState(fake)).toThrow(
      "registered reference deployment required",
    );
});
it.each(["read-update", "transactional"] as const)(
  "accepts the deploymentFile-only bdptest section for %s with one selected file open",
  async (profile) => {
    const f = fixture(profile);
    const prepared = await loadReferenceDeployment({
      ...f.input,
      bdptest: { deploymentFile: f.input.deploymentFile },
    });
    expect(prepared.profile).toBe(profile);
    expect(open).toHaveBeenCalledTimes(1);
    expect(vi.mocked(open).mock.calls[0]?.[0]).toBe(f.input.deploymentFile);
    expect(existsSync(f.directory)).toBe(false);
  },
);
it.each(["mismatched-path", "invalid-path-type", "fixture-conflict"] as const)(
  "refuses a nested deploymentFile %s before opening",
  async (kind) => {
    const f = fixture();
    const bdptest =
      kind === "mismatched-path"
        ? { deploymentFile: path.join(f.root, "payload_sentinel") }
        : kind === "invalid-path-type"
          ? { deploymentFile: 1 }
          : { fixture: "minimal", deploymentFile: f.input.deploymentFile };
    await failure({ ...f.input, bdptest } as ReferenceDeploymentInput, "configuration");
    expect(open).not.toHaveBeenCalled();
  },
);
it("delegates explicit RU schemas, ownership and endpoint multiplicity without an alternate compiler", async () => {
  const f = fixture(),
    body = ru(f.directory);
  body.configuration.contracts = artifacts();
  body.configuration.maximumEndpointMultiplicity = [
    { endpoint: "target", linkConformsTo: `${scope}types/edge`, max: 1 },
  ];
  f.write(body);
  const prepared = await loadReferenceDeployment(f.input),
    state = referenceDeploymentState(prepared);
  const direct = captureInstalledReferenceConfiguration({
    scope,
    listener: prepared.listener,
    ...body.configuration,
  });
  expect(prepared.artifactIdentity).toBe(direct.artifactIdentity);
  if (state.profile !== "read-update") throw new Error("wrong capture");
  expect(state.installed.identity).toBe(direct.identity);
  expect(state.installed.configuration.maximumEndpointMultiplicity).toEqual(
    direct.configuration.maximumEndpointMultiplicity,
  );
  expect(existsSync(f.directory)).toBe(false);
});
it("keeps TX compilation, credentials and capabilities private and leaves live metadata unavailable", async () => {
  const f = fixture("transactional"),
    body = tx(f.directory);
  const prepared = await loadReferenceDeployment(f.input),
    state = referenceDeploymentState(prepared);
  const installed = captureInstalledTransactionConfiguration({ scope, ...body.configuration });
  const direct = captureTransactionRuntimeConfiguration(installed);
  expect(prepared).toEqual({
    format: body.format,
    profile: "transactional",
    canonicalScope: scope,
    listener: { host: "127.0.0.1", port: 43210 },
    preflightReadLimits: direct.readOptions(scope).advertisedLimits,
    fileDigest: createHash("sha256").update(readFileSync(f.input.deploymentFile)).digest("hex"),
    artifactIdentity: direct.contracts?.identity,
  });
  if (state.profile !== "transactional") throw new Error("wrong capture");
  expect(state.installed).toEqual(installed);
  expect(state.preflight.contracts?.identity).toBe(direct.contracts?.identity);
  expect(state.preflight.settings).toEqual(direct.settings);
  expect(state.preflight.readOptions(scope).advertisedLimits).toEqual(
    direct.readOptions(scope).advertisedLimits,
  );
  expect(state.preflight.authenticate(Buffer.from(`Bearer ${readToken}`))).toEqual({
    kind: "authenticated",
    principal: "same",
    canMutate: false,
  });
  expect(state.installed.port).toBe(0);
  expect(prepared.listener.port).toBe(43210);
  expect(prepared).not.toHaveProperty("policyIdentity");
  expect(prepared).not.toHaveProperty("runtimeConfigurationIdentity");
  inert(prepared);
  expect(existsSync(f.directory)).toBe(false);
});
it("accepts duplicate RU principals with unique tokens, preserving existing semantics", async () => {
  const f = fixture(),
    body = ru(f.directory);
  body.configuration.credentials[1]!.principal = "writer";
  f.write(body);
  expect((await loadReferenceDeployment(f.input)).profile).toBe("read-update");
});
it("snapshots caller settings before await and never rereads after file replacement", async () => {
  const f = fixture("transactional");
  const originalReadLimits = structuredClone(f.input.server.limits);
  const pending = loadReferenceDeployment(f.input);
  f.input.scope.url = "https://changed.test/";
  f.input.server.host = "other";
  f.input.server.port = 1;
  f.input.server.limits.page.maximumItems = 1;
  const handle = await pending,
    state = referenceDeploymentState(handle);
  const reads = vi.mocked(open).mock.calls.length;
  f.write({ payload_sentinel: token });
  expect(referenceDeploymentState(handle)).toBe(state);
  expect(handle.canonicalScope).toBe(scope);
  expect(handle.listener.port).toBe(43210);
  expect(handle.preflightReadLimits).toEqual(originalReadLimits);
  expect(handle.preflightReadLimits).not.toEqual(f.input.server.limits);
  expect(vi.mocked(open)).toHaveBeenCalledTimes(reads);
  expect(Object.isFrozen(state.projectedInput)).toBe(true);
});
it("does not create or alter a pre-existing read-only target store directory", async () => {
  const f = fixture();
  mkdirSync(f.directory);
  const marker = path.join(f.directory, "store-marker");
  writeFileSync(marker, "unchanged", { mode: 0o400 });
  const body = ru(f.directory);
  body.configuration.create = false;
  f.write(body);
  await loadReferenceDeployment(f.input);
  expect(readFileSync(marker, "utf8")).toBe("unchanged");
  expect(readdirSync(f.directory)).toEqual(["store-marker"]);
  expect(existsSync(path.join(f.directory, "recovery.sqlite"))).toBe(false);
  expect(existsSync(path.join(f.directory, "transaction.sqlite"))).toBe(false);
});
it.each(["read", undefined, "future"])(
  "refuses unsupported profile %s before opening",
  async (profile) => {
    const f = fixture();
    await failure(
      {
        ...f.input,
        server: {
          ...f.input.server,
          ...(profile === undefined
            ? { advertisedProfile: undefined }
            : { advertisedProfile: profile }),
        },
      } as ReferenceDeploymentInput,
      "configuration",
    );
    expect(open).not.toHaveBeenCalled();
  },
);
it("refuses shared listener/limits/fixture/fault conflicts before opening and never invokes getters", async () => {
  const f = fixture();
  let getters = 0;
  const invalid = [
    { ...f.input, server: { ...f.input.server, port: 0 } },
    { ...f.input, server: { ...f.input.server, host: "0.0.0.0" } },
    {
      ...f.input,
      server: {
        ...f.input.server,
        limits: { ...f.input.server.limits, cursorTtlMilliseconds: 300000 },
      },
    },
    { ...f.input, server: { ...f.input.server, internalFaultResource: `${scope}beads/fault` } },
    { ...f.input, bdptest: { fixture: "minimal" } },
    { ...f.input, deploymentFile: "relative" },
    {
      ...f.input,
      get scope() {
        getters++;
        return { url: scope };
      },
    },
    {
      ...f.input,
      server: new Proxy(f.input.server, {
        ownKeys() {
          getters++;
          throw new Error("proxy trap");
        },
      }),
    },
  ];
  for (const input of invalid) await failure(input, "configuration");
  expect(getters).toBe(0);
  expect(open).not.toHaveBeenCalled();
  const txf = fixture("transactional");
  await failure({ ...txf.input, server: { ...txf.input.server, host: "::1" } }, "configuration");
});
it("accepts the supported RU IPv6 intended listener", async () => {
  const f = fixture();
  expect(
    (await loadReferenceDeployment({ ...f.input, server: { ...f.input.server, host: "::1" } }))
      .listener.host,
  ).toBe("::1");
});
it("refuses envelope extensions, wrong profile/format and Directory/descriptor wire shapes", async () => {
  const f = fixture();
  for (const body of [
    { ...ru(f.directory), format: "other" },
    { ...ru(f.directory), profile: "transactional" },
    { profile: "read-update", configuration: ru(f.directory).configuration },
    { ...ru(f.directory), scope },
    { ...ru(f.directory), claimEligible: true },
    { id: scope, resources: [] },
    artifacts().descriptors[0],
    {
      ...ru(f.directory),
      configuration: { ...ru(f.directory).configuration, listener: { host: "127.0.0.1", port: 1 } },
    },
  ]) {
    f.write(body);
    await failure(f.input, "contract");
  }
});
it("delegates RU credential, policy, provisioning, artifact, locality and aggregate refusals", async () => {
  const f = fixture(),
    configuration = ru(f.directory).configuration;
  for (const patch of [
    { directory: "relative" },
    { create: "true" },
    { credentials: [] },
    {
      credentials: [
        { token, principal: "writer" },
        { token, principal: "reader" },
      ],
    },
    { credentials: [{ token: "short", principal: "writer" }] },
    { credentials: [{ token, principal: "writer", canMutate: true }] },
    { policies: { writer: allow } },
    { policies: { writer: { ...allow, unknown: true }, reader: allow } },
    {
      contracts: {
        descriptors: [{ retrievalUri: `${scope}types/bad`, utf8: "payload_sentinel" }],
        schemas: [],
      },
    },
    {
      contracts: {
        ...artifacts(),
        schemas: [
          {
            retrievalUri: `${scope}schemas/item`,
            utf8: JSON.stringify({
              $id: `${scope}schemas/item`,
              $ref: "https://missing.test/schema",
            }),
          },
        ],
      },
    },
    {
      contracts: {
        descriptors: [
          {
            retrievalUri: "https://foreign.test/type",
            utf8: JSON.stringify({
              id: "https://foreign.test/type",
              name: "Foreign",
              describes: "bead",
              conformsTo: [],
            }),
          },
        ],
        schemas: [],
      },
    },
    {
      maximumEndpointMultiplicity: [
        { endpoint: "target", linkConformsTo: `${scope}types/absent`, max: 1 },
      ],
    },
  ]) {
    f.write({ ...ru(f.directory), configuration: { ...configuration, ...patch } });
    await failure(f.input, "contract");
  }
  const invalid = artifacts();
  invalid.descriptors[1]!.utf8 = JSON.stringify({
    id: `${scope}types/owner`,
    name: "Owner",
    describes: "bead",
    conformsTo: [],
    ownsOutgoing: { [`${scope}types/missing`]: { max: 2 } },
  });
  f.write({ ...ru(f.directory), configuration: { ...configuration, contracts: invalid } });
  await failure(f.input, "contract");
});
it("delegates TX exact credential and compiled closure refusals", async () => {
  const f = fixture("transactional"),
    body = tx(f.directory);
  for (const patch of [
    { policies: {} },
    { directory: "relative" },
    { create: 1 },
    { credentials: [] },
    {
      credentials: [
        { token, principal: "same", canMutate: true },
        { token, principal: "same", canMutate: false },
      ],
    },
    { credentials: [{ token, principal: "same", canMutate: "yes" }] },
    { artifacts: { descriptors: [], schemas: [] } },
    {
      artifacts: {
        ...artifacts(),
        schemas: [{ retrievalUri: `${scope}schemas/item`, utf8: "payload_sentinel" }],
      },
    },
    {
      artifacts: {
        descriptors: [
          {
            retrievalUri: `${scope}types/missing`,
            utf8: JSON.stringify({
              id: `${scope}types/missing`,
              name: "Missing",
              describes: "bead",
              conformsTo: [`${scope}types/absent`],
            }),
          },
        ],
        schemas: [],
      },
    },
  ]) {
    f.write({ ...body, configuration: { ...body.configuration, ...patch } });
    await failure(f.input, "contract");
  }
});
it("rejects malformed UTF8, BOM, escaped duplicate names, lone surrogates and unsafe numbers without echo", async () => {
  const f = fixture();
  for (const text of [
    Buffer.alloc(0),
    Buffer.from([0xc3, 0x28]),
    Buffer.from(`\ufeff${JSON.stringify(ru(f.directory))}`),
    '{"format":1,"fo\\u0072mat":2}',
    '{"payload_sentinel":"\\ud800"}',
    '{"unsafe_key_sentinel":9007199254740993,"other":1e9999}',
  ]) {
    writeFileSync(f.input.deploymentFile, text);
    await failure(f.input, "syntax");
  }
});
it("bounds the lossless tree before numeric admission and treats number literals as atomic", async () => {
  const f = fixture();
  const nested = (count: number, leaf: string) => "[".repeat(count) + leaf + "]".repeat(count);
  writeFileSync(f.input.deploymentFile, `{"extra":${nested(15, "1")}}`);
  await failure(f.input, "contract"); // Number at depth16, not its private literal property at17.
  writeFileSync(f.input.deploymentFile, `{"extra":${nested(16, "9007199254740993")}}`);
  await failure(f.input, "bounds");
  // Root object + child array + 99998 atomic values = exactly100000 nodes.
  f.write({ extra: Array.from({ length: 99998 }, () => 1) });
  await failure(f.input, "contract");
  f.write({ extra: Array.from({ length: 99999 }, () => 1) });
  await failure(f.input, "bounds");
});
it("isolates the outer byte ceiling with a valid small envelope and legal trailing whitespace", async () => {
  const f = fixture(),
    inner = JSON.stringify(ru(f.directory));
  writeFileSync(
    f.input.deploymentFile,
    inner + " ".repeat(32 * 1024 * 1024 + 1 - Buffer.byteLength(inner)),
  );
  await failure(f.input, "bounds");
  expect(existsSync(f.directory)).toBe(false);
});
it("closes the single real descriptor on success and syntax/contract failures", async () => {
  const f = fixture();
  for (const body of [ru(f.directory), "bad-json", { invalid: true }]) {
    let closeCalls = 0;
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await realFs.open(...args),
        close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closeCalls++;
        await close();
      });
      return handle;
    });
    if (body === "bad-json") writeFileSync(f.input.deploymentFile, "bad-json");
    else f.write(body);
    if (typeof body === "string") await failure(f.input, "syntax");
    else if ("invalid" in body) await failure(f.input, "contract");
    else await loadReferenceDeployment(f.input);
    expect(closeCalls).toBe(1);
  }
});
it("bounds reads despite stale stat and closes handles on overflow/read failure/non-file", async () => {
  const f = fixture();
  for (const mode of ["growth", "read-error", "special"] as const) {
    let total = 0;
    const close = vi.fn(async () => {});
    const read = vi.fn(async (_buffer: Buffer, _offset: number, length: number) => {
      if (mode === "read-error") throw new Error(`payload_sentinel ${token}`);
      total += length;
      return { bytesRead: length };
    });
    vi.mocked(open).mockResolvedValueOnce({
      stat: async () => ({ isFile: () => mode !== "special", size: 1 }),
      read,
      close,
    } as unknown as FileHandle);
    await failure(f.input, mode === "growth" ? "bounds" : "file");
    expect(close).toHaveBeenCalledTimes(1);
    if (mode === "growth") expect(total).toBe(32 * 1024 * 1024 + 1);
    if (mode === "special") expect(read).not.toHaveBeenCalled();
  }
  await failure({ ...f.input, deploymentFile: path.join(f.root, "missing") }, "file");
});
it("exports only the loader and local error constructor from the public data entry", () => {
  expect(Object.keys(publicEntry).sort()).toEqual([
    "ReferenceDeploymentError",
    "loadReferenceDeployment",
  ]);
});
