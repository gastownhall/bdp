import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isReadProblem, REFERENCE_TYPE_DESCRIPTORS, type ReadRequest } from "@bdp/protocol";
import { describe, expect, it } from "vitest";

import {
  BdpClient,
  BdpClientCapabilityError,
  BdpClientClosedError,
  BdpClientOperationAbortedError,
  BdpClientRequestError,
  BdpClientTransportError,
  type BdpTransport,
  type BdpTransportResult,
  createFetchTransport,
  isBdpClientProblem,
} from "./index.js";

const SCOPE = "https://beads.example/acme/";
const BEADS = `${SCOPE}beads/`;
const LINKS = `${SCOPE}links/`;
const TASK_TYPE = "https://work.example/types/task";
const LINK_TYPE = "https://work.example/types/blocks";
const OUTSIDE_SCOPE_PROBLEM = {
  type: "https://github.com/gastownhall/bdp/problems/authorization",
  code: "forbidden",
  retry: "after-state-change",
  status: 403,
  detail: "the requested URL is outside the configured Scope",
} as const;
const UNSUPPORTED_DISCOVERY_PROBLEM = {
  type: "https://github.com/gastownhall/bdp/problems/unavailable",
  code: "temporarily-unavailable",
  retry: "after-delay",
  status: 503,
  detail: "the Scope returned invalid or unsupported discovery metadata",
} as const;
const UNSUPPORTED_VERSION_DISCOVERY = {
  bdpVersion: "1",
  profile: "read",
  scope: SCOPE,
  beads: BEADS,
  links: `${SCOPE}links/`,
  types: `${SCOPE}types/`,
} as const;
const UNSUPPORTED_PROFILE_DISCOVERY = {
  bdpVersion: "0",
  profile: "future",
  scope: SCOPE,
  beads: BEADS,
  links: `${SCOPE}links/`,
  types: `${SCOPE}types/`,
} as const;

const unsupportedDiscoveries: readonly (readonly [string, unknown])[] = [
  ["version", UNSUPPORTED_VERSION_DISCOVERY],
  ["profile", UNSUPPORTED_PROFILE_DISCOVERY],
];

const unsupportedRequests: readonly (readonly [string, ReadRequest])[] = [
  ["resource", { kind: "resource", resource: "bead", id: `${BEADS}a` }],
  ["properties view", { kind: "properties", resource: "bead", id: `${BEADS}a` }],
  ["incident links", { kind: "bead-links", bead: `${BEADS}a` }],
];

function validBead(id = `${BEADS}a`): Record<string, unknown> {
  return { id, type: TASK_TYPE, revision: "1", properties: {} };
}

function validLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `${LINKS}blocks-a-b`,
    type: LINK_TYPE,
    revision: "1",
    source: `${BEADS}a`,
    target: `${BEADS}b`,
    properties: {},
    ...overrides,
  };
}

function validTypeDescriptor(id = `${SCOPE}types/task`): Record<string, unknown> {
  return { id, name: "Task", describes: "bead", conformsTo: [] };
}

