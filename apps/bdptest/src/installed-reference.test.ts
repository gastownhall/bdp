import {
  mkdtempSync,
  rmSync,
  cpSync,
  mkdirSync,
  appendFileSync,
  symlinkSync,
  renameSync,
  existsSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, request as httpRequest } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import {
  REFERENCE_TYPE_DESCRIPTORS,
  parseReadUpdateMutationResult,
  parseReadUpdateSequenceResponse,
} from "@bdp/protocol";
const helpers = (await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
)) as {
  availablePort(): Promise<number>;
  observeInstalledReference(entry: string, directory: string): Promise<{ claimEligible: false }>;
  referenceConfiguration(
    directory: string,
    port: number,
    token: string,
    scope?: string,
  ): {
    scope: string;
    listener: { host: string; port: number };
    directory: string;
    create: boolean;
    credentials: { token: string; principal: string }[];
    policies: Record<
      string,
      { create: boolean; write: boolean; hidden: string[]; readOnly: string[] }
    >;
    contracts: {
      descriptors: { retrievalUri: string; utf8: string }[];
      schemas: { retrievalUri: string; utf8: string }[];
    };
    maximumEndpointMultiplicity: unknown[];
  };
  launchInstalledReference(
    entry: string,
    config: unknown,
  ): Promise<{
    ready: Record<string, unknown>;
    child: import("node:child_process").ChildProcess;
    exited: Promise<unknown>;
    wait(): Promise<unknown>;
    close(): Promise<unknown>;
  }>;
  requestInstalled(
    config: unknown,
    token: string,
    url: string,
    method?: string,
    value?: unknown,
    key?: string,
    headers?: Record<string, string>,
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    text: string;
    value: Record<string, unknown>;
  }>;
};
const configuration = (await import(
  new URL("../../../packages/server/dist/installed-reference-configuration.js", import.meta.url)
    .href
)) as typeof import("../../../packages/server/src/installed-reference-configuration.js");
const runtime = (await import(
  new URL("../../../packages/server/dist/development-runtime.js", import.meta.url).href
)) as typeof import("../../../packages/server/src/development-runtime.js");
const entry = fileURLToPath(
  new URL("../../../packages/server/dist/installed-reference-process.js", import.meta.url),
);
const token = "installed_candidate_01234567890123456789";
const dirs: string[] = [];
const children: Awaited<ReturnType<typeof helpers.launchInstalledReference>>[] = [];
function directory() {
  const dir = mkdtempSync(path.join(tmpdir(), "bdp-installed-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) await child.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("cold-navigates the emitted installed factory, all targets and stable reopen using the packed-smoke observations", async () => {
  expect((await helpers.observeInstalledReference(entry, directory())).claimEligible).toBe(false);
}, 30000);

it("releases the installed owner while a non-reading CONNECT peer withholds FIN", async () => {
  const config = helpers.referenceConfiguration(directory(), await helpers.availablePort(), token);
  const running = await helpers.launchInstalledReference(entry, config);
  children.push(running);
  const created = await helpers.requestInstalled(
    config,
    token,
    `${config.scope}operations/create-bead`,
    "POST",
    { id: "beads/connect-owner", type: `${config.scope}types/task`, properties: { kept: true } },
    "connect-owner",
  );
  expect(created.status).toBe(200);
  const peer = createConnection({ ...config.listener, allowHalfOpen: true });
  peer.pause();
  const errors: Error[] = [];
  peer.on("error", (error) => errors.push(error));
  async function bounded<T>(operation: Promise<T>, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error(message)), 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    await bounded(once(peer, "connect"), "CONNECT peer connection deadline");
    const refusal = once(peer, "readable");
    peer.write("CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n");
    await bounded(refusal, "CONNECT refusal arrival deadline");
    // Actual refusal bytes establish that CONNECT reached the child. Do not read
    // them or send FIN: a reset/fully closed peer cannot pin detached shutdown.
    expect(peer.readableLength).toBeGreaterThan(0);
    expect(peer.writableEnded).toBe(false);
    await expect(
      bounded(running.close(), "installed shutdown blocked by non-reading CONNECT peer"),
    ).resolves.toEqual({ code: 0, signal: null });
    expect(peer.writableEnded).toBe(false);
    const reopened = await helpers.launchInstalledReference(entry, { ...config, create: false });
    children.push(reopened);
    const retained = await helpers.requestInstalled(
      config,
      token,
      `${config.scope}beads/connect-owner`,
    );
    expect(retained.status).toBe(200);
    expect(retained.value).toEqual(created.value.resource);
    expect(errors).toEqual([]);
  } finally {
    // Release the peer before awaiting cleanup, including the deliberate mutant
    // timeout; this lets an unfixed child finish without the launcher's SIGKILL.
    peer.destroy();
    await running.close();
  }
}, 15000);

