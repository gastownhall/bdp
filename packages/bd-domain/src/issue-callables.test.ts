import { readFileSync } from "node:fs";
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
    expect(all).toHaveLength(45);
    expect(new Set(all.map(({ name }) => name)).size).toBe(45);
    expect(all.filter(({ type }) => type === QUERY)).toHaveLength(21);
    expect(all.filter(({ type }) => type === BATCH)).toHaveLength(24);
    expect(
      all
        .filter(({ idempotent }) => idempotent)
        .map(({ name }) => name)
        .sort(),
    ).toEqual(["issue/claim", "issue/close", "issue/dep/add", "issue/dep/remove", "issue/reopen"]);
    expect(
      all
        .filter(({ atomic }) => atomic)
        .map(({ name }) => name)
        .sort(),
    ).toEqual([
      "issue/batch",
      "issue/claim-next",
      "issue/comment",
      "issue/create-many",
      "issue/delete",
      "issue/dep/add",
    ]);
    expect(
      all
        .filter(({ errorSchema }) => errorSchema !== undefined)
        .map(({ name }) => name)
        .sort(),
    ).toEqual([
      "events/list",
      "issue/batch",
      "issue/claim",
      "issue/close",
      "issue/create",
      "issue/dep/add",
      "issue/heartbeat",
      "issue/unclaim",
      "issue/update",
    ]);
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
    expect(checked).toBeGreaterThan(140);
  });

  it("names each section of the Issue document, in the document's order of the name table", async () => {
    const document = readFileSync(
      new URL("../../../specs/types/issue/callables.md", import.meta.url),
      "utf8",
    );
    const start = document.indexOf("## 1. Names");
    const table = document.slice(start, document.indexOf("## 2. ", start));
    const named = [...table.matchAll(/^\| `([^`]+)` \| (CallableQuery|CallableBatch) \|/gm)].map(
      ([, name, kind]) => [name, kind === "CallableQuery" ? QUERY : BATCH],
    );
    const all = await issueCallableCatalog().list();
    expect(named).toHaveLength(45);
    expect(all.map(({ name, type }) => [name, type]).sort()).toEqual(named.sort());
  });

  it("derives each parameter from one property of the arguments fragment", async () => {
    const catalog = issueCallableCatalog();
    const ready = await catalog.get("issue/ready");
    const parameter = (name: string) => ready?.parameters.find((entry) => entry.name === name);
    expect(ready?.title).toBe("List ready work");
    expect(ready?.description).toMatch(/^Unblocked, open work/);
    expect(parameter("limit")?.schema).toMatchObject({ type: "integer" });
    expect(parameter("assignee")).toMatchObject({
      name: "assignee",
      schema: { type: "string" },
      description: "Only issues assigned to this actor.",
    });

    const claim = await catalog.get("issue/claim");
    expect(claim).toMatchObject({ type: BATCH, idempotent: true, title: expect.any(String) });
    expect(claim?.atomic).toBeUndefined();
    expect(claim?.parameters).toMatchObject(
      expect.arrayContaining([expect.objectContaining({ name: "id", required: true })]),
    );
    await expect(catalog.get("no-such-callable")).resolves.toBeUndefined();
    await expect(catalog.get("list-issues")).resolves.toBeUndefined();
  });

  it("carries each CLI mapping and declares every service default of Issue §4", async () => {
    const catalog = issueCallableCatalog();
    expect(
      (await catalog.list()).filter(({ cliMapping }) => cliMapping !== undefined),
    ).toHaveLength(28);
    expect((await catalog.get("issue/update"))?.cliMapping?.memberFlags).toEqual(
      expect.arrayContaining([
        { member: "title", parameter: "patch" },
        { member: "status", names: ["-s"], parameter: "patch" },
      ]),
    );
    expect((await catalog.get("issue/create"))?.cliMapping?.memberFlags).toEqual([
      { member: "spawner_id", parameter: "waits_for" },
      { member: "gate", names: ["--waits-for-gate"], parameter: "waits_for" },
    ]);
    expect((await catalog.get("issue/create"))?.cliMapping).toMatchObject({
      positionals: [{ position: 0, parameter: "title" }],
      flags: expect.arrayContaining([{ names: ["-t", "--type"], parameter: "issue_type" }]),
      fromFile: [
        { names: ["--body-file"], parameter: "description" },
        { names: ["--design-file"], parameter: "design" },
      ],
    });
    const declares = async (name: string, expected: Record<string, unknown>) => {
      const declared = (await catalog.get(name))?.parameters ?? [];
      for (const [parameter, value] of Object.entries(expected)) {
        const held = declared.find((candidate) => candidate.name === parameter);
        expect(held?.default, `${name}.${parameter}`).toEqual(value);
        expect(held?.required, `${name}.${parameter}`).toBeUndefined();
      }
    };
    await declares("issue/create", {
      issue_type: "https://github.com/gastownhall/bdp/types/issue/task",
    });
    await declares("issue/list", { sort: "priority" });
    await declares("issue/dep/list", { direction: "out" });
    await declares("issue/close", { reason: "Closed" });
    await declares("issue/purge", {
      dry_run: true,
      tier: "ephemeral",
      protect_referenced: false,
      protect_live_dependents: true,
    });
    await declares("issue/prune", {
      dry_run: true,
      tier: "durable",
      protect_referenced: true,
      protect_live_dependents: false,
    });
    await declares("issue/delete", { dry_run: true });
    await declares("issue/reclaim", { older_than_seconds: 600 });
  });

  it("declares no actor or author, and no cliMapping defaults", async () => {
    for (const { name, parameters, cliMapping } of await issueCallableCatalog().list()) {
      expect(
        parameters
          .map((parameter) => parameter.name)
          .filter((n) => ["actor", "author"].includes(n)),
        name,
      ).toEqual([]);
      expect(Object.keys(cliMapping ?? {}), name).not.toContain("defaults");
    }
  });
});
