import { type Command, CommanderError } from "commander";
import { describe, expect, it } from "vitest";
import {
  type CanonicalInvocation,
  createCanonicalCommand,
  nearestCommand,
  UnknownCommandError,
} from "./canonical-command.js";

function fixture(profile: "canonical" | "compat" = "canonical") {
  const invocations: CanonicalInvocation[] = [];
  let stdout = "";
  let stderr = "";
  const command = createCanonicalCommand({
    version: "test-version",
    profile,
    onInvocation: (invocation) => {
      invocations.push(invocation);
    },
    writeOut: (text) => {
      stdout += text;
    },
    writeErr: (text) => {
      stderr += text;
    },
  });
  return { command, invocations, stdout: () => stdout, stderr: () => stderr };
}

async function parse(args: string[], profile: "canonical" | "compat" = "canonical") {
  const result = fixture(profile);
  await result.command.parseAsync(args, { from: "user" });
  return result;
}

function onlyInvocation(invocations: CanonicalInvocation[]): CanonicalInvocation {
  expect(invocations).toHaveLength(1);
  const invocation = invocations[0];
  if (!invocation) throw new Error("missing invocation");
  return invocation;
}

describe("canonical command registration and generated help", () => {
  it.each(["canonical", "compat"] as const)(
    "keeps help and actual registration in both directions (%s)",
    (profile) => {
      const { command } = fixture(profile);
      function check(node: Command) {
        const help = node.helpInformation();
        const allowed = new Set(["--help"]);
        for (let ancestor: Command | null = node; ancestor; ancestor = ancestor.parent) {
          for (const option of ancestor.options) if (option.long) allowed.add(option.long);
        }
        for (const option of node.options) if (option.long) expect(help).toContain(option.long);
        for (const match of help.matchAll(/--[a-z][a-z_-]*/g))
          expect(allowed.has(match[0]), `${node.name()}: ${match[0]}`).toBe(true);
        for (const child of node.commands) {
          expect(help).toContain(child.name());
          check(child);
        }
      }
      check(command);
    },
  );

  it("renders product-like grouped help without copying product globals", async () => {
    const result = fixture();
    await expect(result.command.parseAsync(["--help"], { from: "user" })).rejects.toMatchObject({
      code: "commander.helpDisplayed",
      exitCode: 0,
    });
    expect(result.stdout()).toContain("Usage:");
    expect(result.stdout()).toContain("Read Commands:");
    expect(result.stdout()).toContain("Write Commands:");
    expect(result.stdout()).toContain("Domain Commands:");
    for (const forbidden of [
      "--actor",
      "--json",
      "--db",
      "--workspace",
      "--verbose",
      "--quiet",
      "--readonly",
    ])
      expect(result.stdout()).not.toContain(forbidden);
    expect(result.invocations).toEqual([]);
  });

  it("shows the required Bead and Link identities in mutation usage", () => {
    const { command } = fixture();
    const update = command.commands.find((child) => child.name() === "update");
    const link = command.commands.find((child) => child.name() === "link");
    expect(update?.helpInformation()).toContain(
      "Usage: bdp update <bead-id> | --retry-file <file>",
    );
    expect(link?.commands.find((child) => child.name() === "update")?.helpInformation()).toContain(
      "Usage: bdp link update <link-id> | --retry-file <file>",
    );
  });

  it.each(["query", "graph", "count", "events", "type", "serve", "import", "export"])(
    "does not register unsupported or proposed %s",
    async (name) => {
      const result = fixture();
      await expect(result.command.parseAsync([name], { from: "user" })).rejects.toBeInstanceOf(
        UnknownCommandError,
      );
      expect(result.invocations).toEqual([]);
      expect(result.command.helpInformation()).not.toMatch(new RegExp(`^  ${name}(?: |$)`, "m"));
    },
  );

  it("a misused `bdp link` keeps its helpful error through a stray flag and points at issue dep add", async () => {
    const result = fixture();
    // A stray `--type` must not preempt the unknown-command error with a bare "unsupported argument".
    await expect(
      result.command.parseAsync(["link", "a", "b", "--type", "parent-child"], { from: "user" }),
    ).rejects.toThrow(
      /unknown command 'a' for 'bdp link'.*To create a Link, use `bdp link create.*to add a dependency, use `bdp issue dep add/s,
    );
    expect(result.invocations).toEqual([]);
  });

  it("suggests the nearest command, and only one near enough (row 2)", () => {
    expect(nearestCommand("inspcet", ["set", "inspect"])).toBe("inspect");
    expect(nearestCommand("ins", ["set", "inspect"])).toBe("inspect");
    expect(nearestCommand("lnk", ["show", "link", "list"])).toBe("link");
    expect(nearestCommand("status", ["set", "inspect"])).toBeUndefined();
  });

  it("registers connect with --clear and the global --response-context (rows 1 and 4)", async () => {
    const { invocations } = await parse(["--response-context", "connect", "--clear"]);
    expect(onlyInvocation(invocations)).toMatchObject({
      command: ["connect"],
      positionals: [],
      options: { clear: true, responseContext: true },
    });
  });

  it.each([
    ["versions", "note-1"],
    ["link", "versions", "rel-1"],
  ])("registers retained History command %s", async (...args) => {
    const { invocations } = await parse(args);
    expect(onlyInvocation(invocations)).toMatchObject({
      command: args.length === 2 ? ["versions"] : ["link", "versions"],
      positionals: [args.at(-1)],
    });
  });

  it("does not register canonical commands in the tiny compatibility tree", async () => {
    const result = fixture("compat");
    expect(result.command.commands.map((command) => command.name())).toEqual(["bd"]);
    await expect(
      result.command.parseAsync(["show", "note"], { from: "user" }),
    ).rejects.toBeInstanceOf(UnknownCommandError);
    expect(result.invocations).toEqual([]);
  });

  it.each(["canonical", "compat"] as const)(
    "preserves command-specific bd ready --json under %s",
    async (profile) => {
      const { invocations } = await parse(["bd", "ready", "--json"], profile);
      expect(invocations).toEqual([
        {
          command: ["bd", "ready"],
          positionals: [],
          options: { json: true },
          explicitOptions: ["json"],
        },
      ]);
    },
  );

  it("leaves version/help exits to root integration without process.exit", async () => {
    const result = fixture();
    await expect(result.command.parseAsync(["--version"], { from: "user" })).rejects.toMatchObject({
      exitCode: 0,
    });
    expect(result.stdout()).toBe("test-version\n");
    expect(result.invocations).toHaveLength(0);
  });
});

