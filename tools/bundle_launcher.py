#!/usr/bin/env python3
"""Embed the standard-library server in the distributed shell launcher."""

from pathlib import Path
import sys


def bundle(launcher, server, output):
    source = launcher.read_text(encoding="utf-8")
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