it("captures detached configuration, remaps the whole reference Type closure and separates live policy identity", async () => {
  const config = helpers.referenceConfiguration(directory(), await helpers.availablePort(), token);
  const captured = configuration.captureInstalledReferenceConfiguration(config);
  const types = configuration.referenceTypeArtifacts(config.scope);
  const back = (value: unknown): unknown =>
    typeof value === "string"
      ? value.replaceAll(`${config.scope}types/`, "https://work.example/types/")
      : Array.isArray(value)
        ? value.map(back)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [back(k) as string, back(v)]))
          : value;
  expect(back(types)).toEqual(REFERENCE_TYPE_DESCRIPTORS);
  const credential = config.credentials[0];
  const operator = config.policies.operator;
  if (!credential || !operator) throw Error("missing fixture principal");
  credential.token = "replacement_credential_01234567890123456789";
  operator.hidden.push("beads/a");
  expect(captured.credentials[0]?.token).toBe(token);
  expect(captured.configuration.access.capture("operator").hidden).toEqual([]);
  const changed = configuration.captureInstalledReferenceConfiguration(config);
  expect(changed.identity).not.toBe(captured.identity);
  expect(changed.artifactIdentity).toBe(captured.artifactIdentity);
  expect(() =>
    configuration.captureInstalledReferenceConfiguration({
      ...config,
      limits: { requestBodyBytes: 1 },
    }),
  ).toThrow();
  expect(() =>
    configuration.captureInstalledReferenceConfiguration({
      ...config,
      configurationIdentity: captured.identity,
    }),
  ).toThrow();
});

it("hosts exact captured local schema bytes and validates real HTTP writes with inherited pinned contracts", async () => {
  const config = helpers.referenceConfiguration(directory(), await helpers.availablePort(), token);
  const type = `${config.scope}types/number`,
    schema = `${config.scope}schemas/number`;
  const bytes = ' { "type": "object", "properties": { "n": {"type":"integer"} } }\n';
  config.contracts = {
    descriptors: [
      {
        retrievalUri: type,
        utf8: JSON.stringify({
          id: type,
          name: "Number",
          describes: "bead",
          conformsTo: [],
          propertiesSchema: schema,
        }),
      },
    ],
    schemas: [{ retrievalUri: schema, utf8: bytes }],
  };
  const child = await helpers.launchInstalledReference(entry, config);
  children.push(child);
  const wire = (
    url: string,
    method?: string,
    value?: unknown,
    key?: string,
    headers?: Record<string, string>,
  ) => helpers.requestInstalled(config, token, url, method, value, key, headers);
  const schemaGet = await wire(schema);
  expect(schemaGet.text).toBe(bytes);
  expect(schemaGet.headers["x-bdp-development"]).toBe("non-attesting");
  const head = await wire(schema, "HEAD");
  expect(head.text).toBe("");
  expect(head.headers["x-bdp-development"]).toBe("non-attesting");
  expect(Number(head.headers["content-length"])).toBe(Buffer.byteLength(bytes));
  expect((await wire(schema, "GET", undefined, undefined, { accept: "text/plain" })).status).toBe(
    406,
  );
  const options = await wire(schema, "OPTIONS");
  expect(options.status).toBe(405);
  expect(options.headers["x-bdp-development"]).toBe("non-attesting");
  expect(
    (await wire(schema, "GET", undefined, undefined, { authorization: "Bearer wrong" })).status,
  ).toBe(401);
  expect((await wire(`${config.scope}schemas/not-installed`)).status).toBe(404);
  const target = `${config.scope}operations/create-bead`;
  const failed = await wire(
    target,
    "POST",
    { id: "beads/bad", type, properties: { n: "wrong" } },
    "bad",
  );
  expect(failed.status).toBe(422);
  expect((await wire(`${config.scope}beads/bad`)).status).toBe(404);
  expect(
    (await wire(target, "POST", { id: "beads/good", type, properties: { n: 1 } }, "good")).status,
  ).toBe(200);
});

