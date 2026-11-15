# Kuroko

English | [日本語](README.ja.md)

Kuroko is a small tool for saving figures copied from PowerPoint or Excel as PDF files.
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

1. Open [Kuroko](https://shioyadan.github.io/kuroko2/) in Chrome or Edge.
2. Select and copy a figure in PowerPoint or Excel.
3. Return to Kuroko and press Ctrl+V (⌘V on Mac), or click Paste Objects.
4. If fonts are missing, load them as described below.
5. Check the PDF preview, then click Save PDF or press Ctrl+S / ⌘S.

Enable Auto Capture on Focus to paste automatically when you return to the Kuroko window.
You can also open an SVG file directly or drag it into the window.


### Loading fonts

You may need to load fonts once per session so the PDF uses the same typefaces as your figure.

- Click Use Local Fonts and allow the browser to access your fonts.
- If a font cannot be found automatically, use Select Font Files… to choose its TTF, OTF or TTC file. On Windows, fonts are usually in `C:\Windows\Fonts`.
- For Office fonts such as Aptos, use Fonts → Office CloudFonts… and select the `CloudFonts` folder under `%LOCALAPPDATA%\Microsoft\FontCache`.

PDF creation resumes automatically when the missing fonts are loaded. While the preview says
“SVG preview · PDF pending,” the PDF is not ready yet. Loaded figures and fonts are kept only
until you close or reload the page. Save history separately remembers names, small previews and save destinations on this device.


### Editing and saving similar figures

Save a figure once with your chosen PDF name. When you paste a slightly edited
version, Kuroko compares it with your recent saves and automatically suggests a
name after the PDF is ready. Check the previous and current previews, then choose:

- Overwrite PDF to save to the previously selected file, when the browser can reuse that destination. Nothing is overwritten until you confirm.
- Save with this name when the previous destination is unavailable. The browser opens a save dialog or downloads a new copy.
- Save as… to choose a different name or destination, or Not now to continue without saving.

The Save history button lets you forget entries, clear history, or turn off
automatic suggestions. It remembers up to 30 recent saves made with this feature;
it does not scan existing PDFs on your computer. Clearing history does not delete
PDF files. History is specific to the browser and site, and stays on your device.
In browsers that only download files, Kuroko cannot overwrite an earlier download
or know whether the download finished; the browser controls duplicate names.


## Known limitations and troubleshooting

- Cannot paste: the copied content must include SVG. Check the selected objects and copy them again in PowerPoint. Clipboard content containing only EMF or PNG is not supported. You can also save the figure as SVG and open that file.
- Permission prompts: clipboard and local font access require browser permission. If the offline app restricts these features, use the [web app](https://shioyadan.github.io/kuroko2/) or select SVG and font files directly.
- Cannot save: missing fonts, missing characters or font embedding restrictions can prevent PDF creation. Check the message on screen and the Log pane.
- No save dialog: some browsers download the PDF instead. Check your browser's download location.
- Some SVG effects and font settings are not supported. Check the preview before saving. Any whitespace included in the SVG is retained in the PDF.


## How to build

Most users should use the [web app](https://shioyadan.github.io/kuroko2/) or
[offline download](https://shioyadan.github.io/kuroko2/kuroko-latest.zip).
For building from source and contributing, see the [development guide](docs/development.md).


## License

Copyright (C) 2016–2026 Ryota Shioya

Released under the [3-Clause BSD License](LICENSE.md).
Bundled library notices are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and
About Kuroko → Licenses in the app. Microsoft fonts are not included.
