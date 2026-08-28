import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseTypeDescriptor,
  REFERENCE_BLOCKING_LINK_TYPE_ID,
  REFERENCE_TYPE_DESCRIPTORS,
  REFERENCE_TYPE_SUMMARIES,
} from "./index.js";

describe("reference-domain artifacts", () => {
  it("keeps the language-neutral fixture and runtime vocabulary aligned", () => {
    const artifact = JSON.parse(
      readFileSync(
        new URL("../../../fixtures/reference-domain/reference-domain.json", import.meta.url),
        "utf8",
      ),
    );
    expect([...artifact.beadTypes, ...artifact.linkTypes]).toEqual(REFERENCE_TYPE_SUMMARIES);
    expect(artifact.typeDescriptors).toEqual(REFERENCE_TYPE_DESCRIPTORS);
    expect(artifact.linkTypes.map(({ id }: { id: string }) => id)).toContain(
      REFERENCE_BLOCKING_LINK_TYPE_ID,
    );
    expect(
      REFERENCE_TYPE_DESCRIPTORS.map((descriptor, index) =>
        parseTypeDescriptor(descriptor, `reference descriptor ${index}`),
      ),
    ).toEqual(REFERENCE_TYPE_DESCRIPTORS);
    expect(Object.keys(artifact.propertiesSchemas).sort()).toEqual(
      REFERENCE_TYPE_SUMMARIES.map((type) => type.id).sort(),
    );
    expect(artifact.beadTypes.map((type: { id: string }) => type.id.split("/").pop())).toEqual([
      "tracked-item",
      "work-item",
      "task",
      "bug",
      "feature",
      "chore",
      "epic",
      "decision",
    ]);
  });
});
