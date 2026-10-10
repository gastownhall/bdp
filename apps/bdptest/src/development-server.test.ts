import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createReadUpdateFetchTransport, BdpReadUpdateClient } from "@bdp/client";
import { parseReadUpdateMutationResult } from "@bdp/protocol";
import {
  startDevelopmentReferenceServer,
  DEVELOPMENT_BEAD_TYPE,
  DEVELOPMENT_LINK_TYPE,
} from "@bdp/server/development";

const token = "development_test_credential_0123456789";
const dirs: string[] = [];
const servers: Awaited<ReturnType<typeof startDevelopmentReferenceServer>>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(path.join(tmpdir(), "bdptest-development-"));
  dirs.push(dir);
  return dir;
}
async function start(dir = directory(), port = 0, create = true) {
  const server = await startDevelopmentReferenceServer({ directory: dir, port, create, token });
  servers.push(server);
  const transport = createReadUpdateFetchTransport({
    scope: server.scope,
    credential: () => token,
    limits: {
      requestBodyBytes: 128 * 1024,
      responseBodyBytes: 2 * 1024 * 1024,
      responseTimeoutMs: 5000,
      cleanupTimeoutMs: 1000,
    },
  });
  return {
    server,
    dir,
    transport,
    post: (operation: string, input: unknown, key: string) =>
      transport.post(`${server.scope}development/${operation}`, {
        bodyText: JSON.stringify(input),
        idempotencyKey: key,
      }),
    get: (relative: string) => transport.get(new URL(relative, server.scope).href),
  };
}
function jsonBody(
  response: Awaited<ReturnType<ReturnType<typeof createReadUpdateFetchTransport>["get"]>>,
) {
  if (response.kind !== "json") throw new Error("expected JSON response");
  return response.body;
}
function resource(
  response: Awaited<ReturnType<ReturnType<typeof createReadUpdateFetchTransport>["get"]>>,
) {
  expect(response.status).toBe(200);
  const result = parseReadUpdateMutationResult(jsonBody(response));
  if (!("resource" in result)) throw new Error("expected live mutation result");
  return result.resource;
}

