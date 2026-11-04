import { Writable } from "node:stream";
import { BdpClient, RetainedClient, RetainedWriteBinding } from "@bdp/client";
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
  ["9223372036854775807", 5, "unsupported_capability"],
  ["9223372036854775808", 2, "invalid_value"],
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
          specRevision: "0123456789abcdef0123456789abcdef01234567",
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

it.each([
  ["note@current", "https://wire.example/work/note"],
  ["note@=r@current", { uri: "https://wire.example/work/note", revision: "r@current" }],
  ["[https://wire.example/work/note@literal]@current", "https://wire.example/work/note@literal"],
  ["https://wire.example/work/note@current", "https://wire.example/work/note@current"],
] as const)(
  "preserves the complete current or exact read selection %s",
  async (operand, reference) => {
    const scope = "https://wire.example/work/";
    const read = vi.spyOn(RetainedClient.prototype, "read").mockResolvedValue({
      kind: "success",
      http: { status: 200, url: scope, headers: {}, contentType: null, retryAfter: null },
      value: {
        specification: RETAINED_V01_SPECIFICATION,
        scope,
        resourceKind: "bead",
        representation: "resource",
        body: {
          id: `${scope}note`,
          type: `${scope}Task`,
          revision: "r1",
          properties: { title: "observed" },
          metadata: {},
        },
      },
    });
    try {
      const status = await runCanonicalInvocation(
        {
          command: ["show"],
          positionals: [operand],
          options: { outputFormat: "json" },
          explicitOptions: ["outputFormat"],
        },
        { scope: { url: scope }, auth: {} },
        { stdout: () => undefined, stderr: () => undefined },
      );
      expect(status).toBe(0);
      expect(read).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reference }));
    } finally {
      read.mockRestore();
    }
  },
);

it("resolves @N newest-first through History before reading the exact token", async () => {
  const scope = "https://wire.example/work/";
  const history = vi
    .spyOn(BdpClient.prototype, "performHistory")
    .mockImplementation(async (request) => {
      if (request.kind !== "versions") throw new Error("expected History versions request");
      return {
        subject: `${scope}note`,
        population: "all-retained",
        participation: "tracked",
        window: { newest: "new", oldest: "old", complete: true },
        items: [
          { revision: "new", lineage: "current", body: "complete" },
          { revision: "previous", lineage: "replaced", body: "complete" },
        ],
        next: null,
      };
    });
  const read = vi.spyOn(RetainedClient.prototype, "read").mockResolvedValue({
    kind: "success",
    http: { status: 200, url: scope, headers: {}, contentType: null, retryAfter: null },
    value: {
      specification: RETAINED_V01_SPECIFICATION,
      scope,
      resourceKind: "bead",
      representation: "resource",
      body: {
        id: `${scope}note`,
        type: `${scope}Task`,
        revision: "previous",
        properties: {},
        metadata: {},
      },
    },
  });
  try {
    const status = await runCanonicalInvocation(
      {
        command: ["show"],
        positionals: ["note@2"],
        options: { outputFormat: "json" },
        explicitOptions: ["outputFormat"],
      },
      { scope: { url: scope }, auth: {} },
      { stdout: () => undefined, stderr: () => undefined },
    );
    expect(status).toBe(0);
    expect(history).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "versions", resource: "bead", id: `${scope}note` }),
      {},
    );
    expect(read).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ reference: { uri: `${scope}note`, revision: "previous" } }),
    );
  } finally {
    history.mockRestore();
    read.mockRestore();
  }
});

