import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseSvgLength, normalizeFontFamily } from "../src/core/svg";
import { parseFont, embeddingAllowed, FontRegistry } from "../src/core/fonts";
import { pdfFileName } from "../src/file_access";

import { fontMetadataFixture } from "./font_fixture.cjs";

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

test("Cambria Math bold uses regular glyphs only when no exact bold face is available", async () => {
    const registry = new FontRegistry();
    const requirement = { family: "Cambria Math", weight: 700, style: "normal" as const, text: "₀₁₃" };
    assert.deepEqual(registry.missing([requirement]), [requirement]);
    assert.deepEqual(registry.syntheticBold([requirement]), []);
    await registry.add(new File([fontMetadataFixture("Cambria Math")], "math-regular.ttf"));
    assert.deepEqual(registry.missing([requirement]), []);
    assert.deepEqual(registry.syntheticBold([requirement]), [requirement]);
    assert.equal(registry.forConversion([requirement])[0].name, "math-regular.ttf");
    assert.equal(registry.syntheticBold([{ ...requirement, family: "CAMBRIA MATH_MSFontService" }]).length, 1);
    assert.deepEqual(registry.syntheticBold([{ ...requirement, weight: 400 }]), []);
    assert.throws(() => registry.forConversion([{ ...requirement, text: "\u{10ffff}" }]), /missing glyphs/);
    for (const weight of [500, 600, 800]) assert.equal(registry.missing([{ ...requirement, weight }]).length, 1);
    assert.equal(registry.missing([{ ...requirement, style: "italic" }]).length, 1);
    await registry.add(new File([fontMetadataFixture("Cambria")], "cambria-regular.ttf"));
    assert.equal(registry.missing([{ ...requirement, family: "Cambria" }]).length, 1, "regular-face fallback must not spread to other families");
    await registry.add(new File([fontMetadataFixture("Cambria Math", 700)], "math-bold.ttf"));
    assert.deepEqual(registry.syntheticBold([requirement]), []);
    assert.equal(registry.forConversion([requirement])[0].name, "math-bold.ttf", "an exact face wins even if loaded after regular");

    const restricted = new FontRegistry();
    await assert.rejects(restricted.add(new File([fontMetadataFixture("Cambria Math", 400, 2)], "restricted.ttf")), /Restricted/);
    assert.deepEqual(restricted.missing([requirement]), [requirement]);
});

test("local font resolution searches past a synthetic fallback for a real bold face", async () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const queryDescriptor = Object.getOwnPropertyDescriptor(globalThis, "queryLocalFonts");
    const regular = fontMetadataFixture("Cambria Math"), bold = fontMetadataFixture("Cambria Math", 700);
    const calls: string[] = [];
    let includeBold = true;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { permissions: { query: async () => ({ state: "granted" }) } } });
    Object.defineProperty(globalThis, "queryLocalFonts", { configurable: true, value: async () => [
        { family: "Cambria Math", fullName: "Cambria Math Regular", postscriptName: "MathRegular", style: "Regular", blob: async () => { calls.push("regular"); return new Blob([regular]); } },
        { family: "Cambria Math", fullName: "Cambria Math Bold", postscriptName: "MathBold", style: "Bold", blob: async () => { calls.push("bold"); return new Blob([bold]); } }
    ].slice(0, includeBold ? 2 : 1) });
    try {
        for (const preloadRegular of [false, true]) {
            calls.length = 0;
            const registry = new FontRegistry();
            if (preloadRegular) await registry.add(new File([regular], "manually-selected-regular.ttf"));
            await registry.ensureLocal();
            const requirement = { family: "Cambria Math", weight: 700, style: "normal" as const, text: "₀₁₃" };
            assert.deepEqual(await registry.resolve([requirement]), []);
            assert.deepEqual(calls, ["regular", "bold"]);
            assert.deepEqual(registry.syntheticBold([requirement]), []);
            assert.equal(registry.forConversion([requirement])[0].name, "MathBold.ttf");
        }
        includeBold = false; calls.length = 0;
        const registry = new FontRegistry();
        await registry.ensureLocal();
        const requirement = { family: "Cambria Math", weight: 700, style: "normal" as const, text: "₀₁₃" };
        await registry.resolve([requirement]);
        await registry.resolve([requirement]);
        assert.deepEqual(registry.syntheticBold([requirement]), [requirement]);
        assert.deepEqual(calls, ["regular"], "later pastes should reuse the already loaded regular face");
    } finally {
        if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
        else Reflect.deleteProperty(globalThis, "navigator");
        if (queryDescriptor) Object.defineProperty(globalThis, "queryLocalFonts", queryDescriptor);
        else Reflect.deleteProperty(globalThis, "queryLocalFonts");
    }
});

test("font access prompts once per session, respects gestures and denial, and reuses a granted catalog", async () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const queryDescriptor = Object.getOwnPropertyDescriptor(globalThis, "queryLocalFonts");
    let state: PermissionState = "prompt", queries = 0, gesture = false, allow = false;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userActivation: { get isActive() { return gesture; } }, permissions: { query: async ({ name }: PermissionDescriptor) => {
        assert.equal(name, "local-fonts");
        return { state };
    } } } });
    Object.defineProperty(globalThis, "queryLocalFonts", { configurable: true, value: async () => { queries++; if (allow) state = "granted"; return []; } });
    try {
        const registry = new FontRegistry();
        assert.equal(await registry.ensureLocal(), "permission");
        assert.equal(queries, 0, "no permission prompt without a live gesture");
        gesture = true;
        assert.equal(await registry.ensureLocal("never"), "permission");
        assert.equal(queries, 0, "manual file selection must not trigger another prompt");
        assert.equal(await registry.ensureLocal(), "permission");
        assert.equal(queries, 1, "first paste can request permission");
        assert.equal(await registry.ensureLocal(), "permission");
        assert.equal(queries, 1, "dismissed permission prompts must not recur on every paste");
        assert.equal(await registry.ensureLocal("explicit"), "permission");
        assert.equal(queries, 2, "the setup button can retry a dismissed prompt");
        state = "denied";
        assert.equal(await registry.ensureLocal("explicit"), "denied");
        assert.equal(queries, 2);
        state = "prompt"; allow = true;
        await Promise.all([registry.ensureLocal("explicit"), registry.ensureLocal("explicit")]);
        assert.equal(queries, 3, "concurrent requests share a single enumeration");
        assert.equal(await registry.ensureLocal(), "ready");
        assert.equal(queries, 3, "a loaded catalog is reused for later figures");
        gesture = false;
        assert.equal(await new FontRegistry().ensureLocal(), "ready");
        assert.equal(queries, 4, "granted access works without a gesture after reload");
        assert.equal(await new FontRegistry().ensureLocal("automatic", () => false), "unknown");
        assert.equal(queries, 4, "cancelled conversions cannot request fonts");
        Object.defineProperty(globalThis, "queryLocalFonts", { configurable: true, value: undefined });
        assert.equal(await new FontRegistry().ensureLocal(), "unsupported");
    } finally {
        if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
        else Reflect.deleteProperty(globalThis, "navigator");
        if (queryDescriptor) Object.defineProperty(globalThis, "queryLocalFonts", queryDescriptor);
        else Reflect.deleteProperty(globalThis, "queryLocalFonts");
    }
});
