import { REFERENCE_TYPE_DESCRIPTORS } from "@bdp/protocol";
import { BD_SERVED_TYPE_DESCRIPTORS } from "./index.js";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type AbsoluteHttpUrl, type BdProcessOptions, createBdProcessScopePort } from "./index.js";

const scope = "https://scope.example/local-test/" as AbsoluteHttpUrl;
const options = { signal: new AbortController().signal };
const temporaryDirectories: string[] = [];
const DEPENDENCY_FALLBACK_OVERSIZE = 17_000;
const opaque = (value: string): string => `b64_${Buffer.from(value, "utf8").toString("base64url")}`;
const localComponent = (value: string): string =>
  /^[A-Za-z0-9._~-]+$/.test(value) && value !== "." && value !== ".." && !value.startsWith("b64_")
    ? value
    : opaque(value);
const beadUrl = (id: string): string => `${scope}beads/${localComponent(id)}`;
const linkUrl = (source: string, target: string, type: string): string =>
  `${scope}links/${opaque(source)}/${opaque(target)}/${opaque(type)}`;
const typeUrl = (type: string): string => `${scope}types/${localComponent(type)}`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("bd process Scope port", () => {
  it("serves the shared domain descriptors with ownership stripped — bd declares no ownership", () => {
    const decision = BD_SERVED_TYPE_DESCRIPTORS.find(({ id }) => id.endsWith("/decision"));
    expect(decision).toBeDefined();
    expect(decision).not.toHaveProperty("ownsOutgoing");
    expect(REFERENCE_TYPE_DESCRIPTORS.find(({ id }) => id.endsWith("/decision"))).toHaveProperty(
      "ownsOutgoing",
    );
  });

  it("combines structural predicates over the projected reference Type closure", async () => {
    const { port } = await createPort();

    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "beads",
          conformsTo: "https://work.example/types/tracked-item",
        },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "success",
      body: { items: [{ properties: { title: "A" } }], next: null },
    });
    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "beads",
          type: "https://work.example/types/work-item",
        },
        options,
      ),
    ).resolves.toEqual({ kind: "success", body: { items: [], next: null } });
    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "beads",
          type: "https://work.example/types/decision",
          conformsTo: "https://work.example/types/work-item",
        },
        options,
      ),
    ).resolves.toEqual({ kind: "success", body: { items: [], next: null } });
    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "links",
          type: "https://work.example/types/blocks",
          source: beadUrl("a"),
          endpoint: beadUrl("b"),
        },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "success",
      body: {
        items: [
          {
            id: linkUrl("a", "b", "blocks"),
            type: "https://work.example/types/blocks",
            source: beadUrl("a"),
            target: beadUrl("b"),
          },
        ],
        next: null,
      },
    });
    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "links",
          type: "https://work.example/types/relationship",
        },
        options,
      ),
    ).resolves.toEqual({ kind: "success", body: { items: [], next: null } });
    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "links",
          conformsTo: "https://work.example/types/relationship",
        },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "success",
      body: { items: [{ id: linkUrl("a", "b", "blocks") }], next: null },
    });
    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "links",
          conformsTo: "https://work.example/types/work-item",
        },
        options,
      ),
    ).resolves.toEqual({ kind: "success", body: { items: [], next: null } });
  });

  it("preserves the pinned bd ready compatibility properties", async () => {
    const { port } = await createPort();

    await expect(
      port.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: {
        items: [
          {
            properties: {
              id: "a",
              title: "A",
              status: "open",
              priority: 2,
              issue_type: "task",
              created_at: "2026-08-08T23:33:31Z",
              created_by: "bdp-conformance",
              updated_at: "2026-08-08T23:33:35Z",
              dependency_count: 1,
              dependent_count: 0,
              comment_count: 0,
            },
          },
          {
            properties: {
              id: "b",
              title: "B",
              status: "open",
              priority: 2,
              issue_type: "decision",
              created_at: "2026-08-08T23:33:32Z",
              created_by: "bdp-conformance",
              updated_at: "2026-08-08T23:33:36Z",
              dependency_count: 0,
              dependent_count: 1,
              comment_count: 0,
            },
          },
        ],
        next: null,
      },
    });
  });

  it("returns resource-not-found for missing properties and incident-Link subjects", async () => {
    const { port } = await createPort();

    await expect(
      port.perform({ kind: "properties", resource: "bead", id: beadUrl("missing") }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found", status: 404 },
    });
    await expect(
      port.perform({ kind: "bead-links", bead: beadUrl("missing"), direction: "both" }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found", status: 404 },
    });
  });

  it("uses an exact caller-provided environment for every bd child", async () => {
    const environment = {
      PATH: process.env.PATH ?? "",
      HOME: "/isolated/bdp-home",
      BDP_TEST_MARKER: "present",
    };
    const { port, environmentFile } = await createPort("normal", environment);
    environment.HOME = "/mutated/after-construction";

    await expect(
      port.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: { items: expect.any(Array), next: null },
    });
    const childEnvironment = JSON.parse(await readFile(environmentFile, "utf8")) as Record<
      string,
      string
    >;
    expect(childEnvironment).toMatchObject({
      HOME: "/isolated/bdp-home",
      BDP_TEST_MARKER: "present",
    });
    expect(childEnvironment.USER).toBeUndefined();
  });

  it("resolves Type Descriptors by exact identity without suffix aliasing", async () => {
    const { port } = await createPort("custom-type");

    await expect(
      port.perform(
        { kind: "resource", resource: "type", id: "https://work.example/types/task" },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "success",
      body: { id: "https://work.example/types/task", describes: "bead" },
    });
    await expect(
      port.perform({ kind: "resource", resource: "type", id: typeUrl("custom") }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: { id: typeUrl("custom"), describes: "bead" },
    });
    await expect(
      port.perform({ kind: "resource", resource: "type", id: `${scope}types/blocks` }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found", status: 404 },
    });
  });

  it("does not classify deterministic Type-category collisions as retryable failures", async () => {
    const { port } = await createPort("type-collision");

    await expect(
      port.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "temporarily-unavailable", status: 503 },
    });
  });

  it("fails closed when bd reports a dependency whose target is not a live Bead", async () => {
    const { port } = await createPort("missing-target");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "temporarily-unavailable", status: 503 },
    });
  });

  it("projects bd's exact native external dependency as a local-to-external Link", async () => {
    const { port } = await createPort("external-target");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toEqual({
      kind: "success",
      body: {
        items: [
          {
            id: linkUrl("a", "external:beads:mol-run-assignee", "blocks"),
            type: "https://work.example/types/blocks",
            revision: expect.stringMatching(/^sha256_[A-Za-z0-9_-]{43}$/),
            source: beadUrl("a"),
            target: "external:beads:mol-run-assignee",
            properties: {},
          },
        ],
        next: null,
      },
    });
    await expect(
      port.perform({ kind: "bead-links", bead: beadUrl("a"), direction: "outbound" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: { items: [{ target: "external:beads:mol-run-assignee" }], next: null },
    });
    await expect(
      port.perform({ kind: "bead-links", bead: beadUrl("a"), direction: "inbound" }, options),
    ).resolves.toEqual({ kind: "success", body: { items: [], next: null } });
    await expect(
      port.perform({ kind: "bead-links", bead: beadUrl("a"), direction: "both" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: { items: [{ target: "external:beads:mol-run-assignee" }], next: null },
    });
    await expect(
      port.perform({ kind: "properties", resource: "bead", id: beadUrl("a") }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: {
        dependencies: [
          {
            issue_id: "a",
            depends_on_id: "external:beads:mol-run-assignee",
            type: "blocks",
          },
        ],
      },
    });
    const types = await port.perform({ kind: "collection", collection: "types" }, options);
    expect(types).toMatchObject({ kind: "success" });
    if (types.kind !== "success") throw new Error("Type inventory must succeed");
    for (const { id } of types.body.items) expect(id).toMatch(/^https:\/\/work\.example\/types\//);
  });

  it("resolves a live local target before classifying an external-looking native ID", async () => {
    const { port } = await createPort("local-external-spelling");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: {
        items: [
          {
            source: beadUrl("a"),
            target: beadUrl("external:beads:local"),
          },
        ],
      },
    });
  });

  it("mints canonical injective IDs per opaque bd component", async () => {
    const { port } = await createPort("canonical-identities");
    const beadResult = await port.perform({ kind: "collection", collection: "beads" }, options);
    const linkResult = await port.perform({ kind: "collection", collection: "links" }, options);
    const typeResult = await port.perform({ kind: "collection", collection: "types" }, options);
    if (
      beadResult.kind !== "success" ||
      linkResult.kind !== "success" ||
      typeResult.kind !== "success"
    )
      throw new Error("canonical identity fixture must project");

    expect(beadResult.body.items.map(({ id }) => id)).toEqual(
      [".", "..", "a-b", "c", "a", "b-c", "b64_YQ"].map(beadUrl).sort(),
    );
    expect(linkResult.body.items.map(({ id }) => id)).toEqual(
      [linkUrl("a-b", "c", "d"), linkUrl("a", "b-c", "d")].sort(),
    );
    expect(new Set(linkResult.body.items.map(({ id }) => id))).toHaveLength(2);
    expect(typeResult.body.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([typeUrl("x/y"), typeUrl("b64_ec95"), typeUrl("d")]),
    );
  });

  it("deduplicates identical embedded edges and pins blocks direction", async () => {
    const { port } = await createPort("duplicate-edge");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toEqual({
      kind: "success",
      body: {
        items: [
          {
            id: linkUrl("a", "b", "blocks"),
            type: "https://work.example/types/blocks",
            revision: expect.stringMatching(/^sha256_[A-Za-z0-9_-]{43}$/),
            source: beadUrl("a"),
            target: beadUrl("b"),
            properties: {},
          },
        ],
        next: null,
      },
    });
  });

  it("sorts projected Beads and Links by canonical ID", async () => {
    const { port } = await createPort("unordered");
    const beadResult = await port.perform({ kind: "collection", collection: "beads" }, options);
    const linkResult = await port.perform({ kind: "collection", collection: "links" }, options);
    if (beadResult.kind !== "success" || linkResult.kind !== "success")
      throw new Error("unordered fixture must project");
    expect(beadResult.body.items.map(({ id }) => id)).toEqual(
      [...beadResult.body.items.map(({ id }) => id)].sort(),
    );
    expect(linkResult.body.items.map(({ id }) => id)).toEqual(
      [...linkResult.body.items.map(({ id }) => id)].sort(),
    );
  });

  it.each([
    "list-not-array",
    "dependencies-not-array",
    "dependency-not-object",
    "dependency-missing-target",
    "dependency-bad-target",
    "dependency-source-mismatch",
    "dependency-conflicting-target",
    "dependency-conflicting-type",
    "external-degenerate",
    "external-degenerate-capability",
    "fallback-not-array",
    "fallback-source-mismatch",
    "fallback-oversize-id",
  ] as const)("maps malformed bd projection %s to temporarily-unavailable", async (mode) => {
    const { port } = await createPort(mode);

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "temporarily-unavailable", status: 503 },
    });
  });

  it("negative-caches a projection failure instead of respawning bd", async () => {
    const { port, callsFile } = await createPort("dependencies-not-array");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: { code: "temporarily-unavailable" } });
    await expect(
      port.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: { code: "temporarily-unavailable" } });
    const calls = (await readFile(callsFile, "utf8")).trim().split("\n");
    expect(calls).toHaveLength(1);
  });

  it("does not impose a hidden one-second breaker when snapshot caching is disabled", async () => {
    const { port, callsFile } = await createPort("dependencies-not-array", undefined, {
      snapshotTtlMs: 0,
    });

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: { code: "temporarily-unavailable" } });
    await expect(
      port.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: { code: "temporarily-unavailable" } });
    const calls = (await readFile(callsFile, "utf8")).trim().split("\n");
    expect(calls).toHaveLength(2);
  });

  it("single-flights cold loads without letting one caller abort the other", async () => {
    const { port, callsFile } = await createPort("slow");
    const firstController = new AbortController();
    const first = port.perform(
      { kind: "collection", collection: "beads" },
      { signal: firstController.signal },
    );
    const second = port.perform({ kind: "collection", collection: "links" }, options);
    firstController.abort(new Error("cancel first reader"));

    await expect(first).rejects.toThrow("cancel first reader");
    await expect(second).resolves.toMatchObject({
      kind: "success",
      body: { items: [{ id: linkUrl("a", "b", "blocks") }], next: null },
    });
    const calls = (await readFile(callsFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(calls.filter(([command]) => command === "list")).toHaveLength(1);
    expect(calls.filter(([command, action]) => command === "dep" && action === "list")).toEqual([]);

    const warmController = new AbortController();
    warmController.abort(new Error("cancel warm reader"));
    await expect(
      port.perform({ kind: "collection", collection: "beads" }, { signal: warmController.signal }),
    ).rejects.toThrow("cancel warm reader");
  });

  it("uses a dependency fallback only when the dependencies field is absent", async () => {
    const { port, callsFile } = await createPort("fallback");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: {
        items: [
          {
            id: linkUrl("a", "b", "blocks"),
            type: "https://work.example/types/blocks",
            source: beadUrl("a"),
            target: beadUrl("b"),
          },
        ],
        next: null,
      },
    });
    const calls = (await readFile(callsFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(calls).toEqual([
      ["list", "--all", "--limit", "0", "--sort", "id", "--flat", "--json"],
      ["dep", "list", "--json", "--", "a"],
    ]);
  });

  it("falls back when dependencies are absent even if dependency_count is zero", async () => {
    const { port } = await createPort("fallback-zero-count");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: {
        items: [
          {
            source: beadUrl("a"),
            target: beadUrl("b"),
          },
        ],
      },
    });
  });

  it("attributes real bd-shaped multi-source output with bounded single-source probes", async () => {
    const { port, callsFile } = await createPort("fallback-batch");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: {
        items: [
          {
            type: "https://work.example/types/blocks",
            source: beadUrl("a"),
            target: beadUrl("c"),
          },
          {
            type: "https://work.example/types/blocks",
            source: beadUrl("b"),
            target: beadUrl("c"),
          },
        ],
      },
    });
    const calls = (await readFile(callsFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(calls.filter(([command, action]) => command === "dep" && action === "list")).toEqual([
      ["dep", "list", "--json", "--", "a", "b"],
      ["dep", "list", "--json", "--", "a"],
      ["dep", "list", "--json", "--", "b"],
    ]);
  });

  it("accepts an empty multi-source probe without spawning per-source commands", async () => {
    const { port, callsFile } = await createPort("fallback-empty-batch");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toEqual({ kind: "success", body: { items: [], next: null } });
    const calls = (await readFile(callsFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(calls.filter(([command, action]) => command === "dep" && action === "list")).toEqual([
      ["dep", "list", "--json", "--", "a", "b"],
    ]);
  });

  it("protects option-like IDs with the supported argument terminator", async () => {
    const { port, callsFile } = await createPort("fallback-option-id");

    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: { items: [{ source: beadUrl("--profile"), target: beadUrl("b") }] },
    });
    const calls = (await readFile(callsFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(calls.at(-1)).toEqual(["dep", "list", "--json", "--", "--profile"]);
  });

  it("decodes JSON correctly when a multibyte UTF-8 scalar spans stdout chunks", async () => {
    const { port } = await createPort("split-utf8");

    await expect(
      port.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: { items: [{ properties: { title: "Café" } }] },
    });
  });

  it("refreshes the bd snapshot between sequential operations", async () => {
    const { port } = await createPort("changing", undefined, { snapshotTtlMs: 0 });

    await expect(
      port.perform({ kind: "resource", resource: "bead", id: beadUrl("a") }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: { properties: { status: "open" } },
    });
    await expect(
      port.perform({ kind: "resource", resource: "bead", id: beadUrl("a") }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: { properties: { status: "closed" } },
    });
  });

  it("changes a Bead revision when an incoming dependency count changes without updated_at", async () => {
    const { port } = await createPort("changing-dependent-count", undefined, { snapshotTtlMs: 0 });

    const first = await port.perform(
      { kind: "resource", resource: "bead", id: beadUrl("b") },
      options,
    );
    const second = await port.perform(
      { kind: "resource", resource: "bead", id: beadUrl("b") },
      options,
    );
    if (first.kind !== "success" || second.kind !== "success")
      throw new Error("changing dependent-count fixture must project");

    expect(first.body.properties).toMatchObject({
      updated_at: "2026-08-08T23:33:36Z",
      dependent_count: 1,
    });
    expect(second.body.properties).toMatchObject({
      updated_at: "2026-08-08T23:33:36Z",
      dependent_count: 2,
    });
    expect(second.body.revision).not.toBe(first.body.revision);
  });

  it("keeps a Link revision stable when only an endpoint Bead's Type changes", async () => {
    const { port } = await createPort("changing-link-representation", undefined, {
      snapshotTtlMs: 0,
    });

    const first = await port.perform({ kind: "collection", collection: "links" }, options);
    const second = await port.perform({ kind: "collection", collection: "links" }, options);
    if (first.kind !== "success" || second.kind !== "success")
      throw new Error("changing Link fixture must project");
    const firstLink = first.body.items[0];
    const secondLink = second.body.items[0];
    if (firstLink === undefined || secondLink === undefined)
      throw new Error("changing Link fixture must contain a Link");

    expect(firstLink.id).toBe(secondLink.id);
    // References no longer carry endpoint Types, so retyping the target Bead
    // leaves the Link's projected representation — and its revision — alone.
    expect(secondLink.target).toBe(firstLink.target);
    expect(secondLink.revision).toBe(firstLink.revision);
  });

  it("fails closed after the deadline when a child traps SIGTERM and later exits zero", async () => {
    const { port, pidFile } = await createPort("late-success", undefined, { timeoutMs: 500 });
    const started = Date.now();

    await expect(
      port.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "temporarily-unavailable" },
    });
    expect(Date.now() - started).toBeLessThan(1_200);
    await waitForProcessExit(pidFile);
  });

  it("contains and terminates a grandchild that keeps the stdio pipes open", async () => {
    const { port, pidFile, grandchildPidFile } = await createPort("grandchild-stdio", undefined, {
      timeoutMs: 500,
    });
    const started = Date.now();
    try {
      await expect(
        port.perform({ kind: "collection", collection: "beads" }, options),
      ).resolves.toMatchObject({
        kind: "problem",
        problem: { code: "temporarily-unavailable" },
      });
      expect(Date.now() - started).toBeLessThan(1_200);
      await waitForProcessExit(pidFile);
      expect(await processExists(grandchildPidFile)).toBe(false);
    } finally {
      await terminateProcess(grandchildPidFile);
    }
  });

  it("fails closed when combined child output exceeds its configured bound", async () => {
    const { port, pidFile } = await createPort("output-overflow", undefined, {
      timeoutMs: 5_000,
      maxOutputBytes: 64,
    });
    const started = Date.now();

    await expect(
      port.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "temporarily-unavailable" },
    });
    expect(Date.now() - started).toBeLessThan(1_200);
    await waitForProcessExit(pidFile);
  });

  it("escalates termination after the final reader aborts a hostile child", async () => {
    const { port, pidFile } = await createPort("late-success", undefined, { timeoutMs: 5_000 });
    const controller = new AbortController();
    const operation = port.perform(
      { kind: "collection", collection: "beads" },
      { signal: controller.signal },
    );
    await waitForFile(pidFile);

    controller.abort(new Error("cancel hostile reader"));

    await expect(operation).rejects.toThrow("cancel hostile reader");
    await waitForProcessExit(pidFile);
  });
});

