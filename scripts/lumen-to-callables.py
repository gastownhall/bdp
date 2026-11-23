#!/usr/bin/env python3
# Lumen pack -> callable catalog (the op/fault coverage surface for conformance).
#
# Each `command`/`fn` operation in a pack is a CALLABLE — invoked via the generic
# `call` primitive at POST /{path}/-/call, not a REST route of its own. This emits a
# catalog enumerating every callable with: its element path, cli name, summary,
# parameters (name / type / required), the success return type, the effect markers
# (safe/idempotent), and the declared error set (the E of `Result<T, E>`). Types are
# recorded as their Lumen form (resolvable against the generated schema bundles).
#
# Usage: lumen-to-callables.py SRC.lumen [OUT.json]
import re, sys, json, os

src_path = sys.argv[1]
out_path = sys.argv[2] if len(sys.argv) > 2 else None
pack = os.path.splitext(os.path.basename(src_path))[0]
src = open(src_path).read().split('\n')

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

OP_RE = re.compile(r'^(idempotent\s+|safe\s+)?(command|fn)\s+([A-Za-z_]\w*)')

# --- collect op declarations with their preceding /// description --------------
ops = []
i, n = 0, len(src)
desc, cli_name = None, None
while i < n:
    l = src[i]; s = l.strip()
    dm = re.match(r'^/// description: ?(.*)$', l)
    cm = re.match(r'^/// cli\.name:\s*"([^"]+)"', l)
    if dm:
        desc = dm.group(1).strip(); i += 1; continue
    if cm:
        cli_name = cm.group(1); i += 1; continue
    if s.startswith('///'):
        i += 1; continue
    om = OP_RE.match(s)
    if om:
        body, bdepth = [], 0
        while i < n:
            ln = src[i]; st = ln.strip()
            if body and bdepth <= 0 and (st == '' or st.startswith('///')
                    or st.startswith('//') or OP_RE.match(st)
                    or re.match(r'^(?:abstract\s+)?type\s', st) or re.match(r'^## ', ln)
                    or re.match(r'^// [#=]{5,}', ln) or re.match(r'^// -{5,}', ln)):
                break
            if st == '' or st.startswith('///') or st.startswith('//'):
                i += 1; continue
            body.append(re.sub(r'\s+//.*$', '', ln))
            bdepth += ln.count('(') + ln.count('[') + ln.count('{') \
                    - ln.count(')') - ln.count(']') - ln.count('}')
            i += 1
        ops.append({'markers': om.group(1), 'kind': om.group(2), 'name': om.group(3),
                    'desc': desc, 'cli': cli_name, 'body': body})
        desc, cli_name = None, None
        continue
    if s == '' or s.startswith('##') or re.match(r'^(?:abstract\s+)?type\s', s):
        desc, cli_name = None, None
    i += 1

# --- parse one op signature: params + return -----------------------------------
def signature(body):
    joined = ' '.join(b.strip() for b in body)
    start = joined.find('(')
    if start < 0:
        return [], None
    d, end = 0, len(joined)
    for j in range(start, len(joined)):
        if joined[j] == '(': d += 1
        elif joined[j] == ')':
            d -= 1
            if d == 0:
                end = j; break
    params = []
    for p in split_top(joined[start + 1:end]):
        pm = re.match(r'^([A-Za-z_]\w*)(\??)\s*:\s*(.+)$', p.strip())
        if pm:
            typ = split_top(pm.group(3), '=')[0].strip()   # drop any `= default`
            params.append({"name": pm.group(1), "type": typ,
                           "required": pm.group(2) != '?'})
    rm = re.search(r'->\s*(.+)$', joined[end + 1:])
    return params, (rm.group(1).strip() if rm else None)

# --- success type + declared error set from a return like Result<rep<Issue>, E> --
def return_and_errors(ret):
    if not ret:
        return None, []
    m = re.match(r'^Result<(.+)>$', ret) or re.match(r'^Outcome<(.+)>$', ret)
    if m:
        args = split_top(m.group(1))
        success = args[0].strip() if args else None
        errors = [a.strip() for a in args[1:]]
        return success, errors
    return ret, []

# --- the callable element path lives in the description's trailing (`pack/path`.) --
def callable_path(desc):
    if not desc:
        return None
    m = re.search(r'\([`]?([a-z][a-z0-9]+(?:/[a-z0-9-]+)+)[`]?[.;]', desc)
    return m.group(1) if m else None

catalog = {"pack": pack, "callables": []}
for op in ops:
    params, ret = signature(op['body'])
    success, errors = return_and_errors(ret)
    path = callable_path(op['desc'])
    entry = {
        "path": path or f"{pack}/{op['name']}",
        "operation": op['name'],
        "safe": op['kind'] == 'fn' or (op['markers'] or '').strip() == 'safe',
        "idempotent": (op['markers'] or '').strip() == 'idempotent',
    }
    if op.get('cli'):
        entry["cli"] = op['cli']
    if op['desc']:
        entry["summary"] = op['desc'].split('. ')[0][:140]
    entry["parameters"] = params
    if success:
        entry["returns"] = success
    if errors:
        entry["errors"] = errors
    catalog["callables"].append(entry)

text = json.dumps(catalog, indent=2, ensure_ascii=False) + '\n'
if out_path:
    open(out_path, 'w').write(text)
print(f"{pack}: {len(catalog['callables'])} callables")
