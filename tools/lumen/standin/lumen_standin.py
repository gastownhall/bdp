#!/usr/bin/env python3
"""lumen (stand-in) — projects a .lumen source to BDP artifacts.

TEMPORARY stand-in for the real Rust `lumen` binary (gated on the document-AST
parser merge). Honors the same CLI contract so it can be swapped out with no change
to build-spec.sh or CI. Self-contained: the parser lives here, no external deps.

  lumen build <file.lumen> --emit openapi=<path> --emit jsonschema=<path>
  lumen --version

Emits OpenAPI 3.1 and a JSON Schema 2020-12 bundle from the `schema` declarations
and the `/// openapi`/`/// jsonschema` metadata. `markdown`/`reference` backends are
wired separately (the preview renderer).
"""
import re, sys, json, argparse

VERSION = "standin-2026-11-11"

# ───────────────────────── parser (self-contained) ─────────────────────────
class P:
    def __init__(s, t): s.t, s.i = t, 0
    def ws(s):
        while s.i < len(s.t) and s.t[s.i] in " \t\r\n": s.i += 1
    def val(s):
        s.ws(); c = s.t[s.i]
        if c == '"': return s.string()
        if c == '{': return s.record()
        if c == '[': return s.array()
        return s.scalar()
    def string(s):
        s.i += 1; out = ""
        while s.t[s.i] != '"':
            if s.t[s.i] == '\\': s.i += 1
            out += s.t[s.i]; s.i += 1
        s.i += 1; return out
    def record(s):
        s.i += 1; d = {}
        while True:
            s.ws()
            if s.t[s.i] == '}': s.i += 1; return d
            k = s.ident(); s.ws(); s.i += 1; d[k] = s.val(); s.ws()
            if s.t[s.i] == ',': s.i += 1
    def array(s):
        s.i += 1; a = []
        while True:
            s.ws()
            if s.t[s.i] == ']': s.i += 1; return a
            a.append(s.val()); s.ws()
            if s.t[s.i] == ',': s.i += 1
    def ident(s):
        m = re.match(r'[A-Za-z_][A-Za-z0-9_-]*', s.t[s.i:]); s.i += m.end(); return m.group(0)
    def scalar(s):
        m = re.match(r'[^,}\]\s]+', s.t[s.i:]); s.i += m.end(); tok = m.group(0)
        if tok in ("true", "false"): return tok == "true"
        if tok == "null": return None
        if re.fullmatch(r'-?\d+', tok): return int(tok)
        return tok

def is_fence(line):
    s = line.strip()
    return s.startswith("//") and len(s) > 2 and set(s[2:]) == {"`"} and len(s[2:]) >= 3

def strip_inline(code):
    m = re.search(r"\s//\s", code)
    return code[: m.start()].rstrip() if m else code.rstrip()

def parse_file(path):
    items, pending = [], {}
    in_prose, prose = False, []
    decl, mode, bal = None, None, 0
    bk, bv, depth = None, None, 0
    def flush():
        nonlocal bk, bv
        if bk is None: return
        t = bv.strip()
        pending[bk] = P(t).val() if t and t[0] in "{[" else t.strip('"')
        bk = None
    for line in open(path).read().splitlines():
        s = line.strip()
        if decl is not None and mode == "union":
            if s == "" or re.match(r"(schema|command|fn)\b", s) or is_fence(line) or s.startswith("///"):
                items.append(("decl", "\n".join(decl), pending)); pending = {}; decl = mode = None
            else:
                decl.append(strip_inline(line)); continue
        if bk is not None:
            seg = s[3:] if s.startswith("///") else s
            bv += " " + seg; depth += seg.count("{") + seg.count("[") - seg.count("}") - seg.count("]")
            if depth <= 0: flush()
            continue
        if decl is not None and mode == "brace":
            decl.append(strip_inline(line)); bal += line.count("{") + line.count("[") - line.count("}") - line.count("]")
            if bal <= 0:
                items.append(("decl", "\n".join(decl), pending)); pending = {}; decl = mode = None
            continue
        if is_fence(line):
            if not in_prose: in_prose, prose = True, []
            else: in_prose = False; items.append(("prose", "\n".join(prose), None))
            continue
        if in_prose: prose.append(line); continue
        if s.startswith("///"):
            mm = re.match(r"([A-Za-z0-9._-]+)\s*([:=])\s*(.*)$", s[3:].strip())
            if mm:
                key, sep, val = mm.group(1), mm.group(2), mm.group(3)
                if sep == "=" and val.lstrip()[:1] in "{[":
                    d = val.count("{") + val.count("[") - val.count("}") - val.count("]")
                    if d > 0: bk, bv, depth = key, val, d; continue
                    pending[key] = P(val.strip()).val()
                else:
                    pending[key] = val.strip().strip('"')
            continue
        if s == "" or s.startswith("//"): continue
        m = re.match(r"(schema|command|fn)\s+(\w+)", s)
        if m:
            code = strip_inline(line); b = code.count("{") + code.count("[") - code.count("}") - code.count("]")
            if m.group(1) == "schema" and b > 0: decl, mode, bal = [code], "brace", b
            elif m.group(1) == "schema" and code.rstrip().endswith("="): decl, mode = [code], "union"
            else: items.append(("decl", code.strip(), pending)); pending = {}
    if decl is not None: items.append(("decl", "\n".join(decl), pending))
    return items

