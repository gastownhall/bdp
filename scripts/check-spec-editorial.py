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
CANONICAL = (
    "specs/profiles/core/core.md",
    "specs/profiles/write/write.md",
    "specs/profiles/types/types.md",
    "specs/profiles/transfer/transfer.md",
    "docs/cli-design/bdp-cli.md",
)
ENTRY_POINTS = ("README.md", "specs/README.md", "docs/spec-review/README.md")
EDITORIAL_TOOLING = {
    ".github/workflows/ci.yml", "scripts/check-spec-editorial.py",
    "scripts/check-spec-editorial-test.py", "scripts/spec-schema-fragments.mjs",
    "scripts/spec-schema-fragments.node-test.mjs",
}
CORE_BUNDLES = {
    "specs/profiles/core/bdp-v0.1.schema.json",
    "packages/protocol/schemas/bdp-v0.1.schema.json",
}
CORE_OWNERSHIP = "x-bdp-core-definitions"
EDITORIAL_FILES = {
    *ENTRY_POINTS,
    "CONTEXT.md", "package.json", *CORE_BUNDLES,
    "specs/profiles/core/bdp-v0.1.schema.md",
    "docs/cli-design/overview/examples/csv-failure.sh",
    "docs/cli-design/overview/examples/csv-review.sh",
}
EDITORIAL_PREFIXES = (
    "specs/profiles/core/",
    "specs/profiles/write/",
    "specs/profiles/types/",
    "specs/profiles/transfer/",
    "specs/types/type-system/",
    "specs/history/",
    "docs/spec-review/",
    "docs/cli-design/", "docs/design/", "docs/releases/", "specs/openapi/",
)
# Retired protocol modules have exact paths. CLI companions may legitimately
# share a filename (for example events.md) without being a retired protocol.
SUPERSEDED = {
    *("specs/profiles/core/" + name for name in (
        "retained-core.md", "contract-binding.md", "affiliations.md",
        "read-delivery.md", "resource-projection.md", "publication.md",
        "events.md", "type-definition-read.md",
    )),
    *("specs/profiles/write/" + name for name in (
        "retained-write.md", "object-edits.md", "link-updates.md",
        "atomic-batch.md", "id-root.md",
    )),
    *("specs/profiles/types/" + name for name in (
        "types-binding.md", "exact-definition-read.md",
        "intrinsic-publication.md", "intrinsic-publication-2.md",
    )),
    "specs/types/type-system/type-system.md",
}
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
    paths = changed_paths(base, head)
    if not paths or not all(editorial_path(p) for p in paths):
        return False
    for path in paths:
        found = False
        bodies = {}
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
            bodies[revision] = body.decode("utf-8")
        if not found:
            raise ValueError(f"cannot inspect changed path {path!r}")
        # These are narrowly checked specification distributions/tool wiring,
        # not a path exemption for arbitrary schema or dependency changes.
        if path == "package.json" or path in CORE_BUNDLES:
            if base not in bodies or head not in bodies:
                return False
            try:
                before = strict_json(bodies[base], preserve_numbers=True)
                after = strict_json(bodies[head], preserve_numbers=True)
                if path == "package.json":
                    if not editorial_package_change(before, after):
                        return False
                elif not editorial_core_change(before, after):
                    return False
            except (ValueError, TypeError, KeyError):
                return False
    # Both distributions must exist and agree. The required specification job
    # separately checks their definitions against visible Core fragments.
    if CORE_BUNDLES.intersection(paths):
        bundles = [strict_json(subprocess.check_output(
            ["git", "show", f"{head}:{path}"], cwd=ROOT).decode("utf-8"),
            preserve_numbers=True) for path in sorted(CORE_BUNDLES)]
        if bundles[0] != bundles[1]:
            return False
    return True


def editorial_package_change(before, after):
    before = dict(before)
    after = dict(after)
    old_scripts = dict(before.pop("scripts"))
    new_scripts = dict(after.pop("scripts"))
    old = old_scripts.pop("test:markdown")
    new = new_scripts.pop("test:markdown")
    return (before == after and old_scripts == new_scripts
            and new in (old, old + " scripts/spec-schema-fragments.node-test.mjs"))


def editorial_core_change(before, after):
    before = dict(before)
    after = dict(after)
    old_owned = before.pop(CORE_OWNERSHIP, [])
    new_owned = after.pop(CORE_OWNERSHIP)
    if not isinstance(old_owned, list) or not isinstance(new_owned, list):
        return False
    if not all(isinstance(name, str) for name in old_owned + new_owned):
        return False
    if len(set(new_owned)) != len(new_owned) or not set(old_owned) <= set(new_owned):
        return False
    old_defs = dict(before.pop("$defs"))
    new_defs = dict(after.pop("$defs"))
    if not set(new_owned) <= new_defs.keys():
        return False
    for name in new_owned:
        old_defs.pop(name, None)
        new_defs.pop(name)
    # The already reviewed optional-Events correction is the sole non-Core
    # exception in this baseline. Any other Write schema edit needs alignment.
    old_write = old_defs.get("writeDiscovery")
    new_write = new_defs.get("writeDiscovery")
    if isinstance(old_write, dict) and isinstance(new_write, dict):
        expected = dict(old_write)
        required = expected.get("required")
        if isinstance(required, list) and "events" in required:
            expected["required"] = [name for name in required if name != "events"]
            if new_write == expected:
                old_defs.pop("writeDiscovery")
                new_defs.pop("writeDiscovery")
    return before == after and old_defs == new_defs


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
        marker = re.fullmatch(r"<!-- bdp-schema:(start|end) ([A-Za-z][A-Za-z0-9]*) -->", line)
        if comment is None and marker:
            action, name = marker.groups()
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
    documents = (*CANONICAL, *ENTRY_POINTS)
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
            if relative in CANONICAL and target.relative_to(ROOT).as_posix() in SUPERSEDED:
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
