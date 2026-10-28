"""Finite selected Types artifact checks, not a registration or provider engine.

No network retrieval, registration/default transitions, or instance execution.
The old illustrative graph and its receipts are deliberately independent inputs.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from urllib.parse import urldefrag, urljoin

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError
from jsonschema.validators import SPECIFICATIONS
from referencing import Registry, Resource
from referencing.exceptions import NoSuchResource
from referencing.jsonschema import DRAFT202012


ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "specs/profiles/types"
NAMESPACE = "https://github.com/gastownhall/bdp/types/type-system/"
SCHEMA_NAMESPACE = "https://github.com/gastownhall/bdp/schemas/types/intrinsic-1/"
TYPES = "https://github.com/gastownhall/bdp/capabilities/types"
READ = "https://github.com/gastownhall/bdp/capabilities/type-definition-read"
DIALECT = "https://json-schema.org/draft/2020-12/schema"
NAMES = ("type", "bead-type", "link-type", "refines")
PINS = {name: {"uri": NAMESPACE + name, "revision": name + "-1"} for name in NAMES}
FORMAT = FormatChecker()


class ArtifactError(ValueError):
    """An explicit finite-source invariant failed."""


def require(condition, message):
    if not condition:
        raise ArtifactError(message)


def unavailable(uri):
    raise NoSuchResource(ref=uri)


def pin(reference):
    require(isinstance(reference, dict) and set(reference) == {"uri", "revision"},
            "missing exact reference")
    require(isinstance(reference["uri"], str) and isinstance(reference["revision"], str)
            and reference["revision"], "invalid exact reference")
    return reference["uri"], reference["revision"]


def record_pin(record):
    return record["id"], record["revision"]


def validator(schema, registry):
    return Draft202012Validator(schema, registry=registry, format_checker=FORMAT)


def schema_references(schema, base):
    """Walk schema locations, not arbitrary property/example data containing $ref."""
    resource = Resource.from_contents(schema, default_specification=DRAFT202012)
    current = urljoin(base, resource.id() or "")
    if isinstance(schema, dict):
        if "$schema" in schema:
            require(schema["$schema"] == DIALECT, "non-2020-12 schema resource")
        for keyword in ("$schema", "$ref", "$dynamicRef"):
            if keyword in schema:
                yield urljoin(current, schema[keyword])
    for child in resource.subresources():
        yield from schema_references(child.contents, current)


def schema_environment(definition):
    """Use only this exact definition's own schema map and standard resources."""
    properties = definition["properties"]
    root = properties["propertiesSchema"]
    retained = properties.get("schemaResources", {})
    require(isinstance(root, dict) and root.get("$id", "").startswith(SCHEMA_NAMESPACE),
            "intrinsic root schema identity")
    require(isinstance(retained, dict), "schemaResources is not an object")
    resources = {root["$id"]: root, **retained}
    require(root["$id"] not in retained or retained[root["$id"]] == root,
            "conflicting root resource")
    for uri, schema in resources.items():
        require(FORMAT.conforms(uri, "uri") and "#" not in uri,
                "invalid schema resource binding")
        if uri in SPECIFICATIONS:
            require(schema == SPECIFICATIONS[uri].contents, "standard schema bytes drift")
        else:
            require(isinstance(schema, dict) and schema.get("$id") == uri,
                    "schema resource identity mismatch")
            require(uri.startswith(SCHEMA_NAMESPACE), "unselected protocol schema identity")
        Draft202012Validator.check_schema(schema)
    registry = Registry(retrieve=unavailable).with_resources(
        list(SPECIFICATIONS.items()) + [
            (uri, Resource.from_contents(schema, default_specification=DRAFT202012))
            for uri, schema in resources.items()])
    pending, visited = list(resources), set()
    while pending:
        uri = pending.pop()
        if uri in visited:
            continue
        visited.add(uri)
        schema = resources[uri] if uri in resources else SPECIFICATIONS[uri].contents
        for reference in schema_references(schema, uri):
            target = urldefrag(reference)[0]
            require(target in resources or target in SPECIFICATIONS,
                    "missing exact schema resource")
            # Resolve fragments/anchors too; a present document is insufficient.
            registry.resolver(uri).lookup(reference)
            pending.append(target)
    return registry


