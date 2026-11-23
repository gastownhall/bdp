#!/usr/bin/env python3
# core.lumen -> OpenAPI 3.1.1 catalog, per core.lumen Appendix C.
#
# FIRST CUT. Reads the `## op` declarations (command/fn) carrying `/// openapi = {...}`
# and emits an OpenAPI 3.1.1 document: one path-item/operation per primitive, with
# parameters, request body, responses and response headers, all referencing the
# generated JSON Schema bundle (components/schemas <- specs/generated/schema/core.schema.json).
#
# The literal path for each pathItem comes from the §13.1 route table (encoded in
# ROUTES below) keyed by operationId — the `/// openapi` hint gives method + pathItem
# (a category), not the literal path (that is the old bindings.json's job; folding it
# into the hints is a later spec pass).
import re, sys, json

src = open(sys.argv[1]).read().split('\n')
out_path = sys.argv[2] if len(sys.argv) > 2 else None

# route table (Appendix D §13.1): operationId -> literal path template
ROUTES = {
    "get": "/{id}", "create": "/-/create", "put": "/{id}", "patch": "/{id}",
    "delete": "/{id}", "list": "/-/list", "revisions": "/{id}/-/revisions",
    "call": "/{opPath}/-/call", "cancel": "/{asyncResultId}/-/cancel",
    "pull": "/{channel}", "push": "/{channel}", "export": "/-/export", "import": "/-/import",
}

def split_top(s, sep=','):
    parts, buf, depth, q = [], '', 0, None
    for ch in s:
        if q:
            buf += ch
            if ch == q: q = None
            continue
        if ch in '"\'': q = ch; buf += ch; continue
        if ch in '{[(<': depth += 1
        elif ch in '}])>': depth = max(0, depth - 1)
        if ch == sep and depth == 0:
            parts.append(buf); buf = ''
        else:
            buf += ch
    parts.append(buf)
    return [p.strip() for p in parts]

def parse_value(s):
    # recursive Lumen literal -> python (dict / list / str / int / bool)
    s = s.strip()
    if s.startswith('{') and s.endswith('}'):
        d = {}
        for pair in split_top(s[1:-1]):
            if not pair: continue
            m = re.match(r'^([A-Za-z_]\w*)\s*=\s*(.+)$', pair, re.S)
            if m:
                d[m.group(1)] = parse_value(m.group(2))
        return d
    if s.startswith('[') and s.endswith(']'):
        return [parse_value(x) for x in split_top(s[1:-1]) if x.strip()]
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1]
    if s in ('true', 'false'):
        return s == 'true'
    if re.match(r'^-?\d+$', s):
        return int(s)
    return s

# a schema expression from a hint (e.g. "Rev", "Filter", "rep<AsyncResult>", "\"*\"")
def schema_ref(expr):
    expr = (expr or '').strip()
    if not expr:
        return {}
    if expr.startswith('"') and expr.endswith('"'):   # a literal like "*" or "sync" | "async"
        inner = expr[1:-1]
        alts = [a.strip().strip('"') for a in inner.split('|')]
        return {"enum": alts} if len(alts) > 1 else {"const": inner}
    prim = {'string': "string", 'number': "number", 'integer': "integer",
            'boolean': "boolean", 'bool': "boolean", 'text': "string"}
    if expr in prim:
        return {"type": prim[expr]}
    if expr == 'AbsoluteHttpUrl':
        return {"type": "string", "format": "uri"}
    m = re.match(r'^[A-Za-z_]\w*<(.+)>$', expr)        # rep<T>/ref<T> -> the carried base
    if m:
        return {"$ref": f"#/components/schemas/{m.group(1).strip()}"}
    if re.match(r'^[A-Za-z_]\w*$', expr):
        return {"$ref": f"#/components/schemas/{expr}"}
    return {}

PROBLEM = {"$ref": "#/components/schemas/Problem"}

