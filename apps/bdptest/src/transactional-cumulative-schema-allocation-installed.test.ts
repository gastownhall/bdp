/** Four NEW ordinary installed schema/allocation witnesses; no historical suite execution. */
import { expect, it } from "vitest";
import {
  productEntry,
  scope,
  withSchemaAllocationCase,
  row,
  receipt,
  feed,
  validator,
} from "../test-support/transactional-cumulative-schema-allocation-runtime.js";

it.skipIf(!productEntry)(
  "NEW allocated omitted Bead ID is opaque canonical and serves complete original",
  async () => {
    await withSchemaAllocationCase("allocation", async (c, campaign) => {
      const input = {
        type: scope + "types/task",
        properties: { title: "allocated", nested: { keep: [1, true, null] } },
        metadata: { tag: "allocation" },
      };
      c.position("pos-1");
      const made = receipt(
        await c.exchange("operations/create-bead", input, "allocate"),
        "completed",
        "pos-1",
        "allocate",
        "pos-1",
      );
      expect(made.results).toHaveLength(1);
      const allocated = made.results[0].resource;
      expect(typeof allocated.id).toBe("string");
      expect(allocated.id).toMatch(/^https:\/\/reference\.invalid\/acme\/beads\/[A-Za-z0-9_-]+$/);
      const suffix = allocated.id.slice((scope + "beads/").length);
      expect(decodeURIComponent(suffix)).toBe(suffix);
      expect(new URL(allocated.id).href).toBe(allocated.id);
      const full = row(allocated, "beads/" + suffix, "task", input.properties, input.metadata);
      expect(made.results).toEqual([{ operationIndex: 0, outcome: "created", resource: full }]);
      expect(input).not.toHaveProperty("id");
      const get = await c.exchange(allocated.id);
      expect(get.wire.status).toBe(200);
      expect(get.value).toEqual(full);
      expect((await c.exchange("operations/create-bead", input, "allocate")).value).toEqual(made);
      expect(
        (await feed(c)).map((g) => ({
          position: g.position,
          changes: g.changes.map((e: any) => e.resource.id),
          events: g.events.map((e: any) => e.type),
        })),
      ).toEqual([{ position: "pos-1", changes: [full.id], events: ["created"] }]);
      campaign.results.allocation = { input, allocated: full, completeGet: get.value };
    });
  },
  30000,
);

it.skipIf(!productEntry)(
  "NEW inherited-only schema rejects while actual own-only sibling accepts identical properties",
  async () => {
    await withSchemaAllocationCase("inherited", async (c, campaign) => {
      const properties = { childOnly: 7 };
      c.position("pos-1");
      const own = receipt(
        await c.exchange(
          "operations/create-bead",
          { id: "beads/own", type: scope + "types/own-only", properties },
          "own",
        ),
        "completed",
        "pos-1",
        "own",
        "pos-1",
      );
      const original = row(own.results[0].resource, "beads/own", "own-only", properties);
      expect((await c.exchange("beads/own")).value).toEqual(original);
      const refused = receipt(
        await c.exchange(
          "operations/create-bead",
          { id: "beads/child", type: scope + "types/child", properties },
          "inherited-invalid",
        ),
        "failed",
        "pos-1",
        "inherited-invalid",
      );
      expect(refused.problem).toMatchObject({
        type: "https://github.com/gastownhall/bdp/problems/validation",
        code: "validation-failed",
        status: 422,
        retry: "never",
        operationIndex: 0,
      });
      expect(refused.problem.diagnostics).toHaveLength(1);
      expect(refused.problem.diagnostics[0]).toMatchObject({
        type: scope + "types/parent",
        schemaLocation: scope + "schemas/parent#/required",
        instanceLocation: "",
      });
      expect(refused.problem.diagnostics[0].message).toEqual(expect.any(String));
      expect(refused.problem).not.toHaveProperty("diagnosticsTruncated");
      expect((await c.exchange("beads/child")).wire.status).toBe(404);
      expect((await c.exchange("beads/own")).value).toEqual(original);
      c.position("pos-2");
      const goodProperties = { childOnly: 7, parentOnly: "parent-ok" };
      const good = receipt(
        await c.exchange(
          "operations/create-bead",
          { id: "beads/child", type: scope + "types/child", properties: goodProperties },
          "inherited-valid",
        ),
        "completed",
        "pos-2",
        "inherited-valid",
        "pos-2",
      );
      const full = row(good.results[0].resource, "beads/child", "child", goodProperties);
      expect((await c.exchange("beads/child")).value).toEqual(full);
      expect((await feed(c)).map((g) => g.position)).toEqual(["pos-1", "pos-2"]);
      campaign.results.inherited = { ownSchemaControl: original, rejected: refused, valid: full };
    });
  },
  30000,
);