def check_captures(candidate):
    declarations = candidate["declarations"]
    indexed = {record_pin(link): link for link in declarations}
    require(len(indexed) == len(declarations), "duplicate declaration identity")
    captured = set()
    for owner in candidate["definitions"]:
        for nominal, links in owner["ownedLinks"].items():
            require(links, "empty owned group")
            for link in links:
                require(nominal == link["type"]["uri"], "incorrect nominal owned group")
                # Literal unpinned source is part of this publication, not an
                # assertion that an endpoint pin witnesses owner membership.
                require(link["source"] == owner["id"], "captured source mismatch")
                key = record_pin(link)
                require(key not in captured, "duplicate captured declaration")
                require(indexed.get(key) == link, "captured declaration copy differs")
                captured.add(key)
    require(captured == set(indexed), "uncaptured declaration")


def check_schema_copies(candidate):
    roots = {record["properties"]["propertiesSchema"]["$id"]:
             record["properties"]["propertiesSchema"] for record in candidate["definitions"]}
    require(len(roots) == 4, "duplicate intrinsic schema identity")
    for record in candidate["definitions"]:
        for uri, schema in record["properties"].get("schemaResources", {}).items():
            if uri not in SPECIFICATIONS:
                require(uri in roots and roots[uri] == schema,
                        "conflicting retained intrinsic schema copy")


def check_refines_graph(candidate):
    """Only recorded Refines edges; metatype affiliation loops are not edges."""
    records = {record_pin(record): record for record in candidate["definitions"]}
    edges = {}
    for owner in candidate["definitions"]:
        targets = []
        for links in owner["ownedLinks"].values():
            for link in links:
                require(link["type"] == PINS["refines"], "wrong Refines affiliation")
                target = pin(link["target"])
                require(target in records, "missing exact Refines target")
                targets.append(target)
        require(len(set(targets)) == len(targets), "duplicate exact Refines target")
        edges[record_pin(owner)] = targets
    done, active = set(), set()

    def visit(node):
        require(node not in active, "exact Refines cycle")
        if node in done:
            return
        active.add(node)
        for target in edges[node]:
            visit(target)
        active.remove(node)
        done.add(node)

    for node in records:
        visit(node)


def exact_walk(candidate, start):
    records = {record_pin(record): record for record in candidate["definitions"]}
    pending, visited = [start], set()
    while pending:
        key = pending.pop()
        if key in visited:
            continue
        require(key in records, "missing exact definition dependency")
        visited.add(key)
        record = records[key]
        pending.append(pin(record["type"]))
        for links in record["ownedLinks"].values():
            for link in links:
                pending.extend((pin(link["type"]), pin(link["target"])))
    return visited


