"""Validate review artifacts only; this is not a BDP Type-profile implementation."""
from copy import deepcopy
import json
from pathlib import Path
import re

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.validators import SPECIFICATIONS
from referencing import Registry, Resource
from referencing.exceptions import NoSuchResource

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "specs/profiles/types"
ISSUE = ROOT / "specs/types/issue"
NAMES = (
    "type-definition.properties.schema.json",
    "bead-type-definition.properties.schema.json",
    "link-type-definition.properties.schema.json",
    "conforms-to.properties.schema.json",
    "issue.properties.schema.json",
    "dependency.properties.schema.json",
)
SCHEMAS = {name: json.loads(((ISSUE if name in {"issue.properties.schema.json", "dependency.properties.schema.json"} else HERE) / name).read_text()) for name in NAMES}


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


type_name, bead_name, link_name, conformance_name, issue_name, dependency_name = NAMES
fixture = json.loads((HERE / "definitions.json").read_text())
definitions = fixture["definitions"]
by_pin = {(d["id"], d["revision"]): d for d in definitions}
assert len(by_pin) == len(definitions)
prefix = "https://example.org/types/beads/"
conforms_id = prefix + "conforms-to"

def pin_of(reference):
    return reference["uri"], reference["revision"]

def category(definition):
    return definition["type"]["uri"].removeprefix(prefix)

for definition in definitions:
    own_type = by_pin[pin_of(definition["type"])]
    assert category(definition) in {"bead-type", "link-type"}
    assert own_type["id"] == prefix + category(definition)
    check(bead_name if category(definition) == "bead-type" else link_name,
          definition["properties"], True, definition["id"])

base = {"description": "Example", "propertiesSchema": {"type": "object"}}
for key in ["propertiesSchema"]:
    candidate = deepcopy(base)
    del candidate[key]
    check(type_name, candidate, False, "missing " + key)
for key, value in [("description", 42), ("describes", "bead"), ("propertiesSchema", "https://example.org/schema"),
                   ("propertiesSchema", {"type": 42}), ("propertiesSchema", {"required": "title"}),
                   ("propertiesSchema", {"$schema": "http://json-schema.org/draft-07/schema#"}),
                   ("conformsTo", []), ("id", "https://example.org/type"), ("revision", "r1"),
                   ("ownedLinks", {}), ("source", {}), ("pairUnique", True)]:
    check(type_name, altered(base, **{key: value}), False, "invalid " + key + repr(value))
check(type_name, {"propertiesSchema": {"type": "object"}}, True, "identity is envelope; no display-name field needed")
check(type_name, altered(base, propertiesSchema=True), True, "explicit permissive schema")
check(type_name, altered(base, propertiesSchema=False), True, "false schema is syntax-valid only")
check(type_name, altered(base, extensionNote="example"), True, "open descriptor root")
for version, valid in [("2.1.0", True), ("0.1.0-rc.1+build.3", True), ("1.0.0-01", False),
                       ("01.2.3", False), ("v1.2.3", False), ("1.2", False), (3, False)]:
    check(type_name, altered(base, version=version), valid, "proposed version " + str(version))
selector = {"anyOf": [{"uri": prefix + "dependency", "revision": "d1"}]}
for selected, valid in [(selector, True), ({"any": True}, True), ({"anyOf": []}, False),
                        ({"anyOf": [prefix + "dependency"]}, True),
                        ({"anyOf": [{"uri": "relative", "revision": "d1"}]}, False),
                        ({"anyOf": [{"uri": prefix + "t", "revision": ""}]}, False),
                        ({"allOf": [selector]}, False), ({"any": True, "anyOf": [prefix + "t"]}, False)]:
    check(bead_name, altered(base, ownsOutgoing=[selected]), valid, "ownership " + repr(selected))
for bounds, valid in [({"min": 1, "max": 1}, True), ({"max": 0}, True), ({"min": 0}, True),
                       ({"min": -1}, False), ({"max": 1.5}, False), ({}, False),
                       ({"min": 3, "max": 2}, True)]:
    check(bead_name, altered(base, outgoing=[{"linkTypes": selector, **bounds}]), valid, "participation " + repr(bounds))

def endpoint(types, scope="same"):
    return {"resourceKind": "bead", "scope": scope, "types": types}

pair = {"source": endpoint(selector["anyOf"]), "target": endpoint(["*"])}
link = altered(base, linkConstraints={"typeConstraints": [pair]})
check(link_name, link, True, "Link descriptor")
check(link_name, base, False, "missing Link constraints")
check(bead_name, link, False, "Bead descriptor cannot declare Link constraints")
for key in ["source", "target"]:
    candidate = deepcopy(pair)
    del candidate[key]
    check(link_name, altered(base, linkConstraints={"typeConstraints": [candidate]}), False, "missing endpoint " + key)
for ep, valid in [(endpoint(["*"]), True), (endpoint([prefix + "issue"]), True),
                  (endpoint([]), False), (endpoint(["*", prefix + "issue"]), False),
                  (endpoint([{"uri": prefix + "issue", "revision": ""}]), False),
                  (endpoint(["*"], "cross"), True), (endpoint(["*"], "either"), True),
                  (endpoint(selector["anyOf"], "cross"), False),
                  (endpoint(selector["anyOf"], "either"), False),
                  ({"resourceKind": "resource"}, True),
                  ({"resourceKind": "resource", "types": ["*"]}, False),
                  ({"resourceKind": "link"}, False),
                  ({**endpoint(["*"]), "pinMode": "pinned"}, False)]:
    check(link_name, altered(base, linkConstraints={"typeConstraints": [{**pair, "source": ep}]}), valid, "endpoint " + repr(ep))
