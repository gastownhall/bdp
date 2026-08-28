#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";

import {
  ConfigError,
  formatConfigError,
  formatStartupDiagnostic,
  loadStartupConfig,
  parseConfigArgs,
  type ServerReadLimitsConfig,
} from "@bdp/config";
import {
  isNodeHttpListenerError,
  isReadServerAdmissionError,
  serveNodeHttpServer,
  type ProtocolProfile,
} from "@bdp/server";

import { createConfiguredBdpbdReadServer } from "./server-composition.js";

const executable = "bdpbd";
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const help = `Usage: bdpbd --serve [--config <path>]
       bdpbd [--config <path>]
       bdpbd --help
       bdpbd --version

Runs lifecycle mode by default; --serve requests a read-only BDP server backed
by the configured bd workspace and is refused until Read evidence exists.

Options:
  --serve          Request the HTTP Read server (refused until Read evidence exists).
  --config <path>  Load a JSON startup configuration file from <path>.
  --help           Show this help text.
  --version        Show the executable version.

In production mode bdpbd requires an explicit bd workspace; the local-test
default is not a deployment.

Startup configuration names, precedence, and Scope identity rules are pinned in
docs/design/startup-configuration.md.
`;

function diagnostic(
  level: "error" | "info",
  event: string,
  message: string,
  signal?: NodeJS.Signals,
): void {
  process.stderr.write(`${JSON.stringify({ level, event, executable, message, signal })}\n`);
}

function unexpectedErrorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
}

async function runServer(config: {
  readonly scope: { readonly url: string };
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly advertisedProfile?: ProtocolProfile;
    readonly limits: ServerReadLimitsConfig;
    readonly internalFaultResource?: string;
  };
  readonly bd: { readonly executable: string; readonly workspace?: string };
}): Promise<number> {
  const readServer = createConfiguredBdpbdReadServer(config);
  const stoppedBy = await serveNodeHttpServer(readServer, {
    host: config.server.host,
    port: config.server.port,
    onRequestError: (error) =>
      diagnostic(
        "error",
        "server.request_failed",
        `bdpbd request failed (${unexpectedErrorSummary(error)})`,
      ),
    onStarted: () => diagnostic("info", "server.started", "bdpbd Read server started"),
  });
  if (stoppedBy.kind === "listener-failure") {
    diagnostic("error", "server.listener_failed", stoppedBy.error.message);
  }
  diagnostic("info", "server.stopped", "bdpbd Read server stopped");
  return stoppedBy.kind === "listener-failure" ? 2 : 0;
}

async function runLifecycle(): Promise<number> {
  const stopped = new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => undefined, 2_147_483_647);
    const stop = (): void => {
      clearInterval(keepAlive);
      resolve();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
  diagnostic("info", "lifecycle.started", "bdpbd lifecycle started");
  await stopped;
  diagnostic("info", "lifecycle.stopped", "bdpbd lifecycle stopped");
  await new Promise<void>((resolve) => setImmediate(resolve));
  return 0;
}

async function main(args: readonly string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(help);
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${executable} ${version}\n`);
    return 0;
  }

  const serve = args.includes("--serve");
  const parsed = parseConfigArgs(args.filter((arg) => arg !== "--serve"));
  if (parsed.rest.length > 0 || parsed.errors.length > 0) {
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
      role: "bdpbd",
    });
    process.stderr.write(formatStartupDiagnostic(config, executable));
    if (!serve) return runLifecycle();
    // Await inside this try so admission failures become structured exit 2 diagnostics.
    return await runServer(config);
  } catch (error) {
    if (isReadServerAdmissionError(error)) {
      diagnostic("error", "startup.profile_refused", error.message);
      return 2;
    }
    if (isNodeHttpListenerError(error)) {
      diagnostic("error", "startup.listen_failed", error.message);
      return 2;
    }
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(formatConfigError(error, executable));
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
