import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { requireThat } from "./contract.mjs";
export class HarnessError extends Error {}
export const hash = (value) => createHash("sha256").update(value).digest("hex");
// A separate lexer detects duplicate members before JSON.parse loses them.
export function parseJson(text) {
  let at = 0;
  const space = () => {
    while (/[ \t\r\n]/.test(text[at] ?? "") && at < text.length) at++;
  };
  const quoted = () => {
    const start = at++;
    while (at < text.length) {
      if (text[at] === "\\") at += 2;
      else if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    throw Error();
  };
  const value = (depth) => {
    if (depth > 128) throw new HarnessError("JSON exceeds checker nesting bound");
    space();
    const c = text[at];
    if (c === "{") {
      at++;
      space();
      const names = new Set();
      if (text[at] === "}") {
        at++;
        return;
      }
      for (;;) {
        space();
        if (text[at] !== '"') throw Error();
        const name = quoted();
        if (names.has(name)) throw Error();
        names.add(name);
        space();
        if (text[at++] !== ":") throw Error();
        value(depth + 1);
        space();
        const end = text[at++];
        if (end === "}") return;
        if (end !== ",") throw Error();
      }
    } else if (c === "[") {
      at++;
      space();
      if (text[at] === "]") {
        at++;
        return;
      }
      for (;;) {
        value(depth + 1);
        space();
        const end = text[at++];
        if (end === "]") return;
        if (end !== ",") throw Error();
      }
    } else if (c === '"') quoted();
    else {
      const token =
        /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
          text.slice(at),
        );
      if (!token) throw Error();
      if (!["true", "false", "null"].includes(token[0])) {
        const n = Number(token[0]);
        if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n)))
          throw new HarnessError("Response numeric value exceeds checker lossless bounds");
      }
      at += token[0].length;
    }
  };
  try {
    value(0);
    space();
    requireThat(at === text.length, "Response contains malformed JSON");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    requireThat(false, "Response contains malformed JSON or duplicate members");
  }
}
export function transport(
  scope,
  { authorization, timeoutMs = 30000, maxBytes = 256 * 1024 * 1024 } = {},
) {
  const origin = new URL(scope).origin,
    agents = {
      http: new http.Agent({ keepAlive: false }),
      https: new https.Agent({ keepAlive: false }),
    };
  const receipts = [];
  async function request(target, { method = "GET", body, headers = {}, observeForMs } = {}) {
    const url = new URL(target, scope);
    if (url.origin !== origin || url.username || url.password)
      throw new HarnessError("Undeclared or credential-bearing navigation origin");
    const payload =
      body === undefined
        ? undefined
        : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    return new Promise((resolve, reject) => {
      let ended = false,
        observationTimer;
      const finish = (error, value) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        clearTimeout(observationTimer);
        error ? reject(error) : resolve(value);
      };
      const req = (url.protocol === "https:" ? https : http).request(
        url,
        {
          method,
          agent: url.protocol === "https:" ? agents.https : agents.http,
          headers: {
            Accept: "application/json",
            ...(authorization ? { Authorization: authorization } : {}),
            ...(payload
              ? { "Content-Type": "application/json", "Content-Length": payload.length }
              : {}),
            ...headers,
          },
        },
        (res) => {
          const parts = [];
          let bytes = 0;
          res.on("data", (part) => {
            bytes += part.length;
            if (bytes > maxBytes) {
              finish(new HarnessError("HTTP response exceeds checker byte bound"));
              res.destroy();
            } else parts.push(part);
          });
          res.on("error", () =>
            finish(new HarnessError("HTTP response ended before observation completed")),
          );
          res.on("aborted", () => finish(new HarnessError("HTTP response was truncated")));
          const complete = (live) => {
            const data = Buffer.concat(parts);
            let text;
            try {
              text = new TextDecoder("utf-8", { fatal: true }).decode(data);
            } catch {
              finish(new HarnessError("HTTP response was not valid UTF8"));
              return;
            }
            const result = {
              status: res.statusCode,
              headers: res.headers,
              rawHeaders: res.rawHeaders,
              text,
              ...(observeForMs ? { live, observedMs: observeForMs } : {}),
            };
            receipts.push({
              method,
              pathSha256: hash(url.pathname),
              status: res.statusCode,
              bytes,
              sha256: hash(data),
              ...(observeForMs ? { observation: "live-window", live } : {}),
            });
            finish(null, result);
            if (live) res.destroy();
          };
          res.on("end", () => complete(false));
          if (observeForMs) observationTimer = setTimeout(() => complete(true), observeForMs);
        },
      );
      const timer = setTimeout(() => {
        finish(new HarnessError("HTTP exchange exceeded checker deadline"));
        req.destroy();
      }, timeoutMs);
      req.on("error", () => finish(new HarnessError("HTTP transport failed")));
      req.end(payload);
    });
  }
  return {
    request,
    receipts,
    close() {
      agents.http.destroy();
      agents.https.destroy();
    },
  };
}
