import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { seedBdWorkspace, type BdWorkspaceSeed } from "./bd-workspace.js";

interface CommandTrace {
  readonly args: readonly string[];
  readonly creationSecond: number;
  readonly pid: number;
}

describe("actual bd workspace seeder with controlled creation-second witness", () => {
  it.each(["ready-trio", "unrelated-ids"] as const)(
    "separates every consecutive creation for %s while preserving public commands",
    async (kind) => {
      const directory = await mkdtemp(path.join(tmpdir(), "bdp-seed-contract-"));
      const controller = new AbortController();
      const realSetTimeout = globalThis.setTimeout;
      try {
        const workspace = path.join(directory, "workspace");
        await mkdir(workspace);
        const tracePath = path.join(directory, "commands.jsonl");
        const executable = path.join(directory, "fake-bd.mjs");
        // This real child executable only records the seeder's commands. It
        // does not implement bd, create issues, or manufacture ready results.
        await writeFile(
          executable,
          `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nappendFileSync(process.env.SEED_TRACE, JSON.stringify({ args: process.argv.slice(2), creationSecond: Math.floor(Number(process.env.SEED_EPOCH) / 1000), pid: process.pid }) + "\\n");\n`,
          { mode: 0o755 },
        );
        const environment: Record<string, string> = {
          PATH: process.env.PATH ?? "",
          HOME: directory,
          SEED_TRACE: tracePath,
          SEED_EPOCH: "0",
        };
        let epoch = 0;
        // Advance only the spacing clock. Actual spawn/streams/close events and
        // the helper's 10-second command deadlines keep their native behavior.
        vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, milliseconds, ...args) => {
          if (milliseconds !== 1_100) return realSetTimeout(handler, milliseconds, ...args);
          return realSetTimeout(() => {
            epoch += 1_100;
            environment.SEED_EPOCH = String(epoch);
            handler(...args);
          }, 0);
        });
        const ids =
          kind === "ready-trio"
            ? (["demo-a", "demo-d", "demo-j"] as const)
            : (["other-x", "other-y", "other-z"] as const);
        const seed: BdWorkspaceSeed = {
          actor: "seed-contract",
          prefix: kind === "ready-trio" ? "demo" : "other",
          beads: ids.map((id, index) => ({
            id,
            title: kind === "ready-trio" ? id.slice(-1).toUpperCase() : `Item ${index}`,
            type: "task",
            priority: 2,
            status:
              kind === "unrelated-ids" && index === 1
                ? "closed"
                : kind === "unrelated-ids" && index === 2
                  ? "deferred"
                  : "open",
          })),
          links: kind === "ready-trio" ? [] : [{ source: ids[0], target: ids[1], type: "blocks" }],
        };
        await seedBdWorkspace(executable, workspace, environment, seed, controller.signal);
        const commands = (await readFile(tracePath, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as CommandTrace);
        const expectedCommands = [
          ["init", "--prefix", seed.prefix, "--skip-agents", "--skip-hooks"],
          ...seed.beads.map((bead) => [
            "create",
            bead.title,
            "--id",
            bead.id,
            "--type",
            bead.type,
            "--priority",
            String(bead.priority),
            "--silent",
          ]),
          ...seed.links.map((link) => [
            "dep",
            "add",
            link.source,
            link.target,
            "--type",
            link.type,
          ]),
          ...(kind === "unrelated-ids"
            ? [
                ["close", ids[1], "--reason", "conformance fixture"],
                ["defer", ids[2]],
              ]
            : []),
        ];
        expect(commands.map((command) => command.args)).toEqual(
          expectedCommands.map((args) => ["--actor", seed.actor, ...args]),
        );
        for (const command of commands) {
          // seedBdWorkspace returns only after the real child close event.
          expect(() => process.kill(command.pid, 0)).toThrow(
            expect.objectContaining({ code: "ESRCH" }),
          );
        }
        const creations = commands.filter((command) => command.args[2] === "create");
        expect(creations.map((command) => command.args[5])).toEqual(ids);
        // Observe epochs recorded by the actual children at command execution,
        // not the number of timer calls. Removing any creation gap makes a tie.
        expect(creations.map((command) => command.creationSecond)).toEqual([0, 1, 2]);
      } finally {
        controller.abort();
        vi.restoreAllMocks();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
