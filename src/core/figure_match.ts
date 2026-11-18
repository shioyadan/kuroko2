import { type SvgDocument, SVG_MIME } from "./svg";

export interface FigureFingerprint {
    readonly version: 1;
    readonly aspect: number;
    readonly ink: readonly number[];
    readonly shapes: readonly number[];
}
export interface FigureMemory {
    readonly fingerprint: FigureFingerprint;
    readonly thumbnail: string;
}
const SHAPES = ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image", "use"];
const GRID = 32;
export const MAX_THUMBNAIL_LENGTH = 2_000_000;

// Ignore the white background, so two unrelated sparse figures do not match just
// because most of their pages are white. Compare layout rather than exact SVG IDs.
export function figureSimilarity(left: FigureFingerprint, right: FigureFingerprint): number {
    if (left.version !== 1 || right.version !== 1) return 0;
    const aspect = Math.min(left.aspect, right.aspect) / Math.max(left.aspect, right.aspect);
    if (aspect < 0.8 || left.ink.length !== GRID * GRID || right.ink.length !== GRID * GRID) return 0;
    let intersection = 0, union = 0;
    for (let i = 0; i < left.ink.length; i++) {
        intersection += Math.min(left.ink[i], right.ink[i]);
        union += Math.max(left.ink[i], right.ink[i]);
    }
    if (union < 255) return 0; // Empty/nearly empty pages are not identifiable.
    const visual = intersection / union;
    if (visual < 0.65) return 0;
    let common = 0, total = 0;
    for (let i = 0; i < SHAPES.length; i++) {
        common += Math.min(left.shapes[i] ?? 0, right.shapes[i] ?? 0);
        total += Math.max(left.shapes[i] ?? 0, right.shapes[i] ?? 0);
    }
    return 0.8 * visual + 0.15 * (total ? common / total : 1) + 0.05 * aspect;
}

export function validFingerprint(value: unknown): value is FigureFingerprint {
    if (!value || typeof value !== "object") return false;
    const f = value as Partial<FigureFingerprint>;
    const validArray = (array: unknown, length: number, max: number): boolean => Array.isArray(array) && array.length === length && array.every(n => Number.isInteger(n) && n >= 0 && n <= max);
    return f.version === 1 && typeof f.aspect === "number" && Number.isFinite(f.aspect) && f.aspect > 0 &&
        validArray(f.ink, GRID * GRID, 255) && validArray(f.shapes, SHAPES.length, 30000);
}

export function validFigureMemory(record: Partial<FigureMemory>): boolean {
    return validFingerprint(record.fingerprint) && typeof record.thumbnail === "string" &&
        record.thumbnail.length < MAX_THUMBNAIL_LENGTH && /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(record.thumbnail);
}

export async function describeFigure(svg: SvgDocument, preview: string): Promise<FigureMemory> {
    const image = new Image(); image.src = preview;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = GRID;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, GRID, GRID);
    ctx.drawImage(image, 0, 0, GRID, GRID);
    const pixels = ctx.getImageData(0, 0, GRID, GRID).data;
    const ink = Array.from({ length: GRID * GRID }, (_, i) => Math.min(255, Math.round((255 - Math.min(...pixels.slice(i * 4, i * 4 + 3))) * 2)));
    const root = new DOMParser().parseFromString(svg.sanitized, SVG_MIME);
    const shapes = SHAPES.map(tag => [...root.querySelectorAll(tag)].filter(node => !node.closest("defs,clipPath,mask,filter,pattern,marker")).length);
    let scale = Math.min(1, 1200 / image.naturalWidth, 900 / image.naturalHeight);
    let thumbnail: string;
    do {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        ctx.imageSmoothingQuality = "high";
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL("image/png");
        scale *= 0.75; // Bound storage even for photographs or noisy embedded images.
    } while (thumbnail.length >= MAX_THUMBNAIL_LENGTH);
    canvas.width = canvas.height = 0;
    return { fingerprint: { version: 1, aspect: svg.width / svg.height, ink, shapes }, thumbnail };
}

export function matchingFigures<T extends { fingerprint: FigureFingerprint; savedAt: number }>(fingerprint: FigureFingerprint, records: readonly T[]): T[] {
    return records.map(record => ({ record, score: figureSimilarity(fingerprint, record.fingerprint) }))
        .filter(match => match.score >= 0.78)
        .sort((a, b) => b.score - a.score || b.record.savedAt - a.record.savedAt)
        .slice(0, 3).map(match => match.record);
}
