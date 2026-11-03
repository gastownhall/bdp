import { type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type JsonValue,
  type ScenarioAssertion,
  type HttpExchangeResponse,
} from "@bdp/conformance";
import { literalJsonPointerMatches, isLiteralJsonPointerAssertion } from "@bdp/conformance/testing";
import {
  scope,
  manifestSource,
  sourceCommit,
  type InstalledObservation,
  observe,
} from "../test-support/transactional-matrix-observation.js";

describe("same-run set expectation verifier controls", () => {
  type PointerAssertion = Extract<ScenarioAssertion, { readonly kind: "json-pointer" }>;
  const scenarioId = "transactional.set.singleton-targets";
  const cases = [
    {
      kind: "matched",
      actionId: "set-update",
      assertionId: "matched",
      wrong: { operationIndex: 0, outcome: "matched", count: 3 },
    },
    { kind: "order", actionId: "set-update", assertionId: "a-id", wrong: `${scope}beads/b` },
    { kind: "index", actionId: "set-update", assertionId: "b-index", wrong: 1 },
    {
      kind: "poststate",
      actionId: "target-a-updated",
      assertionId: "properties",
      wrong: { title: "never-observed" },
    },
  ] as const;
  let observed: InstalledObservation;
  const bodies = new Map<string, JsonValue>();
  const assertions = new Map<string, PointerAssertion>();
  let immutableObservation: string;

  function freezeJson(value: JsonValue): JsonValue {
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) freezeJson(child);
      Object.freeze(value);
    }
    return value;
  }

  beforeAll(async () => {
    // Keep the actual unmodified run and capture raw responses before the runner
    // redacts its report. Response selection follows the authored action order,
    // never an expected payload value: GET a before, updated, deleted, reopened.
    const responses: {
      readonly url: string;
      readonly status: number;
      readonly requestMethod: string;
      readonly bodyText: string;
      readonly request: Pick<
        NonNullable<HttpExchangeResponse["exactRequest"]>,
        "source" | "bodyPresent" | "bodyOctets" | "writeState"
      >;
    }[] = [];
    const requests: { readonly method: string; readonly url: string }[] = [];
    observed = await observe({
      onDispatch(request, session) {
        if (session.scenario === scenarioId)
          requests.push(Object.freeze({ method: request.method, url: request.url }));
      },
      async afterExchange(response, _signal, session) {
        if (session.scenario === scenarioId) {
          const request = requests.at(-1);
          if (requests.length !== responses.length + 1 || request?.url !== response.url)
            throw new Error("Same-run response does not match its actual dispatched request");
          const exact = response.exactRequest;
          if (!exact) throw new Error("Same-run response lacks actual serialized request evidence");
          responses.push(
            Object.freeze({
              url: response.url,
              status: response.status,
              requestMethod: request.method,
              bodyText: response.bodyText,
              request: Object.freeze({
                source: exact.source,
                bodyPresent: exact.bodyPresent,
                bodyOctets: exact.bodyOctets,
                writeState: exact.writeState,
              }),
            }),
          );
        }
      },
    });
    const row = observed.result.scenarios.find((scenario) => scenario.id === scenarioId)!;
    expect(row.state).toBe("pass");
    const updates = responses.filter(
      (response) => response.url === observed.baseline.operationTargets.updateWhere,
    );
    const targetReads = responses.filter((response) => response.url === `${scope}beads/a`);
    expect(updates).toHaveLength(1);
    expect(
      row.exchanges
        .filter(
          (exchange) => exchange.request.url === observed.baseline.operationTargets.updateWhere,
        )
        .map((exchange) => exchange.request.id),
    ).toEqual(["set-update"]);
    expect(targetReads).toHaveLength(4);
    expect(
      row.exchanges
        .filter((exchange) => exchange.request.url === `${scope}beads/a`)
        .map((exchange) => exchange.request.id),
    ).toEqual([
      "target-a-before",
      "target-a-updated",
      "target-a-after-delete",
      "target-a-reopened",
    ]);
    bodies.set("set-update", freezeJson(JSON.parse(updates[0]!.bodyText) as JsonValue));
    bodies.set("target-a-updated", freezeJson(JSON.parse(targetReads[1]!.bodyText) as JsonValue));
    const manifest = JSON.parse(manifestSource.bytes.toString("utf8")) as {
      scenarios: { id: string; actions: { id: string; assertions?: ScenarioAssertion[] }[] }[];
    };
    const scenario = manifest.scenarios.find((candidate) => candidate.id === scenarioId)!;
    for (const entry of cases) {
      const action = scenario.actions.find((candidate) => candidate.id === entry.actionId)!;
      const assertion = action.assertions!.find((candidate) => candidate.id === entry.assertionId)!;
      expect(assertion.kind).toBe("json-pointer");
      const pointer = assertion as PointerAssertion;
      expect(isLiteralJsonPointerAssertion(pointer)).toBe(true);
      assertions.set(
        entry.kind,
        freezeJson(structuredClone(pointer) as unknown as JsonValue) as unknown as PointerAssertion,
      );
      const exchange = row.exchanges.find((candidate) => candidate.request.id === entry.actionId)!;
      expect(exchange.request.exact?.writeState).toBe("complete");
      const captured = entry.actionId === "set-update" ? updates[0]! : targetReads[1]!;
      expect(exchange.request.method).toBe(entry.actionId === "set-update" ? "POST" : "GET");
      expect(exchange.request.method).toBe(captured.requestMethod);
      expect(exchange.request.url).toBe(captured.url);
      expect(exchange.response?.url).toBe(captured.url);
      expect(exchange.response?.status).toBe(captured.status);
      expect(exchange.response?.status).toBe(200);
      expect(exchange.response?.bodyKind).toBe("json");
      expect(exchange.response?.decodedBodyBytes).toBe(Buffer.byteLength(captured.bodyText));
      expect(exchange.request.exact).toMatchObject(captured.request);
      expect(
        exchange.assertions.find((candidate) => candidate.id === entry.assertionId)?.passed,
      ).toBe(true);
    }
    immutableObservation = createHash("sha256")
      .update(JSON.stringify([...bodies]))
      .digest("hex");
  }, 120000);

  it("reuses the same actual installed positive with identical literal verifier outcomes", () => {
    for (const entry of cases)
      expect(
        literalJsonPointerMatches(bodies.get(entry.actionId), assertions.get(entry.kind)!),
      ).toBe(true);
  });

  it.each(cases)(
    "rejects the wrong $kind expectation using the immutable same-run observation",
    (entry) => {
      const original = assertions.get(entry.kind)!;
      const changed = { ...structuredClone(original), equals: structuredClone(entry.wrong) };
      expect(literalJsonPointerMatches(bodies.get(entry.actionId), changed)).toBe(false);
      expect(literalJsonPointerMatches(bodies.get(entry.actionId), original)).toBe(true);
      expect(changed.equals).not.toEqual(original.equals);
      expect(Object.isFrozen(original)).toBe(true);
      expect(Object.isFrozen(bodies.get(entry.actionId))).toBe(true);
      expect(
        createHash("sha256")
          .update(JSON.stringify([...bodies]))
          .digest("hex"),
      ).toBe(immutableObservation);
    },
  );
});

