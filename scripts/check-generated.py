#!/usr/bin/env python3
"""Gate: specs/generated must be current with specs/src, and valid.

Regenerates every artifact from specs/src and fails if the committed output differs
(drift), or if any generated JSON is malformed or carries an unresolved $ref. This
makes the generator the single source of truth for specs/generated/ — editing a
Lumen source without regenerating, or hand-editing a generated file, fails the gate.

Not protocol-semantic or implementation conformance; a structural/consistency check.
"""
import glob
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd):
    subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True)


def regenerate():
    run(["python3", "scripts/lumen-to-markdown.py",
         "specs/src/core/core.lumen", "specs/generated/core.md"])
    run(["python3", "scripts/generate-schema-bundles.py"])
    run(["python3", "scripts/lumen-to-openapi.py",
         "specs/src/core/core.lumen", "specs/generated/openapi/core.openapi.json"])
    os.makedirs(os.path.join(ROOT, "specs/generated/callables"), exist_ok=True)
    for f in sorted(glob.glob(os.path.join(ROOT, "specs/src/packs/*/*.lumen"))):
        pack = os.path.splitext(os.path.basename(f))[0]
        run(["python3", "scripts/lumen-to-callables.py", f,
             f"specs/generated/callables/{pack}.callables.json"])


def main():
    fail = []
    regenerate()

    # 1. drift — regenerating must not change anything committed under specs/generated/
    diff = subprocess.run(["git", "diff", "--name-only", "--", "specs/generated/"],
                          cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if diff:
        fail.append("specs/generated/ is STALE — run the generators and commit:\n  "
                    + diff.replace("\n", "\n  "))

    # 2. validity — every generated JSON well-formed; every $ref resolves in/across bundles
    schema_dir = os.path.join(ROOT, "specs/generated/schema")
    bundles = {os.path.basename(f): json.load(open(f))
               for f in glob.glob(os.path.join(schema_dir, "*.schema.json"))}
    names = {name: set(b.get("$defs", {})) for name, b in bundles.items()}
    for name, b in bundles.items():
        for m in re.finditer(r'(?:([a-z0-9-]+\.schema\.json))?#/\$defs/([A-Za-z_]\w*)',
                             json.dumps(b)):
            owner = m.group(1) or name
            if m.group(2) not in names.get(owner, set()):
                fail.append(f"{name}: unresolved $ref {(m.group(1) or '')}#/$defs/{m.group(2)}")
    for f in (glob.glob(os.path.join(ROOT, "specs/generated/openapi/*.json"))
              + glob.glob(os.path.join(ROOT, "specs/generated/callables/*.json"))):
        try:
            json.load(open(f))
        except Exception as error:   # noqa: BLE001 — report any malformed artifact
            fail.append(f"{os.path.relpath(f, ROOT)}: invalid JSON: {error}")

    # 3. degenerate cycles — a def whose ENTIRE body is a $ref to itself has no base
    # case and no validator can build it. Static and toolchain-free, so this class stays
    # caught even where the Node/Ajv pass below cannot run, and it names the offender
    # precisely instead of reporting a stack overflow.
    #
    # The predicate is deliberately NOT "is this def self-referential". At aa439827 three
    # defs referred to themselves and only one was broken: `BeadSchema` and `Retention`
    # carry their self-$ref inside a `oneOf` arm beside non-recursive siblings, which is
    # legitimate recursion with a base case. Testing self-reference would have cried wolf
    # on both while still needing a validator to tell them apart.
    for name, b in bundles.items():
        for def_name, body in (b.get("$defs") or {}).items():
            if not isinstance(body, dict):
                continue
            if (set(body) - {"description", "$comment", "title"} == {"$ref"}
                    and body.get("$ref") == f"#/$defs/{def_name}"):
                fail.append(f"{name}: $defs/{def_name} is a degenerate self-cycle — its "
                            f"whole body is a $ref to itself, so it has no base case")

    # 4. compilability — a resolvable $ref name is NOT enough. A def shaped
    # {"$ref": "#/$defs/Self"} passes pass 2 and then blows a validator's stack, which
    # is how an uncompilable $defs/Resource shipped while this gate said "all $refs
    # resolve". Compile every def in a real 2020-12 validator (the one
    # packages/conformance uses) so the bundles are provably consumable.
    compile_check = subprocess.run(
        ["node", "scripts/compile-generated-schemas.mjs", "specs/generated/schema"],
        cwd=ROOT, capture_output=True, text=True)
    if compile_check.returncode != 0:
        fail.append((compile_check.stderr or compile_check.stdout).strip()
                    or "generated schema bundles failed to compile")

    if fail:
        print("\n".join(fail), file=sys.stderr)
        return 1
    defs = sum(len(v) for v in names.values())
    print(f"Generated artifacts current and valid: {len(bundles)} schema bundles "
          f"({defs} defs), core OpenAPI, {len(glob.glob(os.path.join(ROOT, 'specs/generated/callables/*.json')))} "
          f"callable catalogs. No drift; all $refs resolve; all defs compile.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
