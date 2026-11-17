import { renderPdf } from "./core/pdf_preview";
import { downloadBlob } from "./file_access";
import type { FigureMemory } from "./core/figure_match";
import { canonicalProjectUrl, loadOverleafHistory, MAX_OVERLEAF_HISTORY, MAX_RECENT_PROJECTS,
    overleafDestinationSuggestions, projectDisplayName, putOverleafSavedFigure, readRecentProjects, validPdfPath, writeRecentProjects,
    type OverleafSavedFigure, type RecentOverleafProject } from "./overleaf_history";

export interface OverleafFile { readonly path: string; readonly oid: string; readonly size: number }
interface Project {
    api: "kuroko-overleaf-v1";
    session: string;
    url: string | null;
    files: OverleafFile[];
    folders?: string[];
    result?: "uploaded" | "unchanged";
}
export interface OverleafSnapshot {
    readonly available: boolean | null;
    readonly url: string | null;
    readonly files: readonly OverleafFile[];
    readonly folders: readonly string[];
    readonly recentProjects: readonly RecentOverleafProject[];
    readonly historyPersistent: boolean;
    readonly suggestions: readonly OverleafSavedFigure[];
    readonly savedRevision: number;
    readonly lastSavedPath: string | null;
    readonly busy: boolean;
    readonly status: string;
    readonly error: string;
    readonly remote: { path: string; oid: string; bytes: Uint8Array<ArrayBuffer>; preview: string } | null;
    readonly confirmation: { path: string; expected: string; preview: string | null } | null;
}
type Upload = { path: string; pdf: Uint8Array<ArrayBuffer>; preview: string | null; memory: FigureMemory | null };
type Action =
    | { type: "PROBE" | "INIT" | "REFRESH" | "DISCONNECT" | "DOWNLOAD" | "CONFIRM_UPLOAD" | "DISMISS_CONFIRM" | "CANCEL" }
    | { type: "CONNECT"; url: string }
    | { type: "FORGET_PROJECT"; url: string }
    | { type: "RENAME_PROJECT"; url: string; name: string }
    | { type: "SET_FIGURE"; memory: FigureMemory | null }
    | { type: "SELECT"; path: string }
    | ({ type: "PREPARE_UPLOAD" } & Omit<Upload, "memory">);

class BridgeError extends Error {
    constructor(message: string, readonly code: string) { super(message); }
}

