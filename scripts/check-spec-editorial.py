#!/usr/bin/env python3
"""Fast structural checks for the canonical specification editorial workflow.

This checks documents, not implementation conformance or protocol semantics.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
# The canonical human reference in the v0.2.3 layout is the GENERATED Markdown
# (emitted from specs/src/core/core.lumen) plus the CLI design doc. The old
# per-profile documents are retired to docs/history/ (see check-generated.py for the
# src -> generated drift/consistency gate that makes the generated reference load-bearing).
CANONICAL = (
    "specs/generated/core.md",
    "docs/cli-design/bdp-cli.md",
)
ENTRY_POINTS = ("README.md", "specs/README.md", "docs/spec-review/README.md")
AUTHORING_DOCS = (
    "specs/formats/README.md", "specs/formats/markdown-openapi.md",
    "specs/formats/markdown-type-definitions.md",
)
EDITORIAL_TOOLING = {
    # `.github/workflows/ci.yml` is DELIBERATELY ABSENT. It used to be here, which made a
    # workflow-only change classify editorial and so SKIP `implementation` and `regression`
    # — the file that decides which lanes run was on the list of files that skip them, and
    # `verify` passed because the skip matched the verdict. A change to the lane definitions
    # is exactly when the lanes must run. (`check-spec-editorial.py` below is self-listed too,
    # but the always-on `specification` job runs both it and its test, so it is self-guarded;
    # nothing tests a workflow file.)
    "scripts/check-spec-editorial.py",
    "scripts/check-spec-editorial-test.py",
}
# Retired protocol modules have exact paths, now under docs/history/. A canonical
# or authoring document must not cite them as current authority. CLI companions may
# legitimately share a filename (for example events.md) without being a retired module.
SUPERSEDED = {
    *("docs/history/profiles/core/" + name for name in (
        "retained-core.md", "contract-binding.md", "affiliations.md",
        "read-delivery.md", "resource-projection.md", "publication.md",
        "events.md", "type-definition-read.md",
    )),
    *("docs/history/profiles/write/" + name for name in (
        "retained-write.md", "object-edits.md", "link-updates.md",
        "atomic-batch.md", "id-root.md",
    )),
    *("docs/history/profiles/types/" + name for name in (
        "types-binding.md", "exact-definition-read.md",
        "intrinsic-publication.md", "intrinsic-publication-2.md",
    )),
    "docs/history/types/type-system/type-system.md",
}
EDITORIAL_FILES = {
    *ENTRY_POINTS,
    "CONTEXT.md",
    "docs/cli-design/overview/examples/csv-failure.sh",
    "docs/cli-design/overview/examples/csv-review.sh",
}
EDITORIAL_PREFIXES = (
    "specs/formats/",
    "docs/history/",
    "docs/spec-review/",
    "docs/cli-design/", "docs/design/", "docs/releases/",
)
LINK = re.compile(r"!?\[[^\]\n]*\]\((<?[^\s)]+>?)(?:\s+\"[^\"]*\")?\)")
REFERENCE = re.compile(r"\[([^\]\n]+)\]\[([^\]\n]*)\]")
DEFINITION = re.compile(r'^ {0,3}\[([^\]\n]+)\]:\s*(<[^>\n]+>|\S+)(?:\s+[\"\'\(].*)?$')


def editorial_path(path):
    if path in EDITORIAL_TOOLING or path in EDITORIAL_FILES:
        return True
    return (path.endswith(".md") and not path.endswith(".schema.md")
            and path.startswith(EDITORIAL_PREFIXES))


def changed_paths(base, head):
    raw = subprocess.check_output([
        "git", "diff", "--name-only", "--no-renames", "-z", base, head, "--"
    ], cwd=ROOT)
    return [p.decode("utf-8") for p in raw.split(b"\0") if p]


def editorial_change(base, head):
    # Specification-editorial change = every changed path is an editorial document
    # or the small set of editorial tooling/entry files, AND none is a symlink,
    # binary or otherwise non-plain-text file masquerading as an editorial doc
    # (which could smuggle a product change past the implementation/regression lanes).
    # The retired v0.1 schema-ownership fast-path is gone with the v0.1 toolchain:
    # any schema, package.json or product change now runs the full lanes.
    paths = changed_paths(base, head)
    if not paths or not all(editorial_path(p) for p in paths):
        return False
    for path in paths:
        found = False
        for revision in (base, head):
            entry = subprocess.check_output([
                "git", "--literal-pathspecs", "ls-tree", "-z", revision, "--", path
            ], cwd=ROOT)
            if not entry:
                continue
            found = True
            mode, kind, oid = entry.split(b"\t", 1)[0].split()
            if mode != b"100644" or kind != b"blob":
                return False
            body = subprocess.check_output(["git", "cat-file", "blob", oid], cwd=ROOT)
            if b"\0" in body:
                return False
            try:
                body.decode("utf-8")
            except UnicodeDecodeError:
                return False
        if not found:
            raise ValueError(f"cannot inspect changed path {path!r}")
    return True


def parse_document(text):
    prose = []
    examples = []
    comments = []
    comment = None
    fence = None
    language = ""
    body = []
    start = 0
    schema_fragment = None
    for number, line in enumerate(text.splitlines(), 1):
        if fence is not None:
            if re.match(r"^\s{0,3}" + re.escape(fence[0]) + "{" + str(len(fence)) + r",}\s*$", line):
                if language == "json":
                    examples.append((start, "\n".join(body)))
                fence = None
            else:
                body.append(line)
            continue
        marker = re.fullmatch(r"<!-- bdp-schema:(start|end) ([A-Za-z][A-Za-z0-9]*)(?: bundle=([a-z][a-z-]*))? -->", line)
        if comment is None and marker:
            action, name, bundle = marker.groups()
            name = (bundle or "common") + ":" + name
            if action == "start":
                if schema_fragment is not None:
                    raise ValueError(f"nested schema fragment at line {number}")
                schema_fragment = name
            else:
                if schema_fragment != name:
                    raise ValueError(f"unmatched schema fragment at line {number}")
                schema_fragment = None
        # HTML review comments are not rendered Markdown. Inline code and fenced
        # examples retain their literal contents, including comment-like strings.
        visible = []
        ticks = 0
        index = 0
        while index < len(line):
            if comment is not None:
                end = line.find("-->", index)
                if end < 0:
                    comment.append(line[index:] + "\n")
                    break
                comment.append(line[index:end])
                comments.append("".join(comment))
                comment = None
                index = end + 3
            elif not ticks and line.startswith("<!--", index):
                comment = []
                index += 4
            elif line[index] == "`":
                run = re.match(r"`+", line[index:]).group()
                if not ticks:
                    ticks = len(run)
                elif len(run) == ticks:
                    ticks = 0
                visible.append(run)
                index += len(run)
            else:
                visible.append(line[index])
                index += 1
        clean = "".join(visible)
        opening = re.match(r"^\s{0,3}(`{3,}|~{3,})(.*)$", clean)
        if opening:
            fence = opening.group(1)
            language = opening.group(2).strip().split(" ")[0]
            body = []
            start = number
        else:
            # The schema codec validates literal DSL cells. JSON pattern and
            # annotation strings inside them are not Markdown link syntax.
            # Keep headings for ordinary incoming fragment-anchor checks.
            prose.append(clean if schema_fragment is None or re.match(r"^#{1,6} ", clean) else "")
    if fence is not None:
        raise ValueError(f"unclosed code fence at line {start}")
    if comment is not None:
        raise ValueError("unclosed HTML comment")
    if schema_fragment is not None:
        raise ValueError(f"unclosed schema fragment {schema_fragment}")
    return "\n".join(prose), examples, comments


def prose_and_json(text):
    prose, examples, _ = parse_document(text)
    return prose, examples


def link_addresses(prose):
    def label(text):
        return " ".join(text.split()).casefold()

    definitions = {}
    visible = []
    for line in prose.splitlines():
        definition = DEFINITION.match(line)
        if definition:
            key = label(definition.group(1))
            if key in definitions:
                raise ValueError(f"duplicate Markdown link definition {key!r}")
            definitions[key] = definition.group(2).strip("<>")
        else:
            visible.append(line)
    text = re.sub(r"`+[^`]*`+", "", "\n".join(visible))
    addresses = [m.group(1).strip("<>") for m in LINK.finditer(text)]
    text = LINK.sub("", text)
    for match in REFERENCE.finditer(text):
        key = label(match.group(2) or match.group(1))
        if key not in definitions:
            raise ValueError(f"undefined Markdown link reference {key!r}")
        addresses.append(definitions[key])
    text = REFERENCE.sub("", text)
    for match in re.finditer(r"\[([^\]\n]+)\]", text):
        key = label(match.group(1))
        if key in definitions:
            addresses.append(definitions[key])
    return addresses


def anchors(text):
    prose, _ = prose_and_json(text)
    found = set(re.findall(r'<a\s+(?:id|name)=[\"\']([^\"\']+)', prose))
    counts = {}
    for line in prose.splitlines():
        heading = re.match(r"^#{1,6}\s+(.+?)(?:\s+#+)?$", line)
        if not heading:
            continue
        label = re.sub(r"<[^>]+>", "", heading.group(1)).lower()
        slug = re.sub(r"[^\w\- ]", "", label).replace(" ", "-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        found.add(slug if count == 0 else f"{slug}-{count}")
    return found


def strict_json(text, preserve_numbers=False):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate object member {key!r}")
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError(f"non-JSON numeric constant {value}")

    numbers = {"parse_int": lambda token: ("number", token),
               "parse_float": lambda token: ("number", token)} if preserve_numbers else {}
    return json.loads(text, object_pairs_hook=unique_object,
                      parse_constant=invalid_constant, **numbers)


def check_documents():
    failures = []
    checked_json = 0
    comments = 0
    documents = (*CANONICAL, *ENTRY_POINTS, *AUTHORING_DOCS)
    for relative in documents:
        path = ROOT / relative
        if not path.is_file():
            failures.append(f"{relative}: missing document")
            continue
        text = path.read_text(encoding="utf-8")
        try:
            prose, examples, review_comments = parse_document(text)
            addresses = link_addresses(prose)
        except ValueError as error:
            failures.append(f"{relative}: {error}")
            continue
        if not re.search(r"^# .+", prose, re.MULTILINE):
            failures.append(f"{relative}: missing document title")
        if relative in CANONICAL:
            comments += sum(bool(re.match(r"\s*Donna\b", c, re.IGNORECASE))
                            for c in review_comments)
        for line, example in examples:
            try:
                strict_json(example)
                checked_json += 1
            except ValueError as error:
                failures.append(f"{relative}:{line}: invalid JSON example: {error}")
        for address in addresses:
            url = urlsplit(address)
            if url.scheme or url.netloc:
                continue
            target = (path.parent / unquote(url.path)).resolve() if url.path else path
            if not target.is_relative_to(ROOT):
                failures.append(f"{relative}: link escapes repository: {address}")
                continue
            if not target.exists():
                failures.append(f"{relative}: missing link target: {address}")
                continue
            if relative in (*CANONICAL, *AUTHORING_DOCS) and target.relative_to(ROOT).as_posix() in SUPERSEDED:
                failures.append(f"{relative}: links to superseded rule module: {address}")
            if url.fragment and target.suffix == ".md":
                try:
                    if unquote(url.fragment) not in anchors(target.read_text(encoding="utf-8")):
                        failures.append(f"{relative}: missing heading: {address}")
                except ValueError as error:
                    failures.append(f"{relative}: target {address}: {error}")
    for failure in failures:
        print(failure, file=sys.stderr)
    if failures:
        return 1
    print(f"Editorial structure passed: {len(documents)} documents, {checked_json} JSON examples.")
    print(f"Donna comment markers retained: {comments}. Comments require human processing, not automatic acceptance.")
    print("This is not protocol-semantic, schema-conformance, implementation or release qualification.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--classify", nargs=2, metavar=("BASE", "HEAD"))
    args = parser.parse_args()
    if args.classify:
        print("true" if editorial_change(*args.classify) else "false")
        return 0
    return check_documents()


if __name__ == "__main__":
    sys.exit(main())
