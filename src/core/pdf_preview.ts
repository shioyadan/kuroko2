import PreviewWorker from "./pdf_preview_worker";
import { workerRequest } from "./worker_request";

// PDFium supports type-1 shadings used by krilla for Office's reflected gradients.
// Keep its WASM off the UI thread and release the heap after rendering.
export async function renderPdf(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string> {
    const { data, width, height } = await workerRequest<{ data: Uint8Array; width: number; height: number }>(
        () => new PreviewWorker(), { bytes }, signal, {
        cancelled: "Preview cancelled",
        timeout: "PDF preview timed out after 30 seconds.",
        failed: "The PDF preview worker failed."
    });
    const canvas = document.createElement("canvas");
    try {
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
        return canvas.toDataURL("image/png");
    } finally { canvas.width = canvas.height = 0; }
}
