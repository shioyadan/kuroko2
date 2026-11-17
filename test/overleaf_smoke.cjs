const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const index = path.join(root, "dist-web/index.html");
const work = path.join(root, "work");
const origin = "http://127.0.0.1:30080";
const projectUrl = "https://git.overleaf.com/0123456789abcdef01234567";
const session = "browser-test-session";
const oldPath = "figures/old figure.pdf";
const newPath = "figures/current.pdf";
const shape = content => `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96">${content}</svg>`;
const oldSvg = shape('<rect x="10" y="10" width="172" height="76" fill="#397ca0"/>');
const currentSvg = shape('<circle cx="96" cy="48" r="38" fill="#c0473e"/>');
const oid = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

async function paste(page, svg) {
    await page.evaluate(text => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("image/svg+xml", text);
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, svg);
    await page.waitForFunction(() => document.querySelector("main").getAttribute("aria-busy") === "false", undefined, { timeout: 60000 });
    await page.getByAltText("Generated PDF preview", { exact: true }).waitFor();
}
async function saveCurrent(page, name) {
    await page.getByLabel("PDF file name", { exact: true }).fill(name);
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Save PDF/ }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), name);
    const bytes = fs.readFileSync(await download.path());
    assert.match(bytes.toString("latin1"), /^%PDF-/);
    await page.getByText(`Download started: ${name}`, { exact: true }).waitFor();
    return bytes;
}
async function openPanel(page) {
    await page.getByLabel("Application menu", { exact: true }).click();
    await page.getByRole("button", { name: "Overleaf…", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Overleaf", exact: true });
    await panel.waitFor();
    return panel;
}
async function settle(panel) {
    await panel.getByRole("button", { name: "Refresh", exact: true }).waitFor();
    await panel.page().waitForFunction(() => !document.querySelector('.overleaf-status button'));
}

(async () => {
    fs.mkdirSync(work, { recursive: true });
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
        const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 950 } });
        await context.addInitScript(() => {
            Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
            localStorage.setItem("kuroko.suggestNames", "false");
        });
        let connected = false;
        let conflictNext = false;
        let holdRefresh = false;
        let heldRefresh;
        let holdPdf = false;
        let heldPdf;
        let onPdfHeld;
        const stored = new Map();
        const requests = [];
        const uploads = [];
        const unexpected = [];
        const routeFailures = [];
        const snapshot = extra => ({ api: "kuroko-overleaf-v1", session, url: connected ? projectUrl : null,
            files: connected ? [...stored].map(([path, bytes]) => ({ path, oid: oid(bytes), size: bytes.length })) : [], ...extra });
        const reply = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
        await context.route(/^https?:/, async route => {
            try {
                const request = route.request();
                const url = new URL(request.url());
                if (url.origin === origin && url.pathname === "/") {
                    return await route.fulfill({ contentType: "text/html", path: index });
                }
                if (url.origin !== origin || !url.pathname.startsWith("/api/overleaf")) {
                    unexpected.push(request.url());
                    return await route.abort();
                }
                const action = url.pathname.slice("/api/overleaf".length);
                const headers = request.headers();
                requests.push({ action, method: request.method(), headers });
                if (action) {
                    assert.equal(headers["x-kuroko-session"], session, "all non-bootstrap API requests carry the session nonce");
                    assert.match(headers["x-kuroko-operation"], /^[\da-f-]{36}$/i, "operations carry cancellation IDs");
                }
                switch (action) {
                    case "": return await reply(route, snapshot());
                    case "/connect":
                        assert.equal(request.method(), "POST");
                        assert.deepEqual(request.postDataJSON(), { url: projectUrl });
                        connected = true;
                        return await reply(route, snapshot());
                    case "/disconnect":
                        connected = false;
                        return await reply(route, snapshot());
                    case "/refresh":
                        if (holdRefresh) {
                            heldRefresh = { route, operation: headers["x-kuroko-operation"] };
                            return;
                        }
                        return await reply(route, snapshot());
                    case "/cancel": {
                        assert.ok(heldRefresh, "cancel has a pending operation");
                        assert.equal(request.postDataJSON().operation, heldRefresh.operation);
                        const held = heldRefresh;
                        heldRefresh = undefined;
                        holdRefresh = false;
                        await reply(held.route, { error: "Operation cancelled.", code: "cancelled" }, 409);
                        return await reply(route, { cancelled: true });
                    }
                    case "/pdf": {
                        const filePath = url.searchParams.get("path");
                        const bytes = stored.get(filePath);
                        assert.ok(bytes, "requested PDF exists");
                        assert.equal(url.searchParams.get("oid"), oid(bytes));
                        if (holdPdf) {
                            heldPdf = { route, bytes };
                            onPdfHeld();
                            return;
                        }
                        return await route.fulfill({ contentType: "application/pdf", body: bytes });
                    }
                    case "/upload": {
                        assert.equal(request.method(), "POST");
                        assert.equal(headers["content-type"], "application/pdf");
                        const filePath = url.searchParams.get("path");
                        const expected = url.searchParams.get("expected");
                        assert.equal(url.searchParams.get("project"), projectUrl, "uploads are pinned to the project shown in this tab");
                        const bytes = request.postDataBuffer();
                        assert.match(bytes.toString("latin1"), /^%PDF-/);
                        assert.equal(expected, stored.has(filePath) ? oid(stored.get(filePath)) : "");
                        uploads.push({ path: filePath, expected, bytes });
                        if (conflictNext) {
                            conflictNext = false;
                            stored.set(filePath, Buffer.concat([stored.get(filePath), Buffer.from("\n% another editor\n")]));
                            return await reply(route, { code: "conflict", error: "The PDF changed in Overleaf. Review the updated file and confirm again." }, 409);
                        }
                        const unchanged = stored.has(filePath) && stored.get(filePath).equals(bytes);
                        stored.set(filePath, bytes);
                        return await reply(route, snapshot({ result: unchanged ? "unchanged" : "uploaded", path: filePath }));
                    }
                    default: throw new Error(`Unexpected API: ${action}`);
                }
            } catch (error) {
                routeFailures.push(error.stack || String(error));
                await reply(route, { error: String(error), code: "test-error" }, 500).catch(() => {});
            }
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(origin + "/");
        await paste(page, oldSvg);
        stored.set(oldPath, await saveCurrent(page, "old.pdf"));
        await paste(page, currentSvg);
        const current = await saveCurrent(page, "current.pdf");
        const currentPreview = await page.getByAltText("Generated PDF preview", { exact: true }).getAttribute("src");
        assert.equal(requests.length, 0, "conversion and saving never contact the Overleaf bridge before its menu is opened");

        let panel = await openPanel(page);
        const urlField = panel.getByLabel("Overleaf Git URL", { exact: true });
        await urlField.waitFor();
        await urlField.fill("https://git:secret@git.overleaf.com/0123456789abcdef01234567");
        await panel.getByRole("button", { name: "Connect", exact: true }).click();
        await panel.getByRole("alert").filter({ hasText: "Do not include a token" }).waitFor();
        assert.equal(requests.filter(request => request.action === "/connect").length, 0, "tokens in URLs are rejected before contacting the bridge");
        await urlField.fill(projectUrl);
        await panel.getByRole("button", { name: "Connect", exact: true }).click();
        await settle(panel);

        await panel.getByRole("button", { name: /^figures\/old figure.pdf/ }).click();
        const remote = panel.getByAltText(`First page of ${oldPath}`, { exact: true });
        await remote.waitFor({ timeout: 60000 });
        await settle(panel);
        const remoteImage = await remote.evaluate(async image => {
            await image.decode();
            return { width: image.naturalWidth, height: image.naturalHeight, src: image.src, draggable: image.draggable };
        });
        assert.equal(remoteImage.width / remoteImage.height, 2);
        assert.notEqual(remoteImage.src, currentPreview, "the remote PDF is rendered separately from the pasted figure");
        assert.equal(remoteImage.draggable, false);
        assert.equal(await remote.evaluate(image => !image.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }))), true);
        assert.equal(await panel.getByLabel("PDF path in the project", { exact: true }).inputValue(), oldPath);
        const downloading = page.waitForEvent("download");
        await panel.getByRole("button", { name: "Download PDF", exact: true }).click();
        const download = await downloading;
        assert.equal(download.suggestedFilename(), "old figure.pdf");
        assert.deepEqual(fs.readFileSync(await download.path()), stored.get(oldPath));
        await panel.locator(".overleaf-panel").evaluate(element => {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData("image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
            element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
        });
        assert.ok(await page.getByAltText("Generated PDF preview", { exact: true }).getAttribute("src") === currentPreview, "drops in Overleaf cannot replace the current figure");
        await panel.locator("header").evaluate(element => {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData("image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
            element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
        });
        assert.ok(await page.getByAltText("Generated PDF preview", { exact: true }).getAttribute("src") === currentPreview, "drops on the dialog header cannot replace the current figure");
        await page.screenshot({ path: path.join(work, "overleaf-preview.png") });

        await panel.getByLabel("PDF path in the project", { exact: true }).fill(newPath);
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await panel.getByRole("status").filter({ hasText: `Uploaded to Overleaf: ${newPath}` }).waitFor();
        await settle(panel);
        assert.equal(uploads.length, 1);
        assert.equal(uploads[0].expected, "");
        assert.deepEqual(uploads[0].bytes, current, "new uploads send the actual generated PDF bytes");

        await panel.getByLabel("PDF path in the project", { exact: true }).fill(oldPath);
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await panel.getByRole("button", { name: "Replace PDF", exact: true }).waitFor();
        assert.equal(uploads.length, 1, "an existing path cannot be replaced before the separate confirmation");
        assert.equal(await panel.getByLabel("PDF path in the project", { exact: true }).isDisabled(), true);
        await panel.getByRole("button", { name: "Cancel replacement", exact: true }).click();
        assert.equal(uploads.length, 1, "dismissing replacement never uploads");

        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        conflictNext = true;
        const oldOid = oid(stored.get(oldPath));
        await panel.getByRole("button", { name: "Replace PDF", exact: true }).click();
        await panel.getByRole("alert").filter({ hasText: "The PDF changed in Overleaf" }).waitFor();
        await settle(panel);
        assert.equal(uploads[1].expected, oldOid);
        assert.equal(uploads.length, 2, "a conflict does not automatically re-upload");
        const updatedOid = oid(stored.get(oldPath));
        assert.notEqual(updatedOid, oldOid);
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await panel.getByRole("button", { name: "Replace PDF", exact: true }).click();
        await panel.getByRole("status").filter({ hasText: `Uploaded to Overleaf: ${oldPath}` }).waitFor();
        await settle(panel);
        assert.equal(uploads[2].expected, updatedOid, "after reviewing a conflict, confirmation uses the refreshed snapshot");
        assert.deepEqual(stored.get(oldPath), current);

        holdRefresh = true;
        await panel.getByRole("button", { name: "Refresh", exact: true }).click();
        await panel.getByRole("button", { name: "Cancel", exact: true }).waitFor();
        await panel.getByRole("button", { name: "Close Overleaf", exact: true }).click();
        await page.getByRole("navigation", { name: "Main toolbar", exact: true }).getByRole("status").filter({ hasText: "Refreshing Overleaf" }).waitFor();
        await page.getByRole("button", { name: "Cancel Overleaf operation", exact: true }).click();
        await page.getByRole("button", { name: "Cancel Overleaf operation", exact: true }).waitFor({ state: "detached" });
        assert.equal(heldRefresh, undefined, "toolbar cancellation reaches the pending backend operation");
        assert.ok(await page.getByAltText("Generated PDF preview", { exact: true }).getAttribute("src") === currentPreview, "remote operations preserve the pasted figure");

        // Closing during the comparison load must discard the captured upload.
        // Otherwise a new paste can leave an old figure queued for replacement.
        panel = await openPanel(page);
        await settle(panel);
        stored.set(oldPath, Buffer.concat([stored.get(oldPath), Buffer.from("\n% newer revision\n")]));
        await panel.getByRole("button", { name: "Refresh", exact: true }).click();
        await settle(panel);
        await panel.getByLabel("PDF path in the project", { exact: true }).fill(oldPath);
        holdPdf = true;
        const comparisonRequested = new Promise(resolve => { onPdfHeld = resolve; });
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await comparisonRequested;
        assert.equal(await panel.getByRole("button", { name: "Replace PDF", exact: true }).isDisabled(), true);
        await panel.getByRole("button", { name: "Close Overleaf", exact: true }).click();
        await paste(page, oldSvg);
        const nextPreview = await page.getByAltText("Generated PDF preview", { exact: true }).getAttribute("src");
        assert.ok(nextPreview !== currentPreview);
        holdPdf = false;
        await heldPdf.route.fulfill({ contentType: "application/pdf", body: heldPdf.bytes });
        heldPdf = undefined;
        await page.getByRole("button", { name: "Cancel Overleaf operation", exact: true }).waitFor({ state: "detached" });
        panel = await openPanel(page);
        await settle(panel);
        assert.equal(await panel.getByRole("button", { name: "Replace PDF", exact: true }).count(), 0, "reopening cannot restore the old replacement confirmation");
        assert.equal(uploads.length, 3, "closing a confirmation never uploads the old figure");
        await panel.getByLabel("PDF path in the project", { exact: true }).fill(oldPath);
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        const nextConfirmationPreview = panel.getByAltText("Current figure to upload", { exact: true });
        await nextConfirmationPreview.waitFor();
        assert.ok(await nextConfirmationPreview.getAttribute("src") === nextPreview, "a fresh confirmation captures the newly pasted figure");
        await panel.getByRole("button", { name: "Cancel replacement", exact: true }).click();

        const beforeReload = requests.length;
        await page.reload();
        await page.getByRole("heading", { name: "kuroko 2", exact: true }).waitFor();
        assert.equal(requests.length, beforeReload, "reload does not contact the bridge until requested");
        const connectCount = requests.filter(request => request.action === "/connect").length;
        panel = await openPanel(page);
        await settle(panel);
        assert.equal(await panel.getByRole("button", { name: "Connect", exact: true }).count(), 0);
        assert.equal(requests.filter(request => request.action === "/connect").length, connectCount, "reload restores the server's connection without another clone");
        await panel.getByRole("button", { name: /^figures\/old figure.pdf/ }).click();
        await panel.getByAltText(`First page of ${oldPath}`, { exact: true }).waitFor();
        await settle(panel);
        await page.setViewportSize({ width: 390, height: 844 });
        const bounds = await panel.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, "Overleaf dialog fits a narrow viewport");
        assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "panel does not scroll horizontally");
        await page.screenshot({ path: path.join(work, "overleaf-mobile.png") });
        await panel.getByRole("button", { name: "Disconnect", exact: true }).click();
        await panel.getByLabel("Overleaf Git URL", { exact: true }).waitFor();
        assert.equal(connected, false);

        const offline = await browser.newContext();
        const offlineRequests = [];
        await offline.route(/^https?:/, route => { offlineRequests.push(route.request().url()); return route.abort(); });
        const offlinePage = await offline.newPage();
        offlinePage.on("pageerror", error => errors.push(error.message));
        await offlinePage.goto(pathToFileURL(index).href);
        const offlinePanel = await openPanel(offlinePage);
        await offlinePanel.getByText("Overleaf is available when kuroko 2 is opened with its local launcher.", { exact: true }).waitFor();
        assert.deepEqual(offlineRequests, [], "standalone HTML explains the launcher without probing local or external services");
        assert.deepEqual(unexpected, []);
        assert.deepEqual(routeFailures, []);
        assert.deepEqual(errors, []);
        console.log("Overleaf browser smoke passed: URL-only connection, independent preview/download, upload confirmation/conflict, cancellation, reload, offline help and mobile layout.");
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
