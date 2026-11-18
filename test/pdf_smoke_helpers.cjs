const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const work = path.join(root, "work");

async function paste(page, text, type = "image/svg+xml") {
    await page.evaluate(({ text, type }) => {
        const data = new DataTransfer(); data.setData(type, text);
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, { text, type });
}
async function ready(page) {
    await page.waitForFunction(() => document.querySelector("main")?.getAttribute("aria-busy") === "false", undefined, { timeout: 60000 });
    if (await page.getByRole("alert").count()) throw new Error(await page.getByRole("alert").innerText());
    await page.getByAltText("Generated PDF preview", { exact: true }).waitFor({ timeout: 60000 });
    // The history-specific suite verifies confirmation; keep unrelated smoke flows explicit.
    const suggestion = page.getByRole("dialog", { name: "Save matching figure", exact: true });
    if (await suggestion.count()) await suggestion.getByRole("button", { name: "Not now", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), true);
}
async function save(page, fileName) {
    await page.getByLabel("PDF file name", { exact: true }).fill(fileName);
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Save PDF/ }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), fileName);
    assert.equal(await download.failure(), null);
    await download.saveAs(path.join(work, fileName));
    // Downloads can finish before history is recorded; new pastes are locked until then.
    await page.getByText(`Download started: ${fileName}`, { exact: true }).waitFor();
    const bytes = fs.readFileSync(path.join(work, fileName));
    assert.match(bytes.toString("latin1"), /^%PDF-/);
    return bytes;
}

module.exports = { root, work, paste, ready, save };
