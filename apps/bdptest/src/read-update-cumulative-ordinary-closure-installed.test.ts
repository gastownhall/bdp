/** Three NEW ordinary installed RU residual witnesses, never the104 carrier replay. */
import { expect, it } from "vitest";
import {
  entry,
  scope,
  withRUClosure,
  resource,
  success,
  problem,
  validator,
} from "../test-support/read-update-cumulative-ordinary-closure-runtime.js";
const task = scope + "types/task",
  relates = scope + "types/relates";
it.skipIf(!entry)(
  "NEW RU semantic identity retains exact pins external URI guard and provenance",
  async () => {
    await withRUClosure("identity", async (c) => {
      const made = await c.exchange(
        "operations/create-bead",
        { id: "beads/a", type: task, properties: { n: 0 }, metadata: { kept: true } },
        "identity-a",
      );
      const a = resource(made.value.resource, "beads/a", "task", { n: 0 }, { kept: true });
      success(made, "created", a);
      const original = {
        id: "links/identity",
        type: relates,
        source: { uri: "beads/a", revision: "source-pin:opaque/v1" },
        target: {
          uri: "https://elsewhere.invalid/foreign/bead?tag=%41",
          revision: "target-pin:opaque/v1",
        },
        properties: { title: "retained" },
        metadata: { tag: "literal" },
      };
      const linkResponse = await c.exchange("operations/create-link", original, "identity-link");
      const link = resource(
        linkResponse.value.resource,
        "links/identity",
        "relates",
        original.properties,
        original.metadata,
        {
          source: { uri: scope + "beads/a", revision: original.source.revision },
          target: original.target,
        },
      );
      const linkResult = success(linkResponse, "created", link);
      expect((await c.exchange("links/identity")).value).toEqual(link);
      for (const changed of [
        { ...original, target: { ...original.target, revision: "target-pin:opaque/v2" } },
        {
          ...original,
          target: { ...original.target, uri: "https://elsewhere.invalid/foreign/bead?tag=A" },
        },
        { ...original, source: { ...original.source, revision: "source-pin:opaque/v2" } },
      ]) {
        problem(
          await c.exchange("operations/create-link", changed, "identity-link"),
          "idempotency-conflict",
          409,
          "never",
        );
        expect((await c.exchange("links/identity")).value).toEqual(link);
      }
      expect(
        (
          await c.exchange(
            "operations/create-link",
            { ...original, source: { ...original.source, uri: scope + "beads/a" } },
            "identity-link",
          )
        ).value,
      ).toEqual(linkResult);
      const provenance = { actor: { id: "writer:original", basis: "writer-supplied" } };
      const update = {
        bead: "beads/a",
        expectedRevision: a.revision,
        propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
        revisionProvenance: provenance,
      };
      const changed = await c.exchange("operations/update-bead", update, "identity-update");
      const a1 = resource(
        changed.value.resource,
        "beads/a",
        "task",
        { n: 1 },
        { kept: true },
        { revisionProvenance: provenance },
      );
      expect(a1.revision).not.toBe(a.revision);
      const updateResult = success(changed, "updated", a1);
      for (const other of [
        { ...update, expectedRevision: a1.revision },
        {
          ...update,
          revisionProvenance: { actor: { id: "writer:different", basis: "writer-supplied" } },
        },
      ]) {
        problem(
          await c.exchange("operations/update-bead", other, "identity-update"),
          "idempotency-conflict",
          409,
          "never",
        );
        expect((await c.exchange("beads/a")).value).toEqual(a1);
      }
      expect(
        (
          await c.exchange(
            "operations/update-bead",
            { ...update, bead: scope + "beads/a" },
            "identity-update",
          )
        ).value,
      ).toEqual(updateResult);
      expect((await c.exchange("beads/a")).value).toEqual(a1);
      expect((await c.exchange("links/identity")).value).toEqual(link);
      const links = await c.exchange("links/?limit=100");
      expect(links.wire.status).toBe(200);
      expect(links.value).toEqual({ items: [link], next: null });
      c.results.identity = {
        a,
        a1,
        link,
        linkResult,
        updateResult,
        independentChangedFields: [
          "target revision",
          "external URI lexical bytes",
          "source revision",
          "expectedRevision",
          "revisionProvenance",
        ],
      };
    });
  },
  30000,
);
it.skipIf(!entry)(
  "NEW RU concurrent last aggregate slot commits exactly one complete graph",
  async () => {
    await withRUClosure("aggregate", async (c) => {
      const records = [];
      for (const id of ["a", "b"]) {
        const r = await c.exchange(
          "operations/create-bead",
          { id: "beads/" + id, type: task, properties: { title: id } },
          "aggregate-" + id,
        );
        const v = resource(r.value.resource, "beads/" + id, "task", { title: id });
        success(r, "created", v);
        records.push(v);
      }
      const links = [];
      for (let i = 0; i < 7; i++) {
        const properties = { slot: i };
        const r = await c.exchange(
          "operations/create-link",
          {
            id: "links/seed-" + i,
            type: relates,
            source: "beads/a",
            target: "beads/b",
            properties,
          },
          "aggregate-seed-" + i,
        );
        const v = resource(
          r.value.resource,
          "links/seed-" + i,
          "relates",
          properties,
          {},
          { source: scope + "beads/a", target: scope + "beads/b" },
        );
        success(r, "created", v);
        links.push(v);
      }
      const contenders = [0, 1].map((i) => ({
        id: "links/contender-" + i,
        type: relates,
        source: "beads/a",
        target: "beads/b",
        properties: { contender: i },
        metadata: { ordinary: true },
      }));
      const settled = await Promise.allSettled(
        contenders.map((body, i) =>
          c.exchange("operations/create-link", body, "aggregate-contender-" + i),
        ),
      );
      for (const r of settled) expect(r.status).toBe("fulfilled");
      const answers = settled.map((r) => {
        if (r.status !== "fulfilled") throw r.reason;
        return r.value;
      });
      expect(answers.map((a) => a.wire.status).sort()).toEqual([200, 409]);
      const winner = answers.findIndex((a) => a.wire.status === 200),
        loser = 1 - winner;
      const candidate = contenders[winner]!;
      const won = resource(
        answers[winner]!.value.resource,
        candidate.id,
        "relates",
        candidate.properties,
        candidate.metadata,
        { source: scope + "beads/a", target: scope + "beads/b" },
      );
      success(answers[winner], "created", won);
      const refused = problem(
        answers[loser],
        "aggregate-constraint-violation",
        409,
        "after-state-change",
      );
      expect((await c.exchange(contenders[loser]!.id)).wire.status).toBe(404);
      expect((await c.exchange(won.id)).value).toEqual(won);
      for (let i = 0; i < 2; i++)
        expect(
          (await c.exchange("operations/create-link", contenders[i], "aggregate-contender-" + i))
            .value,
        ).toEqual(answers[i]!.value);
      const all = [...links, won].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const collection = await c.exchange("links/?limit=100");
      expect(collection.wire.status).toBe(200);
      expect(collection.value).toEqual({ items: all, next: null });
      for (const r of records) expect((await c.exchange(r.id)).value).toEqual(r);
      const beads = await c.exchange("beads/?limit=100");
      expect(beads.wire.status).toBe(200);
      expect(beads.value).toEqual({ items: records, next: null });
      c.results.aggregate = {
        initialLinks: links,
        contenders,
        answers: answers.map((a) => a.value),
        winner,
        loser,
        refused,
        completeFinalLinks: all,
        unchangedEndpoints: records,
      };
    });
  },
  30000,
);
it.skipIf(!entry)(
  "NEW RU actual advertised diagnostic omission with separate real33-property schema",
  async () => {
    await withRUClosure(
      "truncation",
      async (c) => {
        // Exact installed source locator: this case tests the advertised validation bound,
        // not the Scope's bodyless navigation response or its cache policy.
        const discovery = await c.exchange("bdp.json");
        expect(discovery.wire.status).toBe(200);
        expect(discovery.value.limits.validation).toEqual({
          diagnostics: 32,
          diagnosticBytes: 524288,
        });
        const properties = Object.fromEntries(
          Array.from({ length: 33 }, (_, i) => [
            "e" + String(i).padStart(2, "0"),
            "not-an-integer",
          ]),
        );
        const bad = await c.exchange(
          "operations/create-bead",
          { id: "beads/diagnostics", type: scope + "types/closure-many", properties },
          "diagnostic-invalid",
        );
        expect(bad.wire.status).toBe(422);
        expect(bad.wire.headers["content-type"]).toMatch(/^application\/problem\+json/);
        expect(validator.validate("#/$defs/readUpdateProblem", bad.value)).toEqual([]);
        expect(bad.value).toMatchObject({
          type: "https://github.com/gastownhall/bdp/problems/validation",
          code: "validation-failed",
          status: 422,
          retry: "never",
          diagnosticsTruncated: true,
        });
        expect(bad.value).not.toHaveProperty("resource");
        expect(bad.value.diagnostics).toHaveLength(32);
        const seen = new Set<string>();
        for (const d of bad.value.diagnostics) {
          expect(d.instanceLocation).toMatch(/^\/e(?:[0-2][0-9]|3[0-2])$/);
          expect(seen.has(d.instanceLocation)).toBe(false);
          seen.add(d.instanceLocation);
          expect(d).toEqual({
            message: "Schema assertion failed: type",
            type: scope + "types/closure-many",
            schemaLocation:
              scope + "schemas/closure-many#/properties" + d.instanceLocation + "/type",
            instanceLocation: d.instanceLocation,
          });
        }
        expect(Buffer.byteLength(JSON.stringify(bad.value.diagnostics))).toBeLessThanOrEqual(
          discovery.value.limits.validation.diagnosticBytes,
        );
        expect((await c.exchange("beads/diagnostics")).wire.status).toBe(404);
        expect((await c.exchange("beads/?limit=100")).value).toEqual({ items: [], next: null });
        const valid = Object.fromEntries(
          Array.from({ length: 33 }, (_, i) => ["e" + String(i).padStart(2, "0"), i]),
        );
        const good = await c.exchange(
          "operations/create-bead",
          {
            id: "beads/diagnostics",
            type: scope + "types/closure-many",
            properties: valid,
            metadata: { valid: true },
          },
          "diagnostic-valid",
        );
        const full = resource(good.value.resource, "beads/diagnostics", "closure-many", valid, {
          valid: true,
        });
        success(good, "created", full);
        expect((await c.exchange("beads/diagnostics")).value).toEqual(full);
        expect((await c.exchange("beads/?limit=100")).value).toEqual({ items: [full], next: null });
        c.results.truncation = {
          advertised: discovery.value.limits.validation,
          failed: bad.value,
          completeValid: full,
        };
      },
      true,
    );
  },
  30000,
);
