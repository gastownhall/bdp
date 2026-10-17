"""Offline WIP review-vector checks; no endpoint, receipt or atomicity qualification."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.validators import SPECIFICATIONS
from referencing import Registry, Resource
from referencing.exceptions import NoSuchResource

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "specs/proposals/batch-subsets"
bundle = json.loads((ROOT / "specs/profiles/core/bdp-v0.schema.json").read_text())
schema = json.loads((HERE / "support-cases.schema.json").read_text())

def unavailable(uri):
    raise NoSuchResource(ref=uri)

registry = Registry(retrieve=unavailable).with_resources(list(SPECIFICATIONS.items()) + [(bundle["$id"], Resource.from_contents(bundle))])
Draft202012Validator.check_schema(schema)
Draft202012Validator.check_schema(bundle)
request = Draft202012Validator({"$ref": bundle["$id"] + "#/$defs/batchRequest"}, registry=registry, format_checker=FormatChecker())
cases = json.loads((HERE / "examples/support-cases.json").read_text())
Draft202012Validator(schema).validate(cases)
supported = {"createBead", "updateBead", "deleteBead", "createLink", "updateLink", "deleteLink"}
for case in cases:
    body = case["request"]
    if list(request.iter_errors(body)):
        actual = {"classification": "malformed"}
    else:
        first = next(((i, op["operation"]) for i, op in enumerate(body["operations"]) if op["operation"] not in supported), None)
        actual = {"classification": "supported-shape"} if first is None else {"classification": "unsupported", "pointer": f"/operations/{first[0]}/operation", "operation": first[1]}
    assert actual == case["expected"], (case["name"], actual, case["expected"])
print(f"PASS: {len(cases)} batch support review vectors; no runtime/receipt/atomicity claim")
