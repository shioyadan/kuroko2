"""Exercise the local bridge against disposable Git remotes, never Overleaf."""

import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kuroko2_server import BridgeError, GitFailure, OverleafBridge, make_server


PDF = b"%PDF-1.7\noriginal figure\n%%EOF\n"
EDITED_PDF = b"%PDF-1.7\nedited figure\n%%EOF\n"
OTHER_PDF = b"%PDF-1.7\nanother author's figure\n%%EOF\n"


class LocalBridge(OverleafBridge):
    """Only tests can replace the production URL allowlist."""

    @staticmethod
    def validate_url(url):
        if not Path(url).is_absolute():
            raise ValueError("A test remote must be an absolute path")
        return url


class GitFixture(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="kuroko-overleaf-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        # No helpers, identities, hooks, URL rewrites, or command overrides from
        # the machine running the tests may affect these disposable repositories.
        environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        environment.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                            "GIT_TERMINAL_PROMPT": "0"})
        self.environment = patch.dict(os.environ, environment, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.remote = self.root / "remote.git"
        self.editor = self.root / "editor"
        self.git("init", "--bare", "--initial-branch=master", str(self.remote))
        self.git("init", "--initial-branch=master", str(self.editor))
        self.git("config", "user.name", "Fixture Author", cwd=self.editor)
        self.git("config", "user.email", "fixture@example.invalid", cwd=self.editor)
        self.write("paper.tex", b"A paper referencing figures/existing.pdf\n")
        self.write("figures/existing.pdf", PDF)
        self.write("figures/日本語 space.PDF", PDF)
        self.commit_and_push("Initial project")
        self.bridge = LocalBridge()
        self.addCleanup(self.bridge.close)

    def git(self, *args, cwd=None, data=None):
        result = subprocess.run(["git", *args], cwd=cwd or self.root, input=data,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return result.stdout

    def write(self, path, data):
        target = self.editor / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def commit_and_push(self, message="Concurrent edit"):
        self.git("add", "--all", cwd=self.editor)
        self.git("commit", "-m", message, cwd=self.editor)
        self.git("push", str(self.remote), "master", cwd=self.editor)

    def head(self):
        return self.git("--git-dir", str(self.remote), "rev-parse", "refs/heads/master").strip()

    def contents(self, path):
        return self.git("--git-dir", str(self.remote), "show", "refs/heads/master:" + path)

    def connect(self):
        return self.bridge.connect(str(self.remote))

    def oid(self, path="figures/existing.pdf"):
        return next(item["oid"] for item in self.bridge.snapshot()["files"] if item["path"] == path)

    def assert_rejected(self, action, code=None):
        with self.assertRaises(Exception) as raised:
            action()
        if code is not None:
            self.assertEqual(getattr(raised.exception, "code", None), code)
        return raised.exception


class BridgeTests(GitFixture):
    def test_list_and_read_only_pdf_blobs(self):
        self.assertIsNone(self.bridge.snapshot()["url"])
        snapshot = self.connect()
        self.assertEqual(snapshot["api"], "kuroko-overleaf-v1")
        self.assertTrue(snapshot["session"])
        self.assertEqual({item["path"] for item in snapshot["files"]},
                         {"figures/existing.pdf", "figures/日本語 space.PDF"})
        self.assertEqual(self.bridge.read_pdf("figures/existing.pdf", self.oid()), PDF)
        self.assert_rejected(lambda: self.bridge.read_pdf("paper.tex", self.oid()))

    def test_upload_changes_only_one_file_and_identical_upload_has_no_commit(self):
        self.connect()
        before = self.head()
        result = self.bridge.upload("figures/new figure.pdf", "", EDITED_PDF)
        self.assertEqual(result["result"], "uploaded")
        after = self.head()
        self.assertNotEqual(before, after)
        self.assertEqual(self.contents("figures/new figure.pdf"), EDITED_PDF)
        self.assertEqual(self.contents("figures/existing.pdf"), PDF)
        self.assertEqual(self.contents("paper.tex"), b"A paper referencing figures/existing.pdf\n")
        changed = self.git("--git-dir", str(self.remote), "diff-tree", "--no-commit-id",
                           "--name-only", "-r", after.decode()).decode().strip()
        self.assertEqual(changed, "figures/new figure.pdf")
        result = self.bridge.upload("figures/new figure.pdf", self.oid("figures/new figure.pdf"), EDITED_PDF)
        self.assertEqual(result["result"], "unchanged")
        self.assertEqual(self.head(), after)

    def test_overwrite_uses_expected_blob_and_preserves_other_remote_edits(self):
        self.connect()
        expected = self.oid()
        self.write("paper.tex", b"A concurrent paper edit\n")
        self.write("new-section.tex", b"A new section\n")
        self.commit_and_push()
        result = self.bridge.upload("figures/existing.pdf", expected, EDITED_PDF)
        self.assertEqual(result["result"], "uploaded")
        self.assertEqual(self.contents("figures/existing.pdf"), EDITED_PDF)
        self.assertEqual(self.contents("paper.tex"), b"A concurrent paper edit\n")
        self.assertEqual(self.contents("new-section.tex"), b"A new section\n")

    def test_changed_remote_target_requires_a_fresh_confirmation(self):
        self.connect()
        expected = self.oid()
        self.write("figures/existing.pdf", OTHER_PDF)
        self.commit_and_push()
        before = self.head()
        self.assert_rejected(lambda: self.bridge.upload("figures/existing.pdf", expected, EDITED_PDF), "conflict")
        self.assertEqual(self.head(), before)
        self.assertEqual(self.contents("figures/existing.pdf"), OTHER_PDF)
        snapshot = self.bridge.refresh()
        self.assertNotEqual(self.oid(), expected)
        self.assertEqual(self.bridge.read_pdf("figures/existing.pdf", self.oid()), OTHER_PDF)
        self.assertEqual(snapshot["url"], str(self.remote))

    def test_new_file_collision_and_stale_preview_do_not_overwrite(self):
        self.connect()
        old = self.oid()
        self.write("figures/new.pdf", OTHER_PDF)
        self.write("figures/existing.pdf", OTHER_PDF)
        self.commit_and_push()
        before = self.head()
        self.assert_rejected(lambda: self.bridge.upload("figures/new.pdf", "", EDITED_PDF), "conflict")
        self.assertEqual(self.head(), before)
        self.bridge.refresh()
        self.assert_rejected(lambda: self.bridge.read_pdf("figures/existing.pdf", old), "conflict")

    def test_upload_rejects_unsafe_paths_and_non_pdf_data(self):
        self.connect()
        before = self.head()
        for path in ["../escape.pdf", "/absolute.pdf", "figures/../../escape.pdf", "a\\b.pdf",
                     ".git/config.pdf", "figures/.git/config.pdf", "a//b.pdf", "a/./b.pdf",
                     "not-a-pdf.txt", "figure.pdf\x00", "C:/figure.pdf"]:
            with self.subTest(path=path):
                self.assert_rejected(lambda: self.bridge.upload(path, "", EDITED_PDF))
        self.assert_rejected(lambda: self.bridge.upload("figures/new.pdf", "", b"not a PDF"))
        self.assertEqual(self.head(), before)

    def test_symlinks_and_directory_collisions_are_not_replaced(self):
        (self.editor / "alias").symlink_to("figures", target_is_directory=True)
        (self.editor / "shortcut.pdf").symlink_to("figures/existing.pdf")
        self.write("folder.pdf/child.txt", b"keep this file")
        self.commit_and_push()
        snapshot = self.connect()
        self.assertNotIn("shortcut.pdf", [item["path"] for item in snapshot["files"]])
        before = self.head()
        for path in ["alias/new.pdf", "shortcut.pdf", "folder.pdf", "paper.tex/new.pdf"]:
            with self.subTest(path=path):
                self.assert_rejected(lambda: self.bridge.upload(path, "", EDITED_PDF))
        self.assertEqual(self.head(), before)
        self.assertEqual(self.contents("folder.pdf/child.txt"), b"keep this file")

    def test_disconnect_clears_session_project_without_changing_remote(self):
        self.connect()
        before = self.head()
        snapshot = self.bridge.disconnect()
        self.assertIsNone(snapshot["url"])
        self.assertEqual(snapshot["files"], [])
        self.assertEqual(self.head(), before)
        self.assert_rejected(lambda: self.bridge.upload("figure.pdf", "", EDITED_PDF))

    def test_upload_cannot_follow_a_project_switch_from_another_tab(self):
        self.connect()
        previous_project = str(self.remote)
        previous_oid = self.oid()
        original_head = self.head()
        other_remote = self.root / "other-project.git"
        self.git("clone", "--bare", str(self.remote), str(other_remote))
        self.bridge.connect(str(other_remote))
        other_head = self.git("--git-dir", str(other_remote), "rev-parse", "master")
        # Matching blob IDs are not enough: both cloned projects have the same
        # existing figure, and a new destination is absent from both projects.
        for path, expected in [("figures/new.pdf", ""), ("figures/existing.pdf", previous_oid)]:
            with self.subTest(path=path):
                self.assert_rejected(lambda: self.bridge.upload(
                    path, expected, EDITED_PDF, expected_project=previous_project), "project_changed")
        self.assertEqual(self.head(), original_head)
        self.assertEqual(self.git("--git-dir", str(other_remote), "rev-parse", "master"), other_head)
        result = self.bridge.upload("figures/new.pdf", "", EDITED_PDF, expected_project=str(other_remote))
        self.assertEqual(result["result"], "uploaded")
        self.assertEqual(self.head(), original_head)
        self.assertEqual(self.git("--git-dir", str(other_remote), "show", "master:figures/new.pdf"), EDITED_PDF)

    def test_push_race_retries_only_when_the_target_is_unchanged(self):
        self.connect()
        expected = self.oid()
        original_git = self.bridge._git
        pushes = []

        def concurrent_edit(*args, **kwargs):
            if args[0] == "push":
                pushes.append(args)
                if len(pushes) == 1:
                    self.write("paper.tex", b"Edit arriving immediately before push\n")
                    self.commit_and_push()
            return original_git(*args, **kwargs)

        with patch.object(self.bridge, "_git", side_effect=concurrent_edit):
            result = self.bridge.upload("figures/existing.pdf", expected, EDITED_PDF)
        self.assertEqual(result["result"], "uploaded")
        self.assertEqual(len(pushes), 2)
        self.assertTrue(all("--force" not in args and not any(arg.startswith("+") for arg in args) for args in pushes))
        self.assertEqual(self.contents("figures/existing.pdf"), EDITED_PDF)
        self.assertEqual(self.contents("paper.tex"), b"Edit arriving immediately before push\n")

    def test_push_race_does_not_replace_a_concurrent_pdf_edit(self):
        self.connect()
        expected = self.oid()
        original_git = self.bridge._git
        pushes = []

        def concurrent_edit(*args, **kwargs):
            if args[0] == "push":
                pushes.append(args)
                self.write("figures/existing.pdf", OTHER_PDF)
                self.commit_and_push()
            return original_git(*args, **kwargs)

        with patch.object(self.bridge, "_git", side_effect=concurrent_edit):
            self.assert_rejected(lambda: self.bridge.upload("figures/existing.pdf", expected, EDITED_PDF), "conflict")
        self.assertEqual(len(pushes), 1)
        self.assertEqual(self.contents("figures/existing.pdf"), OTHER_PDF)

    def test_successful_push_with_lost_response_is_verified_without_another_commit(self):
        self.connect()
        original_git = self.bridge._git
        for failure, data in [(GitFailure(b"connection interrupted after push"), EDITED_PDF),
                              (BridgeError("Git timed out", "timeout", 504), OTHER_PDF)]:
            with self.subTest(failure=type(failure).__name__):
                before = self.git("--git-dir", str(self.remote), "rev-list", "--count", "master")
                pushes = []

                def lost_response(*args, **kwargs):
                    result = original_git(*args, **kwargs)
                    if args[0] == "push":
                        pushes.append(args)
                        raise failure
                    return result

                with patch.object(self.bridge, "_git", side_effect=lost_response):
                    result = self.bridge.upload("figures/existing.pdf", self.oid(), data)
                self.assertEqual(result["result"], "uploaded")
                self.assertEqual(len(pushes), 1)
                self.assertEqual(self.contents("figures/existing.pdf"), data)
                after = self.git("--git-dir", str(self.remote), "rev-list", "--count", "master")
                self.assertEqual(int(after), int(before) + 1)

    def test_cancelled_push_requires_refresh_to_determine_whether_it_reached_remote(self):
        self.connect()
        original_git = self.bridge._git
        for accepted in (False, True):
            with self.subTest(accepted=accepted):
                before = self.head()
                commands = []
                path = "figures/cancel-after.pdf" if accepted else "figures/cancel-before.pdf"

                def cancelled_push(*args, **kwargs):
                    commands.append(args[0])
                    if args[0] == "push":
                        if accepted:
                            original_git(*args, **kwargs)
                        raise BridgeError("Operation cancelled", "cancelled", 409)
                    return original_git(*args, **kwargs)

                with patch.object(self.bridge, "_git", side_effect=cancelled_push):
                    error = self.assert_rejected(lambda: self.bridge.upload(path, "", EDITED_PDF), "cancelled")
                self.assertIn("Refresh", str(error))
                self.assertIn("whether", str(error))
                self.assertEqual(commands.count("fetch"), 1)
                if accepted:
                    self.assertEqual(self.contents(path), EDITED_PDF)
                else:
                    self.assertEqual(self.head(), before)
                self.bridge.refresh()

    def test_commit_author_uses_configured_identity_and_has_a_fallback(self):
        self.connect()
        self.bridge.upload("fallback.pdf", "", PDF)
        author = self.git("--git-dir", str(self.remote), "log", "-1", "--format=%an <%ae>").decode().strip()
        self.assertEqual(author, "kuroko 2 <kuroko2@localhost>")
        config = self.root / "gitconfig"
        config.write_text("[user]\n    name = Configured Author\n    email = configured@example.invalid\n", encoding="utf-8")
        with patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": str(config)}):
            self.bridge.upload("configured.pdf", "", PDF)
        author = self.git("--git-dir", str(self.remote), "log", "-1", "--format=%an <%ae>").decode().strip()
        self.assertEqual(author, "Configured Author <configured@example.invalid>")

    def test_cancel_kills_a_running_git_operation_and_releases_the_lock(self):
        started = threading.Event()
        errors = []
        original_popen = subprocess.Popen

        def observe_process(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            started.set()
            return process

        def wait_in_git():
            try:
                with self.bridge._operation("cancellable-test"):
                    # Git starts a child process too, exercising process-group cleanup.
                    self.bridge._git("-c", "alias.fixture-wait=!sleep 20", "fixture-wait")
            except Exception as error:
                errors.append(error)

        with patch("kuroko2_server.subprocess.Popen", side_effect=observe_process):
            worker = threading.Thread(target=wait_in_git, daemon=True)
            worker.start()
            try:
                self.assertTrue(started.wait(timeout=3))
                self.assertFalse(self.bridge.cancel("another-operation")["cancelled"])
                self.assert_rejected(lambda: self.bridge.refresh(), "busy")
                self.assertIsNone(self.bridge.snapshot()["url"])
                self.assertTrue(self.bridge.cancel("cancellable-test")["cancelled"])
                worker.join(timeout=3)
                self.assertFalse(worker.is_alive())
            finally:
                self.bridge.cancel("cancellable-test")
                worker.join(timeout=3)
        self.assertEqual(len(errors), 1)
        self.assertEqual(getattr(errors[0], "code", None), "cancelled")
        self.assertEqual(self.connect()["url"], str(self.remote))


class UrlTests(unittest.TestCase):
    def test_only_overleaf_https_project_urls_are_accepted(self):
        project = "0123456789abcdef01234567"
        for url in [f"https://git.overleaf.com/{project}", f"https://git@git.overleaf.com/{project}"]:
            with self.subTest(url=url):
                self.assertTrue(OverleafBridge.validate_url(url))
        for url in [f"http://git.overleaf.com/{project}", f"ssh://git@git.overleaf.com/{project}",
                    f"https://other.example/{project}", f"https://git.overleaf.com.evil.example/{project}",
                    f"https://git:secret@git.overleaf.com/{project}",
                    f"https://user@git.overleaf.com/{project}",
                    f"https://git.overleaf.com/{project}?token=secret", f"https://git.overleaf.com/{project}#fragment",
                    f"https://git.overleaf.com:444/{project}", "https://git.overleaf.com/not-a-project",
                    "file:///tmp/project.git", "/tmp/project.git", "--upload-pack=anything"]:
            with self.subTest(url=url):
                with self.assertRaises(Exception):
                    OverleafBridge.validate_url(url)


class HttpTests(GitFixture):
    def setUp(self):
        super().setUp()
        self.index = self.root / "index.html"
        self.index.write_text("<!doctype html><title>Fixture</title>", encoding="utf-8")
        self.server = make_server(str(self.index), port=0, bridge=self.bridge)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.host = "127.0.0.1:" + str(self.server.server_port)
        self.origin = "http://" + self.host
        self.session = self.bridge.snapshot()["session"]

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def post(self, action, payload=None, headers=None):
        base = {"Content-Type": "application/json", "Origin": self.origin, "X-Kuroko-Session": self.session}
        base.update(headers or {})
        return self.request("POST", "/api/overleaf/" + action, json.dumps(payload or {}), base)

    def test_only_index_and_bootstrap_are_public(self):
        for path in ["/", "/index.html"]:
            status, _, body = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertEqual(body, self.index.read_bytes())
        status, headers, body = self.request("GET", "/api/overleaf")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["session"], self.session)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        for path in ["/paper.tex", "/../index.html", "/remote.git/config", "/api/unknown"]:
            with self.subTest(path=path):
                self.assertIn(self.request("GET", path)[0], (403, 404))
                self.assertEqual(self.request("GET", path, headers={"X-Kuroko-Session": self.session})[0], 404)

    def test_host_origin_and_session_validation_prevents_cross_site_changes(self):
        self.assertEqual(self.request("GET", "/api/overleaf", headers={"Host": "evil.example"})[0], 403)
        for headers in [{"Origin": "https://evil.example"}, {"Origin": "null"},
                        {"X-Kuroko-Session": "wrong"}, {"Host": "evil.example"}]:
            with self.subTest(headers=headers):
                self.assertEqual(self.post("connect", {"url": str(self.remote)}, headers)[0], 403)
        status, _, _ = self.request("POST", "/api/overleaf/connect", b"{}",
                                    {"Origin": self.origin, "Content-Type": "application/json"})
        self.assertEqual(status, 403)
        self.assertIsNone(self.bridge.snapshot()["url"])

    def test_json_validation_and_pdf_requests(self):
        status, _, _ = self.post("connect", {"url": str(self.remote)})
        self.assertEqual(status, 200)
        path = "/api/overleaf/pdf?" + urlencode({"path": "figures/existing.pdf", "oid": self.oid()})
        self.assertEqual(self.request("GET", path)[0], 403)
        status, headers, body = self.request("GET", path, headers={"X-Kuroko-Session": self.session})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "application/pdf")
        self.assertEqual(body, PDF)
        headers = {"Origin": self.origin, "X-Kuroko-Session": self.session, "Content-Type": "application/json"}
        for body in [b"{", b"[]", b"null"]:
            with self.subTest(body=body):
                status, _, result = self.request("POST", "/api/overleaf/refresh", body, headers)
                self.assertEqual(status, 400)
                self.assertIn("error", json.loads(result))
        status, _, _ = self.post("refresh", {}, {"Content-Type": "text/plain"})
        self.assertIn(status, (400, 415))

    def test_http_upload_and_conflict_use_expected_blob(self):
        self.connect()
        path = "/api/overleaf/upload?" + urlencode({"path": "figures/existing.pdf", "expected": self.oid(), "project": str(self.remote)})
        headers = {"Origin": self.origin, "X-Kuroko-Session": self.session, "Content-Type": "application/pdf"}
        status, _, body = self.request("POST", path, EDITED_PDF, headers)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["result"], "uploaded")
        status, _, body = self.request("POST", path, OTHER_PDF, headers)
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(body)["code"], "conflict")
        self.assertEqual(self.contents("figures/existing.pdf"), EDITED_PDF)

    def test_http_upload_requires_the_displayed_project(self):
        self.connect()
        before = self.head()
        query = {"path": "figures/new.pdf", "expected": ""}
        headers = {"Origin": self.origin, "X-Kuroko-Session": self.session, "Content-Type": "application/pdf"}
        path = "/api/overleaf/upload?" + urlencode(query)
        self.assertEqual(self.request("POST", path, EDITED_PDF, headers)[0], 400)
        path = "/api/overleaf/upload?" + urlencode({**query, "project": str(self.root / "previous-project.git")})
        status, _, body = self.request("POST", path, EDITED_PDF, headers)
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(body)["code"], "project_changed")
        self.assertEqual(self.head(), before)


if __name__ == "__main__":
    unittest.main()
