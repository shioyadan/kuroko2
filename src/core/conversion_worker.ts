import { initSync, SvgPdfConverter } from "../../vendor/krilla-wasm/pkg/krilla_svg_wasm";
import wasmUrl from "../../vendor/krilla-wasm/pkg/krilla_svg_wasm_bg.wasm?inline";

// A fresh worker bounds the WASM heap to one conversion; termination also cancels pathological input.
globalThis.onmessage = (event: MessageEvent<{ svg: string; fonts: Uint8Array[] }>) => {
    let converter: SvgPdfConverter | undefined;
    try {
        const binary = atob(wasmUrl.slice(wasmUrl.indexOf(",") + 1));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        initSync({ module: bytes });
        converter = new SvgPdfConverter();
        for (const font of event.data.fonts) converter.add_font(font);
        const pdf = converter.convert(event.data.svg, true);
        globalThis.postMessage({ pdf });
    } catch (error) {
        globalThis.postMessage({ error: error instanceof Error ? error.message : String(error) });
    } finally {
        converter?.free();
    }
};

// worker-loader replaces this type-only constructor in browser builds (as in Konata).
export default null as unknown as { new(): Worker };
