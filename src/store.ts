/** React dispatches requests synchronously; async services return through completion actions.
 * A request ID prevents cancelled/older conversions from replacing a newer figure.
 */
import { blobToText, readClipboard, readPaste, type ClipboardSvg } from "./core/clipboard";
import { convertSvg } from "./core/convert";
import { FontRegistry, parseFont } from "./core/fonts";
import { renderPdf } from "./core/pdf_preview";
import { fontLabel, normalizeFontFamily, parseSvg, type FontRequirement, type SvgDocument } from "./core/svg";
import { downloadBlob, pdfFileName, savePdf, type SaveHandle, type SaveResult } from "./file_access";
import { describeFigure, matchingFigures, type FigureMemory } from "./core/figure_match";
import { loadSaveHistory, putSavedFigure, removeSavedFigures, saveHistoryId, MAX_SAVE_HISTORY, type SavedFigure } from "./save_history";

export interface StoreSnapshot {
    readonly document: SvgDocument | null;
    readonly pdf: Uint8Array<ArrayBuffer> | null;
    readonly preview: string | null;
    readonly busy: boolean;
    readonly saving: boolean;
    readonly saveFailed: boolean;
    readonly status: string;
    readonly error: string;
    readonly missingFonts: readonly FontRequirement[];
    readonly loadedFonts: readonly string[];
    readonly autoCapture: boolean;
    readonly fileName: string;
    readonly source: string;
    readonly zoom: number | "fit";
    readonly history: readonly SavedFigure[];
    readonly suggestions: readonly SavedFigure[];
    readonly suggestionOpen: boolean;
    readonly suggestNames: boolean;
    readonly historyPersistent: boolean;
}
export type Action =
    | { type: "PASTE"; data?: DataTransfer; automatic?: boolean }
    | { type: "OPEN_SVG"; file: File }
    | { type: "CANCEL" }
    | { type: "SET_AUTO_CAPTURE"; value: boolean }
    | { type: "SET_FILE_NAME"; value: string }
    | { type: "SET_ZOOM"; value: number | "fit" }
    | { type: "LOCAL_FONTS" }
    | { type: "ADD_FONTS"; files: readonly File[]; directory?: boolean }
    | { type: "SAVE_PDF" }
    | { type: "DOWNLOAD_PDF" }
    | { type: "SAVE_SVG" }
    | { type: "CONFIRM_SUGGESTION"; id: string }
    | { type: "SAVE_AS"; id: string }
    | { type: "DISMISS_SUGGESTION" }
    | { type: "SET_SUGGEST_NAMES"; value: boolean }
    | { type: "REMOVE_HISTORY"; id?: string }
    | { type: "LOAD_FINISH"; id: number; document: SvgDocument; source: string }
    | { type: "FONTS_FINISH"; id: number }
    | { type: "CONVERT_FINISH"; id: number; bytes: Uint8Array<ArrayBuffer>; preview: string; memory: FigureMemory | null }
    | { type: "FAIL"; id: number; error: unknown; automatic?: boolean }
    | { type: "SAVE_PROGRESS"; status: string }
    | { type: "SAVE_FINISH"; result?: SaveResult; error?: unknown };

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

export class Store {
    private state: StoreSnapshot = {
        document: null, pdf: null, preview: null, busy: false, saving: false, saveFailed: false,
        status: "Copy a figure in PowerPoint, then paste it here.", error: "", missingFonts: [], loadedFonts: [],
        autoCapture: false, fileName: "figure.pdf", source: "", zoom: "fit",
        history: [], suggestions: [], suggestionOpen: false, suggestNames: true, historyPersistent: true
    };
    private readonly listeners = new Set<() => void>();
    private readonly fonts = new FontRegistry();
    private officeFiles: readonly File[] = [];
    private requestId = 0;
    private controller: AbortController | null = null;
    private memory: FigureMemory | null = null;
    private nameEdited = false;
    private promptForDocument = false;
    private readonly historyReady: Promise<void>;
    private historyQueue: Promise<void> = Promise.resolve();
    private lastSaveHandle: SaveHandle | undefined;
    constructor() {
        try { this.state = { ...this.state, suggestNames: localStorage.getItem("kuroko.suggestNames") !== "false" }; } catch {}
        this.historyReady = loadSaveHistory().then(history => {
            this.lastSaveHandle = history.find(record => record.handle)?.handle;
            this.publish({ history });
        }, error => this.historyError(error));
    }
    private historyError(error: unknown): void {
        if (this.state.historyPersistent) console.warn(`Save history is available for this session only: ${message(error)}`);
        this.publish({ historyPersistent: false });
    }
    readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    readonly getSnapshot = (): StoreSnapshot => this.state;
    private publish(patch: Partial<StoreSnapshot>): void {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(listener => listener());
    }
    private start(status: string): number {
        this.controller?.abort();
        this.controller = new AbortController();
        this.publish({ busy: true, error: "", saveFailed: false, status, suggestionOpen: false, suggestions: [] });
        return ++this.requestId;
    }

