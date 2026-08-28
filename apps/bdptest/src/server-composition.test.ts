import { afterEach, describe, expect, it } from "vitest";
import { establishReadConformanceEvidenceForTesting } from "@bdp/server/testing";

import { createConfiguredBdptestReadServer } from "./server-composition.js";

const withdrawals: Array<() => void> = [];

afterEach(() => {
  for (const withdraw of withdrawals.splice(0)) withdraw();
});

describe("bdptest shipping server composition", () => {
  it("publishes the exact limits enforced by its production controls", async () => {
    withdrawals.push(establishReadConformanceEvidenceForTesting("bdptest"));
    const scope = "https://scope.example/acme/";
    const limits = {
      page: { defaultItems: 3, maximumItems: 7 },
      selector: { bytes: 1_024, depth: 12, nodes: 40 },
      cursorTtlMilliseconds: 12_000,
    } as const;
    const server = createConfiguredBdptestReadServer({
      scope: { url: scope },
      server: { advertisedProfile: "read", limits },
    });
    try {
      await expect(server.perform({ kind: "scope-discovery", scope })).resolves.toMatchObject({
        limits: {
          page: limits.page,
          selector: limits.selector,
          retention: { maximumSnapshotLifetime: "PT12S" },
        },
      });
    } finally {
      await server.close();
    }
  });

  it("faults exactly the configured resource and nothing else", async () => {
    withdrawals.push(establishReadConformanceEvidenceForTesting("bdptest"));
    const scope = "https://scope.example/acme/";
    const faulted = new URL("beads/demo-a", scope).href;
    const server = createConfiguredBdptestReadServer({
      scope: { url: scope },
      server: {
        advertisedProfile: "read",
        limits: {
          page: { defaultItems: 3, maximumItems: 7 },
          selector: { bytes: 1_024, depth: 12, nodes: 40 },
          cursorTtlMilliseconds: 12_000,
        },
        internalFaultResource: faulted,
      },
    });
    try {
      await expect(
        server.perform({ kind: "resource", resource: "bead", id: faulted }),
      ).rejects.toThrow("private configured internal fault");
      await expect(
        server.perform({
          kind: "resource",
          resource: "bead",
          id: new URL("beads/demo-b", scope).href,
        }),
      ).resolves.toMatchObject({ id: new URL("beads/demo-b", scope).href });
    } finally {
      await server.close();
    }
  });

  it("serves no fault when the flag is absent", async () => {
    withdrawals.push(establishReadConformanceEvidenceForTesting("bdptest"));
    const scope = "https://scope.example/acme/";
    const server = createConfiguredBdptestReadServer({
      scope: { url: scope },
      server: {
        advertisedProfile: "read",
        limits: {
          page: { defaultItems: 3, maximumItems: 7 },
          selector: { bytes: 1_024, depth: 12, nodes: 40 },
          cursorTtlMilliseconds: 12_000,
        },
      },
    });
    try {
      await expect(
        server.perform({
          kind: "resource",
          resource: "bead",
          id: new URL("beads/demo-a", scope).href,
        }),
      ).resolves.toMatchObject({ id: new URL("beads/demo-a", scope).href });
    } finally {
      await server.close();
    }
  });
});
