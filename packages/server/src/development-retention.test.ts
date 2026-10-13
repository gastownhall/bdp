import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { stringifyJsonValue } from "@bdp/protocol";
import { openDevelopmentAuthority, DEVELOPMENT_BEAD_TYPE } from "./development-authority.js";
import {
  compileDevelopmentContracts,
  createDevelopmentAccessPolicy,
} from "./development-contracts.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { openRecoveryStore } from "./recovery-store.js";
const scope = "https://example.test/retention/",
  type = `${scope}types/child`,
  base = `${scope}types/base`;
const schema = "https://offline.invalid/object",
  number = "https://offline.invalid/number";
const roots: string[] = [];
const owners: Awaited<ReturnType<typeof openDevelopmentAuthority>>[] = [];
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.close();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing retained fixture data");
  return value;
}
function configuration() {
  const artifact = (retrievalUri: string, value: unknown) => ({
    retrievalUri,
    utf8Bytes: Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
  });
  const contracts = compileDevelopmentContracts({
    descriptors: [
      artifact(base, {
        id: base,
        name: "Base",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: schema,
      }),
      artifact(type, { id: type, name: "Child", describes: "bead", conformsTo: [base] }),
    ],
    schemas: [
      artifact(schema, {
        $id: schema,
        type: "object",
        required: ["n"],
        properties: { n: { $ref: number } },
      }),
      artifact(number, { $id: number, type: "integer", minimum: 0 }),
    ],
    limits: CONTRACT_ARTIFACT_CEILINGS,
  });
  return {
    contracts,
    access: createDevelopmentAccessPolicy({
      p: { create: true, write: true, hidden: [], readOnly: [] },
    }).policy,
    maximumEndpointMultiplicity: [],
  };
}
function directory() {
  const dir = mkdtempSync(path.join(tmpdir(), "bdp-ru-retention-"));
  roots.push(dir);
  return dir;
}
function raw<T>(dir: string, action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path.join(dir, "reference.sqlite"));
  db.function("bdp_json_syntax_v2", (text) => {
    try {
      JSON.parse(String(text));
      return 1;
    } catch {
      return 0;
    }
  });
  try {
    return action(db);
  } finally {
    db.close();
  }
}
function expected(dir: string) {
  return raw(dir, (db) => {
    const metadata = Object.fromEntries(
      db
        .prepare("SELECT * FROM metadata")
        .all()
        .map((row) => [String(row.name), String(row.value)]),
    );
    const expectedTypes = Object.fromEntries(
      db
        .prepare("SELECT * FROM installed_types")
        .all()
        .map((row) => [String(row.id), String(row.body)]),
    );
    return {
      directory: dir,
      scope,
      installationId: present(metadata.installation),
      lineageId: present(metadata.lineage),
      contractCapture: present(metadata.contractCapture),
      expectedTypes,
    };
  });
}
it.each([false, true])(
  "gates capture and complete inventory before cleanup (compiled=%s)",
  async (compiled) => {
    for (const corruption of [
      "capture",
      "missing-capture",
      "missing-type",
      "extra-type",
      "changed-type",
      ...(compiled ? ["artifact-bytes", "artifactLimits", "graphLimits", "evaluatorLimits"] : []),
    ]) {
      const dir = directory(),
        config = compiled ? configuration() : undefined;
      const options = {
        scope,
        directory: dir,
        create: true,
        ...(config ? { configuration: config } : {}),
      };
      const owner = await openDevelopmentAuthority(options);
      owners.push(owner);
      const api = owner.forPrincipal({ id: "p" });
      expect(
        await api.mutate(
          "createBead",
          JSON.stringify({
            id: "beads/live",
            type: compiled ? type : DEVELOPMENT_BEAD_TYPE,
            properties: { n: 1 },
          }),
          "saved",
        ),
      ).toMatchObject({ outcome: "created" });
      expect(
        await api.mutate(
          "updateBead",
          JSON.stringify({
            bead: "beads/missing",
            propertiesChange: [{ op: "add", path: "/n", value: 1 }],
          }),
          "failed",
        ),
      ).toMatchObject({ code: "resource-not-found" });
      await owner.close();
      const expectation = expected(dir);
      const store = openRecoveryStore(expectation);
      store.admit("p", ["pending"]);
      store.close();
      const filename = path.join(dir, "reference.sqlite"),
        valid = readFileSync(filename);
      raw(dir, (db) => {
        if (corruption === "missing-capture")
          db.prepare("DELETE FROM metadata WHERE name='contractCapture'").run();
        else if (corruption === "capture")
          db.prepare("UPDATE metadata SET value=? WHERE name='contractCapture'").run(
            `${expectation.contractCapture} `,
          );
        else if (corruption === "missing-type")
          db.prepare("DELETE FROM installed_types WHERE id=?").run(
            present(Object.keys(expectation.expectedTypes)[0]),
          );
        else if (corruption === "extra-type")
          db.prepare("INSERT INTO installed_types VALUES(?,?)").run("extra", "{}");
        else if (corruption === "changed-type")
          db.prepare("UPDATE installed_types SET body='{}' WHERE id=?").run(
            present(Object.keys(expectation.expectedTypes)[0]),
          );
        else {
          const captured = JSON.parse(expectation.contractCapture);
          if (corruption === "artifact-bytes") captured.artifacts[0].bytesBase64 = "AAAA";
          else captured[corruption] = {};
          db.prepare("UPDATE metadata SET value=? WHERE name='contractCapture'").run(
            JSON.stringify(captured),
          );
        }
      });
      const corrupt = readFileSync(filename);
      await expect(
        openDevelopmentAuthority({ ...options, create: false, clock: () => 86401000 }),
      ).rejects.toThrow(
        expect.objectContaining({
          reason: corruption === "missing-capture" ? "integrity" : "store-mismatch",
          message:
            corruption === "missing-capture"
              ? "missing store metadata: contractCapture"
              : ["missing-type", "extra-type", "changed-type"].includes(corruption)
                ? "installed Type inventory mismatch"
                : "installation capture mismatch",
        }),
      );
      expect(readFileSync(filename)).toEqual(corrupt);
      expect(
        raw(
          dir,
          (db) => db.prepare("SELECT state FROM key_state WHERE key='pending'").get()?.state,
        ),
      ).toBe("claimed");
      writeFileSync(filename, valid);
      const recovered = openRecoveryStore(expectation);
      expect(recovered.runtime.recoveredClaims).toBe(1);
      recovered.close();
      const reopened = await openDevelopmentAuthority({ ...options, create: false });
      owners.push(reopened);
      await reopened.close();
    }
  },
);
it("retains original offline artifacts through mutation, replay, deletion, expiry and restart", async () => {
  const dir = directory(),
    config = configuration();
  let now = 1000;
  const options = { scope, directory: dir, create: true, configuration: config, clock: () => now };
  const owner = await openDevelopmentAuthority(options);
  owners.push(owner);
  const api = owner.forPrincipal({ id: "p" });
  const create = JSON.stringify({ id: "beads/a", type, properties: { n: 1 } });
  const first = await api.mutate("createBead", create, "create");
  expect(first).toMatchObject({ outcome: "created" });
  const badText = JSON.stringify({
    bead: "beads/a",
    propertiesChange: [{ op: "replace", path: "/n", value: -1 }],
  });
  const failed = await api.mutate("updateBead", badText, "bad");
  expect(failed).toMatchObject({ code: "validation-failed" });
  await api.mutate(
    "updateBead",
    JSON.stringify({
      bead: "beads/a",
      propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
    }),
    "update",
  );
  expect(await api.mutate("updateBead", badText, "bad")).toEqual(failed);
  await owner.close();
  const saved = expected(dir),
    capture = JSON.parse(saved.contractCapture) as typeof config.contracts.capture;
  expect(saved.contractCapture).toBe(stringifyJsonValue(config.contracts.capture));
  expect(
    Buffer.from(
      present(capture.artifacts.find((a) => a.retrievalUri === type)).bytesBase64,
      "base64",
    ).toString(),
  ).not.toBe(saved.expectedTypes[type]);
  const artifacts = (kind: "descriptor" | "schema") =>
    capture.artifacts
      .filter((a) => a.kind === kind)
      .map((a) => ({
        retrievalUri: a.retrievalUri,
        utf8Bytes: Buffer.from(a.bytesBase64, "base64"),
      }));
  const reconstructed = compileDevelopmentContracts({
    descriptors: artifacts("descriptor"),
    schemas: artifacts("schema"),
    limits: capture.artifactLimits,
  });
  expect(reconstructed.identity).toBe(config.contracts.identity);
  const reopened = await openDevelopmentAuthority({
    ...options,
    create: false,
    configuration: { ...config, contracts: reconstructed },
  });
  owners.push(reopened);
  const next = reopened.forPrincipal({ id: "p" });
  expect(await next.mutate("createBead", create, "create")).toEqual(first);
  expect(await next.mutate("updateBead", badText, "bad")).toEqual(failed);
  await next.mutate("deleteBead", JSON.stringify({ bead: "beads/a" }), "delete");
  await reopened.close();
  now += 86400001;
  const expired = await openDevelopmentAuthority({ ...options, create: false });
  owners.push(expired);
  await expired.close();
  expect(expected(dir).contractCapture).toBe(saved.contractCapture);
  expect(raw(dir, (db) => db.prepare("SELECT count(*) AS n FROM resources").get()?.n)).toBe(0);
  expect(
    raw(dir, (db) => db.prepare("SELECT state FROM key_state WHERE key='create'").get()?.state),
  ).toBe("expired");
});
