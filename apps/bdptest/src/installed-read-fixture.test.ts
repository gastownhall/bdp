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
