import { request as httpRequest } from "node:http";

/** Source-only fixture helper for fields the portable exact executor forbids.
 * Targets always dial the current disposable loopback development Scope. */
export async function rawPost(
  scope: string,
  target: string,
  headers: string[],
  body: string | Buffer,
  chunked = false,
  signal?: AbortSignal,
): Promise<{ status: number; headers: Record<string, string>; body: string; bodyOctets: number }> {
  const url = new URL(scope);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port === "" ||
    url.pathname !== "/"
  )
    throw new Error("raw development helper requires the current loopback Scope");
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { hostname: "127.0.0.1", port: url.port, path: target, method: "POST", headers, signal },
      (response) => {
        const chunks: Buffer[] = [];
        let bodyOctets = 0;
        response.on("data", (chunk: Buffer) => {
          bodyOctets += chunk.length;
          if (bodyOctets > 2 * 1024 * 1024) {
            response.destroy(new Error("raw development response exceeded observation bound"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(response.headers).flatMap(([name, value]) =>
                value === undefined
                  ? []
                  : [[name, Array.isArray(value) ? value.join(", ") : value]],
              ),
            ),
            body: Buffer.concat(chunks).toString("utf8"),
            bodyOctets,
          }),
        );
        response.once("error", reject);
      },
    );
    request.setTimeout(5000, () => request.destroy(new Error("request timed out")));
    request.once("error", reject);
    if (chunked) request.write(body.slice(0, 40000));
    request.end(chunked ? body.slice(40000) : body);
  });
}
