import assert from "node:assert/strict";
import { test } from "node:test";
import { figureSimilarity, matchingFigures, validFingerprint, type FigureFingerprint } from "../src/core/figure_match";
import { validSavedFigure } from "../src/save_history";
import { savePdf, type SaveHandle } from "../src/file_access";

const fingerprint = (start: number, end: number): FigureFingerprint => ({
    version: 1, aspect: 2, shapes: [1, 3, 0, 0, 1, 0, 0, 0, 0, 0],
    ink: Array.from({ length: 1024 }, (_, i) => i >= start && i < end ? 200 : 0)
});
test("minor edits match; different layouts, empty pages and different proportions do not", () => {
    const original = fingerprint(200, 600);
    assert.equal(figureSimilarity(original, original), 1);
    assert.ok(figureSimilarity(original, fingerprint(210, 610)) > 0.9);
    assert.equal(figureSimilarity(original, fingerprint(650, 1000)), 0);
    assert.equal(figureSimilarity(fingerprint(0, 0), fingerprint(0, 0)), 0);
    assert.equal(figureSimilarity(original, { ...original, aspect: 1 }), 0);
    const records = [
        { name: "unrelated.pdf", savedAt: 3, fingerprint: fingerprint(650, 1000) },
        { name: "older.pdf", savedAt: 1, fingerprint: original },
        { name: "newer.pdf", savedAt: 2, fingerprint: original }
    ];
    assert.deepEqual(matchingFigures(original, records).map(r => r.name), ["newer.pdf", "older.pdf"]);
});
test("corrupt history does not become a candidate or an executable thumbnail", () => {
    const f = fingerprint(0, 100);
    assert.equal(validFingerprint(f), true);
    assert.equal(validFingerprint({ ...f, aspect: Infinity }), false);
    assert.equal(validFingerprint({ ...f, ink: [NaN] }), false);
    const record = { id: "1", name: "a.pdf", savedAt: 1, fingerprint: f, thumbnail: "data:image/png;base64,AAAA" };
    assert.equal(validSavedFigure(record), true);
    assert.equal(validSavedFigure({ ...record, thumbnail: "data:image/svg+xml,<svg/>" }), false);
    assert.equal(validSavedFigure({ ...record, handle: {} }), false);
});
test("confirmed destinations bypass the picker; denied permission never opens a writer", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let pickerCalls = 0, writes = 0, closes = 0, aborts = 0;
    Object.defineProperty(globalThis, "window", { configurable: true, value: { showSaveFilePicker: async () => { pickerCalls++; return handle; } } });
    let permission: PermissionState = "granted";
    let fail = false;
    const handle: SaveHandle = {
        name: "same.pdf", requestPermission: async () => permission,
        createWritable: async () => ({
            write: async blob => { writes++; assert.equal(blob.type, "application/pdf"); if (fail) throw new Error("disk full"); },
            close: async () => { closes++; }, abort: async () => { aborts++; }
        })
    };
    try {
        const bytes = new Uint8Array([1, 2, 3]);
        const saved = await savePdf(bytes, "same.pdf", handle);
        assert.equal(saved.handle, handle); assert.equal(pickerCalls, 0); assert.equal(writes, 1); assert.equal(closes, 1);
        permission = "denied";
        await assert.rejects(savePdf(bytes, "same.pdf", handle), /Write access/);
        assert.equal(writes, 1);
        permission = "granted"; fail = true;
        await assert.rejects(savePdf(bytes, "same.pdf", handle), /disk full/);
        assert.equal(aborts, 1); assert.equal(closes, 1);
        fail = false;
        await savePdf(bytes, "new.pdf");
        assert.equal(pickerCalls, 1);
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
