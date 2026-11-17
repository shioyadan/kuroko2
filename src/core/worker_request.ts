/** Run one request in a disposable worker, bounding its heap and execution time. */
export function workerRequest<T>(create: () => Worker, input: unknown, signal: AbortSignal,
    messages: { cancelled: string; timeout: string; failed: string }): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = create();
        const finish = () => {
            clearTimeout(timeout);
            signal.removeEventListener("abort", cancel);
            worker.onmessage = worker.onerror = null;
            worker.terminate();
        };
        const cancel = () => { finish(); reject(new DOMException(messages.cancelled, "AbortError")); };
        const timeout = setTimeout(() => { finish(); reject(new Error(messages.timeout)); }, 30000);
        signal.addEventListener("abort", cancel, { once: true });
        worker.onmessage = event => {
            finish();
            if (event.data.error) reject(new Error(event.data.error));
            else resolve(event.data);
        };
        worker.onerror = event => { finish(); reject(new Error(event.message || messages.failed)); };
        try { worker.postMessage(input); }
        catch (error) { finish(); reject(error); }
    });
}
