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
const projectName = "図版 / Paper figures";
const otherProjectUrl = "https://git.overleaf.com/abcdef0123456789abcdef01";
const session = "browser-test-session";
const oldPath = "figures/old figure.pdf";
const newPath = "figures/nested/current.pdf";
const shape = content => `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96">${content}</svg>`;
const oldSvg = shape('<rect x="10" y="10" width="172" height="76" fill="#397ca0"/>');
const currentSvg = shape('<circle cx="96" cy="48" r="38" fill="#c0473e"/>');
const editedSvg = shape('<circle cx="97" cy="48" r="38" fill="#c0473e"/>');
const oid = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const toolbar = page => page.getByRole("navigation", { name: "Main toolbar", exact: true });
const uploadButton = page => toolbar(page).getByRole("button", { name: "Upload to Overleaf", exact: true });
const connectionIndicator = page => toolbar(page).getByRole("status", { name: "Overleaf connection", exact: true, includeHidden: true });

async function connected(page, label, url = projectUrl) {
    const indicator = connectionIndicator(page);
    await indicator.waitFor();
    assert.equal((await indicator.innerText()).trim(), `Connected: ${label}`);
    assert.equal(await indicator.getAttribute("title"), url, "the full project URL is available on hover");
}

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
async function openPanel(page, menu = false) {
    if (menu) {
        await page.getByLabel("Application menu", { exact: true }).click();
        await page.getByRole("button", { name: "Overleaf…", exact: true }).click();
    } else await uploadButton(page).click();
    const panel = page.getByRole("dialog", { name: "Upload to Overleaf", exact: true });
    await panel.waitFor();
    return panel;
}
async function closePanel(panel) {
    await panel.getByRole("button", { name: "Close Upload to Overleaf", exact: true }).click();
    await panel.waitFor({ state: "detached" });
}
async function settle(panel) {
    await panel.getByRole("button", { name: "Refresh", exact: true }).waitFor();
    await panel.page().waitForFunction(() => !document.querySelector('.toolbar [aria-label="Cancel Overleaf operation"]'));
}
async function connect(panel, url = projectUrl) {
    await panel.getByLabel("Overleaf Git URL", { exact: true }).fill(url);
    await panel.getByRole("button", { name: "Connect", exact: true }).click();
    await settle(panel);
}
async function navigate(panel, folder) {
    await panel.getByRole("button", { name: "Project root", exact: true }).click();
    let current = "";
    for (const part of folder.split("/").filter(Boolean)) {
        current = current ? `${current}/${part}` : part;
        await panel.getByRole("button", { name: `Open folder ${current}`, exact: true }).click();
    }
}
async function setDestination(panel, destination) {
    await navigate(panel, "");
    await panel.getByLabel("PDF file name in project", { exact: true }).fill(destination);
    assert.equal((await panel.getByLabel("Destination path", { exact: true }).innerText()).trim(), destination);
}
async function previewLayout(panel) {
    return panel.locator(".overleaf-previews").evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return [...element.children].map(section => {
            const box = section.querySelector(".overleaf-preview").getBoundingClientRect();
            return { x: box.x - bounds.x, y: box.y - bounds.y, width: box.width, height: box.height };
        });
    });
}
async function saved(page, panel, destination) {
    await panel.waitFor({ state: "detached", timeout: 60000 });
    await page.locator(".status-bar").getByRole("status").filter({ hasText: destination }).waitFor();
}
async function history(page) {
    return page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open("kuroko.overleafHistory", 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            if (!db.objectStoreNames.contains("figures")) return [];
            return await new Promise((resolve, reject) => {
                const request = db.transaction("figures", "readonly").objectStore("figures").getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } finally { db.close(); }
    });
}

