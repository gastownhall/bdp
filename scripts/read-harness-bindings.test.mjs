import { describe, expect, it } from "vitest";
import { deriveReadHarnessBindings, READ_OBSERVER_SUPPORT_PATHS } from "./read-harness-bindings.ts";

const read = (source) => Buffer.from(`committed bytes for ${source}`);

describe("Read observation harness provenance", () => {
  it.each(READ_OBSERVER_SUPPORT_PATHS)(
    "binds executed support %s in both lanes and both targets",
    (changedSource) => {
      const before = deriveReadHarnessBindings(read);
      const after = deriveReadHarnessBindings((source) =>
        source === changedSource ? Buffer.from("changed observation algorithm") : read(source),
      );
      expect(after.packaged).not.toBe(before.packaged);
      expect(after.matrix.bdptest).not.toBe(before.matrix.bdptest);
      expect(after.matrix.bdpbd).not.toBe(before.matrix.bdpbd);
    },
  );

  it.each(["packages/conformance/src/runner.ts", "packages/server/src/read-http.ts"])(
    "does not fold separately owned runner/payload source %s into harness identity",
    (changedSource) => {
      const before = deriveReadHarnessBindings(read);
      const after = deriveReadHarnessBindings((source) =>
        source === changedSource ? Buffer.from("changed source") : read(source),
      );
      expect(after).toEqual(before);
    },
  );

  it("keeps target-specific matrix entry changes scoped to that matrix", () => {
    const before = deriveReadHarnessBindings(read);
    const after = deriveReadHarnessBindings((source) =>
      source === "apps/bdpbd/src/read-matrix.test.ts" ? Buffer.from("new entry") : read(source),
    );
    expect(after.packaged).toBe(before.packaged);
    expect(after.matrix.bdptest).toBe(before.matrix.bdptest);
    expect(after.matrix.bdpbd).not.toBe(before.matrix.bdpbd);
  });

  it.each(READ_OBSERVER_SUPPORT_PATHS)(
    "fails closed when executed support %s is missing",
    (missingSource) => {
      expect(() =>
        deriveReadHarnessBindings((source) => {
          if (source === missingSource) throw new Error("missing executed observer");
          return read(source);
        }),
      ).toThrow("missing executed observer");
    },
  );
});
