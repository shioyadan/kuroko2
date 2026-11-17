const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright-core");
const { fontMetadataFixture } = require("./font_fixture.cjs");

const root = path.resolve(__dirname, "..");
const work = path.join(root, "work");
const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="white"/>${content}</svg>`;
const fontFile = (family, weight = 400) => ({ name: `${family}-${weight}.ttf`, mimeType: "font/ttf", buffer: Buffer.from(fontMetadataFixture(family, weight)) });
const localFont = (family, weight = 400, options = {}) => {
    const style = options.italic ? (weight >= 700 ? "Bold Italic" : "Italic") : weight >= 700 ? "Bold" : "Regular";
    return { family, fullName: `${family} ${style}`, style, postscriptName: `Fixture-${family.replace(/[^a-z0-9]/gi, "")}-${style.replace(/\s/g, "")}`,
        data: Buffer.from(fontMetadataFixture(family, weight, 0, options)).toString("base64") };
};
async function paste(page, source) {
    await page.evaluate(source => {
        const clipboardData = new DataTransfer(); clipboardData.setData("image/svg+xml", source);
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, source);
}
async function ready(page) {
    await page.waitForFunction(() => document.querySelector("main")?.getAttribute("aria-busy") === "false", undefined, { timeout: 60000 });
    if (await page.getByRole("alert").count()) throw new Error(await page.getByRole("alert").innerText());
    await page.getByAltText("Generated PDF preview", { exact: true }).waitFor({ timeout: 60000 });
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
    assert.match(bytes.toString("latin1"), /\/FontFile2/, "substitutes are embedded, not viewer-dependent fonts");
    assert.doesNotMatch(bytes.toString("latin1"), /\/Subtype\s*\/Image/, "text and shapes remain vector");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false }).promise;
    try {
        const content = await (await document.getPage(1)).getTextContent();
        return content.items.map(item => item.str || "").join("").replace(/\s/g, "");
    } finally { await document.destroy(); }
}
async function checkSource(page, expected) {
    await page.getByLabel("Application menu", { exact: true }).click();
    await page.getByRole("button", { name: "View source SVG", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Source SVG", exact: true });
    assert.equal(await dialog.getByLabel("Original SVG source", { exact: true }).inputValue(), expected);
    await dialog.getByRole("button", { name: "Close Source SVG", exact: true }).click();
}

(async () => {
    fs.mkdirSync(work, { recursive: true });
    const fontFolder = fs.mkdtempSync(path.join(work, "fallback-font-folder-"));
    fs.mkdirSync(path.join(fontFolder, "nested"));
    fs.writeFileSync(path.join(fontFolder, "nested", "arial.ttf"), fontFile("Arial").buffer);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
        const context = await browser.newContext({ acceptDownloads: true });
        await context.addInitScript(fonts => {
            const query = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = descriptor => descriptor.name === "local-fonts"
                ? Promise.resolve({ state: "granted" }) : query(descriptor);
            window.fontQueries = 0;
            Object.defineProperty(window, "queryLocalFonts", { configurable: true, value: async () => {
                window.fontQueries++;
                return fonts.filter(font => !window.omitArial || font.family !== "Arial")
                    .map(({ data, ...font }) => ({ ...font, blob: async () => new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))]) }));
            } });
            Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
            try { localStorage.setItem("kuroko.suggestNames", "false"); } catch {}
        }, [localFont("Arial"), localFont("Arial", 700), localFont("Arial", 400, { italic: true }), localFont("Arial", 700, { italic: true }),
            localFont("Times New Roman"), localFont("Yu Gothic", 400, { sourcePath: process.env.TEST_CJK_FONT_PATH || "/usr/share/fonts/opentype/ipaexfont-gothic/ipaexg.ttf" })]);
        const external = [];
        await context.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
        const page = await context.newPage();
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        await page.goto(pathToFileURL(path.join(root, "dist-web/index.html")).href);
        const notice = page.locator(".notice.font-warning");
        const toolbar = page.getByRole("navigation", { name: "Main toolbar", exact: true });
        const input = page.getByLabel("Select font files", { exact: true });
        await input.setInputFiles(fontFile("Known Font"));
        await page.getByText("Fonts loaded. Paste a figure to continue.", { exact: true }).waitFor();

        // A missing parent and an exact child exercise inheritance as well as
        // mixed families. Actual font bytes, PDF generation and downloads run.
        const source = svg('<text x="16" y="44" font-family="Aptos" font-size="28">Regular Ω<tspan font-family="Known Font"> Known</tspan></text><text x="16" y="92" font-family="Aptos" font-weight="700" font-size="28">Bold ₀</text>');
        await paste(page, source);
        await ready(page);
        await notice.getByText(/Missing fonts:.*Aptos 400.*Aptos 700/).waitFor();
        assert.doesNotMatch(await notice.innerText(), /Known Font/, "available fonts are not reported as missing");
        assert.match(await notice.innerText(), /substitute fonts/);
        assert.equal(await toolbar.getByText(/Fonts needed|Fonts missing|Missing fonts|Fonts ready/).count(), 0, "the warning appears in the notice, not the toolbar");
        const [red, green, blue] = await notice.evaluate(element => getComputedStyle(element).color.match(/\d+/g).slice(0, 3).map(Number));
        assert.ok(red > green * 1.5 && red > blue * 1.5, "missing fonts are shown in red");
        await checkSource(page, source);
        const substituted = await save(page, "fallback-fonts.pdf");
        assert.equal(await inspectPdf(substituted), "RegularΩKnownBold₀");
        assert.match(substituted.toString("latin1"), /Fixture-KnownFont-Regular/, "an exact child font remains embedded");
        assert.match(substituted.toString("latin1"), /Fixture-Arial-Regular/, "missing Aptos uses the available local Arial font");
        assert.match(substituted.toString("latin1"), /Fixture-Arial-Bold/, "a missing bold face uses the local bold substitute");
        await notice.waitFor();
        await page.screenshot({ path: path.join(work, "fallback-fonts-notice.png") });

        // A partial import must keep the guide open and preserve the remaining
        // warning even though a usable PDF is generated after every import.
        await notice.getByRole("button", { name: "Add fonts…", exact: true }).click();
        const setup = page.getByRole("dialog", { name: "Fonts", exact: true });
        await input.setInputFiles(fontFile("Aptos"));
        await ready(page);
        await setup.waitFor();
        assert.match(await notice.innerText(), /Aptos 700/);
        assert.doesNotMatch(await notice.innerText(), /Aptos 400/);
        await input.setInputFiles(fontFile("Aptos", 700));
        await ready(page);
        await setup.waitFor({ state: "detached" });
        assert.equal(await notice.count(), 0, "adding every original face clears the warning");
        await toolbar.getByText("Fonts ready", { exact: true }).waitFor();
        const exact = await save(page, "fallback-fonts-restored.pdf");
        assert.equal(await inspectPdf(exact), "RegularΩKnownBold₀");
        assert.match(exact.toString("latin1"), /Fixture-Aptos-Regular/);
        assert.match(exact.toString("latin1"), /Fixture-Aptos-Bold/);
        assert.match(exact.toString("latin1"), /Fixture-KnownFont-Regular/);
        assert.doesNotMatch(exact.toString("latin1"), /Fixture-Arial/, "original fonts replace the substitutes on reconversion");
        await checkSource(page, source);

        // Local fallback selection supports Japanese, Latin, Greek, subscripts
        // and available styles without downloading or bundling any font files.
        const multilingual = svg('<text x="16" y="42" font-family="Unavailable Cloud Font" font-size="28">日本語 ABC Ω₀</text><text x="16" y="86" font-family="Unavailable Cloud Font" font-size="28" font-style="italic">Italic</text><text x="16" y="130" font-family="Unavailable Cloud Font" font-size="28" font-style="italic" font-weight="700">Bold italic</text>');
        await paste(page, multilingual);
        await ready(page);
        const multilingualPdf = await save(page, "fallback-fonts-multilingual.pdf");
        assert.equal(await inspectPdf(multilingualPdf), "日本語ABCΩ₀ItalicBolditalic");
        assert.match(multilingualPdf.toString("latin1"), /Fixture-YuGothic-Regular/);
        assert.match(multilingualPdf.toString("latin1"), /Fixture-Arial-Italic/);
        assert.match(multilingualPdf.toString("latin1"), /Fixture-Arial-BoldItalic/);
        await checkSource(page, multilingual);
        await page.setViewportSize({ width: 390, height: 700 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(work, "fallback-fonts-mobile.png") });
        await page.setViewportSize({ width: 1280, height: 720 });

        await paste(page, svg('<text x="16" y="44" font-family="Aptos Serif" font-size="28">Serif fallback</text>'));
        await ready(page);
        const serif = await save(page, "fallback-fonts-fixed-order.pdf");
        assert.equal(await inspectPdf(serif), "Seriffallback");
        assert.match(serif.toString("latin1"), /Fixture-Arial-Regular/, "fallback follows a fixed order without guessing the source family");
        assert.equal(await page.evaluate(() => window.fontQueries), 1, "later figures reuse the granted local font catalog");

        await page.reload();
        await page.evaluate(() => { window.omitArial = true; });
        await paste(page, svg('<text x="16" y="44" font-family="Aptos" font-size="28">Second choice</text>'));
        await ready(page);
        const second = await save(page, "fallback-fonts-second-choice.pdf");
        assert.equal(await inspectPdf(second), "Secondchoice");
        assert.match(second.toString("latin1"), /Fixture-TimesNewRoman-Regular/, "Times New Roman is used when Arial is unavailable");

        await paste(page, svg('<text x="16" y="44" font-family="Unavailable Cloud Font" font-size="28">&#x10ffff;</text>'));
        await page.getByRole("alert").filter({ hasText: /missing glyphs|characters/ }).waitFor();
        assert.equal(await page.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false, "unrepresentable characters cannot be silently dropped");

        // Folder imports must also discover substitute families, even if the
        // requested Aptos face is absent and local enumeration is unavailable.
        const folderPage = await context.newPage();
        folderPage.on("pageerror", error => errors.push(error.message));
        await folderPage.goto(pathToFileURL(path.join(root, "dist-web/index.html")).href);
        await folderPage.evaluate(() => Object.defineProperty(window, "queryLocalFonts", { configurable: true, value: undefined }));
        await paste(folderPage, svg('<text x="16" y="44" font-family="Aptos" font-size="28">Folder substitute</text>'));
        const folderNotice = folderPage.locator(".notice.font-warning");
        await folderNotice.waitFor();
        await folderPage.waitForFunction(() => document.querySelector("main")?.getAttribute("aria-busy") === "false");
        assert.equal(await folderPage.getByRole("button", { name: /^Save PDF/ }).isEnabled(), false);
        await folderNotice.getByRole("button", { name: "Add fonts…", exact: true }).click();
        const folderSetup = folderPage.getByRole("dialog", { name: "Fonts", exact: true });
        const folderChooser = folderPage.waitForEvent("filechooser");
        await folderSetup.getByRole("button", { name: "Choose font folder…", exact: true }).click();
        await (await folderChooser).setFiles(fontFolder);
        await ready(folderPage);
        await folderSetup.waitFor();
        assert.match(await folderNotice.innerText(), /Missing fonts: Aptos 400/);
        assert.match(await folderNotice.innerText(), /substitute fonts/);
        await folderSetup.getByRole("button", { name: "Close Fonts", exact: true }).click();
        const folderPdf = await save(folderPage, "fallback-fonts-folder.pdf");
        assert.equal(await inspectPdf(folderPdf), "Foldersubstitute");
        assert.match(folderPdf.toString("latin1"), /Fixture-Arial-Regular/, "the substitute from the nested folder is embedded");
        await folderNotice.waitFor();
        assert.equal(await folderPage.evaluate(() => window.fontQueries), 0, "folder fallback needs no local-font enumeration");
        await folderPage.close();
        assert.deepEqual(errors, []);
        assert.deepEqual(external, [], "font substitutes are obtained locally without remote font requests");
        console.log("Fallback fonts smoke passed: red notice, vector and selectable embedded text, local Arial/Times/Yu Gothic selection, save with warning, exact child fonts, partial/full font imports, nested-folder substitutes, reconversion, source preservation, styled and Japanese substitutes, mobile layout and unsupported-glyph errors.");
    } finally { await browser.close(); fs.rmSync(fontFolder, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
