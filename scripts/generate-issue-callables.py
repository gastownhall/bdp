#!/usr/bin/env python3
"""Generate specs/types/issue/callables.md from the product's pinned v0 contract.

The document is a routing layer: one declaration per v0 operation, named by the table
below. Everything per-operation is projected from the contract; the prose, the name
table and the CLI mappings are authored here.

Run from the repository root:

  git -C <beads repository> show 6d713a74:internal/httpapi/spec/openapi.v0.yaml \
    | ruby -ryaml -rjson -e 'puts JSON.pretty_generate(YAML.safe_load(STDIN.read))' > v0.json
  python3 -B scripts/generate-issue-callables.py v0.json specs/types/issue/callables.md \
    --reset-bundle specs/types/issue/issue-callables-preview-1.schema.json
  node scripts/spec-schema-fragments.mjs --migrate-ownership
  node_modules/.bin/biome format --write specs/types/issue/issue-callables-preview-1.schema.json

--reset-bundle empties the generated bundle's definitions and ownership inventory, the
explicit migration scripts/spec-schema-fragments.mjs requires before a definition can
leave a bundle. --migrate-ownership rewrites every bundle in its own layout, so restore
the bundles other than this one with git afterwards; their content does not change.
--expected-defs PATH also writes the JSON Schema each fragment is meant to extract to, for
comparison against the bundle.

The input is checked against V0_SHA256, so a different contract is refused rather than
silently projected. Output is deterministic: the same input gives the same bytes.
"""
import argparse
import hashlib
import json
import re
import sys

V0_COMMIT = "6d713a74"
V0_PATH = "internal/httpapi/spec/openapi.v0.yaml"
V0_SHA256 = "c1888973e574e940426d3bce2344155473ba662dbbf0bfc0ab29b902dd80100d"
BUNDLE = "issue-callables"
QUERY, BATCH = "CallableQuery", "CallableBatch"

# Sentences that speak of the contract's own code generation mean nothing to a reader here.
STRIP_SENTENCE = ("x-go-type", "Go struct", "apigen", "pinnedSchemas")
STRIP_PARAGRAPH = ("THE DOOR, IF A LATER REVISION",)
# Carried sentences a product adapter makes false.
ADAPTER_FALSE = {"issue/comment": "The caller always names the author and the server never infers one"}
# v0's members for who is acting. Each is the invocation's revisionProvenance.actor, so no
# declaration carries one; see the routing rule.
ACTOR_MEMBERS = {"actor", "author"}
# Carried text about omitting a parameter that a service default (section 4) makes false.
DEFAULT_FALSE = {
    "issue_type": r"SEND ONE\..*?(?:\n\s*\n|$)",
    "tier": r"Required, with no default[^.]*\.\s*",
    "older_than_seconds": r"Absent means `0`[^.]*\.\s*",
    "direction": r"An absent or unrecognized value[^.]*\.\s*",
}


def call(op, name, kind, promises=(), positionals=(), flags=None, from_file=None, defaults=None, members=None):
    return {"op": op, "name": name, "kind": kind, "promises": tuple(promises),
            "positionals": tuple(positionals), "flags": flags or {},
            "from_file": from_file or {}, "defaults": defaults or {}, "members": members or {}}


READY_FLAGS = {"limit": ["-n"], "priority": ["-p"], "assignee": ["-a"], "unassigned": ["-u"],
               "sort": ["-s"], "label": ["-l"], "type": ["-t"]}

# issue/update's patch members with a flat flag on native `bd update`, under native's spelling.
# Left out because native's flag is not this member: metadata (--set-metadata k=v and
# --unset-metadata edit it) and persistence (--ephemeral, --persistent). waiters has no flag.
PATCH_MEMBERS = {"title": [], "description": ["-d"], "design": [], "acceptance_criteria": ["--acceptance"],
                 "notes": [], "append_notes": [], "priority": ["-p"], "issue_type": ["-t", "--type"],
                 "status": ["-s"], "assignee": ["-a"], "parent_id": ["--parent"], "labels": ["--set-labels"],
                 "add_labels": ["-l", "--add-label"], "remove_labels": ["--remove-label"],
                 "estimated_minutes": ["-e", "--estimate"], "external_ref": [], "due_at": ["--due"],
                 "defer_until": ["--defer"], "await_id": []}
# What a member flag may not spell: attribution, and the flags the client keeps for itself.
RESERVED_FLAGS = {"--actor", "--author", "--arguments", "--help", "-h", "--cli-profile", "--config",
                  "--idempotency-key", "--output-format", "--output-mode", "--revision-provenance", "--scope"}

