interface SaveHandle { createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>; name: string; }
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

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
export async function savePdf(bytes: Uint8Array<ArrayBuffer>, name: string): Promise<{ name: string; downloaded: boolean }> {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (!picker) {
        downloadBlob(blob, name);
        return { name, downloaded: true };
    }
    // This call must precede the first await so Ctrl+S / Save PDF retains user activation.
    const handle = await picker({ suggestedName: name, types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }] });
    const stream = await handle.createWritable();
    try { await stream.write(blob); await stream.close(); }
    catch (error) { await stream.abort().catch(() => {}); throw error; }
    return { name: handle.name, downloaded: false };
}
