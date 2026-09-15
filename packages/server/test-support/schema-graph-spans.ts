import { decodeJsonDocument } from "@bdp/protocol";
/** Test-only lexical span extractor. Validates syntax losslessly, never parses a schema number. */
export function schemaSpans(text: string): readonly { start: number; end: number; text: string }[] {
  decodeJsonDocument(text);
  let at = 0;
  const whitespace = (): void => {
    while (at < text.length && /\s/.test(text[at] as string)) at++;
  };
  const token = (): { start: number; end: number; kind: string } => {
    whitespace();
    const start = at;
    const first = text[at++];
    if (first === '"') {
      while (at < text.length) {
        const c = text[at++];
        if (c === "\\") at++;
        else if (c === '"') break;
      }
    } else if (first !== undefined && !"{}[]:,".includes(first)) {
      while (at < text.length && !/[\s,}\]]/.test(text[at] as string)) at++;
    }
    return { start, end: at, kind: first ?? "" };
  };
  const spans = [];
  let depth = 0;
  while (at < text.length) {
    const t = token();
    if (t.kind === "{" || t.kind === "[") depth++;
    else if (t.kind === "}" || t.kind === "]") depth--;
    else if (depth === 2 && t.kind === '"') {
      whitespace();
      if (text[at] !== ":" || JSON.parse(text.slice(t.start, t.end)) !== "schema") continue;
      at++;
      const first = token();
      let nesting = first.kind === "{" || first.kind === "[" ? 1 : 0;
      let end = first.end;
      while (nesting > 0) {
        const next = token();
        if (next.kind === "{" || next.kind === "[") nesting++;
        if (next.kind === "}" || next.kind === "]") nesting--;
        end = next.end;
      }
      spans.push({ start: first.start, end, text: text.slice(first.start, end) });
    }
  }
  return spans;
}

/** Original data spans for /group/tests/case/data, including scalar numbers.
 * Test-only bounded lexical scan; no instance numeric conversion/serialization. */
export function instanceSpans(
  text: string,
): readonly { group: number; case: number; start: number; end: number; text: string }[] {
  if (Buffer.byteLength(text) > 16_777_216) throw new Error("corpus span bound");
  decodeJsonDocument(text);
  let at = 0;
  const space = () => {
    while (at < text.length && " \r\n\t".includes(text[at] as string)) at++;
  };
  const quoted = () => {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === "\\") at++;
      else if (c === '"') break;
    }
    return JSON.parse(text.slice(start, at)) as string;
  };
  type Role = "root" | "group" | "tests" | "case" | "other";
  type Frame = {
    array: boolean;
    role: Role;
    group: number;
    case: number;
    index: number;
    after: boolean;
    start: number;
    capture: boolean;
  };
  const frames: Frame[] = [],
    out: { group: number; case: number; start: number; end: number; text: string }[] = [];
  const value = (role: Role, group: number, index: number, capture: boolean): void => {
    space();
    const start = at,
      c = text[at];
    if (c === "[" || c === "{") {
      at++;
      frames.push({
        array: c === "[",
        role,
        group,
        case: index,
        index: 0,
        after: false,
        start,
        capture,
      });
      return;
    }
    if (c === '"') quoted();
    else while (at < text.length && !"/ \t\r\n,]}".includes(text[at] as string)) at++;
    if (capture) out.push({ group, case: index, start, end: at, text: text.slice(start, at) });
  };
  value("root", -1, -1, false);
  while (frames.length) {
    const f = frames[frames.length - 1] as Frame;
    space();
    if (text[at] === (f.array ? "]" : "}")) {
      at++;
      frames.pop();
      if (f.capture)
        out.push({
          group: f.group,
          case: f.case,
          start: f.start,
          end: at,
          text: text.slice(f.start, at),
        });
      continue;
    }
    if (f.after) {
      if (text[at++] !== ",") throw new Error("corpus separator");
      space();
    }
    f.after = true;
    if (f.array) {
      const i = f.index++;
      value(
        f.role === "root" ? "group" : f.role === "tests" ? "case" : "other",
        f.role === "root" ? i : f.group,
        f.role === "tests" ? i : f.case,
        false,
      );
    } else {
      const key = quoted();
      space();
      if (text[at++] !== ":") throw new Error("corpus colon");
      value(
        f.role === "group" && key === "tests" ? "tests" : "other",
        f.group,
        f.case,
        f.role === "case" && key === "data",
      );
    }
  }
  return out;
}
