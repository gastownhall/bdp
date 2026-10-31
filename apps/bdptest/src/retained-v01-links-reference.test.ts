/** Independent raw HTTP assertions for the incomplete Core-only Link fixture. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJsonSchemaValidator } from "@bdp/conformance";
import { afterEach, describe, expect, it } from "vitest";
import { startPrivateRetainedFixture } from "../../../packages/server/src/retained-v01/http.js";

const media = "application/vnd.bdp.v0.1+json";
const token = "L".repeat(32);
const scope = "https://records.invalid/t/";
const navigation = {
  scope,
  description: "https://discover.invalid/about?tenant=t",
  beads: "https://inventory.invalid/things?tenant=t",
  links: "https://inventory.invalid/relations?tenant=t",
  aliases: `${scope}names`,
  events: "https://observe.invalid/log?tenant=t",
  operations: "https://discover.invalid/invoke?tenant=t",
  targets: {
    createBead: "https://write.invalid/insert?kind=node",
    updateBead: "https://write.invalid/edit?kind=node",
    deleteBead: "https://write.invalid/drop?kind=node",
    createLink: "https://write.invalid/insert?kind=edge",
    updateLink: "https://write.invalid/edit?kind=edge",
    deleteLink: "https://write.invalid/drop?kind=edge",
    putAlias: "https://write.invalid/bind?tenant=t",
    deleteAlias: "https://write.invalid/unbind?tenant=t",
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
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Link HTTP cleanup failed");
});
function wire(
  listen: string,
  target: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Promise<{
    status: number;
    text: string;
    headers: import("node:http").IncomingHttpHeaders;
  }>((resolve, reject) => {
    const transport = new URL(listen);
    const url = new URL(target);
    const text = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        hostname: transport.hostname,
        port: transport.port,
        method: body === undefined ? "GET" : "POST",
        path: url.pathname + url.search,
        headers: {
          host: url.host,
          authorization: `Bearer ${token}`,
          accept: media,
          ...(text === undefined
            ? {}
            : { "content-type": media, "content-length": Buffer.byteLength(text) }),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          try {
            const status = response.statusCode ?? 0;
            const text = Buffer.concat(chunks).toString("utf8");
            // Bodyless HTTP refusals have separate assertions. Every observed
            // error document must satisfy the independent canonical wire oracle.
            if (status >= 400 && text.length) {
              expect(response.headers["content-type"]).toMatch(
                /^application\/problem\+json(?:;|$)/,
              );
              const problem = JSON.parse(text);
              expect(validator.validate("#/$defs/readUpdateProblem", problem)).toEqual([]);
              expect(problem.status).toBe(status);
            }
            resolve({ status, text, headers: response.headers });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error("Link HTTP request deadline")));
    req.on("error", reject);
    req.end(text);
  });
}
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-link-http-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const server = await startPrivateRetainedFixture({
    directory,
    create: true,
    instance: "link-wire",
    navigation,
    credentials: [{ token, principal: "link-principal" }],
  });
  cleanups.push(() => server.close());
  const discovery = JSON.parse((await wire(server.listenUrl, navigation.description)).text);
  const targets = JSON.parse((await wire(server.listenUrl, discovery.operations)).text);
  const beads: Record<string, unknown>[] = [];
  for (const id of ["left", "right", "next"]) {
    const result = await wire(
      server.listenUrl,
      targets.createBead,
      { id, type: "https://types.invalid/Node" },
      { "idempotency-key": `fixture-${id}` },
    );
    expect(result.status).toBe(200);
    const resource = JSON.parse(result.text).resource;
    expect(resource.metadata).toEqual({});
    beads.push(resource);
  }
  return { ...server, targets, discovery, beads };
}
const payload = {
  id: "arbitrary/relationship",
  type: { uri: "https://types.invalid/R", revision: "type/+edition" },
  source: { uri: "left", revision: "opaque-old-Bead-pin" },
  target: "right",
  properties: { nullValue: null },
  metadata: {},
};
describe("Core-only Link wire correspondence", () => {
  it("follows discovered targets and reports actual Link kind without inventing owner revisions", async () => {
    const server = await fixture();
    expect(server.claimEligible).toBe(false);
    const created = await wire(server.listenUrl, server.targets.createLink, payload, {
      "idempotency-key": "create",
    });
    expect(created.status).toBe(200);
    const result = JSON.parse(created.text);
    expect(validator.validate("#/$defs/mutationResult", result)).toEqual([]);
    expect(result.resource.metadata).toEqual({});
    expect(result).not.toHaveProperty("ownerRevisions");
    expect(result.resource.source).toEqual({
      uri: scope + "left",
      revision: "opaque-old-Bead-pin",
    });
    const read = await wire(server.listenUrl, result.resource.id);
    expect(read.headers["bdp-resource-kind"]).toBe("link");
    expect(JSON.parse(read.text)).toEqual(result.resource);
    for (const bead of server.beads)
      expect(JSON.parse((await wire(server.listenUrl, String(bead.id))).text)).toEqual(bead);
    expect(created.headers.etag).toBeUndefined();
    expect(created.headers.location).toBeUndefined();
  });
  it("corrects endpoints in place and projects the same fact to old and new incidence", async () => {
    const server = await fixture();
    const firstResponse = await wire(server.listenUrl, server.targets.createLink, payload, {
      "idempotency-key": "create",
    });
    const first = JSON.parse(firstResponse.text);
    const external = "https://External.Invalid/item?part=%2f#reference";
    const updated = await wire(
      server.listenUrl,
      server.targets.updateLink,
      {
        link: first.resource.id,
        source: "next",
        target: { uri: external, revision: "foreign/+opaque" },
        expectedRevision: first.resource.revision,
      },
      { "idempotency-key": "move", "if-match": '"command-url-condition"' },
    );
    expect(updated.status).toBe(200);
    const result = JSON.parse(updated.text);
    expect(validator.validate("#/$defs/mutationResult", result)).toEqual([]);
    expect(result.resource.metadata).toEqual({});
    expect(result.resource.id).toBe(first.resource.id);
    expect(result.resource.revision).not.toBe(first.resource.revision);
    expect(result.resource.target).toEqual({ uri: external, revision: "foreign/+opaque" });
    const scoped = JSON.parse((await wire(server.listenUrl, server.discovery.events)).text);
    expect(validator.validate("#/$defs/retainedEventPage", scoped)).toEqual([]);
    const event = scoped.events.at(-1);
    expect(event).toMatchObject({
      previousRevision: first.resource.revision,
      revision: result.resource.revision,
      effect: { operation: "updateLink", link: first.resource.id, resource: result.resource },
    });
    for (const id of ["left", "right", "next"]) {
      const page = JSON.parse((await wire(server.listenUrl, `${scope}${id}?view=events`)).text);
      expect(validator.validate("#/$defs/retainedEventPage", page)).toEqual([]);
      expect(page.events.filter((entry: { id: string }) => entry.id === event.id)).toHaveLength(1);
    }
    const replay = await wire(server.listenUrl, server.targets.createLink, payload, {
      "idempotency-key": "create",
    });
    expect(replay.text).toBe(firstResponse.text);
    expect(JSON.parse((await wire(server.listenUrl, first.resource.id)).text)).toEqual(
      result.resource,
    );
  });
  it("returns the complete original envelope on a no-op without adding provenance", async () => {
    const server = await fixture();
    const created = await wire(server.listenUrl, server.targets.createLink, payload, {
      "idempotency-key": "create",
    });
    expect(created.status).toBe(200);
    const original = JSON.parse(created.text).resource;
    const unchanged = await wire(
      server.listenUrl,
      server.targets.updateLink,
      {
        link: original.id,
        expectedRevision: original.revision,
        propertiesChange: [],
        metadataChange: [],
        revisionProvenance: { message: "must not become version provenance" },
      },
      { "idempotency-key": "no-op" },
    );
    expect(unchanged.status).toBe(200);
    expect(JSON.parse(unchanged.text)).toEqual({
      outcome: "updated",
      changed: false,
      resource: original,
    });
    expect(JSON.parse(unchanged.text).resource.metadata).toEqual({});
    expect(JSON.parse(unchanged.text).resource).not.toHaveProperty("revisionProvenance");
  });
  it("keeps incident refusal after Link deletion and retains final-live endpoint context", async () => {
    const server = await fixture();
    const created = JSON.parse(
      (
        await wire(server.listenUrl, server.targets.createLink, payload, {
          "idempotency-key": "create",
        })
      ).text,
    );
    const blocked = await wire(
      server.listenUrl,
      server.targets.deleteBead,
      { bead: "left" },
      { "idempotency-key": "blocked" },
    );
    expect(blocked.status).toBe(409);
    expect(JSON.parse(blocked.text).code).toBe("incident-links-exist");
    expect(validator.validate("#/$defs/readUpdateProblem", JSON.parse(blocked.text))).toEqual([]);
    const deletionBody = {
      link: created.resource.id,
      expectedRevision: created.resource.revision,
      revisionProvenance: { message: "unowned Link deletion" },
    };
    const deleted = await wire(server.listenUrl, server.targets.deleteLink, deletionBody, {
      "idempotency-key": "delete",
    });
    expect(deleted.status).toBe(200);
    const result = JSON.parse(deleted.text);
    expect(validator.validate("#/$defs/mutationResult", result)).toEqual([]);
    expect(result.deleted.resource.revision).toBe(created.resource.revision);
    expect((await wire(server.listenUrl, created.resource.id)).status).toBe(404);
    expect(
      (
        await wire(
          server.listenUrl,
          server.targets.deleteBead,
          { bead: "left" },
          { "idempotency-key": "blocked" },
        )
      ).text,
    ).toBe(blocked.text);
    expect(
      (
        await wire(
          server.listenUrl,
          server.targets.deleteBead,
          { bead: "left" },
          { "idempotency-key": "fresh-delete" },
        )
      ).status,
    ).toBe(200);
    const page = JSON.parse(
      (await wire(server.listenUrl, `${created.resource.id}?view=events`)).text,
    );
    expect(validator.validate("#/$defs/retainedEventPage", page)).toEqual([]);
    expect(page.events).toHaveLength(2);
    expect(page.events[1].effect.deleted).toEqual({
      ...result.deleted,
      source: created.resource.source,
      target: created.resource.target,
    });
    expect(page.events[1]).not.toHaveProperty("previousRevision");
    expect(
      (
        await wire(server.listenUrl, server.targets.deleteLink, deletionBody, {
          "idempotency-key": "delete",
        })
      ).text,
    ).toBe(deleted.text);
  });
  it("refuses endpoint kind, missing local Bead and a wholly external Link atomically", async () => {
    const server = await fixture();
    const first = await wire(server.listenUrl, server.targets.createLink, payload, {
      "idempotency-key": "create",
    });
    const bad = await wire(
      server.listenUrl,
      server.targets.updateLink,
      { link: scope + payload.id, source: scope + payload.id, properties: { mustNotCommit: true } },
      { "idempotency-key": "bad" },
    );
    expect(bad.status).toBe(422);
    expect(validator.validate("#/$defs/readUpdateProblem", JSON.parse(bad.text))).toEqual([]);
    expect(JSON.parse((await wire(server.listenUrl, scope + payload.id)).text)).toEqual(
      JSON.parse(first.text).resource,
    );
    expect(
      (
        await wire(
          server.listenUrl,
          server.targets.createLink,
          { ...payload, id: "missing", target: "absent" },
          { "idempotency-key": "missing" },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await wire(
          server.listenUrl,
          server.targets.createLink,
          {
            ...payload,
            id: "external",
            source: "https://one.invalid/a",
            target: "https://two.invalid/b",
          },
          { "idempotency-key": "external" },
        )
      ).status,
    ).toBe(422);
    expect(
      JSON.parse((await wire(server.listenUrl, server.discovery.events)).text).events,
    ).toHaveLength(4);
  });
  it("keeps the unresolved colon case visibly incomplete without binding a key", async () => {
    const server = await fixture();
    expect(
      (
        await wire(
          server.listenUrl,
          server.targets.createBead,
          { id: "a:b", type: "https://types.invalid/Node" },
          { "idempotency-key": "colon-node" },
        )
      ).status,
    ).toBe(200);
    const gap = await wire(
      server.listenUrl,
      server.targets.createLink,
      { ...payload, source: "a:b" },
      { "idempotency-key": "colon-edge" },
    );
    expect(gap.status).toBe(501);
    expect(gap.text).toBe("");
    expect(gap.headers["content-type"]).toBeUndefined();
    expect(server.missing).toContain(
      "Reference absolute-URI/local-path overlap awaiting paired-source clarification",
    );
    expect(
      (
        await wire(
          server.listenUrl,
          server.targets.createLink,
          { ...payload, source: scope + "a:b" },
          { "idempotency-key": "colon-edge" },
        )
      ).status,
    ).toBe(200);
  });
});
