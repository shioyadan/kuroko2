import { PDFiumLibrary } from "@hyzyla/pdfium";
import wasmUrl from "@hyzyla/pdfium/pdfium.wasm";

globalThis.onmessage = async (event: MessageEvent<{ bytes: Uint8Array }>) => {
    let library: PDFiumLibrary | undefined;
    try {
        const binary = atob(wasmUrl.slice(wasmUrl.indexOf(",") + 1));
        library = await PDFiumLibrary.init({ wasmBinary: Uint8Array.from(binary, char => char.charCodeAt(0)) });
        const document = await library.loadDocument(event.data.bytes);
        try {
            const page = document.getPage(0);
            const { originalWidth, originalHeight } = page.getOriginalSize();
            const scale = 2400 / Math.max(originalWidth, originalHeight);
            const rendered = await page.render({
                width: Math.max(1, Math.round(originalWidth * scale)),
                height: Math.max(1, Math.round(originalHeight * scale)),
                scale: 1, render: "bitmap"
            });
            globalThis.postMessage({ data: rendered.data, width: rendered.width, height: rendered.height });
        } finally { document.destroy(); }
    } catch (error) {
        globalThis.postMessage({ error: error instanceof Error ? error.message : String(error) });
    } finally { library?.destroy(); }
};

export default null as unknown as { new(): Worker };