it("resolves an ordinal across authoritative newest-first History pages", async () => {
  const scope = "https://wire.example/work/";
  const history = vi
    .spyOn(BdpClient.prototype, "performHistory")
    .mockImplementation(async (request) => {
      if (request.kind !== "versions") throw new Error("expected History versions request");
      return request.continuation === undefined
        ? {
            subject: `${scope}note`,
            population: "all-retained",
            participation: "tracked",
            window: { newest: "new", oldest: "old", complete: true },
            items: [{ revision: "new", lineage: "current", body: "complete" }],
            next: `${scope}note?view=versions&cursor=next`,
          }
        : {
            subject: `${scope}note`,
            population: "all-retained",
            participation: "tracked",
            window: { newest: "new", oldest: "old", complete: true },
            items: [{ revision: "older", lineage: "replaced", body: "complete" }],
            next: null,
          };
    });
  const read = vi.spyOn(RetainedClient.prototype, "read").mockResolvedValue({
    kind: "success",
    http: { status: 200, url: scope, headers: {}, contentType: null, retryAfter: null },
    value: {
      specification: RETAINED_V01_SPECIFICATION,
      scope,
      resourceKind: "bead",
      representation: "resource",
      body: {
        id: `${scope}note`,
        type: `${scope}Task`,
        revision: "older",
        properties: {},
        metadata: {},
      },
    },
  });
  try {
    const status = await runCanonicalInvocation(
      { command: ["show"], positionals: ["note@2"], options: {}, explicitOptions: [] },
      { scope: { url: scope }, auth: {} },
      { stdout: () => undefined, stderr: () => undefined },
    );
    expect(status).toBe(0);
    expect(history).toHaveBeenCalledTimes(2);
    expect(history.mock.calls[1]?.[0]).toMatchObject({
      continuation: `${scope}note?view=versions&cursor=next`,
    });
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ reference: { uri: `${scope}note`, revision: "older" } }),
    );
  } finally {
    history.mockRestore();
    read.mockRestore();
  }
});

it("lists Bead and Link History with newest-first CLI ordinals", async () => {
  const scope = "https://wire.example/work/";
  const history = vi
    .spyOn(BdpClient.prototype, "performHistory")
    .mockImplementation(async (request) => ({
      subject: request.id,
      population: "all-retained",
      participation: "tracked",
      window: { newest: "r2", oldest: "r1", complete: true },
      items: [
        { revision: "r2", lineage: "current", body: "complete" },
        { revision: "r1", lineage: "replaced", body: "complete" },
      ],
      next: null,
    }));
  const stdout: string[] = [];
  try {
    expect(
      await runCanonicalInvocation(
        {
          command: ["link", "versions"],
          positionals: ["relation"],
          options: {},
          explicitOptions: [],
        },
        { scope: { url: scope }, auth: {} },
        {
          stdout: (text) => {
            stdout.push(text);
          },
          stderr: () => undefined,
        },
      ),
    ).toBe(0);
    expect(history).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "versions", resource: "link", id: `${scope}relation` }),
      {},
    );
    expect(stdout.join("")).toContain("1       r2");
    expect(stdout.join("")).toContain("2       r1");
  } finally {
    history.mockRestore();
  }
});

it("uses output-mode json for machine-readable failures without output-format", async () => {
  let stdout = "";
  let stderr = "";
  const status = await runCanonicalInvocation(
    {
      command: ["show"],
      positionals: ["note@9223372036854775808"],
      options: { outputMode: "json" },
      explicitOptions: ["outputMode"],
    },
    { scope: { url: "https://wire.example/work/" }, auth: {} },
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  );

  expect(status).toBe(2);
  expect(JSON.parse(stdout)).toMatchObject({
    outcome: "failure",
    error: { problem: { code: "invalid_value" } },
  });
  expect(stderr).toBe("");
});

