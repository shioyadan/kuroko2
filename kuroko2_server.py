#!/usr/bin/env python3
"""Serve the single HTML app and bridge its Overleaf requests to local Git."""

import argparse
from contextlib import contextmanager, nullcontext
import errno
import fcntl
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit


MAX_PDF_BYTES = 50 * 1024 * 1024
MAX_JSON_BYTES = 16 * 1024
GIT_TIMEOUT_SECONDS = 120
API_VERSION = "kuroko-overleaf-v1"


def redact_debug(text):
    """Mask credential-bearing URLs/fields before writing bounded terminal logs."""
    text = re.sub(r"(?i)(https?://[^\s'\"?#]+)[?#][^\s'\"]*", r"\1?[redacted]", text)
    text = re.sub(r"(?i)(https?://)([^\s/?#]*@)",
                  lambda match: match[1] + ("git@" if match[2] == "git@" else "[redacted]@"), text)
    text = re.sub(r"(?im)^.*(?:authorization|cookie|password|passwd|token|secret|extraheader)\s*[:=].*$",
                  "[redacted credential field]", text)
    text = re.sub(r"\b(?:olp_|gh[pousr]_|glpat-)[A-Za-z0-9_-]+", "[redacted]", text)
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", lambda match: f"\\x{ord(match[0]):02x}", text)
    return text[:6000] + ("\n[truncated]" if len(text) > 6000 else "")


def debug_log(text):
    if os.environ.get("KUROKO_DEBUG") == "1":
        for line in redact_debug(text).splitlines():
            print("[kuroko git] " + line, file=sys.stderr, flush=True)


def debug_result(stdout, stderr, returncode, started, outcome=""):
    if os.environ.get("KUROKO_DEBUG") != "1":
        return
    debug_log(f"result: exit={returncode}, elapsed={time.monotonic() - started:.2f}s {outcome}".rstrip())
    # Only object IDs are displayed verbatim. Config values, tree listings and
    # PDF bytes can contain private data, and are represented by their size.
    if re.fullmatch(rb"(?:[0-9a-f]{40}|[0-9a-f]{64})\n?", stdout):
        debug_log("stdout: " + stdout.decode("ascii").strip())
    else:
        debug_log(f"stdout: {len(stdout)} bytes" + (" (contents omitted)" if stdout else ""))
    if stderr:
        debug_log("stderr:\n" + stderr.decode("utf-8", "replace"))


class BridgeError(Exception):
    def __init__(self, message, code="invalid_request", status=400):
        super().__init__(message)
        self.code = code
        self.status = status


class GitFailure(Exception):
    def __init__(self, stderr):
        self.stderr = stderr.decode("utf-8", "replace").lower()


