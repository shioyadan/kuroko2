import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BsClipboard, BsFileEarmarkArrowDown, BsFolder2Open, BsFonts, BsInfoCircle, BsJournalText, BsCodeSlash, BsX, BsArrowsFullscreen, BsClockHistory } from "react-icons/bs";
import { Store } from "./store";
import { fontKey, fontLabel } from "./core/svg";
import { LogPane, type LogEntry, type LogLevel } from "./components/log_pane";
import { SaveSuggestion } from "./components/save_suggestion";

function editable(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input,textarea,select"));
}
function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => { ref.current?.showModal(); }, []);
    return <dialog ref={ref} className="dialog" onCancel={onClose} aria-label={title}>
        <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}><BsX /></button></header>
        <div className="dialog-body">{children}</div>
    </dialog>;
}

export function App({ store }: { store: Store }) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const svgInput = useRef<HTMLInputElement>(null);
    const fontInput = useRef<HTMLInputElement>(null);
    const officeInput = useRef<HTMLInputElement>(null);
    const previewArea = useRef<HTMLDivElement>(null);
    const [available, setAvailable] = useState({ width: 800, height: 600 });
    const [dialog, setDialog] = useState<"fonts" | "source" | "about" | "history" | null>(null);
    const [dragging, setDragging] = useState(false);
    const [logs, setLogs] = useState<readonly LogEntry[]>([]);
    const [logOpen, setLogOpen] = useState(false);
    const [unread, setUnread] = useState(0);
    const [warning, setWarning] = useState(false);
    const logOpenRef = useRef(false);
    const logID = useRef(0);
    useEffect(() => {
        const observer = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            setAvailable({ width: rect.width, height: rect.height });
        });
        observer.observe(previewArea.current!);
        return () => observer.disconnect();
    }, []);
    // Match Konata: preserve console output, mirror it into a bounded, resizable log pane.
    useEffect(() => {
        const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
        const replacements = {} as typeof original;
        for (const method of ["log", "info", "warn", "error"] as const) {
            const level: LogLevel = method === "warn" ? "warning" : method === "error" ? "error" : "info";
            replacements[method] = (...values: unknown[]) => {
                Reflect.apply(original[method], console, values);
                const message = values.map(value => value instanceof Error ? value.message : typeof value === "string" ? value : String(value)).join(" ");
                setLogs(previous => [...previous.slice(-499), { id: logID.current++, level, message }]);
                if (!logOpenRef.current) { setUnread(count => count + 1); if (level !== "info") setWarning(true); }
            };
            console[method] = replacements[method];
        }
        return () => { for (const method of ["log", "info", "warn", "error"] as const) if (console[method] === replacements[method]) console[method] = original[method]; };
    }, []);
    useEffect(() => {
        const paste = (event: ClipboardEvent) => {
            if (editable(event.target) || document.querySelector("dialog[open]")) return;
            if (event.clipboardData) { event.preventDefault(); store.dispatch({ type: "PASTE", data: event.clipboardData }); }
        };
        const keydown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                if (!document.querySelector("dialog[open]")) store.dispatch({ type: "SAVE_PDF" });
            }
        };
        window.addEventListener("paste", paste); window.addEventListener("keydown", keydown);
        return () => { window.removeEventListener("paste", paste); window.removeEventListener("keydown", keydown); };
    }, [store]);
    const toggleLog = () => {
        logOpenRef.current = !logOpenRef.current;
        setLogOpen(logOpenRef.current); setUnread(0); setWarning(false);
    };
    const documentData = state.document;
    const pageWidth = (documentData?.width ?? 800) * 72 / 96;
    const pageHeight = (documentData?.height ?? 600) * 72 / 96;
    const zoom = state.zoom === "fit" ? Math.max(0.02, Math.min((available.width - 64) / pageWidth, (available.height - 64) / pageHeight)) : state.zoom;
    const svgPreview = documentData ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(documentData.sanitized) : "";
    const missing = new Set(state.missingFonts.map(fontKey));
    const filesSelected = (input: HTMLInputElement, directory = false) => {
        store.dispatch({ type: "ADD_FONTS", files: [...(input.files ?? [])], directory }); input.value = "";
    };

    return <div className="kuroko-app" onDragStartCapture={event => {
        // Image drags and selection drags from previews must never become new input.
        if (event.target instanceof Element && event.target.closest(".preview-sheet, .suggestion-previews, .save-history-list img")) event.preventDefault();
    }} onDragOver={event => { event.preventDefault(); setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
        onDrop={event => {
            event.preventDefault(); setDragging(false);
            const file = [...event.dataTransfer.files].find(file => /\.svg$/i.test(file.name) || file.type === "image/svg+xml");
            if (file) store.dispatch({ type: "OPEN_SVG", file });
            else store.dispatch({ type: "PASTE", data: event.dataTransfer });
        }}>
        <input ref={svgInput} type="file" accept=".svg,image/svg+xml" hidden aria-label="Open SVG file" onChange={event => {
            const file = event.currentTarget.files?.[0]; if (file) store.dispatch({ type: "OPEN_SVG", file }); event.currentTarget.value = "";
        }} />
        <input ref={fontInput} type="file" accept=".ttf,.otf,.ttc,.otc" multiple hidden aria-label="Select font files" onChange={event => filesSelected(event.currentTarget)} />
        <input ref={officeInput} type="file" multiple hidden aria-label="Select Office CloudFonts folder" {...{ webkitdirectory: "" }} onChange={event => filesSelected(event.currentTarget, true)} />
        <nav className="toolbar" aria-label="Main toolbar">
            <span className="brand">kuroko 2</span>
            <button onClick={() => store.dispatch({ type: "PASTE" })} disabled={state.busy || state.saving} title="Paste Objects (Ctrl+V / ⌘V)"><BsClipboard /> <span>Paste Objects <kbd>Ctrl+V</kbd></span></button>
            <button className="save-button" onClick={() => store.dispatch({ type: "SAVE_PDF" })} disabled={!state.pdf || state.busy || state.saving} title="Save PDF (Ctrl+S / ⌘S)"><BsFileEarmarkArrowDown /> <span>Save PDF <kbd>Ctrl+S</kbd></span></button>
            <span className="toolbar-spacer" />
            <button className="icon-button" aria-label="Open SVG" title="Open SVG" onClick={() => svgInput.current?.click()}><BsFolder2Open /></button>
            <button className={`icon-button ${missing.size ? "attention" : ""}`} aria-label="Fonts" title="Fonts" onClick={() => setDialog("fonts")}><BsFonts /></button>
            <button className="icon-button" aria-label="View source SVG" title="View source SVG" disabled={!documentData} onClick={() => setDialog("source")}><BsCodeSlash /></button>
            <button className="icon-button" aria-label="Save history" title="Save history" onClick={() => setDialog("history")}><BsClockHistory /></button>
            <button className="icon-button" aria-label="About kuroko 2" title="About kuroko 2" onClick={() => setDialog("about")}><BsInfoCircle /></button>
        </nav>
        {(state.error || state.saveFailed) && <div className={`notice ${state.error ? "error" : "save-incomplete"}`} role={state.error ? "alert" : "status"}>
            {state.error || "No file was saved. If you confirmed the save dialog, try downloading the PDF instead."}
            {state.saveFailed && state.pdf && <button className="save-fallback" disabled={state.busy || state.saving} onClick={() => store.dispatch({ type: "DOWNLOAD_PDF" })}>Download PDF instead</button>}
        </div>}
        {missing.size > 0 && <div className="notice font-notice">
            <span><strong>Fonts needed for PDF</strong><br />{state.missingFonts.map(fontLabel).join(", ")}</span>
            <button disabled={state.busy} onClick={() => store.dispatch({ type: "LOCAL_FONTS" })}>Use Local Fonts</button>
            <button disabled={state.busy} onClick={() => fontInput.current?.click()}>Select Font Files…</button>
            <button onClick={() => setDialog("fonts")}>More…</button>
        </div>}
        <main ref={previewArea} className={`preview-area ${dragging ? "dragging" : ""}`} aria-label="Figure preview" aria-busy={state.busy}>
            {!documentData ? <div className="empty-state">
                <BsClipboard className="empty-icon" />
                <h1>PowerPoint → PDF</h1>
                <p>Copy a figure, then press <kbd>Ctrl+V</kbd> or <kbd>⌘V</kbd>.</p>
                <p className="subtle">Shapes and text stay sharp at any size.</p>
                <button onClick={() => svgInput.current?.click()}><BsFolder2Open /> Open an SVG file</button>
                <span className="drop-hint">or drop an SVG here</span>
            </div> : <div className="preview-sheet" style={{ width: pageWidth * zoom, height: pageHeight * zoom }}>
                <img src={state.preview ?? svgPreview} alt={state.preview ? "Generated PDF preview" : "Source SVG preview; PDF not yet generated"} draggable={false} />
                {!state.pdf && <span className="preview-label">SVG preview · PDF pending</span>}
            </div>}
            {state.busy && <div className="processing" role="status"><span className="spinner" />{state.status}<button onClick={() => store.dispatch({ type: "CANCEL" })}>Cancel</button></div>}
            {dragging && <div className="drop-overlay">Drop SVG to create a PDF</div>}
        </main>
        <div className="document-bar">
            <label>File name <input value={state.fileName} onChange={event => store.dispatch({ type: "SET_FILE_NAME", value: event.currentTarget.value })} aria-label="PDF file name" spellCheck={false} /></label>
            {documentData && <span className="dimensions">{(documentData.width * 25.4 / 96).toFixed(1)} × {(documentData.height * 25.4 / 96).toFixed(1)} mm</span>}
            <span className="toolbar-spacer" />
            <button className="icon-button" title="Fit to window" aria-label="Fit to window" onClick={() => store.dispatch({ type: "SET_ZOOM", value: "fit" })}><BsArrowsFullscreen /></button>
            <select aria-label="Preview zoom" value={state.zoom} onChange={event => store.dispatch({ type: "SET_ZOOM", value: event.target.value === "fit" ? "fit" : Number(event.target.value) })}>
                <option value="fit">Fit</option>{[0.25, 0.5, 1, 1.5, 2, 4].map(value => <option key={value} value={value}>{value * 100}%</option>)}
            </select>
        </div>
        {logOpen && <LogPane entries={logs} onClear={() => setLogs([])} onClose={toggleLog} />}
        <footer className="status-bar"><span role="status">{state.status}</span>
            <button className={warning ? "unread-warning" : ""} onClick={toggleLog} aria-expanded={logOpen}><BsJournalText /> Log{unread > 0 ? ` (${unread})` : ""}</button>
        </footer>
        {state.suggestionOpen && state.suggestions.length > 0 && state.preview && dialog === null && <Dialog title="Save matching figure" onClose={() => store.dispatch({ type: "DISMISS_SUGGESTION" })}>
            <SaveSuggestion key={state.preview} candidates={state.suggestions} currentPreview={state.preview}
                onSave={id => store.dispatch({ type: "CONFIRM_SUGGESTION", id })}
                onSaveAs={id => store.dispatch({ type: "SAVE_AS", id })}
                onDismiss={() => store.dispatch({ type: "DISMISS_SUGGESTION" })} />
        </Dialog>}
        {dialog === "history" && <Dialog title="Save history" onClose={() => setDialog(null)}>
            <label className="history-preference"><input type="checkbox" checked={state.suggestNames} onChange={event => store.dispatch({ type: "SET_SUGGEST_NAMES", value: event.currentTarget.checked })} />Suggest file names after conversion</label>
            <p className="help-text">The last 30 saved figures are remembered on this device using their names, small previews and save destinations. Full SVGs, PDFs and fonts are not stored. Download entries record a started download; the browser controls its final location and name.</p>
            {!state.historyPersistent && <p role="status">History is available for this session only because browser storage is unavailable.</p>}
            <ul className="save-history-list">{state.history.map(record => <li key={record.id}>
                <img src={record.thumbnail} alt="Saved figure thumbnail" draggable={false} />
                <span><strong>{record.name}</strong><small>{new Date(record.savedAt).toLocaleString()}</small></span>
                <button disabled={state.saving} onClick={() => store.dispatch({ type: "REMOVE_HISTORY", id: record.id })} aria-label={`Forget ${record.name}`}>Forget</button>
            </li>)}</ul>
            {!state.history.length && <p>No saved figures yet. Save a PDF to start building your history.</p>}
            <button disabled={state.saving || !state.history.length} onClick={() => store.dispatch({ type: "REMOVE_HISTORY" })}>Clear history</button>
            <p className="help-text">Forgetting history does not delete PDF files.</p>
        </Dialog>}
        {dialog === "fonts" && <Dialog title="Fonts" onClose={() => setDialog(null)}>
            <p>PDF export uses the original font files. Once local font access is allowed, the fonts needed by each figure load automatically, including after a reload.</p>
            <div className="dialog-actions">
                <button disabled={state.busy} onClick={() => store.dispatch({ type: "LOCAL_FONTS" })}>Use Local Fonts</button>
                <button disabled={state.busy} onClick={() => fontInput.current?.click()}>Select Font Files…</button>
                <button disabled={state.busy} onClick={() => officeInput.current?.click()}>Office CloudFonts…</button>
            </div>
            <p className="help-text">Local font access works in supported Chrome / Edge browsers. You can also select TTF, OTF or TTC files. For Aptos, select the CloudFonts folder under <code>%LOCALAPPDATA%\Microsoft\FontCache</code>.</p>
            <h3>Required by this figure</h3>
            {documentData?.fonts.length ? <ul className="font-list">{documentData.fonts.map(font => <li key={fontKey(font)}><span>{fontLabel(font)}</span><span className={missing.has(fontKey(font)) ? "font-missing" : "font-ready"}>{missing.has(fontKey(font)) ? "Missing" : "Ready"}</span></li>)}</ul> : <p>No text fonts required.</p>}
            <h3>Loaded fonts ({state.loadedFonts.length})</h3>
            <p>{state.loadedFonts.join(", ") || "No fonts loaded yet."}</p>
            <p className="help-text">Figures and fonts are processed on this device and are not uploaded. Save history keeps small previews and names; it does not keep font files.</p>
        </Dialog>}
        {dialog === "source" && documentData && <Dialog title="Source SVG" onClose={() => setDialog(null)}>
            <p>Original SVG from {state.source}</p>
            <textarea className="source-text" readOnly value={documentData.raw} aria-label="Original SVG source" />
            <button onClick={() => store.dispatch({ type: "SAVE_SVG" })}>Save SVG</button>
        </Dialog>}
        {dialog === "about" && <Dialog title="About kuroko 2" onClose={() => setDialog(null)}>
            <h3>kuroko 2</h3><p>Version: {__KUROKO_VERSION__}</p><p>Paste a PowerPoint figure and save a vector PDF.</p>
            <p>Build: {__KUROKO_BUILD__}</p>
            <p>Single HTML · React · krilla-svg WASM<br />All conversion runs locally in your browser.</p>
            <p className="help-text">Clipboard access depends on browser permissions and the formats supplied by PowerPoint. Open SVG is available when clipboard access is unavailable.</p>
            <details><summary>Licenses</summary><pre className="license-text">{__KUROKO_LICENSES__}</pre></details>
        </Dialog>}
    </div>;
}
