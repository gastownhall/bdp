"""Offline review-artifact checks, not a Memory runtime or Type-profile implementation.

Run: uv run --no-project --with 'jsonschema[format]' python specs/schemas/check_memory_examples.py
"""
import argparse
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.validators import SPECIFICATIONS
from referencing import Registry, Resource
from referencing.exceptions import NoSuchResource

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--shared-schemas", type=Path, default=HERE,
                    help="Optional pinned shared-artifact snapshot for preparatory checks")
args = parser.parse_args()
K = "https://example.org/memory-types/"
F = "https://example.org/types/beads/"
MEMORY = (K + "memory", "memory-contract-1")
CHILDREN = ("observation", "decision", "procedure", "policy", "lesson")
NAMES = {"memory": "memory.properties.schema.json",
         **{name: f"memory-{name}.local-properties.schema.json" for name in CHILDREN},
         "link": "memory-link.properties.schema.json"}
SHARED_NAMES = ("type-definition.properties.schema.json",
                "bead-type-definition.properties.schema.json",
                "link-type-definition.properties.schema.json",
                "conforms-to.properties.schema.json")


def read(path):
    return json.loads(path.read_text())


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def unavailable(uri):
    raise NoSuchResource(ref=uri)


schemas = {name: read(HERE / filename) for name, filename in NAMES.items()}
shared = {name: read(args.shared_schemas / name) for name in SHARED_NAMES}
all_schemas = [*schemas.values(), *shared.values()]
registry = Registry(retrieve=unavailable).with_resources(
    list(SPECIFICATIONS.items())
    + [(schema["$id"], Resource.from_contents(schema)) for schema in all_schemas]
)
for schema in all_schemas:
    Draft202012Validator.check_schema(schema)


def validator(schema):
    return Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())


validators = {name: validator(schema) for name, schema in schemas.items()}
shared_validators = {name: validator(schema) for name, schema in shared.items()}
cases = read(HERE / "examples/memory-schema-cases.json")["cases"]
require(bool(cases), "No property cases loaded")
for case in cases:
    name = case["type"]
    selected = [validators[name]]
    if name in CHILDREN:
        selected.append(validators["memory"])
    errors = [error.message for selected_validator in selected
              for error in selected_validator.iter_errors(case["properties"])]
    require((not errors) == case["valid"], (case["label"], errors))

fixture = read(HERE / "examples/memory-types.json")
definitions = fixture["definitions"]
require(len(definitions) == 12, "Expected six Bead and six Link definitions")
by_pin = {(d["id"], d["revision"]): d for d in definitions}
require(len(by_pin) == len(definitions), "Duplicate exact domain definition")
foundation = read(args.shared_schemas / "examples/type-foundation.json")
combined = {(d["id"], d["revision"]): d for d in foundation["definitions"]}
require(not set(combined).intersection(by_pin), "Domain fixture overwrites foundation")
combined.update(by_pin)


def exact(reference):
    require(isinstance(reference, dict) and set(reference) == {"uri", "revision"},
            ("Not an exact reference", reference))
    return reference["uri"], reference["revision"]


owned_declarations = []
for definition in definitions:
    own_type = exact(definition["type"])
    require(own_type in combined, ("Missing exact metatype", own_type))
    category = own_type[0].removeprefix(F)
    require(category in {"bead-type", "link-type"}, ("Wrong category", category))
    selected = "bead-type-definition.properties.schema.json" if category == "bead-type" else "link-type-definition.properties.schema.json"
    errors = [e.message for e in shared_validators[selected].iter_errors(definition["properties"])]
    require(not errors, (definition["id"], errors))
    is_bead = category == "bead-type"
    name = definition["id"].removeprefix(K) if is_bead else "link"
    require(definition["properties"]["propertiesSchema"] == schemas[name],
            ("Embedded schema differs from owned artifact", definition["id"]))
    recorded = definition["ownedLinks"][F + "conforms-to"]
    for declaration in recorded:
        require(declaration["source"] == definition["id"], "Wrong declaration owner")
        require(exact(declaration["type"]) == (F + "conforms-to", "conformance-1"),
                "Unexpected declaration affiliation")
        require(exact(declaration["target"]) == MEMORY, "Wrong Memory ancestor pin")
        errors = list(shared_validators["conforms-to.properties.schema.json"].iter_errors(declaration["properties"]))
        require(not errors, "Invalid declaration properties")
        owned_declarations.append(declaration)
    require(len(recorded) == (1 if name in CHILDREN else 0), "Unexpected direct conformance")
require(owned_declarations == fixture["declarations"], "Recorded declarations differ from exposed copies")
require(len(owned_declarations) == 5, "Expected five direct domain declarations")


def closure(pin, active=()):
    require(pin not in active, ("Exact fixture conformance cycle", pin))
    require(pin in combined, ("Missing exact fixture definition", pin))
    result = {pin}
    for declaration in combined[pin].get("ownedLinks", {}).get(F + "conforms-to", []):
        result.update(closure(exact(declaration["target"]), (*active, pin)))
    return result


for name in CHILDREN:
    require(MEMORY in closure((K + name, name + "-contract-1")),
            ("Missing recorded Memory conformance", name))
require(by_pin[MEMORY]["properties"]["ownsOutgoing"] == [{"any": True}],
        "Base Memory must own every outgoing Link")

records = read(HERE / "examples/memory-records.json")
for record in records["records"]:
    pin = exact(record["type"])
    require(pin in by_pin, ("Unknown record affiliation", pin))
    for inherited in closure(pin):
        schema = by_pin[inherited]["properties"]["propertiesSchema"]
        errors = list(validator(schema).iter_errors(record["properties"]))
        require(not errors, (record["id"], inherited, [e.message for e in errors]))
for link in records["links"]:
    pin = exact(link["type"])
    require(pin in by_pin, ("Unknown Link affiliation", pin))
    errors = list(validators["link"].iter_errors(link["properties"]))
    require(not errors, (link["id"], [e.message for e in errors]))

print(f"PASS: {len(schemas)} owned schemas; {len(cases)} positive/negative property cases; "
      f"{len(definitions)} descriptors; {len(owned_declarations)} recorded declarations; "
      f"{len(records['records'])} Bead and {len(records['links'])} Link property excerpts.")
print("LIMIT: finite artifact shapes/copies and exact fixture closure only. "
      "No interval-order, endpoint, provenance, semantic-admission, graph-operation, "
      "History, transaction, CLI or runtime qualification.")
