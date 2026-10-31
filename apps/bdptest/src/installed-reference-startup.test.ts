import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect, vi } from "vitest";
import { readProblem } from "@bdp/protocol";
import { Server } from "node:http";
const gate = vi.hoisted(() => ({
  enabled: false,
  fail: false,
  refuse: false,
  closeCalls: 0,
  closeFailure: undefined as unknown,
  mark: () => {},
  release: Promise.resolve(),
  alternateLimits: undefined as unknown,
}));
vi.mock("../../../packages/server/dist/development-authority.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../packages/server/src/development-authority.js")>();
  return {
    ...actual,
    get DEVELOPMENT_OWNER_LIMITS() {
      return gate.alternateLimits ?? actual.DEVELOPMENT_OWNER_LIMITS;
    },
    openDevelopmentAuthority: async (
      ...args: Parameters<typeof actual.openDevelopmentAuthority>
    ) => {
      const owner = await actual.openDevelopmentAuthority(...args);
      return {
        ...owner,
        async close() {
          gate.closeCalls++;
          await owner.close();
          if (gate.closeFailure !== undefined) throw gate.closeFailure;
        },
        forPrincipal(principal: { id: string }) {
          const facet = owner.forPrincipal(principal);
          return {
            ...facet,
            discover: async () => {
              if (gate.refuse)
                return {
                  kind: "problem" as const,
                  problem: readProblem("temporarily-unavailable"),
                };
              if (gate.enabled && principal.id === "bob") {
                gate.mark();
                await gate.release;
                if (gate.fail) throw Error("later principal startup refused");
              }
              return facet.discover();
            },
          };
        },
      };
    },
  };
});
const helper = (await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
)) as {
  availablePort(): Promise<number>;
  referenceConfiguration(
    directory: string,
    port: number,
    token: string,
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
  };
  requestInstalled(
    config: unknown,
    token: string,
    url: string,
    method?: string,
    body?: unknown,
    key?: string,
  ): Promise<{ status: number; value: unknown }>;
};
const configModule = (await import(
  new URL("../../../packages/server/dist/installed-reference-configuration.js", import.meta.url)
    .href
)) as typeof import("../../../packages/server/src/installed-reference-configuration.js");
const factory = (await import(
  new URL("../../../packages/server/dist/installed-reference.js", import.meta.url).href
)) as typeof import("../../../packages/server/src/installed-reference.js");
const authority = (await import(
  new URL("../../../packages/server/dist/development-authority.js", import.meta.url).href
)) as typeof import("../../../packages/server/src/development-authority.js");

