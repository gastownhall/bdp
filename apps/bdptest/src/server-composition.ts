import { createReferenceFixturePort } from "@bdp/adapter-in-memory";
import type { ServerReadLimitsConfig } from "@bdp/config";
import {
  admitReadServerProfile,
  createPublicReadControls,
  createReadServer,
  type ProtocolProfile,
  type ReadServer,
  withConfiguredInternalFault,
} from "@bdp/server";

export interface BdptestServerConfig {
  readonly scope: { readonly url: string };
  readonly server: {
    readonly advertisedProfile?: ProtocolProfile;
    readonly limits: ServerReadLimitsConfig;
    readonly internalFaultResource?: string;
  };
}

/** Composes the shipping reference Read server with one advertised/enforced limit object. */
export function createConfiguredBdptestReadServer(config: BdptestServerConfig): ReadServer {
  const admittedProfile = admitReadServerProfile(config.server.advertisedProfile, "bdptest");
  return createReadServer({
    scope: config.scope.url,
    target: "bdptest",
    admittedProfile,
    port: withConfiguredInternalFault(
      createReferenceFixturePort(config.scope.url),
      config.server.internalFaultResource,
    ),
    advertisedLimits: config.server.limits,
    readControls: createPublicReadControls({
      scope: config.scope.url,
      limits: config.server.limits,
    }),
  });
}
