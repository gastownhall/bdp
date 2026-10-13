import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, request as httpRequest } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { REFERENCE_TYPE_DESCRIPTORS } from "@bdp/protocol";
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
  expect((await wire(schema)).text).toBe(bytes);
  const head = await wire(schema, "HEAD");
  expect(head.text).toBe("");
  expect(Number(head.headers["content-length"])).toBe(Buffer.byteLength(bytes));
  expect((await wire(schema, "GET", undefined, undefined, { accept: "text/plain" })).status).toBe(
    406,
  );
  expect((await wire(schema, "OPTIONS")).status).toBe(405);
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
