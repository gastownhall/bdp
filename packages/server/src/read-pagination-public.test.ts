import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, expectTypeOf, it } from "vitest";
import type { createReadPagination } from "./index.js";

type PublicPagination = ReturnType<typeof createReadPagination>;
type PublicInput = Parameters<PublicPagination["firstPage"]>[0];

it("keeps the public pagination types free of source-context capability", () => {
  expectTypeOf<keyof PublicPagination>().toEqualTypeOf<
    "limits" | "validateLimit" | "firstPage" | "continuePage" | "cleanupExpired" | "close"
  >();
  expectTypeOf<"sourceContext" extends keyof PublicInput ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<Parameters<PublicPagination["firstPage"]>["length"]>().toEqualTypeOf<1>();
  expectTypeOf<
    "createContextualReadPagination" extends keyof typeof import("./index.js") ? true : false
  >().toEqualTypeOf<false>();
});

it("ignores public context properties/extra arguments through the actual emitted package root", () => {
  const script = `
    import assert from 'node:assert/strict';
    import * as server from '@bdp/server';
    assert.equal('createContextualReadPagination' in server, false);
    const pagination = server.createReadPagination({
      scope:'https://example.test/s/', defaultPageItems:1, maxPageItems:2,
      cursorTtlMs:1000, retainedStateCapacity:10, maxRetainedCursorPositionsPerSnapshot:5,
      retainedSnapshotByteCapacity:5, retainedSnapshotNodeCapacity:3,
      maxOpaqueTokenLength:40, tokenGenerationAttempts:2, idleCleanup:'on-demand',
      clock:()=>0, generateOpaqueToken:()=> 'cursor'
    });
    assert.deepEqual(Object.keys(pagination).sort(), ['cleanupExpired','close','continuePage','firstPage','limits','validateLimit']);
    let getterCalls = 0, traps = 0;
    const input = {items:[1,2], authorizationView:'v', scopeEpoch:'e', projection:'p', continuationUrl:'https://example.test/s/beads/'};
    Object.defineProperty(input, 'sourceContext', {enumerable:true, get(){getterCalls++; throw Error('context getter called');}});
    const extra = new Proxy({}, {ownKeys(){traps++; throw Error('context trap called');}});
    const first = Reflect.apply(pagination.firstPage, pagination, [input, extra]);
    assert.deepEqual(first.items,[1]);
    const second = pagination.continuePage({authorizationView:'v',scopeEpoch:'e',projection:'p',token:new URL(first.next).searchParams.get('cursor')});
    assert.deepEqual(second, {items:[2],next:null});
    assert.equal(getterCalls,0); assert.equal(traps,0);
    assert.equal(pagination.sourceContext,undefined);
    assert.equal(pagination.firstPageWithContext,undefined);
    pagination.close();
    for (const specifier of ['@bdp/server/read-pagination','@bdp/server/dist/read-pagination.js']) {
      await assert.rejects(import(specifier), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    }
    process.stdout.write('public pagination boundary passed');
  `;
  expect(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      timeout: 10_000,
      encoding: "utf8",
    }),
  ).toBe("public pagination boundary passed");
});
