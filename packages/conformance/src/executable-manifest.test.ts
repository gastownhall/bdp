import { describe, expect, it } from "vitest";

import {
  loadExecutableScenarioManifestJson,
  ManifestValidationError,
  materializeScenarioRawRequestTarget,
  parseExecutableScenarioManifest,
} from "./index.js";

function manifest() {
  return {
    manifestVersion: 1,
    catalogId: "read-v1",
    scenarios: [
      {
        id: "read.discovery",
        requiredProfile: "read",
        setup: { fixture: "reference-read-v1", requires: ["public-http"] },
        applicability: { requires: [] },
        requests: [
          {
            id: "scope",
            method: "GET",
            target: { binding: "scope", query: {} },
            headers: { accept: "application/json" },
            captures: [
              { binding: "service-desc", from: { kind: "header-link", rel: "service-desc" } },
            ],
            assertions: [
              { id: "status", kind: "status", equals: 204 },
              { id: "empty", kind: "body-absent" },
            ],
          },
        ],
        cleanup: { resetFixture: true },
      },
    ],
  };
}

function actionManifest() {
  const source = manifest();
  const scenario = source.scenarios[0];
  if (scenario === undefined) throw new Error("test manifest unexpectedly empty");
  const { requests: _requests, ...base } = scenario;
  return {
    ...source,
    scenarios: [
      {
        ...base,
        actions: [
          {
            id: "list",
            family: "client",
            operation: "list",
            input: { selector: "open" },
            captures: [{ binding: "cursor", from: { kind: "json-pointer", pointer: "/next" } }],
            assertions: [{ id: "items", kind: "json-pointer", pointer: "/items", exists: true }],
          },
        ],
      },
    ],
  };
}