# The name table: v0 operation, name, Type, promises and what is plain from cmd/bd at the pin.
CALLABLES = [
    call("getContext", "issue/context", QUERY),
    call("listReadyWork", "issue/ready", QUERY, flags=READY_FLAGS),
    call("countReadyWork", "issue/ready-count", QUERY),
    call("getStats", "issue/stats", QUERY),
    call("listBlockedIssues", "issue/blocked", QUERY),
    call("listDependencyCycles", "issue/dep/cycles", QUERY),
    call("getDependencyTree", "issue/dep/tree", QUERY, positionals=["root_id"],
         flags={"max_depth": ["-d"]}),
    call("listIssues", "issue/list", QUERY,
         flags={"status": ["-s"], "assignee": ["-a"], "type": ["-t"], "label": ["-l"], "limit": ["-n"]},
         defaults={"sort": "priority"}),
    call("createIssue", "issue/create", BATCH, positionals=["title"], defaults={"issue_type": "task"},
         flags={"issue_type": ["-t", "--type"], "priority": ["-p"], "status": ["-s"], "assignee": ["-a"],
                "description": ["-d"], "labels": ["-l"], "parent_id": ["--parent"],
                "acceptance_criteria": ["--acceptance"]},
         from_file={"description": ["--body-file"], "design": ["--design-file"]},
         members={"waits_for": {"spawner_id": [], "gate": ["--waits-for-gate"]}}),
    call("queryIssues", "issue/query", QUERY, positionals=["q"],
         flags={"limit": ["-n"], "all": ["-a"], "reverse": ["-r"]}),
    call("countIssues", "issue/count", QUERY,
         flags={"status": ["-s"], "priority": ["-p"], "assignee": ["-a"], "type": ["-t"], "label": ["-l"]}),
    call("getIssue", "issue/show", QUERY, positionals=["id"]),
    call("updateIssue", "issue/update", BATCH, positionals=["id"], members={"patch": PATCH_MEMBERS}),
    call("listRelatedIssues", "issue/dep/list", QUERY, positionals=["id"], flags={"type": ["-t"]},
         defaults={"direction": "out"}),
    call("addComment", "issue/comment", BATCH, ["atomic"], positionals=["id", "text"],
         from_file={"text": ["-f", "--file"]}),
    call("claimIssue", "issue/claim", BATCH, ["idempotent"], positionals=["id"]),
    call("releaseIssue", "issue/unclaim", BATCH, positionals=["id"],
         flags={"expected_assignee": ["--if-assignee"]}),
    call("heartbeatIssue", "issue/heartbeat", BATCH, positionals=["id"]),
    call("closeIssue", "issue/close", BATCH, ["idempotent"], positionals=["id"],
         flags={"reason": ["-r"], "force": ["-f"], "expected_version": ["--if-revision"]},
         from_file={"reason": ["--reason-file"]}, defaults={"reason": "Closed"}),
    call("advanceMolecule", "issue/advance", BATCH, positionals=["id"]),
    call("reopenIssue", "issue/reopen", BATCH, ["idempotent"], positionals=["id"],
         flags={"reason": ["-r"], "expected_version": ["--if-revision"]}),
    call("compareAndSetMetadata", "issue/metadata/compare-and-set", BATCH, positionals=["id"]),
    call("sweepIssues", "issue/purge", BATCH,
         defaults={"dry_run": True, "tier": "ephemeral", "protect_referenced": False,
                   "protect_live_dependents": True}),
    call("sweepIssues", "issue/prune", BATCH,
         defaults={"dry_run": True, "tier": "durable", "protect_referenced": True,
                   "protect_live_dependents": False}),
    call("deleteIssues", "issue/delete", BATCH, ["atomic"], flags={"expected_version": ["--if-revision"]},
         defaults={"dry_run": True}),
    call("batchGetIssues", "issue/get-many", QUERY),
    call("reclaimIssues", "issue/reclaim", BATCH, defaults={"older_than_seconds": 600}),
    call("batchCreateIssues", "issue/create-many", BATCH, ["atomic"]),
    call("applyBatch", "issue/batch", BATCH, ["atomic"]),
    call("batchCloseIssues", "issue/close-many", BATCH),
    call("claimNextIssue", "issue/claim-next", BATCH, ["atomic"],
         flags={k: v for k, v in READY_FLAGS.items() if k != "limit"}),
    call("listDependencies", "issue/dep/edges", QUERY),
    call("countDependencyEdges", "issue/dep/count", QUERY),
    call("listBlockingAnnotations", "issue/blocking-annotations", QUERY),
    call("addDependencies", "issue/dep/add", BATCH, ["idempotent", "atomic"], positionals=["source", "target"],
         flags={"type": ["-t"], "target": ["--blocked-by", "--depends-on"]}),
    call("removeDependency", "issue/dep/remove", BATCH, ["idempotent"],
         positionals=["issue_id", "depends_on_id"]),
    call("listSettings", "config/list", QUERY),
    call("getSetting", "config/get", QUERY, positionals=["key"]),
    call("setSetting", "config/set", BATCH, positionals=["key", "value"]),
    call("unsetSetting", "config/unset", BATCH, positionals=["key"]),
    call("listMemories", "memory/list", QUERY, positionals=["search"]),
    call("rememberMemory", "memory/remember", BATCH, positionals=["content"]),
    call("getMemory", "memory/recall", QUERY, positionals=["key"]),
    call("forgetMemory", "memory/forget", BATCH, positionals=["key"]),
    call("listEvents", "events/list", QUERY),
]
NOT_DECLARED = {"health", "watchEvents"}

