"""Check the distributed launcher without a separate Python server file."""

import errno
import http.client
import json
import os
from pathlib import Path
import queue
import re
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch, sentinel

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.bundle_launcher import bundle
from kuroko2_server import make_available_server


class LauncherTests(unittest.TestCase):
    def test_embedded_server_starts_with_only_launcher_and_html(self):
        self.check_launcher()

    def test_embedded_server_skips_an_occupied_port_and_prints_actual_url(self):
        self.check_launcher(occupied=True)

    def check_launcher(self, occupied=False):
        with tempfile.TemporaryDirectory(prefix="kuroko launcher ") as directory:
            folder = Path(directory)
            launcher = folder / "kuroko2.sh"
            bundle(ROOT / "kuroko2.sh", ROOT / "kuroko2_server.py", launcher)
            html = b"<!doctype html><title>Packaged app</title>"
            (folder / "index.html").write_bytes(html)
            self.assertEqual({item.name for item in folder.iterdir()}, {"kuroko2.sh", "index.html"})
            reserved = socket.socket()
            self.addCleanup(reserved.close)
            reserved.bind(("127.0.0.1", 0))
            requested_port = reserved.getsockname()[1]
            if occupied:
                reserved.listen()
            else:
                reserved.close()
            environment = dict(os.environ, KUROKO_PORT=str(requested_port), PYTHONDONTWRITEBYTECODE="1")
            process = subprocess.Popen([str(launcher)], cwd=folder, env=environment,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            startup = queue.Queue()

            def read_url():
                for line in process.stdout:
                    match = re.fullmatch(rb"kuroko 2 URL: http://127\.0\.0\.1:(\d+)/\n", line)
                    if match:
                        startup.put(int(match[1]))
                        return
                startup.put(None)

            reader = threading.Thread(target=read_url, daemon=True)
            reader.start()
            try:
                port = startup.get(timeout=10)
                self.assertIsNotNone(port, "Bundled launcher exited without a URL")
                if occupied:
                    self.assertGreater(port, requested_port)
                    self.assertLessEqual(port, 65535)
                    self.assertEqual(reserved.getsockname()[1], requested_port)
                else:
                    self.assertEqual(port, requested_port)
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request("GET", "/api/overleaf")
                response = connection.getresponse()
                snapshot = json.loads(response.read())
                connection.close()
                self.assertEqual(response.status, 200)
                self.assertEqual(snapshot["api"], "kuroko-overleaf-v1")
                self.assertIsNone(snapshot["url"])
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request("GET", "/")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), html)
                connection.close()
            finally:
                process.terminate()
                reader.join(timeout=5)
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                    self.fail("Bundled launcher did not shut down")
            self.assertEqual(process.returncode, 0)

    def test_only_occupied_ports_are_skipped(self):
        busy = OSError(errno.EADDRINUSE, "Address already in use")
        with patch("kuroko2_server.make_server", side_effect=[busy, busy, sentinel.server]) as create:
            self.assertIs(make_available_server("index.html", 30080), sentinel.server)
            self.assertEqual([call.args[1] for call in create.call_args_list], [30080, 30081, 30082])
        denied = OSError(errno.EACCES, "Permission denied")
        with patch("kuroko2_server.make_server", side_effect=denied) as create:
            with self.assertRaises(OSError) as caught:
                make_available_server("index.html", 30080)
            self.assertIs(caught.exception, denied)
            create.assert_called_once()
        with patch("kuroko2_server.make_server", side_effect=busy) as create:
            with self.assertRaisesRegex(OSError, "No available port between 65535 and 65535"):
                make_available_server("index.html", 65535)
            create.assert_called_once_with("index.html", 65535)


if __name__ == "__main__":
    unittest.main()
