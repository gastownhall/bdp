#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionDirectory = path.join(homedir(), ".local", "state", "bdp", "review-lab");
const identity = createHash("sha256").update(Buffer.from(workspace)).digest("hex").slice(0, 20);
const sessionFile = path.join(sessionDirectory, `${identity}.json`);
const runner = path.join(workspace, "scripts", "spec-review-lab.mjs");

try {
  const session = JSON.parse(await readFile(sessionFile, "utf8"));
  if (
    typeof session.socketPath !== "string" ||
    typeof session.root !== "string" ||
    path.dirname(session.socketPath) !== path.dirname(session.root) ||
    path.basename(session.socketPath) !== "r.sock"
  )
    throw new Error("invalid session");
  const result = spawnSync(
    process.execPath,
    [runner, "--invoke", session.socketPath, ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  if (result.error) {
    process.stderr.write(
      "Could not contact the BDP review lab. Restart it with `pnpm review:lab`.\n",
    );
    process.exitCode = 1;
  } else process.exitCode = result.status ?? 1;
} catch (error) {
  if (error?.code === "ENOENT")
    process.stderr.write(
      "No active BDP review lab. Start it with `pnpm review:lab` in the owner terminal.\n",
    );
  else
    process.stderr.write(
      "The BDP review lab session is invalid. Restart it with `pnpm review:lab`.\n",
    );
  process.exitCode = 1;
}