# Where the profile requires a Core or Write code rather than callable-error.
MAPPED = {
    "invalid_argument": "validation-failed",
    "invalid_cursor": "invalid-parameter",
    "unauthenticated": "unauthenticated",
    "not_found": "resource-not-found",
    "already_exists": "identity-taken",
    "idempotency_expired": "identity-taken",
    "internal": "temporarily-unavailable",
    "busy": "temporarily-unavailable",
    "db_unavailable": "temporarily-unavailable",
}
# precondition_failed is a stale revision guard except where a v0 operation has other guards.
OTHER_GUARDS = {"updateIssue", "releaseIssue", "applyBatch"}


def die(message):
    sys.exit(f"generate-issue-callables: {message}")


def carry(text):
    """v0's description as carried text, without what speaks of its code generation."""
    kept = []
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        if paragraph.startswith(STRIP_PARAGRAPH):
            continue
        if any(marker in paragraph for marker in STRIP_SENTENCE):
            sentences = re.split(r"(?<=[.!?])\s+(?=[`A-Z(])", paragraph)
            paragraph = " ".join(s for s in sentences if not any(m in s for m in STRIP_SENTENCE))
            if not paragraph.strip():
                continue
        paragraph = "\n".join(line.rstrip() for line in paragraph.split("\n"))
        kept.append(re.sub(r"^#{1,6} ", "##### ", paragraph, flags=re.M))
    return "\n\n".join(kept)


def translate(schema):
    """OpenAPI 3.0 to JSON Schema 2020-12: references, nullable, no generator annotations."""
    if not isinstance(schema, dict):
        return schema
    out = {}
    for key, value in schema.items():
        if key.startswith("x-") or key == "nullable":
            continue
        if key == "$ref":
            out[key] = "#/$defs/" + value.rsplit("/", 1)[-1]
        elif key == "description":
            text = carry(value)
            if text:
                out[key] = text
        elif key == "properties":
            out[key] = {name: translate(member) for name, member in value.items()}
        elif key in ("items", "additionalProperties", "not"):
            out[key] = translate(value)
        elif key in ("allOf", "anyOf", "oneOf"):
            out[key] = [translate(member) for member in value]
        else:
            out[key] = value
    if schema.get("nullable") and "type" in out:  # with no type, null is already admitted
        out["type"] = [out["type"], "null"]
        if "enum" in out and None not in out["enum"]:
            out["enum"] = [*out["enum"], None]
    return out


def references(schema, found):
    if isinstance(schema, dict):
        for key, value in schema.items():
            if key == "$ref" and isinstance(value, str):
                found.add(value.rsplit("/", 1)[-1])
            elif key not in ("default", "enum", "const", "examples"):
                references(value, found)
    elif isinstance(schema, list):
        for value in schema:
            references(value, found)


def cell(value):
    return json.dumps(value, ensure_ascii=False).replace("\\", "\\\\").replace("|", "\\|")


def inline(bare):
    """The DSL's inline Type for a schema, or None when only Advanced can carry it."""
    if bare == {}:
        return "any"
    if set(bare) == {"$ref"}:
        return "ref " + json.dumps(bare["$ref"])
    if set(bare) == {"type"} and isinstance(bare["type"], str):
        return {"string": "text"}.get(bare["type"], bare["type"])
    if set(bare) == {"type", "items"} and bare["type"] == "array" and isinstance(bare["items"], dict):
        item = inline(bare["items"])
        return None if item is None else f"array of ({item})"
    return None


STRUCTURAL = {"items", "contains", "not", "if", "then", "else", "allOf", "anyOf", "oneOf", "prefixItems",
              "patternProperties", "dependentSchemas", "propertyNames", "unevaluatedProperties",
              "unevaluatedItems", "contentSchema", "$defs"}


