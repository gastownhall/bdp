/** Public non-attesting development facade. Runtime scheduling remains private. */
import {
  startDevelopmentReferenceRuntime,
  type DevelopmentServerOptions,
} from "./development-runtime.js";
export { DEVELOPMENT_BEAD_TYPE, DEVELOPMENT_LINK_TYPE } from "./development-authority.js";
export type { DevelopmentServerOptions } from "./development-runtime.js";
export function startDevelopmentReferenceServer(options: DevelopmentServerOptions) {
  return startDevelopmentReferenceRuntime(options);
}