def split_top(s, seps):
    parts, d, cur, q = [], 0, "", False
    for c in s:
        if c == '"': q = not q
        elif not q and c in "{[(": d += 1
        elif not q and c in "}])": d -= 1
        if c in seps and d == 0 and not q: parts.append(cur); cur = ""
        else: cur += c
    if cur.strip(): parts.append(cur)
    return parts

def parse_fields(src):
    if not re.search(r"schema\s+\w+\s*\{", src): return []
    inner = src[src.index("{") + 1 : src.rindex("}")]
    rows, desc = [], ""
    for ln in inner.splitlines():
        s = ln.strip()
        m = re.match(r"///\s*description\s*:\s*(.+)$", s)
        if m: desc = m.group(1).strip(); continue
        if not s or s.startswith("//"): continue
        for chunk in split_top(s, ","):
            fm = re.match(r"(\w+)(\??)\s*:\s*(.+)$", chunk.strip().rstrip(",").strip())
            if fm:
                rows.append((fm.group(1), fm.group(3).strip(), fm.group(2) == "?", desc)); desc = ""
    return rows

def rhs_of(src):
    return " ".join(src.split("=", 1)[1].split()) if "=" in src else ""

BASE = {"string", "number", "boolean", "integer"}

def classify(src):
    if parse_fields(src): return "record"
    rhs = rhs_of(src)
    if not rhs: return "record"
    arms = [a.strip() for a in split_top(rhs, "|")]
    if len(arms) > 1 and any("{" in a or a == "..." for a in arms): return "du"
    ok = all(a in BASE or (a[:1] == '"' and a[-1:] == '"') or a in ("true", "false", "null")
             or re.fullmatch(r"-?\d+", a) for a in arms)
    if not rhs.startswith("[") and ok: return "atomic"
    return "alias"

def ret_type(src):
    m = re.search(r"\breturns\s+(\S+)(?:\s+fails\s+(\S+))?", src)
    if m: return m.group(1), m.group(2)
    m = re.search(r"\):\s*(\S+)\s*$", src)
    return (m.group(1), None) if m else (None, None)

def body_schema(src):
    m = re.search(r"\(([^)]*)\)", src)
    if not m: return None
    ps = split_top(m.group(1), ",")
    if len(ps) < 2: return None
    tm = re.match(r"\s*\w+\s*:\s*([A-Za-z0-9_\[\]]+)", ps[-1])
    return tm.group(1) if tm else None

# ───────────────────────── type → JSON Schema ─────────────────────────
def type_to_schema(expr, rb):
    e = expr.strip()
    if e == "any": return {}
    if e in BASE: return {"type": e}
    parts = [p.strip() for p in split_top(e, "|")]
    if len(parts) > 1:
        if all(p[:1] == '"' and p[-1:] == '"' for p in parts):
            return {"enum": [p[1:-1] for p in parts]}
        return {"oneOf": [type_to_schema(p, rb) for p in parts]}
    if e[:1] == '"' and e[-1:] == '"': return {"const": e[1:-1]}
    if e.startswith("["): return {"type": "array", "items": type_to_schema(e[1:-1].strip(), rb)}
    if e.startswith("{"): return {"type": "object", "additionalProperties": True}
    if re.fullmatch(r"[A-Za-z_]\w*", e): return {"$ref": rb + e}
    return {"$comment": f"unresolved: {e}"}