it("allows a valid cross-wired set receipt binding but rejects its wrong result oracle", async () => {
  const observed = await observe({
    manifest(value) {
      const row = value.scenarios.find((s) => s.id === "transactional.set.singleton-targets")!;
      const action = row.actions.find((a) => a.id === "set-delete-facts")!;
      action.input = { binding: "set-update-receipt", method: "GET" };
      action.assertions = [
        {
          id: "expected-delete-count",
          kind: "json-pointer",
          pointer: "/body/results/0/count",
          exists: true,
          equals: 1,
        },
      ];
    },
  });
  const row = observed.result.scenarios.find(
    (s) => s.id === "transactional.set.singleton-targets",
  )!;
  expect(row.state).toBe("fail");
  const exchange = row.exchanges.find((e) => e.request.id === "set-delete-facts")!;
  expect(exchange.sourceReceiptObservation?.action).toBe("set-update");
  expect(exchange.request.exact?.writeState).toBe("complete");
  expect(exchange.response?.status).toBe(200);
  expect(
    row.actions
      ?.find((a) => a.action.id === "set-delete-facts")
      ?.assertions?.find((a) => a.id === "expected-delete-count")?.passed,
  ).toBe(false);
}, 120000);

it.each(["update-where", "delete-where"] as const)(
  "refuses an omitted %s route at exact plan preflight before scenario startup or any wire",
  async (suffix) => {
    const children: ChildProcess[] = [];
    let exchanges = 0;
    await expect(
      observe({
        omitRoute: { method: "POST", url: `${scope}operations/${suffix}` },
        children,
        afterExchange: async () => {
          exchanges++;
        },
      }),
    ).rejects.toThrow(
      "Selected exact HTTP requests do not match the configured execution boundary",
    );
    expect(exchanges).toBe(0);
    // Only the attestation bootstrap launched, already closed before preflight.
    // No scenario session or POST source exists from which to grant authority.
    expect(children).toHaveLength(1);
    expect(children.every((c) => c.exitCode !== null || c.signalCode !== null)).toBe(true);
  },
  120000,
);

