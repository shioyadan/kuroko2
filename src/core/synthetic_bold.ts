import { fontKey, inherited, SVG_NS, textFont, type FontRequirement } from "./svg";

// PowerPoint's reference PDF uses Cambria Math Regular with fill-and-stroke:
// 0.33257 pt at 11.64 pt, i.e. 1/35 em, miter joins and miter limit 10.
// Use that thickness for all families while keeping selectable text. It is an
// approximation; native synthesis and grid fitting can vary between fonts.
const BOLD_STROKE_EM = 1 / 35;

export function applySyntheticBold(root: Element, requirements: readonly FontRequirement[]): void {
    if (!requirements.length) return;
    const keys = new Set(requirements.map(fontKey));
    // Snapshot original inheritance before adding spans. Wrap direct text only:
    // normal-weight children/siblings must not inherit the synthetic stroke.
    const runs = [...root.querySelectorAll("text,tspan,textPath")].filter(node =>
        [...node.childNodes].some(child => child.nodeType === 3 && child.textContent?.trim()) &&
        inherited(node, "display", "inline") !== "none" && keys.has(fontKey(textFont(node)))
    ).map(node => ({
        node,
        texts: [...node.childNodes].filter(child => child.nodeType === 3 && child.textContent?.length),
        fill: inherited(node, "fill", "black"),
        fillOpacity: inherited(node, "fill-opacity", "1"),
        stroke: inherited(node, "stroke", "none")
    }));
    for (const { node, texts, fill, fillOpacity, stroke } of runs) {
        if (stroke !== "none") throw new Error("Synthesized bold with an existing text outline is not supported. Use a regular weight or convert that text to paths in the source figure.");
        for (const text of texts) {
            const span = root.ownerDocument.createElementNS(SVG_NS, "tspan");
            span.setAttribute("font-weight", "400");
            span.setAttribute("stroke", fill);
            span.setAttribute("stroke-opacity", fillOpacity);
            span.setAttribute("stroke-width", `${BOLD_STROKE_EM}em`);
            span.setAttribute("stroke-linejoin", "miter");
            span.setAttribute("stroke-miterlimit", "10");
            span.setAttribute("stroke-dasharray", "none");
            node.replaceChild(span, text);
            span.append(text);
        }
    }
}
