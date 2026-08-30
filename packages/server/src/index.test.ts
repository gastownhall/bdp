import {
  type AbsoluteHttpUrl,
  type ReadBodyFor,
  type ReadProblem,
  type ReadRequest,
  readProblem,
  type ScopeDiscoveryRequest,
} from "@bdp/protocol";
// This test-only import installs the single non-emitted evidence mock before server admission.
import { establishReadConformanceEvidenceForTesting } from "@bdp/server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  admitReadServerProfile,
  createHttpHandler,
  createNodeHttpServer,
  createPublicReadControls,
  createReadPagination,
  createReadServer,
  isReadServerAdmissionError,
  isReadServerProblem,
  ReadPaginationError,
  ReadSelectorError,
  type ReadServerAdmissionError,
  type ScopePort,
  type ScopeReadOperation,
  ScopeServerClosedError,
  ScopeServerOperationAbortedError,
  type ServerAdvertisedReadLimits,
  type ServerReadControls,
  scopePortProblem,
  scopePortSuccess,
} from "./index.js";

const SCOPE = "https://beads.example/acme/";

describe("alias resolution", () => {
  const scope = "https://scope.example/acme/" as AbsoluteHttpUrl;
  const port: ScopePort = {
    perform: () => Promise.reject(new Error("alias tests never reach the port")),
  };
  function aliasServer(aliases?: Readonly<Record<string, AbsoluteHttpUrl>>) {
    return createReadServer({
      scope,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port,
      ...(aliases === undefined ? {} : { aliases }),
    });
  }
  const table = Object.freeze({
    decision: `${scope}beads/demo-f` as AbsoluteHttpUrl,
    "releases/latest": `${scope}beads/demo-a` as AbsoluteHttpUrl,
  });
  const request = (url: string, method: "GET" | "HEAD" = "GET") => new Request(url, { method });

  it("redirects GET and HEAD with one 307 to the canonical Bead URL, bodiless", async () => {
    const handler = createHttpHandler(aliasServer(table));
    for (const method of ["GET", "HEAD"] as const) {
      const response = await handler(request(`${scope}alias/decision`, method));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${scope}beads/demo-f`);
      expect(response.body).toBeUndefined();
    }
    const nested = await handler(request(`${scope}alias/releases/latest`));
    expect(nested.status).toBe(307);
    expect(nested.headers.get("location")).toBe(`${scope}beads/demo-a`);
  });

  it("returns the uniform 404 for unknown aliases, query-bearing alias URLs, and alias-less authorities", async () => {
    const handler = createHttpHandler(aliasServer(table));
    for (const url of [
      `${scope}alias/never-created`,
      `${scope}alias/decision?x=1`,
      `${scope}alias/`,
    ]) {
      const response = await handler(request(url));
      expect(response.status, url).toBe(404);
    }
    const bare = createHttpHandler(aliasServer());
    const response = await bare(request(`${scope}alias/decision`));
    expect(response.status).toBe(404);
  });

  it("advertises the alias root exactly when an alias table is composed", async () => {
    const discovery = await aliasServer(table).perform({
      kind: "scope-discovery",
      scope,
    });
    expect((discovery as { aliases?: string }).aliases).toBe(`${scope}alias/`);
    const bare = await aliasServer().perform({ kind: "scope-discovery", scope });
    expect((bare as { aliases?: string }).aliases).toBeUndefined();
  });

  it("refuses composition with a noncanonical alias path or a non-Bead target", () => {
    expect(() => aliasServer({ "bad//path": `${scope}beads/demo-f` as AbsoluteHttpUrl })).toThrow();
    expect(() => aliasServer({ ok: `${scope}links/demo-b-a` as AbsoluteHttpUrl })).toThrow();
    expect(() => aliasServer({ ok: `${scope}alias/other` as AbsoluteHttpUrl })).toThrow();
    expect(() =>
      aliasServer({ ok: "https://elsewhere.example/beads/x" as AbsoluteHttpUrl }),
    ).toThrow();
  });
});

describe("Read server contract", () => {
  let withdrawBdptestEvidence: () => void;
  let withdrawBdpbdEvidence: () => void;
  beforeEach(() => {
    withdrawBdptestEvidence = establishReadConformanceEvidenceForTesting("bdptest");
    withdrawBdpbdEvidence = establishReadConformanceEvidenceForTesting("bdpbd");
  });
  afterEach(() => {
    withdrawBdptestEvidence();
    withdrawBdpbdEvidence();
  });

  it("dispatches every Read operation through the one wire-neutral Scope port seam", async () => {
    const requests: unknown[] = [];
    const port = new ResultPort(requests);
    const server = readServer(port);
    const cases: readonly ReadRequest[] = [
      { kind: "scope-discovery", scope: SCOPE },
      { kind: "collection", collection: "beads" },
      { kind: "collection", collection: "links" },
      { kind: "collection", collection: "types" },
      { kind: "resource", resource: "bead", id: `${SCOPE}beads/a` },
      { kind: "resource", resource: "link", id: `${SCOPE}links/a-b` },
      { kind: "resource", resource: "type", id: "https://work.example/types/task" },
      { kind: "resource", resource: "type", id: `${SCOPE}types/task` },
      { kind: "properties", resource: "bead", id: `${SCOPE}beads/a` },
      { kind: "properties", resource: "link", id: `${SCOPE}links/a-b` },
      {
        kind: "bead-links",
        bead: `${SCOPE}beads/a`,
        direction: "outbound",
      },
    ];

    for (const request of cases) await server.perform(request);
    expect(requests).toEqual(cases.slice(1).map(withoutNavigation));
  });

  it("advertises configured page, Selector, and cursor-retention limits", async () => {
    const limits = {
      page: { defaultItems: 50, maximumItems: 200 },
      selector: { bytes: 16_384, depth: 32, nodes: 256 },
      cursorTtlMilliseconds: 300_000,
    } as const;
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: new ResultPort([]),
      advertisedLimits: limits,
      readControls: createPublicReadControls({ scope: SCOPE, limits }),
    });

    await expect(server.perform({ kind: "scope-discovery", scope: SCOPE })).resolves.toMatchObject({
      limits: {
        page: { defaultItems: 50, maximumItems: 200 },
        selector: { bytes: 16_384, depth: 32, nodes: 256 },
        retention: { maximumSnapshotLifetime: "PT300S" },
      },
    });
  });

  it("binds public Read controls to omitted/default, maximum, Selector, and cursor limits", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const limits = {
        page: { defaultItems: 2, maximumItems: 3 },
        selector: { bytes: 24, depth: 4, nodes: 8 },
        cursorTtlMilliseconds: 100,
      };
      const items = ["a", "b", "c"].map((id) => ({
        id: `${SCOPE}beads/${id}`,
        type: "https://work.example/types/task",
        revision: "1",
        properties: { status: "open" },
      }));
      const port: ScopePort = {
        perform: async () => scopePortSuccess({ items, next: null } as never),
      };
      const server = createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port,
        advertisedLimits: limits,
        readControls: createPublicReadControls({ scope: SCOPE, limits }),
      });

      const first = await server.perform({ kind: "collection", collection: "beads" });
      expect(first).toMatchObject({ items: [items[0], items[1]], next: expect.any(String) });
      await expect(
        server.perform({ kind: "collection", collection: "beads", limit: 3 }),
      ).resolves.toEqual({ items, next: null });
      await expect(
        server.perform({ kind: "collection", collection: "beads", limit: 4 }),
      ).resolves.toMatchObject({ code: "limit-exceeded", status: 413, retry: "never" });
      await expect(
        server.perform({
          kind: "collection",
          collection: "beads",
          selector: '$[?@.properties.status == "open"]',
        }),
      ).resolves.toMatchObject({ code: "limit-exceeded", status: 413, retry: "never" });

      if (isReadServerProblem(first))
        throw new Error("public controls returned a first-page Problem");
      const next = first.next;
      if (next === null) throw new Error("public controls did not issue a continuation");
      vi.setSystemTime(1_101);
      await expect(
        server.perform({ kind: "collection", collection: "beads", continuation: next }),
      ).resolves.toMatchObject({ code: "cursor-expired", status: 410 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed advertised limits before a server can be created", () => {
    const base = {
      scope: SCOPE,
      target: "bdptest" as const,
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: new ResultPort([]),
      advertisedLimits: {
        page: { defaultItems: 50, maximumItems: 200 },
        selector: { bytes: 16_384, depth: 32, nodes: 256 },
        cursorTtlMilliseconds: 300_000,
      },
    };
    expect(() =>
      createReadServer({
        ...base,
        advertisedLimits: {
          ...base.advertisedLimits,
          page: { defaultItems: 201, maximumItems: 200 },
        },
      }),
    ).toThrowError(/must not exceed/);
    expect(() =>
      createReadServer({
        ...base,
        advertisedLimits: {
          ...base.advertisedLimits,
          cursorTtlMilliseconds: 0,
        },
      }),
    ).toThrowError(/positive safe integer/);
  });

  it("requires advertised limits to exactly match enforced controls", () => {
    const controls = testReadControls();
    const exact = {
      page: { defaultItems: 2, maximumItems: 10 },
      selector: { bytes: 1_000, depth: 20, nodes: 100 },
      cursorTtlMilliseconds: 60_000,
    } as const;
    const base = {
      scope: SCOPE,
      target: "bdptest" as const,
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: new ResultPort([]),
    };

    expect(() => createReadServer({ ...base, advertisedLimits: exact })).toThrow(
      /require enforced/,
    );
    const mismatches: readonly ServerAdvertisedReadLimits[] = [
      { ...exact, page: { ...exact.page, defaultItems: exact.page.defaultItems + 1 } },
      { ...exact, page: { ...exact.page, maximumItems: exact.page.maximumItems + 1 } },
      { ...exact, selector: { ...exact.selector, bytes: exact.selector.bytes + 1 } },
      { ...exact, selector: { ...exact.selector, depth: exact.selector.depth + 1 } },
      { ...exact, selector: { ...exact.selector, nodes: exact.selector.nodes + 1 } },
      { ...exact, cursorTtlMilliseconds: exact.cursorTtlMilliseconds + 1 },
    ];
    for (const advertisedLimits of mismatches)
      expect(() => createReadServer({ ...base, readControls: controls, advertisedLimits })).toThrow(
        /exactly match/,
      );
    expect(() =>
      createReadServer({ ...base, readControls: controls, advertisedLimits: exact }),
    ).not.toThrow();
  });

  it("defers the safe Node transport ceiling until Node listener construction", () => {
    const limits = {
      page: { defaultItems: 2, maximumItems: 3 },
      selector: { bytes: 400_000, depth: 20, nodes: 100 },
      cursorTtlMilliseconds: 60_000,
    } as const;
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: new ResultPort([]),
      readControls: createPublicReadControls({ scope: SCOPE, limits }),
    });
    expect(() => createNodeHttpServer(server)).toThrow(/safe Node transport ceiling/);
  });

  it("rejects limit and Selector bounds before dispatching the Scope port", async () => {
    const perform = vi.fn(async () =>
      scopePortSuccess({ items: [], next: null } as never),
    ) as ScopePort["perform"];
    const byteLimits: ServerAdvertisedReadLimits = {
      page: { defaultItems: 2, maximumItems: 3 },
      selector: { bytes: 24, depth: 20, nodes: 100 },
      cursorTtlMilliseconds: 100,
    };
    const serverFor = (limits: typeof byteLimits) =>
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform },
        advertisedLimits: limits,
        readControls: createPublicReadControls({ scope: SCOPE, limits }),
      });
    const server = serverFor(byteLimits);

    await expect(
      server.perform({ kind: "collection", collection: "beads", limit: 4 }),
    ).resolves.toMatchObject({ code: "limit-exceeded", status: 413 });
    await expect(
      server.perform({
        kind: "collection",
        collection: "beads",
        selector: "x".repeat(25),
      }),
    ).resolves.toMatchObject({ code: "limit-exceeded", status: 413 });
    const boundedSelector = '$[?@.properties.status == "open"]';
    await expect(
      serverFor({ ...byteLimits, selector: { bytes: 1_000, depth: 3, nodes: 100 } }).perform({
        kind: "collection",
        collection: "beads",
        selector: boundedSelector,
      }),
    ).resolves.toMatchObject({ code: "limit-exceeded", status: 413 });
    await expect(
      serverFor({ ...byteLimits, selector: { bytes: 1_000, depth: 20, nodes: 4 } }).perform({
        kind: "collection",
        collection: "beads",
        selector: boundedSelector,
      }),
    ).resolves.toMatchObject({ code: "limit-exceeded", status: 413 });
    expect(perform).not.toHaveBeenCalled();
  });

  it("establishes the identity policy before validating limit and Selector controls", async () => {
    const identityFor = vi.fn(() => readProblem("unauthenticated"));
    const perform = vi.fn(async () =>
      scopePortSuccess({ items: [], next: null } as never),
    ) as ScopePort["perform"];
    const controls: ServerReadControls = { ...testReadControls(), identityFor };
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: { perform },
      readControls: controls,
    });

    for (const operation of [
      { kind: "collection", collection: "beads", limit: 4 },
      { kind: "collection", collection: "beads", selector: "x".repeat(25) },
    ] as const) {
      await expect(server.perform(operation)).resolves.toEqual(readProblem("unauthenticated"));
    }
    expect(identityFor).toHaveBeenCalledTimes(2);
    expect(perform).not.toHaveBeenCalled();
  });

  it("maps operational pagination failures to 503 while client bounds stay 413", () => {
    const limits = {
      page: { defaultItems: 2, maximumItems: 3 },
      selector: { bytes: 24, depth: 4, nodes: 8 },
      cursorTtlMilliseconds: 100,
    } as const;
    const controls = createPublicReadControls({ scope: SCOPE, limits });
    for (const code of [
      "capacity-exceeded",
      "configuration-error",
      "invalid-snapshot",
      "token-generation-failed",
    ] as const) {
      expect(controls.problemFor(new ReadPaginationError(code, "private"))).toEqual(
        readProblem("temporarily-unavailable"),
      );
    }
    expect(controls.problemFor(new ReadPaginationError("invalid-limit", "private"))).toEqual(
      readProblem("limit-exceeded"),
    );
    expect(
      controls.problemFor(new ReadSelectorError("source-bytes-limit-exceeded", "private")),
    ).toEqual(readProblem("limit-exceeded"));
  });

  it("forbids credentials at the anonymous Authorization View", async () => {
    const perform = vi.fn(async () =>
      scopePortSuccess({ items: [], next: null } as never),
    ) as ScopePort["perform"];
    const limits = {
      page: { defaultItems: 2, maximumItems: 3 },
      selector: { bytes: 24, depth: 4, nodes: 8 },
      cursorTtlMilliseconds: 100,
    } as const;
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: { perform },
      advertisedLimits: limits,
      readControls: createPublicReadControls({ scope: SCOPE, limits }),
    });

    for (const headers of [{ authorization: "Bearer token" }, { cookie: "session=value" }]) {
      await expect(
        server.perform(
          { kind: "collection", collection: "beads" },
          { httpRequest: new Request(`${SCOPE}beads/`, { headers }) },
        ),
      ).resolves.toEqual(readProblem("forbidden"));
      await expect(
        server.perform(
          { kind: "scope-discovery", scope: SCOPE },
          { httpRequest: new Request(`${SCOPE}bdp.json`, { headers }) },
        ),
      ).resolves.toEqual(readProblem("forbidden"));
    }
    expect(perform).not.toHaveBeenCalled();
  });

  it("applies the identity policy before every non-page Scope read", async () => {
    const identityFor = vi.fn((_operation: ReadRequest) => readProblem("forbidden"));
    const perform = vi.fn() as ScopePort["perform"];
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: { perform },
      readControls: { ...testReadControls(), identityFor },
    });
    const operations = [
      { kind: "scope-discovery", scope: SCOPE },
      { kind: "resource", resource: "bead", id: `${SCOPE}beads/a` },
      { kind: "resource", resource: "link", id: `${SCOPE}links/a-b` },
      { kind: "resource", resource: "type", id: `${SCOPE}types/task` },
      { kind: "properties", resource: "bead", id: `${SCOPE}beads/a` },
      { kind: "properties", resource: "link", id: `${SCOPE}links/a-b` },
    ] as const satisfies readonly ReadRequest[];

    for (const operation of operations) {
      await expect(server.perform(operation)).resolves.toEqual(readProblem("forbidden"));
    }
    expect(identityFor.mock.calls.map(([operation]) => operation)).toEqual(operations);
    expect(perform).not.toHaveBeenCalled();
  });

  it("preserves protocol failures across the port boundary", async () => {
    const problem: ReadProblem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
      status: 404,
    };
    const port: ScopePort = {
      perform<Request extends ScopeReadOperation>() {
        return Promise.resolve(scopePortProblem<Request>(problem));
      },
    };
    const server = readServer(port);

    const result = await server.perform({
      kind: "resource",
      resource: "bead",
      id: `${SCOPE}beads/missing`,
    });
    expect(result).toEqual(problem);
    expect(isReadServerProblem(result)).toBe(true);
    expect(isReadServerProblem({ ...problem })).toBe(false);
  });

  it("owns and validates ScopePort success bodies before exposing them", async () => {
    const beadId = `${SCOPE}beads/a`;
    const source = {
      id: beadId,
      type: "https://work.example/types/task",
      revision: "r1",
      properties: { status: "open" },
    };
    const port: ScopePort = {
      perform: async () => scopePortSuccess({ items: [source], next: null } as never),
    };
    const server = readServer(port);
    const result = await server.perform({ kind: "collection", collection: "beads" });
    source.properties.status = "closed";
    expect(result).toEqual({ items: [{ ...source, properties: { status: "open" } }], next: null });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["invalid discriminant", { kind: "other" }],
    ["missing body", { kind: "success" }],
    ["malformed collection", { kind: "success", body: { items: [], next: "not-a-url" } }],
    [
      "unsupported adapter continuation",
      { kind: "success", body: { items: [], next: `${SCOPE}beads/?cursor=opaque` } },
    ],
  ])("fails closed for a %s ScopePort result", async (_label, result) => {
    const server = readServer({
      perform: async () => result as never,
    });
    await expect(server.perform({ kind: "collection", collection: "beads" })).rejects.toThrow();
  });

  it("enforces request identity and incident direction at the ScopePort seam", async () => {
    const beadId = `${SCOPE}beads/a`;
    const wrongBead = {
      id: `${SCOPE}beads/other`,
      type: "https://work.example/types/task",
      revision: "r1",
      properties: { status: "open" },
    };
    const wrongLink = {
      id: `${SCOPE}links/a-b`,
      type: "https://work.example/types/blocks",
      revision: "r1",
      source: `${SCOPE}beads/b`,
      target: beadId,
      properties: {},
    };
    const server = readServer({
      perform: async (request) =>
        request.kind === "resource"
          ? scopePortSuccess(wrongBead as never)
          : scopePortSuccess({ items: [wrongLink], next: null } as never),
    });
    await expect(
      server.perform({ kind: "resource", resource: "bead", id: beadId }),
    ).rejects.toThrow("wrong Bead ID");
    await expect(
      server.perform({ kind: "bead-links", bead: beadId, direction: "outbound" }),
    ).rejects.toThrow("incident direction");
  });

  it("does not retain server Problem provenance when the exact branded result is reused", async () => {
    const problem: ReadProblem = {
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "cursor-expired",
      retry: "after-state-change",
      status: 410,
    };
    let branded: unknown;
    let calls = 0;
    const server = readServer({
      perform: async () =>
        calls++ === 0 ? scopePortProblem(problem) : scopePortSuccess(branded as never),
    });
    branded = await server.perform({ kind: "resource", resource: "bead", id: `${SCOPE}beads/a` });
    expect(isReadServerProblem(branded)).toBe(true);
    const success = await server.perform({
      kind: "properties",
      resource: "bead",
      id: `${SCOPE}beads/a`,
    });
    expect(success).toEqual(problem);
    expect(isReadServerProblem(success)).toBe(false);
  });

  it("rejects invalid discovery Scope identities", async () => {
    const server = readServer(new ResultPort([]));
    const cases: readonly ReadRequest[] = [
      { kind: "scope-discovery", scope: undefined as never },
      { kind: "scope-discovery", scope: "not a URL" as never },
      { kind: "scope-discovery", scope: "HTTPS://beads.example/acme/" as never },
      {
        kind: "scope-discovery",
        scope: "https://user:password@beads.example/acme/" as never,
      },
      { kind: "scope-discovery", scope: "https://other.example/acme/" },
    ];

    for (const request of cases)
      await expect(server.perform(request)).resolves.toMatchObject({
        code: "invalid-parameter",
        status: 400,
      });
  });

  it("fails closed for deferred controls and invalid endpoint identities before port dispatch", async () => {
    const requests: unknown[] = [];
    const server = readServer(new ResultPort(requests));
    const cases: readonly ReadRequest[] = [
      { kind: "collection", collection: "beads", limit: 1 },
      { kind: "collection", collection: "links", selector: "$" },
      { kind: "collection", collection: "types", continuation: `${SCOPE}types/?cursor=x` },
      { kind: "bead-links", bead: `${SCOPE}beads/a`, direction: "both", limit: 1 },
      {
        kind: "bead-links",
        bead: `${SCOPE}beads/a`,
        direction: "both",
        continuation: `${SCOPE}beads/a?view=links&cursor=x`,
      },
      {
        kind: "collection",
        collection: "links",
        source: `${SCOPE}links/a-b`,
      },
      {
        kind: "collection",
        collection: "links",
        endpoint: `${SCOPE}beads/%61`,
      },
      {
        kind: "collection",
        collection: "links",
        type: "HTTPS://work.example/types/blocks" as never,
      },
      {
        kind: "collection",
        collection: "beads",
        conformsTo: "not a url" as never,
      },
      { kind: "collection", collection: "beads", type: `${SCOPE}beads/a` },
      { kind: "collection", collection: "links", conformsTo: `${SCOPE}links/a-b` },
    ];

    for (const request of cases)
      await expect(server.perform(request)).resolves.toMatchObject({
        code: "invalid-parameter",
        status: 400,
      });
    expect(requests).toEqual([]);
  });

  it("applies Selector after structural port filtering and before snapshot pagination", async () => {
    const type = "https://work.example/types/task";
    const records = [
      {
        id: `${SCOPE}beads/a`,
        type,
        revision: "r1",
        properties: { status: "ready" },
      },
      {
        id: `${SCOPE}beads/b`,
        type,
        revision: "r2",
        properties: { status: "blocked" },
      },
      {
        id: `${SCOPE}beads/c`,
        type,
        revision: "r3",
        properties: { status: "ready" },
      },
    ];
    const perform = vi.fn(async () => scopePortSuccess({ items: records, next: null } as never));
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: { perform: perform as ScopePort["perform"] },
      readControls: testReadControls(),
    });

    const first = await server.perform({
      kind: "collection",
      collection: "beads",
      type,
      selector: '$[?@.properties.status == "ready"]',
      limit: 1,
    });
    if (isReadServerProblem(first) || first.next === null) throw new Error("expected first page");
    const second = await server.perform({
      kind: "collection",
      collection: "beads",
      continuation: first.next,
    });

    expect(first.items.map((item) => item.id)).toEqual([`${SCOPE}beads/a`]);
    expect(second).toMatchObject({ items: [{ id: `${SCOPE}beads/c` }], next: null });
    expect(perform).toHaveBeenCalledOnce();
    expect(perform).toHaveBeenCalledWith(
      { kind: "collection", collection: "beads", type },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    {
      label: "Link collection",
      operation: { kind: "collection", collection: "links", limit: 1 } as const,
      items: ["one", "two"].map((local) => ({
        id: `${SCOPE}links/${local}`,
        type: "https://work.example/types/blocks",
        revision: `r-${local}`,
        source: `${SCOPE}beads/a`,
        target: `${SCOPE}beads/b`,
        properties: {},
      })),
      continue: (next: string) =>
        ({ kind: "collection", collection: "links", continuation: next }) as const,
    },
    {
      label: "Type inventory",
      operation: { kind: "collection", collection: "types", limit: 1 } as const,
      items: ["task", "bug"].map((local) => ({
        id: `https://work.example/types/${local}`,
        name: local,
        describes: "bead" as const,
      })),
      continue: (next: string) =>
        ({ kind: "collection", collection: "types", continuation: next }) as const,
    },
    {
      label: "incident Links",
      operation: {
        kind: "bead-links",
        bead: `${SCOPE}beads/a`,
        direction: "both",
        limit: 1,
      } as const,
      items: ["one", "two"].map((local) => ({
        id: `${SCOPE}links/${local}`,
        type: "https://work.example/types/blocks",
        revision: `r-${local}`,
        source: `${SCOPE}beads/a`,
        target: `${SCOPE}beads/b`,
        properties: {},
      })),
      continue: (next: string) =>
        ({ kind: "bead-links", bead: `${SCOPE}beads/a`, continuation: next }) as const,
    },
  ])("snapshot-pages the $label without a continuation port read", async (testCase) => {
    const perform = vi.fn(async () =>
      scopePortSuccess({ items: testCase.items, next: null } as never),
    );
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: { perform: perform as ScopePort["perform"] },
      readControls: testReadControls(),
    });

    const first = await server.perform(testCase.operation);
    if (isReadServerProblem(first) || first.next === null) throw new Error("expected first page");
    const second = await server.perform(testCase.continue(first.next) as ReadRequest);

    expect(first.items).toHaveLength(1);
    expect(second).toMatchObject({
      items: [expect.objectContaining({ id: testCase.items[1]?.id })],
    });
    expect(perform).toHaveBeenCalledOnce();
  });

  it("dispatches external and Scope-local Type collection filters unchanged", async () => {
    const requests: unknown[] = [];
    const server = readServer(new ResultPort(requests));
    const cases: readonly ReadRequest[] = [
      {
        kind: "collection",
        collection: "beads",
        type: "https://work.example/types/task",
        conformsTo: `${SCOPE}types/work-item`,
      },
      {
        kind: "collection",
        collection: "links",
        type: `${SCOPE}types/blocks`,
        conformsTo: "https://work.example/types/dependency",
      },
    ];

    for (const request of cases) await server.perform(request);
    expect(requests).toEqual(cases);
  });

  it("rejects forged request discriminants and kind-specific fields before port dispatch", async () => {
    const requests: unknown[] = [];
    const server = readServer(new ResultPort(requests));
    const cases: readonly ReadRequest[] = [
      undefined as never,
      null as never,
      [] as never,
      { kind: "unknown" } as never,
      { kind: "scope-discovery", scope: SCOPE, resource: "bead" } as never,
      { kind: "resource", resource: "typ", id: `${SCOPE}types/task` } as never,
      {
        kind: "resource",
        resource: "bead",
        id: `${SCOPE}beads/a`,
        direction: "both",
      } as never,
      { kind: "properties", resource: "type", id: `${SCOPE}types/task` } as never,
      {
        kind: "properties",
        resource: "bead",
        id: `${SCOPE}beads/a`,
        type: `${SCOPE}types/task`,
      } as never,
      { kind: "collection", collection: "widgets" } as never,
      { kind: "collection", collection: "beads", source: `${SCOPE}beads/a` } as never,
      { kind: "collection", collection: "beads", target: `${SCOPE}beads/a` } as never,
      { kind: "collection", collection: "beads", endpoint: `${SCOPE}beads/a` } as never,
      { kind: "collection", collection: "beads", unknown: "value" } as never,
      { kind: "collection", collection: "links", bead: `${SCOPE}beads/a` } as never,
      { kind: "collection", collection: "types", type: `${SCOPE}types/task` } as never,
      {
        kind: "collection",
        collection: "types",
        conformsTo: `${SCOPE}types/base`,
      } as never,
      { kind: "collection", collection: "types", source: `${SCOPE}beads/a` } as never,
      { kind: "collection", collection: "types", target: `${SCOPE}beads/a` } as never,
      { kind: "collection", collection: "types", endpoint: `${SCOPE}beads/a` } as never,
      { kind: "collection", collection: "types", selector: "$" } as never,
      { kind: "bead-links", bead: `${SCOPE}beads/a`, direction: "sideways" } as never,
      { kind: "bead-links", bead: `${SCOPE}beads/a`, type: `${SCOPE}types/task` } as never,
      {
        kind: "bead-links",
        bead: `${SCOPE}beads/a`,
        conformsTo: `${SCOPE}types/work-item`,
      } as never,
      { kind: "bead-links", bead: `${SCOPE}beads/a`, source: `${SCOPE}beads/a` } as never,
      { kind: "bead-links", bead: `${SCOPE}beads/a`, target: `${SCOPE}beads/a` } as never,
      { kind: "bead-links", bead: `${SCOPE}beads/a`, endpoint: `${SCOPE}beads/a` } as never,
      { kind: "bead-links", bead: `${SCOPE}beads/a`, selector: "$" } as never,
    ];

    for (const request of cases)
      await expect(server.perform(request)).resolves.toMatchObject({
        code: "invalid-parameter",
        status: 400,
      });
    expect(requests).toEqual([]);
  });

  it("rejects invalid Bead and Link resource identities before port dispatch", async () => {
    const requests: unknown[] = [];
    const server = readServer(new ResultPort(requests));
    const cases: readonly ReadRequest[] = [
      { kind: "resource", resource: "bead", id: "not a URL" as never },
      { kind: "resource", resource: "bead", id: `${SCOPE}beads/%61` },
      { kind: "resource", resource: "bead", id: `${SCOPE}links/a-b` },
      {
        kind: "resource",
        resource: "link",
        id: "https://other.example/acme/links/a-b",
      },
      { kind: "resource", resource: "link", id: `${SCOPE}beads/a` },
    ];

    for (const request of cases)
      await expect(server.perform(request)).resolves.toMatchObject({
        code: "invalid-parameter",
        status: 400,
      });
    expect(requests).toEqual([]);
  });

  it("rejects invalid Type resource identities before port dispatch", async () => {
    const requests: unknown[] = [];
    const server = readServer(new ResultPort(requests));
    const cases: readonly ReadRequest[] = [
      { kind: "resource", resource: "type", id: undefined as never },
      { kind: "resource", resource: "type", id: "not a URL" as never },
      {
        kind: "resource",
        resource: "type",
        id: "HTTPS://work.example/types/task" as never,
      },
      {
        kind: "resource",
        resource: "type",
        id: "https://user:password@work.example/types/task" as never,
      },
      { kind: "resource", resource: "type", id: `${SCOPE}beads/a` },
      { kind: "resource", resource: "type", id: `${SCOPE}links/a-b` },
      { kind: "resource", resource: "type", id: `${SCOPE}other/task` },
      { kind: "resource", resource: "type", id: `${SCOPE}types/%61` },
      { kind: "resource", resource: "type", id: `${SCOPE}types/a%2Fb` },
    ];

    for (const request of cases)
      await expect(server.perform(request)).resolves.toMatchObject({
        code: "invalid-parameter",
        status: 400,
      });
    expect(requests).toEqual([]);
  });

  it("rejects invalid Bead and Link properties identities before port dispatch", async () => {
    const requests: unknown[] = [];
    const server = readServer(new ResultPort(requests));
    const cases: readonly ReadRequest[] = [
      {
        kind: "properties",
        resource: "bead",
        id: "https://other.example/acme/beads/a",
      },
      { kind: "properties", resource: "bead", id: `${SCOPE}links/a-b` },
      { kind: "properties", resource: "link", id: `${SCOPE}links/%61-b` },
      {
        kind: "properties",
        resource: "link",
        id: "https://other.example/acme/links/a-b",
      },
    ];

    for (const request of cases)
      await expect(server.perform(request)).resolves.toMatchObject({
        code: "invalid-parameter",
        status: 400,
      });
    expect(requests).toEqual([]);
  });

  it("rejects invalid incident-Link subject identities before port dispatch", async () => {
    const requests: unknown[] = [];
    const server = readServer(new ResultPort(requests));
    const cases: readonly ReadRequest[] = [
      { kind: "bead-links", bead: `${SCOPE}beads/%61`, direction: "both" },
      { kind: "bead-links", bead: `${SCOPE}links/a-b`, direction: "both" },
      {
        kind: "bead-links",
        bead: "https://other.example/acme/beads/a",
        direction: "both",
      },
    ];

    for (const request of cases)
      await expect(server.perform(request)).resolves.toMatchObject({
        code: "invalid-parameter",
        status: 400,
      });
    expect(requests).toEqual([]);
  });

  it("rejects an already-aborted operation before port dispatch", async () => {
    const requests: unknown[] = [];
    const server = readServer(new ResultPort(requests));
    const controller = new AbortController();
    controller.abort("request disconnected");

    await expect(
      server.perform({ kind: "scope-discovery", scope: SCOPE }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ScopeServerOperationAbortedError);
    expect(requests).toEqual([]);
  });

  it.each(["identity", "port"] as const)(
    "does not retain pagination state after aborting during late %s resolution",
    async (lateStage) => {
      let releaseLate!: () => void;
      const late = new Promise<void>((resolve) => {
        releaseLate = resolve;
      });
      let identityCalls = 0;
      let portCalls = 0;
      const controls: ServerReadControls = {
        ...testReadControls({ retainedStateCapacity: 2 }),
        identityFor: async () => {
          identityCalls += 1;
          if (lateStage === "identity" && identityCalls === 1) await late;
          return { authorizationView: "test-view", scopeEpoch: "test-epoch" };
        },
      };
      const port: ScopePort = {
        perform: async () => {
          portCalls += 1;
          if (lateStage === "port" && portCalls === 1) await late;
          return scopePortSuccess({
            items: [
              {
                id: `${SCOPE}beads/a`,
                type: "https://work.example/types/task",
                revision: "r1",
                properties: {},
              },
              {
                id: `${SCOPE}beads/b`,
                type: "https://work.example/types/task",
                revision: "r2",
                properties: {},
              },
            ],
            next: null,
          } as never) as never;
        },
      };
      const server = createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port,
        readControls: controls,
      });
      const abort = new AbortController();
      const abandoned = server.perform(
        { kind: "collection", collection: "beads", limit: 1 },
        { signal: abort.signal },
      );
      await vi.waitFor(() => expect(lateStage === "identity" ? identityCalls : portCalls).toBe(1));
      abort.abort("caller left");
      await expect(abandoned).rejects.toBeInstanceOf(ScopeServerOperationAbortedError);
      releaseLate();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const admitted = await server.perform({
        kind: "collection",
        collection: "beads",
        limit: 1,
      });
      expect(isReadServerProblem(admitted)).toBe(false);
      expect(admitted).toMatchObject({ next: expect.stringContaining("cursor=") });
    },
  );

  it("close lets admitted work finish during the grace period", async () => {
    const port = new DrainingPort();
    const server = readServer(port);
    const operation = server.perform({ kind: "resource", resource: "bead", id: `${SCOPE}beads/a` });
    await port.started;

    let closeFinished = false;
    const close = server.close().then(() => {
      closeFinished = true;
    });
    expect(port.signal?.aborted).toBe(false);
    expect(closeFinished).toBe(false);
    await expect(server.perform({ kind: "scope-discovery", scope: SCOPE })).rejects.toBeInstanceOf(
      ScopeServerClosedError,
    );

    port.finish();
    await expect(operation).resolves.toMatchObject({ id: `${SCOPE}beads/a` });
    await close;
  });

  it("releases retained pagination state when the server closes", async () => {
    const controls = testReadControls();
    const items = ["a", "b", "c"].map((id) => ({
      id: `${SCOPE}beads/${id}`,
      type: "https://work.example/types/task",
      revision: "1",
      properties: {},
    }));
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: { perform: async () => scopePortSuccess({ items, next: null } as never) },
      readControls: controls,
    });
    const first = await server.perform({ kind: "collection", collection: "beads", limit: 1 });
    if (isReadServerProblem(first) || first.next === null) throw new Error("expected cursor");
    const token = new URL(first.next).searchParams.get("cursor");
    if (token === null) throw new Error("expected cursor token");

    await server.close();
    expect(() =>
      controls.pagination.continuePage({
        token,
        authorizationView: "test-view",
        scopeEpoch: "test-epoch",
        projection: `${SCOPE}beads/?limit=1`,
      }),
    ).toThrowError(expect.objectContaining({ code: "configuration-error" }));
  });

  it("close cancels admitted Read work after the grace period", async () => {
    const port = new DrainingPort(true);
    const server = readServer(port, { closeGraceMs: 0, closeTimeoutMs: 1_000 });
    const operation = server.perform({ kind: "resource", resource: "bead", id: `${SCOPE}beads/a` });
    await port.started;
    const operationRejection = expect(operation).rejects.toBeInstanceOf(
      ScopeServerOperationAbortedError,
    );

    const close = server.close();

    await vi.waitFor(() => expect(port.signal?.aborted).toBe(true));
    await operationRejection;
    await expect(close).resolves.toBeUndefined();
  });

  it("close abandons a Scope port that ignores cancellation after the total bound", async () => {
    const port = new DrainingPort();
    const server = readServer(port, { closeGraceMs: 0, closeTimeoutMs: 20 });
    const operation = server.perform({ kind: "resource", resource: "bead", id: `${SCOPE}beads/a` });
    await port.started;
    const operationRejection = expect(operation).rejects.toBeInstanceOf(
      ScopeServerOperationAbortedError,
    );

    await expect(server.close()).resolves.toBeUndefined();
    await operationRejection;
    expect(port.signal?.aborted).toBe(true);
    port.finish();
  });

  it("admits only an explicit profile backed by that target's cumulative capability", () => {
    expect(() => admitReadServerProfile(undefined, "bdptest")).toThrowError(
      expect.objectContaining<Partial<ReadServerAdmissionError>>({ code: "profile-required" }),
    );
    expect(() => admitReadServerProfile("read-update", "bdptest")).toThrowError(
      expect.objectContaining<Partial<ReadServerAdmissionError>>({ code: "profile-unsupported" }),
    );
    // Shipping evidence is recorded for both real targets, so the
    // evidence-refusal branch is proved through a target that carries none;
    // withdrawing the test grant can no longer make a real target refuse.
    expect(() => admitReadServerProfile("read", "smoke-imposter" as never)).toThrowError(
      expect.objectContaining<Partial<ReadServerAdmissionError>>({ code: "profile-unsupported" }),
    );
    expect(admitReadServerProfile("read", "bdpbd")).toMatchObject({ profile: "read" });
    expect(admitReadServerProfile("read", "bdptest")).toMatchObject({
      profile: "read",
    });
  });

  it("recognizes only genuine admission errors", () => {
    expect(() => admitReadServerProfile(undefined, "bdptest")).toThrowError(
      expect.objectContaining({ name: "ReadServerAdmissionError" }),
    );
    try {
      admitReadServerProfile(undefined, "bdptest");
    } catch (error) {
      expect(isReadServerAdmissionError(error)).toBe(true);
    }
    expect(
      isReadServerAdmissionError({
        name: "ReadServerAdmissionError",
        code: "profile-unsupported",
        message: "refused",
      }),
    ).toBe(false);
    expect(isReadServerAdmissionError(new Error("refused"))).toBe(false);
  });

  it("rejects a forged admitted-profile object", () => {
    expect(() =>
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: { profile: "read" } as never,
        port: new ResultPort([]),
      }),
    ).toThrowError(TypeError);

    const proxy = new Proxy(
      { profile: "read" },
      {
        get: (target, property) =>
          typeof property === "symbol" ? true : Reflect.get(target, property),
      },
    );
    expect(() =>
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: proxy as never,
        port: new ResultPort([]),
      }),
    ).toThrowError(TypeError);

    const admittedProfile = admitReadServerProfile("read", "bdptest");
    expect(() =>
      createReadServer({
        scope: SCOPE,
        target: "bdpbd",
        admittedProfile,
        port: new ResultPort([]),
      }),
    ).toThrowError(TypeError);
  });

  it.each([
    ["forged pagination", () => ({ ...testReadControls(), pagination: {} })],
    ["proxied controls", () => new Proxy(testReadControls(), {})],
    [
      "proxied pagination",
      () => {
        const controls = testReadControls();
        return { ...controls, pagination: new Proxy(controls.pagination, {}) };
      },
    ],
    [
      "proxied Selector limits",
      () => {
        const controls = testReadControls();
        return { ...controls, selectorLimits: new Proxy(controls.selectorLimits, {}) };
      },
    ],
    [
      "symbol control field",
      () => Object.assign(testReadControls(), { [Symbol("surprise")]: true }),
    ],
    ["missing identity policy", () => ({ ...testReadControls(), identityFor: undefined })],
    ["missing Problem policy", () => ({ ...testReadControls(), problemFor: undefined })],
    [
      "invalid Selector limits",
      () => ({ ...testReadControls(), selectorLimits: { bytes: 0, depth: 1, nodes: 1 } }),
    ],
    [
      "invalid authentication challenge",
      () => ({ ...testReadControls(), unauthenticatedChallenge: "bad\r\nchallenge" }),
    ],
    [
      "invalid authentication scheme",
      () => ({ ...testReadControls(), unauthenticatedChallenge: "bad,scheme" }),
    ],
  ] as const)("rejects malformed ServerReadControls: %s", (_label, controls) => {
    expect(() =>
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: new ResultPort([]),
        readControls: controls() as never,
      }),
    ).toThrowError(TypeError);
  });

  it("binds each pagination engine to only one server lifecycle", () => {
    const controls = testReadControls();
    createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: new ResultPort([]),
      readControls: controls,
    });

    expect(() =>
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: new ResultPort([]),
        readControls: controls,
      }),
    ).toThrow(/only one server/);
  });

  it("keeps omitted controls fail-closed after the caller mutates ServerOptions", async () => {
    const requests: unknown[] = [];
    const options = {
      scope: SCOPE,
      target: "bdptest" as const,
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: new ResultPort(requests),
    };
    const server = createReadServer(options);
    Object.assign(options, { readControls: testReadControls() });

    await expect(
      server.perform({ kind: "collection", collection: "beads", limit: 1 }),
    ).resolves.toMatchObject({ code: "invalid-parameter" });
    expect(requests).toEqual([]);
  });

  it("uses the validated nested-control snapshot after caller replacement", async () => {
    const controls = testReadControls();
    const options = {
      scope: SCOPE,
      target: "bdptest" as const,
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: {
        perform: async () =>
          scopePortSuccess({
            items: [
              {
                id: `${SCOPE}beads/a`,
                type: "https://work.example/types/task",
                revision: "r1",
                properties: { ready: true },
              },
            ],
            next: null,
          } as never) as never,
      },
      readControls: controls,
    };
    const server = createReadServer(options);
    const mutable = controls as unknown as Record<string, unknown>;
    mutable.pagination = {};
    mutable.identityFor = () => {
      throw new Error("replacement identity policy ran");
    };
    mutable.problemFor = () => {
      throw new Error("replacement Problem policy ran");
    };
    (controls.selectorLimits as unknown as Record<string, unknown>).bytes = 0;
    Object.assign(options, { readControls: undefined });

    await expect(
      server.perform({
        kind: "collection",
        collection: "beads",
        selector: "$[?@.properties.ready]",
      }),
    ).resolves.toMatchObject({ items: [{ id: `${SCOPE}beads/a` }], next: null });
  });

  it.each(["ServerOptions", "ServerReadControls"] as const)(
    "rejects an alternating %s getter without invoking it",
    (location) => {
      let reads = 0;
      const controls = testReadControls();
      if (location === "ServerReadControls") {
        Object.defineProperty(controls, "pagination", {
          configurable: true,
          get() {
            reads += 1;
            return reads % 2 === 1 ? testReadControls().pagination : {};
          },
        });
      }
      const options: Record<string, unknown> = {
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: new ResultPort([]),
        ...(location === "ServerReadControls" ? { readControls: controls } : {}),
      };
      if (location === "ServerOptions") {
        Object.defineProperty(options, "readControls", {
          configurable: true,
          get() {
            reads += 1;
            return reads % 2 === 1 ? controls : undefined;
          },
        });
      }

      expect(() => createReadServer(options as never)).toThrow("own data properties");
      expect(reads).toBe(0);
    },
  );

  it("rejects a noncanonical configured Scope during construction", () => {
    const admittedProfile = admitReadServerProfile("read", "bdptest");
    for (const scope of [
      undefined,
      "not a URL",
      "HTTPS://beads.example/acme/",
      "https://user:password@beads.example/acme/",
      "https://beads.example/acme",
      "https://beads.example/acme/?query=1",
      "https://beads.example/acme/#fragment",
    ])
      expect(() =>
        createReadServer({
          scope: scope as never,
          target: "bdptest",
          admittedProfile,
          port: new ResultPort([]),
        }),
      ).toThrow("canonical HTTP(S) URL ending in /");
  });

  it("rejects a structurally forged server at the HTTP boundary", () => {
    expect(() =>
      createHttpHandler({
        scope: SCOPE,
        advertisedProfile: "read",
        perform: vi.fn(),
        probe: vi.fn(),
        close: vi.fn(),
      } as never),
    ).toThrowError(TypeError);

    const server = readServer(new ResultPort([]));
    expect(() => createHttpHandler(new Proxy(server, {}))).toThrowError(TypeError);
    expect(() => createHttpHandler({ ...server })).toThrowError(TypeError);
  });
});

