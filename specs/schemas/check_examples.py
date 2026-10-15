"""Validate review artifacts only; this is not a BDP Type-profile implementation."""
from copy import deepcopy
import json
from pathlib import Path
import re

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.validators import SPECIFICATIONS
from referencing import Registry, Resource
from referencing.exceptions import NoSuchResource

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
NAMES = (
    "type-definition.properties.schema.json",
    "conforms-to.properties.schema.json",
    "issue.properties.schema.json",
    "dependency.properties.schema.json",
)
SCHEMAS = {name: json.loads((HERE / name).read_text()) for name in NAMES}


def unavailable(uri):
    raise NoSuchResource(ref=uri)


# Preload both the standard meta-schemas and our draft artifacts. No URL fetches.
registry = Registry(retrieve=unavailable).with_resources(
    list(SPECIFICATIONS.items())
    + [(s["$id"], Resource.from_contents(s)) for s in SCHEMAS.values()]
)
for schema in SCHEMAS.values():
    Draft202012Validator.check_schema(schema)
validators = {
    name: Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())
    for name, schema in SCHEMAS.items()
}
count = 0


def check(name, instance, expected, label):
    global count
    errors = list(validators[name].iter_errors(instance))
    assert (not errors) == expected, (label, [e.message for e in errors])
    count += 1


def altered(base, **fields):
    result = deepcopy(base)
    result.update(fields)
    return result


type_name, conformance_name, issue_name, dependency_name = NAMES
fixture = json.loads((HERE / "examples/type-foundation.json").read_text())
definitions = fixture["definitions"]
by_pin = {(d["id"], d["revision"]): d for d in definitions}
assert len(by_pin) == len(definitions)
for definition in definitions:
    check(type_name, definition["properties"], True, definition["properties"]["name"])
    own_type = definition["type"]
    assert by_pin[(own_type["uri"], own_type["revision"])]["properties"]["name"] == "Type"

base = {"name": "Example", "describes": "bead", "propertiesSchema": {"type": "object"}}
for key in base:
    candidate = deepcopy(base)
    del candidate[key]
    check(type_name, candidate, False, "missing " + key)
for key, value in [("name", ""), ("describes", "resource"), ("propertiesSchema", "https://example.org/schema"),
                   ("propertiesSchema", {"type": 42}), ("propertiesSchema", {"required": "title"}),
                   ("propertiesSchema", {"$schema": "http://json-schema.org/draft-07/schema#"}),
                   ("conformsTo", []), ("id", "https://example.org/type"), ("revision", "r1"),
                   ("ownedLinks", {}), ("source", {"types": {"any": True}}), ("pairUnique", True)]:
    check(type_name, altered(base, **{key: value}), False, "invalid " + key + repr(value))
check(type_name, altered(base, propertiesSchema=True), True, "explicit permissive schema")
check(type_name, altered(base, propertiesSchema=False), True, "false schema is syntax-valid only")
check(type_name, altered(base, extensionNote="example"), True, "open descriptor root")
selector = {"anyOf": [{"uri": "https://example.org/types/beads/dependency", "revision": "d1"}]}
for selected, valid in [(selector, True), ({"any": True}, True), ({"anyOf": []}, False),
                        ({"anyOf": ["https://example.org/types/beads/dependency"]}, True),
                        ({"anyOf": [{"uri": "relative", "revision": "d1"}]}, False),
                        ({"anyOf": [{"uri": "https://example.org/t", "revision": ""}]}, False),
                        ({"allOf": [selector]}, False), ({"any": True, "anyOf": ["https://example.org/t"]}, False)]:
    check(type_name, altered(base, ownsOutgoing=[selected]), valid, "ownership selector " + repr(selected))
for bounds, valid in [({"min": 1, "max": 1}, True), ({"max": 0}, True), ({"min": 0}, True),
                       ({"min": -1}, False), ({"max": 1.5}, False), ({}, False),
                       ({"min": 3, "max": 2}, True)]:
    check(type_name, altered(base, outgoing=[{"linkTypes": selector, **bounds}]), valid, "participation " + repr(bounds))
link = {"name": "Relation", "describes": "link", "propertiesSchema": {"type": "object"},
        "source": {"types": selector}, "target": {"types": {"any": True}}}
check(type_name, link, True, "Link descriptor")
for key in ["source", "target"]:
    candidate = deepcopy(link)
    del candidate[key]
    check(type_name, candidate, False, "missing endpoint " + key)
