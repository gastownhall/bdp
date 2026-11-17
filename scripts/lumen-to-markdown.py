#!/usr/bin/env python3
# core.lumen -> plain-old-markdown (a human reference).
#   ## Name          -> ### `Name`
#   /// description:  -> prose
#   /// normative:    -> > **Normative.** blockquote
#   /// bdp|openapi|jsonschema -> omitted
#   record / union / op members -> a standardized | Member | Type | Description | table
#   declared union of named arms -> arm descriptions looked up from each arm's own decl
#   one-line sum alias (A | B | C) -> an | Alternative | Description | table
#   one-line string union ("a" | "b") -> an inline "One of `a`, `b`." line
#   scalar / single alias -> a compact inline `type X is Y` line
#   op Returns -> the return type's own one-line description, looked up
#   // comment prose -> paragraphs; "- "/"N." -> md lists; | pipe tables | -> md tables
import re, sys

src = open(sys.argv[1]).read().split('\n')

# --- pre-pass: every `## Name` -> its first `/// description:` line -------------
# Lets named union arms and operation Returns show the referenced type's meaning
# without restating it in the referencing declaration.
DESC = {}
for idx, l in enumerate(src):
    m = re.match(r'^## (\S.*)$', l)
    if not m:
        continue
    name = m.group(1).strip()
    for j in range(idx + 1, min(idx + 10, len(src))):
        if re.match(r'^## ', src[j]):
            break
        d = re.match(r'^/// description: ?(.*)$', src[j])
        if d:
            DESC[name] = d.group(1).strip()
            break

def inner_type(t):
    # First Capitalized identifier; the by-value/by-ref wrappers (rep/ref/source/
    # pinned/unpinned) are lowercase, so they never shadow the carried type.
    m = re.findall(r'[A-Z][A-Za-z0-9_]+', t or '')
    return m[0] if m else None

out, i, n = [], 0, len(src)

def is_banner(s): return bool(re.match(r'^// [#=]{5,}', s))
def is_rule(s):   return bool(re.match(r'^// -{5,}', s))
def collapse(s):  return re.sub(r' {2,}', ' ', s).strip()
def cell(s):      return collapse(s).replace('|', r'\|')

FIELD = re.compile(r'^\s*([A-Za-z_]\w*)(\??):\s*(.+?)\s*,?\s*(?://\s*(.*))?$')

def parse_record(decl):
    rows, pend = [], None
    for l in decl:
        dm = re.match(r'^\s*/// description: ?(.*)$', l)
        if dm: pend = dm.group(1); continue
        if l.lstrip().startswith('///'): continue
        m = FIELD.match(l)
        if m and '->' not in l:
            name, opt, typ, cmt = m.groups()
            rows.append((name + (opt or ''), typ.rstrip(','), pend or cmt or ''))
            pend = None
    return rows

def parse_op(decl):
    joined = ' '.join(x.strip() for x in decl)
    rm = re.search(r'->\s*(.+?)\s*$', joined)
    ret = rm.group(1).strip() if rm else None
    rows = []
    for l in decl:
        if '->' in l: continue
        m = FIELD.match(l)
        if m:
            name, opt, typ, cmt = m.groups()
            rows.append((name + (opt or ''), typ.rstrip(','), cmt or ''))
    return rows, ret

def parse_union(decl):
    rows, pend = [], None
    for l in decl:
        dm = re.match(r'^\s*/// description: ?(.*)$', l)
        if dm: pend = dm.group(1); continue
        if l.lstrip().startswith('///'): continue
        s = l.strip()
        if not s or s.startswith('type ') or s.endswith('union {') or s in ('{', '}'):
            continue
        m = re.match(r'^\s*("[^"]+"|[A-Za-z_][\w<>,.\s]*?)\s*(\{.*\})?\s*,?\s*(?://\s*(.*))?$', l)
        if m:
            tag = m.group(1).strip()
            d = pend or m.group(3) or ''
            if not d and tag in DESC:        # a bare named arm — borrow its own meaning
                d = DESC[tag]
            rows.append((tag, (m.group(2) or '').strip(), d))
            pend = None
    return rows

def emit_members(decl):
    joined = '\n'.join(decl)
    head = decl[0].strip() if decl else ''
    res = []
    # operations ---------------------------------------------------------------
    if re.match(r'^(idempotent command|safe command|command|fn)\b', head):
        rows, ret = parse_op(decl)
        if rows:
            res += ['| Parameter | Type | Description |', '|---|---|---|']
            res += [f'| `{nm}` | `{cell(t)}` | {cell(d)} |' for nm, t, d in rows]
            res += ['']
        if ret:
            rd = DESC.get(inner_type(ret), '')
            res += [f'**Returns** `{cell(ret)}`' + (f' — {cell(rd)}' if rd else ''), '']
        return res
    # declared unions ----------------------------------------------------------
    if 'union {' in joined:
        rows = parse_union(decl)
        if rows:
            res += ['| Variant | Payload | Description |', '|---|---|---|']
            res += [f'| `{tg}` | {("`"+cell(p)+"`") if p else "—"} | {cell(d)} |'
                    for tg, p, d in rows]
            res += ['']
            return res
    # records ------------------------------------------------------------------
    if '{' in joined and re.search(r'^\s*[A-Za-z_]\w*\??:\s*\S', joined, re.M):
        rows = parse_record(decl)
        if rows:
            res += ['| Member | Type | Description |', '|---|---|---|']
            res += [f'| `{nm}` | `{cell(t)}` | {cell(d)} |' for nm, t, d in rows]
            res += ['']
            return res
    # one-line aliases: scalar, string union, or sum-of-types ------------------
    oneline = ' '.join(x.strip() for x in decl)
    am = re.match(r'^type\s+(\w+(?:<[^>]*>)?)\s*(is|=)\s*(.+)$', oneline)
    if am:
        rhs = am.group(3).strip()
        alts = [a.strip() for a in rhs.split('|')]
        if len(alts) > 1 and all(re.match(r'^"[^"]*"$', a) for a in alts):
            return ['One of ' + ', '.join(f'`{a}`' for a in alts) + '.', '']
        if len(alts) > 1:
            res += ['| Alternative | Description |', '|---|---|']
            for a in alts:
                res += [f'| `{cell(a)}` | {cell(DESC.get(inner_type(a), ""))} |']
            res += ['']
            return res
        return [f'`{cell(oneline)}`', '']
    return ['```lumen', *decl, '```', '']