describe("non-attesting bdptest HTTP development authority", () => {
  it("persists create/read/guarded update/delete and retained replay across reopen", async () => {
    const h = await start();
    const create = {
      id: "beads/a",
      type: DEVELOPMENT_BEAD_TYPE,
      properties: { title: "before" },
      metadata: { origin: "test" },
      attribution: { principal: "writer", basis: "writer-supplied" },
    };
    const created = resource(await h.post("create-bead", create, "create_a"));
    expect(created).toMatchObject({
      properties: { title: "before" },
      metadata: { origin: "test" },
      attribution: { principal: "writer", basis: "writer-supplied" },
    });
    expect(jsonBody(await h.get("beads/a"))).toEqual(created);
    expect(resource(await h.post("create-bead", create, "create_a"))).toEqual(created);
    expect(
      await h.post("create-bead", { ...create, properties: { title: "conflict" } }, "create_a"),
    ).toMatchObject({ status: 409, body: { code: "idempotency-conflict" } });
    const update = {
      bead: "beads/a",
      expectedRevision: created.revision,
      propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
      metadataChange: [{ op: "add", path: "/reviewed", value: true }],
    };
    const updated = resource(await h.post("update-bead", update, "update_a"));
    expect(updated.revision).not.toBe(created.revision);
    expect(updated).toMatchObject({
      properties: { title: "after" },
      metadata: { origin: "test", reviewed: true },
    });
    expect(await h.post("update-bead", update, "stale_a")).toMatchObject({
      status: 409,
      body: { code: "revision-mismatch" },
    });
    expect(jsonBody(await h.get("beads/a"))).toEqual(updated);
    const noop = resource(
      await h.post("update-bead", { ...update, expectedRevision: updated.revision }, "noop_a"),
    );
    expect(noop.revision).toBe(updated.revision);
    const port = Number(new URL(h.server.scope).port);
    await h.server.close();
    const reopened = await start(h.dir, port, false);
    expect(jsonBody(await reopened.get("beads/a"))).toEqual(updated);
    expect(resource(await reopened.post("update-bead", update, "update_a"))).toEqual(updated);
    expect(await reopened.post("update-bead", update, "stale_a")).toMatchObject({
      status: 409,
      body: { code: "revision-mismatch" },
    });
    const deletion = { bead: "beads/a", expectedRevision: updated.revision };
    const deleted = await reopened.post("delete-bead", deletion, "delete_a");
    expect(deleted).toMatchObject({ status: 200, body: { outcome: "deleted" } });
    expect(await reopened.get("beads/a")).toMatchObject({ status: 404 });
    expect(jsonBody(await reopened.post("delete-bead", deletion, "delete_a"))).toEqual(
      jsonBody(deleted),
    );
    expect(await reopened.post("create-bead", create, "new_create_a")).toMatchObject({
      status: 409,
      body: { code: "identity-taken" },
    });
  });

  it("shares live Link state with reads and atomically rejects unsafe Bead deletion", async () => {
    const h = await start();
    const bead = resource(
      await h.post("create-bead", { id: "beads/a", type: DEVELOPMENT_BEAD_TYPE }, "bead"),
    );
    const link = resource(
      await h.post(
        "create-link",
        {
          id: "links/l",
          type: DEVELOPMENT_LINK_TYPE,
          source: bead.id,
          target: bead.id,
          properties: { weight: 1 },
          metadata: { note: "kept" },
        },
        "link",
      ),
    );
    expect(jsonBody(await h.get("links/l"))).toEqual(link);
    expect(
      await h.post("delete-bead", { bead: bead.id, expectedRevision: bead.revision }, "unsafe"),
    ).toMatchObject({ status: 409, body: { code: "incident-links-exist" } });
    expect(jsonBody(await h.get("beads/a"))).toEqual(bead);
    const changed = resource(
      await h.post(
        "update-link",
        {
          link: link.id,
          expectedRevision: link.revision,
          metadataChange: [{ op: "replace", path: "", value: {} }],
        },
        "link_update",
      ),
    );
    expect(changed.metadata).toEqual({});
    expect(changed.properties).toEqual({ weight: 1 });
    expect(jsonBody(await h.get("links/l"))).toEqual(changed);
    expect(
      await h.post("delete-link", { link: link.id, expectedRevision: changed.revision }, "unlink"),
    ).toMatchObject({ status: 200 });
    expect(
      await h.post("delete-bead", { bead: bead.id, expectedRevision: bead.revision }, "safe"),
    ).toMatchObject({ status: 200 });
  });

  it("does not grant discovery admission and refuses uncredentialed, foreign-origin and oversized input before mutation", async () => {
    const h = await start();
    const landing = await h.get("");
    expect(jsonBody(landing)).toMatchObject({ development: true, claimEligible: false });
    expect(landing.headers.link).toBeUndefined();
    const client = new BdpReadUpdateClient({
      scope: h.server.scope,
      transport: h.transport,
      settlementTimeoutMs: 5000,
    });
    await expect(client.discover()).rejects.toThrow();
    client.close();
    expect((await fetch(h.server.scope)).status).toBe(401);
    const endpoint = `${h.server.scope}development/create-bead`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "receiving",
    };
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { ...headers, origin: "https://example.test" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(endpoint, { method: "POST", headers, body: "x".repeat(65 * 1024) })).status,
    ).toBe(413);
    expect((await fetch(endpoint, { method: "POST", headers, body: "{" })).status).toBe(400);
    const valid = await h.post(
      "create-bead",
      { id: "beads/receiving", type: DEVELOPMENT_BEAD_TYPE },
      "receiving",
    );
    expect(valid.status).toBe(200); // Every refusal above left the key unclaimed.
  });

  it("rejects duplicate singleton keys before admission", async () => {
    const h = await start();
    const input = JSON.stringify({ id: "beads/raw", type: DEVELOPMENT_BEAD_TYPE });
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${h.server.scope}development/create-bead`,
        {
          method: "POST",
          headers: [
            "Host",
            new URL(h.server.scope).host,
            "Authorization",
            `Bearer ${token}`,
            "Content-Type",
            "application/json",
            "Content-Length",
            String(Buffer.byteLength(input)),
            "Idempotency-Key",
            "raw",
            "Idempotency-Key",
            "raw",
          ],
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        },
      );
      request.setTimeout(5000, () => request.destroy(new Error("request timed out")));
      request.once("error", reject);
      request.end(input);
    });
    expect(status).toBe(400);
    expect((await h.post("create-bead", JSON.parse(input), "raw")).status).toBe(200);
  });

  it("requires explicit provisioning and refuses reseeding an existing Scope", async () => {
    const dir = directory();
    await expect(start(dir, 0, false)).rejects.toThrow("missing");
    const h = await start(dir);
    await h.server.close();
    await expect(start(dir, Number(new URL(h.server.scope).port), true)).rejects.toThrow();
    const reopened = await start(dir, Number(new URL(h.server.scope).port), false);
    expect((await reopened.get("beads/")).status).toBe(200);
  });
});