function readServer(
  port: ScopePort,
  closeOptions: { readonly closeGraceMs?: number; readonly closeTimeoutMs?: number } = {},
) {
  return createReadServer({
    scope: SCOPE,
    target: "bdptest",
    admittedProfile: admitReadServerProfile("read", "bdptest"),
    port,
    ...closeOptions,
  });
}

class ResultPort implements ScopePort {
  constructor(private readonly requests: unknown[]) {}

  perform<Operation extends ScopeReadOperation>(operation: Operation) {
    this.requests.push(operation);
    return Promise.resolve(scopePortSuccess<Operation>(resultForOperation(operation)));
  }
}

class DrainingPort implements ScopePort {
  readonly started: Promise<void>;
  private readonly markStarted: () => void;
  private readonly completion: Promise<void>;
  readonly finish: () => void;
  signal: AbortSignal | undefined;

  constructor(private readonly finishOnAbort = false) {
    [this.started, this.markStarted] = deferred();
    [this.completion, this.finish] = deferred();
  }

  async perform<Operation extends ScopeReadOperation>(
    operation: Operation,
    options: { readonly signal: AbortSignal },
  ) {
    this.signal = options.signal;
    this.markStarted();
    if (this.finishOnAbort) options.signal.addEventListener("abort", this.finish, { once: true });
    await this.completion;
    return scopePortSuccess<Operation>(resultForOperation(operation));
  }
}