def check_intrinsic(candidate, validators):
    require(set(candidate) == {"definitions", "declarations"}, "publication root members")
    definitions, declarations = candidate["definitions"], candidate["declarations"]
    require(len(definitions) == 4 and len(declarations) == 2, "publication record counts")
    by_pin = {record_pin(record): record for record in definitions}
    require(set(by_pin) == {pin(value) for value in PINS.values()}, "intrinsic exact identities")
    by_name = {record["id"].removeprefix(NAMESPACE): record for record in definitions}
    schema_names = {"type": "type-definition", "bead-type": "bead-type-definition",
                    "link-type": "link-type-definition", "refines": "refines"}
    for name, record in by_name.items():
        validators["beadRecord"].validate(record)
        require(record["type"] == PINS["link-type" if name == "refines" else "bead-type"],
                "incorrect intrinsic metatype affiliation")
        require("originScope" not in record, "invented origin Scope")
        require(record["properties"]["propertiesSchema"]["$id"] ==
                SCHEMA_NAMESPACE + schema_names[name] + ".properties.schema.json",
                "incorrect intrinsic schema identity")
        schema_environment(record)
    check_schema_copies(candidate)
    require(by_name["type"]["properties"].get("abstract") is True, "Type must be abstract")
    for name in ("bead-type", "link-type", "refines"):
        require(not by_name[name]["properties"].get("abstract", False), "usable intrinsic abstract")
    require(by_name["type"]["properties"].get("ownsOutgoing") == [{"anyOf": [PINS["refines"]]}],
            "Type owns Refines")
    pairs = []
    for name in ("bead-type", "link-type"):
        endpoint = {"resourceKind": "bead", "scope": "either", "types": {"anyOf": [PINS[name]]}}
        pairs.append({"source": endpoint, "target": deepcopy(endpoint)})
    require(by_name["refines"]["properties"].get("linkConstraints") == {"typeConstraints": pairs},
            "category-preserving Refines pairs")
    expected_ids = {NAMESPACE + name + "-refines-type" for name in ("bead-type", "link-type")}
    require({link["id"] for link in declarations} == expected_ids, "intrinsic declaration identities")
    for link in declarations:
        validators["linkRecord"].validate(link)
        require(link["revision"] == "declaration-1" and link["type"] == PINS["refines"]
                and link["target"] == PINS["type"], "intrinsic declaration exact pins")
        require(link["source"] + "-refines-type" == link["id"], "intrinsic declaration source")
    check_captures(candidate)
    check_refines_graph(candidate)
    for definition in definitions:
        metatype = by_pin[pin(definition["type"])]
        validator(metatype["properties"]["propertiesSchema"], schema_environment(metatype)).validate(
            definition["properties"])
    for link in declarations:
        refines = by_name["refines"]
        validator(refines["properties"]["propertiesSchema"], schema_environment(refines)).validate(link["properties"])
    for name in NAMES:
        require(exact_walk(candidate, pin(PINS[name])) == set(by_pin), "incomplete intrinsic exact closure")


def check_receipt(raw, receipt, candidate):
    require(receipt["publication"] == "intrinsic-1" and receipt["artifact"] == "intrinsic-1.json",
            "publication receipt identity")
    require(receipt["sha256"] == hashlib.sha256(raw).hexdigest(), "full artifact digest mismatch")
    require(receipt["definitionCount"] == len(candidate["definitions"]) == 4
            and receipt["declarationCount"] == len(candidate["declarations"]) == 2, "receipt counts")
    require(receipt["originScopeRecorded"] is False and "originScope" not in receipt,
            "invented receipt origin Scope")
    pins = receipt["definitionPins"]
    require(isinstance(pins, list) and len(pins) == len(PINS)
            and {pin(value) for value in pins} == {pin(value) for value in PINS.values()},
            "receipt exact pins")


