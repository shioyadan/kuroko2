import { matchingFigures, validFigureMemory, validFingerprint, type FigureMemory } from "./core/figure_match";
import { HistoryDatabase } from "./history_database";

export const MAX_RECENT_PROJECTS = 10;
export const MAX_OVERLEAF_HISTORY = 30;
export const MAX_PROJECT_NAME_LENGTH = 100;

export interface RecentOverleafProject {
    readonly url: string;
    readonly name: string;
}

export interface OverleafSavedFigure extends FigureMemory {
    readonly id: string;
    readonly project: string;
    readonly path: string;
    readonly oid: string;
    readonly savedAt: number;
}

const RECENT_PROJECTS = "kuroko.overleafProjects";
const database = new HistoryDatabase("kuroko.overleafHistory", "Overleaf save history");

/** Keep only a project address, never URL credentials or token parameters. */
export function canonicalProjectUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const match = /^https:\/\/(?:git@)?git\.overleaf\.com\/([a-f\d]{24})\/?$/i.exec(value.trim());
    return match ? `https://git.overleaf.com/${match[1].toLowerCase()}` : null;
}

export function projectDisplayName(value: unknown): string {
    return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, MAX_PROJECT_NAME_LENGTH) : "";
}

function normalizedProjects(values: readonly unknown[]): RecentOverleafProject[] {
    const projects = new Map<string, RecentOverleafProject>();
    for (const value of values) {
        // Older versions stored an array of URLs without display names.
        const record = value && typeof value === "object" ? value as Partial<RecentOverleafProject> : { url: value };
        const url = canonicalProjectUrl(record.url);
        if (url && !projects.has(url)) projects.set(url, { url, name: projectDisplayName("name" in record ? record.name : "") });
        if (projects.size === MAX_RECENT_PROJECTS) break;
    }
    return [...projects.values()];
}

export function readRecentProjects(): RecentOverleafProject[] {
    const raw = localStorage.getItem(RECENT_PROJECTS);
    if (!raw) return [];
    let values: unknown;
    try { values = JSON.parse(raw); } catch { return []; }
    return Array.isArray(values) ? normalizedProjects(values) : [];
}

export function writeRecentProjects(projects: readonly RecentOverleafProject[]): void {
    localStorage.setItem(RECENT_PROJECTS, JSON.stringify(normalizedProjects(projects)));
}

export function validPdfPath(value: unknown): value is string {
    return typeof value === "string" && value.length <= 1024 && /\.pdf$/i.test(value) &&
        !/[\\:\x00-\x1f\x7f\ud800-\udfff]/u.test(value) &&
        value.split("/").every(part => !!part && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
}

export function validOverleafSavedFigure(value: unknown): value is OverleafSavedFigure {
    if (!value || typeof value !== "object") return false;
    const record = value as Partial<OverleafSavedFigure>;
    return typeof record.id === "string" && record.id.length > 0 && record.id.length <= 2048 &&
        typeof record.project === "string" && canonicalProjectUrl(record.project) === record.project && validPdfPath(record.path) &&
        typeof record.oid === "string" && /^(?:[a-f\d]{40}|[a-f\d]{64})$/.test(record.oid) &&
        typeof record.savedAt === "number" && Number.isFinite(record.savedAt) && record.savedAt >= 0 &&
        validFigureMemory(record);
}

function recentFigures(values: readonly unknown[]): OverleafSavedFigure[] {
    const destinations = new Set<string>();
    return values.filter(validOverleafSavedFigure).sort((a, b) => b.savedAt - a.savedAt).filter(record => {
        const destination = JSON.stringify([record.project, record.path]);
        if (destinations.has(destination)) return false;
        destinations.add(destination);
        return true;
    }).slice(0, MAX_OVERLEAF_HISTORY);
}

export function overleafDestinationSuggestions(memory: FigureMemory | null, project: string | null,
    history: readonly OverleafSavedFigure[], files: readonly { path: string; oid: string }[]): OverleafSavedFigure[] {
    const canonical = canonicalProjectUrl(project);
    if (!memory || !validFingerprint(memory.fingerprint) || !canonical) return [];
    const current = new Map(files.map(file => [file.path, file.oid]));
    const candidates = recentFigures(history).filter(record => record.project === canonical && current.get(record.path) === record.oid);
    return matchingFigures(memory.fingerprint, candidates);
}

export async function loadOverleafHistory(): Promise<OverleafSavedFigure[]> {
    const request = await database.transaction("readonly", store => store.getAll());
    return recentFigures(request.result);
}

export async function putOverleafSavedFigure(record: OverleafSavedFigure): Promise<void> {
    if (!validOverleafSavedFigure(record)) throw new Error("Invalid Overleaf save history entry.");
    // Copy only the metadata schema, even if the caller supplies extra fields.
    const metadata: OverleafSavedFigure = {
        id: record.id, project: record.project, path: record.path, oid: record.oid, savedAt: record.savedAt,
        thumbnail: record.thumbnail,
        fingerprint: { version: 1, aspect: record.fingerprint.aspect, ink: [...record.fingerprint.ink], shapes: [...record.fingerprint.shapes] }
    };
    await database.transaction("readwrite", store => {
        store.put(metadata);
        const request = store.getAll();
        request.onsuccess = () => {
            const records = request.result;
            const distinct = records.filter(old => old.id === metadata.id || old.project !== metadata.project || old.path !== metadata.path);
            const retained = new Set(recentFigures(distinct).map(old => old.id));
            for (const old of records) if (!retained.has(old.id)) store.delete(old.id);
        };
    });
}
