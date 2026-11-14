#!/usr/bin/env python3
"""Regenerate bundled notices from installed npm packages and checksum-verified Cargo archives.
Run explicitly when dependencies change; normal builds never access the network.
"""
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "work" / "crate-licenses"
CACHE.mkdir(parents=True, exist_ok=True)
NPM = ["react", "react-dom", "scheduler", "react-icons", "@hyzyla/pdfium", "style-loader", "css-loader", "worker-loader", "webpack"]

def cargo_notice(package):
    name, version = package["name"], package["version"]
    archive = CACHE / f"{name}-{version}.crate"
    if not archive.exists():
        url = f"https://static.crates.io/crates/{name}/{name}-{version}.crate"
        with urllib.request.urlopen(url, timeout=60) as response:
            archive.write_bytes(response.read())
    data = archive.read_bytes()
    if hashlib.sha256(data).hexdigest() != package["checksum"]:
        raise ValueError(f"Checksum mismatch: {archive}")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        manifest = tomllib.loads(tar.extractfile(f"{name}-{version}/Cargo.toml").read().decode())
        license_id = manifest["package"].get("license", "see license file")
        notices = []
        for member in tar.getmembers():
            parts = member.name.split("/")
            basename = parts[-1].lower()
            if member.isfile() and (basename.startswith(("license", "licence", "copying", "notice"))) and len(parts) <= 3:
                notices.append(f"### {parts[-1]}\n\n```text\n" + tar.extractfile(member).read().decode("utf-8", errors="replace").strip() + "\n```\n")
        if not any(len(member.name.split("/")) == 2 and member.name.split("/")[-1].lower().startswith(("license", "licence", "copying")) for member in tar.getmembers()):
            # Workspace crates sometimes omit the repository-level dual-license files.
            repository = manifest["package"].get("repository", "").removesuffix(".git")
            vcs = json.loads(tar.extractfile(f"{name}-{version}/.cargo_vcs_info.json").read())
            commit = vcs["git"]["sha1"]
            if not repository.startswith("https://github.com/"):
                raise ValueError(f"Inspect missing license: {name} ({repository})")
            base = repository.replace("https://github.com/", "https://raw.githubusercontent.com/") + f"/{commit}/"
            for filename in ["LICENSE-MIT", "LICENSE-APACHE", "LICENSE_MIT", "LICENSE_APACHE", "LICENSE", "LICENSE.md", "NOTICE.md"]:
                cached = CACHE / f"{name}-{version}-{filename}.txt"
                if not cached.exists():
                    try:
                        with urllib.request.urlopen(base + filename, timeout=60) as response:
                            cached.write_bytes(response.read())
                    except urllib.error.HTTPError as error:
                        if error.code == 404: continue
                        raise
                notices.append(f"### {filename} ({commit})\n\n```text\n{cached.read_text().strip()}\n```\n")
            if not notices:
                raise ValueError(f"No license text in {name}-{version} ({license_id}); inspect source before bundling.")
    return f"## {name} {version}\n\nRust / {license_id}\nSource: https://crates.io/crates/{name}/{version}\n\n" + "\n".join(notices)

output = ["# Third-Party Licenses\n\nThese notices accompany the single HTML distribution. Rust entries conservatively include all registry packages in the locked WASM build, including build-time dependencies. Font files selected by users are not distributed with Kuroko.\n"]
for name in NPM:
    directory = ROOT / "node_modules" / name
    package = json.loads((directory / "package.json").read_text())
    notice = next(p for p in [directory / "LICENSE", directory / "LICENSE.md", directory / "LICENSE.txt"] if p.exists())
    output.append(f"## {name} {package['version']}\n\n```text\n{notice.read_text().strip()}\n```\n")
# Only react-icons/bs is imported. Preserve the underlying icon set's notice as well.
output.append("""## Bootstrap Icons

MIT License

Copyright (c) 2019-2024 The Bootstrap Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
""")
packages = tomllib.loads((ROOT / "vendor/krilla-wasm/Cargo.lock").read_text())["package"]
output.append((ROOT / "vendor/pdfium/THIRD_PARTY_NOTICES.md").read_text())
packages = sorted((p for p in packages if "source" in p), key=lambda p: p["name"])
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    output.extend(pool.map(cargo_notice, packages))
(ROOT / "THIRD_PARTY_LICENSES.md").write_text("\n".join(output))
print(f"Wrote notices for {len(NPM)} npm packages, Bootstrap Icons and {len(packages)} Rust packages.")
