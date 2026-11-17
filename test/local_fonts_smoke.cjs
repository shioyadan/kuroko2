const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const { chromium } = require("playwright-core");
const root = path.resolve(__dirname, "..");
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96">${body}</svg>`;
const shapes = svg('<rect x="10" y="10" width="172" height="76" fill="#397ca0"/>');
const textFigure = svg('<text x="12" y="52" font-family="DejaVu Sans" font-size="24">Hello Ω</text>');
async function paste(page, text) {
    const session = await page.context().newCDPSession(page);
    try {
        // Granted fonts remain available during asynchronous loading without user activation.
        await session.send("Runtime.evaluate", { expression: `(${(text => {
            const clipboardData = new DataTransfer(); clipboardData.setData("image/svg+xml", text);
            window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
        }).toString()})(${JSON.stringify(text)})`, userGesture: false });
    } finally { await session.detach(); }
}
async function ready(page) {
    await page.getByAltText("Generated PDF preview", { exact: true }).waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("main").getAttribute("aria-busy") === "false");
    const suggestion = page.getByRole("dialog", { name: "Save matching figure", exact: true });
    if (await suggestion.count()) await suggestion.getByRole("button", { name: "Not now", exact: true }).click();
}
async function missing(page) {
    await page.locator(".notice.font-warning").filter({ hasText: "Missing fonts:" }).waitFor();
    await page.waitForFunction(() => document.querySelector("main").getAttribute("aria-busy") === "false");
    assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false, "without access to any font, conversion waits for font access or a file");
}
(async () => {
    fs.mkdirSync(path.join(root, "work"), { recursive: true });
    const server = http.createServer((_request, response) => {
        response.setHeader("Content-Type", "text/html");
        fs.createReadStream(path.join(root, "dist-web/index.html")).pipe(response);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const fontPath = process.env.TEST_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    const fontFolder = fs.mkdtempSync(path.join(os.tmpdir(), "kuroko-font-folder-"));
    fs.mkdirSync(path.join(fontFolder, "nested"));
    fs.copyFileSync(fontPath, path.join(fontFolder, "nested", "12345.ttf"));
    try {
        const context = await browser.newContext({ acceptDownloads: true });
        await context.addInitScript(() => {
            const query = window.queryLocalFonts;
            window.localFontQueries = 0;
            window.queryLocalFonts = (...args) => { window.localFontQueries++; return query.apply(window, args); };
            Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
        });
        const page = await context.newPage();
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        const url = `http://127.0.0.1:${server.address().port}/`;
        await page.goto(url);
        await paste(page, textFigure);
        await missing(page);
        assert.equal(await page.evaluate(() => window.localFontQueries), 0, "first use still requires permission");

        // Exercise Chromium's actual permission and installed font API, not a mock catalog.
        await context.grantPermissions(["local-fonts"]);
        await page.reload();
        await paste(page, shapes);
        await ready(page);
        assert.equal(await page.evaluate(() => window.localFontQueries), 0, "figures without text never enumerate fonts");
        await paste(page, textFigure);
        await ready(page);
        assert.equal(await page.evaluate(() => window.localFontQueries), 1);
        assert.equal(await page.locator(".notice.font-warning").count(), 0);
        await paste(page, textFigure.replace("Hello Ω", "Hello again"));
        await ready(page);
        assert.equal(await page.evaluate(() => window.localFontQueries), 1, "later pastes reuse the local catalog");

        await page.reload();
        await paste(page, textFigure);
        await ready(page);
        assert.equal(await page.evaluate(() => window.localFontQueries), 1, "granted fonts are restored after a reload without a button click");
        const download = page.waitForEvent("download");
        await page.getByRole("button", { name: /^Save PDF/ }).click();
        const pdf = await download;
        assert.equal(await pdf.failure(), null);
        const bytes = fs.readFileSync(await pdf.path());
        assert.match(bytes.toString("latin1"), /\/FontFile2/);
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const document = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false }).promise;
        const text = await (await document.getPage(1)).getTextContent();
        assert.equal(text.items.map(item => item.str || "").join("").replace(/\s/g, ""), "HelloΩ");
        await document.destroy();

        // An enumeration failure leaves the manual font-file fallback usable.
        await page.reload();
        await page.evaluate(() => { window.queryLocalFonts = async () => { throw new DOMException("Font access unavailable", "SecurityError"); }; });
        await paste(page, textFigure);
        await missing(page);
        assert.equal(await page.getByRole("alert").count(), 0);
        await page.getByRole("button", { name: "Add fonts…", exact: true }).click();
        const guide = page.getByRole("dialog", { name: "Fonts", exact: true });
        await guide.getByText("Choose individual font files instead", { exact: true }).click();
        const fileChooser = page.waitForEvent("filechooser");
        await guide.getByRole("button", { name: "Choose font files…", exact: true }).click();
        await (await fileChooser).setFiles(fontPath);
        await ready(page);
        await guide.waitFor({ state: "detached" });
        const matching = page.getByRole("dialog", { name: "Save matching figure", exact: true });
        if (await matching.count()) await matching.getByRole("button", { name: "Not now", exact: true }).click();
        await page.getByLabel("Application menu", { exact: true }).click();
        await page.getByRole("button", { name: "Fonts", exact: true }).click();
        await guide.getByText("All fonts for this figure are ready.", { exact: true }).waitFor();
        await guide.getByRole("button", { name: "Close Fonts", exact: true }).click();

        // Mock only the permission decision for first-use flows. OS prompts are
        // outside the page; native enumeration and embedding were covered above.
        const firstUseContext = await browser.newContext();
        await firstUseContext.addInitScript(({ text, font }) => {
            window.fontPermission = "prompt";
            window.fontResponse = "allow";
            window.fontQueries = 0;
            window.fontQueryGestures = [];
            const query = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = descriptor => descriptor.name === "local-fonts"
                ? Promise.resolve({ state: window.fontPermission }) : query(descriptor);
            Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
                read: async () => [{ types: ["image/svg+xml"], getType: async () => new Blob([text], { type: "image/svg+xml" }) }]
            } });
            window.queryLocalFonts = async () => {
                window.fontQueries++;
                window.fontQueryGestures.push(navigator.userActivation.isActive);
                if (window.holdFontQuery) await new Promise(resolve => { window.releaseFontQuery = resolve; });
                if (window.fontResponse === "dismiss") return [];
                if (window.fontResponse === "deny") { window.fontPermission = "denied"; return []; }
                window.fontPermission = "granted";
                return [{ family: "DejaVu Sans", fullName: "DejaVu Sans", postscriptName: "DejaVuSans", style: "Regular",
                    blob: async () => new Blob([Uint8Array.from(atob(font), c => c.charCodeAt(0))]) }];
            };
        }, { text: textFigure, font: fs.readFileSync(fontPath).toString("base64") });
        const firstUse = await firstUseContext.newPage();
        firstUse.on("pageerror", error => errors.push(error.message));
        await firstUse.goto(url);
        await firstUse.evaluate(() => { window.holdFontQuery = true; });
        await firstUse.getByRole("button", { name: /^Paste Objects/ }).click();
        await firstUse.locator(".toolbar .toolbar-status").getByText("Loading fonts…", { exact: true }).waitFor();
        assert.equal(await firstUse.locator(".processing").count(), 0, "font loading stays in the toolbar");
        assert.equal(await firstUse.getByRole("dialog").count(), 0, "pasting does not open the font guide");
        await firstUse.screenshot({ path: path.join(root, "work/font-status-loading.png") });
        await firstUse.evaluate(() => window.releaseFontQuery());
        await ready(firstUse);
        await firstUse.locator(".toolbar .toolbar-status").getByText("Fonts ready", { exact: true }).waitFor();
        assert.equal(await firstUse.evaluate(() => window.fontQueries), 1);
        assert.deepEqual(await firstUse.evaluate(() => window.fontQueryGestures), [true], "first-use permission is requested within the paste gesture");
        assert.equal(await firstUse.getByRole("button", { name: "Add fonts…", exact: true }).count(), 0);

        // Cancelling from the toolbar must suppress the pending conversion.
        await firstUse.reload();
        await firstUse.evaluate(() => { window.holdFontQuery = true; window.fontResponse = "dismiss"; });
        await firstUse.getByRole("button", { name: /^Paste Objects/ }).click();
        await firstUse.getByRole("navigation", { name: "Main toolbar", exact: true }).getByRole("button", { name: "Cancel font loading", exact: true }).click();
        await firstUse.evaluate(() => window.releaseFontQuery());
        await firstUse.getByText("Cancelled.", { exact: true }).waitFor();
        assert.equal(await firstUse.getByRole("button", { name: "Cancel font loading", exact: true }).count(), 0);
        assert.equal(await firstUse.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false);
        assert.equal(await firstUse.getByAltText("Generated PDF preview", { exact: true }).count(), 0);

        await firstUse.reload();
        await firstUse.evaluate(() => { window.fontResponse = "dismiss"; });
        await firstUse.getByRole("button", { name: /^Paste Objects/ }).click();
        await missing(firstUse);
        assert.equal(await firstUse.locator(".notice.font-warning button").count(), 1, "one font recovery action appears in the notice");
        assert.equal(await firstUse.locator(".toolbar-status .font-add").count(), 0, "font warnings are outside the toolbar");
        await firstUse.getByRole("button", { name: /^Paste Objects/ }).click();
        await missing(firstUse);
        assert.equal(await firstUse.evaluate(() => window.fontQueries), 1, "dismissal does not nag on subsequent pastes");
        await firstUse.getByRole("button", { name: "Add fonts…", exact: true }).click();
        const setup = firstUse.getByRole("dialog", { name: "Fonts", exact: true });
        await setup.getByRole("button", { name: "Allow font access", exact: true }).waitFor();
        await firstUse.screenshot({ path: path.join(root, "work/font-setup-permission.png") });
        await firstUse.evaluate(() => { window.fontResponse = "allow"; });
        await setup.getByRole("button", { name: "Allow font access", exact: true }).click();
        await ready(firstUse);
        await setup.waitFor({ state: "detached" });
        assert.equal(await firstUse.evaluate(() => window.fontQueries), 2);

        await firstUse.reload();
        await firstUse.evaluate(() => { window.fontResponse = "deny"; });
        await firstUse.getByRole("button", { name: /^Paste Objects/ }).click();
        await missing(firstUse);
        await firstUse.getByRole("button", { name: "Add fonts…", exact: true }).click();
        await setup.getByText(/Font access is blocked/).waitFor();
        assert.equal(await setup.getByRole("button", { name: "Allow font access", exact: true }).count(), 0);
        await firstUse.screenshot({ path: path.join(root, "work/font-setup-folder.png") });
        const folderChooser = firstUse.waitForEvent("filechooser");
        await setup.getByRole("button", { name: "Choose font folder…", exact: true }).click();
        await (await folderChooser).setFiles(fontFolder);
        await ready(firstUse);
        await setup.waitFor({ state: "detached" });
        assert.equal(await firstUse.evaluate(() => window.fontQueries), 1, "manual folder selection does not retry denied access");

        await firstUse.reload();
        await firstUse.evaluate(() => { window.queryLocalFonts = undefined; });
        await firstUse.getByRole("button", { name: /^Paste Objects/ }).click();
        await missing(firstUse);
        await firstUse.screenshot({ path: path.join(root, "work/font-status-needed.png") });
        await firstUse.setViewportSize({ width: 390, height: 700 });
        await firstUse.screenshot({ path: path.join(root, "work/font-status-mobile.png") });
        assert.equal(await firstUse.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await firstUse.getByLabel("Application menu", { exact: true }).click();
        await firstUse.screenshot({ path: path.join(root, "work/application-menu-mobile.png") });
        await firstUse.getByRole("button", { name: "Fonts", exact: true }).click();
        await setup.getByText(/This browser cannot load installed fonts automatically/).waitFor();
        await firstUse.setViewportSize({ width: 390, height: 700 });
        await firstUse.screenshot({ path: path.join(root, "work/font-setup-mobile.png") });
        assert.equal(await setup.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
        // Desktop Chromium suppresses file pickers in windows narrower than 400 px.
        await firstUse.setViewportSize({ width: 1280, height: 720 });
        const unsupportedChooser = firstUse.waitForEvent("filechooser");
        await setup.getByRole("button", { name: "Choose font folder…", exact: true }).click();
        await (await unsupportedChooser).setFiles(fontFolder);
        await ready(firstUse);
        await setup.waitFor({ state: "detached" });
        assert.deepEqual(errors, []);
        console.log("Local fonts smoke passed: native granted access and embedding, first-use prompting in the paste gesture, dismissal without repeat prompts, explicit retry, denied/unsupported access, nested folder and individual-file recovery, automatic dialog completion and mobile layout.");
    } finally { await browser.close(); server.close(); fs.rmSync(fontFolder, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
