"""Validate review artifacts only; this is not a BDP Type-profile implementation."""
from copy import deepcopy
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urldefrag

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.validators import SPECIFICATIONS
from referencing import Registry, Resource
from referencing.exceptions import NoSuchResource
from referencing.jsonschema import DRAFT202012

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
for resources, valid in [({}, True), ({"https://example.org/schema/value": True}, True),
                         ({"relative": True}, False),
                         ({"https://example.org/schema/value": 42}, False)]:
    check(type_name, altered(base, schemaResources=resources), valid, "schemaResources map shape")


# Explicit resource lists for finite dialect cases, not a schema-position walker.
# Discovery of resource boundaries/reference closure is still an admission obligation.
baseline_dialect = "https://json-schema.org/draft/2020-12/schema"
old_dialect = "http://json-schema.org/draft-07/schema#"
def example_resource_dialects_valid(resources):
    return all(not isinstance(resource, dict)
               or resource.get("$schema", baseline_dialect) == baseline_dialect
               for resource in resources)

nested_dialect_example = {
    "$schema": baseline_dialect,
    "$defs": {"nested": {"$id": "https://example.org/schema/nested", "$schema": old_dialect}},
}
# Root descriptor shape permits this: the separate closure check must refuse it.
check(type_name, altered(base, propertiesSchema=nested_dialect_example), True,
      "root dialect shape check does not prove closure dialects")
literal_dialect_data = {"const": {"$schema": old_dialect},
                        "examples": [{"$schema": old_dialect}]}
dialect_cases = [
    ([literal_dialect_data], True),
    ([nested_dialect_example, nested_dialect_example["$defs"]["nested"]], False),
    ([{"$ref": "https://example.org/schema/other"}, {"$schema": old_dialect}], False),
    ([{"$schema": baseline_dialect}, {"$id": "https://example.org/schema/nested"}], True),
]
for resources, valid in dialect_cases:
    assert example_resource_dialects_valid(resources) == valid

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
                  (endpoint(selector["anyOf"], "cross"), True),
                  (endpoint(selector["anyOf"], "either"), True),
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
def check_owned_declaration_sources(candidate):
    declarations = candidate["declarations"]
    exact_declarations = {(d["id"], d["revision"]) for d in declarations}
    assert len(exact_declarations) == len(declarations), "duplicate exact declaration"
    for declaration in declarations:
        sources = [d for d in candidate["definitions"] if d["id"] == declaration["source"]]
        # This finite seed has one definition revision per identity.
        assert len(sources) == 1, "source absent or ambiguous in finite seed"
        assert declaration in sources[0]["ownedLinks"][conforms_id], "declaration absent from source owned state"
    for owner in candidate["definitions"]:
        for declaration in owner["ownedLinks"][conforms_id]:
            assert declaration["source"] == owner["id"], "owned declaration source differs from owner"
            assert declaration in declarations, "owned declaration absent from declaration table"


fixture_refusals = 0


def rejects_fixture_mutation(checker, candidate, expected_reason):
    global fixture_refusals
    try:
        checker(candidate)
    except AssertionError as error:
        assert str(error) == expected_reason, ("unexpected mutation refusal", str(error))
    else:
        raise AssertionError("invalid fixture mutation accepted: " + expected_reason)
    fixture_refusals += 1


check_owned_declaration_sources(fixture)
# A declaration copied into a second owner's snapshot must not manufacture
# conformance, even when it remains in both the global table and correct owner.
for mutation in ("copy", "move", "remove"):
    candidate = deepcopy(fixture)
    declaration = candidate["declarations"][0]
    source = next(d for d in candidate["definitions"] if d["id"] == declaration["source"])
    other = next(d for d in candidate["definitions"] if d["id"] != source["id"])
    if mutation in {"copy", "move"}:
        other["ownedLinks"][conforms_id].append(deepcopy(declaration))
    if mutation in {"move", "remove"}:
        source["ownedLinks"][conforms_id].remove(declaration)
    reason = ("owned declaration source differs from owner" if mutation == "copy"
              else "declaration absent from source owned state")
    rejects_fixture_mutation(check_owned_declaration_sources, candidate, reason)
candidate = deepcopy(fixture)
candidate["declarations"].append(deepcopy(candidate["declarations"][0]))
rejects_fixture_mutation(check_owned_declaration_sources, candidate, "duplicate exact declaration")

