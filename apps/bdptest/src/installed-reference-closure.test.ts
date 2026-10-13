import { expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ extension: {} as Record<string, unknown> }));
vi.mock("@bdp/protocol", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bdp/protocol")>();
  return {
    ...actual,
    get REFERENCE_TYPE_DESCRIPTORS() {
      return actual.REFERENCE_TYPE_DESCRIPTORS.map((d, index) =>
        index === 0 ? { ...d, ...fixture.extension } : d,
      );
    },
  };
});
const { referenceTypeArtifacts } = (await import(
  new URL("../../../packages/server/dist/installed-reference-configuration.js", import.meta.url)
    .href
)) as typeof import("../../../packages/server/src/installed-reference-configuration.js");
it("refuses foreign URIs in future reference fields, including nested values and keys", () => {
  const scope = "https://reference.invalid/acme/";
  try {
    for (const extension of [
      { propertiesSchema: "https://foreign.invalid/schema" },
      { future: { nested: ["https://foreign.invalid/types/one"] } },
      { future: { "https://foreign.invalid/type": {} } },
      { future: { nested: "https://reference.invalid/acme-other/type" } },
      { future: { nested: "https://reference.invalid/acme/../outside/type" } },
    ]) {
      fixture.extension = extension;
      expect(() => referenceTypeArtifacts(scope)).toThrow("not Scope-local");
    }
    fixture.extension = { future: { nested: `${scope}types/example` } };
    expect(referenceTypeArtifacts(scope)).toHaveLength(13);
  } finally {
    fixture.extension = {};
  }
});
