import process from "node:process";

import { afterEach, describe, expect, it } from "vitest";
import { establishReadConformanceEvidenceForTesting } from "@bdp/server/testing";

import { createConfiguredBdpbdReadServer } from "./server-composition.js";

const withdrawals: Array<() => void> = [];

afterEach(() => {
  for (const withdraw of withdrawals.splice(0)) withdraw();
});

describe("bdpbd shipping server composition", () => {
  it("publishes the exact limits enforced by its production controls", async () => {
    withdrawals.push(establishReadConformanceEvidenceForTesting("bdpbd"));
    const scope = "https://scope.example/acme/";
    const limits = {
      page: { defaultItems: 3, maximumItems: 7 },
      selector: { bytes: 1_024, depth: 12, nodes: 40 },
      cursorTtlMilliseconds: 12_000,
    } as const;
    const server = createConfiguredBdpbdReadServer({
      scope: { url: scope },
      server: { advertisedProfile: "read", limits },
      bd: { executable: process.execPath, workspace: process.cwd() },
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

  it("faults the configured resource before any bd dispatch", async () => {
    withdrawals.push(establishReadConformanceEvidenceForTesting("bdpbd"));
    const scope = "https://scope.example/acme/";
    const faulted = new URL("beads/demo-a", scope).href;
    const server = createConfiguredBdpbdReadServer({
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
      // A deliberately non-bd executable: the fault must fire without ever
      // dispatching to the adapter, so this configuration is never exercised.
      bd: { executable: "/nonexistent/bd-never-spawned", workspace: process.cwd() },
    });
    try {
      await expect(
        server.perform({ kind: "resource", resource: "bead", id: faulted }),
      ).rejects.toThrow("private configured internal fault");
    } finally {
      await server.close();
    }
  });
});
