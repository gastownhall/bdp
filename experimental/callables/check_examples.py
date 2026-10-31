# Finite offline experimental schema/example checks, not a provider or conformance runner.
from pathlib import Path
import argparse,copy,hashlib,json,re
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2]);p.add_argument('--receipt',type=Path);args=p.parse_args();root=args.repo
schema_path=root/'experimental/callables/callables.properties.schema.json'
paths=[schema_path,root/'specs/profiles/core/bdp-v0.1.schema.json',root/'docs/cli-design/query-ir/query.schema.json']
schemas=[json.loads(q.read_text()) for q in paths]
registry=Registry(retrieve=lambda uri: (_ for _ in ()).throw(RuntimeError('Network retrieval forbidden: '+uri)))
for s in schemas:
 Draft202012Validator.check_schema(s);registry=registry.with_resource(s['$id'],Resource.from_contents(s))
schema=schemas[0]
def validate(name,value):
 wrapper={'$schema':'https://json-schema.org/draft/2020-12/schema','$ref':schema['$id']+'#/$defs/'+name}
 return Draft202012Validator(wrapper,registry=registry).is_valid(value)
examples=json.loads((root/'experimental/callables/examples.json').read_text())['examples'];results=[]
def case(name,kind,value,expected):
 actual=validate(kind,value);assert actual==expected,(name,actual,expected)
 results.append({'case':name,'schema':kind,'expectedValid':expected,'actualValid':actual});print(('PASS: ')+name,flush=True)
for name,entry in examples.items():case('example-'+name,entry['schema'],entry['properties'],True)
q=examples['queryBody']['properties'];qe=examples['queryExtern']['properties'];b=examples['batchExtern']['properties']
x=copy.deepcopy(q);del x['description'];case('inherited-help-required','CallableQuery',x,False)
x=copy.deepcopy(q);del x['parameters'];case('inherited-parameters-required','CallableQuery',x,False)
x=copy.deepcopy(q);x['extern']={'binding':'also'};case('query-body-and-extern-refused','CallableQuery',x,False)
x=copy.deepcopy(q);del x['body'];case('query-no-implementation-refused','CallableQuery',x,False)
x=copy.deepcopy(b);del x['extern'];case('batch-no-implementation-refused','CallableBatch',x,False)
x=copy.deepcopy(b);x['body']={'capabilityVersion':'1','operations':[{'operation':'bogus'}]};del x['extern'];case('invalid-literal-batch-body-refused','CallableBatch',x,False)
x=copy.deepcopy(q);x['body']['ir']='unselected-future-ir';case('wrong-query-body-version-refused','CallableQuery',x,False)
x=copy.deepcopy(qe);x['cliMapping']['positionals'][0]['position']=-1;case('negative-positional-index-refused','CallableQuery',x,False)
x=copy.deepcopy(qe);x['cliMapping']['flags'][0]['names']=[];case('empty-flag-names-refused','CallableQuery',x,False)
x=copy.deepcopy(qe);x['cliMapping']['shell']='run something';case('imperative-cli-mapping-refused','CallableQuery',x,False)
x=copy.deepcopy(qe);x['parameters'][0]['schema']=None;case('null-value-schema-refused','CallableQuery',x,False)
x=copy.deepcopy(qe);x['parameters'][0]['schema']=False;case('boolean-value-schema-structurally-admitted','CallableQuery',x,True)
case('open-base-admits-refinement-properties','Callable',q,True)
for entry in examples.values():
 for param in entry['properties']['parameters']:
  Draft202012Validator.check_schema(param['schema'])
  if 'default' in param:assert Draft202012Validator(param['schema']).is_valid(param['default'])
for path in [root/'experimental/callables.md',root/'experimental/packs.md',root/'experimental/README.md']:
 body=path.read_text();assert body.count('```')%2==0,path
 for raw in re.findall(r'\]\(([^\s)]+)\)',body):
  if raw.startswith(('https:','http:','#')):continue
  target=raw.split('#')[0]
  assert (path.parent/target).exists(),(str(path),raw)
  if '#' in raw and target.endswith('.md'):
   anchor=raw.split('#',1)[1];heads=[]
   for line in (path.parent/target).read_text().splitlines():
    if re.match(r'^#{1,6} ',line):
     title=re.sub(r'^#{1,6} ','',line).strip().lower();title=re.sub(r'[^\w\- ]','',title);heads.append(title.replace(' ','-'))
   assert anchor in heads,(str(path),raw,heads[:10])
receipt={'status':'PASS','checks':len(results),'cases':results,'schemaMetaChecks':len(schemas),'embeddedExampleSchemasAndDefaultsChecked':True,'networkRetrieval':'forbidden','scope':'Finite structural schema/examples/link checks only; no provider, HTTP, parameter binding, effective Type admission or runtime conformance.','files':{str(q.relative_to(root)):{'sha256':hashlib.sha256(q.read_bytes()).hexdigest(),'bytes':q.stat().st_size} for q in paths}}
if args.receipt:
 args.receipt.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'status':'PASS','cases':len(results),'metaSchemas':len(schemas),'receipt':str(args.receipt) if args.receipt else None}),flush=True)
