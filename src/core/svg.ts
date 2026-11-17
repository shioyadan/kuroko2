export const SVG_MIME = "image/svg+xml";
export const SVG_NS = "http://www.w3.org/2000/svg";
export const MAX_SVG_BYTES = 20 * 1024 * 1024;
export interface FontRequirement {
    readonly family: string;
    readonly weight: number;
    readonly style: "normal" | "italic";
    readonly text: string;
}
export interface SvgDocument {
    readonly raw: string;
    readonly sanitized: string;
    readonly width: number;
    readonly height: number;
    readonly fonts: readonly FontRequirement[];
    readonly warnings: readonly string[];
}

const elements = new Set(("svg g defs title desc path rect circle ellipse line polyline polygon text tspan textPath " +
    "linearGradient radialGradient stop clipPath mask pattern marker image use symbol filter feBlend feColorMatrix " +
    "feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow " +
    "feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset " +
    "fePointLight feSpecularLighting feSpotLight feTile feTurbulence").split(" "));
const attributes = new Set(("id xmlns xmlns:xlink xml:space viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry " +
    "width height d points transform fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-dasharray " +
    "stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit opacity color display visibility overflow " +
    "clip-path clip-rule mask filter href xlink:href gradientUnits gradientTransform spreadMethod offset stop-color " +
    "stop-opacity fx fy fr patternUnits patternContentUnits patternTransform maskUnits maskContentUnits clipPathUnits " +
    "markerWidth markerHeight markerUnits refX refY orient marker-start marker-mid marker-end font-family font-size " +
    "font-weight font-style font-stretch font-variant text-anchor dominant-baseline alignment-baseline baseline-shift " +
    "text-decoration letter-spacing word-spacing dx dy rotate textLength lengthAdjust startOffset method spacing " +
    "filterUnits primitiveUnits in in2 result stdDeviation type values tableValues slope intercept amplitude exponent " +
    "operator k1 k2 k3 k4 mode color-interpolation color-interpolation-filters flood-color flood-opacity lighting-color " +
    "scale xChannelSelector yChannelSelector radius baseFrequency numOctaves seed stitchTiles surfaceScale " +
    "diffuseConstant specularConstant specularExponent limitingConeAngle azimuth elevation pointsAtX pointsAtY pointsAtZ z " +
    "order kernelMatrix divisor bias targetX targetY edgeMode kernelUnitLength preserveAlpha").split(" "));
const cssProperties = new Set([...attributes].filter(name => /^[a-z]+(?:-[a-z]+)*$/.test(name)));

