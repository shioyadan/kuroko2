import type { FontSubstitution, LoadedFont } from "./fonts";
import { fontKey, inherited, SVG_MIME, SVG_NS, textFont, type SvgDocument } from "./svg";

// Change only the derived SVG. Original text, font requirements and saved source
// remain intact so adding the missing font can recreate the original appearance.
export function substituteFonts(document: SvgDocument, substitutions: readonly FontSubstitution[]): { document: SvgDocument; fonts: readonly LoadedFont[] } {
    if (!substitutions.length) return { document, fonts: [] };
    const doc = new DOMParser().parseFromString(document.sanitized, SVG_MIME);
    const root = doc.documentElement;
    const byKey = new Map(substitutions.map(substitution => [fontKey(substitution.requirement), substitution]));
    const selected = new Set<LoadedFont>();
    // Snapshot inheritance before wrapping any direct text. Nested runs may use
    // an available original font even when their parent needs a substitute.
    const runs = [...root.querySelectorAll("text,tspan,textPath")].filter(node => inherited(node, "display", "inline") !== "none")
        .map(node => ({ node, substitution: byKey.get(fontKey(textFont(node))), texts: [...node.childNodes].filter(child => child.nodeType === 3) }));
    for (const { node, substitution, texts } of runs) {
        if (!substitution) continue;
        for (const text of texts) {
            let span: Element | undefined;
            let content = "";
            let previous = substitution.defaultFont;
            for (const char of text.textContent ?? "") {
                const choice = substitution.glyphs.get(char) ?? previous;
                if (!span || choice !== previous) {
                    if (span) span.textContent = content;
                    content = "";
                    span = doc.createElementNS(SVG_NS, "tspan");
                    span.setAttribute("font-family", choice.face.family);
                    span.setAttribute("font-weight", String(choice.face.weight));
                    span.setAttribute("font-style", choice.face.style);
                    node.insertBefore(span, text);
                    selected.add(choice.font);
                }
                content += char;
                previous = choice;
            }
            if (span) span.textContent = content;
            node.removeChild(text);
        }
    }
    return { document: { ...document, sanitized: new XMLSerializer().serializeToString(root) }, fonts: [...selected] };
}