def main():
    require(FORMAT.conforms("https://example.test/value", "uri")
            and not FORMAT.conforms("not a URI", "uri"), "URI format checker unavailable")
    common = json.loads((ROOT / "specs/profiles/core/bdp-v0.1.schema.json").read_text())
    sidecar = json.loads((HERE / "types-v1.schema.json").read_text())
    for schema in (common, sidecar):
        Draft202012Validator.check_schema(schema)
    registry = Registry(retrieve=unavailable).with_resources(list(SPECIFICATIONS.items()) + [
        (schema["$id"], Resource.from_contents(schema)) for schema in (common, sidecar)])
    validators = {name: validator({"$ref": sidecar["$id"] + "#/$defs/" + name}, registry)
                  for name in sidecar["$defs"]}
    counts = {"shape": 0, "refusals": 0}

    def shape(name, instance, valid, label):
        errors = list(validators[name].iter_errors(instance))
        require((not errors) == valid, f"{label}: {[error.message for error in errors]}")
        counts["shape"] += 1

    def refused(check, value, reason):
        try:
            check(value)
        except ArtifactError as error:
            require(str(error) == reason, f"wrong refusal: {reason}: {error}")
        else:
            raise ArtifactError("mutation accepted: " + reason)
        counts["refusals"] += 1

    for profile in ("core", "write"):
        base = {"bdpVersion": "0.1", "profile": profile, "scope": "https://example.test/scope/",
                "beads": "https://example.test/beads", "links": "https://example.test/links",
                "events": "https://example.test/events"}
        if profile == "write":
            base.update(operations="https://example.test/operations", aliases="https://example.test/aliases")
        cases = [(None, True), ({}, True), ({TYPES: {}}, False),
                 ({TYPES: {"2": {"future": True}}}, True),
                 ({READ: {"1": {"operation": "https://example.test/lookup"}}}, True),
                 ({TYPES: {"1": {}}, READ: {"1": {"operation": "https://example.test/lookup"}}}, True),
                 ({TYPES: {"1": {}}}, False), ({TYPES: {"1": {}}, READ: {}}, False),
                 ({TYPES: {"1": {}}, READ: {"2": {}}}, False),
                 ({TYPES: {"1": {}}, READ: {"1": {}}}, False),
                 ({TYPES: {"1": {}}, READ: {"1": {"operation": "relative"}}}, False),
                 ({TYPES: {"1": {"extra": True}}, READ: {"1": {"operation": "https://example.test/lookup"}}}, False),
                 ({TYPES: {"1": {}}, READ: {"1": {"operation": "https://example.test/lookup", "extra": True}}}, False),
                 ({TYPES: {"1": {}, "2": {"future": True}},
                   READ: {"1": {"operation": "https://example.test/lookup"}, "2": {"future": True}}}, True),
                 ({TYPES: {"1": {}, "2": {"future": True}}, READ: {"2": {"future": True}}}, False),
                 ({TYPES: {"1": {}, "2": {"future": True}}}, False),
                 ({TYPES: {"2": {"future": True}}, READ: {"2": {"future": True}}}, True),
                 ({TYPES: {"2": {"future": True}}, READ: {"1": {}}}, False),
                 ({TYPES: {"1": None}, READ: {"1": {"operation": "https://example.test/lookup"}}}, False),
                 ({TYPES: {"1": []}, READ: {"1": {"operation": "https://example.test/lookup"}}}, False)]
        for index, (capabilities, valid) in enumerate(cases):
            instance = deepcopy(base)
            if capabilities is not None:
                instance["capabilities"] = capabilities
            shape("discovery", instance, valid, f"{profile} discovery {index}")
            known = capabilities is not None and "1" in capabilities.get(TYPES, {})
            shape("typesDiscovery", instance, valid and known, f"{profile} Types discovery {index}")
        for malformed in ([], "1", None):
            instance = deepcopy(base)
            instance["capabilities"] = {TYPES: malformed}
            shape("discovery", instance, False, "invalid capability version map")
        for capabilities in (None, {TYPES: {"1": {}}, READ: {"1": {"operation": "https://example.test/lookup"}}}):
            instance = deepcopy(base)
            instance["types"] = "https://example.test/types"
            if capabilities is not None:
                instance["capabilities"] = capabilities
            shape("discovery", instance, False, "base discovery rejects extra Type inventory root")
    raw = (HERE / "intrinsic-1.json").read_bytes()
    candidate = json.loads(raw)
    receipt = json.loads((HERE / "intrinsic-1.publication.json").read_text())
    check_receipt(raw, receipt, candidate)
    check_intrinsic(candidate, validators)
    reordered_receipt = deepcopy(receipt)
    reordered_receipt["definitionPins"].reverse()
    check_receipt(raw, reordered_receipt, candidate)
    for record in candidate["definitions"] + candidate["declarations"]:
        kind = "beadRecord" if "ownedLinks" in record else "linkRecord"
        for bad in (record["type"]["uri"], {"uri": record["type"]["uri"]}):
            changed = deepcopy(record)
            changed["type"] = bad
            shape(kind, changed, False, "typed record requires exact affiliation")
        changed = deepcopy(record)
        del changed["type"]
        shape(kind, changed, False, "common full record requires affiliation")
    changed = deepcopy(candidate["definitions"][0])
    changed["originScope"] = "https://receiver.example.test/"
    shape("beadRecord", changed, False, "full definition rejects invented origin Scope member")
    beads = {"items": deepcopy(candidate["definitions"]), "next": None}
    shape("beadCollection", beads, True, "complete typed Bead collection")
    shape("beadCollection", {"items": [], "next": None}, True, "empty typed Bead collection")
    changed = deepcopy(beads)
    changed["next"] = "https://example.test/beads?cursor=next"
    shape("beadCollection", changed, True, "typed Bead continuation")
    for bad in (PINS["bead-type"]["uri"], {"uri": PINS["bead-type"]["uri"]}):
        changed = deepcopy(beads)
        changed["items"][0]["type"] = bad
        shape("beadCollection", changed, False, "Bead collection item requires exact affiliation")
    changed = deepcopy(beads)
    del changed["items"][0]["type"]
    shape("beadCollection", changed, False, "Bead collection item requires affiliation")
    for missing in ("items", "next"):
        changed = deepcopy(beads)
        del changed[missing]
        shape("beadCollection", changed, False, "Bead collection missing " + missing)
    changed = deepcopy(beads)
    changed["extra"] = True
    shape("beadCollection", changed, False, "Bead collection remains closed")
    changed = deepcopy(beads)
    changed["items"][1]["ownedLinks"][PINS["refines"]["uri"]][0]["type"] = PINS["refines"]["uri"]
    shape("beadCollection", changed, False, "Bead collection keeps exact captured Link affiliations")
    changed = deepcopy(candidate["definitions"][1])
    changed["ownedLinks"][PINS["refines"]["uri"]][0]["type"] = PINS["refines"]["uri"]
    shape("beadRecord", changed, False, "captured Link requires exact affiliation")
    incident = {"items": deepcopy(candidate["declarations"]), "next": None}
    owner = deepcopy(candidate["definitions"][1])

    def incident_shape(collection, valid, label):
        shape("linkCollection", collection, valid, label + " collection")
        nested = deepcopy(owner)
        nested["links"] = collection
        shape("beadRecord", nested, valid, label + " nested Bead")

    incident_shape(incident, True, "complete incident records")
    incident_shape({"items": [], "next": None}, True, "empty incident records")
    changed = deepcopy(incident)
    changed["next"] = "https://example.test/incident?cursor=next"
    incident_shape(changed, True, "incident continuation")
    for bad in (PINS["refines"]["uri"], {"uri": PINS["refines"]["uri"]}):
        changed = deepcopy(incident)
        changed["items"][0]["type"] = bad
        incident_shape(changed, False, "incident Link requires exact affiliation")
    for missing in ("items", "next"):
        changed = deepcopy(incident)
        del changed[missing]
        incident_shape(changed, False, "incident missing " + missing)
    changed = deepcopy(incident)
    changed["extra"] = True
    incident_shape(changed, False, "incident collection remains closed")
    refused(lambda r: check_receipt(raw + b" ", r, candidate), receipt, "full artifact digest mismatch")
    changed = deepcopy(receipt)
    changed["definitionPins"][0]["revision"] = "newer"
    refused(lambda r: check_receipt(raw, r, candidate), changed, "receipt exact pins")
    changed = deepcopy(receipt)
    changed["declarationCount"] = 0
    refused(lambda r: check_receipt(raw, r, candidate), changed, "receipt counts")
    changed = deepcopy(receipt)
    changed["originScope"] = "https://receiver.example.test/"
    refused(lambda r: check_receipt(raw, r, candidate), changed, "invented receipt origin Scope")
    mutations = [
        (lambda c: c["definitions"].append(deepcopy(c["definitions"][0])), "publication record counts"),
        (lambda c: c["definitions"][0].update(revision="newer"), "intrinsic exact identities"),
        (lambda c: c["definitions"][0].update(type=PINS["link-type"]), "incorrect intrinsic metatype affiliation"),
        (lambda c: c["definitions"][0]["properties"].update(abstract=False), "Type must be abstract"),
        (lambda c: c["definitions"][3]["properties"].update(linkConstraints={}), "category-preserving Refines pairs"),
    ]
    for mutate, reason in mutations:
        changed = deepcopy(candidate)
        mutate(changed)
        refused(lambda c: check_intrinsic(c, validators), changed, reason)
    changed = deepcopy(candidate)
    changed["definitions"][1]["ownedLinks"][PINS["refines"]["uri"]][0]["revision"] = "edited"
    refused(check_captures, changed, "captured declaration copy differs")
    changed = deepcopy(candidate)
    changed["definitions"][1]["ownedLinks"] = {}
    refused(check_captures, changed, "uncaptured declaration")
    changed = deepcopy(candidate)
    links = changed["definitions"][1]["ownedLinks"].pop(PINS["refines"]["uri"])
    changed["definitions"][1]["ownedLinks"][PINS["type"]["uri"]] = links
    refused(check_captures, changed, "incorrect nominal owned group")
    changed = deepcopy(candidate)
    changed["definitions"][1]["ownedLinks"][PINS["refines"]["uri"]][0]["source"] = PINS["type"]["uri"]
    refused(check_captures, changed, "captured source mismatch")
    changed = deepcopy(candidate)
    changed["definitions"][1]["ownedLinks"][PINS["refines"]["uri"]] = []
    refused(check_captures, changed, "empty owned group")
    changed = deepcopy(candidate)
    owner = changed["definitions"][1]
    owner["ownedLinks"][PINS["refines"]["uri"]].append(deepcopy(owner["ownedLinks"][PINS["refines"]["uri"]][0]))
    refused(check_refines_graph, changed, "duplicate exact Refines target")
    changed = deepcopy(candidate)
    edge = deepcopy(changed["declarations"][0])
    edge.update(source=PINS["type"]["uri"], target=PINS["bead-type"])
    changed["definitions"][0]["ownedLinks"] = {PINS["refines"]["uri"]: [edge]}
    refused(check_refines_graph, changed, "exact Refines cycle")
    changed = deepcopy(candidate)
    changed["definitions"][0]["revision"] = "newer"
    refused(lambda c: exact_walk(c, pin(PINS["bead-type"])), changed, "missing exact definition dependency")
    changed = deepcopy(candidate["definitions"][1])
    changed["properties"]["schemaResources"].pop(SCHEMA_NAMESPACE + "type-definition.properties.schema.json")
    refused(schema_environment, changed, "missing exact schema resource")
    changed = deepcopy(candidate["definitions"][0])
    changed["properties"]["schemaResources"][DIALECT]["title"] = "altered standard"
    refused(schema_environment, changed, "standard schema bytes drift")
    changed = deepcopy(candidate)
    changed["definitions"][1]["properties"]["schemaResources"][
        SCHEMA_NAMESPACE + "type-definition.properties.schema.json"]["required"] = []
    refused(check_schema_copies, changed, "conflicting retained intrinsic schema copy")
    # Exercise actual JSON Schema validation under Refines' exact LinkType,
    # rather than invent a local instance or registration implementation.
    link_metatype = candidate["definitions"][2]
    invalid_properties = deepcopy(candidate["definitions"][3]["properties"])
    invalid_properties["ownsOutgoing"] = []
    try:
        validator(link_metatype["properties"]["propertiesSchema"],
                  schema_environment(link_metatype)).validate(invalid_properties)
    except ValidationError:
        counts["refusals"] += 1
    else:
        raise ArtifactError("LinkType accepted forbidden ownsOutgoing properties")
    print(f"PASS: 4 intrinsic definitions/2 declarations; {counts['shape']} sidecar positive/negative cases; "
          f"{counts['refusals']} finite publication/closure refusal mutations; offline exact metatype properties validated")
    print("LIMIT: source/shape/finite graph checks only; no provider, registration/default, instance, authority or runtime proof")


if __name__ == "__main__":
    main()