it.each(["set-update", "set-delete"] as const)(
  "records the %s source and exact failed dynamic request when its receipt credentials are denied",
  async (action) => {
    const observed = await observe({ invalidReceiptCredentials: action });
    const row = observed.result.scenarios.find(
      (s) => s.id === "transactional.set.singleton-targets",
    )!;
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.sourceReceiptObservation?.action === action)!;
    expect(exchange.sourceReceiptObservation?.credentialRef).toBe("operator");
    expect(exchange.sourceReceiptObservation?.responseDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(exchange.dynamicExactConfiguration?.routes).toEqual([
      { method: "GET", url: exchange.sourceReceiptObservation!.receipt },
    ]);
    expect(exchange.servedSession).toBeDefined();
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(401);
    expect(exchange.assertions.find((a) => a.id === "actual-status")?.passed).toBe(false);
  },
  120000,
);

it.each([
  [
    "second postimage",
    "transactional.set.mutation",
    "m-updated-b",
    "properties",
    { title: "never-observed" },
  ],
  [
    "rollback metadata",
    "transactional.set.mutation",
    "m-rollback-a",
    "metadata",
    { tag: "never-observed" },
  ],
  ["receipt order", "transactional.set.mutation", "m-update", "a-id", `${scope}beads/b`],
  [
    "Event order",
    "transactional.set.mutation",
    "m-update-events",
    "ordered-facts",
    [
      ["created", `${scope}beads/b`, 0],
      ["created", `${scope}beads/c`, 1],
      ["created", `${scope}beads/a`, 2],
      ["updated", `${scope}beads/b`, 0],
      ["updated", `${scope}beads/a`, 1],
    ],
  ],
  [
    "zero results",
    "transactional.set.zero-match",
    "z-update",
    "exact-results",
    [{ operationIndex: 0, outcome: "matched", count: 1 }],
  ],
  [
    "zero Events",
    "transactional.set.zero-match",
    "z-update-events",
    "ordered-facts",
    [
      ["created", `${scope}beads/a`, 0],
      ["updated", `${scope}beads/a`, 0],
    ],
  ],
  ["no effect", "transactional.set.zero-match", "z-update", "no-effect", true],
] as const)(
  "discriminates actual set effects against wrong %s expectation",
  async (kind, id, actionId, assertionId, wrong) => {
    const observed = await observe({
      manifest(value) {
        const row = value.scenarios.find((s) => s.id === id)!;
        const action = row.actions.find((a) => a.id === actionId)!;
        const assertion = (action.assertions as { id: string }[]).find(
          (a) => a.id === assertionId,
        ) as {
          equals?: unknown;
          exists?: boolean;
        };
        if (kind === "no effect") assertion.exists = true;
        else assertion.equals = wrong;
      },
    });
    const row = observed.result.scenarios.find((s) => s.id === id)!;
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.request.id === actionId)!;
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(200);
    expect(exchange.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual([assertionId]);
  },
  120000,
);

