import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { spawnChild, terminateChild } from "./e2e-ready.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const entries = ["packages/client/dist/index.js", "packages/protocol/dist/index.js"];
async function run(args) {
  const child = spawnChild(process.execPath, ["scripts/demo-history.mjs", ...args], {
    cwd: root,
    env: { PATH: process.env.PATH },
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: 30_000,
  });
  try {
    return await child.result;
  } finally {
    await terminateChild(child);
  }
}
describe.skipIf(!entries.every((entry) => existsSync(path.join(root, entry))))(
  "runnable controlled History walkthrough",
  () => {
    it.each(["before", "during"])(
      "settles startup cancellation %s binding with the original reason",
      async (when) => {
        const { listenFixture } = await import("./demo-history.mjs");
        const server = createServer();
        // Node's HTTP server installs its own listening handler. Preserve it;
        // only the temporary handlers owned by listenFixture must disappear.
        const originalErrors = server.listeners("error");
        const originalListening = server.listeners("listening");
        const controller = new AbortController();
        const reason = new Error("controlled startup interruption");
        if (when === "before") controller.abort(reason);
        const closed =
          when === "during"
            ? new Promise((resolve) => server.once("close", resolve))
            : Promise.resolve();
        try {
          const listening = listenFixture(server, controller.signal);
          const rejected = expect(listening).rejects.toBe(reason);
          if (when === "during") controller.abort(reason);
          await rejected;
          await closed;
          expect(server.listening).toBe(false);
          expect(server.address()).toBeNull();
          expect(server.listeners("error")).toEqual(originalErrors);
          expect(server.listeners("listening")).toEqual(originalListening);
        } finally {
          controller.abort(reason);
          server.closeAllConnections();
          if (server.listening) await new Promise((resolve) => server.close(resolve));
        }
      },
      5000,
    );
    it("does not publish success when a required evidence write fails", async () => {
      const { publishHistoryResult } = await import("./demo-history.mjs");
      const directory = await mkdtemp("/tmp/bdp-history-publish-");
      const stdout = vi.spyOn(process.stdout, "write");
      try {
        await mkdir(path.join(directory, "transcript.txt"));
        await expect(
          publishHistoryResult(directory, { successful: true, http: [], cleanup: [] }, []),
        ).rejects.toThrow();
        expect(stdout).not.toHaveBeenCalled();
        expect(existsSync(path.join(directory, "result.json"))).toBe(false);
      } finally {
        stdout.mockRestore();
        await rm(directory, { recursive: true, force: true });
      }
    });
    it("records real HTTP and SDK observations, preserves old pins, refuses fallback and closes", async () => {
      const directory = await mkdtemp("/tmp/bdp-history-demo-test-");
      try {
        const output = path.join(directory, "run");
        const child = await run([output]);
        assert.equal(child.code, 0, child.stderr + child.stdout);
        const evidence = JSON.parse(await readFile(path.join(output, "result.json"), "utf8"));
        const http = JSON.parse(await readFile(path.join(output, "http.json"), "utf8"));
        const transcript = await readFile(path.join(output, "transcript.txt"), "utf8");
        expect(evidence.successful).toBe(true);
        expect(evidence.fixture).toBe(true);
        expect(evidence.provenance).toContain("controlled History HTTP fixture");
        expect(evidence.cleanup).toEqual([]);
        expect(evidence.http).toEqual(http);
        for (const row of http)
          expect(row.body).toEqual(row.payload === null ? null : JSON.parse(row.payload));
        expect(http[0].headers.link).toBe(`<${evidence.scope}bdp.json>; rel="service-desc"`);
        expect(http[1].body.historicalResolution).toEqual({ version: 1 });
        expect(http[6].headers["content-type"]).toBe("application/problem+json");
        expect(evidence.observations.map((row) => row.problem)).toEqual([
          false,
          false,
          false,
          false,
          true,
        ]);
        expect(http).toHaveLength(7);
        expect(http.map((row) => row.method)).toEqual(Array(7).fill("GET"));
        expect(http.map((row) => row.status)).toEqual([204, 200, 200, 200, 200, 200, 409]);
        const urls = http.map((row) => new URL(row.target, evidence.scope));
        expect(urls.map((url) => url.pathname)).toEqual([
          "/history-demo/",
          "/history-demo/bdp.json",
          "/history-demo/beads/decision",
          "/history-demo/beads/decision",
          "/history-demo/beads/decision",
          "/history-demo/links/citation",
          "/history-demo/beads/decision",
        ]);
        expect(urls[2].search).toBe("?view=versions&limit=2");
        expect(http[3].target).toBe(
          evidence.observations[0].value.next.slice(new URL(evidence.scope).origin.length),
        );
        expect(urls[4].searchParams.getAll("revision")).toEqual(["r +/%?&雪"]);
        expect(urls[5].searchParams.getAll("revision")).toEqual(["link-old"]);
        expect(urls[6].searchParams.getAll("revision")).toEqual(["r2"]);
        const values = evidence.observations.map((observation) => observation.value);
        expect(values).toEqual(http.slice(2).map((row) => row.body));
        expect(values).toHaveLength(5);
        expect(
          [...values[0].items, ...values[1].items].map((row) => [
            row.revision,
            row.lineage,
            row.body,
          ]),
        ).toEqual([
          ["r4", "current", "complete"],
          ["r3", "replaced", "complete"],
          ["r2", "replaced", "incomplete"],
          ["r +/%?&雪", "current", "complete"],
        ]);
        expect(values[1].next).toBeNull();
        expect(values[2].properties.title).toBe("Original plan: launch on Monday");
        expect(values[2].links).toBeUndefined();
        expect(values[2].ownedLinks).toBeUndefined();
        expect(values[2].changeContext.agent.value).toBe("assistant-a");
        expect(values[3].target.revision).toBe("target%2Fold");
        expect(values[3].source).toBe(`${evidence.scope}beads/decision`);
        expect(values[4]).toMatchObject({
          status: 409,
          code: "revision-unretained",
          retry: "after-state-change",
          missing: { complete: false },
        });
        expect(values[4].missing.items).toHaveLength(2);
        expect(transcript).toBe(child.stdout);
        expect(transcript).toContain("PASS: five SDK observations, seven actual HTTP requests");
        // Natural code0 inside the child deadline plus its cleanup record is the listener oracle.
        // A post-exit port probe could hit an unrelated process reusing the ephemeral port.
        const repeated = await run([output]);
        expect(repeated.code).not.toBe(0);
        expect(await readFile(path.join(output, "result.json"), "utf8")).toBe(
          `${JSON.stringify(evidence, null, 2)}\n`,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }, 40_000);
    it.each([
      { args: [] },
      { args: [""] },
      { args: ["relative-output"] },
      { args: ["/tmp/unused", "extra"] },
    ])(
      "refuses invalid arguments %j",
      async ({ args }) => {
        const child = await run(args);
        expect(child.code).not.toBe(0);
        expect(child.stderr).toContain("ABSOLUTE_NEW_OUTPUT_DIRECTORY");
        expect(child.stdout).not.toContain("PASS:");
      },
      40_000,
    );
    it("does not modify an existing output directory", async () => {
      const directory = await mkdtemp("/tmp/bdp-history-existing-");
      try {
        const marker = path.join(directory, "result.json");
        await writeFile(marker, "preserve previous run\n");
        const child = await run([directory]);
        expect(child.code).not.toBe(0);
        expect(await readFile(marker, "utf8")).toBe("preserve previous run\n");
        expect(child.stdout).toBe("");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }, 40_000);
  },
);
