const STORE = "figures";

/** Queue requests synchronously, then expose their results after the transaction commits. */
export class HistoryDatabase {
    constructor(private readonly name: string, private readonly label: string) {}

    private open(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.name, 1);
            let blocked = false;
            request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
            request.onsuccess = () => {
                if (blocked) { request.result.close(); return; }
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => { blocked = true; reject(new Error(`${this.label} is locked by another tab.`)); };
        });
    }

    async transaction<T>(mode: IDBTransactionMode, queue: (store: IDBObjectStore) => T): Promise<T> {
        const database = await this.open();
        try {
            const transaction = database.transaction(STORE, mode);
            const completion = new Promise<void>((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error(`${this.label} transaction failed.`));
            });
            let result: T;
            try { result = queue(transaction.objectStore(STORE)); }
            catch (error) {
                transaction.abort();
                await completion.catch(() => {});
                throw error;
            }
            await completion;
            return result;
        } finally { database.close(); }
    }
}
