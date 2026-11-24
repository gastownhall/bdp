#!/usr/bin/env node
// The v0.1 current-contract provider kit was retired with the rest of the v0.1
// toolchain; its sources moved to docs/history/. This entry is kept as the stable
// invocation path and now dispatches to the v0.2 read-only provider kit. Run, e.g.:
//   node scripts/current-provider-kit.mjs --spec v0.2 --profile read-only --scope SCOPE_URL
// See scripts/v02-provider-kit.mjs (and scripts/v02-provider-kit/) for the kit itself.
import { fileURLToPath } from "node:url";

export { main, runV02Provider, parseV02Arguments, usage } from "./v02-provider-kit.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { main } = await import("./v02-provider-kit.mjs");
  process.exitCode = await main();
}
