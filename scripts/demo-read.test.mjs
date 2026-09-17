import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spawnChild, terminateChild } from "./e2e-ready.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
async function run(args, port) {
  const child = spawnChild(process.execPath, ["scripts/demo-read.mjs", ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, BDP_DEMO_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: 20_000,
  });
  try {
    return await child.result;
  } finally {
    await terminateChild(child);
  }
}
describe("runnable Read walkthrough", () => {
  it("uses actual HTTP Links and a separate packaged ready client, then closes its listener", async () => {
    const directory = await mkdtemp("/tmp/bdp-demo-test-");
    try {
      const output = path.join(directory, "run");
      const result = await run([output], 19289);
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
      await expect(fetch(evidence.scope, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
      const repeated = await run([output], 19289);
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
      const result = await run([output, executable], 19289);
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
});