describe("BdpClient", () => {
  it("omits ambient credentials from every in-Scope Fetch request", async () => {
    const requests: Array<{
      readonly url: string;
      readonly init: RequestInit | undefined;
    }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === SCOPE)
        return responseAt(url, null, {
          status: 204,
          headers: { link: `<${SCOPE}bdp.json>; rel="service-desc"` },
        });
      if (url === `${SCOPE}bdp.json`)
        return responseAt(url, JSON.stringify(validDiscovery()), {
          headers: { "content-type": "application/json" },
        });
      if (url === BEADS)
        return responseAt(url, JSON.stringify({ items: [], next: null }), {
          headers: { "content-type": "application/json" },
        });
      throw new Error(`unexpected URL ${url}`);
    };
    const client = new BdpClient({
      scope: SCOPE,
      transport: createFetchTransport(fetchImplementation),
    });

    await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual({
      items: [],
      next: null,
    });
    expect(requests.map(({ url }) => url)).toEqual([SCOPE, `${SCOPE}bdp.json`, BEADS]);
    expect(requests.every(({ init }) => init?.credentials === "omit")).toBe(true);
  });

  it.each([
    "not a URL",
    "ftp://beads.example/acme/",
    "https://beads.example/acme",
    "https://user:secret@beads.example/acme/",
    "https://beads.example/acme/?query=1",
    "https://beads.example/acme/#fragment",
    "https://beads.example/acme//",
    "https://beads.example/%61cme/",
  ])("rejects noncanonical configured Scope %s", (scope) => {
    expect(() => new BdpClient({ scope, transport: new RecordingTransport({}) })).toThrow(
      "scope must be a canonical HTTP(S) URL ending in /",
    );
  });

  it.each([0, -1, 1.5, Number.NaN, 2_147_483_648])(
    "rejects invalid custom-transport settlement timeout %s",
    (transportSettlementTimeoutMs) => {
      expect(
        () =>
          new BdpClient({
            scope: SCOPE,
            transport: new RecordingTransport({}),
            transportSettlementTimeoutMs,
          }),
      ).toThrow("transportSettlementTimeoutMs must be an integer");
    },
  );

  it("admits only exact external Type IDs, not another path on the same authority", async () => {
    const transport = new RecordingTransport({});
    let externalRequests = 0;
    const client = new BdpClient({
      scope: SCOPE,
      transport,
      externalTypeDescriptors: {
        typeIds: [TASK_TYPE],
        fetchImplementation: async () => {
          externalRequests += 1;
          throw new Error("must not fetch a non-allowlisted Type ID");
        },
      },
    });

    await expect(
      client.perform({
        kind: "resource",
        resource: "type",
        id: "https://work.example/internal/metadata",
      }),
    ).rejects.toBeInstanceOf(BdpClientCapabilityError);
    expect(externalRequests).toBe(0);
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
  });

  it("does not follow redirects from an allowlisted external Type ID", async () => {
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport({}),
      externalTypeDescriptors: {
        typeIds: [TASK_TYPE],
        fetchImplementation: async (input) =>
          responseAt(String(input), "redirect body", {
            status: 302,
            headers: { location: LINK_TYPE },
          }),
      },
    });

    await expect(
      client.perform({ kind: "resource", resource: "type", id: TASK_TYPE }),
    ).resolves.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("rejects an external Type response observed at a different URL", async () => {
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport({}),
      externalTypeDescriptors: {
        typeIds: [TASK_TYPE],
        fetchImplementation: async () =>
          responseAt(LINK_TYPE, JSON.stringify(validTypeDescriptor(TASK_TYPE)), {
            headers: { "content-type": "application/json" },
          }),
      },
    });

    await expect(
      client.perform({ kind: "resource", resource: "type", id: TASK_TYPE }),
    ).resolves.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("applies configured response bounds to the isolated external Fetch", async () => {
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport({}),
      externalTypeDescriptors: {
        typeIds: [TASK_TYPE],
        fetchImplementation: async (input) =>
          responseAt(String(input), JSON.stringify(validTypeDescriptor(TASK_TYPE))),
        fetchOptions: { maximumResponseBodyBytes: 1 },
      },
    });

    await expect(
      client.perform({ kind: "resource", resource: "type", id: TASK_TYPE }),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      status: 503,
      detail: "the server response exceeded 1 bytes",
    });
  });

  it.each([
    "https://user:secret@work.example/types/task",
    "http://work.example/types/task",
    "https://localhost/types/task",
    "https://metadata.internal/types/task",
    "https://127.0.0.1/types/task",
    "https://169.254.10.20/types/task",
    "https://192.168.1.20/types/task",
    "https://[::1]/types/task",
    "https://[fe80::1]/types/task",
    "https://[fc00::1]/types/task",
    "https://[::ffff:7f00:1]/types/task",
  ])("rejects unsafe external Type Descriptor policy target %s", (typeId) => {
    expect(
      () =>
        new BdpClient({
          scope: SCOPE,
          transport: new RecordingTransport({}),
          externalTypeDescriptors: {
            typeIds: [typeId],
            fetchImplementation: fetch,
          },
        }),
    ).toThrow(TypeError);
  });

  it("requires explicit test-only opt-ins for private HTTP Type publishers", () => {
    expect(
      () =>
        new BdpClient({
          scope: SCOPE,
          transport: new RecordingTransport({}),
          externalTypeDescriptors: {
            typeIds: ["http://127.0.0.1/types/task"],
            fetchImplementation: fetch,
            allowInsecureHttpForTesting: true,
            allowPrivateNetworkForTesting: true,
          },
        }),
    ).not.toThrow();
  });

  it("does not extend an external Type Descriptor authority grant to a subdomain", async () => {
    const urls: string[] = [];
    const fetchImplementation: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === SCOPE)
        return responseAt(url, null, {
          status: 204,
          headers: { link: `<${SCOPE}bdp.json>; rel="service-desc"` },
        });
      if (url === `${SCOPE}bdp.json`)
        return responseAt(url, JSON.stringify(validDiscovery()), {
          headers: { "content-type": "application/json" },
        });
      throw new Error(`unexpected URL ${url}`);
    };
    const client = new BdpClient({
      scope: SCOPE,
      transport: createFetchTransport(fetchImplementation),
      externalTypeDescriptors: {
        typeIds: [TASK_TYPE],
        fetchImplementation: async () => {
          throw new Error("external Fetch must not run");
        },
      },
    });

    await expect(
      client.perform({
        kind: "resource",
        resource: "type",
        id: "https://subdomain.work.example/types/task",
      }),
    ).rejects.toBeInstanceOf(BdpClientCapabilityError);
    expect(urls).toEqual([SCOPE, `${SCOPE}bdp.json`]);
  });

  it("accepts an explicitly undefined custom-transport settlement timeout", () => {
    expect(
      () =>
        new BdpClient({
          scope: SCOPE,
          transport: new RecordingTransport({}),
          transportSettlementTimeoutMs: undefined,
        } as never),
    ).not.toThrow();
  });

  it.each(unsupportedDiscoveries)(
    "reports unsupported discovery %s before issuing a Read operation",
    async (_label, discovery) => {
      const { client, transport } = unsupportedClient(discovery);
      await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual(
        UNSUPPORTED_DISCOVERY_PROBLEM,
      );
      expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
    },
  );

  it.each(unsupportedRequests)(
    "reports unsupported discovery before dispatching the %s request",
    async (_label, request) => {
      const { client, transport } = unsupportedClient(UNSUPPORTED_VERSION_DISCOVERY);
      await expect(client.perform(request)).resolves.toEqual(UNSUPPORTED_DISCOVERY_PROBLEM);
      expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
    },
  );

  it("propagates a discovery transport Problem before dispatching a Read operation", async () => {
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
    } as const;
    const transport: BdpTransport = {
      discover: () => Promise.resolve({ kind: "problem", problem }),
      perform: () => Promise.reject(new Error("Read operation must not be dispatched")),
    };
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(
      client.perform({ kind: "resource", resource: "bead", id: `${BEADS}a` }),
    ).resolves.toEqual(problem);
  });

  it("propagates a discovery-document Problem before dispatching a Read operation", async () => {
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
    } as const;
    const transport = new RecordingTransport({ items: [], next: null });
    transport.discovery = problem;
    const client = new BdpClient({ scope: SCOPE, transport });

    const result = await client.perform({ kind: "collection", collection: "beads" });
    expect(result).toEqual(problem);
    expect(isBdpClientProblem(result)).toBe(true);
    expect(isBdpClientProblem({ ...result })).toBe(false);
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
  });

  it("performs the semantic Scope discovery request through the validated discovery path", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.perform({ kind: "scope-discovery", scope: SCOPE })).resolves.toEqual(
      transport.discovery,
    );
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
  });

  it("rejects a semantic Scope discovery request for another Scope without fetching it", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });

    const result = await client.perform({
      kind: "scope-discovery",
      scope: "https://attacker.example/",
    });
    expect(result).toEqual({
      type: "https://github.com/gastownhall/bdp/problems/authorization",
      code: "forbidden",
      retry: "after-state-change",
      status: 403,
      detail: "the requested Scope does not match the configured Scope",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => Object.assign(result, { code: "temporarily-unavailable" })).toThrow();
    expect(isBdpClientProblem(result)).toBe(true);
    expect(transport.urls).toEqual([]);
  });

  it("defers a same-origin service descriptor outside the canonical Scope", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    transport.serviceDescription = "https://beads.example/other/bdp.json";
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.perform({ kind: "collection", collection: "beads" })).rejects.toMatchObject(
      {
        code: "safe-fetch-policy-required",
      },
    );
    expect(transport.urls).toEqual([]);
  });

  it.each(["beads", "links", "types"] as const)(
    "rejects a discovery document whose %s root is not the fixed Scope root",
    async (root) => {
      const transport = new RecordingTransport({ items: [], next: null });
      transport.discovery = {
        ...(transport.discovery as Record<string, unknown>),
        [root]: `https://beads.example/other/${root}/`,
      };
      const client = new BdpClient({ scope: SCOPE, transport });

      await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual({
        type: "https://github.com/gastownhall/bdp/problems/authorization",
        code: "forbidden",
        retry: "after-state-change",
        status: 403,
        detail: "discovery metadata does not identify the configured Scope",
      });
      expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
    },
  );

  it("rejects discovery metadata for a different Scope path", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    transport.discovery = {
      ...(transport.discovery as Record<string, unknown>),
      scope: "https://beads.example/other/",
    };
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/authorization",
      code: "forbidden",
      retry: "after-state-change",
      status: 403,
      detail: "discovery metadata does not identify the configured Scope",
    });
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
  });

  it.each([
    ["properties", { kind: "properties", resource: "bead", id: "https://attacker.example/x" }],
    ["incident links", { kind: "bead-links", bead: "https://attacker.example/x" }],
    [
      "credential-bearing continuation",
      {
        kind: "collection",
        collection: "beads",
        continuation: "https://user:secret@beads.example/acme/beads/?cursor=x",
      },
    ],
  ] as const)(
    "rejects an unconfined or unissued %s request before transport dispatch",
    async (_label, request) => {
      const transport = new RecordingTransport({ items: [], next: null });
      const client = new BdpClient({ scope: SCOPE, transport });

      if (_label === "credential-bearing continuation") {
        await expect(client.perform(request)).rejects.toBeInstanceOf(BdpClientRequestError);
        expect(transport.urls).toEqual([]);
      } else {
        await expect(client.perform(request)).resolves.toEqual(OUTSIDE_SCOPE_PROBLEM);
        expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
      }
    },
  );

  it("rejects an incomplete higher profile until its schema is supported", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    transport.discovery = {
      bdpVersion: "0",
      profile: "transactional",
      scope: SCOPE,
      beads: BEADS,
      links: `${SCOPE}links/`,
      types: `${SCOPE}types/`,
    };
    const client = new BdpClient({ scope: SCOPE, transport });
    await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual(
      UNSUPPORTED_DISCOVERY_PROBLEM,
    );
  });

  it.each([
    ["unknown member", { ...validDiscovery(), operations: `${SCOPE}operations/` }],
    ["malformed limits", { ...validDiscovery(), limits: { page: { defaultItems: 0 } } }],
  ] as const)("rejects discovery with an %s", async (_label, discovery) => {
    const transport = new RecordingTransport({ items: [], next: null });
    transport.discovery = discovery;
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.discover()).resolves.toEqual(UNSUPPORTED_DISCOVERY_PROBLEM);
  });
  it("performs a typed Read operation and preserves the caller's request", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });
    const request = {
      kind: "collection",
      collection: "beads",
      selector: '$[?@.properties.status == "open"]',
    } as const;

    await expect(client.perform(request)).resolves.toEqual({ items: [], next: null });
    expect(transport.urls).toEqual([
      `${SCOPE}bdp.json`,
      `${BEADS}?selector=%24%5B%3F%40.properties.status+%3D%3D+%22open%22%5D`,
    ]);
  });

  it.each([
    [
      "Scope discovery",
      { kind: "scope-discovery", scope: SCOPE },
      validDiscovery(),
      [`${SCOPE}bdp.json`],
    ],
    [
      "Bead collection",
      { kind: "collection", collection: "beads" },
      { items: [], next: null },
      [`${SCOPE}bdp.json`, BEADS],
    ],
    [
      "Link collection",
      { kind: "collection", collection: "links" },
      { items: [], next: null },
      [`${SCOPE}bdp.json`, LINKS],
    ],
    [
      "Type inventory",
      { kind: "collection", collection: "types" },
      { items: [], next: null },
      [`${SCOPE}bdp.json`, `${SCOPE}types/`],
    ],
    [
      "Bead Resource",
      { kind: "resource", resource: "bead", id: `${BEADS}a` },
      validBead(),
      [`${SCOPE}bdp.json`, `${BEADS}a`],
    ],
    [
      "Link Resource",
      { kind: "resource", resource: "link", id: `${LINKS}blocks-a-b` },
      validLink(),
      [`${SCOPE}bdp.json`, `${LINKS}blocks-a-b`],
    ],
    [
      "Type Resource",
      { kind: "resource", resource: "type", id: `${SCOPE}types/task` },
      validTypeDescriptor(),
      [`${SCOPE}bdp.json`, `${SCOPE}types/task`],
    ],
    [
      "Bead properties",
      { kind: "properties", resource: "bead", id: `${BEADS}a` },
      { status: "open" },
      [`${SCOPE}bdp.json`, `${BEADS}a?view=properties`],
    ],
    [
      "Link properties",
      { kind: "properties", resource: "link", id: `${LINKS}blocks-a-b` },
      { reason: "dependency" },
      [`${SCOPE}bdp.json`, `${LINKS}blocks-a-b?view=properties`],
    ],
    [
      "incident-Link view",
      { kind: "bead-links", bead: `${BEADS}a` },
      { items: [validLink()], next: null },
      [`${SCOPE}bdp.json`, `${BEADS}a?view=links&direction=both`],
    ],
  ] as const)(
    "routes and validates the registered %s request variant",
    async (_label, request, body, expectedUrls) => {
      const transport = new RecordingTransport(body);
      const client = new BdpClient({ scope: SCOPE, transport });

      const result = await client.perform(request);

      expect(result).toEqual(request.kind === "scope-discovery" ? validDiscovery() : body);
      expect(transport.urls).toEqual(expectedUrls);
    },
  );

  it("maps a structurally invalid successful Read body to a structured Problem", async () => {
    const transport = new RecordingTransport({ surprise: true });
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
      detail: "the server returned a structurally invalid Read response",
    });
  });

  it("rejects a collection whose typed Resource identities do not match its kind", async () => {
    const transport = new RecordingTransport({
      items: [
        {
          id: `${LINKS}wrong-kind`,
          type: "https://work.example/types/task",
          revision: "1",
          properties: {},
        },
      ],
      next: null,
    });
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(
      client.perform({ kind: "collection", collection: "beads" }),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server returned a structurally invalid Read response",
    });
  });

  it.each([
    ["extra record member", { ...validBead(), extra: true }],
    ["empty revision", { ...validBead(), revision: "" }],
    ["unexpected embedded Links", { ...validBead(), links: { items: [], next: null } }],
  ] as const)("rejects a structurally invalid Bead %s", async (_label, bead) => {
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport({ items: [bead], next: null }),
    });

    await expect(
      client.perform({ kind: "collection", collection: "beads" }),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server returned a structurally invalid Read response",
    });
  });

  it.each([
    ["two external endpoints", validLink({ source: "urn:source", target: "urn:target" })],
    [
      "revision citation on an in-Scope endpoint",
      validLink({ target: { uri: `${BEADS}b`, revision: "cited-1" } }),
    ],
    [
      "revision citation on a normalized in-Scope HTTP alias",
      validLink({
        target: { uri: "https://BEADS.example:443/acme/beads/b", revision: "cited-1" },
      }),
    ],
    ["citation object missing its revision", validLink({ target: { uri: "urn:target" } })],
    [
      "citation object with an empty revision",
      validLink({ target: { uri: "urn:target", revision: "" } }),
    ],
    [
      "extra citation member",
      validLink({ target: { uri: "urn:target", revision: "cited-1", extra: true } }),
    ],
    [
      "noncanonical in-Scope endpoint ID",
      validLink({ source: "https://BEADS.example:443/acme/beads/a" }),
    ],
    ["noncanonical in-Scope endpoint path", validLink({ target: `${BEADS}b%2Fc` })],
    [
      "encoded Scope-prefix alias endpoint",
      validLink({ target: "https://beads.example/%61cme/beads/b" }),
    ],
    [
      "special-scheme Scope alias without slashes",
      validLink({ target: "https:beads.example/acme/beads/b" }),
    ],
    [
      "special-scheme Scope alias with one slash",
      validLink({ target: "https:/beads.example/acme/beads/b" }),
    ],
  ] as const)("rejects an invalid Link with %s", async (_label, link) => {
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport({ items: [link], next: null }),
    });

    await expect(
      client.perform({ kind: "collection", collection: "links" }),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server returned a structurally invalid Read response",
    });
  });

  it("accepts an opaque RFC URI that the WHATWG URL parser cannot represent as external", async () => {
    const link = validLink({ target: "https:/" });
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport({ items: [link], next: null }),
    });

    await expect(client.perform({ kind: "collection", collection: "links" })).resolves.toEqual({
      items: [link],
      next: null,
    });
  });

  it("keeps reserved path escapes opaque when classifying an external HTTP URI", async () => {
    const link = validLink({ target: "https://beads.example/acme%2Foutside" });
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport({ items: [link], next: null }),
    });

    await expect(client.perform({ kind: "collection", collection: "links" })).resolves.toEqual({
      items: [link],
      next: null,
    });
  });

  it.each([
    [
      "unrelated",
      "both",
      validLink({
        source: `${BEADS}b`,
        target: `${BEADS}c`,
      }),
    ],
    [
      "wrong outbound direction",
      "outbound",
      validLink({
        source: `${BEADS}b`,
        target: `${BEADS}a`,
      }),
    ],
    ["wrong inbound direction", "inbound", validLink()],
  ] as const)(
    "rejects an incident-Link response with a %s Link",
    async (_label, direction, link) => {
      const client = new BdpClient({
        scope: SCOPE,
        transport: new RecordingTransport({ items: [link], next: null }),
      });

      await expect(
        client.perform({ kind: "bead-links", bead: `${BEADS}a`, direction }),
      ).resolves.toMatchObject({
        code: "temporarily-unavailable",
        detail: "the server returned a structurally invalid Read response",
      });
    },
  );

  it("binds continuation incident-Link pages to the original Bead and direction", async () => {
    const continuation = `${BEADS}a?view=links&cursor=opaque`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(
      client.perform({ kind: "bead-links", bead: `${BEADS}a`, direction: "inbound" }),
    ).resolves.toEqual({ items: [], next: continuation });
    transport.result = { items: [validLink()], next: null };

    await expect(
      client.perform({
        kind: "bead-links",
        bead: `${BEADS}a`,
        continuation,
      }),
    ).resolves.toMatchObject({ code: "temporarily-unavailable" });
  });

  it("rejects a continuation outside its client-issued request context", async () => {
    const continuation = `${BEADS}?cursor=opaque`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });
    await client.perform({ kind: "collection", collection: "beads" });
    transport.result = { items: [], next: null };

    await expect(
      client.perform({ kind: "collection", collection: "types", continuation }),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, BEADS]);
  });

  it("rejects an unissued collection continuation before discovery", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(
      client.perform({
        kind: "collection",
        collection: "beads",
        continuation: `${BEADS}?cursor=unissued`,
      }),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
    expect(transport.urls).toEqual([]);
  });

  it("retains distinct collection contexts for one authoritative continuation URL", async () => {
    const continuation = `${SCOPE}page?cursor=shared`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });

    await client.perform({ kind: "collection", collection: "beads" });
    await client.perform({ kind: "collection", collection: "links" });
    transport.result = { items: [], next: null };

    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation }),
    ).resolves.toEqual({ items: [], next: null });
    await expect(
      client.perform({ kind: "collection", collection: "links", continuation }),
    ).resolves.toEqual({ items: [], next: null });
  });

  it("retains repeated issuance of one continuation in the same context", async () => {
    const continuation = `${BEADS}?cursor=shared`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });

    await client.perform({ kind: "collection", collection: "beads" });
    await client.perform({ kind: "collection", collection: "beads" });
    transport.result = { items: [], next: null };

    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation }),
    ).resolves.toEqual({ items: [], next: null });
    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation }),
    ).resolves.toEqual({ items: [], next: null });
  });

  it("allows only one concurrent dispatch for one continuation issuance", async () => {
    const continuation = `${BEADS}?cursor=single-concurrent`;
    const transport = new GatedContinuationTransport(continuation, 1);
    const client = new BdpClient({ scope: SCOPE, transport });
    await client.perform({ kind: "collection", collection: "beads" });

    const first = client.perform({ kind: "collection", collection: "beads", continuation });
    await transport.allContinuationDispatchesStarted;
    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation }),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
    expect(transport.continuationDispatches).toBe(1);

    transport.finishContinuations();
    await expect(first).resolves.toEqual({ items: [], next: null });
  });

  it("allows two concurrent dispatches for two identical continuation issuances", async () => {
    const continuation = `${BEADS}?cursor=double-concurrent`;
    const transport = new GatedContinuationTransport(continuation, 2);
    const client = new BdpClient({ scope: SCOPE, transport });
    await client.perform({ kind: "collection", collection: "beads" });
    await client.perform({ kind: "collection", collection: "beads" });

    const first = client.perform({ kind: "collection", collection: "beads", continuation });
    const second = client.perform({ kind: "collection", collection: "beads", continuation });
    await transport.allContinuationDispatchesStarted;
    expect(transport.continuationDispatches).toBe(2);

    transport.finishContinuations();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { items: [], next: null },
      { items: [], next: null },
    ]);
  });

  it("forgets only continuations owned by the selected traversal scope", async () => {
    const continuation = `${BEADS}?cursor=owner-isolated`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });
    const firstScope = client.createContinuationScope();
    const secondScope = client.createContinuationScope();

    await client.perform(
      { kind: "collection", collection: "beads" },
      { continuationScope: firstScope },
    );
    await client.perform(
      { kind: "collection", collection: "beads" },
      { continuationScope: secondScope },
    );
    client.forgetContinuations(firstScope);
    transport.result = { items: [], next: null };

    await expect(
      client.perform(
        { kind: "collection", collection: "beads", continuation },
        { continuationScope: firstScope },
      ),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
    await expect(
      client.perform(
        { kind: "collection", collection: "beads", continuation },
        { continuationScope: secondScope },
      ),
    ).resolves.toEqual({ items: [], next: null });
  });

  it("restores a leased continuation after a protocol Problem", async () => {
    const continuation = `${BEADS}?cursor=retry-after-problem`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });
    await client.perform({ kind: "collection", collection: "beads" });
    transport.result = {
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
    };

    const problem = await client.perform({
      kind: "collection",
      collection: "beads",
      continuation,
    });
    expect(isBdpClientProblem(problem)).toBe(true);
    transport.result = { items: [], next: null };
    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation }),
    ).resolves.toEqual({ items: [], next: null });
  });

  it("restores a leased continuation after caller abort", async () => {
    const continuation = `${BEADS}?cursor=retry-after-abort`;
    const transport = new GatedContinuationTransport(continuation, 1);
    const client = new BdpClient({ scope: SCOPE, transport });
    const continuationScope = client.createContinuationScope();
    await client.perform({ kind: "collection", collection: "beads" }, { continuationScope });
    const controller = new AbortController();
    const abortedOperation = client.perform(
      { kind: "collection", collection: "beads", continuation },
      { signal: controller.signal, continuationScope },
    );
    await transport.allContinuationDispatchesStarted;
    client.forgetContinuations(continuationScope);

    controller.abort("caller stopped continuation");
    await expect(abortedOperation).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    const retry = client.perform(
      { kind: "collection", collection: "beads", continuation },
      { continuationScope },
    );
    while (transport.continuationDispatches < 2)
      await new Promise((resolve) => setTimeout(resolve, 0));
    transport.finishContinuations();
    await expect(retry).resolves.toEqual({ items: [], next: null });
  });

  it("retains incident-Link contexts for one URL when their Beads differ", async () => {
    const continuation = `${SCOPE}incident?cursor=shared`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });

    await client.perform({ kind: "bead-links", bead: `${BEADS}a`, direction: "inbound" });
    await client.perform({ kind: "bead-links", bead: `${BEADS}b`, direction: "outbound" });
    transport.result = {
      items: [
        validLink({
          source: `${BEADS}b`,
          target: `${BEADS}a`,
        }),
      ],
      next: null,
    };

    await expect(
      client.perform({ kind: "bead-links", bead: `${BEADS}a`, continuation }),
    ).resolves.toMatchObject({ items: expect.any(Array), next: null });
    await expect(
      client.perform({ kind: "bead-links", bead: `${BEADS}b`, continuation }),
    ).resolves.toMatchObject({ items: expect.any(Array), next: null });
  });

  it("rejects a continuation URL that is ambiguous across directions for one Bead", async () => {
    const continuation = `${SCOPE}incident?cursor=shared`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });

    await client.perform({ kind: "bead-links", bead: `${BEADS}a`, direction: "inbound" });
    await expect(
      client.perform({ kind: "bead-links", bead: `${BEADS}a`, direction: "outbound" }),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server returned a structurally invalid Read response",
    });
    transport.result = {
      items: [
        validLink({
          source: `${BEADS}b`,
          target: `${BEADS}a`,
        }),
      ],
      next: null,
    };
    await expect(
      client.perform({ kind: "bead-links", bead: `${BEADS}a`, continuation }),
    ).resolves.toMatchObject({ items: expect.any(Array), next: null });
  });

  it("rejects a direction-ambiguous next URL while the other direction is leased", async () => {
    const continuation = `${SCOPE}incident?cursor=leased-direction`;
    const transport = new GatedDirectionAmbiguityTransport(continuation);
    const client = new BdpClient({ scope: SCOPE, transport });
    await client.perform({ kind: "bead-links", bead: `${BEADS}a`, direction: "inbound" });

    const inbound = client.perform({ kind: "bead-links", bead: `${BEADS}a`, continuation });
    await transport.continuationStarted;
    await expect(
      client.perform({ kind: "bead-links", bead: `${BEADS}a`, direction: "outbound" }),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server returned a structurally invalid Read response",
    });

    transport.finishContinuation();
    await expect(inbound).resolves.toEqual({ items: [], next: null });
  });

  it("rejects a continuation self-loop without consuming the issued capability", async () => {
    const continuation = `${BEADS}?cursor=loop`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });

    await client.perform({ kind: "collection", collection: "beads" });
    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation }),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server returned a structurally invalid Read response",
    });
    transport.result = { items: [], next: null };
    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation }),
    ).resolves.toEqual({ items: [], next: null });
  });

  it("rejects a multi-page continuation cycle without consuming an independent issuance", async () => {
    const first = `${BEADS}?cursor=cycle-a`;
    const second = `${BEADS}?cursor=cycle-b`;
    const transport = new RecordingTransport({ items: [], next: first });
    const client = new BdpClient({ scope: SCOPE, transport });

    await client.perform({ kind: "collection", collection: "beads" });
    await client.perform({ kind: "collection", collection: "beads" });
    transport.result = { items: [], next: second };
    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation: first }),
    ).resolves.toEqual({ items: [], next: second });

    transport.result = { items: [], next: first };
    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation: second }),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server returned a structurally invalid Read response",
    });

    transport.result = { items: [], next: null };
    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation: first }),
    ).resolves.toEqual({ items: [], next: null });
  });

  it("bounds abandoned continuation capabilities and recovers after consumption", async () => {
    const transport = new RecordingTransport({ items: [], next: `${BEADS}?cursor=0` });
    const client = new BdpClient({ scope: SCOPE, transport });
    const continuationScope = client.createContinuationScope();

    for (let index = 0; index < 1_024; index += 1) {
      transport.result = { items: [], next: `${BEADS}?cursor=${index}` };
      await expect(
        client.perform({ kind: "collection", collection: "beads" }, { continuationScope }),
      ).resolves.toEqual({
        items: [],
        next: `${BEADS}?cursor=${index}`,
      });
    }
    const overflow = `${BEADS}?cursor=overflow`;
    transport.result = { items: [], next: overflow };
    await expect(
      client.perform({ kind: "collection", collection: "beads" }, { continuationScope }),
    ).rejects.toMatchObject({
      name: "BdpClientContinuationCapacityError",
      code: "continuation-capacity-exceeded",
    });

    transport.result = { items: [], next: null };
    await expect(
      client.perform(
        {
          kind: "collection",
          collection: "beads",
          continuation: `${BEADS}?cursor=0`,
        },
        { continuationScope },
      ),
    ).resolves.toEqual({ items: [], next: null });
    transport.result = { items: [], next: overflow };
    await expect(
      client.perform({ kind: "collection", collection: "beads" }, { continuationScope }),
    ).resolves.toEqual({
      items: [],
      next: overflow,
    });

    client.forgetContinuations(continuationScope);
    const afterReclamation = `${BEADS}?cursor=after-reclamation`;
    transport.result = { items: [], next: afterReclamation };
    await expect(
      client.perform({ kind: "collection", collection: "beads" }, { continuationScope }),
    ).resolves.toEqual({
      items: [],
      next: afterReclamation,
    });
  });

  it("bounds retained continuation history and recovers after terminal consumption", async () => {
    const continuation = (index: number | "overflow" | "recovered") => `${BEADS}?cursor=${index}`;
    const transport = new RecordingTransport({ items: [], next: continuation(0) });
    const client = new BdpClient({ scope: SCOPE, transport });

    await client.perform({ kind: "collection", collection: "beads" });
    for (let index = 1; index < 10_000; index += 1) {
      transport.result = { items: [], next: continuation(index) };
      await client.perform({
        kind: "collection",
        collection: "beads",
        continuation: continuation(index - 1),
      });
    }

    transport.result = { items: [], next: continuation("overflow") };
    await expect(
      client.perform({
        kind: "collection",
        collection: "beads",
        continuation: continuation(9_999),
      }),
    ).rejects.toMatchObject({
      name: "BdpClientContinuationCapacityError",
      code: "continuation-capacity-exceeded",
    });

    transport.result = { items: [], next: null };
    await expect(
      client.perform({
        kind: "collection",
        collection: "beads",
        continuation: continuation(9_999),
      }),
    ).resolves.toEqual({ items: [], next: null });
    transport.result = { items: [], next: continuation("recovered") };
    await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual({
      items: [],
      next: continuation("recovered"),
    });
  });

  it.each([
    ["bead", `${BEADS}requested`, validBead(`${BEADS}other`)],
    ["link", `${LINKS}requested`, validLink({ id: `${LINKS}other` })],
    ["type", `${SCOPE}descriptors/requested`, validTypeDescriptor(`${SCOPE}descriptors/other`)],
  ] as const)(
    "rejects a %s singleton whose response identity differs",
    async (resource, id, body) => {
      const client = new BdpClient({ scope: SCOPE, transport: new RecordingTransport(body) });

      await expect(client.perform({ kind: "resource", resource, id })).resolves.toMatchObject({
        code: "temporarily-unavailable",
      });
    },
  );

  it("accepts an in-Scope Type Descriptor outside the inventory root", async () => {
    const id = `${SCOPE}descriptors/task`;
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport(validTypeDescriptor(id)),
    });

    await expect(client.perform({ kind: "resource", resource: "type", id })).resolves.toEqual(
      validTypeDescriptor(id),
    );
  });

  it("keeps a Problem-shaped successful properties object as properties", async () => {
    const properties = {
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "cursor-expired",
      retry: "after-state-change",
    };
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport({ kind: "success", body: properties }),
    });

    const result = await client.perform({
      kind: "properties",
      resource: "bead",
      id: `${BEADS}a`,
    });
    expect(result).toEqual(properties);
    expect(isReadProblem(result)).toBe(true);
    expect(isBdpClientProblem(result)).toBe(false);
  });

  it.each([
    ["cross-kind root", `${LINKS}a`],
    ["query-bearing ID", `${BEADS}a?view=properties`],
    ["encoded slash", `${BEADS}a%2Fb`],
    ["encoded backslash", `${BEADS}a%5Cb`],
    ["duplicate slash", `${BEADS}/a`],
    ["encoded reserved colon", `${BEADS}a%3Ab`],
    ["encoded reserved exclamation", `${BEADS}a%21b`],
    ["lowercase percent escape", `${BEADS}%e2%82%ac`],
    ["fragment", `${BEADS}a#fragment`],
  ] as const)("rejects a noncanonical Bead Resource %s before dispatch", async (_label, id) => {
    const transport = new RecordingTransport({});
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.perform({ kind: "resource", resource: "bead", id })).resolves.toMatchObject(
      {
        code: "invalid-parameter",
      },
    );
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
  });

  it.each([
    ["non-integer limit", { kind: "collection", collection: "beads", limit: 2.5 }],
    ["invalid direction", { kind: "bead-links", bead: `${BEADS}a`, direction: "sideways" }],
    ["inapplicable Type filter", { kind: "collection", collection: "types", type: TASK_TYPE }],
    ["unknown operation", { kind: "future", resource: "bead", id: `${BEADS}a` }],
    ["unknown collection", { kind: "collection", collection: "future" }],
    ["unknown Resource kind", { kind: "resource", resource: "future", id: `${BEADS}a` }],
    ["Type properties view", { kind: "properties", resource: "type", id: TASK_TYPE }],
    ["missing Resource ID", { kind: "resource", resource: "bead" }],
    ["non-string Type filter", { kind: "collection", collection: "beads", type: 7 }],
  ] as const)("rejects an invalid local request with %s", async (_label, request) => {
    const transport = new RecordingTransport({});
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.perform(request as ReadRequest)).rejects.toBeInstanceOf(
      BdpClientRequestError,
    );
    expect(transport.urls).toEqual([]);
  });

  it("rejects request objects whose inherited fields could bypass own-key validation", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });
    const request = Object.assign(Object.create({ type: TASK_TYPE }) as object, {
      kind: "collection",
      collection: "types",
    });

    await expect(client.perform(request as ReadRequest)).rejects.toBeInstanceOf(
      BdpClientRequestError,
    );
    expect(transport.urls).toEqual([]);
  });

  it("does not misclassify an internal response-parser failure as transport rejection", async () => {
    const parserFailure = new Error("parser infrastructure failed");
    const body = {
      get items(): never {
        throw parserFailure;
      },
      next: null,
    };
    const client = new BdpClient({ scope: SCOPE, transport: new RecordingTransport(body) });

    await expect(client.perform({ kind: "collection", collection: "beads" })).rejects.toBe(
      parserFailure,
    );
  });

  it("owns a request before asynchronous discovery can observe caller mutation", async () => {
    const transport = new DelayedDiscoveryTransport();
    const client = new BdpClient({ scope: SCOPE, transport });
    const request = { kind: "collection", collection: "types" } as const as {
      kind: "collection";
      collection: "beads" | "types";
    };
    const operation = client.perform(request as ReadRequest);
    await transport.discoveryStarted;
    request.collection = "beads";
    transport.finishDiscovery();

    await expect(operation).resolves.toEqual({ items: [], next: null });
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, `${SCOPE}types/`]);
  });

  it("rejects accessor-bearing requests before they can change between reads", async () => {
    let reads = 0;
    const request = {
      kind: "collection",
      get collection(): string {
        reads += 1;
        return reads === 1 ? "beads" : "types";
      },
    };
    const client = new BdpClient({ scope: SCOPE, transport: new RecordingTransport({}) });

    await expect(client.perform(request as ReadRequest)).rejects.toBeInstanceOf(
      BdpClientRequestError,
    );
    expect(reads).toBe(0);
  });

  it("rejects accessor-bearing client options before storing Scope identity", () => {
    let reads = 0;
    const options = {
      get scope(): string {
        reads += 1;
        return reads === 1 ? SCOPE : "https://attacker.example/";
      },
      transport: new RecordingTransport({ items: [], next: null }),
    };

    expect(() => new BdpClient(options)).toThrow(BdpClientRequestError);
    expect(reads).toBe(0);
  });

  it("rejects a forged operation signal before admission and close remains live", async () => {
    const client = new BdpClient({
      scope: SCOPE,
      transport: new RecordingTransport({ items: [], next: null }),
    });

    await expect(
      client.perform(
        { kind: "collection", collection: "beads" },
        {
          signal: { aborted: false } as unknown as AbortSignal,
        },
      ),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
    await expect(client.close()).resolves.toBeUndefined();
  });

  it.each(["https://outside.example/beads/a", `${BEADS}a%2Fb`] as const)(
    "rejects an unissued incident-Link continuation before discovery: %s",
    async (bead) => {
      const transport = new RecordingTransport({ items: [], next: null });
      const client = new BdpClient({ scope: SCOPE, transport });

      await expect(
        client.perform({
          kind: "bead-links",
          bead,
          continuation: `${BEADS}a?view=links&cursor=opaque`,
        }),
      ).rejects.toBeInstanceOf(BdpClientRequestError);
      expect(transport.urls).toEqual([]);
    },
  );

  it("reports the explicit safe-fetch gap for an external Type Descriptor", async () => {
    const transport = new RecordingTransport({});
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(
      client.perform({
        kind: "resource",
        resource: "type",
        id: "https://work.example/types/task",
      }),
    ).rejects.toBeInstanceOf(BdpClientCapabilityError);
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
  });

  it.each([
    ["selected Bead", TASK_TYPE],
    ["selected Link", LINK_TYPE],
  ] as const)(
    "surfaces the supported %s Type Descriptor from an allowlisted authority",
    async (_label, id) => {
      const descriptor = REFERENCE_TYPE_DESCRIPTORS.find((candidate) => candidate.id === id);
      if (descriptor === undefined) throw new Error(`missing reference descriptor ${id}`);
      const scopeRequests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const scopeFetch: typeof fetch = async (input, init = {}) => {
        const url = String(input);
        const credentialed = new Headers(init.headers);
        credentialed.set("authorization", "Bearer scope-only-secret");
        scopeRequests.push({ url, init: { ...init, headers: credentialed } });
        if (url === SCOPE)
          return responseAt(url, null, {
            status: 204,
            headers: { link: `<${SCOPE}bdp.json>; rel="service-desc"` },
          });
        if (url === `${SCOPE}bdp.json`)
          return responseAt(url, JSON.stringify(validDiscovery()), {
            headers: { "content-type": "application/json" },
          });
        throw new Error(`Scope Fetch received external URL ${url}`);
      };
      const externalRequests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const externalFetch: typeof fetch = async (input, init = {}) => {
        const url = String(input);
        externalRequests.push({ url, init });
        if (url === id)
          return responseAt(url, JSON.stringify(descriptor), {
            headers: { "content-type": "application/json" },
          });
        throw new Error(`external Fetch received unexpected URL ${url}`);
      };
      const client = new BdpClient({
        scope: SCOPE,
        transport: createFetchTransport(scopeFetch),
        externalTypeDescriptors: { typeIds: [id], fetchImplementation: externalFetch },
      });

      await expect(client.perform({ kind: "resource", resource: "type", id })).resolves.toEqual(
        descriptor,
      );
      expect(scopeRequests.map(({ url }) => url)).toEqual([SCOPE, `${SCOPE}bdp.json`]);
      expect(
        scopeRequests.every(({ init }) => new Headers(init.headers).has("authorization")),
      ).toBe(true);
      expect(externalRequests).toHaveLength(1);
      expect(externalRequests[0]?.init).toMatchObject({
        redirect: "manual",
        credentials: "omit",
      });
      expect(new Headers(externalRequests[0]?.init.headers).get("authorization")).toBeNull();
      expect(new Headers(externalRequests[0]?.init.headers).get("accept")).toBe("application/json");
    },
  );

  it("caches validated discovery across sequential operations", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });

    await client.perform({ kind: "collection", collection: "beads" });
    await client.perform({ kind: "collection", collection: "links" });

    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, BEADS, LINKS]);
  });

  it("owns and freezes cached discovery before exposing it", async () => {
    const source = validDiscovery();
    const transport = new RecordingTransport({ items: [], next: null });
    transport.discovery = source;
    const client = new BdpClient({ scope: SCOPE, transport });
    const discovery = await client.discover();
    if ("code" in discovery) throw new Error("expected discovery");

    expect(Object.isFrozen(discovery)).toBe(true);
    expect(() => Object.assign(discovery, { beads: "https://attacker.example/" })).toThrow();
    source.beads = "https://attacker.example/";
    await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual({
      items: [],
      next: null,
    });
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, BEADS]);
  });

  it("does not dispatch after a caller aborts during cached discovery resolution", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });
    await client.perform({ kind: "collection", collection: "beads" });
    const controller = new AbortController();

    const operation = client.perform(
      { kind: "collection", collection: "links" },
      { signal: controller.signal },
    );
    controller.abort("caller stopped after cached discovery");

    await expect(operation).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, BEADS]);
  });

  it("does not resolve public discover after a cached caller abort", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });
    await client.discover();
    const controller = new AbortController();
    const operation = client.discover({ signal: controller.signal });
    controller.abort("caller stopped cached discovery");

    await expect(operation).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
  });

  it("does not resolve a cached Scope-discovery request after close", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });
    await client.discover();
    const operation = client.perform({ kind: "scope-discovery", scope: SCOPE });
    const close = client.close();

    await expect(operation).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    await expect(close).resolves.toBeUndefined();
  });

  it("models a rejecting custom transport as a local transport error", async () => {
    const transport: BdpTransport = {
      discover: () => Promise.reject(new TypeError("socket closed")),
      perform: () => Promise.reject(new TypeError("must not dispatch")),
    };
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(
      client.perform({ kind: "collection", collection: "beads" }),
    ).rejects.toBeInstanceOf(BdpClientTransportError);
  });

  it("does not let a rejecting transport spoof another local client error", async () => {
    const transport: BdpTransport = {
      discover: () => Promise.reject(new BdpClientRequestError("forged request error")),
      perform: () => Promise.reject(new TypeError("must not dispatch")),
    };
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.perform({ kind: "collection", collection: "beads" })).rejects.toMatchObject(
      {
        code: "transport-failed",
        cause: expect.any(BdpClientRequestError),
      },
    );
  });

  it("models an invalid custom transport discriminant as a local transport error", async () => {
    const transport: BdpTransport = {
      discover: () =>
        Promise.resolve({
          kind: "future",
          body: { serviceDescription: `${SCOPE}bdp.json` },
        } as never),
      perform: () => Promise.reject(new TypeError("must not dispatch")),
    };
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(
      client.perform({ kind: "collection", collection: "beads" }),
    ).rejects.toBeInstanceOf(BdpClientTransportError);
  });

  it("models an invalid custom discovery success body as a local transport error", async () => {
    const transport: BdpTransport = {
      discover: () => Promise.resolve({ kind: "success", body: null } as never),
      perform: () => Promise.reject(new TypeError("must not dispatch")),
    };
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(
      client.perform({ kind: "collection", collection: "beads" }),
    ).rejects.toBeInstanceOf(BdpClientTransportError);
  });

  it.each([
    ["invalid", { kind: "problem", problem: { code: "forged" } }],
    [
      "incoherent",
      {
        kind: "problem",
        problem: {
          type: "https://github.com/gastownhall/bdp/problems/not-found",
          code: "resource-not-found",
          retry: "after-state-change",
          status: 404,
        },
        httpStatus: 403,
      },
    ],
  ] as const)(
    "models an %s custom transport Problem as a local transport error",
    async (_label, result) => {
      const transport: BdpTransport = {
        discover: () => Promise.resolve(result),
        perform: () => Promise.reject(new TypeError("must not dispatch")),
      };
      const client = new BdpClient({ scope: SCOPE, transport });

      await expect(client.discover()).rejects.toBeInstanceOf(BdpClientTransportError);
    },
  );

  it("owns a custom transport result after reading its discriminant and body once", async () => {
    let kindReads = 0;
    let bodyReads = 0;
    const result = Object.defineProperties(
      {},
      {
        kind: {
          enumerable: true,
          get: () => {
            kindReads += 1;
            return kindReads === 1 ? "success" : "future";
          },
        },
        body: {
          enumerable: true,
          get: () => {
            bodyReads += 1;
            return { serviceDescription: `${SCOPE}bdp.json` };
          },
        },
      },
    );
    const transport: BdpTransport = {
      discover: () => Promise.resolve(result as never),
      perform: () => Promise.resolve({ kind: "success", body: validDiscovery() } as never),
    };
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.discover()).resolves.toEqual(validDiscovery());
    expect({ kindReads, bodyReads }).toEqual({ kindReads: 1, bodyReads: 1 });
  });

  it("retries discovery after a structured discovery failure", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    transport.discovery = {
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
    };
    const client = new BdpClient({ scope: SCOPE, transport });
    await expect(
      client.perform({ kind: "collection", collection: "beads" }),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
    });

    transport.discovery = validDiscovery();
    await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual({
      items: [],
      next: null,
    });
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, `${SCOPE}bdp.json`, BEADS]);
  });

  it("single-flights cold discovery across concurrent operations", async () => {
    const transport = new DelayedDiscoveryTransport();
    const client = new BdpClient({ scope: SCOPE, transport });
    const first = client.perform({ kind: "collection", collection: "beads" });
    const second = client.perform({ kind: "collection", collection: "links" });
    await transport.discoveryStarted;

    expect(transport.urls).toEqual([`${SCOPE}bdp.json`]);
    transport.finishDiscovery();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { items: [], next: null },
      { items: [], next: null },
    ]);
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, BEADS, LINKS]);
  });

  it("does not let one caller abort the shared cold discovery", async () => {
    const transport = new DelayedDiscoveryTransport();
    const client = new BdpClient({ scope: SCOPE, transport });
    const controller = new AbortController();
    const first = client.perform(
      { kind: "collection", collection: "beads" },
      { signal: controller.signal },
    );
    const second = client.perform({ kind: "collection", collection: "links" });
    await transport.discoveryStarted;

    controller.abort("first caller stopped");
    await expect(first).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    expect(transport.discoverySignal?.aborted).toBe(false);
    transport.finishDiscovery();
    await expect(second).resolves.toEqual({ items: [], next: null });
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, LINKS]);
  });

  it("close aborts and waits for an in-flight shared discovery", async () => {
    const transport = new DelayedDiscoveryTransport();
    const client = new BdpClient({ scope: SCOPE, transport });
    const operation = client.perform({ kind: "collection", collection: "beads" });
    await transport.discoveryStarted;

    const close = client.close();
    await transport.discoveryCancelled;
    await expect(operation).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    await expect(close).resolves.toBeUndefined();
  });

  it("returns a protocol problem without converting it to a local error", async () => {
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "cursor-expired",
      retry: "after-state-change",
      status: 410,
    } as const;
    const client = new BdpClient({ scope: SCOPE, transport: new RecordingTransport(problem) });

    await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual(
      problem,
    );
  });

  it("follows an authoritative continuation URL after Scope discovery without rebuilding it", async () => {
    const continuation = `${SCOPE}beads/?cursor=opaque%2ftoken%7Epart&limit=7`;
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });

    await client.perform({ kind: "collection", collection: "beads" });
    transport.result = { items: [], next: null };
    await client.perform({ kind: "collection", collection: "beads", continuation });
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, BEADS, continuation]);
  });

  it.each([
    ["Bead collection", { kind: "collection", collection: "beads" }, BEADS],
    ["Link collection", { kind: "collection", collection: "links" }, LINKS],
    ["Type inventory", { kind: "collection", collection: "types" }, `${SCOPE}types/`],
    [
      "incident-Link view",
      { kind: "bead-links", bead: `${BEADS}a`, direction: "both" },
      `${BEADS}a?view=links&direction=both`,
    ],
  ] as const)("rejects an off-Scope next URL from a %s", async (_label, request, requestUrl) => {
    const continuation = "https://attacker.example/page?cursor=opaque";
    const transport = new RecordingTransport({ items: [], next: continuation });
    const client = new BdpClient({ scope: SCOPE, transport });

    await expect(client.perform(request)).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server returned a structurally invalid Read response",
    });
    await expect(
      client.perform({ kind: "collection", collection: "beads", continuation }),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, requestUrl]);
  });

  it.each([
    {
      kind: "collection",
      collection: "beads",
      continuation: `${BEADS}?cursor=opaque`,
      type: TASK_TYPE,
    },
    {
      kind: "bead-links",
      bead: `${BEADS}a`,
      continuation: `${BEADS}a?view=links&cursor=opaque`,
      limit: 10,
    },
    {
      kind: "bead-links",
      bead: `${BEADS}a`,
      continuation: `${BEADS}a?view=links&cursor=opaque`,
      direction: "inbound",
    },
  ] as const)(
    "rejects predicates, direction, or limits repeated beside a continuation",
    async (request) => {
      const transport = new RecordingTransport({ items: [], next: null });
      const client = new BdpClient({ scope: SCOPE, transport });

      await expect(client.perform(request)).rejects.toBeInstanceOf(BdpClientRequestError);
      expect(transport.urls).toEqual([]);
    },
  );

  it("rejects an already-aborted operation before transport dispatch", async () => {
    const transport = new RecordingTransport({ items: [], next: null });
    const client = new BdpClient({ scope: SCOPE, transport });
    const controller = new AbortController();
    controller.abort("caller stopped");

    await expect(
      client.perform({ kind: "collection", collection: "beads" }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    expect(transport.urls).toEqual([]);
  });

  it("close cancels admitted work, waits for cleanup, and rejects later admission", async () => {
    const transport = new BlockingTransport();
    const client = new BdpClient({ scope: SCOPE, transport });
    const operation = client.perform({ kind: "collection", collection: "beads" });
    await transport.started;

    let closeFinished = false;
    const close = client.close().then(() => {
      closeFinished = true;
    });
    const operationRejected = expect(operation).rejects.toBeInstanceOf(
      BdpClientOperationAbortedError,
    );
    await transport.cancelled;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closeFinished).toBe(false);

    transport.finishCleanup();
    await operationRejected;
    await close;
    await expect(
      client.perform({ kind: "collection", collection: "beads" }),
    ).rejects.toBeInstanceOf(BdpClientClosedError);
    expect(transport.urls).toEqual([`${SCOPE}bdp.json`, BEADS]);
  });

  it("close is idempotent while several rejecting operations settle", async () => {
    const transport = new MultiBlockingTransport();
    const client = new BdpClient({ scope: SCOPE, transport });
    const first = client.perform({ kind: "collection", collection: "beads" });
    const second = client.perform({ kind: "collection", collection: "links" });
    await transport.allStarted;

    const closeA = client.close();
    const closeB = client.close();
    transport.finishCleanup();

    const operations = await Promise.allSettled([first, second]);
    expect(operations.every((result) => result.status === "rejected")).toBe(true);
    await expect(Promise.all([closeA, closeB])).resolves.toEqual([undefined, undefined]);
  });

  it("close settles when an injected Fetch implementation ignores abort", async () => {
    const [started, markStarted] = deferred();
    const fetchImplementation: typeof fetch = () => {
      markStarted();
      return new Promise<Response>(() => undefined);
    };
    const client = new BdpClient({
      scope: SCOPE,
      transport: createFetchTransport(fetchImplementation, { responseTimeoutMs: 10 }),
    });
    const operation = client.perform({ kind: "collection", collection: "beads" });
    await started;

    const close = client.close();
    await expect(operation).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    await expect(close).resolves.toBeUndefined();
  });

  it("close abandons a custom transport that does not settle within its configured bound", async () => {
    const [started, markStarted] = deferred();
    const transport: BdpTransport = {
      discover: () => {
        markStarted();
        return new Promise(() => undefined);
      },
      perform: () => Promise.reject(new Error("must not dispatch")),
    };
    const client = new BdpClient({
      scope: SCOPE,
      transport,
      transportSettlementTimeoutMs: 10,
    });
    const operation = client.perform({ kind: "collection", collection: "beads" });
    await started;

    const close = client.close();
    await expect(operation).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    await expect(close).resolves.toBeUndefined();
  });

  it("keeps close pending until a late Fetch response receives bounded cleanup", async () => {
    const [started, markStarted] = deferred();
    let resolveFetch!: (response: Response) => void;
    const fetchImplementation: typeof fetch = () => {
      markStarted();
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    };
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const client = new BdpClient({
      scope: SCOPE,
      transport: createFetchTransport(fetchImplementation, { responseTimeoutMs: 100 }),
    });
    const operation = client.perform({ kind: "collection", collection: "beads" });
    await started;

    let closeFinished = false;
    const close = client.close().then(() => {
      closeFinished = true;
    });
    const operationRejected = expect(operation).rejects.toBeInstanceOf(
      BdpClientOperationAbortedError,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closeFinished).toBe(false);

    resolveFetch(responseAt(SCOPE, body));
    await operationRejected;
    await close;
    expect(cancelled).toBe(true);
  });
});

