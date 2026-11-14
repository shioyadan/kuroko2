/* tslint:disable */
/* eslint-disable */

export class SvgPdfConverter {
    free(): void;
    [Symbol.dispose](): void;
    add_font(data: Uint8Array): number;
    clear_fonts(): void;
    convert(svg: string, embed_text: boolean): Uint8Array;
    constructor();
}

export function engine_name(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_svgpdfconverter_free: (a: number, b: number) => void;
    readonly engine_name: (a: number) => void;
    readonly svgpdfconverter_add_font: (a: number, b: number, c: number) => number;
    readonly svgpdfconverter_clear_fonts: (a: number) => void;
    readonly svgpdfconverter_convert: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly svgpdfconverter_new: () => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
