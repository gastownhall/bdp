#!/usr/bin/env python3
# core.lumen -> JSON Schema 2020-12 bundle ($defs), per core.lumen Appendix C.
#
# FIRST CUT (structural correctness; byte-exact fidelity to the sealed v0 bundle is a
# later gate, pending the conformance contract). Lowers the type declarations of a
# Lumen source into one `{$schema, $id, $defs}` bundle. Operations (`command`/`fn`) are
# skipped here — they lower to OpenAPI (a separate emitter), not to $defs.
#
# Mapping (Appendix C):
#   ## Name                      -> $defs.Name
#   /// description:             -> "description"
#   /// jsonschema = { k = v }   -> merged keyword (format/pattern/minLength/closed/type)
#   type X is string             -> {"type":"string"} (+ refinements)
#   type X = Y                   -> {"$ref":"#/$defs/Y"}
#   type X { a: T, b?: U }       -> object + properties + required + additionalProperties:false
#   { ...: any }                 -> additionalProperties:true
#   [ T ]                        -> {"type":"array","items":T}
#   "a" | "b"                    -> {"enum":[...]}
#   A | B                        -> {"oneOf":[A,B]}
#   type X is Y { ... }          -> allOf [ {$ref Y}, {narrowing} ]
#   union { Tag {f} ... }        -> {"oneOf":[...],"discriminator":{"propertyName":"kind"}}
#   ref<T>/pinned<T>/unpinned<T> -> {"$ref":"#/$defs/ResourceRef"} (T erases)
import re, sys, json

SCHEMA_URI = "https://json-schema.org/draft/2020-12/schema"
BUNDLE_ID = "https://github.com/gastownhall/bdp/specs/generated/schema/core.schema.json"

src = open(sys.argv[1]).read().split('\n')
out_path = sys.argv[2] if len(sys.argv) > 2 else None

PRIMITIVES = {'string', 'number', 'integer', 'bool', 'boolean', 'any', 'text'}
DEF_NAMES = set()   # populated after pass 1; used by the lowering to tell refs from nullary tags
# scalar types used in core.lumen but declared elsewhere (no `## ` def here)
KNOWN_SCALARS = {'AbsoluteHttpUrl': {"type": "string", "format": "uri"}}

# --- generic shared lexer: split on a separator at bracket-depth 0, outside quotes ---
def split_top(s, sep='|'):
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

def split_fields(body):
    # record fields separate on a top-level ',' OR newline (Lumen allows either)
    parts, buf, depth, q = [], '', 0, None
    for ch in body:
        if q:
            buf += ch
            if ch == q: q = None
            continue
        if ch in '"\'': q = ch; buf += ch; continue
        if ch in '{[(<': depth += 1
        elif ch in '}])>': depth = max(0, depth - 1)
        if (ch == ',' or ch == '\n') and depth == 0:
            if buf.strip(): parts.append(buf.strip())
            buf = ''
        else:
            buf += ch
    if buf.strip(): parts.append(buf.strip())
    return parts

# --- parse a Lumen metadata literal `{ k = v, k = v }` into a dict (jsonschema hints) ---
def parse_meta(body):
    d = {}
    for pair in split_top(body, ','):
        pair = pair.strip()
        if not pair: continue
        m = re.match(r'^([A-Za-z_]\w*)\s*=\s*(.+)$', pair)
        if not m: continue
        k, v = m.group(1), m.group(2).strip()
        d[k] = _scalar(v)
    return d

def _scalar(v):
    v = v.strip()
    if v.startswith('"') and v.endswith('"'): return v[1:-1]
    if v in ('true', 'false'): return v == 'true'
    if re.match(r'^-?\d+$', v): return int(v)
    if re.match(r'^-?\d+\.\d+$', v): return float(v)
    # a bracketed list of scalars e.g. ["a","b"]
    if v.startswith('[') and v.endswith(']'):
        return [_scalar(x) for x in split_top(v[1:-1], ',') if x.strip()]
    return v  # bare token -> string

