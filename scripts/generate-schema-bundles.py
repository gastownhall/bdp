#!/usr/bin/env python3
# Emit the per-bundle JSON Schema 2020-12 set: core + one bundle per pack.
#
# Runs lumen-to-jsonschema.py on each source (core.lumen + specs/src/packs/*/*.lumen),
# then rewrites cross-bundle $refs: a type that references a def owned by ANOTHER bundle
# gets a bundle-qualified ref (`<owner>.schema.json#/$defs/Name`); same-bundle refs stay
# `#/$defs/Name`. This gives the v0.2 core + per-pack schema partition without changing
# the single-file generator.
import json, re, subprocess, sys, os, glob, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(ROOT, "scripts", "lumen-to-jsonschema.py")
OUT = os.path.join(ROOT, "specs", "generated", "schema")
ID_BASE = "https://github.com/gastownhall/bdp/specs/generated/schema"

sources = [("core", os.path.join(ROOT, "specs/src/core/core.lumen"))]
for f in sorted(glob.glob(os.path.join(ROOT, "specs/src/packs/*/*.lumen"))):
    sources.append((os.path.splitext(os.path.basename(f))[0], f))

os.makedirs(OUT, exist_ok=True)
bundles = {}
for name, src in sources:
    tmp = os.path.join(tempfile.gettempdir(), f"bdp-bundle-{name}.json")
    r = subprocess.run([sys.executable, GEN, src, tmp], capture_output=True, text=True)
    first = (r.stdout.strip().splitlines() or [r.stderr.strip()])[0]
    print(f"{name:9} {first}")
    bundles[name] = json.load(open(tmp))

# global def name -> owning bundle (first declarer wins; core is listed first)
owner = {}
for name, b in bundles.items():
    for k in b.get("$defs", {}):
        owner.setdefault(k, name)

dangling = {}
for name, b in bundles.items():
    local = set(b.get("$defs", {}))
    miss = set()

    def repl(m):
        t = m.group(1)
        if t in local:
            return f'#/$defs/{t}'
        if t in owner:
            return f'{owner[t]}.schema.json#/$defs/{t}'
        miss.add(t)
        return m.group(0)

    txt = re.sub(r'(?:[a-z0-9-]+\.schema\.json)?#/\$defs/([A-Za-z_]\w*)', repl,
                 json.dumps(b, ensure_ascii=False))
    out_b = json.loads(txt)
    out_b["$id"] = f"{ID_BASE}/{name}.schema.json"
    open(os.path.join(OUT, f"{name}.schema.json"), "w").write(
        json.dumps(out_b, indent=2, ensure_ascii=False) + "\n")
    if miss:
        dangling[name] = sorted(miss)
    print(f"  -> {name}.schema.json  ({len(local)} defs)")

print("bundles:", ", ".join(f"{n}({len(b.get('$defs', {}))})" for n, b in bundles.items()))
if dangling:
    print("DANGLING (ref to no bundle):", dangling)
else:
    print("all cross-bundle refs resolve")
