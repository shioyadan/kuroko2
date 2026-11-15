export interface SaveHandle {
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
    getFile?(): Promise<File>;
    name: string;
    requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
    isSameEntry?(other: SaveHandle): Promise<boolean>;
}
export interface SaveResult { name: string; downloaded: boolean; handle?: SaveHandle; }
type SavePicker = (options: { id: string; suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

export function downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function pdfFileName(name: string): string {
    return (name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.pdf$/i, "") || "figure") + ".pdf";
}
export async function savePdf(bytes: Uint8Array<ArrayBuffer>, name: string, previous?: SaveHandle, options: { onProgress?: (status: string) => void; downloadOnly?: boolean } = {}): Promise<SaveResult> {
    const onProgress = options.onProgress ?? (() => {});
    const blob = new Blob([bytes], { type: "application/pdf" });
    const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (options.downloadOnly || (!picker && !previous)) {
        onProgress(`Starting download: ${name}`);
        downloadBlob(blob, name);
        return { name, downloaded: true };
    }
    let stage = previous ? "requesting write permission" : "choosing a destination";
    let stream: Awaited<ReturnType<SaveHandle["createWritable"]>> | undefined;
    try {
        // Start permission/picker access in the click's call stack, before any other await.
        // Reuse a destination only after the app's explicit overwrite confirmation.
        onProgress(previous ? `Requesting write access: ${name}` : `Choose where to save: ${name}`);
        if (previous?.requestPermission && await previous.requestPermission({ mode: "readwrite" }) !== "granted") {
            throw new Error("Write access was not granted. Use Save as… to choose a destination.");
        }
        // Chrome remembers the last directory for this picker ID, independently of SVG/font pickers.
        // It also remembers a selected directory when the subsequent write fails.
        const handle = previous ?? await picker!.call(window, { id: "kuroko-pdf", suggestedName: name, types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }] });
        stage = "opening the file for writing";
        onProgress(`Opening destination: ${handle.name}`);
        stream = await handle.createWritable();
        stage = "writing the PDF";
        onProgress(`Writing PDF: ${handle.name} (${bytes.byteLength} bytes)`);
        await stream.write(blob);
        stage = "finalizing the file";
        onProgress(`Finalizing PDF: ${handle.name}`);
        await stream.close();
        stream = undefined;
        if (handle.getFile) {
            stage = "checking the saved file";
            onProgress(`Checking saved PDF: ${handle.name}`);
            const file = await handle.getFile();
            if (file.size !== bytes.byteLength || await file.slice(0, 5).text() !== "%PDF-") {
                throw new Error("The saved file does not contain the expected PDF data.");
            }
        }
        return { name: handle.name, downloaded: false, handle };
    } catch (error) {
        // A write/close AbortError is a failed save, not a cancelled picker.
        // Cleanup must not hide the original failure if abort itself fails or stalls.
        try { if (stream) void stream.abort().catch(() => {}); } catch { /* Preserve the original save failure. */ }
        if (stage === "choosing a destination" && error instanceof DOMException && error.name === "AbortError") throw error;
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        throw new Error(`PDF save failed while ${stage}: ${detail}`, { cause: error });
    }
}
