/** Private installed qualification bootstrap. No package export, bin or CLI flag.
 * No clock/store/outcome control. Configuration arrives only through inherited IPC.
 */

import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { administrativeData } from "./development-contracts.js";
import { startInstalledReferenceCandidate } from "./installed-reference.js";

type QualificationPhase = "configuration" | "candidate-start" | "serving" | "closing";
let qualificationPhase: QualificationPhase = "configuration";
const diagnosticCodes = new Set([
  "EADDRINUSE",
  "EADDRNOTAVAIL",
  "EACCES",
  "EPERM",
  "EMFILE",
  "ENFILE",
  "ENOSPC",
  "ENOENT",
  "EEXIST",
  "EIO",
  "EBUSY",
  "EROFS",
  "ERR_SQLITE_ERROR",
  "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE",
  "ERR_OUT_OF_RANGE",
]);
/** Private diagnostic only: no messages, paths, configuration or accessor reads. */
export function qualificationFailureDiagnostic(error: unknown, phase: QualificationPhase) {
  let errorClass = "unknown",
    code: string | null = null;
  try {
    const proto = Object.getPrototypeOf(error);
    if (proto === Error.prototype) errorClass = "Error";
    else if (proto === TypeError.prototype) errorClass = "TypeError";
    else if (proto === RangeError.prototype) errorClass = "RangeError";
    else if (proto === SyntaxError.prototype) errorClass = "SyntaxError";
    else if (proto === AggregateError.prototype) errorClass = "AggregateError";
    let current = error;
    const seen = new Set<unknown>();
    for (let depth = 0; depth < 4; depth++) {
      if (current === null || typeof current !== "object" || seen.has(current)) break;
      seen.add(current);
      const candidate = Object.getOwnPropertyDescriptor(current, "code");
      if (
        candidate &&
        "value" in candidate &&
        typeof candidate.value === "string" &&
        diagnosticCodes.has(candidate.value)
      ) {
        code = candidate.value;
        break;
      }
      const cause = Object.getOwnPropertyDescriptor(current, "cause");
      current = cause && "value" in cause ? cause.value : undefined;
    }
  } catch {
    /* Unknown exotic input remains a fixed diagnostic, never formatted. */
  }
  return Object.freeze({ event: "qualification.failed", phase, errorClass, code });
}

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
  qualificationPhase = "candidate-start";
  const runtime = await startInstalledReferenceCandidate(configuration);
  qualificationPhase = "serving";
  try {
    if (process.connected && !stopping)
      send({
        event: "qualification.ready",
        scope: runtime.scope,
        listenUrl: runtime.listenUrl,
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
    qualificationPhase = "closing";
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
if (isEntrypoint())
  void main().catch((error: unknown) => {
    // Never echo credentials, input configuration or callback exceptions.
    process.stderr.write("installed reference qualification failed\n");
    process.exitCode = 2;
    if (process.connected && process.send) {
      try {
        process.send(qualificationFailureDiagnostic(error, qualificationPhase), () => {
          if (process.connected) process.disconnect();
        });
      } catch {
        if (process.connected) process.disconnect();
      }
    }
  });