async function fixture(context) {
    const state = {
        connected: null, unavailable: false, conflictNext: false, failNext: false,
        holdRefresh: false, heldRefresh: null,
        projects: new Map([[projectUrl, new Map()], [otherProjectUrl, new Map()]]),
        requests: [], uploads: [], unexpected: [], failures: []
    };
    const files = () => state.projects.get(state.connected);
    const snapshot = extra => ({ api: "kuroko-overleaf-v1", session, url: state.connected,
        folders: state.connected ? ["empty", "figures", "figures/nested"] : [],
        files: state.connected ? [...files()].map(([path, bytes]) => ({ path, oid: oid(bytes), size: bytes.length })) : [], ...extra });
    const reply = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    await context.route(/^https?:/, async route => {
        try {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin === origin && url.pathname === "/") return await route.fulfill({ contentType: "text/html", path: index });
            if (url.origin !== origin || !url.pathname.startsWith("/api/overleaf")) {
                state.unexpected.push(request.url());
                return await route.abort();
            }
            const action = url.pathname.slice("/api/overleaf".length);
            const headers = request.headers();
            state.requests.push({ action, method: request.method(), headers });
            if (state.unavailable) return await reply(route, { error: "Not found", code: "not_found" }, 404);
            if (action) {
                assert.equal(headers["x-kuroko-session"], session);
                assert.match(headers["x-kuroko-operation"], /^[\da-f-]{36}$/i);
            }
            switch (action) {
                case "": return await reply(route, snapshot());
                case "/connect": {
                    assert.equal(request.method(), "POST");
                    const target = request.postDataJSON().url.replace("https://git@", "https://");
                    assert.ok(state.projects.has(target));
                    state.connected = target;
                    return await reply(route, snapshot());
                }
                case "/disconnect":
                    state.connected = null;
                    return await reply(route, snapshot());
                case "/refresh":
                    if (state.holdRefresh) { state.heldRefresh = { route, operation: headers["x-kuroko-operation"] }; return; }
                    return await reply(route, snapshot());
                case "/cancel": {
                    assert.ok(state.heldRefresh, "cancel has a pending operation");
                    assert.equal(request.postDataJSON().operation, state.heldRefresh.operation);
                    const held = state.heldRefresh;
                    state.heldRefresh = null; state.holdRefresh = false;
                    await reply(held.route, { error: "Operation cancelled.", code: "cancelled" }, 409);
                    return await reply(route, { cancelled: true });
                }
                case "/pdf": {
                    const bytes = files().get(url.searchParams.get("path"));
                    assert.ok(bytes, "requested PDF exists");
                    assert.equal(url.searchParams.get("oid"), oid(bytes));
                    return await route.fulfill({ contentType: "application/pdf", body: bytes });
                }
                case "/upload": {
                    assert.equal(request.method(), "POST");
                    assert.equal(headers["content-type"], "application/pdf");
                    const destination = url.searchParams.get("path");
                    const expected = url.searchParams.get("expected");
                    const project = url.searchParams.get("project");
                    const bytes = request.postDataBuffer();
                    assert.match(bytes.toString("latin1"), /^%PDF-/);
                    state.uploads.push({ path: destination, expected, project, bytes });
                    if (project !== state.connected) return await reply(route, { code: "project_changed", error: "The connected project changed in another tab." }, 409);
                    assert.equal(expected, files().has(destination) ? oid(files().get(destination)) : "");
                    if (state.failNext) {
                        state.failNext = false;
                        return await reply(route, { code: "git_error", error: "The upload could not be confirmed. Refresh before retrying." }, 502);
                    }
                    if (state.conflictNext) {
                        state.conflictNext = false;
                        files().set(destination, Buffer.concat([files().get(destination), Buffer.from("\n% another editor\n")]));
                        return await reply(route, { code: "conflict", error: "The PDF changed in Overleaf. Review the updated file and confirm again." }, 409);
                    }
                    const unchanged = files().has(destination) && files().get(destination).equals(bytes);
                    files().set(destination, bytes);
                    return await reply(route, snapshot({ result: unchanged ? "unchanged" : "uploaded", path: destination }));
                }
                default: throw new Error(`Unexpected API: ${action}`);
            }
        } catch (error) {
            state.failures.push(error.stack || String(error));
            await reply(route, { error: String(error), code: "test-error" }, 500).catch(() => {});
        }
    });
    return state;
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
        const api = await fixture(context);
        const stored = api.projects.get(projectUrl);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(origin + "/");
        await uploadButton(page).waitFor();
        assert.equal(await uploadButton(page).isDisabled(), true, "upload requires a generated PDF");
        assert.equal(await connectionIndicator(page).count(), 0, "bridge availability alone is not a project connection");
        assert.ok(api.requests.length > 0 && api.requests.every(request => request.action === ""), "startup only checks the local bridge and never connects to Overleaf");

        await paste(page, oldSvg);
        stored.set(oldPath, await saveCurrent(page, "old.pdf"));
        await paste(page, currentSvg);
        const current = await saveCurrent(page, "current.pdf");
        const currentPreview = await page.getByAltText("Generated PDF preview", { exact: true }).getAttribute("src");
        assert.equal(await uploadButton(page).isEnabled(), true);
        assert.ok(api.requests.every(request => request.action === ""), "conversion and local saving never start a remote Git operation");

        let panel = await openPanel(page);
        const urlField = panel.getByLabel("Overleaf Git URL", { exact: true });
        await urlField.fill("https://git:secret@git.overleaf.com/0123456789abcdef01234567");
        await panel.getByRole("button", { name: "Connect", exact: true }).click();
        await panel.getByRole("alert").filter({ hasText: "Do not include a token" }).waitFor();
        assert.equal(api.requests.filter(request => request.action === "/connect").length, 0);
        assert.ok(!(await page.evaluate(() => localStorage.getItem("kuroko.overleafProjects") || "")).includes("secret"));
        await connect(panel);
        await connected(page, "01234567…");
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("kuroko.overleafProjects"))), [{ url: projectUrl, name: "" }]);
        await panel.getByRole("button", { name: "Change project", exact: true }).click();
        await connectionIndicator(page).waitFor({ state: "detached" });
        const beforeName = api.requests.length;
        await panel.getByRole("button", { name: `Name project ${projectUrl}`, exact: true }).click();
        const projectNameField = panel.getByLabel(`Project name for ${projectUrl}`, { exact: true });
        await projectNameField.fill(`  ${projectName}  `);
        await projectNameField.press("Enter");
        await panel.getByRole("button", { name: `Use project ${projectName}`, exact: true }).waitFor();
        assert.equal(api.requests.length, beforeName, "naming a project does not submit the connection form or call Git");
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("kuroko.overleafProjects"))), [{ url: projectUrl, name: projectName }]);
        await panel.getByRole("button", { name: `Rename project ${projectName}`, exact: true }).click();
        await projectNameField.fill("Discard this name");
        await projectNameField.press("Escape");
        await panel.getByRole("button", { name: `Use project ${projectName}`, exact: true }).waitFor();
        await page.screenshot({ path: path.join(work, "overleaf-recent-projects.png") });
        await connect(panel);
        await connected(page, projectName);
        await panel.locator(".overleaf-connection").getByText(projectName, { exact: false }).waitFor();
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("kuroko.overleafProjects"))), [{ url: projectUrl, name: projectName }]);
        const sourcePreview = panel.getByRole("region", { name: "Figure to upload", exact: true });
        const destinationPreview = panel.getByRole("region", { name: "Current PDF at destination", exact: true });
        assert.equal(await sourcePreview.getByAltText("Current figure to upload", { exact: true }).getAttribute("src"), currentPreview);
        await destinationPreview.getByText("Save as a new file.", { exact: true }).waitFor();
        assert.equal(await destinationPreview.locator("img").count(), 0);
        const initialLayout = await previewLayout(panel);
        assert.ok(initialLayout[0].x < initialLayout[1].x, "the upload figure is always on the left");

        for (const destination of ["../escape.pdf", "C:/figure.pdf", "figures/.git/figure.pdf", "a".repeat(1021) + ".pdf"]) {
            await setDestination(panel, destination);
            await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
            await panel.getByRole("alert").filter({ hasText: "Enter a relative PDF path" }).waitFor();
        }
        assert.equal(api.uploads.length, 0, "invalid destinations are rejected before contacting the Git bridge");
        await closePanel(panel);
        panel = await openPanel(page);
        await settle(panel);

        await navigate(panel, "empty");
        await panel.getByRole("button", { name: "Up one folder", exact: true }).click();
        await navigate(panel, "figures");
        await panel.getByLabel("PDF file name in project", { exact: true }).fill("old figure.pdf");
        await destinationPreview.getByAltText(`First page of ${oldPath}`, { exact: true }).waitFor({ timeout: 60000 });
        await panel.getByRole("button", { name: `Select ${oldPath}`, exact: true }).click();
        const remote = panel.getByAltText(`First page of ${oldPath}`, { exact: true });
        await remote.waitFor({ timeout: 60000 });
        await settle(panel);
        const remoteImage = await remote.evaluate(async image => {
            await image.decode();
            return { width: image.naturalWidth, height: image.naturalHeight, src: image.src, draggable: image.draggable };
        });
        assert.equal(remoteImage.width / remoteImage.height, 2);
        assert.notEqual(remoteImage.src, currentPreview);
        assert.equal(await sourcePreview.getByAltText("Current figure to upload", { exact: true }).getAttribute("src"), currentPreview, "choosing an existing PDF keeps the source figure visible");
        assert.equal(await destinationPreview.locator("img").getAttribute("src"), remoteImage.src);
        assert.deepEqual(await previewLayout(panel), initialLayout, "file selection does not move the preview panes");
        await page.screenshot({ path: path.join(work, "overleaf-preview-pair.png") });
        assert.equal(remoteImage.draggable, false);
        assert.equal(await remote.evaluate(image => !image.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }))), true);
        assert.equal(await panel.getByLabel("PDF file name in project", { exact: true }).inputValue(), "old figure.pdf");
        assert.equal((await panel.getByLabel("Destination path", { exact: true }).innerText()).trim(), oldPath);
        const downloading = page.waitForEvent("download");
        await panel.getByRole("button", { name: "Download PDF", exact: true }).click();
        const download = await downloading;
        assert.equal(download.suggestedFilename(), "old figure.pdf");
        assert.deepEqual(fs.readFileSync(await download.path()), stored.get(oldPath));
        for (const selector of [".overleaf-panel", "header"]) {
            await panel.locator(selector).evaluate(element => {
                const dataTransfer = new DataTransfer();
                dataTransfer.setData("image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
                element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
            });
            assert.equal(await page.getByAltText("Generated PDF preview", { exact: true }).getAttribute("src"), currentPreview);
        }
        await navigate(panel, "figures/nested");
        await panel.getByLabel("PDF file name in project", { exact: true }).fill("current.pdf");
        assert.equal((await panel.getByLabel("Destination path", { exact: true }).innerText()).trim(), newPath);
        await destinationPreview.getByText("Save as a new file.", { exact: true }).waitFor();
        assert.equal(await destinationPreview.locator("img").count(), 0, "a new destination never shows the previously selected PDF");
        assert.equal(await sourcePreview.getByAltText("Current figure to upload", { exact: true }).getAttribute("src"), currentPreview);
        await page.screenshot({ path: path.join(work, "overleaf-save-picker.png") });
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await saved(page, panel, newPath);
        await connected(page, projectName);
        await page.screenshot({ path: path.join(work, "overleaf-connected-toolbar.png") });
        for (const width of [1400, 1201, 1001, 1000, 760, 551, 390, 320]) {
            await page.setViewportSize({ width, height: 950 });
            assert.equal(await toolbar(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `toolbar fits at ${width}px`);
            for (const control of [uploadButton(page), connectionIndicator(page), page.getByLabel("PDF file name", { exact: true }), page.getByLabel("Application menu", { exact: true })]) {
                const box = await control.boundingBox();
                assert.ok(box && box.width >= 30 && box.x >= 0 && box.x + box.width <= width + 1, `toolbar control stays visible at ${width}px`);
            }
        }
        await page.screenshot({ path: path.join(work, "overleaf-connected-toolbar-mobile.png") });
        await page.setViewportSize({ width: 1200, height: 950 });
        const beforeReload = api.requests.filter(request => request.action === "/connect").length;
        const reloadedPage = await context.newPage();
        await reloadedPage.goto(origin + "/");
        await connected(reloadedPage, projectName);
        await reloadedPage.reload();
        await connected(reloadedPage, projectName);
        assert.equal(api.requests.filter(request => request.action === "/connect").length, beforeReload, "reload restores the server connection indicator without reconnecting");
        await reloadedPage.close();
        assert.deepEqual(api.uploads[0].bytes, current);
        assert.equal(api.uploads[0].expected, "");
        const firstHistory = await history(page);
        assert.equal(firstHistory.length, 1);
        assert.equal(firstHistory[0].project, projectUrl);
        assert.equal(firstHistory[0].path, newPath);
        assert.equal(firstHistory[0].oid, oid(current));
        assert.deepEqual(Object.keys(firstHistory[0]).sort(), ["fingerprint", "id", "oid", "path", "project", "savedAt", "thumbnail"]);

        await paste(page, editedSvg);
        panel = await openPanel(page);
        await settle(panel);
        const suggested = panel.getByRole("region", { name: "Suggested destinations", exact: true });
        await suggested.getByRole("button", { name: `Use suggested destination ${newPath}`, exact: true }).waitFor();
        assert.equal((await panel.getByLabel("Destination path", { exact: true }).innerText()).trim(), newPath);
        assert.equal(await suggested.locator("img").first().getAttribute("src"), firstHistory[0].thumbnail);
        assert.equal(api.uploads.length, 1, "a suggested destination never authorizes a write");
        const editedPreview = await panel.getByAltText("Current figure to upload", { exact: true }).getAttribute("src");
        const beforeConfirmation = await previewLayout(panel);
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await panel.getByRole("button", { name: "Replace PDF", exact: true }).waitFor();
        assert.equal(await panel.getByAltText("Current figure to upload", { exact: true }).getAttribute("src"), editedPreview);
        assert.deepEqual(await previewLayout(panel), beforeConfirmation, "confirmation preserves both preview positions and sizes");
        await page.screenshot({ path: path.join(work, "overleaf-preview-confirmation.png") });
        assert.equal(api.uploads.length, 1);
        await panel.getByRole("button", { name: "Cancel replacement", exact: true }).click();
        assert.equal(api.uploads.length, 1);
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        api.conflictNext = true;
        await panel.getByRole("button", { name: "Replace PDF", exact: true }).click();
        await panel.getByRole("alert").filter({ hasText: "The PDF changed in Overleaf" }).waitFor();
        await settle(panel);
        assert.equal(api.uploads.length, 2, "a conflict does not automatically retry");
        assert.equal((await history(page))[0].oid, firstHistory[0].oid, "a failed upload cannot replace destination history");
        assert.equal(await suggested.count(), 0, "a remotely replaced PDF is no longer suggested from stale history");
        const updatedOid = oid(stored.get(newPath));
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await panel.getByRole("button", { name: "Replace PDF", exact: true }).click();
        await saved(page, panel, newPath);
        assert.equal(api.uploads[2].expected, updatedOid);
        assert.equal((await history(page)).length, 1, "saving the same destination updates its existing record");

        panel = await openPanel(page);
        await settle(panel);
        await setDestination(panel, "figures/failed.pdf");
        api.failNext = true;
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await panel.getByRole("alert").filter({ hasText: "could not be confirmed" }).waitFor();
        await settle(panel);
        assert.equal((await history(page)).length, 1);
        assert.equal(stored.has("figures/failed.pdf"), false);
        assert.equal(await panel.getByLabel("PDF file name in project", { exact: true }).inputValue(), "figures/failed.pdf", "manual names survive asynchronous state updates");

        api.holdRefresh = true;
        await panel.getByRole("button", { name: "Refresh", exact: true }).click();
        await toolbar(page).getByRole("status").filter({ hasText: "Refreshing Overleaf" }).waitFor();
        await closePanel(panel);
        await page.getByRole("button", { name: "Cancel Overleaf operation", exact: true }).click();
        await page.getByRole("button", { name: "Cancel Overleaf operation", exact: true }).waitFor({ state: "detached" });
        assert.equal(api.heldRefresh, null);

        // A different tab must not redirect an upload to another project.
        panel = await openPanel(page);
        await settle(panel);
        await setDestination(panel, "wrong-project.pdf");
        api.connected = otherProjectUrl;
        api.projects.get(otherProjectUrl).set(newPath, stored.get(newPath));
        await panel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await panel.getByRole("alert").filter({ hasText: "changed in another tab" }).waitFor();
        await settle(panel);
        assert.equal(api.uploads.at(-1).project, projectUrl);
        assert.equal(api.projects.get(otherProjectUrl).has("wrong-project.pdf"), false);
        assert.equal(await panel.getByRole("region", { name: "Suggested destinations", exact: true }).count(), 0, "same paths and bytes in another project do not inherit suggestions");
        await panel.getByRole("button", { name: "Change project", exact: true }).click();
        await connect(panel, otherProjectUrl);
        await connected(page, "abcdef01…", otherProjectUrl);
        assert.equal(await panel.getByRole("region", { name: "Suggested destinations", exact: true }).count(), 0);
        await closePanel(panel);

        // A server restart drops the connection, while browser history survives.
        api.connected = null;
        const connectCount = api.requests.filter(request => request.action === "/connect").length;
        await page.reload();
        await uploadButton(page).waitFor();
        assert.equal(await connectionIndicator(page).count(), 0, "a stopped server session is not shown as connected");
        await paste(page, editedSvg);
        panel = await openPanel(page);
        assert.equal(await panel.getByLabel("Overleaf Git URL", { exact: true }).inputValue(), otherProjectUrl);
        await panel.getByRole("button", { name: `Use project ${projectName}`, exact: true }).click();
        assert.equal(await panel.getByLabel("Overleaf Git URL", { exact: true }).inputValue(), projectUrl);
        assert.equal(api.requests.filter(request => request.action === "/connect").length, connectCount, "remembering a URL never initiates a connection");
        await panel.getByRole("button", { name: "Connect", exact: true }).click();
        await settle(panel);
        await connected(page, projectName);
        await panel.getByRole("button", { name: `Use suggested destination ${newPath}`, exact: true }).waitFor();
        assert.equal((await panel.getByLabel("Destination path", { exact: true }).innerText()).trim(), newPath, "saved destinations survive reload and reconnect");
        await page.setViewportSize({ width: 390, height: 844 });
        const bounds = await panel.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
        assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
        await page.screenshot({ path: path.join(work, "overleaf-save-mobile.png") });
        await panel.getByRole("button", { name: "Change project", exact: true }).click();
        await panel.getByRole("button", { name: `Forget URL for ${otherProjectUrl}`, exact: true }).click();
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("kuroko.overleafProjects"))), [{ url: projectUrl, name: projectName }]);
        await panel.getByRole("button", { name: `Rename project ${projectName}`, exact: true }).click();
        await panel.getByLabel(`Project name for ${projectUrl}`, { exact: true }).fill("");
        assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
        await page.screenshot({ path: path.join(work, "overleaf-project-name-mobile.png") });
        await panel.getByRole("button", { name: "Save name", exact: true }).click();
        await panel.getByRole("button", { name: `Use project ${projectUrl}`, exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("kuroko.overleafProjects"))), [{ url: projectUrl, name: "" }]);
        assert.equal((await history(page)).length, 1, "forgetting a URL does not delete uploaded figures or destination history");

        // Storage restrictions affect remembering destinations, not writing PDFs.
        const transient = await browser.newContext();
        await transient.addInitScript(() => {
            Object.defineProperty(indexedDB, "open", { value: () => { throw new DOMException("Storage denied", "SecurityError"); } });
            Object.defineProperty(Storage.prototype, "setItem", { value: () => { throw new DOMException("Storage denied", "SecurityError"); } });
        });
        const transientApi = await fixture(transient);
        const transientPage = await transient.newPage();
        transientPage.on("pageerror", error => errors.push(error.message));
        await transientPage.goto(origin + "/");
        await uploadButton(transientPage).waitFor();
        await paste(transientPage, currentSvg);
        const transientPanel = await openPanel(transientPage);
        await connect(transientPanel);
        await setDestination(transientPanel, "session-only.pdf");
        await transientPanel.getByRole("button", { name: "Upload PDF", exact: true }).click();
        await saved(transientPage, transientPanel, "session-only.pdf");
        assert.equal(transientApi.projects.get(projectUrl).has("session-only.pdf"), true);
        assert.deepEqual(transientApi.failures, []);

        const offline = await browser.newContext();
        const offlineRequests = [];
        await offline.route(/^https?:/, route => { offlineRequests.push(route.request().url()); return route.abort(); });
        const offlinePage = await offline.newPage();
        offlinePage.on("pageerror", error => errors.push(error.message));
        await offlinePage.goto(pathToFileURL(index).href);
        assert.equal(await uploadButton(offlinePage).count(), 0);
        assert.equal(await connectionIndicator(offlinePage).count(), 0);
        const offlinePanel = await openPanel(offlinePage, true);
        await offlinePanel.getByText("Overleaf is available when kuroko 2 is opened with its local launcher.", { exact: true }).waitFor();
        assert.deepEqual(offlineRequests, []);

        const unavailable = await browser.newContext();
        const unavailableApi = await fixture(unavailable);
        unavailableApi.unavailable = true;
        const unavailablePage = await unavailable.newPage();
        await unavailablePage.goto(origin + "/");
        const unavailablePanel = await openPanel(unavailablePage, true);
        await unavailablePanel.getByText("Overleaf is available when kuroko 2 is opened with its local launcher.", { exact: true }).waitFor();
        assert.equal(await uploadButton(unavailablePage).count(), 0, "a plain localhost server does not expose the upload button");
        assert.equal(await connectionIndicator(unavailablePage).count(), 0);
        assert.deepEqual(api.unexpected, []);
        assert.deepEqual(api.failures, []);
        assert.deepEqual(errors, []);
        console.log("Overleaf browser smoke passed: toolbar availability, named connection history, folder picker, preview/download, project-scoped persistent suggestions, confirmed upload/conflict, cancellation, storage fallback and mobile layout.");
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
