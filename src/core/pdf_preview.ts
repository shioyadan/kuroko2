import PreviewWorker from "./pdf_preview_worker";

// PDFium supports type-1 shadings used by krilla for Office's reflected gradients.
// Keep its WASM off the UI thread and release the heap after rendering.
export function renderPdf(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new PreviewWorker();
        const finish = () => { clearTimeout(timeout); signal.removeEventListener("abort", cancel); worker.terminate(); };
        const cancel = () => { finish(); reject(new DOMException("Preview cancelled", "AbortError")); };
        const timeout = setTimeout(() => { finish(); reject(new Error("PDF preview timed out after 30 seconds.")); }, 30000);
        signal.addEventListener("abort", cancel, { once: true });
        worker.onerror = event => { finish(); reject(new Error(event.message || "The PDF preview worker failed.")); };
        worker.onmessage = event => {
            finish();
            if (event.data.error) { reject(new Error(event.data.error)); return; }
            const { data, width, height } = event.data;
            const canvas = document.createElement("canvas");
            try {
                canvas.width = width; canvas.height = height;
                canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
                resolve(canvas.toDataURL("image/png"));
            } catch (error) { reject(error); }
            finally { canvas.width = canvas.height = 0; }
        };
        worker.postMessage({ bytes });
    });
}
