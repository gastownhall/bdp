import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stringifyJsonValue } from "@bdp/protocol";
import { afterEach, expect, it } from "vitest";
import { openDevelopmentAuthority } from "./development-authority.js";
import {
  compileDevelopmentContracts,
  createDevelopmentAccessPolicy,
} from "./development-contracts.js";
import {
  CONTRACT_ARTIFACT_CEILINGS,
  ingestContractArtifacts,
} from "./installed-contract-artifact.js";
import { prepareTransaction } from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";

const scope = "https://example.test/policy/";
const type = `${scope}types/bead`;
const schema = "https://schema.test/object";
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const value = mkdtempSync(path.join(tmpdir(), "bdp-uri-policy-"));
  directories.push(value);
  return value;
}
function fixture() {
  const artifact = (retrievalUri: string, value: unknown) => ({
    retrievalUri,
    utf8Bytes: Buffer.from(JSON.stringify(value)),
  });
  const input = {
    descriptors: [
      artifact(type, {
        id: type,
        name: "Bead",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: schema,
      }),
    ],
    schemas: [artifact(schema, { type: "object", properties: { n: { type: "integer" } } })],
    limits: CONTRACT_ARTIFACT_CEILINGS,
  };
  const contracts = compileDevelopmentContracts(input);
  const captured = ingestContractArtifacts(input);
  // Exact predecessor algorithm, deliberately without an interpretation-policy
  // field. Do not manufacture a new-policy identity for old persisted evidence.
  const legacyIdentity = `development-schema5-${createHash("sha256")
    .update(
      stringifyJsonValue({
        artifacts: captured.sha256,
        artifactLimits: captured.receipt.limits,
        graphLimits: contracts.capture.graphLimits,
        evaluatorLimits: contracts.capture.evaluatorLimits,
      }),
    )
    .digest("hex")}`;
  const { graphPolicy: _policy, ...legacyCapture } = contracts.capture;
  return { input, contracts, legacyIdentity, legacyCapture };
}
function raw<T>(file: string, action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file);
  try {
    return action(db);
  } finally {
    db.close();
  }
}

it.each(["pre-policy", "different-policy"] as const)(
  "refuses %s transaction metadata before recovery writes and reopens the same policy unchanged",
  (kind) => {
    const f = fixture();
    const file = path.join(directory(), "transaction.sqlite");
    const options = {
      file,
      scope,
      types: f.contracts.descriptors,
      contracts: f.contracts,
      clock: () => 1000,
      maintenanceIntervalMs: 60000,
    };
    const owner = openTransactionStore({ ...options, create: true });
    const prepared = prepareTransaction(
      scope,
      JSON.stringify({
        operations: [{ operation: "createBead", id: "beads/a", type, properties: { n: 1 } }],
      }),
    );
    let saved: ReturnType<typeof owner.executeObserved>["receipt"];
    try {
      const first = owner.admit("p", "saved", prepared);
      if (first.kind !== "owned") throw new Error("expected owned claim");
      saved = owner.executeObserved(first.claim).receipt;
      expect(owner.admit("p", "pending", prepared).kind).toBe("owned");
    } finally {
      owner.close();
    }
    const current = readFileSync(file);
    // Simulate the exact old installation identity/capture fields while retaining
    // the receipt and pending claim, whose recovery would otherwise write state.
    raw(file, (db) => {
      if (kind === "pre-policy") {
        const row = db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()!;
        const configuration = JSON.parse(String(row.value));
        configuration.contractIdentity = f.legacyIdentity;
        db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(
          JSON.stringify(configuration),
        );
      }
      db.prepare("UPDATE metadata SET value=? WHERE name='contractCapture'").run(
        stringifyJsonValue(
          kind === "pre-policy"
            ? f.legacyCapture
            : { ...f.contracts.capture, graphPolicy: "schema-resource-index-2" },
        ),
      );
    });
    const legacyBytes = readFileSync(file);
    expect(() =>
      openTransactionStore({ ...options, create: false, clock: () => 86401000 }),
    ).toThrow(
      kind === "pre-policy"
        ? "transaction installation mismatch"
        : "transaction contract capture mismatch",
    );
    expect(readFileSync(file)).toEqual(legacyBytes);
    writeFileSync(file, current);
    const reopened = openTransactionStore({ ...options, create: false });
    try {
      expect(reopened.recoveredPending).toBe(1);
      expect(reopened.receipt("p", saved!.id)).toEqual(saved!);
    } finally {
      reopened.close();
    }
    expect(f.contracts.identity).not.toBe(f.legacyIdentity);
    expect(compileDevelopmentContracts(f.input).identity).toBe(f.contracts.identity);
  },
);

it.each(["pre-policy", "different-policy"] as const)(
  "refuses %s configured Read/Update custody before writes and preserves same-policy replay",
  async (kind) => {
    const f = fixture();
    const dir = directory();
    const configuration = {
      contracts: f.contracts,
      access: createDevelopmentAccessPolicy({
        p: { create: true, write: true, hidden: [], readOnly: [] },
      }).policy,
      maximumEndpointMultiplicity: [],
    };
    const options = { scope, directory: dir, configuration, clock: () => 1000 };
    const text = JSON.stringify({ id: "beads/a", type, properties: { n: 1 } });
    const owner = await openDevelopmentAuthority({ ...options, create: true });
    let first: unknown;
    try {
      first = await owner.forPrincipal({ id: "p" }).mutate("createBead", text, "saved");
    } finally {
      await owner.close();
    }
    const reopened = await openDevelopmentAuthority({ ...options, create: false });
    try {
      expect(await reopened.forPrincipal({ id: "p" }).mutate("createBead", text, "saved")).toEqual(
        first,
      );
    } finally {
      await reopened.close();
    }
    const file = path.join(dir, "reference.sqlite");
    raw(file, (db) => {
      if (kind === "pre-policy") {
        for (const name of ["installation", "lineage"]) {
          const row = db.prepare("SELECT value FROM metadata WHERE name=?").get(name)!;
          const value = String(row.value).replace(f.contracts.identity, f.legacyIdentity);
          expect(value).not.toBe(row.value);
          db.prepare("UPDATE metadata SET value=? WHERE name=?").run(value, name);
        }
        db.prepare("UPDATE metadata SET value=? WHERE name='contractCapture'").run(
          stringifyJsonValue(f.legacyCapture),
        );
      } else {
        db.prepare("UPDATE metadata SET value=? WHERE name='contractCapture'").run(
          stringifyJsonValue({ ...f.contracts.capture, graphPolicy: "schema-resource-index-2" }),
        );
      }
    });
    const legacyBytes = readFileSync(file);
    await expect(
      openDevelopmentAuthority({ ...options, create: false, clock: () => 86401000 }),
    ).rejects.toThrow(
      kind === "pre-policy"
        ? "store format/Scope/installation/lineage mismatch"
        : "installation capture mismatch",
    );
    expect(readFileSync(file)).toEqual(legacyBytes);
  },
);
