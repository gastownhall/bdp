import { describe, expect, it } from "vitest";
import { ReadSession, ReadSessionLocalError } from "./read-session.js";

const scope = "https://example.test/s/";
const roots = { scope, beads: `${scope}beads/`, links: `${scope}links/`, types: `${scope}types/` };
const first = { kind: "collection", collection: "beads" } as const;
const next = `${scope}beads/?cursor=next`;
function issue(session: ReadSession) {
  const prepared = session.prepare(first);
  expect(prepared.route(roots).kind).toBe("success");
  const staged = prepared.validate({ items: [], next });
  if (staged.kind !== "success") throw Error("valid control refused");
  expect(prepared.commit(staged.value).kind).toBe("success");
  prepared.release();
}

describe("shared Read stage ownership", () => {
  it("validates without issuing a capability and commits only its own captured stage", () => {
    const session = new ReadSession(scope),
      prepared = session.prepare(first);
    const staged = prepared.validate({ items: [], next });
    if (staged.kind !== "success") throw Error("valid control refused");
    expect(() => session.prepare({ ...first, continuation: next })).toThrow(ReadSessionLocalError);
    expect(() => prepared.commit({ body: staged.value.body })).toThrow(ReadSessionLocalError);
    expect(prepared.commit(staged.value).kind).toBe("success");
    expect(() => prepared.commit(staged.value)).toThrow(ReadSessionLocalError);
    session.prepare({ ...first, continuation: next }).release();
  });
  it.each([false, true])("released stage cannot commit or be reactivated (leased=%s)", (leased) => {
    const session = new ReadSession(scope);
    if (leased) issue(session);
    const prepared = session.prepare(leased ? { ...first, continuation: next } : first);
    const staged = prepared.validate({ items: [], next: `${scope}beads/?cursor=later` });
    if (staged.kind !== "success") throw Error("valid control refused");
    prepared.release();
    prepared.release();
    expect(() => prepared.commit(staged.value)).toThrow(ReadSessionLocalError);
    expect(() => prepared.validate({ items: [], next: null })).toThrow(ReadSessionLocalError);
    if (leased) session.prepare({ ...first, continuation: next }).release();
    expect(() =>
      session.prepare({ ...first, continuation: `${scope}beads/?cursor=later` }),
    ).toThrow(ReadSessionLocalError);
  });
  it.each([false, true])(
    "clear invalidates staged work without restoring a stale generation (leased=%s)",
    (leased) => {
      const session = new ReadSession(scope);
      if (leased) issue(session);
      const prepared = session.prepare(leased ? { ...first, continuation: next } : first);
      const staged = prepared.validate({ items: [], next: `${scope}beads/?cursor=later` });
      if (staged.kind !== "success") throw Error("valid control refused");
      session.clear();
      prepared.release();
      expect(() => prepared.commit(staged.value)).toThrow(ReadSessionLocalError);
      expect(() => session.prepare(first)).toThrow(ReadSessionLocalError);
    },
  );
  it("captures response keys during validation and runs no response inspection during commit", () => {
    const session = new ReadSession(scope),
      prepared = session.prepare(first);
    let reads = 0;
    const body = new Proxy(
      { items: [], next },
      {
        ownKeys(target) {
          reads++;
          return Reflect.ownKeys(target);
        },
      },
    );
    const staged = prepared.validate(body);
    if (staged.kind !== "success") throw Error("valid control refused");
    expect(reads).toBeGreaterThan(0);
    const before = reads;
    prepared.commit(staged.value);
    expect(reads).toBe(before);
    expect(Object.isFrozen(staged.value.body)).toBe(true);
  });
});
