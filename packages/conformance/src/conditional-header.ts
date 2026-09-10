/** Restricted reuse of a validator observed earlier in this scenario, never a generic capture. */
export interface ScenarioConditionalHeader {
  readonly etagFrom: string;
  readonly form: "exact" | "weak" | "nonmatching" | "exact-list" | "weak-list";
}

export const CONDITIONAL_HEADER_FORMS: ReadonlySet<string> = new Set([
  "exact",
  "weak",
  "nonmatching",
  "exact-list",
  "weak-list",
]);

/** A target supplied no usable validator; distinct from an invalid manifest reference. */
export class ObservedEntityTagError extends Error {
  constructor() {
    super("earlier response must contain exactly one valid ETag");
    this.name = "ObservedEntityTagError";
  }
}

/** Entity tags are opaque HTTP bytes: backslashes are not JSON escapes. */
export function observedEntityTag(value: string | undefined): string {
  if (value === undefined || !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value))
    throw new ObservedEntityTagError();
  return value;
}

export function resolveScenarioHeaders(
  headers: Readonly<Record<string, string | ScenarioConditionalHeader>>,
  responses: ReadonlyMap<string, { readonly headers: Readonly<Record<string, string>> }>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      if (typeof value === "string") return [name, value];
      if (name !== "if-match" && name !== "if-none-match")
        throw new Error("observed ETag reuse is restricted to conditional request fields");
      const previous = responses.get(value.etagFrom);
      if (previous === undefined)
        throw new Error("conditional header requires an earlier response");
      const tag = observedEntityTag(previous.headers.etag);
      const opaque = tag.startsWith("W/") ? tag.slice(2) : tag;
      // Appending an allowed byte guarantees a different opaque tag, even for an empty tag.
      const nonmatching = `${opaque.slice(0, -1)}!"`;
      switch (value.form) {
        case "exact":
          return [name, tag];
        case "weak":
          return [name, `W/${opaque}`];
        case "nonmatching":
          return [name, nonmatching];
        case "exact-list":
          return [name, `${nonmatching}, ${tag}`];
        case "weak-list":
          return [name, `${nonmatching}, W/${opaque}`];
        default:
          throw new Error("unknown conditional ETag form");
      }
    }),
  );
}
