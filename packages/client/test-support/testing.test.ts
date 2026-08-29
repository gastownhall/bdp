import { describe, expect, it } from "vitest";

import { createBdpClientScenarioActionExecutor } from "./testing.js";

const scope = "https://scope.example/acme/";

describe("BdpClient programmable conformance actions", () => {
  const execute = createBdpClientScenarioActionExecutor();

  it.each(["version", "profile"] as const)(
    "rejects unsupported discovery %s before Read dispatch",
    async (variant) => {
      await expect(
        execute({
          family: "client",
          operation: "unsupported-discovery",
          scope,
          input: { variant },
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({
        outcome: "problem",
        code: "temporarily-unavailable",
        discoveryProbes: 1,
        discoveryDocumentRequests: 1,
        readRequests: 0,
      });
    },
  );

  it("reads a generic Resource without resolving its external Type", async () => {
    await expect(
      execute({
        family: "client",
        operation: "resource-without-type-resolution",
        scope,
        input: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      outcome: "success",
      code: null,
      discoveryProbes: 1,
      discoveryDocumentRequests: 1,
      resourceRequests: 1,
      descriptorRequests: 0,
      otherRequests: 0,
    });
  });

  it("normalizes malformed successful JSON through the public Fetch client", async () => {
    await expect(
      execute({
        family: "client",
        operation: "malformed-success-response",
        scope,
        input: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      outcome: "problem",
      code: "temporarily-unavailable",
      scopeRequests: 1,
      discoveryDocumentRequests: 1,
      readRequests: 1,
      otherRequests: 0,
    });
  });

  it("recovers on the same public client after an interrupted response body", async () => {
    const liveExecute = createBdpClientScenarioActionExecutor({
      fetchImplementation: fixtureFetch(),
    });
    await expect(
      liveExecute({
        family: "client",
        operation: "disconnect-recovery",
        scope,
        input: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      disconnectInjected: true,
      firstOutcome: "problem",
      firstCode: "temporarily-unavailable",
      secondOutcome: "success",
      secondCode: null,
      readRequests: 2,
    });
  });

  it("projects fixture-owned logical roles from public Resource pages without IDs", async () => {
    const liveExecute = createBdpClientScenarioActionExecutor({
      fetchImplementation: fixtureFetch(),
    });
    await expect(
      liveExecute({
        family: "client",
        operation: "public-logical-projection",
        scope,
        input: {
          relationshipRoles: [
            { type: "https://work.example/types/blocks", role: "blocks" },
            { type: "https://work.example/types/relates", role: "relates" },
          ],
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      outcome: "success",
      code: null,
      complete: true,
      projection: {
        beadStatuses: [
          ["A", "open", 2],
          ["B", "closed", 1],
        ],
        relationships: [["A", "B", "blocks"]],
      },
    });
  });

  it("makes a public Link-Type mutation observable in the logical projection", async () => {
    const liveExecute = createBdpClientScenarioActionExecutor({
      fetchImplementation: fixtureFetch("https://work.example/types/relates"),
    });
    const result = await liveExecute({
      family: "client",
      operation: "public-logical-projection",
      scope,
      input: {
        relationshipRoles: [
          { type: "https://work.example/types/blocks", role: "blocks" },
          { type: "https://work.example/types/relates", role: "relates" },
        ],
      },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      projection: { relationships: [["A", "B", "relates"]] },
    });
    expect(result).not.toMatchObject({
      projection: { relationships: [["A", "B", "blocks"]] },
    });
  });

  it("keeps external-endpoint Links out of the local logical projection", async () => {
    const liveExecute = createBdpClientScenarioActionExecutor({
      fetchImplementation: fixtureFetch("https://work.example/types/blocks", true),
    });

    await expect(
      liveExecute({
        family: "client",
        operation: "public-logical-projection",
        scope,
        input: {
          relationshipRoles: [{ type: "https://work.example/types/blocks", role: "blocks" }],
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      projection: { relationships: [["A", "B", "blocks"]] },
    });
  });

  it("retrieves only the pinned task and blocks descriptors through an isolated publisher Fetch", async () => {
    const publisherRequests: string[] = [];
    const liveExecute = createBdpClientScenarioActionExecutor({
      fetchImplementation: fixtureFetch(),
      externalTypeDescriptorFetchImplementation: async (input) => {
        const url = String(input);
        publisherRequests.push(url);
        if (url === "https://work.example/types/task")
          return jsonAt(url, {
            id: url,
            name: "Task",
            describes: "bead",
            conformsTo: ["https://work.example/types/work-item"],
          });
        if (url === "https://work.example/types/blocks")
          return jsonAt(url, {
            id: url,
            name: "Blocks",
            describes: "link",
            conformsTo: ["https://work.example/types/dependency"],
            source: { conformsTo: [] },
            target: { conformsTo: [] },
          });
        throw new Error(`unexpected publisher URL ${url}`);
      },
    });

    await expect(
      liveExecute({
        family: "client",
        operation: "external-type-descriptors",
        scope,
        input: {
          ids: ["https://work.example/types/task", "https://work.example/types/blocks"],
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      outcome: "success",
      rows: [
        { id: "https://work.example/types/task", describes: "bead" },
        { id: "https://work.example/types/blocks", describes: "link" },
      ],
    });
    expect(publisherRequests).toEqual([
      "https://work.example/types/task",
      "https://work.example/types/blocks",
    ]);
  });

  it("rejects a descriptor authority supplied by action input", async () => {
    let publisherRequests = 0;
    const liveExecute = createBdpClientScenarioActionExecutor({
      fetchImplementation: fixtureFetch(),
      externalTypeDescriptorFetchImplementation: async () => {
        publisherRequests += 1;
        throw new Error("must not fetch");
      },
    });

    await expect(
      liveExecute({
        family: "client",
        operation: "external-type-descriptors",
        scope,
        input: { ids: ["https://attacker.example/types/task"] },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("controlled work.example Type IDs");
    expect(publisherRequests).toBe(0);
  });

  it("surfaces opaque external Link endpoints in both supported orientations", async () => {
    const liveExecute = createBdpClientScenarioActionExecutor({
      fetchImplementation: externalEndpointFetch(),
    });
    await expect(
      liveExecute({
        family: "client",
        operation: "external-link-endpoints",
        scope,
        input: { linkIds: ["links/outbound", "links/inbound"] },
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      outcome: "success",
      rows: [
        ["links/outbound", "types/related", ["beads/a"], ["external:beads:mol-run-assignee"]],
        [
          "links/inbound",
          "https://work.example/types/blocks",
          ["external:beads:mol-run-assignee"],
          ["beads/a"],
        ],
      ],
      externalEndpoints: 2,
      localSource: 1,
      localTarget: 1,
      allHaveLocalEndpoint: true,
    });
  });

  it("fails closed for unregistered operations and malformed inputs", async () => {
    await expect(
      execute({
        family: "client",
        operation: "unknown",
        scope,
        input: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("unsupported client scenario operation");
    await expect(
      execute({
        family: "client",
        operation: "unsupported-discovery",
        scope,
        input: { variant: "other" },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("action input was invalid");
  });
});

function fixtureFetch(
  linkType = "https://work.example/types/blocks",
  includeExternalEndpoint = false,
): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === scope)
      return responseAt(url, null, {
        status: 204,
        headers: { link: '<bdp.json>; rel="service-desc"' },
      });
    if (url === `${scope}bdp.json`)
      return jsonAt(url, {
        bdpVersion: "0",
        profile: "read",
        scope,
        beads: `${scope}beads/`,
        links: `${scope}links/`,
        types: `${scope}types/`,
      });
    if (url === `${scope}beads/`)
      return jsonAt(url, {
        items: [
          {
            id: `${scope}beads/a`,
            type: "https://work.example/types/task",
            revision: "1",
            properties: { title: "A", status: "open", priority: 2 },
          },
          {
            id: `${scope}beads/b`,
            type: "https://work.example/types/task",
            revision: "1",
            properties: { title: "B", status: "closed", priority: 1 },
          },
        ],
        next: null,
      });
    if (url === `${scope}links/`)
      return jsonAt(url, {
        items: [
          {
            id: `${scope}links/a-b`,
            type: linkType,
            revision: "1",
            source: `${scope}beads/a`,
            target: `${scope}beads/b`,
            properties: {},
          },
          ...(includeExternalEndpoint
            ? [
                {
                  id: `${scope}links/a-external`,
                  type: linkType,
                  revision: "1",
                  source: `${scope}beads/a`,
                  target: "external:beads:remote",
                  properties: {},
                },
              ]
            : []),
        ],
        next: null,
      });
    return responseAt(url, null, { status: 404 });
  };
}

function externalEndpointFetch(): typeof fetch {
  const base = fixtureFetch();
  return async (input, init) => {
    const url = String(input);
    const external = "external:beads:mol-run-assignee";
    const local = `${scope}beads/a`;
    const remote = external;
    if (url === `${scope}links/outbound` || url === `${scope}links/inbound`)
      return jsonAt(url, {
        id: url,
        type: url.endsWith("outbound")
          ? `${scope}types/related`
          : "https://work.example/types/blocks",
        revision: "1",
        source: url.endsWith("outbound") ? local : remote,
        target: url.endsWith("outbound") ? remote : local,
        properties: {},
      });
    return base(input, init);
  };
}

function jsonAt(url: string, body: unknown): Response {
  return responseAt(url, JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function responseAt(
  url: string,
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit,
): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}
