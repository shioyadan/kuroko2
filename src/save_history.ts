import { validFigureMemory, type FigureMemory } from "./core/figure_match";
import type { SaveHandle } from "./file_access";
import { HistoryDatabase } from "./history_database";

export const MAX_SAVE_HISTORY = 30;
export interface SavedFigure extends FigureMemory {
    readonly id: string;
    readonly name: string;
    readonly savedAt: number;
    readonly handle?: SaveHandle;
}
const database = new HistoryDatabase("kuroko.saveHistory", "Save history");

export function saveHistoryId(): string {
    // randomUUID is unavailable on plain HTTP origins; getRandomValues also works there.
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function validSavedFigure(value: unknown): value is SavedFigure {
    if (!value || typeof value !== "object") return false;
    const r = value as Partial<SavedFigure>;
    return typeof r.id === "string" && typeof r.name === "string" && r.name.length > 0 && r.name.length <= 1024 &&
        typeof r.savedAt === "number" && Number.isFinite(r.savedAt) && validFigureMemory(r) &&
        (!r.handle || (typeof r.handle === "object" && typeof r.handle.createWritable === "function"));
}
export async function loadSaveHistory(): Promise<SavedFigure[]> {
    const request = await database.transaction("readonly", store => store.getAll());
    return request.result.filter(validSavedFigure).sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SAVE_HISTORY);
}
export function putSavedFigure(record: SavedFigure): Promise<void> {
    return database.transaction("readwrite", store => {
        // Native file handles are serializable. Test doubles / unsupported handles are not.
        try { store.put(record); }
        catch (error) {
            if (!(error instanceof DOMException) || error.name !== "DataCloneError") throw error;
            const { handle: _handle, ...metadata } = record;
            store.put(metadata);
        }
        const request = store.getAll();
        request.onsuccess = () => {
            const sorted = request.result.filter(validSavedFigure).sort((a, b) => b.savedAt - a.savedAt);
            for (const old of sorted.slice(MAX_SAVE_HISTORY)) store.delete(old.id);
        };
    });
}
export function removeSavedFigures(id?: string): Promise<void> {
    return database.transaction("readwrite", store => {
        if (id) store.delete(id);
        else store.clear();
    });
}
