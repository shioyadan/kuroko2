const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");
const { fontMetadataFixture } = require("./font_fixture.cjs");

const root = path.resolve(__dirname, "..");
const work = path.join(root, "work");
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="110"><rect width="400" height="110" fill="white"/>${body}</svg>`;
const figure = weight => svg(`<text x="20" y="72" font-family="Cambria Math" font-weight="${weight}" font-size="48" fill="#172b3a">P₀/H₀ ₁₃</text>`);
async function paste(page, text) {
    await page.evaluate(text => {
        const clipboardData = new DataTransfer(); clipboardData.setData("image/svg+xml", text);
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, text);
}
async function ready(page) {
    await page.waitForFunction(() => document.querySelector("main")?.getAttribute("aria-busy") === "false", undefined, { timeout: 60000 });
    if (await page.getByRole("alert").count()) throw new Error(await page.getByRole("alert").innerText());
    await page.getByAltText("Generated PDF preview", { exact: true }).waitFor({ timeout: 60000 });
    const suggestion = page.getByRole("dialog", { name: "Save matching figure", exact: true });
    if (await suggestion.count()) await suggestion.getByRole("button", { name: "Not now", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), true);
}
async function save(page, name) {
    await page.getByLabel("PDF file name", { exact: true }).fill(name);
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Save PDF/ }).click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    await download.saveAs(path.join(work, name));
    await page.getByText(`Download started: ${name}`, { exact: true }).waitFor();
    return fs.readFileSync(path.join(work, name));
}
async function inspectPdf(bytes) {
    assert.doesNotMatch(bytes.toString("latin1"), /\/Subtype\s*\/Image/, "synthetic text must stay vector");
    assert.match(bytes.toString("latin1"), /\/FontFile2/, "the regular font remains embedded");
    const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false }).promise;
    try {
        const page = await document.getPage(1);
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str || "").join("").replace(/\s/g, "");
        const ops = await page.getOperatorList();
        const painted = [];
        const stack = [];
        let state = { mode: 0, lineWidth: 1, fontSize: 0, lineJoin: 0, miterLimit: 10 };
        for (let i = 0; i < ops.fnArray.length; i++) {
            const fn = ops.fnArray[i], args = ops.argsArray[i];
            if (fn === OPS.save) stack.push({ ...state });
            else if (fn === OPS.restore) state = stack.pop() ?? state;
            else if (fn === OPS.setTextRenderingMode) state.mode = args[0];
            else if (fn === OPS.setLineWidth) state.lineWidth = args[0];
            else if (fn === OPS.setFont) state.fontSize = args[1];
            else if (fn === OPS.setLineJoin) state.lineJoin = args[0];
            else if (fn === OPS.setMiterLimit) state.miterLimit = args[0];
            else if ([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText].includes(fn)) {
                for (const glyph of args.flat(Infinity)) {
                    if (glyph && typeof glyph.unicode === "string") {
                        for (const char of glyph.unicode) painted.push({ char, ...state });
                    }
                }
            }
        }
        return { text, painted };
    } finally { await document.destroy(); }
}
async function previewInk(page) {
    return page.evaluate(async () => {
        const image = document.querySelector('img[alt="Generated PDF preview"]');
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4) ink += (255 - pixels[i] + 255 - pixels[i + 1] + 255 - pixels[i + 2]) / 3;
        return ink;
    });
}
async function checkSource(page, expected) {
    await page.getByLabel("Application menu", { exact: true }).click();
    await page.getByRole("button", { name: "View source SVG", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Source SVG", exact: true });
    assert.equal(await dialog.getByLabel("Original SVG source", { exact: true }).inputValue(), expected);
    await dialog.getByRole("button", { name: "Close Source SVG", exact: true }).click();
}
const fontFile = (name, family, weight = 400) => ({ name, mimeType: "font/ttf", buffer: Buffer.from(fontMetadataFixture(family, weight)) });

(async () => {
    fs.mkdirSync(work, { recursive: true });
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
        const context = await browser.newContext({ acceptDownloads: true });
        await context.addInitScript(() => {
            Object.defineProperty(window, "queryLocalFonts", { configurable: true, value: undefined });
            Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
            try { localStorage.setItem("kuroko.suggestNames", "false"); } catch {}
        });
        const external = [];
        await context.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
        const page = await context.newPage();
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        page.on("console", entry => { if (entry.type() === "error") console.log("Browser:", entry.text()); });
        await page.goto(pathToFileURL(path.join(root, "dist-web/index.html")).href);
        const toolbar = page.getByRole("navigation", { name: "Main toolbar", exact: true });
        const fonts = page.getByRole("dialog", { name: "Fonts", exact: true });
        const bold = figure(700);
        await paste(page, bold);
        await page.locator(".notice.font-warning").filter({ hasText: "Missing fonts:" }).waitFor();
        await page.waitForFunction(() => document.querySelector("main").getAttribute("aria-busy") === "false");
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false, "no font is bundled or available yet");
        await page.getByLabel("Select font files", { exact: true }).setInputFiles(fontFile("math-regular.ttf", "Cambria Math"));
        await ready(page);
        await toolbar.getByText("Fonts ready · synthesized bold", { exact: true }).waitFor();
        await page.getByLabel("Application menu", { exact: true }).click();
        await page.getByRole("button", { name: "Fonts", exact: true }).click();
        await fonts.locator("li").filter({ hasText: "Cambria Math 700" }).getByText("Synthesized bold", { exact: true }).waitFor();
        await fonts.getByRole("button", { name: "Close Fonts", exact: true }).click();
        await checkSource(page, bold);
        const syntheticPdf = await inspectPdf(await save(page, "synthetic-bold.pdf"));
        assert.equal(syntheticPdf.text, "P₀/H₀₁₃", "selectable text is present exactly once");
        assert.ok(syntheticPdf.painted.some(item => (item.mode & 3) === 2), "synthetic text uses PDF fill-and-stroke");
        // Measured from the PowerPoint reference, independently of app constants.
        for (const glyph of syntheticPdf.painted.filter(item => (item.mode & 3) === 2)) {
            assert.ok(Math.abs(glyph.lineWidth / glyph.fontSize - 0.33257 / 11.64) < 0.000001, "stroke-to-font ratio matches PowerPoint's synthetic bold");
            assert.equal(glyph.lineJoin, 0, "PowerPoint uses miter joins");
            assert.equal(glyph.miterLimit, 10, "PowerPoint uses the default miter limit");
        }
        const syntheticInk = await previewInk(page);

        await paste(page, figure(400));
        await ready(page);
        await toolbar.getByText("Fonts ready", { exact: true }).waitFor();
        const regularPdf = await inspectPdf(await save(page, "synthetic-bold-regular.pdf"));
        assert.equal(regularPdf.text, "P₀/H₀₁₃");
        assert.ok(regularPdf.painted.every(item => (item.mode & 3) === 0), "regular text does not receive a synthetic stroke");
        const regularInk = await previewInk(page);
        assert.ok(syntheticInk > regularInk * 1.05, `synthetic text must visibly thicken: ${syntheticInk} vs ${regularInk}`);

        // The parent requests bold, one child switches to regular, and the next
        // child inherits bold again. A stroke added on the parent would leak.
        const mixed = svg('<text x="20" y="72" font-family="Cambria Math" font-weight="700" font-size="48">A<tspan>₀</tspan><tspan font-weight="400">B₁</tspan><tspan>₃</tspan></text>');
        await paste(page, mixed);
        await ready(page);
        await checkSource(page, mixed);
        const mixedPdf = await inspectPdf(await save(page, "synthetic-bold-mixed.pdf"));
        assert.equal(mixedPdf.text, "A₀B₁₃");
        for (const char of ["B", "₁"]) {
            const paint = mixedPdf.painted.filter(item => item.char === char);
            assert.ok(paint.length > 0, `regular glyph ${char} must be present`);
            assert.ok(paint.every(item => (item.mode & 3) === 0), `regular child ${char} must not inherit synthetic stroke`);
        }
        for (const char of ["A", "₀", "₃"]) assert.ok(mixedPdf.painted.some(item => item.char === char && (item.mode & 3) === 2), `inherited bold glyph ${char} must be stroked`);

        await paste(page, bold.replace('fill="#172b3a"', 'fill="#172b3a" stroke="#b00000" stroke-width="1"'));
        await page.getByRole("alert").filter({ hasText: "existing text outline is not supported" }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false, "an existing text outline must not be silently replaced");

        await paste(page, bold.replace('font-weight="700"', 'font-weight="700" font-style="italic"'));
        await ready(page);
        await page.locator(".notice.font-warning").filter({ hasText: "Missing fonts:" }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), true, "unavailable italic uses a substitute");
        const italicPdf = await inspectPdf(await save(page, "synthetic-bold-italic-substitute.pdf"));
        assert.equal(italicPdf.text, "P₀/H₀₁₃");
        assert.ok(italicPdf.painted.every(item => (item.mode & 3) === 0), "substitution must not apply Cambria's synthetic stroke");
        await page.getByLabel("Select font files", { exact: true }).setInputFiles(fontFile("other-regular.ttf", "Other Family"));
        await paste(page, bold.replace("Cambria Math", "Other Family"));
        await ready(page);
        await page.locator(".notice.font-warning").filter({ hasText: "Missing fonts:" }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), true, "other families can use a substitute bold face");
        const otherPdf = await inspectPdf(await save(page, "synthetic-bold-other-substitute.pdf"));
        assert.equal(otherPdf.text, "P₀/H₀₁₃");
        assert.ok(otherPdf.painted.every(item => (item.mode & 3) === 0), "other regular families do not gain Cambria's synthetic stroke");

        // This metadata-only bold fixture intentionally retains regular outlines:
        // it isolates exact-face preference from any change in the test glyphs.
        await paste(page, bold);
        await ready(page);
        await page.getByLabel("Select font files", { exact: true }).setInputFiles(fontFile("math-bold.ttf", "Cambria Math", 700));
        await ready(page);
        await toolbar.getByText("Fonts ready", { exact: true }).waitFor();
        const exactPdf = await inspectPdf(await save(page, "synthetic-bold-exact.pdf"));
        assert.equal(exactPdf.text, "P₀/H₀₁₃");
        assert.ok(exactPdf.painted.every(item => (item.mode & 3) === 0), "an exact bold face removes synthetic strokes");
        assert.deepEqual(external, [], "font synthesis requires no external resources");
        assert.deepEqual(errors, [], "no uncaught browser errors");
        console.log("Synthetic bold smoke passed: regular-face fallback, UI, original source, selectable vector text, visible bold, mixed-span inheritance, existing-outline rejection, visible missing-font substitutions and exact-face preference.");
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