function bdRow(id: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    title: id,
    status: "open",
    priority: 2,
    issue_type: "task",
    created_at: "2026-08-08T23:33:31Z",
    created_by: "bdp-conformance",
    updated_at: "2026-08-08T23:33:35Z",
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

async function createPort(
  mode:
    | "normal"
    | "custom-type"
    | "type-collision"
    | "missing-target"
    | "external-target"
    | "fallback"
    | "fallback-batch"
    | "fallback-empty-batch"
    | "fallback-zero-count"
    | "fallback-source-mismatch"
    | "fallback-option-id"
    | "fallback-oversize-id"
    | "fallback-not-array"
    | "canonical-identities"
    | "local-external-spelling"
    | "duplicate-edge"
    | "unordered"
    | "list-not-array"
    | "dependencies-not-array"
    | "dependency-not-object"
    | "dependency-missing-target"
    | "dependency-bad-target"
    | "dependency-source-mismatch"
    | "dependency-conflicting-target"
    | "dependency-conflicting-type"
    | "external-degenerate"
    | "external-degenerate-capability"
    | "slow"
    | "changing"
    | "changing-dependent-count"
    | "changing-link-representation"
    | "split-utf8"
    | "late-success"
    | "grandchild-stdio"
    | "output-overflow" = "normal",
  environment?: Readonly<Record<string, string>>,
  processOptions: Pick<BdProcessOptions, "timeoutMs" | "maxOutputBytes" | "snapshotTtlMs"> = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-adapter-bd-test-"));
  temporaryDirectories.push(directory);
  const executable = path.join(directory, "bd-fixture");
  const callsFile = path.join(directory, "calls.jsonl");
  const environmentFile = path.join(directory, "environment.json");
  const pidFile = path.join(directory, "pid");
  const grandchildPidFile = path.join(directory, "grandchild-pid");
  let rows: Array<Record<string, unknown>> = [
    {
      id: "a",
      title: "A",
      status: "open",
      priority: 2,
      issue_type: mode === "custom-type" || mode === "type-collision" ? "custom" : "task",
      created_at: "2026-08-08T23:33:31Z",
      created_by: "bdp-conformance",
      updated_at: "2026-08-08T23:33:35Z",
      dependency_count: 1,
      dependent_count: 0,
      comment_count: 0,
      ...(mode === "fallback" || mode.startsWith("fallback-")
        ? {}
        : mode === "external-target"
          ? {
              dependencies: [
                {
                  issue_id: "a",
                  depends_on_id: "external:beads:mol-run-assignee",
                  type: "blocks",
                },
              ],
            }
          : {
              dependencies: [
                {
                  issue_id: "a",
                  depends_on_id: "b",
                  type: mode === "type-collision" ? "custom" : "blocks",
                },
              ],
            }),
    },
    ...(mode === "missing-target"
      ? []
      : [
          {
            id: "b",
            title: "B",
            status: "open",
            priority: 2,
            issue_type: "decision",
            created_at: "2026-08-08T23:33:32Z",
            created_by: "bdp-conformance",
            updated_at: "2026-08-08T23:33:36Z",
            dependency_count: 0,
            dependent_count: 1,
            comment_count: 0,
            dependencies: [],
          },
        ]),
  ];
  if (mode === "canonical-identities") {
    rows = [
      bdRow(".", { issue_type: "x/y", dependencies: [] }),
      bdRow("..", { issue_type: "b64_eC95", dependencies: [] }),
      bdRow("a-b", {
        dependencies: [{ issue_id: "a-b", depends_on_id: "c", type: "d" }],
      }),
      bdRow("c", { dependencies: [] }),
      bdRow("a", {
        dependencies: [{ issue_id: "a", depends_on_id: "b-c", type: "d" }],
      }),
      bdRow("b-c", { dependencies: [] }),
      bdRow("b64_YQ", { dependencies: [] }),
    ];
  } else if (mode === "local-external-spelling") {
    rows = [
      bdRow("a", {
        dependencies: [{ issue_id: "a", depends_on_id: "external:beads:local", type: "blocks" }],
      }),
      bdRow("external:beads:local", { dependencies: [] }),
    ];
  } else if (mode === "duplicate-edge") {
    const edge = { issue_id: "a", depends_on_id: "b", type: "blocks" };
    rows[0] = { ...rows[0], dependencies: [edge, { ...edge }] };
  } else if (mode === "unordered") {
    rows = [
      bdRow("c", { dependencies: [] }),
      bdRow("b", {
        dependencies: [{ issue_id: "b", depends_on_id: "c", type: "blocks" }],
      }),
      bdRow("a", {
        dependencies: [
          { issue_id: "a", depends_on_id: "c", type: "blocks" },
          { issue_id: "a", depends_on_id: "b", type: "blocks" },
        ],
      }),
    ];
  } else if (mode === "fallback-batch" || mode === "fallback-empty-batch") {
    rows = [
      bdRow("a", { dependency_count: 1 }),
      bdRow("b", { dependency_count: 1 }),
      bdRow("c", { dependency_count: 0, dependencies: [] }),
    ];
  } else if (mode === "fallback-zero-count") {
    rows = [bdRow("a", { dependency_count: 0 }), bdRow("b", { dependencies: [] })];
  } else if (mode === "fallback-source-mismatch") {
    rows = [bdRow("a", { dependency_count: 1 }), bdRow("b", { dependencies: [] })];
  } else if (mode === "fallback-option-id") {
    rows = [bdRow("--profile", { dependency_count: 1 }), bdRow("b", { dependencies: [] })];
  } else if (mode === "fallback-oversize-id") {
    rows = [bdRow("x".repeat(DEPENDENCY_FALLBACK_OVERSIZE), { dependency_count: 1 })];
  } else if (mode === "split-utf8") {
    rows = [bdRow("a", { title: "Café", dependencies: [] })];
  } else if (mode === "dependencies-not-array") {
    rows[0] = { ...rows[0], dependencies: {} };
  } else if (mode === "dependency-not-object") {
    rows[0] = { ...rows[0], dependencies: ["bad"] };
  } else if (mode === "dependency-missing-target") {
    rows[0] = { ...rows[0], dependencies: [{ issue_id: "a", type: "blocks" }] };
  } else if (mode === "dependency-bad-target") {
    rows[0] = { ...rows[0], dependencies: [{ issue_id: "a", depends_on_id: 7 }] };
  } else if (mode === "dependency-source-mismatch") {
    rows[0] = {
      ...rows[0],
      dependencies: [{ issue_id: "b", depends_on_id: "b", type: "blocks" }],
    };
  } else if (mode === "dependency-conflicting-target") {
    rows[0] = {
      ...rows[0],
      dependencies: [{ issue_id: "a", depends_on_id: "b", id: "c", type: "blocks" }],
    };
  } else if (mode === "dependency-conflicting-type") {
    rows[0] = {
      ...rows[0],
      dependencies: [
        {
          issue_id: "a",
          depends_on_id: "b",
          type: "blocks",
          dependency_type: "tracks",
        },
      ],
    };
  } else if (mode === "external-degenerate") {
    rows[0] = {
      ...rows[0],
      dependencies: [{ issue_id: "a", depends_on_id: "external::capability", type: "blocks" }],
    };
  } else if (mode === "external-degenerate-capability") {
    rows[0] = {
      ...rows[0],
      dependencies: [{ issue_id: "a", depends_on_id: "external:beads::tail", type: "blocks" }],
    };
  }
  const dependencies = [
    {
      id: "b",
      dependency_type: mode === "type-collision" ? "custom" : "blocks",
    },
  ];
  const executableSource =
    mode === "late-success" || mode === "grandchild-stdio"
      ? `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
if (${JSON.stringify(mode)} === "grandchild-stdio") {
  const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  writeFileSync(${JSON.stringify(grandchildPidFile)}, String(grandchild.pid));
}
process.on("SIGTERM", () => {});
setTimeout(() => process.stdout.write("[]"), 1500);
`
      : `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + "\\n");
writeFileSync(${JSON.stringify(environmentFile)}, JSON.stringify(process.env));
const respond = () => {
  if (args[0] === "list") {
    const listCalls = readFileSync(${JSON.stringify(callsFile)}, "utf8")
      .trim()
      .split("\\n")
      .filter((line) => JSON.parse(line)[0] === "list").length;
    const rows = ${JSON.stringify(rows)};
    if (${JSON.stringify(mode)} === "changing" && listCalls > 1) {
      rows[0] = { ...rows[0], status: "closed", updated_at: "2026-08-08T23:33:37Z" };
    }
    if (${JSON.stringify(mode)} === "changing-dependent-count" && listCalls > 1) {
      rows[1] = { ...rows[1], dependent_count: 2 };
    }
    if (${JSON.stringify(mode)} === "changing-link-representation" && listCalls > 1) {
      rows[1] = { ...rows[1], issue_type: "task" };
    }
    const output = Buffer.from(JSON.stringify(${JSON.stringify(mode)} === "list-not-array" ? {} : rows));
    if (${JSON.stringify(mode)} === "split-utf8") {
      const scalar = Buffer.from("é");
      const split = output.indexOf(scalar) + 1;
      process.stdout.write(output.subarray(0, split));
      process.stderr.write(scalar.subarray(0, 1));
      setImmediate(() => {
        process.stdout.write(output.subarray(split));
        process.stderr.write(scalar.subarray(1));
      });
    } else process.stdout.write(output);
  } else if (args[0] === "dep" && args[1] === "list") {
    const mode = ${JSON.stringify(mode)};
    const separator = args.indexOf("--");
    const sources = separator === -1 ? [] : args.slice(separator + 1);
    const response = mode === "fallback-not-array"
      ? {}
      : mode === "fallback-batch"
        ? sources.map(() => ({ id: "c", dependency_type: "blocks" }))
        : mode === "fallback-source-mismatch"
          ? [{ issue_id: "b", id: "b", dependency_type: "blocks" }]
          : sources[0] === "a" && (mode === "fallback" || mode === "fallback-zero-count")
            ? ${JSON.stringify(dependencies)}
            : sources[0] === "--profile" && mode === "fallback-option-id"
              ? ${JSON.stringify(dependencies)}
            : [];
    process.stdout.write(JSON.stringify(response));
  } else {
    process.stderr.write("unexpected arguments");
    process.exitCode = 2;
  }
};
if (${JSON.stringify(mode)} === "slow" && args[0] === "list") setTimeout(respond, 75);
else if (${JSON.stringify(mode)} === "output-overflow" && args[0] === "list") {
  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
  process.on("SIGTERM", () => {});
  process.stdout.write("[]");
  process.stderr.write("x".repeat(1024));
  setTimeout(() => process.exit(0), 1500);
} else respond();
`;
  await writeFile(executable, executableSource);
  await chmod(executable, 0o755);
  return {
    port: createBdProcessScopePort(scope, {
      executable,
      workspace: directory,
      ...(environment === undefined ? {} : { environment }),
      ...processOptions,
    }),
    callsFile,
    environmentFile,
    pidFile,
    grandchildPidFile,
  };
}

async function waitForFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await readFile(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("fixture process did not start");
}

async function processExists(pidFile: string): Promise<boolean> {
  const pid = Number(await readFile(pidFile, "utf8"));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pidFile: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await processExists(pidFile))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("fixture process survived bounded termination");
}

async function terminateProcess(pidFile: string): Promise<void> {
  try {
    const pid = Number(await readFile(pidFile, "utf8"));
    process.kill(pid, "SIGTERM");
    await waitForProcessExit(pidFile);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ESRCH")
    )
      return;
    throw error;
  }
}
