import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BsClipboard, BsFileEarmarkArrowDown, BsFolder2Open, BsFonts, BsInfoCircle, BsJournalText, BsCodeSlash, BsX, BsArrowsFullscreen, BsClockHistory, BsCloudArrowUp } from "react-icons/bs";
import { Store } from "./store";
import { fontLabel } from "./core/svg";
import { LogPane, type LogEntry, type LogLevel } from "./components/log_pane";
import { SaveSuggestion } from "./components/save_suggestion";
import { FontSetup } from "./components/font_setup";
import { ApplicationMenu } from "./components/application_menu";
import { OverleafPanel } from "./components/overleaf_panel";
import { canonicalProjectUrl } from "./overleaf_history";

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
    const overleaf = useSyncExternalStore(store.overleaf.subscribe, store.overleaf.getSnapshot);
    const svgInput = useRef<HTMLInputElement>(null);
    const fontInput = useRef<HTMLInputElement>(null);
    const fontFolderInput = useRef<HTMLInputElement>(null);
    const closeFontsWhenReady = useRef(false);
    const previewArea = useRef<HTMLDivElement>(null);
    const [available, setAvailable] = useState({ width: 800, height: 600 });
    const [dialog, setDialog] = useState<"fonts" | "source" | "about" | "history" | "overleaf" | null>(null);
    const [dragging, setDragging] = useState(false);
    const [logs, setLogs] = useState<readonly LogEntry[]>([]);
    const [logOpen, setLogOpen] = useState(false);
    const [unread, setUnread] = useState(0);
    const [warning, setWarning] = useState(false);
    const logOpenRef = useRef(false);
    const logID = useRef(0);
    useEffect(() => { store.overleaf.dispatch({ type: "PROBE" }); }, [store]);
    useEffect(() => {
        if (dialog === "fonts" && closeFontsWhenReady.current && state.pdf && !state.busy && !state.missingFonts.length) {
            closeFontsWhenReady.current = false;
            setDialog(null);
        }
    }, [dialog, state.pdf, state.busy, state.missingFonts.length]);
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
    const hasMissingFonts = state.missingFonts.length > 0;
    const openFonts = () => {
        closeFontsWhenReady.current = hasMissingFonts;
        setDialog("fonts");
    };
    const filesSelected = (input: HTMLInputElement, directory = false) => {
        store.dispatch({ type: "ADD_FONTS", files: [...(input.files ?? [])], directory }); input.value = "";
    };
    const openOverleaf = () => { setDialog("overleaf"); store.overleaf.dispatch({ type: "INIT" }); };
    const closeOverleaf = () => { store.overleaf.dispatch({ type: "DISMISS_CONFIRM" }); setDialog(null); };
    const overleafUrl = canonicalProjectUrl(overleaf.url);
    const overleafProject = overleaf.recentProjects.find(project => project.url === overleafUrl)?.name
        || (overleafUrl ? `${overleafUrl.split("/").pop()!.slice(0, 8)}…` : "");

    return <div className="kuroko-app" onDragStartCapture={event => {
        // Image drags and selection drags from previews must never become new input.
        if (event.target instanceof Element && event.target.closest(".preview-sheet, .suggestion-previews, .save-history-list img")) event.preventDefault();
    }} onDragOver={event => { event.preventDefault(); setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
        onDrop={event => {
            event.preventDefault(); setDragging(false);
            if (document.querySelector("dialog[open]")) return;
            const file = [...event.dataTransfer.files].find(file => /\.svg$/i.test(file.name) || file.type === "image/svg+xml");
            if (file) store.dispatch({ type: "OPEN_SVG", file });
            else store.dispatch({ type: "PASTE", data: event.dataTransfer });
        }}>
        <input ref={svgInput} type="file" accept=".svg,image/svg+xml" hidden aria-label="Open SVG file" onChange={event => {
            const file = event.currentTarget.files?.[0]; if (file) store.dispatch({ type: "OPEN_SVG", file }); event.currentTarget.value = "";
        }} />
        <input ref={fontInput} type="file" accept=".ttf,.otf,.ttc,.otc" multiple hidden aria-label="Select font files" onChange={event => filesSelected(event.currentTarget)} />
        <input ref={fontFolderInput} type="file" multiple hidden aria-label="Select font folder" {...{ webkitdirectory: "" }} onChange={event => filesSelected(event.currentTarget, true)} />
        <nav className="toolbar" aria-label="Main toolbar">
            <div className="toolbar-actions">
                <button onClick={() => store.dispatch({ type: "PASTE" })} disabled={state.busy || state.saving} title="Paste Objects (Ctrl+V / ⌘V)"><BsClipboard /> <span>Paste Objects <kbd>Ctrl+V</kbd></span></button>
                <button className="save-button" onClick={() => store.dispatch({ type: "SAVE_PDF" })} disabled={!state.pdf || state.busy || state.saving} title="Save PDF (Ctrl+S / ⌘S)"><BsFileEarmarkArrowDown /> <span>Save PDF <kbd>Ctrl+S</kbd></span></button>
                {overleaf.available && <div className="toolbar-overleaf">
                    <button onClick={openOverleaf} disabled={!state.pdf || state.busy || state.saving || overleaf.busy} title="Upload to Overleaf" aria-label="Upload to Overleaf"><BsCloudArrowUp /> <span>Upload to Overleaf</span></button>
                    {overleafUrl && <span className="overleaf-connection-indicator" role="status" aria-label="Overleaf connection" title={overleafUrl}>
                        <span className="connection-dot" aria-hidden="true" />
                        <span className="connection-text">Connected: {overleafProject}</span>
                    </span>}
                </div>}
            </div>
            <div className="toolbar-document">
                <div className="zoom-controls">
                    <button className="icon-button" title="Fit to window" aria-label="Fit to window" onClick={() => store.dispatch({ type: "SET_ZOOM", value: "fit" })}><BsArrowsFullscreen /></button>
                    <select aria-label="Preview zoom" value={state.zoom} onChange={event => store.dispatch({ type: "SET_ZOOM", value: event.target.value === "fit" ? "fit" : Number(event.target.value) })}>
                        <option value="fit">Fit</option>{[0.25, 0.5, 1, 1.5, 2, 4].map(value => <option key={value} value={value}>{value * 100}%</option>)}
                    </select>
                </div>
            </div>
            <span className="toolbar-spacer" />
            {overleaf.busy && <div className="toolbar-status">
                <span className="spinner" aria-hidden="true" />
                <span className="toolbar-status-text" role="status" title={overleaf.status}>{overleaf.status}</span>
                <button className="status-cancel" aria-label="Cancel Overleaf operation" title="Cancel" onClick={() => store.overleaf.dispatch({ type: "CANCEL" })}><BsX aria-hidden="true" /></button>
            </div>}
            {(state.busy || (documentData && !hasMissingFonts)) && <div className="toolbar-status">
                {state.busy ? <span className="spinner" aria-hidden="true" /> : <BsFonts aria-hidden="true" />}
                <span className="toolbar-status-text" role="status" title={state.busy ? state.status : state.syntheticBoldFonts.map(font => `${fontLabel(font)} (synthesized)`).join(", ")}>{state.busy ? state.status
                    : state.syntheticBoldFonts.length ? "Fonts ready · synthesized bold"
                    : documentData?.fonts.length ? "Fonts ready" : "No fonts needed"}</span>
                {state.busy && <button className="status-cancel" aria-label={state.fontLoading ? "Cancel font loading" : "Cancel"} title="Cancel" onClick={() => store.dispatch({ type: "CANCEL" })}><BsX aria-hidden="true" /></button>}
            </div>}
            <div className="toolbar-file">
                <input className="file-name-control" value={state.fileName} onChange={event => store.dispatch({ type: "SET_FILE_NAME", value: event.currentTarget.value })} aria-label="PDF file name" title="PDF file name" spellCheck={false} />
                <ApplicationMenu>
                    <button aria-label="Open SVG" onClick={() => svgInput.current?.click()}><BsFolder2Open aria-hidden="true" />Open SVG…</button>
                    <button className={hasMissingFonts ? "attention" : ""} onClick={openFonts}><BsFonts aria-hidden="true" />Fonts</button>
                    <button disabled={!documentData} onClick={() => setDialog("source")}><BsCodeSlash aria-hidden="true" />View source SVG</button>
                    <button onClick={() => setDialog("history")}><BsClockHistory aria-hidden="true" />Save history</button>
                    <button onClick={openOverleaf}><BsCloudArrowUp aria-hidden="true" />Overleaf…</button>
                    <button onClick={() => setDialog("about")}><BsInfoCircle aria-hidden="true" />About kuroko 2</button>
                </ApplicationMenu>
            </div>
        </nav>
        {(state.error || state.saveFailed) && <div className={`notice ${state.error ? "error" : "save-incomplete"}`} role={state.error ? "alert" : "status"}>
            {state.error || "No file was saved. If you confirmed the dialog, the browser may have blocked the destination. Try another folder or download the PDF instead."}
            {state.saveFailed && state.pdf && <button className="save-fallback" disabled={state.busy || state.saving} onClick={() => store.dispatch({ type: "DOWNLOAD_PDF" })}>Download PDF instead</button>}
        </div>}
        {documentData && hasMissingFonts && !state.fontLoading && <div className="notice font-warning" role="status">
            <span>Missing fonts: {state.missingFonts.map(fontLabel).join(", ")}. {state.pdf
                ? "The PDF uses substitute fonts and may look different. Add the missing fonts to restore the original appearance."
                : state.busy ? "Looking for substitute fonts and preparing the PDF…"
                : "Allow font access or add fonts to create the PDF."}</span>
            <button className="font-add" disabled={state.busy || state.saving} onClick={openFonts}>Add fonts…</button>
        </div>}
        <main ref={previewArea} className="preview-area" aria-label="Figure preview" aria-busy={state.busy}>
            {!documentData ? <div className="empty-state">
                <BsClipboard className="empty-icon" />
                <h1>kuroko 2</h1>
                <p className="empty-description">PowerPoint · Excel · SVG → PDF</p>
                <p>Copy a figure in PowerPoint or Excel,<br />then press <kbd>Ctrl+V</kbd> or <kbd>⌘V</kbd>.</p>
                <p className="subtle">Shapes and text stay sharp at any size.</p>
                <button onClick={() => svgInput.current?.click()}><BsFolder2Open /> Open an SVG file</button>
                <span className="drop-hint">or drop an SVG here</span>
            </div> : <div className="preview-sheet" style={{ width: pageWidth * zoom, height: pageHeight * zoom }}>
                <img src={state.preview ?? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(documentData.sanitized)}
                    alt={state.preview ? "Generated PDF preview" : "Source SVG preview; PDF not yet generated"} draggable={false} />
                {!state.pdf && <span className="preview-label">SVG preview · PDF pending</span>}
            </div>}
            {dragging && <div className="drop-overlay">Drop SVG to create a PDF</div>}
        </main>
        {logOpen && <LogPane entries={logs} onClear={() => setLogs([])} onClose={toggleLog} />}
        <footer className="status-bar"><span role="status">{state.status}</span>
            {documentData && <span className="dimensions">{(documentData.width * 25.4 / 96).toFixed(1)} × {(documentData.height * 25.4 / 96).toFixed(1)} mm</span>}
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
            <FontSetup state={state} onAllow={() => store.dispatch({ type: "ALLOW_FONT_ACCESS" })}
                onChooseFolder={() => fontFolderInput.current?.click()} onChooseFiles={() => fontInput.current?.click()} />
        </Dialog>}
        {dialog === "overleaf" && <Dialog title="Upload to Overleaf" onClose={closeOverleaf}>
            <OverleafPanel store={store.overleaf} pdf={state.pdf} preview={state.preview} fileName={state.fileName} conversionBusy={state.busy || state.saving} onClose={closeOverleaf} />
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
