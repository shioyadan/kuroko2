# Development

For usage and downloads, see [English](../README.md) or [日本語](../README.ja.md).

## Build and run

Use Node.js **22.12 or newer**, npm and GNU Make.

```sh
npm ci
make production
# Output: dist-web/index.html
```

The production artifact is one HTML file containing JavaScript, CSS, the conversion
and preview workers, both WASM engines, and license notices. No runtime CDN or
server-side conversion is required.

```sh
make serve     # Development server: http://127.0.0.1:8080
./kuroko.sh    # Serve the built HTML only: http://127.0.0.1:30080
```

`kuroko.sh` requires Python 3; `KUROKO_PORT` overrides its port. On Windows,
`py -m http.server 30080 --bind 127.0.0.1 --directory dist-web` is another option.

## Checks and packaging

```sh
npx playwright-core install --with-deps chromium
make check
make archive
```

`make check` runs launcher syntax validation, TypeScript checks, core tests, license
checks, the production build, the single-HTML check and browser smoke tests.
Linux tests also require DejaVu Sans (`fonts-dejavu-core` on Ubuntu).
Set `CHROMIUM_PATH` to use an existing Chromium executable, or `TEST_FONT_PATH`
to override the location of `DejaVuSans.ttf`.

Browser tests open the production HTML via `file://` and check clipboard paths,
PDF dimensions and vector output, embedded text extraction, missing fonts/glyphs,
Office shadows and reflected gradients, save/cancel behavior, auto-capture error
recovery, logs, mobile layout, and the absence of external HTTP requests.
Native PowerPoint clipboard formats and OS permission dialogs still need manual
testing on the target platform.

`make release-archive` runs checks and packages the app as
`dist-release/kuroko-v<version>.zip`. `make archive ARCHIVE_NAME=kuroko-latest`
packages the already-built app under the stable download filename used on Pages.
Both archives include the English and Japanese guides and license notices.

## GitHub Pages

[`.github/workflows/pages.yml`](https://github.com/shioyadan/kuroko2/blob/master/.github/workflows/pages.yml) runs on pushes to
`master` and manual dispatches. It installs Node.js and Chromium, runs `make check`,
packages the offline ZIP, then deploys the checked HTML and ZIP with the official
GitHub Pages actions. The build job only has repository read access; the deployment
job receives `pages: write` and `id-token: write`.

For a new repository, set **Settings → Pages → Build and deployment → Source**
to **GitHub Actions** once. The workflow does not require a personal access token.
After that, pushes update both the web app and `kuroko-latest.zip` automatically.
Failed builds do not deploy. Test output is retained as an Actions artifact for
diagnosis when a build fails.

## Architecture

The React/TypeScript UI subscribes to immutable Store snapshots with
`useSyncExternalStore()`. State changes and asynchronous operations enter through
synchronous `dispatch()` actions; request IDs prevent stale work from replacing
newer figures. The application structure and log pane follow Konata, while the
toolbar and paste/save flow follow the original Kuroko.

| Location | Responsibility |
| --- | --- |
| `src/app.tsx`, `src/components/` | Toolbar, preview, dialogs and bounded, resizable console log pane |
| `src/store.ts` | Input, font resolution, conversion, cancellation and saving |
| `src/core/clipboard.ts` | Paste events, Async Clipboard API and UTF-8/UTF-16 decoding |
| `src/core/svg.ts` | SVG validation/sanitization, dimensions and required fonts |
| `src/core/fonts.ts` | SFNT/TTC metadata, embedding restrictions, deduplication and glyph coverage |
| `src/core/effects.ts` | Rasterize Office shadows at 150 dpi while preserving z-order |
| `src/core/conversion_worker.ts` | krilla-svg WASM conversion |
| `src/core/pdf_preview_worker.ts` | Render the generated PDF with PDFium |
| `src/file_access.ts` | Save picker and download fallback |
| `vendor/krilla-wasm/` | Validated WASM binary, Rust source and Cargo.lock from the SVG experiment |

Conversion and preview workers are terminated on completion, cancellation or
timeout. PDFium supports the type-1 shadings emitted by krilla for reflected Office
gradients. PDF.js is a development dependency used only for independent text
extraction tests.

SVG dimensions use 96 CSS px per inch and PDF dimensions use 72 pt per inch.
The source SVG remains unchanged for inspection/download. Sanitized and prepared
versions are derived separately. Only allowed elements/attributes are retained;
scripts, event handlers, external references and nested SVG image data are removed.

Inline styles and presentation attributes are supported. Stylesheets, relative
font weights, `font-stretch`, text inside Office shadow nodes, variable font axes
and implicit CJK fallback are outside the current scope. Missing fonts/glyphs and
restricted, bitmap-only or no-subsetting fonts stop conversion. Limits include
20 MiB input SVGs, 30,000 elements, font/rasterization budgets and 30-second worker
timeouts. Non-Office filters are handled by krilla-svg.

## Notices and local files

Update third-party notices after dependency changes with
`python3 tools/generate_licenses.py` (Python 3.11+). It downloads locked Rust crate
archives and verifies their SHA-256 checksums. Normal builds use the checked-in
notices without network access. Follow the vendor READMEs when updating WASM.

`work/`, logs, build outputs and `node_modules/` are ignored by Git. Keep working
notes, including `AGENTS.md`, under `work/` rather than committing them.
