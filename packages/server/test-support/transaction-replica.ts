import assert from "node:assert/strict";
import { stringifyJsonValue } from "@bdp/protocol";
import type { TransactionReadContext } from "../src/transaction-store.js";
import type { TransactionChangeGroup } from "../src/transaction-changefeed.js";
import type { ResourceRecord } from "../src/resource-evaluator.js";
/** Test replica oracle: stage complete changes; publish graph+cursor only together.
 * Positions are compared exclusively by equality, never parsed or ordered. */
export function replica(context: TransactionReadContext, linkType: string) {
  let graph = new Map<string, ResourceRecord>(),
    checkpoint = "genesis",
    position = "pos-0";
  const applied = new Map<string, string>();
  return {
    state: () => ({ graph, checkpoint, position }),
    apply(group: TransactionChangeGroup, failBeforePublish = false) {
      assert.equal(group.scopeEpoch, context.scopeEpoch);
      assert.equal(group.authorizationView, context.authorizationView);
      const bytes = stringifyJsonValue(group),
        duplicate = applied.get(group.checkpoint);
      if (duplicate !== undefined) {
        assert.equal(bytes, duplicate);
        return;
      }
      assert.equal(group.previousPosition, position);
      const staged = new Map(graph);
      for (const change of group.changes) {
        if (change.operation === "upsert")
          staged.set(change.resource.id, structuredClone(change.resource) as ResourceRecord);
        else staged.delete(change.resource.id);
      }
      for (const resource of staged.values())
        for (const links of Object.values(
          "ownedLinks" in resource ? (resource.ownedLinks ?? {}) : {},
        )) {
          for (const link of links) {
            assert.equal(link.source, resource.id);
            assert.deepEqual(staged.get(link.id), link);
          }
        }
      for (const resource of staged.values())
        if ("source" in resource && resource.type === linkType) {
          const source = staged.get(
            typeof resource.source === "string" ? resource.source : resource.source.uri,
          );
          assert.ok(source && "ownedLinks" in source);
          assert.deepEqual(
            source.ownedLinks?.[linkType]?.find((link) => link.id === resource.id),
            resource,
          );
        }
      if (failBeforePublish) throw Error("replica publication failed");
      graph = staged;
      checkpoint = group.checkpoint;
      position = group.position;
      applied.set(checkpoint, bytes);
    },
  };
}
