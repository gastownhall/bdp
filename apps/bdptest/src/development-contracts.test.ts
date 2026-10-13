import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  parseReadUpdateDiscovery,
  parseReadUpdateOperationDirectory,
  parseCanonicalHttpUrl,
} from "@bdp/protocol";
import { CONTRACT_ARTIFACT_CEILINGS } from "../../../packages/server/src/installed-contract-artifact.js";
import type { DevelopmentAccess } from "../../../packages/server/src/development-contracts.js";
import {
  startPrivateRuntime,
  canonicalDevelopmentComposition,
} from "../test-support/development-discovery.js";
const contracts = (await import(
  new URL("../../../packages/server/dist/development-contracts.js", import.meta.url).href
)) as typeof import("../../../packages/server/src/development-contracts.js");
const base = "https://bdp.example/u2/base",
  owner = "https://bdp.example/u2/owner",
  edge = "https://bdp.example/u2/edge",
  schema = "https://bdp.example/u2/schema";
const alice = "u2_alice_credential_01234567890123456789",
  bob = "u2_bob_credential_012345678901234567890";
const allow: DevelopmentAccess = { create: true, write: true, hidden: [], readOnly: [] };
const servers: Awaited<ReturnType<typeof startPrivateRuntime>>[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const artifact = (retrievalUri: string, body: unknown) => ({
  retrievalUri,
  utf8Bytes: Buffer.from(JSON.stringify(body)),
});
function bundle() {
  return {
    limits: CONTRACT_ARTIFACT_CEILINGS,
    descriptors: [
      artifact(base, {
        id: base,
        name: "Base",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: schema,
      }),
      artifact(owner, {
        id: owner,
        name: "Owner",
        describes: "bead",
        conformsTo: [base],
        ownsOutgoing: { [edge]: { max: 2 } },
      }),
      artifact(edge, {
        id: edge,
        name: "Edge",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [base], external: "opaque" },
        target: { conformsTo: [base], external: "opaque" },
      }),
    ],
    schemas: [
      artifact(schema, {
        $id: schema,
        type: "object",
        required: ["n"],
        properties: { n: { $ref: "https://bdp.example/u2/number" } },
      }),
      artifact("https://bdp.example/u2/number", {
        $id: "https://bdp.example/u2/number",
        type: "integer",
        minimum: 0,
      }),
    ],
  };
}
async function fixture() {
  const input = bundle();
  const installed = contracts.compileDevelopmentContracts(input);
  const access = contracts.createDevelopmentAccessPolicy({
    alice: allow,
    bob: { ...allow, write: false, create: false },
  });
  const deployment = {
    configuration: {
      contracts: installed,
      access: access.policy,
      maximumEndpointMultiplicity: [
        { linkConformsTo: parseCanonicalHttpUrl(edge), endpoint: "target" as const, max: 1 },
      ],
    },
    credentials: [
      { token: alice, principal: "alice" },
      { token: bob, principal: "bob" },
    ],
  };
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-contracts-"));
  dirs.push(directory);
  const options = { directory, token: alice, port: 0, create: true };
  const server = await startPrivateRuntime(
    options,
    undefined,
    undefined,
    canonicalDevelopmentComposition,
    deployment,
  );
  servers.push(server);
  async function wire(url: string, method = "GET", body?: unknown, key?: string, token = alice) {
    const response = await fetch(new URL(url, server.scope), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(key === undefined ? {} : { "idempotency-key": key }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      value: text ? JSON.parse(text) : undefined,
    };
  }
  const probe = await wire("");
  const descriptor = probe.headers.get("link")?.match(/^<([^>]+)>/)?.[1];
  if (!descriptor) throw Error("no discovery Link");
  const discovery = parseReadUpdateDiscovery((await wire(descriptor)).value);
  const operationDirectory = parseReadUpdateOperationDirectory(
    (await wire(discovery.operations)).value,
  );
  const post = (op: keyof typeof operationDirectory, body: unknown, key: string, token = alice) =>
    wire(new URL(operationDirectory[op], discovery.operations).href, "POST", body, key, token);
  const bead = async (id: string, key = id, token = alice) => {
    const response = await post(
      "createBead",
      { id: `beads/${id}`, type: owner, properties: { n: 1 } },
      key,
      token,
    );
    expect(response.status, response.text).toBe(200);
    return response.value.resource;
  };
  return { server, options, deployment, access, input, installed, wire, post, bead, discovery };
}

it("installs pinned schema closure and applies inherited validation through actual HTTP with retained failures", async () => {
  const f = await fixture();
  const bad = { id: "beads/bad", type: owner, properties: { n: -1 } };
  const failure = await f.post("createBead", bad, "bad");
  expect(failure.status).toBe(422);
  expect(failure.value.code).toBe("validation-failed");
  expect(failure.value.diagnostics).toEqual([
    expect.objectContaining({
      type: base,
      schemaLocation: "https://bdp.example/u2/number#/minimum",
      instanceLocation: "/n",
    }),
  ]);
  expect((await f.wire("beads/bad")).status).toBe(404);
  expect((await f.post("createBead", bad, "bad")).value).toEqual(failure.value);
  expect((await f.post("createBead", { ...bad, properties: { n: 1 } }, "bad")).value.code).toBe(
    "idempotency-conflict",
  );
  const a = await f.bead("a");
  const rejected = await f.post(
    "updateBead",
    {
      bead: a.id,
      expectedRevision: a.revision,
      propertiesChange: [{ op: "replace", path: "/n", value: "wrong" }],
    },
    "bad_update",
  );
  expect(rejected.status).toBe(422);
  expect((await f.wire(a.id)).value).toEqual(a);
  // Input bytes were captured before compilation; mutating the caller's copy cannot loosen validation.
  f.input.schemas[1]?.utf8Bytes.fill(32);
  expect((await f.post("createBead", { ...bad, id: "beads/still-bad" }, "still_bad")).status).toBe(
    422,
  );
  expect((await f.wire("types/")).value.items.map((x: { id: string }) => x.id).sort()).toEqual(
    [base, edge, owner].sort(),
  );
});

it("enforces owned source guards, aggregate constraints, revision/provenance fanout and no-op preservation", async () => {
  const f = await fixture(),
    a = await f.bead("a"),
    b = await f.bead("b"),
    c = await f.bead("c");
  const input = {
    id: "links/one",
    type: edge,
    source: { uri: a.id, revision: a.revision },
    target: b.id,
    revisionProvenance: {
      actor: { id: "human:author", basis: "writer-supplied" },
      message: "owned edge",
    },
  };
  const created = await f.post("createLink", input, "link");
  expect(created.status, created.text).toBe(200);
  const edge1 = created.value.resource,
    source = (await f.wire(a.id)).value;
  expect(created.value.source).toBe(a.id);
  expect(created.value.sourceRevision).toBe(source.revision);
  expect(source.revision).not.toBe(a.revision);
  expect(source.ownedLinks[edge]).toEqual([edge1]);
  expect(source.revisionProvenance).toEqual(edge1.revisionProvenance);
  expect((await f.wire(b.id)).value).toEqual(b);
  // An endpoint pin is carried data, not an optimistic concurrency guard.
  // The owned mutation changed the source Bead revision, so its old guard fails.
  expect(edge1.source).toEqual(input.source);
  const stale = await f.post(
    "updateBead",
    {
      bead: a.id,
      expectedRevision: a.revision,
      metadataChange: [{ op: "add", path: "/stale", value: true }],
    },
    "stale",
  );
  expect(stale.value.code).toBe("revision-mismatch");
  expect((await f.wire(a.id)).value).toEqual(source);
  const aggregate = await f.post(
    "createLink",
    { id: "links/aggregate", type: edge, source: c.id, target: b.id },
    "aggregate",
  );
  expect(aggregate.value.code).toBe("aggregate-constraint-violation");
  expect((await f.wire("links/aggregate")).status).toBe(404);
  expect((await f.wire(c.id)).value).toEqual(c);
  const noop = await f.post(
    "updateLink",
    {
      link: edge1.id,
      expectedRevision: edge1.revision,
      propertiesChange: [{ op: "replace", path: "", value: {} }],
      revisionProvenance: { message: "ignored no-op" },
    },
    "noop",
  );
  expect(noop.status).toBe(200);
  expect(noop.value.resource).toEqual(edge1);
  expect((await f.wire(a.id)).value).toEqual(source);
  const updated = await f.post(
    "updateLink",
    {
      link: edge1.id,
      expectedRevision: edge1.revision,
      metadataChange: [{ op: "add", path: "/reviewed", value: true }],
      revisionProvenance: { message: "changed" },
    },
    "update",
  );
  expect(updated.status).toBe(200);
  const after = (await f.wire(a.id)).value;
  expect(updated.value.sourceRevision).toBe(after.revision);
  expect(after.revision).not.toBe(source.revision);
  expect(after.ownedLinks[edge]).toEqual([updated.value.resource]);
  expect(after.revisionProvenance).toEqual(updated.value.resource.revisionProvenance);
  const removed = await f.post(
    "deleteLink",
    { link: edge1.id, expectedRevision: updated.value.resource.revision },
    "delete",
  );
  expect(removed.status).toBe(200);
  const final = (await f.wire(a.id)).value;
  expect(final.ownedLinks[edge]).toEqual([]);
  expect(final.revision).toBe(removed.value.sourceRevision);
  expect((await f.wire(edge1.id)).status).toBe(404);
});

it("uses transport principals rather than actor attribution and distinguishes hidden, forbidden and retained disclosure", async () => {
  const f = await fixture(),
    a = await f.bead("a", "principal_key");
  const forged = {
    bead: a.id,
    expectedRevision: a.revision,
    propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
    revisionProvenance: { actor: { id: "alice", basis: "writer-supplied" } },
  };
  expect((await f.post("updateBead", forged, "forged", bob)).value.code).toBe("forbidden");
  expect((await f.wire(a.id)).value).toEqual(a);
  expect(
    (
      await f.post(
        "createBead",
        { id: "beads/b", type: owner, properties: { n: 1 } },
        "principal_key",
        bob,
      )
    ).value.code,
  ).toBe("forbidden");
  f.access.replace("bob", { ...allow, hidden: ["beads/a"] });
  expect((await f.wire(a.id, "GET", undefined, undefined, bob)).status).toBe(404);
  expect((await f.post("updateBead", forged, "hidden", bob)).value.code).toBe("resource-not-found");
  f.access.replace("alice", { ...allow, hidden: ["beads/a"] });
  const hiddenReplay = await f.post(
    "createBead",
    { id: "beads/a", type: owner, properties: { n: 1 } },
    "principal_key",
  );
  expect(hiddenReplay.status).toBe(403);
  expect(hiddenReplay.text).not.toContain(a.id);
  f.access.replace("alice", allow);
  expect(
    (
      await f.post(
        "createBead",
        { id: "beads/a", type: owner, properties: { n: 1 } },
        "principal_key",
      )
    ).value.resource,
  ).toEqual(a);
  expect((await f.wire(a.id)).value).toEqual(a);
  // Bob's earlier failure was retained in his namespace; changed authority policy does not execute it again.
  expect(
    (
      await f.post(
        "createBead",
        { id: "beads/b", type: owner, properties: { n: 1 } },
        "principal_key",
        bob,
      )
    ).value.code,
  ).toBe("forbidden");
  await f.bead("b", "bob_fresh", bob);
});

it("withholds a complete owned Resource and its retained postimage when an owned Link becomes hidden", async () => {
  const f = await fixture(),
    a = await f.bead("a"),
    b = await f.bead("b");
  const link = await f.post(
    "createLink",
    { id: "links/secret", type: edge, source: a.id, target: b.id },
    "link",
  );
  expect(link.status).toBe(200);
  const update = { bead: a.id, metadataChange: [{ op: "add", path: "/reviewed", value: true }] };
  const saved = await f.post("updateBead", update, "saved");
  expect(saved.status).toBe(200);
  const page = await f.wire("beads/?limit=1");
  f.access.replace("alice", { ...allow, hidden: ["links/secret"] });
  expect((await f.wire(a.id)).status).toBe(404);
  const replay = await f.post("updateBead", update, "saved");
  expect(replay.status).toBe(403);
  expect(replay.text).not.toContain("secret");
  expect(page.value.next).toBeTypeOf("string");
  expect((await f.wire(page.value.next)).value.code).toBe("foreign-view");
  f.access.replace("alice", allow);
  expect((await f.wire(a.id)).value).toEqual(saved.value.resource);
  expect((await f.post("updateBead", update, "saved")).value).toEqual(saved.value);
});

it("reopens the same pinned contracts and refuses a changed schema closure or aggregate installation", async () => {
  const f = await fixture(),
    a = await f.bead("a");
  const port = Number(new URL(f.server.scope).port);
  await f.server.close();
  const options = { ...f.options, create: false, port };
  const reopened = await startPrivateRuntime(
    options,
    undefined,
    undefined,
    canonicalDevelopmentComposition,
    f.deployment,
  );
  servers.push(reopened);
  expect((await f.wire(a.id)).value).toEqual(a);
  await reopened.close();
  const changed = bundle();
  changed.schemas[1] = artifact("https://bdp.example/u2/number", { type: "integer", minimum: 10 });
  const other = contracts.compileDevelopmentContracts(changed);
  await expect(
    startPrivateRuntime(options, undefined, undefined, canonicalDevelopmentComposition, {
      ...f.deployment,
      configuration: { ...f.deployment.configuration, contracts: other },
    }),
  ).rejects.toThrow();
  await expect(
    startPrivateRuntime(options, undefined, undefined, canonicalDevelopmentComposition, {
      ...f.deployment,
      configuration: { ...f.deployment.configuration, maximumEndpointMultiplicity: [] },
    }),
  ).rejects.toThrow();
});

it("refuses unpinned schemas, accessor policies and duplicate credential maps before service construction", async () => {
  const missing = bundle();
  missing.schemas.pop();
  expect(() => contracts.compileDevelopmentContracts(missing)).toThrow();
  let invoked = false;
  expect(() =>
    contracts.createDevelopmentAccessPolicy({
      get alice() {
        invoked = true;
        return allow;
      },
    }),
  ).toThrow();
  expect(invoked).toBe(false);
  const policy = contracts.createDevelopmentAccessPolicy({ alice: allow });
  const hidden: string[] = [];
  Object.defineProperty(hidden, "0", {
    get() {
      invoked = true;
      return "beads/a";
    },
    enumerable: true,
  });
  expect(() => policy.replace("alice", { ...allow, hidden })).toThrow();
  expect(invoked).toBe(false);
  const f = await fixture();
  await f.server.close();
  await expect(
    startPrivateRuntime(
      { ...f.options, create: false },
      undefined,
      undefined,
      canonicalDevelopmentComposition,
      {
        ...f.deployment,
        credentials: [
          { token: alice, principal: "alice" },
          { token: alice, principal: "bob" },
        ],
      },
    ),
  ).rejects.toThrow("unique trusted credentials");
});

it("requires write permission on an owned Link's source and preserves state on refusal", async () => {
  const f = await fixture();
  const a = await f.bead("a"),
    b = await f.bead("b");
  const created = await f.post(
    "createLink",
    { id: "links/one", type: edge, source: a.id, target: b.id },
    "link",
  );
  expect(created.status).toBe(200);
  const before = (await f.wire(a.id)).value;
  const update = {
    link: created.value.resource.id,
    metadataChange: [{ op: "add", path: "/x", value: true }],
  };
  f.access.replace("alice", { ...allow, readOnly: ["beads/a"] });
  const refused = await f.post("updateLink", update, "source_denied");
  expect(refused.value.code).toBe("forbidden");
  expect((await f.wire(a.id)).value).toEqual(before);
  expect((await f.wire(created.value.resource.id)).value).toEqual(created.value.resource);
  f.access.replace("alice", allow);
  expect((await f.post("updateLink", update, "source_denied")).value).toEqual(refused.value);
  const changed = await f.post("updateLink", update, "source_allowed");
  expect(changed.status).toBe(200);
  expect((await f.wire(a.id)).value.revision).toBe(changed.value.sourceRevision);
  expect(changed.value.sourceRevision).not.toBe(before.revision);
});

it("refuses incomplete guarded evaluation before emitting any standardized Type diagnostics", () => {
  const input = bundle();
  input.schemas[0] = artifact(schema, {
    type: "object",
    allOf: Array.from({ length: 1025 }, (_, i) => ({ required: [`p${i}`] })),
  });
  const installed = contracts.compileDevelopmentContracts(input);
  const bytes = installed.types[base];
  if (bytes === undefined) throw Error("missing installed descriptor");
  const validator = installed.registry.get(base, bytes)?.validateProperties;
  if (validator === undefined) throw Error("missing installed schema validator");
  let emitted = 0;
  expect(() =>
    validator(
      {},
      {
        emit() {
          emitted++;
          return true;
        },
      },
    ),
  ).toThrow("did not complete");
  expect(emitted).toBe(0);
});
