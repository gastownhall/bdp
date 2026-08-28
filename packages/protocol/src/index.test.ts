import { describe, expect, it } from "vitest";

import {
  BDP_EXTERNAL_REFERENCE_TYPE,
  BDP_PROBLEM_FAMILY_PREFIX,
  BDP_V0_SCHEMA_ID,
  isProtocolProfile,
  isReadProblemCode,
  packageName,
  PROTOCOL_PROFILES,
  readProblemDefinitionFor,
  READ_PROBLEM_DEFINITIONS,
} from "./index.js";

describe("protocol package skeleton", () => {
  it("is importable without defining protocol behavior", () => {
    expect(packageName).toBe("@bdp/protocol");
  });
});

describe("ProtocolProfile", () => {
  it("enumerates exactly the three cumulative wire tokens", () => {
    expect(PROTOCOL_PROFILES).toEqual(["read", "read-update", "transactional"]);
  });

  it("accepts each wire token", () => {
    for (const value of PROTOCOL_PROFILES) expect(isProtocolProfile(value)).toBe(true);
  });

  const rejected: readonly unknown[] = [
    // Human labels — not wire tokens.
    "read+update",
    "Read",
    "READ-UPDATE",
    " read",
    "read ",
    "",
    undefined,
    null,
    5,
    ["read"],
  ];

  for (const value of rejected) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      expect(isProtocolProfile(value)).toBe(false);
    });
  }
});

describe("Read problem definitions", () => {
  it("exports the canonical BDP v0 schema and problem identifiers", () => {
    expect(BDP_V0_SCHEMA_ID).toBe("https://github.com/gastownhall/bdp/schemas/bdp-v0.schema.json");
    expect(BDP_PROBLEM_FAMILY_PREFIX).toBe("https://github.com/gastownhall/bdp/problems/");
    expect(BDP_EXTERNAL_REFERENCE_TYPE).toBe(
      "https://github.com/gastownhall/bdp/types/external-reference",
    );
  });

  it("enumerates the accepted Gate 0 Read problem table exactly", () => {
    expect(READ_PROBLEM_DEFINITIONS).toEqual([
      {
        code: "malformed-request",
        family: "request",
        type: "https://github.com/gastownhall/bdp/problems/request",
        status: 400,
        retry: "never",
      },
      {
        code: "invalid-parameter",
        family: "request",
        type: "https://github.com/gastownhall/bdp/problems/request",
        status: 400,
        retry: "never",
      },
      {
        code: "unauthenticated",
        family: "authentication",
        type: "https://github.com/gastownhall/bdp/problems/authentication",
        status: 401,
        retry: "after-state-change",
      },
      {
        code: "forbidden",
        family: "authorization",
        type: "https://github.com/gastownhall/bdp/problems/authorization",
        status: 403,
        retry: "after-state-change",
      },
      {
        code: "resource-not-found",
        family: "not-found",
        type: "https://github.com/gastownhall/bdp/problems/not-found",
        status: 404,
        retry: "after-state-change",
      },
      {
        code: "foreign-view",
        family: "conflict",
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        status: 409,
        retry: "after-state-change",
      },
      {
        code: "cursor-expired",
        family: "gone",
        type: "https://github.com/gastownhall/bdp/problems/gone",
        status: 410,
        retry: "after-state-change",
      },
      {
        code: "request-too-large",
        family: "size",
        type: "https://github.com/gastownhall/bdp/problems/size",
        status: 413,
        retry: "never",
      },
      {
        code: "limit-exceeded",
        family: "size",
        type: "https://github.com/gastownhall/bdp/problems/size",
        status: 413,
        retry: "never",
      },
      {
        code: "rate-limited",
        family: "rate-limit",
        type: "https://github.com/gastownhall/bdp/problems/rate-limit",
        status: 429,
        retry: "after-delay",
      },
      {
        code: "temporarily-unavailable",
        family: "unavailable",
        type: "https://github.com/gastownhall/bdp/problems/unavailable",
        status: 503,
        retry: "after-delay",
      },
    ]);
  });

  it("looks up and validates known Read problem codes", () => {
    expect(readProblemDefinitionFor("cursor-expired")).toMatchObject({
      type: "https://github.com/gastownhall/bdp/problems/gone",
      status: 410,
      retry: "after-state-change",
    });
    expect(isReadProblemCode("cursor-expired")).toBe(true);
    expect(isReadProblemCode("unsupported-media-type")).toBe(false);
  });
});