describe("createFetchTransport", () => {
  it("parses service-desc as an exact Link relation token regardless of parameter order", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), null, {
        status: 204,
        headers: {
          link: `<ignored.json>; rel="service-description", <bdp.json>; type="application/json"; rel="alternate service-desc"`,
        },
      }),
    );

    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).resolves.toEqual({ serviceDescription: `${SCOPE}bdp.json` });
  });

  it.each(["", " ", "\t"])(
    "rejects a blank service-desc Link target %j instead of treating the Scope as its descriptor",
    async (target) => {
      const transport = createFetchTransport(async (input) =>
        responseAt(String(input), null, {
          status: 204,
          headers: { link: `<${target}>; rel="service-desc"` },
        }),
      );

      await expect(
        transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
      ).resolves.toMatchObject({
        code: "temporarily-unavailable",
        detail: "Scope discovery returned an invalid service-desc target",
      });
    },
  );

  it.each(["Service-Desc", "SERVICE-DESC"])(
    "matches registered service-desc relation tokens case-insensitively: %s",
    async (relation) => {
      const transport = createFetchTransport(async (input) =>
        responseAt(String(input), null, {
          status: 204,
          headers: { link: `<bdp.json>; rel="${relation}"` },
        }),
      );

      await expect(
        transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
      ).resolves.toEqual({ serviceDescription: `${SCOPE}bdp.json` });
    },
  );

  it("does not forge service-desc from a semicolon inside a quoted Link parameter", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), null, {
        status: 204,
        headers: {
          link: `<evil.json>; title="x; rel=service-desc; y", <bdp.json>; rel="service-desc"`,
        },
      }),
    );

    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).resolves.toEqual({ serviceDescription: `${SCOPE}bdp.json` });
  });

  it("does not synthesize service-desc when it appears only inside quoted text", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), null, {
        status: 204,
        headers: { link: `<evil.json>; title="x; rel=service-desc; y"` },
      }),
    );

    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "scope discovery returned no service-desc Link relation",
    });
  });

  it("ignores duplicate rel parameters after the first", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), null, {
        status: 204,
        headers: { link: `<wrong.json>; rel="alternate"; rel="service-desc"` },
      }),
    );

    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "scope discovery returned no service-desc Link relation",
    });
  });

  it("rejects invalid unquoted multi-token rel parameters", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), null, {
        status: 204,
        headers: { link: `<wrong.json>; rel=alternate service-desc` },
      }),
    );

    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "scope discovery returned no service-desc Link relation",
    });
  });

  it("preserves a coherent Scope Problem response", async () => {
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
      status: 404,
    } as const;
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), JSON.stringify(problem), { status: 404 }),
    );

    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).resolves.toEqual(problem);
  });

  it("fails closed for a Scope Problem whose mapping disagrees with HTTP status", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(
        String(input),
        JSON.stringify({
          type: "https://github.com/gastownhall/bdp/problems/authorization",
          code: "forbidden",
          retry: "after-state-change",
          status: 403,
        }),
        { status: 404 },
      ),
    );

    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).rejects.toThrow("scope discovery returned an incoherent Problem response");
  });

  it("reports malformed successful JSON as a temporary-unavailable Problem", async () => {
    const urls: string[] = [];
    const requests: RequestInit[] = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      requests.push(init ?? {});
      if (url === SCOPE)
        return responseAt(url, null, {
          status: 200,
          headers: { link: `<${SCOPE}bdp.json>; rel="service-desc"` },
        });
      if (url === `${SCOPE}bdp.json`)
        return responseAt(
          url,
          JSON.stringify({
            bdpVersion: "0",
            profile: "read",
            scope: SCOPE,
            beads: BEADS,
            links: `${SCOPE}links/`,
            types: `${SCOPE}types/`,
          }),
          { headers: { "content-type": "application/json" } },
        );
      return responseAt(url, "{not-json", {
        status: 200,
      });
    };
    const client = new BdpClient({
      scope: SCOPE,
      transport: createFetchTransport(fetchImplementation),
    });

    await expect(client.perform({ kind: "collection", collection: "beads" })).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
      detail: "the server returned a malformed JSON response",
    });
    expect(urls).toEqual([SCOPE, `${SCOPE}bdp.json`, BEADS]);
    expect(requests.map(({ redirect }) => redirect)).toEqual(["manual", "manual", "manual"]);
    expect(new Headers(requests[1]?.headers).get("accept")).toBe("application/json");
    expect(new Headers(requests[2]?.headers).get("accept")).toBe("application/json");
  });

  it("rejects a successful body without a JSON media type", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), JSON.stringify({ items: [], next: null }), {
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(
      transportValue(transport.perform(BEADS, transportOptions())),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server response did not use a JSON media type",
    });
  });

  it("cancels a nonterminating response body with the wrong media type", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = responseAt(BEADS, body, { headers: { "content-type": "text/plain" } });
    const transport = createFetchTransport(async () => response);

    await expect(
      transportValue(transport.perform(BEADS, transportOptions())),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server response did not use a JSON media type",
    });
    expect(cancelled).toBe(true);
  });

  it.each([201, 202, 204, 206])(
    "rejects unexpected successful Read status %i as a transport contract failure and cancels its body",
    async (status) => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      });
      const response = responseAt(BEADS, status === 204 ? null : body, { status });
      const transport = createFetchTransport(async () => response);

      await expect(transport.perform(BEADS, transportOptions())).rejects.toThrow(
        `the server returned unexpected success status ${status}`,
      );
      expect(cancelled).toBe(status !== 204);
    },
  );

  it("keeps a body-less internal fault outside the protocol Problem taxonomy", async () => {
    const transport = createFetchTransport(async () => responseAt(BEADS, null, { status: 500 }));

    await expect(transport.perform(BEADS, transportOptions())).rejects.toThrow(
      "the server returned a body-less internal fault without a BDP Problem",
    );
  });

  it.each([undefined, "application/json"])(
    "recognizes a real wire body-less internal fault with content-type %s",
    async (contentType) => {
      const server = createServer((_request, response) => {
        response.statusCode = 500;
        if (contentType !== undefined) response.setHeader("content-type", contentType);
        response.end();
      });
      const scope = `${await listenHttp(server)}/`;
      try {
        const transport = createFetchTransport(fetch);
        await expect(transport.perform(scope, transportOptionsFor(scope))).rejects.toThrow(
          "the server returned a body-less internal fault without a BDP Problem",
        );
        await expect(
          transport.discover(scope, { signal: new AbortController().signal }),
        ).rejects.toThrow(
          "scope discovery returned a body-less internal fault without a BDP Problem",
        );
      } finally {
        await closeHttp(server);
      }
    },
  );

  it.each(["Read", "Scope discovery"] as const)(
    "does not fabricate a Problem when a non-success %s body times out",
    async (mode) => {
      for (const status of [404, 500]) {
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
          pull: () => new Promise<void>(() => undefined),
          cancel() {
            cancelled = true;
          },
        });
        const url = mode === "Read" ? BEADS : SCOPE;
        const response = responseAt(url, body, {
          status,
          headers: { "content-type": "application/problem+json" },
        });
        const transport = createFetchTransport(async () => response, { responseTimeoutMs: 10 });
        const operation =
          mode === "Read"
            ? transport.perform(BEADS, transportOptions())
            : transport.discover(SCOPE, { signal: new AbortController().signal });

        await expect(operation).rejects.toThrow(
          new RegExp(`HTTP ${status} with an unreadable BDP Problem`),
        );
        expect(cancelled).toBe(true);
      }
    },
  );

  it.each([403, 405, 500])(
    "does not fabricate a BDP Problem from non-Problem HTTP %i",
    async (status) => {
      const transport = createFetchTransport(async () =>
        responseAt(BEADS, "<html>intermediary response</html>", {
          status,
          headers: { "content-type": "text/html" },
        }),
      );

      await expect(transport.perform(BEADS, transportOptions())).rejects.toThrow(
        `the server returned HTTP ${status} without a BDP Problem`,
      );
    },
  );

  it("does not fabricate a Scope Problem from a nonempty HTTP 500", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), "<html>internal fault</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      transport.discover(SCOPE, { signal: new AbortController().signal }),
    ).rejects.toThrow("scope discovery returned HTTP 500 without a BDP Problem");
  });

  it("surfaces a non-Problem Fetch response as a local transport error", async () => {
    const fetchImplementation: typeof fetch = async (input) => {
      const url = String(input);
      if (url === SCOPE)
        return responseAt(url, null, {
          status: 204,
          headers: { link: `<${SCOPE}bdp.json>; rel="service-desc"` },
        });
      if (url === `${SCOPE}bdp.json`)
        return responseAt(url, JSON.stringify(validDiscovery()), { status: 200 });
      return responseAt(url, "<html>forbidden by intermediary</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    };
    const client = new BdpClient({
      scope: SCOPE,
      transport: createFetchTransport(fetchImplementation),
    });

    await expect(client.perform({ kind: "collection", collection: "beads" })).rejects.toMatchObject(
      { code: "transport-failed", cause: expect.any(Error) },
    );
  });

  it("normalizes unrepresentable JSON numbers in Read and discovery Problem bodies", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), '{"value":1e999}', {
        status: String(input) === SCOPE ? 404 : 200,
      }),
    );

    await expect(
      transportValue(transport.perform(BEADS, transportOptions())),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server returned a malformed JSON response",
    });
    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).rejects.toThrow("scope discovery returned HTTP 404 with an unreadable BDP Problem");
  });

  it("rejects an off-origin response URL and cancels its body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "url", { value: "https://attacker.example/result" });
    const transport = createFetchTransport(async () => response);

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/authorization",
      code: "forbidden",
      retry: "after-state-change",
      status: 403,
      detail: "the response redirected outside the configured Scope",
    });
    expect(cancelled).toBe(true);
  });

  it("rejects a custom Fetch response that omits its observed URL", async () => {
    const response = new Response(JSON.stringify({ items: [], next: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const transport = createFetchTransport(async () => response);

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/request",
      code: "invalid-parameter",
      retry: "never",
      status: 400,
      detail: "the response returned an invalid response URL",
    });
  });

  it("cancels a Scope response body when service-desc is missing", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, { status: 200 });
    Object.defineProperty(response, "url", { value: SCOPE });
    const transport = createFetchTransport(async () => response);

    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
      detail: "scope discovery returned no service-desc Link relation",
    });
    expect(cancelled).toBe(true);
  });

  it("bounds a Scope response whose body cancellation never settles", async () => {
    let cancelStarted = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelStarted = true;
        return new Promise<void>(() => undefined);
      },
    });
    const response = new Response(body, { status: 200 });
    Object.defineProperty(response, "url", { value: SCOPE });
    const transport = createFetchTransport(async () => response, { responseTimeoutMs: 10 });

    await expect(
      transportValue(transport.discover(SCOPE, { signal: new AbortController().signal })),
    ).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
      detail: "scope discovery returned no service-desc Link relation",
    });
    expect(cancelStarted).toBe(true);
  });

  it("bounds redirect cleanup whose body cancellation never settles", async () => {
    let cancelStarted = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelStarted = true;
        return new Promise<void>(() => undefined);
      },
    });
    const response = new Response(body, { status: 200 });
    Object.defineProperty(response, "url", { value: "https://attacker.example/result" });
    const transport = createFetchTransport(async () => response, { responseTimeoutMs: 10 });

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/authorization",
      code: "forbidden",
      retry: "after-state-change",
      status: 403,
      detail: "the response redirected outside the configured Scope",
    });
    expect(cancelStarted).toBe(true);
  });

  it.each([
    ["Scope", SCOPE, "https://attacker.example/evil", "scope discovery"],
    ["Read", BEADS, "https://attacker.example/evil", "the response"],
  ] as const)(
    "classifies a real off-origin %s redirect before body parsing",
    async (_label, url, location, subject) => {
      const transport = createFetchTransport(async (input) =>
        responseAt(String(input), "redirect body", { status: 302, headers: { location } }),
      );
      const result =
        url === SCOPE
          ? await transportValue(transport.discover(url, { signal: new AbortController().signal }))
          : await transportValue(transport.perform(url, transportOptions()));

      expect(result).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/authorization",
        code: "forbidden",
        retry: "after-state-change",
        status: 403,
        detail: `${subject} redirected outside the configured Scope`,
      });
    },
  );

  it("classifies a real in-Scope redirect as a non-retryable protocol mismatch", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), "redirect body", {
        status: 307,
        headers: { location: `${SCOPE}other` },
      }),
    );

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/request",
      code: "invalid-parameter",
      retry: "never",
      status: 400,
      detail: "the response returned an unsupported redirect",
    });
  });

  it("classifies a same-origin redirect outside the Scope as forbidden", async () => {
    const transport = createFetchTransport(async (input) =>
      responseAt(String(input), "redirect body", {
        status: 302,
        headers: { location: "https://beads.example/other/" },
      }),
    );

    await expect(
      transportValue(transport.perform(BEADS, transportOptions())),
    ).resolves.toMatchObject({
      code: "forbidden",
      detail: "the response redirected outside the configured Scope",
    });
  });

  it("bounds successful response bytes before JSON materialization", async () => {
    const transport = createFetchTransport(
      async (input) => responseAt(String(input), JSON.stringify({ padding: "x".repeat(64) })),
      { maximumResponseBodyBytes: 32 },
    );

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
      detail: "the server response exceeded 32 bytes",
    });
  });

  it("bounds reader cancellation when a byte-limited body refuses cleanup", async () => {
    let cancelStarted = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64));
      },
      cancel() {
        cancelStarted = true;
        return new Promise<void>(() => undefined);
      },
    });
    const response = responseAt(BEADS, body);
    const transport = createFetchTransport(async () => response, {
      maximumResponseBodyBytes: 32,
      responseTimeoutMs: 10,
    });

    await expect(
      transportValue(transport.perform(BEADS, transportOptions())),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server response exceeded 32 bytes",
    });
    expect(cancelStarted).toBe(true);
  });

  it("bounds reader cancellation when a timed-out body refuses cleanup", async () => {
    let cancelStarted = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancelStarted = true;
        return new Promise<void>(() => undefined);
      },
    });
    const response = responseAt(BEADS, body);
    const transport = createFetchTransport(async () => response, { responseTimeoutMs: 10 });

    await expect(
      transportValue(transport.perform(BEADS, transportOptions())),
    ).resolves.toMatchObject({
      code: "temporarily-unavailable",
      detail: "the server response timed out",
    });
    expect(cancelStarted).toBe(true);
  });

  it("fails closed when a non-success Problem body exceeds local bounds", async () => {
    const transport = createFetchTransport(
      async (input) =>
        responseAt(String(input), JSON.stringify({ padding: "x".repeat(64) }), { status: 404 }),
      { maximumResponseBodyBytes: 32 },
    );

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).rejects.toThrow(
      "the server returned HTTP 404 with an unreadable BDP Problem",
    );
  });

  it.each([
    [
      "closed mapping",
      404,
      {
        type: "https://evil.example/problem",
        code: "resource-not-found",
        retry: "after-state-change",
        status: 404,
      },
    ],
    [
      "HTTP status",
      404,
      {
        type: "https://github.com/gastownhall/bdp/problems/authorization",
        code: "forbidden",
        retry: "after-state-change",
        status: 403,
      },
    ],
  ] as const)(
    "fails closed for a Problem with an incoherent %s",
    async (_label, status, problem) => {
      const transport = createFetchTransport(async (input) =>
        responseAt(String(input), JSON.stringify(problem), { status }),
      );

      await expect(transportValue(transport.perform(BEADS, transportOptions()))).rejects.toThrow(
        /the server returned an (?:invalid|incoherent) Problem response/,
      );
    },
  );

  it("bounds successful response JSON complexity", async () => {
    const transport = createFetchTransport(
      async (input) => responseAt(String(input), JSON.stringify({ outer: { inner: true } })),
      { maximumJsonDepth: 1 },
    );

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
      detail: "the server response exceeded JSON depth 1",
    });
  });

  it.each([
    [
      "nodes",
      { maximumJsonNodes: 2 },
      JSON.stringify([true, false]),
      "the server response exceeded 2 JSON nodes",
    ],
    [
      "container entries",
      { maximumJsonContainerEntries: 1 },
      JSON.stringify({ first: true, second: false }),
      "the server response exceeded 1 JSON entries",
    ],
  ] as const)("bounds successful response JSON %s", async (_label, options, body, detail) => {
    const transport = createFetchTransport(
      async (input) => responseAt(String(input), body),
      options,
    );

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
      detail,
    });
  });

  it.each([
    ["maximumResponseBodyBytes", { maximumResponseBodyBytes: 0 }],
    ["maximumJsonDepth", { maximumJsonDepth: 0 }],
    ["maximumJsonNodes", { maximumJsonNodes: 0 }],
    ["maximumJsonContainerEntries", { maximumJsonContainerEntries: 0 }],
    ["responseTimeoutMs", { responseTimeoutMs: 0 }],
    ["responseTimeoutMs", { responseTimeoutMs: 2_147_483_648 }],
  ] as const)("rejects an invalid %s option", (name, options) => {
    expect(() => createFetchTransport(fetch, options)).toThrow(name);
  });

  it("bounds a response body that stops making progress", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "url", { value: BEADS });
    const transport = createFetchTransport(async () => response, { responseTimeoutMs: 10 });

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
      detail: "the server response timed out",
    });
    expect(cancelled).toBe(true);
  });

  it("bounds an injected Fetch implementation that ignores its signal", async () => {
    const fetchImplementation: typeof fetch = () => new Promise<Response>(() => undefined);
    const transport = createFetchTransport(fetchImplementation, { responseTimeoutMs: 10 });

    await expect(transportValue(transport.perform(BEADS, transportOptions()))).resolves.toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
      status: 503,
      detail: "the server response timed out",
    });
  });
});

