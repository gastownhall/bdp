#!/usr/bin/env python3
"""Check the authored binding schema/admission fixtures; not an HTTP/provider test."""
import copy
import hashlib
import json
from pathlib import Path
import runpy
from collections import Counter
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
static = runpy.run_path(str(HERE / 'validate.py'))
AST_ADMIT = static['admit']
AST_KIND = static['collection_kind']
formats = FormatChecker()
assert 'uri' in formats.checkers
paths = [HERE / 'read-binding.schema.json', HERE / 'query.schema.json', ROOT / 'specs/profiles/core/bdp-v0.1.schema.json']
schemas = [json.loads(p.read_text()) for p in paths]
registry = Registry().with_resources((s['$id'], Resource.from_contents(s)) for s in schemas)
wire = schemas[0]
Draft202012Validator.check_schema(wire)
validators = {kind: Draft202012Validator({'$ref': wire['$id'] + '#/$defs/' + kind}, registry=registry, format_checker=formats) for kind in ['request', 'response', 'capability', 'pointProjectionCapability', 'problem']}
native = schemas[-1]
full = {kind: Draft202012Validator({'$ref': native['$id'] + '#/$defs/' + kind + 'Record'}, registry=registry, format_checker=formats) for kind in ['bead', 'link']}

def require(test, why):
    if not test:
        raise ValueError(why)

def edition(r):
    return r['id'], r['revision']

def semantic(case):
    value, kind = case['value'], case['kind']
    if kind == 'request':
        q = value['query']
        AST_ADMIT(q)
        cap = case.get('capability')
        if cap:
            require(q['profile'] in cap['profiles'], 'unsupported profile')
            require(q['result']['form'] != 'graph' or 'graph' in cap['profiles'], 'unsupported graph result')
            require(q['result']['form'] != 'count' or cap['count'], 'unsupported count')
            require('sort' not in value or cap['sort'], 'unsupported sort')
            require('projection' not in q or cap['projection'], 'unsupported projection')
            def nodes(x):
                if isinstance(x, dict):
                    if 'op' in x:
                        yield x
                    if x.get('op') == 'literal':
                        return
                    for v in x.values():
                        yield from nodes(v)
                elif isinstance(x, list):
                    for v in x:
                        yield from nodes(v)
            for node in nodes(q['selection']):
                require(node['op'] != 'walk' or node.get('depth') != 'unbounded' or cap['unboundedTraversal'], 'unsupported unbounded walk')
                require(node['op'] != 'typeIs' or node['match'] != 'family' or cap['typeFamily'], 'unsupported family')
                require(node['op'] != 'refs' or not any(isinstance(v, dict) for v in node['references']) or cap['pinnedReferences'], 'unsupported pinned refs')
        require((case['operation'] == 'list') == (q['profile'] == 'list'), 'operation/profile')
        require('limit' not in value or q['result']['form'] == 'resources', 'page on nonresources')
        require('sort' not in value or q['result']['form'] != 'graph', 'sort graph')
        return
    if kind == 'capability':
        require(value['unboundedTraversal'] is False or bool(set(value['profiles']) & {'graph', 'query'}), 'unbounded without traversal')
        return
    if kind in {'problem', 'pointProjectionCapability'}:
        return
    result = value['result']
    if result['form'] == 'count':
        return
    if result['form'] == 'resources':
        records = result['items']
        require(len({edition(r) for r in records}) == len(records), 'duplicate edition')
        if 'projection' not in result:
            for r in records:
                require(not list(full[result['resourceKind']].iter_errors(r)), 'full-record required')
        return
    beads, links = result['beads'], result['links']
    by_bead = {edition(b): b for b in beads}
    by_link = {edition(l): l for l in links}
    require(len(by_bead) == len(beads) and len(by_link) == len(links), 'duplicate edition')
    require(all(edition(r) in by_bead for r in result['roots']), 'missing root')
    mappings = {edition(m['link']): m for m in result['endpoints']}
    require(len(mappings) == len(result['endpoints']) and mappings.keys() == by_link.keys(), 'mapping cardinality')
    for key, link in by_link.items():
        for side in ['source', 'target']:
            selected = mappings[key][side]
            require(edition(selected) in by_bead, 'missing endpoint')
            authored = link[side]
            require(selected['id'] == (authored if isinstance(authored, str) else authored['uri']), 'endpoint identity')
            if isinstance(authored, dict):
                require(selected['revision'] == authored['revision'], 'endpoint pin')

cases_path = HERE / 'read-binding-cases.json'
cases = json.loads(cases_path.read_text())
assert cases['status'] == 'authored-structural-and-admission-cases-not-http-tests'
counts = Counter()
for case in cases['cases']:
    errors = list(validators[case['kind']].iter_errors(case['value']))
    if case['expect'] == 'reject-schema':
        require(errors, case['id'])
    else:
        require(not errors, (case['id'], [e.message for e in errors]))
        try:
            semantic(case)
        except (ValueError, AssertionError) as e:
            require(case['expect'] == 'reject-semantic', (case['id'], str(e)))
        else:
            require(case['expect'] == 'accept', case['id'])
    counts[case['expect']] += 1
receipt = {'status': 'schema-and-bounded-static-binding-checks-passed', 'cases': len(cases['cases']), 'checks': dict(counts), 'not_executed': ['HTTP request dispatch', 'CLI parser', 'service evaluator', 'response header and native cursor behavior', 'provider lowering'], 'files': [{'path': str(p.relative_to(ROOT)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths + [cases_path, Path(__file__)] ]}
(HERE / 'BINDING-VALIDATION.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({k:v for k,v in receipt.items() if k!='files'}, indent=2))