it.each([
  ["root next", "p-root-read", "next-page", null],
  ["inline boundary", "p-update", "p30-id", `${scope}beads/p31`],
  ["page member", "p-page-read", "p31-id", `${scope}beads/p30`],
  ["page parent", "p-page-read", "parent", `${scope}receipts/wrong`],
  ["historical title", "p-page-retained", "historical-title", "later"],
  ["terminal next", "p-page-read", "no-next", `${scope}receipts/wrong/pages/next`],
] as const)(
  "discriminates receipt pagination against wrong %s expectation",
  async (_kind, actionId, assertionId, wrong) => {
    const observed = await observe({
      manifest(value) {
        const row = value.scenarios.find((s) => s.id === "transactional.receipt.pagination")!;
        const action = row.actions.find((a) => a.id === actionId)!;
        const assertion = (
          action.assertions as { id: string; equals?: unknown; equalsBinding?: string }[]
        ).find((a) => a.id === assertionId)!;
        delete assertion.equalsBinding;
        assertion.equals = wrong;
      },
    });
    const row = observed.result.scenarios.find((s) => s.id === "transactional.receipt.pagination")!;
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.request.id === actionId)!;
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(200);
    const assertionResults =
      actionId === "p-update"
        ? exchange.assertions
        : row.actions!.find((a) => a.action.id === actionId)!.assertions;
    expect(assertionResults.filter((a) => !a.passed).map((a) => a.id)).toEqual([assertionId]);
  },
  120000,
);

it.each([
  ["conflict code", "c-conflict", "problem-code", "malformed-request", 409],
  ["reopened conflict status", "c-conflict-reopened", "http-status", 200, 409],
  [
    "current record",
    "c-state",
    "ordered-state",
    [[`${scope}beads/b`, `${scope}types/task`, { title: "original" }, { tag: "conflict" }]],
    200,
  ],
  ["retained replay body", "c-retry-reopened", "retained-body", {}, 200],
  [
    "unchanged Event",
    "c-events-reopened",
    "ordered-facts",
    [[`${scope}events/`, "created", `${scope}beads/b`, 0]],
    200,
  ],
] as const)(
  "discriminates completed-key conflict against wrong %s expectation",
  async (kind, actionId, assertionId, wrong, status) => {
    const children: ChildProcess[] = [];
    const observed = await observe({
      children,
      manifest(value) {
        const row = value.scenarios.find((s) => s.id === "transactional.idempotency.conflict")!;
        const action = row.actions.find((a) => a.id === actionId)!;
        const assertion = (
          action.assertions as { id: string; equals?: unknown; equalsBinding?: string }[]
        ).find((a) => a.id === assertionId)!;
        delete assertion.equalsBinding;
        assertion.equals = wrong;
      },
    });
    const row = observed.result.scenarios.find(
      (s) => s.id === "transactional.idempotency.conflict",
    )!;
    expect(observed.result.claimEligible).toBe(false);
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.request.id === actionId)!;
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(status);
    expect(exchange.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual([assertionId]);
    expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(
      true,
    );
    console.log(
      JSON.stringify({
        kind: "installed-tx-completed-conflict-control",
        control: kind,
        sourceCommit,
        actionId,
        assertionId,
        observedStatus: exchange.response?.status,
        writeState: exchange.request.exact?.writeState,
        failures: exchange.assertions.filter((a) => !a.passed).map((a) => a.id),
        childLaunches: children.length,
        closedChildren: children.filter((c) => c.exitCode !== null || c.signalCode !== null).length,
        artifacts: observed.result.artifacts,
        declarations: observed.result.declarations,
        baseline: observed.baseline,
        claimEligible: observed.result.claimEligible,
      }),
    );
  },
  120000,
);
