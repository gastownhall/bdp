"""Finite offline framing/closure review checks, NOT a runtime import implementation."""
from copy import deepcopy
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError
from jsonschema.validators import SPECIFICATIONS
from referencing import Registry, Resource
from referencing.exceptions import NoSuchResource

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "specs/proposals/interchange"
core = json.loads((ROOT / "specs/profiles/core/bdp-v0.schema.json").read_text())
schema = json.loads((HERE / "transfer.schema.json").read_text())
owned_types = set(json.loads((HERE / "examples/ownership-facts.json").read_text())["sourceOwnedLinkTypes"])

def unavailable(uri):
    raise NoSuchResource(ref=uri)

registry = Registry(retrieve=unavailable).with_resources(list(SPECIFICATIONS.items()) + [(s["$id"], Resource.from_contents(s)) for s in [core, schema]])
for s in [core, schema]:
    Draft202012Validator.check_schema(s)
validators = {name: Draft202012Validator({"$ref": schema["$id"] + "#/$defs/" + name}, registry=registry, format_checker=FormatChecker()) for name in ["manifest", "version", "complete"]}

class Refusal(ValueError):
    pass

def require(condition):
    if not condition:
        raise Refusal("invalid framing/closure review artifact")

def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result)
        result[key] = value
    return result

def invalid_constant(value):
    raise Refusal("non-JSON number")

def scalar_strings(value):
    if isinstance(value, str):
        value.encode("utf-8", errors="strict")
    elif isinstance(value, dict):
        for key, child in value.items():
            scalar_strings(key)
            scalar_strings(child)
    elif isinstance(value, list):
        for child in value:
            scalar_strings(child)

def check(raw):
    require(raw.endswith(b"\n"))
    lines = raw.splitlines(keepends=True)
    require(len(lines) >= 2 and all(line.endswith(b"\n") and not line.endswith(b"\r\n") for line in lines))
    records = [json.loads(line.decode("utf-8", errors="strict"), object_pairs_hook=pairs, parse_float=Decimal, parse_constant=invalid_constant) for line in lines]
    for record in records:
        scalar_strings(record)
    validators["manifest"].validate(records[0])
    validators["complete"].validate(records[-1])
    versions = records[1:-1]
    for version in versions:
        validators["version"].validate(version)
    footer = records[-1]
    require(footer["sha256"] == hashlib.sha256(b"".join(lines[:-1])).hexdigest())
    require(footer["versions"] == len(versions))
    by_version = {}
    heads = {}
    for version in versions:
        resource = version["resource"]
        require(resource["id"].startswith(records[0]["sourceScope"]))
        key = resource["id"], resource["revision"]
        require(key not in by_version)
        by_version[key] = version
        if version["head"]:
            require(resource["id"] not in heads)
            heads[resource["id"]] = version
    identities = {key[0] for key in by_version}
    require(footer["resources"] == len(identities) and set(heads) == identities)
    scope = records[0]["sourceScope"]
    for version in versions:
        resource = version["resource"]
        require(heads[resource["id"]]["resourceKind"] == version["resourceKind"])
        if version["resourceKind"] == "link":
            for name in ["source", "target"]:
                reference = resource[name]
                uri = reference if isinstance(reference, str) else reference["uri"]
                if uri.startswith(scope):
                    require(uri in heads and heads[uri]["resourceKind"] == "bead")
                    if isinstance(reference, dict):
                        require((uri, reference["revision"]) in by_version and by_version[(uri, reference["revision"])]["resourceKind"] == "bead")
        for type_id, owned in resource.get("ownedLinks", {}).items():
            for link in owned:
                actual = by_version.get((link["id"], link["revision"]))
                source = link["source"] if isinstance(link["source"], str) else link["source"]["uri"]
                require(actual is not None and actual["resourceKind"] == "link" and actual["resource"] == link and link["type"] == type_id and source == resource["id"])
    # Reverse agreement for current owned state under the explicitly supplied
    # synthetic ownership facts only; no Type inference from arbitrary properties.
    for version in heads.values():
        link = version["resource"]
        if version["resourceKind"] == "link" and link["type"] in owned_types:
            source_id = link["source"] if isinstance(link["source"], str) else link["source"]["uri"]
            owner = heads.get(source_id)
            require(owner is not None and owner["resourceKind"] == "bead")
            owned = owner["resource"].get("ownedLinks", {}).get(link["type"], [])
            require(sum(item == link for item in owned) == 1)
    return records

