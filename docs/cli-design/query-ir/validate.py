"""Check design artifacts; never execute bd, HTTP, SQL, or the Query evaluator.

Run with Python plus jsonschema 4.23.0, for example:
  uv run --no-project --with jsonschema==4.23.0 python validate.py

The semantic checks below are a draft static admission checker. Expected Resource
sets/counts in cases.json remain authored obligations, not executed query tests.
"""

import hashlib
import json
import re
import shlex
from collections import Counter
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SCHEMA = json.loads((HERE / "query.schema.json").read_text())
CORPUS = json.loads((HERE / "cases.json").read_text())


class AdmissionError(ValueError):
    pass


def require(condition, diagnosis):
    if not condition:
        raise AdmissionError(diagnosis)


def resource_kind(expr, environment):
    if expr["op"] == "binding":
        require(expr["name"] in environment, "unknown-binding")
        return environment[expr["name"]]
    require(resource_kind(expr["of"], environment) == "links", "wrong-resource-kind")
    return "beads"


def check_value(expr, environment):
    op = expr["op"]
    if op in {"binding", "endpoint"}:
        resource_kind(expr, environment)
        return "resource"
    if op != "literal":
        resource_kind(expr["of"], environment)
    return "value"


def check_predicate(predicate, environment):
    if isinstance(predicate, bool):
        return
    op = predicate["op"]
    if op in {"and", "or"}:
        for child in predicate["operands"]:
            check_predicate(child, environment)
    elif op == "not":
        check_predicate(predicate["predicate"], environment)
    elif op in {"any", "all"}:
        kind = collection_kind(predicate["input"], environment)
        check_predicate(predicate.get("predicate", True), {**environment, predicate["bind"]: kind})
    elif op == "typeIs":
        resource_kind(predicate["of"], environment)
    elif op == "compare":
        left = check_value(predicate["left"], environment)
        right = check_value(predicate["right"], environment)
        require(left == right, "incompatible-comparison-domains")
        require(left != "resource" or predicate["operator"] in {"eq", "ne"}, "resource-ordering")
    else:
        for key in {"present": ["value"], "contains": ["text", "substring"], "member": ["value", "array"]}[op]:
            check_value(predicate[key], environment)


def collection_kind(expr, environment):
    op = expr["op"]
    if op in {"scan", "refs"}:
        return expr["collection"]
    if op == "walk":
        root = expr["roots"]
        kind = resource_kind(root, environment) if root["op"] in {"binding", "endpoint"} else collection_kind(root, environment)
        require(kind == "beads", "wrong-root-kind")
        check_predicate(expr.get("through", True), {**environment, expr.get("bind", "__unused"): "links"})
        return "links"
    kind = collection_kind(expr["input"], environment)
    if op == "endpoints":
        require(kind == "links", "wrong-resource-kind")
        return "beads"
    check_predicate(expr["predicate"], {**environment, expr["bind"]: kind})
    return kind


def local_value(expr, binding):
    if expr["op"] == "literal":
        return True
    return expr["op"] in {"field", "id", "rev"} and expr["of"] == {"op": "binding", "name": binding}


def local_predicate(expr, binding):
    if isinstance(expr, bool):
        return True
    op = expr["op"]
    if op in {"and", "or"}:
        return all(local_predicate(p, binding) for p in expr["operands"])
    if op == "not":
        return local_predicate(expr["predicate"], binding)
    if op == "typeIs":
        return expr["of"] == {"op": "binding", "name": binding}
    if op in {"any", "all"}:
        return False
    if op == "compare":
        values = [expr["left"], expr["right"]]
        return all(local_value(v, binding) for v in values) and any(v["op"] == "literal" for v in values)
    keys = {"present": ["value"], "contains": ["text", "substring"], "member": ["value", "array"]}[op]
    if not all(local_value(expr[k], binding) for k in keys):
        return False
    return op == "present" or expr["substring" if op == "contains" else "value"]["op"] == "literal"


def admit(request):
    collection_kind(request["selection"], {})
    selection, profile, form = request["selection"], request["profile"], request["result"]["form"]
    if form == "graph":
        require(selection["op"] == "walk", "graph-result-needs-direct-walk")
    if profile == "list":
        require(form in {"resources", "count"}, "outside-profile")
        if selection["op"] == "filter":
            require(selection["input"]["op"] == "scan" and local_predicate(selection["predicate"], selection["bind"]), "outside-profile")
        else:
            require(selection["op"] == "scan", "outside-profile")
    elif profile == "graph":
        require(form == "graph" and selection["op"] == "walk", "outside-profile")
        roots = selection["roots"]
        require(roots["op"] == "refs" and roots["collection"] == "beads", "outside-profile")
        predicate = selection.get("through", True)
        require(predicate is True or (isinstance(predicate, dict) and predicate["op"] == "typeIs" and predicate["of"] == {"op": "binding", "name": selection.get("bind")}), "outside-profile")