describe("canonical invocation data and structural admission", () => {
  it("preserves literal References, opaque guards, ordered repeated options and explicit sources", async () => {
    const { invocations } = await parse([
      "--config",
      "chosen.json",
      "update",
      "note",
      "--set-property",
      "a=1",
      "--set-property",
      "a=2",
      "--unset-property",
      "b",
      "--if-revision",
      "=3",
    ]);
    const invocation = onlyInvocation(invocations);
    expect(invocation.command).toEqual(["update"]);
    expect(invocation.positionals).toEqual(["note"]);
    expect(invocation.options).toEqual({
      config: "chosen.json",
      setProperty: ["a=1", "a=2"],
      unsetProperty: ["b"],
      ifRevision: "=3",
    });
    expect(invocation.explicitOptions).toEqual([
      "config",
      "setProperty",
      "unsetProperty",
      "ifRevision",
    ]);
    expect(invocation.options).not.toHaveProperty("outputFormat");
    expect(Object.isFrozen(invocation)).toBe(true);
    expect(Object.isFrozen(invocation.options)).toBe(true);
    expect(Object.isFrozen(invocation.options.setProperty)).toBe(true);
  });

  it("registers scope inspect and preserves the effective supplied profile", async () => {
    const { invocations } = await parse([
      "--cli-profile",
      "canonical",
      "scope",
      "inspect",
      "https://example.invalid/work/",
    ]);
    expect(invocations[0]).toMatchObject({
      command: ["scope", "inspect"],
      positionals: ["https://example.invalid/work/"],
      options: { cliProfile: "canonical" },
    });
  });

  it.each([
    ["--output-mode", "json", "scope", "inspect"],
    ["scope", "inspect", "--output-mode", "human"],
  ])("accepts the global output mode in either CLI position: %j", async (...args) => {
    const { invocations } = await parse(args);
    expect(invocations[0]?.options.outputMode).toBe(args[0] === "--output-mode" ? "json" : "human");
    expect(invocations[0]?.explicitOptions).toContain("outputMode");
  });

  it.each([
    ["--scope", "https://example.invalid/work/", "update", "note", "--properties", "{}"],
    ["update", "note", "--scope", "https://example.invalid/work/", "--properties", "{}"],
  ])("accepts the same common Scope before or after the command %j", async (...args) => {
    const { invocations } = await parse(args);
    expect(onlyInvocation(invocations).options.scope).toBe("https://example.invalid/work/");
    expect(onlyInvocation(invocations).explicitOptions).toContain("scope");
  });

  it("allows only page-size adjustment on an opaque continuation", async () => {
    const { invocations } = await parse([
      "list",
      "--continue",
      "https://example.invalid/next?opaque=%2B",
      "--page-size",
      "7",
    ]);
    expect(onlyInvocation(invocations).options).toEqual({
      continue: "https://example.invalid/next?opaque=%2B",
      pageSize: "7",
    });
  });

  it.each([
    ["show", "note", "--scope", "a", "--scope", "b"],
    ["--scope", "a", "show", "note", "--scope", "b"],
    ["--config", "a", "--config", "b", "show", "note"],
    ["update", "note", "--properties", "{}", "--if-revision", "3", "--if-revision", "3"],
    ["create", "--type", "memory", "--actor", "a", "--actor", "a"],
    ["create", "--type", "memory", "--idempotency-key", "a", "--idempotency-key", "b"],
    ["show", "note", "--long", "--long"],
    ["batch", "--retry-file", "a", "--retry-file", "b"],
  ])("rejects singleton option repetitions before invocation: %j", async (...args) => {
    const result = fixture();
    await expect(result.command.parseAsync(args, { from: "user" })).rejects.toBeInstanceOf(
      CommanderError,
    );
    expect(result.invocations).toEqual([]);
  });

  it.each([
    ["a", "b"],
    ["a", "--to", "b"],
    ["--from", "a", "--to", "b"],
  ])("admits exactly the selected Link creation form %j", async (...args) => {
    const { invocations } = await parse(["link", "create", ...args, "--type", "references"]);
    expect(onlyInvocation(invocations).command).toEqual(["link", "create"]);
  });

  it.each([["a", "b", "--to", "b"], ["--from", "a", "b"], ["a"], ["--to", "b"]])(
    "refuses ambiguous/incomplete Link creation %j",
    async (...args) => {
      const result = fixture();
      await expect(
        result.command.parseAsync(["link", "create", ...args, "--type", "references"], {
          from: "user",
        }),
      ).rejects.toBeInstanceOf(CommanderError);
      expect(result.invocations).toEqual([]);
    },
  );

  it.each([
    ["create", "--type", "memory"],
    ["update", "note", "--properties", "{}"],
    ["link", "create", "a", "b", "--type", "references"],
    ["link", "update", "edge", "--properties", "{}"],
    ["link", "delete", "edge", "--force"],
  ])("admits actor input only on a provenance-capable mutation %j", async (...args) => {
    const { invocations } = await parse([...args, "--actor", "caller-data"]);
    expect(onlyInvocation(invocations).options.actor).toBe("caller-data");
  });

  it.each([
    ["show", "note"],
    ["list"],
    ["delete", "note", "--force"],
    ["alias", "put", "route", "--target", "note"],
    ["alias", "delete", "route", "--force"],
    ["batch", "--file", "members.jsonl"],
    ["bd", "ready"],
  ])("refuses actor on a non-provenance command %j", async (...args) => {
    const result = fixture();
    await expect(
      result.command.parseAsync([...args, "--actor", "must-not-dispatch"], { from: "user" }),
    ).rejects.toBeInstanceOf(CommanderError);
    expect(result.invocations).toEqual([]);
  });

  it.each([
    "--json",
    "--db",
    "--workspace",
    "--verbose",
    "--quiet",
    "--readonly",
    "--head",
    "--revision",
  ])("rejects unrelated/deferred flags on canonical show: %s", async (name) => {
    const result = fixture();
    await expect(
      result.command.parseAsync(["show", "note", name], { from: "user" }),
    ).rejects.toBeInstanceOf(CommanderError);
    expect(result.invocations).toEqual([]);
  });

  it("accepts a frozen retry without requiring original operands or inputs", async () => {
    const { invocations } = await parse([
      "link",
      "create",
      "--retry-file",
      "saved.json",
      "--output-format",
      "json",
    ]);
    expect(invocations[0]).toMatchObject({
      command: ["link", "create"],
      positionals: [],
      options: { retryFile: "saved.json", outputFormat: "json" },
    });
  });

  it.each([
    ["update", "note", "--retry-file", "saved.json"],
    ["update", "--retry-file", "saved.json", "--actor", "changed"],
    ["update", "--retry-file", "saved.json", "--scope", "changed"],
    ["batch", "--retry-file", "saved.json", "--file", "changed"],
    ["delete", "note", "--if-revision", "3"],
    ["create", "--type", "memory", "--batch-bind", "name"],
    ["create", "--type", "memory", "--dry-run-mode", "batch", "--output-format", "json"],
    ["batch", "--file", "x", "--batch-version", "2"],
    ["batch", "--file", "x", "--input-format", "json", "--batch-version", "1"],
    ["show", "note", "--properties-only", "--include-links"],
    ["list", "--paged", "--unpaged"],
    ["link", "list", "--direction", "out"],
    ["link", "list", "--all-revisions"],
    ["list", "--continue", "https://example.invalid/next", "--selector", "$[*]"],
    ["list", "https://example.invalid/", "--scope", "https://example.invalid/"],
    ["alias", "delete", "route"],
  ])("refuses incompatible invocation structure %j", async (...args) => {
    const result = fixture();
    await expect(result.command.parseAsync(args, { from: "user" })).rejects.toBeInstanceOf(
      CommanderError,
    );
    expect(result.invocations).toEqual([]);
  });
});

describe("historical Bead Update authoring", () => {
  it.each(["--from-revision", "--from_revision"])(
    "accepts source-only Update using %s",
    async (flag) => {
      const invocation = onlyInvocation(
        (await parse(["update", "note", flag, "=source", "--if-revision", "current"])).invocations,
      );
      expect(invocation.options).toEqual({ fromRevision: "=source", ifRevision: "current" });
      expect(invocation.explicitOptions).toContain("fromRevision");
    },
  );
  it("refuses duplicate source selectors across both spellings", async () => {
    await expect(
      parse(["update", "note", "--from-revision", "=a", "--from_revision", "=b"]),
    ).rejects.toBeInstanceOf(CommanderError);
  });
  it.each([
    ["create", "--type", "Task"],
    ["delete", "note", "--force"],
    ["link", "update", "edge", "--metadata", "{}"],
  ])("does not widen another operation: %s", async (...args) => {
    await expect(parse([...args, "--from-revision", "=source"])).rejects.toBeInstanceOf(
      CommanderError,
    );
  });
});
