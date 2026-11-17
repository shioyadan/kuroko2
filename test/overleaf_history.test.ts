import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_THUMBNAIL_LENGTH, type FigureFingerprint } from "../src/core/figure_match";
import { canonicalProjectUrl, MAX_PROJECT_NAME_LENGTH, MAX_RECENT_PROJECTS, overleafDestinationSuggestions, readRecentProjects,
    validOverleafSavedFigure, writeRecentProjects, type OverleafSavedFigure } from "../src/overleaf_history";

const project = "https://git.overleaf.com/0123456789abcdef01234567";
const otherProject = "https://git.overleaf.com/fedcba9876543210fedcba98";
const oid = "a".repeat(40);
const fingerprint = (start = 200, end = 600): FigureFingerprint => ({
    version: 1, aspect: 2, shapes: [1, 3, 0, 0, 1, 0, 0, 0, 0, 0],
    ink: Array.from({ length: 1024 }, (_, i) => i >= start && i < end ? 200 : 0)
});
const saved = (path = "figures/figure.pdf", patch: Partial<OverleafSavedFigure> = {}): OverleafSavedFigure => ({
    id: path, project, path, oid, savedAt: 1, thumbnail: "data:image/png;base64,AAAA", fingerprint: fingerprint(), ...patch
});

function withStorage(storage: Pick<Storage, "getItem" | "setItem">, callback: () => void): void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    try { callback(); }
    finally {
        if (previous) Object.defineProperty(globalThis, "localStorage", previous);
        else Reflect.deleteProperty(globalThis, "localStorage");
    }
}

test("project history keeps only canonical credential-free Overleaf URLs", () => {
    assert.equal(canonicalProjectUrl(project), project);
    assert.equal(canonicalProjectUrl("  https://git@git.overleaf.com/0123456789ABCDEF01234567/  "), project);
    for (const invalid of [null, {}, "", "http://git.overleaf.com/0123456789abcdef01234567", project + "?token=secret", project + "#token",
        "https://git:secret@git.overleaf.com/0123456789abcdef01234567", "https://secret@git.overleaf.com/0123456789abcdef01234567",
        "https://git.overleaf.com.evil.example/0123456789abcdef01234567", "https://www.overleaf.com/project/0123456789abcdef01234567",
        project + "/child", "https://git.overleaf.com/short", "https://git.overleaf.com/../0123456789abcdef01234567"]) {
        assert.equal(canonicalProjectUrl(invalid), null, String(invalid));
    }
});

test("recent projects preserve order, deduplicate URL forms, and bound storage", () => {
    let stored = "";
    const projects = Array.from({ length: 15 }, (_, i) => `https://git.overleaf.com/${i.toString(16).padStart(24, "0")}`);
    withStorage({ getItem: key => { assert.equal(key, "kuroko.overleafProjects"); return stored; },
        setItem: (key, value) => { assert.equal(key, "kuroko.overleafProjects"); stored = value; } }, () => {
        writeRecentProjects([project, project.replace("https://", "https://git@") + "/", "https://git:secret@git.overleaf.com/0123456789abcdef01234567", ...projects]
            .map(url => ({ url, name: "" })));
        assert.deepEqual(readRecentProjects(), [project, ...projects.slice(0, MAX_RECENT_PROJECTS - 1)].map(url => ({ url, name: "" })));
        assert.equal(stored.includes("secret"), false);
        stored = JSON.stringify([otherProject, null, { url: project }, project, otherProject]);
        assert.deepEqual(readRecentProjects(), [otherProject, project].map(url => ({ url, name: "" })));
        stored = "{invalid JSON";
        assert.deepEqual(readRecentProjects(), []);
        stored = JSON.stringify({ url: project });
        assert.deepEqual(readRecentProjects(), []);
    });
});

test("project names round-trip, migrate URL-only history, and discard unrelated metadata", () => {
    let stored = JSON.stringify([project, otherProject]);
    withStorage({ getItem: () => stored, setItem: (_key, value) => { stored = value; } }, () => {
        assert.deepEqual(readRecentProjects(), [{ url: project, name: "" }, { url: otherProject, name: "" }]);
        writeRecentProjects([{ url: project, name: "  図版 / Paper figures  " }, { url: otherProject, name: "" }]);
        assert.deepEqual(readRecentProjects(), [{ url: project, name: "図版 / Paper figures" }, { url: otherProject, name: "" }]);
        stored = JSON.stringify([{ url: project, name: "Main\nproject", token: "secret" }, { url: otherProject, name: "x".repeat(200) }]);
        writeRecentProjects(readRecentProjects());
        assert.equal(stored.includes("secret"), false);
        assert.equal(readRecentProjects()[0].name, "Main project");
        assert.equal(readRecentProjects()[1].name.length, MAX_PROJECT_NAME_LENGTH);
        stored = JSON.stringify([{ url: project, name: {} }, { url: otherProject, name: "   " }]);
        assert.deepEqual(readRecentProjects().map(value => value.name), ["", ""]);
    });
});