def fragment(name, schema):
    out = [f"<!-- bdp-schema:start {name} bundle={BUNDLE} -->", f"### Schema: {json.dumps(name)}", "", "Value: object", ""]
    advanced = {}
    closed = schema.get("additionalProperties")
    if isinstance(closed, bool):
        out += ["Other fields: " + ("allowed" if closed else "not allowed"), ""]
    elif closed is not None:
        advanced["additionalProperties"] = closed
    properties = schema.get("properties")
    if properties is not None and schema.get("required"):
        out += ["Required order: " + json.dumps(schema["required"], ensure_ascii=False), ""]
    keywords = {key: value for key, value in schema.items()
                if key not in STRUCTURAL and key not in ("properties", "additionalProperties")
                and not (key == "required" and properties is not None)}
    advanced.update({key: value for key, value in schema.items() if key in STRUCTURAL})
    if keywords:
        out += ["#### Keywords", "", "| Keyword | JSON value |", "| --- | --- |"]
        out += [f"| {key} | {cell(keywords[key])} |" for key in sorted(keywords)]
        out.append("")
    if properties is not None:
        required = set(schema.get("required", []))
        out += ["#### Properties", "", "| Name | Type | Required | Defined by | Meaning |", "| --- | --- | --- | --- | --- |"]
        residual = {}
        for member, value in properties.items():
            bare = {key: item for key, item in value.items() if key != "description"}
            kind = inline(bare)
            if kind is None:
                kind = "schema"
                residual[member] = bare
            meaning = cell(value["description"]) if value.get("description") else "—"
            out.append(f"| {cell(member)} | {kind} | {'yes' if member in required else 'no'} | — | {meaning} |")
        out.append("")
        if residual:
            advanced["properties"] = residual
    if advanced:
        out += ["#### Advanced", "", "```json-schema", json.dumps(advanced, indent=2, ensure_ascii=False), "```", ""]
    out.append(f"<!-- bdp-schema:end {name} bundle={BUNDLE} -->")
    return "\n".join(out)


def camel(name):
    words = [word for word in re.split(r"[/\-_.]", name) if word]
    return words[0] + "".join(word[0].upper() + word[1:] for word in words[1:])


def kebab(name):
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", name)
    return "-".join(word.lower() for word in re.split(r"[_\-]", spaced) if word)


def first_sentence(text):
    plain = " ".join((text or "").split())
    sentence = re.split(r"(?<=[.!?])\s+(?=[`A-Z(])", plain)[0]
    if len(sentence) > 220:
        sentence = sentence[:217].rsplit(" ", 1)[0] + " […]"
    return sentence.replace("|", "\\|") or "—"


def display_type(schema):
    if "$ref" in schema:
        return "`" + schema["$ref"].rsplit("/", 1)[-1] + "`"
    kind = schema.get("type")
    if isinstance(kind, list):
        return " or ".join({"string": "text"}.get(item, item) for item in kind)
    if kind == "array":
        return "array of " + display_type(schema.get("items", {}))
    return {"string": "text", None: "any"}.get(kind, kind)


class Contract:
    def __init__(self, doc):
        self.doc = doc
        self.schemas = doc["components"]["schemas"]
        self.responses = doc["components"]["responses"]
        self.parameters = doc["components"]["parameters"]
        self.ops = {}
        for path, item in doc["paths"].items():
            for method, op in item.items():
                if isinstance(op, dict) and "operationId" in op:
                    self.ops[op["operationId"]] = (method.upper(), path, op)

    def arguments(self, op_id):
        """(name, location, required, translated schema), path then query then body."""
        _, _, op = self.ops[op_id]
        rows, seen = [], set()
        for parameter in op.get("parameters", []):
            if "$ref" in parameter:
                parameter = self.parameters[parameter["$ref"].rsplit("/", 1)[-1]]
            schema = translate(parameter["schema"])
            text = carry(parameter.get("description", ""))
            if text:
                schema = {**schema, "description": text}
            rows.append((parameter["name"], parameter["in"], bool(parameter.get("required")), schema))
        rows.sort(key=lambda row: row[1] != "path")
        body = op.get("requestBody")
        if body:
            schema = body["content"]["application/json"]["schema"]
            schema = self.schemas[schema["$ref"].rsplit("/", 1)[-1]] if "$ref" in schema else schema
            required = schema.get("required", [])
            for name, member in schema.get("properties", {}).items():
                rows.append((name, "body", name in required, translate(member)))
        for name, *_ in rows:
            if name in seen:
                die(f"{op_id}: {name} is in two places")
            seen.add(name)
        return rows

    def result(self, op_id):
        schema = self.ops[op_id][2]["responses"]["200"]["content"]["application/json"]["schema"]
        return schema["$ref"].rsplit("/", 1)[-1]

    def codes(self, op_id):
        found = []
        for response in self.ops[op_id][2]["responses"].values():
            if "$ref" in response:
                response = self.responses[response["$ref"].rsplit("/", 1)[-1]]
            for code in response.get("x-bd-codes", []):
                if code not in found:
                    found.append(code)
        return found

    def reasons(self, op_id):
        kept = [code for code in self.codes(op_id) if code not in MAPPED]
        if op_id not in OTHER_GUARDS:
            kept = [code for code in kept if code != "precondition_failed"]
        return kept