def schema_to_jsonschema(name, src, meta, rb):
    kind = classify(src); js = meta.get("jsonschema", {})
    if kind == "record":
        props, req = {}, []
        for fn, ty, opt, desc in parse_fields(src):
            sc = type_to_schema(ty, rb)
            if desc and "$ref" not in sc: sc["description"] = desc
            props[fn] = sc
            if not opt: req.append(fn)
        base = {"type": "object", "properties": props}
        if req: base["required"] = req
        base["additionalProperties"] = (js.get("closed") is False)  # closed=false ⇒ open
    elif kind == "du":
        arms = []
        for a in split_top(rhs_of(src), "|"):
            a = a.strip()
            if a == "...": continue
            m = re.match(r"(\w+)\s*\{(.*)\}$", a)
            if m:
                inner, ireq = {}, []
                for c in split_top(m.group(2), ","):
                    if ":" in c:
                        k, t = c.split(":", 1); inner[k.strip()] = type_to_schema(t.strip(), rb); ireq.append(k.strip())
                arms.append({"type": "object", "required": [m.group(1)],
                             "properties": {m.group(1): {"type": "object", "properties": inner, "required": ireq}}})
            else:
                arms.append({"const": a})
        base = {"oneOf": arms, "unevaluatedProperties": False}
    elif kind == "atomic":
        parts = [p.strip() for p in split_top(rhs_of(src), "|")]
        if len(parts) > 1 and all(p[:1] == '"' for p in parts):
            base = {"enum": [p[1:-1] for p in parts]}
        elif len(parts) == 1 and parts[0][:1] == '"':
            base = {"const": parts[0][1:-1]}
        else:
            base = type_to_schema(rhs_of(src), rb)
        for k, v in js.items():
            if k != "closed": base[k] = v
    else:
        base = type_to_schema(rhs_of(src), rb)
    if meta.get("title"): base.setdefault("title", meta["title"])
    if meta.get("description") and kind != "record": base.setdefault("description", meta["description"])
    bid = meta.get("bdp", {}).get("id")
    if bid: base["$comment"] = f"bdp:id {bid}"
    return base

def collect_schemas(items, rb):
    out = {}
    for k, a, b in items:
        if k != "decl" or not a.startswith("schema"): continue
        name = re.match(r"schema\s+(\w+)", a).group(1)
        out[name] = schema_to_jsonschema(name, a, b, rb)
    return out

# ───────────────────────── emitters ─────────────────────────
REQ_HEADERS = ["BDP-Cause", "BDP-Provenance", "BDP-Metadata"]
REP_HEADERS = ["BDP-Cause", "BDP-Transaction", "BDP-Metadata"]

def _ref(name, rb):
    return {"type": name} if name in BASE else {"$ref": rb + name}

def emit_jsonschema(items):
    return json.dumps({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://github.com/gastownhall/bdp/schemas/bdp-v0.2",
        "title": "BDP Core v0.2",
        "$defs": collect_schemas(items, "#/$defs/"),
    }, indent=2)

def emit_openapi(items):
    rb = "#/components/schemas/"
    schemas = collect_schemas(items, rb)
    path_items = {}
    for k, a, b in items:
        if k != "decl" or a.startswith("schema"): continue
        oa = b.get("openapi")
        if not oa: continue
        method = oa.get("method", "get").lower(); pi = oa.get("pathItem", "default")
        op = {"operationId": oa.get("operationId", ""), "tags": oa.get("tags", [])}
        if b.get("description"): op["description"] = b["description"]
        params = []
        for pn, pa in oa.get("params", {}).items():
            params.append({"name": pn, "in": pa.get("in", "query"),
                           "required": bool(pa.get("required", False)), "schema": _ref(pa.get("schema", "string"), rb)})
        if "requestContext" in oa.get("paramGroups", []):
            for h in REQ_HEADERS:
                params.append({"name": h, "in": "header", "required": False, "schema": {"type": "string"}})
        if params: op["parameters"] = params
        req = oa.get("request", {})
        if req.get("contentType"):
            bs = body_schema(a)
            op["requestBody"] = {"required": True, "content": {req["contentType"]: {"schema": _ref(bs, rb) if bs else {}}}}
        rtype, fails = ret_type(a)
        responses = {}
        su = oa.get("success")
        if su:
            responses[str(su["status"])] = {"description": "success",
                "content": {su.get("contentType", "application/json"): {"schema": _ref(rtype, rb) if rtype else {}}}}
        for r in oa.get("responses", []):
            responses[str(r["status"])] = {"description": r.get("description", ""),
                "content": {r.get("contentType", "application/json"): {"schema": _ref(r.get("schema", ""), rb)}}}
        pr = oa.get("problem")
        if pr:
            sts = pr["status"] if isinstance(pr["status"], list) else [pr["status"]]
            for st in sts:
                responses[str(st)] = {"description": "problem",
                    "content": {pr.get("contentType", "application/problem+json"): {"schema": _ref(fails or "Problem", rb)}}}
        if "replyContext" in oa.get("paramGroups", []):
            hdrs = {h: {"schema": {"type": "string"}} for h in REP_HEADERS}
            for resp in responses.values(): resp.setdefault("headers", {}).update(hdrs)
        for hn, ha in oa.get("responseHeaders", {}).items():
            if su and str(su["status"]) in responses:
                responses[str(su["status"])].setdefault("headers", {})[hn] = {"schema": _ref(ha.get("schema", "string"), rb)}
        op["responses"] = responses
        path_items.setdefault(pi, {})[method] = op
    doc = {"openapi": "3.1.0",
           "info": {"title": "BDP Core", "version": "0.2",
                    "description": "Projected from core.lumen by the lumen stand-in. URLs are discovered; operation signatures live in components.pathItems."},
           "paths": {},
           "components": {"schemas": schemas, "pathItems": path_items}}
    return json.dumps(doc, indent=2, ensure_ascii=False)

