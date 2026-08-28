#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ConfigError,
  formatConfigError,
  formatStartupDiagnostic,
  loadStartupConfig,
  parseConfigArgs,
} from "@bdp/config";
import { BdpClient, BdpClientLocalError, createFetchTransport } from "@bdp/client";
import {
  BLOCKING_LINK_TYPE_ID,
  isReadinessProblem,
  ReadyOutputCompatibilityError,
  readyBeadsFromClient,
  renderReadyJson,
  renderReadyText,
} from "@bdp/bd-domain";
import type { ReadProblem } from "@bdp/protocol";

const executable = "bdp";
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const help = `Usage: bdp [--config <path>]
       bdp --help
       bdp --version

Commands:
  bdp bd ready [--json]  Compute readiness from generic BDP Read resources.

Options:
  --config <path>  Load a JSON startup configuration file from <path>.
  --help           Show this help text.
  --version        Show the executable version.

Startup configuration names, precedence, and Scope identity rules are pinned in
docs/design/startup-configuration.md.
`;

function diagnostic(level: "error" | "info", event: string, message: string): void {
  process.stderr.write(`${JSON.stringify({ level, event, executable, message })}\n`);
}

export async function runBdp(args: readonly string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(help);
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${executable} ${version}\n`);
    return 0;
  }

  if (args.length === 0) {
    const config = loadStartupConfig({ env: process.env, role: "bdp" });
    process.stderr.write(formatStartupDiagnostic(config, executable));
    diagnostic("info", "lifecycle.started", "bdp lifecycle started");
    diagnostic("info", "lifecycle.stopped", "bdp lifecycle stopped");
    return 0;
  }

  const json = args.includes("--json");
  const parsed = parseConfigArgs(args.filter((arg) => arg !== "--json"));
  if (
    parsed.rest.length !== 2 ||
    parsed.rest[0] !== "bd" ||
    parsed.rest[1] !== "ready" ||
    parsed.errors.length > 0
  ) {
    // Never echo argv: an unsupported argument may be a mistyped credential.
    const details = [
      ...parsed.errors,
      ...(parsed.rest.length > 0 ? [`${parsed.rest.length} unsupported argument(s)`] : []),
    ];
    diagnostic("error", "cli.usage", `${details.join("; ")}; use --help for usage`);
    return 2;
  }

  try {
    const config = loadStartupConfig({
      configFile: parsed.configFile,
      env: process.env,
      role: "bdp",
    });
    process.stderr.write(formatStartupDiagnostic(config, executable));
    const client = new BdpClient({ scope: config.scope.url, transport: createFetchTransport() });
    let output: string | undefined;
    let failureMessage: string | undefined;
    let exitCode = 0;
    try {
      const result = await readyBeadsFromClient(client, {
        blockingLinkType: BLOCKING_LINK_TYPE_ID,
      });
      if (isReadinessProblem(result)) {
        if (json) output = renderReadyErrorJson({ kind: "protocol", problem: result });
        else failureMessage = result.code;
        exitCode = 1;
      } else {
        output = json ? renderReadyJson(result) : renderReadyText(result);
      }
    } finally {
      await client.close();
    }
    if (output !== undefined) process.stdout.write(output);
    if (failureMessage !== undefined) diagnostic("error", "bd.ready.failed", failureMessage);
    return exitCode;
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(formatConfigError(error, executable));
      return 2;
    }
    if (error instanceof BdpClientLocalError) {
      if (json) process.stdout.write(renderReadyErrorJson({ kind: "local", code: error.code }));
      else diagnostic("error", "bd.ready.failed", error.code);
      return 1;
    }
    if (error instanceof ReadyOutputCompatibilityError) {
      if (json) process.stdout.write(renderReadyErrorJson({ kind: "local", code: error.code }));
      else diagnostic("error", "bd.ready.failed", error.code);
      return 1;
    }
    if (json)
      process.stdout.write(renderReadyErrorJson({ kind: "local", code: "internal-failure" }));
    else diagnostic("error", "bd.ready.failed", "internal-failure");
    return 1;
  }
}

function renderReadyErrorJson(
  error:
    | { readonly kind: "protocol"; readonly problem: ReadProblem }
    | { readonly kind: "local"; readonly code: string },
): string {
  return `${JSON.stringify({ error })}\n`;
}

if (isMainModule()) process.exitCode = await runBdp(process.argv.slice(2));

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
