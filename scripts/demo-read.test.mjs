import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spawnChild, terminateChild } from "./e2e-ready.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
async function run(args, port = undefined) {
  port ??= await freePort();
  const child = spawnChild(process.execPath, ["scripts/demo-read.mjs", ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, BDP_DEMO_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: args.length > 1 ? 90_000 : 20_000,
  });
  try {
    return await child.result;
  } finally {
    await terminateChild(child);
  }
}
describe.skipIf(!existsSync(path.join(root, "apps/bdp/dist/main.js")))(
  "runnable Read walkthrough",
  () => {
    it("uses actual HTTP Links and a separate packaged ready client, then closes its listener", async () => {
      const directory = await mkdtemp("/tmp/bdp-demo-test-");
      try {
        const output = path.join(directory, "run");
        const result = await run([output]);
        assert.equal(result.code, 0, result.stderr + result.stdout);
        const evidence = JSON.parse(await readFile(path.join(output, "result.json"), "utf8"));
        expect(evidence.successful).toBe(true);
        expect(evidence.cleanup).toEqual([]);
        expect(evidence.http.filter((item) => item.phase === "bdp-cli")).toHaveLength(12);
        expect(
          evidence.responses
            .filter((item) => item.request?.kind === "resource")
            .map((item) => item.value.properties.title),
        ).toEqual(["B", "A", "C"]);
        expect(JSON.parse(evidence.commands.at(-1).stdout).map((item) => item.title)).toEqual([
          "J",
          "D",
          "A",
        ]);
        await expect(
          fetch(evidence.scope, { signal: AbortSignal.timeout(1000) }),
        ).rejects.toThrow();
        const repeated = await run([output]);
        expect(repeated.code).not.toBe(0);
        expect(JSON.parse(await readFile(path.join(output, "result.json"), "utf8"))).toEqual(
          evidence,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
    it("refuses an unrecognized bd artifact before executing it", async () => {
      const directory = await mkdtemp("/tmp/bdp-demo-pin-test-");
      try {
        const executable = path.join(directory, "not-bd");
        await writeFile(executable, "this is not an executable");
        const output = path.join(directory, "run");
        const result = await run([output, executable]);
        expect(result.code).toBe(1);
        const evidence = JSON.parse(await readFile(path.join(output, "result.json"), "utf8"));
        expect(evidence.commands).toEqual([]);
        expect(evidence.http).toEqual([]);
        expect(evidence.successful).toBe(false);
        expect(evidence.failure).toContain("requires the recorded bd binary");
        expect(evidence.cleanup).toEqual([]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
    it("requires an output argument", async () => {
      const result = await run([]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("NEW_OUTPUT_DIRECTORY");
    });
    it.runIf(process.env.BDP_DEMO_BD_EXECUTABLE)(
      "matches real bd and preserves the established seed command recipe",
      async () => {
        const directory = await mkdtemp("/tmp/bdp-demo-real-test-");
        try {
          const output = path.join(directory, "run");
          const result = await run([output, process.env.BDP_DEMO_BD_EXECUTABLE]);
          assert.equal(result.code, 0, result.stderr + result.stdout);
          const evidence = JSON.parse(await readFile(path.join(output, "result.json"), "utf8"));
          const fixture = JSON.parse(
            await readFile(
              path.join(root, "packages/conformance/fixtures/read-bdpbd-v1.json"),
              "utf8",
            ),
          );
          const seed = fixture.bd;
          const expected = [
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
            ...seed.beads.flatMap((bead) =>
              bead.status === "closed"
                ? [["close", bead.id, "--reason", "conformance fixture"]]
                : bead.status === "deferred"
                  ? [["defer", bead.id]]
                  : [],
            ),
          ];
          expect(evidence.successful).toBe(true);
          expect(evidence.cleanup).toEqual([]);
          expect(evidence.commands.slice(1, -2).map((entry) => entry.argv)).toEqual(
            expected.map((argv) => ["--actor", seed.actor, ...argv]),
          );
          expect(JSON.parse(evidence.commands.at(-1).stdout)).toEqual(
            JSON.parse(evidence.commands.at(-2).stdout),
          );
          expect(evidence.responses[0].value.limits).toBeDefined();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
      100_000,
    );
  },
);
