import process from "node:process";

import { createBdProcessScopePort } from "@bdp/adapter-bd";
import type { ServerReadLimitsConfig } from "@bdp/config";
import {
  admitReadServerProfile,
  createPublicReadControls,
  createReadServer,
  type ProtocolProfile,
  type ReadServer,
  withConfiguredInternalFault,
} from "@bdp/server";

export interface BdpbdServerConfig {
  readonly scope: { readonly url: string };
  readonly server: {
    readonly advertisedProfile?: ProtocolProfile;
    readonly limits: ServerReadLimitsConfig;
    readonly internalFaultResource?: string;
  };
  readonly bd: { readonly executable: string; readonly workspace?: string };
}

/** Composes the shipping bd-backed Read server with one advertised/enforced limit object. */
export function createConfiguredBdpbdReadServer(config: BdpbdServerConfig): ReadServer {
  const admittedProfile = admitReadServerProfile(config.server.advertisedProfile, "bdpbd");
  return createReadServer({
    scope: config.scope.url,
    target: "bdpbd",
    admittedProfile,
    port: withConfiguredInternalFault(
      createBdProcessScopePort(config.scope.url, {
        executable: config.bd.executable,
        workspace: config.bd.workspace ?? process.cwd(),
      }),
      config.server.internalFaultResource,
    ),
    advertisedLimits: config.server.limits,
    readControls: createPublicReadControls({
      scope: config.scope.url,
      limits: config.server.limits,
    }),
  });
}