it.each([
  [
    "[https://wire.example/work/note@literal]@=r@current",
    "https://wire.example/work/note@literal",
    0,
  ],
  ["[https://wire.example/work/note]@3", "https://wire.example/work/note", 0],
  ["https://wire.example/work/note@current", "https://wire.example/work/note@current", 0],
  ["note@current", "https://wire.example/work/note", 0],
  ["https://wire.example/work/urn:example:note", "https://wire.example/work/urn:example:note", 0],
  ["https://wire.example/work/batch-ref::X", "https://wire.example/work/batch-ref::X", 0],
  ["note@garbage", undefined, 2],
  ["note@=", undefined, 2],
  ["note@0", undefined, 2],
  ["note@01", undefined, 2],
  ["note@-1", undefined, 2],
  ["note@9223372036854775807", "https://wire.example/work/note", 0],
  ["[https://wire.example/work/note]@9223372036854775807", "https://wire.example/work/note", 0],
  ["note@9223372036854775808", undefined, 2],
  ["[https://wire.example/work/note]@9223372036854775808", undefined, 2],
] as const)(
  "validates whole incidence operand before ignoring applicability: %s",
  async (operand, identity, expected) => {
    const scope = "https://wire.example/work/";
    const list = vi.spyOn(RetainedClient.prototype, "list").mockResolvedValue({
      kind: "success",
      http: { status: 200, url: scope, headers: {}, contentType: null, retryAfter: null },
      value: {
        specification: RETAINED_V01_SPECIFICATION,
        scope,
        collectionKind: "link",
        page: { items: [], next: null },
      },
    });
    try {
      const status = await runCanonicalInvocation(
        {
          command: ["link", "list"],
          positionals: [operand],
          options: { allRevisions: true, outputFormat: "json" },
          explicitOptions: ["allRevisions", "outputFormat"],
        },
        { scope: { url: scope }, auth: {} },
        { stdout: () => undefined, stderr: () => undefined },
      );
      expect(status).toBe(expected);
      if (identity === undefined) expect(list).not.toHaveBeenCalled();
      else
        expect(list).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            filters: {
              selector: `$[?((@.source == ${JSON.stringify(identity)} || @.source.uri == ${JSON.stringify(identity)}) || (@.target == ${JSON.stringify(identity)} || @.target.uri == ${JSON.stringify(identity)}))]`,
            },
          }),
        );
    } finally {
      list.mockRestore();
    }
  },
);

it.each([
  ["update", "note@current", { properties: "{}" }],
  ["update", "note@=r1", { properties: "{}" }],
  ["delete", "note@current", { force: true }],
  ["delete", "note@=r1", { force: true }],
  ["delete", "note@current", {}],
  ["delete", "note@=r1", {}],
] as const)(
  "refuses selected mutation target %s %s before any read or Write discovery",
  async (command, operand, edits) => {
    const read = vi.spyOn(RetainedClient.prototype, "read");
    const bind = vi.spyOn(RetainedClient.prototype, "bindWrite");
    try {
      expect(
        await runCanonicalInvocation(
          {
            command: [command],
            positionals: [operand],
            options: { ...edits, outputFormat: "json" },
            explicitOptions: [...Object.keys(edits), "outputFormat"],
          },
          { scope: { url: "https://wire.example/work/" }, auth: {} },
          { stdout: () => undefined, stderr: () => undefined },
        ),
      ).toBe(2);
      expect(read).not.toHaveBeenCalled();
      expect(bind).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      bind.mockRestore();
    }
  },
);

it.each([
  [true, "urn:example:note"],
  [true, "batch-ref::X"],
  [false, "urn:example:note"],
  [false, "batch-ref::X"],
] as const)(
  "keeps incidence Reference admission when all-revisions=%s: %s",
  async (allRevisions, operand) => {
    const list = vi.spyOn(RetainedClient.prototype, "list");
    const read = vi.spyOn(RetainedClient.prototype, "read");
    let stdout = "";
    try {
      expect(
        await runCanonicalInvocation(
          {
            command: ["link", "list"],
            positionals: [operand],
            options: { allRevisions, outputFormat: "json" },
            explicitOptions: ["allRevisions", "outputFormat"],
          },
          { scope: { url: "https://wire.example/work/" }, auth: {} },
          {
            stdout: (text) => {
              stdout += text;
            },
            stderr: () => undefined,
          },
        ),
      ).toBe(2);
      expect(JSON.parse(stdout).error.problem.code).toBe("invalid_value");
      expect(list).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
      read.mockRestore();
    }
  },
);
