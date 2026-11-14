import { fontKey, fontLabel, normalizeFontFamily, type FontRequirement } from "./svg";

interface Table { offset: number; length: number; }
export interface FontFaceInfo {
    readonly family: string;
    readonly aliases: readonly string[];
    readonly weight: number;
    readonly style: "normal" | "italic";
    readonly embeddingFlags: number;
    readonly faceIndex: number;
    readonly cmap: Table | undefined;
}
export interface LoadedFont {
    readonly name: string;
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly faces: readonly FontFaceInfo[];
}
interface LocalFont {
    family: string;
    fullName: string;
    postscriptName: string;
    style: string;
    blob(): Promise<Blob>;
}
const MAX_FONT_BYTES = 64 * 1024 * 1024;

export function parseFont(bytes: Uint8Array<ArrayBuffer>, name: string): LoadedFont {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const requireRange = (offset: number, length: number) => {
        if (offset < 0 || length < 0 || offset + length > view.byteLength) throw new Error(`${name}: Invalid font table bounds.`);
    };
    requireRange(0, 12);
    if (bytes.length > MAX_FONT_BYTES) throw new Error(`${name}: Font exceeds 64 MiB.`);
    let offsets = [0];
    if (view.getUint32(0) === 0x74746366) {
        const count = view.getUint32(8);
        if (!count || count > 256) throw new Error(`${name}: Invalid font collection.`);
        requireRange(12, count * 4);
        offsets = Array.from({ length: count }, (_, i) => view.getUint32(12 + i * 4));
    }
    const faces = offsets.map((offset, faceIndex): FontFaceInfo => {
        requireRange(offset, 12);
        if (![0x00010000, 0x4f54544f, 0x74727565].includes(view.getUint32(offset))) throw new Error(`${name}: Select a TTF, OTF or TTC font.`);
        const count = view.getUint16(offset + 4);
        requireRange(offset + 12, count * 16);
        const tables = new Map<string, Table>();
        for (let i = 0; i < count; i++) {
            const record = offset + 12 + i * 16;
            const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
            const table = { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) };
            requireRange(table.offset, table.length);
            tables.set(tag, table);
        }
        const nameTable = tables.get("name");
        if (!nameTable || nameTable.length < 6) throw new Error(`${name}: Font family metadata is missing.`);
        const names = new Map<number, { value: string; score: number }>();
        const aliases = new Set<string>();
        const records = view.getUint16(nameTable.offset + 2);
        const strings = nameTable.offset + view.getUint16(nameTable.offset + 4);
        if (6 + records * 12 > nameTable.length) throw new Error(`${name}: Invalid font names.`);
        for (let i = 0; i < records; i++) {
            const record = nameTable.offset + 6 + i * 12;
            const platform = view.getUint16(record);
            if (platform !== 0 && platform !== 3) continue;
            const id = view.getUint16(record + 6);
            const length = view.getUint16(record + 8);
            const start = strings + view.getUint16(record + 10);
            if (start < nameTable.offset || start + length > nameTable.offset + nameTable.length) throw new Error(`${name}: Invalid font name offset.`);
            const value = new TextDecoder("utf-16be").decode(bytes.subarray(start, start + length)).replace(/\0/g, "").trim();
            if (!value) continue;
            if (id === 1 || id === 16) aliases.add(value);
            const score = (platform === 3 ? 100 : 80) + (view.getUint16(record + 4) === 0x0409 ? 10 : 0);
            if (score > (names.get(id)?.score ?? -1)) names.set(id, { value, score });
        }
        let family = names.get(16)?.value ?? names.get(1)?.value;
        if (!family) throw new Error(`${name}: Font family could not be identified.`);
        const subfamily = names.get(17)?.value ?? names.get(2)?.value ?? "";
        // Windows groups Arial Narrow under the typographic Arial family.
        if (/\bnarrow\b/i.test(subfamily) && !/\bnarrow\b/i.test(family)) {
            family += " Narrow";
            for (const alias of [...aliases]) if (!/narrow/i.test(alias)) aliases.delete(alias);
        }
        aliases.add(family);
        const os2 = tables.get("OS/2");
        if (!os2 || os2.length < 10) throw new Error(`${name}: OS/2 embedding metadata is missing.`);
        const embeddingFlags = view.getUint16(os2.offset + 8);
        const weight = view.getUint16(os2.offset + 4);
        const italic = /italic|oblique/i.test(subfamily) || (os2.length >= 64 && !!(view.getUint16(os2.offset + 62) & 1));
        return { family, aliases: [...aliases], weight, style: italic ? "italic" : "normal", embeddingFlags, faceIndex, cmap: tables.get("cmap") };
    });
    return { name, bytes, faces };
}

