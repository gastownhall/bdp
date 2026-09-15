import { afterEach, describe, expect, it, vi } from "vitest";

// Per-test module isolation exercises missing private dependency surfaces without
// changing the installed package or its shared process registry.
afterEach(() => {
  vi.doUnmock("node:module");
  vi.doUnmock("./installed-schema-builtins.js");
  vi.resetModules();
});

describe("graph dependency and built-in integrity containment", () => {
  it.each(["create-require", "private-module"])("contains %s load failure", async (failure) => {
    vi.resetModules();
    vi.doMock("node:module", () => ({
      createRequire: () => {
        if (failure === "create-require") throw new Error("private payload");
        return () => {
          throw new Error("private payload");
        };
      },
    }));
    const { resolveSchemaUri } = await import("./installed-schema-uri.js");
    const { GraphBudget, SCHEMA_GRAPH_CEILINGS } = await import("./installed-schema-shape.js");
    expect(() =>
      resolveSchemaUri("https://schema.test/", "child", new GraphBudget(SCHEMA_GRAPH_CEILINGS)),
    ).toThrow("schema resource index refused: uri-handler-registry");
  });
  it.each(["aggregate", "bytes", "bytes-and-matching-sha"])(
    "names the internal invariant for changed built-in %s",
    async (failure) => {
      vi.resetModules();
      vi.doMock("./installed-schema-builtins.js", async (original) => {
        const source = await original<typeof import("./installed-schema-builtins.js")>();
        return failure === "aggregate"
          ? { ...source, BUILTIN_SCHEMA_DIGEST: "0".repeat(64) }
          : {
              ...source,
              BUILTIN_SCHEMA_DOCUMENTS: source.BUILTIN_SCHEMA_DOCUMENTS.map((row, index) =>
                index === 0
                  ? {
                      ...row,
                      bytesBase64: "e30=",
                      sha256:
                        failure === "bytes-and-matching-sha"
                          ? "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
                          : row.sha256,
                    }
                  : row,
              ),
            };
      });
      const { buildInstalledSchemaGraph } = await import("./installed-schema-graph.js");
      const { CONTRACT_ARTIFACT_CEILINGS } = await import("./installed-contract-artifact.js");
      const { SCHEMA_GRAPH_CEILINGS } = await import("./installed-schema-shape.js");
      expect(() =>
        buildInstalledSchemaGraph(
          { descriptors: [], schemas: [], limits: CONTRACT_ARTIFACT_CEILINGS },
          SCHEMA_GRAPH_CEILINGS,
        ),
      ).toThrow("schema resource index refused: internal-invariant");
    },
  );
});
