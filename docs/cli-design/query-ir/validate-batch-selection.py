"""Check authored transaction-selection shapes and bounded static admission.

No Batch, Query evaluator, provider, parser, staged read or publication is run.
Run with jsonschema[format-nongpl]==4.23.0. A normalization used below is solely
for reusing the standalone static type checker; it is not an execution lowering.
"""

import ast
import copy
import hashlib
import json
import re
import shlex
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "validate.py"
tree = ast.parse(SOURCE.read_text(), filename=str(SOURCE))
definitions = ast.Module(
    body=[item for item in tree.body if isinstance(item, (ast.Import, ast.ImportFrom, ast.ClassDef, ast.FunctionDef))],
    type_ignores=[],
)
CHECKER = {}
exec(compile(definitions, str(SOURCE), "exec"), CHECKER)
AdmissionError = CHECKER["AdmissionError"]
require = CHECKER["require"]
schema = json.loads((HERE / "query.schema.json").read_text())
batch_schema = json.loads((HERE / "batch-selection.schema.json").read_text())
registry = Registry().with_resource(schema["$id"], Resource.from_contents(schema))
FORMATS = FormatChecker()
assert "uri" in FORMATS.checkers
VALIDATOR = Draft202012Validator(batch_schema, registry=registry, format_checker=FORMATS)
ORDINARY_VALIDATOR = Draft202012Validator(schema, format_checker=FORMATS)


def admit_selector(selector, bindings, scope):
    """Validate prior binding kind/cardinality and the selected first-slice rules."""
    selection = copy.deepcopy(selector["selection"])
    source = selection["input"] if selection["op"] == "filter" else selection
    captured_list = selector["profile"] == "list" and source["op"] == "refs" and isinstance(source["references"], dict)
    if selector["profile"] == "list" and source["op"] == "refs":
        require(captured_list, "list-source-not-prior-set")
        name = source["references"]["binding"]
        require(name in bindings, "unknown-or-forward-batch-binding")
        require(bindings[name]["cardinality"] == "set", "list-source-not-prior-set")

    def resource(expr):
        if expr["op"] == "endpoint":
            resource(expr["of"])

    def value(expr):
        op = expr["op"]
        if op == "literal":
            return  # Literal JSON is data, including objects that resemble nodes.
        require(op != "rev", "batch-public-revision-test")
        if op == "field":
            require(expr["path"][0] not in {"revision", "revisionProvenance"}, "batch-public-revision-test")
        resource(expr["of"] if op not in {"binding", "endpoint"} else expr)

    def predicate(expr):
        if isinstance(expr, bool):
            return
        op = expr["op"]
        if op in {"and", "or"}:
            for child in expr["operands"]:
                predicate(child)
        elif op == "not":
            predicate(expr["predicate"])
        elif op in {"any", "all"}:
            collection(expr["input"])
            if "predicate" in expr:
                predicate(expr["predicate"])
        elif op == "compare":
            require(expr["left"]["op"] not in {"binding", "endpoint"} and expr["right"]["op"] not in {"binding", "endpoint"}, "batch-edition-comparison")
            value(expr["left"])
            value(expr["right"])
        elif op == "typeIs":
            resource(expr["of"])
        else:
            for key in {"present": ["value"], "contains": ["text", "substring"], "member": ["value", "array"]}[op]:
                value(expr[key])

    def collection(expr):
        op = expr["op"]
        if op == "scan":
            return
        if op == "refs":
            refs = expr["references"]
            if isinstance(refs, dict):
                name = refs["binding"]
                require(name in bindings, "unknown-or-forward-batch-binding")
                require(bindings[name]["collection"] == expr["collection"], "wrong-batch-binding-kind")
                # Empty refs preserve the inferred Resource kind during static
                # checking only. The real captured identities are not evaluated.
                expr["references"] = []
            else:
                for ref in refs:
                    require(isinstance(ref, str), "batch-pinned-read-operand")
                    require(ref.startswith(scope), "batch-cross-scope-root")
            return
        if op == "walk":
            roots = expr["roots"]
            if roots["op"] in {"binding", "endpoint"}:
                resource(roots)
            else:
                collection(roots)
            if "through" in expr:
                predicate(expr["through"])
            return
        collection(expr["input"])
        if op == "filter":
            predicate(expr["predicate"])

    collection(selection)
    if captured_list:
        # Reuse List's existing candidate-local checks without executing or
        # replacing the source. The original AST remains unchanged on the wire.
        source.clear()
        source.update({"op": "scan", "collection": bindings[name]["collection"]})
    request = {**selector, "selection": selection, "result": {"form": "resources"}}
    CHECKER["admit"](request)