export function embeddingAllowed(face: FontFaceInfo): boolean {
    return !(face.embeddingFlags & (0x0002 | 0x0100 | 0x0200));
}
function faceMatches(face: FontFaceInfo, requirement: FontRequirement): boolean {
    return face.weight === requirement.weight && face.style === requirement.style && face.aliases.some(alias => normalizeFontFamily(alias) === normalizeFontFamily(requirement.family));
}
function hasGlyph(font: LoadedFont, face: FontFaceInfo, code: number): boolean {
    if (!face.cmap) return false;
    const v = new DataView(font.bytes.buffer, font.bytes.byteOffset, font.bytes.byteLength);
    const start = face.cmap.offset;
    const end = start + face.cmap.length;
    if (start + 4 > end) return false;
    const count = v.getUint16(start + 2);
    for (let i = 0; i < count && start + 12 + i * 8 <= end; i++) {
        const entry = start + 4 + i * 8;
        const platform = v.getUint16(entry), encoding = v.getUint16(entry + 2);
        if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
        const table = start + v.getUint32(entry + 4);
        if (table + 4 > end) continue;
        const format = v.getUint16(table);
        if (format === 12 && table + 16 <= end) {
            const groups = v.getUint32(table + 12);
            if (table + 16 + groups * 12 > end) continue;
            for (let j = 0; j < groups; j++) {
                const group = table + 16 + j * 12;
                const first = v.getUint32(group), last = v.getUint32(group + 4);
                if (code >= first && code <= last && v.getUint32(group + 8) + code - first !== 0) return true;
            }
        } else if (format === 4 && code <= 0xffff && table + 16 <= end) {
            const length = v.getUint16(table + 2), segments = v.getUint16(table + 6) / 2;
            if (table + length > end || 16 + segments * 8 > length) continue;
            for (let j = 0; j < segments; j++) {
                const last = v.getUint16(table + 14 + j * 2);
                const first = v.getUint16(table + 16 + segments * 2 + j * 2);
                if (code < first || code > last) continue;
                const delta = v.getInt16(table + 16 + segments * 4 + j * 2);
                const rangePosition = table + 16 + segments * 6 + j * 2;
                const range = v.getUint16(rangePosition);
                if (!range) { if (((code + delta) & 0xffff) !== 0) return true; }
                else {
                    const glyphPosition = rangePosition + range + (code - first) * 2;
                    if (glyphPosition + 2 <= table + length) {
                        const glyph = v.getUint16(glyphPosition);
                        if (glyph && ((glyph + delta) & 0xffff) !== 0) return true;
                    }
                }
            }
        }
    }
    return false;
}

export class FontRegistry {
    private fonts: LoadedFont[] = [];
    private hashes = new Set<string>();
    private catalog: LocalFont[] | null = null;
    private totalBytes = 0;
    get loaded(): readonly LoadedFont[] { return this.fonts; }
    get hasCatalog(): boolean { return this.catalog !== null; }
    missing(requirements: readonly FontRequirement[]): FontRequirement[] {
        return requirements.filter(requirement => !this.fonts.some(font => font.faces.some(face => embeddingAllowed(face) && faceMatches(face, requirement))));
    }
    async add(file: File): Promise<void> {
        if (file.size > MAX_FONT_BYTES) throw new Error(`${file.name}: Font exceeds 64 MiB.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
        if (this.hashes.has(hash)) return;
        const font = parseFont(bytes, file.name);
        // The WASM database loads every face in a TTC, so reject the whole collection if any face is restricted.
        if (font.faces.some(face => !embeddingAllowed(face))) throw new Error(`${file.name}: Restricted, bitmap-only or no-subsetting font embedding is not supported.`);
        if (this.totalBytes + bytes.length > 256 * 1024 * 1024) throw new Error("Loaded fonts exceed 256 MiB. Reload the app to release fonts.");
        this.hashes.add(hash);
        this.fonts.push(font);
        this.totalBytes += bytes.length;
    }
    async queryLocal(): Promise<void> {
        const query = (globalThis as typeof globalThis & { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
        if (!query) throw new Error("Local fonts require Chrome / Edge on localhost or HTTPS. Select font files instead.");
        this.catalog = await query();
    }
    async resolve(requirements: readonly FontRequirement[]): Promise<string[]> {
        const errors: string[] = [];
        const attempted = new Set<string>();
        for (const requirement of this.missing(requirements)) {
            // Full-name matching handles Arial Narrow catalogued under Arial without accepting an unrelated family.
            const family = normalizeFontFamily(requirement.family);
            const candidates = (this.catalog ?? []).filter(font => normalizeFontFamily(font.family) === family || normalizeFontFamily(font.fullName).startsWith(family + " "));
            for (const candidate of candidates) {
                if (attempted.has(candidate.postscriptName)) continue;
                attempted.add(candidate.postscriptName);
                try { await this.add(new File([await candidate.blob()], candidate.postscriptName + ".ttf")); }
                catch (error) { errors.push(String(error)); }
                if (!this.missing([requirement]).length) break;
            }
        }
        return errors;
    }
    forConversion(requirements: readonly FontRequirement[]): readonly LoadedFont[] {
        const missing = this.missing(requirements);
        if (missing.length) throw new Error(`Missing fonts: ${missing.map(fontLabel).join(", ")}`);
        const selected = new Set<LoadedFont>();
        for (const requirement of requirements) {
            const font = this.fonts.find(font => font.faces.some(face => faceMatches(face, requirement)))!;
            const face = font.faces.find(face => faceMatches(face, requirement))!;
            const absent = [...new Set([...requirement.text])].filter(char => !/\s/.test(char) && !hasGlyph(font, face, char.codePointAt(0)!));
            if (absent.length) throw new Error(`${fontLabel(requirement)} is missing glyphs: ${absent.slice(0, 8).join(" ")}. Select a font containing these characters.`);
            selected.add(font);
        }
        return [...selected];
    }
    labels(): string[] { return [...new Set(this.fonts.flatMap(font => font.faces.map(fontLabel)))]; }
}
