import { useEffect, useState, useSyncExternalStore } from "react";
import { pdfFileName } from "../file_access";
import type { OverleafStore } from "../overleaf";
import "./overleaf_panel.css";

interface Props {
    readonly store: OverleafStore;
    readonly pdf: Uint8Array<ArrayBuffer> | null;
    readonly preview: string | null;
    readonly fileName: string;
    readonly conversionBusy: boolean;
}

function fileSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

export function OverleafPanel({ store, pdf, preview, fileName, conversionBusy }: Props) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [url, setUrl] = useState(state.url ?? "");
    const [path, setPath] = useState(`figures/${pdfFileName(fileName)}`);
    const [pathEdited, setPathEdited] = useState(false);
    const [selectedPath, setSelectedPath] = useState(state.remote?.path ?? "");
    useEffect(() => { if (state.url) setUrl(state.url); }, [state.url]);
    useEffect(() => { if (!pathEdited) setPath(`figures/${pdfFileName(fileName)}`); }, [fileName, pathEdited]);

    const confirmation = state.confirmation;
    const locked = state.busy || !!confirmation;
    const select = (nextPath: string) => {
        setSelectedPath(nextPath);
        setPath(nextPath);
        setPathEdited(true);
        store.dispatch({ type: "SELECT", path: nextPath });
    };
    return <div className="overleaf-panel"
        onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
        onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); }}>
        {state.error && <p className="overleaf-error" role="alert">{state.error}</p>}
        {state.status && <div className="overleaf-status">
            <span role="status">{state.status}</span>
            {state.busy && <button onClick={() => store.dispatch({ type: "CANCEL" })}>Cancel</button>}
        </div>}
        {state.available === false ? <div className="overleaf-launcher-help">
            <p>Overleaf is available when kuroko 2 is opened with its local launcher.</p>
            <p>Run <code>./kuroko2.sh</code> in your terminal, then open the URL it prints. On Windows, run the launcher in WSL.</p>
            <p className="help-text">The launcher uses Python 3 and Git. Configure Overleaf authentication in that Git installation before connecting.</p>
            <button disabled={state.busy} onClick={() => store.dispatch({ type: "INIT" })}>Check connection</button>
        </div> : state.available === null ? <p className="help-text">Checking the local launcher…</p> : !state.url ? <form className="overleaf-connect" onSubmit={event => {
            event.preventDefault();
            if (!state.busy && url.trim()) store.dispatch({ type: "CONNECT", url: url.trim() });
        }}>
            <p>Connect to an Overleaf project to upload your figure or preview PDF files in the project.</p>
            <label htmlFor="overleaf-git-url">Overleaf Git URL</label>
            <div className="overleaf-input-row">
                <input id="overleaf-git-url" type="url" required autoComplete="off" spellCheck={false}
                    placeholder="https://git.overleaf.com/your-project-id" value={url} disabled={state.busy}
                    onChange={event => setUrl(event.target.value)} />
                <button className="primary-button" disabled={state.busy || !url.trim()} type="submit">Connect</button>
            </div>
            <p className="help-text">Use the URL from your project’s Git settings. Authentication uses your locally configured Git credentials; do not include a token in the URL.</p>
        </form> : <>
            <div className="overleaf-connection">
                <span title={state.url}>{state.url}</span>
                <div className="dialog-actions">
                    <button disabled={locked} onClick={() => store.dispatch({ type: "REFRESH" })}>Refresh</button>
                    <button disabled={locked} onClick={() => store.dispatch({ type: "DISCONNECT" })}>Disconnect</button>
                </div>
            </div>
            <div className="overleaf-browser">
                <section className="overleaf-files" aria-label="Project PDF files">
                    <h3>Project PDFs <span className="help-text">({state.files.length})</span></h3>
                    {state.files.length ? <ul>{state.files.map(file => <li key={file.path}>
                        <button disabled={locked} onClick={() => select(file.path)} aria-pressed={selectedPath === file.path}>
                            <span>{file.path}</span><small>{fileSize(file.size)}</small>
                        </button>
                    </li>)}</ul> : <p className="help-text">No PDF files in this project yet.</p>}
                </section>
                <section className="overleaf-remote" aria-label="Project PDF preview">
                    {state.remote ? <>
                        <figure>
                            <div className="overleaf-preview"><img src={state.remote.preview} alt={`First page of ${state.remote.path}`} draggable={false} /></div>
                            <figcaption>{state.remote.path} <span>· First page</span></figcaption>
                        </figure>
                        <button disabled={state.busy} onClick={() => store.dispatch({ type: "DOWNLOAD" })}>Download PDF</button>
                    </> : <div className="overleaf-preview overleaf-preview-empty">Select a PDF to preview its first page.</div>}
                </section>
            </div>
            <p className="help-text overleaf-source-note">These are PDFs stored in the project. Overleaf’s compiled document is not included.</p>
            <section className="overleaf-upload" aria-label="Upload current PDF">
                <h3>Upload current figure</h3>
                {!pdf || conversionBusy ? <p className="help-text">Paste a figure and wait for its PDF to be ready before uploading.</p> : <>
                    <label htmlFor="overleaf-upload-path">PDF path in the project</label>
                    <form className="overleaf-input-row" onSubmit={event => {
                        event.preventDefault();
                        if (!locked && path.trim()) store.dispatch({ type: "PREPARE_UPLOAD", path: path.trim(), pdf, preview });
                    }}>
                        <input id="overleaf-upload-path" value={path} disabled={locked} required autoComplete="off" spellCheck={false}
                            onChange={event => { setPath(event.target.value); setPathEdited(true); }} placeholder="figures/figure.pdf" />
                        <button type="submit" className="primary-button" disabled={locked || !path.trim()}>Upload PDF</button>
                    </form>
                    {!confirmation && <p className="help-text">Select an existing PDF above to reuse its path, or enter a new path. Replacing a file requires confirmation.</p>}
                </>}
                {confirmation && <div className="overleaf-confirmation" aria-label="Confirm PDF replacement">
                    <p>Replace <code>{confirmation.path}</code> in Overleaf with this figure?</p>
                    {confirmation.preview && <figure>
                        <div className="overleaf-preview"><img src={confirmation.preview} alt="Current figure to upload" draggable={false} /></div>
                        <figcaption>Current figure</figcaption>
                    </figure>}
                    <div className="dialog-actions">
                        <button className="primary-button" disabled={state.busy} onClick={() => store.dispatch({ type: "CONFIRM_UPLOAD" })}>Replace PDF</button>
                        <button disabled={state.busy} onClick={() => store.dispatch({ type: "DISMISS_CONFIRM" })}>Cancel replacement</button>
                    </div>
                </div>}
            </section>
        </>}
    </div>;
}