for endpoint, valid in [({"types": selector, "max": 0}, True), ({"types": selector, "min": 1}, False),
                         ({"types": selector, "max": -1}, False), ({"types": selector, "external": "mystery"}, False)]:
    check(type_name, altered(link, source=endpoint), valid, "Link source " + repr(endpoint))
for key in ["ownsOutgoing", "incoming", "outgoing"]:
    check(type_name, altered(link, **{key: []}), False, "Link descriptor cannot declare " + key)
check(type_name, altered(link, pairUnique=True), True, "declared pair uniqueness")
check(conformance_name, {}, True, "empty base conformance properties")
check(conformance_name, {"reviewRef": "https://example.org/review"}, True, "extension property structure")
check(conformance_name, [], False, "conformance properties must be object")

# Example Links must be the exact records captured by their example owners.
conforms_id = "https://example.org/types/beads/conforms-to"
for declaration in fixture["declarations"]:
    check(conformance_name, declaration["properties"], True, declaration["id"])
    source = next(d for d in definitions if d["id"] == declaration["source"])
    target = by_pin[(declaration["target"]["uri"], declaration["target"]["revision"])]
    assert source["properties"]["describes"] == target["properties"]["describes"]
    assert declaration in source["ownedLinks"][conforms_id]
    link_type = declaration["type"]
    assert by_pin[(link_type["uri"], link_type["revision"])]["properties"]["name"] == "ConformsTo"
for definition in definitions:
    for declaration in definition["ownedLinks"][conforms_id]:
        assert declaration in fixture["declarations"]

# The seed has reference dependencies but no conformance cycle. This checks the
# finite example only, not generic admission, source-pin semantics or live indexes.
def closure(pin, visiting=()):
    assert pin not in visiting, ("example conformance cycle", pin)
    result = set()
    for declaration in by_pin[pin]["ownedLinks"][conforms_id]:
        target = (declaration["target"]["uri"], declaration["target"]["revision"])
        result.add(target)
        result.update(closure(target, visiting + (pin,)))
    return result

for pin in by_pin:
    closure(pin)
for bead_name, file_name in [("Type", type_name), ("ConformsTo", conformance_name),
                             ("issue", issue_name), ("dependency", dependency_name)]:
    definition = next(d for d in definitions if d["properties"]["name"] == bead_name)
    assert definition["properties"]["propertiesSchema"] == SCHEMAS[file_name]

# Inline domain fragments mirror these review artifacts, apart from document annotations.
issue_doc = (ROOT / "specs/types/issue.md").read_text()
blocks = [json.loads(b) for b in re.findall(r"```json\n(.*?)\n```", issue_doc, re.S)]
assert len(blocks) == 4
for inline, name in zip(blocks[:2], [issue_name, dependency_name]):
    artifact = {k: v for k, v in SCHEMAS[name].items() if k not in ["$id", "title", "$comment"]}
    assert inline == artifact, name + " drifted from prose"
issue_instance = blocks[2]["properties"]
check(issue_name, issue_instance, True, "Issue payload")
check(dependency_name, blocks[3]["properties"], True, "Dependency payload")
for key, value, valid in [("priority", 0, True), ("priority", 5, False), ("title", "", False),
                          ("issue_type", "task", False), ("estimated_minutes", -1, False),
                          ("estimated_minutes", None, True), ("due_at", "bad-date", False),
                          ("extensionNote", "preserved", True)]:
    check(issue_name, altered(issue_instance, **{key: value}), valid, "Issue " + key)
check(dependency_name, {"dep_type": "blocks"}, False, "removed Dependency discriminator")
check(dependency_name, {"extensionNote": "preserved"}, True, "open Dependency properties")

for path in [ROOT / "specs/types.md", ROOT / "specs/types/issue.md", HERE / "README.md"]:
    text = path.read_text()
    assert text.count("```") % 2 == 0, path
    for destination in re.findall(r"\]\(([^)]+)\)", text):
        if ":" not in destination and not destination.startswith("#"):
            assert (path.parent / destination.split("#", 1)[0]).exists(), (path, destination)
print(f"PASS: {len(SCHEMAS)} schemas; {count} positive/negative shape cases; "
      f"{len(definitions)} definition records; {len(fixture['declarations'])} owned declarations; "
      "example closure, embedded copies, domain prose and local links consistent. No runtime qualification.")
