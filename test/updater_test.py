"""Update disposable distributions from local archives, never the published app."""

import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.bundle_launcher import bundle


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="kuroko updater ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.installation = self.root / "installed app"
        self.installation.mkdir()
        self.launcher = self.installation / "kuroko2.sh"
        bundle(ROOT / "kuroko2.sh", ROOT / "kuroko2_server.py", self.launcher)
        self.original_script = re.sub(r"^build=.*$", "build=100-aaaaaaa-2026-01-01",
                                      self.launcher.read_text(), count=1, flags=re.MULTILINE).encode()
        self.launcher.write_bytes(self.original_script)
        self.original_html = b"<!doctype html><title>Original app</title>"
        (self.installation / "index.html").write_bytes(self.original_html)
        self.next_script = self.original_script.replace(b"build=100-aaaaaaa-2026-01-01", b"build=200-bbbbbbb-2026-02-01")
        self.next_html = b"<!doctype html><title>Updated app</title>"
        self.archive = self.root / "latest.zip"

    def package(self, script=None, html=None, extra=None):
        entries = {"kuroko2.sh": self.next_script if script is None else script,
                   "index.html": self.next_html if html is None else html}
        entries.update(extra or {})
        with ZipFile(self.archive, "w") as package:
            for name, data in entries.items():
                if data is not None:
                    package.writestr("kuroko-latest/" + name, data)

    def run_update(self, answer="y\n", launcher=None, environment=None):
        env = dict(os.environ, KUROKO_UPDATE_URL=self.archive.as_uri(), PYTHONDONTWRITEBYTECODE="1")
        env.update(environment or {})
        return subprocess.run([str(launcher or self.launcher), "--update"], input=answer,
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              cwd=self.root, env=env, timeout=15)

    def assert_unchanged(self):
        self.assertEqual(self.launcher.read_bytes(), self.original_script)
        self.assertEqual((self.installation / "index.html").read_bytes(), self.original_html)
        self.assertEqual(list(self.installation.glob(".kuroko2-update-*")), [])

    def test_accept_updates_both_runtime_files_and_packaged_docs_only(self):
        unrelated = self.installation / "my-figure.pdf"
        unrelated.write_bytes(b"keep my PDF")
        self.package(extra={"README.md": b"New instructions", "THIRD_PARTY_LICENSES.md": b"New notices",
                            "docs/development.md": b"New development notes", "unrelated.txt": b"Ignore"})
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Installed build: aaaaaaa (2026-01-01)", result.stdout)
        self.assertIn("Available build: bbbbbbb (2026-02-01)", result.stdout)
        self.assertIn("A newer kuroko 2 build", result.stdout)
        self.assertIn("Install this update? [y/N]", result.stderr)
        self.assertEqual(self.launcher.read_bytes(), self.next_script)
        self.assertEqual(self.launcher.stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.installation / "index.html").read_bytes(), self.next_html)
        self.assertEqual((self.installation / "README.md").read_bytes(), b"New instructions")
        self.assertEqual((self.installation / "docs/development.md").read_bytes(), b"New development notes")
        self.assertEqual(unrelated.read_bytes(), b"keep my PDF")
        self.assertFalse((self.installation / "unrelated.txt").exists())
        self.assertEqual(list(self.installation.glob(".kuroko2-update-*")), [])

    def test_decline_and_closed_stdin_keep_everything_unchanged(self):
        self.package()
        for answer in ("n\n", "\n", ""):
            with self.subTest(answer=answer):
                result = self.run_update(answer)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Update cancelled.", result.stdout)
                self.assert_unchanged()

    def test_identical_build_does_not_prompt(self):
        self.package(script=self.original_script, html=self.original_html)
        result = self.run_update("")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("already up to date", result.stdout)
        self.assertNotIn("Install this update?", result.stderr)
        self.assert_unchanged()

    def test_older_and_same_timestamp_different_builds_are_identified(self):
        for timestamp, description in ((50, "older than this copy"), (100, "differs from this copy")):
            with self.subTest(timestamp=timestamp):
                self.package(script=self.next_script.replace(b"build=200-", f"build={timestamp}-".encode()))
                result = self.run_update("n\n")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(description, result.stdout)
                self.assert_unchanged()

    def test_bad_downloads_and_invalid_payloads_leave_installed_app_intact(self):
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assert_unchanged()
        self.archive.write_bytes(b"not a zip")
        self.assertNotEqual(self.run_update().returncode, 0)
        self.assert_unchanged()
        invalid = [dict(extra={"index.html": None}), dict(html=b"not html"),
                   dict(script=b"#!/usr/bin/env bash\nbuild=200-bbbbbbb-2026-02-01\n"),
                   dict(script=self.next_script + b"\nif\n"),
                   dict(script=self.next_script.replace(b"build=200-bbbbbbb-2026-02-01", b"build=$(touch should-not-run)")),
                   dict(extra={"../../escaped.txt": b"must not escape"})]
        for payload in invalid:
            with self.subTest(payload=list(payload)):
                self.package(**payload)
                result = self.run_update()
                self.assertNotEqual(result.returncode, 0)
                self.assert_unchanged()
        self.assertFalse((self.root / "escaped.txt").exists())
        self.assertFalse((self.root / "should-not-run").exists())
        self.package()
        with ZipFile(self.archive, "a") as archive:
            member = ZipInfo("kuroko-latest/shortcut")
            member.create_system = 3
            member.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(member, "../../outside")
        self.assertNotEqual(self.run_update().returncode, 0)
        self.assert_unchanged()

    def test_symlink_invocation_updates_real_installation(self):
        self.package()
        bin_directory = self.root / "bin"
        bin_directory.mkdir()
        link = bin_directory / "kuroko2"
        link.symlink_to(self.launcher)
        result = self.run_update(launcher=link)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(link.is_symlink())
        self.assertEqual(self.launcher.read_bytes(), self.next_script)
        self.assertEqual((self.installation / "index.html").read_bytes(), self.next_html)
        self.assertEqual({file.name for file in bin_directory.iterdir()}, {"kuroko2"})

    def test_source_checkout_and_linked_targets_are_rejected_before_install(self):
        self.package()
        marker = self.installation / ".git"
        marker.write_text("gitdir: ../elsewhere")
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Source checkouts must be rebuilt", result.stderr)
        self.assert_unchanged()
        marker.unlink()
        external = self.root / "external.html"
        external.write_bytes(self.original_html)
        html = self.installation / "index.html"
        html.unlink()
        html.symlink_to(external)
        self.assertNotEqual(self.run_update().returncode, 0)
        self.assertTrue(html.is_symlink())
        self.assertEqual(external.read_bytes(), self.original_html)
        self.assertEqual(self.launcher.read_bytes(), self.original_script)

    def test_install_failure_restores_already_replaced_launcher(self):
        self.package()
        injected = self.root / "injected"
        injected.mkdir()
        (injected / "sitecustomize.py").write_text(
            "import os\n"
            "original_replace = os.replace\n"
            "def replacement(source, destination):\n"
            "    if str(source).endswith('/payload/index.html'):\n"
            "        raise PermissionError('Simulated installation failure')\n"
            "    return original_replace(source, destination)\n"
            "os.replace = replacement\n"
        )
        result = self.run_update(environment={"PYTHONPATH": str(injected)})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Simulated installation failure", result.stderr)
        self.assert_unchanged()

    def test_packaged_build_marker_is_safe_and_source_guard_does_not_need_git(self):
        packaged = self.root / "packaged.sh"
        with patch("tools.bundle_launcher.subprocess.check_output", return_value="123-abcdef123-2026-01-02\n"):
            bundle(ROOT / "kuroko2.sh", ROOT / "kuroko2_server.py", packaged)
        self.assertIn("\nbuild=123-abcdef123-2026-01-02\n", packaged.read_text())
        with patch("tools.bundle_launcher.subprocess.check_output", return_value="$(touch unexpected)"):
            with self.assertRaisesRegex(ValueError, "Invalid Git build identifier"):
                bundle(ROOT / "kuroko2.sh", ROOT / "kuroko2_server.py", packaged)
        self.launcher.write_text((ROOT / "kuroko2.sh").read_text())
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Source checkouts must be rebuilt", result.stderr)


if __name__ == "__main__":
    unittest.main()
