import ConversionWorker from "./conversion_worker";
import type { LoadedFont } from "./fonts";
import type { FontRequirement, SvgDocument } from "./svg";
import { prepareSvg } from "./effects";
import { workerRequest } from "./worker_request";

export async function convertSvg(document: SvgDocument, fonts: readonly LoadedFont[], signal: AbortSignal, syntheticBold: readonly FontRequirement[] = []): Promise<Uint8Array<ArrayBuffer>> {
    const prepared = await prepareSvg(document, signal, syntheticBold);
    if (prepared.shadows) console.info(`Rasterized ${prepared.shadows} Office shadows at 150 dpi; shapes remain vector.`);
    const result = await workerRequest<{ pdf: Uint8Array<ArrayBuffer> }>(() => new ConversionWorker(),
        { svg: prepared.svg, fonts: fonts.map(font => font.bytes) }, signal, {
        cancelled: "Conversion cancelled",
        timeout: "PDF conversion timed out after 30 seconds. Copy a smaller group of objects.",
        failed: "The PDF conversion worker failed."
    });
    return result.pdf;
}
