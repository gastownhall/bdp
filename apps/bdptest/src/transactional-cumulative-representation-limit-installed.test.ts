/** NEW ordinary installed per-Resource representation limit and atomic rollback. */
import { expect, it } from "vitest";
import {
  installed,
  withRepresentationLimit,
  scope,
  row,
  receipt,
} from "../test-support/transactional-cumulative-representation-limit-runtime.js";
const pad = (letter: string) => ({ pad: letter.repeat(50 * 1024) });
it.skipIf(!installed)(
  "NEW TX representation-limit rejects the oversized owning-source postimage and rolls back the preceding operation",
  async () => {
    await withRepresentationLimit("owning-source-representation", async (c) => {
      c.position("pos-1");
      const seed = receipt(
        await c.batch(
          [
            {
              operation: "createBead",
              id: "beads/owner",
              type: scope + "types/mixed",
              properties: { n: 0 },
              metadata: pad("A"),
            },
            {
              operation: "createBead",
              id: "beads/target",
              type: scope + "types/task",
              properties: { n: 0 },
            },
          ],
          "representation-seed",
        ),
        "completed",
        "pos-1",
        "representation-seed",
        "pos-1",
      );
      const ownerInitial = row(
        seed.results[0].resource,
        "beads/owner",
        "mixed",
        { n: 0 },
        {
          metadata: pad("A"),
          ownedLinks: { [scope + "types/explicit"]: [], [scope + "types/empty"]: [] },
        },
      );
      const target = row(seed.results[1].resource, "beads/target", "task", { n: 0 });
      const definitions = [
        { id: "links/e", type: "explicit", metadata: pad("B") },
        { id: "links/w1", type: "wild", metadata: pad("C") },
        { id: "links/w2", type: "wild", metadata: pad("D") },
      ];
      const links: any[] = [];
      let ownerRevision = ownerInitial.revision;
      for (const [i, d] of definitions.entries()) {
        const position = `pos-${i + 2}`,
          key = `representation-link-${i}`;
        c.position(position);
        const completed = receipt(
          await c.batch(
            [
              {
                operation: "createLink",
                id: d.id,
                type: scope + "types/" + d.type,
                source: "beads/owner",
                target: "beads/target",
                properties: { n: 0 },
                metadata: d.metadata,
              },
            ],
            key,
          ),
          "completed",
          position,
          key,
          position,
        );
        const result = completed.results[0];
        const link = row(
          result.resource,
          d.id,
          d.type,
          { n: 0 },
          { metadata: d.metadata, source: ownerInitial.id, target: target.id },
        );
        expect(completed.results).toEqual([
          {
            operationIndex: 0,
            outcome: "created",
            resource: link,
            source: ownerInitial.id,
            sourceRevision: result.sourceRevision,
          },
        ]);
        expect(result.sourceRevision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
        expect(result.sourceRevision).not.toBe(ownerRevision);
        ownerRevision = result.sourceRevision;
        links.push(link);
      }
      const owner = {
        ...ownerInitial,
        revision: ownerRevision,
        ownedLinks: {
          [scope + "types/explicit"]: [links[0]],
          [scope + "types/empty"]: [],
          [scope + "types/wild"]: links.slice(1),
        },
      };
      async function graph() {
        expect((await c.exchange("beads/owner")).value).toEqual(owner);
        expect((await c.exchange("beads/target")).value).toEqual(target);
        expect((await c.exchange("links/?limit=32")).value).toEqual({ items: links, next: null });
      }
      await graph();
      const baseline = await c.exchange("changes/?start=now");
      expect(baseline.wire.status).toBe(200);
      expect(baseline.value).toEqual({
        scope,
        scopeEpoch: baseline.wire.headers["bdp-scope-epoch"],
        authorizationView: baseline.wire.headers["bdp-authorization-view"],
        after: baseline.value.after,
        observedHeadPosition: "pos-4",
        groups: [],
        next: null,
      });
      expect(baseline.value.after).toMatch(/^cg_/);
      const overflow = "Q".repeat(60 * 1024);
      const body = {
        operations: [
          {
            operation: "updateBead",
            bead: "beads/target",
            expectedRevision: target.revision,
            propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
          },
          {
            operation: "updateLink",
            link: "links/e",
            expectedRevision: links[0].revision,
            metadataChange: [{ op: "add", path: "/overflow", value: overflow }],
          },
        ],
      };
      // Exact independently assembled candidate graph: only opaque generated revisions are bounded placeholders here.
      const candidateLink = {
        ...links[0],
        revision: "R".repeat(256),
        metadata: { ...definitions[0]!.metadata, overflow },
      };
      const candidateSource = {
        ...owner,
        revision: "S".repeat(256),
        ownedLinks: { ...owner.ownedLinks, [scope + "types/explicit"]: [candidateLink] },
      };
      const sizes = {
        request: Buffer.byteLength(JSON.stringify(body)),
        beforeSource: Buffer.byteLength(JSON.stringify(owner)),
        candidateLink: Buffer.byteLength(JSON.stringify(candidateLink)),
        candidateSource: Buffer.byteLength(JSON.stringify(candidateSource)),
      };
      expect(sizes.request).toBeLessThanOrEqual(65536);
      expect(sizes.beforeSource).toBeLessThan(262144);
      expect(sizes.candidateLink).toBeLessThan(262144);
      // Even shortest legal replacement revisions cannot remove the >4 KiB overflow margin.
      expect(sizes.candidateSource - 510).toBeGreaterThan(262144);
      const key = "representation-overflow";
      const failed = receipt(
        await c.exchange("operations/batch", body, key),
        "failed",
        "pos-4",
        key,
      );
      expect(failed.problem).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/size",
        status: 413,
        code: "limit-exceeded",
        retry: "never",
        operationIndex: 1,
      });
      expect(failed).not.toHaveProperty("results");
      expect(failed.problem).not.toHaveProperty("limit");
      expect((await c.exchange("operations/batch", body, key)).value).toEqual(failed);
      expect((await c.exchange(failed.id)).value).toEqual(failed);
      await graph();
      const suffix = await c.exchange(`changes/?after=${encodeURIComponent(baseline.value.after)}`);
      expect(suffix.wire.status).toBe(200);
      expect(suffix.value).toEqual(baseline.value);
      c.results.representation = {
        expectedGraph: { owner, target, links },
        baseline: baseline.value,
        failed,
        sizes,
        nativeRepresentationBytes: 262144,
        semanticScope:
          "per-Resource source postimage, operation-indexed failure; whole batch rollback",
        propertiesBytes: 7,
        baselineGroupCount: 4,
        newGroups: 0,
      };
    });
  },
  90000,
);
