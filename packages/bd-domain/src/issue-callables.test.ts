import { describe, expect, it } from "vitest";
import { issueCallableCatalog } from "./index.js";

const QUERY = "https://github.com/gastownhall/bdp/types/callable/callable-query";
const BATCH = "https://github.com/gastownhall/bdp/types/callable/callable-batch";

function refs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) refs(item, found);
  else if (node !== null && typeof node === "object")
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") found.push(value);
      else refs(value, found);
    }
  return found;
}

function resolves(root: unknown, ref: string): boolean {
  if (!ref.startsWith("#/")) return false;
  let node = root;
  for (const part of ref.slice(2).split("/")) {
    if (node === null || typeof node !== "object") return false;
    if (!Object.hasOwn(node, part)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return true;
}

describe("the static Issue catalog", () => {
  it("carries every declaration of the Issue document with its declared promises", async () => {
    const all = await issueCallableCatalog().list();
    expect(all).toHaveLength(39);
    expect(new Set(all.map(({ name }) => name)).size).toBe(39);
    expect(all.filter(({ type }) => type === QUERY)).toHaveLength(18);
    expect(all.filter(({ type }) => type === BATCH)).toHaveLength(21);
    expect(
      all
        .filter(({ idempotent }) => idempotent)
        .map(({ name }) => name)
        .sort(),
    ).toEqual([
      "add-dependencies",
      "claim-issue",
      "close-issue",
      "remove-dependency",
      "reopen-issue",
    ]);
    expect(
      all
        .filter(({ atomic }) => atomic)
        .map(({ name }) => name)
        .sort(),
    ).toEqual([
      "add-comment",
      "add-dependencies",
      "apply-batch",
      "batch-create-issues",
      "claim-next-issue",
      "delete-issues",
    ]);
    expect(all.filter(({ errorSchema }) => errorSchema !== undefined)).toHaveLength(11);
  });

  it("makes every schema self-contained, with no reference leaving it", async () => {
    let checked = 0;
    for (const declaration of await issueCallableCatalog().list()) {
      const schemas = [
        ...declaration.parameters.map(({ schema }) => schema),
        ...(declaration.resultSchema === undefined ? [] : [declaration.resultSchema]),
        ...(declaration.errorSchema === undefined ? [] : [declaration.errorSchema]),
      ];
      for (const schema of schemas)
        for (const ref of refs(schema)) {
          checked++;
          expect(resolves(schema, ref), `${declaration.name} ${ref}`).toBe(true);
        }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("derives each parameter from one property of the arguments fragment", async () => {
    const catalog = issueCallableCatalog();
    const ready = await catalog.get("list-ready-work");
    const parameter = (name: string) => ready?.parameters.find((entry) => entry.name === name);
    expect(ready?.description).toMatch(/^Unblocked open work/);
    expect(ready?.title).toBeUndefined();
    expect(parameter("limit")).toMatchObject({ default: 100, schema: { type: "integer" } });
    expect(parameter("sort")).toMatchObject({ default: "priority" });
    expect(parameter("assignee")).toEqual({
      name: "assignee",
      schema: { type: "string", description: "Only issues assigned to this actor." },
      description: "Only issues assigned to this actor.",
    });
    expect(parameter("type")?.schema).toMatchObject({
      $ref: "#/$defs/typeUri",
      $defs: {
        typeUri: { $ref: "#/$defs/absoluteHttpUrl" },
        absoluteHttpUrl: { type: "string", format: "uri" },
      },
    });

    const claim = await catalog.get("claim-issue");
    expect(claim).toMatchObject({ type: BATCH, idempotent: true });
    expect(claim?.atomic).toBeUndefined();
    expect(claim?.parameters).toMatchObject([{ name: "issue", required: true }]);
    expect(claim?.errorSchema).toMatchObject({
      oneOf: [{ $ref: "#/$defs/alreadyClaimedError" }, { $ref: "#/$defs/notClaimableError" }],
    });
    expect(claim?.resultSchema).toMatchObject({
      properties: { issue: { $ref: "#/$defs/issueView" } },
      $defs: { beadRecord: {}, issueView: {} },
    });

    const setting = (await catalog.get("get-setting"))?.resultSchema;
    expect(setting).toMatchObject({ properties: { key: { type: "string" } } });
    expect(setting).not.toHaveProperty("$defs");
    await expect(catalog.get("no-such-callable")).resolves.toBeUndefined();
  });

  it("carries no cliMapping because the Issue document declares none", async () => {
    const all = await issueCallableCatalog().list();
    expect(all.filter(({ cliMapping }) => cliMapping !== undefined)).toEqual([]);
  });
});
