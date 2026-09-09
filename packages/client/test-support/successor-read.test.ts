import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { independentlyExpectedProjectedToken } from "./successor-read.js";
import { createBdpClientScenarioActionExecutor } from "./testing.js";

const scope = "https://scope.example/acme/";
const model = "IEEE-754-binary64-ECMAScript-JSON";
const fixture = (target: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/read-${target}-v1.json`, import.meta.url),
      "utf8",
    ),
  );
const json = (url: string, body: unknown) => {
  const response = new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
};
function publicFetch(resources: Record<string, unknown>): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === scope) {
      const response = new Response(null, {
        status: 204,
        headers: { link: '<bdp.json>; rel="service-desc"' },
      });
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    if (url === `${scope}bdp.json`)
      return json(url, {
        bdpVersion: "0",
        profile: "read",
        scope,
        beads: `${scope}beads/`,
        links: `${scope}links/`,
        types: `${scope}types/`,
      });
    if (Object.hasOwn(resources, url)) return json(url, resources[url]);
    throw new Error(`unexpected observation URL ${url}`);
  };
}
const run = (
  operation: string,
  input: unknown,
  fetchImplementation: typeof fetch,
  externalTypeDescriptorFetchImplementation?: typeof fetch,
) =>
  createBdpClientScenarioActionExecutor({
    fetchImplementation,
    ...(externalTypeDescriptorFetchImplementation
      ? { externalTypeDescriptorFetchImplementation }
      : {}),
  })({ family: "client", operation, input, scope, signal: new AbortController().signal });

describe("successor Read observations", () => {
  it.each(["reference", "bdpbd"])(
    "binds %s numeric declaration prose to the fixture, not an unbound document",
    (target) => {
      const f = fixture(target);
      const d = f.oracles["numeric-model"].declaration;
      const doc = readFileSync(new URL(`../../../${d.source}`, import.meta.url), "utf8");
      expect(doc).toContain(d.description);
      expect(d.description).toContain(d.name);
      if (target === "bdpbd") {
        expect(d.numberModel).toBe(model);
        expect(f.oracles["numeric-model"].input.numberModel).toBe(d.numberModel);
        expect(f.capabilities).toContain("content-derived-revisions-v1");
      } else {
        expect(d.numberModel).toBe("not-content-derived");
        expect(f.capabilities).not.toContain("content-derived-revisions-v1");
        expect(f.beads.every((b: { revision: string }) => b.revision === "1")).toBe(true);
      }
    },
  );
  it("checks the independent writer against literal preimages, including numeric keys, nesting, zero and exponents", () => {
    // The expected preimage is authored literally, not produced by either serializer.
    const expected =
      '{"id":"x","properties":{"10":1e+30,"2":0,"nested":[0.1,1e-7,9007199254740992]},"type":"t"}';
    const body = {
      type: "t",
      revision: "ignored",
      id: "x",
      properties: { "2": -0, "10": 1e30, nested: [0.1, 1e-7, 9007199254740992] },
    };
    expect(independentlyExpectedProjectedToken(body)).toBe(
      `sha256_${createHash("sha256").update(expected).digest("base64url")}`,
    );
    expect(independentlyExpectedProjectedToken({ ...body, revision: "different" })).toBe(
      independentlyExpectedProjectedToken(body),
    );
    expect(
      independentlyExpectedProjectedToken({
        ...body,
        properties: { ...body.properties, nested: [0.2, 1e-7, 9007199254740992] },
      }),
    ).not.toBe(independentlyExpectedProjectedToken(body));
  });
  it("detects stale numeric revisions and refuses to count an all-Bead or numberless sample as coverage", async () => {
    const b = {
      id: `${scope}beads/a`,
      type: "https://work.example/types/task",
      properties: { priority: 2 },
    };
    const l = {
      id: `${scope}links/a-b`,
      type: "https://work.example/types/blocks",
      properties: {},
      source: `${scope}beads/a`,
      target: `${scope}beads/b`,
    };
    // Literal serialized preimages, independent of the observation and adapter algorithms.
    const bt =
      "sha256_" +
      createHash("sha256")
        .update(`{"id":"${b.id}","properties":{"priority":2},"type":"${b.type}"}`)
        .digest("base64url");
    const lt =
      "sha256_" +
      createHash("sha256")
        .update(
          `{"id":"${l.id}","properties":{},"source":"${l.source}","target":"${l.target}","type":"${l.type}"}`,
        )
        .digest("base64url");
    const resources = { [b.id]: { ...b, revision: bt }, [l.id]: { ...l, revision: lt } };
    const input = { ids: ["beads/a", "links/a-b"], numberModel: model };
    await expect(run("numeric-token-model", input, publicFetch(resources))).resolves.toMatchObject({
      tokensMatch: true,
      hasNumbers: true,
      bothKinds: true,
    });
    await expect(
      run(
        "numeric-token-model",
        input,
        publicFetch({ ...resources, [b.id]: { ...b, properties: { priority: 3 }, revision: bt } }),
      ),
    ).resolves.toMatchObject({ tokensMatch: false });
    await expect(
      run(
        "numeric-token-model",
        input,
        publicFetch({ ...resources, [b.id]: { ...b, properties: {}, revision: bt } }),
      ),
    ).resolves.toMatchObject({ hasNumbers: false });
    await expect(
      run(
        "numeric-token-model",
        { ...input, ids: ["beads/a", "beads/b"] },
        publicFetch({
          ...resources,
          [`${scope}beads/b`]: { ...b, id: `${scope}beads/b`, revision: "different" },
        }),
      ),
    ).resolves.toMatchObject({ bothKinds: false });
  });
  it.each(["reference", "bdpbd"])(
    "actually parses every %s negative descriptor and catches replacement by a valid body",
    async (target) => {
      const f = fixture(target);
      for (const group of Object.values(f.oracles["wildcard-descriptors"]) as {
        input: { ids: string[] };
        descriptors: Record<string, unknown>[];
        rows: unknown[];
      }[]) {
        const bodies = new Map(group.descriptors.map((d) => [d.id, d]));
        const requested: string[] = [];
        const publisher: typeof fetch = async (url) => {
          requested.push(String(url));
          return json(String(url), bodies.get(String(url)));
        };
        await expect(
          run("wildcard-descriptors", group.input, publicFetch({}), publisher),
        ).resolves.toEqual({ rows: group.rows });
        expect(requested).toEqual(group.input.ids);
      }
      const group = f.oracles["wildcard-descriptors"]["explicit-max-bounded"];
      const bodies = new Map<string, Record<string, unknown>>(
        group.descriptors.map((d: Record<string, unknown>) => [d.id, d]),
      );
      const above = group.input.ids[2];
      bodies.set(above, {
        ...bodies.get(above),
        ownsOutgoing: { "*": { max: 4 }, "https://work.example/types/cites": { max: 4 } },
      });
      const observed = await run(
        "wildcard-descriptors",
        group.input,
        publicFetch({}),
        async (url) => json(String(url), bodies.get(String(url))),
      );
      expect(observed).not.toEqual({ rows: group.rows });
      expect(observed).toMatchObject({
        rows: [{ outcome: "success" }, { outcome: "success" }, { outcome: "success" }],
      });
    },
  );
  it("fails an ownership absence witness on an incomplete inventory", async () => {
    await expect(
      run(
        "ownership-inventory",
        { ids: ["https://work.example/types/task"] },
        publicFetch({
          [`${scope}types/`]: { items: [], next: `${scope}types/?cursor=more` },
          [`${scope}beads/`]: { items: [], next: null },
        }),
        async (url) => json(String(url), {}),
      ),
    ).rejects.toThrow("complete inventory");
  });
  it("rejects extra inline groups and mismatched first-class properties in the actual observer", async () => {
    const f = fixture("reference");
    const input = f.oracles["wildcard-present"].input;
    const plane = f.oracles["owned-links"].ownedLinks;
    const makeBead = (id: string, ownedLinks?: unknown) => {
      const b = f.beads.find((v: { localId: string }) => v.localId === id);
      return {
        id: scope + id,
        type: b.type,
        revision: b.revision,
        properties: b.properties,
        ...(ownedLinks === undefined ? {} : { ownedLinks }),
      };
    };
    const resources: Record<string, unknown> = {
      [scope + input.owner]: makeBead(input.owner, plane),
      [scope + input.empty]: makeBead(input.empty, {}),
      [scope + input.nonowner]: makeBead(input.nonowner),
    };
    for (const links of Object.values(plane) as Record<string, unknown>[][])
      for (const link of links) resources[String(link.id)] = link;
    await expect(run("wildcard-present", input, publicFetch(resources))).resolves.toMatchObject({
      exactGroups: true,
      firstClassEqual: true,
      empty: {},
      nonownerAbsent: true,
    });
    await expect(
      run(
        "wildcard-present",
        input,
        publicFetch({
          ...resources,
          [scope + input.owner]: makeBead(input.owner, {
            ...plane,
            "https://work.example/types/absent": [],
          }),
        }),
      ),
    ).resolves.toMatchObject({ exactGroups: false });
    const id = `${scope}links/external-target`;
    await expect(
      run(
        "wildcard-present",
        input,
        publicFetch({
          ...resources,
          [id]: { ...(resources[id] as object), properties: { changed: true } },
        }),
      ),
    ).resolves.toMatchObject({ firstClassEqual: false });
  });
});
