import { Writable } from "node:stream";
import { RetainedClient, RetainedWriteBinding } from "@bdp/client";
import { parseCanonicalHttpUrl, RETAINED_V01_SPECIFICATION } from "@bdp/protocol";
import { expect, it, vi } from "vitest";
import { writeCanonicalOutput } from "./canonical-io.js";
import { runCanonicalInvocation } from "./canonical-runtime.js";

it("bounds a blocked failure terminal after interruption between complete pages", async () => {
  const scope = "https://wire.example/work/";
  const next = parseCanonicalHttpUrl(`${scope}inventory?cursor=exact-native-boundary`);
  const interruption = new AbortController();
  const records: Record<string, unknown>[] = [];
  let release: (() => void) | undefined;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      const record = JSON.parse(String(chunk));
      records.push(record);
      if (record.record_type === "terminal") release = callback;
      else callback();
    },
  });
  const list = vi.spyOn(RetainedClient.prototype, "list").mockResolvedValue({
    kind: "success",
    http: {
      status: 200,
      url: `${scope}inventory`,
      headers: {},
      contentType: null,
      retryAfter: null,
    },
    value: {
      specification: RETAINED_V01_SPECIFICATION,
      scope,
      collectionKind: "bead",
      page: { items: [{ id: `${scope}a` }], next },
    },
  });
  const fetch = vi.spyOn(RetainedClient.prototype, "readPage").mockImplementation(async () => {
    interruption.abort();
    throw interruption.signal.reason;
  });
  const diagnostics: string[] = [];
  const running = runCanonicalInvocation(
    {
      command: ["list"],
      positionals: [],
      options: { outputFormat: "jsonl" },
      explicitOptions: ["outputFormat"],
    },
    { scope: { url: scope }, auth: {} },
    {
      signal: interruption.signal,
      stdout: (text, signal) => writeCanonicalOutput(sink, text, signal),
      stderr: (text) => {
        diagnostics.push(text);
      },
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const status = await Promise.race([
      running,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("aborted delivery waits forever for failure-terminal drain")),
          1500,
        );
      }),
    ]);
    expect(status).toBe(130);
    expect(records.map((record) => record.record_type)).toEqual(["header", "item", "terminal"]);
    expect(sink.destroyed).toBe(true);
    const diagnostic = JSON.parse(diagnostics.join(""));
    expect(diagnostic.outcome).toBe("failure");
    expect(diagnostic.completion).toEqual({ returned: 1, exhausted: false, stop_reason: "error" });
    expect(diagnostic.continuation).toBe(next);
    expect(diagnostic.error.problem.code).toBe("interrupted");
  } finally {
    clearTimeout(timer);
    release?.();
    await running;
    sink.destroy();
    list.mockRestore();
    fetch.mockRestore();
  }
}, 3000);

it.each([
  ["1", 5, "unsupported_capability"],
  ["=", 2, "invalid_value"],
  ["bare-token", 2, "invalid_value"],
] as const)(
  "refuses unresolved historical source %s before discovering or reading an absolute target",
  async (source, status, code) => {
    const bind = vi.spyOn(RetainedClient.prototype, "bindWrite");
    const read = vi.spyOn(RetainedClient.prototype, "read");
    let stdout = "";
    try {
      expect(
        await runCanonicalInvocation(
          {
            command: ["update"],
            positionals: ["https://wire.example/work/note"],
            options: { fromRevision: source, outputFormat: "json" },
            explicitOptions: ["fromRevision", "outputFormat"],
          },
          { auth: {} },
          {
            stdout: (text) => {
              stdout += text;
            },
            stderr: () => undefined,
          },
        ),
      ).toBe(status);
      expect(JSON.parse(stdout).error.problem.code).toBe(code);
      expect(JSON.parse(stdout).bdp_spec).toBeNull();
      expect(bind).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } finally {
      bind.mockRestore();
      read.mockRestore();
    }
  },
);

it.each([true, false])(
  "selects historical media only for advertised source Update (advertised=%s)",
  async (advertised) => {
    const scope = "https://wire.example/work/";
    const url = `${scope}custom-update`;
    const directory = Object.fromEntries(
      [
        "createBead",
        "updateBead",
        "deleteBead",
        "createLink",
        "updateLink",
        "deleteLink",
        "putAlias",
        "deleteAlias",
      ].map((k) => [k, k === "updateBead" ? url : `${scope}${k}`]),
    );
    const binding = new RetainedWriteBinding({
      scope,
      discovery: {
        contentType: "application/vnd.bdp.v0.1+json",
        bodyText: JSON.stringify({
          bdpVersion: "0.1",
          profile: "write",
          scope,
          beads: `${scope}beads`,
          links: `${scope}links`,
          aliases: `${scope}aliases/`,
          operations: `${scope}verbs`,
          ...(advertised
            ? {
                capabilities: {
                  "https://github.com/gastownhall/bdp/capabilities/historical-update": {
                    "1": { atomicBatch: false },
                  },
                },
              }
            : {}),
        }),
      },
      directory: {
        contentType: "application/vnd.bdp.v0.1+json",
        bodyText: JSON.stringify(directory),
      },
      maximumDocumentBytes: 65536,
      maximumRequestBodyBytes: 65536,
    });
    const bind = vi.spyOn(RetainedClient.prototype, "bindWrite").mockResolvedValue({
      kind: "success",
      value: binding,
      http: { status: 200, url, headers: {}, contentType: null, retryAfter: null },
    });
    const submit = vi.spyOn(RetainedClient.prototype, "submit");
    let stdout = "";
    let stderr = "";
    try {
      const status = await runCanonicalInvocation(
        {
          command: ["update"],
          positionals: ["note"],
          options: {
            fromRevision: "=source + /@=",
            ifRevision: "current + /@=",
            dryRunMode: "bdp",
          },
          explicitOptions: ["fromRevision", "ifRevision", "dryRunMode"],
        },
        { scope: { url: scope }, auth: {} },
        {
          stdout: (text) => {
            stdout += text;
          },
          stderr: (text) => {
            stderr += text;
          },
        },
      );
      expect(status).toBe(advertised ? 0 : 5);
      const value = JSON.parse(advertised ? stdout : stderr);
      if (advertised)
        expect(value).toMatchObject({
          method: "POST",
          url,
          headers: {
            accept: "application/vnd.bdp.v0.1.historical-update.v1+json",
            "content-type": "application/vnd.bdp.v0.1.historical-update.v1+json",
          },
          body: {
            bead: `${scope}note`,
            fromRevision: "source + /@=",
            expectedRevision: "current + /@=",
          },
        });
      else expect(value.error.problem.code).toBe("unsupported_capability");
      expect(submit).not.toHaveBeenCalled();
    } finally {
      bind.mockRestore();
      submit.mockRestore();
    }
  },
);