def default_row(row, value):
    """A parameter the service defaults: optional, declared with its value and saying so."""
    name, location, _, schema = row
    text = schema.get("description", "")
    if name in DEFAULT_FALSE:
        text = re.sub(DEFAULT_FALSE[name], "", text, flags=re.S).strip()
    note = f"Omitted, this Callable uses `{json.dumps(value, ensure_ascii=False)}`. "
    return (name, location, False, {**schema, "default": value, "description": note + text})


def adapt(entry, rows):
    """The argument changes the product's router makes; see the adapters and defaults sections."""
    rows = [row for row in rows if row[0] not in ACTOR_MEMBERS]
    rows = [default_row(row, entry["defaults"][row[0]]) if row[0] in entry["defaults"] else row for row in rows]
    if entry["name"] == "issue/dep/add":
        edge = {"source": ("issue_id", "The edge's source. Flat form only; exactly one of this form and `edges`."),
                "target": ("depends_on_id", "The edge's target. Flat form only; exactly one of this form and `edges`."),
                "type": ("type", "The edge type. Flat form only; omitted, it is `blocks`.")}
        adapted = [(n, loc, False if n == "edges" else req, s) for n, loc, req, s in rows]
        for name, (member, text) in edge.items():
            base = {k: v for k, v in EDGE_MEMBERS[member].items() if k != "description"}
            adapted.append((name, "adapter", False, {**base, "description": text}))
        return adapted
    return rows


def member_schemas(contract, label, parameter, schema):
    """An object parameter's members, by name, or die: only an object has any."""
    if "$ref" in schema:
        schema = translate(contract.schemas[schema["$ref"].rsplit("/", 1)[-1]])
    if schema.get("type") != "object" or not schema.get("properties"):
        die(f"{label}: {parameter} is no object with declared members")
    return schema["properties"]


def cli_mapping(contract, entry, rows):
    """The declaration's cliMapping, checked against Callables section 2.5."""
    label = entry["name"]
    schemas = {name: schema for name, _, _, schema in rows}
    for group in (entry["positionals"], entry["flags"], entry["from_file"], entry["defaults"], entry["members"]):
        for name in group:
            if name not in schemas:
                die(f"{label}: {name} is no parameter")
    taken = {"--" + kebab(name): name for name in schemas}
    if len(taken) != len(schemas):
        die(f"{label}: two parameters derive one flag")
    for name, schema in schemas.items():
        kinds = schema.get("type")
        if kinds == "boolean" or (isinstance(kinds, list) and "boolean" in kinds):
            taken.setdefault("--no-" + kebab(name), name)
    for group in (entry["flags"], entry["from_file"]):
        for name, spellings in group.items():
            for spelling in spellings:
                if spelling in taken:
                    die(f"{label}: {spelling} is taken by {taken[spelling]}")
                taken[spelling] = name
    member_flags = []
    for parameter, members in entry["members"].items():
        declared = member_schemas(contract, label, parameter, schemas[parameter])
        for member, aliases in members.items():
            if member not in declared:
                die(f"{label}: {member} is no member of {parameter}")
            if member in ACTOR_MEMBERS:
                die(f"{label}: {parameter}.{member} would project to who is acting")
            spellings = ["--" + kebab(member), *aliases]
            if declared[member].get("type") == "boolean":
                spellings.append("--no-" + kebab(member))
            for spelling in spellings:
                if spelling in RESERVED_FLAGS:
                    die(f"{label}: {parameter}.{member} would take the reserved flag {spelling}")
                if spelling in taken:
                    die(f"{label}: {parameter}.{member} would take {spelling} from {taken[spelling]}")
                taken[spelling] = f"{parameter}.{member}"
            member_flags.append({"member": member, **({"names": aliases} if aliases else {}), "parameter": parameter})
    for name in entry["positionals"]:
        if schemas[name].get("type") == "array":
            die(f"{label}: {name} would need a variadic position")
    for name, value in entry["defaults"].items():
        schema = schemas[name]
        expected = {"boolean": bool, "string": str, "number": (int, float), "integer": int}[schema["type"]]
        if not isinstance(value, expected) or ("enum" in schema and value not in schema["enum"]):
            die(f"{label}: default {name}={value!r} fails its schema")
    mapping = {}
    if entry["flags"]:
        mapping["flags"] = [{"names": names, "parameter": name} for name, names in entry["flags"].items()]
    if entry["from_file"]:
        mapping["fromFile"] = [{"names": names, "parameter": name} for name, names in entry["from_file"].items()]
    if member_flags:
        mapping["memberFlags"] = member_flags
    if entry["positionals"]:
        mapping["positionals"] = [{"position": index, "parameter": name} for index, name in enumerate(entry["positionals"])]
    return mapping


