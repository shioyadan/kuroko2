import { validFingerprint, type FigureMemory } from "./core/figure_match";
import type { SaveHandle } from "./file_access";

export const MAX_SAVE_HISTORY = 30;
export interface SavedFigure extends FigureMemory {
    readonly id: string;
    readonly name: string;
    readonly savedAt: number;
    readonly handle?: SaveHandle;
}
const DATABASE = "kuroko.saveHistory";
const STORE = "figures";

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        let blocked = false;
        request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
        request.onsuccess = () => {
            if (blocked) { request.result.close(); return; }
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { blocked = true; reject(new Error("Save history is locked by another tab.")); };
    });
}
function finished(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Save history transaction failed."));
    });
}
export function validSavedFigure(value: unknown): value is SavedFigure {
    if (!value || typeof value !== "object") return false;
    const r = value as Partial<SavedFigure>;
    return typeof r.id === "string" && typeof r.name === "string" && r.name.length > 0 && r.name.length <= 1024 &&
        typeof r.savedAt === "number" && Number.isFinite(r.savedAt) && validFingerprint(r.fingerprint) &&
        typeof r.thumbnail === "string" && r.thumbnail.length < 300000 && /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(r.thumbnail) &&
        (!r.handle || (typeof r.handle === "object" && typeof r.handle.createWritable === "function"));
}
export async function loadSaveHistory(): Promise<SavedFigure[]> {
    const database = await openDatabase();
    try {
        const transaction = database.transaction(STORE, "readonly");
        const completion = finished(transaction);
        const request = transaction.objectStore(STORE).getAll();
        // The request is consumed only after transaction completion, including failures.
        await completion;
        return request.result.filter(validSavedFigure).sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SAVE_HISTORY);
    } finally { database.close(); }
}
export async function putSavedFigure(record: SavedFigure): Promise<void> {
    const database = await openDatabase();
    try {
        const transaction = database.transaction(STORE, "readwrite");
        const completion = finished(transaction);
        const store = transaction.objectStore(STORE);
        // Native file handles are serializable. Test doubles / unsupported handles are not.
        try { store.put(record); }
        catch (error) {
            if (!(error instanceof DOMException) || error.name !== "DataCloneError") { transaction.abort(); await completion.catch(() => {}); throw error; }
            const { handle: _handle, ...metadata } = record;
            store.put(metadata);
        }
        const request = store.getAll();
        request.onsuccess = () => {
            const sorted = request.result.filter(validSavedFigure).sort((a, b) => b.savedAt - a.savedAt);
            for (const old of sorted.slice(MAX_SAVE_HISTORY)) store.delete(old.id);
        };
        await completion;
    } finally { database.close(); }
}
export async function removeSavedFigures(id?: string): Promise<void> {
    const database = await openDatabase();
    try {
        const transaction = database.transaction(STORE, "readwrite");
        const completion = finished(transaction);
        if (id) transaction.objectStore(STORE).delete(id);
        else transaction.objectStore(STORE).clear();
        await completion;
    } finally { database.close(); }
}