it("closes the actual owner when listener startup cleanup fails and preserves both causes", async () => {
  const options = {
    directory: directory(),
    port: await helpers.availablePort(),
    create: true,
    token,
  };
  const original = new Error("route construction failure"),
    cleanup = new Error("listener cleanup failure");
  const close = Server.prototype.close;
  vi.spyOn(Server.prototype, "close").mockImplementationOnce(function (this: Server, callback) {
    return close.call(this, (error?: Error) => callback?.(error ?? cleanup));
  });
  let failure: unknown;
  try {
    await runtime.startDevelopmentReferenceRuntime(options, undefined, undefined, {
      scopePath: "/",
      createReadRoute() {
        throw original;
      },
    });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).cause).toBe(original);
  expect((failure as AggregateError).errors).toEqual([original, cleanup]);
  vi.restoreAllMocks();
  const reopened = await runtime.startDevelopmentReferenceRuntime({ ...options, create: false });
  await reopened.close();
});

it("refuses a second owner and changed installation but permits distinct live policy on a later reopen", async () => {
  const config = helpers.referenceConfiguration(directory(), await helpers.availablePort(), token);
  const first = await helpers.launchInstalledReference(entry, config);
  children.push(first);
  const preserved = await helpers.requestInstalled(
    config,
    token,
    `${config.scope}operations/create-bead`,
    "POST",
    { id: "beads/preserved", type: `${config.scope}types/task` },
    "preserved",
  );
  expect(preserved.status).toBe(200);
  const other = {
    ...config,
    create: false,
    listener: { ...config.listener, port: await helpers.availablePort() },
  };
  await expect(helpers.launchInstalledReference(entry, other)).rejects.toThrow("exited");
  await first.close();
  const changed = { ...other, scope: "https://reference.invalid/different/" };
  await expect(helpers.launchInstalledReference(entry, changed)).rejects.toThrow("exited");
  other.policies = { operator: { create: false, write: false, hidden: [], readOnly: [] } };
  const reopened = await helpers.launchInstalledReference(entry, other);
  children.push(reopened);
  expect(reopened.ready.configurationIdentity).not.toBe(first.ready.configurationIdentity);
  expect(reopened.ready.artifactIdentity).toBe(first.ready.artifactIdentity);
  expect(
    (await helpers.requestInstalled(other, token, `${other.scope}beads/preserved`)).value,
  ).toEqual(preserved.value.resource);
  expect(
    (
      await helpers.requestInstalled(
        other,
        token,
        `${other.scope}operations/create-bead`,
        "POST",
        { id: "beads/denied", type: `${other.scope}types/task` },
        "denied",
      )
    ).status,
  ).toBe(403);
});