/** URL-only client. Credentials stay with the local Git credential helper. */
export class OverleafStore {
    private state: OverleafSnapshot = {
        available: null, url: null, files: [], folders: [], recentProjects: [], historyPersistent: true,
        suggestions: [], savedRevision: 0, lastSavedPath: null,
        busy: false, status: "", error: "", remote: null, confirmation: null
    };
    private session = "";
    private operation: { id: string; controller: AbortController; rendering: boolean } | null = null;
    private pendingUpload: Upload | null = null;
    private figure: FigureMemory | null = null;
    private history: readonly OverleafSavedFigure[] = [];
    private historyReady: Promise<void> | null = null;
    private probing: Promise<void> | null = null;
    private readonly listeners = new Set<() => void>();
    constructor(private readonly onSaved: (status: string) => void = () => {}) {}
    readonly getSnapshot = (): OverleafSnapshot => this.state;
    readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    private publish(patch: Partial<OverleafSnapshot>): void {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(listener => listener());
    }
    private historyError(error: unknown): void {
        if (this.state.historyPersistent) console.warn(`Overleaf history is available for this session only: ${error instanceof Error ? error.message : String(error)}`);
        this.publish({ historyPersistent: false });
    }
    private updateSuggestions(): void {
        const project = canonicalProjectUrl(this.state.url);
        this.publish({ suggestions: overleafDestinationSuggestions(this.figure, this.state.url, this.history, this.state.files),
            lastSavedPath: this.history.find(record => record.project === project)?.path ?? null });
    }
    private ensureHistory(): Promise<void> {
        if (!this.historyReady) {
            try { this.publish({ recentProjects: readRecentProjects() }); } catch (error) { this.historyError(error); }
            this.historyReady = loadOverleafHistory().then(history => {
                this.history = history;
                this.updateSuggestions();
            }, error => this.historyError(error));
        }
        return this.historyReady;
    }
    private rememberProject(url: string): void {
        const project = canonicalProjectUrl(url);
        if (!project) return;
        const existing = this.state.recentProjects.find(value => value.url === project);
        const recentProjects = [existing ?? { url: project, name: "" }, ...this.state.recentProjects.filter(value => value.url !== project)].slice(0, MAX_RECENT_PROJECTS);
        this.saveRecentProjects(recentProjects);
    }
    private saveRecentProjects(recentProjects: readonly RecentOverleafProject[]): void {
        this.publish({ recentProjects });
        try { writeRecentProjects(recentProjects); } catch (error) { this.historyError(error); }
    }
    private probe(): Promise<void> {
        if (this.probing) return this.probing;
        if (!/^https?:$/.test(location.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) {
            this.publish({ available: false, status: "Overleaf needs the local launcher.", error: "" });
            return Promise.resolve();
        }
        // This only reads local process state. Never clone/fetch a project on startup.
        this.probing = (async () => {
            try {
                this.project(await (await this.request("", {}, true)).json());
                await this.ensureHistory();
                if (this.state.url) this.rememberProject(this.state.url);
                this.publish({ status: this.state.url ? "Overleaf project connected." : "Choose an Overleaf project to continue." });
            } catch {
                this.publish({ available: false, url: null, files: [], folders: [], remote: null, suggestions: [], error: "", status: "Overleaf needs the local launcher." });
            }
        })().finally(() => { this.probing = null; });
        return this.probing;
    }
    private project(value: Project): void {
        if (value.api !== "kuroko-overleaf-v1" || typeof value.session !== "string" || !Array.isArray(value.files)) {
            throw new Error("Open the URL printed by ./kuroko2.sh to use Overleaf.");
        }
        this.session = value.session;
        const changedProject = canonicalProjectUrl(this.state.url) !== canonicalProjectUrl(value.url);
        if (changedProject) this.clearConfirmation();
        const remote = this.state.remote;
        this.publish({ available: true, url: value.url, files: value.files, folders: value.folders ?? [],
            remote: !changedProject && remote && value.files.some(file => file.path === remote.path && file.oid === remote.oid) ? remote : null });
        this.updateSuggestions();
    }
    private async request(path: string, init: RequestInit = {}, bootstrap = false): Promise<Response> {
        const response = await fetch(`/api/overleaf${path}`, {
            ...init, credentials: "same-origin", cache: "no-store",
            headers: { ...(!bootstrap ? { "X-Kuroko-Session": this.session } : {}),
                ...(this.operation ? { "X-Kuroko-Operation": this.operation.id } : {}), ...init.headers }
        });
        if (!response.ok) {
            const value = await response.json().catch(() => null) as { error?: string; code?: string } | null;
            throw new BridgeError(value?.error ?? "The local Overleaf server is unavailable. Run ./kuroko2.sh and reopen its URL.", value?.code ?? "unavailable");
        }
        return response;
    }
    private async json(path: string, body: object): Promise<Project> {
        return (await this.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    }
    private run(status: string, task: () => Promise<void>): void {
        if (this.operation) return;
        const operation = { id: crypto.randomUUID(), controller: new AbortController(), rendering: false };
        this.operation = operation;
        this.publish({ busy: true, error: "", status });
        console.info(status);
        void task().catch(async error => {
            const cancelled = (error instanceof BridgeError && error.code === "cancelled") || (error instanceof DOMException && error.name === "AbortError");
            if (cancelled) {
                this.publish({ status: "Overleaf operation cancelled. Refresh before retrying an upload.", error: "" });
                console.info(this.state.status);
            } else {
                const message = error instanceof Error ? error.message : String(error);
                this.publish({ error: message, status: "Overleaf operation failed." });
                console.error(`Overleaf: ${message}`);
            }
            // Fetch may have advanced the repository before reporting a conflict.
            // Read its current local snapshot without another network operation.
            if (this.session) {
                try { this.project(await (await this.request("", {}, true)).json()); } catch { /* Keep the useful original error. */ }
            }
        }).finally(() => {
            this.operation = null;
            this.publish({ busy: false });
        });
    }
    dispatch(action: Action): void {
        if (action.type === "SET_FIGURE") {
            this.figure = action.memory;
            this.clearConfirmation();
            this.updateSuggestions();
            return;
        }
        if (action.type === "PROBE") {
            if (this.state.available === null) void this.probe();
            return;
        }
        if (action.type === "CANCEL") {
            const operation = this.operation;
            if (!operation) return;
            operation.controller.abort();
            if (!operation.rendering) void this.json("/cancel", { operation: operation.id }).catch(error => {
                console.warn(`Could not cancel the Overleaf operation: ${error instanceof Error ? error.message : String(error)}`);
            });
            return;
        }
        if (action.type === "DISMISS_CONFIRM") { this.clearConfirmation(); return; }
        if (this.state.busy) return;
        switch (action.type) {
            case "INIT":
                this.clearConfirmation();
                this.run("Checking the local Overleaf server…", () => this.probe());
                break;
            case "FORGET_PROJECT": {
                const project = canonicalProjectUrl(action.url);
                this.saveRecentProjects(this.state.recentProjects.filter(value => value.url !== project));
                break;
            }
            case "RENAME_PROJECT": {
                const project = canonicalProjectUrl(action.url);
                this.saveRecentProjects(this.state.recentProjects.map(value => value.url === project
                    ? { ...value, name: projectDisplayName(action.name) } : value));
                break;
            }
            case "CONNECT": {
                const url = action.url.trim();
                if (!canonicalProjectUrl(url)) {
                    this.publish({ error: "Enter an Overleaf Git URL: https://git.overleaf.com/<project-id>. Do not include a token." });
                    break;
                }
                this.clearConfirmation();
                this.run("Connecting to Overleaf…", async () => {
                    await this.ensureHistory();
                    this.project(await this.json("/connect", { url }));
                    if (this.state.url) this.rememberProject(this.state.url);
                    this.publish({ remote: null, status: "Overleaf project connected." });
                    console.info("Overleaf project connected.");
                });
                break;
            }
            case "REFRESH":
                this.clearConfirmation();
                this.run("Refreshing Overleaf PDFs…", async () => {
                    this.project(await this.json("/refresh", {}));
                    this.publish({ status: "Overleaf PDF list refreshed." });
                });
                break;
            case "DISCONNECT":
                this.clearConfirmation();
                this.run("Disconnecting from Overleaf…", async () => {
                    this.project(await this.json("/disconnect", {}));
                    this.publish({ remote: null, status: "Overleaf disconnected." });
                });
                break;
            case "SELECT": {
                const file = this.state.files.find(file => file.path === action.path);
                if (!file) break;
                this.run("Opening Overleaf PDF…", async () => {
                    this.publish({ remote: null });
                    const response = await this.request(`/pdf?${new URLSearchParams({ path: file.path, oid: file.oid })}`);
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    this.operation!.rendering = true;
                    this.publish({ status: "Rendering Overleaf PDF…" });
                    const preview = await renderPdf(bytes, this.operation!.controller.signal);
                    this.publish({ remote: { ...file, bytes, preview }, status: `Overleaf: ${file.path} · first page` });
                });
                break;
            }
            case "DOWNLOAD": {
                const remote = this.state.remote;
                if (remote) downloadBlob(new Blob([remote.bytes], { type: "application/pdf" }), remote.path.split("/").pop()!);
                break;
            }
            case "PREPARE_UPLOAD": {
                if (!this.state.url) break;
                const path = action.path.trim();
                if (!validPdfPath(path)) {
                    this.publish({ error: "Enter a relative PDF path, for example figures/figure.pdf." });
                    break;
                }
                const upload = { path, pdf: action.pdf, preview: action.preview, memory: this.figure };
                const previous = this.state.files.find(file => file.path === path);
                if (previous) {
                    this.pendingUpload = upload;
                    this.publish({ confirmation: { path, expected: previous.oid, preview: action.preview }, error: "" });
                    if (this.state.remote?.oid !== previous.oid || this.state.remote.path !== path) this.dispatch({ type: "SELECT", path });
                } else this.upload(upload, "");
                break;
            }
            case "CONFIRM_UPLOAD": {
                const upload = this.pendingUpload;
                const confirmation = this.state.confirmation;
                if (upload && confirmation) this.upload(upload, confirmation.expected);
                break;
            }
        }
    }
    private clearConfirmation(): void {
        this.pendingUpload = null;
        this.publish({ confirmation: null });
    }
    private upload(upload: Upload, expected: string): void {
        const projectUrl = this.state.url;
        if (!projectUrl) return;
        this.clearConfirmation();
        this.run("Uploading PDF to Overleaf…", async () => {
            const response = await this.request(`/upload?${new URLSearchParams({ path: upload.path, expected, project: projectUrl })}`, {
                method: "POST", headers: { "Content-Type": "application/pdf" }, body: upload.pdf
            });
            const project: Project = await response.json();
            this.project(project);
            const file = project.files.find(file => file.path === upload.path);
            if (!file || (project.result !== "uploaded" && project.result !== "unchanged")) throw new Error("The upload could not be confirmed. Refresh the project before trying again.");
            await this.rememberUpload(upload, projectUrl, file.oid);
            this.publish({ status: project.result === "unchanged" ? `Already up to date: ${upload.path}` : `Uploaded to Overleaf: ${upload.path}`,
                remote: upload.preview ? { ...file, bytes: upload.pdf, preview: upload.preview } : null,
                savedRevision: this.state.savedRevision + 1 });
            console.info(this.state.status);
            this.onSaved(this.state.status);
        });
    }
    private async rememberUpload(upload: Upload, url: string, oid: string): Promise<void> {
        const project = canonicalProjectUrl(url);
        if (!upload.memory || !project) return;
        await this.ensureHistory();
        const entry: OverleafSavedFigure = { ...upload.memory, id: `${project}\n${upload.path}`, project, path: upload.path, oid, savedAt: Date.now() };
        this.history = [entry, ...this.history.filter(record => record.project !== project || record.path !== upload.path)].slice(0, MAX_OVERLEAF_HISTORY);
        this.updateSuggestions();
        try { await putOverleafSavedFigure(entry); } catch (error) { this.historyError(error); }
    }
}
