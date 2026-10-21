/** Test-only exact reader for an opaque next URL captured by the shared runner.
 * It neither reconstructs the cursor nor expands mutation-route authority. */
import {
  createRawHttpExchangeExecutor,
  type ExactHttpModeOptions,
  type JsonValue,
  type RawHttpDialRoute,
  type ScenarioActionExecutor,
  snapshotExactHttpMode,
} from "@bdp/conformance";
import {
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  resolveCanonicalLocalResourceId,
} from "@bdp/protocol";
import { createInstalledExactClient } from "./read-update-exact-client.js";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw Error("captured continuation input must be an object");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw Error("captured continuation string missing");
  return value;
}

export function createCumulativeRUClient(
  inputMode: ExactHttpModeOptions,
  inputDialRoute: RawHttpDialRoute,
  observe: (value: unknown) => void,
): ScenarioActionExecutor {
  const mode = snapshotExactHttpMode(inputMode);
  const dial = Object.freeze({ ...inputDialRoute });
  const existing = createInstalledExactClient(mode, dial, observe);
  return async (execution) => {
    if (execution.operation === "cumulative.race-update") {
      if (execution.family !== "client" || execution.scope !== mode.scope)
        throw Error("unbound update race");
      const input = record(execution.input);
      if (
        Object.keys(input).sort().join() !==
          "changes,credentialRef,keys,revisionBinding,subjectBinding" ||
        !Array.isArray(input.changes) ||
        input.changes.length !== 2 ||
        !Array.isArray(input.keys) ||
        input.keys.length !== 2 ||
        input.keys.some((key) => typeof key !== "string" || key.length === 0) ||
        input.keys[0] === input.keys[1]
      )
        throw Error("update race requires exactly two distinct keyed candidates");
      const subjectBinding = string(input.subjectBinding),
        revisionBinding = string(input.revisionBinding);
      string(execution.bindings[subjectBinding]);
      string(execution.bindings[revisionBinding]);
      const credentialRef = string(input.credentialRef);
      const keys = input.keys as string[];
      const completionOrder: number[] = [];
      const settled = await Promise.allSettled(
        input.changes.map(async (change, index) => {
          const result = await existing({
            ...execution,
            operation: "installed.exact-request",
            input: {
              method: "POST",
              targetBinding: "cumulative.update-bead",
              credentialRef,
              body: { propertiesChange: change as JsonValue },
              bodyBindings: { bead: subjectBinding, expectedRevision: revisionBinding },
              idempotencyKey: keys[index]!,
            },
          });
          completionOrder.push(index);
          return result;
        }),
      );
      const errors = settled.filter((item) => item.status === "rejected");
      if (errors.length)
        throw new AggregateError(
          errors.map((item) => item.reason),
          "both actual race attempts settled with failure",
          { cause: settled },
        );
      const results = settled.map((item) => {
        if (item.status !== "fulfilled") throw Error("unsettled race attempt");
        return item.value;
      });
      return {
        results,
        completionOrder,
        successfulResponses: results.filter((result) => record(result).status === 200),
      };
    }
    if (execution.operation !== "cumulative.follow-next") return existing(execution);
    if (execution.family !== "client" || execution.scope !== mode.scope)
      throw Error("unbound continuation reader");
    const input = record(execution.input);
    const collection = string(input.collection);
    const incident = collection === "incident-links";
    const keys = incident
      ? ["nextBinding", "collection", "credentialRef", "subjectBinding"]
      : ["nextBinding", "collection", "credentialRef"];
    if (
      Object.keys(input).length !== keys.length ||
      Object.keys(input).some((key) => !keys.includes(key))
    )
      throw Error("unknown continuation reader input");
    const nextBinding = string(input.nextBinding);
    const captured = string(execution.bindings[nextBinding]);
    if (!["beads", "links", "types", "incident-links"].includes(collection))
      throw Error("unsupported collection continuation");
    const url = new URL(captured);
    const root = new URL(mode.scope);
    let expectedPath = `${root.pathname}${collection}/`;
    let subject: string | undefined;
    if (incident) {
      subject = string(execution.bindings[string(input.subjectBinding)]);
      const bead = new URL(subject);
      if (
        subject !== bead.href ||
        bead.origin !== root.origin ||
        bead.search ||
        bead.hash ||
        !bead.pathname.startsWith(`${root.pathname}beads/`) ||
        resolveCanonicalLocalResourceId(
          parseCanonicalScope(mode.scope),
          "bead",
          bead.pathname.slice(root.pathname.length),
        ) !== subject
      )
        throw Error("incident continuation subject was not a canonical captured Bead");
      expectedPath = bead.pathname;
    }
    if (
      captured !== url.href ||
      parseCanonicalHttpUrl(captured) !== captured ||
      url.origin !== root.origin ||
      url.pathname !== expectedPath ||
      url.username ||
      url.password ||
      url.hash ||
      !url.search
    )
      throw Error("captured continuation escaped the exact collection");
    const credentialRef = string(input.credentialRef);
    const route = Object.freeze({ method: "GET" as const, url: captured });
    // A single genuine captured URL is authorized, not a collection wildcard.
    const execute = createRawHttpExchangeExecutor(dial, {
      exactMode: { ...mode, routes: [route] },
      requestTimeoutMs: 5000,
      maximumBodyBytes: 1048576,
    });
    const response = await execute({
      method: "GET",
      url: captured,
      credentialRef,
      signal: execution.signal,
      raw: { headerLines: [] },
    });
    const actual = response.exactRequest;
    if (!actual) throw Error("continuation serializer observation missing");
    const output = {
      request: {
        method: "GET",
        url: captured,
        nextBinding,
        collection,
        credentialRef,
        ...(subject === undefined ? {} : { subjectBinding: input.subjectBinding, subject }),
      },
      route,
      observation: {
        source: actual.source,
        writeState: actual.writeState,
        bodyPresent: actual.bodyPresent,
        bodyOctets: actual.bodyOctets,
        ...(actual.bodyDigest === undefined ? {} : { bodyDigest: actual.bodyDigest }),
      },
      status: response.status,
      headers: Object.fromEntries(
        Object.entries(response.headers).filter(([key]) =>
          ["content-type", "etag", "location", "cache-control"].includes(key),
        ),
      ),
      ...(response.bodyText === "" ? {} : { body: JSON.parse(response.bodyText) }),
    };
    observe(structuredClone(output));
    return output;
  };
}