it("IPC disconnect closes a slow unadmitted body and releases the real owner without capturing its key", async () => {
  const config = helpers.referenceConfiguration(directory(), await helpers.availablePort(), token);
  const child = await helpers.launchInstalledReference(entry, config);
  children.push(child);
  const partial = httpRequest({
    hostname: config.listener.host,
    port: config.listener.port,
    path: "/acme/operations/create-bead",
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "partial",
      "content-type": "application/json",
      "content-length": 1000,
    },
  });
  const closed = new Promise<void>((resolve) => {
    partial.on("error", () => resolve());
    partial.on("close", () => resolve());
  });
  partial.write("{");
  try {
    expect(
      (await helpers.requestInstalled(config, token, `${config.scope}beads/partial`)).status,
    ).toBe(404);
    child.child.disconnect();
    expect(await child.wait()).toEqual({ code: 0, signal: null });
    await closed;
    config.create = false;
    config.listener.port = await helpers.availablePort();
    const reopened = await helpers.launchInstalledReference(entry, config);
    children.push(reopened);
    const result = await helpers.requestInstalled(
      config,
      token,
      `${config.scope}operations/create-bead`,
      "POST",
      { id: "beads/partial", type: `${config.scope}types/task` },
      "partial",
    );
    expect(result.status).toBe(200);
    expect(
      (await helpers.requestInstalled(config, token, `${config.scope}beads/partial`)).status,
    ).toBe(200);
  } finally {
    partial.destroy();
  }
});

it("the actual factory captures credentials and policy before caller mutation", async () => {
  const factory = (await import(
    new URL("../../../packages/server/dist/installed-reference.js", import.meta.url).href
  )) as typeof import("../../../packages/server/src/installed-reference.js");
  const config = helpers.referenceConfiguration(directory(), await helpers.availablePort(), token);
  const requestConfig = structuredClone(config);
  const pending = factory.startInstalledReferenceCandidate(config);
  const credential = config.credentials[0],
    policy = config.policies.operator;
  if (!credential || !policy) throw Error("missing fixture principal");
  credential.token = "mutated_credential_01234567890123456789";
  policy.create = false;
  const server = await pending;
  try {
    const result = await helpers.requestInstalled(
      requestConfig,
      token,
      `${requestConfig.scope}operations/create-bead`,
      "POST",
      { id: "beads/captured", type: `${requestConfig.scope}types/task` },
      "captured",
    );
    expect(result.status).toBe(200);
    expect(
      (await helpers.requestInstalled(requestConfig, credential.token, requestConfig.scope)).status,
    ).toBe(401);
    expect(server.configurationIdentity).toBe(
      configuration.captureInstalledReferenceConfiguration(requestConfig).identity,
    );
  } finally {
    await server.close();
  }
});

it("refuses a second IPC start and occupied listener without leaving another owner", async () => {
  const config = helpers.referenceConfiguration(directory(), await helpers.availablePort(), token);
  const first = await helpers.launchInstalledReference(entry, config);
  children.push(first);
  const second = { ...config, directory: directory() };
  await expect(helpers.launchInstalledReference(entry, second)).rejects.toThrow("exited");
  first.child.send({ configuration: config });
  expect(await first.wait()).toEqual({ code: 2, signal: null });
  config.create = false;
  const reopened = await helpers.launchInstalledReference(entry, config);
  children.push(reopened);
  expect((await helpers.requestInstalled(config, token, config.scope)).status).toBe(204);
});