describe("executable scenario manifest", () => {
  it("confines raw-wire sentinel assertions to private fixture data", () => {
    const base = manifest();
    const request = base.scenarios[0]?.requests[0];
    if (request === undefined) throw new Error("test request unexpectedly absent");
    const source = {
      ...base,
      scenarios: [
        {
          ...base.scenarios[0],
          requests: [
            {
              ...request,
              assertions: [
                {
                  id: "redacted",
                  kind: "wire-not-contains",
                  fixturePointer: "/private/internalFaultSentinel",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseExecutableScenarioManifest(source)).toEqual(source);
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...source.scenarios[0],
            requests: [
              {
                ...request,
                assertions: [
                  {
                    id: "redacted",
                    kind: "wire-not-contains",
                    fixturePointer: "/oracles/internalFaultSentinel",
                  },
                ],
              },
            ],
          },
        ],
      },
      ["$.scenarios[0].requests[0].assertions[0].fixturePointer"],
    );
  });

  it("strictly clones an exclusive programmable-action sequence", () => {
    const source = actionManifest();
    const parsed = parseExecutableScenarioManifest(source);
    expect(parsed).toEqual(source);
    expect(parsed.scenarios[0]?.actions).not.toBe(source.scenarios[0]?.actions);
    const action = parsed.scenarios[0]?.actions?.[0];
    if (action?.family !== "client") throw new Error("expected a client action");
    expect(action.input).not.toBe(source.scenarios[0]?.actions[0]?.input);
  });

  it("accepts only an oracle-scoped fixture input in place of literal action input", () => {
    const source = actionManifest();
    const scenario = source.scenarios[0];
    const action = scenario?.actions[0];
    if (scenario === undefined || action === undefined)
      throw new Error("test action manifest unexpectedly empty");
    const { input: _input, ...withoutInput } = action;
    const fixtureInput = {
      ...source,
      scenarios: [
        {
          ...scenario,
          actions: [{ ...withoutInput, inputFixturePointer: "/oracles/action-input" }],
        },
      ],
    };
    expect(parseExecutableScenarioManifest(fixtureInput)).toEqual(fixtureInput);
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...scenario,
            actions: [{ ...action, inputFixturePointer: "/oracles/action-input" }],
          },
        ],
      },
      ["$.scenarios[0].actions[0]"],
    );
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...scenario,
            actions: [{ ...withoutInput, inputFixturePointer: "/bindings/resource" }],
          },
        ],
      },
      ["$.scenarios[0].actions[0].inputFixturePointer"],
    );
  });

  it("rejects both or neither sequence member", () => {
    const legacy = manifest();
    const scenario = legacy.scenarios[0];
    const actions = actionManifest().scenarios[0]?.actions;
    if (scenario === undefined || actions === undefined)
      throw new Error("test manifest unexpectedly empty");
    expectIssues({ ...legacy, scenarios: [{ ...scenario, actions }] }, ["$.scenarios[0]"]);
    const { requests: _requests, ...withoutSequence } = scenario;
    expectIssues({ ...legacy, scenarios: [withoutSequence] }, ["$.scenarios[0]"]);
  });

  it("rejects unknown action members, families, and non-JSON oracle kinds", () => {
    const source = actionManifest();
    const scenario = source.scenarios[0];
    const action = scenario?.actions[0];
    if (scenario === undefined || action === undefined)
      throw new Error("test action manifest unexpectedly empty");
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...scenario,
            actions: [
              {
                ...action,
                family: "shell",
                extra: true,
                captures: [{ binding: "url", from: { kind: "response-url" } }],
                assertions: [{ id: "status", kind: "status", equals: 200 }],
              },
            ],
          },
        ],
      },
      ["$.scenarios[0].actions[0].extra", "$.scenarios[0].actions[0].family"],
    );
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...scenario,
            actions: [
              {
                ...action,
                extra: true,
                captures: [{ binding: "url", from: { kind: "response-url" } }],
                assertions: [{ id: "status", kind: "status", equals: 200 }],
              },
            ],
          },
        ],
      },
      [
        "$.scenarios[0].actions[0].extra",
        "$.scenarios[0].actions[0].captures[0].from.kind",
        "$.scenarios[0].actions[0].assertions[0].kind",
      ],
    );
  });

  it("rejects action id duplication, capture shadowing, and late prerequisites", () => {
    const source = actionManifest();
    const scenario = source.scenarios[0];
    const action = scenario?.actions[0];
    if (scenario === undefined || action === undefined)
      throw new Error("test action manifest unexpectedly empty");
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...scenario,
            actions: [
              action,
              {
                ...action,
                captures: [{ binding: "cursor", from: { kind: "json-pointer", pointer: "/next" } }],
                prerequisiteScenario: "read.discovery.prerequisite",
              },
            ],
          },
        ],
      },
      [
        "$.scenarios[0].actions[1].id",
        "$.scenarios[0].actions[1].prerequisiteScenario",
        "$.scenarios[0].actions[1].captures[0].binding",
      ],
    );
  });

  it("accepts strict authored raw request targets and rejects noncanonical encodings", () => {
    const source = manifest();
    const scenario = source.scenarios[0];
    const request = scenario?.requests[0];
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    expect(
      parseExecutableScenarioManifest({
        ...source,
        scenarios: [
          {
            ...scenario,
            requests: [
              { ...request, rawRequestTarget: { encoding: "base64", value: "Ly9hY21lLw==" } },
            ],
          },
        ],
      }).scenarios[0]?.requests?.[0]?.rawRequestTarget,
    ).toEqual({ encoding: "base64", value: "Ly9hY21lLw==" });
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...scenario,
            requests: [{ ...request, rawRequestTarget: { encoding: "ascii", value: "/café" } }],
          },
        ],
      },
      ["$.scenarios[0].requests[0].rawRequestTarget.value"],
    );
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...scenario,
            requests: [
              { ...request, rawRequestTarget: { encoding: "base64", value: "Ly9hY21lLw" } },
            ],
          },
        ],
      },
      ["$.scenarios[0].requests[0].rawRequestTarget.value"],
    );
    const withRawTarget = (encoding: "ascii" | "base64", value: string) => ({
      ...source,
      scenarios: [
        {
          ...scenario,
          requests: [{ ...request, rawRequestTarget: { encoding, value } }],
        },
      ],
    });
    expect(() =>
      parseExecutableScenarioManifest(withRawTarget("ascii", "/".repeat(8_192))),
    ).not.toThrow();
    expectIssues(withRawTarget("ascii", "/".repeat(8_193)), [
      "$.scenarios[0].requests[0].rawRequestTarget.value",
    ]);
    expect(() =>
      parseExecutableScenarioManifest(
        withRawTarget("base64", Buffer.alloc(8_192, 0x2f).toString("base64")),
      ),
    ).not.toThrow();
    expectIssues(withRawTarget("base64", Buffer.alloc(8_193, 0x2f).toString("base64")), [
      "$.scenarios[0].requests[0].rawRequestTarget.value",
    ]);
  });

  it("accepts strict resolved-URL raw request-target templates and rejects malformed parts", () => {
    const source = manifest();
    const scenario = source.scenarios[0];
    const request = scenario?.requests[0];
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const withRawTarget = (rawRequestTarget: unknown) => ({
      ...source,
      scenarios: [{ ...scenario, requests: [{ ...request, rawRequestTarget }] }],
    });
    const template = {
      template: "resolved-url",
      form: "scheme-relative",
      authority: "evil.invalid",
      insertBeforeFinalPathSegment: { encoding: "ascii", value: "./" },
      suffix: { encoding: "base64", value: "wyg=" },
    };

    expect(
      parseExecutableScenarioManifest(withRawTarget(template)).scenarios[0]?.requests?.[0],
    ).toHaveProperty("rawRequestTarget", template);
    for (const [candidate, issuePaths] of [
      [
        { ...template, template: "scope-url" },
        ["$.scenarios[0].requests[0].rawRequestTarget.template"],
      ],
      [
        { ...template, form: "origin", authority: "evil.invalid" },
        ["$.scenarios[0].requests[0].rawRequestTarget.authority"],
      ],
      [
        { template: "resolved-url", form: "absolute" },
        ["$.scenarios[0].requests[0].rawRequestTarget.authority"],
      ],
      [
        { ...template, authority: "café.invalid" },
        ["$.scenarios[0].requests[0].rawRequestTarget.authority"],
      ],
      [
        { ...template, suffix: { encoding: "ascii", value: "café" } },
        ["$.scenarios[0].requests[0].rawRequestTarget.suffix.value"],
      ],
      [
        { ...template, suffix: { encoding: "base64", value: "wyg" } },
        ["$.scenarios[0].requests[0].rawRequestTarget.suffix.value"],
      ],
      [{ ...template, extra: true }, ["$.scenarios[0].requests[0].rawRequestTarget.extra"]],
    ] as const)
      expectIssues(withRawTarget(candidate), issuePaths);
  });

  it("bounds the fully materialized raw request target rather than only its authored parts", () => {
    const template = {
      template: "resolved-url",
      form: "origin",
      suffix: { encoding: "ascii", value: "x" },
    } as const;
    expect(
      materializeScenarioRawRequestTarget(template, `https://scope.example/${"a".repeat(8_190)}`),
    ).toHaveLength(8_192);
    expect(() =>
      materializeScenarioRawRequestTarget(template, `https://scope.example/${"a".repeat(8_191)}`),
    ).toThrow(/must not exceed 8192 bytes/);
  });

  it("runtime-validates erased raw-target materialization inputs", () => {
    const url = "https://scope.example/runtime/item";
    for (const target of [
      { template: "resolved-url", form: "scheme-relative" },
      { template: "resolved-url", form: "bogus", authority: "evil.invalid" },
      { template: "resolved-url", form: "absolute", authority: "café.invalid" },
      {
        template: "resolved-url",
        form: "origin",
        suffix: { encoding: "hex", value: "ff" },
      },
      { encoding: "ascii", value: "x".repeat(8_193) },
    ]) {
      expect(() => materializeScenarioRawRequestTarget(target as never, url)).toThrow(
        "raw request target failed runtime validation",
      );
    }
    expect(() =>
      materializeScenarioRawRequestTarget(
        { template: "resolved-url", form: "origin" },
        new String(url) as unknown as string,
      ),
    ).toThrow("resolved raw request-target URL must be a string");
  });

  it("returns a closed copy of a complete versioned plan", () => {
    const source = manifest();
    const parsed = parseExecutableScenarioManifest(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.scenarios[0]).not.toBe(source.scenarios[0]);
  });

  it("does not invent an empty query map when the member is absent", () => {
    const source = manifest();
    const scenario = source.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const parsed = parseExecutableScenarioManifest({
      ...source,
      scenarios: [
        {
          ...scenario,
          requests: [{ ...request, target: { binding: request.target.binding } }],
        },
      ],
    });
    expect(parsed.scenarios[0]?.requests?.[0]?.target).toEqual({ binding: "scope" });
  });

  it("accepts closed fixture-binding query values and rejects malformed ones", () => {
    const source = manifest();
    const scenario = source.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const withQuery = (endpoint: unknown) => ({
      ...source,
      scenarios: [
        {
          ...scenario,
          requests: [{ ...request, target: { binding: "scope", query: { endpoint } } }],
        },
      ],
    });
    expect(
      parseExecutableScenarioManifest(
        withQuery({ binding: "bead.demo-a", representation: "absolute-url" }),
      ).scenarios[0]?.requests?.[0]?.target.query,
    ).toEqual({ endpoint: { binding: "bead.demo-a", representation: "absolute-url" } });
    expectIssues(withQuery({ binding: "Bead", representation: "absolute-url", extra: true }), [
      "$.scenarios[0].requests[0].target.query.endpoint.extra",
      "$.scenarios[0].requests[0].target.query.endpoint.binding",
    ]);
    expectIssues(withQuery({ binding: "bead.demo-a", representation: "relative" }), [
      "$.scenarios[0].requests[0].target.query.endpoint.representation",
    ]);
  });

  it("accepts a repeated query key and rejects degenerate spellings", () => {
    const source = manifest();
    const scenario = source.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const withQuery = (limit: unknown) => ({
      ...source,
      scenarios: [
        {
          ...scenario,
          requests: [{ ...request, target: { binding: "scope", query: { limit } } }],
        },
      ],
    });
    expect(
      parseExecutableScenarioManifest(withQuery(["1", "2"])).scenarios[0]?.requests?.[0]?.target
        .query,
    ).toEqual({ limit: ["1", "2"] });
    // A one-element array is a string spelled confusingly; an empty array and a
    // non-string occurrence are not repeated keys at all.
    for (const degenerate of [["1"], [], ["1", 2]]) {
      expectIssues(withQuery(degenerate), ["$.scenarios[0].requests[0].target.query.limit"]);
    }
  });

  it("loads JSON and reports source labels", () => {
    expect(loadExecutableScenarioManifestJson(JSON.stringify(manifest()), "read.json")).toEqual(
      manifest(),
    );
    expect(() => loadExecutableScenarioManifestJson("{", "read.json")).toThrowError(
      /^read\.json: validation failed/,
    );
  });

  it("rejects inherited records and unknown members", () => {
    class ManifestLike {
      manifestVersion = 1;
      catalogId = "read-v1";
      scenarios: readonly unknown[] = [];
    }
    expectIssues(new ManifestLike(), ["$"]);
    expectIssues({ ...manifest(), extra: true }, ["$.extra"]);
  });

  it("rejects duplicate scenario and request identifiers", () => {
    const base = manifest();
    const first = base.scenarios.at(0);
    if (first === undefined) throw new Error("test manifest unexpectedly empty");
    const firstRequest = first.requests.at(0);
    if (firstRequest === undefined) throw new Error("test scenario unexpectedly empty");
    const source = {
      ...base,
      scenarios: [
        { ...first, requests: [...first.requests, { ...firstRequest, captures: [] }] },
        first,
      ],
    };
    expectIssues(source, ["$.scenarios[0].requests[1].id", "$.scenarios[1].id"]);
  });

  it("requires explicit prerequisites to precede at least one scenario-owned request", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const prerequisite = {
      ...request,
      prerequisiteScenario: "read.discovery.scope-service-desc",
    };
    const owned = {
      ...request,
      id: "document",
      target: { binding: "service-desc" },
      captures: [],
    };
    const parsed = parseExecutableScenarioManifest({
      ...base,
      scenarios: [{ ...scenario, requests: [prerequisite, owned] }],
    });
    expect(parsed.scenarios[0]?.requests?.[0]?.prerequisiteScenario).toBe(
      "read.discovery.scope-service-desc",
    );
    expectIssues({ ...base, scenarios: [{ ...scenario, requests: [owned, prerequisite] }] }, [
      "$.scenarios[0].requests[1].prerequisiteScenario",
    ]);
    expectIssues({ ...base, scenarios: [{ ...scenario, requests: [prerequisite] }] }, [
      "$.scenarios[0].requests",
    ]);
  });

  it("rejects captures that shadow Scope or a binding from an earlier request", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    expectIssues(
      {
        ...base,
        scenarios: [
          {
            ...scenario,
            requests: [
              {
                ...request,
                captures: [
                  { binding: "scope", from: { kind: "response-url" } },
                  { binding: "service-desc", from: { kind: "response-url" } },
                ],
              },
              {
                ...request,
                id: "follow",
                target: { binding: "service-desc" },
                captures: [{ binding: "service-desc", from: { kind: "response-url" } }],
              },
            ],
          },
        ],
      },
      [
        "$.scenarios[0].requests[0].captures[0].binding",
        "$.scenarios[0].requests[1].captures[0].binding",
      ],
    );
  });

  it("rejects credentials and noncanonical header names", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    if (scenario === undefined) throw new Error("test manifest unexpectedly empty");
    const request = scenario.requests.at(0);
    if (request === undefined) throw new Error("test scenario unexpectedly empty");
    const source = {
      ...base,
      scenarios: [
        {
          ...scenario,
          requests: [{ ...request, headers: { Authorization: "secret", cookie: "secret" } }],
        },
      ],
    };
    expectIssues(source, [
      "$.scenarios[0].requests[0].headers.Authorization",
      "$.scenarios[0].requests[0].headers.cookie",
    ]);
  });

  it("rejects authority-changing paths, secret-like headers, and control values", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    if (scenario === undefined) throw new Error("test manifest unexpectedly empty");
    const request = scenario.requests.at(0);
    if (request === undefined) throw new Error("test scenario unexpectedly empty");
    expectIssues(
      {
        ...base,
        scenarios: [
          {
            ...scenario,
            requests: [
              {
                ...request,
                target: { binding: "scope", path: "//foreign.example/" },
                headers: { "x-api-key": "secret", accept: "application/json\r\nsmuggled" },
              },
            ],
          },
        ],
      },
      [
        "$.scenarios[0].requests[0].target.path",
        "$.scenarios[0].requests[0].headers.x-api-key",
        "$.scenarios[0].requests[0].headers.accept",
      ],
    );
  });

  it("rejects noncanonical percent encoding in relative request paths", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    for (const path of ["beads/%41", "beads/%2a"]) {
      expectIssues(
        {
          ...base,
          scenarios: [
            {
              ...scenario,
              requests: [{ ...request, target: { binding: "scope", path } }],
            },
          ],
        },
        ["$.scenarios[0].requests[0].target.path"],
      );
    }
  });

  it("requires an explicit marker for the Read-profile negative POST probe", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    expectIssues(
      {
        ...base,
        scenarios: [{ ...scenario, requests: [{ ...request, method: "DELETE" }] }],
      },
      ["$.scenarios[0].requests[0].method"],
    );
    expectIssues(
      {
        ...base,
        scenarios: [{ ...scenario, requests: [{ ...request, method: "POST" }] }],
      },
      ["$.scenarios[0].requests[0].method"],
    );
    expect(
      parseExecutableScenarioManifest({
        ...base,
        scenarios: [
          {
            ...scenario,
            requests: [{ ...request, method: "POST", negativeMethodProbe: true }],
          },
        ],
      }).scenarios[0]?.requests?.[0]?.negativeMethodProbe,
    ).toBe(true);
  });

  it("keeps optional header tokens unique and disjoint from required tokens", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const withTokens = (includes: readonly string[], optional: readonly string[]) => ({
      ...base,
      scenarios: [
        {
          ...scenario,
          requests: [
            {
              ...request,
              assertions: [
                {
                  id: "allow",
                  kind: "header-tokens",
                  name: "allow",
                  includes,
                  optional,
                  allowsAdditional: false,
                },
              ],
            },
          ],
        },
      ],
    });
    expectIssues(withTokens(["GET", "HEAD"], ["OPTIONS", "OPTIONS"]), [
      "$.scenarios[0].requests[0].assertions[0].optional",
    ]);
    expectIssues(withTokens(["GET", "HEAD"], ["GET"]), [
      "$.scenarios[0].requests[0].assertions[0].optional",
    ]);
    expectIssues(withTokens(["GET", "GET"], ["OPTIONS"]), [
      "$.scenarios[0].requests[0].assertions[0].includes",
    ]);
  });

  it("makes case-insensitive header-token comparison explicit and normalized", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const withCasePolicy = (caseInsensitive: unknown, includes = ["private", "no-store"]) => ({
      ...base,
      scenarios: [
        {
          ...scenario,
          requests: [
            {
              ...request,
              assertions: [
                {
                  id: "cache-control",
                  kind: "header-tokens",
                  name: "cache-control",
                  includes,
                  allowsAdditional: false,
                  caseInsensitive,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(
      parseExecutableScenarioManifest(withCasePolicy(true)).scenarios[0]?.requests?.[0]
        ?.assertions[0],
    ).toMatchObject({ caseInsensitive: true });
    expectIssues(withCasePolicy(false), [
      "$.scenarios[0].requests[0].assertions[0].caseInsensitive",
    ]);
    expectIssues(withCasePolicy(true, ["private", "PRIVATE"]), [
      "$.scenarios[0].requests[0].assertions[0].includes",
    ]);
  });

  it("accepts closed GET/HEAD metadata comparisons only against an earlier request", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const get = scenario?.requests.at(0);
    if (scenario === undefined || get === undefined)
      throw new Error("test manifest unexpectedly empty");
    const comparison = {
      id: "head-metadata",
      kind: "response-metadata-equals",
      request: "scope",
      headers: ["content-length", "content-type"],
    };
    const source = {
      ...base,
      scenarios: [
        {
          ...scenario,
          requests: [
            get,
            {
              ...get,
              id: "head",
              method: "HEAD",
              captures: [],
              assertions: [comparison, { id: "head-body", kind: "body-absent" }],
            },
          ],
        },
      ],
    };

    expect(
      parseExecutableScenarioManifest(source).scenarios[0]?.requests?.[1]?.assertions[0],
    ).toEqual(comparison);
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...scenario,
            requests: [
              get,
              {
                ...source.scenarios[0]?.requests?.[1],
                assertions: [{ ...comparison, request: "head" }],
              },
            ],
          },
        ],
      },
      ["$.scenarios[0].requests[1].assertions[0].request"],
    );
    expectIssues(
      {
        ...source,
        scenarios: [
          {
            ...scenario,
            requests: [
              get,
              {
                ...source.scenarios[0]?.requests?.[1],
                assertions: [
                  {
                    ...comparison,
                    request: "missing",
                    headers: ["date", "content-length", "content-length"],
                    extra: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      [
        "$.scenarios[0].requests[1].assertions[0].extra",
        "$.scenarios[0].requests[1].assertions[0].headers",
      ],
    );
  });

  it("rejects malformed JSON pointers and contradictory assertions", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    if (scenario === undefined) throw new Error("test manifest unexpectedly empty");
    const request = scenario.requests.at(0);
    if (request === undefined) throw new Error("test scenario unexpectedly empty");
    const source = {
      ...base,
      scenarios: [
        {
          ...scenario,
          requests: [
            {
              ...request,
              assertions: [
                {
                  id: "bad-pointer",
                  kind: "json-pointer",
                  pointer: "/bad~2",
                  exists: false,
                  equals: 1,
                },
              ],
            },
          ],
        },
      ],
    };
    expectIssues(source, [
      "$.scenarios[0].requests[0].assertions[0].pointer",
      "$.scenarios[0].requests[0].assertions[0].equals",
    ]);
  });

  it("keeps fixture-oracle expected sources mutually exclusive and under /oracles/", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const assertionPath = "$.scenarios[0].requests[0].assertions[0]";
    const withAssertion = (assertion: unknown) => ({
      ...base,
      scenarios: [
        {
          ...scenario,
          requests: [{ ...request, assertions: [assertion] }],
        },
      ],
    });
    const sourcePairs = [
      {
        id: "resource",
        kind: "json-equals",
        value: { id: "beads/demo-a" },
        fixturePointer: "/oracles/resource",
      },
      {
        id: "run-profile",
        kind: "json-equals",
        equalsRunProfile: true,
        fixturePointer: "/oracles/profile",
      },
      {
        id: "resource-id",
        kind: "json-pointer",
        pointer: "/id",
        exists: true,
        equals: "beads/demo-a",
        fixturePointer: "/oracles/resource-id",
      },
      {
        id: "resource-ids",
        kind: "json-array-set",
        pointer: "/items",
        itemPointer: "/id",
        equals: ["beads/demo-a"],
        fixturePointer: "/oracles/resource-ids",
      },
      {
        id: "links",
        kind: "json-array-tuples",
        pointer: "/items",
        projections: [{ pointer: "/id", normalize: "scope-relative-url" }],
        equals: [["links/one"]],
        fixturePointer: "/oracles/link-tuples",
      },
    ];
    for (const assertion of sourcePairs)
      expectIssues(withAssertion(assertion), [
        assertion.id === "run-profile" ? `${assertionPath}.equalsRunProfile` : assertionPath,
      ]);

    for (const assertion of sourcePairs.filter(({ kind }) => kind !== "json-pointer")) {
      const sourcelessAssertion: Record<string, unknown> = { ...assertion };
      delete sourcelessAssertion.value;
      delete sourcelessAssertion.equals;
      delete sourcelessAssertion.equalsRunProfile;
      delete sourcelessAssertion.fixturePointer;
      expectIssues(withAssertion(sourcelessAssertion), [assertionPath]);
    }

    for (const assertion of sourcePairs) {
      const oracleAssertion: Record<string, unknown> = { ...assertion };
      delete oracleAssertion.value;
      delete oracleAssertion.equals;
      delete oracleAssertion.equalsRunProfile;
      expectIssues(withAssertion({ ...oracleAssertion, fixturePointer: "/bindings/resource" }), [
        `${assertionPath}.fixturePointer`,
      ]);
    }
  });

  it("accepts only the explicit ISO timestamp normalizer for exact JSON values", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const withAssertion = (normalize: string, timestampPointers?: readonly string[]) => ({
      ...base,
      scenarios: [
        {
          ...scenario,
          requests: [
            {
              ...request,
              assertions: [
                {
                  id: "properties",
                  kind: "json-equals",
                  fixturePointer: "/oracles/properties",
                  normalize,
                  ...(timestampPointers === undefined ? {} : { timestampPointers }),
                },
              ],
            },
          ],
        },
      ],
    });

    expect(
      loadExecutableScenarioManifestJson(
        JSON.stringify(withAssertion("iso-timestamps", ["/created_at"])),
        "iso-timestamps.json",
      ).scenarios[0]?.requests?.[0]?.assertions[0],
    ).toMatchObject({ normalize: "iso-timestamps", timestampPointers: ["/created_at"] });
    expectIssues(withAssertion("iso-timestamps"), [
      "$.scenarios[0].requests[0].assertions[0].timestampPointers",
    ]);
    expectIssues(withAssertion("iso-timestamps", ["created_at"]), [
      "$.scenarios[0].requests[0].assertions[0].timestampPointers[0]",
    ]);
    expectIssues(withAssertion("iso-timestamps", ["/created_at", "/created_at"]), [
      "$.scenarios[0].requests[0].assertions[0].timestampPointers",
    ]);
    expectIssues(withAssertion("scope-relative-url"), [
      "$.scenarios[0].requests[0].assertions[0].normalize",
    ]);
  });

  it("requires normalized array-set literals to be strings like fixture-backed values", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    expectIssues(
      {
        ...base,
        scenarios: [
          {
            ...scenario,
            requests: [
              {
                ...request,
                assertions: [
                  {
                    id: "resource-ids",
                    kind: "json-array-set",
                    pointer: "/items",
                    itemPointer: "/id",
                    equals: [7],
                    normalize: "scope-relative-url",
                  },
                ],
              },
            ],
          },
        ],
      },
      ["$.scenarios[0].requests[0].assertions[0].equals"],
    );
  });

  it("parses closed relational tuple projections and rejects width drift", () => {
    const base = manifest();
    const scenario = base.scenarios.at(0);
    const request = scenario?.requests.at(0);
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const tupleAssertion = {
      id: "links",
      kind: "json-array-tuples",
      pointer: "/items",
      projections: [
        { pointer: "/id", normalize: "scope-relative-url" },
        { pointer: "/target/id", normalize: "scope-relative-or-absolute-uri" },
      ],
      equals: [["links/a", "https://external.example/item"]],
    };
    const parsed = parseExecutableScenarioManifest({
      ...base,
      scenarios: [
        {
          ...scenario,
          requests: [{ ...request, assertions: [tupleAssertion] }],
        },
      ],
    });
    expect(parsed.scenarios[0]?.requests?.[0]?.assertions[0]).toEqual(tupleAssertion);

    expectIssues(
      {
        ...base,
        scenarios: [
          {
            ...scenario,
            requests: [
              {
                ...request,
                assertions: [{ ...tupleAssertion, equals: [["links/a"]] }],
              },
            ],
          },
        ],
      },
      ["$.scenarios[0].requests[0].assertions[0].equals"],
    );

    expectIssues(
      {
        ...base,
        scenarios: [
          {
            ...scenario,
            requests: [
              {
                ...request,
                assertions: [{ ...tupleAssertion, equals: [[1, "https://external.example/item"]] }],
              },
            ],
          },
        ],
      },
      ["$.scenarios[0].requests[0].assertions[0].equals"],
    );

    expectIssues(
      {
        ...base,
        scenarios: [
          {
            ...scenario,
            requests: [
              {
                ...request,
                assertions: [{ ...tupleAssertion, projections: [], equals: [[]] }],
              },
            ],
          },
        ],
      },
      ["$.scenarios[0].requests[0].assertions[0].projections"],
    );

    expectIssues(
      {
        ...base,
        scenarios: [
          {
            ...scenario,
            requests: [
              {
                ...request,
                assertions: [{ ...tupleAssertion, projections: "not-an-array", equals: [[]] }],
              },
            ],
          },
        ],
      },
      ["$.scenarios[0].requests[0].assertions[0].projections"],
    );

    for (const [projections, expectedPath] of [
      [
        [{ pointer: "/id", normalize: "not-a-normalizer" }],
        "$.scenarios[0].requests[0].assertions[0].projections[0].normalize",
      ],
      [
        [{ pointer: "/id", extra: true }],
        "$.scenarios[0].requests[0].assertions[0].projections[0].extra",
      ],
      [["not-a-record"], "$.scenarios[0].requests[0].assertions[0].projections[0]"],
    ] as const)
      expectIssues(
        {
          ...base,
          scenarios: [
            {
              ...scenario,
              requests: [
                {
                  ...request,
                  assertions: [{ ...tupleAssertion, projections, equals: [["links/a"]] }],
                },
              ],
            },
          ],
        },
        [expectedPath],
      );

    expectIssues(
      {
        ...base,
        scenarios: [
          {
            ...scenario,
            requests: [
              {
                ...request,
                assertions: [{ ...tupleAssertion, equals: "not-an-array" }],
              },
            ],
          },
        ],
      },
      ["$.scenarios[0].requests[0].assertions[0].equals"],
    );
  });
});

function expectIssues(value: unknown, expectedPaths: readonly string[]): void {
  try {
    parseExecutableScenarioManifest(value);
    throw new Error("expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestValidationError);
    if (!(error instanceof ManifestValidationError)) return;
    expect(error.issues.map(({ path }) => path)).toEqual(expectedPaths);
  }
}
