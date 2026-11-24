"""Exercise the CI editorial classifier with real temporary Git histories.

The v0.1 schema-ownership fast-path was retired with the v0.1 toolchain; the
classifier is now purely path-based plus a symlink/binary-smuggling guard. Any
schema, package.json or product change runs the full implementation/regression
lanes, so the surviving contract is: documents and the small editorial
tooling/entry set classify as specification-only, everything else does not, and
nothing non-plain-text can masquerade as an editorial document.
"""

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest


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
        self.write("docs/cli-design/client.md", "# Client\n")
        self.write("packages/server/src/index.ts", "export const version = 1;\n")
        self.write("package.json", '{"dependencies": {"example": "1"}}\n')
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-c", "user.name=Spec classifier fixture", "-c",
             "user.email=spec-fixture@example.invalid", *args], cwd=self.root,
            stderr=subprocess.STDOUT).decode().strip()

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)

    def commit(self):
        self.git("add", "--all")
        self.git("commit", "--quiet", "-m", "classifier fixture")
        return self.git("rev-parse", "HEAD")

    def classify(self):
        head = self.commit()
        import unittest.mock as mock
        with mock.patch.object(editorial, "ROOT", self.root):
            return editorial.editorial_change(self.base, head)

    def test_cli_document_is_specification_only(self):
        self.write("docs/cli-design/client.md", "# Updated client\n")
        self.assertTrue(self.classify())

    def test_history_document_is_specification_only(self):
        self.write("docs/history/profiles/core/core.md", "# Retired core\n")
        self.assertTrue(self.classify())

    def test_product_file_requires_implementation(self):
        self.write("packages/server/src/index.ts", "export const version = 2;\n")
        self.assertFalse(self.classify())

    def test_product_file_in_same_change_requires_implementation(self):
        self.write("docs/cli-design/client.md", "# Updated client\n")
        self.write("packages/server/src/index.ts", "export const version = 2;\n")
        self.assertFalse(self.classify())

    def test_package_json_change_requires_implementation(self):
        self.write("package.json", '{"dependencies": {"example": "2"}}\n')
        self.assertFalse(self.classify())

    def test_named_shell_examples_have_a_specification_lane(self):
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
