import { MAX_SVG_BYTES, SVG_MIME } from "./svg";
export interface ClipboardSvg { text: string; source: string; types: readonly string[]; }

export async function blobToText(blob: Blob): Promise<string> {
    if (blob.size > MAX_SVG_BYTES) throw new Error("SVG exceeds the 20 MiB limit.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    return new TextDecoder(encoding).decode(bytes).replace(/\0+$/, "");
}
function extract(text: string, type: string): string {
    if (type === SVG_MIME) return text.trim() ? text : "";
    if (type === "text/plain") return /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text) ? text : "";
    if (type === "text/html" && text) {
        const svg = new DOMParser().parseFromString(text, "text/html").querySelector("svg");
        return svg ? new XMLSerializer().serializeToString(svg) : "";
    }
    return "";
}
export async function readClipboard(): Promise<ClipboardSvg> {
    if (!navigator.clipboard?.read) throw new Error("Clipboard access is unavailable. Use Ctrl+V or open an SVG file; Chrome / Edge on localhost or HTTPS supports Paste Objects.");
    const items = await navigator.clipboard.read();
    const types = [...new Set(items.flatMap(item => [...item.types]))];
    for (const type of [SVG_MIME, "text/html", "text/plain"]) {
        for (const item of items) {
            if (!item.types.includes(type)) continue;
            const text = extract(await blobToText(await item.getType(type)), type);
            if (text) return { text, source: `${type} (Clipboard API)`, types };
        }
    }
    throw new Error(`No SVG on the clipboard. Copy the figure in PowerPoint again. Available formats: ${types.join(", ") || "none"}`);
}

// Read all event-owned data synchronously: browsers clear DataTransfer after the paste handler returns.
export function readPaste(data: DataTransfer): Promise<ClipboardSvg> {
    const types = [...data.types];
    const strings = [SVG_MIME, "text/html", "text/plain"].map(type => ({ type, text: extract(data.getData(type), type) }));
    const direct = strings.find(item => item.text);
    if (direct) return Promise.resolve({ text: direct.text, source: direct.type, types });
    const files = [...data.files].filter(file => file.type === SVG_MIME || /\.svg$/i.test(file.name));
    const items = [...data.items].filter(item => item.type === SVG_MIME);
    const pending = items.map(item => item.kind === "file"
        ? (item.getAsFile() ? blobToText(item.getAsFile()!) : Promise.resolve(""))
        : new Promise<string>(resolve => {
            const timeout = setTimeout(() => resolve(""), 200);
            item.getAsString(text => { clearTimeout(timeout); resolve(text); });
        }));
    // Chromium may advertise image/svg+xml but return empty event data. Start while user activation is live.
    const fallback = types.includes(SVG_MIME) ? readClipboard().then(value => ({ value }), error => ({ error })) : null;
    return (async () => {
        for (const file of files) {
            const text = await blobToText(file);
            if (text.trim()) return { text, source: `${SVG_MIME} (file)`, types };
        }
        for (const promise of pending) {
            const text = await promise;
            if (text.trim()) return { text, source: SVG_MIME, types };
        }
        if (fallback) {
            const result = await fallback;
            if ("value" in result) return result.value;
            throw result.error;
        }
        throw new Error(`No SVG on the clipboard. Available formats: ${types.join(", ") || "none"}. Copy a PowerPoint figure or open an SVG file.`);
    })();
}
