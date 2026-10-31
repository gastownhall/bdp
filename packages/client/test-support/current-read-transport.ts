import {
  createFetchTransport,
  type BdpTransport,
  type FetchTransportOptions,
} from "../src/index.js";

/** Test-only wire observer, invoked before the public client projects legacy records. */
export type ReadWireValidator = (url: string, scope: string, body: unknown) => void;

export function createCurrentReadTransport(
  fetchImplementation: typeof fetch,
  limits: FetchTransportOptions,
  validate?: ReadWireValidator,
): BdpTransport {
  const transport = createFetchTransport(fetchImplementation, limits);
  return {
    discover: transport.discover,
    async perform<Body>(
      url: Parameters<BdpTransport["perform"]>[0],
      options: Parameters<BdpTransport["perform"]>[1],
    ) {
      const result = await transport.perform<Body>(url, options);
      if (result.kind === "success") validate?.(url, options.scope, result.body);
      return result;
    },
  };
}
