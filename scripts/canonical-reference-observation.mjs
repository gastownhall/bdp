/** Actual packed service/client witness; no global install or implicit store. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { request } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
export async function observeCanonicalReference(installRoot, temporaryRoot) {
  const consumer = createRequire(path.join(installRoot, "canonical-consumer.cjs"));
  const { startReferenceService } = await import(
    pathToFileURL(consumer.resolve("@bdp/server/reference")).href
  );
  const { RetainedClient, createRetainedFetchTransport } = await import(
    pathToFileURL(consumer.resolve("@bdp/client")).href
  );
  const scope = "https://installed-canonical.invalid/work/";
  const token = randomBytes(32).toString("base64url");
  const directory = await mkdtemp(path.join(temporaryRoot, "canonical-store-"));
  const config = {
    directory,
    create: true,
    instance: "installed-canonical",
    scope,
    credentials: [{ token, principal: "operator" }],
  };
  let server = await startReferenceService(config);
  try {
    // Explicit test proxy: preserve every canonical target/Host/header/body while
    // routing this one owned Scope to its private loopback listener.
    const fetcher = async (input, init = {}) => {
      const target = String(input);
      assert.ok(target.startsWith(scope));
      const logical = new URL(target),
        listener = new URL(server.listenUrl);
      const result = await new Promise((resolve, reject) => {
        const call = request(
          {
            hostname: listener.hostname,
            port: listener.port,
            path: logical.pathname + logical.search,
            method: init.method ?? "GET",
            headers: { ...Object.fromEntries(new Headers(init.headers)), host: logical.host },
            signal: init.signal,
          },
          (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("error", reject);
            response.on("end", () =>
              resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        call.on("error", reject);
        call.end(init.body);
      });
      const response = new Response(
        init.method === "HEAD" || [204, 304].includes(result.status) ? null : result.body,
        { status: result.status, headers: result.headers },
      );
      Object.defineProperty(response, "url", { value: target });
      return response;
    };
    const sdk = new RetainedClient({
      transport: createRetainedFetchTransport({
        fetchImplementation: fetcher,
        allowTarget: (target) => target.startsWith(scope),
        credentialForTarget: () => token,
        limits: {
          requestBodyBytes: 65536,
          responseBodyBytes: 262144,
          responseTimeoutMs: 3000,
          cleanupTimeoutMs: 100,
        },
      }),
      maximumDocumentBytes: 262144,
      maximumRequestBodyBytes: 65536,
      operationTimeoutMs: 10000,
    });
    const success = (reply) => {
      assert.equal(reply.kind, "success", JSON.stringify(reply));
      return reply;
    };
    const discovery = success(await sdk.inspectScope(scope)).value;
    assert.equal(discovery.beads, scope + "bdp/beads");
    assert.equal(discovery.events, undefined);
    assert.equal(discovery.capabilities, undefined);
    const binding = success(await sdk.bindWrite(scope)).value;
    const createA = binding.prepare(
      "createBead",
      JSON.stringify({
        id: "a",
        type: "https://types.invalid/ordinary",
        properties: { title: "first" },
      }),
      "installed-a",
    );
    const a = success(await sdk.submit(createA));
    assert.deepEqual(a.value.resource.metadata, {});
    success(
      await sdk.submit(
        binding.prepare(
          "createBead",
          JSON.stringify({ id: "b", type: "https://types.invalid/ordinary" }),
          "installed-b",
        ),
      ),
    );
    const first = success(await sdk.list({ scope, kind: "bead", limit: 1 }));
    assert.deepEqual(
      first.value.page.items.map((x) => x.id),
      [scope + "a"],
    );
    const oldNext = first.value.page.next;
    assert.equal(typeof oldNext, "string");
    const tail = success(await sdk.readPage({ url: oldNext, scope, collectionKind: "bead" }));
    assert.deepEqual(
      tail.value.page.items.map((x) => x.id),
      [scope + "b"],
    );
    assert.equal(tail.value.page.next, null);
    const edge = success(
      await sdk.submit(
        binding.prepare(
          "createLink",
          JSON.stringify({
            id: "edge",
            type: "https://types.invalid/edge",
            source: { uri: "a", revision: a.value.resource.revision },
            target: "b",
          }),
          "installed-edge",
        ),
      ),
    );
    const incident = success(
      await sdk.incident({ scope, bead: scope + "a", direction: "outbound" }),
    );
    assert.equal(incident.http.headers["bdp-resource-kind"], "bead");
    assert.equal(incident.value.page.items[0].id, edge.value.resource.id);
    success(
      await sdk.submit(
        binding.prepare(
          "putAlias",
          JSON.stringify({ alias: "aliases/one", target: "a" }),
          "installed-alias",
        ),
      ),
    );
    assert.equal(
      success(await sdk.resolveAlias(scope + "aliases/one", scope)).value.target,
      scope + "a",
    );
    success(
      await sdk.submit(
        binding.prepare(
          "updateBead",
          JSON.stringify({ bead: "a", metadata: { reviewed: true } }),
          "installed-update",
        ),
      ),
    );
    const point = success(await sdk.read({ reference: scope + "a", scope }));
    assert.deepEqual(point.value.body.metadata, { reviewed: true });
    const properties = success(
      await sdk.read({ reference: scope + "a", scope, view: "properties" }),
    );
    assert.deepEqual(properties.value.body, { title: "first" });
    await server.close();
    server = await startReferenceService({ ...config, create: false });
    const replay = success(await sdk.submit(createA));
    assert.deepEqual(replay.nativeBody, a.nativeBody);
    assert.equal(replay.value.resource.revision, a.value.resource.revision);
    assert.deepEqual(
      success(await sdk.read({ reference: scope + "a", scope })).value.body.metadata,
      { reviewed: true },
    );
    const expired = await sdk.readPage({ url: oldNext, scope, collectionKind: "bead" });
    assert.equal(expired.kind, "problem");
    assert.equal(expired.problem.code, "cursor-expired");
    assert.equal(
      success(await sdk.resolveAlias(scope + "aliases/one", scope)).value.target,
      scope + "a",
    );
    return {
      contract: "canonical-core-ordinary-write",
      packaged: true,
      nativePages: true,
      aliases: true,
      exactPins: true,
      reopened: true,
      durableOriginalReplay: true,
      optionalProfiles: [],
    };
  } finally {
    await server.close();
  }
}