class OverleafBridge:
    """One connected project, backed by reusable private bare clones in temp storage.

    Tests can override validate_url to use a local bare repository. Production
    never accepts a local path, command, credential, or arbitrary remote host.
    """

    def __init__(self, cache_root=None):
        self.session = secrets.token_urlsafe(32)
        self._operation_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._active = None
        self._cancelled = threading.Event()
        self._process = None
        self._cache_root = Path(cache_root) if cache_root is not None else (
            Path(tempfile.gettempdir()) / f"kuroko2-overleaf-cache-{os.getuid()}"
        )
        self._repo = None
        self._branch = None
        self._url = None
        self._files = []
        self._entries = {}
        self._head = None

    @staticmethod
    def validate_url(url):
        if not isinstance(url, str):
            raise BridgeError("Enter the project's Overleaf Git URL.")
        # Match the entire URL rather than allowing URL-parser normalization.
        match = re.fullmatch(
            r"https://(?:git@)?git\.overleaf\.com/([0-9a-fA-F]{24})/?", url.strip()
        )
        if not match:
            raise BridgeError(
                "Use https://git@git.overleaf.com/<project ID>, without a password or token.",
                "invalid_url",
            )
        return "https://git@git.overleaf.com/" + match.group(1).lower()

    @staticmethod
    def validate_path(path):
        if not isinstance(path, str) or len(path) > 1024:
            raise BridgeError("Choose a PDF path within the project.", "invalid_path")
        parts = path.split("/")
        if (
            not path.lower().endswith(".pdf")
            or any(part in ("", ".", "..") or part.lower() == ".git" for part in parts)
            or any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF for char in path)
            or any(char in path for char in ("\\", ":", "\x7f"))
        ):
            raise BridgeError("Use a relative PDF path, such as figures/figure.pdf.", "invalid_path")
        return path

    @staticmethod
    def _validate_operation(operation):
        if not isinstance(operation, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", operation):
            raise BridgeError("Invalid operation identifier.")
        return operation

    def snapshot(self):
        with self._state_lock:
            folders = []
            for path, entry in self._entries.items():
                if entry["mode"] != "040000":
                    continue
                try:
                    self.validate_path(path + "/figure.pdf")
                except BridgeError:
                    continue
                folders.append(path)
            return {
                "api": API_VERSION,
                "session": self.session,
                "url": self._url,
                "files": [dict(file) for file in self._files],
                "folders": sorted(folders),
            }

    @contextmanager
    def _operation(self, operation, repository=False):
        operation = self._validate_operation(operation or secrets.token_hex(16))
        if not self._operation_lock.acquire(blocking=False):
            raise BridgeError("Another Overleaf operation is running.", "busy", 409)
        with self._state_lock:
            self._active = operation
            self._cancelled.clear()
        try:
            with self._lock_cache(self._repo.parent) if repository and self._repo is not None else nullcontext():
                yield
        except GitFailure as error:
            self._raise_git_error(error)
        finally:
            with self._state_lock:
                self._active = None
                self._process = None
            self._operation_lock.release()

    @staticmethod
    def _private_directory(directory):
        try:
            directory.mkdir(mode=0o700, exist_ok=True)
            info = directory.lstat()
        except OSError:
            raise BridgeError("Cannot open the local Overleaf cache. Check temporary storage and its permissions.", "cache_error", 500) from None
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise BridgeError("The local Overleaf cache must be a private directory owned by this user.", "cache_error", 500)

    def _cache_directory(self, url):
        self._private_directory(self._cache_root)
        directory = self._cache_root / hashlib.sha256(url.encode("utf-8")).hexdigest()
        self._private_directory(directory)
        return directory

    @contextmanager
    def _lock_cache(self, directory):
        self._private_directory(directory)
        try:
            descriptor = os.open(directory / "lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        except OSError:
            raise BridgeError("Cannot open the local Overleaf cache lock. Check temporary storage and its permissions.", "cache_error", 500) from None
        with os.fdopen(descriptor, "a+b") as lock:
            info = os.fstat(lock.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise BridgeError("The local Overleaf cache lock is not a private file.", "cache_error", 500)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise BridgeError("This project is busy in another kuroko 2 window. Try again shortly.", "busy", 409) from None
            try:
                self._check_cancelled()
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    @staticmethod
    def _raise_git_error(error):
        if any(text in error.stderr for text in (
            "authentication", "could not read username", "could not read password",
            "access denied", "not authorized", "repository not found", "403", "401",
        )):
            raise BridgeError(
                "Git could not access this project. Check the URL, Overleaf Git access, "
                "and the credentials saved by Git in the environment running kuroko2.sh.",
                "authentication", 502,
            ) from None
        raise BridgeError(
            "Git could not complete the request. Check the connection and project access, then refresh.",
            "git_error", 502,
        ) from None

    def _check_cancelled(self):
        if self._cancelled.is_set():
            raise BridgeError("Overleaf operation cancelled.", "cancelled", 409)

    @staticmethod
    def _stop_process(process):
        if process is None:
            return
        try:
            # A helper can keep pipes open after Git itself exits.
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def cancel(self, operation):
        self._validate_operation(operation)
        with self._state_lock:
            matches = self._active == operation
            if matches:
                self._cancelled.set()
                self._stop_process(self._process)
        return {"cancelled": matches}

    def _git(self, *args, repo=None, data=None, env_extra=None):
        self._check_cancelled()
        env = os.environ.copy()
        for name in (
            "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR",
        ):
            env.pop(name, None)
        env.update({
            "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "Never",
            "LC_ALL": "C",
        })
        if env_extra:
            env.update(env_extra)
        command = [
            "git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never",
            "-c", "http.followRedirects=false",
            # Keep Git's automatic maintenance inside the per-project lock.
            "-c", "gc.autoDetach=false", "-c", "maintenance.autoDetach=false",
        ]
        if repo is not None or self._repo is not None:
            command += ["-C", str(repo if repo is not None else self._repo)]
        command += list(args)
        started = time.monotonic()
        debug_log("cwd: " + str(repo if repo is not None else self._repo or Path.cwd()))
        debug_log("$ " + shlex.join(command))
        debug_log("auth: GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=Never, "
                  + ", ".join(name + ("=set (inherited)" if env.get(name) else "=not set")
                              for name in ("GIT_ASKPASS", "SSH_ASKPASS")))
        if data is not None:
            debug_log(f"stdin: {len(data)} bytes (contents omitted)")
        try:
            with self._state_lock:
                self._check_cancelled()
                process = subprocess.Popen(
                    command, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                    start_new_session=True,
                )
                self._process = process
            try:
                stdout, stderr = process.communicate(data, timeout=GIT_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                self._stop_process(process)
                stdout, stderr = process.communicate()
                debug_result(stdout, stderr, process.returncode, started, "timed out")
                raise BridgeError("Git timed out. Check the connection and try again.", "timeout", 504) from None
            finally:
                with self._state_lock:
                    self._process = None
        except FileNotFoundError:
            debug_log("result: Git executable was not found")
            raise BridgeError("Git is not installed in the environment running kuroko2.sh.", "git_missing", 503) from None
        debug_result(stdout, stderr, process.returncode, started, "cancelled" if self._cancelled.is_set() else "")
        self._check_cancelled()
        if process.returncode:
            raise GitFailure(stderr)
        return stdout

    def _require_connection(self):
        if self._repo is None:
            raise BridgeError("Connect to an Overleaf project first.", "not_connected", 409)

    def _inspect(self, repo, branch):
        head = self._git("rev-parse", "--verify", branch + "^{commit}", repo=repo).decode().strip()
        listing = self._git("ls-tree", "-r", "-t", "-l", "-z", head, repo=repo)
        entries = {}
        files = []
        for record in listing.split(b"\0"):
            if not record:
                continue
            metadata, raw_path = record.split(b"\t", 1)
            mode, _, oid, size = metadata.decode("ascii").split()
            path = raw_path.decode("utf-8", "surrogateescape")
            entries[path] = {"mode": mode, "oid": oid}
            if mode not in ("100644", "100755") or not path.lower().endswith(".pdf"):
                continue
            try:
                self.validate_path(path)
            except BridgeError:
                continue
            files.append({"path": path, "oid": oid, "size": int(size)})
        return head, entries, sorted(files, key=lambda file: file["path"])

    def _publish(self, inspected):
        with self._state_lock:
            self._head, self._entries, self._files = inspected

    def _fetch(self):
        self._git("fetch", "--no-tags", "origin", "+" + self._branch + ":" + self._branch)
        self._publish(self._inspect(self._repo, self._branch))

    def _cached_branch(self, repo, url):
        """Validate local metadata before contacting a cached repository's remote."""
        if not repo.exists() and not repo.is_symlink():
            return None
        info = repo.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise BridgeError("The cached Overleaf repository is not a directory owned by this user.", "cache_error", 500)
        try:
            if self._git("rev-parse", "--is-bare-repository", repo=repo).strip() != b"true":
                return None
            if self._git("config", "--local", "--get-all", "remote.origin.url", repo=repo).decode().strip() != url:
                return None
            branch = self._git("symbolic-ref", "HEAD", repo=repo).decode().strip()
            if not branch.startswith("refs/heads/"):
                return None
            self._inspect(repo, branch)
            return branch
        except (GitFailure, UnicodeError):
            return None

    def _clear_connection(self):
        with self._state_lock:
            self._repo = self._branch = self._url = self._head = None
            self._files, self._entries = [], {}

    def connect(self, url, operation=None):
        url = self.validate_url(url)
        with self._operation(operation):
            directory = self._cache_directory(url)
            repo = directory / "project.git"
            with self._lock_cache(directory):
                branch = self._cached_branch(repo, url)
                if branch:
                    debug_log("cache: reusing " + str(repo))
                    # Network failures leave a good cache intact, never trigger another clone.
                    self._git("fetch", "--no-tags", "origin", "+" + branch + ":" + branch, repo=repo)
                    inspected = self._inspect(repo, branch)
                else:
                    if repo.exists():
                        debug_log("cache: rebuilding invalid repository " + str(repo))
                        if self._repo == repo:
                            self._clear_connection()
                        shutil.rmtree(repo)
                    debug_log("cache: cloning into " + str(repo))
                    # Publish only a complete clone. Failure/cancellation removes the staging directory.
                    with tempfile.TemporaryDirectory(dir=directory, prefix="clone-") as temporary:
                        staged = Path(temporary) / "project.git"
                        self._git("clone", "--bare", "--", url, str(staged), repo=temporary)
                        branch = self._git("symbolic-ref", "HEAD", repo=staged).decode().strip()
                        if not branch.startswith("refs/heads/"):
                            raise BridgeError("The project has no default Git branch.", "git_error", 502)
                        inspected = self._inspect(staged, branch)
                        self._check_cancelled()
                        staged.rename(repo)
                self._check_cancelled()
                with self._state_lock:
                    self._repo, self._branch, self._url = repo, branch, url
                    self._head, self._entries, self._files = inspected
            return self.snapshot()

    def refresh(self, operation=None):
        with self._operation(operation, repository=True):
            self._require_connection()
            self._fetch()
            return self.snapshot()

    def disconnect(self, operation=None):
        with self._operation(operation):
            self._clear_connection()
            return self.snapshot()

    def read_pdf(self, path, oid, operation=None):
        self.validate_path(path)
        with self._operation(operation, repository=True):
            self._require_connection()
            file = next((file for file in self._files if file["path"] == path), None)
            if not file or file["oid"] != oid:
                raise BridgeError("This PDF has changed. Refresh the project and select it again.", "conflict", 409)
            if file["size"] > MAX_PDF_BYTES:
                raise BridgeError("This PDF exceeds the 50 MiB limit.", "too_large", 413)
            data = self._git("cat-file", "blob", oid)
            if not data.startswith(b"%PDF-"):
                raise BridgeError("The selected file is not a PDF.", "invalid_pdf")
            return data

    def _target_oid(self, path):
        parts = path.split("/")
        for count in range(1, len(parts)):
            parent = self._entries.get("/".join(parts[:count]))
            if parent and parent["mode"] != "040000":
                raise BridgeError("A file or symbolic link occupies a parent folder of this path.", "conflict", 409)
        target = self._entries.get(path)
        if target and target["mode"] not in ("100644", "100755"):
            raise BridgeError("This path is a folder or symbolic link. Choose another PDF path.", "conflict", 409)
        return target["oid"] if target else ""

    def _author(self):
        identity = {}
        for key, fallback in (("name", "kuroko 2"), ("email", "kuroko2@localhost")):
            try:
                value = self._git("config", "--get", "user." + key).decode("utf-8").strip()
            except GitFailure:
                value = fallback
            identity["GIT_AUTHOR_" + key.upper()] = value or fallback
            identity["GIT_COMMITTER_" + key.upper()] = value or fallback
        return identity

    def _commit_pdf(self, path, oid, head):
        with tempfile.TemporaryDirectory(dir=self._repo.parent, prefix="index-") as directory:
            env = {"GIT_INDEX_FILE": str(Path(directory) / "index"), **self._author()}
            self._git("read-tree", head, env_extra=env)
            mode = self._entries.get(path, {}).get("mode", "100644")
            self._git("update-index", "--add", "--cacheinfo", mode, oid, path, env_extra=env)
            tree = self._git("write-tree", env_extra=env).decode().strip()
            return self._git(
                "-c", "commit.gpgSign=false", "commit-tree", tree, "-p", head,
                "-m", "Update " + path, env_extra=env,
            ).decode().strip()

    def upload(self, path, expected, data, operation=None, expected_project=None):
        self.validate_path(path)
        if not isinstance(expected, str) or (expected and not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", expected)):
            raise BridgeError("Invalid previous PDF identifier.")
        if len(data) > MAX_PDF_BYTES:
            raise BridgeError("This PDF exceeds the 50 MiB limit.", "too_large", 413)
        if not data.startswith(b"%PDF-"):
            raise BridgeError("Only PDF files can be uploaded.", "invalid_pdf")
        with self._operation(operation, repository=True):
            self._require_connection()
            if expected_project is not None and expected_project != self._url:
                raise BridgeError(
                    "The connected project changed in another tab. Reconnect to the intended project before uploading.",
                    "project_changed", 409,
                )
            self._fetch()
            oid = self._git("hash-object", "-w", "--stdin", data=data).decode().strip()
            for attempt in range(2):
                target = self._target_oid(path)
                if target == oid:
                    return {**self.snapshot(), "result": "unchanged", "path": path}
                if target != expected:
                    raise BridgeError("This PDF changed on Overleaf. Refresh and confirm the replacement again.", "conflict", 409)
                head = self._head
                commit = self._commit_pdf(path, oid, head)
                try:
                    self._git("push", "origin", commit + ":" + self._branch)
                except (GitFailure, BridgeError) as push_error:
                    if isinstance(push_error, BridgeError):
                        if push_error.code == "cancelled":
                            raise BridgeError(
                                "Upload cancelled. Refresh the project to check whether the PDF reached Overleaf.",
                                "cancelled", 409,
                            ) from None
                        if push_error.code != "timeout":
                            raise
                    # A failed response may still follow a successful push. Fetch before
                    # deciding whether to retry, and never force or replace a newer PDF.
                    try:
                        self._fetch()
                    except (GitFailure, BridgeError) as verify_error:
                        if isinstance(verify_error, BridgeError) and verify_error.code == "cancelled":
                            raise BridgeError(
                                "Upload cancelled. Refresh the project to check whether the PDF reached Overleaf.",
                                "cancelled", 409,
                            ) from None
                        raise BridgeError(
                            "The upload could not be confirmed. Refresh the project before trying again.",
                            "git_error", 502,
                        ) from None
                    current = self._target_oid(path)
                    if current == oid:
                        return {**self.snapshot(), "result": "uploaded", "path": path}
                    if current != expected or (self._head != head and attempt):
                        raise BridgeError("The project changed during upload. Refresh and try again.", "conflict", 409)
                    if self._head == head:
                        raise push_error
                    continue
                self._git("update-ref", self._branch, commit)
                self._publish(self._inspect(self._repo, self._branch))
                return {**self.snapshot(), "result": "uploaded", "path": path}
            raise BridgeError("The project changed during upload. Refresh and try again.", "conflict", 409)

    def close(self):
        with self._state_lock:
            if self._active:
                self._cancelled.set()
                self._stop_process(self._process)
        with self._operation_lock:
            self._clear_connection()


def make_server(index_file, port=0, bridge=None):
    bridge = bridge or OverleafBridge()
    index_file = Path(index_file)

    class Handler(BaseHTTPRequestHandler):
        # Request logs can contain project paths; errors are returned to the app.
        def log_message(self, format, *args):
            pass

        def _send(self, status, data, content_type="application/json; charset=utf-8"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

        def _json(self, value, status=200):
            self._send(status, json.dumps(value).encode("utf-8"))

        def _validate_request(self, bootstrap=False):
            host = self.headers.get("Host", "")
            port = self.server.server_address[1]
            hosts = {"127.0.0.1:" + str(port), "localhost:" + str(port)}
            if port == 80:
                hosts.update(("127.0.0.1", "localhost"))
            if host not in hosts:
                raise BridgeError("Invalid local server host.", "forbidden", 403)
            origin = self.headers.get("Origin")
            if origin is not None and origin != "http://" + host:
                raise BridgeError("Only this local app can access the Git bridge.", "forbidden", 403)
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                raise BridgeError("Cross-site requests are not allowed.", "forbidden", 403)
            if not bootstrap and not hmac.compare_digest(
                self.headers.get("X-Kuroko-Session", "").encode("utf-8"), bridge.session.encode("ascii")
            ):
                raise BridgeError("The local server restarted. Reopen the Overleaf panel.", "session", 403)

        def _body(self, content_type, limit):
            if self.headers.get("Transfer-Encoding"):
                raise BridgeError("Transfer encoding is not supported.")
            if self.headers.get_content_type() != content_type:
                raise BridgeError("Unexpected request content type.", "content_type", 415)
            length = self.headers.get("Content-Length", "")
            if len(length) > 20 or not re.fullmatch(r"[0-9]+", length):
                raise BridgeError("A request content length is required.")
            length = int(length)
            if length > limit:
                raise BridgeError("The request exceeds the size limit.", "too_large", 413)
            data = self.rfile.read(length)
            if len(data) != length:
                raise BridgeError("The request body was incomplete.")
            return data

        def _json_body(self):
            try:
                data = json.loads(self._body("application/json", MAX_JSON_BYTES))
            except ValueError:
                raise BridgeError("Invalid JSON request.") from None
            if not isinstance(data, dict):
                raise BridgeError("Expected a JSON object.")
            return data

        def _dispatch(self):
            url = urlsplit(self.path)
            path = url.path
            bootstrap = self.command in ("GET", "HEAD") and path in ("/", "/index.html", "/api/overleaf")
            self._validate_request(bootstrap)
            operation = self.headers.get("X-Kuroko-Operation")
            if self.command in ("GET", "HEAD") and path in ("/", "/index.html"):
                self._send(200, index_file.read_bytes(), "text/html; charset=utf-8")
                return
            if self.command == "GET" and path == "/api/overleaf":
                self._json(bridge.snapshot())
                return
            query = parse_qs(url.query, keep_blank_values=True)

            def parameter(name):
                values = query.get(name)
                if values is None or len(values) != 1:
                    raise BridgeError("Missing or repeated query parameter: " + name)
                return values[0]

            if self.command == "GET" and path == "/api/overleaf/pdf":
                data = bridge.read_pdf(parameter("path"), parameter("oid"), operation)
                self._send(200, data, "application/pdf")
                return
            if self.command == "POST" and path == "/api/overleaf/upload":
                data = self._body("application/pdf", MAX_PDF_BYTES)
                self._json(bridge.upload(
                    parameter("path"), parameter("expected"), data, operation,
                    expected_project=parameter("project"),
                ))
                return
            if self.command == "POST" and path in (
                "/api/overleaf/connect", "/api/overleaf/refresh", "/api/overleaf/disconnect", "/api/overleaf/cancel",
            ):
                data = self._json_body()
                if path.endswith("/connect"):
                    value = bridge.connect(data.get("url"), operation)
                elif path.endswith("/refresh"):
                    value = bridge.refresh(operation)
                elif path.endswith("/disconnect"):
                    value = bridge.disconnect(operation)
                else:
                    value = bridge.cancel(data.get("operation"))
                self._json(value)
                return
            raise BridgeError("Not found.", "not_found", 404)

        def _handle(self):
            self.connection.settimeout(30)
            try:
                self._dispatch()
            except BridgeError as error:
                self._json({"error": str(error), "code": error.code}, error.status)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass
            except Exception:
                self._json({"error": "The local server could not complete the request.", "code": "server_error"}, 500)

        do_GET = do_POST = do_HEAD = _handle

        def do_OPTIONS(self):
            self._json({"error": "Cross-origin access is not supported.", "code": "forbidden"}, 403)

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def server_close(self):
            super().server_close()
            bridge.close()

    return Server(("127.0.0.1", port), Handler)


def make_available_server(index_file, port):
    for candidate in range(port, 65536):
        try:
            return make_server(index_file, candidate)
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise
    raise OSError(errno.EADDRINUSE, f"No available port between {port} and 65535.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", required=True, type=Path)
    parser.add_argument("--port", type=int, default=30080)
    args = parser.parse_args()
    if not args.index.is_file():
        parser.error("the HTML file does not exist")
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")

    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        server = make_available_server(args.index, args.port)
    except OSError as error:
        parser.exit(1, f"Could not start the local server: {error}\n")
    with server:
        if server.server_port != args.port:
            print(f"Port {args.port} is in use; using port {server.server_port}.", flush=True)
        print(f"kuroko 2 URL: http://127.0.0.1:{server.server_port}/", flush=True)
        print("Press Ctrl+C to stop the server.", flush=True)
        if os.environ.get("KUROKO_DEBUG") == "1":
            print("Git debugging is enabled. Commands and results appear in this terminal.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
