const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const notices = fs.readFileSync("THIRD_PARTY_LICENSES.md", "utf8");
const runtime = ["react", "react-dom", "scheduler", "react-icons", "@hyzyla/pdfium", "style-loader", "css-loader", "worker-loader", "webpack"];
for (const name of runtime) {
    const pkg = JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, "utf8"));
    assert.ok(notices.includes(`## ${name} ${pkg.version}\n`), `Missing notice: ${name} ${pkg.version}`);
}
const cargo = fs.readFileSync("vendor/krilla-wasm/Cargo.lock", "utf8");
for (const entry of cargo.split("[[package]]").filter(entry => entry.includes('source = "registry+'))) {
    const name = entry.match(/name = "([^"]+)"/)[1];
    const version = entry.match(/version = "([^"]+)"/)[1];
    assert.ok(notices.includes(`## ${name} ${version}\n`), `Missing crate notice: ${name} ${version}`);
}
const pdfiumNotice = fs.readFileSync("vendor/pdfium/THIRD_PARTY_NOTICES.md", "utf8");
assert.ok(notices.includes(pdfiumNotice), "PDFium notices must be embedded verbatim");
const binary = fs.readFileSync(require.resolve("@hyzyla/pdfium/pdfium.wasm"));
const digest = crypto.createHash("sha256").update(binary).digest("hex");
assert.ok(fs.readFileSync("vendor/pdfium/README.md", "utf8").includes(digest), "Review PDFium notices when the WASM binary changes");
console.log("Third-party notices verified.");
