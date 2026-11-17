import ConversionWorker from "./conversion_worker";
import type { LoadedFont } from "./fonts";
import type { FontRequirement, SvgDocument } from "./svg";
import { prepareSvg } from "./effects";

export async function convertSvg(document: SvgDocument, fonts: readonly LoadedFont[], signal: AbortSignal, syntheticBold: readonly FontRequirement[] = []): Promise<Uint8Array<ArrayBuffer>> {
    const prepared = await prepareSvg(document, signal, syntheticBold);
    signal.throwIfAborted();
    if (prepared.shadows) console.info(`Rasterized ${prepared.shadows} Office shadows at 150 dpi; shapes remain vector.`);
    return new Promise((resolve, reject) => {
        const worker = new ConversionWorker();
        const finish = () => { clearTimeout(timeout); signal.removeEventListener("abort", cancel); worker.terminate(); };
        const cancel = () => { finish(); reject(new DOMException("Conversion cancelled", "AbortError")); };
        const timeout = setTimeout(() => { finish(); reject(new Error("PDF conversion timed out after 30 seconds. Copy a smaller group of objects.")); }, 30000);
        signal.addEventListener("abort", cancel, { once: true });
        worker.onmessage = event => {
            finish();
            if (event.data.error) reject(new Error(event.data.error));
            else resolve(event.data.pdf);
        };
        worker.onerror = event => { finish(); reject(new Error(event.message || "The PDF conversion worker failed.")); };
        worker.postMessage({ svg: prepared.svg, fonts: fonts.map(font => font.bytes) });
    });
}
