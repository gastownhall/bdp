#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  BLOCKING_LINK_TYPE_ID,
  isReadinessProblem,
  ReadyOutputCompatibilityError,
  readyBeadsFromClient,
  renderReadyJson,
  renderReadyText,
} from "@bdp/bd-domain";
import { BdpClient, BdpClientLocalError, createFetchTransport } from "@bdp/client";
import {
  ConfigError,
  formatConfigError,
  formatStartupDiagnostic,
  loadCanonicalCliConfig,
  loadCliProfile,
  loadStartupConfig,
  parseConfigArgs,
} from "@bdp/config";
import type { ReadProblem } from "@bdp/protocol";
import { type Command, CommanderError } from "commander";
import { createCanonicalCommand } from "./canonical-command.js";
import { readBoundedFile } from "./canonical-io.js";
import { runCanonicalInvocation } from "./canonical-runtime.js";

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

/** Bootstrap registration policy using the declared option arities. No
 * command-specific parsing or network activity occurs until the profile is known. */
export async function runBdp(args: readonly string[]): Promise<number> {
  // Keep the original no-argument lifecycle entry used by installed smoke checks.
  if (args.length === 0) return runLegacyBdp(args);
  let status = 0;
  try {
    const inventory = createCanonicalCommand({
      version,
      profile: "canonical",
      onInvocation: () => undefined,
    });
    const arities = new Map<string, boolean>();
    const visit = (command: Command): void => {
      for (const option of command.options) {
        if (option.long) arities.set(option.long, option.required || option.optional);
        if (option.short) arities.set(option.short, option.required || option.optional);
      }
      for (const child of command.commands) visit(child);
    };
    visit(inventory);
    let configFile: string | undefined, explicitProfile: "canonical" | "compat" | undefined;
    let configSeen = false,
      profileSeen = false;
    for (let index = 0; index < args.length; index++) {
      const argument = args[index] ?? "";
      if (argument === "--") break;
      const at = argument.indexOf("=");
      const name = at < 0 ? argument : argument.slice(0, at);
      if (!arities.has(name)) continue;
      const value =
        at >= 0 ? argument.slice(at + 1) : arities.get(name) ? args[++index] : undefined;
      if (name === "--config") {
        if (configSeen || value === undefined || value.length === 0)
          throw new Error("invalid bootstrap option");
        configSeen = true;
        configFile = value;
      }
      if (name === "--cli-profile") {
        if (profileSeen || (value !== "canonical" && value !== "compat"))
          throw new Error("invalid bootstrap option");
        profileSeen = true;
        explicitProfile = value;
      }
    }
    // Read a selected configuration once; profile registration and execution see
    // the same bytes even when the on-disk file changes during this invocation.
    const configPath = configFile ?? process.env.BDP_CONFIG;
    const configText =
      configPath === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(
            await readBoundedFile(configPath, 1_048_576),
          );
    const readFile = (): string => {
      if (configText === undefined) throw new Error("configuration not captured");
      return configText;
    };
    const selectedProfile =
      explicitProfile ?? loadCliProfile({ configFile, env: process.env, readFile });
    const tree = createCanonicalCommand({
      version: `${executable} ${version}`,
      profile: selectedProfile,
      writeOut: (text) => {
        process.stdout.write(text);
      },
      // Commander can echo unknown operands; diagnostics never echo argv.
      writeErr: () => undefined,
      onInvocation: async (invocation) => {
        if (invocation.command.join(" ") === "bd ready") {
          const env = {
            ...process.env,
            ...(typeof invocation.options.scope === "string"
              ? { BDP_SCOPE_URL: invocation.options.scope }
              : {}),
          };
          status = await runLegacyBdp(
            [
              ...(configFile === undefined ? [] : ["--config", configFile]),
              "bd",
              "ready",
              ...(invocation.options.json ? ["--json"] : []),
            ],
            env,
          );
          return;
        }
        const env = {
          ...process.env,
          ...(typeof invocation.options.scope === "string"
            ? { BDP_SCOPE_URL: invocation.options.scope }
            : {}),
        };
        const config = loadCanonicalCliConfig({ configFile, env, readFile });
        status = await runCanonicalInvocation(invocation, config, {
          stdout: (text) => {
            process.stdout.write(text);
          },
          stderr: (text) => {
            process.stderr.write(text);
          },
        });
      },
    });
    await tree.parseAsync([...args], { from: "user" });
    return status;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    // A typo may contain a credential. No argv, option value, file contents or
    // library exception text is copied to the diagnostic channel.
    diagnostic("error", "cli.usage", "invalid command or configuration; use --help for usage");
    return 2;
  }
}

async function runLegacyBdp(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(help);
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${executable} ${version}\n`);
    return 0;
  }

  if (args.length === 0) {
    const config = loadStartupConfig({ env, role: "bdp" });
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
      env,
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
