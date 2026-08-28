// This import installs the non-emitted evidence mock before @bdp/server loads.
import { establishReadConformanceEvidenceForTesting } from "@bdp/server/testing";
import { BdpClient, createFetchTransport } from "@bdp/client";
import {
  admitReadServerProfile,
  closeNodeHttpServer,
  createNodeHttpServer,
  createReadServer,
  listenNodeHttpServer,
  scopePortSuccess,
} from "@bdp/server";
import { expect, it } from "vitest";

const scope = "https://scope.example/acme/";

it("preserves Problem-shaped properties through the public server and Fetch client", async () => {
  const withdrawEvidence = establishReadConformanceEvidenceForTesting("bdptest");
  try {
    const properties = {
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "cursor-expired",
      retry: "after-state-change",
    };
    const server = createReadServer({
      scope,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: {
        perform: async () => scopePortSuccess(properties as never) as never,
      },
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
            client.perform({
              kind: "properties",
              resource: "bead",
              id: `${scope}beads/demo-a`,
            }),
          ).resolves.toEqual(properties);
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

it("keeps deterministic ScopePort contract faults local and non-retryable", async () => {
  const withdrawEvidence = establishReadConformanceEvidenceForTesting("bdptest");
  try {
    const server = createReadServer({
      scope,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: {
        perform: async () =>
          scopePortSuccess({
            items: [],
            next: `${scope}beads/?cursor=unsupported-adapter-continuation`,
          } as never) as never,
      },
    });
    const faults: unknown[] = [];
    try {
      const listener = createNodeHttpServer(server, { onError: (error) => faults.push(error) });
      try {
        await listenNodeHttpServer(listener, {
          host: "127.0.0.1",
          port: 0,
          onError: (error) => faults.push(error),
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
            client.perform({ kind: "collection", collection: "beads" }),
          ).rejects.toMatchObject({ code: "transport-failed" });
          expect(faults).toEqual([
            expect.objectContaining({ name: "ProtocolArtifactValidationError" }),
          ]);
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
