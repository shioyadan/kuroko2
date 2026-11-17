import { SVG_MIME, SVG_NS, type FontRequirement, type SvgDocument } from "./svg";
import { applySyntheticBold } from "./synthetic_bold";

function isPowerPointShadow(filter: Element): boolean {
    const children = new Set([...filter.children].map(child => child.localName));
    return /^fx\d+$/i.test(filter.id) && filter.getAttribute("filterUnits") === "userSpaceOnUse" &&
        filter.getAttribute("primitiveUnits") === "userSpaceOnUse" &&
        ["x", "y", "width", "height"].every(name => /^-?(?:\d+(?:\.\d+)?|\.\d+)%$/.test(filter.getAttribute(name) ?? "")) &&
        children.has("feComponentTransfer") && children.has("feGaussianBlur");
}
function ancestors(node: Element, root: Element): Element[] {
    const result: Element[] = [];
    for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) result.unshift(parent);
    return result;
}

// Rasterize only the Office shadow nodes. Each image stays at its original z-position.
// The PoC put every shadow behind the figure; that changes overlapping objects.
export async function prepareSvg(document: SvgDocument, signal: AbortSignal, syntheticBold: readonly FontRequirement[] = []): Promise<{ svg: string; shadows: number }> {
    const doc = new DOMParser().parseFromString(document.sanitized, SVG_MIME);
    const root = doc.documentElement;
    root.setAttribute("width", String(document.width * 72 / 96));
    root.setAttribute("height", String(document.height * 72 / 96));
    applySyntheticBold(root, syntheticBold);
    const filters = [...root.querySelectorAll("filter")].filter(isPowerPointShadow);
    const ids = new Set(filters.map(filter => filter.id));
    const nodes = [...root.querySelectorAll("[filter]")].filter(node => ids.has(node.getAttribute("filter")?.match(/^url\(['"]?#([^)'"\s]+)['"]?\)$/)?.[1] ?? ""));
    const pixelWidth = Math.ceil(document.width * 150 / 96), pixelHeight = Math.ceil(document.height * 150 / 96);
    if (nodes.length > 128 || (nodes.length && pixelWidth * pixelHeight > 16000000) || nodes.length * pixelWidth * pixelHeight > 512000000) {
        throw new Error("The shadow rasterization budget was exceeded. Copy a smaller group of objects.");
    }
    const box = root.getAttribute("viewBox")!.split(/[\s,]+/).map(Number);
    let count = 0;
    for (const node of nodes) {
        signal.throwIfAborted();
        if (!root.contains(node)) continue;
        if (node.querySelector("text,tspan")) throw new Error("Office shadows containing text are not supported. Convert the shadow text to paths in the source figure.");
        node.setAttribute("data-kuroko-shadow", "selected");
        const clone = root.cloneNode(true) as Element;
        node.removeAttribute("data-kuroko-shadow");
        clone.setAttribute("width", String(pixelWidth));
        clone.setAttribute("height", String(pixelHeight));
        const selected = clone.querySelector('[data-kuroko-shadow="selected"]')!;
        // Ancestor compositing will still apply to the replacement image, so do not bake it in twice.
        for (const parent of [...ancestors(selected, clone), clone]) {
            for (const attribute of ["opacity", "clip-path", "mask", "filter"]) parent.removeAttribute(attribute);
        }
        const style = doc.createElementNS(SVG_NS, "style");
        style.textContent = 'svg *{visibility:hidden!important}svg defs,svg defs *,svg [data-kuroko-shadow="selected"],svg [data-kuroko-shadow="selected"] *{visibility:visible!important}';
        clone.prepend(style);
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: SVG_MIME }));
        const image = new Image();
        const canvas = globalThis.document.createElement("canvas");
        try {
            image.src = url;
            await image.decode();
            signal.throwIfAborted();
            canvas.width = pixelWidth; canvas.height = pixelHeight;
            const context = canvas.getContext("2d", { willReadFrequently: true })!;
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight).data;
            let left = pixelWidth, top = pixelHeight, right = -1, bottom = -1;
            for (let y = 0; y < pixelHeight; y++) for (let x = 0; x < pixelWidth; x++) {
                if (pixels[(y * pixelWidth + x) * 4 + 3]) {
                    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
                }
            }
            if (right < left) throw new Error("An Office shadow rendered empty; conversion stopped to avoid losing an effect.");
            const cropped = globalThis.document.createElement("canvas");
            cropped.width = right - left + 1; cropped.height = bottom - top + 1;
            cropped.getContext("2d")!.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
            const replacement = doc.createElementNS(SVG_NS, "image");
            replacement.setAttribute("href", cropped.toDataURL("image/png"));
            replacement.setAttribute("x", String(box[0] + left / pixelWidth * box[2]));
            replacement.setAttribute("y", String(box[1] + top / pixelHeight * box[3]));
            replacement.setAttribute("width", String(cropped.width / pixelWidth * box[2]));
            replacement.setAttribute("height", String(cropped.height / pixelHeight * box[3]));
            replacement.setAttribute("preserveAspectRatio", "none");
            // Raster coordinates are in root viewBox space. Undo the parent transforms at insertion.
            let matrix = new DOMMatrix();
            for (const parent of ancestors(node, root)) {
                const transform = (parent as SVGGraphicsElement).transform?.baseVal.consolidate();
                if (transform) matrix = matrix.multiply(transform.matrix);
            }
            const inverse = matrix.inverse();
            if (![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) throw new Error("Cannot rasterize a shadow with a singular transform.");
            replacement.setAttribute("transform", `matrix(${inverse.a} ${inverse.b} ${inverse.c} ${inverse.d} ${inverse.e} ${inverse.f})`);
            node.replaceWith(replacement);
            cropped.width = cropped.height = 0;
            count++;
        } finally {
            URL.revokeObjectURL(url);
            canvas.width = canvas.height = 0;
        }
        // Yield between islands so cancel and UI updates can run.
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (const filter of filters) filter.remove();
    return { svg: new XMLSerializer().serializeToString(root), shadows: count };
}
