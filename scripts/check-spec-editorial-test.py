"""Exercise the CI boundary with real temporary Git histories, including refusals."""

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "editorial", Path(__file__).with_name("check-spec-editorial.py"))
editorial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(editorial)


class ClassificationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="bdp-spec-ci-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git("init", "--quiet")
        self.package = {"dependencies": {"example": "1"}, "scripts": {
            "build": "compiler", "test:markdown": "node --test codec.test.mjs"}}
        self.bundle = {"$id": "https://example.invalid/schema", "$defs": {
            "coreRecord": {"type": "object"}, "otherProfile": {"const": 0}}}
        self.write("package.json", self.package)
        self.write_bundles(self.bundle)
        self.write("docs/cli-design/client.md", "# Client\n")
        self.write("packages/server/src/index.ts", "export const version = 1;\n")
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-c", "user.name=Spec classifier fixture", "-c",
             "user.email=spec-fixture@example.invalid", *args], cwd=self.root,
            stderr=subprocess.STDOUT).decode().strip()

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value if isinstance(value, str) else json.dumps(value) + "\n")

    def write_bundles(self, value):
        for name in editorial.CORE_BUNDLES:
            self.write(name, value)

    def commit(self):
        self.git("add", "--all")
        self.git("commit", "--quiet", "-m", "classifier fixture")
        return self.git("rev-parse", "HEAD")

    def classify(self):
        head = self.commit()
        with patch.object(editorial, "ROOT", self.root), patch.object(editorial, "CORE_BASELINE_DEFINITIONS", {"coreRecord"}):
            return editorial.editorial_change(self.base, head)

    def test_cli_document_is_specification_only(self):
        self.write("docs/cli-design/client.md", "# Updated client\n")
        self.assertTrue(self.classify())

    def test_product_file_in_same_change_requires_implementation(self):
        self.write("docs/cli-design/client.md", "# Updated client\n")
        self.write("packages/server/src/index.ts", "export const version = 2;\n")
        self.assertFalse(self.classify())

    def test_core_distribution_and_extractor_wiring_are_specification_only(self):
        updated = copy.deepcopy(self.bundle)
        updated[editorial.CORE_OWNERSHIP] = ["coreRecord"]
        updated["$defs"]["coreRecord"]["description"] = "Reviewed Core record"
        self.write_bundles(updated)
        self.package["scripts"]["test:markdown"] += " scripts/spec-schema-fragments.node-test.mjs"
        self.write("package.json", self.package)
        self.assertTrue(self.classify())

    def test_dependency_change_requires_implementation(self):
        self.package["dependencies"]["example"] = "2"
        self.write("package.json", self.package)
        self.assertFalse(self.classify())

    def test_other_package_script_change_requires_implementation(self):
        self.package["scripts"]["build"] = "different compiler"
        self.write("package.json", self.package)
        self.assertFalse(self.classify())

    def test_removing_codec_tests_requires_implementation(self):
        self.package["scripts"]["test:markdown"] = "node --test scripts/spec-schema-fragments.node-test.mjs"
        self.write("package.json", self.package)
        self.assertFalse(self.classify())

    def test_other_profile_definition_change_requires_implementation(self):
        updated = copy.deepcopy(self.bundle)
        updated[editorial.CORE_OWNERSHIP] = ["coreRecord"]
        updated["$defs"]["otherProfile"]["const"] = 1
        self.write_bundles(updated)
        self.assertFalse(self.classify())

    def test_negative_zero_drift_outside_core_is_not_lost(self):
        updated = copy.deepcopy(self.bundle)
        updated[editorial.CORE_OWNERSHIP] = ["coreRecord"]
        self.write_bundles(json.dumps(updated).replace('"const": 0', '"const": -0'))
        self.assertFalse(self.classify())

    def test_one_distribution_cannot_drift_from_the_other(self):
        updated = copy.deepcopy(self.bundle)
        updated[editorial.CORE_OWNERSHIP] = ["coreRecord"]
        self.write(sorted(editorial.CORE_BUNDLES)[0], updated)
        self.assertFalse(self.classify())

    def test_deleted_owned_definition_is_not_an_editorial_shortcut(self):
        original = copy.deepcopy(self.bundle)
        original[editorial.CORE_OWNERSHIP] = ["coreRecord"]
        self.write_bundles(original)
        self.base = self.commit()
        updated = copy.deepcopy(original)
        updated[editorial.CORE_OWNERSHIP] = []
        del updated["$defs"]["coreRecord"]
        self.write_bundles(updated)
        self.assertFalse(self.classify())

    def test_schema_identity_change_requires_implementation(self):
        updated = copy.deepcopy(self.bundle)
        updated[editorial.CORE_OWNERSHIP] = ["coreRecord"]
        updated["$id"] = "https://example.invalid/different"
        self.write_bundles(updated)
        self.assertFalse(self.classify())

    def test_only_the_reviewed_optional_events_write_change_is_allowed(self):
        original = copy.deepcopy(self.bundle)
        original["$defs"]["writeDiscovery"] = {
            "type": "object", "required": ["scope", "events", "operations"]}
        self.write_bundles(original)
        self.base = self.commit()
        updated = copy.deepcopy(original)
        updated[editorial.CORE_OWNERSHIP] = ["coreRecord"]
        updated["$defs"]["writeDiscovery"]["required"].remove("events")
        self.write_bundles(updated)
        self.assertTrue(self.classify())

    def test_adjacent_write_discovery_edits_require_implementation(self):
        original = copy.deepcopy(self.bundle)
        original["$defs"]["writeDiscovery"] = {
            "type": "object", "required": ["scope", "events", "operations"]}
        self.write_bundles(original)
        self.base = self.commit()
        updated = copy.deepcopy(original)
        updated[editorial.CORE_OWNERSHIP] = ["coreRecord"]
        updated["$defs"]["writeDiscovery"]["required"] = ["scope"]
        self.write_bundles(updated)
        self.assertFalse(self.classify())

    def test_named_shell_examples_have_a_syntax_checked_specification_lane(self):
        self.write("docs/cli-design/overview/examples/csv-review.sh", "#!/bin/bash\ntrue\n")
        self.assertTrue(self.classify())

    def test_other_executable_scripts_require_implementation(self):
        self.write("docs/cli-design/overview/examples/new-command.sh", "#!/bin/bash\ntrue\n")
        self.assertFalse(self.classify())

    def test_markdown_symlink_cannot_hide_a_product_change(self):
        path = self.root / "docs/cli-design/client.md"
        path.unlink()
        path.symlink_to("../../packages/server/src/index.ts")
        self.assertFalse(self.classify())

    def profile_adoption(self):
        updated = copy.deepcopy(self.bundle)
        updated[editorial.PROFILE_OWNERSHIP] = ["coreRecord", "otherProfile"]
        updated[editorial.PROFILE_SOURCES] = {
            "specs/profiles/core/core.md": ["coreRecord"],
            "specs/profiles/events/events.md": [],
            "specs/profiles/write/write.md": ["otherProfile"],
        }
        return updated

    def test_exact_cross_profile_authoring_adoption_is_specification_only(self):
        self.write_bundles(self.profile_adoption())
        self.assertTrue(self.classify())

    def test_cross_profile_adoption_cannot_smuggle_write_semantics(self):
        updated = self.profile_adoption()
        updated["$defs"]["otherProfile"]["const"] = 1
        self.write_bundles(updated)
        self.assertFalse(self.classify())

    def test_profile_source_inventory_cannot_omit_or_duplicate_a_definition(self):
        updated = self.profile_adoption()
        updated[editorial.PROFILE_SOURCES]["specs/profiles/events/events.md"] = ["coreRecord"]
        self.write_bundles(updated)
        self.assertFalse(self.classify())

    def test_distinct_feature_schema_adoption_preserves_existing_meaning(self):
        path = "specs/profiles/types/types-v1.schema.json"
        original = {"$id": "https://example.invalid/types", "$defs": {"beadRecord": {"type": "object"}}}
        self.write(path, original)
        self.base = self.commit()
        updated = copy.deepcopy(original)
        updated[editorial.PROFILE_OWNERSHIP] = ["beadRecord"]
        updated[editorial.PROFILE_SOURCES] = {"specs/profiles/types/types.md": ["beadRecord"]}
        self.write(path, updated)
        self.assertTrue(self.classify())

    def test_distinct_feature_schema_semantic_change_requires_implementation(self):
        path = "specs/profiles/types/types-v1.schema.json"
        original = {"$id": "https://example.invalid/types", "$defs": {"beadRecord": {"type": "object"}}}
        self.write(path, original)
        self.base = self.commit()
        updated = copy.deepcopy(original)
        updated["$defs"]["beadRecord"]["type"] = "string"
        self.write(path, updated)
        self.assertFalse(self.classify())

    def test_write_definition_cannot_be_relabelled_core_to_hide_a_semantic_edit(self):
        updated = self.profile_adoption()
        updated[editorial.PROFILE_SOURCES]["specs/profiles/core/core.md"].append("otherProfile")
        updated[editorial.PROFILE_SOURCES]["specs/profiles/write/write.md"] = []
        updated["$defs"]["otherProfile"]["const"] = 2
        self.write_bundles(updated)
        self.assertFalse(self.classify())

    def test_authored_core_semantic_edits_are_checked_as_specs_not_runtime_conformance(self):
        updated = self.profile_adoption()
        updated["$defs"]["coreRecord"]["additionalProperties"] = False
        self.write_bundles(updated)
        self.assertTrue(self.classify())

    def test_exact_feature_documentation_pointer_move_is_allowed_without_constraint_drift(self):
        path = "specs/profiles/types/types-v1.schema.json"
        original = {"$id": "https://example.invalid/types", "$comment": "See types-binding.md for status.", "$defs": {"one": {"type": "string"}}}
        self.write(path, original)
        self.base = self.commit()
        updated = copy.deepcopy(original)
        updated["$comment"] = "See types.md#12-types1-capability-and-rejectable-selection for status."
        self.write(path, updated)
        self.assertTrue(self.classify())

    def test_removing_source_map_cannot_enable_foreign_definition_edits(self):
        updated = self.profile_adoption()
        del updated[editorial.PROFILE_SOURCES]
        updated["$defs"]["otherProfile"]["const"] = 2
        self.write_bundles(updated)
        self.assertFalse(self.classify())


if __name__ == "__main__":
    unittest.main(verbosity=2)