function withoutNavigation(request: ReadRequest): unknown {
  if (request.kind === "scope-discovery") return undefined;
  return request;
}

function resultForOperation<Operation extends ScopeReadOperation>(
  operation: Operation,
): ReadBodyFor<Operation> {
  return resultFor(operation as ReadRequest) as ReadBodyFor<Operation>;
}

function resultFor<Request extends ReadRequest>(request: Request): ReadBodyFor<Request> {
  let result: unknown;
  switch (request.kind) {
    case "scope-discovery":
      result = {
        bdpVersion: "0",
        profile: "read",
        scope: SCOPE,
        beads: `${SCOPE}beads/`,
        links: `${SCOPE}links/`,
        types: `${SCOPE}types/`,
      } satisfies ReadBodyFor<ScopeDiscoveryRequest>;
      break;
    case "collection":
    case "bead-links":
      result = { items: [], next: null };
      break;
    case "properties":
      result = {};
      break;
    case "resource":
      if (request.resource === "type") {
        result = { id: request.id, name: "Type", describes: "bead", conformsTo: [] };
      } else if (request.resource === "bead") {
        result = {
          id: request.id,
          type: "https://work.example/types/task",
          revision: "1",
          properties: {},
        };
      } else {
        result = {
          id: request.id,
          type: "https://work.example/types/blocks",
          revision: "1",
          source: `${SCOPE}beads/a`,
          target: `${SCOPE}beads/b`,
          properties: {},
        };
      }
      break;
  }
  return result as ReadBodyFor<Request>;
}

