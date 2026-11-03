/** Actual emitted executable witness; scenarios are shared with packed smoke. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startReferenceService } from "../packages/server/dist/reference.js";
import { registerCanonicalCliCases } from "./canonical-cli-cases.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
registerCanonicalCliCases({
  binary: path.join(root, "apps/bdp/dist/main.js"),
  startReferenceService,
});
