import { describe, expect, it } from "vitest";
import { deriveReadHarnessBindings } from "./read-harness-bindings.ts";

const read = (source) => Buffer.from(`committed bytes for ${source}`);

describe("Read observation harness provenance", () => {
  it("binds a successor observer-only edit in both lanes and both targets", () => {
    const before = deriveReadHarnessBindings(read);
    const after = deriveReadHarnessBindings((source) =>
      source === "packages/client/test-support/successor-read.ts"
        ? Buffer.from("changed observation algorithm")
        : read(source),
    );
    expect(after.packaged).not.toBe(before.packaged);
    expect(after.matrix.bdptest).not.toBe(before.matrix.bdptest);
    expect(after.matrix.bdpbd).not.toBe(before.matrix.bdpbd);
  });

  it("keeps target-specific matrix entry changes scoped to that matrix", () => {
    const before = deriveReadHarnessBindings(read);
    const after = deriveReadHarnessBindings((source) =>
      source === "apps/bdpbd/src/read-matrix.test.ts" ? Buffer.from("new entry") : read(source),
    );
    expect(after.packaged).toBe(before.packaged);
    expect(after.matrix.bdptest).toBe(before.matrix.bdptest);
    expect(after.matrix.bdpbd).not.toBe(before.matrix.bdpbd);
  });

  it("fails closed when an executed support source is missing", () => {
    expect(() =>
      deriveReadHarnessBindings((source) => {
        if (source === "packages/client/test-support/successor-read.ts")
          throw new Error("missing executed observer");
        return read(source);
      }),
    ).toThrow("missing executed observer");
  });
});
