/** Independent public HTTP acceptance. Explicit batch1 provisioning; no historical TX suite. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJsonSchemaValidator } from "@bdp/conformance";
import { afterEach, describe, expect, it } from "vitest";
import { startReferenceService } from "../../../packages/server/src/reference.js";

const media = "application/vnd.bdp.v0.1+json",
  capability = "https://github.com/gastownhall/bdp/capabilities/atomic-batch";
const scope = "https://records.invalid/atomic/",
  token = "x".repeat(32);
const type = { uri: "https://types.invalid/Record", revision: "definition-exact" };
const validate = createJsonSchemaValidator(
  JSON.parse(
    readFileSync(
      new URL("../../../specs/profiles/core/bdp-v0.1.schema.json", import.meta.url),
      "utf8",
    ),
  ),
);
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse())
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  if (errors.length) throw new AggregateError(errors, "atomic public cleanup");
});
async function fixture(atomicBatch = true) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-public-batch-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    directory,
    create: true,
    instance: "independent-batch-wire",
    scope,
    credentials: [{ token, principal: "actor" }],
    atomicBatch,
  };
  const service = await startReferenceService(config);
  cleanups.push(() => service.close());
  return { service, config };
}
function wire(listen: string, target: string, body?: string, key?: string, accept = media) {
  return new Promise<{
    status: number;
    text: string;
    headers: import("node:http").IncomingHttpHeaders;
  }>((resolve, reject) => {
    const socket = new URL(listen),
      url = new URL(target);
    const req = request(
      {
        hostname: socket.hostname,
        port: socket.port,
        path: url.pathname + url.search,
        method: body === undefined ? "GET" : "POST",
        headers: {
          host: url.host,
          authorization: `Bearer ${token}`,
          accept,
          ...(body === undefined
            ? {}
            : {
                "content-type": media,
                "content-length": String(Buffer.byteLength(body)),
                ...(key === undefined ? {} : { "idempotency-key": key }),
              }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            text: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("bounded batch HTTP timeout")));
    req.end(body);
  });
}
const body = (operations: unknown[]) => JSON.stringify({ capabilityVersion: "1", operations });
async function operation(service: Awaited<ReturnType<typeof startReferenceService>>) {
  const discovery = await wire(service.listenUrl, service.navigation.description);
  expect(discovery.status).toBe(200);
  const document = JSON.parse(discovery.text);
  expect(document.capabilities[capability]["1"].operations).toEqual([
    "createBead",
    "updateBead",
    "deleteBead",
    "createLink",
    "updateLink",
    "deleteLink",
  ]);
  expect(document).not.toHaveProperty("events");
  return document.capabilities[capability]["1"].operation as string;
}
function schemaResult(text: string) {
  const value = JSON.parse(text);
  expect(validate.validate("#/$defs/atomicBatchResult", value)).toEqual([]);
  return value;
}

describe("selected atomic batch1 public reference wire", () => {
  it("derives batch discovery from opened mode and refuses format5 batch without claiming its key", async () => {
    const { service, config } = await fixture(false);
    const discovery = JSON.parse(
      (await wire(service.listenUrl, service.navigation.description)).text,
    );
    expect(discovery.capabilities?.[capability]).toBeUndefined();
    const refused = await wire(
      service.listenUrl,
      scope + "bdp/batch",
      body([{ operation: "createBead", id: "must-not-exist", type }]),
      "unclaimed",
    );
    expect(refused.status).toBe(422);
    expect(JSON.parse(refused.text)).toMatchObject({
      code: "capability-not-supported",
      capabilityVersion: "1",
    });
    expect((await wire(service.listenUrl, scope + "must-not-exist")).status).toBe(404);
    expect(
      (
        await wire(
          service.listenUrl,
          service.navigation.targets.createBead,
          JSON.stringify({ id: "ordinary", type }),
          "unclaimed",
        )
      ).status,
    ).toBe(200);
    await service.close();
    const reopened = await startReferenceService({ ...config, create: false });
    cleanups.push(() => reopened.close());
    const again = JSON.parse(
      (await wire(reopened.listenUrl, reopened.navigation.description)).text,
    );
    expect(again.capabilities?.[capability]).toBeUndefined();
  });
  it("uses all six CRUD kinds through the advertised target, preserves pins, and reopens exact outcomes", async () => {
    const { service, config } = await fixture(),
      target = await operation(service);
    const input = body([
      { operation: "createBead", id: "z-node", type, name: "node", properties: { initial: true } },
      {
        operation: "createLink",
        id: "a-edge",
        type,
        name: "edge",
        source: { uri: "@node", revision: "literal-pin" },
        target: "urn:external:one",
      },
      { operation: "updateBead", bead: "@node", metadata: { updated: true } },
      {
        operation: "updateLink",
        link: "@edge",
        target: { uri: "urn:external:two", revision: "external-pin" },
      },
    ]);
    const first = await wire(service.listenUrl, target, input, "six-create-update");
    expect(first.status).toBe(200);
    const result = schemaResult(first.text);
    expect(result.resources.map((row: { id: string }) => row.id)).toEqual([
      scope + "a-edge",
      scope + "z-node",
    ]);
    expect(result.resources[0].resource).toMatchObject({
      type,
      source: { uri: scope + "z-node", revision: "literal-pin" },
      target: { uri: "urn:external:two", revision: "external-pin" },
      metadata: {},
    });
    const deletion = body([
      { operation: "deleteLink", link: "a-edge" },
      { operation: "deleteBead", bead: "z-node" },
    ]);
    const removed = await wire(service.listenUrl, target, deletion, "six-delete");
    expect(removed.status).toBe(200);
    expect(
      schemaResult(removed.text).resources.map((row: { outcome: string }) => row.outcome),
    ).toEqual(["deleted", "deleted"]);
    await service.close();
    const reopened = await startReferenceService({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect((await wire(reopened.listenUrl, target, input, "six-create-update")).text).toBe(
      first.text,
    );
    expect((await wire(reopened.listenUrl, target, deletion, "six-delete")).text).toBe(
      removed.text,
    );
    expect((await wire(reopened.listenUrl, scope + "z-node")).status).toBe(404);
  });
  it("does not claim a key for unsupported versions and never exposes a valid member prefix", async () => {
    const { service } = await fixture(),
      target = await operation(service);
    const unsupported = await wire(
      service.listenUrl,
      target,
      '{"capabilityVersion":"future","futureBody":[null]}',
      "free-key",
    );
    expect(unsupported.status).toBe(422);
    expect(JSON.parse(unsupported.text)).toMatchObject({
      capability,
      capabilityVersion: "future",
      pointer: "/capabilityVersion",
      code: "capability-not-supported",
    });
    const refused = await wire(
      service.listenUrl,
      target,
      body([
        { operation: "createBead", id: "no-prefix", type },
        { operation: "deleteBead", bead: "absent" },
      ]),
      "free-key",
    );
    expect(refused.status).toBe(404);
    expect((await wire(service.listenUrl, scope + "no-prefix")).status).toBe(404);
    const creation = await wire(
      service.listenUrl,
      service.navigation.targets.createBead,
      JSON.stringify({ id: "no-prefix", type }),
      "fresh-identity",
    );
    expect(creation.status).toBe(200);
    expect(
      (
        await wire(
          service.listenUrl,
          target,
          body([{ operation: "createBead", id: "no-prefix", type }]),
          "free-key",
        )
      ).status,
    ).toBe(409);
  });
  it("rejects malformed handles and keeps singleton and batch keys in one namespace", async () => {
    const { service } = await fixture(),
      target = await operation(service);
    const bad = await wire(
      service.listenUrl,
      target,
      body([{ operation: "createLink", type, source: "@future", target: "urn:opaque:x" }]),
      "same-key",
    );
    expect(bad.status).toBe(400);
    const singleton = await wire(
      service.listenUrl,
      service.navigation.targets.createBead,
      JSON.stringify({ id: "node", type }),
      "same-key",
    );
    expect(singleton.status).toBe(200);
    const conflict = await wire(
      service.listenUrl,
      target,
      body([{ operation: "updateBead", bead: "node", properties: {} }]),
      "same-key",
    );
    expect(conflict.status).toBe(409);
    expect(JSON.parse(conflict.text).code).toBe("idempotency-conflict");
  });
});
