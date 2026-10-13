import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { createInstalledExactClient } from "../test-support/read-update-exact-client.js";
import type { ExactHttpModeOptions, ScenarioActionExecution } from "@bdp/conformance";
const scope = "https://example.invalid/acme/";
it("rejects foreign, malformed, wrong-kind and missing captured targets before dialing or credentials", async () => {
  const resolveCredentials = vi.fn(() => ({}));
  const mode: ExactHttpModeOptions = {
    scope,
    profile: "read-update",
    routes: [],
    maximumRequestHeaderBytes: 1024,
    maximumRequestBodyBytes: 1024,
    defaultCredentialRef: "anonymous",
    credentialHandles: [{ id: "anonymous", headerNames: [] }],
    resolveCredentials,
  };
  const observe = vi.fn();
  const execute = createInstalledExactClient(
    mode,
    { transport: "plain", host: "127.0.0.1", port: 1 },
    observe,
  );
  for (const value of [
    undefined,
    "https://foreign.invalid/acme/beads/a",
    "https://example.invalid/other/beads/a",
    `${scope}links/a`,
    `${scope}beads/%`,
    `${scope}beads/%2F`,
    `${scope}beads/../beads/a`,
    `${scope}beads/a#`,
    `${scope}beads/a?`,
    "beads/a",
    1,
  ]) {
    const execution = {
      family: "client",
      operation: "installed.exact-request",
      scope,
      bindings: value === undefined ? {} : { target: value },
      input: { targetBinding: "target", method: "GET", credentialRef: "anonymous" },
      signal: new AbortController().signal,
    };
    await expect(execute(execution as ScenarioActionExecution)).rejects.toThrow();
  }
  expect(resolveCredentials).not.toHaveBeenCalled();
  expect(observe).not.toHaveBeenCalled();
});

it("decodes only the exact supported installed contract identity version", async () => {
  const { installedContractsDigest } = await import(
    "../test-support/installed-contract-identity.js"
  );
  expect(installedContractsDigest(`development-schema5-${"a".repeat(64)}`)).toBe("a".repeat(64));
  for (const value of [
    "a".repeat(64),
    `development-schema6-${"a".repeat(64)}`,
    `development-schema5-${"A".repeat(64)}`,
    `development-schema5-${"a".repeat(63)}`,
    {},
    undefined,
  ])
    expect(() => installedContractsDigest(value)).toThrow("identity");
});

it("refuses missing revision captures before dialing or credential resolution", async () => {
  const resolveCredentials = vi.fn(() => ({}));
  const mode: ExactHttpModeOptions = {
    scope,
    profile: "read-update",
    routes: [{ method: "POST", url: `${scope}operations/update-bead` }],
    maximumRequestHeaderBytes: 1024,
    maximumRequestBodyBytes: 1024,
    defaultCredentialRef: "anonymous",
    credentialHandles: [{ id: "anonymous", headerNames: [] }],
    resolveCredentials,
  };
  const execute = createInstalledExactClient(
    mode,
    { transport: "plain", host: "127.0.0.1", port: 1 },
    vi.fn(),
  );
  await expect(
    execute({
      family: "client",
      operation: "installed.exact-request",
      scope,
      bindings: { target: `${scope}operations/update-bead` },
      input: {
        targetBinding: "target",
        method: "POST",
        body: {},
        bodyBindings: { expectedRevision: "missing-revision" },
        idempotencyKey: "guard",
        credentialRef: "anonymous",
      },
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("observed string");
  expect(resolveCredentials).not.toHaveBeenCalled();
});

it("serializes omitted versus supplied carrier keys without fabricating a header", async () => {
  const keys: (string | string[] | undefined)[] = [];
  const server = createServer((request, response) => {
    keys.push(request.headers["idempotency-key"]);
    request.resume();
    response.setHeader("content-type", "application/json");
    response.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("listener missing");
    const target = `${scope}operations/sequence`;
    const mode: ExactHttpModeOptions = {
      scope,
      profile: "read-update",
      routes: [{ method: "POST", url: target }],
      maximumRequestHeaderBytes: 1024,
      maximumRequestBodyBytes: 1024,
      defaultCredentialRef: "anonymous",
      credentialHandles: [{ id: "anonymous", headerNames: [] }],
      resolveCredentials: () => ({}),
    };
    const execute = createInstalledExactClient(
      mode,
      { transport: "plain", host: "127.0.0.1", port: address.port },
      () => {},
    );
    for (const idempotencyKey of [undefined, "supplied-key"])
      await execute({
        family: "client",
        operation: "installed.exact-request",
        scope,
        bindings: { target },
        input: {
          method: "POST",
          targetBinding: "target",
          body: { operations: [] },
          credentialRef: "anonymous",
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        },
        signal: new AbortController().signal,
      });
    expect(keys).toEqual([undefined, "supplied-key"]);
    await expect(
      execute({
        family: "client",
        operation: "installed.exact-request",
        scope,
        bindings: { target },
        input: {
          method: "POST",
          targetBinding: "target",
          body: { operations: [] },
          credentialRef: "anonymous",
          idempotencyKey: "",
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("observed string");
    expect(keys).toHaveLength(2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
