// This test-local mock admits the Read server; it creates no conformance evidence.
import { establishReadConformanceEvidenceForTesting } from "@bdp/server/testing";
import { createPortableReferenceFixturePort } from "@bdp/adapter-in-memory";
import { BdpClient, createFetchTransport } from "@bdp/client";
import { parseBeadRecord, parseBeadCollection, parseLinkCollection } from "@bdp/protocol";
import {
  admitReadServerProfile,
  closeNodeHttpServer,
  createNodeHttpServer,
  createReadServer,
  listenNodeHttpServer,
} from "@bdp/server";
import { describe, expect, it } from "vitest";

const scope = "https://scope.example/acme/";
const memory = "https://scope.example/acme/types/memory";
const note = "https://scope.example/acme/types/note";
const plain = "https://scope.example/acme/types/plain";
const cites = "https://scope.example/acme/types/cites";
const relates = "https://scope.example/acme/types/relates";
const empty = "https://scope.example/acme/types/explicit-empty";
const absent = "https://scope.example/acme/types/absent";
const properties = {
  ownsOutgoing: { "*": { max: 999 } },
  ownedLinks: { "*": ["https://outside.example/not-a-link"] },
  source: "opaque authored value",
  label: "also opaque",
};

function wildcardFixture(wildcardMax = 3, explicitMax = 2) {
  const types = [
    ...[memory, note, plain].map((id) => ({ id, name: id, describes: "bead" as const })),
    ...[cites, relates, empty, absent].map((id) => ({ id, name: id, describes: "link" as const })),
  ];
  return {
    types,
    typeDescriptors: types.map((type) => ({
      ...type,
      conformsTo: [],
      ...(type.describes === "link"
        ? { source: { conformsTo: [] }, target: { conformsTo: [] } }
        : type.id === memory
          ? {
              ownsOutgoing: {
                "*": { max: wildcardMax },
                [cites]: { max: explicitMax, label: "cites" },
                [empty]: { max: 1 },
              },
            }
          : type.id === note
            ? { ownsOutgoing: { "*": { max: wildcardMax } } }
            : {}),
    })),
    beads: [
      { localId: "beads/a", type: memory, revision: "a-1", properties },
      { localId: "beads/b", type: memory, revision: "b-1", properties: {} },
      { localId: "beads/n", type: note, revision: "n-1", properties: {} },
      { localId: "beads/p", type: plain, revision: "p-1", properties: {} },
    ],
    links: [
      // Deliberately reverse the canonical IDs within a group. Pins and
      // attribution must match the first-class records exactly.
      {
        localId: "links/z",
        type: cites,
        revision: "z-1",
        source: { uri: "beads/a", revision: "a-0" },
        target: "beads/b",
        properties: { label: "authored" },
      },
      {
        localId: "links/a",
        type: cites,
        revision: "a-1",
        source: "beads/a",
        target: { uri: "urn:external:cited", revision: "e-1" },
        attribution: { principal: "agent:writer", status: "claimed" },
        properties: {},
      },
      {
        localId: "links/r",
        type: relates,
        revision: "r-1",
        source: "beads/a",
        target: "beads/b",
        properties: { source: "opaque" },
      },
      // Incoming and non-owning sources do not contribute to a's bound.
      {
        localId: "links/incoming",
        type: relates,
        revision: "i-1",
        source: "beads/p",
        target: "beads/a",
        properties: {},
      },
    ],
  };
}