def build_operation(opid, hint, desc):
    op = {"operationId": opid}
    if desc:
        op["summary"] = desc.split('. ')[0][:120]
    if hint.get("tags"):
        op["tags"] = hint["tags"]
    # parameters
    params = []
    for key, p in (hint.get("params") or {}).items():
        if not isinstance(p, dict):
            continue
        params.append({
            "name": p.get("name", key),
            "in": p.get("in", "query"),
            "required": bool(p.get("required", False)),
            "schema": schema_ref(p.get("schema")),
        })
    if params:
        op["parameters"] = params
    # request body
    req = hint.get("request")
    if isinstance(req, dict) and req.get("contentType"):
        op["requestBody"] = {"content": {req["contentType"]: {}}}
    # responses
    responses = {}
    if isinstance(hint.get("success"), dict):
        responses[str(hint["success"].get("status", 200))] = {"description": "success"}
    for r in (hint.get("responses") or []):
        if isinstance(r, dict) and r.get("status"):
            responses[str(r["status"])] = {
                "description": r.get("description", ""),
                **({"content": {"application/json": {"schema": schema_ref(r.get("schema"))}}}
                   if r.get("schema") else {}),
            }
    for st in ((hint.get("problem") or {}).get("status") or []):
        responses[str(st)] = {"description": "problem",
                              "content": {"application/problem+json": {"schema": PROBLEM}}}
    # response headers
    rh = hint.get("responseHeaders")
    if isinstance(rh, dict):
        hdrs = {h: {"schema": schema_ref(v.get("schema") if isinstance(v, dict) else v)}
                for h, v in rh.items()}
        # attach headers to the 2xx responses
        for code, body in responses.items():
            if code.startswith("2"):
                body["headers"] = hdrs
    if not responses:
        responses["default"] = {"description": ""}
    op["responses"] = responses
    return op

# --- scan the ops: `## op` with command/fn + a `/// openapi = {...}` hint ---------
paths, count = {}, 0
i, n = 0, len(src)
while i < n:
    m = re.match(r'^## (\S.*)$', src[i])
    if not m:
        i += 1; continue
    i += 1
    desc, hint = None, None
    while i < n and not re.match(r'^## ', src[i]) and not re.match(r'^// [#=]{5,}', src[i]):
        l = src[i]
        dm = re.match(r'^/// description: ?(.*)$', l)
        om = re.match(r'^/// openapi\s*=\s*(\{.*\})\s*$', l)
        if dm and desc is None:
            desc = dm.group(1).strip()
        elif om:
            hint = parse_value(om.group(1))
        elif l.strip() and not l.lstrip().startswith('/') and not l.lstrip().startswith('//'):
            # first code line of a non-op decl without an openapi hint: stop scanning it
            pass
        i += 1
    if not hint:
        continue
    opid = hint.get("operationId")
    method = (hint.get("method") or "GET").lower()
    path = ROUTES.get(opid, f"/-/{opid}")
    paths.setdefault(path, {})[method] = build_operation(opid, hint, desc)
    count += 1

# core.lumen version (from the `// Version: x.y.z` header, if present)
ver = "0.2.0"
for l in src[:40]:
    vm = re.search(r'Version:\s*([0-9]+\.[0-9]+\.[0-9]+)', l)
    if vm:
        ver = vm.group(1); break

# embed the generated schema bundle under components/schemas (refs rewritten from
# #/$defs/ to #/components/schemas/) so the OpenAPI document is self-contained
try:
    _b = json.load(open("specs/generated/schema/core.schema.json"))
    _defs = json.dumps(_b.get("$defs", {})).replace("#/$defs/", "#/components/schemas/")
    components_schemas = json.loads(_defs)
except Exception:
    components_schemas = {"$comment": "run lumen-to-jsonschema.py first to populate schemas"}

doc = {
    "openapi": "3.1.1",
    "info": {"title": "BDP Core", "version": ver,
             "description": "Generated from specs/src/core/core.lumen (Appendix C lowering)."},
    "jsonSchemaDialect": "https://json-schema.org/draft/2020-12/schema",
    "paths": paths,
    "components": {"schemas": components_schemas},
}
text = json.dumps(doc, indent=2, ensure_ascii=False) + '\n'
if out_path:
    open(out_path, 'w').write(text)
print(f"emitted {count} operations across {len(paths)} paths; openapi {doc['openapi']} v{ver}")