def check_documents():
    files = [
        ROOT / "specs/profiles/core/query.md",
        ROOT / "specs/profiles/core/resource-projection.md",
        ROOT / "docs/cli-design/query-ir.md",
        ROOT / "docs/cli-design/overview/02-explore-graph.md",
        HERE / "EXAMPLES.md",
        HERE / "INCORPORATION.md",
    ]
    later = ROOT / "docs/cli-design/overview/05-revisions.md"
    if later.exists():
        files.append(later)
    parsed_blocks = 0
    shell_commands = 0
    for path in files:
        text = path.read_text()
        assert sum(line.startswith("```") for line in text.splitlines()) % 2 == 0, path
        assert not any(line != line.rstrip() for line in text.splitlines()), path
        for block in re.findall(r"^```json\n(.*?)^```", text, re.S | re.M):
            value = json.loads(block)
            if isinstance(value, dict) and value.get("ir") == "bdp-query-design-1":
                VALIDATOR.validate(value)
                admit(value)
            parsed_blocks += 1
        for target in re.findall(r"\]\(([^)]+)\)", text):
            if "://" not in target and not target.startswith("#"):
                assert (path.parent / target.split("#")[0]).exists(), (path, target)
        for block in re.findall(r"^```console\n(.*?)^```", text, re.S | re.M):
            lines = iter(block.splitlines())
            for line in lines:
                if not line.startswith("> bd "):
                    continue
                command = line[2:]
                while command.endswith("\\"):
                    command = command[:-1] + next(lines).lstrip()
                assert shlex.split(command)[0] == "bd", (path, command)
                shell_commands += 1
    for path in [HERE / "query.schema.json", HERE / "cases.json", HERE / "fixtures.json", HERE / "validate.py"]:
        files.append(path)
    examples = json.loads((HERE / "examples/index.json").read_text())
    cases = {case["id"]: case for case in CORPUS["cases"]}
    for example in examples["examples"]:
        path = HERE / example["file"]
        value = json.loads(path.read_text())
        VALIDATOR.validate(value)
        admit(value)
        assert value == cases[example["case"]]["request"], example["file"]
        assert example["expected"] == cases[example["case"]]["expected"], example["file"]
        files.append(path)
    files.append(HERE / "examples/index.json")
    story = ROOT / "docs/cli-design/overview/05-revisions.fixture.json"
    if story.exists():
        states = json.loads(story.read_text())["guideStates"]
        assert [state["localOrdinal"] for state in states] == list(range(1, 10))
        assert len({state["opaqueToken"] for state in states}) == 9
        assert states[7]["record"]["properties"]["title"] == "CSV export guide (reviewed)"
        assert states[8]["record"]["properties"]["title"] == "CSV export guide (approved)"
        assert states[8]["record"]["metadata"] == states[7]["record"]["metadata"]
        files.append(story)
    return files, parsed_blocks, shell_commands


Draft202012Validator.check_schema(SCHEMA)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
assert CORPUS["status"] == "authored-design-obligations-not-executed-evaluator-tests"
counts = Counter()
seen = set()
for case in CORPUS["cases"]:
    assert case["id"] not in seen
    seen.add(case["id"])
    errors = list(VALIDATOR.iter_errors(case["request"]))
    if case["admission"] == "reject-schema":
        assert errors, case["id"]
        counts["schema_refusals_checked"] += 1
        continue
    assert not errors, (case["id"], [error.message for error in errors])
    try:
        admit(case["request"])
    except AdmissionError as error:
        assert case["admission"] == "reject-semantic", (case["id"], str(error))
        assert str(error) == case["expected"]["error"], (case["id"], str(error))
        counts["static_admission_refusals_checked"] += 1
    else:
        assert case["admission"] == "accept", case["id"]
        counts["static_admission_accepts_checked"] += 1

files, blocks, commands = check_documents()
receipt = {
    "status": "schema-and-static-admission-checks-passed",
    "authored_cases": len(CORPUS["cases"]),
    "checks": dict(counts),
    "markdown_json_blocks_parsed": blocks,
    "shell_examples_lexically_parsed_not_executed": commands,
    "semantic_expected_results": "authored, not executed by this validator",
    "not_executed": ["friendly parser", "Query evaluator", "bd CLI", "HTTP transport", "backend lowering", "runtime conformance"],
    "artifacts": [{"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in files],
}
(HERE / "VALIDATION.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({key: value for key, value in receipt.items() if key != "artifacts"}, indent=2))