function transportOptions(): { readonly scope: string; readonly signal: AbortSignal } {
  return { scope: SCOPE, signal: new AbortController().signal };
}

function transportOptionsFor(scope: string): {
  readonly scope: string;
  readonly signal: AbortSignal;
} {
  return { scope, signal: new AbortController().signal };
}

async function listenHttp(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (address === null) throw new Error("HTTP test server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function closeHttp(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function transportValue<Body>(
  result: Promise<BdpTransportResult<Body>>,
): Promise<Body | unknown> {
  const settled = await result;
  return settled.kind === "success" ? settled.body : settled.problem;
}

function isTransportResult(value: unknown): value is BdpTransportResult<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value.kind === "success" || value.kind === "problem")
  );
}

function unsupportedClient(discovery: unknown): {
  readonly client: BdpClient;
  readonly transport: RecordingTransport;
} {
  const transport = new RecordingTransport({ items: [], next: null });
  transport.discovery = discovery;
  return { client: new BdpClient({ scope: SCOPE, transport }), transport };
}

function validDiscovery(): Record<string, unknown> {
  return {
    bdpVersion: "0",
    profile: "read",
    scope: SCOPE,
    beads: BEADS,
    links: LINKS,
    types: `${SCOPE}types/`,
  };
}

class RecordingTransport implements BdpTransport {
  readonly urls: string[] = [];
  serviceDescription = `${SCOPE}bdp.json`;
  discovery: unknown = validDiscovery();