it.skipIf(!productEntry)(
  "NEW UpdateWhere validation exposes actual request path pointer with atomic rollback",
  async () => {
    await withSchemaAllocationCase("pointer", async (c, campaign) => {
      c.position("pos-1");
      const made = receipt(
        await c.exchange(
          "operations/create-bead",
          { id: "beads/p", type: scope + "types/task", properties: { title: "unchanged" } },
          "pointer-seed",
        ),
        "completed",
        "pos-1",
        "pointer-seed",
        "pos-1",
      );
      const original = row(made.results[0].resource, "beads/p", "task", { title: "unchanged" });
      const operations = [
        {
          operation: "createBead",
          id: "beads/tentative",
          type: scope + "types/task",
          properties: {},
        },
        {
          operation: "updateWhere",
          collection: "beads",
          selector: "$[?@.id]",
          change: [{ op: "remove", path: "/missing" }],
        },
      ];
      const failed = receipt(
        await c.batch(operations, "pointer-failure"),
        "failed",
        "pos-1",
        "pointer-failure",
      );
      expect(failed.problem).toMatchObject({
        type: "https://github.com/gastownhall/bdp/problems/validation",
        code: "validation-failed",
        status: 422,
        retry: "never",
        operationIndex: 1,
        pointer: "/operations/1/change/0/path",
      });
      expect(failed.problem.diagnostics).toEqual([
        {
          message: "Property Change target does not exist",
          instanceLocation: "/missing",
        },
      ]);
      expect(failed.problem).not.toHaveProperty("diagnosticsTruncated");
      expect((await c.exchange("beads/p")).value).toEqual(original);
      expect((await c.exchange("beads/tentative")).wire.status).toBe(404);
      expect((await c.batch(operations, "pointer-failure")).value).toEqual(failed);
      expect((await feed(c)).map((g) => g.position)).toEqual(["pos-1"]);
      campaign.results.pointer = { failed, original };
    });
  },
  30000,
);

it.skipIf(!productEntry)(
  "NEW advertised diagnostic count truncates real seventeen-error installed schema",
  async () => {
    await withSchemaAllocationCase("truncation", async (c, campaign) => {
      const root = await c.exchange(scope);
      expect(root.wire.status).toBe(204);
      const link = /^<([^>]+)>; rel="service-desc"; type="application\/json"$/.exec(
        root.wire.headers.link!,
      );
      expect(link).not.toBeNull();
      const discovery = await c.exchange(link![1]!);
      expect(discovery.wire.status).toBe(200);
      expect(discovery.value.limits.validation).toEqual({
        diagnostics: 16,
        diagnosticBytes: 524288,
      });
      const failed = receipt(
        await c.exchange(
          "operations/create-bead",
          {
            id: "beads/many",
            type: scope + "types/many-required",
            properties: Object.fromEntries(
              Array.from({ length: 17 }, (_, i) => [
                "r" + String(i).padStart(2, "0"),
                "not-an-integer",
              ]),
            ),
          },
          "many-invalid",
        ),
        "failed",
        "pos-0",
        "many-invalid",
      );
      expect(validator.validate("#/$defs/readUpdateProblem", failed.problem)).toEqual([]);
      expect(failed.problem).toMatchObject({
        code: "validation-failed",
        status: 422,
        operationIndex: 0,
        diagnosticsTruncated: true,
      });
      expect(failed.problem.diagnostics).toHaveLength(16);
      const seen = new Set<string>();
      for (const d of failed.problem.diagnostics) {
        expect(d.instanceLocation).toMatch(/^\/r(?:0[0-9]|1[0-6])$/);
        expect(seen.has(d.instanceLocation)).toBe(false);
        seen.add(d.instanceLocation);
        expect(d).toEqual({
          message: "Schema assertion failed: type",
          type: scope + "types/many-required",
          schemaLocation:
            scope + "schemas/many-required#/properties" + d.instanceLocation + "/type",
          instanceLocation: d.instanceLocation,
        });
      }
      expect(Buffer.byteLength(JSON.stringify(failed.problem.diagnostics))).toBeLessThanOrEqual(
        discovery.value.limits.validation.diagnosticBytes,
      );
      expect((await c.exchange("beads/many")).wire.status).toBe(404);
      expect(await feed(c)).toEqual([]);
      c.position("pos-1");
      const properties = Object.fromEntries(
        Array.from({ length: 17 }, (_, i) => ["r" + String(i).padStart(2, "0"), i]),
      );
      const good = receipt(
        await c.exchange(
          "operations/create-bead",
          { id: "beads/many", type: scope + "types/many-required", properties },
          "many-valid",
        ),
        "completed",
        "pos-1",
        "many-valid",
        "pos-1",
      );
      const full = row(good.results[0].resource, "beads/many", "many-required", properties);
      expect((await c.exchange("beads/many")).value).toEqual(full);
      campaign.results.truncation = {
        advertised: discovery.value.limits.validation,
        failed,
        valid: full,
      };
    });
  },
  30000,
);
