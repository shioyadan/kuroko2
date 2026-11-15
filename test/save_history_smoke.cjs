const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright-core");
const root = path.resolve(__dirname, "..");
const original = '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96"><rect x="10" y="10" width="172" height="76" rx="8" fill="#397ca0"/><path d="M20 70L172 25" stroke="black" stroke-width="3"/></svg>';
const edited = original.replace('width="172"', 'width="168"').replace('L172 25', 'L170 27');
const unrelated = '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96"><circle cx="170" cy="70" r="10" fill="black"/></svg>';
async function paste(page, text) {
    await page.evaluate(text => {
        const clipboardData = new DataTransfer(); clipboardData.setData("image/svg+xml", text);
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, text);
    await page.getByAltText("Generated PDF preview", { exact: true }).waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("main").getAttribute("aria-busy") === "false");
}
async function fileBytes(page, name = "diagram.pdf") {
    return page.evaluate(async name => {
        const root = await navigator.storage.getDirectory();
        const file = await (await root.getFileHandle(name)).getFile();
        return Array.from(new Uint8Array(await file.arrayBuffer()));
    }, name);
}
(async () => {
    const server = http.createServer((_request, response) => {
        response.setHeader("Content-Type", "text/html");
        fs.createReadStream(path.join(root, "dist-web/index.html")).pipe(response);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server", "--host-resolver-rules=MAP kuroko.test 127.0.0.1"] });
    try {
        const context = await browser.newContext();
        // Real, serializable handles in the origin's test filesystem exercise IndexedDB
        // persistence and writes without touching a user's files or showing OS dialogs.
        await context.addInitScript(() => {
            window.pickerCalls = 0;
            window.nativeRequestPermission = FileSystemHandle.prototype.requestPermission;
            const close = FileSystemWritableFileStream.prototype.close;
            FileSystemWritableFileStream.prototype.close = function () {
                if (window.failClose) return Promise.reject(new DOMException("Write was interrupted", "AbortError"));
                return close.call(this);
            };
            Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: async options => {
                window.pickerCalls++;
                const directory = await navigator.storage.getDirectory();
                return directory.getFileHandle(window.nextSaveName || options.suggestedName, { create: true });
            } });
        });
        const page = await context.newPage();
        page.on("console", entry => { if (entry.type() === "error") console.log("Browser:", entry.text()); });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        const url = `http://127.0.0.1:${server.address().port}/`;
        await page.goto(url);
        await paste(page, original);
        assert.equal(await page.getByRole("dialog").count(), 0);
        await page.getByLabel("PDF file name", { exact: true }).fill("diagram.pdf");
        await page.evaluate(() => { window.failClose = true; });
        await page.getByRole("button", { name: /^Save PDF/ }).click();
        await page.getByRole("alert").filter({ hasText: "finalizing the file: AbortError" }).waitFor();
        await page.getByText("PDF was not saved.", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Save history", exact: true }).click();
        await page.getByText("No saved figures yet. Save a PDF to start building your history.").waitFor();
        await page.getByRole("button", { name: "Close Save history", exact: true }).click();
        await page.getByRole("button", { name: /^Log/ }).click();
        await page.getByRole("region", { name: "Application log" }).getByText(/PDF save failed while finalizing the file: AbortError/).waitFor();
        await page.getByRole("button", { name: "Close application log", exact: true }).click();
        await page.evaluate(() => { window.failClose = false; });
        await page.getByRole("button", { name: /^Save PDF/ }).click();
        await page.getByText("Saved: diagram.pdf", { exact: true }).waitFor();
        const first = await fileBytes(page);

        // Startup reload must restore both the visual descriptor and the real destination.
        await page.reload();
        await paste(page, edited);
        const dialog = page.getByRole("dialog", { name: "Save matching figure", exact: true });
        await dialog.waitFor();
        assert.equal(await dialog.getByText("diagram.pdf", { exact: true }).count(), 1);
        assert.deepEqual(await fileBytes(page), first, "nothing is overwritten before confirmation");
        assert.equal(await page.evaluate(() => window.pickerCalls), 0);
        fs.mkdirSync(path.join(root, "work"), { recursive: true });
        await page.screenshot({ path: path.join(root, "work/save-suggestion.png") });
        await dialog.getByRole("button", { name: "Not now", exact: true }).click();
        assert.deepEqual(await fileBytes(page), first, "dismissal must not write");
        await page.getByRole("button", { name: /^Save PDF/ }).click();
        await dialog.getByRole("button", { name: "Overwrite PDF", exact: true }).click();
        await page.getByText("Saved: diagram.pdf", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.pickerCalls), 0, "confirmation reuses the previous destination");
        const second = await fileBytes(page);
        assert.notDeepEqual(second, first);

        await paste(page, original);
        await dialog.waitFor();
        await page.evaluate(() => { FileSystemHandle.prototype.requestPermission = async () => "denied"; });
        await dialog.getByRole("button", { name: "Overwrite PDF", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Write access was not granted" }).waitFor();
        assert.deepEqual(await fileBytes(page), second, "denied permission must not write or learn a new figure");
        await page.evaluate(() => { FileSystemHandle.prototype.requestPermission = window.nativeRequestPermission; window.nextSaveName = "alternative.pdf"; });
        await page.getByRole("button", { name: /^Save PDF/ }).click();
        await dialog.getByRole("button", { name: "Save as…", exact: true }).click();
        await page.getByText("Saved: alternative.pdf", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.pickerCalls), 1);
        assert.deepEqual(await fileBytes(page), second, "Save as must preserve the previous file");

        await page.getByRole("button", { name: "Save history", exact: true }).click();
        const history = page.getByRole("dialog", { name: "Save history", exact: true });
        await history.getByLabel("Suggest file names after conversion").uncheck();
        await page.reload();
        await paste(page, edited);
        assert.equal(await dialog.count(), 0, "disabled suggestions must stay disabled after reload");
        await page.getByRole("button", { name: "Save history", exact: true }).click();
        assert.equal(await history.getByLabel("Suggest file names after conversion").isChecked(), false);
        await history.getByLabel("Suggest file names after conversion").check();
        await history.getByRole("button", { name: "Close Save history", exact: true }).click();
        await paste(page, original);
        await dialog.waitFor();
        assert.equal(await dialog.getByRole("radio").count(), 2);
        await dialog.getByRole("radio", { name: /^diagram.pdf/ }).check();
        await dialog.getByText("This will overwrite the previously selected file “diagram.pdf”.", { exact: true }).waitFor();
        await dialog.getByRole("button", { name: "Not now", exact: true }).click();

        await paste(page, unrelated);
        assert.equal(await dialog.count(), 0, "unrelated figures should not be suggested");
        await page.getByRole("button", { name: "Save history", exact: true }).click();
        assert.equal(await history.locator("li").count(), 2);
        await history.getByRole("button", { name: "Forget alternative.pdf", exact: true }).click();
        await history.getByRole("button", { name: "Forget alternative.pdf", exact: true }).waitFor({ state: "detached" });
        assert.equal(await history.locator("li").count(), 1);
        await history.getByRole("button", { name: "Clear history", exact: true }).click();
        await history.getByText("No saved figures yet. Save a PDF to start building your history.").waitFor();
        await page.reload();
        await paste(page, original);
        assert.equal(await dialog.count(), 0, "cleared history must stay cleared after reload");
        assert.deepEqual(await fileBytes(page), second, "clearing history must not delete saved PDFs");
        assert.deepEqual(errors, []);

        // Storage denial must not prevent conversion, downloading or session-only suggestions.
        const ephemeral = await browser.newContext({ acceptDownloads: true });
        await ephemeral.addInitScript(() => {
            Object.defineProperty(window, "indexedDB", { get: () => { throw new Error("Storage unavailable"); } });
            Object.defineProperty(window, "showSaveFilePicker", { value: async () => { throw new DOMException("Native save unavailable", "NotAllowedError"); } });
        });
        const fallback = await ephemeral.newPage();
        await fallback.goto(url);
        await paste(fallback, original);
        await fallback.getByLabel("PDF file name", { exact: true }).fill("download.pdf");
        await fallback.getByRole("button", { name: /^Save PDF/ }).click();
        await fallback.getByRole("alert").filter({ hasText: "Native save unavailable" }).waitFor();
        const download = fallback.waitForEvent("download");
        await fallback.getByRole("button", { name: "Download PDF instead", exact: true }).click();
        const recovered = await download;
        assert.equal(recovered.suggestedFilename(), "download.pdf");
        assert.equal(await recovered.failure(), null);
        assert.match(fs.readFileSync(await recovered.path()).toString("latin1"), /^%PDF-/);
        await fallback.getByText("Download started: download.pdf", { exact: true }).waitFor();
        await paste(fallback, edited);
        await fallback.getByRole("dialog", { name: "Save matching figure", exact: true }).waitFor();
        assert.equal(await fallback.getByRole("button", { name: "Overwrite PDF", exact: true }).count(), 0);

        // Ordinary HTTP hosts lack randomUUID, but must still save and remember PDFs.
        const httpContext = await browser.newContext({ acceptDownloads: true });
        const httpPage = await httpContext.newPage();
        const httpErrors = [];
        httpPage.on("pageerror", error => httpErrors.push(error.message));
        await httpPage.goto(`http://kuroko.test:${server.address().port}/`);
        assert.equal(await httpPage.evaluate(() => isSecureContext), false);
        assert.equal(await httpPage.evaluate(() => typeof crypto.randomUUID), "undefined");
        await paste(httpPage, original);
        await httpPage.getByLabel("PDF file name", { exact: true }).fill("http.pdf");
        const httpDownload = httpPage.waitForEvent("download");
        await httpPage.getByRole("button", { name: /^Save PDF/ }).click();
        const downloaded = await httpDownload;
        assert.equal(await downloaded.failure(), null);
        assert.match(fs.readFileSync(await downloaded.path()).toString("latin1"), /^%PDF-/);
        await httpPage.getByText("Download started: http.pdf", { exact: true }).waitFor();
        await httpPage.getByRole("button", { name: "Save history", exact: true }).click();
        await httpPage.getByRole("dialog", { name: "Save history", exact: true }).getByText("http.pdf", { exact: true }).waitFor();
        await httpPage.reload();
        await paste(httpPage, edited);
        await httpPage.getByRole("dialog", { name: "Save matching figure", exact: true }).getByText("http.pdf", { exact: true }).waitFor();
        assert.deepEqual(httpErrors, []);
        console.log("Save history smoke passed: real file writes/readback, aborted-write reporting, explicit download recovery, HTTP downloads/history, edited-figure matching, persistence, confirmation, overwrite, permission denial, Save as, preferences, multiple candidates, unrelated input, forget/clear and unavailable storage.");
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
