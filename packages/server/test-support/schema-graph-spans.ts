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