export function parseSvgLength(value: string | null): number | null {
    const match = value?.trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(px|pt|pc|mm|cm|in)?$/i);
    if (!match) return null;
    const factors: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
    const result = Number(match[1]) * factors[(match[2] ?? "px").toLowerCase()];
    return Number.isFinite(result) && result > 0 ? result : null;
}
export function fontKey(font: Pick<FontRequirement, "family" | "weight" | "style">): string {
    return `${normalizeFontFamily(font.family)}|${font.weight}|${font.style}`;
}
export function normalizeFontFamily(family: string): string {
    return family.trim().replace(/^['"]|['"]$/g, "").replace(/_MSFontService$/i, "").replace(/\s+/g, " ").toLowerCase();
}
export function fontLabel(font: Pick<FontRequirement, "family" | "weight" | "style">): string {
    return `${font.family} ${font.weight}${font.style === "italic" ? " Italic" : ""}`;
}
function safeReference(value: string, raster: boolean): boolean {
    return /^#[\w:.-]+$/.test(value.trim()) || (raster && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value));
}
function safeValue(value: string): boolean {
    if (/[\\]|@import|var\s*\(|expression\s*\(/i.test(value)) return false;
    for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) {
        if (!safeReference(match[1].trim().replace(/^['"]|['"]$/g, ""), false)) return false;
    }
    return !/url/i.test(value.replace(/url\s*\([^)]*\)/gi, ""));
}
export function inherited(node: Element, name: string, fallback: string): string {
    for (let current: Element | null = node; current; current = current.parentElement) {
        const value = current.getAttribute(name);
        if (value && value !== "inherit") return value;
    }
    return fallback;
}
export function textFont(node: Element): Omit<FontRequirement, "text"> {
    const family = inherited(node, "font-family", "Times New Roman").split(",")[0].trim().replace(/^['"]|['"]$/g, "").replace(/_MSFontService$/i, "");
    const weightValue = inherited(node, "font-weight", "400");
    const weight = weightValue === "bold" ? 700 : weightValue === "normal" ? 400 : Number(weightValue);
    if (!Number.isFinite(weight) || weight < 100 || weight > 900) throw new Error(`Unsupported font weight: ${weightValue}`);
    if (inherited(node, "font-stretch", "normal") !== "normal") throw new Error("font-stretch is not supported. Use the explicit Narrow font family.");
    return { family, weight, style: /italic|oblique/.test(inherited(node, "font-style", "normal")) ? "italic" : "normal" };
}
function collectFonts(root: Element): FontRequirement[] {
    const fonts = new Map<string, FontRequirement>();
    for (const node of root.querySelectorAll("text,tspan,textPath")) {
        if (inherited(node, "display", "inline") === "none") continue;
        const text = [...node.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent ?? "").join("");
        if (!text.trim()) continue;
        const requirement: FontRequirement = { ...textFont(node), text };
        const key = fontKey(requirement);
        fonts.set(key, { ...requirement, text: (fonts.get(key)?.text ?? "") + text });
        // Office sometimes appends a service suffix that fontdb cannot resolve.
        node.setAttribute("font-family", requirement.family);
    }
    return [...fonts.values()];
}

export function parseSvg(raw: string): SvgDocument {
    if (new TextEncoder().encode(raw).length > MAX_SVG_BYTES) throw new Error("SVG exceeds the 20 MiB limit.");
    if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error("SVG document types and entities are not supported.");
    const doc = new DOMParser().parseFromString(raw, SVG_MIME);
    const root = doc.documentElement;
    if (doc.querySelector("parsererror") || root.localName !== "svg" || root.namespaceURI !== SVG_NS) {
        throw new Error("The clipboard does not contain a valid SVG document.");
    }
    const nodes = [root, ...root.querySelectorAll("*")];
    if (nodes.length > 30000) throw new Error("SVG contains too many elements (maximum 30,000).");
    const warnings = new Set<string>();
    for (const node of nodes) {
        if (!root.contains(node) && node !== root) continue;
        let depth = 0;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) depth++;
        if (depth > 128) throw new Error("SVG nesting exceeds the supported limit.");
        if (node.localName === "style" && node.textContent?.trim()) {
            throw new Error("SVG stylesheets are not supported. Use an SVG with inline styles or presentation attributes, as copied by PowerPoint.");
        }
        if (!elements.has(node.localName) || node.namespaceURI !== SVG_NS) {
            warnings.add(`Removed unsupported SVG element: ${node.localName}`);
            node.remove();
            continue;
        }
        // Inline declarations override presentation attributes; normalize them before font analysis.
        const style = (node as SVGElement).style;
        if (node.hasAttribute("style")) {
            for (const property of [...style]) {
                const value = style.getPropertyValue(property).trim();
                if (!cssProperties.has(property) || !safeValue(value)) throw new Error(`Unsupported SVG style: ${property}`);
                node.setAttribute(property, value);
            }
            node.removeAttribute("style");
        }
        for (const attribute of [...node.attributes]) {
            const name = attribute.name;
            const reference = name === "href" || name === "xlink:href";
            // Image data is not CSS: Base64 can contain "url" by chance.
            // Validate references separately while still rejecting external/active content.
            const safe = reference
                ? safeReference(attribute.value, node.localName === "image" || node.localName === "feImage")
                : safeValue(attribute.value);
            if (!attributes.has(name) || !safe) {
                warnings.add(`Removed unsupported or external SVG attribute: ${name}`);
                node.removeAttributeNode(attribute);
            }
        }
    }
    let width = parseSvgLength(root.getAttribute("width"));
    let height = parseSvgLength(root.getAttribute("height"));
    let box = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (!box || box.length !== 4 || box.some(n => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0) {
        if (root.hasAttribute("viewBox") || !width || !height) throw new Error("SVG needs a valid width, height or viewBox.");
        box = [0, 0, width, height];
        root.setAttribute("viewBox", box.join(" "));
    }
    width ??= height ? height * box[2] / box[3] : box[2];
    height ??= width * box[3] / box[2];
    if (width > 19200 || height > 19200) throw new Error("SVG exceeds the maximum page size (200 inches).");
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
    const fonts = collectFonts(root);
    if (fonts.length > 128) throw new Error("SVG requests too many fonts.");
    return { raw, sanitized: new XMLSerializer().serializeToString(root), width, height, fonts, warnings: [...warnings] };
}