function deferred(): readonly [Promise<void>, () => void] {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return [promise, resolve];
}

function testReadControls(
  paginationOverrides: Partial<Parameters<typeof createReadPagination>[0]> = {},
): ServerReadControls {
  let token = 0;
  const retainedStateCapacity = paginationOverrides.retainedStateCapacity ?? 100;
  return {
    selectorLimits: { bytes: 1_000, depth: 20, nodes: 100 },
    pagination: createReadPagination({
      scope: SCOPE,
      defaultPageItems: 2,
      maxPageItems: 10,
      cursorTtlMs: 60_000,
      retainedStateCapacity,
      maxRetainedCursorPositionsPerSnapshot:
        paginationOverrides.maxRetainedCursorPositionsPerSnapshot ?? retainedStateCapacity - 1,
      retainedSnapshotByteCapacity: 100_000,
      retainedSnapshotNodeCapacity: 10_000,
      maxOpaqueTokenLength: 40,
      tokenGenerationAttempts: 3,
      clock: () => 1_000,
      generateOpaqueToken: () => `test_${++token}`,
      ...paginationOverrides,
    }),
    identityFor: () => ({ authorizationView: "test-view", scopeEpoch: "test-epoch" }),
    problemFor: () => readProblem("invalid-parameter"),
  };
}