# --- parse inline type constraints `{ minLength: 1 }` / `{ 0..4 }` / `{ pattern: "x" }` ---
def parse_constraints(body):
    body = body.strip()
    out = {}
    rng = re.match(r'^(-?\d+)\s*\.\.\s*(-?\d+)$', body)
    if rng:
        out['minimum'], out['maximum'] = int(rng.group(1)), int(rng.group(2))
        return out
    for pair in split_top(body, ','):
        pair = pair.strip()
        m = re.match(r'^([A-Za-z_]\w*)\s*:\s*(.+)$', pair)
        if not m: continue
        k, v = m.group(1), _scalar(m.group(2))
        key = {'min': 'minimum', 'max': 'maximum'}.get(k, k)
        out[key] = v
    return out

# --- recursively lower a Lumen type expression to a JSON Schema fragment ---------
WARN = []
def lower_type(expr):
    expr = expr.strip().rstrip(',').strip()
    if not expr:
        return {}
    # array  [ T ]
    if expr.startswith('[') and expr.endswith(']'):
        return {"type": "array", "items": lower_type(expr[1:-1])}
    # inline record / open record  { ... }
    if expr.startswith('{') and expr.endswith('}'):
        return lower_inline_record(expr[1:-1])
    # top-level union  A | B  (or string enum "a" | "b")
    parts = split_top(expr, '|')
    if len(parts) > 1:
        sp = [p.strip() for p in parts]
        if all(re.match(r'^"[^"]*"$', p) for p in sp):
            return {"enum": [p[1:-1] for p in sp]}
        # nullary-tag union: every arm a bare name, none a primitive or a known def -> enum
        if all(re.match(r'^[A-Za-z_]\w*$', p) and p not in PRIMITIVES and p not in DEF_NAMES
               for p in sp):
            return {"enum": sp}
        # discriminated union written with pipes: arms are `Tag { fields }`
        if any(re.match(r'^[A-Za-z_]\w*\s*\{', p) for p in sp):
            return {"oneOf": [lower_arm(p) for p in sp],
                    "discriminator": {"propertyName": "kind"}}
        return {"oneOf": [lower_type(p) for p in sp]}
    # refinement with trailing constraints:  Base { ... }
    m = re.match(r'^(.+?)\s*\{(.+)\}$', expr)
    if m and '<' not in m.group(1)[-1:]:
        base = lower_type(m.group(1).strip())
        base.update(parse_constraints(m.group(2)))
        return base
    # generic wrapper  G<T>
    m = re.match(r'^([A-Za-z_]\w*)<(.+)>$', expr)
    if m:
        return lower_generic(m.group(1), m.group(2).strip())
    # scalar primitives
    prim = {'string': {"type": "string"}, 'number': {"type": "number"},
            'integer': {"type": "integer"}, 'bool': {"type": "boolean"},
            'boolean': {"type": "boolean"}, 'any': {}, 'text': {"type": "string"},
            'null': {"type": "null"}}
    if expr in prim:
        return dict(prim[expr])
    # string literal const
    if re.match(r'^"[^"]*"$', expr):
        return {"const": expr[1:-1]}
    # generic type variable (T, E, F, U) erases to `any`
    if re.match(r'^[A-Z]$', expr):
        return {}
    # bare named type -> $ref (or a known external scalar)
    if re.match(r'^[A-Za-z_]\w*$', expr):
        if expr not in DEF_NAMES and expr in KNOWN_SCALARS:
            return dict(KNOWN_SCALARS[expr])
        return {"$ref": f"#/$defs/{expr}"}
    WARN.append(expr)
    return {"$comment": f"UNLOWERED: {expr}"}

def lower_generic(g, inner):
    # ref<T>/pinned<T>/unpinned<T> erase T -> ResourceRef (Appendix C)
    if g in ('ref', 'pinned', 'unpinned'):
        return {"$ref": "#/$defs/ResourceRef"}
    if g == 'rep':
        return {"$ref": "#/$defs/Resource"}  # by-value representation
    if g in ('set',):
        return {"type": "array", "items": lower_type(inner), "uniqueItems": True}
    if g in ('source',):
        return {"type": "array", "items": lower_type(inner)}  # a stream of T
    # a nominal generic (Result<T,E>, Outcome<T,E>, rel<F,T>, …) refs its base def
    return {"$ref": f"#/$defs/{g}"}

