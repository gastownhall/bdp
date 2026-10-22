/** Test-only return-boundary parking; every operation runs in the installed modules. */
import { writeSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const installed = process.env.BDP_CRASH_INSTALLED_SERVER;
const configuration = process.env.BDP_CRASH_CONFIGURATION;
if (!installed || !configuration) throw new Error("missing installed crash fixture inputs");
const storeUrl = pathToFileURL(`${installed}/transaction-store.js`).href;
const runtimeUrl = pathToFileURL(`${installed}/transaction-runtime.js`).href;
const shimUrl = new URL("./crash-recovery-store.ts", import.meta.url).href;
if (process.env.BDP_CRASH_PHASE !== "none")
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "./transaction-store.js" && context.parentURL === runtimeUrl) {
        writeSync(
          3,
          `${JSON.stringify({ event: "binding", parent: runtimeUrl, original: storeUrl, shim: shimUrl })}\n`,
        );
        return { url: shimUrl, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
process.env.BDP_CRASH_STORE_URL = storeUrl;
const { startReferenceDeployment } = await import(
  pathToFileURL(`${installed}/reference-startup.js`).href
);
const controller = new AbortController();
const runtime = await startReferenceDeployment(JSON.parse(configuration), controller.signal);
writeSync(
  3,
  `${JSON.stringify({ event: "ready", scope: runtime.scope, claimEligible: runtime.claimEligible })}\n`,
);
process.once("SIGTERM", () => controller.abort());
await runtime.completion;
