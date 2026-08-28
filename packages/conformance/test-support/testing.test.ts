import { describe, expect, it } from "vitest";

import type { SchemaValidator } from "../src/schema-validator.js";
import {
  type ControlledReadActionSession,
  createControlledReadActionExecutor,
  startControlledTypeDescriptorPublisher,
} from "./testing.js";

const scope = "https://scope.example/acme/";
const schemaValidator: SchemaValidator = { resolve() {}, validate: () => [] };
const fallback = async (): Promise<never> => {
  throw new Error("unexpected fallback action");
};

describe("controlled Read conformance actions", () => {
  it("publishes only known credential-free descriptors at their semantic URL", async () => {
    const descriptor = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
      conformsTo: [],
    };
    const publisher = await startControlledTypeDescriptorPublisher([descriptor]);
    try {
      const found = await publisher.fetch(descriptor.id);
      expect(found.status).toBe(200);
      expect(found.url).toBe(descriptor.id);
      await expect(found.json()).resolves.toEqual(descriptor);

      await expect(
        publisher.fetch(descriptor.id, { headers: { authorization: "Bearer secret" } }),
      ).resolves.toMatchObject({ status: 400 });
      await expect(publisher.fetch("https://work.example/types/unknown")).resolves.toMatchObject({
        status: 404,
      });
      await expect(publisher.fetch(descriptor.id, { method: "POST" })).resolves.toMatchObject({
        status: 404,
      });
    } finally {
      await publisher.close();
    }
  });

  it("preserves manual redirect observation on the routed descriptor Fetch", async () => {
    const descriptor = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
      conformsTo: [],
    };
    const publisher = await startControlledTypeDescriptorPublisher([descriptor]);
    try {
      const response = await publisher.fetch("https://work.example/types/redirect");
      expect(response.status).toBe(302);
      expect(response.redirected).toBe(false);
      expect(response.headers.get("location")).toBe("/types/task");
      expect(response.url).toBe("https://work.example/types/redirect");
      await expect(
        publisher.fetch("https://work.example/types/redirect", { redirect: "follow" }),
      ).resolves.toMatchObject({ status: 302, redirected: false });
    } finally {
      await publisher.close();
    }
  });

  it("rejects a non-JSON Problem response instead of manufacturing lifecycle evidence", async () => {
    const executor = createControlledReadActionExecutor(
      async () =>
        new Response("not json", {
          status: 400,
          headers: { "content-type": "text/html" },
        }),
      fallback,
      () => undefined,
      schemaValidator,
    );

    await expect(
      executor({
        family: "lifecycle",
        operation: "problem-table-serialization",
        scope,
        bindings: {},
        input: { codes: ["resource-not-found"] },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("HTTP 400 response was not JSON");
  });

  it.each([
    ["identical", false, true, 1],
    ["semantically equal but byte-distinct", true, false, 2],
  ] as const)(
    "observes nondisclosure bodies that are %s",
    async (_label, varyOneBody, byteIdentical, distinctDigests) => {
      const hidden = new URL("beads/demo-b", scope).href;
      const deleted = new URL("beads/demo-f", scope).href;
      const unknown = new URL("beads/never-existed", scope).href;
      let transitioned = false;
      const problem = {
        type: "https://github.com/gastownhall/bdp/problems/not-found",
        code: "resource-not-found",
        retry: "after-state-change",
      };
      const fetchImplementation: typeof fetch = async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/beads/"))
          return jsonResponseAt(url, { items: [], next: null });
        if (!transitioned && (url === hidden || url === deleted))
          return jsonResponseAt(url, { id: url });
        const vary = varyOneBody && url === `${unknown}?view=properties`;
        return rawProblemResponseAt(url, `${JSON.stringify(problem)}${vary ? " " : ""}`);
      };
      const session: ControlledReadActionSession = {
        advanceClock() {},
        materializeAdvertisedLimitFixture() {},
        mutateSource() {},
        excludeResourceFromAuthorizationView() {},
        deleteResource() {
          transitioned = true;
        },
        restoreScope: async () => {
          throw new Error("unexpected restore");
        },
        adapterReads: () => 0,
        adapterReadsByProjection: () => ({ collection: 0, incidentLinks: 0 }),
        forbidAdapterReads: () => () => undefined,
      };
      const executor = createControlledReadActionExecutor(
        fetchImplementation,
        fallback,
        () => session,
        schemaValidator,
      );

      const observed = await executor({
        family: "lifecycle",
        operation: "nondisclosure-identities",
        scope,
        bindings: {},
        input: {
          hiddenId: "beads/demo-b",
          deletedId: "beads/demo-f",
          unknownId: "beads/never-existed",
          view: "view",
          epoch: "epoch",
        },
        signal: new AbortController().signal,
      });

      expect(observed).toMatchObject({
        hiddenLiveBefore: true,
        deletedLiveBefore: true,
        hiddenAbsentFromCollection: true,
        deletedAbsentFromCollection: true,
        hidden: { probeCount: 3 },
        deleted: { probeCount: 3 },
        unknown: { probeCount: 3 },
        rawBodyEvidence: {
          probeCount: 9,
          byteIdentical,
          digestAlgorithm: "sha-256",
          distinctDigests,
          representativeByteLength: JSON.stringify(problem).length,
          representativeDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
    },
  );

  it.each([
    ["page tuples", { replayRevision: "2", replayNext: `${scope}beads/?cursor=tail` }],
    ["continuation shape", { replayRevision: "1", replayNext: null }],
  ] as const)("rejects a pre-expiry replay with changed %s", async (_label, replay) => {
    const continuation = `${scope}beads/?cursor=stable`;
    const beforeExpiryNext = `${scope}beads/?cursor=tail`;
    let continuationRequests = 0;
    const fetchImplementation: typeof fetch = async (input) => {
      const url = String(input);
      if (url === `${scope}beads/`)
        return jsonResponseAt(url, {
          items: [resource("a", "1")],
          next: continuation,
        });
      if (url === `${scope}beads/?limit=200`)
        return jsonResponseAt(url, { items: [resource("a", "1")], next: continuation });
      if (url === continuation) {
        continuationRequests += 1;
        if (continuationRequests === 1)
          return jsonResponseAt(url, {
            items: [resource("b", "1")],
            next: beforeExpiryNext,
          });
        if (continuationRequests === 2)
          return jsonResponseAt(url, {
            items: [resource("b", replay.replayRevision)],
            next: replay.replayNext,
          });
        return problemResponseAt(url, 410, "cursor-expired", "after-state-change");
      }
      return problemResponseAt(url, 413, "limit-exceeded", "never");
    };
    const advances: number[] = [];
    const session: ControlledReadActionSession = {
      advanceClock(milliseconds) {
        advances.push(milliseconds);
      },
      materializeAdvertisedLimitFixture() {},
      mutateSource() {},
      excludeResourceFromAuthorizationView() {},
      deleteResource() {},
      restoreScope: async () => {
        throw new Error("unexpected restore");
      },
      adapterReads: () => 0,
      adapterReadsByProjection: () => ({ collection: 0, incidentLinks: 0 }),
      forbidAdapterReads: () => () => undefined,
    };
    const executor = createControlledReadActionExecutor(
      fetchImplementation,
      fallback,
      () => session,
      schemaValidator,
    );

    await expect(
      executor({
        family: "lifecycle",
        operation: "advertised-limit-boundaries",
        scope,
        bindings: {},
        input: {
          pageDefault: 50,
          pageMaximum: 200,
          selectorBytes: 16_384,
          selectorDepth: 32,
          selectorNodes: 256,
          cursorTtlMilliseconds: 300_000,
          view: "limits-view",
          epoch: "limits-epoch",
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ replayBeforeExpiry: false, publicRequests: 9 });
    expect(continuationRequests).toBe(3);
    expect(advances).toEqual([299_999, 1]);
  });

  it("surfaces a failed restored-Resource probe instead of defaulting it to success", async () => {
    const stable = new URL("beads/demo-a", scope).href;
    const deleted = new URL("beads/demo-f", scope).href;
    const initialFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${scope}beads/?limit=1`)
        return jsonResponseAt(url, {
          items: [resource("demo-a", "1")],
          next: `${scope}beads/?limit=1&cursor=pre-restore`,
        });
      return jsonResponse({ id: url });
    };
    const restoredFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === new URL("bdp.json", scope).href) return jsonResponse({ scope });
      if (url === stable) return jsonResponse({ id: stable });
      if (url === deleted) throw new Error("restored Resource probe failed");
      throw new Error(`unexpected restored URL ${url}`);
    };
    const session: ControlledReadActionSession = {
      advanceClock() {},
      materializeAdvertisedLimitFixture() {},
      mutateSource() {},
      excludeResourceFromAuthorizationView() {},
      deleteResource() {},
      restoreScope: async () => ({
        scope,
        scopeEpoch: "restored-epoch",
        fetch: restoredFetch,
        close: async () => undefined,
      }),
      adapterReads: () => 0,
      adapterReadsByProjection: () => ({ collection: 0, incidentLinks: 0 }),
      forbidAdapterReads: () => () => undefined,
    };
    const executor = createControlledReadActionExecutor(
      initialFetch,
      fallback,
      () => session,
      schemaValidator,
    );

    await expect(
      executor({
        family: "lifecycle",
        operation: "scope-restore-identity",
        scope,
        bindings: {},
        input: {
          stableId: "beads/demo-a",
          deletedId: "beads/demo-f",
          view: "view",
          epoch: "epoch",
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("restored Resource probe failed");
  });
});

function jsonResponse(body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonResponseAt(url: string, body: Readonly<Record<string, unknown>>): Response {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function problemResponseAt(url: string, status: number, code: string, retry: string): Response {
  const response = new Response(
    JSON.stringify({ type: `https://github.com/gastownhall/bdp/problems/${code}`, code, retry }),
    {
      status,
      headers: {
        "content-type": "application/problem+json",
        "cache-control": "private, no-store",
      },
    },
  );
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function rawProblemResponseAt(url: string, body: string): Response {
  const response = new Response(body, {
    status: 404,
    headers: {
      "content-type": "application/problem+json",
      "cache-control": "private, no-store",
    },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function resource(id: string, revision: string): Readonly<Record<string, unknown>> {
  return { id: `${scope}beads/${id}`, revision };
}
