import { afterEach, describe, expect, it } from "vitest";
import { READ_PROBLEM_DEFINITIONS, readProblem } from "@bdp/protocol";

import {
  assertObservedReadConformanceMockForTesting,
  createControlledReadSessionForTesting,
  createReadProblemTablePortForTesting,
  createReadResourceFaultPortForTesting,
  establishReadConformanceEvidenceForTesting,
} from "./testing.js";
import { readConformanceMockState } from "./read-conformance-mock-state.js";
import {
  admitReadServerProfile,
  createReadServer,
  scopePortProblem,
  scopePortSuccess,
  type ScopePort,
} from "../src/index.js";

const withdrawals: Array<() => void> = [];

afterEach(() => {
  for (const withdraw of withdrawals.splice(0)) withdraw();
});

function grant(target: "bdptest" | "bdpbd"): () => void {
  const withdraw = establishReadConformanceEvidenceForTesting(target);
  withdrawals.push(withdraw);
  return withdraw;
}

const scope = "https://scope.example/acme/";
const limits = {
  selector: { bytes: 128, depth: 16, nodes: 64 },
  page: { defaultItems: 2, maximumItems: 4 },
  cursorTtlMilliseconds: 100,
};

function bead(id: string, revision = "1") {
  return {
    id: new URL(id, scope).href,
    type: "https://work.example/types/task",
    revision,
    properties: { title: id },
  };
}

function controlledSession(items: readonly unknown[]) {
  const source: ScopePort = {
    perform: async () => scopePortSuccess({ items, next: null } as never),
  };
  return createControlledReadSessionForTesting({
    scope,
    source,
    viewHeader: "x-view",
    epochHeader: "x-epoch",
    unauthenticatedChallenge: 'Bearer realm="bdp-conformance"',
    limits,
  });
}

async function controlledBeadItems(session: ReturnType<typeof controlledSession>) {
  const result = await session.port.perform(
    { kind: "collection", collection: "beads" },
    { signal: new AbortController().signal },
  );
  if (result.kind !== "success") throw new Error("controlled collection unexpectedly failed");
  return result.body.items;
}

