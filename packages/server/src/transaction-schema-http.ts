/** Source-private exact local retrieval identities. No resolver, installation API,
 * public discovery or minimum-control support is implied by this projection. */
import type { HttpResponse } from "./index.js";
import { assertDevelopmentContracts, type DevelopmentContracts } from "./development-contracts.js";
import { applyReadHttpSemantics } from "./read-http.js";
import { hasMinimumControls, type TransactionHttpAuthorization } from "./transaction-http.js";
import type { createTransactionService } from "./transaction-service.js";

export function createTransactionSchemaHttp(
  scope: string,
  contracts: DevelopmentContracts | undefined,
  observe: ReturnType<typeof createTransactionService>["schemaObserved"],
) {
  const entries = new Map<string, Readonly<{ utf8: string; byteLength: number }>>();
  if (contracts) {
    assertDevelopmentContracts(contracts);
    for (const entry of contracts.capture.artifacts) {
      if (entry.kind !== "schema") continue;
      const url = new URL(entry.retrievalUri);
      if (
        url.href !== entry.retrievalUri ||
        !entry.retrievalUri.startsWith(`${scope}schemas/`) ||
        entry.retrievalUri.includes("?") ||
        entry.retrievalUri.includes("#") ||
        url.username ||
        url.password
      )
        continue;
      entries.set(
        entry.retrievalUri,
        Object.freeze({
          utf8: Buffer.from(entry.bytesBase64, "base64").toString("utf8"),
          byteLength: entry.byteLength,
        }),
      );
    }
  }
  return async (
    request: Request,
    authorization: TransactionHttpAuthorization,
  ): Promise<Readonly<{ response: HttpResponse; raw?: string }> | undefined> => {
    if (
      (request.method !== "GET" && request.method !== "HEAD") ||
      authorization.kind !== "authenticated" ||
      hasMinimumControls(request)
    )
      return undefined;
    const entry = entries.get(request.url);
    if (!entry) return undefined;
    const observed = await observe();
    // Selection needs representation metadata, not another parsed schema copy.
    const response = applyReadHttpSemantics(request, {
      status: 200,
      headers: new Headers({
        "content-type": "application/json",
        "cache-control": "private, no-store",
        "bdp-scope-epoch": observed.context.scopeEpoch,
        "bdp-authorization-view": observed.context.authorizationView,
        "bdp-scope-position": observed.context.scopePosition,
      }),
    });
    if (response.status !== 200) return Object.freeze({ response });
    response.headers.set("content-length", String(entry.byteLength));
    return Object.freeze({ response, raw: entry.utf8 });
  };
}