# ───────────────────────── markdown reference backend ─────────────────────────
def _cell(t): return t.replace("|", "\\|")

def _q_fields(src):
    out = [f'  "{n}"{"?" if opt else ""}: {ty},' for n, ty, opt, _ in parse_fields(src)]
    if out: out[-1] = out[-1].rstrip(",")
    return "{\n" + "\n".join(out) + "\n}"

def _du_arms(src):
    arms = []
    for a in split_top(rhs_of(src), "|"):
        a = a.strip()
        if a == "...": arms.append(("…", None)); continue
        m = re.match(r"(\w+)\s*\{(.*)\}$", a)
        if m:
            fs = ", ".join(f'"{c.split(":")[0].strip()}": {c.split(":", 1)[1].strip()}'
                           for c in split_top(m.group(2), ",") if ":" in c)
            arms.append((m.group(1), fs))
        else:
            arms.append((a, None))
    return arms

def _q_du(src):
    out = []
    for i, (tag, fs) in enumerate(_du_arms(src)):
        bar = "  " if i == 0 else "| "
        if tag == "…": out.append(bar + "…"); continue
        out.append(bar + (f'{{ "{tag}": {{ {fs} }} }}' if fs else f'"{tag}"'))
    return "\n".join(out)

def _schema_md(name, src, meta):
    kind = classify(src); o = [f"### `{name}`", ""]
    t = meta.get("title", "")
    if t and t.lower() != name.lower(): o += [f"_{t}_", ""]
    if meta.get("description"): o += [meta["description"], ""]
    code = _q_fields(src) if kind == "record" else _q_du(src) if kind == "du" else rhs_of(src)
    if code: o += ["```", code, "```", ""]
    if kind == "record":
        o += ["| field | type | optional | description |", "| --- | --- | --- | --- |"]
        for n, ty, opt, desc in parse_fields(src):
            o.append(f"| `{n}` | `{_cell(ty)}` | {'yes' if opt else 'no'} | {desc} |")
        o.append("")
    elif kind == "du":
        o += ["| arm | carries |", "| --- | --- |"]
        for tag, fs in _du_arms(src):
            o.append(f"| `{tag}` | {('`'+fs+'`') if fs else '_open_' if tag == '…' else '_no payload_'} |")
        o.append("")
    bid = meta.get("bdp", {}).get("id")
    if bid: o += [f"`$id`: `{bid}`", ""]
    return "\n".join(o)

def _atomic_md(atomics):
    o = ["| type | base | refinements | description |", "| --- | --- | --- | --- |"]
    for name, src, meta in atomics:
        arms = " \\| ".join(f"`{a.strip()}`" for a in split_top(rhs_of(src), "|"))
        ref = ", ".join(f"`{k}: {v}`" for k, v in meta.get("jsonschema", {}).items()) or "—"
        desc = meta.get("description", meta.get("title", ""))
        o.append(f"| `{name}` | {arms} | {ref} | {desc} |")
    return "\n".join(o + [""])

MD_REQ = [("BDP-Cause", "cause (`Reference`)"), ("BDP-Provenance", "provenance (`RevisionProvenance`)"), ("BDP-Metadata", "open metadata")]
MD_REP = [("BDP-Cause", "cause (`Reference`)"), ("BDP-Transaction", "transaction (`Reference`)"), ("BDP-Metadata", "open metadata")]

def _resp_tbl(rs):
    if not rs: return ["_none_", ""]
    out = ["| status | content-type | entity body |", "| --- | --- | --- |"]
    for st, ct, bd, note in rs:
        out.append(f"| {st} | {ct or '—'} | `{bd}`{(' — ' + note) if note else ''} |")
    return out + [""]