def main():
    corpus = json.loads((HERE / "batch-selection-cases.json").read_text())
    assert corpus["status"] == "authored-static-admission-and-runtime-obligations-not-executed-selections"
    counts = {"accept": 0, "schema-refusal": 0, "static-refusal": 0}
    seen = set()
    for case in corpus["cases"]:
        assert case["id"] not in seen
        seen.add(case["id"])
        selector = case["selector"]
        errors = list(VALIDATOR.iter_errors(selector))
        if case["admission"] == "schema-refusal":
            assert errors, case["id"]
        else:
            assert not errors, (case["id"], [error.message for error in errors])
            try:
                admit_selector(selector, case.get("priorBindings", corpus["priorBindings"]), corpus["scope"])
            except AdmissionError as error:
                assert case["admission"] == "static-refusal" and str(error) == case["error"], (case["id"], str(error))
            else:
                assert case["admission"] == "accept", case["id"]
        counts[case["admission"]] += 1
    # The same binding node is not admitted by an ordinary standalone read.
    standalone = {
        "ir": "bdp-query-design-1", "profile": "query",
        "selection": {"op": "refs", "collection": "beads", "references": {"binding": "notes"}},
        "result": {"form": "resources"},
    }
    ORDINARY_VALIDATOR.validate(standalone)
    try:
        CHECKER["admit"](standalone)
    except AdmissionError as error:
        assert str(error) == "batch-input-outside-context"
    else:
        raise AssertionError("standalone read accepted a batch binding")
    doc = HERE / "transaction-selection-inputs.md"
    text = doc.read_text()
    assert sum(line.startswith("```") for line in text.splitlines()) % 2 == 0
    assert not any(line.rstrip() != line for line in text.splitlines())
    blocks = re.findall(r"^```json\n(.*?)^```", text, re.S | re.M)
    for block in blocks:
        parsed = json.loads(block)
        if "ir" in parsed:
            VALIDATOR.validate(parsed)
            admit_selector(parsed, corpus["priorBindings"], corpus["scope"])
    commands = 0
    for block in re.findall(r"^```sh\n(.*?)^```", text, re.S | re.M):
        logical = block.replace("\\\n", " ")
        for line in logical.splitlines():
            if line.startswith("bd "):
                assert shlex.split(line)[0] == "bd"
                commands += 1
    for target in re.findall(r"\]\(([^)]+)\)", text):
        if "://" not in target and not target.startswith("#"):
            assert (doc.parent / target.split("#")[0]).exists(), target
    files = ["query.schema.json", "batch-selection.schema.json", "batch-selection-cases.json", "validate.py", "validate-batch-selection.py", "transaction-selection-inputs.md"]
    receipt = {
        "status": "static-checks-passed-not-executed-selections",
        "cases": len(seen), "counts": counts,
        "standaloneBatchInputRefusalChecked": True,
        "markdownJsonBlocksParsed": len(blocks),
        "shellCommandsLexicallyCheckedNotExecuted": commands,
        "notRun": ["CLI parser", "Batch execution", "Query execution", "staged visibility", "provider admission", "backend lowering", "concurrency", "publication", "recovery"],
        "sha256": {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in files},
    }
    (HERE / "BATCH-SELECTION-VALIDATION.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