def lower_inline_record(body):
    # body is the content between { }  — fields separated at top level by ','
    props, required, additional = {}, [], False
    for field in split_fields(body):
        field = field.strip()
        if not field: continue
        if field.startswith('...'):   # { ...: any }
            additional = True; continue
        f = parse_field(field)
        if f:
            nm, opt, sch = f
            props[nm] = sch
            if not opt: required.append(nm)
    sch = {"type": "object", "properties": props}
    if required: sch["required"] = required
    sch["additionalProperties"] = True if additional else False
    return sch

MODIFIERS = ('computed', 'serviceManaged', 'service-managed', 'init-only',
             'read-only', 'unique', 'acyclic', 'abstract')
def parse_field(field):
    toks = field.split()                          # strip leading access modifiers
    while toks and toks[0] in MODIFIERS:
        toks.pop(0)
    field = ' '.join(toks)
    m = re.match(r'^([A-Za-z_]\w*)(\??)\s*:\s*(.+)$', field)
    if not m:
        return None
    nm, opt, typ = m.group(1), m.group(2) == '?', m.group(3).strip()
    default = None                                 # field default `= v`
    dparts = split_top(typ, '=')
    if len(dparts) == 2:
        typ, default = dparts[0].strip(), _scalar(dparts[1].strip())
    sch = lower_type(typ)
    if default is not None:
        sch = {**sch, "default": default}
    return nm, opt, sch

# --- pass 1: collect `## Name` declarations with desc, jsonschema hint, body ------
decls = []
i, n = 0, len(src)
while i < n:
    m = re.match(r'^## (\S.*)$', src[i])
    if not m:
        i += 1; continue
    name = m.group(1).strip()
    i += 1
    desc, js_hint, body, in_decl, bdepth = None, {}, [], False, 0
    while i < n:
        l = src[i]
        if re.match(r'^## ', l) or re.match(r'^// [#=]{5,}', l) or re.match(r'^// -{5,}', l):
            break
        s = l.strip()
        if s == '':
            if in_decl and bdepth <= 0: break     # blank line ends a BALANCED decl only
            i += 1; continue
        dm = re.match(r'^/// description: ?(.*)$', l)
        jm = re.match(r'^/// jsonschema\s*=\s*\{(.*)\}\s*$', l)
        if not in_decl and dm:
            desc = dm.group(1).strip(); i += 1; continue
        if not in_decl and jm:
            js_hint.update(parse_meta(jm.group(1))); i += 1; continue
        if s.startswith('///'):                   # any other doc-comment — skip
            i += 1; continue
        if s.startswith('//'):                     # plain comment
            if in_decl and bdepth <= 0: break      # after the balanced decl — ends it
            i += 1; continue                        # leading / interior-record comment — skip
        in_decl = True
        code = re.sub(r'\s+//.*$', '', l)           # strip trailing inline comment
        body.append(code)
        bdepth += code.count('{') + code.count('[') - code.count('}') - code.count(']')
        i += 1
    decls.append({'name': name, 'desc': desc, 'js': js_hint, 'body': body})

def split_arms(body):
    # DU arms: each is a "literal", a bare `Name`/`Ref<...>`, or `Name { ... }`.
    out, i, nn = [], 0, len(body)
    while i < nn:
        while i < nn and body[i] in ' \t\n\r,': i += 1
        if i >= nn: break
        start = i
        if body[i] == '"':                       # string-literal arm
            i += 1
            while i < nn and body[i] != '"': i += 1
            i += 1
            out.append(body[start:i]); continue
        depth = 0                                 # identifier arm (+ optional record)
        while i < nn:
            c = body[i]
            if c == '<': depth += 1; i += 1
            elif c == '>': depth -= 1; i += 1
            elif c == '{':                        # pull in the arm's record block
                bd = 0
                while i < nn:
                    if body[i] == '{': bd += 1
                    elif body[i] == '}':
                        bd -= 1
                        if bd == 0: i += 1; break
                    i += 1
                break
            elif c in ' \t\n\r,' and depth == 0:
                j = i                       # whitespace between a tag and its `{record}` is
                while j < nn and body[j] in ' \t\n\r,': j += 1   # not an arm boundary — peek
                if j < nn and body[j] == '{':
                    i = j
                else:
                    break
            else:
                i += 1
        out.append(body[start:i])
    return out

