/** React dispatches requests synchronously; async services return through completion actions.
 * A request ID prevents cancelled/older conversions from replacing a newer figure.
 */
import { blobToText, readClipboard, readPaste, type ClipboardSvg } from "./core/clipboard";
import { convertSvg } from "./core/convert";
import { FontRegistry, parseFont } from "./core/fonts";
import { renderPdf } from "./core/pdf_preview";
import { fontLabel, normalizeFontFamily, parseSvg, type FontRequirement, type SvgDocument } from "./core/svg";
import { downloadBlob, pdfFileName, savePdf } from "./file_access";

export interface StoreSnapshot {
    readonly document: SvgDocument | null;
    readonly pdf: Uint8Array<ArrayBuffer> | null;
    readonly preview: string | null;
    readonly busy: boolean;
    readonly saving: boolean;
    readonly status: string;
    readonly error: string;
    readonly missingFonts: readonly FontRequirement[];
    readonly loadedFonts: readonly string[];
    readonly autoCapture: boolean;
    readonly fileName: string;
    readonly source: string;
    readonly zoom: number | "fit";
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
    | { type: "SAVE_SVG" }
    | { type: "LOAD_FINISH"; id: number; document: SvgDocument; source: string }
    | { type: "FONTS_FINISH"; id: number }
    | { type: "CONVERT_FINISH"; id: number; bytes: Uint8Array<ArrayBuffer>; preview: string }
    | { type: "FAIL"; id: number; error: unknown; automatic?: boolean }
    | { type: "SAVE_FINISH"; result?: { name: string; downloaded: boolean }; error?: unknown };

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function aborted(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

export class Store {
    private state: StoreSnapshot = {
        document: null, pdf: null, preview: null, busy: false, saving: false,
        status: "Copy a figure in PowerPoint, then paste it here.", error: "", missingFonts: [], loadedFonts: [],
        autoCapture: false, fileName: "figure.pdf", source: "", zoom: "fit"
    };
    private readonly listeners = new Set<() => void>();
    private readonly fonts = new FontRegistry();
    private officeFiles: readonly File[] = [];
    private requestId = 0;
    private controller: AbortController | null = null;
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
        this.publish({ busy: true, error: "", status });
        return ++this.requestId;
    }

    dispatch(action: Action): void {
        if ("id" in action && action.id !== this.requestId) return;
        switch (action.type) {
            case "PASTE": {
                if (action.automatic && (this.state.busy || this.state.saving)) return;
                const id = this.start("Reading clipboard…");
                // readPaste snapshots event data now, before the event's lifetime ends.
                void this.load(action.data ? readPaste(action.data) : readClipboard(), id, action.automatic);
                break;
            }
            case "OPEN_SVG": {
                const id = this.start("Opening SVG…");
                void this.load(blobToText(action.file).then(text => ({ text, source: action.file.name, types: [action.file.type] })), id);
                this.publish({ fileName: pdfFileName(action.file.name.replace(/\.svg$/i, "")) });
                break;
            }
            case "LOAD_FINISH":
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
            case "SET_FILE_NAME": this.publish({ fileName: action.value }); break;
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
                this.publish({ busy: false, pdf: action.bytes, preview: action.preview, error: "", status: `PDF ready · ${(action.bytes.length / 1024).toFixed(1)} KiB` });
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
                this.publish({ saving: true, error: "" });
                void savePdf(this.state.pdf, pdfFileName(this.state.fileName)).then(
                    result => this.dispatch({ type: "SAVE_FINISH", result }),
                    error => this.dispatch({ type: "SAVE_FINISH", error })
                );
                break;
            case "SAVE_FINISH":
                this.publish({ saving: false });
                if (action.result) {
                    this.publish({ fileName: action.result.name, status: `${action.result.downloaded ? "Download started" : "Saved"}: ${action.result.name}` });
                    console.info(this.state.status);
                } else if (!aborted(action.error)) {
                    const error = message(action.error); console.error(error); this.publish({ error });
                } else this.publish({ status: "Save cancelled." });
                break;
            case "SAVE_SVG":
                if (this.state.document) downloadBlob(new Blob([this.state.document.raw], { type: "image/svg+xml" }), pdfFileName(this.state.fileName).replace(/\.pdf$/, ".svg"));
                break;
        }
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
            this.dispatch({ type: "CONVERT_FINISH", id, bytes, preview });
        } catch (error) { this.dispatch({ type: "FAIL", id, error }); }
    }
}
