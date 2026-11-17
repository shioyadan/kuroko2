"""Debug output must aid diagnosis without dumping credentials or PDF payloads."""

from contextlib import redirect_stderr
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kuroko2_server import BridgeError, GitFailure, OverleafBridge, debug_result, redact_debug


class GitDebugTests(unittest.TestCase):
    def test_inherited_askpass_works_with_terminal_prompts_disabled(self):
        with tempfile.TemporaryDirectory(prefix="kuroko-askpass-test-") as directory:
            helper = Path(directory) / "askpass.sh"
            helper.write_text("#!/bin/sh\nprintf '%s\\n' 'fixture-only-askpass-password'\n")
            helper.chmod(0o700)
            environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
            environment.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                                "GIT_ASKPASS": str(helper), "KUROKO_DEBUG": "1"})
            with patch.dict(os.environ, environment, clear=True):
                bridge = OverleafBridge()
                with redirect_stderr(io.StringIO()) as log:
                    # Git credential fill only consults the isolated local fixture;
                    # it makes no network request or credential-store write.
                    result = bridge._git("credential", "fill", repo=directory,
                                         data=b"protocol=https\nhost=example.invalid\nusername=git\n\n")
                self.assertIn(b"password=fixture-only-askpass-password", result)
                self.assertIn("GIT_ASKPASS=set (inherited)", log.getvalue())
                self.assertIn("credential fill", log.getvalue())
                self.assertIn("result: exit=0", log.getvalue())
                self.assertNotIn("fixture-only-askpass-password", log.getvalue())
                self.assertNotIn("host=example.invalid", log.getvalue())

    def test_credentials_and_terminal_control_sequences_are_redacted(self):
        output = redact_debug(
            "fatal: Authentication failed for 'https://git:uri-password@git.overleaf.com/project?token=query-secret'\n"
            "Authorization: Basic header-secret\n"
            "Set-Cookie: session=cookie-secret\n"
            "password=field-secret\n"
            "helper returned olp_token-fixture\n"
            "fatal: could not read Password for 'https://git@git.overleaf.com': terminal prompts disabled\n"
            "\x1b[31merror\x1b[0m"
        )
        for secret in ["uri-password", "query-secret", "header-secret", "cookie-secret", "field-secret", "olp_token-fixture", "\x1b"]:
            self.assertNotIn(secret, output)
        self.assertIn("Authentication failed", output)
        self.assertIn("could not read Password", output)
        self.assertIn("https://git@git.overleaf.com", output)
        self.assertIn("[redacted]", output)

    def test_debug_is_opt_in_and_pdf_output_is_omitted(self):
        pdf = b"%PDF-1.7\nprivate figure contents\n"
        with patch.dict(os.environ, {"KUROKO_DEBUG": "0"}), redirect_stderr(io.StringIO()) as log:
            debug_result(pdf, b"error", 1, 0)
        self.assertEqual(log.getvalue(), "")
        with patch.dict(os.environ, {"KUROKO_DEBUG": "1"}), redirect_stderr(io.StringIO()) as log:
            debug_result(pdf, b"fatal: test error", 1, 0)
        self.assertIn("result: exit=1", log.getvalue())
        self.assertIn("fatal: test error", log.getvalue())
        self.assertIn("contents omitted", log.getvalue())
        self.assertNotIn("private figure", log.getvalue())
        self.assertNotIn("%PDF", log.getvalue())

    def test_failed_and_timed_out_git_commands_log_results(self):
        for timed_out in [False, True]:
            with self.subTest(timed_out=timed_out):
                process = Mock(returncode=-9 if timed_out else 128)
                error = b"fatal: Authentication failed for 'https://git:fixture-secret@git.overleaf.com/project'"
                process.communicate.side_effect = ([subprocess.TimeoutExpired("git", 120), (b"", error)]
                                                   if timed_out else [(b"", error)])
                bridge = OverleafBridge()
                with patch.dict(os.environ, {"KUROKO_DEBUG": "1"}), \
                        patch("kuroko2_server.subprocess.Popen", return_value=process), \
                        patch.object(bridge, "_stop_process"), redirect_stderr(io.StringIO()) as log:
                    with self.assertRaises(BridgeError if timed_out else GitFailure):
                        bridge._git("fetch", "origin")
                self.assertIn("fetch origin", log.getvalue())
                self.assertIn("result: exit=", log.getvalue())
                self.assertIn("Authentication failed", log.getvalue())
                self.assertNotIn("fixture-secret", log.getvalue())
                if timed_out:
                    self.assertIn("timed out", log.getvalue())


if __name__ == "__main__":
    unittest.main()
