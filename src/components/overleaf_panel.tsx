import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BsArrowUp, BsChevronRight, BsFileEarmarkPdf, BsFolder2 } from "react-icons/bs";
import { pdfFileName } from "../file_access";
import type { OverleafStore } from "../overleaf";
import { canonicalProjectUrl, MAX_PROJECT_NAME_LENGTH, type RecentOverleafProject } from "../overleaf_history";
import "./overleaf_panel.css";

interface Props {
    readonly store: OverleafStore;
    readonly pdf: Uint8Array<ArrayBuffer> | null;
    readonly preview: string | null;
    readonly fileName: string;
    readonly conversionBusy: boolean;
    readonly onClose: () => void;
}

function parentFolder(path: string): string { return path.slice(0, Math.max(0, path.lastIndexOf("/"))); }
function baseName(path: string): string { return path.slice(path.lastIndexOf("/") + 1); }
function inFolder(folder: string, name: string): string { return folder ? `${folder}/${name}` : name; }
function fileSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

function RecentProject({ project, busy, selected, onSelect, onRename, onForget }: {
    readonly project: RecentOverleafProject;
    readonly busy: boolean;
    readonly selected: boolean;
    readonly onSelect: () => void;
    readonly onRename: (name: string) => void;
    readonly onForget: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(project.name);
    const save = () => { onRename(name); setEditing(false); };
    return <li>
        {editing ? <>
            <div className="overleaf-project-editor">
                <input aria-label={`Project name for ${project.url}`} value={name} autoFocus autoComplete="off"
                    maxLength={MAX_PROJECT_NAME_LENGTH} disabled={busy} placeholder="Project name"
                    onChange={event => setName(event.target.value)} onKeyDown={event => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault(); event.stopPropagation(); if (!busy) save();
                        } else if (event.key === "Escape") {
                            event.preventDefault(); event.stopPropagation(); setEditing(false);
                        }
                    }} />
                <small>{project.url}</small>
            </div>
            <div className="overleaf-project-actions">
                <button type="button" disabled={busy} onClick={save}>Save name</button>
                <button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
            </div>
        </> : <>
            <button type="button" className="overleaf-project-choice" disabled={busy}
                aria-label={`Use project ${project.name || project.url}`} aria-pressed={selected} onClick={onSelect}>
                <span>{project.name || project.url}</span>
                {project.name && <small>{project.url}</small>}
            </button>
            <div className="overleaf-project-actions">
                <button type="button" disabled={busy} aria-label={`${project.name ? "Rename" : "Name"} project ${project.name || project.url}`}
                    onClick={() => { setName(project.name); setEditing(true); }}>{project.name ? "Rename" : "Name"}</button>
                <button type="button" disabled={busy} aria-label={`Forget URL for ${project.name || project.url}`}
                    onClick={onForget}>Forget URL</button>
            </div>
        </>}
    </li>;
}

