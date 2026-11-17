# kuroko 2

English | [日本語](README.ja.md)

kuroko 2 is a small tool for saving figures copied from PowerPoint or Excel as PDF files.
A typical use is preparing figures for LaTeX papers and presentations.

- Getting started
    - **[Open the web app](https://shioyadan.github.io/kuroko2/)** — no installation required.
    - [Download the offline app](https://shioyadan.github.io/kuroko2/kuroko-latest.zip) — extract the ZIP and open `index.html`.
        - The offline app is required to upload PDFs to Overleaf.
- Features
    - Shapes and text stay sharp as vectors. Effects such as shadows may be saved as images.
    - PDF conversion runs entirely in your browser without communicating with a server.
        - Overleaf transfers use your local Git installation. Only this feature communicates with the locally running server.


## How to use

1. Open [kuroko 2](https://shioyadan.github.io/kuroko2/) in Chrome or Edge.
2. Select and copy a figure in PowerPoint or Excel.
3. Return to kuroko 2 and press Ctrl+V (⌘V on Mac), or click Paste Objects.
4. If fonts are missing, check the substitute-font preview or load the original fonts.
5. Check the PDF preview, then click Save PDF or press Ctrl+S / ⌘S.


### Using Overleaf

When opened through the local launcher, kuroko 2 can upload generated PDFs to an
Overleaf project, or retrieve project PDFs for preview and download.
Python 3 and Git are required. On Windows, run the launcher in WSL. This feature
is available at the URL printed by the launcher; it is unavailable in the hosted
web app or when opening the HTML file directly.

This feature uses your local Git installation to work with project files, so make
sure Git can connect to Overleaf. The following setting caches your token after
successful authentication:

```
git config --global credential.https://git.overleaf.com.helper 'cache --timeout=28800'
```

## Known limitations and troubleshooting

- Saving to WSL from Windows: Chrome's file access restrictions can reject WSL folders after you confirm the save dialog. Save to a Windows folder and copy the PDF into WSL, or try Download PDF instead.


## How to build

Most users should use the [web app](https://shioyadan.github.io/kuroko2/) or
[offline download](https://shioyadan.github.io/kuroko2/kuroko-latest.zip).
For building from source and contributing, see the [development guide](docs/development.md).


## License

Copyright (C) 2016–2026 Ryota Shioya

Released under the [3-Clause BSD License](LICENSE.md).
Bundled library notices are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and
Menu → About kuroko 2 → Licenses in the app. Microsoft fonts are not included.