test("storage access failures reach the caller for a session-only fallback", () => {
    withStorage({ getItem: () => { throw new Error("blocked read"); }, setItem: () => { throw new Error("blocked write"); } }, () => {
        assert.throws(readRecentProjects, /blocked read/);
        assert.throws(() => writeRecentProjects([{ url: project, name: "Paper" }]), /blocked write/);
    });
});

test("corrupt records cannot supply unsafe paths, executable thumbnails, or unverified destinations", () => {
    const record = saved("figures/日本語 📈.PDF");
    assert.equal(validOverleafSavedFigure(record), true);
    assert.equal(validOverleafSavedFigure({ ...record, oid: "b".repeat(64) }), true);
    assert.equal(validOverleafSavedFigure({ ...record, thumbnail: "data:image/png;base64," + "A".repeat(400000) }), true);
    for (const patch of [{ id: "" }, { project: project.replace("https://", "https://git@") }, { project: project + "?token=secret" },
        { path: "../escape.pdf" }, { path: "/absolute.pdf" }, { path: "a/.git/figure.pdf" }, { path: "a\\figure.pdf" },
        { path: "C:/figure.pdf" }, { path: "a//figure.pdf" }, { path: "a/./figure.pdf" }, { path: "figure.pdf\u0000" },
        { path: "\ud800.pdf" }, { path: "file.txt" }, { oid: "a".repeat(41) }, { oid: "" }, { savedAt: NaN }, { savedAt: -1 },
        { fingerprint: { ...fingerprint(), ink: [] } }, { thumbnail: "data:image/svg+xml,<svg/>" },
        { thumbnail: "data:image/png;base64," + "A".repeat(MAX_THUMBNAIL_LENGTH) }]) {
        assert.equal(validOverleafSavedFigure({ ...record, ...patch }), false, JSON.stringify(patch));
    }
});

test("destination suggestions are confined to the current project and unchanged existing PDFs", () => {
    const memory = { fingerprint: fingerprint(210, 610), thumbnail: "data:image/png;base64,AAAA" };
    const history = [saved("figures/same.pdf"), saved("figures/other-project.pdf", { project: otherProject, savedAt: 10 }),
        saved("figures/replaced.pdf", { oid: "b".repeat(40) }), saved("figures/deleted.pdf"),
        saved("figures/unrelated.pdf", { fingerprint: fingerprint(650, 1000) })];
    const files = ["figures/same.pdf", "figures/other-project.pdf", "figures/replaced.pdf", "figures/unrelated.pdf"].map(path => ({ path, oid }));
    assert.deepEqual(overleafDestinationSuggestions(memory, project.replace("https://", "https://git@"), history, files).map(record => record.path), ["figures/same.pdf"]);
    assert.deepEqual(overleafDestinationSuggestions(memory, otherProject, history, files).map(record => record.path), ["figures/other-project.pdf"]);
    assert.deepEqual(overleafDestinationSuggestions(null, project, history, files), []);
    assert.deepEqual(overleafDestinationSuggestions(memory, null, history, files), []);
});

test("suggestions keep the newest destination record and at most three similar figures", () => {
    const history = [saved("a.pdf"), saved("a.pdf", { id: "new-a", savedAt: 6 }),
        saved("b.pdf", { savedAt: 5 }), saved("c.pdf", { savedAt: 4 }), saved("d.pdf", { savedAt: 3 }),
        saved("unsafe.pdf", { thumbnail: "data:image/svg+xml,<svg/>" })];
    const files = history.map(record => ({ path: record.path, oid: record.oid }));
    const suggestions = overleafDestinationSuggestions(saved(), project, history, files);
    assert.deepEqual(suggestions.map(record => record.path), ["a.pdf", "b.pdf", "c.pdf"]);
    assert.equal(suggestions[0].id, "new-a");
});
