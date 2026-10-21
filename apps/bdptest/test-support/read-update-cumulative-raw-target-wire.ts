/** Fixed own loopback receiver probes only; deliberately not a generic URL/credential transport. */
import { connect } from "node:net";
export const fixedTargets = Object.freeze({
  canonical: Buffer.from("/acme/beads/raw-target"),
  backslash: Buffer.from("/acme/beads/raw-target\\suffix"),
  control: Buffer.concat([Buffer.from("/acme/beads/raw-target"), Buffer.from([1])]),
  invalidUTF8: Buffer.concat([Buffer.from("/acme/beads/raw-target"), Buffer.from([0xc3, 0x28])]),
});
export type FixedTarget = keyof typeof fixedTargets;
export async function fixedRawRead(
  port: number,
  token: string,
  kind: FixedTarget,
  signal: AbortSignal,
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Object.hasOwn(fixedTargets, kind))
    throw Error("fixed loopback binding required");
  if (!/^[\x21-\x7e]{32,1024}$/.test(token)) throw Error("owned single-line credential required");
  const request = Buffer.concat([
    Buffer.from("GET "),
    fixedTargets[kind],
    Buffer.from(
      ` HTTP/1.1\r\nHost: reference.invalid\r\nAuthorization: Bearer ${token}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`,
    ),
  ]);
  if (request.length > 65536) throw Error("fixed request bound");
  return new Promise<{
    privateRequest: Buffer;
    response: Buffer;
    writeComplete: boolean;
    responseEOF: boolean;
    socketClosed: boolean;
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port, signal });
    const chunks: Buffer[] = [];
    let bytes = 0,
      writeComplete = false,
      responseEOF = false;
    let failure: unknown;
    socket.setTimeout(5000, () => socket.destroy(Error("fixed read5000ms deadline")));
    socket.on("connect", () =>
      socket.write(request, (error) => {
        if (error) socket.destroy(error);
        else writeComplete = true;
      }),
    );
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      bytes += chunk.length;
      if (bytes > 1048576) socket.destroy(Error("fixed response1MiB bound"));
    });
    socket.on("end", () => {
      responseEOF = true;
    });
    socket.on("error", (error) => {
      failure = error;
    });
    socket.on("close", () => {
      const response = Buffer.concat(chunks);
      if (failure || !responseEOF || !writeComplete) {
        reject(
          Object.assign(new Error("fixed receiver exchange incomplete", { cause: failure }), {
            responseBase64: response.toString("base64"),
            writeComplete,
            responseEOF,
            socketClosed: true,
          }),
        );
        return;
      }
      try {
        const split = response.indexOf("\r\n\r\n");
        if (split < 0) throw Error("missing HTTP header boundary");
        const lines = response.subarray(0, split).toString("latin1").split("\r\n");
        const first = /^HTTP\/1\.1 (\d{3}) [^\r\n]*$/.exec(lines.shift()!);
        if (!first) throw Error("HTTP status line required");
        const headers: Record<string, string> = {};
        for (const line of lines) {
          const at = line.indexOf(":");
          if (at <= 0) throw Error("HTTP header required");
          const name = line.slice(0, at).toLowerCase();
          if (Object.hasOwn(headers, name)) throw Error("duplicate selected response header");
          headers[name] = line.slice(at + 1).trim();
        }
        const body = response.subarray(split + 4);
        if (
          headers["transfer-encoding"] !== undefined ||
          (headers["content-length"] !== undefined &&
            (!/^\d+$/.test(headers["content-length"]) ||
              Number(headers["content-length"]) !== body.length))
        )
          throw Error("finite fixed Content-Length or close-delimited response required");
        resolve({
          privateRequest: request,
          response,
          writeComplete,
          responseEOF,
          socketClosed: true,
          status: Number(first[1]),
          headers,
          body,
        });
      } catch (error) {
        reject(
          Object.assign(new Error("fixed response parsing failed", { cause: error }), {
            responseBase64: response.toString("base64"),
            writeComplete,
            responseEOF,
            socketClosed: true,
          }),
        );
      }
    });
  });
}
