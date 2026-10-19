"""HISTORICAL Memory property checks for catalog 3025dc7; not current v0.2 validation.

Run: uv run --no-project --with 'jsonschema[format]' python scripts/check_memory_examples.py
Add --with-bdp-exploration to check the separate, nonnormative definition graph.
Neither mode validates the current Memory catalog or qualifies native Memory operations.
"""
import argparse
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.validators import SPECIFICATIONS
from referencing import Registry, Resource
from referencing.exceptions import NoSuchResource

ROOT = Path(__file__).resolve().parent.parent
MEMORY_DIR = ROOT / "specs/types/memory"
FIXTURES = ROOT / "fixtures/specs/memory"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--with-bdp-exploration", action="store_true",
                    help="Also validate the nonnormative BDP definition/closure experiment")
parser.add_argument("--shared-schemas", type=Path, default=ROOT / "specs/profiles/types",
                    help="Shared experimental schemas, used only with --with-bdp-exploration")
args = parser.parse_args()
print("HISTORICAL CATALOG 3025dc7 ONLY: these schemas and fixtures do not validate "
      "the current v0.2 Memory catalog or its runtime implementation.")
K = "https://example.org/memory-types/"
F = "https://example.org/types/beads/"
MEMORY = (K + "memory", "memory-contract-1")
CHILDREN = ("policy", "decision", "procedure", "specification", "requirement", "scenario", "proposal")
NAMES = {"memory": "memory.properties.schema.json",
         **{name: f"memory-{name}.local-properties.schema.json" for name in CHILDREN},
         "link": "memory-link.properties.schema.json"}
LINK_NAMES = {"references"}
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


def exact(reference):
    require(isinstance(reference, dict) and set(reference) == {"uri", "revision"},
            ("Not an exact illustrative reference", reference))
    require(all(isinstance(reference[k], str) and reference[k] for k in reference),
            "Empty illustrative Type label")
    return reference["uri"], reference["revision"]


schemas = {name: read(MEMORY_DIR / filename) for name, filename in NAMES.items()}
registry = Registry(retrieve=unavailable).with_resources(
    list(SPECIFICATIONS.items())
    + [(schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()]
)
for schema in schemas.values():
    Draft202012Validator.check_schema(schema)


def validator(schema):
    return Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())


validators = {name: validator(schema) for name, schema in schemas.items()}
cases = read(FIXTURES / "schema-cases.json")["cases"]
require(bool(cases), "No property cases loaded")
for case in cases:
    name = case["type"]
    require(name in validators, ("Unknown supplied Type", name))
    selected = [validators[name]]
    if name in CHILDREN:
        selected.append(validators["memory"])
    errors = [error.message for selected_validator in selected
              for error in selected_validator.iter_errors(case["properties"])]
    require((not errors) == case["valid"], (case["label"], errors))

records = read(FIXTURES / "records.json")
for record in records["records"]:
    uri, _ = exact(record["type"])
    require(uri.startswith(K), ("Unknown fixture Type namespace", uri))
    name = uri.removeprefix(K)
    require(name == "memory" or name in CHILDREN, ("Not a supplied Memory Type", name))
    selected = [validators["memory"]]
    if name in CHILDREN:
        selected.append(validators[name])
    errors = [error.message for v in selected for error in v.iter_errors(record["properties"])]
    require(not errors, (record["id"], errors))
for link in records["links"]:
    uri, _ = exact(link["type"])
    require(uri.startswith(K) and uri.removeprefix(K) in LINK_NAMES,
            ("Not a supplied informational Link Type", uri))
    errors = [error.message for error in validators["link"].iter_errors(link["properties"])]
    require(not errors, (link["id"], errors))

print(f"PASS HISTORICAL product properties: {len(schemas)} schemas; {len(cases)} positive/negative cases; "
      f"{len(records['records'])} Bead and {len(records['links'])} Link excerpts. "
      "No BDP definition/profile inputs required.")

if args.with_bdp_exploration:
    shared = {name: read(args.shared_schemas / name) for name in SHARED_NAMES}
    for schema in shared.values():
        Draft202012Validator.check_schema(schema)
    registry = registry.with_resources(
        [(schema["$id"], Resource.from_contents(schema)) for schema in shared.values()]
    )
    shared_validators = {name: validator(schema) for name, schema in shared.items()}
    fixture = read(MEMORY_DIR / "definitions.json")
    definitions = fixture["definitions"]
    require(len(definitions) == 9, "Expected eight Bead and one Link definition")
    by_pin = {(d["id"], d["revision"]): d for d in definitions}
    require(len(by_pin) == len(definitions), "Duplicate exact domain definition")
    foundation = read(args.shared_schemas / "definitions.json")
    combined = {(d["id"], d["revision"]): d for d in foundation["definitions"]}
    require(not set(combined).intersection(by_pin), "Domain fixture overwrites foundation")
    combined.update(by_pin)


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
        parent = None
        if is_bead and name in CHILDREN:
            parent = MEMORY
        for declaration in recorded:
            require(declaration["source"] == definition["id"], "Wrong declaration owner")
            require(exact(declaration["type"]) == (F + "conforms-to", "conformance-1"),
                    "Unexpected declaration affiliation")
            require(exact(declaration["target"]) == parent, "Wrong family ancestor pin")
            errors = list(shared_validators["conforms-to.properties.schema.json"].iter_errors(declaration["properties"]))
            require(not errors, "Invalid declaration properties")
            owned_declarations.append(declaration)
        require(len(recorded) == (1 if parent else 0), "Unexpected direct conformance")
    require(owned_declarations == fixture["declarations"], "Recorded declarations differ from exposed copies")
    require(len(owned_declarations) == 7, "Expected seven Memory family declarations")


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
        for inherited in closure(pin):
            schema = by_pin[inherited]["properties"]["propertiesSchema"]
            errors = list(validator(schema).iter_errors(link["properties"]))
            require(not errors, (link["id"], inherited, [e.message for e in errors]))

    print(f"PASS HISTORICAL optional BDP exploration: {len(definitions)} descriptors; "
          f"{len(owned_declarations)} declarations. Nonnormative encoding/closure only.")

print("HISTORICAL LIMIT: property shapes, formats and finite examples only. "
      "No prose meaning, endpoint admission, provenance, graph operations, History, "
      "transactions, CLI or installed runtime qualification.")