function isolatedPayload() {
  const modules = path.join(directory(), "node_modules");
  const require = createRequire(entry);
  {
    const root = path.resolve(path.dirname(entry), "..");
    const destination = path.join(modules, "@bdp/server");
    mkdirSync(destination, { recursive: true });
    cpSync(path.join(root, "package.json"), path.join(destination, "package.json"));
    cpSync(path.join(root, "dist"), path.join(destination, "dist"), { recursive: true });
  }
  symlinkSync(
    path.resolve(path.dirname(require.resolve("@bdp/protocol")), ".."),
    path.join(modules, "@bdp/protocol"),
    "dir",
  );
  const dependency = path.join(modules, "fast-uri");
  cpSync(path.dirname(require.resolve("fast-uri")), dependency, {
    recursive: true,
    dereference: true,
  });
  const copiedEntry = path.join(modules, "@bdp/server/dist/installed-reference-process.js");
  return { dependency, copiedEntry };
}
it("binds resolved fast-uri runtime bytes in an isolated installed payload", async () => {
  const { dependency, copiedEntry } = isolatedPayload();
  const config = helpers.referenceConfiguration(directory(), await helpers.availablePort(), token);
  const first = await helpers.launchInstalledReference(copiedEntry, config);
  children.push(first);
  await first.close();
  appendFileSync(
    path.join(dependency, "lib/utils.js"),
    "\n// isolated payload identity regression\n",
  );
  const second = await helpers.launchInstalledReference(copiedEntry, { ...config, create: false });
  children.push(second);
  expect(second.ready.payloadIdentity).not.toBe(first.ready.payloadIdentity);
  expect(second.ready.configurationIdentity).toBe(first.ready.configurationIdentity);
  expect(second.ready.artifactIdentity).toBe(first.ready.artifactIdentity);
});

it("reports actual captured policy and authentication bindings over private IPC", async () => {
  const config = helpers.referenceConfiguration(directory(), await helpers.availablePort(), token);
  const captured = configuration.captureInstalledReferenceConfiguration(config);
  const first = await helpers.launchInstalledReference(entry, config);
  children.push(first);
  expect(first.ready).toMatchObject({
    configurationIdentity: captured.identity,
    policyIdentity: captured.policyIdentity,
    authenticationIdentity: captured.authenticationIdentity,
    profile: "read-update",
    history: false,
  });
  expect(JSON.stringify(first.ready)).not.toContain(token);
  await first.close();
  const changedPolicy = {
    ...config,
    create: false,
    policies: { operator: { create: false, write: false, hidden: [], readOnly: [] } },
  };
  const second = await helpers.launchInstalledReference(entry, changedPolicy);
  children.push(second);
  expect(second.ready.policyIdentity).not.toBe(first.ready.policyIdentity);
  expect(second.ready.authenticationIdentity).toBe(first.ready.authenticationIdentity);
  expect(second.ready.configurationIdentity).not.toBe(first.ready.configurationIdentity);
  await second.close();
  const changedAuth = {
    ...changedPolicy,
    credentials: [{ token: "other_installed_01234567890123456789012345", principal: "operator" }],
  };
  const third = await helpers.launchInstalledReference(entry, changedAuth);
  children.push(third);
  expect(third.ready.policyIdentity).toBe(second.ready.policyIdentity);
  expect(third.ready.authenticationIdentity).not.toBe(second.ready.authenticationIdentity);
  expect(third.ready.configurationIdentity).not.toBe(second.ready.configurationIdentity);
  for (const field of ["policyIdentity", "authenticationIdentity", "profile", "history"])
    expect(() =>
      configuration.captureInstalledReferenceConfiguration({
        ...config,
        [field]: first.ready[field],
      }),
    ).toThrow();
});

it.each(["file", "directory", "manifest"] as const)(
  "refuses an internal dependency %s symlink before listener or store provisioning",
  async (kind) => {
    const { dependency, copiedEntry } = isolatedPayload();
    const relative =
      kind === "file" ? "lib/utils.js" : kind === "directory" ? "lib" : "package.json";
    const target = path.join(
      directory(),
      kind === "file"
        ? "actual-utils.cjs"
        : kind === "directory"
          ? "actual-lib"
          : "actual-package.json",
    );
    const original = path.join(dependency, relative);
    renameSync(original, target);
    symlinkSync(target, original, kind === "directory" ? "dir" : "file");
    const store = path.join(directory(), "unprovisioned");
    const config = helpers.referenceConfiguration(store, await helpers.availablePort(), token);
    await expect(helpers.launchInstalledReference(copiedEntry, config)).rejects.toThrow(
      "installed reference qualification failed",
    );
    expect(existsSync(store)).toBe(false);
    // The child exits without publishing readiness or retaining its configured listener.
    const listener = new Server();
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(config.listener.port, config.listener.host, resolve);
    });
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  },
);