def section(contract, entry, fragments, expected):
    op_id, name = entry["op"], entry["name"]
    method, path, op = contract.ops[op_id]
    stem = camel(name)
    rows = adapt(entry, contract.arguments(op_id))
    schema = {"description": f"Arguments of {name}.", "type": "object", "additionalProperties": False}
    if rows:
        schema["properties"] = {arg: value for arg, _, _, value in rows}
    required = [arg for arg, _, req, _ in rows if req]
    if required:
        schema["required"] = required
    fragments.append(fragment(f"{stem}Arguments", schema))
    expected[f"{stem}Arguments"] = schema

    reasons = contract.reasons(op_id)
    text = carry(op.get("description") or op["summary"])
    if name in ADAPTER_FALSE:
        sentence = re.compile(re.escape(ADAPTER_FALSE[name]) + r"[^.]*\.\s*")
        if not sentence.search(text):
            die(f"{name}: the adapter-false sentence is gone from the contract")
        text = sentence.sub("", text, count=1)
    out = [f"### {name} ({entry['kind']})", "", text, ""]
    declared = []
    if entry["promises"]:
        declared.append("Declared " + " and ".join(f"`{p}`" for p in entry["promises"]) + ".")
    if reasons:
        error = {"description": f"The error values {name} can return: v0's Problem, discriminated by code.",
                 "allOf": [{"$ref": "#/$defs/Problem"},
                           {"properties": {"code": {"enum": reasons}}}]}
        fragments.append(fragment(f"{stem}Error", error))
        expected[f"{stem}Error"] = error
        declared.append(f"Its `errorSchema` is `{stem}Error`.")
    if declared:
        out += [" ".join(declared), ""]
    out += [f"**`{stem}Arguments`** — Arguments of {name}.", ""]
    if rows:
        out += ["| Name | Type | Required | In | Meaning |", "| --- | --- | --- | --- | --- |"]
        for arg, location, req, value in rows:
            out.append(f"| `{arg}` | {display_type(value)} | {'yes' if req else 'no'} | {location} | {first_sentence(value.get('description'))} |")
        out.append("")
    out += [f"Result: `{contract.result(op_id)}`", "",
            f"Title: {op['summary']}", "",
            f"Routes to: v0 `{op_id}`, `{method} {path}`.", ""]
    if reasons:
        out += ["Declared reasons: " + ", ".join(f"`{code}`" for code in reasons) + ".", ""]
    mapping = cli_mapping(contract, entry, rows)
    if mapping:
        out += ["CLI mapping:", "", "```json", json.dumps(mapping, ensure_ascii=False), "```", ""]
    return "\n".join(out)


def table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines)