    dispatch(action: Action): void {
        if ("id" in action && typeof action.id === "number" && action.id !== this.requestId) return;
        switch (action.type) {
            case "PASTE": {
                if (this.state.saving || (action.automatic && (this.state.busy || this.state.suggestionOpen))) return;
                const id = this.start("Reading clipboard…");
                // readPaste snapshots event data now, before the event's lifetime ends.
                void this.load(action.data ? readPaste(action.data) : readClipboard(), id, action.automatic);
                break;
            }
            case "OPEN_SVG": {
                if (this.state.saving) return;
                const id = this.start("Opening SVG…");
                void this.load(blobToText(action.file).then(text => ({ text, source: action.file.name, types: [action.file.type] })), id);
                this.publish({ fileName: pdfFileName(action.file.name.replace(/\.svg$/i, "")) });
                break;
            }
            case "LOAD_FINISH":
                this.memory = null; this.nameEdited = false; this.promptForDocument = true;
                this.publish({ document: action.document, pdf: null, preview: null, source: action.source });
                action.document.warnings.forEach(warning => console.warn(warning));
                console.info(`SVG loaded: ${action.source}; ${action.document.width.toFixed(1)} × ${action.document.height.toFixed(1)} CSS px.`);
                void this.resolveAndConvert(action.id);
                break;
            case "CANCEL":
                this.controller?.abort(); this.requestId++;
                this.publish({ busy: false, status: "Cancelled.", error: "" });
                break;
            case "SET_AUTO_CAPTURE":
                this.publish({ autoCapture: action.value });
                if (action.value) this.dispatch({ type: "PASTE", automatic: true });
                break;
            case "SET_FILE_NAME": this.nameEdited = true; this.publish({ fileName: action.value }); break;
            case "SET_ZOOM": this.publish({ zoom: action.value }); break;
            case "LOCAL_FONTS": {
                if (this.state.busy) return;
                const id = this.start("Waiting for local font access…");
                void this.fonts.queryLocal().then(() => this.dispatch({ type: "FONTS_FINISH", id }), error => this.dispatch({ type: "FAIL", id, error }));
                break;
            }
            case "ADD_FONTS": {
                if (this.state.busy) return;
                const id = this.start("Reading font files…");
                if (action.directory) this.officeFiles = action.files;
                void this.addFontFiles(action.files, !!action.directory, id);
                break;
            }
            case "FONTS_FINISH":
                this.publish({ loadedFonts: this.fonts.labels() });
                void this.resolveAndConvert(action.id);
                break;
            case "CONVERT_FINISH":
                this.memory = action.memory;
                const suggestions = action.memory ? matchingFigures(action.memory.fingerprint, this.state.history) : [];
                this.publish({ busy: false, pdf: action.bytes, preview: action.preview, error: "", status: `PDF ready · ${(action.bytes.length / 1024).toFixed(1)} KiB`,
                    suggestions, suggestionOpen: this.promptForDocument && this.state.suggestNames && !this.nameEdited && suggestions.length > 0 });
                this.promptForDocument = false;
                console.info(`PDF ready: ${action.bytes.length} bytes.`);
                break;
            case "FAIL": {
                if (aborted(action.error)) { this.publish({ busy: false, status: "Cancelled." }); break; }
                const error = message(action.error);
                console.error(error);
                this.publish({ busy: false, error, status: "Could not complete the operation.", ...(action.automatic ? { autoCapture: false } : {}) });
                break;
            }
            case "SAVE_PDF":
                if (!this.state.pdf || this.state.busy || this.state.saving) return;
                if (!this.nameEdited && this.state.suggestNames && this.state.suggestions.length) this.publish({ suggestionOpen: true });
                else this.beginSave();
                break;
            case "DOWNLOAD_PDF":
                if (this.state.saveFailed) this.beginSave(undefined, false, true);
                break;
            case "CONFIRM_SUGGESTION":
            case "SAVE_AS": {
                if (!this.state.suggestionOpen || this.state.saving || this.state.busy) return;
                const record = this.state.suggestions.find(item => item.id === action.id);
                if (record) this.beginSave(record, action.type === "CONFIRM_SUGGESTION");
                break;
            }
            case "DISMISS_SUGGESTION": this.publish({ suggestionOpen: false }); break;
            case "SET_SUGGEST_NAMES":
                this.publish({ suggestNames: action.value, ...(action.value ? {} : { suggestionOpen: false }) });
                try { localStorage.setItem("kuroko.suggestNames", String(action.value)); } catch {}
                break;
            case "REMOVE_HISTORY":
                if (this.state.saving) return;
                this.historyQueue = this.historyQueue.then(async () => {
                    await this.historyReady;
                    try { await removeSavedFigures(action.id); } catch (error) { this.historyError(error); }
                    this.publish({ history: action.id ? this.state.history.filter(record => record.id !== action.id) : [], suggestions: [], suggestionOpen: false });
                });
                break;
            case "SAVE_PROGRESS":
                if (this.state.saving) { this.publish({ status: action.status }); console.info(action.status); }
                break;
            case "SAVE_FINISH":
                this.publish({ saving: false });
                if (action.result) {
                    this.publish({ fileName: action.result.name, suggestions: [], status: `${action.result.downloaded ? "Download started" : "Saved"}: ${action.result.name}` });
                    console.info(this.state.status);
                } else if (!aborted(action.error)) {
                    const error = message(action.error); console.error(error); this.publish({ error, saveFailed: true, status: "PDF was not saved." });
                } else {
                    // Chrome uses AbortError both for cancellation and an interrupted/rejected picker.
                    console.info(`Save dialog ended without a destination: ${message(action.error)}`);
                    this.publish({ saveFailed: true, status: "Save cancelled." });
                }
                break;
            case "SAVE_SVG":
                if (this.state.document) downloadBlob(new Blob([this.state.document.raw], { type: "image/svg+xml" }), pdfFileName(this.state.fileName).replace(/\.pdf$/, ".svg"));
                break;
        }
    }
    private beginSave(record?: SavedFigure, reuse = false, downloadOnly = false): void {
        if (!this.state.pdf || this.state.busy || this.state.saving) return;
        const memory = this.memory;
        const name = record?.name ?? pdfFileName(this.state.fileName);
        this.publish({ saving: true, saveFailed: false, error: "", suggestionOpen: false, fileName: name });
        // Start file access in the confirmation click's call stack; no history I/O before it.
        void savePdf(this.state.pdf, name, reuse ? record?.handle : undefined, {
            downloadOnly, startIn: this.lastSaveHandle, onProgress: status => this.dispatch({ type: "SAVE_PROGRESS", status })
        }).then(async result => {
            if (result.handle) this.lastSaveHandle = result.handle;
            console.info(`${result.downloaded ? "Download handed to the browser" : "PDF file written"}: ${result.name}`);
            if (memory) {
                this.dispatch({ type: "SAVE_PROGRESS", status: "Updating save history…" });
                this.historyQueue = this.historyQueue.then(() => this.rememberSave(memory, result, reuse ? record : undefined)).catch(error => this.historyError(error));
                await this.historyQueue;
            }
            this.dispatch({ type: "SAVE_FINISH", result });
        }, error => this.dispatch({ type: "SAVE_FINISH", error }));
    }
    private async rememberSave(memory: FigureMemory, result: SaveResult, previous?: SavedFigure): Promise<void> {
        await this.historyReady;
        let existing = previous;
        if (!existing) for (const record of this.state.history) {
            try {
                if (result.handle && record.handle && await result.handle.isSameEntry?.(record.handle)) existing = record;
                else if (!result.handle && !record.handle && result.name === record.name) existing = record;
            } catch { /* An unavailable old destination is not the same file. */ }
            if (existing) break;
        }
        const entry: SavedFigure = { ...memory, id: existing?.id ?? saveHistoryId(), name: result.name, savedAt: Date.now(), handle: result.handle };
        this.publish({ history: [entry, ...this.state.history.filter(record => record.id !== entry.id)].slice(0, MAX_SAVE_HISTORY) });
        try { await putSavedFigure(entry); } catch (error) { this.historyError(error); }
    }
    private async load(input: Promise<ClipboardSvg>, id: number, automatic = false): Promise<void> {
        try {
            const result = await input;
            if (id !== this.requestId) return;
            if (automatic && this.state.document?.raw === result.text) { this.publish({ busy: false, status: "Clipboard unchanged." }); return; }
            console.info(`Clipboard / input formats: ${result.types.join(", ") || result.source}`);
            this.dispatch({ type: "LOAD_FINISH", id, document: parseSvg(result.text), source: result.source });
        } catch (error) { this.dispatch({ type: "FAIL", id, error, automatic }); }
    }
    private async scanOfficeFiles(id: number): Promise<void> {
        const required = this.state.document?.fonts ?? [];
        for (const file of this.officeFiles) {
            if (id !== this.requestId) return;
            if (!this.fonts.missing(required).length) break;
            if (!/\.(ttf|otf|ttc|otc)$/i.test(file.name) || file.size > 64 * 1024 * 1024) continue;
            try {
                const parsed = parseFont(new Uint8Array(await file.arrayBuffer()), file.name);
                if (parsed.faces.some(face => face.aliases.some(alias => required.some(font => normalizeFontFamily(alias) === normalizeFontFamily(font.family))))) {
                    await this.fonts.add(file);
                }
            } catch (error) { console.warn(message(error)); }
        }
    }
    private async addFontFiles(files: readonly File[], directory: boolean, id: number): Promise<void> {
        try {
            if (directory) await this.scanOfficeFiles(id);
            else for (const file of files) {
                if (id !== this.requestId) return;
                try { await this.fonts.add(file); console.info(`Loaded font: ${file.name}`); }
                catch (error) { console.warn(message(error)); }
            }
            this.dispatch({ type: "FONTS_FINISH", id });
        } catch (error) { this.dispatch({ type: "FAIL", id, error }); }
    }
    private async resolveAndConvert(id: number): Promise<void> {
        const document = this.state.document;
        try {
            if (!document) { this.publish({ busy: false, status: "Fonts loaded. Paste a figure to continue." }); return; }
            if (this.fonts.missing(document.fonts).length) {
                this.publish({ status: "Loading fonts…" });
                try { await this.fonts.queryLocalIfGranted(); }
                catch (error) { console.warn(`Could not automatically load local fonts: ${message(error)}`); }
                if (id !== this.requestId) return;
            }
            if (this.fonts.hasCatalog) (await this.fonts.resolve(document.fonts)).forEach(error => console.warn(error));
            await this.scanOfficeFiles(id);
            if (id !== this.requestId) return;
            const missingFonts = this.fonts.missing(document.fonts);
            this.publish({ missingFonts, loadedFonts: this.fonts.labels(), pdf: null, preview: null });
            if (missingFonts.length) {
                console.warn(`Missing fonts: ${missingFonts.map(fontLabel).join(", ")}`);
                this.publish({ busy: false, status: "Load the missing fonts to create the PDF." });
                return;
            }
            this.publish({ status: "Creating PDF…" });
            const signal = this.controller!.signal;
            const bytes = await convertSvg(document, this.fonts.forConversion(document.fonts), signal);
            if (id !== this.requestId) return;
            this.publish({ status: "Rendering PDF preview…" });
            const preview = await renderPdf(bytes, signal);
            let memory: FigureMemory | null = null;
            try { memory = await describeFigure(document, preview); }
            catch (error) { console.warn(`Could not compare this figure with saved figures: ${message(error)}`); }
            await this.historyReady;
            this.dispatch({ type: "CONVERT_FINISH", id, bytes, preview, memory });
        } catch (error) { this.dispatch({ type: "FAIL", id, error }); }
    }
}