it("ignores copied read minimum fields on Update singleton and sequence commands", async () => {
  const dir = directory();
  const config = helpers.referenceConfiguration(dir, await helpers.availablePort(), token);
  const running = await helpers.launchInstalledReference(entry, config);
  children.push(running);
  const failures: unknown[] = [];
  const observations: { method: string; url: string; status: number }[] = [];
  let childClosed = false;
  async function wire(
    url: string,
    method = "GET",
    value?: unknown,
    key?: string,
    headers: Record<string, string> = {},
  ) {
    expect(observations.length).toBeLessThan(6);
    const response = await helpers.requestInstalled(
      config,
      token,
      url,
      method,
      value,
      key,
      headers,
    );
    observations.push({ method, url, status: response.status });
    expect(response.status).toBe(200);
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(response.headers[name]).toBeUndefined();
    for (const name of ["transaction", "requiredPosition", "effectPosition", "idempotencyKey"])
      expect(response.value).not.toHaveProperty(name);
    return response.value;
  }
  try {
    expect(running.ready.claimEligible).toBe(false);
    for (const [carrier, name, copied] of [
      [
        "create-bead",
        "copied-singleton",
        {
          "bdp-minimum-scope-position": "pos-999",
          "bdp-scope-epoch": "foreign-epoch",
          "bdp-authorization-view": "foreign-view",
        },
      ],
      ["sequence", "copied-sequence", { "bdp-minimum-scope-position": "not a token!" }],
    ] as const) {
      const input = {
        id: `beads/${name}`,
        type: `${config.scope}types/task`,
        properties: { title: name },
      };
      const request =
        carrier === "sequence"
          ? { operations: [{ operation: "createBead", ...input, idempotencyKey: name }] }
          : input;
      const target = `${config.scope}operations/${carrier}`;
      const created = await wire(
        target,
        "POST",
        request,
        carrier === "sequence" ? undefined : name,
        copied,
      );
      if (carrier === "sequence") parseReadUpdateSequenceResponse(created);
      else parseReadUpdateMutationResult(created);
      const resource = (
        carrier === "sequence"
          ? (created.results as Record<string, unknown>[])[0]?.resource
          : created.resource
      ) as Record<string, unknown>;
      expect(resource).toEqual({
        id: `${config.scope}beads/${name}`,
        type: `${config.scope}types/task`,
        properties: { title: name },
        metadata: {},
        revision: expect.any(String),
      });
      expect(String(resource.revision).length).toBeGreaterThan(0);
      expect(created).toEqual(
        carrier === "sequence"
          ? { results: [{ operationIndex: 0, outcome: "created", resource }] }
          : { outcome: "created", resource },
      );
      expect(await wire(`${config.scope}beads/${name}`)).toEqual(resource);
      const replay = await wire(
        target,
        "POST",
        request,
        carrier === "sequence" ? undefined : name,
        {
          "bdp-minimum-scope-position": "",
          "bdp-scope-epoch": "epoch-one, epoch-two",
          "bdp-authorization-view": "not a view!",
        },
      );
      expect(replay).toEqual(created);
    }
    expect(observations).toHaveLength(6);
  } catch (error) {
    failures.push(error);
  } finally {
    children.splice(children.indexOf(running), 1);
    dirs.splice(dirs.indexOf(dir), 1);
    try {
      expect(await running.close()).toEqual({ code: 0, signal: null });
      childClosed = true;
    } catch (error) {
      failures.push(error);
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    console.log(
      JSON.stringify({
        observation: "private-update-command-minimum",
        outcome: failures.length ? "failed" : "passed",
        childPid: running.child.pid,
        childExitCode: running.child.exitCode,
        childClosed,
        directoryAbsent: !existsSync(dir),
        directory: dir,
        completedResponses: observations,
        claimEligible: false,
      }),
    );
  }
  if (failures.length)
    throw new AggregateError(failures, "Update command minimum observation and cleanup");
}, 30000);
