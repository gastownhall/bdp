import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { rawPost } from "../test-support/raw-development-http.js";
import { afterEach, describe, expect, it } from "vitest";
import { createReadUpdateFetchTransport, BdpReadUpdateClient } from "@bdp/client";
import {
  parseBeadRecord,
  parseLinkRecord,
  parseReadUpdateProblem,
  parseReadUpdateMutationResult,
  parseReadUpdateSequenceResponse,
} from "@bdp/protocol";
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
    sequence: (input: unknown) =>
      transport.post(`${server.scope}development/sequence`, { bodyText: JSON.stringify(input) }),
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
  it("refuses the preceding installation without changing its existing store", async () => {
    const first = await start();
    await first.post(
      "create-bead",
      { type: DEVELOPMENT_BEAD_TYPE, properties: { retained: true } },
      "retained",
    );
    const port = Number(new URL(first.server.scope).port);
    await first.server.close();
    const file = path.join(first.dir, "reference.sqlite");
    const raw = new DatabaseSync(file);
    try {
      raw
        .prepare("UPDATE metadata SET value=? WHERE name IN ('installation','lineage')")
        .run("bdptest-development-1-metadata-basis");
    } finally {
      raw.close();
    }
    const before = readFileSync(file);
    await expect(start(first.dir, port, false)).rejects.toThrow(
      "store format/Scope/installation/lineage mismatch",
    );
    expect(readFileSync(file)).toEqual(before);
  });

  it("persists create/read/guarded update/delete and retained replay across reopen", async () => {
    const h = await start();
    const create = {
      id: "beads/a",
      type: DEVELOPMENT_BEAD_TYPE,
      properties: { title: "before" },
      metadata: { origin: "test" },
      revisionProvenance: { actor: { id: "writer", basis: "writer-supplied" } },
    };
    const created = resource(await h.post("create-bead", create, "create_a"));
    expect(created).toMatchObject({
      properties: { title: "before" },
      metadata: { origin: "test" },
      revisionProvenance: { actor: { id: "writer", basis: "writer-supplied" } },
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

  it("puts, retargets, resolves and deletes aliases without changing Bead revisions", async () => {
    const h = await start();
    const a = resource(
      await h.post("create-bead", { id: "beads/a", type: DEVELOPMENT_BEAD_TYPE }, "a"),
    );
    const b = resource(
      await h.post("create-bead", { id: "beads/b", type: DEVELOPMENT_BEAD_TYPE }, "b"),
    );
    const put = { alias: "alias/latest", target: "beads/a" };
    const first = await h.post("put-alias", put, "alias_first");
    expect(first).toMatchObject({
      status: 200,
      body: { outcome: "created", alias: `${h.server.scope}alias/latest`, target: a.id },
    });
    const redirect = await fetch(`${h.server.scope}alias/latest`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("x-bdp-development")).toBe("non-attesting");
    expect(redirect.headers.get("location")).toBe(a.id);
    await redirect.body?.cancel();
    const retarget = await h.post("put-alias", { ...put, target: b.id }, "alias_second");
    expect(retarget).toMatchObject({ status: 200, body: { target: b.id } });
    expect(jsonBody(await h.get("beads/a"))).toEqual(a);
    expect(jsonBody(await h.get("beads/b"))).toEqual(b);
    expect(jsonBody(await h.post("put-alias", put, "alias_first"))).toEqual(jsonBody(first));
    expect(await h.post("put-alias", { ...put, target: b.id }, "alias_first")).toMatchObject({
      status: 409,
      body: { code: "idempotency-conflict" },
    });
    expect(
      await h.post("put-alias", { alias: "alias/a", target: b.id }, "collision"),
    ).toMatchObject({ status: 409, body: { code: "identity-taken" } });
    const deletion = await h.post("delete-alias", { alias: put.alias }, "alias_delete");
    expect(deletion).toMatchObject({ status: 200, body: { outcome: "deleted" } });
    expect(await h.get(put.alias)).toMatchObject({ status: 404 });
    expect(jsonBody(await h.post("delete-alias", { alias: put.alias }, "alias_delete"))).toEqual(
      jsonBody(deletion),
    );
  });

  it("commits ordered local-reference sequences and replays each member across restart", async () => {
    const h = await start();
    const input = {
      operations: [
        {
          operation: "createBead",
          idempotencyKey: "seq_bead",
          name: "a",
          type: DEVELOPMENT_BEAD_TYPE,
        },
        {
          operation: "createLink",
          idempotencyKey: "seq_link",
          name: "l",
          type: DEVELOPMENT_LINK_TYPE,
          source: "@a",
          target: "@a",
        },
        { operation: "putAlias", idempotencyKey: "seq_alias", alias: "alias/first", target: "@a" },
        {
          operation: "updateBead",
          idempotencyKey: "seq_update",
          bead: "@a",
          propertiesChange: [{ op: "add", path: "/ready", value: true }],
        },
      ],
    };
    const response = await h.sequence(input);
    expect(response.status).toBe(200);
    const result = parseReadUpdateSequenceResponse(jsonBody(response));
    expect(result.results).toMatchObject([
      { operationIndex: 0, operationName: "a", outcome: "created" },
      { operationIndex: 1, operationName: "l", outcome: "created" },
      { operationIndex: 2, outcome: "created" },
      { operationIndex: 3, outcome: "updated", resource: { properties: { ready: true } } },
    ]);
    const first = result.results[0];
    const link = result.results[1];
    const updated = result.results[3];
    if (
      !first ||
      !link ||
      !updated ||
      !("resource" in first) ||
      !("resource" in link) ||
      !("resource" in updated)
    )
      throw new Error("missing resource");
    const firstBead = parseBeadRecord(first.resource);
    const firstLink = parseLinkRecord(link.resource);
    expect(firstLink).toMatchObject({ source: firstBead.id, target: firstBead.id });
    expect(jsonBody(await h.get(firstBead.id))).toEqual(updated.resource);
    expect(jsonBody(await h.sequence(input))).toEqual(result);
    await h.server.close();
    const reopened = await start(h.dir, Number(new URL(h.server.scope).port), false);
    expect(jsonBody(await reopened.sequence(input))).toEqual(result);
    expect(jsonBody(await reopened.get(firstLink.id))).toEqual(link.resource);
    const aliasRead = await fetch(`${reopened.server.scope}alias/first`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    expect(aliasRead.headers.get("location")).toBe(firstBead.id);
    await aliasRead.body?.cancel();
    const changed = structuredClone(input);
    const changedCreator = changed.operations[0];
    if (!changedCreator) throw new Error("missing creator");
    changedCreator.type = DEVELOPMENT_LINK_TYPE;
    const conflict = parseReadUpdateSequenceResponse(jsonBody(await reopened.sequence(changed)));
    expect(conflict.results[0]).toMatchObject({ code: "idempotency-conflict", operationIndex: 0 });
  });

  it("shares retained keys between singleton and sequence carriers", async () => {
    const h = await start();
    const create = { id: "beads/shared", type: DEVELOPMENT_BEAD_TYPE };
    const singleton = resource(await h.post("create-bead", create, "shared_create"));
    const operations = [
      { ...create, operation: "createBead", idempotencyKey: "shared_create", name: "shared" },
      {
        operation: "putAlias",
        idempotencyKey: "shared_alias",
        alias: "alias/shared-name",
        target: "@shared",
      },
    ];
    const result = parseReadUpdateSequenceResponse(jsonBody(await h.sequence({ operations })));
    expect(result.results[0]).toMatchObject({
      operationIndex: 0,
      operationName: "shared",
      resource: singleton,
    });
    const alias = await h.post(
      "put-alias",
      { alias: "alias/shared-name", target: singleton.id },
      "shared_alias",
    );
    const aliasMember = result.results[1];
    if (!aliasMember) throw new Error("missing alias result");
    const { operationIndex: _index, ...retainedAlias } = aliasMember;
    expect(jsonBody(alias)).toEqual(retainedAlias);
    const changed = { operations: [{ ...operations[0], properties: { different: true } }] };
    expect(
      parseReadUpdateSequenceResponse(jsonBody(await h.sequence(changed))).results[0],
    ).toMatchObject({ code: "idempotency-conflict" });
  });

  it("retains successful prefixes, reports failures in order and continues independent members", async () => {
    const h = await start();
    const a = resource(
      await h.post("create-bead", { id: "beads/a", type: DEVELOPMENT_BEAD_TYPE }, "seed"),
    );
    const input = {
      operations: [
        {
          operation: "updateBead",
          idempotencyKey: "good",
          bead: a.id,
          expectedRevision: a.revision,
          propertiesChange: [{ op: "add", path: "/n", value: 1 }],
        },
        {
          operation: "updateBead",
          idempotencyKey: "stale",
          bead: a.id,
          expectedRevision: a.revision,
          propertiesChange: [{ op: "add", path: "/n", value: 2 }],
        },
        {
          operation: "createBead",
          idempotencyKey: "bad_create",
          name: "bad",
          id: "beads/a",
          type: DEVELOPMENT_BEAD_TYPE,
        },
        { operation: "putAlias", idempotencyKey: "dependent", alias: "alias/bad", target: "@bad" },
        {
          operation: "createBead",
          idempotencyKey: "last",
          id: "beads/last",
          type: DEVELOPMENT_BEAD_TYPE,
        },
      ],
    };
    const response = await h.sequence(input);
    expect(response.status).toBe(200);
    const result = parseReadUpdateSequenceResponse(jsonBody(response));
    expect(result.results).toMatchObject([
      { operationIndex: 0, outcome: "updated" },
      { operationIndex: 1, code: "revision-mismatch" },
      { operationIndex: 2, code: "identity-taken" },
      { operationIndex: 3, code: "binding-unavailable" },
      { operationIndex: 4, outcome: "created" },
    ]);
    expect(jsonBody(await h.get(a.id))).toMatchObject({ properties: { n: 1 } });
    expect(await h.get("beads/last")).toMatchObject({ status: 200 });
    expect(await h.get("alias/bad")).toMatchObject({ status: 404 });
    expect(jsonBody(await h.sequence(input))).toEqual(result);
    await h.server.close();
    const reopened = await start(h.dir, Number(new URL(h.server.scope).port), false);
    expect(jsonBody(await reopened.sequence(input))).toEqual(result);
  });

  it("recovers a committed sequence when its HTTP response is discarded", async () => {
    const h = await start();
    const input = {
      operations: [
        {
          operation: "createBead",
          idempotencyKey: "lost_bead",
          name: "lost",
          type: DEVELOPMENT_BEAD_TYPE,
          properties: { text: "x".repeat(48 * 1024) },
        },
        {
          operation: "putAlias",
          idempotencyKey: "lost_alias",
          alias: "alias/lost",
          target: "@lost",
        },
      ],
    };
    const text = JSON.stringify(input);
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        `${h.server.scope}development/sequence`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(text),
          },
        },
        (response) => {
          // Headers establish that the admitted sequence finished. Discard its
          // result without parsing/retaining any disposition, then recover by key.
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error("sequence failed"));
            return;
          }
          response.destroy();
          resolve();
        },
      );
      request.setTimeout(5000, () => request.destroy(new Error("request timed out")));
      request.once("error", reject);
      request.end(text);
    });
    const recovered = parseReadUpdateSequenceResponse(jsonBody(await h.sequence(input)));
    expect(recovered.results).toMatchObject([{ outcome: "created" }, { outcome: "created" }]);
    const first = recovered.results[0];
    if (!first || !("resource" in first)) throw new Error("missing retained resource");
    const bead = parseBeadRecord(first.resource);
    expect(jsonBody(await h.get(bead.id))).toEqual(bead);
    expect(jsonBody(await h.sequence(input))).toEqual(recovered);
  });

  it("rejects malformed or oversized carriers and stray carrier keys before any member executes", async () => {
    const h = await start();
    const first = {
      operation: "createBead",
      idempotencyKey: "first",
      id: "beads/first",
      type: DEVELOPMENT_BEAD_TYPE,
    };
    const bad = {
      operation: "putAlias",
      idempotencyKey: "bad",
      alias: "alias/bad?query",
      target: "beads/first",
    };
    expect(await h.sequence({ operations: [first, bad] })).toMatchObject({ status: 400 });
    expect(await h.post("sequence", { operations: [first] }, "stray")).toMatchObject({
      status: 400,
    });
    expect(
      await h.sequence({ operations: [first, { ...first, id: "beads/other" }] }),
    ).toMatchObject({ status: 400 });
    expect(
      await h.sequence({
        operations: Array.from({ length: 33 }, (_, i) => ({
          ...first,
          id: `beads/item${i}`,
          idempotencyKey: `item${i}`,
        })),
      }),
    ).toMatchObject({ status: 413 });
    expect(await h.get("beads/first")).toMatchObject({ status: 404 });
    expect(await h.get("beads/item0")).toMatchObject({ status: 404 });
    const result = parseReadUpdateSequenceResponse(
      jsonBody(await h.sequence({ operations: [first] })),
    );
    expect(result.results[0]).toMatchObject({ outcome: "created" });
  });

  it("serves conditional GET/HEAD with Resource ETags and ordinary refusals first", async () => {
    const h = await start();
    const created = resource(
      await h.post("create-bead", { id: "beads/http", type: DEVELOPMENT_BEAD_TYPE }, "http"),
    );
    const url = `${h.server.scope}beads/http`;
    const headers = { authorization: `Bearer ${token}` };
    const get = await fetch(url, { headers });
    const etag = get.headers.get("etag");
    expect(etag).toBe(`"${created.revision}"`);
    const bytes = await get.text();
    const head = await fetch(url, { method: "HEAD", headers });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(bytes)));
    expect(await head.text()).toBe("");
    for (const method of ["GET", "HEAD"]) {
      for (const [condition, status] of [
        { "if-none-match": etag },
        { "if-none-match": `W/${etag}` },
      ].map((condition) => [condition, 304] as const)) {
        const r = await fetch(url, {
          method,
          headers: { ...headers, ...condition } as Record<string, string>,
        });
        expect(r.status).toBe(status);
        expect(r.headers.get("etag")).toBe(etag);
        expect(r.headers.get("content-type")).toBeNull();
        expect(await r.text()).toBe("");
      }
      const mismatch = await fetch(url, { method, headers: { ...headers, "if-match": '"wrong"' } });
      expect(mismatch.status).toBe(412);
      expect(await mismatch.text()).toBe("");
    }
    const absent = await fetch(`${h.server.scope}beads/missing`, {
      headers: { ...headers, "if-none-match": "*", accept: "text/plain" },
    });
    expect(absent.status).toBe(404);
    expect(parseReadUpdateProblem(await absent.json()).code).toBe("resource-not-found");
    const denied = await fetch(url, { headers: { "if-none-match": "*" } });
    expect(denied.status).toBe(401);
    expect(parseReadUpdateProblem(await denied.json()).code).toBe("unauthenticated");
    const noTag = await fetch(`${h.server.scope}beads/`, {
      headers: { ...headers, "if-none-match": "*" },
    });
    expect(noTag.status).toBe(304);
    expect(noTag.headers.get("etag")).toBeNull();
    expect(await noTag.text()).toBe("");
  });

  it("uses media-range quality for reads and keeps HEAD Problems bodyless", async () => {
    const h = await start();
    for (const [accept, status] of [
      ["application/json;q=0, */*;q=1", 406],
      ["text/plain", 406],
      ["application/*;q=0.5", 200],
      ["application/json; charset=utf-8", 406],
    ] as const) {
      const response = await fetch(`${h.server.scope}beads/`, {
        headers: { authorization: `Bearer ${token}`, accept },
      });
      expect(response.status).toBe(status);
      expect(response.headers.get("vary")).toContain("Accept");
      if (status === 406) {
        expect(response.headers.get("content-type")).toBeNull();
        expect(await response.text()).toBe("");
      } else await response.body?.cancel();
    }
    const head = await fetch(`${h.server.scope}beads/missing`, {
      method: "HEAD",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(head.status).toBe(404);
    expect(head.headers.get("content-type")).toBe("application/problem+json");
    expect(await head.text()).toBe("");
    for (const [target, method, allow] of [
      ["beads/", "POST", "GET, HEAD"],
      ["development/create-bead", "GET", "POST"],
      ["beads/", "OPTIONS", "GET, HEAD"],
    ] as const) {
      const response = await fetch(`${h.server.scope}${target}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe(allow);
      expect(await response.text()).toBe("");
    }
  });

  it("refuses unknown development operations before method or key admission", async () => {
    const h = await start();
    const input = { id: "beads/unknown-route", type: DEVELOPMENT_BEAD_TYPE };
    const unknown = await h.post("not-an-operation", input, "unknown_route");
    expect(unknown.status).toBe(404);
    expect(parseReadUpdateProblem(jsonBody(unknown))).toMatchObject({
      code: "resource-not-found",
    });
    expect(unknown.headers.allow).toBeUndefined();
    for (const method of ["GET", "HEAD", "PUT"]) {
      const response = await fetch(`${h.server.scope}development/not-an-operation`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("allow")).toBeNull();
      if (method === "HEAD") expect(await response.text()).toBe("");
      else
        expect(parseReadUpdateProblem(await response.json())).toMatchObject({
          code: "resource-not-found",
        });
    }
    expect(await h.get(input.id)).toMatchObject({ status: 404 });
    expect(resource(await h.post("create-bead", input, "unknown_route")).id).toBe(
      `${h.server.scope}${input.id}`,
    );
  });

  it("returns BDP receiving Problems without capturing keys and ignores request media parameters", async () => {
    const h = await start();
    const url = `${h.server.scope}development/create-bead`;
    const input = { id: "beads/media", type: DEVELOPMENT_BEAD_TYPE };
    const headers = { authorization: `Bearer ${token}`, "idempotency-key": "media" };
    for (const contentType of [undefined, "text/plain"]) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...headers,
          ...(contentType === undefined ? {} : { "content-type": contentType }),
        },
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(415);
      expect(parseReadUpdateProblem(await response.json())).toMatchObject({
        code: "unsupported-media-type",
        status: 415,
        retry: "never",
      });
    }
    const malformed = await fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "{",
    });
    expect(parseReadUpdateProblem(await malformed.json())).toMatchObject({
      code: "malformed-request",
      status: 400,
    });
    const large = await fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: " ".repeat(65537),
    });
    expect(parseReadUpdateProblem(await large.json())).toMatchObject({
      code: "request-too-large",
      status: 413,
    });
    expect(await h.get(input.id)).toMatchObject({ status: 404 });
    const accepted = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "Application/JSON; charset=utf-8",
        "if-match": '"not-a-resource-guard"',
      },
      body: JSON.stringify(input),
    });
    expect(accepted.status).toBe(200);
    await accepted.body?.cancel();
  });

  it("rejects hostile raw targets, wrong Host and duplicate credentials before key capture", async () => {
    const h = await start();
    const body = JSON.stringify({ id: "beads/raw-safe", type: DEVELOPMENT_BEAD_TYPE });
    const host = new URL(h.server.scope).host;
    const base = [
      "Host",
      host,
      "Authorization",
      `Bearer ${token}`,
      "Content-Type",
      "application/json",
      "Idempotency-Key",
      "raw_safe",
      "Content-Length",
      String(Buffer.byteLength(body)),
    ];
    for (const target of [
      "/x/../development/create-bead",
      "/x/%2e%2e/development/create-bead",
      "/development\\create-bead",
      "/development/create-bead#x",
      "//foreign/development/create-bead",
    ]) {
      const r = await rawPost(h.server.scope, target, base, body);
      expect(r.status).toBe(400);
      expect(parseReadUpdateProblem(JSON.parse(r.body)).code).toBe("malformed-request");
    }
    const wrongHost = [...base];
    wrongHost[1] = "foreign.invalid";
    expect(
      (await rawPost(h.server.scope, "/development/create-bead", wrongHost, body)).status,
    ).toBe(400);
    expect(
      (
        await rawPost(
          h.server.scope,
          "/development/create-bead",
          [...base, "Authorization", `Bearer ${token}`],
          body,
        )
      ).status,
    ).toBe(400);
    expect(
      (await rawPost(h.server.scope, "/development/create-bead", [...base, "Host", host], body))
        .status,
    ).toBe(400);
    expect(await h.get("beads/raw-safe")).toMatchObject({ status: 404 });
    expect(await h.post("create-bead", JSON.parse(body), "raw_safe")).toMatchObject({
      status: 200,
    });
  });

  it("rejects malformed scalar JSON and oversized chunked input without claiming the key", async () => {
    const h = await start();
    const url = `${h.server.scope}development/create-bead`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "bad_scalar",
    };
    for (const body of ['{"type":"a","type":"b"}', '{"type":"\\ud800"}']) {
      const response = await fetch(url, { method: "POST", headers, body });
      expect(response.status).toBe(400);
      expect(parseReadUpdateProblem(await response.json()).code).toBe("malformed-request");
    }
    const rawHeaders = [
      "Host",
      new URL(h.server.scope).host,
      "Authorization",
      `Bearer ${token}`,
      "Content-Type",
      "application/json",
      "Idempotency-Key",
      "bad_scalar",
    ];
    const invalidUtf8 = await rawPost(
      h.server.scope,
      "/development/create-bead",
      rawHeaders,
      Buffer.from([0xc0, 0xaf]),
    );
    expect(invalidUtf8.status).toBe(400);
    expect(parseReadUpdateProblem(JSON.parse(invalidUtf8.body)).code).toBe("malformed-request");
    const huge = await rawPost(
      h.server.scope,
      "/development/create-bead",
      rawHeaders,
      " ".repeat(65537),
      true,
    );
    expect(huge.status).toBe(413);
    expect(parseReadUpdateProblem(JSON.parse(huge.body)).code).toBe("request-too-large");
    expect(
      await h.post(
        "create-bead",
        { id: "beads/scalar", type: DEVELOPMENT_BEAD_TYPE },
        "bad_scalar",
      ),
    ).toMatchObject({ status: 200 });
  });

  it("negotiates mutation JSON before admission while preserving retained conflict and failure", async () => {
    const h = await start();
    const input = { id: "beads/accept", type: DEVELOPMENT_BEAD_TYPE };
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "accept",
      accept: "application/json;q=0, */*;q=1",
    };
    const url = `${h.server.scope}development/create-bead`;
    const refused = await fetch(url, { method: "POST", headers, body: JSON.stringify(input) });
    expect(refused.status).toBe(406);
    expect(refused.headers.get("content-type")).toBeNull();
    expect(await refused.text()).toBe("");
    expect(await h.get(input.id)).toMatchObject({ status: 404 });
    const created = resource(await h.post("create-bead", input, "accept"));
    const retained = await fetch(url, { method: "POST", headers, body: JSON.stringify(input) });
    expect(retained.status).toBe(406);
    expect(await retained.text()).toBe("");
    const conflict = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, properties: { changed: true } }),
    });
    expect(conflict.status).toBe(409);
    expect(parseReadUpdateProblem(await conflict.json()).code).toBe("idempotency-conflict");
    expect(resource(await h.post("create-bead", input, "accept"))).toEqual(created);
    expect(await h.post("delete-bead", { bead: "beads/missing" }, "missing_accept")).toMatchObject({
      status: 404,
    });
    const failed = await fetch(`${h.server.scope}development/delete-bead`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "missing_accept" },
      body: JSON.stringify({ bead: "beads/missing" }),
    });
    expect(failed.status).toBe(404);
    expect(parseReadUpdateProblem(await failed.json()).code).toBe("resource-not-found");
    const sequence = {
      operations: [
        {
          ...input,
          id: "beads/sequence-accept",
          operation: "createBead",
          idempotencyKey: "sequence_accept",
        },
      ],
    };
    const seq = await fetch(`${h.server.scope}development/sequence`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "text/plain",
      },
      body: JSON.stringify(sequence),
    });
    expect(seq.status).toBe(406);
    expect(await seq.text()).toBe("");
    expect(await h.get("beads/sequence-accept")).toMatchObject({ status: 404 });
    expect(await h.sequence(sequence)).toMatchObject({ status: 200 });
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

it("labels numeric update request pointers in messages without claiming document locations", async () => {
  const f = await start();
  const created = resource(
    await f.post(
      "create-bead",
      { type: DEVELOPMENT_BEAD_TYPE, properties: { unchanged: true } },
      "numeric-target",
    ),
  );
  for (const document of ["properties", "metadata"]) {
    const bodyText = JSON.stringify({
      bead: created.id,
      [`${document}Change`]: [{ op: "add", path: "/items/-", value: "BAD" }],
    }).replace('"BAD"', "1e400");
    const response = await f.transport.post(`${f.server.scope}development/update-bead`, {
      bodyText,
      idempotencyKey: `bad-${document}`,
    });
    expect(response.status).toBe(422);
    const problem = parseReadUpdateProblem(jsonBody(response));
    expect(problem.diagnostics).toEqual([
      {
        message: `${document === "metadata" ? "metadata: " : ""}unsupported number at request location /${document}Change/0/value`,
        ...(document === "metadata" ? { document } : {}),
      },
    ]);
    expect(jsonBody(await f.get(created.id))).toEqual(created);
  }
});
