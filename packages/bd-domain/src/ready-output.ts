import type { ReadyBead } from "./index.js";

export class ReadyOutputCompatibilityError extends Error {
  readonly code = "ready-output-incompatible";

  constructor(message: string) {
    super(message);
    this.name = "ReadyOutputCompatibilityError";
  }
}

export function renderReadyJson(results: readonly ReadyBead[]): string {
  return `${JSON.stringify(results.map(({ bead }) => projectBdReadyRecord(bead.properties)))}\n`;
}

export function renderReadyText(results: readonly ReadyBead[]): string {
  return results.length === 0
    ? ""
    : `${results
        .map(({ bead }) => {
          const title = bead.properties.title;
          return typeof title === "string" && !/[\p{Cc}\p{Cf}]/u.test(title) ? title : bead.id;
        })
        .join("\n")}\n`;
}

function projectBdReadyRecord(
  properties: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const dependencies = properties.dependencies;
  const status = optionalString(properties, "status");
  const issueType = optionalString(properties, "issue_type");
  const owner = optionalString(properties, "owner");
  const createdBy = optionalString(properties, "created_by");
  return {
    id: requiredLocalId(properties, "id"),
    title: requiredString(properties, "title"),
    ...(status === undefined ? {} : { status }),
    priority: requiredInteger(properties, "priority"),
    ...(issueType === undefined ? {} : { issue_type: issueType }),
    ...(owner === undefined ? {} : { owner }),
    created_at: requiredTimestamp(properties, "created_at"),
    ...(createdBy === undefined ? {} : { created_by: createdBy }),
    updated_at: requiredTimestamp(properties, "updated_at"),
    ...(dependencies === undefined ? {} : { dependencies: projectDependencies(dependencies) }),
    dependency_count: requiredNonnegativeInteger(properties, "dependency_count"),
    dependent_count: requiredNonnegativeInteger(properties, "dependent_count"),
    comment_count: requiredNonnegativeInteger(properties, "comment_count"),
  };
}

function projectDependencies(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw compatibilityError("dependencies", "an array");
  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) throw compatibilityError(`dependencies[${index}]`, "a plain object");
    const context = `dependencies[${index}]`;
    return {
      issue_id: requiredLocalId(entry, "issue_id", context),
      depends_on_id: requiredLocalId(entry, "depends_on_id", context),
      type: requiredNonemptyString(entry, "type", context),
      created_at: requiredTimestamp(entry, "created_at", context),
      created_by: requiredString(entry, "created_by", context),
      metadata: requiredString(entry, "metadata", context),
    };
  });
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  context = "properties",
): string {
  const value = record[key];
  if (typeof value !== "string") throw compatibilityError(`${context}.${key}`, "a string");
  return value;
}

function requiredNonemptyString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  context = "properties",
): string {
  const value = requiredString(record, key, context);
  if (value.length === 0) throw compatibilityError(`${context}.${key}`, "a non-empty string");
  return value;
}

function requiredLocalId(
  record: Readonly<Record<string, unknown>>,
  key: string,
  context = "properties",
): string {
  const value = requiredNonemptyString(record, key, context);
  if (/[\p{Cc}\p{Cf}\s]/u.test(value))
    throw compatibilityError(`${context}.${key}`, "a whitespace-free local ID");
  return value;
}

function requiredInteger(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw compatibilityError(`properties.${key}`, "a safe integer");
  return value;
}

function requiredNonnegativeInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const value = requiredInteger(record, key);
  if (value < 0) throw compatibilityError(`properties.${key}`, "a non-negative safe integer");
  return value;
}

function requiredTimestamp(
  record: Readonly<Record<string, unknown>>,
  key: string,
  context = "properties",
): string {
  const value = requiredString(record, key, context);
  const timestamp = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw compatibilityError(`${context}.${key}`, "a canonical ISO timestamp");
  return value;
}

function optionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw compatibilityError(`properties.${key}`, "a string");
  return value;
}

function compatibilityError(field: string, expected: string): ReadyOutputCompatibilityError {
  return new ReadyOutputCompatibilityError(
    `bd ready compatibility field ${field} must be ${expected}`,
  );
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
