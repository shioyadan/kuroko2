#!/usr/bin/env bash
# 配布 HTML と、ローカル Git を使う Overleaf 接続を localhost に公開する。
set -eu
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
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