export function OverleafPanel({ store, pdf, preview, fileName, conversionBusy, onClose }: Props) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [url, setUrl] = useState(state.url ?? state.recentProjects[0]?.url ?? "");
    const [folder, setFolder] = useState("");
    const [name, setName] = useState(pdfFileName(fileName));
    const [selectedPath, setSelectedPath] = useState("");
    const edited = useRef(false);
    const urlEdited = useRef(false);
    const project = useRef<string | null>(null);
    const previewRequested = useRef("");
    const savedRevision = useRef(state.savedRevision);
    const confirmation = state.confirmation;
    const locked = state.busy || !!confirmation;
    const trimmedName = name.trim();
    const destination = inFolder(folder, trimmedName && !/\.pdf$/i.test(trimmedName) ? `${trimmedName}.pdf` : trimmedName);

    useEffect(() => {
        if (state.url) setUrl(state.url);
        else if (!urlEdited.current) setUrl(state.recentProjects[0]?.url ?? "");
    }, [state.url, state.recentProjects]);
    useEffect(() => {
        if (project.current !== state.url) {
            project.current = state.url;
            edited.current = false;
            previewRequested.current = "";
            setSelectedPath("");
        }
        if (!state.url || edited.current) return;
        const suggestion = pdf && !conversionBusy ? state.suggestions[0] : undefined;
        const initialFolder = state.lastSavedPath ? parentFolder(state.lastSavedPath) : "";
        setFolder(suggestion ? parentFolder(suggestion.path) : initialFolder);
        setName(suggestion ? baseName(suggestion.path) : pdfFileName(fileName));
        setSelectedPath(suggestion?.path ?? "");
    }, [state.url, state.lastSavedPath, state.suggestions, pdf, conversionBusy, fileName]);
    useEffect(() => {
        if (!state.busy && state.savedRevision > savedRevision.current) {
            savedRevision.current = state.savedRevision;
            onClose();
        }
    }, [state.savedRevision, state.busy, onClose]);

    const childFolders = useMemo(() => {
        const prefix = folder ? `${folder}/` : "";
        const folders = new Set<string>();
        for (const path of [...state.folders, ...state.files.map(file => parentFolder(file.path))]) {
            if (path.startsWith(prefix) && path !== folder) {
                const child = path.slice(prefix.length).split("/")[0];
                if (child) folders.add(prefix + child);
            }
        }
        return [...folders].sort((a, b) => a.localeCompare(b));
    }, [folder, state.folders, state.files]);
    const visibleFiles = state.files.filter(file => parentFolder(file.path) === folder);
    const chooseFolder = (nextFolder: string) => {
        edited.current = true;
        setFolder(nextFolder);
        setSelectedPath("");
    };
    const select = (path: string) => {
        edited.current = true;
        setFolder(parentFolder(path));
        setName(baseName(path));
        setSelectedPath(path);
        const file = state.files.find(file => file.path === path);
        previewRequested.current = `${state.url}\n${path}\n${file?.oid}`;
        if (state.remote?.path !== path || state.remote.oid !== file?.oid) {
            store.dispatch({ type: "SELECT", path });
        }
    };
    const shownPath = confirmation?.path ?? (pdf && !conversionBusy ? destination : selectedPath);
    const destinationFile = state.files.find(file => file.path === shownPath);
    const remote = state.remote?.path === shownPath && state.remote.oid === destinationFile?.oid ? state.remote : null;
    const remembered = state.suggestions.find(item => item.path === shownPath && item.oid === destinationFile?.oid);
    const previousPreview = remote?.preview ?? remembered?.thumbnail;
    const uploadPreview = confirmation ? confirmation.preview : pdf && !conversionBusy ? preview : null;
    const canUpload = !!pdf && !conversionBusy && !locked && !!trimmedName && !trimmedName.endsWith("/");
    const projectName = state.recentProjects.find(recent => recent.url === canonicalProjectUrl(state.url))?.name;

    // Preview the actual destination, including an existing path typed into the name field.
    useEffect(() => {
        // A failed upload may update the file list. Keep its error visible until a user action.
        if (!state.url || !destinationFile || state.busy || state.error) return;
        const key = `${state.url}\n${destinationFile.path}\n${destinationFile.oid}`;
        if (previewRequested.current === key) return;
        previewRequested.current = key;
        if (!remote) store.dispatch({ type: "SELECT", path: destinationFile.path });
    }, [state.url, destinationFile, state.busy, state.error, remote, store]);

    return <div className="overleaf-panel"
        onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
        onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); }}>
        {state.error && <p className="overleaf-error" role="alert">{state.error}</p>}
        {state.status && <div className="overleaf-status">
            <span role="status">{state.status}</span>
            {state.busy && <button aria-label="Cancel Overleaf operation" onClick={() => store.dispatch({ type: "CANCEL" })}>Cancel</button>}
        </div>}
        {!state.historyPersistent && <p className="help-text" role="status">Recent projects and destinations are available for this session only.</p>}
        {state.available === false ? <div>
            <p>Overleaf is available when kuroko 2 is opened with its local launcher.</p>
            <p>Run <code>./kuroko2.sh</code> in your terminal, then open the URL it prints. On Windows, run the launcher in WSL.</p>
            <p className="help-text">The launcher uses Python 3 and Git. Configure Overleaf authentication in that Git installation before connecting.</p>
            <button disabled={state.busy} onClick={() => store.dispatch({ type: "INIT" })}>Check connection</button>
        </div> : state.available === null ? <p className="help-text">Checking the local launcher…</p> : !state.url ? <>
            <form onSubmit={event => {
                event.preventDefault();
                if (!state.busy && url.trim()) store.dispatch({ type: "CONNECT", url: url.trim() });
            }}>
                <p>Choose an Overleaf project to save your PDF.</p>
                <label htmlFor="overleaf-git-url">Overleaf Git URL</label>
                <input id="overleaf-git-url" type="url" required autoFocus autoComplete="off" spellCheck={false}
                    placeholder="https://git.overleaf.com/your-project-id" value={url} disabled={state.busy}
                    onChange={event => { urlEdited.current = true; setUrl(event.target.value); }} />
                <p className="help-text">Use your project’s Git URL. Authentication uses your local Git settings; do not include a token in the URL.</p>
                {state.recentProjects.length > 0 && <section className="overleaf-recent" aria-label="Recent projects">
                    <h3>Recent projects</h3>
                    <ul>{state.recentProjects.map(recent => <RecentProject key={recent.url} project={recent} busy={state.busy}
                        selected={canonicalProjectUrl(url) === recent.url}
                        onSelect={() => { urlEdited.current = true; setUrl(recent.url); }}
                        onRename={name => store.dispatch({ type: "RENAME_PROJECT", url: recent.url, name })}
                        onForget={() => {
                            if (canonicalProjectUrl(url) === recent.url) { urlEdited.current = false; setUrl(""); }
                            store.dispatch({ type: "FORGET_PROJECT", url: recent.url });
                        }} />)}</ul>
                </section>}
                <div className="overleaf-footer">
                    <button type="button" disabled={state.busy} onClick={onClose}>Cancel</button>
                    <button className="primary-button" disabled={state.busy || !url.trim()} type="submit">Connect</button>
                </div>
            </form>
        </> : <>
            <div className="overleaf-connection">
                <span title={state.url}>{projectName || state.url}{projectName && <small>{state.url}</small>}</span>
                <div className="dialog-actions">
                    <button disabled={locked} onClick={() => store.dispatch({ type: "REFRESH" })}>Refresh</button>
                    <button disabled={locked} onClick={() => store.dispatch({ type: "DISCONNECT" })}>Change project</button>
                </div>
            </div>
            {pdf && !conversionBusy && state.suggestions.length > 0 && <section className="overleaf-suggestions" aria-label="Suggested destinations">
                <h3>Suggested destinations <span className="help-text">· Similar figures you uploaded</span></h3>
                <div>{state.suggestions.map(suggestion => <button key={suggestion.id} disabled={locked}
                    aria-label={`Use suggested destination ${suggestion.path}`} aria-pressed={destination === suggestion.path}
                    onClick={() => select(suggestion.path)}>
                    <img src={suggestion.thumbnail} alt="Previously uploaded figure" draggable={false} />
                    <span>{suggestion.path}</span>
                </button>)}</div>
            </section>}
            <div className="overleaf-location">
                <button className="icon-button" disabled={locked || !folder} aria-label="Up one folder" title="Up one folder" onClick={() => chooseFolder(parentFolder(folder))}><BsArrowUp /></button>
                <nav className="overleaf-breadcrumbs" aria-label="Project folders">
                    <button disabled={locked} aria-label="Project root" onClick={() => chooseFolder("")}>Project</button>
                    {folder.split("/").filter(Boolean).map((part, index, parts) => <span key={parts.slice(0, index + 1).join("/")}>
                        <BsChevronRight aria-hidden="true" />
                        <button disabled={locked} onClick={() => chooseFolder(parts.slice(0, index + 1).join("/"))}>{part}</button>
                    </span>)}
                </nav>
            </div>
            <div className="overleaf-browser">
                <section className="overleaf-files" aria-label="Project files">
                    <div className="overleaf-file-heading"><span>Name</span><span>Size</span></div>
                    <ul aria-label="Files in current folder">
                        {childFolders.map(child => <li key={child}>
                            <button disabled={locked} aria-label={`Open folder ${child}`} onClick={() => chooseFolder(child)}>
                                <BsFolder2 className="overleaf-folder-icon" aria-hidden="true" /><span>{baseName(child)}</span><BsChevronRight aria-hidden="true" />
                            </button>
                        </li>)}
                        {visibleFiles.map(file => <li key={file.path}>
                            <button disabled={locked} onClick={() => select(file.path)} aria-label={`Select ${file.path}`} aria-pressed={selectedPath === file.path} title={file.path}>
                                <BsFileEarmarkPdf aria-hidden="true" /><span>{baseName(file.path)}</span><small>{fileSize(file.size)}</small>
                            </button>
                        </li>)}
                        {!childFolders.length && !visibleFiles.length && <li className="overleaf-empty-folder">No PDF files in this folder.</li>}
                    </ul>
                </section>
                <div className="overleaf-previews">
                    <section aria-label="Figure to upload">
                        <h3>Figure to upload</h3>
                        {uploadPreview ? <figure>
                            <div className="overleaf-preview"><img src={uploadPreview} alt="Current figure to upload" draggable={false} /></div>
                            <figcaption>{pdfFileName(fileName)}</figcaption>
                        </figure> : <div className="overleaf-preview overleaf-preview-empty">{conversionBusy ? "Creating PDF…" : "Paste a figure to upload."}</div>}
                    </section>
                    <section aria-label="Current PDF at destination">
                        <h3>Currently in Overleaf</h3>
                        <figure>
                            {previousPreview ? <div className="overleaf-preview">
                                <img src={previousPreview} alt={remote ? `First page of ${remote.path}` : `Previously uploaded ${shownPath}`} draggable={false} />
                            </div> : <div className="overleaf-preview overleaf-preview-empty">{destinationFile
                                ? state.busy ? "Loading PDF preview…" : "Preview unavailable. Select the file to try again."
                                : pdf && !!trimmedName && !trimmedName.endsWith("/") ? "Save as a new file." : "Select a PDF to preview its first page."}</div>}
                            <figcaption>{shownPath}<small>{remote ? "First page" : remembered ? "Previously uploaded preview" : ""}</small></figcaption>
                        </figure>
                        {remote && !confirmation && <button className="overleaf-download" disabled={state.busy} onClick={() => store.dispatch({ type: "DOWNLOAD" })}>Download PDF</button>}
                    </section>
                </div>
            </div>
            <form className="overleaf-save-form" aria-label="Upload current PDF" onSubmit={event => {
                event.preventDefault();
                if (canUpload && pdf) store.dispatch({ type: "PREPARE_UPLOAD", path: destination, pdf, preview });
            }}>
                <label htmlFor="overleaf-file-name">File name</label>
                <input id="overleaf-file-name" aria-label="PDF file name in project" value={name} disabled={locked || !pdf || conversionBusy}
                    required autoFocus autoComplete="off" spellCheck={false} onChange={event => {
                        edited.current = true; setName(event.target.value); setSelectedPath("");
                    }} />
                <span className="overleaf-file-type">PDF (*.pdf)</span>
                <div className="overleaf-destination">Destination: <output aria-label="Destination path">{destination || "Choose a file name"}</output></div>
                {confirmation ? <div className="overleaf-confirmation" aria-label="Confirm PDF replacement">
                    <p>Replace <code>{confirmation.path}</code> in Overleaf with this figure?</p>
                    <div className="overleaf-footer">
                        <button type="button" disabled={state.busy} onClick={() => store.dispatch({ type: "DISMISS_CONFIRM" })}>Cancel replacement</button>
                        <button type="button" className="primary-button" disabled={state.busy} onClick={() => store.dispatch({ type: "CONFIRM_UPLOAD" })}>Replace PDF</button>
                    </div>
                </div> : <>
                    <p className="help-text overleaf-save-hint">{pdf && !conversionBusy
                        ? "Choose a folder and file name. You can include a new subfolder in the file name."
                        : "Paste a figure and wait for its PDF to be ready before uploading."}</p>
                    <div className="overleaf-footer">
                        <button type="button" disabled={state.busy} onClick={onClose}>Cancel</button>
                        <button type="submit" className="primary-button" disabled={!canUpload}>Upload PDF</button>
                    </div>
                </>}
            </form>
        </>}
    </div>;
}
