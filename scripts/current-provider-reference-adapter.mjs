/** One adapter, never a provider oracle. Creates only a fresh owned reference Scope. */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startReferenceService } from "../packages/server/dist/reference.js";

export async function provision({ fixture }) {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-current-provider-"));
  const scope = `https://current-provider.invalid/${fixture.runId}/`;
  const token = randomBytes(32).toString("base64url");
  const config = {
    directory,
    scope,
    create: true,
    instance: fixture.runId,
    credentials: [{ token, principal: "provider-kit" }],
  };
  let server;
  try {
    server = await startReferenceService(config);
  } catch (failure) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [failure, cleanupError],
        "Provider provisioning and cleanup failed",
        { cause: failure },
      );
    }
    throw failure;
  }
  const connections = () => [
    {
      origin: new URL(scope).origin,
      connectOrigin: new URL(server.listenUrl).origin,
      authorization: `Bearer ${token}`,
    },
  ];
  return {
    scope,
    connections: connections(),
    // This append-only reference has no outcome-expiry administration. The
    // configured fixture therefore retains complete outcomes for this window.
    conditions: {
      retainedDetailWindowMs: fixture.minimumDetailWindowMs,
      // The fresh composition has no native ownership rule; its canonical alias
      // namespace admits the runner's unique safe leaf. These are fixture facts.
      unownedLinkFixture: true,
      hierarchicalAliasFixture: true,
    },
    async restart() {
      await server.close();
      server = await startReferenceService({ ...config, create: false });
      return { connections: connections() };
    },
    async cleanup() {
      const errors = [];
      try {
        await server.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, "Reference adapter cleanup failed");
    },
  };
}
