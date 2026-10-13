import { createServer } from "node:http";
import { once } from "node:events";
import { createRawHttpExchangeExecutor, type RawHttpExchangeExecutor } from "@bdp/conformance";
import { expect, it } from "vitest";
import { exactNativeReadAdapter } from "../test-support/installed-read-fixture.js";

it("transmits resolved conditional headers through the real exact serializer", async () => {
  const wire: unknown[] = [],
    observed: unknown[] = [];
  const server = createServer((request, response) => {
    wire.push({
      method: request.method,
      match: request.headers["if-match"],
      none: request.headers["if-none-match"],
    });
    response.writeHead(304, { etag: '"actual-revision"' });
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("listener missing");
    const scope = "https://read.invalid/acme/",
      url = `${scope}beads/a`;
    const execute = createRawHttpExchangeExecutor(
      { host: "127.0.0.1", port: address.port, transport: "plain" },
      {
        exactMode: {
          scope,
          profile: "read-update",
          routes: [{ method: "HEAD", url }],
          maximumRequestBodyBytes: 1024,
          maximumRequestHeaderBytes: 4096,
          defaultCredentialRef: "operator",
          credentialHandles: [{ id: "operator", headerNames: [] }],
          resolveCredentials: () => ({}),
        },
      },
    );
    const adapted = exactNativeReadAdapter(execute, (value) => observed.push(value));
    const response = await adapted({
      method: "HEAD",
      url,
      headers: { "if-match": '"actual-revision"', "if-none-match": 'W/"actual-revision"' },
      signal: new AbortController().signal,
    });
    expect(response.status).toBe(304);
    expect(response.bodyText).toBe("");
    expect(wire).toEqual([
      { method: "HEAD", match: '"actual-revision"', none: 'W/"actual-revision"' },
    ]);
    expect(observed).toEqual([
      {
        method: "HEAD",
        url,
        headers: [
          { name: "if-match", value: '"actual-revision"' },
          { name: "if-none-match", value: 'W/"actual-revision"' },
          { name: "Accept", value: "*/*" },
        ],
        writeState: "complete",
        status: 304,
      },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("rejects unsafe, colliding, accessor and unresolved headers before execution", async () => {
  let calls = 0;
  const execute: RawHttpExchangeExecutor = async () => {
    calls++;
    throw Error("must not execute");
  };
  const adapted = exactNativeReadAdapter(execute, () => {
    throw Error("must not observe");
  });
  for (const headers of [
    { authorization: "secret" },
    { "if-match": '"a"', "If-Match": '"b"' },
    { "if-match": "x\r\nHost: bad" },
    { "if-match": { etagFrom: "earlier" } },
    Object.defineProperty({}, "accept", {
      enumerable: true,
      get() {
        throw Error("getter invoked");
      },
    }),
  ])
    await expect(
      adapted({
        method: "GET",
        url: "https://read.invalid/acme/",
        headers: headers as Record<string, string>,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("unsafe or unresolved");
  expect(calls).toBe(0);
});

it.each(["anonymous", "operator"])(
  "uses the same %s default credential on raw and semantic Reads",
  async (defaultCredentialRef) => {
    const wire: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      wire.push(request.headers.authorization);
      response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw Error("listener missing");
      const scope = "https://read.invalid/acme/";
      const execute = createRawHttpExchangeExecutor(
        { host: "127.0.0.1", port: address.port, transport: "plain" },
        {
          exactMode: {
            scope,
            profile: "read-update",
            routes: [{ method: "GET", url: scope }],
            maximumRequestBodyBytes: 1024,
            maximumRequestHeaderBytes: 4096,
            defaultCredentialRef,
            credentialHandles: [
              { id: "anonymous", headerNames: [] },
              { id: "operator", headerNames: ["authorization"] },
            ],
            resolveCredentials: ({ credentialRef }) =>
              credentialRef === "anonymous"
                ? {}
                : { authorization: "Bearer synthetic_test_credential" },
          },
        },
      );
      const adapted = exactNativeReadAdapter(execute, () => {});
      await adapted({
        method: "GET",
        url: scope,
        signal: AbortSignal.timeout(5000),
        raw: { headerLines: [] },
      });
      await adapted({ method: "GET", url: scope, signal: AbortSignal.timeout(5000), headers: {} });
      expect(wire).toEqual(
        defaultCredentialRef === "anonymous"
          ? [undefined, undefined]
          : ["Bearer synthetic_test_credential", "Bearer synthetic_test_credential"],
      );
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  },
);

it("accepts semantically equal reordered seed documents but rejects changed values", async () => {
  const { seedInstalledReadFixture } = await import("../test-support/installed-read-fixture.js");
  const fixtureSource = (
    await import("../../../packages/conformance/fixtures/read-update-reference-v1.json", {
      with: { type: "json" },
    })
  ).default;
  const fixture = { ...fixtureSource, fixtureVersion: 1 as const };
  let corrupt = false;
  const reverse = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverse)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, item]) => [key, reverse(item)]),
          )
        : value;
  const server = createServer((request, response) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      const body = JSON.parse(text);
      const resource = {
        ...body,
        id: new URL(body.id, "https://read.invalid/acme/").href,
        properties: reverse(body.properties),
        metadata: corrupt ? { changed: true } : reverse(body.metadata),
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ outcome: "created", resource }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("listener missing");
    const scope = "https://read.invalid/acme/";
    const execute = createRawHttpExchangeExecutor(
      { host: "127.0.0.1", port: address.port, transport: "plain" },
      {
        exactMode: {
          scope,
          profile: "read-update",
          routes: ["bead", "link"].map((kind) => ({
            method: "POST",
            url: `${scope}operations/create-${kind}`,
          })),
          maximumRequestBodyBytes: 65536,
          maximumRequestHeaderBytes: 4096,
          defaultCredentialRef: "operator",
          credentialHandles: [{ id: "operator", headerNames: [] }],
          resolveCredentials: () => ({}),
        },
      },
    );
    let observed = 0;
    await seedInstalledReadFixture(
      fixture,
      scope,
      execute,
      AbortSignal.timeout(5000),
      () => observed++,
    );
    expect(observed).toBe(4);
    corrupt = true;
    await expect(
      seedInstalledReadFixture(fixture, scope, execute, AbortSignal.timeout(5000), () => {}),
    ).rejects.toThrow("disagreed with fixture");
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});