for declaration in fixture["declarations"]:
    check(conformance_name, declaration["properties"], True, declaration["id"])
    source = next(d for d in definitions if d["id"] == declaration["source"])
    target = by_pin[pin_of(declaration["target"])]
    assert category(source) == category(target)
    assert by_pin[pin_of(declaration["type"])]["id"] == conforms_id

def closure(pin, visiting=(), records=by_pin):
    assert pin not in visiting, ("example conformance cycle", pin)
    result = set()
    for declaration in records[pin]["ownedLinks"][conforms_id]:
        target = pin_of(declaration["target"])
        result.add(target)
        result.update(closure(target, visiting + (pin,), records))
    return result

for pin in by_pin:
    closure(pin)
for label, file_name in [("type", type_name), ("bead-type", bead_name), ("link-type", link_name),
                          ("conforms-to", conformance_name), ("issue", issue_name), ("dependency", dependency_name)]:
    definition = next(d for d in definitions if d["id"] == prefix + label)
    assert definition["properties"]["propertiesSchema"] == SCHEMAS[file_name]

# Check pair correlation using the finite foundation graph's exact Type closure.
def matches(types, reference, records=by_pin):
    if types == ["*"]:
        return True
    p = pin_of(reference)
    members = {p} | closure(p, records=records)
    return any((any(member[0] == t for member in members) if isinstance(t, str)
                else pin_of(t) in members) for t in types)

def check_effective_ownership(candidate):
    # Definition Beads use their own Bead-Type affiliation's inherited selectors;
    # this says nothing about ownership by Link instances they may describe.
    records = {(d["id"], d["revision"]): d for d in candidate["definitions"]}
    for owner in candidate["definitions"]:
        affiliation = pin_of(owner["type"])
        ancestors = {affiliation} | closure(affiliation, records=records)
        selectors = [selector for ancestor in ancestors
                     for selector in records[ancestor]["properties"].get("ownsOutgoing", [])]
        for declaration in owner["ownedLinks"][conforms_id]:
            assert any(selector.get("any") is True or
                       matches(selector["anyOf"], declaration["type"], records)
                       for selector in selectors), "owned declaration lacks effective ownership selector"


check_effective_ownership(fixture)
candidate = deepcopy(fixture)
next(d for d in candidate["definitions"] if d["id"] == prefix + "type")["properties"].pop("ownsOutgoing")
rejects_fixture_mutation(check_effective_ownership, candidate,
                         "owned declaration lacks effective ownership selector")


def check_seed_endpoint_domain(candidate):
    # The fixture explicitly uses https://example.org/types/ as its sole Scope
    # and beads/ as its definition path. This is not a production URI parser.
    assert all(d["id"].startswith(prefix) for d in candidate["definitions"]), "definition outside finite seed Bead namespace"
    conforms = next(d for d in candidate["definitions"] if d["id"] == conforms_id)
    for pair in conforms["properties"]["linkConstraints"]["typeConstraints"]:
        for side in ("source", "target"):
            endpoint = pair[side]
            assert endpoint["resourceKind"] == "bead", "finite seed endpoint must be a Bead"
            assert endpoint["scope"] in {"same", "either"}, "finite seed endpoint scope excludes same-Scope definitions"


# Type matching below is valid only after checking the finite endpoint domain;
# it must not accidentally accept a relabelled cross-Scope or non-Bead arm.
check_seed_endpoint_domain(fixture)
for field, value, reason in (
    ("scope", "cross", "finite seed endpoint scope excludes same-Scope definitions"),
    ("resourceKind", "resource", "finite seed endpoint must be a Bead"),
):
    candidate = deepcopy(fixture)
    conforms = next(d for d in candidate["definitions"] if d["id"] == conforms_id)
    conforms["properties"]["linkConstraints"]["typeConstraints"][0]["source"][field] = value
    rejects_fixture_mutation(check_seed_endpoint_domain, candidate, reason)
candidate = deepcopy(fixture)
candidate["definitions"][0]["id"] = "https://other.example/types/beads/type"
rejects_fixture_mutation(check_seed_endpoint_domain, candidate, "definition outside finite seed Bead namespace")

