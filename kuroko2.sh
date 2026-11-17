#!/usr/bin/env bash
# Konata と同様、配布 HTML だけを localhost に公開する。
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
echo "kuroko 2 URL: http://127.0.0.1:$port/"
echo "Press Ctrl+C to stop the server."
python3 -c '
import http.server
import sys
import urllib.parse
class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, url):
        return sys.argv[2]
    def send_head(self):
        if urllib.parse.urlsplit(self.path).path not in ("/", "/index.html"):
            self.send_error(404)
            return None
        return super().send_head()
http.server.test(Handler, port=int(sys.argv[1]), bind="127.0.0.1")
' "$port" "$index_file"
