declare module "*.css";
declare module "*?inline" { const url: string; export default url; }
declare module "@hyzyla/pdfium/pdfium.wasm" { const url: string; export default url; }
declare module "*?source" { const source: string; export default source; }
declare module "*conversion_worker" { const WorkerClass: { new(): Worker }; export default WorkerClass; }
declare const __KUROKO_VERSION__: string;
declare const __KUROKO_BUILD__: string;
declare const __KUROKO_LICENSES__: string;