  constructor(public result: unknown) {}

  discover(): Promise<BdpTransportResult<{ serviceDescription: string }>> {
    return Promise.resolve({
      kind: "success",
      body: { serviceDescription: this.serviceDescription },
    });
  }

  perform<Body>(url: string): Promise<BdpTransportResult<Body>> {
    this.urls.push(url);
    const value = url.endsWith("bdp.json") ? this.discovery : this.result;
    if (isTransportResult(value)) return Promise.resolve(value as BdpTransportResult<Body>);
    return Promise.resolve(
      isReadProblem(value)
        ? { kind: "problem", problem: value }
        : { kind: "success", body: value as Body },
    );
  }
}

class GatedContinuationTransport implements BdpTransport {
  continuationDispatches = 0;
  readonly allContinuationDispatchesStarted: Promise<void>;
  private readonly markAllContinuationDispatchesStarted: () => void;
  private readonly continuationGate: Promise<void>;
  readonly finishContinuations: () => void;

  constructor(
    private readonly continuation: string,
    private readonly expectedDispatches: number,
  ) {
    [this.allContinuationDispatchesStarted, this.markAllContinuationDispatchesStarted] = deferred();
    [this.continuationGate, this.finishContinuations] = deferred();
  }

  discover(): Promise<BdpTransportResult<{ serviceDescription: string }>> {
    return Promise.resolve({ kind: "success", body: { serviceDescription: `${SCOPE}bdp.json` } });
  }