def fixture_endpoint_matches(arm, actual_scope, exact_type, registered_exact_definition=False, endpoint_revision=None):
    # Facts are stipulated for these finite examples, not obtained from a URI parser,
    # network resolver or implemented registry. Foreign checked cases use exact state.
    if arm["resourceKind"] != "bead" or arm["scope"] not in {"either", actual_scope}:
        return False
    if arm["types"] == ["*"]:
        return True
    if actual_scope == "cross" and (not registered_exact_definition or not endpoint_revision):
        return False
    return exact_type is not None and matches(arm["types"], exact_type)


bead_meta = {"uri": prefix + "bead-type", "revision": "bead-type-1"}
link_meta = {"uri": prefix + "link-type", "revision": "link-type-1"}
endpoint_fact_cases = [
    ("same", "same", bead_meta, False, True),
    ("cross", "cross", bead_meta, True, True),
    ("either", "cross", bead_meta, True, True),
    ("same", "cross", bead_meta, True, False),
    ("cross", "same", bead_meta, True, False),
    ("cross", "cross", bead_meta, False, False),
    ("either", "cross", link_meta, True, False),
    ("either", "cross", None, True, False),
]
for declared_scope, actual_scope, exact_type, registered, expected in endpoint_fact_cases:
    arm = endpoint([bead_meta], declared_scope)
    assert fixture_endpoint_matches(arm, actual_scope, exact_type, registered, "definition-1") == expected
assert fixture_endpoint_matches(endpoint(["*"], "cross"), "cross", None)
assert not fixture_endpoint_matches(endpoint([bead_meta], "either"), "cross", bead_meta, True)

conforms = next(d for d in definitions if d["id"] == conforms_id)
pairs = conforms["properties"]["linkConstraints"]["typeConstraints"]
assert all(p[side]["scope"] == "either" for p in pairs for side in ("source", "target"))
for source in definitions:
    for target in definitions:
        matched = any(fixture_endpoint_matches(p["source"], "same", source["type"]) and
                      fixture_endpoint_matches(p["target"], "same", target["type"]) for p in pairs)
        assert matched == (category(source) == category(target))
assert "acyclic" not in conforms["properties"]["linkConstraints"]
# Identity-wide selectors are not aliases for the latest revision.
task_ref = {"uri": prefix + "task", "revision": "task-1"}
assert matches([prefix + "issue"], task_ref)
assert matches([{"uri": prefix + "issue", "revision": "issue-1"}], task_ref)
assert not matches([{"uri": prefix + "issue", "revision": "issue-2"}], task_ref)
assert not matches([prefix + "dependency"], task_ref)

# Exact-target traversal permits same-identity earlier-revision conformance, but
# still refuses exact cycles. These minimal records test the traversal only,
# not bootstrap, declaration-Type admission, registration or publication.
version_records = deepcopy(by_pin)
task_v2 = (prefix + "task", "task-2")
version_records[task_v2] = {"ownedLinks": {conforms_id: [{"target": task_ref}]}}
assert closure(task_v2, records=version_records) == {pin_of(task_ref), (prefix + "issue", "issue-1")}
version_records[pin_of(task_ref)]["ownedLinks"][conforms_id].append(
    {"target": {"uri": task_v2[0], "revision": task_v2[1]}})
try:
    closure(task_v2, records=version_records)
except AssertionError as error:
    assert error.args[0][0] == "example conformance cycle"
else:
    raise AssertionError("exact-revision cycle accepted")


# Finite 2020-12 composition examples: every contract validates unchanged.
composition = json.loads((HERE / "schema-composition-cases.json").read_text())
composition_validators = {}
for name, schema in composition["schemas"].items():
    Draft202012Validator.check_schema(schema)
    composition_validators[name] = Draft202012Validator(schema, registry=registry)
assert composition["schemas"]["closedProduct"] == {
    **composition["schemas"]["product"], "additionalProperties": False
}, "closed Product changes more than additionalProperties"

for case in composition["cases"]:
    individual = [composition_validators[name].is_valid(case["instance"])
                  for name in case["contracts"]]
    # Independently validated roots above become non-resource-root branches here.
    # Remove only their root dialect declaration; no assertion/closure is rewritten.
    combined = {"$schema": baseline_dialect, "allOf": [
        {key: value for key, value in composition["schemas"][name].items() if key != "$schema"}
        for name in case["contracts"]]}
    Draft202012Validator.check_schema(combined)
    composed = Draft202012Validator(combined, registry=registry).is_valid(case["instance"])
    assert all(individual) == composed == case["valid"], (case["label"], individual, composed)