it.each([false, true])(
  "withholds reads and mutation admission until every principal is ready (later failure=%s)",
  async (fail) => {
    const dir = mkdtempSync(path.join(tmpdir(), "bdp-startup-gate-"));
    const token = "startup_operator_01234567890123456789";
    const config = helper.referenceConfiguration(dir, await helper.availablePort(), token);
    config.credentials.push({ token: "startup_bob_01234567890123456789012345", principal: "bob" });
    config.policies.bob = { create: true, write: true, hidden: [], readOnly: [] };
    let entered!: () => void, release!: () => void;
    const entry = new Promise<void>((r) => (entered = r));
    gate.release = new Promise<void>((r) => (release = r));
    gate.mark = entered;
    gate.enabled = true;
    gate.fail = fail;
    let server: Awaited<ReturnType<typeof factory.startInstalledReferenceCandidate>> | undefined;
    const startup = factory.startInstalledReferenceCandidate(config);
    const settled = startup.then(
      (s) => ({ server: s }),
      (error) => ({ error }),
    );
    try {
      await entry;
      expect((await helper.requestInstalled(config, token, config.scope)).status).toBe(503);
      const bead = { id: "beads/early", type: `${config.scope}types/task` };
      expect(
        (
          await helper.requestInstalled(
            config,
            token,
            `${config.scope}operations/create-bead`,
            "POST",
            bead,
            "early",
          )
        ).status,
      ).toBe(503);
      release();
      const result = await settled;
      gate.enabled = false;
      if (fail) {
        expect(result).toHaveProperty("error.message", "later principal startup refused");
        server = await factory.startInstalledReferenceCandidate({ ...config, create: false });
      } else {
        if (!("server" in result)) throw result.error;
        server = result.server;
      }
      expect((await helper.requestInstalled(config, token, config.scope)).status).toBe(204);
      expect(
        (await helper.requestInstalled(config, token, `${config.scope}beads/early`)).status,
      ).toBe(404);
      // Direct absence plus same-key correction proves no early effects/key claim.
      expect(
        (
          await helper.requestInstalled(
            config,
            token,
            `${config.scope}operations/create-bead`,
            "POST",
            bead,
            "early",
          )
        ).status,
      ).toBe(200);
    } finally {
      release();
      gate.enabled = false;
      const result = await settled;
      if ("server" in result) await result.server.close();
      await server?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it("binds every fixed owner-bound group into configuration identity without enabling overrides", async () => {
  const original = authority.DEVELOPMENT_OWNER_LIMITS;
  expect(Object.isFrozen(original)).toBe(true);
  for (const group of [
    original.update,
    original.read,
    original.read.page,
    original.read.selector,
    original.member,
    original.lifecycle,
    original.pagination,
  ])
    expect(Object.isFrozen(group)).toBe(true);
  const input = helper.referenceConfiguration(
    "/tmp/unused-limit-probe",
    12345,
    "limits_operator_01234567890123456789",
  );
  const baseline = configModule.captureInstalledReferenceConfiguration(input).identity;
  try {
    for (const [group, key] of [
      ["member", "patchOperations"],
      ["member", "representationBytes"],
      ["lifecycle", "retentionMs"],
      ["lifecycle", "maintenanceIntervalMs"],
      ["pagination", "retainedSnapshotByteCapacity"],
      ["pagination", "tokenGenerationAttempts"],
    ] as const) {
      const values = original[group];
      gate.alternateLimits = Object.freeze({
        ...original,
        [group]: Object.freeze({
          ...values,
          [key]: Number(values[key as keyof typeof values]) + 1,
        }),
      });
      expect(configModule.captureInstalledReferenceConfiguration(input).identity).not.toBe(
        baseline,
      );
    }
  } finally {
    gate.alternateLimits = undefined;
  }
  expect(configModule.captureInstalledReferenceConfiguration(input).identity).toBe(baseline);
});

it("checks the actual owner before serving a static directory or hosted schema", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdp-owner-gate-"));
  const token = "owner_gate_01234567890123456789012345";
  const input = helper.referenceConfiguration(dir, await helper.availablePort(), token);
  const schema = `${input.scope}schemas/local`;
  const type = `${input.scope}types/local`;
  const config = {
    ...input,
    contracts: {
      descriptors: [
        {
          retrievalUri: type,
          utf8: JSON.stringify({
            id: type,
            name: "Local",
            describes: "bead",
            conformsTo: [],
            propertiesSchema: schema,
          }),
        },
      ],
      schemas: [{ retrievalUri: schema, utf8: '{"type":"object"}' }],
    },
  };
  const server = await factory.startInstalledReferenceCandidate(config);
  try {
    for (const url of [`${input.scope}operations/`, schema])
      expect((await helper.requestInstalled(config, token, url)).status).toBe(200);
    gate.refuse = true;
    for (const url of [`${input.scope}operations/`, schema]) {
      const result = await helper.requestInstalled(config, token, url);
      expect(result.status).toBe(503);
      expect(result.value).toMatchObject({ status: 503 });
      expect(result.value).not.toHaveProperty("operations");
      expect(result.value).not.toHaveProperty("type", "object");
    }
    gate.refuse = false;
    for (const url of [`${input.scope}operations/`, schema])
      expect((await helper.requestInstalled(config, token, url)).status).toBe(200);
  } finally {
    gate.refuse = false;
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("retries failed listener cleanup without repeating successful owner cleanup", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdp-close-retry-"));
  const token = "close_retry_01234567890123456789012345";
  const config = helper.referenceConfiguration(dir, await helper.availablePort(), token);
  const server = await factory.startInstalledReferenceCandidate(config);
  gate.closeCalls = 0;
  const cleanup = new Error("listener did not close on first attempt");
  const close = vi.spyOn(Server.prototype, "close").mockImplementationOnce(function (
    this: Server,
    callback,
  ) {
    callback?.(cleanup);
    return this;
  });
  try {
    const first = server.close();
    expect(server.close()).toBe(first);
    await expect(first).rejects.toMatchObject({ errors: [cleanup] });
    expect(gate.closeCalls).toBe(1);
    const reopened = await factory.startInstalledReferenceCandidate({
      ...config,
      create: false,
      listener: { ...config.listener, port: await helper.availablePort() },
    });
    try {
      await server.close();
      expect(gate.closeCalls).toBe(1);
      const calls = close.mock.calls.length;
      await server.close();
      expect(close).toHaveBeenCalledTimes(calls);
    } finally {
      await reopened.close();
    }
  } finally {
    await server.close();
    close.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("does not erase a terminal owner cleanup failure or invoke owner close again on retry", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdp-owner-close-failure-"));
  const token = "close_failure_01234567890123456789012345";
  const config = helper.referenceConfiguration(dir, await helper.availablePort(), token);
  const server = await factory.startInstalledReferenceCandidate(config);
  const failure = new Error("owner terminal cleanup failure");
  gate.closeCalls = 0;
  gate.closeFailure = failure;
  try {
    await expect(server.close()).rejects.toMatchObject({ errors: [failure] });
    expect(gate.closeCalls).toBe(1);
    gate.closeFailure = undefined;
    await expect(server.close()).rejects.toMatchObject({ errors: [failure] });
    expect(gate.closeCalls).toBe(1);
    // The injected failure follows the real owner completion; the store can reopen.
    const reopened = await factory.startInstalledReferenceCandidate({ ...config, create: false });
    await reopened.close();
  } finally {
    gate.closeFailure = undefined;
    await server.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});
