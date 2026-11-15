const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright-core");
const root = path.resolve(__dirname, "..");
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96">${body}</svg>`;
const shapes = svg('<rect x="10" y="10" width="172" height="76" fill="#397ca0"/>');
const textFigure = svg('<text x="12" y="52" font-family="DejaVu Sans" font-size="24">Hello Ω</text>');
async function paste(page, text) {
    const session = await page.context().newCDPSession(page);
    try {
        // No user activation: this also covers Auto Capture on Focus.
        await session.send("Runtime.evaluate", { expression: `(${(text => {
            const clipboardData = new DataTransfer(); clipboardData.setData("image/svg+xml", text);
            window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
        }).toString()})(${JSON.stringify(text)})`, userGesture: false });
    } finally { await session.detach(); }
}
async function ready(page) {
    await page.getByAltText("Generated PDF preview", { exact: true }).waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("main").getAttribute("aria-busy") === "false");
}
(async () => {
    const server = http.createServer((_request, response) => {
        response.setHeader("Content-Type", "text/html");
        fs.createReadStream(path.join(root, "dist-web/index.html")).pipe(response);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
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
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await paste(page, textFigure);
        await page.getByText("Fonts needed for PDF", { exact: true }).waitFor();
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
        assert.equal(await page.getByText("Fonts needed for PDF", { exact: true }).count(), 0);
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
        await page.getByText("Fonts needed for PDF", { exact: true }).waitFor();
        assert.equal(await page.getByRole("alert").count(), 0);
        await page.getByLabel("Select font files", { exact: true }).setInputFiles(process.env.TEST_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
        await ready(page);
        assert.deepEqual(errors, []);
        console.log("Local fonts smoke passed: granted Chromium fonts load on paste and after reload without user activation; text embeds correctly; first use, catalog reuse, text-free SVGs and manual fallback remain supported.");
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
