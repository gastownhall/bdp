import {
  readProblem,
  type ReadProblem,
  type ReadRequest,
  type ScopeReadOperation,
} from "@bdp/protocol";
// This test-only import installs the single non-emitted evidence mock before server admission.
import { establishReadConformanceEvidenceForTesting } from "@bdp/server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admitReadServerProfile,
  createHttpHandler,
  createReadPagination,
  createReadServer,
  scopePortProblem,
  scopePortSuccess,
  type ServerReadControls,
  type ScopePort,
} from "./index.js";

const SCOPE = "https://beads.example/acme/";

describe("BDP public HTTP handler", () => {
  let withdrawEvidence: () => void;
  beforeEach(() => {
    withdrawEvidence = establishReadConformanceEvidenceForTesting("bdptest");
  });
  afterEach(() => withdrawEvidence());

  it("exposes scope Link discovery, discovery JSON, and generic Read routes", async () => {
    const port: ScopePort = {
      perform<Operation extends ScopeReadOperation>(operation: Operation) {
        if (operation.kind === "collection")
          return Promise.resolve(scopePortSuccess<Operation>({ items: [], next: null } as never));
        throw new Error(`unexpected ${operation.kind}`);
      },
    };
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port,
      }),
    );
    const probe = await handler(new Request(SCOPE));
    expect(probe.status).toBe(204);
    expect(probe.headers.get("link")).toContain('rel="service-desc"');
    const discovery = await handler(new Request(`${SCOPE}bdp.json`));
    expect(discovery.status).toBe(200);
    expect(discovery.body).toMatchObject({ bdpVersion: "0", profile: "read", scope: SCOPE });
    const beads = await handler(new Request(`${SCOPE}beads/`));
    expect(beads.status).toBe(200);
    expect(beads.body).toEqual({ items: [], next: null });
  });

  it("dispatches a canonical Scope-local Type resource route", async () => {
    const perform = vi.fn(async (operation: ScopeReadOperation) => {
      if (operation.kind !== "resource" || operation.resource !== "type")
        throw new Error("unexpected operation");
      return scopePortSuccess({
        id: operation.id,
        name: "Task",
        describes: "bead",
        conformsTo: [],
      } as never);
    });
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: perform as ScopePort["perform"] },
      }),
    );

    const response = await handler(new Request(`${SCOPE}types/task`));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: `${SCOPE}types/task`,
      name: "Task",
      describes: "bead",
      conformsTo: [],
    });
    expect(perform).toHaveBeenCalledWith(
      { kind: "resource", resource: "type", id: `${SCOPE}types/task` },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("emits the quoted Resource revision as ETag only on individual Bead and Link reads", async () => {
    const perform = vi.fn(async (operation: ScopeReadOperation) => {
      if (operation.kind === "resource" && operation.resource === "bead") {
        return scopePortSuccess({
          id: operation.id,
          type: "https://work.example/types/task",
          revision: "opaque-task-revision",
          properties: {},
        } as never);
      }
      if (operation.kind === "resource" && operation.resource === "link") {
        return scopePortSuccess({
          id: operation.id,
          type: "https://work.example/types/blocks",
          revision: "opaque-link-revision",
          source: { id: `${SCOPE}beads/a`, type: "https://work.example/types/task" },
          target: { id: `${SCOPE}beads/b`, type: "https://work.example/types/task" },
          properties: {},
        } as never);
      }
      if (operation.kind === "resource" && operation.resource === "type") {
        return scopePortSuccess({
          id: operation.id,
          name: "Task",
          describes: "bead",
          conformsTo: [],
        } as never);
      }
      return scopePortSuccess({ items: [], next: null } as never);
    });
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: perform as ScopePort["perform"] },
      }),
    );

    const bead = await handler(new Request(`${SCOPE}beads/a`));
    const link = await handler(new Request(`${SCOPE}links/a-b`));
    const type = await handler(new Request(`${SCOPE}types/task`));
    const collection = await handler(new Request(`${SCOPE}beads/`));
    const problem = await handler(new Request(`${SCOPE}unknown`));

    expect(bead.headers.get("etag")).toBe('"opaque-task-revision"');
    expect(link.headers.get("etag")).toBe('"opaque-link-revision"');
    expect(type.headers.has("etag")).toBe(false);
    expect(collection.headers.has("etag")).toBe(false);
    expect(problem.headers.has("etag")).toBe(false);
  });

  it.each([
    ['rev"quote', '"bdp-b64_cmV2InF1b3Rl"'],
    ["rev\ncontrol", '"bdp-b64_cmV2CmNvbnRyb2w"'],
    ["révision", '"bdp-b64_csOpdmlzaW9u"'],
    ["bdp-b64_literal", '"bdp-b64_YmRwLWI2NF9saXRlcmFs"'],
    ["bdp-u16_literal", '"bdp-b64_YmRwLXUxNl9saXRlcmFs"'],
    ["\ud800", '"bdp-u16_2AA"'],
    ["\udc00", '"bdp-u16_3AA"'],
  ] as const)(
    "projects the unsafe Resource revision %j to a valid injective ETag",
    async (revision, etag) => {
      const handler = createHttpHandler(
        createReadServer({
          scope: SCOPE,
          target: "bdptest",
          admittedProfile: admitReadServerProfile("read", "bdptest"),
          port: {
            perform: async () =>
              scopePortSuccess({
                id: `${SCOPE}beads/a`,
                type: "https://work.example/types/task",
                revision,
                properties: {},
              } as never) as never,
          },
        }),
      );

      const response = await handler(new Request(`${SCOPE}beads/a`));

      expect(response.headers.get("etag")).toBe(etag);
    },
  );

  it("keeps Problem-shaped properties success data as a 200 response", async () => {
    const properties = {
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "cursor-expired",
      retry: "after-state-change",
    };
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: {
          perform: async () => scopePortSuccess(properties as never) as never,
        },
      }),
    );

    const response = await handler(new Request(`${SCOPE}beads/a?view=properties`));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(properties);
  });

  it("does not retain failure provenance when a port later reuses that object as success data", async () => {
    const reused: ReadProblem = {
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "cursor-expired",
      retry: "after-state-change",
      status: 410,
    };
    let requestCount = 0;
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: {
          perform: async () =>
            (++requestCount === 1
              ? scopePortProblem(reused)
              : scopePortSuccess(reused as never)) as never,
        },
      }),
    );

    const failure = await handler(new Request(`${SCOPE}beads/a`));
    const success = await handler(new Request(`${SCOPE}beads/a?view=properties`));

    expect(failure.status).toBe(410);
    expect(success.status).toBe(200);
    expect(success.body).toEqual(reused);
  });

  it("rejects foreign origins and unknown routes with protocol Problems", async () => {
    const port: ScopePort = {
      perform: async () => scopePortSuccess({ items: [], next: null } as never) as never,
    };
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port,
      }),
    );
    const foreign = await handler(new Request("https://other.example/acme/beads/"));
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ code: "resource-not-found" });
    const unknown = await handler(new Request(`${SCOPE}unknown`));
    expect(unknown.status).toBe(404);
    for (const target of [
      `${SCOPE}beads`,
      `${SCOPE}/beads//`,
      `${SCOPE}beads//a`,
      `${SCOPE}beads/a/`,
      `${SCOPE}links/a-b/`,
      `${SCOPE}types/%61`,
      `${SCOPE}types/a%2Fb`,
    ])
      expect((await handler(new Request(target))).status, target).toBe(404);
    const badLimit = await handler(new Request(`${SCOPE}beads/?limit=0`));
    expect(badLimit.status).toBe(400);
    const badDirection = await handler(
      new Request(`${SCOPE}beads/a?view=links&direction=sideways`),
    );
    expect(badDirection.status).toBe(400);
    for (const target of [
      `${SCOPE}beads/a?view=events`,
      `${SCOPE}beads/a?view=properties&view=links`,
      `${SCOPE}beads/a?view=properties&direction=inbound`,
      `${SCOPE}beads/a?include=links`,
      `${SCOPE}beads/a?direction=inbound`,
      `${SCOPE}links/a-b?view=links`,
      `${SCOPE}types/task?view=properties`,
    ])
      expect((await handler(new Request(target))).status, target).toBe(400);
  });

  it("normalizes structural endpoint predicates before Scope-port dispatch", async () => {
    const perform = vi.fn(async () => scopePortSuccess({ items: [], next: null } as never));
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: perform as ScopePort["perform"] },
      }),
    );

    const links = new URL(`${SCOPE}links/`);
    links.searchParams.set("type", "https://work.example/types/blocks");
    links.searchParams.set("conformsTo", "https://work.example/types/dependency");
    links.searchParams.set("source", "beads/a");
    links.searchParams.set("target", `${SCOPE}beads/b`);
    links.searchParams.set("endpoint", `${SCOPE}beads/c`);
    expect((await handler(new Request(links))).status).toBe(200);
    expect(perform).toHaveBeenCalledWith(
      {
        kind: "collection",
        collection: "links",
        type: "https://work.example/types/blocks",
        conformsTo: "https://work.example/types/dependency",
        source: `${SCOPE}beads/a`,
        target: `${SCOPE}beads/b`,
        endpoint: `${SCOPE}beads/c`,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const external = new URL(`${SCOPE}links/`);
    external.searchParams.set("source", "urn:example:opaque");
    external.searchParams.set("endpoint", "https://external.example:443/a");
    expect((await handler(new Request(external))).status).toBe(200);
    expect(perform).toHaveBeenLastCalledWith(
      {
        kind: "collection",
        collection: "links",
        source: "urn:example:opaque",
        endpoint: "https://external.example:443/a",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const rfcOnly = new URL(`${SCOPE}links/`);
    rfcOnly.searchParams.set("source", "https://[v1.fe80::]/");
    rfcOnly.searchParams.set("target", "https://u:p@other.example/beads/demo-a");
    rfcOnly.searchParams.set("endpoint", "https:other.example/beads/demo-a");
    expect((await handler(new Request(rfcOnly))).status).toBe(200);
    expect(perform).toHaveBeenLastCalledWith(
      {
        kind: "collection",
        collection: "links",
        source: "https://[v1.fe80::]/",
        target: "https://u:p@other.example/beads/demo-a",
        endpoint: "https:other.example/beads/demo-a",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    for (const target of [
      `${SCOPE}beads/?type=task`,
      `${SCOPE}beads/?conformsTo=task`,
      `${SCOPE}beads/?source=beads%2Fdemo-a`,
      `${SCOPE}beads/?selector=%24`,
      `${SCOPE}beads/?limit=1`,
      `${SCOPE}beads/?cursor=opaque`,
      `${SCOPE}types/?type=https%3A%2F%2Fwork.example%2Ftypes%2Ftask`,
      `${SCOPE}links/?source=beads%2Fdemo-a&source=beads%2Fdemo-b`,
      `${SCOPE}links/?unknown=value`,
      `${SCOPE}links/?source=beads%2F..%2Fx`,
      `${SCOPE}links/?source=${encodeURIComponent(`${SCOPE}links/demo-a-c`)}`,
      `${SCOPE}links/?source=${encodeURIComponent(`${SCOPE}beads/%41`)}`,
      `${SCOPE}links/?source=${encodeURIComponent("https://u:p@beads.example/acme/beads/demo-a")}`,
      `${SCOPE}links/?source=${encodeURIComponent("https:beads.example/acme/beads/demo-a")}`,
    ]) {
      const invalid = await handler(new Request(target));
      expect(invalid.status, target).toBe(400);
      expect(invalid.body, target).toMatchObject({ code: "invalid-parameter" });
    }
    expect(perform).toHaveBeenCalledTimes(3);
  });

  it("serves Selector and snapshot continuation pages when explicit controls are supplied", async () => {
    const type = "https://work.example/types/task";
    const perform = vi.fn(async () =>
      scopePortSuccess({
        items: [
          {
            id: `${SCOPE}beads/a`,
            type,
            revision: "r1",
            properties: { ready: true },
          },
          {
            id: `${SCOPE}beads/b`,
            type,
            revision: "r2",
            properties: { ready: false },
          },
          {
            id: `${SCOPE}beads/c`,
            type,
            revision: "r3",
            properties: { ready: true },
          },
        ],
        next: null,
      } as never),
    );
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: perform as ScopePort["perform"] },
        readControls: testReadControls(),
      }),
    );
    const initial = new URL(`${SCOPE}beads/`);
    initial.searchParams.set("selector", "$[?@.properties.ready == true]");
    initial.searchParams.set("limit", "1");

    const first = await handler(new Request(initial));
    const firstBody = first.body as { readonly items: readonly unknown[]; readonly next: string };
    const second = await handler(new Request(firstBody.next));

    expect(first.status).toBe(200);
    expect(firstBody.items).toEqual([expect.objectContaining({ id: `${SCOPE}beads/a` })]);
    expect(second).toMatchObject({
      status: 200,
      body: { items: [expect.objectContaining({ id: `${SCOPE}beads/c` })], next: null },
    });
    expect(perform).toHaveBeenCalledOnce();
  });

  it("binds a cursor to the principal derived from each originating HTTP request", async () => {
    const type = "https://work.example/types/task";
    const identityFor = vi.fn(
      (_operation: ReadRequest, options: { readonly httpRequest?: Request }) => ({
        authorizationView: options.httpRequest?.headers.get("authorization") ?? "anonymous",
        scopeEpoch: "test-epoch",
      }),
    );
    const controls = { ...testReadControls(), identityFor };
    const perform = vi.fn(async () =>
      scopePortSuccess({
        items: ["a", "b", "c"].map((local, index) => ({
          id: `${SCOPE}beads/${local}`,
          type,
          revision: `r${index}`,
          properties: {},
        })),
        next: null,
      } as never),
    );
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: perform as ScopePort["perform"] },
        readControls: controls,
      }),
    );
    const first = await handler(
      new Request(`${SCOPE}beads/?limit=1`, {
        headers: { authorization: "Principal A" },
      }),
    );
    const next = (first.body as { readonly next: string }).next;

    const foreign = await handler(new Request(next, { headers: { authorization: "Principal B" } }));
    const replay = await handler(new Request(next, { headers: { authorization: "Principal A" } }));

    expect(foreign).toMatchObject({ status: 409, body: { code: "foreign-view" } });
    expect(foreign.headers.get("cache-control")).toBe("private, no-store");
    expect(replay).toMatchObject({
      status: 200,
      body: { items: [expect.objectContaining({ id: `${SCOPE}beads/b` })] },
    });
    expect(perform).toHaveBeenCalledOnce();
    expect(
      identityFor.mock.calls.map(([, options]) =>
        options.httpRequest?.headers.get("authorization"),
      ),
    ).toEqual(["Principal A", "Principal B", "Principal A"]);
  });

  it("maps Selector failures and expired cursors through the supplied Problem policy", async () => {
    let now = 1_000;
    const perform = vi.fn(async () =>
      scopePortSuccess({
        items: ["a", "b"].map((local) => ({
          id: `${SCOPE}beads/${local}`,
          type: "https://work.example/types/task",
          revision: `r-${local}`,
          properties: {},
        })),
        next: null,
      } as never),
    );
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: perform as ScopePort["perform"] },
        readControls: testReadControls({ cursorTtlMs: 10, clock: () => now }),
      }),
    );

    const malformed = await handler(
      new Request(`${SCOPE}beads/?selector=${encodeURIComponent("$[?]")}`),
    );
    const excessiveLimit = await handler(new Request(`${SCOPE}beads/?limit=11`));
    const first = await handler(new Request(`${SCOPE}beads/?limit=1`));
    now += 10;
    const expired = await handler(new Request((first.body as { readonly next: string }).next));

    expect(malformed).toMatchObject({ status: 400, body: { code: "invalid-parameter" } });
    expect(excessiveLimit).toMatchObject({
      status: 400,
      body: { code: "invalid-parameter" },
    });
    expect(expired).toMatchObject({ status: 410, body: { code: "cursor-expired" } });
    expect(expired.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects a cross-projection cursor forgery without consuming replay", async () => {
    const perform = vi.fn(async () =>
      scopePortSuccess({
        items: ["a", "b"].map((local) => ({
          id: `${SCOPE}beads/${local}`,
          type: "https://work.example/types/task",
          revision: `r-${local}`,
          properties: {},
        })),
        next: null,
      } as never),
    );
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: perform as ScopePort["perform"] },
        readControls: testReadControls(),
      }),
    );
    const first = await handler(new Request(`${SCOPE}beads/?limit=1`));
    const next = (first.body as { readonly next: string }).next;
    const forgedUrl = new URL(next);
    forgedUrl.pathname = `${new URL(SCOPE).pathname}links/`;

    const forged = await handler(new Request(forgedUrl));
    const replay = await handler(new Request(next));

    expect(forged).toMatchObject({ status: 400, body: { code: "invalid-parameter" } });
    expect(replay).toMatchObject({
      status: 200,
      body: { items: [expect.objectContaining({ id: `${SCOPE}beads/b` })], next: null },
    });
    expect(perform).toHaveBeenCalledOnce();
  });

  it("marks Scope data and every Problem private/no-store without marking 204 or 405 responses", async () => {
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: {
          perform: async () => scopePortSuccess({ items: [], next: null } as never) as never,
        },
      }),
    );

    const collection = await handler(new Request(`${SCOPE}beads/`));
    const problem = await handler(new Request(`${SCOPE}unknown`));
    const invalidParameter = await handler(new Request(`${SCOPE}beads/?limit=0`));
    const discovery = await handler(new Request(`${SCOPE}bdp.json`));
    const scope = await handler(new Request(SCOPE));
    const method = await handler(new Request(SCOPE, { method: "OPTIONS" }));

    expect(collection.headers.get("cache-control")).toBe("private, no-store");
    expect(problem.status).toBe(404);
    expect(problem.headers.get("cache-control")).toBe("private, no-store");
    expect(invalidParameter.status).toBe(400);
    expect(invalidParameter.headers.get("cache-control")).toBe("private, no-store");
    expect(discovery.headers.has("cache-control")).toBe(false);
    expect(scope.headers.has("cache-control")).toBe(false);
    expect(method.headers.has("cache-control")).toBe(false);
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
  ] as const)("marks an identity-policy %s Problem private/no-store", async (code, status) => {
    const perform = vi.fn(async () => scopePortSuccess({ items: [], next: null } as never));
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: perform as ScopePort["perform"] },
        readControls: {
          ...testReadControls(),
          identityFor: () => readProblem(code),
          ...(code === "unauthenticated" ? { unauthenticatedChallenge: 'Bearer realm="bdp"' } : {}),
        },
      }),
    );

    const response = await handler(new Request(`${SCOPE}beads/?limit=1`));

    expect(response).toMatchObject({ status, body: { code } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    if (code === "unauthenticated")
      expect(response.headers.get("www-authenticate")).toBe('Bearer realm="bdp"');
    else expect(response.headers.has("www-authenticate")).toBe(false);
    expect(perform).not.toHaveBeenCalled();
  });

  it("fails closed instead of emitting an unchallenged 401", async () => {
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: vi.fn() as ScopePort["perform"] },
        readControls: {
          ...testReadControls(),
          identityFor: () => readProblem("unauthenticated"),
        },
      }),
    );

    await expect(handler(new Request(`${SCOPE}beads/`))).rejects.toThrow(
      /authentication challenge/,
    );
  });

  it("derives a direct Problem HTTP status without materializing its optional status member", async () => {
    const problem: ReadProblem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
    };
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: async () => scopePortProblem(problem) as never },
      }),
    );

    const response = await handler(new Request(`${SCOPE}beads/missing`));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.body).toEqual(problem);
    expect(response.body).not.toHaveProperty("status");
  });

  it("rejects a direct Problem whose optional status contradicts its code", async () => {
    const problem: ReadProblem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
      status: 400,
    };
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: async () => scopePortProblem(problem) as never },
      }),
    );

    await expect(handler(new Request(`${SCOPE}beads/missing`))).rejects.toThrow(
      "ScopePort Problem/status must be equal to constant",
    );
  });

  it.each([
    {
      field: "type",
      problem: {
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "resource-not-found",
        retry: "after-state-change",
      } satisfies ReadProblem,
    },
    {
      field: "retry",
      problem: {
        type: "https://github.com/gastownhall/bdp/problems/not-found",
        code: "resource-not-found",
        retry: "never",
      } satisfies ReadProblem,
    },
  ])("rejects a direct Problem whose $field contradicts its code", async ({ field, problem }) => {
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: async () => scopePortProblem(problem) as never },
      }),
    );

    await expect(handler(new Request(`${SCOPE}beads/missing`))).rejects.toThrow(
      `ScopePort Problem/${field} must be equal to constant`,
    );
  });

  it("marks an authorization-dependent cursor-expired Problem private/no-store", async () => {
    const problem: ReadProblem = {
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "cursor-expired",
      retry: "after-state-change",
    };
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform: async () => scopePortProblem(problem) as never },
      }),
    );

    const response = await handler(new Request(`${SCOPE}beads/`));

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.body).toEqual(problem);
  });

  it("maps lifecycle closure to a protocol 503 response", async () => {
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: {
        perform: async () => scopePortSuccess({ items: [], next: null } as never) as never,
      },
    });
    const handler = createHttpHandler(server);
    await server.close();

    const response = await handler(new Request(`${SCOPE}bdp.json`));
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "temporarily-unavailable",
      detail: "the BDP server is closed",
    });
    const probe = await handler(new Request(SCOPE));
    expect(probe.status).toBe(503);
  });

  it("surfaces client cancellation locally and waits for port cleanup before close", async () => {
    let finishCleanup: (() => void) | undefined;
    const cleanup = new Promise<never>((resolve) => {
      finishCleanup = () => resolve(scopePortSuccess({ items: [], next: null } as never) as never);
    });
    let operationSignal: AbortSignal | undefined;
    const perform = vi.fn(((_operation, options) => {
      operationSignal = options.signal;
      return cleanup;
    }) as ScopePort["perform"]);
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: { perform },
    });
    const handler = createHttpHandler(server);
    const controller = new AbortController();
    const pending = handler(new Request(`${SCOPE}beads/`, { signal: controller.signal }));
    await vi.waitFor(() => expect(perform).toHaveBeenCalledOnce());
    controller.abort("client disconnected");

    await expect(pending).rejects.toMatchObject({ code: "operation-aborted" });
    expect(operationSignal?.aborted).toBe(true);
    let closeFinished = false;
    const close = server.close().then(() => {
      closeFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closeFinished).toBe(false);

    finishCleanup?.();
    await expect(close).resolves.toBeUndefined();
  });

  it("does not mislabel unexpected adapter failures as retryable protocol failures", async () => {
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: {
        perform: async () => {
          throw new Error("private adapter details");
        },
      },
    });
    await expect(createHttpHandler(server)(new Request(`${SCOPE}beads/`))).rejects.toThrow(
      "private adapter details",
    );
  });

  it("allows only GET and HEAD at the protocol boundary", async () => {
    const perform = vi.fn(
      async () => scopePortSuccess({ items: [], next: null } as never) as never,
    );
    const handler = createHttpHandler(
      createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: { perform },
      }),
    );

    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await handler(new Request(`${SCOPE}beads/`, { method }));
      expect(response.status).toBe(405);
      expect(response.body).toBeUndefined();
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("content-length")).toBe("0");
    }
    expect(perform).not.toHaveBeenCalled();
    expect((await handler(new Request(`${SCOPE}beads/`))).status).toBe(200);
  });
});

function testReadControls(
  paginationOverrides: Partial<Parameters<typeof createReadPagination>[0]> = {},
): ServerReadControls {
  let token = 0;
  return {
    selectorLimits: { bytes: 1_000, depth: 20, nodes: 100 },
    pagination: createReadPagination({
      scope: SCOPE,
      defaultPageItems: 2,
      maxPageItems: 10,
      cursorTtlMs: 60_000,
      retainedStateCapacity: 100,
      maxRetainedCursorPositionsPerSnapshot: 99,
      retainedSnapshotByteCapacity: 100_000,
      retainedSnapshotNodeCapacity: 10_000,
      maxOpaqueTokenLength: 40,
      tokenGenerationAttempts: 3,
      clock: () => 1_000,
      generateOpaqueToken: () => `http_${++token}`,
      ...paginationOverrides,
    }),
    identityFor: () => ({ authorizationView: "test-view", scopeEpoch: "test-epoch" }),
    problemFor: (error) =>
      readProblem(
        error.code === "foreign-view"
          ? "foreign-view"
          : error.code === "cursor-expired"
            ? "cursor-expired"
            : "invalid-parameter",
      ),
  };
}
