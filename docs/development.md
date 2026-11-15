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
Office shadows and reflected gradients, save/cancel behavior, clipboard permission
recovery, logs, mobile layout, and the absence of external HTTP requests.
Native PowerPoint clipboard formats and OS permission dialogs still need manual
testing on the target platform.

The save-history suite uses real serializable handles in the browser's test
filesystem. It checks edited-figure matching, reload persistence, confirmation
before writes, denied permissions, Save as, clearing history and unavailable
storage without touching user files. It also checks interrupted writes, readback
of saved files, explicit download recovery, and history persistence on ordinary
HTTP origins where `crypto.randomUUID()` is unavailable.

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
| `src/core/figure_match.ts` | A small ink-layout descriptor and shape histogram for similar-figure suggestions |
| `src/save_history.ts` | Bounded IndexedDB history, thumbnails and reusable save handles |
| `vendor/krilla-wasm/` | Validated WASM binary, Rust source and Cargo.lock from the SVG experiment |

Conversion and preview workers are terminated on completion, cancellation or
timeout. PDFium supports the type-1 shadings emitted by krilla for reflected Office
gradients. PDF.js is a development dependency used only for independent text
extraction tests.

Successful saves (or started downloads) add up to 30 history entries with a
32×32 ink descriptor, shape counts, a PNG preview up to 1200×900 and the file name.
Previews exceeding two million data-URL characters are downscaled to bound storage;
older, smaller previews remain compatible and update on the next save. Native
save handles are persisted where supported. Complete SVG/PDF/font contents are
not retained. The similarity threshold gates suggestions; it is a heuristic, not
a probability, and matching never authorizes a write. A separate confirmation
action requests write permission and reuses the exact saved handle. Saving is
locked against new input until its result is recorded. Storage failures retain
session-only history without blocking PDF saving.

When a figure needs fonts, the store checks the `local-fonts` permission and
automatically enumerates installed fonts. First use can request permission while
the paste/open gesture is still active; a dismissed prompt is not repeated
automatically during the session. Granted access needs no gesture. Concurrent
queries share one enumeration, and cancelled conversions cannot start a prompt.
The toolbar shows progress for clipboard reading, font loading, PDF creation and
preview rendering, with a cancellation action beside it. When idle it shows the
font state and, when needed, Add fonts…. Add fonts… and Menu → Fonts open the same setup guide:
permission when needed, then folder selection for remaining fonts, with an
individual-file fallback. File selection never triggers a new permission prompt.
The catalog and selected folders are reused for the session; only the permission
survives reload. `test/local_fonts_smoke.cjs` covers the setup flow and Chromium's
real font API, including conversion without user activation and PDF text extraction.

The save picker receives the last successfully saved file handle as `startIn`.
The handle is restored from the latest history entry with a reusable destination.
It only sets the initial folder; a new destination still requires the picker, and
overwriting a suggested file still requires confirmation. The stable picker ID
`kuroko-pdf` supplies the browser's remembered folder when no handle is available.

Save stages appear in the status bar and log. An `AbortError` from the file picker
means it returned no destination; the app cannot distinguish cancellation from a
browser rejection. Errors while opening, writing or closing a file are
reported as failed saves. Native file handles are read back after closing to check
the size and PDF header before adding history. A failed native save offers an
explicit download fallback, whose history entry has no reusable file handle. This
fallback is also offered after a picker `AbortError`, but requires another click
so cancelling the picker never starts a download automatically. The PDF picker has
a stable `id` so its last directory is remembered separately from SVG/font pickers.

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
