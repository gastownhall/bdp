export interface LinkHeaderParameter {
  readonly name: string;
  readonly value: string;
  readonly quoted: boolean;
}

export interface LinkHeaderValue {
  readonly target: string;
  readonly parameters: readonly LinkHeaderParameter[];
}

/**
 * Parses the syntax needed to consume an RFC 8288 Link field while preserving
 * parameter order and duplicates for caller-owned policy decisions.
 */
export function parseLinkHeader(value: string): readonly LinkHeaderValue[] {
  const links: LinkHeaderValue[] = [];
  for (const fieldValue of splitOutsideQuotedString(value, ",", true)) {
    const target = /^\s*<([^>]*)>/.exec(fieldValue);
    if (target?.[1] === undefined) continue;

    const parameters: LinkHeaderParameter[] = [];
    for (const part of splitOutsideQuotedString(fieldValue.slice(target[0].length), ";", false)) {
      const separator = part.indexOf("=");
      if (separator < 0) continue;
      const name = part.slice(0, separator).trim().toLowerCase();
      if (name.length === 0 || /\s/.test(name)) continue;
      const parsed = parseParameterValue(part.slice(separator + 1).trim());
      if (parsed === undefined) continue;
      parameters.push(Object.freeze({ name, ...parsed }));
    }
    links.push(
      Object.freeze({
        target: target[1],
        parameters: Object.freeze(parameters),
      }),
    );
  }
  return Object.freeze(links);
}

function parseParameterValue(
  value: string,
): { readonly value: string; readonly quoted: boolean } | undefined {
  if (!value.startsWith('"')) {
    if (value.length === 0 || /[\s"]/.test(value)) return undefined;
    return { value, quoted: false };
  }
  if (!value.endsWith('"')) return undefined;

  let decoded = "";
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];
    if (character === "\\" && index + 1 < value.length - 1) {
      decoded += value[index + 1];
      index += 1;
    } else {
      decoded += character;
    }
  }
  return { value: decoded, quoted: true };
}

function splitOutsideQuotedString(
  value: string,
  delimiter: "," | ";",
  trackAngles: boolean,
): readonly string[] {
  const values: string[] = [];
  let start = 0;
  let quoted = false;
  let angle = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && !isEscaped(value, index)) quoted = !quoted;
    else if (trackAngles && !quoted && character === "<") angle = true;
    else if (trackAngles && !quoted && character === ">") angle = false;
    else if (!quoted && !angle && character === delimiter) {
      values.push(value.slice(start, index));
      start = index + 1;
    }
  }
  values.push(value.slice(start));
  return values;
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}
