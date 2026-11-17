#!/usr/bin/env bash
# 配布 HTML と、ローカル Git を使う Overleaf 接続を localhost に公開する。
set -eu
# Replaced with the commit timestamp, hash and date when packaging a distribution.
build=0-source-unknown
script_path="$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve())' "$0")"
script_dir="$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd)"

if [ "$#" -eq 1 ] && [ "$1" = "--update" ]; then
    python3 - "$script_path" "$build" "${KUROKO_UPDATE_URL:-https://shioyadan.github.io/kuroko2/kuroko-latest.zip}" 3<&0 <<'KUROKO2_UPDATE_PYTHON'
from pathlib import Path, PurePosixPath
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
from urllib.request import urlopen
from zipfile import ZipFile

launcher = Path(sys.argv[1])
installed_build = sys.argv[2]
directory = launcher.parent
build_pattern = r"([0-9]{1,12})-([0-9a-f]{7,64})-([0-9]{4}-[0-9]{2}-[0-9]{2})"
files = ("kuroko2.sh", "index.html", "README.md", "README.ja.md", "LICENSE.md", "THIRD_PARTY_LICENSES.md", "docs/development.md")
limit = 128 * 1024 * 1024

def interrupted(signum, frame):
    raise KeyboardInterrupt

def update():
    current = re.fullmatch(build_pattern, installed_build)
    if not current or (directory / ".git").exists() or not (directory / "index.html").is_file():
        raise ValueError("Only an extracted distribution with index.html next to kuroko2.sh can be updated. Source checkouts must be rebuilt.")
    with tempfile.TemporaryDirectory(prefix=".kuroko2-update-", dir=directory) as temporary:
        stage = Path(temporary)
        archive = stage / "update.zip"
        print("Downloading the latest kuroko 2 development build...", flush=True)
        with urlopen(sys.argv[3], timeout=30) as response, archive.open("wb") as output:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise ValueError("The update archive is too large.")
                output.write(chunk)
        payload = stage / "payload"
        payload.mkdir()
        with ZipFile(archive) as package:
            seen = set()
            for member in package.infolist():
                path = PurePosixPath(member.filename)
                if (member.filename in seen or path.is_absolute() or ".." in path.parts or
                        "\\" in member.filename or not path.parts or path.parts[0] != "kuroko-latest" or
                        stat.S_ISLNK(member.external_attr >> 16)):
                    raise ValueError("The downloaded update contains an unsafe archive path.")
                seen.add(member.filename)
            selected = [name for name in files if "kuroko-latest/" + name in seen]
            if not all(name in selected for name in files[:2]):
                raise ValueError("The downloaded update is missing kuroko2.sh or index.html.")
            if sum(package.getinfo("kuroko-latest/" + name).file_size for name in selected) > limit:
                raise ValueError("The unpacked update is too large.")
            for name in selected:
                target = payload / name
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(package.read("kuroko-latest/" + name))
        script = (payload / "kuroko2.sh").read_text(encoding="utf-8")
        versions = re.findall(r"^build=(.*)$", script, re.MULTILINE)
        available = re.fullmatch(build_pattern, versions[0]) if len(versions) == 1 else None
        if (not available or not script.startswith("#!/usr/bin/env bash\n") or
                "\nKUROKO2_EMBEDDED_PYTHON\n" not in script or
                subprocess.run(["bash", "-n", str(payload / "kuroko2.sh")], capture_output=True).returncode or
                not (payload / "index.html").read_bytes()[:64].lstrip().lower().startswith(b"<!doctype html>")):
            raise ValueError("The downloaded kuroko 2 update is invalid.")
        for name in selected:
            target = directory / name
            if target.is_symlink() or (target.exists() and not target.is_file()) or target.parent.is_symlink():
                raise ValueError("An installed application file is a directory or symbolic link: " + name)
        changed = [name for name in selected if not (directory / name).exists() or
                   (directory / name).read_bytes() != (payload / name).read_bytes()]
        print(f"Installed build: {current[2]} ({current[3]})")
        print(f"Available build: {available[2]} ({available[3]})")
        if not changed:
            print("kuroko 2 is already up to date.")
            return
        if int(available[1]) > int(current[1]):
            print("A newer kuroko 2 build is available:")
        elif int(available[1]) < int(current[1]):
            print("The available kuroko 2 build is older than this copy:")
        else:
            print("The available kuroko 2 build differs from this copy:")
        for name in changed:
            print("  " + name)
        sys.stdout.flush()
        print("Install this update? [y/N] ", end="", file=sys.stderr, flush=True)
        with os.fdopen(3) as answer:
            accepted = answer.readline().strip().lower() in ("y", "yes")
        if not accepted:
            print("Update cancelled.")
            return
        backup = stage / "backup"
        backup.mkdir()
        for name in changed:
            previous = directory / name
            if previous.exists():
                saved = backup / name
                saved.parent.mkdir(exist_ok=True)
                shutil.copy2(previous, saved)
            (payload / name).chmod(0o755 if name == "kuroko2.sh" else 0o644)
        replaced = []
        made_docs = False
        try:
            for name in changed:
                target = directory / name
                if not target.parent.exists():
                    target.parent.mkdir()
                    made_docs = True
                os.replace(payload / name, target)
                replaced.append(name)
        except BaseException:
            for name in reversed(replaced):
                previous = backup / name
                if previous.exists():
                    os.replace(previous, directory / name)
                else:
                    (directory / name).unlink()
            if made_docs:
                (directory / "docs").rmdir()
            raise
        print("kuroko 2 was updated to the latest development build. Restart kuroko2.sh and reload the page.")

signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGHUP, interrupted)
try:
    update()
except KeyboardInterrupt:
    print("Update interrupted.", file=sys.stderr)
    sys.exit(1)
except Exception as error:
    print("Could not update kuroko 2: " + str(error), file=sys.stderr)
    sys.exit(1)
KUROKO2_UPDATE_PYTHON
    exit 0
fi
if [ "$#" -gt 0 ]; then
    echo "Usage: $0 [--update]" >&2
    case "$1" in --help|-h) exit 0;; *) exit 2;; esac
fi
if [ -f "$script_dir/index.html" ]; then
    index_file="$script_dir/index.html"
elif [ -f "$script_dir/dist-web/index.html" ]; then
    index_file="$script_dir/dist-web/index.html"
else
    echo "index.html was not found. Run make production first." >&2
    exit 1
fi
port="${KUROKO_PORT:-30080}"
case "$port" in ''|*[!0-9]*) echo "KUROKO_PORT must be an integer from 1 to 65535." >&2; exit 1;; esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo "KUROKO_PORT must be an integer from 1 to 65535." >&2
    exit 1
fi
# Python binds an available port before printing the actual URL.
exec python3 "$script_dir/kuroko2_server.py" --port "$port" --index "$index_file"
