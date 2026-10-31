/** Independent HTTP alias witnesses for the incomplete private fixture. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJsonSchemaValidator } from "@bdp/conformance";
import { afterEach, describe, expect, it } from "vitest";
import { startPrivateRetainedFixture } from "../../../packages/server/src/retained-v01/http.js";

const media = "application/vnd.bdp.v0.1+json";
const token = "Q".repeat(32);
const scope = "https://records.invalid/alias-http/";
const navigation = {
  scope,
  aliases: `${scope}decisions/`,
  description: "https://discovery.invalid/about?owner=a",
  beads: "https://inventory.invalid/nodes?owner=a",
  links: "https://inventory.invalid/edges?owner=a",
  events: "https://observe.invalid/facts?owner=a",
  operations: "https://discovery.invalid/commands?owner=a",
  targets: {
    createBead: "https://invoke.invalid/z?slot=17",
    updateBead: "https://invoke.invalid/y?slot=31",
    deleteBead: "https://invoke.invalid/x?slot=45",
    createLink: "https://invoke.invalid/w?slot=59",
    updateLink: "https://invoke.invalid/v?slot=73",
    deleteLink: "https://invoke.invalid/u?slot=87",
    putAlias: "https://invoke.invalid/t?slot=101",
    deleteAlias: "https://invoke.invalid/s?slot=115",
  },
};
const validator = createJsonSchemaValidator(
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
  if (errors.length) throw new AggregateError(errors, "alias HTTP cleanup failed");
});
function wire(
  listen: string,
  target: string,
  method = "GET",
  body?: unknown,
  key?: string,
  headers: Record<string, string> = {},
) {
  return new Promise<{
    status: number;
    text: string;
    headers: import("node:http").IncomingHttpHeaders;
  }>((resolve, reject) => {
    const transport = new URL(listen),
      logical = new URL(target);
    const input = body === undefined ? undefined : JSON.stringify(body);
    const outgoing = request(
      {
        hostname: transport.hostname,
        port: transport.port,
        method,
        path: logical.pathname + logical.search,
        headers: {
          host: logical.host,
          authorization: `Bearer ${token}`,
          accept: media,
          ...(input === undefined
            ? {}
            : { "content-type": media, "content-length": Buffer.byteLength(input) }),
          ...(key === undefined ? {} : { "idempotency-key": key }),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          try {
            const status = response.statusCode ?? 0,
              text = Buffer.concat(chunks).toString("utf8");
            if (status >= 400 && text) {
              expect(response.headers["content-type"]).toMatch(
                /^application\/problem\+json(?:;|$)/,
              );
              const problem = JSON.parse(text);
              expect(validator.validate("#/$defs/readUpdateProblem", problem)).toEqual([]);
              expect(problem.status).toBe(status);
            }
            if (
              status === 200 &&
              [navigation.targets.putAlias, navigation.targets.deleteAlias].includes(target)
            )
              expect(validator.validate("#/$defs/aliasResult", JSON.parse(text))).toEqual([]);
            resolve({ status, text, headers: response.headers });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error("alias HTTP deadline")));
    outgoing.on("error", reject);
    outgoing.end(input);
  });
}
async function fixture(selectedNavigation = navigation) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-alias-http-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    directory,
    create: true,
    instance: "alias-http",
    navigation: selectedNavigation,
    credentials: [{ token, principal: "p" }],
  };
  const server = await startPrivateRetainedFixture(config);
  cleanups.push(() => server.close());
  expect(server.claimEligible).toBe(false);
  expect(server.missing).not.toContain("putAlias");
  expect(server.missing).not.toContain("deleteAlias");
  const discovery = JSON.parse((await wire(server.listenUrl, navigation.description)).text);
  const targets = JSON.parse((await wire(server.listenUrl, discovery.operations)).text);
  expect(targets).toEqual(navigation.targets);
  for (const id of ["a", "b"]) {
    const created = await wire(
      server.listenUrl,
      targets.createBead,
      "POST",
      { id, type: "https://types.invalid/T" },
      `seed-${id}`,
    );
    expect(created.status).toBe(200);
  }
  return { ...server, config, targets, discovery };
}

describe("private alias wire correspondence, no full profile qualification", () => {
  it("preserves query-based Event traversal in a Scope-wide alias namespace", async () => {
    const selected = { ...navigation, aliases: scope, events: `${scope}stream?owner=a` };
    const server = await fixture(selected);
    const collision = await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { alias: "stream", target: "a" },
      "reserved",
    );
    expect(collision.status).toBe(409);
    expect(JSON.parse(collision.text).code).toBe("identity-taken");
    const first = await wire(
      server.listenUrl,
      `${selected.events}&representation=postimage&limit=1`,
    );
    expect(first.status).toBe(200);
    const page = JSON.parse(first.text);
    expect(page.events).toHaveLength(1);
    expect(typeof page.next).toBe("string");
    const next = await wire(server.listenUrl, page.next);
    expect(next.status).toBe(200);
    expect(JSON.parse(next.text).events).toHaveLength(1);
  });
  it("uses discovered put/delete and bodyless GET/HEAD redirects without Resource versions or facts", async () => {
    const server = await fixture();
    const before = await wire(server.listenUrl, `${scope}a`);
    const beforeFacts = JSON.parse((await wire(server.listenUrl, navigation.events)).text);
    const put = await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { alias: "decisions/latest", target: "a" },
      "put",
    );
    expect(put.status).toBe(200);
    expect(JSON.parse(put.text)).toEqual({
      outcome: "created",
      alias: `${scope}decisions/latest`,
      target: `${scope}a`,
    });
    expect(put.headers.location).toBeUndefined();
    expect(put.headers.etag).toBeUndefined();
    for (const method of ["GET", "HEAD"]) {
      const response = await wire(
        server.listenUrl,
        `${scope}decisions/latest`,
        method,
        undefined,
        undefined,
        { accept: "application/json" },
      );
      expect(response.status).toBe(307);
      expect(response.text).toBe("");
      expect(response.headers.location).toBe(`${scope}a`);
      expect(response.headers["content-length"]).toBe("0");
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["bdp-resource-kind"]).toBeUndefined();
    }
    expect((await wire(server.listenUrl, `${scope}decisions/%6Catest`)).status).toBe(307);
    expect(
      (
        await wire(
          server.listenUrl,
          server.targets.putAlias,
          "POST",
          { alias: "decisions/%6catest", target: "%61" },
          "put",
        )
      ).text,
    ).toBe(put.text);
    const same = await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { alias: "decisions/latest", target: "a" },
      "same",
    );
    expect(JSON.parse(same.text)).toEqual({
      outcome: "updated",
      alias: `${scope}decisions/latest`,
      target: `${scope}a`,
    });
    expect((await wire(server.listenUrl, `${scope}a`)).text).toBe(before.text);
    const removed = await wire(
      server.listenUrl,
      server.targets.deleteAlias,
      "POST",
      { alias: "decisions/latest" },
      "delete",
    );
    expect(JSON.parse(removed.text)).toEqual({
      outcome: "deleted",
      alias: `${scope}decisions/latest`,
    });
    expect((await wire(server.listenUrl, `${scope}decisions/latest`)).status).toBe(404);
    const afterFacts = JSON.parse((await wire(server.listenUrl, navigation.events)).text);
    expect(afterFacts.events).toEqual(beforeFacts.events);
    expect(afterFacts.coverage).toEqual(beforeFacts.coverage);
  });
  it("keeps alias queries and unknown aliases uniformly missing, and does not prepend the base", async () => {
    const server = await fixture();
    const outside = await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { alias: "latest", target: "a" },
      "outside",
    );
    expect(outside.status).toBe(404);
    await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { alias: "decisions/latest", target: "a" },
      "put",
    );
    for (const suffix of ["?x=1", "?view=events", "?view=events&unsupported=1"]) {
      const response = await wire(server.listenUrl, `${scope}decisions/latest${suffix}`);
      expect(response.status).toBe(404);
      expect(JSON.parse(response.text).code).toBe("resource-not-found");
    }
    expect((await wire(server.listenUrl, `${scope}decisions/unknown`)).status).toBe(404);
    const method = await wire(server.listenUrl, server.targets.putAlias);
    expect(method.status).toBe(405);
    expect(method.text).toBe("");
    expect(method.headers.allow).toBe("POST");
  });
  it("retains alias results through repoint, deletion, reuse and reopen", async () => {
    const server = await fixture();
    const body = { alias: "decisions/latest", target: "a" };
    const original = await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      body,
      "original",
    );
    await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { ...body, target: "b" },
      "repoint",
    );
    expect(
      (await wire(server.listenUrl, server.targets.putAlias, "POST", body, "original")).text,
    ).toBe(original.text);
    expect((await wire(server.listenUrl, `${scope}decisions/latest`)).headers.location).toBe(
      `${scope}b`,
    );
    const deleted = await wire(
      server.listenUrl,
      server.targets.deleteAlias,
      "POST",
      { alias: body.alias },
      "delete",
    );
    await wire(server.listenUrl, server.targets.putAlias, "POST", body, "reuse");
    await server.close();
    const reopened = await startPrivateRetainedFixture({ ...server.config, create: false });
    cleanups.push(() => reopened.close());
    expect(
      (await wire(reopened.listenUrl, server.targets.putAlias, "POST", body, "original")).text,
    ).toBe(original.text);
    expect(
      (
        await wire(
          reopened.listenUrl,
          server.targets.deleteAlias,
          "POST",
          { alias: body.alias },
          "delete",
        )
      ).text,
    ).toBe(deleted.text);
    expect((await wire(reopened.listenUrl, `${scope}decisions/latest`)).headers.location).toBe(
      `${scope}a`,
    );
  });
  it("retains hits and misses before fresh alias/Resource state and preserves pinned endpoints", async () => {
    const server = await fixture();
    await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { alias: "decisions/endpoint", target: "a" },
      "assign",
    );
    const body = {
      id: "edge",
      type: "https://types.invalid/R",
      source: { uri: "decisions/endpoint", revision: "opaque-pin" },
      target: "b",
      properties: { literal: `${scope}decisions/endpoint` },
    };
    const original = await wire(server.listenUrl, server.targets.createLink, "POST", body, "edge");
    expect(original.status).toBe(200);
    expect(JSON.parse(original.text).resource.source).toEqual({
      uri: `${scope}a`,
      revision: "opaque-pin",
    });
    expect(JSON.parse(original.text).resource.properties.literal).toBe(
      `${scope}decisions/endpoint`,
    );
    await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { alias: "decisions/endpoint", target: "b" },
      "move",
    );
    expect(
      (await wire(server.listenUrl, server.targets.createLink, "POST", body, "edge")).text,
    ).toBe(original.text);
    const edit = { bead: "decisions/future", properties: { done: true } };
    const missing = await wire(server.listenUrl, server.targets.updateBead, "POST", edit, "miss");
    expect(missing.status).toBe(404);
    await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { alias: "decisions/future", target: "a" },
      "later",
    );
    expect(
      (await wire(server.listenUrl, server.targets.updateBead, "POST", edit, "miss")).text,
    ).toBe(missing.text);
    expect(
      (await wire(server.listenUrl, server.targets.updateBead, "POST", edit, "fresh")).status,
    ).toBe(200);
  });
  it("returns canonical collision Problems and leaves malformed/media carriers unbound", async () => {
    const server = await fixture();
    const body = { alias: "decisions/live", target: "a" };
    expect(
      (await wire(server.listenUrl, server.targets.putAlias, "POST", {}, "carrier")).status,
    ).toBe(400);
    expect(
      (await wire(server.listenUrl, server.targets.putAlias, "POST", body, "carrier")).status,
    ).toBe(200);
    const collision = await wire(
      server.listenUrl,
      server.targets.createBead,
      "POST",
      { id: "decisions/live", type: "https://types.invalid/T" },
      "collision",
    );
    expect(collision.status).toBe(409);
    expect(JSON.parse(collision.text).type).toBe(
      "https://github.com/gastownhall/bdp/problems/conflict",
    );
    expect(JSON.parse(collision.text).code).toBe("alias-path-taken");
    expect(
      (
        await wire(
          server.listenUrl,
          server.targets.deleteAlias,
          "POST",
          { alias: "decisions/live" },
          "carrier",
        )
      ).status,
    ).toBe(409);
    const second = { alias: "decisions/media", target: "a" };
    expect(
      (
        await wire(server.listenUrl, server.targets.putAlias, "POST", second, "media", {
          "content-type": "application/json",
        })
      ).status,
    ).toBe(415);
    expect(
      (await wire(server.listenUrl, server.targets.putAlias, "POST", second, "media")).status,
    ).toBe(200);
  });
  it("redirects without asserting that a deleted target is currently readable", async () => {
    const server = await fixture();
    await wire(
      server.listenUrl,
      server.targets.putAlias,
      "POST",
      { alias: "decisions/dangling", target: "a" },
      "assign",
    );
    expect(
      (
        await wire(
          server.listenUrl,
          server.targets.deleteBead,
          "POST",
          { bead: "a" },
          "delete-target",
        )
      ).status,
    ).toBe(200);
    const redirect = await wire(server.listenUrl, `${scope}decisions/dangling`);
    expect(redirect.status).toBe(307);
    expect(redirect.headers.location).toBe(`${scope}a`);
    expect(redirect.text).toBe("");
    expect((await wire(server.listenUrl, `${scope}a`)).status).toBe(404);
  });
});