def _kebab(name):
    return re.sub(r'(?<!^)(?=[A-Z])', '-', name).lower()

def lower_arm(arm):
    # one DU arm: `Tag { fields }` (internally-tagged record), bare `Ref`, or nullary tag
    arm = arm.strip()
    am = re.match(r'^([A-Za-z_][\w<>]*)\s*(\{.*\})?\s*$', arm, re.S)
    if am and am.group(2):
        rec = lower_type(am.group(2))
        rec.setdefault("properties", {})["kind"] = {"const": _kebab(am.group(1))}
        req = rec.get("required", [])
        rec["required"] = ["kind"] + [r for r in req if r != "kind"]
        return rec
    if am:
        nm = re.sub('<.*>', '', am.group(1))
        return {"$ref": f"#/$defs/{nm}"} if nm in DEF_NAMES else {"const": _kebab(nm)}
    return lower_type(arm)

def lower_du(body):
    # closed discriminated union (the `union { ... }` form)
    arms = [lower_arm(a) for a in split_arms(body) if a.strip()]
    if arms and all(list(a.keys()) == ["const"] for a in arms):   # all nullary -> enum
        return {"enum": [a["const"] for a in arms]}
    return {"oneOf": arms, "discriminator": {"propertyName": "kind"}}

DEF_NAMES.update(d['name'] for d in decls)   # now the lowering can tell refs from nullary tags

# --- pass 2: classify + lower each declaration ----------------------------------
defs = {}
skipped_ops, lowered = [], []
for d in decls:
    body = [b for b in d['body'] if b.strip()]
    if not body:
        continue
    head = body[0].strip()
    # operations lower to OpenAPI, not $defs
    if re.match(r'^(idempotent command|safe command|command|fn)\b', head):
        skipped_ops.append(d['name']); continue
    joined = '\n'.join(b.rstrip() for b in body)
    # strip the `type Name` / `abstract type Name` prefix, keep the RHS
    tm = re.match(r'^(?:abstract\s+)?type\s+([A-Za-z_]\w*(?:<[^>]*>)?)\s*(is|=)?\s*(.*)$',
                  joined, re.S)
    if not tm:
        WARN.append(f"[decl] {d['name']}: {joined[:60]}"); continue
    op, rhs = tm.group(2), tm.group(3).strip()
    # a nominal record written `type X { ... }` (no is/=) — RHS is the brace body
    if op is None and rhs.startswith('{'):
        schema = lower_type(rhs)
    elif op == 'is':
        # refinement: `is Base` (+ optional `{ narrowing }`) or scalar `is string`
        rm = re.match(r'^([A-Za-z_]\w*(?:<[^>]*>)?)\s*(\{.*\})?\s*$', rhs, re.S)
        if rm and rm.group(1) in ('string', 'number', 'integer', 'bool', 'boolean', 'text'):
            schema = lower_type(rhs)                       # scalar newtype
        elif rm:
            base = {"$ref": f"#/$defs/{re.sub('<.*>', '', rm.group(1))}"}
            if rm.group(2):
                schema = {"allOf": [base, lower_type('{' + rm.group(2)[1:-1] + '}')]}
            else:
                schema = base
        else:
            schema = lower_type(rhs)
    else:  # `=`
        # union { ... } (closed DU)
        um = re.match(r'^union\s*\{(.*)\}\s*$', rhs, re.S)
        if um:
            schema = lower_du(um.group(1))
        else:
            schema = lower_type(rhs)
    if d['desc']:
        schema = {"description": d['desc'], **schema}
    if d['js']:
        schema.update(d['js'])
    defs[d['name']] = schema
    lowered.append(d['name'])

bundle = {
    "$schema": SCHEMA_URI,
    "$id": BUNDLE_ID,
    "$defs": defs,
}
text = json.dumps(bundle, indent=2, ensure_ascii=False) + '\n'
if out_path:
    open(out_path, 'w').write(text)
print(f"lowered {len(lowered)} type defs; skipped {len(skipped_ops)} ops; "
      f"{len(set(WARN))} unlowered forms")
if WARN:
    print("UNLOWERED:", "; ".join(sorted(set(str(w) for w in WARN))[:25]))
