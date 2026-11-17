#!/usr/bin/env python3
"""Embed the standard-library server in the distributed shell launcher."""

from pathlib import Path
import re
import subprocess
import sys


def bundle(launcher, server, output):
    source = launcher.read_text(encoding="utf-8")
    try:
        build = subprocess.check_output(
            ["git", "-C", str(launcher.parent), "show", "-s", "--abbrev=12", "--format=%ct-%h-%cs", "HEAD"],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        build = "0-0000000-1970-01-01"
    if not re.fullmatch(r"[0-9]{1,12}-[0-9a-f]{7,64}-[0-9]{4}-[0-9]{2}-[0-9]{2}", build):
        raise ValueError("Invalid Git build identifier")
    if source.count("\nbuild=0-source-unknown\n") != 1:
        raise ValueError("Launcher build placeholder is invalid")
    source = source.replace("\nbuild=0-source-unknown\n", "\nbuild=" + build + "\n")
    command = 'exec python3 "$script_dir/kuroko2_server.py" --port "$port" --index "$index_file"'
    marker = "KUROKO2_EMBEDDED_PYTHON"
    python = server.read_text(encoding="utf-8").rstrip()
    if source.count(command) != 1 or marker in python.splitlines():
        raise ValueError("Launcher template or embedded Python delimiter is invalid")
    embedded = f'exec python3 - --port "$port" --index "$index_file" <<\'{marker}\'\n{python}\n{marker}'
    output.write_text(source.replace(command, embedded), encoding="utf-8")
    output.chmod(launcher.stat().st_mode & 0o777)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: bundle_launcher.py LAUNCHER SERVER OUTPUT")
    bundle(*(Path(argument) for argument in sys.argv[1:]))
