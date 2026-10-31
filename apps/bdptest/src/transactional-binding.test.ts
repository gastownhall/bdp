/** Synthetic metadata controls around real sockets; not installed target evidence. */
import { createServer, type Socket } from "node:net";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createRawHttpExchangeExecutor, type ExactHttpModeOptions } from "@bdp/conformance";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import {
  createTransactionalExecutionBinding,
  installedTransactionBinding,
} from "../test-support/transactional-execution-binding.js";
const fixtureSource = {
  bytes: readFileSync(
    new URL(
      "../../../packages/conformance/test-support/transactional/fixture-v1.json",
      import.meta.url,
    ),
  ),
};
const bundle = createCumulativeTransactionalArtifactBundle(
  loadProfileContractSelection("transactional"),
  {
    fixture: fixtureSource,
    manifest: {
      bytes: readFileSync(
        new URL(
          "../../../packages/conformance/test-support/transactional/manifest-v1.json",
          import.meta.url,
        ),
      ),
    },
  },
);
const scope = "https://reference.invalid/acme/",
  point = `${scope}beads/a`,
  receipt = `${scope}receipts/r1`,
  scenario = bundle.manifest.scenarios[0]!;
async function listener(handler: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
function ready(listenUrl: string) {
  const targets = Object.fromEntries(
    Object.entries({
      createBead: "create-bead",
      updateBead: "update-bead",
      deleteBead: "delete-bead",
      createLink: "create-link",
      updateLink: "update-link",
      deleteLink: "delete-link",
      putAlias: "put-alias",
      deleteAlias: "delete-alias",
      updateWhere: "update-where",
      deleteWhere: "delete-where",
      batch: "batch",
      sequence: "sequence",
    }).map(([k, v]) => [k, `${scope}operations/${v}`]),
  );
  return {
    scope,
    listenUrl,
    targets,
    profile: "transactional",
    history: false,
    claimEligible: false,
    authorityMode: "canonical",
    runtimeConfigurationIdentity: "a".repeat(64),
    artifactIdentity: `development-schema5-${"b".repeat(64)}`,
    payloadIdentity: "c".repeat(64),
    policyIdentity: "d".repeat(64),
    authenticationIdentity: "e".repeat(64),
  };
}
const mode: ExactHttpModeOptions = {
  scope,
  profile: "transactional",
  routes: [{ method: "GET", url: point }],
  maximumRequestHeaderBytes: 16384,
  maximumRequestBodyBytes: 65536,
  defaultCredentialRef: "operator",
  credentialHandles: [{ id: "operator", headerNames: [] }],
  resolveCredentials: () => ({}),
};
it.each(["close", "cohort"])(
  "aborts and drains a real registered dynamic socket via %s",
  async (cause) => {
    const parent = new AbortController();
    let received!: () => void;
    const requestSeen = new Promise<void>((r) => {
      received = r;
    });
    const server = await listener((socket) => socket.once("data", received));
    let settled = false,
      closed = false;
    const baseline = installedTransactionBinding(ready(server.url), "f".repeat(40), fixtureSource);
    const bound = createTransactionalExecutionBinding({
      baseline,
      sourceCommit: "f".repeat(40),
      fixtureSource,
      exactMode: mode,
      launch: async () => ({
        ready: ready(server.url),
        close: async () => {
          expect(settled).toBe(true);
          closed = true;
        },
      }),
    });
    try {
      expect(() => bound.context.current(scenario.id)).toThrow();
      await bound.target.harness.prepare(scenario, scope, 0, bundle.fixture, parent.signal);
      const session = bound.context.current(scenario.id),
        raw = createRawHttpExchangeExecutor(session.dialRoute, {
          exactMode: { ...mode, routes: [{ method: "GET", url: receipt }] },
          requestTimeoutMs: 5000,
        });
      const operation = session.register(
        raw({
          method: "GET",
          url: receipt,
          raw: { headerLines: [] },
          signal: session.signal,
        }).catch((error) => {
          settled = true;
          return error;
        }),
      );
      await requestSeen;
      if (cause === "cohort") {
        parent.abort();
        expect(await operation).toHaveProperty("category", "abort");
        expect(closed).toBe(false);
      }
      await bound.target.close();
      expect(await operation).toHaveProperty("category", "abort");
      expect(closed).toBe(true);
      expect(() => bound.context.current(scenario.id)).toThrow();
    } finally {
      await bound.target.close();
      await server.close();
    }
  },
);
it("rebinds ordinary raw requests to the new validated physical session while base mode stays fixed", async () => {
  const first = await listener((socket) =>
    socket.once("data", () =>
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\n1"),
    ),
  );
  const second = await listener((socket) =>
    socket.once("data", () =>
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\n2"),
    ),
  );
  const baseline = installedTransactionBinding(ready(first.url), "f".repeat(40), fixtureSource);
  const bound = createTransactionalExecutionBinding({
    baseline,
    sourceCommit: "f".repeat(40),
    fixtureSource,
    exactMode: mode,
    launch: async (_id, reopen) => ({
      ready: ready(reopen ? second.url : first.url),
      close: async () => {},
    }),
  });
  try {
    await bound.target.harness.prepare(
      scenario,
      scope,
      0,
      bundle.fixture,
      new AbortController().signal,
    );
    const old = bound.context.current(scenario.id),
      configuration = bound.target.exactConfiguration;
    const request = {
      method: "GET" as const,
      url: point,
      raw: { headerLines: [] },
      signal: new AbortController().signal,
    };
    expect((await bound.target.execute(request)).bodyText).toBe("1");
    await bound.context.reopen(scenario.id, new AbortController().signal);
    expect((await bound.target.execute(request)).bodyText).toBe("2");
    expect(bound.target.exactConfiguration).toBe(configuration);
    expect(old.signal.aborted).toBe(true);
    expect(bound.context.current(scenario.id).binding.listenUrl).not.toBe(old.binding.listenUrl);
  } finally {
    await bound.target.close();
    await first.close();
    await second.close();
  }
});