for constraints, valid in [({"typeConstraints": []}, False), ({}, False),
                           ({"typeConstraints": [pair], "sourceMax": 0, "targetMax": 2}, True),
                           ({"typeConstraints": [pair], "targetMax": -1}, False),
                           ({"typeConstraints": [pair], "sourceMin": 1}, False),
                           ({"typeConstraints": [pair], "unique": True, "acyclic": True}, True),
                           ({"typeConstraints": [pair], "unique": False, "acyclic": False}, True),
                           ({"typeConstraints": [pair], "acyclic": "yes"}, False)]:
    check(link_name, altered(base, linkConstraints=constraints), valid, "constraints " + repr(constraints))
for key in ["ownsOutgoing", "incoming", "outgoing"]:
    check(link_name, altered(link, **{key: []}), False, "Link descriptor cannot declare " + key)
check(conformance_name, {}, True, "empty base conformance properties")
check(conformance_name, {"reviewRef": "https://example.org/review"}, True, "extension property structure")
check(conformance_name, [], False, "conformance properties must be object")

# Final-state fixture consistency, not a generic admission implementation.
for declaration in fixture["declarations"]:
    check(conformance_name, declaration["properties"], True, declaration["id"])
    source = next(d for d in definitions if d["id"] == declaration["source"])
    target = by_pin[pin_of(declaration["target"])]
    assert category(source) == category(target)
    assert declaration in source["ownedLinks"][conforms_id]
    assert by_pin[pin_of(declaration["type"])]["id"] == conforms_id
for definition in definitions:
    for declaration in definition["ownedLinks"][conforms_id]:
        assert declaration in fixture["declarations"]

def closure(pin, visiting=()):
    assert pin not in visiting, ("example conformance cycle", pin)
    result = set()
    for declaration in by_pin[pin]["ownedLinks"][conforms_id]:
        target = pin_of(declaration["target"])
        result.add(target)
        result.update(closure(target, visiting + (pin,)))
    return result

for pin in by_pin:
    closure(pin)
for label, file_name in [("type", type_name), ("bead-type", bead_name), ("link-type", link_name),
                          ("conforms-to", conformance_name), ("issue", issue_name), ("dependency", dependency_name)]:
    definition = next(d for d in definitions if d["id"] == prefix + label)
    assert definition["properties"]["propertiesSchema"] == SCHEMAS[file_name]

# Check pair correlation using the finite foundation graph's exact Type closure.
def matches(types, reference):
    if types == ["*"]:
        return True
    p = pin_of(reference)
    members = {p} | closure(p)
    return any((any(member[0] == t for member in members) if isinstance(t, str)
                else pin_of(t) in members) for t in types)

conforms = next(d for d in definitions if d["id"] == conforms_id)
pairs = conforms["properties"]["linkConstraints"]["typeConstraints"]
for source in definitions:
    for target in definitions:
        matched = any(matches(p["source"]["types"], source["type"]) and
                      matches(p["target"]["types"], target["type"]) for p in pairs)
        assert matched == (category(source) == category(target))
assert "acyclic" not in conforms["properties"]["linkConstraints"]
# Identity-wide selectors are not aliases for the latest revision.
task_ref = {"uri": prefix + "task", "revision": "task-1"}
assert matches([prefix + "issue"], task_ref)
assert matches([{"uri": prefix + "issue", "revision": "issue-1"}], task_ref)
assert not matches([{"uri": prefix + "issue", "revision": "issue-2"}], task_ref)
assert not matches([prefix + "dependency"], task_ref)


# Illustrative domain properties keep these shape cases independent of the separate domain spec.
domain_cases = json.loads((ROOT / "fixtures/specs/issue/domain-property-cases.json").read_text())
issue_instance = domain_cases["issue"]
check(issue_name, issue_instance, True, "Issue payload")
check(dependency_name, domain_cases["dependency"], True, "Dependency payload")
for key, value, valid in [("priority", 0, True), ("priority", 5, False), ("title", "", False),
                          ("issue_type", "task", False), ("estimated_minutes", -1, False),
                          ("estimated_minutes", None, True), ("due_at", "bad-date", False),
                          ("extensionNote", "preserved", True)]:
    check(issue_name, altered(issue_instance, **{key: value}), valid, "Issue " + key)
check(dependency_name, {"dep_type": "blocks"}, False, "removed Dependency discriminator")
check(dependency_name, {"extensionNote": "preserved"}, True, "open Dependency properties")

# The recovered Issue draft embeds these fragments; only document annotations differ.
issue_text = (ISSUE / "issue.md").read_text()
inline = [json.loads(block) for block in re.findall(r"```json\n(.*?)\n```", issue_text, re.S)]
inline_schemas = [block for block in inline if "$schema" in block]
assert len(inline_schemas) == 2
for name, block in zip((issue_name, dependency_name), inline_schemas):
    artifact = {key: value for key, value in SCHEMAS[name].items()
                if key not in {"$id", "title", "$comment"}}
    assert block == artifact, (name, "inline properties schema drift")

for path in [HERE / "types.md", HERE / "README.md", ISSUE / "issue.md"]:
    text = path.read_text()
    assert text.count("```") % 2 == 0, path
    for destination in re.findall(r"\]\(([^)]+)\)", text):
        if ":" not in destination and not destination.startswith("#"):
            assert (path.parent / destination.split("#", 1)[0]).exists(), (path, destination)
print(f"PASS: {len(SCHEMAS)} schemas; {count} positive/negative shape cases; "
      f"{len(definitions)} definition records; {len(fixture['declarations'])} owned declarations; "
      "example closure, embedded copies, domain property cases and local links consistent. No runtime qualification.")
