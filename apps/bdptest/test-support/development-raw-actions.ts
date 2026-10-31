import {
  createRawHttpExchangeExecutor,
  type ScenarioActionExecution,
  type RawHeaderLine,
} from "@bdp/conformance";
import { rawPost } from "./raw-development-http.js";

/** Observes authored receiving cases; only the manifest runner decides pass/fail. */
export async function executeDevelopmentRawAction(
  execution: ScenarioActionExecution,
  token: string,
) {
  const input = object(execution.input);
  const scope = new URL(execution.scope);
  if (
    scope.protocol !== "http:" ||
    scope.hostname !== "127.0.0.1" ||
    scope.port === "" ||
    scope.pathname !== "/"
  )
    throw new Error("raw development actions require the disposable loopback Scope");
  const target = text(input.target);
  const method = input.method;
  if (
    !["development/create-bead", "development/delete-bead", "development/sequence"].includes(
      target,
    ) ||
    (method !== "POST" && method !== "GET")
  )
    throw new Error("raw development action target or method is outside its bounded fixture");
  const url = new URL(target, scope).href;
  const credential = input.credential ?? "valid";
  if (!["valid", "missing", "wrong", "malformed", "duplicate"].includes(text(credential)))
    throw new Error("unknown fixed development credential fixture");
  const authorization =
    credential === "missing"
      ? undefined
      : credential === "wrong"
        ? "Bearer deliberately_wrong_fixture_credential"
        : credential === "malformed"
          ? "Bearer two credentials"
          : `Bearer ${token}`;
  if (!Array.isArray(input.headerLines)) throw new Error("raw action requires header lines");
  const headerLines: RawHeaderLine[] = input.headerLines.map((entry) => {
    const line = object(entry);
    const name = text(line.name);
    if (
      !["content-type", "content-encoding", "idempotency-key", "accept", "if-match"].includes(
        name.toLowerCase(),
      )
    )
      throw new Error("raw action header is outside its bounded fixture");
    return { name, value: text(line.value) };
  });
  let bytes: Buffer;
  if (input.bodyText !== undefined) bytes = Buffer.from(text(input.bodyText));
  else if (input.bodyBase64 !== undefined) bytes = Buffer.from(text(input.bodyBase64), "base64");
  else if (input.bodySpaces !== undefined) {
    if (input.bodySpaces !== 65537) throw new Error("unsupported body limit fixture");
    bytes = Buffer.alloc(65537, 0x20);
  } else bytes = Buffer.from(JSON.stringify(input.body));
  if (input.bodyPaddingBytes !== undefined) {
    if (input.bodyPaddingBytes !== 65536 || bytes.length > input.bodyPaddingBytes)
      throw new Error("unsupported inclusive byte-bound fixture");
    bytes = Buffer.concat([bytes, Buffer.alloc(input.bodyPaddingBytes - bytes.length, 0x20)]);
  }
  if (bytes.length > 128 * 1024) throw new Error("raw fixture body exceeds harness bound");
  let response: {
    status: number;
    headers: Readonly<Record<string, string>>;
    bodyText: string;
    bodyOctets?: number;
  };
  if (credential === "duplicate" || input.chunked === true) {
    if (method !== "POST") throw new Error("fixture helper only supports POST");
    const headers = ["Host", scope.host];
    if (authorization !== undefined) headers.push("Authorization", authorization);
    if (credential === "duplicate") headers.push("Authorization", `Bearer ${token}`);
    headers.push(...headerLines.flatMap(({ name, value }) => [name, value]));
    if (input.chunked !== true) headers.push("Content-Length", String(bytes.length));
    const result = await rawPost(
      execution.scope,
      `/${target}`,
      headers,
      bytes,
      input.chunked === true,
      execution.signal,
    );
    response = { ...result, bodyText: result.body };
  } else {
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: "127.0.0.1", port: Number(scope.port) },
      {
        requestTimeoutMs: 5000,
        exactMode: {
          scope: execution.scope,
          profile: "read-update",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 8192,
          maximumRequestBodyBytes: 128 * 1024,
          defaultCredentialRef: "fixture",
          credentialHandles: [
            { id: "fixture", headerNames: authorization === undefined ? [] : ["authorization"] },
          ],
          resolveCredentials: () => (authorization === undefined ? {} : { authorization }),
        },
      },
    );
    response = await execute({
      method,
      url,
      signal: execution.signal,
      raw: { headerLines, bodyBytes: bytes },
    });
  }
  return {
    status: response.status,
    headers: response.headers,
    bodyOctets: response.bodyOctets,
    ...(response.bodyText.length === 0 ? {} : { body: JSON.parse(response.bodyText) }),
  };
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("expected object fixture");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected string fixture");
  return value;
}
