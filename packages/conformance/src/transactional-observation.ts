/** Private receipt authority: populated only alongside validated actual wire observations. */
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { ExactHttpConfiguration } from "./raw-http-scenario-target.js";
import type {
  ExactHttpModeOptions,
  RawHttpDialRoute,
  HttpExchangeResponse,
} from "./http-executor.js";
import type { SchemaValidator } from "./schema-validator.js";

export interface TransactionalSessionBinding {
  readonly scenario: string;
  readonly generation: number;
  readonly listenUrl: string;
  readonly runtimeConfigurationIdentity: string;
  readonly configurationDigest: string;
  readonly responseLimits: Readonly<{ headerBytes: 65536; bodyBytes: 1048576; wireBytes: 2097152 }>;
}
export interface TransactionalSession {
  readonly binding: TransactionalSessionBinding;
  readonly dialRoute: RawHttpDialRoute;
  readonly signal: AbortSignal;
  readonly resolveCredentials: ExactHttpModeOptions["resolveCredentials"];
  /** Registers with the same session pending set drained before close/reopen. */
  register<T>(operation: Promise<T>): Promise<T>;
}
export interface TransactionalRunContext {
  current(scenario: string): TransactionalSession;
  reopen(scenario: string, signal: AbortSignal): Promise<void>;
}
export interface ReceiptObservationReference {
  readonly action: string;
  readonly pointer: "/id";
  readonly receipt: string;
  readonly responseDigest: string;
  readonly credentialRef: string;
  readonly session: TransactionalSessionBinding;
}
export interface TransactionalExchangeFields {
  readonly dynamicExactConfiguration?: ExactHttpConfiguration;
  readonly dynamicExactConfigurationDigest?: string;
  readonly sourceReceiptObservation?: ReceiptObservationReference;
  readonly servedSession?: TransactionalSessionBinding;
}
export const TRANSACTIONAL_EXCHANGE_FIELDS = [
  "dynamicExactConfiguration",
  "dynamicExactConfigurationDigest",
  "sourceReceiptObservation",
  "servedSession",
] as const;
export function receiptUrl(value: unknown, scope: string): string {
  if (typeof value !== "string" || value.length > 8192)
    throw new Error("unobserved receipt target");
  const url = new URL(value);
  const prefix = `${scope}receipts/`;
  if (
    url.href !== value ||
    !value.startsWith(prefix) ||
    !/^[A-Za-z0-9_-]+$/.test(value.slice(prefix.length)) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("unobserved receipt target");
  return value;
}
export function createTransactionalObservations(
  context: TransactionalRunContext,
  scenario: string,
  scope: string,
  maximum: number,
) {
  const ledger = new Map<
    string,
    { reference: ReceiptObservationReference; body: unknown; wire: Buffer }
  >();
  let accepted: TransactionalSessionBinding | undefined;
  const session = () => {
    const current = context.current(scenario);
    if (current.signal.aborted || current.binding.scenario !== scenario)
      throw new Error("transaction session unavailable");
    if (accepted && !isDeepStrictEqual(current.binding, accepted))
      throw new Error("unvalidated physical session transition");
    accepted ??= Object.freeze({ ...current.binding });
    return current;
  };
  return {
    session,
    async reopen(signal: AbortSignal) {
      const previous = session().binding;
      await context.reopen(scenario, signal);
      const current = context.current(scenario);
      if (
        current.signal.aborted ||
        current.binding.scenario !== scenario ||
        current.binding.generation <= previous.generation ||
        current.binding.runtimeConfigurationIdentity !== previous.runtimeConfigurationIdentity ||
        current.binding.configurationDigest !== previous.configurationDigest
      )
        throw new Error("invalid reopened session");
      accepted = Object.freeze({ ...current.binding });
      session();
    },
    register(
      binding: string,
      pointer: string,
      action: string,
      response: HttpExchangeResponse,
      value: unknown,
      config: ExactHttpConfiguration,
      credential: string | undefined,
      validator: SchemaValidator | undefined,
      served: TransactionalSessionBinding,
    ) {
      if (pointer !== "/id") return;
      if (!validator || validator.validate("#/$defs/mutationReceipt", value).length)
        throw new Error("source receipt schema invalid");
      const body = value as Record<string, unknown>;
      if (body.status !== "completed" && body.status !== "failed")
        throw new Error("source receipt disposition unavailable");
      if ((body.status === "completed" && body.next !== null) || body.detail !== "available")
        throw new Error("source receipt exceeds inline fixture");
      const receipt = receiptUrl(body.id, scope);
      if (
        response.status !== 200 ||
        !response.wireResponseBytes ||
        response.wireResponseBytes.length > 2097152
      )
        throw new Error("source receipt wire unavailable");
      if (ledger.has(binding) || ledger.size >= maximum)
        throw new Error("receipt authority binding limit or reuse");
      validateReceiptWire(response, "GET");
      ledger.set(binding, {
        reference: Object.freeze({
          action,
          pointer: "/id",
          receipt,
          responseDigest: createHash("sha256").update(response.wireResponseBytes).digest("hex"),
          credentialRef: credential ?? config.defaultCredentialRef,
          session: Object.freeze({ ...served }),
        }),
        body: JSON.parse(response.bodyText),
        wire: Buffer.from(response.wireResponseBytes),
      });
    },
    resolve(binding: unknown, value: unknown) {
      const entry = typeof binding === "string" ? ledger.get(binding) : undefined;
      const source = entry?.reference;
      if (!source || source.receipt !== value || receiptUrl(value, scope) !== source.receipt)
        throw new Error("receipt not authorized by original wire observation");
      if (createHash("sha256").update(entry!.wire).digest("hex") !== source.responseDigest)
        throw new Error("source receipt observation changed");
      const active = session();
      if (
        active.binding.runtimeConfigurationIdentity !==
          source.session.runtimeConfigurationIdentity ||
        active.binding.configurationDigest !== source.session.configurationDigest
      )
        throw new Error("receipt session logical identity changed");
      return {
        source,
        active,
        validate(response: HttpExchangeResponse, method: "GET" | "HEAD") {
          validateReceiptWire(response, method);
          if (method === "GET" && !isDeepStrictEqual(JSON.parse(response.bodyText), entry?.body))
            throw new Error("retained receipt differs from original wire facts");
        },
      };
    },
  };
}

/** This bounded fixture requires the receiver's actual Content-Length encoding.
 * No general alternate transfer coding claim is made by this witness. */
export function validateReceiptWire(response: HttpExchangeResponse, method: "GET" | "HEAD") {
  const bytes = response.wireResponseBytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 2097152)
    throw new Error("receipt wire evidence unavailable");
  const wire = Buffer.from(bytes),
    delimiter = wire.indexOf("\r\n\r\n");
  if (delimiter < 0 || delimiter > 65536) throw new Error("receipt wire header bound");
  const lines = wire.subarray(0, delimiter).toString("latin1").split("\r\n");
  if (lines.shift() !== `HTTP/1.1 ${response.status} OK`)
    throw new Error("receipt wire status mismatch");
  const actual: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 1) throw new Error("receipt wire header mismatch");
    const name = line.slice(0, colon).toLowerCase(),
      value = line.slice(colon + 1).trim();
    if (Object.hasOwn(actual, name)) throw new Error("duplicate receipt header");
    actual[name] = value;
  }
  const expected = Object.fromEntries(
    Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  if (!isDeepStrictEqual(actual, expected)) throw new Error("receipt wire headers mismatch");
  const body = wire.subarray(delimiter + 4);
  if (
    body.length > 1048576 ||
    response.bodyOctets !== body.length ||
    !body.equals(Buffer.from(response.bodyText)) ||
    (method === "HEAD" && body.length !== 0) ||
    (method === "GET" && Number(actual["content-length"]) !== body.length)
  )
    throw new Error("receipt wire body mismatch");
}
