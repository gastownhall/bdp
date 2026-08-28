import { describe, expect, it } from "vitest";

import { parseLinkHeader } from "./link-header.js";

describe("parseLinkHeader", () => {
  it("preserves link and parameter order, including duplicate parameters", () => {
    expect(
      parseLinkHeader(
        '<ignored>; title="commas, semicolons; stay quoted", <bdp.json>; rel=alternate; REL="service-desc next"; rel=last',
      ),
    ).toEqual([
      {
        target: "ignored",
        parameters: [{ name: "title", value: "commas, semicolons; stay quoted", quoted: true }],
      },
      {
        target: "bdp.json",
        parameters: [
          { name: "rel", value: "alternate", quoted: false },
          { name: "rel", value: "service-desc next", quoted: true },
          { name: "rel", value: "last", quoted: false },
        ],
      },
    ]);
  });

  it("decodes quoted-pair escapes", () => {
    expect(parseLinkHeader('<target>; title="say \\"hello\\""')).toEqual([
      {
        target: "target",
        parameters: [{ name: "title", value: 'say "hello"', quoted: true }],
      },
    ]);
  });

  it("ignores malformed field values and parameters without discarding valid siblings", () => {
    expect(
      parseLinkHeader('not-a-link; rel=next, <good>; missing; =bad; rel="unterminated; type=json'),
    ).toEqual([{ target: "good", parameters: [] }]);
  });

  it("returns immutable snapshots", () => {
    const parsed = parseLinkHeader("<target>; rel=next");
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed[0])).toBe(true);
    expect(Object.isFrozen(parsed[0]?.parameters)).toBe(true);
    expect(Object.isFrozen(parsed[0]?.parameters[0])).toBe(true);
  });
});