def encode(records):
    raw = b"".join((json.dumps(x, ensure_ascii=False, separators=(",", ":")) + "\n").encode() for x in records)
    vs = [x for x in records if x.get("record") == "version"]
    footer = {"record": "complete", "resources": len({x["resource"]["id"] for x in vs}), "versions": len(vs), "sha256": hashlib.sha256(raw).hexdigest()}
    return raw + (json.dumps(footer, separators=(",", ":")) + "\n").encode()

raw = (HERE / "examples/connected.jsonl").read_bytes()
base = check(raw)[:-1]
check((HERE / "examples/empty.jsonl").read_bytes())
cases = json.loads((HERE / "examples/refusal-cases.json").read_text())
for case in cases:
    records = deepcopy(base)
    action = case["mutation"]
    if action == "remove-task": del records[1]
    elif action == "remove-old-memory": del records[3]
    elif action == "duplicate-version": records.append(deepcopy(records[2]))
    elif action == "multiple-heads": records[3]["head"] = True
    elif action == "missing-head": records[2]["head"] = False
    elif action == "owned-copy": next(iter(records[1]["resource"]["ownedLinks"].values()))[0]["target"]["revision"] = "memory-r2"
    elif action == "missing-inline-owned": records[1]["resource"]["ownedLinks"] = {}
    elif action == "link-endpoint": records[4]["resource"]["target"] = records[4]["resource"]["id"]
    elif action == "format": records[0]["formatVersion"] = 999
    elif action == "contract": records[0]["resourceContract"] = "urn:unsupported"
    elif action == "record": records[4]["record"] = "future-record"
    elif action == "foreign-id": records[2]["resource"]["id"] = "https://other.invalid/bead"
    elif action == "wrapper-member": records[2]["undeclared"] = True
    elif action == "surrogate": records[2]["resource"]["properties"]["body"] = "\ud800"
    elif action == "nan": records[2]["resource"]["properties"]["bad"] = float("nan")
    elif action == "provenance": records[2]["resource"]["revisionProvenance"] = {"committedAt": "2026-10-17T00:00:00Z"}
    elif action not in {"count", "tamper", "truncate", "trailing", "duplicate-json", "final-lf"}: raise AssertionError(action)
    # Surrogate input is syntactically JSON bytes but not a valid Unicode scalar.
    if action == "surrogate":
        candidate = encode(base).replace(b"Current caf\xc3\xa9 procedure.", b"\\ud800")
        ls = candidate.splitlines(keepends=True)
        footer = json.loads(ls[-1]); footer["sha256"] = hashlib.sha256(b"".join(ls[:-1])).hexdigest()
        candidate = b"".join(ls[:-1]) + (json.dumps(footer) + "\n").encode()
    else:
        candidate = encode(records)
    if action == "count":
        ls = candidate.splitlines(keepends=True); footer = json.loads(ls[-1]); footer["versions"] += 1
        candidate = b"".join(ls[:-1]) + (json.dumps(footer) + "\n").encode()
    elif action == "tamper": candidate = candidate.replace(b"Current", b"Altered")
    elif action == "truncate": candidate = b"".join(candidate.splitlines(keepends=True)[:-1])
    elif action == "trailing": candidate += b"{}\n"
    elif action == "duplicate-json":
        candidate = candidate.replace(b'"head":true', b'"head":true,"head":true', 1)
        ls = candidate.splitlines(keepends=True); footer = json.loads(ls[-1])
        footer["sha256"] = hashlib.sha256(b"".join(ls[:-1])).hexdigest()
        candidate = b"".join(ls[:-1]) + (json.dumps(footer) + "\n").encode()
    elif action == "final-lf": candidate = candidate[:-1]
    try:
        check(candidate)
    except (Refusal, ValidationError, json.JSONDecodeError, UnicodeError):
        pass
    else:
        raise AssertionError((case["name"], "expected refusal"))
print(f"PASS: 2 positive packages and {len(cases)} refusal vectors; no runtime/Memory-domain/atomicity claim")