def _op_md(name, src, meta):
    oa = meta.get("openapi", {}); rtype, fails = ret_type(src)
    opid = oa.get("operationId", name); method = oa.get("method", "")
    o = [f"### `{opid}`", ""]
    if meta.get("description"): o += [meta["description"], ""]
    o += ["**Method**", "", f"`{method}`" + (f" on a `{oa['pathItem']}` URL" if oa.get("pathItem") else ""), ""]
    qp = {k: v for k, v in oa.get("params", {}).items() if v.get("in") == "query"}
    if qp:
        o += ["| query parameter | schema | required |", "| --- | --- | --- |"]
        for k, v in qp.items(): o.append(f"| `{k}` | `{v.get('schema','')}` | {str(v.get('required', False)).lower()} |")
        o.append("")
    o += ["**Request Headers**", ""]
    rrows = list(MD_REQ) if "requestContext" in oa.get("paramGroups", []) else []
    for k, v in oa.get("params", {}).items():
        if v.get("in") == "header": rrows.append(("If-Match" if k == "ifMatch" else k, f"`{v.get('schema','')}`"))
    o += (["| header | meaning |", "| --- | --- |"] + [f"| `{h}` | {m} |" for h, m in rrows] + [""]) if rrows else ["_none_", ""]
    o += ["**Request Entity Body**", ""]
    ct = oa.get("request", {}).get("contentType")
    o += [f"`{ct}` → `{body_schema(src) or ''}`" if ct else "_none_", ""]
    o += ["**Response Headers**", ""]
    prows = list(MD_REP) if "replyContext" in oa.get("paramGroups", []) else []
    for hn, a in oa.get("responseHeaders", {}).items(): prows.append((hn, f"`{a.get('schema','')}`"))
    o += (["| header | meaning |", "| --- | --- |"] + [f"| `{h}` | {m} |" for h, m in prows] + [""]) if prows else ["_none_", ""]
    rows = []
    su = oa.get("success")
    if su: rows.append((su.get("status", ""), su.get("contentType", ""), rtype or "", ""))
    for r in oa.get("responses", []): rows.append((r.get("status", ""), r.get("contentType", ""), r.get("schema", ""), r.get("description", "")))
    ok = [r for r in rows if str(r[0])[:1] == "2"]; err = [r for r in rows if str(r[0])[:1] in ("4", "5")]
    pr = oa.get("problem")
    if pr:
        st = pr.get("status"); st = ", ".join(map(str, st)) if isinstance(st, list) else st
        err.append((st, pr.get("contentType", ""), fails or "Problem", ""))
    o += ["**Response Entity Body**", ""] + _resp_tbl(ok)
    o += ["**Errors**", ""] + _resp_tbl(err)
    return "\n".join(o)

def emit_markdown(items):
    atomics = [(re.match(r"schema\s+(\w+)", a).group(1), a, b) for k, a, b in items
               if k == "decl" and a.startswith("schema") and classify(a) == "atomic"]
    out, emitted = [], False
    for k, a, b in items:
        if k == "prose": out.append(a.strip()); continue
        m = re.match(r"(schema|command|fn)\s+(\w+)", a); name = m.group(2)
        if m.group(1) != "schema": out.append(_op_md(name, a, b)); continue
        c = classify(a)
        if c == "atomic":
            if not emitted: out.append(_atomic_md(atomics)); emitted = True
            continue
        out.append(_schema_md(name, a, b))
    return "\n\n".join(out)

EMITTERS = {"openapi": emit_openapi, "jsonschema": emit_jsonschema, "markdown": emit_markdown}

def main():
    ap = argparse.ArgumentParser(prog="lumen")
    ap.add_argument("--version", action="store_true")
    ap.add_argument("cmd", nargs="?")
    ap.add_argument("file", nargs="?")
    ap.add_argument("--emit", action="append", default=[], metavar="backend=path")
    args = ap.parse_args()
    if args.version:
        print(f"lumen {VERSION} (stand-in; not grammar-backed)"); return 0
    if args.cmd != "build" or not args.file:
        ap.error("usage: lumen build <file.lumen> --emit backend=path ...")
    items = parse_file(args.file)
    for spec in args.emit:
        backend, _, path = spec.partition("=")
        if backend not in EMITTERS:
            print(f"lumen: unknown backend '{backend}' (have: {', '.join(EMITTERS)})", file=sys.stderr); return 2
        open(path, "w").write(EMITTERS[backend](items) + "\n")
        print(f"lumen: wrote {backend} -> {path}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
