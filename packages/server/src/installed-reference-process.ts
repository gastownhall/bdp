/** Private installed qualification bootstrap. No package export, bin or CLI flag.
 * No clock/store/outcome control. Configuration arrives only through inherited IPC.
 */
import process from "node:process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { administrativeData } from "./development-contracts.js";
import { startInstalledReferenceCandidate } from "./installed-reference.js";

async function main() {
  if (!process.send || process.argv.length !== 2) throw new TypeError("inherited IPC required");
  const send = process.send.bind(process);
  const input = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("configuration deadline")), 10000);
    process.once("disconnect", () => {
      clearTimeout(timer);
      reject(new Error("configuration disconnected"));
    });
    process.once("message", (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
  const { configuration } = administrativeData(input, ["configuration"]);
  let stop!: () => void;
  let stopping = false;
  const stopped = new Promise<void>((resolve) => {
    stop = () => {
      stopping = true;
      resolve();
    };
  });
  process.once("SIGTERM", () => stop());
  process.once("SIGINT", () => stop());
  process.once("disconnect", () => stop());
  process.on("message", (message) => {
    try {
      const value = administrativeData(message, ["command"]);
      if (value.command !== "close") throw new TypeError("unsupported control");
    } catch {
      process.exitCode = 2;
    }
    stop();
  });
  if (!process.connected) stop();
  const runtime = await startInstalledReferenceCandidate(configuration);
  try {
    if (process.connected && !stopping)
      send({
        event: "qualification.ready",
        scope: runtime.scope,
        claimEligible: false,
        configurationIdentity: runtime.configurationIdentity,
        artifactIdentity: runtime.artifactIdentity,
        payloadIdentity: runtime.payloadIdentity,
        policyIdentity: runtime.policyIdentity,
        authenticationIdentity: runtime.authenticationIdentity,
        profile: runtime.profile,
        history: runtime.history,
      });
    await stopped;
  } finally {
    await runtime.close();
    if (process.connected) process.disconnect();
  }
}
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
// Private qualification diagnostics contain only fixed categories. Never send
// exception messages, paths, credentials, configuration or arbitrary error codes.
function qualificationFailureCode(error: unknown): string {
  const code =
    error instanceof Error ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
  switch (code) {
    case "EADDRINUSE":
    case "EACCES":
    case "EMFILE":
    case "ENFILE":
    case "ENOSPC":
    case "ENOMEM":
    case "ENOENT":
    case "EIO":
      return code;
    default:
      return "REFUSED";
  }
}
if (isEntrypoint())
  void main().catch(async (error: unknown) => {
    // Never echo credentials, input configuration or callback exceptions.
    process.stderr.write("installed reference qualification failed\n");
    process.exitCode = 2;
    if (process.connected && process.send) {
      const send = process.send.bind(process);
      await new Promise<void>((resolve) => {
        try {
          send({ event: "qualification.failed", code: qualificationFailureCode(error) }, () =>
            resolve(),
          );
        } catch {
          resolve();
        }
      });
    }
    if (process.connected) process.disconnect();
  });