def render_list(sub, ordered):
    items = []
    for l in sub:
        m = re.match(r'^\s*(?:[-*]|\d+\.)\s+(.*)$', l)
        if m: items.append(collapse(m.group(1)))
        elif items: items[-1] += ' ' + collapse(l)
    return [f'{k+1}. {t}' for k, t in enumerate(items)] if ordered else [f'- {t}' for t in items]

def render_table(sub):
    rows = []
    for l in sub:
        s = l.strip()
        if not s.startswith('|'): continue
        rows.append([c.strip() for c in s.strip('|').split('|')])
    if len(rows) < 2: return None
    w = max(len(r) for r in rows)
    rows = [r + [''] * (w - len(r)) for r in rows]
    res = ['| ' + ' | '.join(rows[0]) + ' |', '|' + '|'.join(['---'] * w) + '|']
    res += ['| ' + ' | '.join(r) + ' |' for r in rows[1:]]
    return res

def render_sub(sub):
    if sum(1 for l in sub if l.strip().startswith('|')) >= 2:
        t = render_table([l for l in sub if l.strip().startswith('|')])
        if t: return t
    bullets  = sum(1 for l in sub if re.match(r'^\s*[-*]\s+\S', l))
    numbered = sum(1 for l in sub if re.match(r'^\s*\d+\.\s+\S', l))
    if numbered >= 2: return render_list(sub, True)
    if bullets  >= 2: return render_list(sub, False)
    if any('{' in l or '}' in l for l in sub) \
       or sum(1 for l in sub if re.search(r'\S {2,}\S', l)) >= 2 \
       or sum(1 for l in sub if re.match(r'^  +\S', l)) >= 2:
        return ['```', *sub, '```']
    text = collapse(' '.join(l.strip() for l in sub))
    mh = re.match(r'^-{2,}\s*(.*?)\s*-{2,}$', text)       # "--- a mini-heading ---"
    if mh: return [f'**{mh.group(1)}**']
    return [text]

def render_comment(buf):
    res, sub = [], []
    for b in buf + ['']:
        if b.strip() == '':
            if sub:
                if not any(re.search(r'>DB\?|>L\b|>>>|TYPES-PASS:', x) for x in sub):
                    res += render_sub(sub) + ['']
                sub = []
        else: sub.append(b)
    return res

while i < n:
    line = src[i]
    if is_banner(line):
        if i+2 < n and src[i+1].startswith('//') and is_banner(src[i+2]):
            out += [f'# {src[i+1][2:].strip()}', '']; i += 3; continue
        i += 1; continue
    if is_rule(line):
        if i+2 < n and src[i+1].startswith('//') and is_rule(src[i+2]):
            out += [f'## {src[i+1][2:].strip()}', '']; i += 3; continue
        i += 1; continue
    m = re.match(r'^## (\S.*)$', line)
    if m:
        name = m.group(1).strip()
        # Explicit, case-preserving anchor = the exact Lumen form-id, so bdp.md can
        # deep-link every form as `…/core.md#FormName` independent of the renderer's
        # own heading-slug rules.
        out += [f'<a id="{name}"></a>', '', f'### `{name}`', '']
        i += 1
        desc, norms, decl, in_decl = [], [], [], False
        while i < n:
            l = src[i]
            if re.match(r'^## ', l) or is_banner(l) or is_rule(l): break
            if l.strip() == '':
                if in_decl: break
                i += 1; continue
            dm = re.match(r'^/// (description|normative|doc|review-todo): ?(.*)$', l)
            om = re.match(r'^/// (bdp|openapi|jsonschema) ?=', l)
            if (dm or om) and not in_decl:
                if dm and dm.group(1) == 'description': desc.append(dm.group(2))
                elif dm and dm.group(1) == 'normative': norms.append(dm.group(2))
                i += 1; continue
            if not in_decl and l.lstrip().startswith('//'):   # leading comment before the decl
                i += 1; continue
            if in_decl and l.lstrip().startswith('//') and not l.lstrip().startswith('///'):
                break                                          # trailing comment after the decl
            in_decl = True; decl.append(l); i += 1
        for d in desc:    out += [collapse(d), '']
        for nrm in norms: out += [f'> **Normative.** {collapse(nrm)}', '']
        while decl and decl[-1].strip() == '': decl.pop()
        if decl: out += emit_members(decl)
        continue
    if line.startswith('//'):
        buf = []
        while i < n and src[i].startswith('//') and not is_banner(src[i]) and not is_rule(src[i]):
            t = src[i][2:]
            buf.append((t[1:] if t.startswith(' ') else t).rstrip())
            i += 1
        out += render_comment(buf)
        continue
    i += 1

res = []
for l in out:
    if l == '' and res and res[-1] == '': continue
    res.append(l)
open(sys.argv[2], 'w').write('\n'.join(res).strip() + '\n')
print(f'wrote {sys.argv[2]}: {len(res)} lines')