  async perform<Body>(url: string): Promise<BdpTransportResult<Body>> {
    if (url.endsWith("bdp.json")) return { kind: "success", body: validDiscovery() as Body };
    if (url !== this.continuation)
      return {
        kind: "success",
        body: { items: [], next: this.continuation } as Body,
      };
    this.continuationDispatches += 1;
    if (this.continuationDispatches === this.expectedDispatches)
      this.markAllContinuationDispatchesStarted();
    await this.continuationGate;
    return { kind: "success", body: { items: [], next: null } as Body };
  }
}

class GatedDirectionAmbiguityTransport implements BdpTransport {
  readonly continuationStarted: Promise<void>;
  private readonly markContinuationStarted: () => void;
  private readonly continuationGate: Promise<void>;
  readonly finishContinuation: () => void;

  constructor(private readonly continuation: string) {
    [this.continuationStarted, this.markContinuationStarted] = deferred();
    [this.continuationGate, this.finishContinuation] = deferred();
  }

  discover(): Promise<BdpTransportResult<{ serviceDescription: string }>> {
    return Promise.resolve({ kind: "success", body: { serviceDescription: `${SCOPE}bdp.json` } });
  }

  async perform<Body>(url: string): Promise<BdpTransportResult<Body>> {
    if (url.endsWith("bdp.json")) return { kind: "success", body: validDiscovery() as Body };
    if (url === this.continuation) {
      this.markContinuationStarted();
      await this.continuationGate;
      return { kind: "success", body: { items: [], next: null } as Body };
    }
    return {
      kind: "success",
      body: {
        items: [],
        next: this.continuation,
      } as Body,
    };
  }
}

