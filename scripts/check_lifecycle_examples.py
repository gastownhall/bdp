"""Check fixture-only lifecycle facts, not Event wire/runtime conformance."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "specs/proposals/lifecycle-events"
schema = json.loads((HERE / "fact-cases.schema.json").read_text())
Draft202012Validator.check_schema(schema)
cases = json.loads((ROOT / "fixtures/specs/lifecycle-events/fact-cases.json").read_text())
Draft202012Validator(schema).validate(cases)
fact = Draft202012Validator(schema["$defs"]["fact"], format_checker=FormatChecker())
for case in cases:
    indexes = case["visibleFactIndexes"]
    valid = all(fact.is_valid(f) for f in case["facts"]) and len(indexes) == len(set(indexes)) and all(i < len(case["facts"]) for i in indexes)
    counts = {"facts": len(case["facts"]), "bead": sum(f.get("resourceKind") == "bead" for f in case["facts"]), "link": sum(f.get("resourceKind") == "link" for f in case["facts"])}
    valid = valid and counts == case["expectedCounts"]
    assert valid == case["expectedValid"], case["name"]
print(f"PASS: {len(cases)} lifecycle fixture shape/count-consistency vectors; no Event-wire/runtime claim")
