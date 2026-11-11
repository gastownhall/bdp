/**
 * The reference, composed with the Callables mechanism. These operations mean nothing: each
 * exists to be a witness for a row of Callables §11. No Issue knowledge. Conditions only.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startReferenceService } from "../packages/server/dist/reference.js";

const recordType = "https://current-provider.invalid/types/WitnessRecord";
export const WITNESS_CALLABLES = Object.freeze([
  {
    name: "witness/echo",
    kind: "query",
    properties: {
      title: "Echo",
      description: "Says back the arguments it ran with.",
      parameters: [
        {
          name: "greeting",
          schema: { type: "string" },
          default: "hello",
          description: "Said back.",
        },
        { name: "note", schema: { type: ["string", "null"] } },
      ],
      resultSchema: { type: "object" },
    },
    implementation: ({ arguments: args }) => ({ result: args }),
  },
  {
    name: "witness/needs-value",
    kind: "query",
    properties: {
      description: "Has one required parameter.",
      parameters: [{ name: "value", schema: { type: "string" }, required: true }],
    },
    implementation: ({ arguments: args }) => ({ result: args.value }),
  },
  {
    name: "witness/unbuilt",
    kind: "query",
    properties: { description: "Reachable, with no implementation.", parameters: [] },
  },
  {
    name: "reserve-room",
    kind: "batch",
    properties: {
      title: "Reserve a room",
      description: "Reserve a room for one day. Reserving a room you already hold changes nothing.",
      idempotent: true,
      atomic: true,
      parameters: [
        {
          name: "room",
          schema: { type: "string", minLength: 1 },
          required: true,
          description: "The room to reserve.",
        },
        {
          name: "day",
          schema: { type: "string", format: "date" },
          required: true,
          description: "The day to reserve it for.",
        },
      ],
      resultSchema: {
        type: "object",
        properties: { reservation: { type: "string" }, already_held: { type: "boolean" } },
        required: ["reservation", "already_held"],
      },
      errorSchema: {
        oneOf: [
          {
            type: "object",
            properties: { reason: { const: "room-closed" } },
            required: ["reason"],
          },
        ],
      },
      cliMapping: { positionals: [{ position: 0, parameter: "room" }] },
    },
    implementation: ({ arguments: args, effects, read, scope }) => {
      if (args.room === "closed") return { error: { reason: "room-closed" } };
      const local = `reservations/${args.room}/${args.day}`;
      if (read(scope + local) !== undefined)
        return { result: { reservation: local, already_held: true } };
      const created = effects.createBead({
        id: local,
        type: recordType,
        properties: {},
        metadata: {},
      });
      return created.status === 200
        ? { result: { reservation: local, already_held: false } }
        : { problem: created };
    },
  },
  {
    name: "witness/fails-after-effects",
    kind: "batch",
    properties: {
      description: "Commits a record, then fails: nothing may remain.",
      atomic: true,
      parameters: [{ name: "id", schema: { type: "string" }, required: true }],
    },
    implementation: ({ arguments: args, effects }) => {
      effects.createBead({
        id: `witness/${args.id}`,
        type: recordType,
        properties: {},
        metadata: {},
      });
      return { error: { reason: "changed its mind" } };
    },
  },
]);

export function provisionReference(extra = {}, witnessExtra = {}) {
  return async function provision({ fixture }) {
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-current-provider-callables-"));
    const scope = `https://current-provider.invalid/${fixture.runId}/`;
    const token = randomBytes(32).toString("base64url");
    const config = {
      directory,
      scope,
      create: true,
      instance: fixture.runId,
      credentials: [{ token, principal: "provider-kit" }],
      callables: { registration: "root", declarations: WITNESS_CALLABLES },
      ...extra,
    };
    let server;
    try {
      server = await startReferenceService(config);
    } catch (failure) {
      await rm(directory, { recursive: true, force: true });
      throw failure;
    }
    const connections = () => [
      {
        origin: new URL(scope).origin,
        connectOrigin: new URL(server.listenUrl).origin,
        authorization: `Bearer ${token}`,
      },
    ];
    return {
      scope,
      connections: connections(),
      conditions: {
        retainedDetailWindowMs: fixture.minimumDetailWindowMs,
        graphRetainedDetailWindowMs: fixture.minimumGraphDetailWindowMs,
        linkFixture: true,
        hierarchicalAliasFixture: true,
      },
      witnesses: {
        // The stabilization plan: "the reference service takes no exceptions".
        takesNoExceptions: true,
        ...witnessExtra,
        callables: {
          unimplemented: "witness/unbuilt",
          batch: {
            name: "reserve-room",
            arguments: { room: `cedar-${fixture.runId}`, day: "2026-11-20" },
          },
          idempotentBatch: {
            name: "reserve-room",
            arguments: { room: `oak-${fixture.runId}`, day: "2026-11-20" },
          },
          callableError: {
            name: "reserve-room",
            arguments: { room: "closed", day: "2026-11-20" },
          },
          atomicProblem: {
            name: "witness/fails-after-effects",
            arguments: { id: fixture.runId },
          },
        },
      },
      async restart() {
        await server.close();
        server = await startReferenceService({ ...config, create: false });
        return { connections: connections() };
      },
      async cleanup() {
        const errors = [];
        try {
          await server.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          await rm(directory, { recursive: true, force: true });
        } catch (error) {
          errors.push(error);
        }
        if (errors.length) throw new AggregateError(errors, "Reference adapter cleanup failed");
      },
    };
  };
}
/** The reference with the mechanism only: no Issue package. */
export const provision = provisionReference();
/** And with the Issue Types enforced, for the IT rows. */
export const provisionWithIssuePackage = provisionReference(
  { issuePackage: true },
  { issuePackage: true },
);