class DelayedDiscoveryTransport implements BdpTransport {
  readonly urls: string[] = [];
  readonly discoveryStarted: Promise<void>;
  private readonly markDiscoveryStarted: () => void;
  private readonly discoveryFinished: Promise<void>;
  readonly finishDiscovery: () => void;
  readonly discoveryCancelled: Promise<void>;
  private readonly markDiscoveryCancelled: () => void;
  discoverySignal: AbortSignal | undefined;

  constructor() {
    [this.discoveryStarted, this.markDiscoveryStarted] = deferred();
    [this.discoveryFinished, this.finishDiscovery] = deferred();
    [this.discoveryCancelled, this.markDiscoveryCancelled] = deferred();
  }

  discover(): Promise<BdpTransportResult<{ serviceDescription: string }>> {
    return Promise.resolve({ kind: "success", body: { serviceDescription: `${SCOPE}bdp.json` } });
  }

  async perform<Body>(
    url: string,
    options: { readonly scope: string; readonly signal: AbortSignal },
  ): Promise<BdpTransportResult<Body>> {
    this.urls.push(url);
    if (url.endsWith("bdp.json")) {
      this.discoverySignal = options.signal;
      this.markDiscoveryStarted();
      await Promise.race([
        this.discoveryFinished,
        aborted(options.signal).then(() => {
          this.markDiscoveryCancelled();
          throw options.signal.reason;
        }),
      ]);
      return {
        kind: "success",
        body: {
          bdpVersion: "0",
          profile: "read",
          scope: SCOPE,
          beads: BEADS,
          links: LINKS,
          types: `${SCOPE}types/`,
        } as Body,
      };
    }
    return { kind: "success", body: { items: [], next: null } as Body };
  }
}

