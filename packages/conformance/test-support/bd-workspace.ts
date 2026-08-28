import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Isolated bd workspace provisioning, shared by the bdpbd matrix and the
 * packaged cohort generator. Everything here shells the pinned bd executable
 * inside a caller-supplied workspace and hermetic environment; nothing reads
 * ambient state, and the repository working tree is never a valid workspace.
 */

const commandTimeoutMs = 10_000;
const commandMaxOutputBytes = 1_048_576;

export interface BdCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface BdCommandOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface BdWorkspaceSeed {
  readonly actor: string;
  readonly prefix: string;
  readonly beads: readonly {
    readonly id: string;
    readonly title: string;
    readonly type: string;
    readonly priority: number;
    readonly status: string;
  }[];
  readonly links: readonly {
    readonly source: string;
    readonly target: string;
    readonly type: string;
  }[];
}

/** Resolve the pinned bd executable against an explicit PATH, or throw. */
export async function resolveBdExecutable(command: string, searchPath: string): Promise<string> {
  for (const candidate of bdExecutableCandidates(command, searchPath)) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next explicit PATH entry.
    }
  }
  throw new Error("pinned bd executable was not found on PATH");
}

export function bdExecutableCandidates(command: string, searchPath: string): readonly string[] {
  if (command.includes(path.sep)) return [path.resolve(command)];
  return searchPath
    .split(path.delimiter)
    .filter((directory) => directory.length > 0)
    .map((directory) => path.resolve(directory, command));
}

export function runBdWorkspaceCommand(
  executable: string,
  args: readonly string[],
  workspace: string,
  environment: Readonly<Record<string, string>>,
  options: BdCommandOptions,
): Promise<BdCommandResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(options.signal.reason);
      return;
    }
    const child = spawn(executable, args, {
      cwd: workspace,
      env: { ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeoutMs = options.timeoutMs ?? commandTimeoutMs;
    const maxOutputBytes = options.maxOutputBytes ?? commandMaxOutputBytes;
    let outputBytes = 0;
    let terminationReason: "abort" | "deadline" | "output-bound" | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = (reason?: typeof terminationReason): void => {
      terminationReason ??= reason;
      child.kill("SIGTERM");
      if (killTimer !== undefined) return;
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
      }, 250);
      killTimer.unref();
    };
    const timeout = setTimeout(() => terminate("deadline"), timeoutMs);
    timeout.unref();
    const abort = () => terminate("abort");
    if (options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });
    const collect =
      (target: Buffer[]) =>
      (chunk: Buffer): void => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) terminate("output-bound");
        else target.push(chunk);
      };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer !== undefined) clearTimeout(killTimer);
      options.signal.removeEventListener("abort", abort);
      callback();
    };
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) =>
      finish(() => {
        if (terminationReason === "deadline") reject(new Error("bd command exceeded its deadline"));
        else if (terminationReason === "output-bound")
          reject(new Error("bd command exceeded its output bound"));
        else if (terminationReason === "abort" || options.signal.aborted)
          reject(options.signal.reason);
        else if (code !== 0) reject(new Error(`bd command failed with exit ${String(code)}`));
        else
          resolve({
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
      }),
    );
  });
}

/**
 * Seed one isolated workspace from the fixture's bd section. The pause after
 * demo-a keeps created_at ordering deterministic across hosts; it is
 * load-bearing for ordering oracles and must not be removed.
 */
export async function seedBdWorkspace(
  executable: string,
  workspace: string,
  environment: Readonly<Record<string, string>>,
  seed: BdWorkspaceSeed,
  signal: AbortSignal,
): Promise<void> {
  const bd = async (args: readonly string[]): Promise<void> => {
    await runBdWorkspaceCommand(
      executable,
      ["--actor", seed.actor, ...args],
      workspace,
      environment,
      {
        signal,
      },
    );
  };
  await bd(["init", "--prefix", seed.prefix, "--skip-agents", "--skip-hooks"]);
  for (const bead of seed.beads) {
    await bd([
      "create",
      bead.title,
      "--id",
      bead.id,
      "--type",
      bead.type,
      "--priority",
      String(bead.priority),
      "--silent",
    ]);
    if (bead.id === "demo-a") await new Promise((resolve) => setTimeout(resolve, 1_100));
  }
  for (const link of seed.links)
    await bd(["dep", "add", link.source, link.target, "--type", link.type]);
  for (const bead of seed.beads) {
    if (bead.status === "closed") await bd(["close", bead.id, "--reason", "conformance fixture"]);
    else if (bead.status === "deferred") await bd(["defer", bead.id]);
  }
}
