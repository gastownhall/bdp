/** Private harness composition: real HTTP setup and already-resolved Read headers. */
import { isDeepStrictEqual } from "node:util";
import type { ConformanceFixture, RawHttpExchangeExecutor } from "@bdp/conformance";

const fields = new Set([
  "accept",
  "if-match",
  "if-none-match",
  "origin",
  "access-control-request-method",
  "access-control-request-headers",
]);
export function exactNativeReadAdapter(
  execute: RawHttpExchangeExecutor,
  observe: (value: unknown) => void,
): RawHttpExchangeExecutor {
  return async (request) => {
    if ("raw" in request) return execute(request);
    if (request.method !== "GET" && request.method !== "HEAD")
      throw Error("native semantic adapter is Read-only");
    const lines: { name: string; value: string }[] = [];
    const seen = new Set<string>();
    for (const [name, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(request.headers),
    )) {
      const key = name.toLowerCase();
      if (
        !fields.has(key) ||
        seen.has(key) ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "string" ||
        !/^[\t\x20-\x7e\x80-\xff]*$/.test(descriptor.value)
      )
        throw Error("unsafe or unresolved native Read header");
      seen.add(key);
      lines.push({ name, value: descriptor.value });
    }
    const response = await execute({
      method: request.method,
      url: request.url,
      signal: request.signal,
      raw: { headerLines: lines },
      ...(request.rawRequestTarget === undefined
        ? {}
        : { rawRequestTarget: request.rawRequestTarget }),
    });
    if (!response.exactRequest) throw Error("native Read exact observation missing");
    observe({
      method: request.method,
      url: request.url,
      headers: response.exactRequest.headerLines.filter((line) =>
        fields.has(line.name.toLowerCase()),
      ),
      writeState: response.exactRequest.writeState,
      status: response.status,
    });
    return response;
  };
}

export async function seedInstalledReadFixture(
  fixture: ConformanceFixture,
  scope: string,
  execute: RawHttpExchangeExecutor,
  signal: AbortSignal,
  observe: (value: unknown) => void,
): Promise<void> {
  const seed = fixture.readSeed as unknown as {
    beads: { id: string; type: string; properties: unknown; metadata: unknown }[];
    links: {
      id: string;
      type: string;
      source: string;
      target: string;
      properties: unknown;
      metadata: unknown;
    }[];
  };
  if (!seed || !Array.isArray(seed.beads) || !Array.isArray(seed.links))
    throw Error("Read seed missing");
  for (const [kind, entries] of [
    ["bead", seed.beads],
    ["link", seed.links],
  ] as const) {
    for (const input of entries) {
      const body = {
        ...input,
        type: new URL(input.type, scope).href,
        ...(kind === "link"
          ? {
              source: new URL((input as (typeof seed.links)[number]).source, scope).href,
              target: new URL((input as (typeof seed.links)[number]).target, scope).href,
            }
          : {}),
      };
      const response = await execute({
        method: "POST",
        url: `${scope}operations/create-${kind}`,
        signal,
        credentialRef: "operator",
        raw: {
          headerLines: [
            { name: "content-type", value: "application/json" },
            { name: "idempotency-key", value: `read-seed-${input.id.replaceAll("/", "-")}` },
          ],
          bodyBytes: Buffer.from(JSON.stringify(body)),
        },
      });
      if (!response.exactRequest) throw Error("seed exact observation missing");
      const value = JSON.parse(response.bodyText);
      observe({
        phase: "read-seed",
        body,
        status: response.status,
        result: value,
        writeState: response.exactRequest.writeState,
      });
      if (
        response.status !== 200 ||
        value.outcome !== "created" ||
        value.resource?.id !== new URL(input.id, scope).href ||
        value.resource?.type !== body.type ||
        (kind === "link" &&
          (value.resource?.source !== body.source || value.resource?.target !== body.target)) ||
        !isDeepStrictEqual(value.resource?.properties, input.properties) ||
        !isDeepStrictEqual(value.resource?.metadata, input.metadata)
      )
        throw Error("actual Read seed creation failed or disagreed with fixture");
    }
  }
}
