import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseSvgLength, normalizeFontFamily } from "../src/core/svg";
import { parseFont, embeddingAllowed, FontRegistry } from "../src/core/fonts";
import { pdfFileName } from "../src/file_access";

test("physical SVG units convert to CSS px, invalid dimensions are rejected", () => {
    assert.equal(parseSvgLength("72pt"), 96);
    assert.equal(parseSvgLength("25.4mm"), 96);
    assert.equal(parseSvgLength("2.54cm"), 96);
    assert.equal(parseSvgLength("1in"), 96);
    assert.equal(parseSvgLength("6pc"), 96);
    for (const value of ["0", "-1", "NaN", "Infinity", "100%", "1e999", "12garbage"]) assert.equal(parseSvgLength(value), null);
});
test("font names normalize only presentation suffixes; narrow is distinct", () => {
    assert.equal(normalizeFontFamily("'Arial_MSFontService'"), "arial");
    assert.notEqual(normalizeFontFamily("Arial Narrow"), normalizeFontFamily("Arial"));
});
test("filenames are safe and do not accumulate PDF suffixes", () => {
    assert.equal(pdfFileName(" figure.PDF "), "figure.pdf");
    assert.equal(pdfFileName(" "), "figure.pdf");
    assert.equal(pdfFileName("a/b:c"), "a_b_c.pdf");
});
test("malformed fonts fail before reaching WASM", () => {
    assert.throws(() => parseFont(new Uint8Array(2), "short.ttf"), /bounds/);
    assert.throws(() => parseFont(new Uint8Array(32), "fake.ttf"), /TTF/);
    const collection = new Uint8Array(12);
    const view = new DataView(collection.buffer);
    view.setUint32(0, 0x74746366); view.setUint32(8, 257);
    assert.throws(() => parseFont(collection, "bad.ttc"), /collection/);
});
test("restricted and no-subsetting fonts cannot be used", () => {
    const face = { family: "Test", aliases: ["Test"], weight: 400, style: "normal" as const, faceIndex: 0, cmap: undefined, embeddingFlags: 0 };
    assert.equal(embeddingAllowed(face), true);
    for (const flags of [2, 0x100, 0x200]) assert.equal(embeddingAllowed({ ...face, embeddingFlags: flags }), false);
    assert.equal(embeddingAllowed({ ...face, embeddingFlags: 4 }), true);
});
test("real font metadata and glyph coverage, TTC faces and deduplication", async () => {
    const path = process.env.TEST_FONT_PATH ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    const bytes = Uint8Array.from(readFileSync(path));
    const font = parseFont(bytes, "numeric-cloud-font.ttf");
    assert.equal(font.faces[0].family, "DejaVu Sans");
    const registry = new FontRegistry();
    await registry.add(new File([bytes], "font.ttf"));
    await registry.add(new File([bytes], "duplicate.ttf"));
    assert.equal(registry.loaded.length, 1);
    const requirement = { family: "DejaVu Sans", weight: 400, style: "normal" as const, text: "Hello Ω" };
    assert.equal(registry.missing([requirement]).length, 0);
    assert.equal(registry.forConversion([requirement]).length, 1);
    assert.throws(() => registry.forConversion([{ ...requirement, text: "\u{10ffff}" }]), /missing glyphs/);
    assert.equal(registry.missing([{ ...requirement, family: "DejaVu Sans Narrow" }]).length, 1);
    // A valid one-face TTC fixture adjusts absolute SFNT table offsets.
    const ttc = new Uint8Array(bytes.length + 16); ttc.set(bytes, 16);
    const v = new DataView(ttc.buffer); v.setUint32(0, 0x74746366); v.setUint32(4, 0x00010000); v.setUint32(8, 1); v.setUint32(12, 16);
    for (let i = 0; i < v.getUint16(20); i++) { const p = 16 + 12 + i * 16 + 8; v.setUint32(p, v.getUint32(p) + 16); }
    assert.equal(parseFont(ttc, "font.ttc").faces[0].family, "DejaVu Sans");
});

test("automatic local font access only queries a granted permission and reuses its catalog", async () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const queryDescriptor = Object.getOwnPropertyDescriptor(globalThis, "queryLocalFonts");
    let state: PermissionState = "prompt", queries = 0, unsupported = false;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { permissions: { query: async ({ name }: PermissionDescriptor) => {
        assert.equal(name, "local-fonts");
        if (unsupported) throw new TypeError("Unknown permission");
        return { state };
    } } } });
    Object.defineProperty(globalThis, "queryLocalFonts", { configurable: true, value: async () => { queries++; return []; } });
    try {
        const registry = new FontRegistry();
        await registry.queryLocalIfGranted();
        state = "denied";
        await registry.queryLocalIfGranted();
        assert.equal(queries, 0, "automatic conversion must not request permission");
        state = "granted"; unsupported = true;
        await registry.queryLocalIfGranted();
        assert.equal(queries, 0);
        unsupported = false;
        await registry.queryLocalIfGranted();
        await registry.queryLocalIfGranted();
        assert.equal(queries, 1, "a loaded catalog is reused for later figures");
    } finally {
        if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
        else Reflect.deleteProperty(globalThis, "navigator");
        if (queryDescriptor) Object.defineProperty(globalThis, "queryLocalFonts", queryDescriptor);
        else Reflect.deleteProperty(globalThis, "queryLocalFonts");
    }
});
