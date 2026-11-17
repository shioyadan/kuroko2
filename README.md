# kuroko 2

English | [日本語](README.ja.md)

kuroko 2 is a small tool for saving figures copied from PowerPoint or Excel as PDF files.
A typical use is preparing figures for LaTeX papers and presentations.

- Getting started
    - **[Open the web app](https://shioyadan.github.io/kuroko2/)** — no installation required.
    - [Download the offline app](https://shioyadan.github.io/kuroko2/kuroko-latest.zip) — extract the ZIP and open `index.html`.
- Features
    - Shapes and text stay sharp as vectors. Effects such as shadows may be saved as images.
    - Each PDF page is sized to fit the copied figure.
    - All processing happens locally in your browser. Nothing is uploaded to a server.
    - This is a browser-based successor to the [original Kuroko](https://github.com/shioyadan/kuroko). It does not require Electron or the Microsoft Print to PDF printer.


## How to use

1. Open [kuroko 2](https://shioyadan.github.io/kuroko2/) in Chrome or Edge.
2. Select and copy a figure in PowerPoint or Excel.
3. Return to kuroko 2 and press Ctrl+V (⌘V on Mac), or click Paste Objects.
4. If fonts are missing, load them as described below.
5. Check the PDF preview, then click Save PDF or press Ctrl+S / ⌘S.

The file name is editable just to the left of the menu. Fit to window and the preview zoom selector are also in the top toolbar.

You can open an SVG file directly or drag it into the window. The menu (☰) at the
top right contains Open SVG, Fonts, View source SVG, Save history and About kuroko 2.
Clipboard reading, PDF creation and preview rendering progress appear at the top
right of the toolbar. Use the × beside the progress message to cancel.


### Loading fonts

The fonts needed by your figure are loaded automatically when you paste it. On
first use, allow the browser to access your fonts if asked. Granted fonts are also
loaded automatically after a page reload.

The top right of the toolbar shows whether fonts are loading, missing or ready.
If fonts are still needed, click Add fonts… there. Menu → Fonts opens the same guide.

- If permission is needed, click Allow font access. If access is blocked or unavailable, the guide offers folder selection.
- Click Choose font folder… to find the missing fonts in that folder and its subfolders. For Office fonts such as Aptos, select the `CloudFonts` folder under `%LOCALAPPDATA%\Microsoft\FontCache`. Other installed fonts are usually in `C:\Windows\Fonts`.
- To select TTF, OTF, TTC or OTC files directly, expand Choose individual font files instead. If the guide is asking for permission, expand Add fonts from a folder or files instead first.

Once the fonts are loaded, PDF creation resumes and the guide closes when the PDF
is ready. Closing a permission prompt does not make it appear on every paste;
use Add fonts… to retry.

Cambria Math bold is generated automatically from its regular font when no bold
face is available. The font guide shows Synthesized bold. Its appearance is
adjusted to approximate Windows rendering; no extra font file is needed.

While the preview says
“SVG preview · PDF pending,” the PDF is not ready yet. Loaded figures and fonts are kept only
until you close or reload the page; local fonts are loaded again automatically while access remains allowed. Manually selected font files and folders need to be selected again after a reload. Save history separately remembers names, previews and save destinations on this device.


### Editing and saving similar figures

Save a figure once with your chosen PDF name. When you paste a slightly edited
version, kuroko 2 compares it with your recent saves and automatically suggests a
name after the PDF is ready. Check the previous and current previews, then choose:

- Overwrite PDF to save to the previously selected file, when the browser can reuse that destination. Nothing is overwritten until you confirm.
- Save with this name when the previous destination is unavailable. The browser opens a save dialog or downloads a new copy.
- Save as… to choose a different name or destination, or Not now to continue without saving.

In Chrome and Edge, the save dialog starts in the folder of the last successfully
saved PDF, including after a reload when that destination is in your history.
No separate folder selection is needed. The Previously saved preview is stored
at up to 1200×900 pixels; older history entries gain the improved resolution when
you save them again.

Menu → Save history lets you forget entries, clear history, or turn off
automatic suggestions. It remembers up to 30 recent saves made with this feature;
it does not scan existing PDFs on your computer. Clearing history does not delete
PDF files. History is specific to the browser and site, and stays on your device.
In browsers that only download files, kuroko 2 cannot overwrite an earlier download
or know whether the download finished; the browser controls duplicate names.


## Known limitations and troubleshooting

- Cannot paste: the copied content must include SVG. Check the selected objects and copy them again in PowerPoint. Clipboard content containing only EMF or PNG is not supported. You can also save the figure as SVG and open that file.
- Permission prompts: clipboard and local font access require browser permission. If the offline app restricts these features, use the [web app](https://shioyadan.github.io/kuroko2/) or select SVG and font files directly.
- Cannot save: missing fonts, missing characters or font embedding restrictions can prevent PDF creation. Check the message on screen and the Log pane. If writing to the selected file fails, use Download PDF instead in the error message to save a new copy through your browser.
- No save dialog: some browsers download the PDF instead. Check your browser's download location.
- Saving to WSL from Windows: Chrome's file access restrictions can reject WSL folders after you confirm the save dialog. Save to a Windows folder and copy the PDF into WSL, or try Download PDF instead. See the [Chromium report](https://issues.chromium.org/issues/553114097).
- Some SVG effects and font settings are not supported. Check the preview before saving. Any whitespace included in the SVG is retained in the PDF.


## How to build

Most users should use the [web app](https://shioyadan.github.io/kuroko2/) or
[offline download](https://shioyadan.github.io/kuroko2/kuroko-latest.zip).
For building from source and contributing, see the [development guide](docs/development.md).


## License

Copyright (C) 2016–2026 Ryota Shioya

Released under the [3-Clause BSD License](LICENSE.md).
Bundled library notices are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and
Menu → About kuroko 2 → Licenses in the app. Microsoft fonts are not included.
