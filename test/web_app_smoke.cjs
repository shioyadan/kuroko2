const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const work = path.join(root, "work");
const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96" viewBox="0 0 192 96">${content}</svg>`;
const shapes = svg('<defs><linearGradient id="gradient"><stop stop-color="#316b9b"/><stop offset="1" stop-color="#80c7ab"/></linearGradient></defs><rect width="192" height="96" fill="white"/><rect x="10" y="10" width="172" height="76" rx="8" fill="url(#gradient)"/><path d="M20 70 L172 25" stroke="#203c55" stroke-width="3"/>');
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
    await download.saveAs(path.join(work, fileName));
    // Downloads can finish before history is recorded; new pastes are locked until then.
    await page.getByText(`Download started: ${fileName}`, { exact: true }).waitFor();
    const bytes = fs.readFileSync(path.join(work, fileName));
    assert.match(bytes.toString("latin1"), /^%PDF-/);
    return bytes;
}

(async () => {
    fs.mkdirSync(work, { recursive: true });
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
        const context = await browser.newContext({ viewport: { width: 1150, height: 800 }, acceptDownloads: true });
        await context.addInitScript(() => {
            Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
        });
        const external = [];
        await context.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
        const page = await context.newPage();
        page.on("console", entry => { if (entry.type() === "error") console.log("Browser:", entry.text()); });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(pathToFileURL(path.join(root, "dist-web/index.html")).href);
        await page.getByRole("heading", { name: "PowerPoint → PDF" }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false);
        await page.screenshot({ path: path.join(work, "empty.png") });

        await paste(page, shapes);
        await ready(page);
        const bytes = await save(page, "vector.pdf");
        const raw = bytes.toString("latin1");
        assert.match(raw, /\/MediaBox\s*\[\s*0\s+0\s+144\s+72\s*\]/);
        assert.doesNotMatch(raw, /\/Subtype\s*\/Image/);
        await page.screenshot({ path: path.join(work, "vector.png") });

        // PowerPoint wraps raster images in defs/use. Base64 containing "url" is
        // image data, not a CSS URL expression; neither reference spelling may lose it.
        const embedded = fs.readFileSync(path.join(root, "test/fixtures/embedded-image.svg"), "utf8");
        assert.match(embedded, /data:image\/png;base64,[^"]*url/i);
        for (const input of [embedded, embedded.replaceAll("xlink:href=", "href=")]) {
            await paste(page, input);
            await ready(page);
            const samples = await page.evaluate(async () => {
                const image = document.querySelector('img[alt="Generated PDF preview"]');
                await image.decode();
                const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 20;
                const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 100, 20);
                return { left: [...ctx.getImageData(25, 10, 1, 1).data], right: [...ctx.getImageData(75, 10, 1, 1).data] };
            });
            assert.ok(samples.left[0] > 150 && samples.left[1] < 100 && samples.left[2] < 100, JSON.stringify(samples));
            assert.ok(samples.right[2] > 150 && samples.right[0] < 100 && samples.right[1] < 100, JSON.stringify(samples));
        }
        const imagePdf = (await save(page, "embedded-image.pdf")).toString("latin1");
        assert.match(imagePdf, /\/Subtype\s*\/Image/);
        assert.match(imagePdf, /\/MediaBox\s*\[\s*0\s+0\s+376\.5\s+53\.25\s*\]/);

        // Original source stays intact; scripts, event handlers and external images never execute.
        const nested = Buffer.from(svg('<rect width="192" height="96" fill="red"/>')).toString("base64");
        const unsafe = svg('<script>globalThis.svgExecuted=true</script><rect width="192" height="96" fill="#8899aa" onclick="alert(1)"/>' +
            '<image href="https://invalid.example/image.png" width="10" height="10"/>' +
            `<image href="data:image/svg+xml;base64,${nested}" width="192" height="96"/>`);
        await paste(page, unsafe);
        await ready(page);
        assert.equal(await page.evaluate(() => globalThis.svgExecuted), undefined);
        const safePixel = await page.evaluate(async () => {
            const image = document.querySelector('img[alt="Generated PDF preview"]'); await image.decode();
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data];
        });
        assert.deepEqual(safePixel, [136, 153, 170, 255], "nested SVG data must remain blocked");
        await page.getByRole("button", { name: "View source SVG", exact: true }).click();
        assert.equal(await page.getByLabel("Original SVG source").inputValue(), unsafe);
        await page.getByRole("button", { name: "Close Source SVG" }).click();

        await paste(page, "not SVG", "text/plain");
        await page.getByRole("alert").filter({ hasText: "No SVG" }).waitFor();
        await paste(page, `<div>${shapes}</div>`, "text/html");
        await ready(page);

        // An advertised but empty SVG payload must use Async Clipboard while event activation survives.
        await page.evaluate(text => {
            Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
                read: async () => [{ types: ["image/svg+xml"], getType: async () => new Blob([text], { type: "image/svg+xml" }) }]
            } });
        }, shapes);
        await paste(page, "");
        await ready(page);

        await page.getByRole("checkbox", { name: "Auto Capture on Focus" }).check();
        await ready(page);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await page.getByText("Clipboard unchanged.", { exact: true }).waitFor();
        await page.evaluate(() => {
            navigator.clipboard.read = async () => { throw new DOMException("Clipboard permission denied", "NotAllowedError"); };
            window.dispatchEvent(new Event("focus"));
        });
        await page.getByRole("alert").filter({ hasText: "Clipboard permission denied" }).waitFor();
        assert.equal(await page.getByRole("checkbox", { name: "Auto Capture on Focus" }).isChecked(), false);
        await paste(page, shapes);
        await ready(page);

        // Exercise the native-picker branch without opening an OS dialog in the test runner.
        await page.evaluate(() => {
            Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: async options => ({
                name: options.suggestedName,
                createWritable: async () => ({
                    write: async blob => { window.savedPdfSize = (await blob.arrayBuffer()).byteLength; },
                    close: async () => { window.saveClosed = true; },
                    abort: async () => {}
                })
            }) });
        });
        await page.getByLabel("PDF file name", { exact: true }).fill("picked.pdf");
        await page.keyboard.press("Control+s");
        await page.getByText("Saved: picked.pdf", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.saveClosed && window.savedPdfSize > 100), true);
        await page.evaluate(() => Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: async () => { throw new DOMException("Cancelled", "AbortError"); } }));
        let cancelledDownloads = 0;
        const countCancelledDownload = () => { cancelledDownloads++; };
        page.on("download", countCancelledDownload);
        await page.getByRole("button", { name: /^Save PDF/ }).click();
        await page.getByText("Save cancelled.", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), true);
        assert.equal(cancelledDownloads, 0, "a cancelled/interrupted picker must not start a download automatically");
        page.off("download", countCancelledDownload);
        const recoveredDownload = page.waitForEvent("download");
        await page.getByRole("button", { name: "Download PDF instead", exact: true }).click();
        const recovered = await recoveredDownload;
        assert.equal(recovered.suggestedFilename(), "picked.pdf");
        assert.equal(await recovered.failure(), null);
        assert.match(fs.readFileSync(await recovered.path()).toString("latin1"), /^%PDF-/);
        await page.getByText("Download started: picked.pdf", { exact: true }).waitFor();
        await page.evaluate(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true }));

        const textFigure = svg('<rect width="192" height="96" fill="white"/><text x="12" y="52" font-family="DejaVu Sans" font-size="24">Hello Ω</text>');
        await paste(page, textFigure);
        await page.getByText("Fonts needed for PDF", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false);
        await page.getByLabel("Select font files", { exact: true }).setInputFiles(process.env.TEST_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
        await ready(page);
        const textPdf = await save(page, "text.pdf");
        assert.match(textPdf.toString("latin1"), /\/FontFile2/);
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const document = await getDocument({ data: Uint8Array.from(textPdf), useSystemFonts: false }).promise;
        const text = await (await document.getPage(1)).getTextContent();
        assert.equal(text.items.map(item => item.str || "").join("").replace(/\s/g, ""), "HelloΩ");
        await document.destroy();

        // Local font names must not silently accept the wrong family or missing glyphs.
        await paste(page, textFigure.replace("DejaVu Sans", "DejaVu Sans Missing"));
        await page.getByText("Fonts needed for PDF", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false);
        await paste(page, textFigure.replace("Hello Ω", "&#x10ffff;"));
        await page.getByRole("alert").filter({ hasText: "missing glyphs" }).waitFor();

        await page.getByLabel("Open SVG file", { exact: true }).setInputFiles(path.join(root, "test/fixtures/ram.svg"));
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByText("Cancelled.", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false);

        // Replacing a document in flight cannot publish the older result.
        await page.getByLabel("Open SVG file", { exact: true }).setInputFiles(path.join(root, "test/fixtures/ram.svg"));
        await paste(page, shapes);
        await ready(page);
        await new Promise(resolve => setTimeout(resolve, 500));
        assert.equal(await page.getByText("50.8 × 25.4 mm", { exact: true }).count(), 1);

        // Exercise the full Office shadow fixture separately, preserving vector shapes.
        await page.getByLabel("Open SVG file", { exact: true }).setInputFiles(path.join(root, "test/fixtures/ram.svg"));
        await ready(page);
        const shadowPdf = await save(page, "shadow.pdf");
        assert.match(shadowPdf.toString("latin1"), /\/Subtype\s*\/Image/);
        // PDF.js's unsupported type-1 shading fallback used to turn these blue gradients pink.
        const colors = await page.evaluate(async () => {
            const image = document.querySelector('img[alt="Generated PDF preview"]');
            await image.decode();
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 600;
            const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 600, 600);
            const pixels = ctx.getImageData(0, 0, 600, 600).data;
            let blue = 0, pink = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 2] > pixels[i] + 15 && pixels[i + 1] > pixels[i] + 10) blue++;
                if (pixels[i] > 240 && pixels[i + 1] < 140 && pixels[i + 2] > 140) pink++;
            }
            return { blue, pink };
        });
        assert.ok(colors.blue > 10000, JSON.stringify(colors));
        assert.equal(colors.pink, 0);
        await page.screenshot({ path: path.join(work, "shadow.png") });

        await page.getByRole("button", { name: /^Log/ }).click();
        await page.getByRole("region", { name: "Application log" }).waitFor();
        await page.getByRole("separator", { name: "Resize application log" }).focus();
        await page.keyboard.press("ArrowUp");
        await page.screenshot({ path: path.join(work, "log.png") });
        await page.getByRole("button", { name: "Close application log" }).click();
        await page.setViewportSize({ width: 390, height: 700 });
        await page.screenshot({ path: path.join(work, "mobile.png") });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(external, [], "single HTML must not request any external resources");
        assert.deepEqual(errors, [], "no uncaught browser errors");
        console.log("Browser smoke passed: file://, clipboard routes, embedded PNG references, blocked external/nested content, PDF dimensions/vector/text, fonts, shadow fixture, cancellation, log and mobile layout.");
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
