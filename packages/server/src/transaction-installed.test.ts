import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { captureInstalledTransactionConfiguration } from "./transaction-installed-configuration.js";
const scope = "https://reference.invalid/acme/";
function input(directory: string) {
  return {
    scope,
    directory,
    create: true,
    credentials: [{ token: "a".repeat(32), principal: "p", canMutate: true }],
    artifacts: {
      descriptors: [
        {
          retrievalUri: `${scope}types/task`,
          utf8: JSON.stringify({
            id: `${scope}types/task`,
            name: "Task",
            describes: "bead",
            conformsTo: [],
          }),
        },
      ],
      schemas: [],
    },
  };
}
it("captures detached bounded own-data launch inputs without installing alternate runtime controls", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tx-installed-config-"));
  try {
    const supplied = input(directory),
      captured = captureInstalledTransactionConfiguration(supplied);
    supplied.credentials[0]!.canMutate = false;
    supplied.artifacts.descriptors[0]!.utf8 = "changed";
    expect(captured.credentials[0]?.canMutate).toBe(true);
    expect(captured.artifacts?.descriptors[0]?.utf8).not.toBe("changed");
    expect(captured).toMatchObject({ port: 0, authorityMode: "canonical", scope });
    expect(Object.isFrozen(captured.credentials)).toBe(true);
    expect(Object.isFrozen(captured.artifacts?.descriptors)).toBe(true);
    for (const patch of [
      { port: 1234 },
      { clock: undefined },
      { authorityMode: "listener" },
      { types: [] },
      { artifacts: { descriptors: [], schemas: [] } },
    ])
      expect(() =>
        captureInstalledTransactionConfiguration({ ...input(directory), ...patch }),
      ).toThrow();
    let invoked = 0;
    expect(() =>
      captureInstalledTransactionConfiguration({
        ...input(directory),
        get credentials() {
          invoked++;
          return [];
        },
      }),
    ).toThrow();
    expect(invoked).toBe(0);
    expect(existsSync(path.join(directory, "transaction.sqlite"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
