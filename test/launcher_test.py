"""Check the distributed launcher without a separate Python server file."""

import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.bundle_launcher import bundle


class LauncherTests(unittest.TestCase):
    def test_embedded_server_starts_with_only_launcher_and_html(self):
        with tempfile.TemporaryDirectory(prefix="kuroko launcher ") as directory:
            folder = Path(directory)
            launcher = folder / "kuroko2.sh"
            bundle(ROOT / "kuroko2.sh", ROOT / "kuroko2_server.py", launcher)
            html = b"<!doctype html><title>Packaged app</title>"
            (folder / "index.html").write_bytes(html)
            self.assertEqual({item.name for item in folder.iterdir()}, {"kuroko2.sh", "index.html"})
            with socket.socket() as reserved:
                reserved.bind(("127.0.0.1", 0))
                port = reserved.getsockname()[1]
            environment = dict(os.environ, KUROKO_PORT=str(port), PYTHONDONTWRITEBYTECODE="1")
            process = subprocess.Popen([str(launcher)], cwd=folder, env=environment,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                for attempt in range(100):
                    try:
                        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                        connection.request("GET", "/api/overleaf")
                        response = connection.getresponse()
                        snapshot = json.loads(response.read())
                        connection.close()
                        self.assertEqual(response.status, 200)
                        self.assertEqual(snapshot["api"], "kuroko-overleaf-v1")
                        self.assertIsNone(snapshot["url"])
                        break
                    except ConnectionRefusedError:
                        if process.poll() is not None:
                            self.fail("Bundled launcher exited before serving the app")
                        time.sleep(0.05)
                else:
                    self.fail("Bundled launcher did not start")
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request("GET", "/")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), html)
                connection.close()
            finally:
                process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                    self.fail("Bundled launcher did not shut down")
            self.assertEqual(process.returncode, 0)


if __name__ == "__main__":
    unittest.main()
