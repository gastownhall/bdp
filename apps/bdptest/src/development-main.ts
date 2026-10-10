#!/usr/bin/env node
import { readFileSync } from "node:fs";
import process from "node:process";
import { startDevelopmentReferenceServer } from "@bdp/server/development";

// Separate executable: normal bdptest admission/configuration is unchanged.
try {
  if (process.argv.length !== 3) throw new Error("expected one development configuration path");
  const config: unknown = JSON.parse(readFileSync(process.argv[2] as string, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("invalid configuration");
  const value = config as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "create,directory,port,token" ||
    typeof value.directory !== "string" ||
    typeof value.port !== "number" ||
    typeof value.token !== "string" ||
    typeof value.create !== "boolean"
  )
    throw new Error("invalid configuration");
  const server = await startDevelopmentReferenceServer({
    directory: value.directory,
    port: value.port,
    token: value.token,
    create: value.create,
  });
  process.stdout.write(
    `${JSON.stringify({ event: "development.ready", scope: server.scope, claimEligible: false })}\n`,
  );
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await server.close();
} catch {
  // Credentials and request data never enter diagnostics.
  process.stderr.write("bdptest development startup or shutdown failed\n");
  process.exitCode = 2;
}
