/** Internal index for the ATX headings and standalone anchors used by our specs. */
export interface MarkdownAnchor {
  anchor: string;
  index: number;
  end: number;
  level: number;
  title?: string;
  aliasOf?: string;
}

export function markdownAnchors(markdown: string): MarkdownAnchor[] {
  const visible = maskFencedCodeBlocks(markdown);
  const headings: MarkdownAnchor[] = [];
  const used = new Set<string>();
  for (const match of visible.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const title = match[2];
    const hashes = match[1];
    if (title === undefined || hashes === undefined) continue;
    // GitHub preserves each space after punctuation removal (e.g. "I — Read").
    const base = title
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/ /g, "-");
    let slug = base;
    let suffix = 0;
    while (used.has(slug)) slug = `${base}-${++suffix}`;
    used.add(slug);
    headings.push({
      anchor: `#${slug}`,
      index: match.index,
      end: markdown.length,
      level: hashes.length,
      title,
    });
  }
  for (const [index, heading] of headings.entries())
    heading.end =
      headings.slice(index + 1).find((next) => next.level <= heading.level)?.index ??
      markdown.length;

  const explicit: MarkdownAnchor[] = [];
  for (const match of visible.matchAll(/^ *<a\s+(?:id|name)=["']([^"']+)["']\s*><\/a> *$/gm)) {
    const next = headings.find((heading) => heading.index > match.index);
    // A standalone alias immediately before a heading names that whole section.
    // An interior anchor starts at itself and ends at the next heading, so it
    // cannot acquire unrelated text from later sections.
    const aliasesHeading =
      next !== undefined && markdown.slice(match.index + match[0].length, next.index).trim() === "";
    explicit.push({
      anchor: `#${match[1]}`,
      index: match.index,
      end: aliasesHeading ? next.end : (next?.index ?? markdown.length),
      level: aliasesHeading ? next.level : 0,
      ...(aliasesHeading ? { aliasOf: next.anchor } : {}),
    });
  }
  const result = [...headings, ...explicit].sort((left, right) => left.index - right.index);
  const anchors = new Set<string>();
  for (const entry of result) {
    if (anchors.has(entry.anchor)) throw new Error(`Ambiguous Markdown anchor: ${entry.anchor}`);
    anchors.add(entry.anchor);
  }
  return result;
}

export function markdownSection(markdown: string, anchor: string): string | undefined {
  const section = markdownAnchors(markdown).find((entry) => entry.anchor === anchor);
  return section === undefined ? undefined : markdown.slice(section.index, section.end);
}

/**
 * Replace fenced-code content with spaces while retaining every original line
 * ending and code-unit offset. A closing fence must use the opening character
 * and contain at least as many markers.
 */
function maskFencedCodeBlocks(markdown: string): string {
  let result = "";
  let cursor = 0;
  let fenceCharacter: "`" | "~" | undefined;
  let minimumFenceLength = 0;

  while (cursor < markdown.length) {
    const newline = markdown.indexOf("\n", cursor);
    const lineEnd = newline < 0 ? markdown.length : newline + 1;
    const line = markdown.slice(cursor, lineEnd);
    const content = line.replace(/\r?\n$/, "");

    if (fenceCharacter === undefined) {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(content)?.[1];
      if (opening === undefined) {
        result += line;
      } else {
        fenceCharacter = opening[0] as "`" | "~";
        minimumFenceLength = opening.length;
        result += maskLine(line);
      }
    } else {
      const closing = new RegExp(`^ {0,3}\\${fenceCharacter}{${minimumFenceLength},}[ \\t]*$`).test(
        content,
      );
      result += maskLine(line);
      if (closing) {
        fenceCharacter = undefined;
        minimumFenceLength = 0;
      }
    }
    cursor = lineEnd;
  }

  return result;
}

function maskLine(line: string): string {
  return line.replace(/[^\r\n]/g, " ");
}