class BlockingTransport implements BdpTransport {
  readonly urls: string[] = [];
  readonly started: Promise<void>;
  readonly cancelled: Promise<void>;
  private readonly markStarted: () => void;
  private readonly markCancelled: () => void;
  private readonly cleanup: Promise<void>;
  readonly finishCleanup: () => void;

  constructor() {
    [this.started, this.markStarted] = deferred();
    [this.cancelled, this.markCancelled] = deferred();
    [this.cleanup, this.finishCleanup] = deferred();
  }

  discover(): Promise<BdpTransportResult<{ serviceDescription: string }>> {
    return Promise.resolve({ kind: "success", body: { serviceDescription: `${SCOPE}bdp.json` } });
  }

  async perform<Body>(
    url: string,
    options: { readonly scope: string; readonly signal: AbortSignal },
  ): Promise<BdpTransportResult<Body>> {
    this.urls.push(url);
    if (url.endsWith("bdp.json")) {
      return {
        kind: "success",
        body: {
          bdpVersion: "0",
          profile: "read",
          scope: SCOPE,
          beads: `${SCOPE}beads/`,
          links: `${SCOPE}links/`,
          types: `${SCOPE}types/`,
        } as Body,
      };
    }
    this.markStarted();
    await aborted(options.signal);
    this.markCancelled();
    await this.cleanup;
    throw options.signal.reason;
  }
}

class MultiBlockingTransport implements BdpTransport {
  private started = 0;
  readonly allStarted: Promise<void>;
  private readonly markAllStarted: () => void;
  private readonly cleanup: Promise<void>;
  readonly finishCleanup: () => void;

  constructor() {
    [this.allStarted, this.markAllStarted] = deferred();
    [this.cleanup, this.finishCleanup] = deferred();
  }

  discover(): Promise<BdpTransportResult<{ serviceDescription: string }>> {
    return Promise.resolve({ kind: "success", body: { serviceDescription: `${SCOPE}bdp.json` } });
  }

  async perform<Body>(
    url: string,
    options: { readonly scope: string; readonly signal: AbortSignal },
  ): Promise<BdpTransportResult<Body>> {
    if (url.endsWith("bdp.json")) {
      return {
        kind: "success",
        body: {
          bdpVersion: "0",
          profile: "read",
          scope: SCOPE,
          beads: `${SCOPE}beads/`,
          links: `${SCOPE}links/`,
          types: `${SCOPE}types/`,
        } as Body,
      };
    }
    this.started += 1;
    if (this.started === 2) this.markAllStarted();
    await aborted(options.signal);
    await this.cleanup;
    throw new Error("transport cleanup rejected");
  }
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

function deferred(): readonly [Promise<void>, () => void] {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return [promise, resolve];
}

function responseAt(
  url: string,
  body: ConstructorParameters<typeof Response>[0],
  init?: ResponseInit,
): Response {
  const headers = new Headers(init?.headers);
  if (body !== null && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = new Response(body, { ...init, headers });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
