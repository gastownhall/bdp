import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect, vi } from "vitest";
const gate = vi.hoisted(() => ({
  enabled: false,
  fail: false,
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
        forPrincipal(principal: { id: string }) {
          const facet = owner.forPrincipal(principal);
          return {
            ...facet,
            discover: async () => {
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
const configModule = await import(
  "../../../packages/server/dist/installed-reference-configuration.js"
);
const factory = await import("../../../packages/server/dist/installed-reference.js");
const authority = await import("../../../packages/server/dist/development-authority.js");

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