def document(contract, expected):
    fragments = []
    queries = [entry for entry in CALLABLES if entry["kind"] == QUERY]
    batches = [entry for entry in CALLABLES if entry["kind"] == BATCH]
    query_sections = [section(contract, entry, fragments, expected) for entry in queries]
    batch_sections = [section(contract, entry, fragments, expected) for entry in batches]

    # Every v0 component the declarations reach, verbatim, in the contract's order.
    used = set()
    references(expected, used)
    for op_id in {entry["op"] for entry in CALLABLES}:
        used.add(contract.result(op_id))
    pending = set(used)
    while pending:
        found = set()
        references(translate(contract.schemas[pending.pop()]), found)
        pending |= found - used
        used |= found
    components = []
    for name, schema in contract.schemas.items():
        if name in used:
            translated = translate(schema)
            components.append(fragment(name, translated))
            expected[name] = translated

    names = table(["Name", "Type", "v0 operation", "Route"], [
        [f"`{entry['name']}`", entry["kind"], f"`{entry['op']}`",
         f"`{contract.ops[entry['op']][0]} {contract.ops[entry['op']][1]}`"] for entry in CALLABLES])
    defaults = table(["Callable", "Omitted parameters"], [
        [f"`{entry['name']}`", "`" + json.dumps(entry["defaults"], ensure_ascii=False) + "`"]
        for entry in CALLABLES if entry["defaults"]])
    reason_rows = {}
    for entry in CALLABLES:
        for code in contract.reasons(entry["op"]):
            reason_rows.setdefault(code, []).append(entry["name"])
    reasons = table(["Reason", "Declared by"], [
        [f"`{code}`", ", ".join(f"`{name}`" for name in reason_rows[code])] for code in sorted(reason_rows)])
    mapped = {}
    for code, target in MAPPED.items():
        mapped.setdefault(target, []).append(code)
    mapped.setdefault("revision-mismatch", []).append("precondition_failed")
    mapping = table(["v0 code", "BDP code"], [
        [", ".join(f"`{code}`" for code in codes)
         + (" on a stale `expected_version`" if target == "revision-mismatch" else ""), f"`{target}`"]
        for target, codes in sorted(mapped.items())])

    return f"""---
status: editorial-draft
intended-status: type-package-operations
version: "preview-1"
---

# Beads Protocol — Issue and Dependency Callables

Editorial draft preview-1 · November 5, 2026 · generated from the v0 HTTP contract of OSS beads at {V0_COMMIT} by `scripts/generate-issue-callables.py`

This document is the operations half of the [Issue and Dependency Types](issue.md)
package. It is a routing table: each Callable routes to the product's v0 operation
over the [Callables](../../profiles/callables/callables.md) profile, and returns the
product's JSON. The operation's behavior is the product's and is not specified here.

The generic reads and `createBead`, `updateBead`, `deleteBead`, `createLink`,
`updateLink` and `deleteLink` are unchanged and stay available beside these names. A
Scope serving the Issue and Dependency Types package and advertising Callables1 offers
the names of §1. Rules marked **preview** may change in a later edition without a
compatibility promise.

## Contents

1. [Names](#1-names)
2. [The routing rule](#2-the-routing-rule)
3. [Product adapters](#3-product-adapters)
4. [Service defaults](#4-service-defaults)
5. [Errors](#5-errors)
6. [Queries](#6-queries)
7. [Batches](#7-batches)
8. [Conformance rows for preview-1](#8-conformance-rows-for-preview-1)
9. [Schemas](#9-schemas)
10. [Obsolescence](#10-obsolescence)

## 1. Names

{len(CALLABLES)} Callables are declared: {len(queries)} CallableQuery and {len(batches)} CallableBatch declarations, one per v0
operation. `issue/purge` and `issue/prune` are the one exception: both route to
`sweepIssues`, and they differ only in their defaults (§4). A caller of either may supply
`tier` itself, and either name then clears the tier it is given.

{names}

`health` and `watchEvents` stay plain routes of the product and are not declared.

## 2. The routing rule

- **Arguments.** A Callable's parameters are its v0 operation's path, query and body
  parameters, flattened into one closed `arguments` object under the Callables
  [OpenAPI rule](../../profiles/callables/callables.md#14-openapi), with v0's names, types
  and defaults, apart from §3 and §4. Each section's table says where each parameter goes.
- **Actor.** No declaration has an `actor` parameter. A CallableBatch invocation says who
  is acting in `revisionProvenance.actor`, and the product's router passes its `id` to v0
  (§3). It is caller-asserted data on every Callable, and never authentication.
- **Results.** A Callable's `resultSchema` is its v0 operation's 200 response schema,
  verbatim, and `result` is the product's JSON.
- **Identifiers.** Identifiers and classifications are v0's native forms: `bd-1`, `task`.
- **Revision tokens.** A Callable's result carries v0's `revision`, the row version. A
  generic Core record carries its own revision, which also moves on a change the row
  version does not ([Issue §7](issue.md#7-revisions-and-attribution)). `expected_version`
  on `issue/update`, `issue/close`, `issue/reopen` and `issue/delete` takes either: a Core
  revision holds only if the record still carries exactly that revision, and otherwise the
  invocation is `revision-mismatch` and writes nothing. An `issue/batch` item's
  `expected_version` takes the row version only, as v0's own routes do.
- **Schemas.** §9 carries each v0 component under its v0 name. OpenAPI 3.0's `nullable`
  is spelled as a JSON Schema type array, references point within this bundle, and the
  contract's code-generation annotations are absent. Declarations carry their own closure,
  as Callables §2.3 requires.
- **Carried text.** Descriptions are v0's, and speak in v0's terms: "this surface" is the
  v0 API, "this document" and its document-level rules are `{V0_PATH}` at {V0_COMMIT}, a
  status is v0's, and an operation path is the v0 route. §5 says how a v0 refusal reaches
  a Callable's caller.

## 3. Product adapters

Four things need a thin adapter in the product's router. Everything else in this
document is the routing rule above.

| Callable | Adapter |
| --- | --- |
| `issue/dep/add` | Accepts flat `source`, `target` and optional `type` beside `edges`, exactly one form per call, and sends v0 one edge built from the flat form. An omitted `type` is `blocks`. Both forms present, or neither, is `validation-failed` |
| Every CallableBatch whose v0 operation has `actor` | `revisionProvenance.actor.id` is sent as v0's `actor`. Where v0 requires it, an invocation with no actor is refused as `validation-failed`; `issue/purge`, `issue/prune` and `issue/delete` run without one. On `issue/claim`, `issue/claim-next`, `issue/unclaim`, `issue/heartbeat` and `issue/advance` the value also names the holder or the fence's subject, as v0's `actor` does |
| `issue/comment` | `revisionProvenance.actor.id` is sent as v0's `author`, and the comment stays signed under `author`. An invocation with no actor is refused as `validation-failed` |
| `config/set`, `config/unset`, `memory/remember`, `memory/forget` | v0 records no actor on these, so an invocation that supplies one is refused as `validation-failed` rather than dropped |

## 4. Service defaults

These are the native CLI's defaults, declared as each parameter's `default`, so an omitted
parameter behaves the same from the command tree, from `bdp call` and over HTTP. The
product's router supplies them before calling v0. They are this document's, and v0's own
route keeps its behavior.

{defaults}

`issue/delete`, `issue/purge` and `issue/prune` preview by default, and a real run sends
`dry_run: false`. `force` on `issue/delete` keeps its v0 meaning, orphaning
dependents.

## 5. Errors

A failure that meets the condition of a Core or Write code uses that code, as Callables
§9 requires:

{mapping}

Every other code a v0 operation documents is a declared reason of its Callable. It
answers `callable-error` at HTTP 409, and the `error` member is v0's `Problem` body
verbatim, whose `code` is the reason. That body keeps its own `status`, `title`,
`request_id` and extension members, so its `status` can differ from the invocation's.

```json
{{"code": "callable-error", "error": {{"status": 409, "title": "Conflict", "code": "already_claimed", "request_id": "r1", "assignee": "sam", "issue_status": "in_progress"}}}}
```

{reasons}

## 6. Queries

{chr(10).join(query_sections)}
## 7. Batches

{chr(10).join(batch_sections)}
## 8. Conformance rows for preview-1

| Row | Expectation |
| --- | --- |
| IC-1 | Every name of §1 is invocable |
| IC-2 | Each invocation's arguments and result validate against its declaration |

## 9. Schemas

The following markdown-json-schema/0.6 fragments, bundle `{BUNDLE}`, are the arguments and
errors each section names and the v0 components they reach;
`scripts/spec-schema-fragments.mjs` extracts them into
`issue-callables-preview-1.schema.json`.

{(chr(10) * 2).join(fragments + components)}

## 10. Obsolescence

The fragments of §9 extract to `specs/types/issue/issue-callables-preview-1.schema.json`.
This edition replaces the command-shaped draft archived at
`specs/history/issue-callables-reshaped-20261105/`, which is history, not authority.
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("v0", help="the pinned v0 contract, converted to JSON")
    parser.add_argument("output")
    parser.add_argument("--reset-bundle")
    parser.add_argument("--expected-defs")
    args = parser.parse_args()
    with open(args.v0, encoding="utf-8") as source:
        doc = json.load(source)
    digest = hashlib.sha256(json.dumps(doc, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    if digest != V0_SHA256:
        die(f"input is not the contract at {V0_COMMIT}: sha256 {digest}")
    contract = Contract(doc)
    global EDGE_MEMBERS
    EDGE_MEMBERS = {name: translate(member) for name, member in contract.schemas["DependencyEdge"]["properties"].items()}
    declared = {entry["op"] for entry in CALLABLES}
    if declared | NOT_DECLARED != set(contract.ops):
        die(f"the name table and the contract differ: {sorted(declared ^ (set(contract.ops) - NOT_DECLARED))}")
    expected = {}
    with open(args.output, "w", encoding="utf-8") as target:
        target.write(document(contract, expected))
    if args.reset_bundle:
        with open(args.reset_bundle, encoding="utf-8") as source:
            bundle = json.load(source)
        for key in ("x-bdp-schema-definitions", "x-bdp-schema-sources"):
            bundle.pop(key, None)
        bundle["$defs"] = {}
        with open(args.reset_bundle, "w", encoding="utf-8") as target:
            json.dump(bundle, target, indent=2, ensure_ascii=False)
            target.write("\n")
    if args.expected_defs:
        with open(args.expected_defs, "w", encoding="utf-8") as target:
            json.dump(expected, target, indent=1, ensure_ascii=False, sort_keys=True)
            target.write("\n")
    print(f"{len(CALLABLES)} declarations, {len(expected)} fragments.")


if __name__ == "__main__":
    main()
