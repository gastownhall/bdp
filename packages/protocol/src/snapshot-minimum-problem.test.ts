import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import {
  BDP_V0_SCHEMA_ID,
  isJsonSchemaDateTime,
  isJsonSchemaUri,
  isReadProblemCode,
  snapshotPositionTooOldProblem,
} from "./index.js";

it("S1 Snapshot conflict is direct Transactional only, with an exact family/status/retry", () => {
  const schema = JSON.parse(
    readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
  ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
  ajv.addSchema(schema);
  const direct = ajv.compile({ $ref: `${BDP_V0_SCHEMA_ID}#/$defs/transactionalProblem` });
  const value = snapshotPositionTooOldProblem();
  expect(direct(value), JSON.stringify(direct.errors)).toBe(true);
  expect(value).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/conflict",
    title: "snapshot-position-too-old",
    status: 409,
    code: "snapshot-position-too-old",
    retry: "after-state-change",
  });
  for (const definition of ["readProblem", "readUpdateProblem", "receiptProblem"]) {
    const validate = ajv.compile({ $ref: `${BDP_V0_SCHEMA_ID}#/$defs/${definition}` });
    expect(validate(value), definition).toBe(false);
  }
  expect(isReadProblemCode(value.code)).toBe(false);
  for (const changed of [
    { type: "https://github.com/gastownhall/bdp/problems/gone" },
    { status: 410 },
    { retry: "after-delay" },
    { diagnostics: [{ message: "not validation" }] },
    { diagnosticsTruncated: true },
  ])
    expect(direct({ ...value, ...changed }), JSON.stringify(changed)).toBe(false);
});