describe("test-only Read conformance evidence", () => {
  it("configures a deterministic authentication challenge for controlled 401 responses", () => {
    expect(controlledSession([]).readControls.unauthenticatedChallenge).toBe(
      'Bearer realm="bdp-conformance"',
    );
  });

  it("admits controlled discovery without pagination identity headers but keeps pages gated", async () => {
    grant("bdptest");
    const session = controlledSession([]);
    const server = createReadServer({
      scope,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: session.port,
      readControls: session.readControls,
    });

    await expect(server.perform({ kind: "scope-discovery", scope })).resolves.toMatchObject({
      bdpVersion: "0",
      profile: "read",
      scope,
    });
    await expect(server.perform({ kind: "collection", collection: "beads" })).resolves.toEqual(
      readProblem("invalid-parameter"),
    );
    await expect(
      server.perform(
        { kind: "collection", collection: "beads" },
        {
          httpRequest: new Request(`${scope}beads/`, {
            headers: { "x-view": "view-1", "x-epoch": "epoch-1" },
          }),
        },
      ),
    ).resolves.toEqual({ items: [], next: null });
    await server.close();
  });

  it("injects one exact Resource fault without changing other Scope-port operations", async () => {
    const port: ScopePort = {
      perform: async () => scopePortProblem(readProblem("resource-not-found")),
    };
    const fault = new Error("private fault");
    const faultingPort = createReadResourceFaultPortForTesting(port, {
      resource: "bead",
      id: "https://scope.example/beads/fault",
      error: fault,
    });
    const options = { signal: new AbortController().signal };

    await expect(
      faultingPort.perform(
        { kind: "resource", resource: "bead", id: "https://scope.example/beads/fault" },
        options,
      ),
    ).rejects.toBe(fault);
    await expect(
      faultingPort.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toMatchObject({ kind: "problem" });
  });

  it("round-trips every closed Problem code and falls through for unknown or nested codes", async () => {
    let fallthroughs = 0;
    const wrapped: ScopePort = {
      perform: async () => {
        fallthroughs += 1;
        return scopePortSuccess(bead("beads/fallback") as never);
      },
    };
    const port = createReadProblemTablePortForTesting(wrapped, { scope });
    const options = { signal: new AbortController().signal };

    for (const definition of READ_PROBLEM_DEFINITIONS) {
      const result = await port.perform(
        {
          kind: "resource",
          resource: "bead",
          id: new URL(`beads/__problem__/${definition.code}`, scope).href,
        },
        options,
      );
      expect(result).toEqual({ kind: "problem", problem: readProblem(definition.code) });
    }
    for (const code of ["unknown", "resource-not-found/nested"]) {
      await expect(
        port.perform(
          {
            kind: "resource",
            resource: "bead",
            id: new URL(`beads/__problem__/${code}`, scope).href,
          },
          options,
        ),
      ).resolves.toMatchObject({ kind: "success" });
    }
    expect(fallthroughs).toBe(2);
  });

  it("rejects a module binding that did not observe the installed mock", () => {
    const installed = () => true;
    expect(() => assertObservedReadConformanceMockForTesting(installed, () => true)).toThrow(
      "test-support module did not observe its installed Read evidence mock",
    );
    expect(() => assertObservedReadConformanceMockForTesting(installed, installed)).not.toThrow();
  });

  // Shipping evidence is now recorded for both real targets, so grant
  // withdrawal can no longer restore an observable refusal through admission:
  // the mock falls through to the shipping record, which admits. The
  // reference-counting mechanics still matter — the leak guard in the global
  // setup demands exact zero — so they are proved on the mock state directly.
  it("reference-counts overlapping grants and makes withdrawal idempotent", () => {
    const state = readConformanceMockState();
    const withdrawFirst = grant("bdptest");
    const withdrawSecond = grant("bdptest");
    expect(state.grants.get("bdptest")).toBe(2);
    expect(admitReadServerProfile("read", "bdptest")).toMatchObject({ profile: "read" });

    withdrawFirst();
    withdrawFirst();
    expect(state.grants.get("bdptest")).toBe(1);

    withdrawSecond();
    withdrawSecond();
    expect(state.grants.get("bdptest") ?? 0).toBe(0);
  });

  it("keeps target grants isolated", () => {
    const state = readConformanceMockState();
    const withdrawBdptest = grant("bdptest");
    expect(state.grants.get("bdptest")).toBe(1);
    expect(state.grants.get("bdpbd") ?? 0).toBe(0);

    const withdrawBdpbd = grant("bdpbd");
    expect(state.grants.get("bdpbd")).toBe(1);
    withdrawBdptest();
    expect(state.grants.get("bdptest") ?? 0).toBe(0);
    expect(state.grants.get("bdpbd")).toBe(1);

    withdrawBdpbd();
    expect(state.grants.get("bdpbd") ?? 0).toBe(0);
  });

  it("materializes exactly maximumItems plus one only when the scenario requests it", async () => {
    const sourceItems = Array.from({ length: limits.page.maximumItems + 1 }, (_, index) =>
      bead(`beads/source-${index}`),
    );
    const session = controlledSession(sourceItems);

    expect(await controlledBeadItems(session)).toEqual(sourceItems);

    session.materializeAdvertisedLimitFixture();
    const materialized = await controlledBeadItems(session);
    expect(materialized).toHaveLength(limits.page.maximumItems + 1);
    expect(materialized.map(({ id }) => id)).toEqual(
      Array.from(
        { length: limits.page.maximumItems + 1 },
        (_, index) => `${scope}beads/limit-${index}`,
      ),
    );
  });

  it("applies authorization exclusion, deletion, and mutation after limit materialization", async () => {
    const session = controlledSession([bead("beads/template")]);
    session.materializeAdvertisedLimitFixture();
    session.excludeResourceFromAuthorizationView("beads/limit-0");
    session.deleteResource("beads/limit-1");
    session.mutateSource({ id: "beads/limit-2", revision: "mutated" });

    const items = await controlledBeadItems(session);
    expect(items.map(({ id }) => id)).toEqual([
      `${scope}beads/limit-2`,
      `${scope}beads/limit-3`,
      `${scope}beads/limit-4`,
    ]);
    expect(items[0]?.revision).toBe("mutated");
  });

  it("preserves id-less source records for production validation", async () => {
    const idLess = { type: "https://work.example/types/task", revision: "1", properties: {} };
    const session = controlledSession([idLess, bead("beads/hidden")]);
    session.excludeResourceFromAuthorizationView("beads/hidden");

    expect(await controlledBeadItems(session)).toEqual([idLess]);
  });

  it("does not fabricate limit records outside the advertised-limit scenario", async () => {
    const sourceItems = [bead("beads/a"), bead("beads/b")];
    const session = controlledSession(sourceItems);

    expect(await controlledBeadItems(session)).toEqual(sourceItems);
  });
});
