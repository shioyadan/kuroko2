const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");
const { root, work, paste, ready, save } = require("./pdf_smoke_helpers.cjs");

const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96" viewBox="0 0 192 96">${content}</svg>`;
const shapes = svg('<defs><linearGradient id="gradient"><stop stop-color="#316b9b"/><stop offset="1" stop-color="#80c7ab"/></linearGradient></defs><rect width="192" height="96" fill="white"/><rect x="10" y="10" width="172" height="76" rx="8" fill="url(#gradient)"/><path d="M20 70 L172 25" stroke="#203c55" stroke-width="3"/>');
(async () => {
    fs.mkdirSync(work, { recursive: true });
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
        const context = await browser.newContext({ viewport: { width: 1150, height: 800 }, acceptDownloads: true });
        await context.addInitScript(() => {
            Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
            // This suite covers the file fallback; local_fonts_smoke exercises the real API.
            Object.defineProperty(window, "queryLocalFonts", { value: undefined, configurable: true });
        });
        const external = [];
        await context.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
        const page = await context.newPage();
        page.on("console", entry => { if (entry.type() === "error") console.log("Browser:", entry.text()); });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(pathToFileURL(path.join(root, "dist-web/index.html")).href);
        await page.getByRole("heading", { name: "kuroko 2" }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false);
        await page.screenshot({ path: path.join(work, "empty.png") });

        // Input progress and cancellation are available before the first document exists.
        await page.evaluate(() => {
            Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
                read: () => new Promise(resolve => { window.finishClipboardRead = () => resolve([]); })
            } });
        });
        const toolbar = page.getByRole("navigation", { name: "Main toolbar", exact: true });
        await toolbar.getByRole("button", { name: /^Paste Objects/ }).click();
        await toolbar.getByRole("status").filter({ hasText: "Reading clipboard…" }).waitFor();
        assert.equal(await page.locator(".processing").count(), 0);
        await toolbar.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.evaluate(() => window.finishClipboardRead());
        await page.getByText("Cancelled.", { exact: true }).waitFor();
        assert.equal(await toolbar.getByRole("status").count(), 0);

        // The disclosure menu supports the keyboard and preserves file-picker activation.
        const menuButton = page.getByLabel("Application menu", { exact: true });
        const menu = page.locator(".application-menu");
        assert.equal(await page.getByRole("button", { name: "Save history", exact: true }).count(), 0);
        await menuButton.focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Tab");
        assert.equal(await page.getByRole("button", { name: "Open SVG", exact: true }).evaluate(button => button === document.activeElement), true);
        assert.equal(await page.getByRole("button", { name: "View source SVG", exact: true }).isEnabled(), false);
        await page.screenshot({ path: path.join(work, "application-menu.png") });
        await page.keyboard.press("Escape");
        assert.equal(await menu.evaluate(element => element.open), false);
        assert.equal(await menuButton.evaluate(button => button === document.activeElement), true);
        await menuButton.click();
        await page.getByRole("heading", { name: "kuroko 2" }).click();
        assert.equal(await menu.evaluate(element => element.open), false);
        await menuButton.click();
        await page.evaluate(() => {
            window.conversionProgress = [];
            window.progressPopupSeen = false;
            window.progressObserver = new MutationObserver(() => {
                const message = document.querySelector(".toolbar-status [role=status]")?.textContent;
                if (["Creating PDF…", "Rendering PDF preview…"].includes(message)) window.conversionProgress.push(message);
                if (document.querySelector(".processing")) window.progressPopupSeen = true;
            });
            window.progressObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
        });
        const openFile = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Open SVG", exact: true }).click();
        await (await openFile).setFiles({ name: "figure.svg", mimeType: "image/svg+xml", buffer: Buffer.from(shapes) });
        assert.equal(await menu.evaluate(element => element.open), false);
        await ready(page);
        const progress = await page.evaluate(() => {
            window.progressObserver.disconnect();
            return { stages: [...new Set(window.conversionProgress)], popup: window.progressPopupSeen };
        });
        assert.deepEqual(progress.stages, ["Creating PDF…", "Rendering PDF preview…"], "both conversion stages appear in the toolbar");
        assert.equal(progress.popup, false, "conversion progress must never cover the preview");
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
        await page.getByLabel("Application menu", { exact: true }).click();
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

        await page.evaluate(() => {
            window.clipboardReads = 0;
            navigator.clipboard.read = async () => { window.clipboardReads++; throw new DOMException("Clipboard permission denied", "NotAllowedError"); };
            window.dispatchEvent(new Event("focus"));
        });
        assert.equal(await page.evaluate(() => window.clipboardReads), 0, "focusing the app must not read the clipboard");
        await page.getByRole("button", { name: /^Paste Objects/ }).click();
        await page.getByRole("alert").filter({ hasText: "Clipboard permission denied" }).waitFor();
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
        await page.getByText("Save dialog closed without saving.", { exact: true }).waitFor();
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
        await page.locator(".notice.font-warning").filter({ hasText: "Missing fonts:" }).waitFor();
        await page.waitForFunction(() => document.querySelector("main").getAttribute("aria-busy") === "false");
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false, "font files are not bundled; one must be made available");
        await page.getByLabel("Select font files", { exact: true }).setInputFiles(process.env.TEST_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
        await ready(page);
        const textPdf = await save(page, "text.pdf");
        assert.match(textPdf.toString("latin1"), /\/FontFile2/);
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const document = await getDocument({ data: Uint8Array.from(textPdf), useSystemFonts: false }).promise;
        const text = await (await document.getPage(1)).getTextContent();
        assert.equal(text.items.map(item => item.str || "").join("").replace(/\s/g, ""), "HelloΩ");
        await document.destroy();

        // Missing families stay visible even with substitutes; missing glyphs cannot be silently dropped.
        await paste(page, textFigure.replace("DejaVu Sans", "DejaVu Sans Missing"));
        await ready(page);
        await page.locator(".notice.font-warning").filter({ hasText: "Missing fonts:" }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), true);
        await paste(page, textFigure.replace("Hello Ω", "&#x10ffff;"));
        await page.getByRole("alert").filter({ hasText: "missing glyphs" }).waitFor();

        await page.getByLabel("Open SVG file", { exact: true }).setInputFiles(path.join(root, "test/fixtures/ram.svg"));
        await toolbar.getByRole("button", { name: "Cancel", exact: true }).click();
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