composition_text = (HERE / "types.md").read_text().split("### 3.4 ", 1)[1].split("### 3.5 ", 1)[0]
inline_composition = [json.loads(block) for block in re.findall(r"```json\n(.*?)\n```", composition_text, re.S)]
assert inline_composition == [composition["schemas"][name] for name in (
    "product", "approval", "closedChildMissingInherited", "closedChild")], "inline composition schema drift"


# Self-contained fixture closure, not a generic schema admission/resolution service.
def fixture_schema_references(schema, base_uri):
    resource = Resource.from_contents(schema, default_specification=DRAFT202012)
    current = urljoin(base_uri, resource.id() or "")
    if isinstance(schema, dict):
        for keyword in ("$schema", "$ref", "$dynamicRef"):
            if keyword in schema:
                uri = urldefrag(urljoin(current, schema[keyword]))[0]
                if uri:
                    yield uri
    for child in resource.subresources():
        yield from fixture_schema_references(child.contents, current)


def check_fixture_schema_maps(candidate):
    for definition in candidate["definitions"]:
        root = definition["properties"]["propertiesSchema"]
        retained = definition["properties"].get("schemaResources", {})
        root_uri = root.get("$id", "") if isinstance(root, dict) else ""
        pending = list(fixture_schema_references(root, root_uri))
        visited = {root_uri}
        while pending:
            uri = pending.pop()
            if uri in visited:
                continue
            visited.add(uri)
            assert uri in retained, "fixture schema resource missing"
            pending.extend(fixture_schema_references(retained[uri], uri))


check_fixture_schema_maps(fixture)
for definition in definitions:
    for uri, schema in definition["properties"].get("schemaResources", {}).items():
        # Source-copy comparison, not just a test that altered copies accept examples.
        expected = (SPECIFICATIONS[uri].contents if uri.startswith("https://json-schema.org/")
                    else next(s for s in SCHEMAS.values() if s["$id"] == uri))
        assert schema == expected, ("retained schema copy drift", uri)
    metatype = by_pin[pin_of(definition["type"])]["properties"]
    offline = Registry(retrieve=unavailable).with_resources([
        (uri, Resource.from_contents(schema, default_specification=DRAFT202012))
        for uri, schema in metatype.get("schemaResources", {}).items()])
    Draft202012Validator(metatype["propertiesSchema"], registry=offline,
                        format_checker=FormatChecker()).validate(definition["properties"])
candidate = deepcopy(fixture)
next(d for d in candidate["definitions"] if d["id"] == prefix + "type")["properties"]["schemaResources"].pop(
    "https://json-schema.org/draft/2020-12/meta/core")
rejects_fixture_mutation(check_fixture_schema_maps, candidate, "fixture schema resource missing")


# The documented map example resolves a relative reference offline from an explicit base.
map_text = (HERE / "types.md").read_text().split("### 3.12 ", 1)[1].split("### 3.13 ", 1)[0]
map_example = json.loads(re.findall(r"```json\n(.*?)\n```", map_text, re.S)[0])
check(type_name, map_example, True, "inline retained schema map")
map_registry = Registry(retrieve=unavailable).with_resources([
    (uri, Resource.from_contents(schema, default_specification=DRAFT202012))
    for uri, schema in map_example["schemaResources"].items()])
map_validator = Draft202012Validator(map_example["propertiesSchema"], registry=map_registry)
assert map_validator.is_valid({"price": 1})
assert not map_validator.is_valid({"price": -1})
# Guard the object-only caveat; no generic static admission solver is claimed.
assert Draft202012Validator({"type": ["string", "object"], "required": ["x"],
                            "maxProperties": 0}).is_valid("ok")


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
      f"{fixture_refusals} invalid fixture mutations refused; "
      f"{len(composition['cases'])} schema composition cases; {len(dialect_cases)} finite resource-dialect cases; "
      f"{len(endpoint_fact_cases) + 2} finite endpoint fact cases; 2 revision-closure cases; "
      "example closure, embedded copies, domain property cases and local links consistent. No runtime qualification.")