describe("wildcard ownership through public Read", () => {
  it("serves present-plus-explicit groups through HTTP and the Fetch client with opaque properties", async () => {
    const withdrawEvidence = establishReadConformanceEvidenceForTesting("bdptest");
    try {
      const server = createReadServer({
        scope,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: createPortableReferenceFixturePort(scope, wildcardFixture()),
      });
      try {
        const listener = createNodeHttpServer(server);
        try {
          await listenNodeHttpServer(listener, {
            host: "127.0.0.1",
            port: 0,
            onError: (error) => {
              throw error;
            },
          });
          const address = listener.address();
          if (address === null || typeof address === "string")
            throw new Error("listener did not bind");
          const client = new BdpClient({
            scope,
            transport: createFetchTransport(createDialFetch(address.port)),
          });
          try {
            await expect(
              client.perform({ kind: "resource", resource: "type", id: memory }),
            ).resolves.toMatchObject({
              ownsOutgoing: {
                "*": { max: 3 },
                [cites]: { max: 2, label: "cites" },
                [empty]: { max: 1 },
              },
            });
            const bead = parseBeadRecord(
              await client.perform({
                kind: "resource",
                resource: "bead",
                id: `${scope}beads/a`,
              }),
            );
            const first = await client.perform({
              kind: "resource",
              resource: "link",
              id: `${scope}links/a`,
            });
            const last = await client.perform({
              kind: "resource",
              resource: "link",
              id: `${scope}links/z`,
            });
            const other = await client.perform({
              kind: "resource",
              resource: "link",
              id: `${scope}links/r`,
            });
            expect(bead.ownedLinks).toEqual({
              [cites]: [first, last],
              [empty]: [],
              [relates]: [other],
            });
            expect(bead.properties).toEqual(properties);
            expect(Object.keys(bead.ownedLinks ?? {})).not.toContain("*");
            expect(Object.keys(bead.ownedLinks ?? {})).not.toContain(absent);
            const collection = parseBeadCollection(
              await client.perform({ kind: "collection", collection: "beads" }),
            );
            expect(collection.items.find((item) => item.id === bead.id)).toEqual(bead);
            expect(
              collection.items.find((item) => item.id === `${scope}beads/b`)?.ownedLinks,
            ).toEqual({ [cites]: [], [empty]: [] });
            expect(
              collection.items.find((item) => item.id === `${scope}beads/n`)?.ownedLinks,
            ).toEqual({});
            expect(
              collection.items.find((item) => item.id === `${scope}beads/p`),
            ).not.toHaveProperty("ownedLinks");
            await expect(
              client.perform({ kind: "properties", resource: "bead", id: bead.id }),
            ).resolves.toEqual(properties);
            const allLinks = parseLinkCollection(
              await client.perform({ kind: "collection", collection: "links" }),
            );
            expect(allLinks.items).toEqual(expect.arrayContaining([first, last, other]));
            const outgoing = parseLinkCollection(
              await client.perform({
                kind: "bead-links",
                bead: bead.id,
                direction: "outbound",
              }),
            );
            expect(outgoing.items).toHaveLength(3);
            expect(outgoing.items).toEqual(expect.arrayContaining([first, last, other]));
            await expect(
              client.perform({ kind: "resource", resource: "bead", id: `${scope}beads/b` }),
            ).resolves.toMatchObject({ id: `${scope}beads/b` });
          } finally {
            await client.close();
          }
        } finally {
          await closeNodeHttpServer(listener);
        }
      } finally {
        await server.close();
      }
    } finally {
      withdrawEvidence();
    }
  });

  it("counts explicit and wildcard-covered links together against the whole-set max", () => {
    expect(() => createPortableReferenceFixturePort(scope, wildcardFixture(2, 2))).toThrow(
      "whole-set wildcard bound",
    );
  });

  it("also enforces the smaller explicit per-type max", () => {
    expect(() => createPortableReferenceFixturePort(scope, wildcardFixture(3, 1))).toThrow(
      "declared bound",
    );
  });

  it("refuses an impossible descriptor cap at fixture admission", () => {
    expect(() => createPortableReferenceFixturePort(scope, wildcardFixture(3, 4))).toThrow(
      "exceeds the wildcard max",
    );
  });

  it.each(["source", "target"] as const)(
    "refuses a wildcard-owned Link with an absent in-Scope %s",
    (endpoint) => {
      const fixture = wildcardFixture();
      expect(() =>
        createPortableReferenceFixturePort(scope, {
          ...fixture,
          links: fixture.links.map((link) =>
            link.localId === "links/r" ? { ...link, [endpoint]: `${scope}beads/hidden` } : link,
          ),
        }),
      ).toThrow("in-Scope Link endpoint");
    },
  );

  it("requires wildcard-covered concrete types to remain declared Link Types", () => {
    const fixture = wildcardFixture();
    expect(() =>
      createPortableReferenceFixturePort(scope, {
        ...fixture,
        links: fixture.links.map((link) =>
          link.localId === "links/r" ? { ...link, type: plain } : link,
        ),
      }),
    ).toThrow("declared link Type");
  });
});

function createDialFetch(dialPort: number): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const semanticUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const dialUrl = new URL(semanticUrl);
    dialUrl.protocol = "http:";
    dialUrl.hostname = "127.0.0.1";
    dialUrl.port = String(dialPort);
    const response = await fetch(dialUrl, init);
    const semanticResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(semanticResponse, "url", { value: semanticUrl });
    return semanticResponse;
  }) as typeof fetch;
}
